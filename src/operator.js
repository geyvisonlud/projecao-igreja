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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const DEFAULT_THEME = { fontSize: 8, dim: 0.35, uppercase: false };

let songs = [];
let plans = [];
let media = [];
let settings = {};
let planId = null; // roteiro aberto
let selected = null; // { kind: 'song', id } (biblioteca) ou { kind: 'item', id } (roteiro)
let live = null; // { key, index } do slide que está no telão
let projectionOpen = false;

// Estado enviado ao telão. A pré-visualização desenha exatamente o mesmo objeto.
const show = { black: false, hideText: false, background: null, content: null, theme: { ...DEFAULT_THEME } };
const timer = { endAt: null, remaining: 5 * 60000, message: 'O culto começa em', endMessage: '', itemId: null };

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
      planId,
      theme: show.theme,
      timerMessage: timer.message,
      timerEndMessage: timer.endMessage,
    };
    api.setSettings(settings);
  }, 300);
}

const maxLines = () => Number(settings.maxLines) || 4;
const slidesOf = (text) => parse(text, { maxLines: maxLines() }).slides;
const songById = (id) => songs.find((s) => s.id === id) || null;
const currentPlan = () => plans.find((p) => p.id === planId) || null;
const planItem = (id) => currentPlan()?.items.find((i) => i.id === id) || null;
const songMeta = (s) => [s.artist, s.key && `Tom ${s.key}`].filter(Boolean).join(' · ');

function renderAll() {
  renderPlan();
  renderSongList();
  renderCenter();
}

// ---------- o que está selecionado ----------

// Uma "fonte" é qualquer coisa com slides: música (da biblioteca ou do roteiro) ou aviso.
function sourceOf(sel) {
  if (!sel) return null;
  if (sel.kind === 'song') return songSource(songById(sel.id));
  const item = planItem(sel.id);
  if (!item) return null;
  if (item.type === 'song') return songSource(songById(item.songId));
  if (item.type === 'text') {
    return {
      key: 'item:' + item.id,
      title: item.title || 'Aviso',
      meta: 'Aviso',
      slides: slidesOf(item.text),
      edit: () => openItemDialog(item),
    };
  }
  return null;
}

function songSource(song) {
  if (!song) return null;
  return {
    key: 'song:' + song.id,
    songId: song.id,
    title: song.title,
    meta: [songMeta(song), (song.tags || []).join(', ')].filter(Boolean).join(' · '),
    slides: slidesOf(song.lyrics),
    edit: () => openEditor(song),
  };
}

function select(sel) {
  selected = sel;
  const item = sel?.kind === 'item' ? planItem(sel.id) : null;
  if (item?.type === 'timer') {
    loadTimerItem(item);
    showTab('timer');
  } else {
    showTab('songs');
  }
  renderAll();
  document.querySelector('#planItems li.selected')?.scrollIntoView({ block: 'nearest' });
}

function renderCenter() {
  const src = sourceOf(selected);
  $('#songHead').classList.toggle('hidden', !src);
  $('#emptyState').classList.toggle('hidden', !!src);
  if (!src) return $('#slides').replaceChildren();
  $('#songTitle').textContent = src.title;
  $('#songMeta').textContent = src.meta;
  $('#addToPlan').classList.toggle('hidden', selected.kind !== 'song');
  $('#slides').replaceChildren(
    ...src.slides.map((slide, i) =>
      h(
        'button',
        {
          className: 'slide' + (live && live.key === src.key && live.index === i ? ' live' : ''),
          onclick: () => goLive(i),
        },
        h('div', { className: 'lbl' }, h('span', { textContent: slide.label || ' ' }), h('span', { textContent: i + 1 })),
        h('div', { className: 'txt', textContent: slide.text }),
      ),
    ),
  );
}

function goLive(index) {
  const src = sourceOf(selected);
  if (!src || !src.slides.length) return;
  index = Math.max(0, Math.min(src.slides.length - 1, index));
  live = { key: src.key, index };
  const slide = src.slides[index];
  show.content = { type: 'text', text: slide.text, label: slide.label };
  show.black = false;
  show.hideText = false;
  push();
  renderAll();
  document.querySelectorAll('#slides .slide')[index]?.scrollIntoView({ block: 'nearest' });
}

// Seleciona o item vizinho do roteiro, sem projetar: o próximo "→" projeta o primeiro slide dele.
function moveItem(delta) {
  const plan = currentPlan();
  if (!plan || selected?.kind !== 'item') return;
  const i = plan.items.findIndex((it) => it.id === selected.id);
  const next = plan.items[i + delta];
  if (next) select({ kind: 'item', id: next.id });
}

