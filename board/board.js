// Paper Assembly Line — a calm, single-user kanban for papers.
// Data is stored by the Cloudflare Worker in cloudflare/board-worker.

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = LOCAL ? 'http://localhost:8787' : 'https://board-api.alighavam.com';

const STAGES = [
  { id: 'concept', name: 'Concept' },
  { id: 'pilot', name: 'Pilot & Setup' },
  { id: 'data', name: 'Data Collection & Analysis' },
  { id: 'figures', name: 'Figures & Storyboard' },
  { id: 'methods', name: 'Methods & Results' },
  { id: 'intro', name: 'Intro & Discussion' },
  { id: 'review', name: 'Co-Author Review' },
  { id: 'submitted', name: 'Submitted' },
];

const COLORS = {
  sage: '#7fa48a',
  sky: '#6e9cc4',
  lavender: '#9b8ec9',
  rose: '#d18a9b',
  sand: '#c9a865',
  clay: '#c9805f',
  teal: '#5fa8a0',
  slate: '#8a94a6',
};

const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
  },
};

let token = store.get('board.token');
let cards = new Map();
const cardEls = new Map();
const lists = new Map();
const counts = new Map();

// ---------- API ----------

async function api(path, { method = 'GET', body, type } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (type) headers['Content-Type'] = type;
  else if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, {
    method,
    headers,
    body: type ? body : body === undefined ? undefined : JSON.stringify(body),
    keepalive: !type && method !== 'GET',
  });
  if (res.status === 401) {
    lock();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ---------- Saving (optimistic, retried) ----------

const dirty = new Set();
const removed = new Set();
let flushTimer = 0;
let flushing = false;
let failures = 0;

function save(id, delay = 0) {
  dirty.add(id);
  setSync('saving');
  cacheBoard();
  scheduleFlush(delay);
}

function scheduleFlush(delay) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function flush() {
  if (flushing || !token) return;
  flushing = true;
  try {
    for (const id of [...removed]) {
      await api(`/cards/${id}`, { method: 'DELETE' });
      removed.delete(id);
    }
    for (const id of [...dirty]) {
      dirty.delete(id);
      const card = cards.get(id);
      if (!card) continue;
      try {
        await api(`/cards/${id}`, { method: 'PUT', body: card });
      } catch (err) {
        dirty.add(id);
        throw err;
      }
    }
    failures = 0;
  } catch {
    flushing = false;
    if (!token) return;
    failures++;
    setSync('offline');
    scheduleFlush(Math.min(30_000, 1000 * 2 ** failures));
    return;
  }
  flushing = false;
  if (dirty.size || removed.size) return flush();
  setSync('idle');
}

function setSync(state) {
  const el = $('sync');
  el.dataset.state = state;
  el.title = { idle: 'All changes saved', saving: 'Saving…', offline: 'Offline — will retry' }[state];
}

function cacheBoard() {
  store.set('board.cache', JSON.stringify([...cards.values()]));
}

// ---------- Loading & syncing ----------

let refreshing = false;

async function refresh() {
  if (!token || refreshing || document.hidden) return;
  refreshing = true;
  try {
    const { cards: list } = await (await api('/board')).json();
    // Never clobber local edits that haven't reached the server yet.
    if (drag || press || dirty.size || removed.size || flushing) return;
    const next = new Map(list.map((c) => [c.id, c]));
    if (openId && cards.has(openId)) next.set(openId, cards.get(openId));
    cards = next;
    render();
    cacheBoard();
    if (!failures) setSync('idle');
  } catch {
    if (token) setSync('offline');
  } finally {
    refreshing = false;
  }
}

setInterval(refresh, 20_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush();
  else refresh();
});
window.addEventListener('focus', refresh);
window.addEventListener('online', () => { flush(); refresh(); });

// ---------- Images ----------

const imageUrls = new Map();

function imageUrl(id) {
  if (!imageUrls.has(id)) {
    imageUrls.set(id, fetchImage(id).catch((err) => {
      imageUrls.delete(id);
      throw err;
    }));
  }
  return imageUrls.get(id);
}

