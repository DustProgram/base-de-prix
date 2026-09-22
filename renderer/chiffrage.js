/* ============================================================
   ★ v2.7 ★ CHIFFRAGE RAPIDE IA DE LA DPGF
   Pour chaque ligne DPGF non chiffrée, on présélectionne côté app les
   meilleurs candidats de la base (similarité), puis l'IA (fournisseur
   choisi dans Paramètres) propose un prix + la MÉTHODE + l'HYPOTHÈSE
   (ex : proratisation au m² d'une porte 147×90 depuis des portes
   200×90 / 150×90). Rien n'entre sans hypothèse vérifiable.
   Chargé après le script principal (portée globale partagée).
   ============================================================ */

const CH_BATCH_SIZE = 30;     // lignes DPGF par appel API
const CH_CANDIDATES = 8;      // candidats de la base par ligne
let chRunning = false;
let chCancelled = false;
let CH_REPORT = null;         // dernier rapport { date, provider, lignes:[], cout, resume }

/* ── Candidats : regroupe la base par repère puis prend les plus proches ── */
function chBuildDigest() {
  const grouped = {};
  dpgfPool().forEach(r => {
    let g = grouped[r.repere];
    if (!g) g = grouped[r.repere] = { rep: r.repere, desg: r.designation, unite: r.unite, prix: [], last: r };
    if (!isPriceExcluded(r)) g.prix.push(r.prix);
    if ((r.date || '') >= (g.last.date || '')) { g.last = r; g.desg = r.designation; g.unite = r.unite; }
  });
  return Object.values(grouped).map(g => {
    const prix = g.prix.length ? g.prix : [g.last.prix];
    const moy = prix.reduce((a, b) => a + b, 0) / prix.length;
    return {
      rep: g.rep,
      desg: String(g.desg || '').slice(0, 110),
      unite: g.unite || 'u',
      moy: Math.round(moy * 100) / 100,
      min: Math.round(Math.min(...prix) * 100) / 100,
      max: Math.round(Math.max(...prix) * 100) / 100,
      dern: Math.round(prix[prix.length - 1] * 100) / 100,
      cnt: prix.length,
      _tokens: new Set(tokenize(g.desg))
    };
  });
}

