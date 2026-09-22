/* ============================================================
   ★ v2.6 ★ IMPORT IA — extraction de prix PDF/Excel via API Claude
   Chargé après le script principal : partage la portée globale
   (BASE, LOTS, PREFS, save, toast, XLSX, similarity, …).
   ============================================================ */

// File d'attente : {uid, name, kind:'pdf'|'excel', filePath?, base64?, status, error?, nb, cost}
let IA_QUEUE = [];
// Lignes extraites en attente de validation (persistées pour survivre à un redémarrage)
let IA_ROWS = [];
try { IA_ROWS = JSON.parse(localStorage.getItem('bp_ia_rows') || '[]'); } catch (e) { IA_ROWS = []; }
let IA_RUNNING = false;
let IA_PAUSED = false;
let iaRowsLimit = 300; // ★ v2.6.2 : pagination du tableau de validation
let IA_SESSION_COST = 0;
let iaUid = 0;

const IA_TXT_LIMIT = 400000; // caractères max envoyés pour un Excel converti en texte

function iaSaveRows() {
  try { localStorage.setItem('bp_ia_rows', JSON.stringify(IA_ROWS)); } catch (e) {}
  const el = $('sbCntIA'); if (el) el.textContent = IA_ROWS.length || '';
}

function openExternalUrl(url) {
  if (isElectron && window.electronAPI.openUrl) window.electronAPI.openUrl(url);
  else window.open(url, '_blank');
}

/* ── Paramètres : clé API ── */
async function saveApiKey() {
  const v = $('prefApiKey').value.trim();
  if (!v) { toast('Saisissez une clé API', 'orange'); return; }
  const r = await window.electronAPI.secretSet('anthropic_api_key', v);
  if (r && r.success) {
    $('prefApiKey').value = '';
    toast('✅ Clé API enregistrée (chiffrée)', 'vert');
    iaRefreshKeyStatus();
  } else toast('Erreur : ' + (r && r.error || '?'), 'rouge');
}
async function deleteApiKey() {
  await window.electronAPI.secretSet('anthropic_api_key', '');
  toast('Clé API supprimée', 'orange');
  iaRefreshKeyStatus();
}
async function iaRefreshKeyStatus() {
  if (!isElectron) return;
  const has = await window.electronAPI.secretHas('anthropic_api_key');
  const st = $('iaKeyStatus');
  if (st) st.innerHTML = has
    ? '<span style="color:#085041">— ✅ une clé est enregistrée</span>'
    : '<span style="color:#a93226">— aucune clé</span>';
  const warn = $('iaKeyWarning');
  if (warn) warn.style.display = has ? 'none' : 'block';
  return has;
}

/* ── Ajout de fichiers ── */
async function iaChooseFiles() {
  if (!isElectron) { toast('Disponible uniquement dans l\'app Electron', 'rouge'); return; }
  const paths = await window.electronAPI.openFiles([
    { name: 'Documents (PDF, Excel)', extensions: ['pdf', 'xlsx', 'xlsm', 'xls', 'csv'] }
  ]);
  if (!paths || !paths.length) return;
  paths.forEach(p => {
    const name = p.split(/[\\\/]/).pop();
    IA_QUEUE.push({ uid: ++iaUid, name, filePath: p,
      kind: /\.pdf$/i.test(name) ? 'pdf' : 'excel', status: 'attente', nb: 0, cost: 0 });
  });
  renderImportIA();
  iaProcessQueue();
}

// Fichiers glissés-déposés (pas de chemin disque : contenu lu côté renderer)
function iaAddDroppedFiles(files) {
  showPage('importia');
  files.forEach(f => {
    const reader = new FileReader();
    const entry = { uid: ++iaUid, name: f.name,
      kind: /\.pdf$/i.test(f.name) ? 'pdf' : 'excel', status: 'lecture', nb: 0, cost: 0 };
    IA_QUEUE.push(entry);
    reader.onload = ev => {
      const arr = new Uint8Array(ev.target.result);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < arr.length; i += chunk) {
        bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
      }
      entry.base64 = btoa(bin);
      entry.status = 'attente';
      renderImportIA();
      iaProcessQueue();
    };
    reader.onerror = () => { entry.status = 'erreur'; entry.error = 'Lecture impossible'; renderImportIA(); };
    reader.readAsArrayBuffer(f);
  });
  renderImportIA();
}

function iaClearQueue() {
  IA_QUEUE = IA_QUEUE.filter(q => q.status === 'analyse');
  renderImportIA();
}