async function fetchImage(id) {
  const key = `${API}/images/${id}`;
  let cache;
  try { cache = await caches.open('board-images'); } catch {}
  let res = cache && (await cache.match(key));
  if (!res) {
    res = await api(`/images/${id}`);
    cache?.put(key, res.clone()).catch(() => {});
  }
  return URL.createObjectURL(await res.blob());
}

async function uploadImage(file) {
  const blob = await shrink(file);
  const { id } = await (await api('/images', { method: 'POST', body: blob, type: 'image/jpeg' })).json();
  imageUrls.set(id, Promise.resolve(URL.createObjectURL(blob)));
  try {
    const cache = await caches.open('board-images');
    await cache.put(`${API}/images/${id}`, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  } catch {}
  return id;
}

async function shrink(file, max = 1200) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
}

// ---------- Rendering ----------

function buildBoard() {
  const board = $('board');
  board.replaceChildren();
  STAGES.forEach((stage, i) => {
    const col = document.createElement('section');
    col.className = 'column';
    col.dataset.stage = stage.id;
    col.innerHTML = `
      <header class="column-head">
        <span class="column-num">${String(i + 1).padStart(2, '0')}</span>
        <h2></h2>
        <span class="column-count"></span>
      </header>
      <div class="cards"></div>
      <button class="add-btn" type="button">
        <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        Add paper
      </button>`;
    col.querySelector('h2').textContent = stage.name;
    col.querySelector('.add-btn').addEventListener('click', () => addCard(stage.id));
    lists.set(stage.id, col.querySelector('.cards'));
    counts.set(stage.id, col.querySelector('.column-count'));
    board.append(col);
  });
}

function stageOf(card) {
  return STAGES.some((s) => s.id === card.stage) ? card.stage : STAGES[0].id;
}

function cardsIn(stageId) {
  return [...cards.values()]
    .filter((c) => stageOf(c) === stageId)
    .sort((a, b) => a.position - b.position);
}

function render({ animate = true } = {}) {
  const apply = () => {
    for (const [id, el] of cardEls) {
      if (!cards.has(id)) {
        el.remove();
        cardEls.delete(id);
      }
    }
    for (const stage of STAGES) {
      const list = lists.get(stage.id);
      for (const card of cardsIn(stage.id)) list.append(cardEl(card));
    }
    updateCounts();
  };
  animate ? flip(apply) : apply();
}

function updateCounts() {
  let total = 0;
  for (const stage of STAGES) {
    const n = lists.get(stage.id).children.length;
    counts.get(stage.id).textContent = n || '';
    total += n;
  }
  const active = total - lists.get('submitted').children.length;
  $('summary').textContent = total
    ? `${active} in progress${total - active ? ` · ${total - active} submitted` : ''}`
    : '';
}

function initials(title) {
  const words = title.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function cardEl(card) {
  let el = cardEls.get(card.id);
  if (!el) {
    el = document.createElement('article');
    el.className = 'card';
    el.tabIndex = 0;
    el.dataset.id = card.id;
    el.innerHTML = '<div class="cover"></div><div class="card-body"><span class="dot"></span><h3 class="card-title"></h3></div>';
    cardEls.set(card.id, el);
  }
  el.style.setProperty('--c', COLORS[card.color] || COLORS.sage);
  const title = el.querySelector('.card-title');
  title.textContent = card.title.trim() || 'Untitled';
  title.classList.toggle('untitled', !card.title.trim());
  paintCover(el.querySelector('.cover'), card);
  return el;
}

function paintCover(cover, card) {
  const key = card.image || `~${initials(card.title)}`;
  if (cover.dataset.key === key) return;
  cover.dataset.key = key;
  if (card.image) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    cover.replaceChildren(img);
    imageUrl(card.image).then((url) => {
      img.src = url;
      img.decode().catch(() => {}).finally(() => img.classList.add('loaded'));
    }).catch(() => {});
  } else {
    const mono = document.createElement('span');
    mono.className = 'monogram';
    mono.textContent = initials(card.title);
    cover.replaceChildren(mono);
  }
}

