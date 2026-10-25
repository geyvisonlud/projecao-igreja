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
  pickMedia: (role, kinds) => ipcRenderer.invoke('media:pick', role, kinds),
  importMedia: (paths, role) => ipcRenderer.invoke('media:import', paths, role),
  saveImages: (images) => ipcRenderer.invoke('media:saveImages', images),
  updateMedia: (id, changes) => ipcRenderer.invoke('media:update', id, changes),
  removeMedia: (id) => ipcRenderer.invoke('media:remove', id),
  pickDoc: () => ipcRenderer.invoke('docs:pick'),
  readDoc: (path) => ipcRenderer.invoke('docs:read', path),
  // Caminho no disco de um arquivo arrastado do Finder.
  pathForFile: (file) => webUtils.getPathForFile(file),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  getStorage: () => ipcRenderer.invoke('storage:get'),
  setStorage: (target) => ipcRenderer.invoke('storage:set', target),
  pickStorageFolder: () => ipcRenderer.invoke('storage:pickFolder'),
  revealStorage: () => ipcRenderer.invoke('storage:reveal'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  accentColor: () => ipcRenderer.invoke('system:accent'),
  defaultLogo: () => ipcRenderer.invoke('assets:logo'),
  getAzure: () => ipcRenderer.invoke('azure:get'),
  setAzure: (cfg) => ipcRenderer.invoke('azure:set', cfg),
  azureToken: () => ipcRenderer.invoke('azure:token'),
  askMicrophone: () => ipcRenderer.invoke('mic:ask'),
  popupMenu: (items) => ipcRenderer.invoke('menu:popup', items),

  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openOutput: (role, displayId) => ipcRenderer.invoke('outputs:open', role, displayId),
  closeOutput: (role) => ipcRenderer.invoke('outputs:close', role),
  outputStatus: () => ipcRenderer.invoke('outputs:status'),
  onOutputStatus: on('outputs:status'),
  onDisplaysChanged: on('displays:changed'),

  updateShow: (state) => ipcRenderer.send('show:update', state),
  onShow: on('show:update'),
});
