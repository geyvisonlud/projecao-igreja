// Comando: a janela do operador.
// `api` é exposto pelo preload (contextBridge); redeclará-lo aqui quebra o script no Electron.
const { parse, normalize } = window.Lyrics;
const { fmt, remaining } = window.ScreenView;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function h(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...children.filter((c) => c != null));
  return n;
}
const icon = (name) => {
  const s = document.createElement('span');
  s.innerHTML = Icons.svg(name);
  return s.firstChild;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clock = (sec) => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '0:00');

const DEFAULT_THEME = { fontSize: 8, dim: 0.35, uppercase: false };
const DEFAULT_WATERMARK = { enabled: true, mediaId: null, size: 12, opacity: 0.35 };
const DEFAULT_CAPTION = { direction: 'pt-en', micId: '', size: 5, lines: 2, color: '#ffd60a', background: '#000000', backgroundOpacity: 0.85 };
const MEDIA_LABEL = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio' };

let songs = [];
let plans = [];
let media = [];
let settings = {};
let planId = null; // roteiro aberto
let selected = null; // { kind: 'song', id } (biblioteca) ou { kind: 'item', id } (roteiro)
let view = 'slides'; // slides | songs | media | timer | audio
let live = null; // o que está no Palco: { key, index, src, itemId }
let outputs = { palco: false, retorno: false };
let mediaSeq = 0; // muda a cada vez que um vídeo entra no ar, para recomeçá-lo
let mediaFilter = 'all';
let selectedMediaId = null;
let defaultLogoUrl = null;

// Estado enviado às saídas. As prévias desenham exatamente o mesmo objeto.
const show = { black: false, hideText: false, background: null, content: null, theme: { ...DEFAULT_THEME } };
const timer = { endAt: null, remaining: 5 * 60000, message: 'O culto começa em', endMessage: '', itemId: null };

if (new URLSearchParams(location.search).get('platform') === 'darwin') document.body.classList.add('mac');
Icons.fill();
const preview = ScreenView.create($('#preview'));
const stagePreview = StageView.create($('#stagePreview'));

function push() {
  const state = JSON.parse(JSON.stringify({ ...show, timer, stage: stageInfo(), watermark: watermarkState(), caption: captionState() }));
  api.updateShow(state);
  preview.update(state);
  stagePreview.update(state);
  $('#blackBtn').classList.toggle('on', show.black);
  $('#hideBtn').classList.toggle('on', show.hideText);
  for (const role of ['palco', 'retorno']) {
    $(`#out${role === 'palco' ? 'Palco' : 'Retorno'}`).classList.toggle('on', outputs[role]);
    const badge = $(`#${role}Badge`);
    badge.textContent = outputs[role] ? 'No ar' : 'Desligado';
    badge.classList.toggle('on', outputs[role]);
  }
  $('#palcoMonitor').classList.toggle('on-air', outputs.palco);
  $('#captionBtn').classList.toggle('on', captions.running);
  const video = show.content?.type === 'media' && show.content.mediaType === 'video';
  $('#videoControls').classList.toggle('hidden', !video);
  if (video) $('#vPlay').textContent = show.content.playing ? 'Pausar vídeo' : 'Continuar vídeo';
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    settings = { ...settings, planId, theme: show.theme, timerMessage: timer.message, timerEndMessage: timer.endMessage };
    api.setSettings(settings);
  }, 300);
}

const maxLines = () => Number(settings.maxLines) || 4;
const slidesOf = (text) => parse(text, { maxLines: maxLines() }).slides;
const songById = (id) => songs.find((s) => s.id === id) || null;
const mediaById = (id) => media.find((m) => m.id === id) || null;
const currentPlan = () => plans.find((p) => p.id === planId) || null;
const planItem = (id) => currentPlan()?.items.find((i) => i.id === id) || null;
const onAirSlide = () => ['text', 'media'].includes(show.content?.type);
const songMeta = (s) => [s.artist, s.key && `Tom ${s.key}`].filter(Boolean).join(' · ');
const libraryMedia = () => media.filter((m) => m.role !== 'slide');

function renderAll() {
  renderPlan();
  renderNav();
  renderSongList();
  renderCenter();
  renderMediaGrid();
}

// ---------- views ----------

function showView(name) {
  view = name;
  for (const v of ['slides', 'songs', 'media', 'timer', 'audio']) {
    $(`#view${v[0].toUpperCase() + v.slice(1)}`).classList.toggle('hidden', v !== name);
  }
  renderNav();
}

function renderNav() {
  const itemSelected = selected?.kind === 'item';
  $$('.sidebar .nav').forEach((li) => {
    const v = li.dataset.view;
    li.classList.toggle('selected', !itemSelected && (view === v || (v === 'songs' && view === 'slides' && selected?.kind === 'song')));
  });
  $('#songBadge').textContent = songs.length || '';
  $('#mediaBadge').textContent = libraryMedia().filter((m) => !m.builtin).length || '';
}

$$('.sidebar .nav').forEach((li) => {
  li.onclick = () => {
    if (selected?.kind === 'item') selected = null;
    showView(li.dataset.view);
    renderAll();
  };
});
$$('[data-goto]').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    showView(a.dataset.goto);
  };
});
$('#backBtn').onclick = () => {
  selected = null;
  showView('songs');
  renderAll();
};

// ---------- o que está selecionado ----------