// FLIP: measure, mutate the DOM, then glide each card from where it was.
function flip(mutate, skip) {
  const els = [...cardEls.values()].filter((el) => el !== skip && el.isConnected);
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  for (const el of els) el.getAnimations().forEach((a) => a.id === 'flip' && a.cancel());
  mutate();
  if (CALM) return;
  for (const el of cardEls.values()) {
    if (el === skip || !el.isConnected) continue;
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    if (!a) {
      el.animate(
        [{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: EASE },
      );
      continue;
    }
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const anim = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 340, easing: EASE },
    );
    anim.id = 'flip';
  }
}

// ---------- Card actions ----------

function nextColor() {
  const used = new Map(Object.keys(COLORS).map((k) => [k, 0]));
  for (const c of cards.values()) used.set(c.color, (used.get(c.color) || 0) + 1);
  return [...used].sort((a, b) => a[1] - b[1])[0][0];
}

function lastPosition(stageId) {
  const list = cardsIn(stageId);
  return list.length ? list[list.length - 1].position + 1 : 0;
}

function addCard(stageId) {
  const card = {
    id: crypto.randomUUID(),
    stage: stageId,
    position: lastPosition(stageId),
    title: '',
    color: nextColor(),
    notes: '',
    image: null,
  };
  cards.set(card.id, card);
  render();
  const el = cardEls.get(card.id);
  el.scrollIntoView({ block: 'nearest', behavior: CALM ? 'auto' : 'smooth' });
  openCard(card.id, { isNew: true });
}

function isBlank(card) {
  return !card.title.trim() && !card.notes.trim() && !card.image;
}

function deleteCard(id) {
  const el = cardEls.get(id);
  const finish = () => {
    cards.delete(id);
    dirty.delete(id);
    removed.add(id);
    setSync('saving');
    cacheBoard();
    render();
    scheduleFlush(0);
  };
  if (el && !CALM) {
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 220, easing: EASE, fill: 'forwards' }).onfinish = finish;
  } else {
    finish();
  }
}

function moveToStage(id, stageId) {
  const card = cards.get(id);
  if (!card || stageOf(card) === stageId) return;
  card.stage = stageId;
  card.position = lastPosition(stageId);
  render();
  save(id);
}

// Give a dropped card a position between its new neighbours.
function commitDrop(el) {
  const card = cards.get(el.dataset.id);
  const stage = el.closest('.column').dataset.stage;
  const prev = el.previousElementSibling && cards.get(el.previousElementSibling.dataset.id);
  const next = el.nextElementSibling && cards.get(el.nextElementSibling.dataset.id);

  if (stageOf(card) === stage && (!prev || prev.position < card.position) && (!next || card.position < next.position)) {
    return;
  }
  card.stage = stage;
  if (prev && next && next.position - prev.position < 1e-6) {
    [...el.parentNode.children].forEach((child, i) => {
      cards.get(child.dataset.id).position = i;
      save(child.dataset.id);
    });
    return;
  }
  card.position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 0;
  save(card.id);
}

// ---------- Drag & drop ----------

let press = null;
let drag = null;
let suppressClick = false;

$('board').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.card');
  if (!el || e.button !== 0 || press || drag || el.classList.contains('placeholder')) return;
  press = { el, id: el.dataset.id, pointerId: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  if (e.pointerType !== 'mouse') {
    press.timer = setTimeout(() => startDrag(), 220);
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
});

function onPointerMove(e) {
  const p = drag || press;
  if (!p || e.pointerId !== p.pointerId) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (!drag) {
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.type === 'mouse' && moved > 4) startDrag();
    else if (p.type !== 'mouse' && moved > 8) endPress();
  }
}

function onPointerUp(e) {
  const p = drag || press;
  if (!p || e.pointerId !== p.pointerId) return;
  if (drag) endDrag();
  else endPress();
}

function endPress() {
  if (press) clearTimeout(press.timer);
  press = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

// Keep touch scrolling from fighting an active drag.
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
$('board').addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });

