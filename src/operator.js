const api = window.api;
const { parse, normalize } = window.Lyrics;
const { fmt, remaining } = window.ScreenView;

const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children.filter((c) => c != null));
  return n;
}

const DEFAULT_THEME = { fontSize: 8, dim: 0.35, uppercase: false };

let songs = [];
let media = [];
let settings = {};
let selectedId = null;
let live = null; // { songId, index } do slide que está no telão
let projectionOpen = false;

// Estado enviado ao telão. A pré-visualização desenha exatamente o mesmo objeto.
const show = { black: false, hideText: false, background: null, content: null, theme: { ...DEFAULT_THEME } };
const timer = { endAt: null, remaining: 5 * 60000, message: 'O culto começa em', endMessage: '' };

const preview = ScreenView.create($('#preview'));

function push() {
  const state = JSON.parse(JSON.stringify(show));
  api.updateShow(state);
  preview.update(state);
  $('#blackBtn').classList.toggle('on', show.black);
  $('#hideBtn').classList.toggle('on', show.hideText);
  $('#liveBadge').classList.toggle('on', projectionOpen);
  $('#liveBadge').textContent = projectionOpen ? 'AO VIVO' : 'PRÉVIA';
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    settings = {
      ...settings,
      theme: show.theme,
      timerMessage: timer.message,
      timerEndMessage: timer.endMessage,
    };
    api.setSettings(settings);
  }, 300);
}

const maxLines = () => Number(settings.maxLines) || 4;
const selectedSong = () => songs.find((s) => s.id === selectedId) || null;
const slidesOf = (song) => parse(song.lyrics, { maxLines: maxLines() }).slides;

// ---------- biblioteca ----------

function renderSongList() {
  const q = normalize($('#search').value);
  const list = songs
    .filter((s) => !q || normalize([s.title, s.artist, (s.tags || []).join(' '), s.lyrics].join(' ')).includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  $('#songList').replaceChildren(
    ...list.map((s) =>
      h(
        'li',
        {
          className: [s.id === selectedId && 'selected', live && live.songId === s.id && 'is-live'].filter(Boolean).join(' '),
          onclick: () => selectSong(s.id),
          ondblclick: () => openEditor(s),
        },
        h('div', { className: 't', textContent: s.title }),
        s.artist || s.key ? h('div', { className: 's', textContent: [s.artist, s.key && `Tom ${s.key}`].filter(Boolean).join(' · ') }) : null,
      ),
    ),
  );
  $('#songCount').textContent = q ? `${list.length} de ${songs.length} músicas` : `${songs.length} músicas no banco`;
}

function selectSong(id) {
  selectedId = id;
  renderSongList();
  renderSlides();
}

function renderSlides() {
  const song = selectedSong();
  $('#songHead').classList.toggle('hidden', !song);
  $('#emptyState').classList.toggle('hidden', !!song);
  if (!song) return $('#slides').replaceChildren();
  $('#songTitle').textContent = song.title;
  $('#songMeta').textContent = [song.artist, song.key && `Tom ${song.key}`, (song.tags || []).join(', ')]
    .filter(Boolean)
    .join(' · ');
  $('#slides').replaceChildren(
    ...slidesOf(song).map((slide, i) =>
      h(
        'button',
        {
          className: 'slide' + (live && live.songId === song.id && live.index === i ? ' live' : ''),
          onclick: () => goLive(i),
        },
        h('div', { className: 'lbl' }, h('span', { textContent: slide.label || ' ' }), h('span', { textContent: i + 1 })),
        h('div', { className: 'txt', textContent: slide.text }),
      ),
    ),
  );
}

function goLive(index) {
  const song = selectedSong();
  if (!song) return;
  const slides = slidesOf(song);
  if (!slides.length) return;
  index = Math.max(0, Math.min(slides.length - 1, index));
  live = { songId: song.id, index };
  show.content = { type: 'text', text: slides[index].text, label: slides[index].label };
  show.black = false;
  show.hideText = false;
  push();
  renderSlides();
  renderSongList();
  document.querySelectorAll('#slides .slide')[index]?.scrollIntoView({ block: 'nearest' });
}

function step(delta) {
  if (!selectedSong()) return;
  if (live && live.songId === selectedId && show.content?.type === 'text') goLive(live.index + delta);
  else goLive(0);
}

// ---------- editor ----------

const editor = $('#editor');
const form = $('#editorForm');
let editing = null;

function renderEditorPreview() {
  const { slides } = parse(form.lyrics.value, { maxLines: maxLines() });
  $('#edCount').textContent = slides.length;
  $('#edSlides').replaceChildren(
    ...slides.map((s, i) =>
      h(
        'div',
        { className: 'slide' },
        h('div', { className: 'lbl' }, h('span', { textContent: s.label || ' ' }), h('span', { textContent: i + 1 })),
        h('div', { className: 'txt', textContent: s.text }),
      ),
    ),
  );
}

function openEditor(song) {
  editing = song || null;
  $('#edHeading').textContent = song ? 'Editar música' : 'Nova música';
  $('#edDelete').classList.toggle('hidden', !song);
  form.title.value = song?.title || '';
  form.artist.value = song?.artist || '';
  form.key.value = song?.key || '';
  form.tags.value = (song?.tags || []).join(', ');
  form.lyrics.value = song?.lyrics || '';
  renderEditorPreview();
  editor.showModal();
  (song ? form.lyrics : form.title).focus();
}

form.lyrics.addEventListener('input', renderEditorPreview);
$('#edCancel').onclick = () => editor.close();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.title.value.trim();
  const dup = songs.find((s) => s.id !== editing?.id && normalize(s.title) === normalize(title));
  if (dup && !confirm(`Já existe uma música chamada "${dup.title}". Salvar mesmo assim?`)) return;
  const saved = await api.saveSong({
    ...(editing || {}),
    title,
    artist: form.artist.value.trim(),
    key: form.key.value.trim(),
    tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    lyrics: form.lyrics.value,
  });
  songs = await api.listSongs();
  editor.close();
  selectSong(saved.id);
});