// Uma "fonte" é qualquer coisa com slides: música (da biblioteca ou do roteiro) ou item de telas.
function sourceOf(sel) {
  if (!sel) return null;
  if (sel.kind === 'song') return songSource(songById(sel.id));
  const item = planItem(sel.id);
  if (!item) return null;
  if (item.type === 'song') return songSource(songById(item.songId));
  if (item.type === 'slides') {
    return {
      key: 'item:' + item.id,
      title: item.title || 'Telas',
      meta: `Telas · ${plural(item.slides.length, 'slide', 'slides')}`,
      slides: item.slides.map(slideView),
      edit: () => openSlidesDialog(item),
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

// Slide de um item de telas no formato usado pelos cartões e pelo telão.
function slideView(slide) {
  if (slide.type === 'text') return { label: '', text: slide.text };
  const m = mediaById(slide.mediaId);
  return { label: m ? m.name : '(arquivo removido)', mediaType: slide.type, url: m?.url, loop: !!slide.loop, missing: !m || m.missing };
}

// Miniatura 16:9 de um slide (texto, imagem ou vídeo).
function face(view) {
  if (view.mediaType && view.missing) return h('div', { className: 'face missing', textContent: 'Arquivo não encontrado' });
  if (!view.mediaType) return h('div', { className: 'face' }, h('div', { className: 'txt', textContent: view.text }));
  return h(
    'div',
    { className: 'face' },
    view.mediaType === 'video' ? h('video', { src: view.url + '#t=0.5', muted: true, preload: 'metadata' }) : h('img', { src: view.url, loading: 'lazy' }),
    view.mediaType === 'video' ? h('span', { className: 'badge-video' }, icon('play'), view.loop ? 'Vídeo · repete' : 'Vídeo') : null,
  );
}

function slideCard(view, i, { live: isLive = false, onclick } = {}) {
  return h(
    onclick ? 'button' : 'div',
    { className: 'slide' + (isLive ? ' live' : ''), onclick },
    face(view),
    h('div', { className: 'cap' }, h('span', { className: 'lbl', textContent: view.label || ' ' }), h('span', { className: 'num', textContent: i + 1 })),
  );
}

function select(sel) {
  selected = sel;
  const item = sel?.kind === 'item' ? planItem(sel.id) : null;
  if (item?.type === 'timer') {
    loadTimerItem(item);
    showView('timer');
  } else if (item?.type === 'audio') {
    showView('audio');
  } else {
    showView('slides');
  }
  renderAll();
  document.querySelector('#planItems li.selected')?.scrollIntoView({ block: 'nearest' });
}

function renderCenter() {
  if (view === 'audio') return renderAudioView();
  const src = sourceOf(selected);
  $('#viewSlides .view-head').classList.toggle('hidden', !src);
  $('#emptyState').classList.toggle('hidden', !!src);
  if (!src) return $('#slides').replaceChildren();
  $('#songTitle').textContent = src.title;
  $('#songMeta').textContent = src.meta;
  $('#backBtn').classList.toggle('hidden', selected.kind !== 'song');
  $('#addToPlan').classList.toggle('hidden', selected.kind !== 'song');
  $('#slides').replaceChildren(
    ...src.slides.map((slide, i) => slideCard(slide, i, { live: live?.key === src.key && live.index === i, onclick: () => goLive(i) })),
  );
}

function goLive(index) {
  const src = sourceOf(selected);
  if (!src) return;
  liveFrom(src, index, selected.kind === 'item' ? selected.id : null);
}

function liveFrom(src, index, itemId = null) {
  if (!src.slides.length) return;
  index = Math.max(0, Math.min(src.slides.length - 1, index));
  const slide = src.slides[index];
  if (slide.mediaType && slide.missing) return;
  live = { key: src.key, index, src, itemId };
  show.content = slide.mediaType
    ? { type: 'media', mediaType: slide.mediaType, url: slide.url, loop: slide.loop, playing: true, seq: ++mediaSeq }
    : { type: 'text', text: slide.text, label: slide.label };
  show.black = false;
  show.hideText = false;
  push();
  renderAll();
  document.querySelectorAll('#slides .slide')[index]?.scrollIntoView({ block: 'nearest' });
}

// O que o Retorno mostra: título e parte atuais, slide atual e o próximo.
function stageInfo() {
  const part = (sl) => (sl.mediaType ? { mediaType: sl.mediaType, name: sl.label } : { text: sl.text });
  if (show.content?.type === 'timer') return { title: timer.message || 'Timer', current: null, next: nextItemPreview(timer.itemId) };
  if (!live || !onAirSlide()) return {};
  const { src, index, itemId } = live;
  const cur = src.slides[index];
  const following = src.slides[index + 1];
  return {
    title: src.title,
    label: cur?.label && !cur.mediaType ? cur.label : '',
    current: cur ? part(cur) : null,
    next: following ? part(following) : nextItemPreview(itemId),
  };
}

function nextItemPreview(itemId) {
  const plan = currentPlan();
  if (!plan || !itemId) return null;
  const i = plan.items.findIndex((it) => it.id === itemId);
  const next = plan.items[i + 1];
  if (!next) return null;
  const info = itemInfo(next);
  const src = sourceOf({ kind: 'item', id: next.id });
  const first = src?.slides[0];
  if (!first) return { title: info.title, text: info.sub };
  return first.mediaType ? { title: info.title, mediaType: first.mediaType, name: first.label } : { title: info.title, text: first.text };
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
  const onAir = live && live.key === src.key && onAirSlide();
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

// Próxima data no mesmo dia da semana do roteiro mais recente (sábado, se ainda não houver).
function nextServiceDate() {
  const last = [...plans].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const weekday = last?.date ? new Date(last.date + 'T12:00').getDay() : 6;
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return localDate(d);
}

function fmtDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', opts);
}

function itemInfo(item) {
  if (item.type === 'song') {
    const s = songById(item.songId);
    return s ? { icon: 'music', title: s.title, sub: songMeta(s) } : { icon: 'music', title: '(música excluída)', sub: '' };
  }
  if (item.type === 'timer') return { icon: 'timer', title: item.message || 'Timer', sub: `Timer · ${item.minutes} min` };
  if (item.type === 'audio') {
    const m = mediaById(item.mediaId);
    return { icon: 'waveform', title: m ? m.name : '(áudio excluído)', sub: 'Áudio' };
  }
  return { icon: 'rectangles', title: item.title || 'Telas', sub: `Telas · ${plural(item.slides.length, 'slide', 'slides')}` };
}

function isItemLive(item) {
  if (item.type === 'song') return live?.key === 'song:' + item.songId && onAirSlide();
  if (item.type === 'slides') return live?.key === 'item:' + item.id && onAirSlide();
  if (item.type === 'audio') return nowPlaying?.id === item.mediaId && !audio.paused;
  return show.content?.type === 'timer' && timer.itemId === item.id;
}

const sortedPlans = () => [...plans].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
let dragIndex = null;
const isPlanDrag = (e) => e.dataTransfer.types.includes('application/x-song-id') || e.dataTransfer.types.includes('application/x-plan-index');

function renderPlan() {
  const plan = currentPlan();
  $('#planTitle').textContent = plan ? plan.name : 'Nenhum roteiro';
  const date = plan ? fmtDate(plan.date) : 'Clique para criar';
  $('#planDate').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  $('#planEmpty').textContent = !plan
    ? 'Use o + para começar um roteiro.'
    : plan.items.length
      ? ''
      : 'Roteiro vazio. Use o + ou arraste músicas para cá.';
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
            info.title.startsWith('(') && 'broken',
          ]
            .filter(Boolean)
            .join(' '),
          draggable: true,
          onclick: () => select({ kind: 'item', id: item.id }),
          ondblclick: () => editItem(item),
          oncontextmenu: async (e) => {
            e.preventDefault();
            const choice = await api.popupMenu([
              { id: 'edit', label: 'Editar…' },
              { type: 'separator' },
              { id: 'remove', label: 'Tirar do roteiro' },
            ]);
            if (choice === 'edit') editItem(item);
            if (choice === 'remove') removeItem(item.id);
          },
          ondragstart: (e) => {
            dragIndex = i;
            e.dataTransfer.setData('application/x-plan-index', String(i));
            e.dataTransfer.effectAllowed = 'move';
            li.classList.add('dragging');
          },
          ondragend: () => li.classList.remove('dragging'),
          ondragover: (e) => {
            if (!isPlanDrag(e)) return;
            e.preventDefault();
            li.classList.add('drop');
          },
          ondragleave: () => li.classList.remove('drop'),
          ondrop: (e) => {
            if (!isPlanDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            li.classList.remove('drop');
            const songId = e.dataTransfer.getData('application/x-song-id');
            if (songId) addSongToPlan(songId, i);
            else reorderItem(dragIndex, i);
          },
        },
        h('span', { className: 'n', textContent: i + 1 }),
        h('span', { className: 'ic' }, icon(info.icon)),
        h('div', { className: 'body' }, h('div', { className: 't', textContent: info.title }), info.sub ? h('div', { className: 's', textContent: info.sub }) : null),
      );
      return li;
    }),
  );
}

function editItem(item) {
  if (item.type === 'song') return songById(item.songId) && openEditor(songById(item.songId));
  if (item.type === 'slides') return openSlidesDialog(item);
  if (item.type === 'timer') return openItemDialog(item);
}

