// Socle : utilitaires, connexion, navigation, chat. Les écrans de candidature sont dans candidature.js.
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
let code = store.get('code');

function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

// Menu du bas : renvoie la valeur choisie, ou null
function menu(titre, items) {
  return new Promise((resolve) => {
    const m = $('menu');
    m.replaceChildren();
    if (titre) { const h = document.createElement('h3'); h.textContent = titre; m.appendChild(h); }
    const fin = (v) => { $('scrim').hidden = true; resolve(v); };
    items.forEach((it) => {
      const b = document.createElement('button');
      b.textContent = it.label;
      if (it.cur) b.className = 'cur';
      if (it.danger) b.className = 'danger';
      b.onclick = () => fin(it.value);
      m.appendChild(b);
    });
    $('scrim').onclick = (e) => { if (e.target === $('scrim')) fin(null); };
    $('scrim').hidden = false;
  });
}

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'x-code': code, ...(opts.headers || {}) } });
  if (r.status === 401) { store.del('code'); showLogin(true); }
  return r;
}
async function erreurDe(r) { try { return (await r.json()).error || 'Erreur.'; } catch { return 'Erreur.'; } }

// Lecture d'un flux SSE (data: {...}\n\n)
async function lireFlux(r, onEvent) {
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 2);
      if (l.startsWith('data: ')) onEvent(JSON.parse(l.slice(6)));
    }
  }
}

// ---------- connexion ----------
function showLogin(show) {
  $('login').style.display = show ? 'flex' : 'none';
  $('main').style.display = show ? 'none' : 'flex';
  if (!show && window.initApp) window.initApp();
}
async function checkCode(c) {
  const r = await fetch('/api/ping', { headers: { 'x-code': c } });
  return r.ok;
}
$('go').onclick = async () => {
  const c = $('code').value;
  $('loginErr').textContent = '';
  try {
    if (await checkCode(c)) { code = c; store.set('code', c); showLogin(false); }
    else $('loginErr').textContent = 'Code incorrect.';
  } catch { $('loginErr').textContent = 'Serveur injoignable.'; }
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });

// ---------- navigation ----------
function setView(v) {
  document.querySelectorAll('.view').forEach((s) => { s.hidden = s.id !== 'v-' + v; });
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (window.surVue) window.surVue(v);
}
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => setView(b.dataset.v); });

// ---------- chat ----------
let sessionId = store.get('sid');
const newSid = () => { sessionId = crypto.randomUUID(); store.set('sid', sessionId); };
if (!sessionId) newSid();
let chatOccupe = false;

function ajouter(cls, texte) {
  const d = document.createElement('div');
  d.className = 'm ' + cls; d.textContent = texte;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight;
  return d;
}
$('reset').onclick = () => { newSid(); $('log').innerHTML = ''; };
$('msg').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; });

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const texte = $('msg').value.trim();
  if (!texte || chatOccupe) return;
  chatOccupe = true; $('send').disabled = true;
  $('msg').value = ''; $('msg').style.height = 'auto';
  ajouter('u', texte);
  const bulle = ajouter('a', '…');
  let recu = false;
  try {
    const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: texte, sessionId }) });
    if (!r.ok) { bulle.remove(); ajouter('e', await erreurDe(r)); }
    else await lireFlux(r, (ev) => {
      if (ev.t === 'delta') { if (!recu) { bulle.textContent = ''; recu = true; } bulle.textContent += ev.text; $('log').scrollTop = $('log').scrollHeight; }
      else if (ev.t === 'error') { if (!recu) bulle.remove(); ajouter('e', ev.message); }
    });
  } catch { bulle.remove(); ajouter('e', 'Connexion perdue, réessaie.'); }
  chatOccupe = false; $('send').disabled = false;
};

// ---------- démarrage ----------
(async () => {
  if (!code) return showLogin(true);
  try { showLogin(!(await checkCode(code))); } catch { showLogin(false); }
})();
