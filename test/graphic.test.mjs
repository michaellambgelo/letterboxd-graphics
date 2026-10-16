// THEME_DEFAULTS shape and how resolveGraphic() layers a config's theme over it.
// No diary or posters needed: an empty film list never touches either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_DEFAULTS, FONT_SIZE_LABELS, resolveGraphic } from '../lib/graphic.mjs';

const resolve = (cfg) => resolveGraphic({ films: [], ...cfg }, { index: new Map() })
  .then((r) => r.graphic);

test('THEME_DEFAULTS carries every knob the template contract names', () => {
  for (const k of ['ground', 'accent', 'accent2', 'accent3']) {
    assert.match(THEME_DEFAULTS[k], /^#[0-9a-f]{6}$/i, k);
  }
  assert.equal(typeof THEME_DEFAULTS.gap, 'number');
  assert.equal(typeof THEME_DEFAULTS.posterRadius, 'number');
  assert.equal(THEME_DEFAULTS.scale, 1);
  assert.equal(THEME_DEFAULTS.showLogs, true);
});

test('every font size has a positive number and an editor label', () => {
  const keys = Object.keys(THEME_DEFAULTS.fontSize).sort();
  assert.equal(keys.length, 9);
  assert.deepEqual(keys, Object.keys(FONT_SIZE_LABELS).sort());
  for (const k of keys) assert.ok(THEME_DEFAULTS.fontSize[k] > 0, k);
});

test('a config with no theme gets the defaults and layout fallbacks', async () => {
  const g = await resolve({});
  assert.deepEqual(g.theme, THEME_DEFAULTS);
  assert.notEqual(g.theme, THEME_DEFAULTS, 'must be a copy, not the shared object');
  assert.notEqual(g.theme.fontSize, THEME_DEFAULTS.fontSize);
  assert.equal(g.width, 1080);
  assert.equal(g.height, 1350);
  assert.equal(g.columns, 4);
  assert.equal(g.template, 'letterboxd-dark');
});

test('showLogs: false survives the merge', async () => {
  const g = await resolve({ theme: { showLogs: false } });
  assert.equal(g.theme.showLogs, false);
  assert.equal(g.theme.accent, THEME_DEFAULTS.accent);
});

test('a partial fontSize override keeps the other sizes', async () => {
  const g = await resolve({ theme: { fontSize: { title: 80 } } });
  assert.equal(g.theme.fontSize.title, 80);
  assert.equal(g.theme.fontSize.logs, THEME_DEFAULTS.fontSize.logs);
  assert.equal(Object.keys(g.theme.fontSize).length, 9);
  assert.equal(THEME_DEFAULTS.fontSize.title, 62, 'defaults must not be mutated');
});
