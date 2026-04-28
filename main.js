const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path   = require('path')
const fs     = require('fs')
const crypto = require('crypto')
const { autoUpdater } = require('electron-updater')

let win
let allowQuit = false
let pendingClose = false

// === DOSSIER DE DONNÉES UTILISATEUR ===
// Windows : C:\Users\<user>\AppData\Roaming\Base de Prix\
// Mac     : ~/Library/Application Support/Base de Prix/
// Linux   : ~/.config/Base de Prix/
const USER_DATA = app.getPath('userData')
const CACHE_DIR     = path.join(USER_DATA, 'cache')
const SNAPSHOTS_DIR = path.join(USER_DATA, 'snapshots')
const BACKUPS_DIR   = path.join(USER_DATA, 'backups')
const LOGS_DIR      = path.join(USER_DATA, 'logs')

// Créer les dossiers au démarrage
;[CACHE_DIR, SNAPSHOTS_DIR, BACKUPS_DIR, LOGS_DIR].forEach(dir => {
  try { fs.mkdirSync(dir, { recursive: true }) } catch(e) {}
})

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Base de Prix',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.loadFile('index.html')
  win.setMenuBarVisibility(false)

  // === Intercepter la fermeture pour confirmation ===
  win.on('close', (e) => {
    if (allowQuit) return
    if (pendingClose) {
      // Le renderer a déjà été interrogé, on attend qu'il appelle confirmQuit()
      e.preventDefault()
      return
    }
    if (win && win.webContents) {
      e.preventDefault()
      pendingClose = true
      win.webContents.send('before-quit-trigger')
      // Si dans 10 secondes le renderer ne répond pas, on quitte quand même
      setTimeout(() => {
        if (pendingClose) {
          allowQuit = true
          app.quit()
        }
      }, 10000)
    }
  })

  // Auto-update : vérification 5 sec après démarrage
  setTimeout(() => {
    if (!app.isPackaged) return
    autoUpdater.checkForUpdates().catch(err => {
      console.log('Vérification mise à jour échouée (silencieux):', err.message)
    })
  }, 5000)
}

// Helper : restaure le focus à la fenêtre après une dialog Windows
function restoreFocus() {
  if (!win || win.isDestroyed()) return
  setImmediate(() => {
    if (win && !win.isDestroyed()) {
      win.focus()
      win.webContents.focus()
    }
  })
}

// === AUTO-UPDATE ===
autoUpdater.autoDownload = false

autoUpdater.on('update-available', async (info) => {
  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Mise à jour disponible',
    message: `Une nouvelle version (${info.version}) est disponible !`,
    detail: 'Voulez-vous la télécharger et l\'installer maintenant ?\n\n' +
            'Le téléchargement se fera en arrière-plan, vous pourrez continuer à utiliser l\'application.\n\n' +
            'Une fois prêt, l\'application redémarrera pour finaliser l\'installation.',
    buttons: ['Plus tard', 'Télécharger maintenant'],
    defaultId: 1,
    cancelId: 0
  })
  if (result.response === 1) {
    autoUpdater.downloadUpdate()
  }
})

autoUpdater.on('update-downloaded', async (info) => {
  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Mise à jour prête',
    message: `La mise à jour ${info.version} a été téléchargée.`,
    detail: 'L\'application va redémarrer pour terminer l\'installation.',
    buttons: ['Redémarrer maintenant', 'Plus tard'],
    defaultId: 0,
    cancelId: 1
  })
  if (result.response === 0) {
    allowQuit = true
    autoUpdater.quitAndInstall()
  }
})

autoUpdater.on('error', (err) => {
  console.log('Auto-update error (silencieux):', err.message)
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// === IPC : ouverture/sauvegarde de fichier (existants) ===
ipcMain.handle('open-file', async (e, filters) => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Ouvrir un fichier',
    filters: filters || [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }],
    properties: ['openFile']
  })
  restoreFocus()
  if (result.canceled || !result.filePaths.length) return null
  const filePath = result.filePaths[0]
  const buffer   = fs.readFileSync(filePath)
  return { path: filePath, data: buffer.toString('base64') }
})