// Soltar uma música no espaço vazio do roteiro adiciona no fim.
for (const el of [$('#planItems'), $('#planEmpty')]) {
  el.addEventListener('dragover', (e) => isPlanDrag(e) && e.preventDefault());
  el.addEventListener('drop', (e) => {
    const songId = e.dataTransfer.getData('application/x-song-id');
    if (!songId) return;
    e.preventDefault();
    addSongToPlan(songId);
  });
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
  const plan = await savePlan({ name: 'Culto', date: nextServiceDate(), items: [] });
  openPlanById(plan.id);
  return plan;
}

async function addItem(item, index) {
  const plan = await ensurePlan();
  const full = { id: uid(), ...item };
  const items = [...plan.items];
  items.splice(index ?? items.length, 0, full);
  await savePlan({ ...plan, items });
  renderPlan();
  return full;
}

async function addSongToPlan(songId, index) {
  await addItem({ type: 'song', songId }, index);
  if (index == null) $('#planItems').lastElementChild?.scrollIntoView({ block: 'nearest' });
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

async function replaceItem(updated) {
  const plan = currentPlan();
  await savePlan({ ...plan, items: plan.items.map((i) => (i.id === updated.id ? updated : i)) });
}

// Menu do título: trocar de roteiro e criar/editar/duplicar/excluir.
$('#planMenu').onclick = async () => {
  const plan = currentPlan();
  const choice = await api.popupMenu([
    ...sortedPlans()
      .slice(0, 20)
      .map((p) => ({ id: 'open:' + p.id, label: `${p.name} — ${fmtDate(p.date, { day: '2-digit', month: '2-digit' })}`, checked: p.id === planId })),
    ...(plans.length ? [{ type: 'separator' }] : []),
    { id: 'new', label: 'Novo roteiro…' },
    { id: 'edit', label: 'Editar nome e data…', enabled: !!plan },
    { id: 'dup', label: 'Duplicar roteiro…', enabled: !!plan },
    { type: 'separator' },
    { id: 'delete', label: 'Excluir roteiro…', enabled: !!plan },
  ]);
  if (!choice) return;
  if (choice.startsWith('open:')) return openPlanById(choice.slice(5));
  if (choice === 'delete') return deletePlan();
  openPlanDialog(choice);
};

async function deletePlan() {
  const plan = currentPlan();
  if (!plan || !confirm(`Excluir o roteiro "${plan.name}"? As músicas e arquivos continuam na biblioteca.`)) return;
  await api.deletePlan(plan.id);
  plans = plans.filter((p) => p.id !== plan.id);
  openPlanById(sortedPlans()[0]?.id || null);
}

// Botão + do roteiro.
$('#addItemBtn').onclick = async () => {
  const audios = libraryMedia().filter((m) => m.type === 'audio');
  const choice = await api.popupMenu([
    { id: 'song', label: 'Música…' },
    { id: 'timer', label: 'Timer…' },
    { id: 'slides', label: 'Telas (texto, imagem, vídeo, PowerPoint)…' },
    {
      label: 'Áudio',
      submenu: audios.length ? audios.map((m) => ({ id: 'audio:' + m.id, label: m.name })) : [{ id: 'none', label: 'Nenhum áudio na biblioteca', enabled: false }],
    },
  ]);
  if (choice === 'song') {
    showView('songs');
    $('#search').focus();
  } else if (choice === 'timer') openItemDialog({ type: 'timer', minutes: 5, message: timer.message, endMessage: timer.endMessage });
  else if (choice === 'slides') openSlidesDialog({ type: 'slides', title: '', slides: [] });
  else if (choice?.startsWith('audio:')) {
    const added = await addItem({ type: 'audio', mediaId: choice.slice(6) });
    select({ kind: 'item', id: added.id });
  }
};

// Folha de criar/editar/duplicar roteiro.
const planDialog = $('#planDialog');
const planForm = $('#planForm');
let planEditing = null; // null = novo; objeto = editar; { copyOf } = duplicar

function openPlanDialog(mode) {
  const plan = currentPlan();
  planEditing = mode === 'new' ? null : mode === 'dup' ? { copyOf: plan } : plan;
  $('#planHeading').textContent = { new: 'Novo roteiro', edit: 'Editar roteiro', dup: 'Duplicar roteiro' }[mode];
  planForm.name.value = mode === 'new' ? '' : plan.name;
  planForm.date.value = mode === 'edit' ? plan.date : nextServiceDate();
  planDialog.showModal();
  planForm.name.focus();
  planForm.name.select();
}

planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = { name: planForm.name.value.trim(), date: planForm.date.value };
  const plan = planEditing?.copyOf
    ? { ...fields, items: planEditing.copyOf.items.map((i) => ({ ...i, id: uid() })) }
    : { ...(planEditing || { items: [] }), ...fields };
  const saved = await savePlan(plan);
  planDialog.close();
  openPlanById(saved.id);
});

// Folha do timer do roteiro.
const itemDialog = $('#itemDialog');
const itemForm = $('#itemForm');
let itemEditing = null;

function openItemDialog(item) {
  itemEditing = item;
  itemForm.minutes.value = item.minutes;
  itemForm.message.value = item.message || '';
  itemForm.endMessage.value = item.endMessage || '';
  itemDialog.showModal();
  itemForm.minutes.focus();
}

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updated = {
    ...itemEditing,
    minutes: Math.max(0, Number(itemForm.minutes.value) || 0),
    message: itemForm.message.value,
    endMessage: itemForm.endMessage.value,
  };
  itemDialog.close();
  if (!updated.id) {
    const added = await addItem(updated);
    return select({ kind: 'item', id: added.id });
  }
  await replaceItem(updated);
  if (timer.itemId === updated.id && !timerRunning()) {
    timer.itemId = null; // força recarregar a duração editada
    loadTimerItem(updated);
  }
  renderAll();
});

