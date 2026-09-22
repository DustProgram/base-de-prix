/* ============================================================
   ★ v2.6 ★ GOOGLE SHEETS — liaison collaborative
   La feuille est la base maître partagée. Sync LIGNE À LIGNE
   (append / update / delete par ID stable), fusion à 3 sources :
   local / feuille / "ombre" (état connu à la dernière sync).
   Chargé après le script principal (portée globale partagée).
   ============================================================ */

const GS_HEADER = ['ID', 'Repère', 'Lot', 'Désignation', 'Unité', 'Prix HT', 'Date', 'Chantier', 'Source', 'Auteur', 'Modifié le', 'Type'];
const GS_SHEET_TITLE = 'BASE_PRIX';

let GS = null;            // { spreadsheetId, url, sheetId, spreadsheetTitle }
try { GS = JSON.parse(localStorage.getItem('bp_gsheet') || 'null'); } catch (e) { GS = null; }
let GS_EMAIL = '';
let gsSyncInProgress = false;
let gsDebounce = null;
let gsOffline = false;
let gsLastError = '';
let gsLastSync = 0;
let gsPollTimer = null;

function gsLoadShadow() {
  try { return JSON.parse(localStorage.getItem('bp_gs_shadow') || '{}'); } catch (e) { return {}; }
}
function gsSaveShadow(s) {
  try { localStorage.setItem('bp_gs_shadow', JSON.stringify(s)); } catch (e) {}
}

function gsSig(r) {
  return JSON.stringify([r.repere || '', r.lot || '', r.designation || '', r.unite || '',
    Math.round((r.prix || 0) * 100) / 100, r.date || '', r.projet || '', normTypePrix(r)]);
}
function gsRowToValues(r) {
  const t = normTypePrix(r);
  return [r.id, r.repere || '', r.lot || '', r.designation || '', r.unite || '',
    Math.round((r.prix || 0) * 100) / 100, r.date || '', r.projet || '', r.source || '',
    GS_EMAIL || '', new Date().toISOString().slice(0, 19).replace('T', ' '),
    t === 'nc' ? '' : t];
}
function gsValuesToRow(v) {
  const row = {
    id: String(v[0] || ''),
    repere: String(v[1] ?? '').trim(),
    lot: String(v[2] ?? '').trim(),
    designation: String(v[3] ?? '').trim(),
    unite: String(v[4] ?? 'u').trim() || 'u',
    prix: (typeof v[5] === 'number') ? v[5] : (parseFloat(String(v[5] ?? '').replace(/\s/g, '').replace(',', '.')) || 0),
    date: String(v[6] ?? '').trim(),
    projet: String(v[7] ?? '').trim(),
    source: String(v[8] ?? '').trim()
  };
  const t = String(v[11] ?? '').trim().toLowerCase();
  if (t === 'vente' || t === 'debours') row.typePrix = t;
  return row;
}

// Nombre de modifications locales pas encore poussées (diff BASE vs ombre)
function gsCountPending() {
  if (!GS) return 0;
  const shadow = gsLoadShadow();
  let n = 0;
  const localIds = new Set();
  for (const r of BASE) {
    if (!r.id) { n++; continue; }
    localIds.add(r.id);
    if (shadow[r.id] !== gsSig(r)) n++;
  }
  for (const id of Object.keys(shadow)) if (!localIds.has(id)) n++; // suppressions locales
  return n;
}

/* ── Planification (appelée par save() via scheduleSync) ── */
function gsScheduleSync() {
  if (!GS || !isElectron || !PREFS.autoSync) { if (GS) updateLinkBar(); return; }
  clearTimeout(gsDebounce);
  gsDebounce = setTimeout(() => { gsSyncNow(false); }, 2000);
  updateLinkBar();
}

