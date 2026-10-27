// Mini chat web -> claude -p. Aucune dépendance (Node >= 18).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const CODE = process.env.CODE;
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.MODEL || '';
const LIMITE_MIN = Number(process.env.LIMITE_PAR_MINUTE || 6);
const LIMITE_JOUR = Number(process.env.LIMITE_PAR_JOUR || 200);
const MAX_PARALLELE = Number(process.env.MAX_PARALLELE || 2);
const MAX_CHARS = 4000;

if (!CODE || CODE.length < 6) {
  console.error('Définis CODE (6 caractères minimum) : CODE=monmotdepasse node server.js');
  process.exit(1);
}

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const SANDBOX = path.join(ROOT, '.sandbox'); // dossier vide : Claude n'y voit rien d'autre
const SESSIONS_FILE = path.join(SANDBOX, 'sessions.json');
fs.mkdirSync(SANDBOX, { recursive: true });

let sessions = new Set();
try { sessions = new Set(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))); } catch {}
const saveSessions = () => fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions]));

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const codeOk = (c) => typeof c === 'string' && crypto.timingSafeEqual(sha(c), sha(CODE));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// limites par IP (Cloudflare fournit cf-connecting-ip)
const hits = new Map(); // ip -> { minute: [ts], jour: [ts], echecs: [ts] }
const ipOf = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
function bucket(ip) {
  if (!hits.has(ip)) hits.set(ip, { minute: [], jour: [], echecs: [] });
  return hits.get(ip);
}
const recent = (arr, ms) => { const t = Date.now() - ms; while (arr.length && arr[0] < t) arr.shift(); return arr; };

let actifs = 0;

function systemPrompt() {
  return fs.readFileSync(path.join(ROOT, 'prompt-systeme.md'), 'utf8')
    .replace(/^---[\s\S]*?---\s*/, '').trim();
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > max) { reject(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

function auth(req, res) {
  const b = bucket(ipOf(req));
  if (recent(b.echecs, 10 * 60 * 1000).length >= 10) { json(res, 429, { error: 'Trop d’essais, réessaie plus tard.' }); return false; }
  if (!codeOk(req.headers['x-code'])) { b.echecs.push(Date.now()); json(res, 401, { error: 'Code incorrect.' }); return false; }
  return true;
}

// code d'accès + limites ; renvoie le compteur de l'IP, ou null si la requête a été refusée
function gate(req, res) {
  if (!auth(req, res)) return null;
  const b = bucket(ipOf(req));
  if (recent(b.minute, 60 * 1000).length >= LIMITE_MIN) { json(res, 429, { error: 'Doucement : trop de messages à la minute.' }); return null; }
  if (recent(b.jour, 24 * 3600 * 1000).length >= LIMITE_JOUR) { json(res, 429, { error: 'Limite quotidienne atteinte.' }); return null; }
  if (actifs >= MAX_PARALLELE) { json(res, 503, { error: 'Occupé, réessaie dans un instant.' }); return null; }
  return b;
}
const acquire = (b) => { b.minute.push(Date.now()); b.jour.push(Date.now()); actifs++; };
const release = () => { actifs--; };

async function chat(req, res) {
  const b = gate(req, res);
  if (!b) return;

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Requête invalide.' }); }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MAX_CHARS) return json(res, 400, { error: `Message vide ou > ${MAX_CHARS} caractères.` });
  if (!UUID.test(body.sessionId || '')) return json(res, 400, { error: 'Session invalide.' });

  acquire(b);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  let child, fin = false;
  const done = () => { if (!fin) { fin = true; actifs--; } };
  res.on('close', () => { if (!fin && child) child.kill('SIGTERM'); });

  // resume=true : reprend une conversation existante ; false : en crée une avec cet identifiant.
  // Si l'état connu est faux (ex. le serveur a redémarré), on retente une fois dans l'autre mode.
  function run(resume, canRetry) {
    const args = ['-p',
      '--tools', '',
      '--setting-sources', '',
      '--disable-slash-commands',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt', systemPrompt()];
    if (MODEL) args.push('--model', MODEL);
    args.push(resume ? '--resume' : '--session-id', body.sessionId);

    child = spawn(CLAUDE_BIN, args, { cwd: SANDBOX, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    child.stdin.end(message); // par stdin : un message commençant par "-" ne doit pas être pris pour une option
    let buf = '', stderr = '', sent = false;

    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const delta = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta' && ev.event.delta.text;
        if (delta) { sent = true; send({ t: 'delta', text: delta }); }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) { done(); sessions.add(body.sessionId); saveSessions(); send({ t: 'done' }); return res.end(); }
      if (canRetry && !sent && !res.destroyed) {
        if (!resume && /already in use/i.test(stderr)) { sessions.add(body.sessionId); saveSessions(); return run(true, false); }
        if (resume && /no conversation|not found/i.test(stderr)) { sessions.delete(body.sessionId); saveSessions(); return run(false, false); }
      }
      done();
      console.error('claude a échoué', code, stderr.slice(0, 500));
      send({ t: 'error', message: 'Erreur côté serveur, réessaie.' });
      res.end();
    });
    child.on('error', () => { done(); send({ t: 'error', message: 'claude introuvable sur le serveur.' }); res.end(); });
  }
  run(sessions.has(body.sessionId), true);
}

const candidature = require('./candidature')({ ROOT, SANDBOX, CLAUDE_BIN, MODEL, auth, gate, acquire, release, json, readBody });

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);
  if (url.pathname.startsWith('/api/profil') || url.pathname === '/api/candidature') {
    const h = candidature[req.method + ' ' + url.pathname];
    if (h) return h(req, res, url);
  }
  if (req.method === 'GET' && url.pathname === '/api/ping') { if (auth(req, res)) json(res, 200, { ok: true }); return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: 'Introuvable.' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => console.log(`Mini chat sur http://localhost:${PORT}`));