document.querySelectorAll('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

// ---------- editor de telas (textos, imagens, vídeos, PowerPoint) ----------

const slidesDialog = $('#slidesDialog');
const slidesForm = $('#slidesForm');
let slidesEditing = null;
let sdSlides = []; // cópia de trabalho; só vai para o roteiro ao salvar

const DOC_EXT = ['pdf', 'ppt', 'pptx', 'key', 'odp'];
const VISUAL_EXT = ['mp4', 'mov', 'm4v', 'webm', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'];
const extOf = (name) => (name.split('.').pop() || '').toLowerCase();

function openSlidesDialog(item) {
  slidesEditing = item;
  sdSlides = item.slides.map((sl) => ({ ...sl }));
  slidesForm.title.value = item.title || '';
  $('#sdStatus').textContent = '';
  renderSdList();
  slidesDialog.showModal();
  slidesForm.title.focus();
}

function moveSd(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= sdSlides.length) return;
  [sdSlides[i], sdSlides[j]] = [sdSlides[j], sdSlides[i]];
  renderSdList();
}

function renderSdList() {
  const list = $('#sdList');
  if (!sdSlides.length) {
    list.replaceChildren(h('div', { className: 'sd-empty', textContent: 'Nenhum slide ainda. Use os botões abaixo ou arraste arquivos para cá.' }));
    return;
  }
  list.replaceChildren(
    ...sdSlides.map((sl, i) => {
      let body;
      if (sl.type === 'text') {
        body = h('textarea', {
          value: sl.text,
          rows: Math.min(8, Math.max(2, sl.text.split('\n').length)),
          placeholder: 'Texto do slide (versículo, título, aviso…)',
          oninput: (e) => (sl.text = e.target.value),
        });
      } else {
        const v = slideView(sl);
        body = h(
          'div',
          { className: 'sd-media' },
          face(v),
          h(
            'div',
            {},
            h('div', { textContent: v.label }),
            sl.type === 'video'
              ? h(
                  'label',
                  { className: 'ins-check small' },
                  h('input', { type: 'checkbox', checked: !!sl.loop, onchange: (e) => (sl.loop = e.target.checked) }),
                  'Repetir em loop',
                )
              : null,
          ),
        );
      }
      return h(
        'div',
        { className: 'sd-row' },
        h('span', { className: 'n', textContent: i + 1 }),
        body,
        h(
          'div',
          { className: 'sd-tools' },
          h('button', { type: 'button', className: 'btn', textContent: '↑', title: 'Subir', onclick: () => moveSd(i, -1) }),
          h('button', { type: 'button', className: 'btn', textContent: '↓', title: 'Descer', onclick: () => moveSd(i, 1) }),
          h('button', {
            type: 'button',
            className: 'btn danger',
            textContent: '✕',
            title: 'Remover',
            onclick: () => {
              sdSlides.splice(i, 1);
              renderSdList();
            },
          }),
        ),
      );
    }),
  );
}

function addMediaSlides(items) {
  for (const m of items) if (m.type !== 'audio') sdSlides.push({ id: uid(), type: m.type, mediaId: m.id, loop: false });
  renderSdList();
  $('#sdList').lastElementChild?.scrollIntoView({ block: 'nearest' });
}

// Converte cada página do PDF numa imagem de 1920 px de largura e guarda na pasta de dados.
async function importDoc(doc) {
  if (!doc) return;
  const status = $('#sdStatus');
  if (doc.error) {
    status.textContent = '';
    return alert(doc.error);
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: doc.data }).promise;
    const images = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      status.textContent = `Importando ${doc.name}: página ${p} de ${pdf.numPages}…`;
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1920 / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push({ name: `${doc.name} · ${p}`, data: canvas.toDataURL('image/jpeg', 0.9) });
    }
    const added = await api.saveImages(images);
    media = await api.listMedia();
    addMediaSlides(added);
    status.textContent = `${plural(added.length, 'página importada', 'páginas importadas')} de "${doc.name}".`;
  } catch (e) {
    status.textContent = '';
    alert('Não consegui ler o arquivo: ' + e.message);
  }
}

async function importFiles(files) {
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
  const mediaPaths = paths.filter((p) => VISUAL_EXT.includes(extOf(p)));
  const docPaths = paths.filter((p) => DOC_EXT.includes(extOf(p)));
  if (mediaPaths.length) {
    $('#sdStatus').textContent = 'Copiando arquivos…';
    const added = await api.importMedia(mediaPaths, 'library');
    media = await api.listMedia();
    addMediaSlides(added);
    $('#sdStatus').textContent = '';
  }
  for (const p of docPaths) {
    $('#sdStatus').textContent = 'Convertendo apresentação…';
    await importDoc(await api.readDoc(p));
  }
}

$('#sdText').onclick = () => {
  sdSlides.push({ id: uid(), type: 'text', text: '' });
  renderSdList();
  $('#sdList').lastElementChild?.querySelector('textarea')?.focus();
};
$('#sdMedia').onclick = async () => {
  const added = await api.pickMedia('library', ['image', 'video']);
  media = await api.listMedia();
  addMediaSlides(added);
};
$('#sdDoc').onclick = async () => {
  $('#sdStatus').textContent = 'Abrindo apresentação…';
  const doc = await api.pickDoc();
  $('#sdStatus').textContent = '';
  await importDoc(doc);
};
$('#sdLibrary').onclick = async () => addMediaSlides(await pickFromLibrary());

slidesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Texto com linha em branco vira vários slides; textos vazios são descartados.
  const slides = sdSlides.flatMap((sl) =>
    sl.type !== 'text'
      ? [sl]
      : sl.text
          .split(/\n[ \t]*\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text, k) => ({ id: k ? uid() : sl.id, type: 'text', text })),
  );
  const updated = { ...slidesEditing, title: slidesForm.title.value.trim(), slides };
  slidesDialog.close();
  if (!updated.id) {
    const added = await addItem(updated);
    return select({ kind: 'item', id: added.id });
  }
  await replaceItem(updated);
  renderAll();
});

// Folha "Escolher da biblioteca": devolve as imagens/vídeos marcados, na ordem em que foram marcados.
function pickFromLibrary() {
  return new Promise((resolve) => {
    const dialog = $('#pickerDialog');
    const chosen = [];
    const items = libraryMedia().filter((m) => m.type !== 'audio' && !m.missing);
    const count = () => ($('#pickerCount').textContent = chosen.length ? plural(chosen.length, 'selecionado', 'selecionados') : '');
    $('#pickerGrid').replaceChildren(
      ...items.map((m) => {
        const tile = mediaTile(m, {
          onclick: () => {
            const i = chosen.indexOf(m);
            if (i >= 0) chosen.splice(i, 1);
            else chosen.push(m);
            tile.classList.toggle('selected', chosen.includes(m));
            count();
          },
        });
        return tile;
      }),
    );
    count();
    const form = $('#pickerForm');
    form.onsubmit = (e) => {
      e.preventDefault();
      dialog.close('ok');
    };
    // Fechar com Esc ou Cancelar não adiciona nada.
    dialog.onclose = () => resolve(dialog.returnValue === 'ok' ? chosen : []);
    dialog.returnValue = '';
    dialog.showModal();
  });
}

// ---------- músicas ----------

