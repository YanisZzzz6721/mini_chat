// Onglet Candidature : profil du candidat + génération lettre / CV / score via claude -p.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = ({ ROOT, SANDBOX, CLAUDE_BIN, MODEL, auth, gate, acquire, release, json, readBody }) => {
  const DATA = path.join(ROOT, 'data', 'profils'); // hors Git (voir .gitignore)
  fs.mkdirSync(DATA, { recursive: true });

  const ID = /^[a-z0-9_-]{2,30}$/;
  const fichier = (id) => path.join(DATA, id + '.json');
  const prompt = (nom) => fs.readFileSync(path.join(ROOT, nom), 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();

  const PREFS_DEFAUT = { ton: 'professionnel', maxChars: 1500, sansTiretLong: true, notes: '' };
  const TONS = ['professionnel', 'chaleureux', 'direct'];
  function prefsValides(p = {}) {
    const n = Number(p.maxChars);
    return {
      ton: TONS.includes(p.ton) ? p.ton : PREFS_DEFAUT.ton,
      maxChars: Number.isFinite(n) ? Math.min(3000, Math.max(500, Math.round(n))) : PREFS_DEFAUT.maxChars,
      sansTiretLong: p.sansTiretLong !== false,
      notes: typeof p.notes === 'string' ? p.notes.slice(0, 500) : '',
    };
  }
  function lire(id) {
    try { return JSON.parse(fs.readFileSync(fichier(id), 'utf8')); } catch { return null; }
  }

  // Lance claude -p une fois, sans mémoire de session. onDelta reçoit le texte au fil de l'eau.
  function appel({ message, system, onDelta, res }) {
    return new Promise((resolve) => {
      const args = ['-p', message, '--tools', '', '--setting-sources', '', '--disable-slash-commands',
        '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--system-prompt', system];
      if (MODEL) args.push('--model', MODEL);
      const child = spawn(CLAUDE_BIN, args, { cwd: SANDBOX, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '', texte = '', stderr = '', fini = false;
      const fin = (r) => { if (!fini) { fini = true; resolve(r); } };
      res.on('close', () => { if (!fini) child.kill('SIGTERM'); });
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const ligne = buf.slice(0, i); buf = buf.slice(i + 1);
          let ev; try { ev = JSON.parse(ligne); } catch { continue; }
          const delta = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta' && ev.event.delta.text;
          if (delta) { texte += delta; onDelta?.(delta); }
        }
      });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => fin({ ok: code === 0, texte, stderr }));
      child.on('error', () => fin({ ok: false, texte, stderr: 'claude introuvable' }));
    });
  }

  function flux(res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    return (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  }

  function sections(texte) {
    const re = /^### (META|SCORE|LETTRE|CV)[ \t]*$/gm;
    const reperes = [];
    let m;
    while ((m = re.exec(texte))) reperes.push({ nom: m[1], debut: m.index, apres: re.lastIndex });
    const out = {};
    reperes.forEach((r, i) => { out[r.nom] = texte.slice(r.apres, i + 1 < reperes.length ? reperes[i + 1].debut : texte.length).trim(); });
    return out;
  }

  const sansTirets = (t, remplacement) => t.replace(/\s*[—–]\s*/g, remplacement);

  const h = {};

  // Lecture du profil : GET /api/profil?id=anass
  h['GET /api/profil'] = (req, res, url) => {
    if (!auth(req, res)) return;
    const id = (url.searchParams.get('id') || '').toLowerCase();
    if (!ID.test(id)) return json(res, 400, { error: 'Nom de profil invalide (2 à 30 caractères : lettres, chiffres, - _).' });
    const p = lire(id);
    json(res, 200, p ? { existe: true, md: p.md, prefs: prefsValides(p.prefs) } : { existe: false, md: '', prefs: PREFS_DEFAUT });
  };

  // Enregistrement du profil validé par le candidat
  h['PUT /api/profil'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body;
    try { body = await readBody(req, 60000); } catch { return json(res, 400, { error: 'Requête invalide.' }); }
    const id = String(body.id || '').toLowerCase();
    if (!ID.test(id)) return json(res, 400, { error: 'Nom de profil invalide.' });
    if (typeof body.md !== 'string' || !body.md.trim() || body.md.length > 20000) return json(res, 400, { error: 'Profil vide ou trop long (20000 caractères max).' });
    fs.writeFileSync(fichier(id), JSON.stringify({ md: body.md, prefs: prefsValides(body.prefs), maj: new Date().toISOString() }, null, 2));
    json(res, 200, { ok: true });
  };

  // Analyse d'un CV brut -> profil structuré (à relire et corriger par le candidat)
  h['POST /api/profil/analyse'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 60000); } catch { return json(res, 400, { error: 'Texte trop long.' }); }
    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (texte.length < 30 || texte.length > 30000) return json(res, 400, { error: 'Colle ou importe un CV (30 à 30000 caractères).' });
    acquire(b);
    const send = flux(res);
    const r = await appel({ message: texte, system: prompt('prompt-profil.md'), onDelta: (t) => send({ t: 'delta', text: t }), res });
    release();
    if (r.ok) send({ t: 'done' });
    else { console.error('analyse profil a échoué', r.stderr.slice(0, 500)); send({ t: 'error', message: 'Erreur côté serveur, réessaie.' }); }
    res.end();
  };

  // Offre -> score + lettre + CV adapté
  h['POST /api/candidature'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 30000); } catch { return json(res, 400, { error: 'Annonce trop longue.' }); }
    const id = String(body.id || '').toLowerCase();
    const p = ID.test(id) ? lire(id) : null;
    if (!p) return json(res, 400, { error: 'Profil introuvable : importe d’abord ton CV.' });
    const offre = typeof body.offre === 'string' ? body.offre.trim() : '';
    if (offre.length < 50 || offre.length > 15000) return json(res, 400, { error: 'Colle le texte complet de l’annonce (50 à 15000 caractères).' });

    const prefs = prefsValides(p.prefs);
    const regles = [
      `Ton : ${prefs.ton}.`,
      `La lettre fait ${prefs.maxChars - 100} caractères maximum, espaces et signature compris.`,
      prefs.sansTiretLong ? 'N’utilise jamais de tiret long (—) ni moyen (–), nulle part : virgule dans la lettre, tiret court (-) dans le CV.' : '',
      prefs.notes ? `Consignes personnelles du candidat : ${prefs.notes}` : '',
    ].filter(Boolean).join('\n');
    const system = prompt('prompt-candidature.md').replace('{{PROFIL}}', () => p.md).replace('{{REGLES}}', () => regles);

    acquire(b);
    const send = flux(res);
    const r = await appel({ message: offre, system, onDelta: (t) => send({ t: 'delta', text: t }), res });
    if (!r.ok) {
      release();
      console.error('candidature a échoué', r.stderr.slice(0, 500));
      send({ t: 'error', message: 'Erreur côté serveur, réessaie.' });
      return res.end();
    }

    // Corrections garanties côté serveur : tirets longs, longueur de la lettre
    const s = sections(r.texte);
    if (prefs.sansTiretLong) {
      if (s.LETTRE && /[—–]/.test(s.LETTRE)) { s.LETTRE = sansTirets(s.LETTRE, ', '); send({ t: 'fix', section: 'LETTRE', text: s.LETTRE }); }
      if (s.CV && /[—–]/.test(s.CV)) { s.CV = sansTirets(s.CV, ' - '); send({ t: 'fix', section: 'CV', text: s.CV }); }
    }
    if (s.LETTRE && s.LETTRE.length > prefs.maxChars) {
      const court = await appel({
        message: s.LETTRE,
        system: `Raccourcis cette lettre de motivation à ${prefs.maxChars - 100} caractères maximum, espaces et signature compris. Garde la structure (formule d’appel, 3 paragraphes, formule de politesse, signature), le ton et les faits, n’invente rien. Réponds uniquement avec la lettre.${prefs.sansTiretLong ? ' Aucun tiret long ni moyen.' : ''}`,
        res,
      });
      const nouveau = prefs.sansTiretLong ? sansTirets(court.texte.trim(), ', ') : court.texte.trim();
      if (court.ok && nouveau && nouveau.length < s.LETTRE.length) send({ t: 'fix', section: 'LETTRE', text: nouveau });
    }
    release();
    send({ t: 'done' });
    res.end();
  };

  return h;
};