$('#edDelete').onclick = async () => {
  if (!editing || !confirm(`Excluir "${editing.title}" do banco de músicas?`)) return;
  await api.deleteSong(editing.id);
  songs = await api.listSongs();
  if (selectedId === editing.id) selectedId = null;
  if (live?.songId === editing.id) live = null;
  editor.close();
  renderSongList();
  renderSlides();
};

$('#newSong').onclick = () => openEditor(null);
$('#editSong').onclick = () => openEditor(selectedSong());
$('#search').addEventListener('input', renderSongList);

// ---------- fundos ----------

function renderMedia() {
  const activeId = settings.backgroundId || null;
  const none = h(
    'button',
    { className: 'item' + (!activeId ? ' active' : ''), onclick: () => setBackground(null) },
    h('span', { className: 'name', textContent: 'Sem fundo' }),
  );
  $('#mediaList').replaceChildren(
    none,
    ...media.map((m) =>
      h(
        'button',
        {
          className: 'item' + (m.id === activeId ? ' active' : '') + (m.missing ? ' missing' : ''),
          title: m.missing ? `Arquivo não encontrado: ${m.path}` : m.path,
          onclick: () => !m.missing && setBackground(m),
        },
        m.type === 'video'
          ? h('video', { src: m.url + '#t=1', muted: true, preload: 'metadata' })
          : h('img', { src: m.url }),
        h('span', { className: 'name', textContent: m.name }),
        h('span', {
          className: 'rm',
          textContent: '✕',
          title: 'Remover da lista',
          onclick: async (e) => {
            e.stopPropagation();
            if (settings.backgroundId === m.id) setBackground(null);
            media = await api.removeMedia(m.id);
            renderMedia();
          },
        }),
      ),
    ),
  );
}

function setBackground(m) {
  settings.backgroundId = m ? m.id : null;
  show.background = m ? { type: m.type, url: m.url } : null;
  saveSettings();
  renderMedia();
  push();
}

$('#addMedia').onclick = async () => {
  media = await api.addMedia();
  renderMedia();
};

// ---------- aparência do texto ----------

function bindTheme() {
  $('#fontSize').value = show.theme.fontSize;
  $('#dim').value = show.theme.dim;
  $('#uppercase').checked = show.theme.uppercase;
  $('#maxLines').value = String(maxLines());
  $('#fontSize').oninput = (e) => {
    show.theme.fontSize = Number(e.target.value);
    push();
    saveSettings();
  };
  $('#dim').oninput = (e) => {
    show.theme.dim = Number(e.target.value);
    push();
    saveSettings();
  };
  $('#uppercase').onchange = (e) => {
    show.theme.uppercase = e.target.checked;
    push();
    saveSettings();
  };
  $('#maxLines').onchange = (e) => {
    settings.maxLines = Number(e.target.value);
    saveSettings();
    renderSlides();
    // Mantém no telão o slide atual com a nova divisão, se ele ainda existir.
    if (live && live.songId === selectedId && show.content?.type === 'text') goLive(live.index);
  };
}

// ---------- telão ----------

$('#blackBtn').onclick = () => {
  show.black = !show.black;
  push();
};
$('#hideBtn').onclick = () => {
  show.hideText = !show.hideText;
  push();
};

async function renderDisplays(list) {
  const displays = list || (await api.listDisplays());
  const sel = $('#displaySelect');
  const preferred = displays.find((d) => d.id === settings.displayId) || displays.find((d) => !d.primary) || displays[0];
  sel.replaceChildren(...displays.map((d) => h('option', { value: d.id, textContent: d.label, selected: d === preferred })));
}

