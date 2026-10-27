// Écrans Postuler, Historique, Profil et résultat. S'appuie sur app.js ($, store, api, lireFlux, toast, menu, setView).
(() => {
  const STATUTS = { brouillon: 'Brouillon', envoyee: 'Envoyée', reponse: 'Réponse reçue', entretien: 'Entretien', refus: 'Refus' };
  const S = { id: store.get('pid') || '', profil: null, cur: null, busy: false, seg: 'lettre', sheet: false };

  const slug = (t) => (t || 'candidature').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'candidature';
  const maxChars = () => (S.profil && S.profil.prefs && S.profil.prefs.maxChars) || 1500;
  const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const ajuste = (ta, min = 90) => { ta.style.height = 'auto'; ta.style.height = Math.max(min, ta.scrollHeight + 2) + 'px'; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- profil ----------
  function sousTitre() {
    const s = $('pSub');
    s.replaceChildren();
    const pill = document.createElement('span');
    if (S.profil && S.profil.existe) { pill.className = 'pill ok'; pill.textContent = `Profil : ${S.id}`; s.appendChild(pill); }
    else {
      pill.className = 'pill warn'; pill.textContent = 'Crée d’abord ton profil'; pill.style.cursor = 'pointer';
      pill.onclick = () => setView('profil'); s.appendChild(pill);
    }
  }

  function montrerProfil(mode) { $('pImport').hidden = mode !== 'import'; $('pEdit').hidden = mode !== 'edit'; }
  const prefsDuFormulaire = () => ({ ton: $('rTon').value, maxChars: Number($('rMax').value) || 1500, sansTiretLong: $('rTirets').checked, notes: $('rNotes').value });

  async function chargerProfil(silencieux) {
    const id = $('pid').value.trim().toLowerCase() || S.id;
    if (!id) { sousTitre(); return; }
    $('pErr').textContent = ''; $('pOk').textContent = '';
    try {
      const r = await api('/api/profil?id=' + encodeURIComponent(id));
      if (!r.ok) { $('pEtat').textContent = await erreurDe(r); return; }
      const p = await r.json();
      S.id = id; store.set('pid', id); $('pid').value = id; S.profil = p;
      $('rTon').value = p.prefs.ton; $('rMax').value = p.prefs.maxChars; $('rTirets').checked = p.prefs.sansTiretLong; $('rNotes').value = p.prefs.notes || '';
      $('rApprises').value = p.apprises || ''; ajuste($('rApprises'));
      if (p.existe) { $('pmd').value = p.md; montrerProfil('edit'); ajuste($('pmd'), 220); $('pEtat').textContent = silencieux ? '' : 'Profil chargé.'; }
      else { montrerProfil('import'); $('pEtat').textContent = 'Nouveau profil : importe ton CV.'; }
    } catch { $('pEtat').textContent = 'Serveur injoignable.'; }
    sousTitre();
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
      $('ptexte').value = t.slice(0, 30000); ajuste($('ptexte'), 140);
    } catch { $('pErr').textContent = 'Lecture impossible : colle ton CV dans la zone ci-dessous.'; }
  };

  $('pana').onclick = async () => {
    const id = $('pid').value.trim().toLowerCase(), texte = $('ptexte').value.trim();
    $('pErr').textContent = '';
    if (!/^[a-z0-9_-]{2,30}$/.test(id)) { $('pErr').textContent = 'Choisis un nom de profil (2 à 30 lettres ou chiffres).'; return; }
    if (texte.length < 30) { $('pErr').textContent = 'Importe ou colle ton CV.'; return; }
    S.id = id; store.set('pid', id);
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

  $('psave').onclick = async () => {
    const id = $('pid').value.trim().toLowerCase();
    $('pOk').textContent = '';
    try {
      const r = await api('/api/profil', { method: 'PUT', body: JSON.stringify({ id, md: $('pmd').value, prefs: prefsDuFormulaire(), apprises: $('rApprises').value }) });
      if (r.ok) { await chargerProfil(true); $('pOk').textContent = 'Profil enregistré ✓'; toast('Profil enregistré ✓'); }
      else $('pOk').textContent = await erreurDe(r);
    } catch { $('pOk').textContent = 'Serveur injoignable.'; }
  };
  $('pnew').onclick = () => { $('ptexte').value = ''; $('pfile').value = ''; montrerProfil('import'); };
  $('pload').onclick = () => chargerProfil(false);
  $('pmd').addEventListener('input', () => ajuste($('pmd'), 220));

  // ---------- Postuler : saisie de l'annonce ----------
  $('offre').addEventListener('input', () => ajuste($('offre'), 150));
  $('coller').onclick = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { toast('Le presse-papiers est vide'); return; }
      $('offre').value = t; ajuste($('offre'), 150); toast('Annonce collée ✓');
    } catch { toast('Appuie longuement dans la zone, puis « Coller »', 2800); $('offre').focus(); }
  };
  $('vider').onclick = () => { $('offre').value = ''; ajuste($('offre'), 150); $('gErr').textContent = ''; };

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
    const noms = ['META', 'SCORE', 'LETTRE', 'CV'];
    const presentes = s ? s._ordre : [];
    document.querySelectorAll('#pSteps .step').forEach((el, i) => {
      const nom = noms[i], pos = presentes.indexOf(nom), dernier = presentes.length - 1;
      el.className = 'step' + (fini || (pos >= 0 && pos < dernier) ? ' done' : (pos === dernier && pos >= 0) || (!presentes.length && i === 0) ? ' run' : '');
      el.firstElementChild.textContent = el.classList.contains('done') ? '✓' : '';
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
    if (ok) { etapes(null, true); $('pStepsT').textContent = 'Candidature prête ✓'; $('offre').value = ''; ajuste($('offre'), 150); if (!ouvert) ouvrirRes(S.cur, false); else { actifs(true); remplirRes(); } }
    else { $('pSteps').hidden = true; if (ouvert) fermerRes(); }
  }
  $('gen').onclick = generer;

  // ---------- écran résultat ----------
  function setSeg(t) {
    S.seg = t;
    document.querySelectorAll('#rSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    document.querySelectorAll('#res .pane').forEach((p) => { p.hidden = p.dataset.p !== t; });
    $('rFoot').hidden = !['lettre', 'cv'].includes(t);
    $('rRetoucheBloc').hidden = !['lettre', 'cv'].includes(t);
    $('rCopier').textContent = t === 'cv' ? 'Copier le CV' : 'Copier la lettre';
    if (t === 'cv') $('rInstr').placeholder = 'Retoucher le CV… (ex : mets mes diplômes en premier)';
    else $('rInstr').placeholder = 'Retoucher… (ex : parle de mon expérience en caisse)';
  }
  document.querySelectorAll('#rSeg button').forEach((b) => { b.onclick = () => setSeg(b.dataset.t); });

  function actifs(oui) { // pendant la génération ou une retouche, on bloque les actions
    ['rCopier', 'rExport', 'rEnvoi', 'rStatut', 'rPlus'].forEach((id) => { $(id).disabled = !oui; });
    $('rInstr').disabled = !oui; $('rLettre').readOnly = !oui; $('rCv').readOnly = !oui;
    document.querySelectorAll('#rQuick .chip').forEach((c) => { c.disabled = !oui; c.style.opacity = oui ? '' : '.5'; });
  }

  function compteur() {
    const n = $('rLettre').value.length, max = maxChars();
    $('rCnt').textContent = `${n} / ${max} caractères`;
    $('rCnt').classList.toggle('over', n > max);
  }

  const LIBELLE = { generation: 'Génération', retouche: 'Retouche', manuel: 'Modification manuelle', restauration: 'Restauration' };
  function versions() {
    const box = $('rVers'); box.replaceChildren();
    const vs = (S.cur.versions || []).slice().reverse();
    vs.forEach((v, i) => {
      const d = document.createElement('div'); d.className = 'ver';
      const t = document.createElement('div'); t.className = 't';
      const b = document.createElement('b'); b.style.fontWeight = '600'; b.textContent = `v${v.n} · ${LIBELLE[v.type] || v.type}`;
      const s = document.createElement('small'); s.textContent = [v.date, v.instruction && v.type !== 'manuel' ? v.instruction : ''].filter(Boolean).join(' · ');
      t.append(b, s); d.appendChild(t);
      if (i > 0) {
        const btn = document.createElement('button'); btn.textContent = 'Restaurer';
        btn.onclick = async () => {
          const r = await api('/api/historique/restaurer', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, n: v.n }) });
          if (!r.ok) return toast(await erreurDe(r));
          const j = await r.json(); S.cur.lettre = j.lettre; S.cur.cv = j.cv; S.cur.versions = j.versions; remplirRes(); toast(`Version ${v.n} restaurée ✓`);
        };
        d.appendChild(btn);
      }
      box.appendChild(d);
    });
  }

  function remplirRes() {
    const c = S.cur, m = c.meta || {};
    $('rTitre').textContent = m.entreprise || 'Candidature en cours…';
    $('rSous').textContent = [m.poste, m.date].filter(Boolean).join(' · ');
    $('rStatut').textContent = (STATUTS[m.statut || 'brouillon'] || 'Brouillon') + ' ▾';
    if (document.activeElement !== $('rLettre')) $('rLettre').value = c.lettre || '';
    if (document.activeElement !== $('rCv')) $('rCv').value = c.cv || '';
    $('rOffre').value = c.offre || ''; ajuste($('rOffre'), 160);
    const sc = c.score || {};
    if (sc.score != null) {
      $('rBar').style.width = Math.max(0, Math.min(100, sc.score)) + '%';
      $('rScoreT').textContent = `Compatibilité : ${sc.score}/100`;
      const tags = (arr, cls) => (arr || []).map((x) => { const e = document.createElement('span'); e.className = 'tag ' + cls; e.textContent = x; return e; });
      $('rOk').replaceChildren(...tags(sc.trouves, 'yes')); $('rNo').replaceChildren(...tags(sc.manquants, 'no'));
      $('rConseil').textContent = sc.conseil || '';
    }
    compteur(); versions();
  }

  function ouvrirRes(c, enCours) {
    S.cur = c; S.sheet = true;
    $('res').hidden = false; setSeg('lettre'); remplirRes(); actifs(!enCours);
  }
  function fermerRes() {
    S.sheet = false; $('res').hidden = true;
    $('pSteps').hidden = true;
    if (!$('v-histo').hidden) chargerHistorique();
  }
  $('rBack').onclick = fermerRes;

  // sauvegarde automatique des modifications manuelles
  const sauver = debounce(async () => {
    if (!S.cur || !S.cur.cid || S.busy) return;
    try {
      const r = await api('/api/historique/sauver', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, lettre: $('rLettre').value, cv: $('rCv').value }) });
      if (r.ok) { const j = await r.json(); if (j.versions) { S.cur.versions = j.versions; versions(); } }
    } catch {}
  }, 1500);
  $('rLettre').addEventListener('input', () => { S.cur.lettre = $('rLettre').value; compteur(); sauver(); });
  $('rCv').addEventListener('input', () => { S.cur.cv = $('rCv').value; sauver(); });

  // copier
  async function copier(texte, nom) {
    try { await navigator.clipboard.writeText(texte); }
    catch { const t = document.createElement('textarea'); t.value = texte; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast(nom + ' copié ✓');
  }
  $('rCopier').onclick = () => (S.seg === 'cv' ? copier($('rCv').value, 'CV') : copier($('rLettre').value, 'Lettre'));

  // retouche : la consigne est envoyée à Claude, et mémorisée si elle vaut pour les prochaines lettres
  async function retoucher(consigne) {
    if (S.busy || !S.cur || !S.cur.cid) return;
    consigne = (consigne || '').trim();
    if (consigne.length < 3) { toast('Écris ce que tu veux changer'); return; }
    const cible = S.seg === 'cv' ? 'cv' : 'lettre', ta = cible === 'cv' ? $('rCv') : $('rLettre');
    const avant = ta.value;
    S.busy = true; actifs(false); ta.value = ''; $('rInstr').value = '';
    let acc = '', fini = false;
    try {
      const r = await api('/api/retouche', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, cible, instruction: consigne }) });
      if (!r.ok) { ta.value = avant; toast(await erreurDe(r), 3000); }
      else await lireFlux(r, (ev) => {
        if (ev.t === 'delta') { acc += ev.text; ta.value = acc; ta.scrollTop = ta.scrollHeight; }
        else if (ev.t === 'fix') { acc = ev.text; ta.value = acc; }
        else if (ev.t === 'saved') { S.cur[cible] = ta.value; S.cur.versions = ev.versions; }
        else if (ev.t === 'prefs') { if (S.profil) S.profil.apprises = ev.text; $('rApprises').value = ev.text; toast('Préférence mémorisée ✓', 2400); }
        else if (ev.t === 'error') { ta.value = avant; toast(ev.message, 3000); }
        if (ev.t === 'done' && !fini) { fini = true; S.busy = false; actifs(true); S.cur[cible] = ta.value; remplirRes(); toast('Retouché ✓'); }
      });
    } catch { ta.value = avant; toast('Connexion perdue, réessaie.', 3000); }
    if (S.busy) { S.busy = false; actifs(true); remplirRes(); }
  }
  $('rEnvoi').onclick = () => retoucher($('rInstr').value);
  $('rInstr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); retoucher($('rInstr').value); } });
  document.querySelectorAll('#rQuick .chip').forEach((c) => { c.onclick = () => retoucher(c.textContent); });

  // statut, suppression
  $('rStatut').onclick = async () => {
    const cur = (S.cur.meta && S.cur.meta.statut) || 'brouillon';
    const v = await menu('Où en est cette candidature ?', Object.entries(STATUTS).map(([k, label]) => ({ label, value: k, cur: k === cur })));
    if (!v || v === cur) return;
    const r = await api('/api/historique/statut', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid, statut: v }) });
    if (r.ok) { S.cur.meta.statut = v; remplirRes(); toast('Statut mis à jour ✓'); } else toast(await erreurDe(r));
  };
  $('rPlus').onclick = async () => {
    const v = await menu(null, [{ label: 'Supprimer cette candidature', value: 'del', danger: true }, { label: 'Annuler', value: null }]);
    if (v !== 'del') return;
    const ok = await menu('Supprimer définitivement ? Les versions seront perdues.', [{ label: 'Oui, supprimer', value: 'ok', danger: true }, { label: 'Annuler', value: null }]);
    if (ok !== 'ok') return;
    const r = await api('/api/historique/supprimer', { method: 'POST', body: JSON.stringify({ id: S.id, cid: S.cur.cid }) });
    if (r.ok) { toast('Candidature supprimée'); fermerRes(); } else toast(await erreurDe(r));
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
  // jsPDF ne gère que Latin-1 : on remplace les caractères typographiques courants
  const latin = (t) => t.replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/…/g, '...').replace(/[  ]/g, ' ')
    .replace(/[•·▪●]/g, '-').replace(/→/g, '->').replace(/[—–]/g, '-').replace(/[^\u0000-ÿ€]/g, '');
  function pdfCv() {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 18, W = 210 - 2 * L;
    let y = 20;
    const saut = (h) => { if (y + h > 280) { pdf.addPage(); y = 20; } };
    const ecrire = (txt, taille, style, indent = 0, interligne = 1.25) => {
      pdf.setFont('helvetica', style); pdf.setFontSize(taille);
      const h = taille * 0.3528 * interligne;
      pdf.splitTextToSize(latin(txt), W - indent).forEach((l) => { saut(h); pdf.text(l, L + indent, y); y += h; });
    };
    for (const brut of $('rCv').value.split('\n')) {
      const l = brut.trimEnd();
      if (!l.trim()) { y += 1.5; continue; }
      if (/^# /.test(l)) { pdf.setTextColor(15, 23, 42); ecrire(l.slice(2), 20, 'bold'); y += 1; }
      else if (/^## /.test(l)) {
        y += 3; saut(10); pdf.setTextColor(37, 99, 235); ecrire(l.slice(3).toUpperCase(), 11, 'bold', 0, 1.1);
        pdf.setDrawColor(37, 99, 235); pdf.setLineWidth(0.3); pdf.line(L, y - 1, L + W, y - 1); y += 2; pdf.setTextColor(30, 30, 30);
      } else if (/^[-*] /.test(l)) { pdf.setTextColor(30, 30, 30); ecrire('- ' + l.slice(2).replace(/\*\*/g, ''), 10, 'normal', 3); }
      else if (/^\*\*/.test(l)) { pdf.setTextColor(30, 30, 30); ecrire(l.replace(/\*\*/g, ''), 10.5, 'bold'); }
      else { pdf.setTextColor(60, 60, 60); ecrire(l.replace(/\*\*/g, ''), 10, 'normal'); }
    }
    enregistrer(pdf.output('blob'), `cv-${slug(S.cur.meta.entreprise)}.pdf`);
  }
  $('rExport').onclick = async () => {
    const v = await menu('Télécharger', [{ label: 'La lettre (.docx)', value: 'docx' }, { label: 'Le CV (PDF)', value: 'pdf' }]);
    if (v === 'docx') docxLettre(); else if (v === 'pdf') pdfCv();
  };

  // ---------- Historique ----------
  async function chargerHistorique() {
    const liste = $('hListe');
    if (!S.id) { liste.innerHTML = ''; const e = document.createElement('div'); e.className = 'empty'; e.innerHTML = '<b>Pas encore de profil</b>Crée ton profil pour commencer.'; liste.appendChild(e); return; }
    try {
      const r = await api(`/api/historique?id=${encodeURIComponent(S.id)}&q=${encodeURIComponent($('hq').value.trim())}`);
      if (!r.ok) { liste.textContent = await erreurDe(r); return; }
      const { liste: items } = await r.json();
      liste.replaceChildren();
      if (!items.length) { const e = document.createElement('div'); e.className = 'empty'; e.innerHTML = '<b>Rien ici pour l’instant</b>Tes candidatures apparaîtront ici.'; liste.appendChild(e); return; }
      items.forEach((it) => {
        const b = document.createElement('button'); b.className = 'item';
        const badge = document.createElement('div'); badge.className = 'badge ' + (it.score >= 75 ? 'hi' : it.score >= 50 ? 'mid' : 'lo'); badge.textContent = it.score || '–';
        const t = document.createElement('div'); t.className = 't';
        const n = document.createElement('b'); n.textContent = it.entreprise || 'Entreprise inconnue';
        const p = document.createElement('small'); p.textContent = [it.poste, it.date].filter(Boolean).join(' · ');
        const st = document.createElement('span'); st.className = 'st ' + (it.statut || 'brouillon'); st.textContent = STATUTS[it.statut] || 'Brouillon';
        t.append(n, p, st); b.append(badge, t);
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
  $('hq').addEventListener('input', debounce(chargerHistorique, 250));

  window.surVue = (v) => {
    if (v === 'histo') chargerHistorique();
    if (v === 'postuler') { sousTitre(); ajuste($('offre'), 150); }
    if (v === 'profil') { ajuste($('pmd'), 220); ajuste($('rApprises')); ajuste($('ptexte'), 140); } // mesure possible seulement quand l'écran est visible
  };
  window.initApp = () => { $('pid').value = S.id; ajuste($('offre'), 150); if (S.id) chargerProfil(true); else sousTitre(); };
})();