/* ── Synchronisation à 3 sources ── */
async function gsSyncNow(forced) {
  if (!GS || !isElectron) return;
  if (gsSyncInProgress) return;
  gsSyncInProgress = true;
  updateLinkBar();

  try {
    ensureIds();
    const read = await window.electronAPI.gsRead(GS.spreadsheetId, GS_SHEET_TITLE);
    if (!read.ok) throw new Error(read.error);
    const values = read.data || [];

    // Carte des lignes distantes : id → {row (n° de ligne 1-based), data}
    const remote = new Map();
    for (let i = 1; i < values.length; i++) {
      const row = gsValuesToRow(values[i]);
      if (row.id) remote.set(row.id, { rowNum: i + 1, data: row });
    }

    const shadow = gsLoadShadow();
    const localMap = new Map(BASE.map(r => [r.id, r]));

    const updates = [];        // [{row, values}]
    const appends = [];        // [values]
    // ★ v2.6.1 — migration : compléter l'en-tête si la feuille date d'avant la colonne "Type"
    if (values[0] && values[0].length < GS_HEADER.length) {
      updates.push({ row: 1, values: GS_HEADER });
    }
    const deleteRemote = [];   // [rowNum]
    const deleteLocalIds = new Set();
    const pulls = [];          // {local, data} lignes distantes à adopter
    const newLocal = [];       // lignes distantes nouvelles à ajouter localement
    let conflicts = 0;

    // 1. Lignes présentes uniquement côté feuille
    for (const [id, rem] of remote) {
      if (localMap.has(id)) continue;
      if (shadow[id] !== undefined) {
        if (shadow[id] === gsSig(rem.data)) {
          // Supprimée localement, inchangée côté feuille → supprimer sur la feuille
          deleteRemote.push(rem.rowNum);
        } else {
          // Supprimée localement MAIS modifiée par quelqu'un d'autre → on la garde (prudence)
          newLocal.push(rem.data);
          conflicts++;
        }
      } else {
        // Nouvelle ligne ajoutée par un collègue → l'adopter
        newLocal.push(rem.data);
      }
    }

    // 2. Lignes locales
    for (const r of BASE) {
      const rem = remote.get(r.id);
      if (!rem) {
        if (shadow[r.id] !== undefined) {
          if (gsSig(r) === shadow[r.id]) {
            // Supprimée sur la feuille, inchangée ici → supprimer localement
            deleteLocalIds.add(r.id);
          } else {
            // Supprimée sur la feuille mais modifiée ici → ré-ajouter (mes modifs gagnent)
            appends.push(gsRowToValues(r));
            conflicts++;
          }
        } else {
          // Nouvelle ligne locale → append
          appends.push(gsRowToValues(r));
        }
        continue;
      }
      const ls = gsSig(r), rs = gsSig(rem.data), ss = shadow[r.id];
      if (ls === rs) continue;
      if (ss !== undefined && ls === ss) {
        // Seule la feuille a changé → adopter la version distante
        pulls.push({ local: r, data: rem.data });
      } else if (ss !== undefined && rs === ss) {
        // Seul le local a changé → pousser
        updates.push({ row: rem.rowNum, values: gsRowToValues(r) });
      } else {
        // Les deux ont changé (ou pas d'ombre) → le local gagne, on le pousse
        updates.push({ row: rem.rowNum, values: gsRowToValues(r) });
        if (ss !== undefined) conflicts++;
      }
    }

    // 3. Appliquer côté feuille (updates → deletes → appends)
    if (updates.length) {
      const r1 = await window.electronAPI.gsUpdate(GS.spreadsheetId, GS_SHEET_TITLE, updates);
      if (!r1.ok) throw new Error(r1.error);
    }
    if (deleteRemote.length) {
      const r2 = await window.electronAPI.gsDeleteRows(GS.spreadsheetId, GS.sheetId, deleteRemote);
      if (!r2.ok) throw new Error(r2.error);
    }
    if (appends.length) {
      const r3 = await window.electronAPI.gsAppend(GS.spreadsheetId, GS_SHEET_TITLE, appends);
      if (!r3.ok) throw new Error(r3.error);
    }

    // 4. Appliquer côté local
    let changedLocal = false;
    if (pulls.length) {
      pulls.forEach(p => Object.assign(p.local, p.data));
      changedLocal = true;
    }
    if (deleteLocalIds.size) {
      BASE = BASE.filter(r => !deleteLocalIds.has(r.id));
      changedLocal = true;
    }
    if (newLocal.length) {
      newLocal.forEach(d => BASE.push({ ...d }));
      changedLocal = true;
    }

    // 5. Nouvelle ombre = état local courant
    const newShadow = {};
    BASE.forEach(r => { newShadow[r.id] = gsSig(r); });
    gsSaveShadow(newShadow);

    gsOffline = false;
    gsLastError = '';
    gsLastSync = Date.now();

    if (changedLocal) {
      save(true);
      initUI(); renderAccueil();
      if ($('page-base').classList.contains('active')) renderBase();
      if ($('page-ratios').classList.contains('active')) renderRatios();
    }
    const nbOps = updates.length + appends.length + deleteRemote.length;
    if (conflicts) {
      toast(`⚠️ ${conflicts} conflit(s) résolu(s) (vos modifications ont été conservées)`, 'orange', 4500);
    } else if (forced) {
      toast(nbOps || changedLocal ? `✅ Feuille synchronisée (${nbOps} envoi(s), ${newLocal.length + pulls.length} réception(s))` : '✅ Déjà à jour', 'vert', 3000);
    } else if (newLocal.length || pulls.length) {
      toast(`🔄 ${newLocal.length + pulls.length} modification(s) reçue(s) de la feuille`, 'bleu', 3000);
    }
  } catch (e) {
    console.error('gsSyncNow:', e);
    gsOffline = true;
    gsLastError = e.message;
    if (forced) toast('Erreur sync Google Sheets : ' + e.message, 'rouge', 5000);
  }
  gsSyncInProgress = false;
  updateLinkBar();
}

