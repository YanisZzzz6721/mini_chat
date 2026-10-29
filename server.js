// Serveur de l'appli Postuler. Aucune dépendance (Node >= 18). Supervisé par lancer.sh.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const diag = require('./diag');

const PORT = Number(process.env.PORT || 3000);
const CODE = process.env.CODE;
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.MODEL || '';
const LIMITE_MIN = Number(process.env.LIMITE_PAR_MINUTE || 6);
const LIMITE_JOUR = Number(process.env.LIMITE_PAR_JOUR || 200);
const MAX_PARALLELE = Number(process.env.MAX_PARALLELE || 2);
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_S || 240) * 1000;

if (!CODE || CODE.length < 6) {
  diag.log('FATAL', 'CODE manquant ou trop court (6 caractères minimum).');
  process.exit(1);
}

// Une erreur non gérée laisse le serveur dans un état incertain : on journalise puis on sort, lancer.sh le relance.
process.on('uncaughtException', (e) => { diag.log('FATAL', 'uncaughtException : ' + ((e && e.stack) || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { diag.log('FATAL', 'unhandledRejection : ' + ((e && e.stack) || e)); process.exit(1); });

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const SANDBOX = path.join(ROOT, '.sandbox'); // dossier vide : Claude n'y voit rien d'autre
fs.mkdirSync(SANDBOX, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const codeOk = (c) => typeof c === 'string' && crypto.timingSafeEqual(sha(c), sha(CODE));

// limites par IP (Cloudflare fournit cf-connecting-ip)
const hits = new Map(); // ip -> { minute: [ts], jour: [ts], echecs: [ts] }
const ipOf = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
function bucket(ip) {
  if (!hits.has(ip)) hits.set(ip, { minute: [], jour: [], echecs: [] });
  return hits.get(ip);
}
const recent = (arr, ms) => { const t = Date.now() - ms; while (arr.length && arr[0] < t) arr.shift(); return arr; };

let actifs = 0;

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

const candidature = require('./candidature')({ ROOT, SANDBOX, CLAUDE_BIN, MODEL, CLAUDE_TIMEOUT_MS, diag, auth, gate, acquire, release, json, readBody });

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const DEBUT = Date.now();

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const t0 = Date.now();
  if (url.pathname.startsWith('/api/')) res.on('finish', () => diag.log('REQ', `${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`));

  // sonde de santé pour lancer.sh : ne révèle rien (pas de code requis)
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, uptime: Math.round((Date.now() - DEBUT) / 1000), actifs });

  const route = candidature[req.method + ' ' + url.pathname];
  if (route) {
    Promise.resolve()
      .then(() => route(req, res, url))
      .catch((e) => {
        diag.log('ERREUR', `${req.method} ${url.pathname} : ${(e && e.stack) || e}`);
        if (!res.headersSent) json(res, 500, { error: 'Erreur côté serveur, réessaie.' });
        else res.end();
      });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/ping') { if (auth(req, res)) json(res, 200, { ok: true }); return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: 'Introuvable.' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

serveur.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    diag.log('FATAL', `Le port ${PORT} est déjà utilisé (un ancien serveur tourne peut-être encore). Pour voir lequel : lsof -i :${PORT}`);
    process.exit(2);
  }
  diag.log('FATAL', 'erreur du serveur HTTP : ' + ((e && e.stack) || e));
  process.exit(1);
});
serveur.listen(PORT, () => diag.log('INFO', `Postuler démarré sur http://localhost:${PORT}`));
