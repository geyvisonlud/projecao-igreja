const { app, BrowserWindow, ipcMain, screen, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PRELOAD = path.join(__dirname, 'preload.js');
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const DOC_EXT = ['pdf', 'ppt', 'pptx', 'key', 'odp'];
// Dentro do app empacotado os vídeos ficam fora do .asar (ver "asarUnpack" no package.json).
const BUILTIN_DIR = path.join(__dirname, 'assets', 'backgrounds').replace('app.asar', 'app.asar.unpacked');

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

// ---------- biblioteca de mídia ----------
// Arquivos adicionados são copiados para <dados do app>/media, então continuam funcionando
// mesmo se o original for movido ou apagado. role: 'background' (painel de fundos) ou 'slide'.

const mediaDir = () => path.join(app.getPath('userData'), 'media');
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const mediaPath = (m) => (m.builtin ? path.join(BUILTIN_DIR, m.file) : m.file ? path.join(mediaDir(), m.file) : m.path);

function builtinMedia() {
  try {
    return fs
      .readdirSync(BUILTIN_DIR)
      .filter((f) => [...VIDEO_EXT, ...IMAGE_EXT].includes(extOf(f)))
      .sort()
      .map((f) => ({
        id: 'builtin:' + f,
        name: path.basename(f, path.extname(f)),
        file: f,
        type: VIDEO_EXT.includes(extOf(f)) ? 'video' : 'image',
        role: 'background',
        builtin: true,
      }));
  } catch {
    return [];
  }
}

function listMedia() {
  return [...builtinMedia(), ...readJson('media.json', [])].map((m) => {
    const p = mediaPath(m);
    return { role: 'background', ...m, url: pathToFileURL(p).href, missing: !fs.existsSync(p) };
  });
}

async function importMedia(paths, role) {
  fs.mkdirSync(mediaDir(), { recursive: true });
  const media = readJson('media.json', []);
  const added = [];
  for (const p of paths) {
    const ext = extOf(p);
    if (![...VIDEO_EXT, ...IMAGE_EXT].includes(ext)) continue;
    const id = crypto.randomUUID();
    await fs.promises.copyFile(p, path.join(mediaDir(), `${id}.${ext}`));
    const item = {
      id,
      name: path.basename(p, path.extname(p)),
      file: `${id}.${ext}`,
      type: VIDEO_EXT.includes(ext) ? 'video' : 'image',
      role,
    };
    media.push(item);
    added.push(item);
  }
  writeJson('media.json', media);
  const all = listMedia();
  return added.map((a) => all.find((m) => m.id === a.id));
}

// ---------- PowerPoint / Keynote / PDF ----------
// O PDF é desenhado em imagens no operador (pdf.js); aqui só convertemos para PDF quando preciso,
// usando o que estiver instalado no Mac: Keynote, PowerPoint ou LibreOffice.

function run(cmd, args, timeout = 180000) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout }, (err, _out, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve())),
  );
}

const KEYNOTE_SCRIPT = `on run argv
  set inFile to POSIX file (item 1 of argv)
  set outFile to POSIX file (item 2 of argv)
  tell application "Keynote"
    set theDoc to open inFile
    export theDoc to outFile as PDF
    close theDoc saving no
  end tell
end run`;

const POWERPOINT_SCRIPT = `on run argv
  set inFile to POSIX file (item 1 of argv)
  set outFile to POSIX file (item 2 of argv)
  tell application "Microsoft PowerPoint"
    open inFile
    set thePres to active presentation
    save thePres in outFile as save as PDF
    close thePres saving no
  end tell
end run`;