function startDrag() {
  const p = press;
  clearTimeout(p.timer);
  press = null;
  drag = p;

  const rect = p.el.getBoundingClientRect();
  p.offsetX = p.x - rect.left;
  p.offsetY = p.y - rect.top;
  p.gx = rect.left;
  p.tilt = 0;
  p.lift = 0;

  const ghost = p.el.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.removeAttribute('tabindex');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.transformOrigin = `${p.offsetX}px ${p.offsetY}px`;
  ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  document.body.append(ghost);
  p.ghost = ghost;
  requestAnimationFrame(() => ghost.classList.add('lifted'));

  p.el.getAnimations().forEach((a) => a.cancel());
  p.el.classList.add('placeholder');
  document.body.classList.add('dragging');
  window.getSelection()?.removeAllRanges();
  navigator.vibrate?.(8);
  p.raf = requestAnimationFrame(dragFrame);
}

function dragFrame() {
  const p = drag;
  if (!p) return;
  const x = p.x - p.offsetX;
  const y = p.y - p.offsetY;
  const vx = x - p.gx;
  p.gx = x;
  // Tilt gently in the direction of travel, like a sheet of paper in the air.
  p.tilt += (Math.max(-7, Math.min(7, vx * 0.55)) - p.tilt) * 0.14;
  p.lift += (1 - p.lift) * 0.18;
  const angle = CALM ? 0 : p.tilt + 1.2 * p.lift;
  const scale = CALM ? 1 : 1 + 0.035 * p.lift;
  p.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;

  autoScroll(p);
  updateTarget(p);
  p.raf = requestAnimationFrame(dragFrame);
}

function updateTarget(p) {
  const col = document.elementFromPoint(p.x, p.y)?.closest('.column');
  document.querySelectorAll('.column.over').forEach((c) => c !== col && c.classList.remove('over'));
  if (!col) return;
  col.classList.add('over');

  const list = col.querySelector('.cards');
  // Layout positions (offsetTop) ignore in-flight FLIP transforms, so targets don't jitter.
  const y = p.y - list.getBoundingClientRect().top + list.scrollTop;
  let before = null;
  for (const child of list.children) {
    if (child === p.el) continue;
    if (y < child.offsetTop + child.offsetHeight / 2) {
      before = child;
      break;
    }
  }
  if (p.el.parentNode === list && p.el.nextElementSibling === before) return;
  if (p.el.parentNode === list && before === null && !p.el.nextElementSibling) return;
  flip(() => list.insertBefore(p.el, before), p.el);
  if (!CALM) {
    p.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE });
  }
  updateCounts();
}

function autoScroll(p) {
  const edge = 64;
  const board = $('board');
  const b = board.getBoundingClientRect();
  if (p.x < b.left + edge) board.scrollLeft -= Math.ceil((b.left + edge - p.x) / 4);
  else if (p.x > b.right - edge) board.scrollLeft += Math.ceil((p.x - (b.right - edge)) / 4);

  const list = document.elementFromPoint(p.x, p.y)?.closest('.column')?.querySelector('.cards');
  if (!list) return;
  const l = list.getBoundingClientRect();
  if (p.y < l.top + edge) list.scrollTop -= Math.ceil((l.top + edge - p.y) / 4);
  else if (p.y > l.bottom - edge) list.scrollTop += Math.ceil((p.y - (l.bottom - edge)) / 4);
}

function endDrag() {
  const p = drag;
  cancelAnimationFrame(p.raf);
  updateTarget(p);
  drag = null;
  endPress();
  document.body.classList.remove('dragging');
  document.querySelectorAll('.column.over').forEach((c) => c.classList.remove('over'));
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);

  const target = p.el.getBoundingClientRect();
  const settle = () => {
    p.ghost.remove();
    p.el.classList.remove('placeholder');
  };
  p.ghost.classList.remove('lifted');
  if (CALM) {
    settle();
  } else {
    p.ghost.animate(
      [
        { transform: p.ghost.style.transform },
        { transform: `translate3d(${target.left}px, ${target.top}px, 0) rotate(0deg) scale(1)` },
      ],
      { duration: 380, easing: 'cubic-bezier(0.2, 1.25, 0.35, 1)', fill: 'forwards' },
    ).onfinish = settle;
  }
  commitDrop(p.el);
  updateCounts();
}

