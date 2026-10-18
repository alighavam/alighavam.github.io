// Songbook: a personal tracker for guitar songs. Want to Learn → Practicing → Learned.
//
// No backend. Everything lives in this browser's localStorage as one readable
// JSON object (Export downloads exactly this; Import accepts it back):
//
//   {
//     "app": "songbook",
//     "version": 1,
//     "songs": [
//       {
//         "id": "s_k3j9x2ab",
//         "title": "Wonderwall",           // the only required field
//         "artist": "Oasis",
//         "list": "practicing",            // "want" | "practicing" | "learned"
//         "chords": "https://…",           // chords / tabs page
//         "tutorial": "https://…",         // favourite YouTube tutorial
//         "key": "F#m",
//         "capo": 2,                       // number, or null
//         "tuning": "Standard",
//         "difficulty": 1,                 // 1–3, or null
//         "notes": "Strum: D D U U D U",
//         "added": "2026-10-18",
//         "learned": null,                 // date it moved to Learned
//         "example": true                  // only on the sample songs
//       }
//     ]
//   }
//
// Within a list, songs show in the order they have in the array.
//
// About the password: like the paper board, it separates your songbook from the
// public demo. It is checked here in the browser, so it is a lock on the door, not
// encryption. Your songs never leave this device unless you export them.
// To change it, put the SHA-256 of the new password below. In any browser console:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('new password'))
//     .then((b) => console.log([...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')))
const PASSWORD_SHA256 = '2466624a287ebd0fbc679c965ad8aabe2b42585ec1f76345e635a95eaf38d61d';

const LISTS = [
  { id: 'want', name: 'Want to Learn', short: 'Want', empty: 'Songs you’d love to play.' },
  { id: 'practicing', name: 'Practicing', short: 'Practicing', empty: 'What you’re working on now.' },
  { id: 'learned', name: 'Learned', short: 'Learned', empty: 'Songs you can play.' },
];

const KEYS = {
  data: 'songbook.data',        // your songs
  demo: 'songbook.demo',        // demo songs (kept separate)
  unlocked: 'songbook.unlocked',
  mode: 'songbook.mode',
  seen: 'songbook.demo.seen',
  tab: 'songbook.tab',
};

const ICONS = {
  chords: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  tutorial: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 9.5 4 2.5-4 2.5Z" fill="currentColor"/></svg>',
  move: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 8h13m-4-4 4 4-4 4M19 16H6m4-4-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAN_DRAG = matchMedia('(hover: hover) and (pointer: fine)').matches;
const PHONE = matchMedia('(max-width: 760px)');
const $ = (id) => document.getElementById(id);
const html = document.documentElement;

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------- State ----------

let demo = false;
let songs = [];
let query = '';
let tab = LISTS.some((l) => l.id === store.get(KEYS.tab)) ? store.get(KEYS.tab) : 'want';
let enterId = null;      // card to animate in on the next render
const columns = {};      // list id → { col, list, counts: [els] }

// ---------- Small helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function newId() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

// Dates are stored as local "YYYY-MM-DD" so they read well in the JSON.
function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Only http(s) links are ever rendered; "tabs.com/x" becomes "https://tabs.com/x".
function safeUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? parsed.href : '';
  } catch {
    return '';
  }
}

const listName = (id) => LISTS.find((l) => l.id === id).name;
const findSong = (id) => songs.find((s) => s.id === id);

// ---------- Data ----------

const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function toCapo(v) {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 24 ? n : null;
}

function toDifficulty(v) {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 3 ? n : null;
}