async function convertToPdf(input) {
  const ext = extOf(input);
  if (ext === 'pdf') return input;
  const outDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'projecao-'));
  const out = path.join(outDir, path.basename(input, path.extname(input)) + '.pdf');
  const attempts = [];
  if (process.platform === 'darwin') {
    if (['ppt', 'pptx', 'key'].includes(ext)) attempts.push(['Keynote', () => run('osascript', ['-e', KEYNOTE_SCRIPT, input, out])]);
    if (['ppt', 'pptx'].includes(ext)) attempts.push(['PowerPoint', () => run('osascript', ['-e', POWERPOINT_SCRIPT, input, out])]);
  }
  const soffice =
    process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'soffice';
  attempts.push(['LibreOffice', () => run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, input])]);

  const failures = [];
  for (const [name, attempt] of attempts) {
    try {
      await attempt();
      if (fs.existsSync(out)) return out;
      failures.push(`${name}: não gerou o PDF`);
    } catch (e) {
      failures.push(`${name}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'Não consegui converter a apresentação. Abra no PowerPoint ou Keynote, exporte como PDF ' +
      '(Arquivo → Exportar → PDF) e importe o PDF.\n\n' +
      failures.join('\n'),
  );
}

async function readDoc(p) {
  try {
    const pdf = await convertToPdf(p);
    return { name: path.basename(p, path.extname(p)), data: await fs.promises.readFile(pdf) };
  } catch (e) {
    return { error: e.message };
  }
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

// Lista de registros com id gravada num arquivo: músicas e roteiros de culto.
function collection(name, file) {
  ipcMain.handle(`${name}:list`, () => readJson(file, []));

  ipcMain.handle(`${name}:save`, (_e, record) => {
    const records = readJson(file, []);
    const now = new Date().toISOString();
    const saved = { ...record, id: record.id || crypto.randomUUID(), updatedAt: now, createdAt: record.createdAt || now };
    const i = records.findIndex((r) => r.id === saved.id);
    if (i >= 0) records[i] = saved;
    else records.push(saved);
    writeJson(file, records);
    return saved;
  });

  ipcMain.handle(`${name}:delete`, (_e, id) => {
    writeJson(file, readJson(file, []).filter((r) => r.id !== id));
  });
}

collection('songs', 'songs.json');
collection('plans', 'plans.json');

ipcMain.handle('media:list', () => listMedia());

ipcMain.handle('media:pick', async (_e, role) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(operatorWin, {
    title: role === 'background' ? 'Adicionar fundo' : 'Adicionar imagem ou vídeo',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vídeos e imagens', extensions: [...VIDEO_EXT, ...IMAGE_EXT] }],
  });
  return canceled ? [] : importMedia(filePaths, role);
});

ipcMain.handle('media:import', (_e, paths, role) => importMedia(paths, role));

// Imagens geradas no operador (páginas de PDF), recebidas como data URL.
ipcMain.handle('media:saveImages', async (_e, images) => {
  fs.mkdirSync(mediaDir(), { recursive: true });
  const media = readJson('media.json', []);
  const added = [];
  for (const img of images) {
    const id = crypto.randomUUID();
    const [, mime, b64] = img.data.match(/^data:image\/(\w+);base64,(.*)$/);
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    await fs.promises.writeFile(path.join(mediaDir(), `${id}.${ext}`), Buffer.from(b64, 'base64'));
    const item = { id, name: img.name, file: `${id}.${ext}`, type: 'image', role: 'slide' };
    media.push(item);
    added.push(item);
  }
  writeJson('media.json', media);
  const all = listMedia();
  return added.map((a) => all.find((m) => m.id === a.id));
});

ipcMain.handle('media:remove', (_e, id) => {
  const media = readJson('media.json', []);
  const item = media.find((m) => m.id === id);
  if (item?.file) fs.rmSync(path.join(mediaDir(), item.file), { force: true });
  writeJson('media.json', media.filter((m) => m.id !== id));
  return listMedia();
});

ipcMain.handle('docs:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(operatorWin, {
    title: 'Importar PowerPoint, Keynote ou PDF',
    properties: ['openFile'],
    filters: [{ name: 'Apresentações', extensions: DOC_EXT }],
  });
  return canceled ? null : readDoc(filePaths[0]);
});

ipcMain.handle('docs:read', (_e, p) => readDoc(p));

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
