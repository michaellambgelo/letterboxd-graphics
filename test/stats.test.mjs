// The letterboxd-stats template (big-number tiles + bar chart) and the
// film-less configs that drive it. Needs Chromium: `npx playwright install chromium`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer, screenshotGraphic } from '../lib/render.mjs';
import { ROOT, THEME_DEFAULTS, resolveGraphic, templatePath } from '../lib/graphic.mjs';

let browser, server, url;

before(async () => {
  server = await startStaticServer(ROOT);
  url = `http://127.0.0.1:${server.port}/templates/letterboxd-stats.html`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

const STATS = [
  { value: '134', label: 'theater trips' },
  { value: '107', label: 'different films' },
  { value: '31', label: 'in IMAX' },
];
const BARS = [
  { label: '2024', value: 27 },
  { label: '2025', value: 19 },
  { label: '2026', value: 33, note: 'through Nov 8' },
];

function graphic(extra = {}) {
  return {
    title: 'test numbers', eyebrow: 'eyebrow', width: 1080, height: 1350, columns: 2,
    template: 'letterboxd-stats', theme: { ...THEME_DEFAULTS }, films: [], ...extra,
  };
}

async function render(g) {
  const page = await browser.newPage({ viewport: { width: g.width, height: g.height } });
  await page.addInitScript((data) => { window.__GRAPHIC__ = data; }, g);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 10000 });
  const m = await page.evaluate(() => {
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const footer = document.querySelector('footer').getBoundingClientRect();
    const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
    return {
      sheet: { width: sheet.width, height: sheet.height, right: sheet.right },
      footerTop: footer.top,
      stats: Array.from(document.querySelectorAll('.stat')).map((e) => ({
        value: e.querySelector('.stat-value').textContent,
        label: e.querySelector('.stat-label').textContent,
        ...box(e),
      })),
      bars: Array.from(document.querySelectorAll('.bar-col')).map((e) => ({
        label: e.querySelector('.bar-label').textContent,
        value: e.querySelector('.bar-value').textContent,
        note: e.querySelector('.bar-note')?.textContent ?? null,
        noteBox: e.querySelector('.bar-note') ? box(e.querySelector('.bar-note')) : null,
        hi: e.classList.contains('hi'),
        height: e.querySelector('.bar').getBoundingClientRect().height,
        colour: getComputedStyle(e.querySelector('.bar')).backgroundColor,
      })),
      posters: document.querySelectorAll('.poster').length,
      decal: document.querySelector('.handle .decal')?.getAttribute('src'),
    };
  });
  return { page, m };
}

test('a film-less config resolves without reading the diary', async () => {
  // Point the join at a directory that does not exist: if resolveGraphic still
  // tried to load viewing_history.json, this would throw.
  const saved = process.env.LETTERBOXD_VIEWER_PATH;
  process.env.LETTERBOXD_VIEWER_PATH = join(ROOT, 'no-such-viewer-checkout');
  try {
    const cfg = { title: 't', template: 'letterboxd-stats', stats: STATS, bars: BARS, films: [] };
    const { graphic: g, problems } = await resolveGraphic(cfg, { strict: true });
    assert.deepEqual(problems, []);
    assert.deepEqual(g.films, []);
    assert.deepEqual(g.stats, STATS);
    assert.deepEqual(g.bars, BARS);
    assert.deepEqual(g.theme, THEME_DEFAULTS);
    assert.equal(templatePath(g), '/templates/letterboxd-stats.html');
    // A config that omits `films` entirely is treated the same way.
    const bare = await resolveGraphic({ title: 't', stats: STATS }, { strict: true });
    assert.deepEqual(bare.graphic.films, []);
  } finally {
    if (saved === undefined) delete process.env.LETTERBOXD_VIEWER_PATH;
    else process.env.LETTERBOXD_VIEWER_PATH = saved;
  }
});

test('stats template FS_DEFAULTS matches THEME_DEFAULTS.fontSize', async () => {
  const html = await readFile(join(ROOT, 'templates', 'letterboxd-stats.html'), 'utf8');
  const m = html.match(/FS_DEFAULTS\s*=\s*\{([^}]*)\}/);
  assert.ok(m, 'FS_DEFAULTS not found in template');
  const parsed = Object.fromEntries(
    [...m[1].matchAll(/(\w+)\s*:\s*([\d.]+)/g)].map(([, k, v]) => [k, Number(v)])
  );
  assert.deepEqual(parsed, THEME_DEFAULTS.fontSize);
});

