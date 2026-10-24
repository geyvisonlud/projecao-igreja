// `api` é exposto pelo preload (contextBridge); redeclará-lo aqui quebra o script no Electron.
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
let mediaSeq = 0; // muda a cada vez que um vídeo entra no ar, para recomeçá-lo

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
  const video = show.content?.type === 'media' && show.content.mediaType === 'video';
  $('#videoControls').classList.toggle('hidden', !video);
  if (video) $('#vPlay').textContent = show.content.playing ? '❚❚ Pausar vídeo' : '▶ Continuar vídeo';
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
const mediaById = (id) => media.find((m) => m.id === id) || null;
const onAirSlide = () => ['text', 'media'].includes(show.content?.type);
const songMeta = (s) => [s.artist, s.key && `Tom ${s.key}`].filter(Boolean).join(' · ');

function renderAll() {
  renderPlan();
  renderSongList();
  renderCenter();
}

// ---------- o que está selecionado ----------

// Uma "fonte" é qualquer coisa com slides: música (da biblioteca ou do roteiro) ou item de telas.
function sourceOf(sel) {
  if (!sel) return null;
  if (sel.kind === 'song') return songSource(songById(sel.id));
  const item = planItem(sel.id);
  if (!item) return null;
  if (item.type === 'song') return songSource(songById(item.songId));
  if (item.type === 'slides') {
    const n = item.slides.length;
    return {
      key: 'item:' + item.id,
      title: item.title || 'Telas',
      meta: `Telas · ${n} slide${n === 1 ? '' : 's'}`,
      slides: item.slides.map(slideView),
      edit: () => openSlidesDialog(item),
    };
  }
  return null;
}

// Slide de um item de telas no formato usado pelos cartões e pelo telão.
function slideView(slide) {
  if (slide.type === 'text') return { label: '', text: slide.text };
  const m = mediaById(slide.mediaId);
  return {
    label: m ? m.name : '(arquivo removido)',
    mediaType: slide.type,
    url: m?.url,
    loop: !!slide.loop,
    missing: !m || m.missing,
  };
}

function thumb(view) {
  if (view.missing) return h('div', { className: 'thumb missing', textContent: 'arquivo não encontrado' });
  return h(
    'div',
    { className: 'thumb' },
    view.mediaType === 'video'
      ? h('video', { src: view.url + '#t=0.5', muted: true, preload: 'metadata' })
      : h('img', { src: view.url, loading: 'lazy' }),
    view.mediaType === 'video' ? h('span', { className: 'badge-video', textContent: '▶ vídeo' + (view.loop ? ' · repete' : '') }) : null,
  );
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
          className: 'slide' + (slide.mediaType ? ' is-media' : '') + (live && live.key === src.key && live.index === i ? ' live' : ''),
          onclick: () => goLive(i),
        },
        h('div', { className: 'lbl' }, h('span', { textContent: slide.label || '\u00a0' }), h('span', { textContent: i + 1 })),
        slide.mediaType ? thumb(slide) : h('div', { className: 'txt', textContent: slide.text }),
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
  if (slide.mediaType && slide.missing) return;
  show.content = slide.mediaType
    ? { type: 'media', mediaType: slide.mediaType, url: slide.url, loop: slide.loop, playing: true, seq: ++mediaSeq }
    : { type: 'text', text: slide.text, label: slide.label };
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
  const n = item.slides.length;
  return { icon: '▣', title: item.title || 'Telas', sub: `Telas · ${n} slide${n === 1 ? '' : 's'}` };
}

function isItemLive(item) {
  if (!live && show.content?.type !== 'timer') return false;
  if (item.type === 'song') return live?.key === 'song:' + item.songId && onAirSlide();
  if (item.type === 'slides') return live?.key === 'item:' + item.id && onAirSlide();
  return show.content?.type === 'timer' && timer.itemId === item.id;
}

let dragIndex = null;
const isPlanDrag = (e) =>
  e.dataTransfer.types.includes('application/x-song-id') || e.dataTransfer.types.includes('application/x-plan-index');