$('#displaySelect').onchange = (e) => {
  settings.displayId = Number(e.target.value);
  saveSettings();
  if (projectionOpen) api.openProjection(settings.displayId);
};

$('#projBtn').onclick = () => {
  if (projectionOpen) api.closeProjection();
  else api.openProjection(Number($('#displaySelect').value));
};

api.onProjectionStatus((open) => {
  projectionOpen = open;
  $('#projBtn').textContent = open ? 'Fechar projeção' : 'Abrir projeção';
  $('#projBtn').classList.toggle('primary', !open);
  push();
});
api.onDisplaysChanged((list) => renderDisplays(list));

// ---------- abas ----------

document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('#songsPanel').classList.toggle('hidden', b.dataset.tab !== 'songs');
    $('#timerPanel').classList.toggle('hidden', b.dataset.tab !== 'timer');
  };
});

// ---------- timer ----------

const timerRunning = () => timer.endAt != null;

function syncTimer() {
  if (show.content?.type === 'timer') {
    show.content = { type: 'timer', ...timer };
    push();
  }
  $('#tStart').textContent = timerRunning() ? '❚❚ Pausar' : '▶ Iniciar';
}

function setDuration(ms) {
  timer.endAt = null;
  timer.remaining = Math.max(0, ms);
  syncTimer();
}

document.querySelectorAll('.presets button').forEach((b) => {
  b.onclick = () => {
    $('#tMin').value = b.dataset.min;
    $('#tSec').value = 0;
    setDuration(Number(b.dataset.min) * 60000);
  };
});
$('#tSetDur').onclick = () => setDuration((Number($('#tMin').value) * 60 + Number($('#tSec').value)) * 1000);
$('#tSetAt').onclick = () => {
  const [hh, mm] = ($('#tAt').value || '').split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return;
  const end = new Date();
  end.setHours(hh, mm, 0, 0);
  if (end.getTime() <= Date.now()) end.setDate(end.getDate() + 1);
  timer.endAt = end.getTime();
  syncTimer();
};
$('#tStart').onclick = () => {
  if (timerRunning()) {
    timer.remaining = Math.max(0, timer.endAt - Date.now());
    timer.endAt = null;
  } else {
    timer.endAt = Date.now() + timer.remaining;
  }
  syncTimer();
};
const nudge = (ms) => {
  if (timerRunning()) timer.endAt = Math.max(Date.now(), timer.endAt + ms);
  else timer.remaining = Math.max(0, timer.remaining + ms);
  syncTimer();
};
$('#tPlus').onclick = () => nudge(60000);
$('#tMinus').onclick = () => nudge(-60000);
$('#tReset').onclick = () => setDuration(0);
$('#tMsg').oninput = (e) => {
  timer.message = e.target.value;
  syncTimer();
  saveSettings();
};
$('#tEnd').oninput = (e) => {
  timer.endMessage = e.target.value;
  syncTimer();
  saveSettings();
};
$('#tProject').onclick = () => {
  live = null;
  show.content = { type: 'timer', ...timer };
  show.black = false;
  show.hideText = false;
  push();
  renderSlides();
  renderSongList();
};

setInterval(() => {
  const ms = remaining(timer);
  $('#tDisplay').textContent = fmt(ms);
  $('#tDisplay').classList.toggle('warn', ms > 0 && ms <= 60000);
}, 250);

// ---------- teclado ----------

document.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (!editor.open) openEditor(null);
    return;
  }
  if (e.metaKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('#search').focus();
    return;
  }
  if (editor.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  // Passadores de slide enviam PageDown/PageUp.
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) step(1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) step(-1);
  else if (e.key.toLowerCase() === 'b') $('#blackBtn').click();
  else if (e.key.toLowerCase() === 'c' || e.key === 'Escape') $('#hideBtn').click();
  else return;
  e.preventDefault();
});

// ---------- início ----------

(async function init() {
  [songs, media, settings] = await Promise.all([api.listSongs(), api.listMedia(), api.getSettings()]);
  settings = settings || {};
  show.theme = { ...DEFAULT_THEME, ...settings.theme };
  timer.message = settings.timerMessage ?? timer.message;
  timer.endMessage = settings.timerEndMessage ?? '';
  $('#tMsg').value = timer.message;
  $('#tEnd').value = timer.endMessage;
  const bg = media.find((m) => m.id === settings.backgroundId && !m.missing);
  show.background = bg ? { type: bg.type, url: bg.url } : null;
  if (!bg) settings.backgroundId = null;

  bindTheme();
  renderMedia();
  renderSongList();
  renderSlides();
  await renderDisplays();
  projectionOpen = await api.projectionStatus();
  push();
})();
