// Stockage sécurisé des secrets (clé API Claude, identifiants Google)
// Les valeurs sont chiffrées via Electron safeStorage (DPAPI sous Windows).
// Elles ne quittent jamais le processus principal : le renderer ne peut que
// écrire un secret ou savoir s'il existe, jamais le relire.
const path = require('path')
const fs = require('fs')

// Seuls ces noms sont acceptés depuis le renderer
const ALLOWED_NAMES = [
  'anthropic_api_key',
  'gemini_api_key',
  'mistral_api_key',
  'gs_client_id',
  'gs_client_secret',
  'gs_refresh_token',
  'gs_email'
]

function createSecretStore(app, safeStorage) {
  const file = path.join(app.getPath('userData'), 'secrets.json')

  function load() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return {} }
  }
  function persist(data) {
    fs.writeFileSync(file, JSON.stringify(data))
  }
  function canEncrypt() {
    try { return safeStorage.isEncryptionAvailable() } catch (e) { return false }
  }

  return {
    isAllowed(name) { return ALLOWED_NAMES.includes(name) },
    set(name, value) {
      const data = load()
      if (value === null || value === undefined || value === '') {
        delete data[name]
        persist(data)
        return
      }
      if (canEncrypt()) {
        data[name] = { enc: true, v: safeStorage.encryptString(String(value)).toString('base64') }
      } else {
        // Fallback (Linux sans keyring) : encodage simple, mieux que rien
        data[name] = { enc: false, v: Buffer.from(String(value), 'utf8').toString('base64') }
      }
      persist(data)
    },
    get(name) {
      const e = load()[name]
      if (!e) return null
      try {
        if (e.enc) return safeStorage.decryptString(Buffer.from(e.v, 'base64'))
        return Buffer.from(e.v, 'base64').toString('utf8')
      } catch (err) {
        return null
      }
    },
    has(name) { return !!load()[name] },
    delete(name) {
      const data = load()
      delete data[name]
      persist(data)
    }
  }
}

module.exports = { createSecretStore }
