const { app, BrowserWindow, Menu, ipcMain, screen, dialog, shell, nativeTheme, systemPreferences, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PRELOAD = path.join(__dirname, 'preload.js');
const IS_MAC = process.platform === 'darwin';
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'];
const MEDIA_EXT = [...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT];
const DOC_EXT = ['pdf', 'ppt', 'pptx', 'key', 'odp'];
// Dentro do app empacotado os vídeos ficam fora do .asar (ver "asarUnpack" no package.json).
const BUILTIN_DIR = path.join(__dirname, 'assets', 'backgrounds').replace('app.asar', 'app.asar.unpacked');

// Saídas: Palco (público) e Retorno (músicos e pregador). O Comando é a janela do operador.
const OUTPUTS = {
  palco: { title: 'Palco', page: 'src/projection.html' },
  retorno: { title: 'Retorno', page: 'src/stage.html' },
};

let operatorWin = null;
const outputWins = {};
let lastShow = null;
let sleepBlocker = null;

// ---------- onde ficam os dados ----------
// settings.json e config.json são deste Mac. Músicas, roteiros e mídias ficam na "pasta de dados",
// que pode ser a do app (Local), uma pasta dentro do Google Drive ou outra pasta escolhida.

const userFile = (name) => path.join(app.getPath('userData'), name);

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Grava em arquivo temporário e renomeia, para nunca deixar o arquivo pela metade.
function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

const config = () => readJsonFile(userFile('config.json'), {});
const dataDir = () => config().dataDir || app.getPath('userData');
const readJson = (name, fallback) => readJsonFile(path.join(dataDir(), name), fallback);
const writeJson = (name, data) => writeJsonFile(path.join(dataDir(), name), data);

// Pasta "Meu Drive" do app Google Drive para computador, se estiver instalado.
function detectGoogleDrive() {
  const cloud = path.join(os.homedir(), 'Library', 'CloudStorage');
  const candidates = [];
  try {
    for (const entry of fs.readdirSync(cloud)) {
      if (!entry.startsWith('GoogleDrive')) continue;
      const root = path.join(cloud, entry);
      const myDrive = ['My Drive', 'Meu Drive'].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
      candidates.push(myDrive || root);
    }
  } catch {}
  candidates.push(path.join(os.homedir(), 'Google Drive', 'My Drive'), path.join(os.homedir(), 'Google Drive'));
  const found = candidates.find((d) => fs.existsSync(d));
  return found ? path.join(found, 'Projeção Igreja') : null;
}

function storageInfo() {
  const local = app.getPath('userData');
  const drive = detectGoogleDrive();
  const current = dataDir();
  const mode = current === local ? 'local' : current === drive ? 'drive' : 'custom';
  return { mode, path: current, local, drive, home: os.homedir() };
}

const SHARED_FILES = ['songs.json', 'plans.json', 'media.json'];

// Troca a pasta de dados. Se a nova pasta já tem dados (ex.: outro Mac sincronizado pelo Drive),
// passa a usá-los; senão copia os dados atuais para lá.
async function setStorage(target) {
  const from = dataDir();
  const to = target === 'local' ? app.getPath('userData') : target === 'drive' ? detectGoogleDrive() : target;
  if (!to) throw new Error('Google Drive para computador não encontrado neste Mac.');
  if (path.resolve(to) === path.resolve(from)) return { ...storageInfo(), adopted: false };
  fs.mkdirSync(to, { recursive: true });
  const adopted = fs.existsSync(path.join(to, 'songs.json')) || fs.existsSync(path.join(to, 'plans.json'));
  if (!adopted) {
    for (const f of SHARED_FILES) {
      if (fs.existsSync(path.join(from, f))) await fs.promises.copyFile(path.join(from, f), path.join(to, f));
    }
    if (fs.existsSync(path.join(from, 'media'))) await fs.promises.cp(path.join(from, 'media'), path.join(to, 'media'), { recursive: true });
  }
  const cfg = config();
  if (to === app.getPath('userData')) delete cfg.dataDir;
  else cfg.dataDir = to;
  writeJsonFile(userFile('config.json'), cfg);
  return { ...storageInfo(), adopted };
}

// ---------- biblioteca de mídia ----------
// Arquivos enviados são copiados para <pasta de dados>/media. role:
//   'background' — aparece no painel de fundos (e na biblioteca)
//   'library'    — só na biblioteca
//   'slide'      — páginas importadas de PowerPoint/PDF (ficam fora da biblioteca)

const mediaDir = () => path.join(dataDir(), 'media');
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const typeOf = (ext) => (VIDEO_EXT.includes(ext) ? 'video' : AUDIO_EXT.includes(ext) ? 'audio' : 'image');
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
        type: typeOf(extOf(f)),
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

function withUrls(added) {
  const all = listMedia();
  return added.map((a) => all.find((m) => m.id === a.id));
}

async function importMedia(paths, role) {
  fs.mkdirSync(mediaDir(), { recursive: true });
  const media = readJson('media.json', []);
  const added = [];
  for (const p of paths) {
    const ext = extOf(p);
    if (!MEDIA_EXT.includes(ext)) continue;
    const id = crypto.randomUUID();
    await fs.promises.copyFile(p, path.join(mediaDir(), `${id}.${ext}`));
    const item = { id, name: path.basename(p, path.extname(p)), file: `${id}.${ext}`, type: typeOf(ext), role };
    media.push(item);
    added.push(item);
  }
  writeJson('media.json', media);
  return withUrls(added);
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
  if (IS_MAC) {
    if (['ppt', 'pptx', 'key'].includes(ext)) attempts.push(['Keynote', () => run('osascript', ['-e', KEYNOTE_SCRIPT, input, out])]);
    if (['ppt', 'pptx'].includes(ext)) attempts.push(['PowerPoint', () => run('osascript', ['-e', POWERPOINT_SCRIPT, input, out])]);
  }
  const soffice = IS_MAC ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'soffice';
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

// ---------- telas de saída ----------

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

const outputStatus = () => Object.fromEntries(Object.keys(OUTPUTS).map((r) => [r, !!outputWins[r]]));

function closeOutput(role) {
  const win = outputWins[role];
  if (win && !win.isDestroyed()) win.close();
}

function openOutput(role, displayId) {
  closeOutput(role);
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || displays.find((d) => d.id !== primaryId);
  const external = target && target.id !== primaryId;

  const win = new BrowserWindow({
    ...(target ? target.bounds : { width: 960, height: 540 }),
    title: OUTPUTS[role].title,
    frame: !external,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  outputWins[role] = win;
  win.loadFile(path.join(__dirname, OUTPUTS[role].page));

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
    if (outputWins[role] === win) delete outputWins[role];
    if (sleepBlocker !== null && !Object.keys(outputWins).length) {
      powerSaveBlocker.stop(sleepBlocker);
      sleepBlocker = null;
    }
    notifyOperator('outputs:status', outputStatus());
  });

  if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  notifyOperator('outputs:status', outputStatus());
}

function createOperator() {
  operatorWin = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: 'Projeção Igreja',
    // Visual de app do Mac: barra de título integrada à barra de ferramentas e barra lateral translúcida.
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff' }),
    webPreferences: { preload: PRELOAD },
  });
  operatorWin.loadFile(path.join(__dirname, 'src/operator.html'), { query: { platform: process.platform } });
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

ipcMain.handle('media:pick', async (_e, role, kinds = ['image', 'video', 'audio']) => {
  const extensions = [
    ...(kinds.includes('image') ? IMAGE_EXT : []),
    ...(kinds.includes('video') ? VIDEO_EXT : []),
    ...(kinds.includes('audio') ? AUDIO_EXT : []),
  ];
  const { canceled, filePaths } = await dialog.showOpenDialog(operatorWin, {
    title: 'Enviar arquivos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens, vídeos e áudios', extensions }],
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
  return withUrls(added);
});

// Muda nome ou papel (ex.: "Usar como fundo") de um arquivo da biblioteca.
ipcMain.handle('media:update', (_e, id, changes) => {
  const media = readJson('media.json', []);
  const item = media.find((m) => m.id === id);
  if (item) Object.assign(item, { name: changes.name ?? item.name, role: changes.role ?? item.role });
  writeJson('media.json', media);
  return listMedia();
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

ipcMain.handle('settings:get', () => readJsonFile(userFile('settings.json'), {}));
ipcMain.handle('settings:set', (_e, settings) => writeJsonFile(userFile('settings.json'), settings));

ipcMain.handle('storage:get', () => storageInfo());
ipcMain.handle('storage:set', async (_e, target) => {
  try {
    return await setStorage(target);
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('storage:pickFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(operatorWin, {
    title: 'Escolher pasta para os dados',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled ? null : filePaths[0];
});
ipcMain.handle('storage:reveal', () => shell.openPath(dataDir()));
ipcMain.handle('open:external', (_e, url) => /^https:\/\//.test(url) && shell.openExternal(url));

ipcMain.handle('system:accent', () => {
  try {
    return IS_MAC ? '#' + systemPreferences.getAccentColor().slice(0, 6) : null;
  } catch {
    return null;
  }
});

// Menu nativo do Mac na posição do clique. Devolve o id escolhido, ou null se fechar sem escolher.
ipcMain.handle('menu:popup', (e, items) =>
  new Promise((resolve) => {
    const build = (list) =>
      list.map((it) =>
        it.type === 'separator'
          ? { type: 'separator' }
          : {
              label: it.label,
              type: it.submenu ? 'submenu' : it.checked === undefined ? 'normal' : 'checkbox',
              checked: !!it.checked,
              enabled: it.enabled !== false,
              submenu: it.submenu ? build(it.submenu) : undefined,
              click: it.submenu ? undefined : () => resolve(it.id),
            },
      );
    // O clique pode chegar logo depois do fechamento do menu; só conta como "nada escolhido"
    // se nenhum clique vier em seguida.
    Menu.buildFromTemplate(build(items)).popup({
      window: BrowserWindow.fromWebContents(e.sender),
      callback: () => setTimeout(() => resolve(null), 150),
    });
  }),
);

ipcMain.handle('displays:list', () => listDisplays());
ipcMain.handle('outputs:open', (_e, role, displayId) => openOutput(role, displayId));
ipcMain.handle('outputs:close', (_e, role) => closeOutput(role));
ipcMain.handle('outputs:status', () => outputStatus());

ipcMain.on('show:update', (_e, state) => {
  lastShow = state;
  for (const win of Object.values(outputWins)) {
    if (!win.isDestroyed()) win.webContents.send('show:update', state);
  }
});

// ---------- ciclo de vida ----------

app.whenReady().then(() => {
  createOperator();
  const onDisplaysChanged = () => notifyOperator('displays:changed', listDisplays());
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
