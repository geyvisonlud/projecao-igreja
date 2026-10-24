const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('api', {
  listSongs: () => ipcRenderer.invoke('songs:list'),
  saveSong: (song) => ipcRenderer.invoke('songs:save', song),
  deleteSong: (id) => ipcRenderer.invoke('songs:delete', id),

  listPlans: () => ipcRenderer.invoke('plans:list'),
  savePlan: (plan) => ipcRenderer.invoke('plans:save', plan),
  deletePlan: (id) => ipcRenderer.invoke('plans:delete', id),

  listMedia: () => ipcRenderer.invoke('media:list'),
  addMedia: () => ipcRenderer.invoke('media:add'),
  removeMedia: (id) => ipcRenderer.invoke('media:remove', id),

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
