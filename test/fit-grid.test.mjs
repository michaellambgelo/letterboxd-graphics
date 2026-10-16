// fitGrid() in templates/letterboxd-dark.html, exercised in real Chromium the
// same way the PNG build drives it. Films carry no poster URL, so the template
// draws placeholder boxes of the same 2:3 size and nothing hits the network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ROOT, resolveGraphic } from '../lib/graphic.mjs';
import { startStaticServer } from '../lib/render.mjs';

let server, browser;
before(async () => {
  server = await startStaticServer(ROOT);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const films = (n) => Array.from({ length: n }, (_, i) => ({
  title: i % 3 ? `Film ${i}` : `A Considerably Longer Film Title Number ${i}`,
  year: 2000 + i, rating: 3.5, logs: (i % 4) + 1, poster: null,
}));

// Render like screenshotGraphic() does, then measure instead of screenshotting.
async function measure(cfg) {
  const { graphic } = await resolveGraphic({ ...cfg, films: [] }, { index: new Map() });
  graphic.films = cfg.films;
  const page = await browser.newPage({ viewport: { width: graphic.width, height: graphic.height } });
  try {
    await page.addInitScript((g) => { window.__GRAPHIC__ = g; }, graphic);
    await page.goto(`http://127.0.0.1:${server.port}/templates/${graphic.template}.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 10000 });
    return await page.evaluate(() => {
      const main = document.querySelector('main');
      const grid = document.getElementById('grid');
      const cs = getComputedStyle(main);
      const mr = main.getBoundingClientRect();
      const gr = grid.getBoundingClientRect();
      return {
        avail: main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        gridH: grid.offsetHeight,
        gridW: grid.clientWidth,
        mainW: main.clientWidth,
        gridBottom: gr.bottom,
        mainBottom: mr.bottom,
        narrowed: grid.style.width !== '',
        logLabels: document.querySelectorAll('.logs').length,
      };
    });
  } finally {
    await page.close();
  }
}

test('a grid that already fits is left at full width', async () => {
  const m = await measure({ columns: 4, films: films(4) });
  assert.equal(m.narrowed, false);
  assert.equal(m.gridW, m.mainW);
  assert.ok(m.gridH <= m.avail + 0.5);
});

// Three rows of four at 1080x1350: the layout the September/October graphics hit
// when they drop to fewer columns.
test('too many rows: the grid narrows until it fits inside main', async () => {
  const m = await measure({ columns: 4, films: films(12) });
  assert.equal(m.narrowed, true);
  assert.ok(m.gridW < m.mainW, `grid ${m.gridW}px should be narrower than ${m.mainW}px`);
  assert.ok(m.gridH <= m.avail + 0.5, `grid ${m.gridH}px overflows ${m.avail}px`);
  assert.ok(m.gridBottom <= m.mainBottom + 0.5, 'grid spills under the footer');
});

test('larger type still fits (fixed text height is accounted for)', async () => {
  const m = await measure({ columns: 3, films: films(6), theme: { scale: 1.4 } });
  assert.equal(m.narrowed, true);
  assert.ok(m.gridH <= m.avail + 0.5, `grid ${m.gridH}px overflows ${m.avail}px`);
});

test('showLogs toggles the "N logs" label', async () => {
  assert.equal((await measure({ columns: 4, films: films(4) })).logLabels, 4);
  assert.equal((await measure({ columns: 4, films: films(4), theme: { showLogs: false } })).logLabels, 0);
});