// Turns anything song-shaped (e.g. hand-edited JSON) into a clean song, or null.
function normalize(s) {
  if (!s || typeof s !== 'object') return null;
  const title = text(s.title).trim();
  if (!title) return null;
  const list = LISTS.some((l) => l.id === s.list) ? s.list : 'want';
  const song = {
    id: text(s.id).trim() || newId(),
    title,
    artist: text(s.artist).trim(),
    list,
    chords: text(s.chords).trim(),
    tutorial: text(s.tutorial).trim(),
    key: text(s.key).trim(),
    capo: toCapo(s.capo),
    tuning: text(s.tuning).trim(),
    difficulty: toDifficulty(s.difficulty),
    notes: text(s.notes),
    added: isDate(s.added) ? s.added : today(),
    learned: list === 'learned' && isDate(s.learned) ? s.learned : null,
  };
  if (s.example === true) song.example = true;
  return song;
}

// Accepts { songs: [...] } or a bare array. Throws if it isn't song data at all.
function parseData(data) {
  const raw = Array.isArray(data) ? data : data && Array.isArray(data.songs) ? data.songs : null;
  if (!raw) throw new Error('Not Songbook data');
  const ids = new Set();
  return raw.map(normalize).filter(Boolean).map((s) => {
    if (ids.has(s.id)) s.id = newId();
    ids.add(s.id);
    return s;
  });
}

const storageKey = () => (demo ? KEYS.demo : KEYS.data);

function load() {
  const raw = store.get(storageKey());
  if (raw == null) return { songs: exampleSongs(), fresh: true };
  try {
    return { songs: parseData(JSON.parse(raw)) };
  } catch {
    // Don't lose a hand-edit gone wrong: keep a copy aside before starting over.
    store.set(storageKey() + '.broken', raw);
    toast('Saved data couldn’t be read; a copy was kept.');
    return { songs: [] };
  }
}

function snapshot() {
  return { app: 'songbook', version: 1, songs };
}

function save() {
  if (!store.set(storageKey(), JSON.stringify(snapshot(), null, 2))) {
    toast('Couldn’t save. Is storage full or blocked?');
  }
}

// ---------- Changing songs ----------

function setList(song, list) {
  if (list === 'learned' && song.list !== 'learned') song.learned = today();
  if (list !== 'learned') song.learned = null;
  song.list = list;
}

// where: 'top' of the list, 'end' of the list, or { before: id }.
function place(song, where) {
  let i = -1;
  if (where === 'top') i = songs.findIndex((s) => s.list === song.list);
  else if (where && where.before) i = songs.findIndex((s) => s.id === where.before);
  songs.splice(i < 0 ? songs.length : i, 0, song);
}

function moveSong(id, list, where = 'top') {
  const i = songs.findIndex((s) => s.id === id);
  if (i < 0) return;
  const [song] = songs.splice(i, 1);
  const changed = song.list !== list;
  setList(song, list);
  place(song, where);
  save();
  enterId = id;
  render();
  if (changed) toast(list === 'learned' ? `“${song.title}” learned. Nice.` : `Moved to ${listName(list)}`);
}

// ---------- Rendering ----------

function buildBoard() {
  const board = $('board');
  const tabs = $('tabs');
  board.replaceChildren();
  tabs.replaceChildren();

  for (const L of LISTS) {
    const col = el('section', 'column');
    col.dataset.list = L.id;
    col.id = `panel-${L.id}`;
    col.setAttribute('aria-labelledby', `head-${L.id}`);

    const head = el('header', 'column-head');
    const h2 = el('h2', null, L.name);
    h2.id = `head-${L.id}`;
    const count = el('span', 'count');
    count.setAttribute('aria-label', 'songs');
    head.append(h2, count);

    const list = el('div', 'songs');
    col.append(head, list);
    board.append(col);

    // Mobile tab
    const t = el('button', 'tab');
    t.type = 'button';
    t.id = `tab-${L.id}`;
    t.dataset.list = L.id;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', col.id);
    const tCount = el('span', 'count');
    t.append(el('span', null, L.short), tCount);
    t.addEventListener('click', () => selectTab(L.id));
    tabs.append(t);

    columns[L.id] = { col, list, counts: [count, tCount] };
    if (CAN_DRAG) wireDrop(L.id);
  }
  selectTab(tab, false);
}

