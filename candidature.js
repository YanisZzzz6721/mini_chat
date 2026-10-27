// Candidatures : profil, mémoire des préférences, historique en .md, génération et retouches via claude -p.
//
// Stockage (sur l'ordinateur, hors Git) :  data/profils/<id>/
//   profil.md            faits du candidat (source de vérité)
//   prefs.json           réglages (ton, longueur max, tirets)
//   preferences.md       ce que l'appli a appris des retouches (court, résumé par Claude)
//   historique/<cid>/candidature.md        état courant : offre, score, lettre, CV
//   historique/<cid>/versions/vNNN-*.md    une version par changement
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = ({ ROOT, SANDBOX, CLAUDE_BIN, MODEL, auth, gate, acquire, release, json, readBody }) => {
  const DATA = path.join(ROOT, 'data', 'profils');
  fs.mkdirSync(DATA, { recursive: true });

  const ID = /^[a-z0-9_-]{2,30}$/;
  const CID = /^\d{8}-\d{6}(-[a-z0-9-]{1,40})?$/;
  const STATUTS = ['brouillon', 'envoyee', 'reponse', 'entretien', 'refus'];

  // ---------- utilitaires fichiers ----------
  const dossier = (id) => path.join(DATA, id);
  const lireFichier = (f, defaut = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return defaut; } };
  const prompt = (nom) => lireFichier(path.join(ROOT, nom)).replace(/^---[\s\S]*?---\s*/, '').trim();
  const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const p2 = (n) => String(n).padStart(2, '0');
  function maintenant() {
    const d = new Date();
    return { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
      cid: `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}` };
  }
  const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${String(v ?? '').replace(/\n/g, ' ')}`).join('\n') + '\n---\n';
  function lireFm(txt) {
    const m = txt.match(/^---\n([\s\S]*?)\n---\n?/), o = {};
    if (m) m[1].split('\n').forEach((l) => { const i = l.indexOf(': '); if (i > 0) o[l.slice(0, i)] = l.slice(i + 2); });
    return o;
  }
  const bloc = (txt, nom) => { const m = txt.match(new RegExp(`<!--${nom}-->\\n([\\s\\S]*?)\\n<!--/${nom}-->`)); return m ? m[1] : ''; };
  const blocs = (o) => Object.entries(o).map(([nom, t]) => `<!--${nom}-->\n${t}\n<!--/${nom}-->`);

  // ---------- réglages ----------
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

  // ---------- profil ----------
  function migrer(id) { // ancien format : data/profils/<id>.json
    const vieux = path.join(DATA, id + '.json');
    if (!fs.existsSync(vieux) || fs.existsSync(dossier(id))) return;
    try {
      const o = JSON.parse(fs.readFileSync(vieux, 'utf8'));
      fs.mkdirSync(dossier(id), { recursive: true });
      fs.writeFileSync(path.join(dossier(id), 'profil.md'), o.md || '');
      fs.writeFileSync(path.join(dossier(id), 'prefs.json'), JSON.stringify(prefsValides(o.prefs), null, 2));
      fs.renameSync(vieux, vieux + '.migre');
    } catch (e) { console.error('migration profil', id, e.message); }
  }
  // Fiche complète (.md) -> profil.md (faits), regles.md (règles de rédaction impératives), notes.md (non envoyé à Claude)
  const sansAccent = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const SEC_REGLES = /^regles? de redaction/;
  const SEC_NOTES = /^(livrables|reste a confirmer|prochaines etapes|plan habilitation)/;
  function decouperFiche(txt) {
    const parts = txt.replace(/\r\n/g, '\n').split(/^(?=## )/m);
    const lignes = parts[0].trim().split('\n');
    const titre = lignes.find((l) => l.startsWith('# ')) || '';
    const profil = [titre], regles = [], notes = [];
    const tete = lignes.filter((l) => l !== titre).join('\n').trim();
    if (tete) notes.push('## En-tête\n' + tete);
    parts.slice(1).forEach((sec) => {
      const [t, ...corps] = sec.split('\n');
      const nom = sansAccent(t.replace(/^##\s*/, '').trim());
      if (SEC_REGLES.test(nom)) regles.push(corps.join('\n').trim());
      else if (SEC_NOTES.test(nom)) notes.push(sec.trim());
      else profil.push(sec.trim());
    });
    return { profil: profil.filter(Boolean).join('\n\n'), regles: regles.join('\n\n'), notes: notes.join('\n\n') };
  }
  function importerFiche(id, texte) {
    const f = decouperFiche(texte);
    if (f.profil.length < 100) return null;
    const d = dossier(id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'fiche.md'), texte);
    fs.writeFileSync(path.join(d, 'profil.md'), f.profil + '\n');
    fs.writeFileSync(path.join(d, 'regles.md'), f.regles ? f.regles + '\n' : '');
    fs.writeFileSync(path.join(d, 'notes.md'), f.notes ? f.notes + '\n' : '');
    if (!fs.existsSync(path.join(d, 'prefs.json'))) fs.writeFileSync(path.join(d, 'prefs.json'), JSON.stringify(PREFS_DEFAUT, null, 2));
    return { profil: f.profil.length, regles: f.regles.length, notes: f.notes.length };
  }

  function charger(id) {
    migrer(id);
    const d = dossier(id);
    // une fiche.md déposée à la main dans le dossier est importée au premier chargement
    if (!fs.existsSync(path.join(d, 'profil.md')) && fs.existsSync(path.join(d, 'fiche.md'))) importerFiche(id, lireFichier(path.join(d, 'fiche.md')));
    if (!fs.existsSync(path.join(d, 'profil.md'))) return null;
    let prefs = {};
    try { prefs = JSON.parse(lireFichier(path.join(d, 'prefs.json'), '{}')); } catch {}
    return {
      md: lireFichier(path.join(d, 'profil.md')), prefs: prefsValides(prefs), apprises: lireFichier(path.join(d, 'preferences.md')),
      regles: lireFichier(path.join(d, 'regles.md')), notes: lireFichier(path.join(d, 'notes.md')),
    };
  }

  // ---------- historique ----------
  const dCand = (id, cid) => path.join(dossier(id), 'historique', cid);
  function lireVersions(id, cid) {
    const d = path.join(dCand(id, cid), 'versions');
    let fichiers = [];
    try { fichiers = fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort(); } catch {}
    return fichiers.map((f) => { const m = lireFm(lireFichier(path.join(d, f))); return { n: Number(m.n), type: m.type, date: m.date, instruction: m.instruction || '', fichier: f }; });
  }
  function lireCand(id, cid) {
    const txt = lireFichier(path.join(dCand(id, cid), 'candidature.md'), null);
    if (txt === null) return null;
    let score = {}; try { score = JSON.parse(bloc(txt, 'SCORE')); } catch {}
    return { meta: lireFm(txt), offre: bloc(txt, 'OFFRE'), score, lettre: bloc(txt, 'LETTRE'), cv: bloc(txt, 'CV'), brut: txt };
  }
  function ecrireCand(id, cid, c) {
    fs.mkdirSync(path.join(dCand(id, cid), 'versions'), { recursive: true });
    const [offre, score, lettre, cv] = blocs({ OFFRE: c.offre, SCORE: JSON.stringify(c.score || {}), LETTRE: c.lettre, CV: c.cv });
    fs.writeFileSync(path.join(dCand(id, cid), 'candidature.md'),
      fm(c.meta) + `\n## Offre\n${offre}\n\n## Score\n${score}\n\n## Lettre de motivation\n${lettre}\n\n## CV\n${cv}\n`);
  }
  // Une version par changement ; les modifications manuelles consécutives sont fusionnées en une seule.
  function ajouterVersion(id, cid, type, instruction, lettre, cv) {
    const d = path.join(dCand(id, cid), 'versions');
    fs.mkdirSync(d, { recursive: true });
    const vs = lireVersions(id, cid);
    const derniere = vs[vs.length - 1];
    const contenu = (n) => fm({ n, date: maintenant().date, type, instruction }) + `\n## Lettre de motivation\n${blocs({ LETTRE: lettre })[0]}\n\n## CV\n${blocs({ CV: cv })[0]}\n`;
    if (type === 'manuel' && derniere && derniere.type === 'manuel') fs.writeFileSync(path.join(d, derniere.fichier), contenu(derniere.n));
    else { const n = (derniere ? derniere.n : 0) + 1; fs.writeFileSync(path.join(d, `v${String(n).padStart(3, '0')}-${type}.md`), contenu(n)); }
    return lireVersions(id, cid).map(({ fichier, ...v }) => v);
  }
  function listerCands(id) {
    const d = path.join(dossier(id), 'historique');
    let ids = [];
    try { ids = fs.readdirSync(d).filter((x) => CID.test(x)).sort().reverse(); } catch {}
    return ids.map((cid) => ({ cid, c: lireCand(id, cid) })).filter((x) => x.c);
  }

  // Exemples de lettres passées les plus proches de l'offre (recouvrement de mots), pour le ton
  const mots = (t) => new Set((t.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ]{5,}/g) || []));
  function exemples(id, offre) {
    const A = mots(offre);
    const notes = listerCands(id).filter((x) => x.c.lettre).map((x, i) => {
      const B = mots(x.c.offre);
      let commun = 0; A.forEach((w) => { if (B.has(w)) commun++; });
      const bonus = ['entretien', 'reponse'].includes(x.c.meta.statut) ? 0.1 : 0;
      return { x, note: (A.size && B.size ? commun / Math.sqrt(A.size * B.size) : 0) + bonus - i * 0.001 };
    }).sort((a, b) => b.note - a.note).slice(0, 3);
    if (!notes.length) return '(aucun pour l’instant)';
    return notes.map(({ x }) => `--- ${x.c.meta.poste || 'Poste'}, ${x.c.meta.entreprise || 'entreprise'} (${x.c.meta.statut || 'brouillon'}) ---\n${x.c.lettre.slice(0, 1800)}`).join('\n\n');
  }

  // ---------- appel à claude ----------
  // Une requête sans mémoire de session. Le message passe par stdin : un texte commençant par "-" ne doit pas être pris pour une option.
  function appel({ message, system, onDelta, res }) {
    return new Promise((resolve) => {
      const args = ['-p', '--tools', '', '--setting-sources', '', '--disable-slash-commands',
        '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--system-prompt', system];
      if (MODEL) args.push('--model', MODEL);
      const child = spawn(CLAUDE_BIN, args, { cwd: SANDBOX, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.on('error', () => {});
      child.stdin.end(message);
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

  function reglesDe(prefs) {
    return [
      `Ton : ${prefs.ton}.`,
      `La lettre fait ${prefs.maxChars - 100} caractères maximum, espaces et signature compris.`,
      prefs.sansTiretLong ? 'N’utilise jamais de tiret long (—) ni moyen (–), nulle part : virgule dans la lettre, tiret court (-) dans le CV.' : '',
      prefs.notes ? `Consignes personnelles du candidat : ${prefs.notes}` : '',
    ].filter(Boolean).join('\n');
  }

  // Corrections garanties côté serveur : tirets longs, longueur de la lettre
  async function finitions(texte, genre, prefs, res) {
    let t = texte;
    if (prefs.sansTiretLong && /[—–]/.test(t)) t = sansTirets(t, genre === 'lettre' ? ', ' : ' - ');
    if (genre === 'lettre' && t.length > prefs.maxChars) {
      const court = await appel({
        message: t,
        system: `Raccourcis cette lettre de motivation à ${prefs.maxChars - 100} caractères maximum, espaces et signature compris. Garde la structure (formule d’appel, 3 paragraphes, formule de politesse, signature), le ton et les faits, n’invente rien. Réponds uniquement avec la lettre.${prefs.sansTiretLong ? ' Aucun tiret long ni moyen.' : ''}`,
        res,
      });
      let nouveau = court.texte.trim();
      if (prefs.sansTiretLong) nouveau = sansTirets(nouveau, ', ');
      if (court.ok && nouveau && nouveau.length < t.length) t = nouveau;
    }
    return t;
  }

  const h = {};
  const refus = (res, msg) => json(res, 400, { error: msg });
  const idDe = (v) => String(v || '').toLowerCase();

  // ---------- profil ----------
  h['GET /api/profil'] = (req, res, url) => {
    if (!auth(req, res)) return;
    const id = idDe(url.searchParams.get('id'));
    if (!ID.test(id)) return refus(res, 'Nom de profil invalide (2 à 30 caractères : lettres, chiffres, - _).');
    const p = charger(id);
    json(res, 200, p ? { existe: true, ...p } : { existe: false, md: '', prefs: PREFS_DEFAUT, apprises: '' });
  };

  h['PUT /api/profil'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body;
    try { body = await readBody(req, 60000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id);
    if (!ID.test(id)) return refus(res, 'Nom de profil invalide.');
    if (typeof body.md !== 'string' || !body.md.trim() || body.md.length > 20000) return refus(res, 'Profil vide ou trop long (20000 caractères max).');
    fs.mkdirSync(dossier(id), { recursive: true });
    fs.writeFileSync(path.join(dossier(id), 'profil.md'), body.md);
    fs.writeFileSync(path.join(dossier(id), 'prefs.json'), JSON.stringify(prefsValides(body.prefs), null, 2));
    if (typeof body.apprises === 'string') fs.writeFileSync(path.join(dossier(id), 'preferences.md'), body.apprises.slice(0, 4000));
    if (typeof body.regles === 'string') fs.writeFileSync(path.join(dossier(id), 'regles.md'), body.regles.slice(0, 8000));
    json(res, 200, { ok: true });
  };

  h['POST /api/profil/fiche'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body;
    try { body = await readBody(req, 60000); } catch { return refus(res, 'Fiche trop longue (60000 caractères max).'); }
    const id = idDe(body.id);
    if (!ID.test(id)) return refus(res, 'Nom de profil invalide.');
    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (texte.length < 200) return refus(res, 'Colle la fiche complète.');
    const r = importerFiche(id, texte);
    if (!r) return refus(res, 'Fiche illisible : il faut au moins un titre « # » et des sections « ## ».');
    json(res, 200, { ok: true, ...r });
  };

  h['POST /api/profil/analyse'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 60000); } catch { return refus(res, 'Texte trop long.'); }
    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (texte.length < 30 || texte.length > 30000) return refus(res, 'Colle ou importe un CV (30 à 30000 caractères).');
    acquire(b);
    const send = flux(res);
    const r = await appel({ message: texte, system: prompt('prompt-profil.md'), onDelta: (t) => send({ t: 'delta', text: t }), res });
    release();
    if (r.ok) send({ t: 'done' });
    else { console.error('analyse profil a échoué', r.stderr.slice(0, 500)); send({ t: 'error', message: 'Erreur côté serveur, réessaie.' }); }
    res.end();
  };

  // ---------- génération ----------
  h['POST /api/candidature'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 30000); } catch { return refus(res, 'Annonce trop longue.'); }
    const id = idDe(body.id);
    const p = ID.test(id) ? charger(id) : null;
    if (!p) return refus(res, 'Profil introuvable : crée d’abord ton profil.');
    const offre = typeof body.offre === 'string' ? body.offre.trim() : '';
    if (offre.length < 50 || offre.length > 15000) return refus(res, 'Colle le texte complet de l’annonce (50 à 15000 caractères).');

    const system = prompt('prompt-candidature.md')
      .replace('{{PROFIL}}', () => p.md)
      .replace('{{REGLES_PROFIL}}', () => p.regles.trim() || '(aucune)')
      .replace('{{PREFERENCES}}', () => p.apprises.trim() || '(aucune pour l’instant)')
      .replace('{{EXEMPLES}}', () => exemples(id, offre))
      .replace('{{REGLES}}', () => reglesDe(p.prefs));

    acquire(b);
    const send = flux(res);
    try {
      const r = await appel({ message: offre, system, onDelta: (t) => send({ t: 'delta', text: t }), res });
      if (!r.ok) {
        console.error('candidature a échoué', r.stderr.slice(0, 500));
        send({ t: 'error', message: 'Erreur côté serveur, réessaie.' });
        return;
      }
      const s = sections(r.texte);
      let meta = {}, score = {};
      try { meta = JSON.parse(s.META); } catch {}
      try { score = JSON.parse(s.SCORE); } catch {}
      const lettre = await finitions(s.LETTRE || '', 'lettre', p.prefs, res);
      const cv = await finitions(s.CV || '', 'cv', p.prefs, res);
      if (lettre !== (s.LETTRE || '')) send({ t: 'fix', section: 'LETTRE', text: lettre });
      if (cv !== (s.CV || '')) send({ t: 'fix', section: 'CV', text: cv });

      const n = maintenant();
      const cid = n.cid + (slug(meta.entreprise) ? '-' + slug(meta.entreprise) : '');
      const fiche = { cid, date: n.date, poste: meta.poste || '', entreprise: meta.entreprise || '', secteur: meta.secteur || '', score: Number(score.score) || 0, statut: 'brouillon' };
      ecrireCand(id, cid, { meta: fiche, offre, score, lettre, cv });
      const versions = ajouterVersion(id, cid, 'generation', '', lettre, cv);
      send({ t: 'saved', cid, meta: fiche, versions });
      send({ t: 'done' });
    } finally {
      release();
      res.end();
    }
  };

  // ---------- coach : chat qui connaît le profil et la candidature en cours ----------
  h['POST /api/coach'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 30000); } catch { return refus(res, 'Message trop long.'); }
    const id = idDe(body.id);
    const p = ID.test(id) ? charger(id) : null;
    if (!p) return refus(res, 'Profil introuvable : crée d’abord ton profil.');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 8000) return refus(res, 'Message vide ou trop long (8000 caractères max).');
    const cid = String(body.cid || '');
    const c = CID.test(cid) ? lireCand(id, cid) : null;
    const contexte = c
      ? `Poste : ${c.meta.poste || '?'} chez ${c.meta.entreprise || '?'} (statut : ${c.meta.statut || 'brouillon'}).\nANNONCE :\n${c.offre}\n\nLETTRE PRÉPARÉE :\n${c.lettre}`
      : '(aucune candidature sélectionnée : réponds de façon générale à partir du profil)';
    const histo = (Array.isArray(body.history) ? body.history : []).slice(-10)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => `${m.role === 'user' ? 'CANDIDAT' : 'COACH'} : ${m.text.slice(0, 2000)}`).join('\n\n');
    const system = prompt('prompt-coach.md')
      .replace('{{PROFIL}}', () => p.md)
      .replace('{{REGLES_PROFIL}}', () => p.regles.trim() || '(aucune)')
      .replace('{{PREFERENCES}}', () => p.apprises.trim() || '(aucune)')
      .replace('{{CONTEXTE}}', () => contexte);
    acquire(b);
    const send = flux(res);
    try {
      const r = await appel({ message: (histo ? `CONVERSATION JUSQU'ICI :\n${histo}\n\n` : '') + `NOUVEAU MESSAGE DU CANDIDAT :\n${message}`, system, onDelta: (t) => send({ t: 'delta', text: t }), res });
      if (r.ok) send({ t: 'done' });
      else { console.error('coach a échoué', r.stderr.slice(0, 500)); send({ t: 'error', message: 'Erreur côté serveur, réessaie.' }); }
    } finally {
      release();
      res.end();
    }
  };

  // ---------- retouche (+ mémoire des préférences) ----------
  h['POST /api/retouche'] = async (req, res) => {
    const b = gate(req, res);
    if (!b) return;
    let body;
    try { body = await readBody(req, 20000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id);
    const p = ID.test(id) ? charger(id) : null;
    const cid = String(body.cid || '');
    const c = p && CID.test(cid) ? lireCand(id, cid) : null;
    if (!c) return refus(res, 'Candidature introuvable.');
    const cible = body.cible === 'cv' ? 'cv' : 'lettre';
    const consigne = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (consigne.length < 3 || consigne.length > 600) return refus(res, 'Écris ce que tu veux changer (3 à 600 caractères).');

    const system = prompt('prompt-retouche.md')
      .replace('{{CIBLE}}', cible === 'lettre' ? 'la lettre de motivation' : 'le CV (en Markdown)')
      .replace('{{PROFIL}}', () => p.md)
      .replace('{{REGLES_PROFIL}}', () => p.regles.trim() || '(aucune)')
      .replace('{{PREFERENCES}}', () => p.apprises.trim() || '(aucune pour l’instant)')
      .replace('{{REGLES}}', () => reglesDe(p.prefs));
    const message = `ANNONCE :\n${c.offre}\n\nTEXTE ACTUEL :\n${c[cible]}\n\nCONSIGNE DU CANDIDAT :\n${consigne}`;

    acquire(b);
    const send = flux(res);
    try {
      const r = await appel({ message, system, onDelta: (t) => send({ t: 'delta', text: t }), res });
      if (!r.ok || !r.texte.trim()) {
        console.error('retouche a échoué', r.stderr.slice(0, 500));
        send({ t: 'error', message: 'Erreur côté serveur, réessaie.' });
        return;
      }
      const nouveau = await finitions(r.texte.trim(), cible, p.prefs, res);
      if (nouveau !== r.texte.trim()) send({ t: 'fix', text: nouveau });
      c[cible] = nouveau;
      ecrireCand(id, cid, { meta: c.meta, offre: c.offre, score: c.score, lettre: c.lettre, cv: c.cv });
      const versions = ajouterVersion(id, cid, 'retouche', consigne, c.lettre, c.cv);
      send({ t: 'saved', versions });
      send({ t: 'done' });

      // Mémoire : Claude met à jour le fichier de préférences (court) ou répond INCHANGÉ
      const m = await appel({
        message: `PRÉFÉRENCES ACTUELLES :\n${p.apprises.trim() || '(vide)'}\n\nNOUVELLE CONSIGNE (donnée pour ${cible === 'lettre' ? 'la lettre' : 'le CV'} d'une candidature "${c.meta.poste || ''}" chez ${c.meta.entreprise || '?'}) :\n${consigne}`,
        system: prompt('prompt-preferences.md'), res,
      });
      const maj = m.texte.trim();
      if (m.ok && maj && !/^INCHANG/i.test(maj) && maj.length <= 3000 && /^- /m.test(maj)) {
        fs.writeFileSync(path.join(dossier(id), 'preferences.md'), maj + '\n');
        send({ t: 'prefs', text: maj });
      }
    } finally {
      release();
      res.end();
    }
  };

  // ---------- historique ----------
  const cand = (req, res, id, cid) => {
    if (!ID.test(id) || !CID.test(cid)) { refus(res, 'Candidature introuvable.'); return null; }
    const c = lireCand(id, cid);
    if (!c) { refus(res, 'Candidature introuvable.'); return null; }
    return c;
  };

  h['GET /api/historique'] = (req, res, url) => {
    if (!auth(req, res)) return;
    const id = idDe(url.searchParams.get('id'));
    if (!ID.test(id)) return refus(res, 'Nom de profil invalide.');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const liste = listerCands(id).filter((x) => !q || x.c.brut.toLowerCase().includes(q)).slice(0, 200)
      .map((x) => ({ ...x.c.meta, score: Number(x.c.meta.score) || 0 }));
    json(res, 200, { liste });
  };

  h['GET /api/historique/detail'] = (req, res, url) => {
    if (!auth(req, res)) return;
    const id = idDe(url.searchParams.get('id')), cid = url.searchParams.get('cid') || '';
    const c = cand(req, res, id, cid);
    if (!c) return;
    json(res, 200, { meta: { ...c.meta, score: Number(c.meta.score) || 0 }, offre: c.offre, score: c.score, lettre: c.lettre, cv: c.cv, versions: lireVersions(id, cid).map(({ fichier, ...v }) => v) });
  };

  h['POST /api/historique/statut'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body; try { body = await readBody(req, 2000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id), cid = String(body.cid || '');
    const c = cand(req, res, id, cid);
    if (!c) return;
    if (!STATUTS.includes(body.statut)) return refus(res, 'Statut invalide.');
    ecrireCand(id, cid, { meta: { ...c.meta, statut: body.statut }, offre: c.offre, score: c.score, lettre: c.lettre, cv: c.cv });
    json(res, 200, { ok: true });
  };

  // Enregistre les modifications manuelles (une seule version « manuel » tant qu'on continue d'éditer)
  h['POST /api/historique/sauver'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body; try { body = await readBody(req, 40000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id), cid = String(body.cid || '');
    const c = cand(req, res, id, cid);
    if (!c) return;
    const lettre = typeof body.lettre === 'string' ? body.lettre : c.lettre, cv = typeof body.cv === 'string' ? body.cv : c.cv;
    if (lettre === c.lettre && cv === c.cv) return json(res, 200, { ok: true });
    ecrireCand(id, cid, { meta: c.meta, offre: c.offre, score: c.score, lettre, cv });
    json(res, 200, { ok: true, versions: ajouterVersion(id, cid, 'manuel', 'Modification manuelle', lettre, cv) });
  };

  h['POST /api/historique/restaurer'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body; try { body = await readBody(req, 2000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id), cid = String(body.cid || '');
    const c = cand(req, res, id, cid);
    if (!c) return;
    const v = lireVersions(id, cid).find((x) => x.n === Number(body.n));
    if (!v) return refus(res, 'Version introuvable.');
    const txt = lireFichier(path.join(dCand(id, cid), 'versions', v.fichier));
    const lettre = bloc(txt, 'LETTRE'), cv = bloc(txt, 'CV');
    ecrireCand(id, cid, { meta: c.meta, offre: c.offre, score: c.score, lettre, cv });
    json(res, 200, { lettre, cv, versions: ajouterVersion(id, cid, 'restauration', `Retour à la version ${v.n}`, lettre, cv) });
  };

  h['POST /api/historique/supprimer'] = async (req, res) => {
    if (!auth(req, res)) return;
    let body; try { body = await readBody(req, 2000); } catch { return refus(res, 'Requête invalide.'); }
    const id = idDe(body.id), cid = String(body.cid || '');
    if (!cand(req, res, id, cid)) return;
    fs.rmSync(dCand(id, cid), { recursive: true, force: true });
    json(res, 200, { ok: true });
  };

  return h;
};
