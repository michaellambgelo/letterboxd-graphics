// The letterboxd-dark template in a real browser: fitGrid() narrowing and the
// showLogs toggle. fitGrid's arithmetic depends on laid-out text heights, so it
// is tested where it runs rather than re-implemented in Node.
//
// Needs Chromium: `npx playwright install chromium`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from '../lib/render.mjs';
import { ROOT, THEME_DEFAULTS } from '../lib/graphic.mjs';

let browser, server, url;

before(async () => {
  server = await startStaticServer(ROOT);
  url = `http://127.0.0.1:${server.port}/templates/letterboxd-dark.html`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

function film(i, extra = {}) {
  // poster: null renders the placeholder block, so no image files are needed.
  return { title: `Film number ${i}`, year: '2000', rating: 3.5, logs: 1, poster: null, ...extra };
}

function graphic({ films, columns = 4, width = 1080, height = 1350, theme = {} }) {
  return {
    title: 'test graphic', eyebrow: 'eyebrow', subtitle: 'subtitle',
    width, height, columns, template: 'letterboxd-dark',
    theme: { ...THEME_DEFAULTS, ...theme },
    films,
  };
}

async function render(g) {
  const page = await browser.newPage({ viewport: { width: g.width, height: g.height } });
  await page.addInitScript((data) => { window.__GRAPHIC__ = data; }, g);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 10000 });
  const m = await page.evaluate(() => {
    const main = document.querySelector('main');
    const grid = document.getElementById('grid');
    const cs = getComputedStyle(main);
    return {
      avail: main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      mainWidth: main.clientWidth,
      gridHeight: grid.offsetHeight,
      gridWidth: grid.clientWidth,
      inlineWidth: grid.style.width,
      logs: Array.from(document.querySelectorAll('.logs')).map((e) => ({
        text: e.textContent, rewatch: e.classList.contains('rewatch'),
      })),
    };
  });
  return { page, m };
}

test('fitGrid leaves a grid that already fits at full width', async () => {
  const { page, m } = await render(graphic({ films: Array.from({ length: 4 }, (_, i) => film(i)) }));
  try {
    assert.equal(m.inlineWidth, '', 'grid should not be narrowed');
    assert.equal(m.gridWidth, m.mainWidth);
    assert.ok(m.gridHeight <= m.avail + 0.5);
  } finally { await page.close(); }
});

test('fitGrid narrows an overflowing grid until it fits the main area', async () => {
  // 3 rows of 4 at full width need ~1100px of a ~976px main area.
  const g = graphic({ films: Array.from({ length: 12 }, (_, i) => film(i)), columns: 4 });
  const { page, m } = await render(g);
  try {
    assert.notEqual(m.inlineWidth, '', 'grid should have been narrowed');
    assert.ok(m.gridWidth < m.mainWidth, `${m.gridWidth} < ${m.mainWidth}`);
    // Narrowed only as far as needed, not collapsed.
    assert.ok(m.gridWidth > m.mainWidth / 2, `${m.gridWidth} > ${m.mainWidth / 2}`);
    assert.ok(m.gridHeight <= m.avail + 0.5, `grid ${m.gridHeight}px must fit in ${m.avail}px`);
  } finally { await page.close(); }
});

test('fitGrid fits a 5-column, 2-row graphic on a short sheet', async () => {
  // The shape of the real monthly graphics, squeezed to force a narrowing.
  const g = graphic({ films: Array.from({ length: 10 }, (_, i) => film(i)), columns: 5, height: 1000 });
  const { page, m } = await render(g);
  try {
    assert.notEqual(m.inlineWidth, '', 'grid should have been narrowed');
    assert.ok(m.gridHeight <= m.avail + 0.5, `grid ${m.gridHeight}px must fit in ${m.avail}px`);
  } finally { await page.close(); }
});

test('fitGrid tolerates an empty film list', async () => {
  const { page, m } = await render(graphic({ films: [] }));
  try {
    assert.equal(m.inlineWidth, '');
  } finally { await page.close(); }
});

test('log counts render by default, singular/plural and rewatch class', async () => {
  const films = [film(1, { logs: 1 }), film(2, { logs: 3 }), film(3, { logs: null })];
  const { page, m } = await render(graphic({ films }));
  try {
    assert.deepEqual(m.logs, [
      { text: '1 log', rewatch: false },
      { text: '3 logs', rewatch: true },
    ]);
  } finally { await page.close(); }
});

test('showLogs: false hides every log count', async () => {
  const films = [film(1, { logs: 1 }), film(2, { logs: 3 })];
  const { page, m } = await render(graphic({ films, theme: { showLogs: false } }));
  try {
    assert.deepEqual(m.logs, []);
  } finally { await page.close(); }
});