function renderSongList() {
  const q = normalize($('#search').value);
  const list = songs
    .filter((s) => !q || normalize([s.title, s.artist, (s.tags || []).join(' '), s.lyrics].join(' ')).includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  $('#songsEmpty').classList.toggle('hidden', songs.length > 0);
  $('#songList').replaceChildren(
    ...list.map((s) =>
      h(
        'li',
        {
          className: selected?.kind === 'song' && selected.id === s.id ? 'selected' : '',
          onclick: () => select({ kind: 'song', id: s.id }),
          ondblclick: () => openEditor(s),
          draggable: true,
          ondragstart: (e) => {
            e.dataTransfer.setData('application/x-song-id', s.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
        },
        h('span', { className: 'c1', textContent: s.title }),
        h('span', { className: 'c2', textContent: s.artist || '' }),
        h('span', { className: 'c3', textContent: s.key ? `Tom ${s.key}` : '' }),
        h(
          'button',
          {
            className: 'add',
            title: 'Adicionar ao roteiro',
            onclick: (e) => {
              e.stopPropagation();
              addSongToPlan(s.id);
            },
          },
          icon('plus'),
        ),
      ),
    ),
  );
  $('#songCount').textContent = q ? `${list.length} de ${plural(songs.length, 'música', 'músicas')}` : plural(songs.length, 'música', 'músicas');
}

$('#search').addEventListener('input', renderSongList);
$('#addToPlan').onclick = () => selected?.kind === 'song' && addSongToPlan(selected.id);

const editor = $('#editor');
const form = $('#editorForm');
let editing = null;

function renderEditorPreview() {
  const slides = slidesOf(form.lyrics.value);
  $('#edCount').textContent = slides.length;
  $('#edSlides').replaceChildren(...slides.map((s, i) => slideCard(s, i)));
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
  if (selected?.kind === 'song' && selected.id === editing.id) {
    selected = null;
    showView('songs');
  }
  if (live?.key === 'song:' + editing.id) live = null;
  editor.close();
  renderAll();
};

$('#newSong').onclick = () => openEditor(null);
$('#editSong').onclick = () => sourceOf(selected)?.edit();

// ---------- biblioteca de mídia ----------

function mediaTile(m, { onclick, ondblclick, oncontextmenu } = {}) {
  const thumb =
    m.type === 'audio'
      ? h('div', { className: 'thumb audio' }, icon('waveform'))
      : h(
          'div',
          { className: 'thumb' },
          m.type === 'video' ? h('video', { src: m.url + '#t=1', muted: true, preload: 'metadata' }) : h('img', { src: m.url, loading: 'lazy' }),
        );
  if (m.type === 'video') thumb.append(h('span', { className: 'kind' }, icon('video'), 'Vídeo'));
  if (oncontextmenu) {
    thumb.append(
      h(
        'button',
        {
          className: 'more',
          title: 'Opções',
          onclick: (e) => {
            e.stopPropagation();
            oncontextmenu(e);
          },
        },
        icon('ellipsis'),
      ),
    );
  }
  const sub = [MEDIA_LABEL[m.type], m.builtin ? 'Incluso no app' : m.role === 'background' ? 'Fundo' : ''].filter(Boolean).join(' · ');
  return h(
    'button',
    {
      type: 'button',
      className: 'tile' + (m.missing ? ' missing' : ''),
      title: m.missing ? 'Arquivo não encontrado na pasta de dados' : m.name,
      onclick,
      ondblclick,
      oncontextmenu: oncontextmenu
        ? (e) => {
            e.preventDefault();
            oncontextmenu(e);
          }
        : undefined,
    },
    thumb,
    h('span', { className: 'name', textContent: m.name }),
    h('span', { className: 'sub', textContent: sub }),
  );
}

function renderMediaGrid() {
  const all = libraryMedia();
  const list = all.filter((m) => mediaFilter === 'all' || m.type === mediaFilter);
  $('#mediaCount').textContent = plural(all.length, 'arquivo', 'arquivos');
  $('#mediaEmpty').classList.toggle('hidden', list.length > 0);
  $('#mediaGrid').replaceChildren(
    ...list.map((m) => {
      const tile = mediaTile(m, {
        onclick: () => {
          selectedMediaId = m.id;
          renderMediaGrid();
        },
        ondblclick: () => primaryMediaAction(m),
        oncontextmenu: () => mediaMenu(m),
      });
      tile.classList.toggle('selected', selectedMediaId === m.id);
      tile.classList.toggle('live', live?.key === 'media:' + m.id && onAirSlide());
      tile.classList.toggle('playing', nowPlaying?.id === m.id && !audio.paused);
      return tile;
    }),
  );
}

function primaryMediaAction(m) {
  if (m.missing) return;
  if (m.type === 'audio') return toggleAudio(m);
  showMediaOnPalco(m);
}

function showMediaOnPalco(m) {
  const v = slideView({ type: m.type, mediaId: m.id, loop: m.type === 'video' });
  liveFrom({ key: 'media:' + m.id, title: m.name, slides: [v] }, 0);
}

async function mediaMenu(m) {
  selectedMediaId = m.id;
  renderMediaGrid();
  const visual = m.type !== 'audio';
  const choice = await api.popupMenu([
    visual ? { id: 'show', label: 'Mostrar no Palco', enabled: !m.missing } : { id: 'play', label: 'Tocar', enabled: !m.missing },
    visual ? { id: 'bg', label: 'Usar como fundo', enabled: !m.missing } : null,
    { id: 'plan', label: 'Adicionar ao roteiro' },
    ...(m.builtin ? [] : [{ type: 'separator' }, { id: 'delete', label: 'Excluir da biblioteca…' }]),
  ].filter(Boolean));
  if (choice === 'show') showMediaOnPalco(m);
  if (choice === 'play') toggleAudio(m);
  if (choice === 'bg') {
    if (!m.builtin && m.role !== 'background') media = await api.updateMedia(m.id, { role: 'background' });
    setBackground(mediaById(m.id));
  }
  if (choice === 'plan') {
    const added = await addItem(
      m.type === 'audio' ? { type: 'audio', mediaId: m.id } : { type: 'slides', title: m.name, slides: [{ id: uid(), type: m.type, mediaId: m.id, loop: false }] },
    );
    renderPlan();
    $('#planItems').lastElementChild?.scrollIntoView({ block: 'nearest' });
    return added;
  }
  if (choice === 'delete') {
    if (!confirm(`Excluir "${m.name}" da biblioteca? Slides que usam este arquivo vão ficar sem ele.`)) return;
    if (nowPlaying?.id === m.id) stopAudio();
    if (settings.backgroundId === m.id) setBackground(null);
    media = await api.removeMedia(m.id);
    renderAll();
    renderBackgrounds();
  }
}

$$('#mediaFilter button').forEach((b) => {
  b.onclick = () => {
    mediaFilter = b.dataset.filter;
    $$('#mediaFilter button').forEach((x) => x.classList.toggle('on', x === b));
    renderMediaGrid();
  };
});

$('#uploadMedia').onclick = async () => {
  await api.pickMedia('library');
  media = await api.listMedia();
  renderAll();
};

// Arrastar arquivos do Finder: na biblioteca, no painel de fundos ou na lista de telas.
function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drag-over');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    onFiles([...e.dataTransfer.files]);
  });
}

dropZone($('#viewMedia'), async (files) => {
  const paths = files.map((f) => api.pathForFile(f)).filter((p) => [...VISUAL_EXT, ...AUDIO_EXT].includes(extOf(p)));
  if (!paths.length) return;
  await api.importMedia(paths, 'library');
  media = await api.listMedia();
  renderAll();
});
dropZone($('#mediaList'), async (files) => {
  const paths = files.map((f) => api.pathForFile(f)).filter((p) => VISUAL_EXT.includes(extOf(p)));
  if (!paths.length) return;
  const added = await api.importMedia(paths, 'background');
  media = await api.listMedia();
  renderAll();
  if (added.length) setBackground(added[0]);
});
dropZone($('#sdList'), importFiles);
// Soltar um arquivo fora das áreas certas não deve abrir o arquivo na janela.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// ---------- fundos ----------

function renderBackgrounds() {
  const activeId = settings.backgroundId || null;
  const backgrounds = media.filter((m) => m.role === 'background' && m.type !== 'audio');
  $('#mediaList').replaceChildren(
    h('button', { className: 'bg-item' + (!activeId ? ' active' : ''), title: 'Sem fundo', onclick: () => setBackground(null) }, h('span', { className: 'name', textContent: 'Sem fundo' })),
    ...backgrounds.map((m) =>
      h(
        'button',
        {
          className: 'bg-item' + (m.id === activeId ? ' active' : ''),
          title: m.missing ? 'Arquivo não encontrado' : m.name,
          onclick: () => !m.missing && setBackground(m),
          oncontextmenu: async (e) => {
            e.preventDefault();
            if (m.builtin) return;
            const choice = await api.popupMenu([{ id: 'remove', label: 'Tirar dos fundos' }]);
            if (choice !== 'remove') return;
            if (settings.backgroundId === m.id) setBackground(null);
            media = await api.updateMedia(m.id, { role: 'library' });
            renderBackgrounds();
            renderMediaGrid();
          },
        },
        m.type === 'video' ? h('video', { src: m.url + '#t=1', muted: true, preload: 'metadata' }) : h('img', { src: m.url }),
        h('span', { className: 'name', textContent: m.name }),
      ),
    ),
  );
}