/* ── Liaison ── */
function openLinkTypeChooser() {
  if (GS) { toast('Une feuille Google Sheets est déjà liée (Paramètres pour la délier)', 'orange', 3500); return; }
  if (linkedExcelPath) { linkExcel(); return; }
  if (!isElectron) { linkExcel(); return; }
  openModal('modalLinkType');
}

async function openGsLinkModal() {
  if (!isElectron) { toast('Disponible uniquement dans l\'app Electron', 'rouge'); return; }
  if (linkedExcelPath) {
    toast('Déliez d\'abord le fichier Excel (menu ⋮ → Délier) avant de lier Google Sheets', 'orange', 5000);
    return;
  }
  const warn = $('gsLinkWarning');
  const st = await window.electronAPI.gsAuthStatus();
  if (!st.ok || !st.data.connected) {
    warn.style.display = 'block';
    warn.innerHTML = '⚠️ Vous n\'êtes pas connecté à Google. Allez d\'abord dans <strong>Paramètres → 🟩 Google Sheets</strong> (identifiants + connexion), puis revenez ici.';
  } else {
    warn.style.display = 'none';
    GS_EMAIL = st.data.email || '';
  }
  openModal('modalGsLink', 'gsUrlInput');
}

function gsExtractId(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (m) return m[1];
  // Autoriser un ID brut collé directement
  if (/^[a-zA-Z0-9\-_]{20,}$/.test(String(url || '').trim())) return String(url).trim();
  return null;
}

async function gsConfirmLink() {
  const url = $('gsUrlInput').value.trim();
  const spreadsheetId = gsExtractId(url);
  if (!spreadsheetId) { toast('URL de feuille Google Sheets invalide', 'rouge', 3500); return; }
  const btn = $('btnGsLinkConfirm');
  btn.disabled = true; btn.textContent = '⏳ Liaison en cours…';
  try {
    const st = await window.electronAPI.gsAuthStatus();
    if (!st.ok || !st.data.connected) throw new Error('Non connecté à Google (Paramètres → Google Sheets)');
    GS_EMAIL = st.data.email || '';

    const ens = await window.electronAPI.gsEnsure(spreadsheetId, GS_SHEET_TITLE, GS_HEADER);
    if (!ens.ok) throw new Error(ens.error);

    await snapshotIfImportant('Avant liaison Google Sheets');
    pushUndo('Liaison Google Sheets');
    ensureIds();

    // Adoption d'IDs : si la feuille contient déjà des lignes identiques aux
    // lignes locales (contenu égal), on reprend l'ID distant pour éviter les doublons
    const read = await window.electronAPI.gsRead(spreadsheetId, GS_SHEET_TITLE);
    if (read.ok && read.data && read.data.length > 1) {
      const remoteBySig = new Map();
      for (let i = 1; i < read.data.length; i++) {
        const row = gsValuesToRow(read.data[i]);
        if (row.id) remoteBySig.set(gsSig(row), row.id);
      }
      const used = new Set();
      BASE.forEach(r => {
        const rid = remoteBySig.get(gsSig(r));
        if (rid && !used.has(rid)) { r.id = rid; used.add(rid); }
      });
    }

    GS = {
      spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheetId: ens.data.sheetId,
      spreadsheetTitle: ens.data.spreadsheetTitle
    };
    localStorage.setItem('bp_gsheet', JSON.stringify(GS));
    gsSaveShadow({}); // ombre vide → la première sync fusionne les deux côtés

    closeModal('modalGsLink');
    toast(`🟩 Liée à « ${GS.spreadsheetTitle} » — synchronisation…`, 'vert', 3000);
    await gsSyncNow(true);
    gsStartPoll();
    if ($('page-params').classList.contains('active')) renderParams();
  } catch (e) {
    toast('Liaison impossible : ' + e.message, 'rouge', 5000);
  }
  btn.disabled = false; btn.textContent = '✅ Lier cette feuille';
  updateLinkBar();
}