// Soltar uma música no espaço vazio do roteiro adiciona no fim.
$('#planItems').addEventListener('dragover', (e) => isPlanDrag(e) && e.preventDefault());
$('#planItems').addEventListener('drop', (e) => {
  const songId = e.dataTransfer.getData('application/x-song-id');
  if (!songId) return;
  e.preventDefault();
  addSongToPlan(songId);
});

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
          ondblclick: () => {
            if (item.type === 'song') songById(item.songId) && openEditor(songById(item.songId));
            else if (item.type === 'slides') openSlidesDialog(item);
            else openItemDialog(item);
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
  planForm.date.value = mode === 'edit' ? plan.date : nextServiceDate();
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

// Diálogo do timer do roteiro.
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

async function replaceItem(updated) {
  const plan = currentPlan();
  await savePlan({ ...plan, items: plan.items.map((i) => (i.id === updated.id ? updated : i)) });
}

$('#addTimer').onclick = () =>
  openItemDialog({ type: 'timer', minutes: 5, message: timer.message, endMessage: timer.endMessage });
$('#addSlides').onclick = () => openSlidesDialog({ type: 'slides', title: '', slides: [] });

// ---------- editor de telas (textos, imagens, vídeos, PowerPoint) ----------

const slidesDialog = $('#slidesDialog');
const slidesForm = $('#slidesForm');
let slidesEditing = null;
let sdSlides = []; // cópia de trabalho; só vai para o roteiro ao salvar

const DOC_EXT = ['pdf', 'ppt', 'pptx', 'key', 'odp'];
const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'webm', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
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
    list.replaceChildren(
      h('div', { className: 'sd-empty muted', textContent: 'Nenhum slide ainda. Use os botões abaixo ou arraste arquivos para cá.' }),
    );
    return;
  }
  list.replaceChildren(
    ...sdSlides.map((sl, i) => {
      let body;
      if (sl.type === 'text') {
        body = h('textarea', {
          value: sl.text,
          rows: Math.min(8, Math.max(2, sl.text.split('\n').length)),
          placeholder: 'Texto do slide (ex.: versículo, título, aviso)',
          oninput: (e) => (sl.text = e.target.value),
        });
      } else {
        const view = slideView(sl);
        body = h(
          'div',
          { className: 'sd-media' },
          thumb(view),
          h(
            'div',
            {},
            h('div', { textContent: view.label }),
            sl.type === 'video'
              ? h(
                  'label',
                  { className: 'check small' },
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
          h('button', { type: 'button', className: 'mini', textContent: '↑', title: 'Subir', onclick: () => moveSd(i, -1) }),
          h('button', { type: 'button', className: 'mini', textContent: '↓', title: 'Descer', onclick: () => moveSd(i, 1) }),
          h('button', {
            type: 'button',
            className: 'mini danger',
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
  for (const m of items) sdSlides.push({ id: uid(), type: m.type, mediaId: m.id, loop: false });
  renderSdList();
  $('#sdList').lastElementChild?.scrollIntoView({ block: 'nearest' });
}

// Converte cada página do PDF numa imagem de 1920 px de largura e guarda na biblioteca.
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
    status.textContent = `${added.length} páginas importadas de "${doc.name}".`;
  } catch (e) {
    status.textContent = '';
    alert('Não consegui ler o arquivo: ' + e.message);
  }
}

async function importFiles(files) {
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
  const mediaPaths = paths.filter((p) => MEDIA_EXT.includes(extOf(p)));
  const docPaths = paths.filter((p) => DOC_EXT.includes(extOf(p)));
  if (mediaPaths.length) {
    $('#sdStatus').textContent = 'Copiando arquivos…';
    const added = await api.importMedia(mediaPaths, 'slide');
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
  const added = await api.pickMedia('slide');
  media = await api.listMedia();
  addMediaSlides(added);
};
$('#sdDoc').onclick = async () => {
  $('#sdStatus').textContent = 'Abrindo apresentação…';
  const doc = await api.pickDoc();
  $('#sdStatus').textContent = '';
  await importDoc(doc);
};

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
          draggable: true,
          ondragstart: (e) => {
            e.dataTransfer.setData('application/x-song-id', s.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
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
        h('div', { className: 'lbl' }, h('span', { textContent: s.label || '\u00a0' }), h('span', { textContent: i + 1 })),
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
  const backgrounds = media.filter((m) => m.role === 'background');
  const none = h(
    'button',
    { className: 'item' + (!activeId ? ' active' : ''), onclick: () => setBackground(null) },
    h('span', { className: 'name', textContent: 'Sem fundo' }),
  );
  $('#mediaList').replaceChildren(
    none,
    ...backgrounds.map((m) =>
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
        m.builtin
          ? null
          : h('span', {
              className: 'rm',
              textContent: '✕',
              title: 'Excluir este fundo',
              onclick: async (e) => {
                e.stopPropagation();
                if (!confirm(`Excluir o fundo "${m.name}"?`)) return;
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
  const added = await api.pickMedia('background');
  media = await api.listMedia();
  renderMedia();
  if (added.length) setBackground(added[0]);
};

// Arrastar arquivos do Finder: no painel de fundos viram fundos; na lista de telas, slides.
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

dropZone($('#mediaList'), async (files) => {
  const paths = files.map((f) => api.pathForFile(f)).filter((p) => MEDIA_EXT.includes(extOf(p)));
  if (!paths.length) return;
  const added = await api.importMedia(paths, 'background');
  media = await api.listMedia();
  renderMedia();
  if (added.length) setBackground(added[0]);
});
dropZone($('#sdList'), importFiles);
// Soltar um arquivo fora das áreas certas não deve abrir o arquivo na janela.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

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

function renderTimerDisplay() {
  const ms = remaining(timer);
  $('#tDisplay').textContent = fmt(ms);
  $('#tDisplay').classList.toggle('warn', ms > 0 && ms <= 60000);
}
setInterval(renderTimerDisplay, 250);

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
  // Na primeira vez, já começa com um fundo embutido escuro (letra branca sobre fundo claro não se lê).
  if (settings.backgroundId === undefined) {
    const builtin = media.filter((m) => m.builtin);
    settings.backgroundId = (builtin.find((m) => m.name === 'Roxo suave') || builtin[0])?.id || null;
  }
  const bg = media.find((m) => m.id === settings.backgroundId && !m.missing);
  show.background = bg ? { type: bg.type, url: bg.url } : null;
  if (!bg) settings.backgroundId = null;
  // Roteiros da versão anterior tinham "avisos" só de texto; viram itens de telas.
  for (const plan of plans) {
    if (!plan.items.some((i) => i.type === 'text')) continue;
    plan.items = plan.items.map((i) =>
      i.type !== 'text'
        ? i
        : { id: i.id, type: 'slides', title: i.title, slides: slidesOf(i.text).map((sl) => ({ id: uid(), type: 'text', text: sl.text })) },
    );
    await savePlan(plan);
  }
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