function render() {
  const q = query.trim().toLowerCase();
  const matches = (s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q);

  for (const L of LISTS) {
    const items = songs.filter((s) => s.list === L.id && matches(s));
    const { list, counts } = columns[L.id];
    list.replaceChildren(...items.map(songCard));
    if (!items.length) list.append(el('p', 'empty', q ? 'No matches.' : L.empty));
    counts.forEach((c) => (c.textContent = items.length));
  }
  enterId = null;

  const learned = songs.filter((s) => s.list === 'learned').length;
  $('summary').textContent = songs.length
    ? `${songs.length} song${songs.length === 1 ? '' : 's'} · ${learned} learned`
    : 'No songs yet';

  $('examples-banner').hidden = demo || !songs.some((s) => s.example);
}

function songCard(s) {
  const card = el('article', 'song');
  card.dataset.id = s.id;
  card.dataset.list = s.list;
  if (s.id === enterId && !CALM) card.classList.add('enter');

  // Stretched button: the whole card opens the detail view.
  const open = el('button', 'song-open');
  open.type = 'button';
  open.setAttribute('aria-label', `${s.title}${s.artist ? ', ' + s.artist : ''}. Open details`);
  open.addEventListener('click', () => openSong(s.id));

  const words = el('div', 'song-text');
  words.append(el('h3', 'song-title', s.title));
  if (s.artist) words.append(el('p', 'song-artist', s.artist));

  const links = el('div', 'song-links');
  const addLink = (href, icon, label) => {
    if (!href) return;
    const a = el('a', 'icon-link');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.draggable = false;
    a.title = label;
    a.setAttribute('aria-label', `${label} for ${s.title} (opens in a new tab)`);
    a.innerHTML = icon;
    links.append(a);
  };
  addLink(safeUrl(s.chords), ICONS.chords, 'Chords / Tabs');
  addLink(safeUrl(s.tutorial), ICONS.tutorial, 'Tutorial');

  // Touch screens: "Move to…" instead of drag and drop (shown via CSS).
  const move = el('button', 'icon-link move-btn');
  move.type = 'button';
  move.title = 'Move to…';
  move.setAttribute('aria-label', `Move ${s.title} to another list`);
  move.innerHTML = ICONS.move;
  move.addEventListener('click', () => openMove(s.id));
  links.append(move);

  card.append(open, words, links);

  // Small details, only the ones that are filled in.
  const meta = el('ul', 'song-meta');
  if (s.key) meta.append(el('li', null, s.key));
  if (s.capo) meta.append(el('li', null, `Capo ${s.capo}`));
  if (s.tuning) meta.append(el('li', null, s.tuning));
  if (s.difficulty) {
    const dots = el('li', 'dots');
    dots.title = `Difficulty ${s.difficulty} of 3`;
    dots.setAttribute('aria-label', dots.title);
    for (let i = 1; i <= 3; i++) dots.append(el('i', i <= s.difficulty ? 'on' : null));
    meta.append(dots);
  }
  if (meta.children.length) card.append(meta);

  if (CAN_DRAG) wireDrag(card, s.id);
  return card;
}

// ---------- Tabs (phone) ----------

function selectTab(id, focus) {
  tab = id;
  store.set(KEYS.tab, id);
  $('board').dataset.tab = id;
  for (const t of $('tabs').children) {
    const on = t.dataset.list === id;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
}

$('tabs').addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!step) return;
  const i = LISTS.findIndex((l) => l.id === tab);
  selectTab(LISTS[(i + step + LISTS.length) % LISTS.length].id, true);
});

// ---------- Drag and drop (desktop) ----------

let dragId = null;
let slot = null;

function wireDrag(card, id) {
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', findSong(id)?.title || '');
    slot = el('div', 'slot');
    slot.style.height = card.offsetHeight + 'px';
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  card.addEventListener('dragend', endDrag);
}