function chCandidatesFor(descriptif, digest) {
  const dt = new Set(tokenize(descriptif));
  if (!dt.size) return [];
  const scored = [];
  for (const d of digest) {
    if (!d._tokens.size) continue;
    let inter = 0;
    dt.forEach(t => { if (d._tokens.has(t)) inter++; });
    if (!inter) continue;
    scored.push({ d, score: inter / (dt.size + d._tokens.size - inter) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, CH_CANDIDATES).map(x => {
    const { _tokens, ...clean } = x.d;
    return clean;
  });
}

/* ── UI ── */
function openChiffrageIA() {
  if (!isElectron) { toast('Disponible uniquement dans l\'app Electron', 'rouge'); return; }
  if (!DPGF.length) { toast('Chargez d\'abord une DPGF', 'rouge'); return; }
  if (!BASE.length) { toast('La base de prix est vide — rien pour chiffrer', 'rouge'); return; }
  const vides = DPGF.filter(r => !(r.prix > 0)).length;
  $('chiffrageInfo').innerHTML =
    `<strong>${DPGF.length} lignes DPGF</strong> · ${vides} sans prix ·
     fournisseur : <strong>${IA_PROVIDERS[iaProvider()].label}</strong> ·
     base consultée : ${dpgfPool().length} prix.
     <br><span style="font-size:10px;color:#666">Coût indicatif : ~0,01 à 0,05 $ par lot de ${CH_BATCH_SIZE} lignes selon le fournisseur.</span>`;
  $('chiffrageTypeLbl').textContent =
    PREFS.dpgfTypeFilter === 'vente' ? 'prix de vente' :
    PREFS.dpgfTypeFilter === 'debours' ? 'prix débours' : 'tous les prix';
  $('chiffrageProgress').style.display = 'none';
  $('btnChiffGo').disabled = false;
  $('btnChiffGo').textContent = '⚡ Lancer le chiffrage';
  openModal('modalChiffrage');
}

function cancelChiffrage() {
  if (chRunning) {
    chCancelled = true;
    toast('⏸ Arrêt demandé — le lot en cours se termine', 'orange', 2500);
  } else {
    closeModal('modalChiffrage');
  }
}

async function startChiffrage() {
  if (chRunning) return;
  const hasKey = await iaRefreshKeyStatus();
  if (!hasKey) {
    toast(`Aucune clé API ${IA_PROVIDERS[iaProvider()].label} — Paramètres → 🤖 IA`, 'rouge', 4000);
    return;
  }
  const scope = document.querySelector('input[name="chiffScope"]:checked').value;
  const targets = [];
  DPGF.forEach((r, i) => {
    if (scope === 'toutes' || !(r.prix > 0)) targets.push(i);
  });
  if (!targets.length) { toast('Aucune ligne à chiffrer dans cette portée', 'orange'); return; }

  chRunning = true;
  chCancelled = false;
  $('btnChiffGo').disabled = true;
  $('btnChiffGo').textContent = '⏳ Chiffrage en cours…';
  $('chiffrageProgress').style.display = '';

  const digest = chBuildDigest();
  const provider = iaProvider();
  const projet = (DPGF[0] && DPGF[0].sheet) || '';
  const report = { date: new Date().toLocaleString('fr-FR'), provider: IA_PROVIDERS[provider].label, lignes: [], cout: 0, erreurs: [] };
  let done = 0;

  for (let b = 0; b < targets.length; b += CH_BATCH_SIZE) {
    if (chCancelled) break;
    const batchIdx = targets.slice(b, b + CH_BATCH_SIZE);
    const lignes = batchIdx.map(i => ({
      index: i,
      descriptif: String(DPGF[i].descriptif || '').slice(0, 220),
      unite: DPGF[i].unite || '',
      qte: DPGF[i].qte || 0,
      candidats: chCandidatesFor(DPGF[i].descriptif, digest)
    }));

    const res = await window.electronAPI.iaChiffrage({ provider, lignes, projet });
    if (!res || !res.ok) {
      report.erreurs.push(res && res.error || 'Erreur inconnue');
      // Erreur de quota/clé : inutile d'enchaîner les lots
      if (res && /clé|limite de débit/i.test(res.error || '')) { toast('❌ ' + res.error, 'rouge', 5000); break; }
    } else {
      report.cout += res.costUSD || 0;
      for (const l of res.data.lignes || []) {
        const i = l.index;
        if (!DPGF[i]) continue;
        if (l.prix !== null && l.prix > 0 && l.methode !== 'non_chiffrable') {
          DPGF[i].prix = Math.round(l.prix * 100) / 100;
          DPGF[i].total = DPGF[i].prix * (DPGF[i].qte || 1);
          DPGF[i].mode = 'exact';
          DPGF[i].ia = { methode: l.methode, hypothese: l.hypothese, repere: l.repere_source, confiance: l.confiance };
          if (l.repere_source && !DPGF[i].repere) DPGF[i].repere = l.repere_source.split(',')[0].trim();
        }
        report.lignes.push({
          descriptif: DPGF[i].descriptif, unite: DPGF[i].unite, qte: DPGF[i].qte,
          prix: (l.prix !== null && l.methode !== 'non_chiffrable') ? l.prix : null,
          methode: l.methode, repere: l.repere_source, hypothese: l.hypothese, confiance: l.confiance
        });
      }
    }
    done += batchIdx.length;
    const pct = Math.round(done / targets.length * 100);
    $('chiffrageProgTxt').textContent = `${done} / ${targets.length} lignes traitées · coût ~$${report.cout.toFixed(2)}`;
    $('chiffrageProgBar').style.width = pct + '%';
  }

  chRunning = false;
  CH_REPORT = report;
  closeModal('modalChiffrage');
  dpgfRenderLimit = Math.max(dpgfRenderLimit, DPGF_PAGE_SIZE);
  renderDPGF();
  $('btnRapportIA').style.display = '';
  renderRapportIA();
  const nbOk = report.lignes.filter(l => l.prix !== null).length;
  const nbNo = report.lignes.filter(l => l.prix === null).length;
  toast(`⚡ Chiffrage ${chCancelled ? 'interrompu' : 'terminé'} : ${nbOk} lignes chiffrées, ${nbNo} non chiffrables · ~$${report.cout.toFixed(2)}`,
    chCancelled ? 'orange' : 'vert', 5000);
  openModal('modalRapportIA');
}

/* ── Rapport ── */
const CH_METHODE_LBL = {
  repere_exact: ['🎯 Repère exact', '#085041'],
  moyenne_ratio: ['📊 Moyenne/ratio', '#2980b9'],
  proratisation_dimensionnelle: ['📐 Proratisation dimensions', '#8e44ad'],
  extrapolation: ['🔮 Extrapolation', '#b9770e'],
  non_chiffrable: ['❌ Non chiffrable', '#a93226']
};

function renderRapportIA() {
  if (!CH_REPORT) return;
  const r = CH_REPORT;
  const parMethode = {};
  r.lignes.forEach(l => { parMethode[l.methode] = (parMethode[l.methode] || 0) + 1; });
  $('rapportIaResume').innerHTML =
    `<strong>${r.lignes.length} lignes traitées</strong> le ${r.date} par ${esc(r.provider)} · coût ~$${r.cout.toFixed(2)}<br>` +
    Object.entries(parMethode).map(([m, n]) => {
      const [lbl, col] = CH_METHODE_LBL[m] || [m, '#888'];
      return `<span class="badge" style="background:${col}22;color:${col};margin-right:4px">${lbl} : ${n}</span>`;
    }).join('') +
    (r.erreurs.length ? `<br><span style="color:#a93226;font-size:10px">⚠️ ${r.erreurs.length} lot(s) en erreur : ${esc(r.erreurs[0])}</span>` : '') +
    `<br><span style="font-size:10px;color:#666">⚠️ Chiffrage indicatif à RELIRE : chaque hypothèse doit être validée par vos soins avant remise d'offre.</span>`;

  $('rapportIaBody').innerHTML = r.lignes.map(l => {
    const [lbl, col] = CH_METHODE_LBL[l.methode] || [l.methode, '#888'];
    const conf = l.confiance === 'haute' ? '🟢' : l.confiance === 'moyenne' ? '🟡' : '🔴';
    return `<div style="padding:7px 10px;border-bottom:1px solid var(--bord);font-size:11px">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
        <strong style="flex:1;min-width:200px">${esc(l.descriptif)}</strong>
        <span class="badge" style="background:${col}22;color:${col}">${lbl}</span>
        <span title="Confiance ${esc(l.confiance)}">${conf}</span>
        <strong style="color:${l.prix !== null ? '#085041' : '#a93226'}">${l.prix !== null ? fmtPrix(l.prix) + (l.unite ? ' / ' + esc(l.unite) : '') : 'non chiffré'}</strong>
      </div>
      <div style="color:#666;margin-top:2px">
        ${l.repere ? `<span style="font-family:Consolas,monospace;color:#8e44ad">[${esc(l.repere)}]</span> ` : ''}
        ${esc(l.hypothese)}
      </div>
    </div>`;
  }).join('') || '<div style="padding:14px;color:#888;text-align:center">Aucune ligne</div>';
}

function copierRapportIA() {
  if (!CH_REPORT) return;
  const r = CH_REPORT;
  const txt = [`RAPPORT DE CHIFFRAGE IA — ${r.date} — ${r.provider} — coût ~$${r.cout.toFixed(2)}`, '']
    .concat(r.lignes.map(l =>
      `• ${l.descriptif}\n  → ${l.prix !== null ? l.prix.toFixed(2) + ' € HT' + (l.unite ? '/' + l.unite : '') : 'NON CHIFFRÉ'} | ${l.methode} | confiance ${l.confiance}${l.repere ? ' | base: ' + l.repere : ''}\n  Hypothèse : ${l.hypothese}`
    )).join('\n\n');
  navigator.clipboard.writeText(txt)
    .then(() => toast('📋 Rapport copié dans le presse-papiers', 'vert'))
    .catch(() => toast('Copie impossible', 'rouge'));
}
