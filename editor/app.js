// Editor client. Holds the draft config, repaints the preview by calling the
// real template's __RENDER__, and writes back to graphics/<name>.json.

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const FONT_LABELS = {
  eyebrow: 'Eyebrow', title: 'Title', subtitle: 'Subtitle',
  filmTitle: 'Film title', filmYear: 'Film year', stars: 'Stars',
  logs: 'Log count', footnote: 'Footnote', handle: 'Handle',
};
const FONT_RANGE = { min: 6, max: 140, step: 0.5 };

const LAYOUT_KNOBS = [
  { key: 'columns', label: 'Columns', min: 1, max: 8, step: 1, top: true },
  { key: 'width', label: 'Width', min: 320, max: 2400, step: 10, top: true },
  { key: 'height', label: 'Height', min: 320, max: 3000, step: 10, top: true },
  { key: 'gap', label: 'Grid gap', min: 0, max: 90, step: 1 },
  { key: 'posterRadius', label: 'Poster radius', min: 0, max: 40, step: 1 },
];
const COLOURS = [
  { key: 'ground', label: 'Background' },
  { key: 'accent', label: 'Accent (green)' },
  { key: 'accent2', label: 'Accent 2 (blue)' },
  { key: 'accent3', label: 'Accent 3 (orange)' },
];

let state = {
  name: null, cfg: null, defaults: null, tmdb: false,
  dirty: false, rendering: false, lastPng: null, posterFor: null,
};