function wireDrop(listId) {
  const { col } = columns[listId];
  col.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    placeSlot(listId, e.clientY);
  });
  col.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    let next = slot.nextElementSibling;
    while (next && (!next.classList.contains('song') || next.classList.contains('dragging'))) next = next.nextElementSibling;
    const id = dragId;
    endDrag();
    moveSong(id, listId, next ? { before: next.dataset.id } : 'end');
  });
}

// Shows a dashed slot where the song would land.
function placeSlot(listId, y) {
  for (const L of LISTS) columns[L.id].col.classList.toggle('drop-target', L.id === listId);
  const list = columns[listId].list;
  const cards = [...list.querySelectorAll('.song:not(.dragging)')];
  const before = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (before) {
    if (slot.nextElementSibling !== before) list.insertBefore(slot, before);
  } else if (slot.parentNode !== list || slot.nextElementSibling) {
    list.append(slot);
  }
}

function endDrag() {
  dragId = null;
  slot?.remove();
  slot = null;
  document.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
  document.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
}

// ---------- Dialogs ----------

function openDialog(d) {
  if (d.open) return;
  d.classList.remove('closing');
  d.showModal();
  html.classList.add('modal-open');
}

// Plays the close animation, then closes. Cleanup lives in each dialog's "close" event.
function closeDialog(d) {
  if (!d.open || d.classList.contains('closing')) return;
  d.classList.add('closing');
  setTimeout(() => {
    d.classList.remove('closing');
    d.close();
  }, CALM ? 0 : 190);
}

for (const d of document.querySelectorAll('dialog')) {
  // Escape: animate out instead of vanishing.
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(d);
  });
  // Clicking the backdrop closes (only if the press also started there).
  let downOnBackdrop = false;
  d.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === d));
  d.addEventListener('click', (e) => {
    if (e.target === d && downOnBackdrop && !(d === sheetEl() && isNew && $('f-title').value.trim())) closeDialog(d);
  });
  d.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) html.classList.remove('modal-open');
  });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(d)));
}

// A small promise-based confirm.
function ask(message, yesLabel = 'Delete') {
  const d = $('confirm');
  $('confirm-msg').textContent = message;
  $('confirm-yes').textContent = yesLabel;
  return new Promise((resolve) => {
    let answered = false;
    const finish = (yes) => {
      if (answered) return;
      answered = true;
      resolve(yes);
      closeDialog(d);
    };
    $('confirm-yes').onclick = () => finish(true);
    $('confirm-no').onclick = () => finish(false);
    d.addEventListener('close', () => finish(false), { once: true });
    openDialog(d);
    $('confirm-no').focus();
  });
}

let toastTimer = 0;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- Song detail sheet ----------

const sheetEl = () => $('sheet');
const form = $('sheet-form');
const f = {
  title: $('f-title'),
  artist: $('f-artist'),
  chords: $('f-chords'),
  tutorial: $('f-tutorial'),
  key: $('f-key'),
  capo: $('f-capo'),
  tuning: $('f-tuning'),
  notes: $('f-notes'),
};
let editing = null;   // the song in the sheet (a draft when adding)
let isNew = false;
let saveTimer = 0;

// Build the list picker and difficulty dots once.
for (const L of LISTS) {
  const b = el('button', null, L.name);
  b.type = 'button';
  b.dataset.list = L.id;
  b.setAttribute('role', 'radio');
  b.addEventListener('click', () => chooseList(L.id));
  $('f-list').append(b);
}
for (let n = 1; n <= 3; n++) {
  const b = el('button');
  b.type = 'button';
  b.dataset.n = n;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', ['Easy', 'Medium', 'Hard'][n - 1]);
  b.title = ['Easy', 'Medium', 'Hard'][n - 1] + ' (click again to clear)';
  b.addEventListener('click', () => {
    editing.difficulty = editing.difficulty === n ? null : n;
    paintDifficulty();
    queueSave();
  });
  $('f-diff').append(b);
}

