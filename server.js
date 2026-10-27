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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20000) { reject(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

function auth(req, res) {
  const b = bucket(ipOf(req));
  if (recent(b.echecs, 10 * 60 * 1000).length >= 10) { json(res, 429, { error: 'Trop d’essais, réessaie plus tard.' }); return false; }
  if (!codeOk(req.headers['x-code'])) { b.echecs.push(Date.now()); json(res, 401, { error: 'Code incorrect.' }); return false; }
  return true;
}

async function chat(req, res) {
  if (!auth(req, res)) return;
  const ip = ipOf(req);
  const b = bucket(ip);
  if (recent(b.minute, 60 * 1000).length >= LIMITE_MIN) return json(res, 429, { error: 'Doucement : trop de messages à la minute.' });
  if (recent(b.jour, 24 * 3600 * 1000).length >= LIMITE_JOUR) return json(res, 429, { error: 'Limite quotidienne atteinte.' });
  if (actifs >= MAX_PARALLELE) return json(res, 503, { error: 'Occupé, réessaie dans un instant.' });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Requête invalide.' }); }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MAX_CHARS) return json(res, 400, { error: `Message vide ou > ${MAX_CHARS} caractères.` });
  if (!UUID.test(body.sessionId || '')) return json(res, 400, { error: 'Session invalide.' });

  b.minute.push(Date.now()); b.jour.push(Date.now());
  actifs++;

  const args = ['-p', message,
    '--tools', '',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt', systemPrompt()];
  if (MODEL) args.push('--model', MODEL);
  if (sessions.has(body.sessionId)) args.push('--resume', body.sessionId);
  else args.push('--session-id', body.sessionId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  const child = spawn(CLAUDE_BIN, args, { cwd: SANDBOX, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '', fin = false, stderr = '';
  const done = () => { if (!fin) { fin = true; actifs--; } };

  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const delta = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta' && ev.event.delta.text;
      if (delta) send({ t: 'delta', text: delta });
    }
  });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => {
    done();
    if (code === 0) { sessions.add(body.sessionId); saveSessions(); send({ t: 'done' }); }
    else { console.error('claude a échoué', code, stderr.slice(0, 500)); send({ t: 'error', message: 'Erreur côté serveur, réessaie.' }); }
    res.end();
  });
  child.on('error', () => { done(); send({ t: 'error', message: 'claude introuvable sur le serveur.' }); res.end(); });
  res.on('close', () => { if (!fin) child.kill('SIGTERM'); });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);
  if (req.method === 'GET' && url.pathname === '/api/ping') { if (auth(req, res)) json(res, 200, { ok: true }); return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: 'Introuvable.' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => console.log(`Mini chat sur http://localhost:${PORT}`));