async function gsUnlink() {
  if (!GS) return;
  const pending = gsCountPending();
  if (!confirm(`Délier la feuille Google Sheets « ${GS.spreadsheetTitle || ''} » ?` +
    (pending ? `\n\n⚠️ ${pending} modification(s) locale(s) non synchronisée(s).` : '') +
    '\n\nVos prix restent dans l\'application ; la feuille n\'est pas modifiée.')) return;
  GS = null;
  localStorage.removeItem('bp_gsheet');
  gsSaveShadow({});
  gsStopPoll();
  updateLinkBar();
  if ($('page-params').classList.contains('active')) renderParams();
  toast('Feuille Google Sheets déliée', 'orange');
}

/* ── Vérification périodique (modifs des collègues) ── */
function gsStartPoll() {
  gsStopPoll();
  if (!GS || !PREFS.checkExternal) return;
  gsPollTimer = setInterval(() => {
    if (document.hidden || gsSyncInProgress) return;
    gsSyncNow(false);
  }, 60000);
}
function gsStopPoll() {
  if (gsPollTimer) { clearInterval(gsPollTimer); gsPollTimer = null; }
}

/* ── Paramètres ── */
async function gsSaveCreds() {
  const id = $('prefGsClientId').value.trim();
  const secret = $('prefGsClientSecret').value.trim();
  if (!id && !secret) { toast('Saisissez au moins le Client ID', 'orange'); return; }
  if (id) await window.electronAPI.secretSet('gs_client_id', id);
  if (secret) await window.electronAPI.secretSet('gs_client_secret', secret);
  $('prefGsClientId').value = '';
  $('prefGsClientSecret').value = '';
  toast('✅ Identifiants Google enregistrés (chiffrés)', 'vert');
  gsRenderParams();
}

async function gsConnect() {
  if (!isElectron) { toast('Disponible uniquement dans l\'app Electron', 'rouge'); return; }
  const hasId = await window.electronAPI.secretHas('gs_client_id');
  if (!hasId) { toast('Renseignez d\'abord le Client ID Google ci-dessus', 'orange', 4000); return; }
  toast('🔐 Votre navigateur va s\'ouvrir pour autoriser l\'accès…', 'bleu', 4000);
  const r = await window.electronAPI.gsAuthStart();
  if (r.ok) {
    GS_EMAIL = (r.data && r.data.email) || '';
    toast(`✅ Connecté : ${GS_EMAIL || 'compte Google'}`, 'vert', 3500);
    gsRenderParams();
    if (GS) gsSyncNow(false);
  } else {
    toast('Connexion échouée : ' + r.error, 'rouge', 5000);
  }
}

async function gsLogout() {
  await window.electronAPI.gsAuthLogout();
  GS_EMAIL = '';
  toast('Déconnecté de Google', 'orange');
  gsRenderParams();
  updateLinkBar();
}

async function gsRenderParams() {
  if (!isElectron) return;
  const zone = $('gsAccountZone');
  if (!zone) return;
  const st = await window.electronAPI.gsAuthStatus();
  const connected = st.ok && st.data.connected;
  if (connected) GS_EMAIL = st.data.email || GS_EMAIL;
  zone.innerHTML = connected
    ? `<div class="info info-vert" style="margin:0">✅ Connecté : <strong>${esc(st.data.email || 'compte Google')}</strong></div>`
    : `<div class="info info-orange" style="margin:0">Non connecté. Renseignez les identifiants ci-dessous puis cliquez sur « Se connecter avec Google ».</div>`;
  const bc = $('btnGsConnect'), bl = $('btnGsLogout');
  if (bc) bc.style.display = connected ? 'none' : '';
  if (bl) bl.style.display = connected ? '' : 'none';
  const idSt = $('gsClientIdStatus');
  if (idSt) {
    const hasId = await window.electronAPI.secretHas('gs_client_id');
    idSt.innerHTML = hasId ? '<span style="color:#085041">— ✅ enregistré</span>' : '<span style="color:#a93226">— manquant</span>';
  }
  const lz = $('gsLinkZone');
  if (lz) {
    if (GS) {
      lz.innerHTML = `<div class="info info-vert" style="margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>🟩 Feuille liée : <strong>${esc(GS.spreadsheetTitle || GS.spreadsheetId)}</strong> (onglet <code>${GS_SHEET_TITLE}</code>)</span>
        <button class="btn btn-bleu" style="font-size:10px;padding:3px 8px" onclick="openExternalUrl('${GS.url}')">↗ Ouvrir la feuille</button>
        <button class="btn btn-vert" style="font-size:10px;padding:3px 8px" onclick="gsSyncNow(true)">🔄 Synchroniser</button>
        <button class="btn btn-rouge" style="font-size:10px;padding:3px 8px" onclick="gsUnlink()">⛓️‍💥 Délier</button>
      </div>`;
    } else {
      lz.innerHTML = `<button class="btn btn-vert" onclick="openGsLinkModal()" ${connected ? '' : 'disabled title="Connectez-vous d\'abord"'}>🟩 Lier une feuille Google Sheets</button>`;
    }
  }
}