function setBackground(m) {
  settings.backgroundId = m ? m.id : null;
  show.background = m ? { type: m.type, url: m.url } : null;
  saveSettings();
  renderBackgrounds();
  push();
}

$('#addMedia').onclick = async () => {
  const added = await api.pickMedia('background', ['image', 'video']);
  media = await api.listMedia();
  renderAll();
  if (added.length) setBackground(added[0]);
};

$('#vPlay').onclick = () => {
  if (show.content?.type !== 'media') return;
  show.content.playing = !show.content.playing;
  push();
};
$('#vRestart').onclick = () => {
  if (show.content?.type !== 'media') return;
  show.content = { ...show.content, playing: true, seq: ++mediaSeq };
  push();
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

// ---------- telas de saída ----------

$('#blackBtn').onclick = () => {
  show.black = !show.black;
  push();
};
$('#hideBtn').onclick = () => {
  show.hideText = !show.hideText;
  push();
};

for (const btn of $$('.output[data-role]')) {
  btn.onclick = async () => {
    const role = btn.dataset.role;
    const displays = await api.listDisplays();
    const assigned = settings.outputs?.[role];
    const choice = await api.popupMenu([
      { id: 'x', label: role === 'palco' ? 'Mostrar o Palco em:' : 'Mostrar o Retorno em:', enabled: false },
      ...displays.map((d) => ({ id: 'd:' + d.id, label: d.label, checked: outputs[role] && assigned === d.id })),
      { type: 'separator' },
      { id: 'off', label: 'Desligar', enabled: outputs[role] },
    ]);
    if (!choice) return;
    if (choice === 'off') return api.closeOutput(role);
    const id = Number(choice.slice(2));
    settings.outputs = { ...settings.outputs, [role]: id };
    saveSettings();
    api.openOutput(role, id);
  };
}

api.onOutputStatus((status) => {
  outputs = status;
  push();
});

// ---------- logo (marca d'água) nas músicas ----------

const wmSettings = () => ({ ...DEFAULT_WATERMARK, ...settings.watermark });

function watermarkUrl() {
  const m = wmSettings().mediaId && mediaById(wmSettings().mediaId);
  return m && !m.missing ? m.url : defaultLogoUrl;
}

// Só aparece quando a letra de uma música está no Palco.
function watermarkState() {
  const w = wmSettings();
  if (!w.enabled || show.content?.type !== 'text' || !live?.key.startsWith('song:')) return null;
  return { url: watermarkUrl(), size: w.size, opacity: w.opacity };
}

function setWatermark(changes) {
  settings.watermark = { ...wmSettings(), ...changes };
  saveSettings();
  bindWatermark();
  push();
}

function bindWatermark() {
  const w = wmSettings();
  $('#wmEnabled').checked = w.enabled;
  $('#wmSize').value = w.size;
  $('#wmOpacity').value = w.opacity;
  $('#wmThumb').src = watermarkUrl() || '';
  $('#wmReset').classList.toggle('hidden', !w.mediaId);
}

$('#wmEnabled').onchange = (e) => setWatermark({ enabled: e.target.checked });
$('#wmSize').oninput = (e) => setWatermark({ size: Number(e.target.value) });
$('#wmOpacity').oninput = (e) => setWatermark({ opacity: Number(e.target.value) });
$('#wmReset').onclick = () => setWatermark({ mediaId: null });
$('#wmChange').onclick = async () => {
  const [added] = await api.pickMedia('library', ['image']);
  if (!added) return;
  media = await api.listMedia();
  renderMediaGrid();
  setWatermark({ mediaId: added.id });
};

// ---------- tradução simultânea (legenda no Palco) ----------
// Microsoft Azure Speech: ouve o microfone do Mac, transcreve e traduz enquanto a pessoa fala.
// A chave fica no processo principal; aqui só usamos um token temporário.

const capSettings = () => ({ ...DEFAULT_CAPTION, ...settings.caption });

const captions = {
  running: false,
  starting: false,
  rec: null,
  target: 'en',
  finals: [],
  partial: '',
  heard: '',
  tokenTimer: null,

  // O que vai para a faixa: as duas últimas frases traduzidas e a que está sendo falada agora.
  text() {
    return [...this.finals.slice(-2), this.partial].filter(Boolean).join(' ');
  },

  feed(kind, translated, original) {
    if (kind === 'partial') this.partial = translated;
    else {
      if (translated) this.finals = [...this.finals, translated].slice(-4);
      this.partial = '';
    }
    this.heard = original || this.heard;
    renderCaptionPanel();
    schedulePush();
  },

  async start() {
    if (this.running || this.starting) return;
    this.starting = true;
    capStatus('Conectando ao Azure…');
    try {
      if (typeof SpeechSDK === 'undefined') throw new Error('O componente de voz não carregou.');
      if (!(await api.askMicrophone())) {
        throw new Error('Sem permissão para usar o microfone. Libere em Ajustes do Sistema → Privacidade e Segurança → Microfone.');
      }
      const tok = await api.azureToken();
      if (tok.error) throw new Error(tok.error);
      const c = capSettings();
      const [from, to] = c.direction === 'pt-en' ? ['pt-BR', 'en'] : ['en-US', 'pt'];
      const cfg = SpeechSDK.SpeechTranslationConfig.fromAuthorizationToken(tok.token, tok.region);
      cfg.speechRecognitionLanguage = from;
      cfg.addTargetLanguage(to);
      // Evita que palavras já mostradas fiquem trocando enquanto a frase não termina.
      cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_TranslationRequestStablePartialResult, 'true');
      const audioCfg = c.micId ? SpeechSDK.AudioConfig.fromMicrophoneInput(c.micId) : SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      const rec = new SpeechSDK.TranslationRecognizer(cfg, audioCfg);
      rec.recognizing = (_s, e) => this.feed('partial', e.result.translations.get(to) || '', e.result.text);
      rec.recognized = (_s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.TranslatedSpeech) this.feed('final', e.result.translations.get(to) || '', e.result.text);
      };
      rec.canceled = (_s, e) => {
        if (e.reason === SpeechSDK.CancellationReason.Error) this.fail(e.errorDetails);
      };
      await new Promise((resolve, reject) => rec.startContinuousRecognitionAsync(resolve, reject));
      Object.assign(this, { rec, target: to, running: true, finals: [], partial: '', heard: '' });
      // O token vale 10 minutos; renova antes de vencer.
      this.tokenTimer = setInterval(async () => {
        const t = await api.azureToken();
        if (t.token && this.rec) this.rec.authorizationToken = t.token;
      }, 9 * 60 * 1000);
      capStatus(c.direction === 'pt-en' ? 'Ouvindo em português e legendando em inglês.' : 'Ouvindo em inglês e legendando em português.');
      refreshMics();
    } catch (e) {
      this.fail(e?.message || String(e));
    } finally {
      this.starting = false;
      renderCaptionPanel();
      push();
    }
  },

  stop(message = 'Desligada.') {
    clearInterval(this.tokenTimer);
    const rec = this.rec;
    if (rec) rec.stopContinuousRecognitionAsync(() => rec.close(), () => rec.close());
    Object.assign(this, { rec: null, running: false, finals: [], partial: '', heard: '' });
    capStatus(message);
    renderCaptionPanel();
    push();
  },

  fail(details) {
    const msg = /1006|websocket|connection|network/i.test(details || '')
      ? 'Não consegui conectar ao Azure. Confira a internet e a região em Ajustes.'
      : details || 'Erro desconhecido.';
    this.stop();
    capStatus('Erro: ' + msg, true);
  },

  toggle() {
    if (this.running) this.stop();
    else this.start();
  },
};