ipcMain.handle('save-file', async (e, { defaultName, filters, data }) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Enregistrer',
    defaultPath: defaultName || 'fichier.xlsx',
    filters: filters || [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  restoreFocus()
  if (result.canceled || !result.filePath) return null
  const buffer = Buffer.from(data, 'base64')
  fs.writeFileSync(result.filePath, buffer)
  return result.filePath
})

ipcMain.handle('read-file', async (e, filePath) => {
  if (!fs.existsSync(filePath)) return null
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('base64')
})

ipcMain.handle('write-file', async (e, { filePath, data }) => {
  try {
    const buffer = Buffer.from(data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-external', async (e, filePath) => {
  shell.openPath(filePath)
})

ipcMain.handle('show-in-folder', async (e, filePath) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choisir un dossier',
    properties: ['openDirectory']
  })
  restoreFocus()
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('file-exists', async (e, filePath) => {
  try { return fs.existsSync(filePath) } catch { return false }
})

ipcMain.handle('file-mtime', async (e, filePath) => {
  try { return fs.statSync(filePath).mtimeMs } catch { return null }
})

// === NOUVELLES API v2.5 — Cache local %APPDATA% ===

function safeRelPath(relPath) {
  // Sécurité : interdire les ".." et les chemins absolus
  if (!relPath || typeof relPath !== 'string') throw new Error('Chemin invalide')
  if (relPath.includes('..') || path.isAbsolute(relPath)) throw new Error('Chemin invalide')
  return path.join(USER_DATA, relPath)
}

ipcMain.handle('appdata-read', async (e, relPath) => {
  try {
    const fp = safeRelPath(relPath)
    if (!fs.existsSync(fp)) return null
    return fs.readFileSync(fp).toString('base64')
  } catch (err) {
    console.error('appdata-read error:', err.message)
    return null
  }
})

ipcMain.handle('appdata-write', async (e, { relPath, data }) => {
  try {
    const fp = safeRelPath(relPath)
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    const buffer = Buffer.from(data, 'base64')
    fs.writeFileSync(fp, buffer)
    return { success: true, path: fp }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('appdata-delete', async (e, relPath) => {
  try {
    const fp = safeRelPath(relPath)
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('appdata-list', async (e, relDir) => {
  try {
    const fp = safeRelPath(relDir || '.')
    if (!fs.existsSync(fp)) return []
    const items = fs.readdirSync(fp, { withFileTypes: true })
    return items.map(it => {
      const full = path.join(fp, it.name)
      let stat = null
      try { stat = fs.statSync(full) } catch(e) {}
      return {
        name: it.name,
        isDirectory: it.isDirectory(),
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtimeMs : 0
      }
    })
  } catch (err) {
    return []
  }
})

ipcMain.handle('appdata-path', async () => USER_DATA)

// === NOUVELLE API v2.5 — Hash SHA-256 d'un fichier ===
ipcMain.handle('file-hash', async (e, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null
    const buffer = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    return hash
  } catch (err) {
    return null
  }
})

// === Confirmation de fermeture ===
ipcMain.on('confirm-quit', () => {
  allowQuit = true
  pendingClose = false
  app.quit()
})

ipcMain.on('set-before-quit', (e, hasUnsavedChanges) => {
  // Le renderer informe l'app si elle a des modifs non sauvegardées
  // (utilisé pour la décision de check au close)
})

// === Mises à jour manuelles depuis Paramètres ===
ipcMain.handle('check-for-updates', async () => {
  try {
    if (!app.isPackaged) {
      return { hasUpdate: false, isDev: true, current: app.getVersion() }
    }
    const result = await autoUpdater.checkForUpdates()
    if (result && result.updateInfo && result.updateInfo.version !== app.getVersion()) {
      return { hasUpdate: true, version: result.updateInfo.version, current: app.getVersion() }
    }
    return { hasUpdate: false, current: app.getVersion() }
  } catch (e) {
    return { hasUpdate: false, error: e.message, current: app.getVersion() }
  }
})

ipcMain.handle('get-app-version', () => app.getVersion())
