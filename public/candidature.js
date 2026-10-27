// Écrans Postuler, Profil, Coach et résultat. S'appuie sur app.js ($, store, api, lireFlux, toast, menu, feuille, setView).
(() => {
  const STATUTS = { brouillon: 'Brouillon', envoyee: 'Envoyée', reponse: 'Réponse reçue', entretien: 'Entretien', refus: 'Refus' };
  const S = { id: store.get('pid') || '', profil: null, cur: null, busy: false, seg: 'lettre', cvEdit: false };

  const slug = (t) => (t || 'candidature').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'candidature';
  const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const maxChars = () => (S.profil && S.profil.prefs && S.profil.prefs.maxChars) || 1500;
  const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const ajuste = (ta, min = 90) => { ta.style.height = 'auto'; ta.style.height = Math.max(min, ta.scrollHeight + 2) + 'px'; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // ---------- profil ----------
  function entete() {
    const ok = S.profil && S.profil.existe;
    $('pname').textContent = S.id || 'profil';
    $('pav').textContent = (S.id || '?').slice(0, 1);
    $('pbtn').style.opacity = ok || !S.id ? '' : '.8';
  }
  const montrerProfil = (mode) => { $('pImport').hidden = mode !== 'import'; $('pEdit').hidden = mode !== 'edit'; };
  const prefsDuFormulaire = () => ({ ton: $('rTon').value, maxChars: Number($('rMax').value) || 1500, sansTiretLong: $('rTirets').checked, notes: $('rNotes').value });

  async function chargerProfil(silencieux) {
    const id = $('pid').value.trim().toLowerCase() || S.id;
    if (!id) { entete(); return; }
    $('pErr').textContent = ''; $('pOk').textContent = '';
    try {
      const r = await api('/api/profil?id=' + encodeURIComponent(id));
      if (!r.ok) { $('pEtat').textContent = await erreurDe(r); return; }
      const p = await r.json();
      S.id = id; store.set('pid', id); $('pid').value = id; S.profil = p;
      $('rTon').value = p.prefs.ton; $('rMax').value = p.prefs.maxChars; $('rTirets').checked = p.prefs.sansTiretLong; $('rNotes').value = p.prefs.notes || '';
      $('rApprises').value = p.apprises || ''; $('rRegles').value = p.regles || '';
      $('pNotes').value = p.notes || ''; $('pNotesBox').hidden = !p.notes;
      if (p.existe) { $('pmd').value = p.md; montrerProfil('edit'); $('pEtat').textContent = silencieux ? '' : 'Profil chargé.'; }
      else { montrerProfil('import'); $('pEtat').textContent = 'Nouveau profil : importe ton CV.'; }
      adapterProfil();
    } catch { $('pEtat').textContent = 'Serveur injoignable.'; }
    entete();
    chargerHistorique();
    restaurerCoach();
  }
  function adapterProfil() { // mesures possibles seulement quand l'écran est visible
    if ($('v-profil').hidden) return;
    ajuste($('pmd'), 220); ajuste($('rRegles'), 120); ajuste($('rApprises'), 96); ajuste($('ptexte'), 120); ajuste($('pNotes'), 120);
  }

  async function texteDuFichier(f) {
    const nom = f.name.toLowerCase();
    if (nom.endsWith('.pdf')) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
      let t = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const c = await (await pdf.getPage(i)).getTextContent();
        c.items.forEach((it) => { t += it.str + (it.hasEOL ? '\n' : ' '); });
        t += '\n';
      }
      return t;
    }
    if (nom.endsWith('.docx')) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const xml = await zip.file('word/document.xml').async('string');
      return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    return f.text();
  }
  $('pfile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('pErr').textContent = '';
    if (f.size > 10 * 1024 * 1024) { $('pErr').textContent = 'Fichier trop gros (10 Mo max).'; return; }
    try {
      const t = (await texteDuFichier(f)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (t.length < 30) { $('pErr').textContent = 'Aucun texte lisible (PDF scanné ?). Colle ton CV dans la zone ci-dessous.'; return; }
      $('ptexte').value = t.slice(0, 30000); ajuste($('ptexte'), 120);
    } catch { $('pErr').textContent = 'Lecture impossible : colle ton CV dans la zone ci-dessous.'; }
  };

  const idValide = () => { const id = $('pid').value.trim().toLowerCase(); return /^[a-z0-9_-]{2,30}$/.test(id) ? id : null; };

  $('pana').onclick = async () => {
    const id = idValide(), texte = $('ptexte').value.trim();
    $('pErr').textContent = '';
    if (!id) { $('pErr').textContent = 'Choisis un nom de profil (2 à 30 lettres ou chiffres).'; return; }
    if (texte.length < 30) { $('pErr').textContent = 'Importe ou colle ton CV.'; return; }
    S.id = id; store.set('pid', id); entete();
    $('pana').disabled = true; $('pana').textContent = 'Analyse en cours…';
    try {
      const r = await api('/api/profil/analyse', { method: 'POST', body: JSON.stringify({ texte }) });
      if (!r.ok) $('pErr').textContent = await erreurDe(r);
      else {
        $('pmd').value = ''; montrerProfil('edit'); $('pOk').textContent = 'Analyse en cours…';
        let ok = true;
        await lireFlux(r, (ev) => {
          if (ev.t === 'delta') { $('pmd').value += ev.text; ajuste($('pmd'), 220); }
          if (ev.t === 'error') { ok = false; $('pErr').textContent = ev.message; }
        });
        $('pOk').textContent = ok ? 'Relis, corrige si besoin, puis enregistre.' : '';
        if (!ok) montrerProfil('import');
      }
    } catch { $('pErr').textContent = 'Connexion perdue, réessaie.'; }
    $('pana').disabled = false; $('pana').textContent = 'Analyser mon CV';
  };

  $('pFiche').onclick = async () => {
    const id = idValide(), texte = $('pFicheTexte').value.trim();
    $('pErr').textContent = '';
    if (!id) { $('pErr').textContent = 'Choisis d’abord un nom de profil (2 à 30 lettres ou chiffres).'; return; }
    if (texte.length < 200) { $('pErr').textContent = 'Colle la fiche complète.'; return; }
    $('pFiche').disabled = true;
    try {
      const r = await api('/api/profil/fiche', { method: 'POST', body: JSON.stringify({ id, texte }) });
      if (!r.ok) $('pErr').textContent = await erreurDe(r);
      else { $('pFicheTexte').value = ''; await chargerProfil(true); toast('Fiche importée ✓', 2400); }
    } catch { $('pErr').textContent = 'Connexion perdue, réessaie.'; }
    $('pFiche').disabled = false;
  };

  $('psave').onclick = async () => {
    const id = idValide();
    $('pOk').textContent = '';
    try {
      const r = await api('/api/profil', { method: 'PUT', body: JSON.stringify({ id, md: $('pmd').value, prefs: prefsDuFormulaire(), apprises: $('rApprises').value, regles: $('rRegles').value }) });
      if (r.ok) { await chargerProfil(true); $('pOk').textContent = 'Profil enregistré ✓'; toast('Profil enregistré ✓'); }
      else $('pOk').textContent = await erreurDe(r);
    } catch { $('pOk').textContent = 'Serveur injoignable.'; }
  };
  $('pnew').onclick = () => { $('ptexte').value = ''; $('pfile').value = ''; montrerProfil('import'); };
  $('pload').onclick = () => chargerProfil(false);
  ['pmd', 'rRegles', 'rApprises', 'ptexte'].forEach((id) => $(id).addEventListener('input', () => ajuste($(id), id === 'pmd' ? 220 : 96)));
  $('pbtn').onclick = () => setView('profil');

  // ---------- Postuler : annonce ----------
  const majCompteur = () => { const n = $('offre').value.length; $('ocnt').textContent = `${n.toLocaleString('fr-FR')} caractère${n > 1 ? 's' : ''}`; ajuste($('offre'), 96); };
  $('offre').addEventListener('input', majCompteur);
  $('coller').onclick = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { toast('Le presse-papiers est vide'); return; }
      $('offre').value = t; majCompteur(); toast('Annonce collée ✓');
    } catch { toast('Appuie longuement dans la zone, puis « Coller »', 2800); $('offre').focus(); }
  };
  $('vider').onclick = () => { $('offre').value = ''; majCompteur(); $('gErr').textContent = ''; };

  const PARTIES = /^### (META|SCORE|LETTRE|CV)[ \t]*$/gm;
  function decouper(t) {
    const rep = []; let m;
    PARTIES.lastIndex = 0;
    while ((m = PARTIES.exec(t))) rep.push({ nom: m[1], debut: m.index, apres: PARTIES.lastIndex });
    const out = { _ordre: rep.map((r) => r.nom) };
    rep.forEach((r, i) => { out[r.nom] = t.slice(r.apres, i + 1 < rep.length ? rep[i + 1].debut : t.length).trim(); });
    return out;
  }
  function etapes(s, fini) {
    const noms = ['META', 'SCORE', 'LETTRE', 'CV'], presentes = s ? s._ordre : [];
    document.querySelectorAll('#pSteps .step').forEach((e, i) => {
      const pos = presentes.indexOf(noms[i]), dernier = presentes.length - 1;
      e.className = 'step' + (fini || (pos >= 0 && pos < dernier) ? ' done' : (pos === dernier && pos >= 0) || (!presentes.length && i === 0) ? ' run' : '');
      e.firstElementChild.textContent = e.classList.contains('done') ? '✓' : '';
    });
  }

  async function generer() {
    if (S.busy) return;
    const offre = $('offre').value.trim();
    $('gErr').textContent = '';
    if (!S.profil || !S.profil.existe) { $('gErr').textContent = 'Crée d’abord ton profil (onglet Profil).'; return; }
    if (offre.length < 50) { $('gErr').textContent = 'Colle le texte complet de l’annonce.'; return; }
    S.busy = true; $('gen').disabled = true;
    $('pSteps').hidden = false; etapes(null, false); $('pStepsT').textContent = 'Je prépare ta candidature';
    S.cur = { cid: null, meta: {}, score: {}, offre, lettre: '', cv: '', versions: [] };
    let brut = '', fixes = {}, ouvert = false, ok = true;
    try {
      const r = await api('/api/candidature', { method: 'POST', body: JSON.stringify({ id: S.id, offre }) });
      if (!r.ok) { $('gErr').textContent = await erreurDe(r); ok = false; }
      else await lireFlux(r, (ev) => {
        if (ev.t === 'delta') {
          brut += ev.text;
          const s = decouper(brut);
          etapes(s, false);
          const meta = s._ordre.includes('SCORE') ? json(s.META) : null; if (meta) S.cur.meta = { ...S.cur.meta, ...meta };
          const sc = s._ordre.includes('LETTRE') ? json(s.SCORE) : null; if (sc) S.cur.score = sc;
          if (s.LETTRE !== undefined) S.cur.lettre = fixes.LETTRE ?? s.LETTRE;
          if (s.CV !== undefined) S.cur.cv = fixes.CV ?? s.CV;
          if (!ouvert && s.LETTRE !== undefined) { ouvert = true; ouvrirRes(S.cur, true); }
          else if (ouvert) remplirRes();
        } else if (ev.t === 'fix') { fixes[ev.section] = ev.text; S.cur[ev.section === 'LETTRE' ? 'lettre' : 'cv'] = ev.text; remplirRes(); }
        else if (ev.t === 'saved') { S.cur.cid = ev.cid; S.cur.meta = ev.meta; S.cur.versions = ev.versions; }
        else if (ev.t === 'error') { ok = false; $('gErr').textContent = ev.message; toast(ev.message, 3000); }
      });
    } catch { ok = false; $('gErr').textContent = 'Connexion perdue, réessaie.'; }
    S.busy = false; $('gen').disabled = false;
    if (ok) {
      etapes(null, true); $('pStepsT').textContent = 'Candidature prête ✓'; $('offre').value = ''; majCompteur();
      if (!ouvert) ouvrirRes(S.cur, false); else { actifs(true); remplirRes(); }
      chargerHistorique();
    } else { $('pSteps').hidden = true; if (ouvert) fermerRes(); }
  }
  $('gen').onclick = generer;

  // ---------- CV : analyse du Markdown, rendu à l'écran et PDF ----------
  function parseCv(md) {
    const o = { name: '', title: '', contact: [], profil: '', exp: [], formation: [], competences: [], langues: [], dispo: [], autres: [] };
    let sec = 'head', cur = null;
    for (const raw of (md || '').split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      if (/^# /.test(l)) { o.name = l.slice(2).trim(); sec = 'head'; continue; }
      if (/^## /.test(l)) {
        const t = norm(l.slice(3));
        sec = /profil|resume|objectif/.test(t) ? 'profil' : /exp/.test(t) ? 'exp' : /formation|diplome/.test(t) ? 'formation' : /comp/.test(t) ? 'competences' : /langue/.test(t) ? 'langues' : /dispo/.test(t) ? 'dispo' : 'autres';
        cur = null; continue;
      }
      if (sec === 'head') {
        if (/@|\[email\]|\[t[ée]l|\+?\d[\d .]{7,}/i.test(l)) o.contact.push(...l.split(/\s*[·|•]\s*/).filter(Boolean));
        else if (!o.title) o.title = l.replace(/^\*+|\*+$/g, '');
        continue;
      }
      if (sec === 'profil') { o.profil += (o.profil ? ' ' : '') + l; continue; }
      if (sec === 'exp') {
        if (/^(\*\*|### )/.test(l)) {
          const t = l.replace(/^### /, '').replace(/\*\*/g, '');
          const [tete, dates = ''] = t.split(/\s*\|\s*/);
          const i = tete.lastIndexOf(' - ');
          cur = { role: i > 0 ? tete.slice(0, i) : tete, co: i > 0 ? tete.slice(i + 3) : '', dates, puces: [] };
          o.exp.push(cur);
        } else if (cur) cur.puces.push(l.replace(/^[-*] /, ''));
        continue;
      }
      o[sec].push(l.replace(/^[-*] /, ''));
    }
    return o;
  }
  function renderCv(md) {
    const c = parseCv(md), root = $('rCvView');
    root.replaceChildren();
    const side = el('div', 'cvside'), main = el('div', 'cvmain');
    side.appendChild(el('div', 'mono0', (c.name.match(/\b\p{L}/gu) || []).slice(0, 2).join('').toUpperCase() || '·'));
    const bloc = (parent, titre, lignes) => {
      if (!lignes.length) return;
      parent.appendChild(el('div', 'cvmono', titre));
      const d = el('div'); lignes.forEach((x) => d.appendChild(el('div', null, x))); parent.appendChild(d);
    };
    bloc(side, 'CONTACT', c.contact);
    bloc(side, 'COMPÉTENCES', c.competences);
    bloc(side, 'LANGUES', c.langues);
    bloc(side, 'DISPONIBILITÉ', c.dispo);
    main.appendChild(el('div', 'cvname', c.name || '…'));
    if (c.title) main.appendChild(el('div', 'cvtitle', c.title));
    if (c.profil) { main.appendChild(el('div', 'cvmono', 'PROFIL')); main.appendChild(el('div', null, c.profil)); }
    if (c.exp.length) {
      main.appendChild(el('div', 'cvmono', 'EXPÉRIENCES'));
      c.exp.forEach((x) => {
        const d = el('div', 'cvexp');
        const t = el('div'); t.appendChild(el('b', null, x.role)); d.appendChild(t);
        const s = el('div'); if (x.co) s.appendChild(el('span', 'co', x.co)); if (x.dates) s.appendChild(el('span', 'dt', (x.co ? '  ' : '') + x.dates)); d.appendChild(s);
        if (x.puces.length) { const u = el('ul'); x.puces.forEach((p) => u.appendChild(el('li', null, p))); d.appendChild(u); }
        main.appendChild(d);
      });
    }
    bloc(main, 'FORMATION', c.formation);
    bloc(main, 'AUTRES', c.autres);
    root.append(side, main);
  }

  // jsPDF ne gère que Latin-1 : on remplace les caractères typographiques courants
  const latin = (t) => String(t).replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/…/g, '...').replace(/[  ]/g, ' ')
    .replace(/[•·▪●]/g, '-').replace(/→/g, '->').replace(/[—–]/g, '-').replace(/[^\u0000-ÿ€]/g, '');
  function pdfCv() {
    const c = parseCv($('rCv').value);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const SW = 66, ML = SW + 9, W = 210 - ML - 12;
    const fond = () => { pdf.setFillColor(10, 10, 10); pdf.rect(0, 0, SW, 297, 'F'); };
    fond();
    // colonne latérale (première page)
    let ys = 18;
    pdf.setFillColor(237, 237, 237); pdf.roundedRect(9, ys, 14, 14, 1, 1, 'F');
    pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
    pdf.text(latin((c.name.match(/\b\p{L}/gu) || []).slice(0, 2).join('').toUpperCase()), 16, ys + 9, { align: 'center' });
    ys += 24;
    const blocSide = (titre, lignes) => {
      if (!lignes.length) return;
      pdf.setFont('courier', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(143, 143, 143); pdf.text(titre, 9, ys); ys += 4.5;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(237, 237, 237);
      lignes.forEach((x) => pdf.splitTextToSize(latin(x), SW - 16).forEach((l) => { pdf.text(l, 9, ys); ys += 4; }));
      ys += 5;
    };
    blocSide('CONTACT', c.contact); blocSide('COMPETENCES', c.competences); blocSide('LANGUES', c.langues); blocSide('DISPONIBILITE', c.dispo);
    // colonne principale
    let y = 20;
    const saut = (h) => { if (y + h > 282) { pdf.addPage(); fond(); y = 20; } };
    const ecrire = (txt, taille, style, couleur, x = ML, larg = W, inter = 1.3, famille = 'helvetica') => {
      pdf.setFont(famille, style); pdf.setFontSize(taille); pdf.setTextColor(...couleur);
      const h = taille * 0.3528 * inter;
      pdf.splitTextToSize(latin(txt), larg).forEach((l) => { saut(h); pdf.text(l, x, y); y += h; });
    };
    const titreSec = (t) => {
      y += 4; saut(12);
      ecrire(t, 7.5, 'normal', [102, 102, 102], ML, W, 1.2, 'courier');
      pdf.setDrawColor(229, 229, 229); pdf.setLineWidth(0.25); pdf.line(ML, y - 2.2, ML + W, y - 2.2); y += 1.5;
    };
    ecrire(c.name || '', 22, 'bold', [17, 17, 17]);
    if (c.title) ecrire(c.title, 10.5, 'normal', [85, 85, 85]);
    if (c.profil) { titreSec('PROFIL'); ecrire(c.profil, 9.5, 'normal', [51, 51, 51]); }
    if (c.exp.length) {
      titreSec('EXPERIENCES');
      c.exp.forEach((x) => {
        saut(16);
        ecrire(x.role, 10, 'bold', [17, 17, 17]);
        if (x.co || x.dates) ecrire([x.co, x.dates].filter(Boolean).join('   '), 9, 'normal', [0, 104, 214]);
        x.puces.forEach((p) => ecrire('- ' + p, 9, 'normal', [51, 51, 51], ML + 2, W - 2));
        y += 3;
      });
    }
    if (c.formation.length) { titreSec('FORMATION'); c.formation.forEach((x) => ecrire(x, 9.5, 'normal', [17, 17, 17])); }
    if (c.autres.length) { titreSec('AUTRES'); c.autres.forEach((x) => ecrire(x, 9.5, 'normal', [51, 51, 51])); }
    enregistrer(pdf.output('blob'), `cv-${slug(S.cur.meta.entreprise)}.pdf`);
  }

  // ---------- écran résultat ----------
  const nomStatut = () => (S.cur.meta && S.cur.meta.statut) || 'brouillon';
  function setSeg(t) {
    S.seg = t;
    document.querySelectorAll('#rSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    document.querySelectorAll('#res [data-p]').forEach((p) => { p.hidden = p.dataset.p !== t; });
    $('rFoot').hidden = t === 'score';
    $('rCopierT').textContent = t === 'cv' ? 'Copier le CV' : 'Copier la lettre';
  }
  document.querySelectorAll('#rSeg button').forEach((b) => { b.onclick = () => setSeg(b.dataset.t); });

  function actifs(oui) { // pendant la génération ou une retouche, on bloque les actions
    ['rCopier', 'rExport', 'rRetouche', 'rStatut', 'rMore', 'rCvToggle'].forEach((id) => { $(id).disabled = !oui; });
    $('rLettre').readOnly = !oui; $('rCv').readOnly = !oui;
  }
  function compteur() {
    const n = $('rLettre').value.length, max = maxChars();
    $('rCnt').textContent = `${n} / ${max}`;
    $('rCnt').classList.toggle('over', n > max);
  }
  function liste(box, items, couleur) {
    box.replaceChildren();
    (items || []).forEach((x) => { const r = el('div', 'li'); const d = el('span', 'dot'); d.style.background = couleur; r.append(d, el('span', null, x)); box.appendChild(r); });
    if (!items || !items.length) { const r = el('div', 'li'); r.appendChild(el('span', null, '—')); box.appendChild(r); }
  }
  function remplirRes() {
    const c = S.cur, m = c.meta || {};
    $('rTitre').textContent = m.entreprise || (c.cid ? 'Entreprise non précisée' : 'Candidature en cours…');
    $('rSous').textContent = [m.poste, m.date].filter(Boolean).join(' · ');
    $('rStatutT').textContent = STATUTS[nomStatut()] || 'Brouillon';
    $('rDot').className = 'dot ' + nomStatut();
    if (document.activeElement !== $('rLettre')) { $('rLettre').value = c.lettre || ''; ajuste($('rLettre'), 320); }
    if (document.activeElement !== $('rCv')) { $('rCv').value = c.cv || ''; ajuste($('rCv'), 420); renderCv(c.cv || ''); }
    const sc = c.score || {};
    if (sc.score != null) {
      $('rScoreTab').textContent = sc.score; $('rScoreVal').textContent = sc.score;
      $('rBar').style.width = Math.max(0, Math.min(100, sc.score)) + '%';
      $('rConseil').textContent = sc.conseil || '';
      liste($('rOkList'), sc.trouves, 'var(--green)'); liste($('rNoList'), sc.manquants, 'var(--amber)');
    }
    compteur();
  }
  function ouvrirRes(c, enCours) {
    S.cur = c; S.cvEdit = false;
    $('rCv').hidden = true; $('rCvView').hidden = false; $('rCvToggle').textContent = 'Modifier le texte';
    $('res').hidden = false; setSeg('lettre'); remplirRes(); actifs(!enCours);
  }
  function fermerRes() { $('res').hidden = true; $('pSteps').hidden = true; chargerHistorique(); }
  $('rBack').onclick = fermerRes;

  // sauvegarde automatique des modifications manuelles
  const sauver = debounce(async () => {
    if (!S.cur || !S.cur.cid || S.busy) return;
    try { await api('/api/historique/sauver', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, lettre: $('rLettre').value, cv: $('rCv').value }) }); } catch {}
  }, 1500);
  $('rLettre').addEventListener('input', () => { S.cur.lettre = $('rLettre').value; ajuste($('rLettre'), 320); compteur(); sauver(); });
  $('rCv').addEventListener('input', () => { S.cur.cv = $('rCv').value; ajuste($('rCv'), 420); sauver(); });
  $('rCvToggle').onclick = () => {
    S.cvEdit = !S.cvEdit;
    $('rCv').hidden = !S.cvEdit; $('rCvView').hidden = S.cvEdit;
    if (S.cvEdit) { ajuste($('rCv'), 420); } else renderCv($('rCv').value);
    $('rCvToggle').textContent = S.cvEdit ? 'Voir le CV' : 'Modifier le texte';
  };

  async function copier(texte, nom) {
    try { await navigator.clipboard.writeText(texte); }
    catch { const t = document.createElement('textarea'); t.value = texte; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast(nom + ' copié ✓');
  }
  $('rCopier').onclick = () => (S.seg === 'cv' ? copier($('rCv').value, 'CV') : copier($('rLettre').value, 'Lettre'));

  // retouche : la consigne est envoyée à Claude, et mémorisée si elle vaut pour l'avenir
  async function retoucher(consigne) {
    if (S.busy || !S.cur || !S.cur.cid) return;
    consigne = (consigne || '').trim();
    if (consigne.length < 3) { toast('Écris ce que tu veux changer'); return; }
    const cible = S.seg === 'cv' ? 'cv' : 'lettre', ta = cible === 'cv' ? $('rCv') : $('rLettre');
    const avant = ta.value;
    S.busy = true; actifs(false); ta.value = '';
    let acc = '', fini = false;
    try {
      const r = await api('/api/retouche', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, cible, instruction: consigne }) });
      if (!r.ok) { ta.value = avant; toast(await erreurDe(r), 3000); }
      else await lireFlux(r, (ev) => {
        if (ev.t === 'delta') { acc += ev.text; ta.value = acc; ajuste(ta, 320); if (cible === 'cv') renderCv(acc); }
        else if (ev.t === 'fix') { acc = ev.text; ta.value = acc; }
        else if (ev.t === 'saved') { S.cur[cible] = ta.value; S.cur.versions = ev.versions; }
        else if (ev.t === 'prefs') { if (S.profil) S.profil.apprises = ev.text; $('rApprises').value = ev.text; toast('Préférence mémorisée ✓', 2400); }
        else if (ev.t === 'error') { ta.value = avant; toast(ev.message, 3000); }
        if (ev.t === 'done' && !fini) { fini = true; S.busy = false; actifs(true); S.cur[cible] = ta.value; remplirRes(); toast('Retouché ✓'); }
      });
    } catch { ta.value = avant; toast('Connexion perdue, réessaie.', 3000); }
    if (S.busy) { S.busy = false; actifs(true); remplirRes(); }
  }
  $('rRetouche').onclick = async () => {
    const cv = S.seg === 'cv';
    const consigne = await feuille((m, fermer) => {
      const t = el('h3', null, cv ? 'Retoucher le CV' : 'Retoucher la lettre'); m.appendChild(t);
      m.appendChild(el('div', 'hint', 'Ce que tu demandes souvent est retenu pour les prochaines lettres.'));
      const box = el('div', 'mbox'); m.appendChild(box);
      (cv ? ['Plus court', 'Mets mes diplômes en premier', 'Insister sur ma disponibilité'] : ['Plus court', 'Plus chaleureux', 'Plus direct', 'Insister sur ma disponibilité']).forEach((x) => {
        const b = el('button', 'mrow'); b.appendChild(el('span', null, x)); b.insertAdjacentHTML('beforeend', CHEVRON); b.onclick = () => fermer(x); box.appendChild(b);
      });
      const lab = el('label', null, 'Ta consigne'); lab.htmlFor = 'rInstr'; lab.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
      const inp = el('input', 'in'); inp.id = 'rInstr'; inp.placeholder = 'Ou écris ta consigne…'; inp.enterKeyHint = 'send';
      const ok = el('button', 'btn', 'Appliquer'); ok.style.marginTop = '10px';
      ok.onclick = () => fermer(inp.value.trim() || null);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
      m.append(lab, inp, ok);
    });
    if (consigne) retoucher(consigne);
  };

  // statut, actions
  $('rStatut').onclick = async () => {
    const cur = nomStatut();
    const v = await menu('Où en est cette candidature ?', Object.entries(STATUTS).map(([k, label]) => ({ label, value: k, cur: k === cur })));
    if (!v || v === cur) return;
    const r = await api('/api/historique/statut', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, statut: v }) });
    if (r.ok) { S.cur.meta.statut = v; remplirRes(); toast('Statut mis à jour ✓'); } else toast(await erreurDe(r));
  };

  const LIBELLE = { generation: 'Génération', retouche: 'Retouche', manuel: 'Modification manuelle', restauration: 'Restauration' };
  async function montrerVersions() {
    await feuille((m, fermer) => {
      m.appendChild(el('h3', null, 'Versions'));
      m.appendChild(el('div', 'hint', 'Chaque changement est gardé. Tu peux revenir en arrière.'));
      const vs = (S.cur.versions || []).slice().reverse();
      vs.forEach((v, i) => {
        const d = el('div', 'ver'), t = el('div', 't');
        t.appendChild(el('b', null, `v${v.n} · ${LIBELLE[v.type] || v.type}`)); t.lastChild.style.fontWeight = '500';
        t.appendChild(el('small', null, [v.date, v.instruction && v.type !== 'manuel' ? v.instruction : ''].filter(Boolean).join(' · ')));
        d.appendChild(t);
        if (i > 0) {
          const b = el('button', 'btn sec small', 'Restaurer');
          b.onclick = async () => {
            const r = await api('/api/historique/restaurer', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, n: v.n }) });
            if (!r.ok) return toast(await erreurDe(r));
            const j = await r.json(); S.cur.lettre = j.lettre; S.cur.cv = j.cv; S.cur.versions = j.versions; remplirRes(); fermer(); toast(`Version ${v.n} restaurée ✓`);
          };
          d.appendChild(b);
        }
        m.appendChild(d);
      });
    });
  }
  async function montrerAnnonce() {
    await feuille((m) => {
      m.appendChild(el('h3', null, 'Annonce')); m.lastChild.style.marginBottom = '10px';
      const ta = el('textarea', 'in'); ta.readOnly = true; ta.rows = 14; ta.value = S.cur.offre || ''; ta.setAttribute('aria-label', 'Texte de l’annonce'); m.appendChild(ta);
    });
  }
  $('rMore').onclick = async () => {
    const v = await menu(null, [
      { label: 'Préparer l’entretien avec le coach', value: 'coach' },
      { label: 'Voir l’annonce', value: 'offre' },
      { label: 'Versions', value: 'versions' },
      { label: 'Supprimer cette candidature', value: 'del', danger: true },
    ]);
    if (v === 'coach') { coachSur(S.cur); fermerRes(); setView('coach'); }
    else if (v === 'offre') montrerAnnonce();
    else if (v === 'versions') montrerVersions();
    else if (v === 'del') {
      const ok = await menu('Supprimer définitivement ? Les versions seront perdues.', [{ label: 'Oui, supprimer', value: 'ok', danger: true }, { label: 'Annuler', value: null }]);
      if (ok !== 'ok') return;
      const r = await api('/api/historique/supprimer', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid }) });
      if (r.ok) { toast('Candidature supprimée'); fermerRes(); } else toast(await erreurDe(r));
    }
  };

  // ---------- exports ----------
  function enregistrer(blob, nom) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  async function docxLettre() {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1304, right: 1304 } } },
        children: $('rLettre').value.split('\n').map((l) => new Paragraph({ spacing: { after: l.trim() ? 160 : 0 }, children: [new TextRun({ text: l, font: 'Calibri', size: 23 })] })),
      }],
    });
    enregistrer(await Packer.toBlob(doc), `lettre-${slug(S.cur.meta.entreprise)}.docx`);
  }
  $('rExport').onclick = async () => {
    const v = await menu('Télécharger', [{ label: 'La lettre (.docx)', value: 'docx' }, { label: 'Le CV (PDF)', value: 'pdf' }]);
    if (v === 'docx') docxLettre(); else if (v === 'pdf') pdfCv();
  };

  // ---------- liste des candidatures (sous la zone d'annonce) ----------
  let cherche = false;
  async function chargerHistorique() {
    const liste = $('hListe');
    if (!S.id) { liste.replaceChildren(); const e = el('div', 'empty'); e.append(el('b', null, 'Pas encore de profil'), 'Crée ton profil pour commencer.'); liste.appendChild(e); $('hcount').textContent = '0'; return; }
    try {
      const r = await api(`/api/historique?id=${encodeURIComponent(S.id)}&q=${encodeURIComponent($('hq').value.trim())}`);
      if (!r.ok) { liste.textContent = await erreurDe(r); return; }
      const { liste: items } = await r.json();
      liste.replaceChildren(); $('hcount').textContent = String(items.length);
      if (!items.length) { const e = el('div', 'empty'); e.append(el('b', null, $('hq').value ? 'Aucun résultat' : 'Rien ici pour l’instant'), $('hq').value ? 'Essaie un autre mot.' : 'Tes candidatures apparaîtront ici.'); liste.appendChild(e); return; }
      items.forEach((it) => {
        const b = el('button', 'trow');
        const t = el('div', 't'); t.append(el('b', null, it.entreprise || 'Entreprise inconnue'), el('small', null, [it.poste, it.date].filter(Boolean).join(' · ')));
        const rr = el('div', 'r'); rr.appendChild(el('div', 'sc', it.score || '–'));
        const st = el('div', 'st'); st.append(el('span', 'dot ' + (it.statut || 'brouillon')), STATUTS[it.statut] || 'Brouillon'); rr.appendChild(st);
        b.append(t, rr);
        b.onclick = async () => {
          const r2 = await api(`/api/historique/detail?id=${encodeURIComponent(S.id)}&cid=${encodeURIComponent(it.cid)}`);
          if (!r2.ok) return toast(await erreurDe(r2));
          const d = await r2.json();
          ouvrirRes({ cid: it.cid, meta: d.meta, score: d.score, offre: d.offre, lettre: d.lettre, cv: d.cv, versions: d.versions }, false);
        };
        liste.appendChild(b);
      });
    } catch { liste.textContent = 'Serveur injoignable.'; }
  }
  $('hsearchbtn').onclick = () => { cherche = !cherche; $('hq').hidden = !cherche; if (cherche) $('hq').focus(); else { $('hq').value = ''; chargerHistorique(); } };
  $('hq').addEventListener('input', debounce(chargerHistorique, 250));

  // ---------- coach ----------
  const C = { msgs: [], cid: null, meta: null, busy: false };
  const cleCoach = () => 'coach_' + S.id;
  function restaurerCoach() {
    try { C.msgs = JSON.parse(store.get(cleCoach()) || '[]'); } catch { C.msgs = []; }
    dessinerCoach();
  }
  const sauverCoach = () => store.set(cleCoach(), JSON.stringify(C.msgs.slice(-30)));
  function coachSur(c) { C.cid = c && c.cid; C.meta = c && c.meta; majContexte(); }
  function majContexte() {
    $('cCtx').hidden = !C.cid;
    if (C.cid && C.meta) $('cCtxT').textContent = [C.meta.entreprise, C.meta.poste].filter(Boolean).join(' · ');
  }
  function bulle(cls, txt) {
    const d = el('div', 'm ' + cls, txt); $('cLog').appendChild(d); $('cLog').scrollTop = $('cLog').scrollHeight; return d;
  }
  function dessinerCoach() {
    const log = $('cLog'); log.replaceChildren();
    if (!C.msgs.length) {
      const chips = el('div'); chips.id = 'cChips';
      ['Prépare-moi à l’entretien', 'Quelles questions pièges va-t-on me poser ?', 'Rédige-moi une relance', 'Aide-moi à répondre à un recruteur'].forEach((x) => {
        const b = el('button', 'btn sec', x); b.style.justifyContent = 'flex-start'; b.onclick = () => envoyerCoach(x); chips.appendChild(b);
      });
      log.appendChild(chips);
    } else C.msgs.forEach((m) => bulle(m.role === 'user' ? 'u' : 'a', m.text));
    majContexte();
  }
  async function envoyerCoach(texte) {
    texte = (texte || '').trim();
    if (!texte || C.busy) return;
    if (!S.profil || !S.profil.existe) { toast('Crée d’abord ton profil'); setView('profil'); return; }
    C.busy = true; $('cSend').disabled = true;
    if (!C.msgs.length) $('cLog').replaceChildren();
    const histo = C.msgs.slice();
    C.msgs.push({ role: 'user', text: texte }); bulle('u', texte);
    $('cMsg').value = ''; $('cMsg').style.height = 'auto';
    const b = bulle('a', '…');
    let acc = '';
    try {
      const r = await api('/api/coach', { method: 'POST', body: JSON.stringify({ id: S.id, cid: C.cid || '', message: texte, history: histo }) });
      if (!r.ok) { b.remove(); bulle('e', await erreurDe(r)); C.msgs.pop(); }
      else await lireFlux(r, (ev) => {
        if (ev.t === 'delta') { acc += ev.text; b.textContent = acc; $('cLog').scrollTop = $('cLog').scrollHeight; }
        else if (ev.t === 'error') { if (!acc) b.remove(); bulle('e', ev.message); }
      });
      if (acc) { C.msgs.push({ role: 'assistant', text: acc }); sauverCoach(); }
      else if (r.ok && C.msgs[C.msgs.length - 1].role === 'user') C.msgs.pop();
    } catch { b.remove(); bulle('e', 'Connexion perdue, réessaie.'); C.msgs.pop(); }
    C.busy = false; $('cSend').disabled = false;
  }
  $('cForm').onsubmit = (e) => { e.preventDefault(); envoyerCoach($('cMsg').value); };
  $('cMsg').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight + 2) + 'px'; });
  $('cClear').onclick = () => { C.msgs = []; sauverCoach(); dessinerCoach(); };
  $('cCtxX').onclick = () => { C.cid = null; C.meta = null; majContexte(); };

  // ---------- démarrage ----------
  window.surVue = (v) => {
    if (v === 'postuler') { entete(); majCompteur(); chargerHistorique(); }
    if (v === 'profil') adapterProfil();
    if (v === 'coach') { majContexte(); $('cLog').scrollTop = $('cLog').scrollHeight; }
  };
  window.initApp = () => { $('pid').value = S.id; entete(); majCompteur(); if (S.id) chargerProfil(true); else dessinerCoach(); };
})();
