const { app, BrowserWindow, ipcMain, screen, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const PRELOAD = path.join(__dirname, 'preload.js');
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

let operatorWin = null;
let projectionWin = null;
let lastShow = null;
let sleepBlocker = null;

// ---------- armazenamento (JSON na pasta de dados do app) ----------

const dataFile = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Grava em arquivo temporário e renomeia, para nunca deixar o banco pela metade.
function writeJson(name, data) {
  const file = dataFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function mediaWithUrls() {
  return readJson('media.json', []).map((m) => ({
    ...m,
    url: pathToFileURL(m.path).href,
    missing: !fs.existsSync(m.path),
  }));
}

// ---------- telas ----------

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    primary: d.id === primaryId,
    label: `${d.label || `Tela ${i + 1}`} (${d.size.width}×${d.size.height})${d.id === primaryId ? ' — principal' : ''}`,
  }));
}

function notifyOperator(channel, payload) {
  if (operatorWin && !operatorWin.isDestroyed()) operatorWin.webContents.send(channel, payload);
}

function closeProjection() {
  if (projectionWin && !projectionWin.isDestroyed()) projectionWin.close();
}

function openProjection(displayId) {
  closeProjection();
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || displays.find((d) => d.id !== primaryId);
  const external = target && target.id !== primaryId;

  const win = new BrowserWindow({
    ...(target ? target.bounds : { width: 960, height: 540 }),
    title: 'Projeção',
    frame: !external,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  projectionWin = win;
  win.loadFile(path.join(__dirname, 'src/projection.html'));

  win.once('ready-to-show', () => {
    if (external) {
      // Janela sem borda cobrindo a tela externa inteira, acima da barra de menus,
      // sem criar um "Space" de tela cheia que roubaria o foco do operador.
      win.setBounds(target.bounds);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.showInactive();
    } else {
      win.show();
      if (target) win.setFullScreen(true);
    }
    if (operatorWin) operatorWin.focus();
  });
  win.webContents.on('did-finish-load', () => {
    if (lastShow) win.webContents.send('show:update', lastShow);
  });
  win.on('closed', () => {
    if (projectionWin === win) projectionWin = null;
    if (sleepBlocker !== null && !projectionWin) {
      powerSaveBlocker.stop(sleepBlocker);
      sleepBlocker = null;
    }
    notifyOperator('projection:status', !!projectionWin);
  });

  if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  notifyOperator('projection:status', true);
}

function createOperator() {
  operatorWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Projeção Igreja',
    backgroundColor: '#15161a',
    webPreferences: { preload: PRELOAD },
  });
  operatorWin.loadFile(path.join(__dirname, 'src/operator.html'));
  operatorWin.on('closed', () => {
    operatorWin = null;
    app.quit();
  });
}

// ---------- IPC ----------

ipcMain.handle('songs:list', () => readJson('songs.json', []));

ipcMain.handle('songs:save', (_e, song) => {
  const songs = readJson('songs.json', []);
  const now = new Date().toISOString();
  const saved = { ...song, id: song.id || crypto.randomUUID(), updatedAt: now, createdAt: song.createdAt || now };
  const i = songs.findIndex((s) => s.id === saved.id);
  if (i >= 0) songs[i] = saved;
  else songs.push(saved);
  writeJson('songs.json', songs);
  return saved;
});

ipcMain.handle('songs:delete', (_e, id) => {
  writeJson('songs.json', readJson('songs.json', []).filter((s) => s.id !== id));
});

ipcMain.handle('media:list', () => mediaWithUrls());

ipcMain.handle('media:add', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(operatorWin, {
    title: 'Adicionar fundo',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vídeos e imagens', extensions: [...VIDEO_EXT, ...IMAGE_EXT] }],
  });
  if (canceled) return mediaWithUrls();
  const media = readJson('media.json', []);
  for (const p of filePaths) {
    if (media.some((m) => m.path === p)) continue;
    const ext = path.extname(p).slice(1).toLowerCase();
    media.push({
      id: crypto.randomUUID(),
      name: path.basename(p, path.extname(p)),
      path: p,
      type: VIDEO_EXT.includes(ext) ? 'video' : 'image',
    });
  }
  writeJson('media.json', media);
  return mediaWithUrls();
});

ipcMain.handle('media:remove', (_e, id) => {
  writeJson('media.json', readJson('media.json', []).filter((m) => m.id !== id));
  return mediaWithUrls();
});

ipcMain.handle('settings:get', () => readJson('settings.json', {}));
ipcMain.handle('settings:set', (_e, settings) => writeJson('settings.json', settings));

ipcMain.handle('displays:list', () => listDisplays());
ipcMain.handle('projection:open', (_e, displayId) => openProjection(displayId));
ipcMain.handle('projection:close', () => closeProjection());
ipcMain.handle('projection:status', () => !!projectionWin);

ipcMain.on('show:update', (_e, state) => {
  lastShow = state;
  if (projectionWin && !projectionWin.isDestroyed()) projectionWin.webContents.send('show:update', state);
});

// ---------- ciclo de vida ----------

app.whenReady().then(() => {
  createOperator();
  const onDisplaysChanged = () => notifyOperator('displays:changed', listDisplays());
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