// ------------------------------------------------------------------ helpers

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} on ${path}`);
  return body;
}

function setStatus(text, cls) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'pill' + (cls ? ' ' + cls : '');
}

function markDirty() {
  state.dirty = true;
  setStatus('unsaved', 'dirty');
  $('#open-png').disabled = true;
  schedulePreview();
}

// The film list is what the config stores; everything else lives at the top
// level or under theme.
function theme() {
  state.cfg.theme = state.cfg.theme || {};
  state.cfg.theme.fontSize = state.cfg.theme.fontSize || {};
  return state.cfg.theme;
}

// -------------------------------------------------------------- the preview

let previewTimer = null;
let previewSeq = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 160);
}

async function refreshPreview() {
  const seq = ++previewSeq;
  let data;
  try {
    data = await api('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.cfg),
    });
  } catch (err) {
    showProblems([err.message]);
    return;
  }
  if (seq !== previewSeq) return;          // a newer keystroke already won

  showProblems(data.problems);
  paint(data.graphic);
  renderFilmList(data.graphic);
  fitFrame(data.graphic);
}

function paint(graphic) {
  const frame = $('#frame');
  const want = `/templates/${graphic.template}.html`;
  const doPaint = () => {
    const w = frame.contentWindow;
    if (w && typeof w.__RENDER__ === 'function') w.__RENDER__(graphic);
  };
  if (frame.dataset.src !== want) {
    frame.dataset.src = want;
    frame.onload = doPaint;
    frame.src = want;
  } else {
    doPaint();
  }
}

function fitFrame(graphic) {
  const frame = $('#frame');
  const wrap = $('#frame-wrap');
  const body = $('#stage-body');
  frame.width = graphic.width;
  frame.height = graphic.height;
  frame.style.width = graphic.width + 'px';
  frame.style.height = graphic.height + 'px';

  const pad = 48;
  const scale = Math.min(
    (body.clientWidth - pad) / graphic.width,
    (body.clientHeight - pad) / graphic.height,
    1,
  );
  wrap.style.transform = `scale(${scale})`;
  wrap.style.width = graphic.width + 'px';
  wrap.style.height = graphic.height + 'px';
  // Collapse the scaled-away space so the stage doesn't scroll needlessly.
  wrap.style.margin = `${(graphic.height * scale - graphic.height) / 2}px ${(graphic.width * scale - graphic.width) / 2}px`;

  $('#dims').textContent = `${graphic.width}×${graphic.height}  →  PNG ${graphic.width * 2}×${graphic.height * 2}`;
  $('#zoom').textContent = `${Math.round(scale * 100)}%`;
}

function showProblems(problems) {
  const box = $('#problems');
  if (!problems || !problems.length) { box.className = ''; box.textContent = ''; return; }
  box.className = 'show';
  box.textContent = problems.join('\n\n');
}

// ----------------------------------------------------------------- controls

function buildKnob(label, value, opts, onInput) {
  const wrap = el('div', 'knob');
  wrap.appendChild(el('span', null, label));
  const range = el('input');
  range.type = 'range';
  Object.assign(range, { min: opts.min, max: opts.max, step: opts.step, value });
  const num = el('input');
  num.type = 'number';
  Object.assign(num, { min: opts.min, max: opts.max, step: opts.step, value });

  const sync = (v, from) => {
    if (from !== range) range.value = v;
    if (from !== num) num.value = v;
    onInput(Number(v));
  };
  range.addEventListener('input', () => sync(range.value, range));
  num.addEventListener('input', () => sync(num.value, num));

  wrap.append(range, num);
  return wrap;
}

function buildTypeKnobs() {
  const box = $('#type-knobs');
  box.textContent = '';
  const t = theme();

  box.appendChild(buildKnob('All type ×', t.scale ?? 1, { min: 0.5, max: 2.5, step: 0.01 }, (v) => {
    theme().scale = v; markDirty();
  }));

  const hr = el('div');
  hr.style.cssText = 'height:1px;background:var(--line);margin:4px 0';
  box.appendChild(hr);

  for (const [key, label] of Object.entries(FONT_LABELS)) {
    const cur = t.fontSize[key] ?? state.defaults.fontSize[key];
    box.appendChild(buildKnob(label, cur, FONT_RANGE, (v) => {
      theme().fontSize[key] = v; markDirty();
    }));
  }

  const reset = el('button', 'ghost', 'Reset type to defaults');
  reset.addEventListener('click', () => {
    theme().scale = 1;
    theme().fontSize = {};
    buildTypeKnobs();
    markDirty();
  });
  box.appendChild(reset);
}

function buildLayoutKnobs() {
  const box = $('#layout-knobs');
  box.textContent = '';
  for (const k of LAYOUT_KNOBS) {
    const cur = k.top
      ? (state.cfg[k.key] ?? state.defaults[k.key] ?? 0)
      : (theme()[k.key] ?? state.defaults[k.key]);
    box.appendChild(buildKnob(k.label, cur, k, (v) => {
      if (k.top) state.cfg[k.key] = v; else theme()[k.key] = v;
      markDirty();
    }));
  }
}

function buildColourKnobs() {
  const box = $('#colour-knobs');
  box.textContent = '';
  for (const c of COLOURS) {
    const row = el('div', 'knob');
    row.style.gridTemplateColumns = '96px 1fr 42px';
    row.appendChild(el('span', null, c.label));
    const text = el('input');
    text.type = 'text';
    text.value = theme()[c.key] ?? state.defaults[c.key];
    const swatch = el('input');
    swatch.type = 'color';
    swatch.value = normaliseHex(text.value);
    const set = (v, from) => {
      if (from !== text) text.value = v;
      if (from !== swatch) swatch.value = normaliseHex(v);
      theme()[c.key] = v;
      markDirty();
    };
    text.addEventListener('input', () => set(text.value, text));
    swatch.addEventListener('input', () => set(swatch.value, swatch));
    row.append(text, swatch);
    box.appendChild(row);
  }
}

function normaliseHex(v) {
  const s = String(v || '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : '#000000';
}

function bindCopyFields() {
  for (const input of document.querySelectorAll('[data-cfg]')) {
    input.addEventListener('input', () => {
      const key = input.dataset.cfg;
      const v = input.value;
      if (v === '') delete state.cfg[key]; else state.cfg[key] = v;
      markDirty();
    });
  }
}

function fillCopyFields() {
  for (const input of document.querySelectorAll('[data-cfg]')) {
    input.value = state.cfg[input.dataset.cfg] ?? '';
  }
}

// -------------------------------------------------------------- film list

function renderFilmList(graphic) {
  const box = $('#films');
  box.textContent = '';

  state.cfg.films.forEach((film, i) => {
    const resolved = graphic.films[i] || {};
    const row = el('div', 'film-row');
    row.draggable = true;
    row.dataset.index = i;

    row.appendChild(el('span', 'grip', '⠿'));

    const thumb = el('img', 'film-thumb' + (resolved.hasPoster ? '' : ' missing'));
    thumb.src = resolved.poster || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    thumb.title = 'Change poster';
    thumb.addEventListener('click', (e) => { e.stopPropagation(); openPosterPicker(i); });
    row.appendChild(thumb);

    const main = el('div', 'film-main');
    main.appendChild(el('div', 'film-name', film.title));
    const bits = [String(film.year)];
    bits.push(resolved.rating != null ? `${resolved.rating}★` : 'no rating');
    bits.push(resolved.logs != null ? `${resolved.logs} log${resolved.logs === 1 ? '' : 's'}` : 'no logs');
    const sub = el('div', 'film-sub');
    sub.textContent = bits.join(' · ');
    if (film.rating != null || film.logs != null) {
      const ovr = el('span', 'ovr', '  (overridden)');
      sub.appendChild(ovr);
    }
    if (!resolved.hasPoster) {
      const warn = el('span', 'ovr', '  · no poster');
      sub.appendChild(warn);
    }
    main.appendChild(sub);
    main.addEventListener('click', () => {
      row.classList.toggle('expanded');
    });
    row.appendChild(main);

    const del = el('button', 'icon', '✕');
    del.title = 'Remove';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.cfg.films.splice(i, 1);
      markDirty();
    });
    row.appendChild(del);

    box.appendChild(row);
    box.appendChild(buildFilmOverrides(film, resolved));
    wireDrag(row, box);
  });
}

function buildFilmOverrides(film, resolved) {
  const edit = el('div', 'film-edit');

  const mk = (label, key, opts) => {
    const f = el('label', 'field');
    f.appendChild(el('span', null, label));
    const inp = el('input');
    inp.type = opts.type || 'text';
    if (opts.step) inp.step = opts.step;
    if (opts.min != null) inp.min = opts.min;
    if (opts.max != null) inp.max = opts.max;
    inp.value = film[key] ?? '';
    inp.placeholder = opts.placeholder ?? '';
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v === '') delete film[key];
      else film[key] = opts.type === 'number' ? Number(v) : v;
      markDirty();
    });
    f.appendChild(inp);
    return f;
  };

  edit.appendChild(mk('Displayed title', 'title', { placeholder: film.title }));
  edit.appendChild(mk('Rating', 'rating', { type: 'number', step: '0.5', min: 0, max: 5, placeholder: resolved.rating ?? '' }));
  edit.appendChild(mk('Logs', 'logs', { type: 'number', step: '1', min: 0, placeholder: resolved.logs ?? '' }));
  return edit;
}

let dragFrom = null;
function wireDrag(row, box) {
  row.addEventListener('dragstart', () => {
    dragFrom = Number(row.dataset.index);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    box.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
  });
  row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const to = Number(row.dataset.index);
    if (dragFrom == null || dragFrom === to) return;
    const [moved] = state.cfg.films.splice(dragFrom, 1);
    state.cfg.films.splice(to, 0, moved);
    dragFrom = null;
    markDirty();
  });
}

// ------------------------------------------------------------- add a film

let searchTimer = null;
function wireSearch() {
  const input = $('#add');
  const results = $('#results');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.className = ''; return; }
    searchTimer = setTimeout(async () => {
      const { results: hits } = await api('/api/diary?q=' + encodeURIComponent(q));
      results.textContent = '';
      if (!hits.length) {
        const none = el('div', 'result');
        none.appendChild(el('span', null, 'Nothing in the diary matches.'));
        results.appendChild(none);
      }
      for (const h of hits) {
        const r = el('div', 'result');
        r.appendChild(el('span', null, `${h.title} (${h.year})`));
        r.appendChild(el('span', 'meta', `${h.rating != null ? h.rating + '★ · ' : ''}${h.logs} log${h.logs === 1 ? '' : 's'}`));
        r.addEventListener('click', () => addFilm(h));
        results.appendChild(r);
      }
      results.className = 'open';
    }, 180);
  });

  input.addEventListener('blur', () => setTimeout(() => { results.className = ''; }, 160));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') results.className = ''; });
}

function addFilm(hit) {
  state.cfg.films.push({ title: hit.title, year: Number(hit.year) });
  $('#add').value = '';
  $('#results').className = '';
  markDirty();
}

// --------------------------------------------------------- poster picker

async function openPosterPicker(index) {
  const film = state.cfg.films[index];
  state.posterFor = index;
  $('#modal-title').textContent = `Poster — ${film.title} (${film.year})`;
  $('#poster-grid').textContent = '';
  $('#modal-note').textContent = 'Loading…';
  $('#modal').className = 'open';

  let data;
  try {
    data = await api(`/api/posters?title=${encodeURIComponent(film.title)}&year=${encodeURIComponent(film.year)}`);
  } catch (err) {
    $('#modal-note').textContent = err.message;
    return;
  }
  $('#modal-note').textContent = data.note || '';

  const grid = $('#poster-grid');
  grid.textContent = '';
  for (const opt of data.options) {
    const card = el('div', 'opt' + (opt.current ? ' current' : ''));
    const img = el('img');
    img.src = opt.thumb;
    img.loading = 'lazy';
    card.appendChild(img);
    const cap = opt.width ? `${opt.label} · ${opt.width}×${opt.height}` : opt.label;
    card.appendChild(el('div', 'cap', cap));
    card.addEventListener('click', () => choosePoster(index, opt));
    grid.appendChild(card);
  }
  if (!data.options.length) {
    $('#modal-note').textContent = (data.note ? data.note + '\n\n' : '') +
      'No poster options found. Drop a file into posters/ named ' + data.stem + '.jpg';
  }
}

async function choosePoster(index, opt) {
  const film = state.cfg.films[index];
  $('#modal-note').textContent = 'Downloading…';
  try {
    await api('/api/poster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: film.title, year: film.year, url: opt.url }),
    });
  } catch (err) {
    $('#modal-note').textContent = err.message;
    return;
  }
  $('#modal').className = '';
  // Bust the cached <img> for the poster we just overwrote.
  bustPosterCache();
  refreshPreview();
}

let bust = 0;
function bustPosterCache() {
  bust++;
  const frame = $('#frame');
  if (frame.contentWindow) {
    frame.contentWindow.location.reload();
    frame.onload = () => refreshPreview();
  }
}

// ---------------------------------------------------------------- load/save

async function loadGraphic(name) {
  const data = await api('/api/graphic/' + encodeURIComponent(name));
  state.name = name;
  state.cfg = data.config;
  state.cfg.films = state.cfg.films || [];
  state.dirty = false;
  state.lastPng = null;
  $('#open-png').disabled = true;
  location.hash = name;

  fillCopyFields();
  buildTypeKnobs();
  buildLayoutKnobs();
  buildColourKnobs();
  showProblems(data.problems);
  paint(data.graphic);
  renderFilmList(data.graphic);
  fitFrame(data.graphic);
  setStatus('saved', 'saved');
}

async function save() {
  await api('/api/graphic/' + encodeURIComponent(state.name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.cfg),
  });
  state.dirty = false;
  setStatus('saved', 'saved');
}

// Render always saves first: a PNG that does not match the preview you are
// looking at is the worst bug this tool could have.
async function render() {
  if (state.rendering) return;
  state.rendering = true;
  $('#render').disabled = true;
  setStatus('rendering…');
  try {
    await save();
    const out = await api('/api/render/' + encodeURIComponent(state.name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    state.lastPng = out.png;
    $('#open-png').disabled = !out.png;
    showProblems(null);
    setStatus('rendered', 'saved');
  } catch (err) {
    showProblems([err.message]);
    setStatus('render failed', 'dirty');
  } finally {
    state.rendering = false;
    $('#render').disabled = false;
  }
}

// -------------------------------------------------------------------- init

async function init() {
  const meta = await api('/api/graphics');
  state.defaults = meta.defaults;
  state.tmdb = meta.tmdb;

  const pick = $('#pick');
  for (const g of meta.graphics) {
    const o = el('option', null, g);
    o.value = g;
    pick.appendChild(o);
  }
  const start = location.hash.slice(1) || meta.graphics[0];
  pick.value = meta.graphics.includes(start) ? start : meta.graphics[0];

  pick.addEventListener('change', async () => {
    if (state.dirty && !confirm('Discard unsaved changes?')) { pick.value = state.name; return; }
    await loadGraphic(pick.value);
  });

  $('#save').addEventListener('click', () => save().catch((e) => showProblems([e.message])));
  $('#render').addEventListener('click', render);
  $('#open-png').addEventListener('click', () => { if (state.lastPng) window.open(state.lastPng + '?v=' + Date.now(), '_blank'); });
  $('#modal-close').addEventListener('click', () => { $('#modal').className = ''; });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').className = ''; });

  $('#new').addEventListener('click', () => createGraphic(null));
  $('#dup').addEventListener('click', () => createGraphic(state.cfg));

  window.addEventListener('resize', () => { if (state.cfg) schedulePreview(); });
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save().catch(() => {}); }
  });

  bindCopyFields();
  wireSearch();
  await loadGraphic(pick.value);
}

async function createGraphic(from) {
  const name = prompt(from ? 'Name for the duplicate:' : 'Name for the new graphic:');
  if (!name) return;
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) { alert('That name has no usable characters.'); return; }

  const cfg = from
    ? JSON.parse(JSON.stringify(from))
    : { title: name.trim(), template: 'letterboxd-dark', width: 1080, height: 1350, columns: 4, films: [] };

  try {
    await api('/api/graphic/' + encodeURIComponent(clean), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  } catch (err) { alert(err.message); return; }

  const pick = $('#pick');
  if (![...pick.options].some((o) => o.value === clean)) {
    const o = el('option', null, clean);
    o.value = clean;
    pick.appendChild(o);
  }
  pick.value = clean;
  await loadGraphic(clean);
}

init().catch((err) => {
  document.body.innerHTML = '<pre style="padding:24px;color:#ffb4b4">' + err.message + '</pre>';
});