function capStatus(text, error = false) {
  $('#capStatus').textContent = text;
  $('#capStatus').classList.toggle('error', error);
}

function captionState() {
  if (!captions.running) return null;
  const c = capSettings();
  return {
    text: captions.text(),
    style: { size: c.size, lines: c.lines, color: c.color, background: c.background, backgroundOpacity: c.backgroundOpacity },
  };
}

// As legendas chegam várias vezes por segundo; o telão é atualizado no máximo a cada 120 ms.
let pushQueued = false;
function schedulePush() {
  if (pushQueued) return;
  pushQueued = true;
  setTimeout(() => {
    pushQueued = false;
    push();
  }, 120);
}

function renderCaptionPanel() {
  const c = capSettings();
  $('#capStart').textContent = captions.starting ? 'Conectando…' : captions.running ? 'Parar tradução' : 'Iniciar tradução';
  $('#capStart').classList.toggle('primary', !captions.running);
  $('#capStart').disabled = captions.starting;
  $$('#capDirection button').forEach((b) => b.classList.toggle('on', b.dataset.dir === c.direction));
  $('#capLive').classList.toggle('hidden', !captions.running);
  $('#capHeard').textContent = captions.heard || '…';
  $('#capSaid').textContent = captions.text() || '…';
}

function setCaption(changes, restart = false) {
  settings.caption = { ...capSettings(), ...changes };
  saveSettings();
  bindCaption();
  push();
  if (restart && captions.running) {
    captions.stop();
    captions.start();
  }
}

function bindCaption() {
  const c = capSettings();
  $('#capSize').value = c.size;
  $('#capLines').value = String(c.lines);
  $('#capColor').value = c.color;
  $('#capBg').value = c.background;
  $('#capBgOpacity').value = c.backgroundOpacity;
  $('#capMic').value = c.micId;
  renderCaptionPanel();
}

async function refreshMics() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
    $('#capMic').replaceChildren(
      h('option', { value: '', textContent: 'Padrão do Mac' }),
      ...devices.map((d, i) => h('option', { value: d.deviceId, textContent: d.label || `Microfone ${i + 1}` })),
    );
    $('#capMic').value = capSettings().micId;
  } catch {}
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);

$('#captionBtn').onclick = () => captions.toggle();
$('#capStart').onclick = () => captions.toggle();
$$('#capDirection button').forEach((b) => (b.onclick = () => setCaption({ direction: b.dataset.dir }, true)));
$('#capMic').onchange = (e) => setCaption({ micId: e.target.value }, true);
$('#capSize').oninput = (e) => setCaption({ size: Number(e.target.value) });
$('#capLines').onchange = (e) => setCaption({ lines: Number(e.target.value) });
$('#capColor').oninput = (e) => setCaption({ color: e.target.value });
$('#capBg').oninput = (e) => setCaption({ background: e.target.value });
$('#capBgOpacity').oninput = (e) => setCaption({ backgroundOpacity: Number(e.target.value) });

// ---------- áudio ----------

const audio = $('#audio');
let nowPlaying = null;

function toggleAudio(m) {
  if (nowPlaying?.id === m.id) {
    if (audio.paused) audio.play();
    else audio.pause();
    return;
  }
  nowPlaying = m;
  audio.src = m.url;
  audio.play().catch((e) => alert('Não consegui tocar este áudio: ' + e.message));
  renderPlayer();
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  nowPlaying = null;
  renderPlayer();
  renderPlan();
  renderMediaGrid();
}