function step(delta) {
  const src = sourceOf(selected);
  if (!src) return moveItem(delta);
  const onAir = live && live.key === src.key && show.content?.type === 'text';
  if (!onAir) return delta > 0 ? goLive(0) : moveItem(delta);
  const next = live.index + delta;
  if ((next < 0 || next >= src.slides.length) && selected.kind === 'item') return moveItem(delta);
  goLive(next);
}

// ---------- roteiro ----------

function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return localDate(d);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function itemInfo(item) {
  if (item.type === 'song') {
    const s = songById(item.songId);
    return s ? { icon: '♪', title: s.title, sub: songMeta(s) } : { icon: '♪', title: '(música excluída)', sub: '' };
  }
  if (item.type === 'timer') return { icon: '⏱', title: item.message || 'Timer', sub: `Timer · ${item.minutes} min` };
  return { icon: '✎', title: item.title || 'Aviso', sub: (item.text || '').split('\n').find((l) => l.trim()) || '' };
}

function isItemLive(item) {
  if (!live && show.content?.type !== 'timer') return false;
  if (item.type === 'song') return live?.key === 'song:' + item.songId && show.content?.type === 'text';
  if (item.type === 'text') return live?.key === 'item:' + item.id && show.content?.type === 'text';
  return show.content?.type === 'timer' && timer.itemId === item.id;
}

let dragIndex = null;

function renderPlan() {
  const sorted = [...plans].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
  $('#planSelect').replaceChildren(
    ...(sorted.length
      ? sorted.map((p) => h('option', { value: p.id, textContent: `${fmtDate(p.date)} · ${p.name}`, selected: p.id === planId }))
      : [h('option', { textContent: 'Nenhum roteiro ainda', disabled: true, selected: true })]),
  );
  const plan = currentPlan();
  ['#planEdit', '#planDup', '#planDel'].forEach((s) => ($(s).disabled = !plan));
  $('#planEmpty').textContent = !plan
    ? 'Clique em Novo, ou use o + ao lado de uma música da biblioteca.'
    : plan.items.length
      ? ''
      : 'Roteiro vazio. Use o + nas músicas da biblioteca, ou + Timer / + Aviso.';
  $('#planEmpty').classList.toggle('hidden', !!plan && plan.items.length > 0);

  $('#planItems').replaceChildren(
    ...(plan?.items || []).map((item, i) => {
      const info = itemInfo(item);
      const li = h(
        'li',
        {
          className: [
            selected?.kind === 'item' && selected.id === item.id && 'selected',
            isItemLive(item) && 'is-live',
            item.type === 'song' && !songById(item.songId) && 'broken',
          ]
            .filter(Boolean)
            .join(' '),
          draggable: true,
          onclick: () => select({ kind: 'item', id: item.id }),
          ondblclick: () => (item.type === 'song' ? songById(item.songId) && openEditor(songById(item.songId)) : openItemDialog(item)),
          ondragstart: (e) => {
            dragIndex = i;
            e.dataTransfer.effectAllowed = 'move';
            li.classList.add('dragging');
          },
          ondragend: () => li.classList.remove('dragging'),
          ondragover: (e) => {
            e.preventDefault();
            li.classList.add('drop');
          },
          ondragleave: () => li.classList.remove('drop'),
          ondrop: (e) => {
            e.preventDefault();
            li.classList.remove('drop');
            reorderItem(dragIndex, i);
          },
        },
        h('span', { className: 'n', textContent: i + 1 }),
        h('span', { className: 'ic', textContent: info.icon }),
        h('div', { className: 'body' }, h('div', { className: 't', textContent: info.title }), info.sub ? h('div', { className: 's', textContent: info.sub }) : null),
        h('button', {
          className: 'rm',
          textContent: '✕',
          title: 'Tirar do roteiro',
          onclick: (e) => {
            e.stopPropagation();
            removeItem(item.id);
          },
        }),
      );
      return li;
    }),
  );
}

async function savePlan(plan) {
  const i = plans.findIndex((p) => p.id === plan.id);
  if (i >= 0) plans[i] = plan;
  const saved = await api.savePlan(plan);
  const j = plans.findIndex((p) => p.id === saved.id);
  if (j >= 0) plans[j] = saved;
  else plans.push(saved);
  return saved;
}

function openPlanById(id) {
  planId = id;
  if (selected?.kind === 'item') selected = null;
  saveSettings();
  renderAll();
}

async function ensurePlan() {
  if (currentPlan()) return currentPlan();
  const plan = await savePlan({ name: 'Culto', date: nextSunday(), items: [] });
  openPlanById(plan.id);
  return plan;
}

async function addItem(item) {
  const plan = await ensurePlan();
  const full = { id: uid(), ...item };
  await savePlan({ ...plan, items: [...plan.items, full] });
  renderPlan();
  return full;
}

