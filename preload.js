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
  getAppVersion:   ()                  => ipcRenderer.invoke('get-app-version')
})