function renderPlayer() {
  $('#player').classList.toggle('hidden', !nowPlaying);
  if (nowPlaying) {
    $('#plName').textContent = nowPlaying.name;
    $('#plTime').textContent = clock(audio.currentTime);
    $('#plDur').textContent = clock(audio.duration);
    $('#plSeek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
    const name = audio.paused ? 'play' : 'pause';
    if ($('#plPlay').dataset.icon !== name) Icons.set($('#plPlay'), name);
    $('#plPlay').title = audio.paused ? 'Tocar' : 'Pausar';
  }
  if (view === 'audio') renderAudioView();
}

function selectedAudio() {
  const item = selected?.kind === 'item' ? planItem(selected.id) : null;
  return item?.type === 'audio' ? mediaById(item.mediaId) : null;
}

function renderAudioView() {
  const m = selectedAudio();
  $('#audioTitle').textContent = m ? m.name : '(áudio excluído)';
  const mine = m && nowPlaying?.id === m.id;
  const playing = mine && !audio.paused;
  const btn = $('#audioBigPlay');
  if (btn.dataset.icon !== (playing ? 'pause' : 'play')) Icons.set(btn, playing ? 'pause' : 'play');
  btn.title = playing ? 'Pausar' : 'Tocar';
  $('#audioBigTime').textContent = clock(mine ? audio.currentTime : 0);
  $('#audioBigDur').textContent = clock(mine ? audio.duration : NaN);
  $('#audioBigSeek').value = mine && audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
}

for (const ev of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'ended']) {
  audio.addEventListener(ev, () => {
    renderPlayer();
    if (['play', 'pause', 'ended'].includes(ev)) {
      renderPlan();
      renderMediaGrid();
    }
  });
}
$('#plPlay').onclick = () => nowPlaying && (audio.paused ? audio.play() : audio.pause());
$('#plStop').onclick = stopAudio;
$('#plSeek').oninput = (e) => audio.duration && (audio.currentTime = (e.target.value / 1000) * audio.duration);
$('#plVol').oninput = (e) => (audio.volume = Number(e.target.value));
$('#audioBigPlay').onclick = () => {
  const m = selectedAudio();
  if (m && !m.missing) toggleAudio(m);
};
$('#audioBigSeek').oninput = (e) => {
  const m = selectedAudio();
  if (m && nowPlaying?.id === m.id && audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
};

// ---------- timer ----------

const timerRunning = () => timer.endAt != null;

function renderTimerDisplay() {
  const ms = remaining(timer);
  $('#tDisplay').textContent = fmt(ms);
  $('#tDisplay').classList.toggle('warn', ms > 0 && ms <= 60000);
}
setInterval(renderTimerDisplay, 250);

function syncTimer() {
  if (show.content?.type === 'timer') show.content = { type: 'timer', ...timer };
  push(); // o Retorno mostra o timer mesmo quando ele não está no Palco
  $('#tStart').textContent = timerRunning() ? 'Pausar' : 'Iniciar';
  renderTimerDisplay();
  $('#tMsg').value = timer.message;
  $('#tEnd').value = timer.endMessage;
}

function setDuration(ms) {
  timer.endAt = null;
  timer.remaining = Math.max(0, ms);
  syncTimer();
}

// Selecionar um timer do roteiro carrega a configuração dele, sem iniciar.
// Se algum timer está correndo, não mexe: oferece o botão "Carregar" para trocar quando quiser.
let pendingTimerItem = null;

function loadTimerItem(item, force = false) {
  if (timer.itemId === item.id && timerRunning()) return;
  if (timerRunning() && !force) {
    pendingTimerItem = item;
    $('#tPending').classList.remove('hidden');
    $('#tPendingText').textContent = `Outro timer está correndo. Carregar "${item.message || 'Timer'}" (${item.minutes} min)?`;
    return;
  }
  pendingTimerItem = null;
  $('#tPending').classList.add('hidden');
  timer.itemId = item.id;
  timer.message = item.message || '';
  timer.endMessage = item.endMessage || '';
  $('#tMin').value = Math.floor(item.minutes);
  $('#tSec').value = Math.round((item.minutes % 1) * 60);
  setDuration(item.minutes * 60000);
}

$('#tLoad').onclick = () => {
  if (!pendingTimerItem) return;
  loadTimerItem(pendingTimerItem, true);
  renderPlan();
};

$$('.presets button').forEach((b) => {
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

// ---------- ajustes: onde guardar os dados ----------

const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');
let storage = null;
let customFolder = null;

async function openSettings() {
  storage = await api.getStorage();
  customFolder = storage.mode === 'custom' ? storage.path : null;
  const pretty = (p) => (p && p.startsWith(storage.home) ? '~' + p.slice(storage.home.length) : p);
  $('#stLocal').textContent = pretty(storage.local);
  $('#stDrive').textContent = storage.drive ? pretty(storage.drive) : 'Google Drive para computador não encontrado neste Mac.';
  $('#stDriveGet').classList.toggle('hidden', !!storage.drive);
  settingsForm.querySelector('input[value="drive"]').disabled = !storage.drive;
  $('#stCustom').textContent = pretty(customFolder) || 'Escolher…';
  settingsForm.querySelector(`input[value="${storage.mode}"]`).checked = true;
  const az = await api.getAzure();
  $('#azRegion').value = az.region;
  $('#azKey').value = '';
  $('#azKey').placeholder = az.hasKey ? 'Chave guardada — cole outra para trocar' : 'Cole a chave (Key 1)';
  azureLoaded = az;
  settingsDialog.showModal();
}
let azureLoaded = null;

settingsForm.querySelector('input[value="custom"]').addEventListener('click', async () => {
  const folder = await api.pickStorageFolder();
  if (folder) {
    customFolder = folder;
    $('#stCustom').textContent = folder;
  } else if (!customFolder) {
    settingsForm.querySelector(`input[value="${storage.mode}"]`).checked = true;
  }
});
$('#stDriveGet').onclick = (e) => {
  e.preventDefault();
  api.openExternal('https://www.google.com/drive/download/');
};
$('#stReveal').onclick = () => api.revealStorage();
$('#settingsBtn').onclick = openSettings;

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const region = $('#azRegion').value.trim().toLowerCase();
  const key = $('#azKey').value.trim();
  if (key || region !== azureLoaded.region) await api.setAzure({ region, key: key || undefined });
  const mode = settingsForm.storage.value;
  const target = mode === 'custom' ? customFolder : mode;
  const targetPath = mode === 'local' ? storage.local : mode === 'drive' ? storage.drive : customFolder;
  if (!target || targetPath === storage.path) return settingsDialog.close();
  if (!confirm(`Guardar músicas, roteiros e arquivos em:\n${targetPath}\n\nSe a pasta já tiver dados do app, eles serão usados; senão, os dados atuais serão copiados para lá.`)) return;
  const result = await api.setStorage(target);
  if (result.error) return alert(result.error);
  if (result.adopted) alert('Essa pasta já tinha dados do Projeção Igreja. O app vai usar esses dados.');
  location.reload();
});

// ---------- barra lateral e teclado ----------

function applySidebar() {
  $('.app').classList.toggle('no-sidebar', !!settings.sidebarHidden);
}
$('#sidebarToggle').onclick = () => {
  settings.sidebarHidden = !settings.sidebarHidden;
  applySidebar();
  saveSettings();
};

document.addEventListener('keydown', (e) => {
  const dialogOpen = !!document.querySelector('dialog[open]');
  const key = e.key.toLowerCase();
  if (e.metaKey && key === 'n') {
    e.preventDefault();
    if (!dialogOpen) openEditor(null);
    return;
  }
  if (e.metaKey && key === 'f') {
    e.preventDefault();
    if (dialogOpen) return;
    showView('songs');
    $('#search').focus();
    return;
  }
  if (e.metaKey && key === ',') {
    e.preventDefault();
    if (!dialogOpen) openSettings();
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
  else if (key === 'b') $('#blackBtn').click();
  else if (key === 'c' || e.key === 'Escape') $('#hideBtn').click();
  else if (key === 't') captions.toggle();
  else return;
  e.preventDefault();
});

// ---------- início ----------

(async function init() {
  defaultLogoUrl = await api.defaultLogo();
  const accent = await api.accentColor();
  if (accent) document.documentElement.style.setProperty('--accent', accent);

  [songs, plans, media, settings] = await Promise.all([api.listSongs(), api.listPlans(), api.listMedia(), api.getSettings()]);
  settings = settings || {};
  // Versões anteriores tinham uma única tela de projeção.
  if (settings.displayId && !settings.outputs) settings.outputs = { palco: settings.displayId };
  show.theme = { ...DEFAULT_THEME, ...settings.theme };
  timer.message = settings.timerMessage ?? timer.message;
  timer.endMessage = settings.timerEndMessage ?? '';
  // Na primeira vez, já começa com um fundo embutido escuro (letra branca sobre fundo claro não se lê).
  if (settings.backgroundId === undefined) {
    const builtin = media.filter((m) => m.builtin);
    settings.backgroundId = (builtin.find((m) => m.name === 'Roxo suave') || builtin[0])?.id || null;
  }
  const bg = media.find((m) => m.id === settings.backgroundId && !m.missing);
  show.background = bg ? { type: bg.type, url: bg.url } : null;
  if (!bg) settings.backgroundId = null;
  // Roteiros da primeira versão tinham "avisos" só de texto; viram itens de telas.
  for (const plan of plans) {
    if (!plan.items.some((i) => i.type === 'text')) continue;
    plan.items = plan.items.map((i) =>
      i.type !== 'text' ? i : { id: i.id, type: 'slides', title: i.title, slides: slidesOf(i.text).map((sl) => ({ id: uid(), type: 'text', text: sl.text })) },
    );
    await savePlan(plan);
  }
  // Abre o último roteiro usado ou, se não houver, o de data mais recente.
  planId = plans.some((p) => p.id === settings.planId) ? settings.planId : sortedPlans()[0]?.id || null;

  applySidebar();
  bindTheme();
  bindWatermark();
  bindCaption();
  refreshMics();
  renderBackgrounds();
  syncTimer();
  showView('slides');
  renderAll();
  api.onDisplaysChanged(() => {});
  outputs = await api.outputStatus();
  push();
})();