function iaTogglePause() {
  IA_PAUSED = !IA_PAUSED;
  const b = $('iaBtnPause');
  if (b) b.textContent = IA_PAUSED ? '▶ Reprendre' : '⏸ Mettre en pause';
  toast(IA_PAUSED ? '⏸ File en pause (le fichier en cours se termine)' : '▶ Reprise', 'bleu', 2000);
  if (!IA_PAUSED) iaProcessQueue();
}

/* ── Conversion Excel → texte (toutes les feuilles en CSV) ── */
function iaExcelToText(base64) {
  const wb = XLSX.read(base64, { type: 'base64' });
  let out = '';
  let truncated = false;
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (!csv.trim()) continue;
    const section = `--- Feuille : ${name} ---\n${csv}\n\n`;
    if (out.length + section.length > IA_TXT_LIMIT) { truncated = true; break; }
    out += section;
  }
  return { text: out, truncated };
}

/* ── Traitement séquentiel de la file ── */
async function iaProcessQueue() {
  if (IA_RUNNING || IA_PAUSED) return;
  const hasKey = await iaRefreshKeyStatus();
  if (!hasKey) return;
  const next = IA_QUEUE.find(q => q.status === 'attente');
  if (!next) { const b = $('iaBtnPause'); if (b) b.style.display = 'none'; return; }
  const bp = $('iaBtnPause'); if (bp) bp.style.display = '';

  IA_RUNNING = true;
  next.status = 'analyse';
  renderImportIA();

  try {
    const payload = { filename: next.name, lots: LOTS, hints: {} };
    if (next.kind === 'pdf') {
      payload.kind = 'pdf';
      if (next.filePath) payload.filePath = next.filePath;
      else payload.base64 = next.base64;
    } else {
      payload.kind = 'text';
      let b64 = next.base64;
      if (!b64 && next.filePath) b64 = await window.electronAPI.readFile(next.filePath);
      if (!b64) throw new Error('Fichier illisible');
      const conv = iaExcelToText(b64);
      if (!conv.text.trim()) throw new Error('Aucun contenu détecté dans ce fichier Excel');
      if (conv.truncated) next.warn = 'Fichier volumineux : contenu tronqué';
      payload.text = conv.text;
    }

    const res = await window.electronAPI.iaExtract(payload);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur inconnue');

    const doc = res.data;
    const added = (doc.lignes || []).map(l => iaMapLigne(l, doc, next.name)).filter(Boolean);
    IA_ROWS.push(...added);
    iaSaveRows();

    next.status = 'ok';
    next.nb = added.length;
    next.cost = res.costUSD || 0;
    next.warnings = doc.avertissements || [];
    IA_SESSION_COST += next.cost;
  } catch (e) {
    next.status = 'erreur';
    next.error = e.message;
  }

  IA_RUNNING = false;
  renderImportIA();
  setTimeout(iaProcessQueue, 400); // enchaîner (léger répit pour l'UI)
}

