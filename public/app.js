// Socle : utilitaires, connexion, navigation. Les écrans sont dans candidature.js.
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

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

// Feuille du bas. build(el, fermer) remplit le contenu ; la promesse se résout avec fermer(valeur).
function feuille(build) {
  return new Promise((resolve) => {
    const m = $('menu');
    m.replaceChildren();
    const fermer = (v) => { $('scrim').hidden = true; resolve(v === undefined ? null : v); };
    build(m, fermer);
    $('scrim').onclick = (e) => { if (e.target === $('scrim')) fermer(null); };
    $('scrim').hidden = false;
  });
}
// Liste de choix : renvoie la valeur choisie, ou null
function menu(titre, items) {
  return feuille((m, fermer) => {
    if (titre) { const h = document.createElement('h3'); h.textContent = titre; h.style.marginBottom = '10px'; m.appendChild(h); }
    const box = document.createElement('div'); box.className = 'mbox'; m.appendChild(box);
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'mrow' + (it.cur ? ' cur' : '') + (it.danger ? ' danger' : '');
      const t = document.createElement('span'); t.textContent = it.label; b.appendChild(t);
      if (!it.danger) b.insertAdjacentHTML('beforeend', CHEVRON);
      b.onclick = () => fermer(it.value);
      box.appendChild(b);
    });
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

// ---------- démarrage ----------
(async () => {
  if (!code) return showLogin(true);
  try { showLogin(!(await checkCode(code))); } catch { showLogin(false); }
})();
