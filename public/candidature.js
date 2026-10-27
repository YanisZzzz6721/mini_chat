// Onglet Candidature : profil, génération lettre / CV / score, exports. Utilise $, store, code, showLogin de index.html.
(() => {
  let pret = false, occupe = false, derniere = null;

  const pid = () => $('pid').value.trim().toLowerCase();
  const headers = () => ({ 'Content-Type': 'application/json', 'x-code': code });

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
    if (r.status === 401) { store.del('code'); showLogin(true); }
    return r;
  }
  async function erreur(r) { try { return (await r.json()).error; } catch { return 'Erreur.'; } }

  // Lecture d'un flux SSE (data: {...}\n\n)
  async function flux(r, onEvent) {
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

  // ---------- Profil ----------
  function prefsDepuisFormulaire() {
    return { ton: $('rTon').value, maxChars: Number($('rMax').value) || 1500, sansTiretLong: $('rTirets').checked, notes: $('rNotes').value };
  }
  function prefsVersFormulaire(p) {
    $('rTon').value = p.ton; $('rMax').value = p.maxChars; $('rTirets').checked = p.sansTiretLong; $('rNotes').value = p.notes || '';
  }
  function montrer(mode) { // 'import' | 'edit'
    $('pImport').hidden = mode !== 'import';
    $('pEdit').hidden = mode !== 'edit';
  }

  async function charger() {
    const id = pid();
    $('pErr').textContent = ''; $('pOk').textContent = '';
    if (!id) { $('pEtat').textContent = 'Choisis un nom de profil.'; return; }
    try {
      const r = await api('/api/profil?id=' + encodeURIComponent(id));
      if (!r.ok) { $('pEtat').textContent = await erreur(r); return; }
      const p = await r.json();
      store.set('pid', id);
      prefsVersFormulaire(p.prefs);
      if (p.existe) { $('pmd').value = p.md; $('pEtat').textContent = 'Profil chargé.'; montrer('edit'); }
      else { $('pEtat').textContent = 'Nouveau profil : importe ton CV.'; montrer('import'); }
    } catch { $('pEtat').textContent = 'Serveur injoignable.'; }
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
      $('ptexte').value = t.slice(0, 30000);
    } catch { $('pErr').textContent = 'Lecture impossible : colle ton CV dans la zone ci-dessous.'; }
  };

  $('pana').onclick = async () => {
    const id = pid(), texte = $('ptexte').value.trim();
    $('pErr').textContent = '';
    if (!id) { $('pErr').textContent = 'Choisis d’abord un nom de profil.'; return; }
    if (texte.length < 30) { $('pErr').textContent = 'Importe ou colle ton CV.'; return; }
    $('pana').disabled = true; $('pana').textContent = 'Analyse en cours…';
    try {
      const r = await api('/api/profil/analyse', { method: 'POST', body: JSON.stringify({ texte }) });
      if (!r.ok) { $('pErr').textContent = await erreur(r); }
      else {
        $('pmd').value = ''; montrer('edit'); $('pOk').textContent = 'Analyse en cours…';
        let ok = true;
        await flux(r, (ev) => {
          if (ev.t === 'delta') $('pmd').value += ev.text;
          if (ev.t === 'error') { ok = false; $('pErr').textContent = ev.message; }
        });
        $('pOk').textContent = ok ? 'Relis, corrige si besoin, puis enregistre.' : '';
        if (!ok) montrer('import');
      }
    } catch { $('pErr').textContent = 'Connexion perdue, réessaie.'; }
    $('pana').disabled = false; $('pana').textContent = 'Analyser mon CV';
  };

  $('psave').onclick = async () => {
    const id = pid();
    $('pOk').textContent = '';
    try {
      const r = await api('/api/profil', { method: 'PUT', body: JSON.stringify({ id, md: $('pmd').value, prefs: prefsDepuisFormulaire() }) });
      if (r.ok) { store.set('pid', id); $('pOk').textContent = 'Profil enregistré ✓'; }
      else $('pOk').textContent = await erreur(r);
    } catch { $('pOk').textContent = 'Serveur injoignable.'; }
  };
  $('pnew').onclick = () => { $('ptexte').value = ''; $('pfile').value = ''; montrer('import'); };
  $('pload').onclick = charger;

  // ---------- Génération ----------
  const PARTIES = /^### (META|SCORE|LETTRE|CV)[ \t]*$/gm;
  function decouper(t) {
    const rep = []; let m;
    PARTIES.lastIndex = 0;
    while ((m = PARTIES.exec(t))) rep.push({ nom: m[1], debut: m.index, apres: PARTIES.lastIndex });
    const out = {};
    rep.forEach((r, i) => { out[r.nom] = t.slice(r.apres, i + 1 < rep.length ? rep[i + 1].debut : t.length).trim(); });
    out._complets = rep.length ? rep.slice(0, -1).map((r) => r.nom) : [];
    return out;
  }
  const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

  function afficher(s, final) {
    if (s.LETTRE !== undefined && !$('rLettre').dataset.edite) { $('rLettre').value = s.LETTRE; majCompteur(); }
    if (s.CV !== undefined && !$('rCv').dataset.edite) $('rCv').value = s.CV;
    const meta = s.META && (final || s._complets.includes('META')) ? json(s.META) : null;
    if (meta) $('rMeta').textContent = [meta.poste, meta.entreprise].filter(Boolean).join(' - ') || 'Compatibilité';
    const sc = s.SCORE && (final || s._complets.includes('SCORE')) ? json(s.SCORE) : null;
    if (sc) {
      $('rBar').style.width = Math.max(0, Math.min(100, sc.score)) + '%';
      $('rScore').textContent = `Compatibilité : ${sc.score}/100`;
      const puces = (arr, cls) => (arr || []).map((x) => { const e = document.createElement('span'); e.className = 'chip ' + cls; e.textContent = x; return e; });
      $('rOk').replaceChildren(...puces(sc.trouves, 'yes'));
      $('rNo').replaceChildren(...puces(sc.manquants, 'no'));
      $('rConseil').textContent = sc.conseil || '';
    }
    ['rLettre', 'rCv'].forEach((id) => { const e = $(id); e.style.height = 'auto'; e.style.height = Math.min(e.scrollHeight + 4, 520) + 'px'; });
  }

  function majCompteur() {
    const n = $('rLettre').value.length, max = Number($('rMax').value) || 1500;
    $('rCnt').textContent = `${n} / ${max} caractères`;
    $('rCnt').classList.toggle('over', n > max);
  }
  $('rLettre').addEventListener('input', () => { $('rLettre').dataset.edite = '1'; majCompteur(); });
  $('rCv').addEventListener('input', () => { $('rCv').dataset.edite = '1'; });

  $('gen').onclick = async () => {
    if (occupe) return;
    const id = pid(), offre = $('offre').value.trim();
    $('gErr').textContent = '';
    if (!id || $('pEdit').hidden) { $('gErr').textContent = 'Charge ou crée d’abord ton profil (étape 1).'; return; }
    if (offre.length < 50) { $('gErr').textContent = 'Colle le texte complet de l’annonce.'; return; }
    occupe = true; $('gen').disabled = true; $('gen').textContent = 'Génération en cours…';
    delete $('rLettre').dataset.edite; delete $('rCv').dataset.edite;
    $('rLettre').value = $('rCv').value = ''; $('res').hidden = false;
    $('rMeta').textContent = 'Compatibilité'; $('rBar').style.width = '0'; $('rScore').textContent = ''; $('rOk').replaceChildren(); $('rNo').replaceChildren(); $('rConseil').textContent = '';
    let brut = '', corrige = {};
    try {
      const r = await api('/api/candidature', { method: 'POST', body: JSON.stringify({ id, offre }) });
      if (!r.ok) { $('gErr').textContent = await erreur(r); $('res').hidden = true; }
      else {
        await flux(r, (ev) => {
          if (ev.t === 'delta') { brut += ev.text; afficher({ ...decouper(brut), ...corrige }, false); }
          if (ev.t === 'fix') { corrige[ev.section] = ev.text; afficher({ ...decouper(brut), ...corrige }, false); }
          if (ev.t === 'error') $('gErr').textContent = ev.message;
        });
        afficher({ ...decouper(brut), ...corrige }, true);
        derniere = json(decouper(brut).META || '') || {};
        $('res').scrollIntoView({ behavior: 'smooth' });
      }
    } catch { $('gErr').textContent = 'Connexion perdue, réessaie.'; }
    occupe = false; $('gen').disabled = false; $('gen').textContent = 'Générer ma candidature';
  };

  // ---------- Copier / exporter ----------
  async function copier(texte, bouton) {
    try { await navigator.clipboard.writeText(texte); }
    catch { const t = document.createElement('textarea'); t.value = texte; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    const ancien = bouton.textContent; bouton.textContent = 'Copié ✓'; setTimeout(() => { bouton.textContent = ancien; }, 1500);
  }
  $('cpL').onclick = (e) => copier($('rLettre').value, e.target);
  $('cpC').onclick = (e) => copier($('rCv').value, e.target);

  const slug = (t) => (t || 'candidature').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'candidature';
  function enregistrer(blob, nom) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  $('dlL').onclick = async () => {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const lignes = $('rLettre').value.split('\n');
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1304, right: 1304 } } },
        children: lignes.map((l) => new Paragraph({ spacing: { after: l.trim() ? 160 : 0 }, children: [new TextRun({ text: l, font: 'Calibri', size: 23 })] })),
      }],
    });
    enregistrer(await Packer.toBlob(doc), `lettre-${slug(derniere && derniere.entreprise)}.docx`);
  };

  // jsPDF ne gère que Latin-1 : on remplace les caractères typographiques courants
  const latin = (t) => t.replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/…/g, '...').replace(/[  ]/g, ' ')
    .replace(/[•·▪●]/g, '-').replace(/→/g, '->').replace(/[—–]/g, '-').replace(/[^\u0000-ÿ€]/g, '');

  $('dlC').onclick = () => {
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
    enregistrer(pdf.output('blob'), `cv-${slug(derniere && derniere.entreprise)}.pdf`);
  };

  window.initCandidature = () => {
    if (pret) return;
    pret = true;
    $('pid').value = store.get('pid') || '';
    if ($('pid').value) charger();
  };
})();