function openSong(id) {
  const song = findSong(id);
  if (!song) return;
  editing = song;
  isNew = false;
  fillSheet();
  openDialog(sheetEl());
  form.focus({ preventScroll: true }); // don't pop the phone keyboard
  autosize();
}

function openNew() {
  editing = normalize({ title: '-', list: PHONE.matches ? tab : 'want' });
  editing.title = '';
  isNew = true;
  fillSheet();
  openDialog(sheetEl());
  f.title.focus();
  autosize();
}

function fillSheet() {
  const s = editing;
  for (const k of Object.keys(f)) f[k].value = s[k] == null ? '' : s[k];
  paintList();
  paintDifficulty();
  paintLinks();
  paintDates();
  $('saved').classList.remove('show');
  $('delete-btn').hidden = isNew;
  $('cancel-btn').hidden = !isNew;
  $('done-btn').textContent = isNew ? 'Add song' : 'Done';
  $('done-btn').disabled = isNew;
  $('sheet-heading').textContent = isNew ? 'Add a song' : s.title;
}

function paintList() {
  for (const b of $('f-list').children) b.setAttribute('aria-checked', b.dataset.list === editing.list);
}

function paintDifficulty() {
  for (const b of $('f-diff').children) {
    const n = Number(b.dataset.n);
    b.classList.toggle('on', n <= (editing.difficulty || 0));
    b.setAttribute('aria-checked', n === editing.difficulty);
  }
}

function paintLinks() {
  for (const k of ['chords', 'tutorial']) {
    const href = safeUrl(f[k].value);
    const a = $(`open-${k}`);
    href ? a.setAttribute('href', href) : a.removeAttribute('href');
  }
}

function paintDates() {
  const s = editing;
  $('dates').hidden = isNew;
  $('dates').textContent = `Added ${prettyDate(s.added)}` + (s.learned ? `  ·  Learned ${prettyDate(s.learned)}` : '');
}

function chooseList(id) {
  if (isNew) {
    editing.list = id;
  } else {
    moveSong(editing.id, id, 'top');
    paintDates();
  }
  paintList();
}

// Every edit saves itself (debounced); notes show a quiet "Saved".
form.addEventListener('input', (e) => {
  const t = e.target;
  const s = editing;
  if (!s) return;
  if (t === f.capo) f.capo.value = f.capo.value.replace(/\D/g, '');

  const title = f.title.value.trim();
  if (title) s.title = title;                // never save an empty title
  s.artist = f.artist.value.trim();
  s.chords = f.chords.value.trim();
  s.tutorial = f.tutorial.value.trim();
  s.key = f.key.value.trim();
  s.capo = toCapo(f.capo.value);
  s.tuning = f.tuning.value.trim();
  s.notes = f.notes.value;

  if (t === f.notes) autosize();
  if (t === f.chords || t === f.tutorial) paintLinks();
  if (isNew) $('done-btn').disabled = !title;
  else queueSave(t === f.notes);
});

// Tidy link fields when leaving them ("tabs.com/x" → "https://tabs.com/x").
for (const k of ['chords', 'tutorial']) {
  f[k].addEventListener('change', () => {
    const href = safeUrl(f[k].value);
    if (href && editing) {
      f[k].value = editing[k] = href;
      if (!isNew) queueSave();
    }
  });
}

function queueSave(showSaved = false) {
  if (isNew) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    save();
    render();
    if (showSaved) {
      $('saved').textContent = 'Saved';
      $('saved').classList.add('show');
      clearTimeout(queueSave.hide);
      queueSave.hide = setTimeout(() => $('saved').classList.remove('show'), 1600);
    }
  }, 300);
}

function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  save();
  render();
}

function autosize() {
  f.notes.style.height = 'auto';
  f.notes.style.height = Math.max(110, f.notes.scrollHeight + 2) + 'px';
}

