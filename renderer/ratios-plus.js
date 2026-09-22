/* ============================================================
   ★ v2.6 ★ RATIOS PAR TYPE D'OUVRAGE + ★ v2.6.1 ★ RATIOS PERSONNALISÉS
   - Vue "Auto par type" : regroupement par similarité, avec garde-fous
     (mots creux BTP ignorés, matériaux incompatibles jamais mélangés,
     signatures techniques C30/37 / CEM III / DN… discriminantes,
     unités normalisées et JAMAIS mélangées).
   - Vue "Mes ratios" : groupes définis par l'utilisateur (mots-clés
     de recherche automatique et/ou sélection manuelle).
   Chargé après le script principal (portée globale partagée).
   ============================================================ */

window.RATIO_VIEW = 'repere';
const TYPE_SIM_THRESHOLD = 0.5;
let lastTypeClusterKeys = [];

/* ── Normalisations ─────────────────────────────────────────── */

function foldTxt(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Unités équivalentes ramenées à une forme canonique (m² = M2 = m2…)
function normalizeUnite(u) {
  const f = foldTxt(u).replace(/[²³]/g, m => (m === '²' ? '2' : '3')).replace(/[\s.]/g, '');
  const map = {
    'm2': 'm2', 'metre2': 'm2', 'm02': 'm2',
    'm3': 'm3',
    'ml': 'ml', 'metrelineaire': 'ml', 'mlin': 'ml', 'm': 'ml',
    'u': 'u', 'un': 'u', 'unite': 'u', 'pce': 'u', 'piece': 'u', 'pc': 'u',
    'ens': 'ens', 'ensemble': 'ens',
    'ff': 'forfait', 'fft': 'forfait', 'forf': 'forfait', 'forfait': 'forfait', 'ft': 'forfait',
    'kg': 'kg', 'h': 'h', 'heure': 'h', 'hr': 'h', 'j': 'j', 'jour': 'j'
  };
  return map[f] || f || 'u';
}

/* Mots "creux" du BTP : présents partout, ils gonflaient artificiellement la
   similarité (ex : "Fourniture et pose de porte bois" vs "... porte métallique"
   partageaient fourniture/pose/porte → regroupés à tort). */
const BTP_STOPWORDS = new Set([
  'fourniture', 'fournitures', 'pose', 'mise', 'oeuvre', 'compris', 'comprenant',
  'ensemble', 'realisation', 'execution', 'travaux', 'toutes', 'tous', 'sujetion',
  'sujetions', 'suivant', 'selon', 'pour', 'avec', 'sans', 'sur', 'sous', 'dans',
  'les', 'des', 'aux', 'par', 'une', 'dito', 'idem', 'type', 'genre', 'etc',
  'ouvrage', 'ouvrages', 'accessoires', 'necessaires', 'necessaire', 'parfait',
  'achevement', 'depose', 'evacuation', 'complement', 'plus', 'value', 'moins'
]);

/* Familles de matériaux : deux désignations qui portent des matériaux de
   familles différentes ne sont JAMAIS regroupées (porte bois ≠ porte métal). */
const MAT_ALIASES = {
  bois: 'bois', chene: 'bois', sapin: 'bois', mdf: 'bois', stratifie: 'bois', contreplaque: 'bois',
  metallique: 'metal', metalliques: 'metal', metal: 'metal', acier: 'metal', galva: 'metal', galvanise: 'metal',
  alu: 'alu', aluminium: 'alu',
  pvc: 'pvc',
  inox: 'inox',
  beton: 'beton',
  platre: 'platre', placo: 'platre', ba13: 'platre',
  verre: 'verre', vitre: 'verre', vitree: 'verre',
  carrelage: 'carrelage', faience: 'carrelage', gres: 'carrelage'
};
function materialSet(tokens) {
  const s = new Set();
  tokens.forEach(t => { const m = MAT_ALIASES[t]; if (m) s.add(m); });
  return s;
}

/* Signature technique extraite de la désignation brute : classes de béton,
   ciments, classes d'exposition, diamètres… Deux lignes ne se regroupent que
   si leurs signatures sont IDENTIQUES (C30/37 CEM III ≠ C30/37 CEM II,
   même si "ecopact" ou la marque diffèrent). */
function techSignature(s) {
  const f = foldTxt(s).replace(/\s+/g, ' ');
  const found = [];
  const push = (m, norm) => { if (m) m.forEach(x => found.push(norm(x))); };
  push(f.match(/c\s?\d{2,3}\s?\/\s?\d{2,3}/g),        x => x.replace(/\s/g, ''));            // C25/30, C30/37
  push(f.match(/cem\s?(?:i{1,3}v?|v)(?:\s?\/\s?[a-c])?/g), x => x.replace(/\s/g, ''));       // CEM II, CEM III/A
  push(f.match(/x[cfdsa]\d/g),                        x => x);                                // XC1, XF3, XA2…
  push(f.match(/dn\s?\d{2,4}/g),                      x => x.replace(/\s/g, ''));            // DN100
  push(f.match(/diam(?:etre)?\.?\s?\d{2,4}|ø\s?\d{2,4}/g), x => 'd' + x.replace(/\D/g, '')); // diam. 125
  push(f.match(/ep\.?\s?\d{1,3}\s?(?:mm|cm)/g),       x => 'ep' + x.replace(/\D/g, ''));     // ep. 20 cm
  push(f.match(/\bs\d{3}[a-z]?\b/g),                  x => x);                                // S235, S355
  push(f.match(/\bei\s?\d{2,3}\b|\bcf\s?\d\s?h\b/g),  x => x.replace(/\s/g, ''));            // EI30, CF 1h
  return [...new Set(found)].sort().join('|');
}

// Tokens utiles (sans accents, sans stopwords BTP, sans nombres isolés courts)
function usefulTokens(designation) {
  return new Set(tokenize(designation).filter(t => !BTP_STOPWORDS.has(t)));
}
function jaccardSets(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(t => { if (b.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

/* ── Bascule de vue ─────────────────────────────────────────── */

function setRatioView(v) {
  window.RATIO_VIEW = v;
  const tg = $('ratioViewToggle');
  if (tg) tg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.rview === v));
  const t = $('ratiosTitle');
  if (t) t.textContent = v === 'types' ? '🧩 Ratios auto par type d\'ouvrage'
                       : v === 'perso' ? '🛠 Mes ratios personnalisés'
                       : '📊 Ratios par repère interne';
  ['ratiosHelpRepere', 'ratiosHelpTypes', 'ratiosHelpPerso'].forEach(id => {
    const el = $(id);
    if (el) el.style.display =
      (id === 'ratiosHelpTypes'  && v === 'types')  ? '' :
      (id === 'ratiosHelpPerso'  && v === 'perso')  ? '' :
      (id === 'ratiosHelpRepere' && v === 'repere') ? '' : 'none';
  });
  expandedRatios.clear();
  renderRatios();
}

/* ── Statistiques communes ──────────────────────────────────── */

function computeGroupStats(c, applyExclusions) {
  const inc = applyExclusions ? c.items.filter(it => !isPriceExcluded(it)) : c.items;
  const prix = inc.map(it => it.prix);
  c.cntTotal = c.items.length;
  c.cnt = inc.length;
  c.nbExcluded = c.cntTotal - c.cnt;
  c.nbReperes = new Set(c.items.map(it => it.repere)).size;
  c.nbChantiers = new Set(c.items.map(it => it.projet || '')).size;
  if (prix.length) {
    c.min = Math.min(...prix);
    c.max = Math.max(...prix);
    c.moy = prix.reduce((a, b) => a + b, 0) / prix.length;
    c.median = [...prix].sort((a, b) => a - b)[Math.floor(prix.length / 2)];
    const byDate = [...inc].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    c.dern = byDate[byDate.length - 1].prix;
  } else {
    c.min = c.max = c.moy = c.median = c.dern = 0;
  }
}

function groupDetailHtml(c, colspan, extraNote) {
  const byDate = [...c.items].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.projet || '').localeCompare(b.projet || ''));
  return `<tr class="ratio-detail-row"><td colspan="${colspan}">
    <div class="ratio-detail-inner">
      <table>
        <thead><tr>
          <th>Date</th><th>Chantier</th><th>Repère</th><th>Type</th><th>Désignation</th><th>U.</th>
          <th style="text-align:right">Prix HT</th>
          <th style="text-align:right">Écart vs moy.</th><th></th>
        </tr></thead>
        <tbody>${byDate.map(it => {
          const idx = BASE.indexOf(it);
          const ref = c.moy || (c.items.reduce((s, x) => s + x.prix, 0) / c.items.length);
          const ecart = ref ? ((it.prix - ref) / ref * 100) : 0;
          const ecartC = Math.abs(ecart) > 50 ? '#a93226' : (Math.abs(ecart) > 20 ? '#b9770e' : '#085041');
          return `<tr>
            <td style="color:#888">${esc(it.date) || '—'}</td>
            <td>${esc(it.projet) || '—'}</td>
            <td><strong>${esc(it.repere)}</strong></td>
            <td>${typeBadge(it)}</td>
            <td>${esc(it.designation)}</td>
            <td>${esc(it.unite)}</td>
            <td style="text-align:right;font-weight:700">${fmtPrix(it.prix)}</td>
            <td style="text-align:right;color:${ecartC};font-weight:600">${ecart >= 0 ? '+' : ''}${ecart.toFixed(1)}%</td>
            <td><button class="btn btn-bleu" style="padding:1px 5px;font-size:9px"
                onclick="event.stopPropagation();openEdit(${idx})">✏️</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <div style="margin-top:6px;font-size:10px;color:#666">
        📊 Moyenne : <strong style="color:#085041">${c.cnt ? fmtPrix(c.moy) : '—'}</strong>
        · ${c.cnt} prix, ${c.nbReperes} repère(s), ${c.nbChantiers} chantier(s)
        ${c.nbExcluded ? ` · <span style="color:#b9770e">${c.nbExcluded} prix exclu(s) du calcul</span>` : ''}
        ${extraNote || ''}
      </div>
    </div>
  </td></tr>`;
}

/* ── Vue AUTO par type d'ouvrage ────────────────────────────── */

/* Clustering glouton avec garde-fous. Une ligne rejoint un groupe si :
   même lot, même unité normalisée, même signature technique, matériaux
   compatibles, et similarité Jaccard (mots utiles) ≥ seuil. */
function buildTypeClusters(items) {
  const clusters = [];
  const byGroup = {};
  for (const it of items) {
    const feat = {
      tokens: usefulTokens(it.designation),
      tech: techSignature(it.designation)
    };
    feat.mat = materialSet([...feat.tokens]);
    const gkey = `${it.lot}||${normalizeUnite(it.unite)}||${feat.tech}`;
    if (!byGroup[gkey]) byGroup[gkey] = [];
    let placed = null;
    for (const c of byGroup[gkey]) {
      // Matériaux : si les deux en déclarent, il faut une famille commune
      if (feat.mat.size && c.mat.size) {
        let commun = false;
        feat.mat.forEach(m => { if (c.mat.has(m)) commun = true; });
        if (!commun) continue;
      }
      if (jaccardSets(feat.tokens, c.tokens) >= TYPE_SIM_THRESHOLD) { placed = c; break; }
    }
    if (!placed) {
      placed = {
        lot: it.lot, unite: normalizeUnite(it.unite), tech: feat.tech,
        repDesg: it.designation, tokens: new Set(feat.tokens), mat: new Set(feat.mat),
        items: []
      };
      byGroup[gkey].push(placed);
      clusters.push(placed);
    }
    placed.items.push(it);
    feat.mat.forEach(m => placed.mat.add(m));
    // L'étiquette du groupe = la désignation la plus courte (souvent la plus générique)
    if (it.designation.length < placed.repDesg.length) placed.repDesg = it.designation;
  }
  clusters.forEach(c => {
    c.key = 'T::' + c.lot + '||' + c.unite + '||' + c.tech + '||' +
      [...c.tokens].sort().slice(0, 6).join('-');
  });
  return clusters;
}

function renderRatiosTypes() {
  const srch = foldTxt($('searchRatio').value || '');
  const flot = $('filterRatioLot').value;
  const items = ratioPool().filter(r =>
    (!flot || r.lot === flot) &&
    (!srch || foldTxt(r.designation).includes(srch) ||
              foldTxt(r.repere).includes(srch) ||
              foldTxt(r.projet).includes(srch)));

  const clusters = buildTypeClusters(items);
  clusters.forEach(c => computeGroupStats(c, true));
  clusters.sort((a, b) => b.cntTotal - a.cntTotal || lotIdx(a.lot) - lotIdx(b.lot));
  lastTypeClusterKeys = clusters.map(c => c.key);

  $('tblRatios').innerHTML =
    `<thead><tr>
      <th style="width:24px"></th>
      <th>Type d'ouvrage</th><th>Lot</th><th>Unité</th>
      <th style="text-align:right" title="Nombre de prix regroupés">Nb prix</th>
      <th style="text-align:right" title="Nombre de repères différents regroupés">Repères</th>
      <th style="text-align:right" title="Nombre de chantiers différents">Chantiers</th>
      <th style="text-align:right">Min</th>
      <th style="text-align:right">Max</th>
      <th style="text-align:right">Moyenne</th>
      <th style="text-align:right">Médiane</th>
      <th style="text-align:right">Dernier</th>
    </tr></thead>
    <tbody>${clusters.map(c => {
      const isExp = expandedRatios.has(c.key);
      const keyJs = c.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const cntTxt = c.nbExcluded > 0
        ? `<strong>${c.cnt}</strong><span style="color:#b9770e;font-size:10px"> /${c.cntTotal}</span>`
        : `<strong>${c.cnt}</strong>`;
      const techTag = c.tech ? ` <span class="badge" style="background:#8e44ad22;color:#8e44ad" title="Signature technique du groupe">${esc(c.tech.replace(/\|/g, ' '))}</span>` : '';
      let html = `<tr class="ratio-row ${isExp ? 'expanded' : ''}" onclick="toggleRatio('${keyJs}',event)">
        <td><span class="expand-icon">▶</span></td>
        <td>${esc(c.repDesg)}${techTag}</td>
        <td><span class="badge" style="background:${lotColor(c.lot)}22;color:${lotColor(c.lot)}">${lotShort(c.lot)}</span></td>
        <td>${esc(c.unite)}</td>
        <td style="text-align:right">${cntTxt}</td>
        <td style="text-align:right">${c.nbReperes}</td>
        <td style="text-align:right">${c.nbChantiers}</td>
        <td style="text-align:right">${c.cnt ? fmtPrix(c.min) : '—'}</td>
        <td style="text-align:right">${c.cnt ? fmtPrix(c.max) : '—'}</td>
        <td style="text-align:right;color:#085041"><strong>${c.cnt ? fmtPrix(c.moy) : '—'}</strong></td>
        <td style="text-align:right">${c.cnt ? fmtPrix(c.median) : '—'}</td>
        <td style="text-align:right">${c.cnt ? fmtPrix(c.dern) : '—'}</td>
      </tr>`;
      if (isExp) html += groupDetailHtml(c, 12);
      return html;
    }).join('') || '<tr><td colspan="12" style="text-align:center;color:#888;padding:20px">Aucun prix</td></tr>'}</tbody>`;
}

/* ── Vue MES RATIOS (personnalisés) ─────────────────────────── */

function customRatioMatches(cr, r) {
  if ((cr.excludeIds || []).includes(r.id)) return false;
  if ((cr.includeIds || []).includes(r.id)) return true;
  const mots = cr.mots || [];
  if (!mots.length) return false;
  if (cr.lot && r.lot !== cr.lot) return false;
  if (cr.unite && normalizeUnite(r.unite) !== normalizeUnite(cr.unite)) return false;
  const d = foldTxt(r.designation);
  if ((cr.motsExclus || []).some(m => m && d.includes(foldTxt(m)))) return false;
  return mots.every(m => d.includes(foldTxt(m)));
}
function customRatioItems(cr, pool) {
  return (pool || ratioPool()).filter(r => customRatioMatches(cr, r));
}

function renderRatiosPerso() {
  const srch = foldTxt($('searchRatio').value || '');
  const flot = $('filterRatioLot').value;
  const pool = ratioPool();
  const list = (PREFS.customRatios || []).filter(cr =>
    (!flot || !cr.lot || cr.lot === flot) &&
    (!srch || foldTxt(cr.nom).includes(srch)));

  const rows = list.map(cr => {
    const c = { items: customRatioItems(cr, pool) };
    computeGroupStats(c, false);
    const unites = new Set(c.items.map(it => normalizeUnite(it.unite)));
    const mixed = unites.size > 1;
    const isExp = expandedRatios.has('P::' + cr.id);
    let html = `<tr class="ratio-row ${isExp ? 'expanded' : ''}" onclick="toggleRatio('P::${cr.id}',event)">
      <td><span class="expand-icon">▶</span></td>
      <td><strong>${esc(cr.nom)}</strong>
        ${(cr.mots && cr.mots.length) ? `<span style="font-size:9px;color:#888"> · mots : ${esc(cr.mots.join(', '))}</span>` : '<span style="font-size:9px;color:#888"> · manuel</span>'}
        ${mixed ? ' <span class="badge" style="background:#fdecea;color:#a93226" title="Ce ratio mélange plusieurs unités : la moyenne n\'a pas de sens. Fixez une unité.">⚠️ unités mélangées</span>' : ''}
      </td>
      <td>${cr.lot ? `<span class="badge" style="background:${lotColor(cr.lot)}22;color:${lotColor(cr.lot)}">${lotShort(cr.lot)}</span>` : '<span style="color:#888;font-size:10px">tous</span>'}</td>
      <td>${esc(cr.unite || [...unites].join('+') || '—')}</td>
      <td style="text-align:right"><strong>${c.cnt}</strong></td>
      <td style="text-align:right">${c.nbReperes}</td>
      <td style="text-align:right">${c.nbChantiers}</td>
      <td style="text-align:right">${c.cnt ? fmtPrix(c.min) : '—'}</td>
      <td style="text-align:right">${c.cnt ? fmtPrix(c.max) : '—'}</td>
      <td style="text-align:right;color:${mixed ? '#a93226' : '#085041'}"><strong>${c.cnt ? fmtPrix(c.moy) : '—'}</strong></td>
      <td style="text-align:right">${c.cnt ? fmtPrix(c.median) : '—'}</td>
      <td style="text-align:right">${c.cnt ? fmtPrix(c.dern) : '—'}</td>
      <td><button class="btn btn-bleu" style="padding:2px 7px;font-size:10px"
          onclick="event.stopPropagation();openCustomRatioEdit('${cr.id}')">✏️</button></td>
    </tr>`;
    if (isExp) html += groupDetailHtml(c, 13,
      mixed ? ' · <span style="color:#a93226">⚠️ unités mélangées, moyenne non significative</span>' : '');
    return html;
  }).join('');

  $('tblRatios').innerHTML =
    `<thead><tr>
      <th style="width:24px"></th>
      <th>Ratio</th><th>Lot</th><th>Unité</th>
      <th style="text-align:right">Nb prix</th>
      <th style="text-align:right">Repères</th>
      <th style="text-align:right">Chantiers</th>
      <th style="text-align:right">Min</th>
      <th style="text-align:right">Max</th>
      <th style="text-align:right">Moyenne</th>
      <th style="text-align:right">Médiane</th>
      <th style="text-align:right">Dernier</th>
      <th style="width:34px"></th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="13" style="text-align:center;color:#888;padding:24px">
      Aucun ratio personnalisé pour l'instant.<br><br>
      <button class="btn btn-vert" onclick="openCustomRatioEdit(-1)">+ Créer mon premier ratio</button>
    </td></tr>`}</tbody>`;
}

/* ── CRUD ratios personnalisés ──────────────────────────────── */

let crEditingId = null;
let crWorking = null; // copie de travail {includeIds, excludeIds}

function openCustomRatioEdit(id) {
  const cr = id !== -1 ? (PREFS.customRatios || []).find(x => x.id === id) : null;
  crEditingId = cr ? cr.id : null;
  crWorking = {
    includeIds: [...(cr && cr.includeIds || [])],
    excludeIds: [...(cr && cr.excludeIds || [])]
  };
  $('crTitle').textContent = cr ? '✏️ Modifier le ratio' : '+ Créer un ratio personnalisé';
  $('crNom').value = cr ? cr.nom : '';
  $('crLot').innerHTML = '<option value="">Tous les lots</option>' +
    LOTS.map(l => `<option ${cr && cr.lot === l ? 'selected' : ''}>${esc(l)}</option>`).join('');
  if (!cr) $('crLot').value = $('filterRatioLot').value || '';
  $('crUnite').value = cr ? (cr.unite || '') : '';
  $('crMots').value = cr ? (cr.mots || []).join(', ') : '';
  $('crMotsExclus').value = cr ? (cr.motsExclus || []).join(', ') : '';
  $('crAddSearch').value = '';
  $('crBtnDelete').style.display = cr ? '' : 'none';
  crRefreshPreview();
  crRefreshAddList();
  openModal('modalRatioEdit', 'crNom');
}

function crCurrentDef() {
  const parse = v => v.split(',').map(s => s.trim()).filter(Boolean);
  return {
    id: crEditingId || ('cr_' + Date.now().toString(36)),
    nom: $('crNom').value.trim(),
    lot: $('crLot').value,
    unite: $('crUnite').value,
    mots: parse($('crMots').value),
    motsExclus: parse($('crMotsExclus').value),
    includeIds: crWorking.includeIds,
    excludeIds: crWorking.excludeIds
  };
}

function crRefreshPreview() {
  const def = crCurrentDef();
  const items = customRatioItems(def, ratioPool()).slice(0, 200);
  $('crPreviewCount').textContent = `(${customRatioItems(def, ratioPool()).length} prix)`;
  $('crPreview').innerHTML = items.map(r => `
    <div style="display:grid;grid-template-columns:24px 90px 1fr 46px 90px;gap:6px;padding:3px 8px;border-bottom:1px dotted var(--bord);font-size:10px;align-items:center">
      <input type="checkbox" checked onchange="crToggleExclude('${r.id}', !this.checked)">
      <span style="color:#888">${esc(r.date) || '—'}</span>
      <span>${esc(r.designation)}</span>
      <span>${esc(r.unite)}</span>
      <span style="text-align:right;font-weight:700">${fmtPrix(r.prix)}</span>
    </div>`).join('') || '<div style="padding:10px;color:#888;font-size:11px;text-align:center">Aucune correspondance — ajustez les mots-clés ou ajoutez des prix à la main ci-dessous.</div>';
}

function crToggleExclude(id, exclude) {
  const inc = crWorking.includeIds.indexOf(id);
  if (exclude) {
    if (inc !== -1) crWorking.includeIds.splice(inc, 1);
    else if (!crWorking.excludeIds.includes(id)) crWorking.excludeIds.push(id);
  } else {
    const ex = crWorking.excludeIds.indexOf(id);
    if (ex !== -1) crWorking.excludeIds.splice(ex, 1);
  }
}

function crRefreshAddList() {
  const q = foldTxt($('crAddSearch').value || '');
  if (q.length < 2) { $('crAddList').innerHTML = '<div style="padding:6px;color:#aaa;font-size:10px">Tapez au moins 2 caractères…</div>'; return; }
  const def = crCurrentDef();
  const candidates = ratioPool()
    .filter(r => !customRatioMatches(def, r) &&
      (foldTxt(r.designation).includes(q) || foldTxt(r.repere).includes(q)))
    .slice(0, 20);
  $('crAddList').innerHTML = candidates.map(r => `
    <div style="display:grid;grid-template-columns:24px 90px 1fr 46px 90px;gap:6px;padding:3px 8px;border-bottom:1px dotted var(--bord);font-size:10px;align-items:center">
      <button class="btn btn-vert" style="padding:0 6px;font-size:11px" title="Ajouter ce prix au ratio"
        onclick="crAddManual('${r.id}')">+</button>
      <span style="color:#888">${esc(r.date) || '—'}</span>
      <span>${esc(r.designation)}</span>
      <span>${esc(r.unite)}</span>
      <span style="text-align:right;font-weight:700">${fmtPrix(r.prix)}</span>
    </div>`).join('') || '<div style="padding:6px;color:#aaa;font-size:10px">Rien trouvé (ou tout est déjà dans le ratio).</div>';
}

function crAddManual(id) {
  const ex = crWorking.excludeIds.indexOf(id);
  if (ex !== -1) crWorking.excludeIds.splice(ex, 1);
  if (!crWorking.includeIds.includes(id)) crWorking.includeIds.push(id);
  crRefreshPreview();
  crRefreshAddList();
}

function saveCustomRatio() {
  const def = crCurrentDef();
  if (!def.nom) { toast('Donnez un nom au ratio', 'rouge'); return; }
  if (!def.mots.length && !def.includeIds.length) {
    toast('Ajoutez des mots-clés ou au moins un prix à la main', 'rouge', 3500);
    return;
  }
  if (!PREFS.customRatios) PREFS.customRatios = [];
  const i = PREFS.customRatios.findIndex(x => x.id === def.id);
  if (i >= 0) PREFS.customRatios[i] = def;
  else PREFS.customRatios.push(def);
  localStorage.setItem('bp_prefs', JSON.stringify(PREFS));
  closeModal('modalRatioEdit');
  toast(`✅ Ratio « ${def.nom} » enregistré`, 'vert');
  renderRatios();
}

function deleteCustomRatio() {
  if (crEditingId === null) { closeModal('modalRatioEdit'); return; }
  const cr = (PREFS.customRatios || []).find(x => x.id === crEditingId);
  if (!confirm(`Supprimer le ratio « ${cr ? cr.nom : ''} » ?\n(Les prix de la base ne sont pas touchés.)`)) return;
  PREFS.customRatios = PREFS.customRatios.filter(x => x.id !== crEditingId);
  localStorage.setItem('bp_prefs', JSON.stringify(PREFS));
  closeModal('modalRatioEdit');
  renderRatios();
  toast('Ratio supprimé', 'orange');
}

/* ── « Tout déployer » selon la vue active ──────────────────── */
const _origExpandAllRatios = expandAllRatios;
expandAllRatios = function () {
  if (window.RATIO_VIEW === 'types') {
    expandedRatios = new Set(lastTypeClusterKeys);
    renderRatios();
    return;
  }
  if (window.RATIO_VIEW === 'perso') {
    expandedRatios = new Set((PREFS.customRatios || []).map(cr => 'P::' + cr.id));
    renderRatios();
    return;
  }
  _origExpandAllRatios();
};
