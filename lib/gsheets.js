// Liaison Google Sheets : OAuth 2.0 "application de bureau" (PKCE + serveur
// de bouclage local) et appels REST à l'API Sheets. Tourne dans le processus
// principal ; les jetons sont stockés via le magasin de secrets (safeStorage).
const http = require('http')
const crypto = require('crypto')

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email openid'

function createGSheets({ secrets, shell }) {
  let tokenCache = null // { access_token, expiresAt }
  let authServer = null

  function creds() {
    return {
      clientId: secrets.get('gs_client_id'),
      clientSecret: secrets.get('gs_client_secret')
    }
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(json.error_description || json.error || `Échange de jeton refusé (HTTP ${res.status})`)
    }
    return json
  }

  async function startAuth() {
    const { clientId, clientSecret } = creds()
    if (!clientId) throw new Error('Client ID Google manquant. Renseignez-le dans Paramètres → Google Sheets.')
    if (authServer) { try { authServer.close() } catch (e) {} authServer = null }

    const verifier = crypto.randomBytes(48).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')
    let redirectUri = ''

    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1')
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        const err = u.searchParams.get('error')
        if (err || u.searchParams.get('state') !== state) {
          res.end('<h2>❌ Connexion refusée. Vous pouvez fermer cet onglet.</h2>')
          cleanup()
          reject(new Error(err || 'Réponse OAuth invalide (state)'))
          return
        }
        res.end('<h2>✅ Connecté ! Vous pouvez fermer cet onglet et revenir dans Base de Prix.</h2>')
        const c = u.searchParams.get('code')
        cleanup()
        resolve(c)
      })
      const timer = setTimeout(() => { cleanup(); reject(new Error('Délai de connexion dépassé (3 min).')) }, 180000)
      function cleanup() {
        clearTimeout(timer)
        try { server.close() } catch (e) {}
        if (authServer === server) authServer = null
      }
      server.on('error', e => { cleanup(); reject(e) })
      server.listen(0, '127.0.0.1', () => {
        authServer = server
        redirectUri = `http://127.0.0.1:${server.address().port}/callback`
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        })
        shell.openExternal(`${AUTH_URL}?${params.toString()}`)
      })
    })

    const body = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    }
    if (clientSecret) body.client_secret = clientSecret
    const tok = await tokenRequest(body)
    if (!tok.refresh_token) throw new Error('Google n\'a pas fourni de jeton de rafraîchissement. Réessayez (le consentement doit être redemandé).')
    secrets.set('gs_refresh_token', tok.refresh_token)
    tokenCache = { access_token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 }

    // Récupérer l'email du compte pour l'afficher et signer les lignes
    let email = ''
    try {
      const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } })
      if (res.ok) email = (await res.json()).email || ''
    } catch (e) {}
    secrets.set('gs_email', email)
    return { email }
  }

  async function getAccessToken() {
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.access_token
    const refresh = secrets.get('gs_refresh_token')
    if (!refresh) throw new Error('Non connecté à Google. Paramètres → Google Sheets → Se connecter.')
    const { clientId, clientSecret } = creds()
    const body = { refresh_token: refresh, client_id: clientId, grant_type: 'refresh_token' }
    if (clientSecret) body.client_secret = clientSecret
    let tok
    try {
      tok = await tokenRequest(body)
    } catch (e) {
      // Jeton révoqué → forcer une reconnexion propre
      if (/invalid_grant/i.test(e.message)) {
        secrets.delete('gs_refresh_token')
        throw new Error('Session Google expirée ou révoquée. Reconnectez-vous dans Paramètres.')
      }
      throw e
    }
    tokenCache = { access_token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 }
    return tokenCache.access_token
  }

  async function api(pathAndQuery, { method = 'GET', body } = {}) {
    let token = await getAccessToken()
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${SHEETS_BASE}${pathAndQuery}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
      if (res.status === 401 && attempt === 0) {
        tokenCache = null
        token = await getAccessToken()
        continue
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = (json.error && json.error.message) || `HTTP ${res.status}`
        throw new Error(`Google Sheets : ${msg}`)
      }
      return json
    }
  }

  function authStatus() {
    return {
      connected: secrets.has('gs_refresh_token'),
      hasClientId: secrets.has('gs_client_id'),
      email: secrets.get('gs_email') || ''
    }
  }

  function logout() {
    secrets.delete('gs_refresh_token')
    secrets.delete('gs_email')
    tokenCache = null
  }

  // ── Opérations feuille ──────────────────────────────────────────────

  const quote = t => `'${String(t).replace(/'/g, "''")}'`

  async function getMeta(spreadsheetId) {
    const json = await api(`/${spreadsheetId}?fields=properties.title,sheets.properties`)
    return {
      title: json.properties.title,
      sheets: (json.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title }))
    }
  }

  // Crée l'onglet s'il n'existe pas et pose la ligne d'en-tête si la feuille est vide
  async function ensureSheet(spreadsheetId, title, header) {
    let meta = await getMeta(spreadsheetId)
    let sheet = meta.sheets.find(s => s.title === title)
    if (!sheet) {
      const r = await api(`/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [{ addSheet: { properties: { title } } }] }
      })
      const props = r.replies[0].addSheet.properties
      sheet = { id: props.sheetId, title: props.title }
    }
    const head = await api(`/${spreadsheetId}/values/${encodeURIComponent(quote(title) + '!1:1')}`)
    if (!head.values || !head.values.length || !head.values[0].length) {
      await api(`/${spreadsheetId}/values/${encodeURIComponent(quote(title) + '!A1')}?valueInputOption=RAW`, {
        method: 'PUT',
        body: { values: [header] }
      })
    }
    return { sheetId: sheet.id, spreadsheetTitle: meta.title }
  }

  async function readAll(spreadsheetId, title) {
    const json = await api(`/${spreadsheetId}/values/${encodeURIComponent(quote(title))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
    return json.values || []
  }

  async function appendRows(spreadsheetId, title, rows) {
    if (!rows.length) return
    await api(`/${spreadsheetId}/values/${encodeURIComponent(quote(title) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: { values: rows }
    })
  }

  // updates : [{ row: <numéro de ligne 1-based>, values: [...] }]
  async function updateRows(spreadsheetId, title, updates) {
    if (!updates.length) return
    await api(`/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: updates.map(u => ({ range: `${quote(title)}!A${u.row}`, values: [u.values] }))
      }
    })
  }

  // rowNumbers : numéros de ligne 1-based à supprimer
  async function deleteRows(spreadsheetId, sheetId, rowNumbers) {
    if (!rowNumbers.length) return
    const sorted = [...rowNumbers].sort((a, b) => b - a) // descendant pour ne pas décaler
    await api(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: {
        requests: sorted.map(n => ({
          deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } }
        }))
      }
    })
  }

  return { startAuth, authStatus, logout, getMeta, ensureSheet, readAll, appendRows, updateRows, deleteRows }
}

module.exports = { createGSheets }