// "Done" (or Enter in a field): add the new song, or just close.
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isNew) {
    const title = f.title.value.trim();
    if (!title) return f.title.focus();
    const song = normalize({ ...editing, title });
    if (song.list === 'learned') song.learned = today();
    place(song, 'top');
    save();
    enterId = song.id;
    isNew = false;
    editing = song;
    if (PHONE.matches) selectTab(song.list);
    render();
    toast(`Added to ${listName(song.list)}`);
  }
  closeDialog(sheetEl());
});

$('cancel-btn').addEventListener('click', () => closeDialog(sheetEl()));

$('delete-btn').addEventListener('click', async () => {
  const s = editing;
  if (!s || !(await ask(`Delete “${s.title}”? This can’t be undone.`, 'Delete'))) return;
  songs = songs.filter((x) => x.id !== s.id);
  clearTimeout(saveTimer);
  saveTimer = 0;
  save();
  editing = null;
  render();
  closeDialog(sheetEl());
  toast('Song deleted');
});

sheetEl().addEventListener('close', () => {
  flushSave();
  const id = !isNew && editing ? editing.id : null;
  editing = null;
  isNew = false;
  // Give focus back to the card that was open.
  if (id) document.querySelector(`.song[data-id="${CSS.escape(id)}"] .song-open`)?.focus({ preventScroll: true });
});

// ---------- Move to… (phone) ----------

function openMove(id) {
  const song = findSong(id);
  if (!song) return;
  $('move-title').textContent = `Move “${song.title}” to…`;
  const list = $('move-list');
  list.replaceChildren();
  for (const L of LISTS) {
    const b = el('button', null, L.name);
    b.type = 'button';
    b.dataset.list = L.id;
    if (L.id === song.list) {
      b.setAttribute('aria-current', 'true');
      b.append(el('small', null, 'current'));
    } else {
      b.addEventListener('click', () => {
        closeDialog($('move'));
        moveSong(id, L.id, 'top');
      });
    }
    list.append(b);
  }
  openDialog($('move'));
}

// ---------- Search, add, keyboard ----------

$('search').addEventListener('input', (e) => {
  query = e.target.value;
  render();
});

$('add-btn').addEventListener('click', openNew);

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || $('app').hidden || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  e.preventDefault();
  $('search').focus();
});

// ---------- Export / import / examples ----------

$('export-btn').addEventListener('click', () => {
  const data = { ...snapshot(), exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `songbook-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${songs.length} song${songs.length === 1 ? '' : 's'}`);
});

$('import-btn').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let incoming;
  try {
    incoming = parseData(JSON.parse(await file.text()));
  } catch {
    return toast('That file isn’t a Songbook backup.');
  }
  if (!incoming.length) return toast('No songs found in that file.');
  const ok = !songs.length || (await ask(
    `Replace your ${songs.length} song${songs.length === 1 ? '' : 's'} with the ${incoming.length} in “${file.name}”?`,
    'Replace',
  ));
  if (!ok) return;
  songs = incoming;
  save();
  render();
  toast(`Imported ${incoming.length} song${incoming.length === 1 ? '' : 's'}`);
});

async function clearExamples() {
  const n = songs.filter((s) => s.example).length;
  if (!(await ask(`Remove the ${n} example songs?`, 'Clear'))) return;
  songs = songs.filter((s) => !s.example);
  save();
  render();
  toast('Examples cleared. It’s all yours.');
}
$('clear-examples-banner').addEventListener('click', clearExamples);

$('reset-demo-btn').addEventListener('click', async () => {
  if (!(await ask('Reset the demo to its example songs?', 'Reset'))) return;
  songs = exampleSongs();
  save();
  render();
});

$('info-btn').addEventListener('click', () => openDialog($('info')));
$('info').addEventListener('close', () => store.set(KEYS.seen, '1'));

// ---------- Example songs ----------