/* ── Intégrations : on enveloppe des fonctions existantes ── */

// Le bandeau de liaison affiche l'état Google Sheets quand une feuille est liée
const _gsOrigUpdateLinkBar = updateLinkBar;
updateLinkBar = function () {
  if (!GS) {
    _gsOrigUpdateLinkBar();
    if (!linkedExcelPath) {
      const main = $('btnLinkMain');
      if (main) main.textContent = '🔗 Lier Excel / Sheets';
    }
    return;
  }
  const bar = $('linkBar'), status = $('lbStatus'), path = $('lbPath'), extra = $('lbExtra');
  const main = $('btnLinkMain');
  if (main) main.style.display = 'none';
  const name = GS.spreadsheetTitle || 'Google Sheets';
  const pending = gsCountPending();
  const btns = `<button onclick="gsSyncNow(true)">🔄 Sync</button>
    <button onclick="openExternalUrl('${GS.url}')">↗ Ouvrir</button>`;
  if (gsSyncInProgress) {
    bar.className = 'link-bar modified';
    status.textContent = '🟩 Synchronisation…';
    path.textContent = name;
    extra.innerHTML = '';
  } else if (gsOffline) {
    bar.className = 'link-bar offline';
    status.textContent = '⚠️ Google Sheets inaccessible';
    path.textContent = gsLastError || name;
    extra.innerHTML = `<button onclick="gsSyncNow(true)">🔄 Réessayer</button>`;
  } else if (pending > 0) {
    bar.className = 'link-bar modified';
    status.textContent = '✏️ Modifications non syncées';
    path.textContent = name;
    extra.innerHTML = `<span class="lb-counter">${pending} modif${pending > 1 ? 's' : ''}</span> ${btns}`;
  } else {
    bar.className = 'link-bar linked';
    status.textContent = '🟩 Google Sheets lié';
    path.textContent = name + (GS_EMAIL ? ` · ${GS_EMAIL}` : '');
    extra.innerHTML = btns;
  }
};

// Impossible de lier un Excel si une feuille Google est déjà liée
const _gsOrigLinkExcel = linkExcel;
linkExcel = async function () {
  if (GS) {
    toast('Une feuille Google Sheets est déjà liée. Déliez-la d\'abord (Paramètres).', 'orange', 4500);
    return;
  }
  return _gsOrigLinkExcel();
};

// La page Paramètres affiche aussi les sections IA + Google
const _gsOrigRenderParams = renderParams;
renderParams = function () {
  _gsOrigRenderParams();
  gsRenderParams();
  if (typeof iaRefreshKeyStatus === 'function') iaRefreshKeyStatus();
};

// Ctrl+S force aussi la sync Google Sheets
const _gsOrigForceSync = forceSync;
forceSync = async function () {
  if (GS) return gsSyncNow(true);
  return _gsOrigForceSync();
};

// Démarrage : reprendre la liaison et lancer une sync silencieuse
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    if (!isElectron) return;
    if (GS) {
      const st = await window.electronAPI.gsAuthStatus();
      if (st.ok && st.data.connected) {
        GS_EMAIL = st.data.email || '';
        gsSyncNow(false);
        gsStartPoll();
      } else {
        gsOffline = true;
        gsLastError = 'Reconnectez-vous à Google (Paramètres)';
      }
    }
    updateLinkBar();
  }, 1500);
});
