const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('api', {
  listSongs: () => ipcRenderer.invoke('songs:list'),
  saveSong: (song) => ipcRenderer.invoke('songs:save', song),
  deleteSong: (id) => ipcRenderer.invoke('songs:delete', id),

  listPlans: () => ipcRenderer.invoke('plans:list'),
  savePlan: (plan) => ipcRenderer.invoke('plans:save', plan),
  deletePlan: (id) => ipcRenderer.invoke('plans:delete', id),

  listMedia: () => ipcRenderer.invoke('media:list'),
  pickMedia: (role) => ipcRenderer.invoke('media:pick', role),
  importMedia: (paths, role) => ipcRenderer.invoke('media:import', paths, role),
  saveImages: (images) => ipcRenderer.invoke('media:saveImages', images),
  removeMedia: (id) => ipcRenderer.invoke('media:remove', id),
  pickDoc: () => ipcRenderer.invoke('docs:pick'),
  readDoc: (path) => ipcRenderer.invoke('docs:read', path),
  // Caminho no disco de um arquivo arrastado do Finder.
  pathForFile: (file) => webUtils.getPathForFile(file),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openProjection: (displayId) => ipcRenderer.invoke('projection:open', displayId),
  closeProjection: () => ipcRenderer.invoke('projection:close'),
  projectionStatus: () => ipcRenderer.invoke('projection:status'),
  onProjectionStatus: on('projection:status'),
  onDisplaysChanged: on('displays:changed'),

  updateShow: (state) => ipcRenderer.send('show:update', state),
  onShow: on('show:update'),
});
