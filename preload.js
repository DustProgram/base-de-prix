const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // === API existantes (v2.2) ===
  openFile:      (filters)             => ipcRenderer.invoke('open-file', filters),
  saveFile:      (options)             => ipcRenderer.invoke('save-file', options),
  readFile:      (filePath)            => ipcRenderer.invoke('read-file', filePath),
  writeFile:     (filePath, data)      => ipcRenderer.invoke('write-file', { filePath, data }),
  openExternal:  (filePath)            => ipcRenderer.invoke('open-external', filePath),
  showInFolder:  (filePath)            => ipcRenderer.invoke('show-in-folder', filePath),
  chooseFolder:  ()                    => ipcRenderer.invoke('choose-folder'),
  fileExists:    (filePath)            => ipcRenderer.invoke('file-exists', filePath),
  fileMtime:     (filePath)            => ipcRenderer.invoke('file-mtime', filePath),
  isElectron: true,

  // === Nouvelles API v2.5 — Cache local ===
  // Lire/écrire dans %APPDATA%\Base de Prix\
  appDataRead:   (relPath)             => ipcRenderer.invoke('appdata-read', relPath),
  appDataWrite:  (relPath, data)       => ipcRenderer.invoke('appdata-write', { relPath, data }),
  appDataDelete: (relPath)             => ipcRenderer.invoke('appdata-delete', relPath),
  appDataList:   (relDir)              => ipcRenderer.invoke('appdata-list', relDir),
  appDataPath:   ()                    => ipcRenderer.invoke('appdata-path'),

  // === Nouvelles API v2.5 — Hash de fichier ===
  fileHash:      (filePath)            => ipcRenderer.invoke('file-hash', filePath),

  // === Nouvelles API v2.5 — Confirmation fermeture ===
  // Permet au renderer de demander une confirmation avant que l'app se ferme
  setBeforeQuit: (hasUnsavedChanges)   => ipcRenderer.send('set-before-quit', hasUnsavedChanges),
  onBeforeQuit:  (cb) => ipcRenderer.on('before-quit-trigger', (_e) => cb()),
  confirmQuit:   ()                    => ipcRenderer.send('confirm-quit'),

  // === Nouvelles API v2.5 — Mises à jour manuelles ===
  checkForUpdates: ()                  => ipcRenderer.invoke('check-for-updates'),
  getAppVersion:   ()                  => ipcRenderer.invoke('get-app-version'),

  // === Nouvelles API v2.6 — Secrets (écriture seule depuis le renderer) ===
  secretSet:     (name, value)         => ipcRenderer.invoke('secret-set', { name, value }),
  secretHas:     (name)                => ipcRenderer.invoke('secret-has', name),

  // === Nouvelles API v2.6 — Import IA (API Claude, exécutée côté main) ===
  openFiles:     (filters)             => ipcRenderer.invoke('open-files', filters),
  iaExtract:     (payload)             => ipcRenderer.invoke('ia-extract', payload),

  // === Nouvelles API v2.6 — Google Sheets ===
  gsAuthStart:   ()                    => ipcRenderer.invoke('gs-auth-start'),
  gsAuthStatus:  ()                    => ipcRenderer.invoke('gs-auth-status'),
  gsAuthLogout:  ()                    => ipcRenderer.invoke('gs-auth-logout'),
  gsMeta:        (spreadsheetId)       => ipcRenderer.invoke('gs-meta', { spreadsheetId }),
  gsEnsure:      (spreadsheetId, title, header) => ipcRenderer.invoke('gs-ensure', { spreadsheetId, title, header }),
  gsRead:        (spreadsheetId, title)         => ipcRenderer.invoke('gs-read', { spreadsheetId, title }),
  gsAppend:      (spreadsheetId, title, rows)   => ipcRenderer.invoke('gs-append', { spreadsheetId, title, rows }),
  gsUpdate:      (spreadsheetId, title, updates)=> ipcRenderer.invoke('gs-update', { spreadsheetId, title, updates }),
  gsDeleteRows:  (spreadsheetId, sheetId, rowNumbers) => ipcRenderer.invoke('gs-delete-rows', { spreadsheetId, sheetId, rowNumbers }),
  openUrl:       (url)                 => ipcRenderer.invoke('open-url', url)
})