$('board').addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (!el || suppressClick || el.classList.contains('placeholder')) return;
  openCard(el.dataset.id);
});

$('board').addEventListener('keydown', (e) => {
  const el = e.target.closest('.card');
  if (el && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openCard(el.dataset.id);
  }
});

// ---------- Detail sheet ----------

let openId = null;
let openIsNew = false;
const scrim = $('scrim');
const sheet = $('sheet');
const titleInput = $('sheet-title');
const notesInput = $('sheet-notes');
const coverEl = $('sheet-cover');

STAGES.forEach((stage, i) => {
  const step = document.createElement('button');
  step.type = 'button';
  step.className = 'step';
  step.dataset.stage = stage.id;
  step.title = `${String(i + 1).padStart(2, '0')} · ${stage.name}`;
  step.setAttribute('aria-label', stage.name);
  step.addEventListener('click', () => {
    moveToStage(openId, stage.id);
    paintSheet();
  });
  $('stepper').append(step);
});

for (const [name, hex] of Object.entries(COLORS)) {
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'swatch';
  sw.dataset.color = name;
  sw.style.setProperty('--sw', hex);
  sw.setAttribute('aria-label', name);
  sw.addEventListener('click', () => {
    const card = cards.get(openId);
    card.color = name;
    cardEl(card);
    paintSheet();
    save(card.id);
  });
  $('swatches').append(sw);
}

function paintSheet() {
  const card = cards.get(openId);
  if (!card) return;
  sheet.style.setProperty('--c', COLORS[card.color] || COLORS.sage);
  const stageIndex = STAGES.findIndex((s) => s.id === stageOf(card));
  [...$('stepper').children].forEach((step, i) => {
    step.classList.toggle('done', i < stageIndex);
    step.classList.toggle('current', i === stageIndex);
  });
  $('stage-name').textContent = `${String(stageIndex + 1).padStart(2, '0')} · ${STAGES[stageIndex].name}`;
  [...$('swatches').children].forEach((sw) => sw.setAttribute('aria-pressed', sw.dataset.color === card.color));

  const img = $('sheet-img');
  coverEl.classList.toggle('has-image', !!card.image);
  coverEl.querySelector('.cover-hint span').textContent = card.image ? 'Change cover — click, drop, or paste' : 'Add a cover — click, drop, or paste';
  $('remove-cover-btn').hidden = !card.image;
  if (card.image) {
    if (img.dataset.id !== card.image) {
      img.dataset.id = card.image;
      img.removeAttribute('src');
      imageUrl(card.image).then((url) => { if (img.dataset.id === card.image) img.src = url; }).catch(() => {});
    }
  } else {
    delete img.dataset.id;
    img.removeAttribute('src');
  }
}

function autosize() {
  notesInput.style.height = 'auto';
  notesInput.style.height = `${notesInput.scrollHeight}px`;
}

function openCard(id, { isNew = false } = {}) {
  const card = cards.get(id);
  if (!card) return;
  openId = id;
  openIsNew = isNew;
  titleInput.value = card.title;
  notesInput.value = card.notes;
  disarmDelete();
  paintSheet();
  scrim.hidden = false;
  autosize();

  if (!CALM) {
    const from = cardEls.get(id)?.getBoundingClientRect();
    const to = sheet.getBoundingClientRect();
    const start = from
      ? `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width})`
      : 'translateY(12px) scale(0.98)';
    sheet.animate([{ transform: start, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' });
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE });
  }
  if (isNew || matchMedia('(hover: hover)').matches) {
    titleInput.focus({ preventScroll: true });
  }
}

function closeCard({ remove = false } = {}) {
  if (!openId) return;
  const id = openId;
  const card = cards.get(id);
  openId = null;
  titleInput.blur();

  const hide = () => { scrim.hidden = true; };
  // A brand-new paper closed without anything in it is simply discarded.
  const discard = card && (remove || (openIsNew && isBlank(card)));
  if (discard) {
    deleteCard(id);
  } else if (dirty.has(id)) {
    scheduleFlush(0);
  }

  if (CALM) return hide();
  const el = cardEls.get(id);
  const to = sheet.getBoundingClientRect();
  const from = card && !discard && el?.getBoundingClientRect();
  const end = from
    ? `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width})`
    : 'translateY(10px) scale(0.98)';
  const sheetOut = sheet.animate([{ transform: 'none', opacity: 1 }, { transform: end, opacity: 0 }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' });
  const scrimOut = scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: EASE, fill: 'forwards' });
  scrimOut.onfinish = () => {
    if (!openId) hide();
    sheetOut.cancel();
    scrimOut.cancel();
  };
}

titleInput.addEventListener('input', () => {
  const card = cards.get(openId);
  card.title = titleInput.value;
  cardEl(card);
  save(card.id, 700);
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    closeCard();
  }
});
notesInput.addEventListener('input', () => {
  const card = cards.get(openId);
  card.notes = notesInput.value;
  autosize();
  save(card.id, 900);
});