/* ── Mapping d'une ligne extraite vers le schéma de la base ── */
function iaFold(s) {
  // minuscules + suppression des accents pour comparer "Étanchéité" et "Etancheite"
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function iaNormalizeLot(lot) {
  if (!lot) return null;
  const exact = LOTS.find(l => l === lot);
  if (exact) return exact;
  const num = String(lot).match(/^\s*(\d{1,2})/);
  if (num) {
    const byNum = LOTS.find(l => l.startsWith(num[1].padStart(2, '0')) || l.startsWith(num[1] + ' '));
    if (byNum) return byNum;
  }
  const low = iaFold(lot);
  const byName = LOTS.find(l => low.includes(iaFold(l.split(' - ').pop())) ||
                                iaFold(l).includes(low));
  return byName || null;
}

// Suggère un repère existant de la base par similarité de désignation (même lot si possible)
function iaSuggestRepere(designation, lot, unite) {
  let best = null, bestScore = 0;
  const seen = new Set();
  for (const r of BASE) {
    if (seen.has(r.repere)) continue;
    seen.add(r.repere);
    if (unite && r.unite && r.unite !== unite) continue;
    let s = similarity(designation, r.designation);
    if (r.lot === lot) s += 0.08; // léger bonus même lot
    if (s > bestScore) { bestScore = s; best = r.repere; }
  }
  return bestScore >= 0.45 ? { repere: best, score: bestScore } : null;
}

let iaSeq = parseInt(localStorage.getItem('bp_ia_seq') || '0', 10);
function iaNewRepere(lot) {
  iaSeq++;
  localStorage.setItem('bp_ia_seq', String(iaSeq));
  return `IA-${lotShort(lot)}-${String(iaSeq).padStart(3, '0')}`;
}

function iaMapLigne(l, doc, filename) {
  const designation = String(l.designation || '').trim();
  const prix = parseFloat(l.prix);
  if (!designation || !prix || prix <= 0) return null;
  const lot = iaNormalizeLot(l.lot) || LOTS[0];
  let repere = String(l.repere || '').trim();
  let repereSuggere = false;
  if (!repere) {
    const sug = iaSuggestRepere(designation, lot, l.unite);
    if (sug) { repere = sug.repere; repereSuggere = true; }
    else repere = iaNewRepere(lot);
  }
  return {
    uid: 'r' + (++iaUid) + '_' + Date.now().toString(36),
    include: true,
    repere, repereSuggere,
    lot,
    designation,
    unite: String(l.unite || 'u').trim() || 'u',
    prix: Math.round(prix * 100) / 100,
    quantite: (l.quantite === null || l.quantite === undefined) ? null : parseFloat(l.quantite),
    date: (l.date || doc.date_document || '').slice(0, 10),
    projet: (doc.projet || '').trim() || filename.replace(/\.(pdf|xlsx?|xlsm|csv)$/i, ''),
    source: filename,
    confiance: l.confiance || 'moyenne'
  };
}

/* ── Type de prix appliqué à l'import (débours par défaut : les offres
      de chantier / devis sous-traitants sont des coûts, pas des prix client) ── */
function iaCurrentType() { return PREFS.iaTypePrix || 'debours'; }
function iaSetType(v) {
  PREFS.iaTypePrix = v;
  localStorage.setItem('bp_prefs', JSON.stringify(PREFS));
  renderImportIA();
}

/* ── Drapeaux qualité (comparaison au sein du même type de prix) ── */
/* ★ v2.6.2 perf — index pré-calculés en un passage sur BASE, au lieu d'un
   parcours complet de la base PAR LIGNE extraite à chaque rendu. */
function iaBuildFlagIndexes() {
  const t = iaCurrentType();
  const dupSet = new Set();
  const ranges = new Map();
  for (const r of BASE) {
    if (normTypePrix(r) !== t) continue;
    dupSet.add(`${r.repere}||${r.date || ''}||${r.projet || ''}||${(r.prix || 0).toFixed(2)}`);
    let g = ranges.get(r.repere);
    if (!g) { g = { count: 0, min: Infinity, max: -Infinity }; ranges.set(r.repere, g); }
    g.count++;
    if (r.prix < g.min) g.min = r.prix;
    if (r.prix > g.max) g.max = r.prix;
  }
  return {
    isDup: row => dupSet.has(`${row.repere}||${row.date || ''}||${row.projet || ''}||${row.prix.toFixed(2)}`),
    isAnom: row => {
      const g = ranges.get(row.repere);
      return !!g && g.count >= 3 && (row.prix < g.min * 0.5 || row.prix > g.max * 2);
    }
  };
}
// Versions unitaires (mêmes règles), utilisées hors rendu
function iaIsDoublon(row) { return iaBuildFlagIndexes().isDup(row); }
function iaIsAnomalie(row) { return iaBuildFlagIndexes().isAnom(row); }

/* ── Rendu ── */
function renderImportIA() {
  iaRefreshKeyStatus();
  const ts = $('iaTypeSel');
  if (ts) ts.value = iaCurrentType();

  // File d'attente
  const wrap = $('iaQueueWrap');
  if (wrap) {
    wrap.style.display = IA_QUEUE.length ? '' : 'none';
    const badge = s => ({
      lecture: '<span class="badge" style="background:#eee;color:#666">⏳ lecture…</span>',
      attente: '<span class="badge" style="background:#eee;color:#666">⏳ en attente</span>',
      analyse: '<span class="badge" style="background:#dbeeff;color:#1e3a5f">🤖 analyse en cours…</span>',
      ok:      '<span class="badge" style="background:#d5f5e3;color:#085041">✅ terminé</span>',
      erreur:  '<span class="badge" style="background:#fdecea;color:#a93226">❌ erreur</span>'
    }[s] || s);
    $('tblIaQueue').innerHTML =
      `<thead><tr><th>Fichier</th><th>Type</th><th>Statut</th>
        <th style="text-align:right">Lignes</th><th style="text-align:right">Coût est.</th><th>Détail</th></tr></thead>
       <tbody>${IA_QUEUE.map(q => `<tr>
        <td><strong>${esc(q.name)}</strong></td>
        <td>${q.kind === 'pdf' ? '📄 PDF' : '📊 Excel'}</td>
        <td>${badge(q.status)}</td>
        <td style="text-align:right">${q.status === 'ok' ? q.nb : '—'}</td>
        <td style="text-align:right">${q.cost ? '$' + q.cost.toFixed(3) : '—'}</td>
        <td style="font-size:10px;color:${q.status === 'erreur' ? '#a93226' : '#888'}">${
          esc(q.error || q.warn || (q.warnings && q.warnings.length ? '⚠️ ' + q.warnings.join(' · ') : ''))
        }</td>
      </tr>`).join('')}</tbody>`;
  }
  const tc = $('iaTotalCost');
  if (tc) tc.textContent = IA_SESSION_COST > 0 ? `Coût cumulé de la session : ~$${IA_SESSION_COST.toFixed(2)}` : '';

  // Tableau de validation
  const card = $('iaResultCard');
  if (!card) return;
  card.style.display = IA_ROWS.length ? '' : 'none';
  iaSaveRows();
  if (!IA_ROWS.length) return;

  const nbCoches = IA_ROWS.filter(r => r.include).length;
  $('iaRowsCount').textContent = `(${IA_ROWS.length} lignes, ${nbCoches} cochées)`;

  // ★ v2.6.2 perf — index doublons/anomalies construits UNE fois par rendu,
  // et affichage paginé par tranches de 300 lignes
  const flags = iaBuildFlagIndexes();
  const shown = IA_ROWS.slice(0, iaRowsLimit);
  const moreHtml = IA_ROWS.length > shown.length
    ? `<tr><td colspan="11" style="text-align:center;padding:10px">
         <button class="btn btn-gris" onclick="iaRowsLimit+=1000;renderImportIA()">⬇ Afficher 1000 de plus (${IA_ROWS.length - shown.length} restantes)</button>
         <button class="btn btn-gris" onclick="iaRowsLimit=Infinity;renderImportIA()">Tout afficher</button>
       </td></tr>`
    : '';

  $('tblIaRows').innerHTML =
    `<thead><tr>
      <th style="width:30px;text-align:center">☑</th>
      <th>Repère</th><th>Lot</th><th>Désignation</th><th>Unité</th>
      <th style="text-align:right">Prix HT</th><th>Date</th><th>Chantier</th>
      <th>Source</th><th style="width:60px">Alertes</th><th style="width:30px"></th>
    </tr></thead>
    <tbody>${shown.map((r, i) => {
      const doublon = flags.isDup(r);
      const anomalie = flags.isAnom(r);
      const basse = r.confiance === 'basse';
      const alerts = [
        anomalie ? '<span title="Prix très éloigné de l\'historique de ce repère">⚠️</span>' : '',
        doublon ? '<span title="Déjà présent dans la base (même repère/date/chantier/prix)">♻️</span>' : '',
        basse ? '<span title="Confiance faible de l\'IA sur cette ligne">🔻</span>' : ''
      ].join(' ');
      const bg = doublon ? 'background:rgba(230,126,34,.07)' : (anomalie ? 'background:rgba(241,196,15,.08)' : '');
      return `<tr style="${bg}">
        <td style="text-align:center"><input type="checkbox" ${r.include ? 'checked' : ''}
            onchange="IA_ROWS[${i}].include=this.checked;renderImportIA()"></td>
        <td class="ia-edit" data-i="${i}" data-f="repere"><strong>${esc(r.repere)}</strong>${r.repereSuggere ? ' <span title="Repère proposé par similarité avec votre base" style="color:#8e44ad">~</span>' : ''}</td>
        <td class="ia-edit" data-i="${i}" data-f="lot"><span class="badge" style="background:${lotColor(r.lot)}22;color:${lotColor(r.lot)}">${lotShort(r.lot)}</span></td>
        <td class="ia-edit" data-i="${i}" data-f="designation">${esc(r.designation)}</td>
        <td class="ia-edit" data-i="${i}" data-f="unite">${esc(r.unite)}</td>
        <td class="ia-edit" data-i="${i}" data-f="prix" style="text-align:right"><strong>${fmtPrix(r.prix)}</strong></td>
        <td class="ia-edit" data-i="${i}" data-f="date" style="font-size:10px;color:#888">${esc(r.date) || '—'}</td>
        <td class="ia-edit" data-i="${i}" data-f="projet" style="font-size:10px">${esc(r.projet) || '—'}</td>
        <td style="font-size:9px;color:#999">${esc(r.source)}</td>
        <td style="text-align:center">${alerts}</td>
        <td><button class="btn btn-rouge" style="padding:1px 6px;font-size:10px"
            onclick="IA_ROWS.splice(${i},1);renderImportIA()">🗑</button></td>
      </tr>`;
    }).join('') + moreHtml}</tbody>`;
}

// ★ v2.6.2 perf — édition par double-clic : un seul écouteur délégué
document.addEventListener('DOMContentLoaded', () => {
  const t = $('tblIaRows');
  if (t) t.addEventListener('dblclick', e => {
    const td = e.target.closest('td.ia-edit');
    if (td) iaEditCell(td);
  });
});

function iaEditCell(td) {
  const i = parseInt(td.dataset.i, 10), f = td.dataset.f;
  const row = IA_ROWS[i];
  if (!row || td.querySelector('input,select')) return;
  let el;
  if (f === 'lot') {
    el = document.createElement('select');
    el.innerHTML = LOTS.map(l => `<option ${l === row.lot ? 'selected' : ''}>${esc(l)}</option>`).join('');
  } else {
    el = document.createElement('input');
    el.type = (f === 'prix') ? 'number' : (f === 'date' ? 'date' : 'text');
    if (f === 'prix') el.step = '0.01';
    el.value = row[f] != null ? row[f] : '';
  }
  el.style.cssText = 'width:100%;font-size:11px;padding:2px 4px';
  td.innerHTML = '';
  td.appendChild(el);
  el.focus();
  if (el.select) try { el.select(); } catch (e) {}
  const commit = () => {
    let v = el.value;
    if (f === 'prix') {
      v = parseFloat(String(v).replace(',', '.'));
      if (!v || v <= 0) { renderImportIA(); return; }
      v = Math.round(v * 100) / 100;
    } else v = String(v).trim();
    if (f === 'repere') row.repereSuggere = false;
    row[f] = v;
    renderImportIA();
  };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.removeEventListener('blur', commit); renderImportIA(); }
  });
}