async function addSongToPlan(songId) {
  await addItem({ type: 'song', songId });
  $('#planItems').lastElementChild?.scrollIntoView({ block: 'nearest' });
}

async function removeItem(id) {
  const plan = currentPlan();
  await savePlan({ ...plan, items: plan.items.filter((i) => i.id !== id) });
  if (selected?.kind === 'item' && selected.id === id) selected = null;
  renderAll();
}

async function reorderItem(from, to) {
  const plan = currentPlan();
  if (!plan || from == null || from === to) return;
  const items = [...plan.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  await savePlan({ ...plan, items });
  renderPlan();
}

$('#planSelect').onchange = (e) => openPlanById(e.target.value);

// Diálogo de criar/editar roteiro.
const planDialog = $('#planDialog');
const planForm = $('#planForm');
let planEditing = null; // null = novo; objeto = editar; { copyOf } = duplicar

function openPlanDialog(mode) {
  const plan = currentPlan();
  planEditing = mode === 'new' ? null : mode === 'dup' ? { copyOf: plan } : plan;
  $('#planHeading').textContent = { new: 'Novo roteiro', edit: 'Editar roteiro', dup: 'Duplicar roteiro' }[mode];
  planForm.name.value = mode === 'new' ? '' : plan.name;
  planForm.date.value = mode === 'edit' ? plan.date : nextSunday();
  planDialog.showModal();
  planForm.name.focus();
  planForm.name.select();
}

planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = { name: planForm.name.value.trim(), date: planForm.date.value };
  let plan;
  if (planEditing?.copyOf) {
    plan = { ...fields, items: planEditing.copyOf.items.map((i) => ({ ...i, id: uid() })) };
  } else {
    plan = { ...(planEditing || { items: [] }), ...fields };
  }
  const saved = await savePlan(plan);
  planDialog.close();
  openPlanById(saved.id);
});

$('#planNew').onclick = () => openPlanDialog('new');
$('#planEdit').onclick = () => currentPlan() && openPlanDialog('edit');
$('#planDup').onclick = () => currentPlan() && openPlanDialog('dup');
$('#planDel').onclick = async () => {
  const plan = currentPlan();
  if (!plan || !confirm(`Excluir o roteiro "${plan.name}"? As músicas continuam na biblioteca.`)) return;
  await api.deletePlan(plan.id);
  plans = plans.filter((p) => p.id !== plan.id);
  const next = [...plans].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  openPlanById(next ? next.id : null);
};

// Diálogo de item de timer ou aviso.
const itemDialog = $('#itemDialog');
const itemForm = $('#itemForm');
let itemEditing = null;

function openItemDialog(item) {
  itemEditing = item;
  const type = item.type;
  $('#itemHeading').textContent = type === 'timer' ? 'Timer do roteiro' : 'Aviso';
  itemDialog.querySelectorAll('[data-for]').forEach((el) => el.classList.toggle('hidden', el.dataset.for !== type));
  if (type === 'timer') {
    itemForm.minutes.value = item.minutes;
    itemForm.message.value = item.message || '';
    itemForm.endMessage.value = item.endMessage || '';
  } else {
    itemForm.title.value = item.title || '';
    itemForm.text.value = item.text || '';
    $('#itemCount').textContent = slidesOf(item.text || '').length;
  }
  itemDialog.showModal();
  (type === 'timer' ? itemForm.minutes : itemForm.title).focus();
}

itemForm.text.addEventListener('input', () => ($('#itemCount').textContent = slidesOf(itemForm.text.value).length));

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields =
    itemEditing.type === 'timer'
      ? { minutes: Math.max(0, Number(itemForm.minutes.value) || 0), message: itemForm.message.value, endMessage: itemForm.endMessage.value }
      : { title: itemForm.title.value.trim(), text: itemForm.text.value };
  const updated = { ...itemEditing, ...fields };
  itemDialog.close();
  if (!updated.id) {
    const added = await addItem(updated);
    return select({ kind: 'item', id: added.id });
  }
  const plan = currentPlan();
  await savePlan({ ...plan, items: plan.items.map((i) => (i.id === updated.id ? updated : i)) });
  if (updated.type === 'timer' && timer.itemId === updated.id && !timerRunning()) {
    timer.itemId = null; // força recarregar a duração editada
    loadTimerItem(updated);
  }
  if (live?.key === 'item:' + updated.id && show.content?.type === 'text') {
    goLive(live.index); // atualiza o aviso que está no ar
  }
  renderAll();
});

$('#addTimer').onclick = () =>
  openItemDialog({ type: 'timer', minutes: 5, message: timer.message, endMessage: timer.endMessage });
$('#addAviso').onclick = () => openItemDialog({ type: 'text', title: '', text: '' });