test('stat tiles render value and label, inside the sheet, above the footer', async () => {
  const { page, m } = await render(graphic({ stats: STATS }));
  try {
    assert.deepEqual(m.stats.map((s) => [s.value, s.label]), STATS.map((s) => [s.value, s.label]));
    assert.equal(m.sheet.width, 1080);
    assert.equal(m.sheet.height, 1350);
    for (const s of m.stats) assert.ok(s.bottom <= m.footerTop + 0.5, `tile bottom ${s.bottom} above footer ${m.footerTop}`);
    // columns: 2 puts the first two tiles on one row and the third below.
    assert.equal(m.stats[0].top, m.stats[1].top);
    assert.ok(m.stats[2].top > m.stats[0].top);
    assert.equal(m.posters, 0);
    assert.equal(m.decal, '/assets/letterboxd-decal-dots-rgb.svg');
  } finally { await page.close(); }
});

test('bars scale to the largest value and the last one is highlighted', async () => {
  const { page, m } = await render(graphic({ bars: BARS }));
  try {
    assert.deepEqual(m.bars.map((b) => [b.label, b.value]), [['2024', '27'], ['2025', '19'], ['2026', '33']]);
    const tallest = m.bars[2].height;
    assert.ok(tallest > 200, `tallest bar is ${tallest}px`);
    assert.ok(Math.abs(m.bars[0].height / tallest - 27 / 33) < 0.01);
    assert.ok(Math.abs(m.bars[1].height / tallest - 19 / 33) < 0.01);
    assert.deepEqual(m.bars.map((b) => b.hi), [false, false, true]);
    assert.equal(m.bars[2].colour, 'rgb(0, 224, 84)');           // accent green
    assert.notEqual(m.bars[0].colour, m.bars[2].colour);
    assert.equal(m.bars[2].note, 'through Nov 8');
    assert.equal(m.bars[0].note, null);
    // The note sits above the footer and does not run off the sheet.
    assert.ok(m.bars[2].noteBox.bottom <= m.footerTop + 0.5);
    assert.ok(m.bars[2].noteBox.right <= m.sheet.right);
  } finally { await page.close(); }
});

test('highlight: true on a bar overrides the last-bar default', async () => {
  const bars = [{ label: 'a', value: 5, highlight: true }, { label: 'b', value: 2 }];
  const { page, m } = await render(graphic({ bars }));
  try {
    assert.deepEqual(m.bars.map((b) => b.hi), [true, false]);
  } finally { await page.close(); }
});

test('all-zero bars and an empty config still settle', async () => {
  const a = await render(graphic({ bars: [{ label: 'x', value: 0 }] }));
  try { assert.equal(a.m.bars.length, 1); } finally { await a.page.close(); }
  const b = await render(graphic());
  try {
    assert.equal(b.m.stats.length, 0);
    assert.equal(b.m.bars.length, 0);
  } finally { await b.page.close(); }
});

test('labels are escaped, not injected', async () => {
  const { page, m } = await render(graphic({ stats: [{ value: '<b>1</b>', label: 'a & b' }] }));
  try {
    assert.equal(m.stats[0].value, '<b>1</b>');
    assert.equal(m.stats[0].label, 'a & b');
  } finally { await page.close(); }
});

test('the shared screenshot path renders a film-less graphic to a PNG', async () => {
  const { graphic: g } = await resolveGraphic(
    { title: 't', template: 'letterboxd-stats', stats: STATS, bars: BARS, films: [] },
    { strict: true, index: new Map() },
  );
  const buf = await screenshotGraphic({ browser, url, graphic: g, scale: 1 });
  assert.deepEqual([...buf.subarray(1, 4)], [0x50, 0x4e, 0x47]);   // "PNG"
  assert.equal(buf.readUInt32BE(16), 1080);
  assert.equal(buf.readUInt32BE(20), 1350);
});