function iaCheckAll(v) { IA_ROWS.forEach(r => r.include = v); renderImportIA(); }
function iaUncheckDoublons() {
  let n = 0;
  const flags = iaBuildFlagIndexes(); // index construit une seule fois
  IA_ROWS.forEach(r => { if (r.include && flags.isDup(r)) { r.include = false; n++; } });
  renderImportIA();
  toast(n ? `♻️ ${n} doublon(s) décoché(s)` : 'Aucun doublon détecté', n ? 'orange' : 'vert', 2500);
}
function iaClearRows() {
  if (!confirm(`Effacer les ${IA_ROWS.length} lignes extraites (non importées) ?`)) return;
  IA_ROWS = [];
  renderImportIA();
}

/* ── Import final dans la base ── */
async function iaValiderImport() {
  const rows = IA_ROWS.filter(r => r.include);
  if (!rows.length) { toast('Aucune ligne cochée', 'orange'); return; }
  const invalid = rows.filter(r => !r.repere || !r.designation || !r.lot || !r.prix);
  if (invalid.length) {
    toast(`${invalid.length} ligne(s) cochée(s) incomplète(s) (repère/lot/désignation/prix requis)`, 'rouge', 4000);
    return;
  }
  await snapshotIfImportant('Avant import IA');
  pushUndo(`Import IA (${rows.length} prix)`);
  const typeSel = iaCurrentType();
  rows.forEach(r => {
    const obj = {
      id: genId(),
      repere: r.repere, lot: r.lot, designation: r.designation,
      unite: r.unite, prix: r.prix, date: r.date, projet: r.projet,
      source: r.source
    };
    if (typeSel !== 'nc') obj.typePrix = typeSel;
    BASE.push(obj);
  });
  IA_ROWS = IA_ROWS.filter(r => !r.include);
  save();
  iaSaveRows();
  initUI(); renderBase(); renderAccueil(); renderImportIA();
  toast(`✅ ${rows.length} prix importés dans la base`, 'vert', 3500);
}

// Badge au démarrage
document.addEventListener('DOMContentLoaded', () => {
  const el = $('sbCntIA'); if (el) el.textContent = IA_ROWS.length || '';
});