function exampleSongs() {
  const tabs = (q) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`;
  const video = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' guitar lesson')}`;
  return [
    {
      title: 'Fast Car', artist: 'Tracy Chapman', list: 'want',
      tutorial: video('fast car tracy chapman'),
      capo: 2, difficulty: 2, added: today(3),
    },
    {
      title: 'Wonderwall', artist: 'Oasis', list: 'practicing',
      chords: tabs('wonderwall oasis'), tutorial: video('wonderwall oasis'),
      key: 'F#m', capo: 2, tuning: 'Standard', difficulty: 1, added: today(12),
      notes: 'Strum: D  D  U  U D U, steady 16ths.\nKeep ring + pinky anchored on the B and E strings the whole song.\nChorus change Cadd9 → Dsus4 is still slow.',
    },
    {
      title: 'Blackbird', artist: 'The Beatles', list: 'practicing',
      chords: tabs('blackbird beatles'), tutorial: video('blackbird beatles'),
      key: 'G', tuning: 'Standard', difficulty: 3, added: today(30),
      notes: 'Thumb + middle finger pinch; index stays out of it.\nBars 9–12 (the climb up the neck) are the hard bit. Practise at 60 bpm.',
    },
    {
      title: 'Wish You Were Here', artist: 'Pink Floyd', list: 'learned',
      chords: tabs('wish you were here pink floyd'), tutorial: video('wish you were here pink floyd'),
      key: 'G', tuning: 'Standard', difficulty: 2, added: today(70), learned: today(21),
      notes: 'Intro riff is solid. Don’t rush the hammer-ons on the G.',
    },
  ].map((s) => normalize({ ...s, id: newId(), example: true }));
}

// ---------- Login / lock / demo ----------

function showLogin() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('app').hidden = true;
  $('login').hidden = false;
  $('password').value = '';
  $('login-error').textContent = '';
  setTimeout(() => $('password').focus(), 50);
}

function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  query = $('search').value = '';
  buildBoard();
  const loaded = load();
  songs = loaded.songs;
  if (loaded.fresh) save();

  $('demo-pill').hidden = !demo;
  $('info-btn').hidden = !demo;
  $('reset-demo-btn').hidden = !demo;
  $('lock-btn').title = demo ? 'Leave the demo' : 'Lock';
  $('lock-btn').setAttribute('aria-label', $('lock-btn').title);
  document.title = demo ? 'Songbook · Demo' : 'Songbook';
  render();

  if (demo && !store.get(KEYS.seen)) setTimeout(() => openDialog($('info')), 600);
}

$('lock-btn').addEventListener('click', () => {
  flushSave();
  if (demo) {
    demo = false;
    store.set(KEYS.mode, null);
    history.replaceState(null, '', location.pathname);
  } else {
    store.set(KEYS.unlocked, null);
  }
  showLogin();
});

$('demo-btn').addEventListener('click', () => {
  demo = true;
  store.set(KEYS.mode, 'demo');
  history.replaceState(null, '', '#demo');
  showApp();
});

async function sha256(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('login-error');
  error.textContent = '';
  if (!window.crypto?.subtle) {
    error.textContent = 'This page needs https to unlock.';
    return;
  }
  if ((await sha256($('password').value)) === PASSWORD_SHA256) {
    store.set(KEYS.unlocked, '1');
    store.set(KEYS.mode, null);
    demo = false;
    history.replaceState(null, '', location.pathname);
    showApp();
    return;
  }
  error.textContent = 'Not quite. Try again.';
  const row = e.target.querySelector('.login-row');
  row.classList.remove('shake');
  void row.offsetWidth;
  row.classList.add('shake');
  $('password').select();
});

// ---------- Start ----------

const unlocked = store.get(KEYS.unlocked) === '1';
demo = !unlocked && (location.hash === '#demo' || store.get(KEYS.mode) === 'demo');
unlocked || demo ? showApp() : showLogin();
