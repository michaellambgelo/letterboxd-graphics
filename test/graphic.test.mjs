// THEME_DEFAULTS and how resolveGraphic() fills them into a config.
// No diary or posters needed: every config here has an empty film list, and an
// index is passed so the letterboxd-viewer checkout is never read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { THEME_DEFAULTS, FONT_SIZE_LABELS, resolveGraphic, ROOT } from '../lib/graphic.mjs';

const NO_DIARY = new Map();
const resolve = (cfg) => resolveGraphic(cfg, { strict: true, index: NO_DIARY });

test('THEME_DEFAULTS has the documented knobs with sane types', () => {
  for (const k of ['ground', 'accent', 'accent2', 'accent3']) {
    assert.match(THEME_DEFAULTS[k], /^#[0-9a-f]{6}$/i, k);
  }
  assert.equal(typeof THEME_DEFAULTS.gap, 'number');
  assert.equal(typeof THEME_DEFAULTS.posterRadius, 'number');
  assert.equal(THEME_DEFAULTS.scale, 1);
  assert.equal(THEME_DEFAULTS.showLogs, true);
});

test('every font size has an editor label, and vice versa', () => {
  assert.deepEqual(Object.keys(FONT_SIZE_LABELS).sort(), Object.keys(THEME_DEFAULTS.fontSize).sort());
  for (const [k, px] of Object.entries(THEME_DEFAULTS.fontSize)) {
    assert.ok(Number.isFinite(px) && px > 0, `${k} = ${px}`);
  }
});

test('template FS_DEFAULTS matches THEME_DEFAULTS.fontSize', async () => {
  // The template keeps its own copy so a raw config still renders; it must not drift.
  const html = await readFile(join(ROOT, 'templates', 'letterboxd-dark.html'), 'utf8');
  const m = html.match(/FS_DEFAULTS\s*=\s*\{([^}]*)\}/);
  assert.ok(m, 'FS_DEFAULTS not found in template');
  const parsed = Object.fromEntries(
    [...m[1].matchAll(/(\w+)\s*:\s*([\d.]+)/g)].map(([, k, v]) => [k, Number(v)])
  );
  assert.deepEqual(parsed, THEME_DEFAULTS.fontSize);
});

test('a config with no theme gets every default, showLogs on', async () => {
  const { graphic, problems } = await resolve({ title: 't', films: [] });
  assert.deepEqual(problems, []);
  assert.deepEqual(graphic.theme, THEME_DEFAULTS);
  assert.equal(graphic.theme.showLogs, true);
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.equal(graphic.columns, 4);
  assert.equal(graphic.template, 'letterboxd-dark');
});

test('showLogs: false in the config survives the merge', async () => {
  const { graphic } = await resolve({ films: [], theme: { showLogs: false } });
  assert.equal(graphic.theme.showLogs, false);
  assert.equal(graphic.theme.accent, THEME_DEFAULTS.accent);
});

test('fontSize is merged per key, not replaced wholesale', async () => {
  const { graphic } = await resolve({ films: [], theme: { fontSize: { title: 80 } } });
  assert.equal(graphic.theme.fontSize.title, 80);
  assert.equal(graphic.theme.fontSize.logs, THEME_DEFAULTS.fontSize.logs);
  assert.equal(Object.keys(graphic.theme.fontSize).length, Object.keys(THEME_DEFAULTS.fontSize).length);
});

test('resolving does not mutate THEME_DEFAULTS', async () => {
  const before = structuredClone(THEME_DEFAULTS);
  await resolve({ films: [], theme: { gap: 4, showLogs: false, fontSize: { title: 1 } } });
  assert.deepEqual(THEME_DEFAULTS, before);
});