document.querySelectorAll('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

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
          className: [
            selected?.kind === 'song' && selected.id === s.id && 'selected',
            live?.key === 'song:' + s.id && 'is-live',
          ]
            .filter(Boolean)
            .join(' '),
          onclick: () => select({ kind: 'song', id: s.id }),
          ondblclick: () => openEditor(s),
        },
        h('div', { className: 'body' }, h('div', { className: 't', textContent: s.title }), songMeta(s) ? h('div', { className: 's', textContent: songMeta(s) }) : null),
        h('button', {
          className: 'add',
          textContent: '+',
          title: 'Adicionar ao roteiro',
          onclick: (e) => {
            e.stopPropagation();
            addSongToPlan(s.id);
          },
        }),
      ),
    ),
  );
  $('#songCount').textContent = q ? `${list.length} de ${songs.length} músicas` : `${songs.length} músicas no banco`;
}

$('#search').addEventListener('input', renderSongList);
$('#addToPlan').onclick = () => selected?.kind === 'song' && addSongToPlan(selected.id);

// ---------- editor de música ----------

const editor = $('#editor');
const form = $('#editorForm');
let editing = null;

function renderEditorPreview() {
  const slides = slidesOf(form.lyrics.value);
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
  // Editando a partir do roteiro, continua no item do roteiro.
  if (editing && selected?.kind === 'item') renderAll();
  else select({ kind: 'song', id: saved.id });
});

$('#edDelete').onclick = async () => {
  if (!editing || !confirm(`Excluir "${editing.title}" do banco de músicas?`)) return;
  await api.deleteSong(editing.id);
  songs = await api.listSongs();
  if (selected?.kind === 'song' && selected.id === editing.id) selected = null;
  if (live?.key === 'song:' + editing.id) live = null;
  editor.close();
  renderAll();
};

$('#newSong').onclick = () => openEditor(null);
$('#editSong').onclick = () => sourceOf(selected)?.edit();

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
    renderCenter();
    // Mantém no telão o slide atual com a nova divisão, se ele ainda existir.
    if (live && live.key === sourceOf(selected)?.key && show.content?.type === 'text') goLive(live.index);
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

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $('#songsPanel').classList.toggle('hidden', name !== 'songs');
  $('#timerPanel').classList.toggle('hidden', name !== 'timer');
}

document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- timer ----------

const timerRunning = () => timer.endAt != null;

function syncTimer() {
  if (show.content?.type === 'timer') {
    show.content = { type: 'timer', ...timer };
    push();
  }
  $('#tStart').textContent = timerRunning() ? '❚❚ Pausar' : '▶ Iniciar';
  $('#tMsg').value = timer.message;
  $('#tEnd').value = timer.endMessage;
}

function setDuration(ms) {
  timer.endAt = null;
  timer.remaining = Math.max(0, ms);
  syncTimer();
}

// Selecionar um timer do roteiro carrega a configuração dele, sem iniciar.
// Se esse mesmo timer já está correndo, não mexe.
function loadTimerItem(item) {
  if (timer.itemId === item.id && timerRunning()) return;
  timer.itemId = item.id;
  timer.message = item.message || '';
  timer.endMessage = item.endMessage || '';
  $('#tMin').value = Math.floor(item.minutes);
  $('#tSec').value = Math.round((item.minutes % 1) * 60);
  setDuration(item.minutes * 60000);
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
  renderAll();
};

setInterval(() => {
  const ms = remaining(timer);
  $('#tDisplay').textContent = fmt(ms);
  $('#tDisplay').classList.toggle('warn', ms > 0 && ms <= 60000);
}, 250);

// ---------- teclado ----------

document.addEventListener('keydown', (e) => {
  const dialogOpen = !!document.querySelector('dialog[open]');
  if (e.metaKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (!dialogOpen) openEditor(null);
    return;
  }
  if (e.metaKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (!dialogOpen) $('#search').focus();
    return;
  }
  if (dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
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
  [songs, plans, media, settings] = await Promise.all([api.listSongs(), api.listPlans(), api.listMedia(), api.getSettings()]);
  settings = settings || {};
  show.theme = { ...DEFAULT_THEME, ...settings.theme };
  timer.message = settings.timerMessage ?? timer.message;
  timer.endMessage = settings.timerEndMessage ?? '';
  const bg = media.find((m) => m.id === settings.backgroundId && !m.missing);
  show.background = bg ? { type: bg.type, url: bg.url } : null;
  if (!bg) settings.backgroundId = null;
  // Abre o último roteiro usado ou, se não houver, o de data mais recente.
  planId = plans.some((p) => p.id === settings.planId)
    ? settings.planId
    : [...plans].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]?.id || null;

  bindTheme();
  renderMedia();
  syncTimer();
  renderAll();
  await renderDisplays();
  projectionOpen = await api.projectionStatus();
  push();
})();