$('done-btn').addEventListener('click', closeCard);
scrim.addEventListener('pointerdown', (e) => {
  if (e.target === scrim) closeCard();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId) closeCard();
});

let deleteArmTimer = 0;
function disarmDelete() {
  clearTimeout(deleteArmTimer);
  $('delete-btn').classList.remove('armed');
  $('delete-btn').textContent = 'Delete';
}
$('delete-btn').addEventListener('click', () => {
  const btn = $('delete-btn');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Delete for good?';
    deleteArmTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  closeCard({ remove: true });
});

$('remove-cover-btn').addEventListener('click', () => {
  const card = cards.get(openId);
  card.image = null;
  cardEl(card);
  paintSheet();
  save(card.id);
});

// Cover image: click, drop, or paste.
const fileInput = $('file-input');
coverEl.addEventListener('click', () => fileInput.click());
coverEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setCover(fileInput.files[0]);
  fileInput.value = '';
});
coverEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  coverEl.classList.add('dropping');
});
coverEl.addEventListener('dragleave', () => coverEl.classList.remove('dropping'));
coverEl.addEventListener('drop', (e) => {
  e.preventDefault();
  coverEl.classList.remove('dropping');
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (file) setCover(file);
});
document.addEventListener('paste', (e) => {
  if (!openId) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    setCover(file);
  }
});

async function setCover(file) {
  const id = openId;
  coverEl.classList.add('busy');
  try {
    const imageId = await uploadImage(file);
    const card = cards.get(id);
    if (!card) return;
    card.image = imageId;
    cardEl(card);
    if (openId === id) paintSheet();
    save(id);
  } catch {
    coverEl.classList.add('shake');
    setTimeout(() => coverEl.classList.remove('shake'), 500);
  } finally {
    coverEl.classList.remove('busy');
  }
}

// Stop file drops elsewhere from navigating away.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- Theme ----------

$('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('board.theme', next);
});

// ---------- Login / lock ----------

function showLogin() {
  $('app').hidden = true;
  scrim.hidden = true;
  $('login').hidden = false;
  $('password').value = '';
  setTimeout(() => $('password').focus(), 50);
}

function showBoard() {
  $('login').hidden = true;
  $('app').hidden = false;
  buildBoard();
  cardEls.clear();
  try {
    const cached = JSON.parse(store.get('board.cache') || '[]');
    cards = new Map(cached.map((c) => [c.id, c]));
  } catch {
    cards = new Map();
  }
  render({ animate: false });
  refresh();
}

function lock() {
  token = null;
  openId = null;
  dirty.clear();
  removed.clear();
  cards = new Map();
  store.set('board.token', null);
  store.set('board.cache', null);
  window.caches?.delete('board-images').catch(() => {});
  imageUrls.clear();
  showLogin();
}

$('lock-btn').addEventListener('click', async () => {
  await flush();
  lock();
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  const error = $('login-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not sign in.');
    token = data.token;
    store.set('board.token', token);
    showBoard();
  } catch (err) {
    error.textContent = err.message === 'Failed to fetch' ? 'Can’t reach the board right now.' : err.message;
    const row = e.target.querySelector('.login-row');
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
    $('password').select();
  } finally {
    button.disabled = false;
  }
});

token ? showBoard() : showLogin();
