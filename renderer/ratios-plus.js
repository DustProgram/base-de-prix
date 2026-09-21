/* ============================================================
   ★ v2.6 ★ RATIOS PAR TYPE D'OUVRAGE
   Regroupe les prix dont les désignations sont similaires
   (Jaccard, même lot + même unité), même si les repères ou les
   chantiers diffèrent, et calcule les moyennes sur le groupe.
   Chargé après le script principal (portée globale partagée).
   ============================================================ */

window.RATIO_VIEW = 'repere';
const TYPE_SIM_THRESHOLD = 0.5;
let lastTypeClusterKeys = [];

function setRatioView(v) {
  window.RATIO_VIEW = v;
  const tg = $('ratioViewToggle');
  if (tg) tg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.rview === v));
  const t = $('ratiosTitle');
  if (t) t.textContent = v === 'types' ? '🧩 Ratios par type d\'ouvrage' : '📊 Ratios par repère interne';
  const h1 = $('ratiosHelpRepere'), h2 = $('ratiosHelpTypes');
  if (h1) h1.style.display = v === 'types' ? 'none' : '';
  if (h2) h2.style.display = v === 'types' ? '' : 'none';
  expandedRatios.clear();
  renderRatios();
}

/* Clustering glouton : chaque prix rejoint le premier groupe (même lot,
   même unité) dont la désignation représentative est assez similaire. */
function buildTypeClusters(items) {
  const clusters = [];
  const byGroup = {};
  for (const it of items) {
    const gkey = `${it.lot}||${(it.unite || 'u').toLowerCase()}`;
    if (!byGroup[gkey]) byGroup[gkey] = [];
    let placed = null;
    for (const c of byGroup[gkey]) {
      if (similarity(it.designation, c.repDesg) >= TYPE_SIM_THRESHOLD) { placed = c; break; }
    }
    if (!placed) {
      placed = { lot: it.lot, unite: it.unite || 'u', repDesg: it.designation, items: [] };
      byGroup[gkey].push(placed);
      clusters.push(placed);
    }
    placed.items.push(it);
    // La désignation la plus courte du groupe sert d'étiquette (souvent la plus générique)
    if (it.designation.length < placed.repDesg.length) placed.repDesg = it.designation;
  }
  clusters.forEach(c => {
    c.key = 'T::' + c.lot + '||' + c.unite.toLowerCase() + '||' +
      tokenize(c.repDesg).sort().slice(0, 6).join('-');
  });
  return clusters;
}

function renderRatiosTypes() {
  const srch = ($('searchRatio').value || '').toLowerCase();
  const flot = $('filterRatioLot').value;
  const items = BASE.filter(r =>
    (!flot || r.lot === flot) &&
    (!srch || (r.designation || '').toLowerCase().includes(srch) ||
              (r.repere || '').toLowerCase().includes(srch) ||
              (r.projet || '').toLowerCase().includes(srch)));

  const clusters = buildTypeClusters(items);

  clusters.forEach(c => {
    const inc = c.items.filter(it => !isPriceExcluded(it));
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
  });

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
      let html = `<tr class="ratio-row ${isExp ? 'expanded' : ''}" onclick="toggleRatio('${keyJs}',event)">
        <td><span class="expand-icon">▶</span></td>
        <td>${esc(c.repDesg)}</td>
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
      if (isExp) {
        const byDate = [...c.items].sort((a, b) =>
          (a.date || '').localeCompare(b.date || '') || (a.projet || '').localeCompare(b.projet || ''));
        html += `<tr class="ratio-detail-row"><td colspan="12">
          <div class="ratio-detail-inner">
            <table>
              <thead><tr>
                <th>Date</th><th>Chantier</th><th>Repère</th><th>Désignation</th>
                <th style="text-align:right">Prix HT</th>
                <th style="text-align:right">Écart vs moy.</th><th></th>
              </tr></thead>
              <tbody>${byDate.map(it => {
                const idx = BASE.indexOf(it);
                const excluded = isPriceExcluded(it);
                const ref = c.cnt ? c.moy : (c.items.reduce((s, x) => s + x.prix, 0) / c.items.length);
                const ecart = ref ? ((it.prix - ref) / ref * 100) : 0;
                const ecartC = Math.abs(ecart) > 50 ? '#a93226' : (Math.abs(ecart) > 20 ? '#b9770e' : '#085041');
                return `<tr style="${excluded ? 'opacity:.5' : ''}">
                  <td style="color:#888">${esc(it.date) || '—'}</td>
                  <td>${esc(it.projet) || '—'}</td>
                  <td><strong>${esc(it.repere)}</strong></td>
                  <td style="${excluded ? 'text-decoration:line-through' : ''}">${esc(it.designation)}</td>
                  <td style="text-align:right;font-weight:700;${excluded ? 'text-decoration:line-through' : ''}">${fmtPrix(it.prix)}</td>
                  <td style="text-align:right;color:${excluded ? '#999' : ecartC};font-weight:600">${ecart >= 0 ? '+' : ''}${ecart.toFixed(1)}%</td>
                  <td><button class="btn btn-bleu" style="padding:1px 5px;font-size:9px"
                      onclick="event.stopPropagation();openEdit(${idx})">✏️</button></td>
                </tr>`;
              }).join('')}</tbody>
            </table>
            <div style="margin-top:6px;font-size:10px;color:#666">
              📊 Moyenne du type : <strong style="color:#085041">${c.cnt ? fmtPrix(c.moy) : '—'}</strong>
              · basé sur ${c.cnt} prix, ${c.nbReperes} repère(s), ${c.nbChantiers} chantier(s)
              ${c.nbExcluded ? ` · <span style="color:#b9770e">${c.nbExcluded} prix exclu(s) du calcul (voir vue par repère)</span>` : ''}
            </div>
          </div>
        </td></tr>`;
      }
      return html;
    }).join('') || '<tr><td colspan="12" style="text-align:center;color:#888;padding:20px">Aucun prix</td></tr>'}</tbody>`;
}

// « Tout déployer » doit fonctionner aussi dans la vue par type
const _origExpandAllRatios = expandAllRatios;
expandAllRatios = function () {
  if (window.RATIO_VIEW === 'types') {
    expandedRatios = new Set(lastTypeClusterKeys);
    renderRatios();
    return;
  }
  _origExpandAllRatios();
};
