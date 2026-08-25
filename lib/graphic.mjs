// Turn a graphics/<name>.json config into a render-ready payload: diary data
// joined, posters resolved to served URLs, theme defaults filled in.
//
// Both the PNG build and the editor's live preview go through here, so the
// preview cannot drift from the output.

import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadDiaryIndex, resolveFilm } from './join.mjs';
import { posterStem } from './slug.mjs';
import { findPosterFile, ROOT, readConfig } from './posters.mjs';

// Defaults live here rather than in the template, so an older config keeps
// rendering identically when new knobs are added.
export const THEME_DEFAULTS = {
  ground: '#14181c',
  accent: '#00e054',
  accent2: '#40bcf4',
  accent3: '#ff8000',
  gap: 26,
  posterRadius: 5,
  // Multiplies every font size at once, for quick global tuning.
  scale: 1,
  // Per-element type sizes in px, measured at the nominal 1080px width. Every
  // piece of text on the graphic is listed here and individually adjustable.
  fontSize: {
    eyebrow: 17,
    title: 62,
    subtitle: 19,
    filmTitle: 16.5,
    filmYear: 14,
    stars: 15,
    logs: 13,
    footnote: 14.5,
    handle: 14,
  },
};

export const FONT_SIZE_LABELS = {
  eyebrow: 'Eyebrow',
  title: 'Title',
  subtitle: 'Subtitle',
  filmTitle: 'Film title',
  filmYear: 'Film year',
  stars: 'Stars',
  logs: 'Log count',
  footnote: 'Footnote',
  handle: 'Handle',
};

export async function listGraphics() {
  const files = await readdir(join(ROOT, 'graphics'));
  return files.filter((f) => f.endsWith('.json') && !f.startsWith('_'))
              .map((f) => f.replace(/\.json$/, ''))
              .sort();
}

// `strict` fails on an unresolvable film (the PNG build). The editor passes
// false so a half-finished config still previews, with the gaps marked.
// Stamp a poster URL with the file's mtime. Swapping a film's art rewrites the
// same path, and the browser will happily keep showing the image it already has
// — the editor preview would silently lie about what the PNG will contain.
// A content-derived query makes the change visible without disabling caching.
async function versioned(url) {
  try {
    const { mtimeMs } = await stat(join(ROOT, decodeURIComponent(url).replace(/^\/+/, '')));
    return `${url}?v=${Math.round(mtimeMs)}`;
  } catch {
    return url;
  }
}

export async function resolveGraphic(cfg, { strict = true, index } = {}) {
  const diary = index || await loadDiaryIndex();
  const films = [];
  const problems = [];

  for (const f of cfg.films || []) {
    let joined;
    try {
      joined = resolveFilm(diary, f);
    } catch (err) {
      problems.push(err.message);
      if (strict) continue;
      joined = { ...f, year: String(f.year), rating: f.rating ?? null, logs: f.logs ?? null, matched: false };
    }

    if (f.poster) {
      joined.poster = await versioned('/' + String(f.poster).replace(/^\/+/, ''));
      joined.hasPoster = true;
    } else {
      const file = await findPosterFile(joined);
      joined.poster = file ? await versioned(`/posters/${encodeURIComponent(file)}`) : null;
      joined.hasPoster = Boolean(file);
      if (!file) {
        problems.push(
          `No poster for "${f.title}" (${f.year}).\n` +
          `  Expected: posters/${posterStem(f.title, f.year)}{.jpg,.jpeg,.png,.webp,.avif}`
        );
      }
    }
    films.push(joined);
  }

  const graphic = {
    ...cfg,
    width: cfg.width ?? 1080,
    height: cfg.height ?? 1350,
    columns: cfg.columns ?? 4,
    template: cfg.template ?? 'letterboxd-dark',
    theme: {
      ...THEME_DEFAULTS,
      ...(cfg.theme || {}),
      fontSize: { ...THEME_DEFAULTS.fontSize, ...((cfg.theme || {}).fontSize || {}) },
    },
    films,
  };

  if (strict && problems.length) {
    const err = new Error(problems.join('\n\n'));
    err.problems = problems;
    throw err;
  }
  return { graphic, problems };
}

export async function loadGraphic(name, opts) {
  return resolveGraphic(await readConfig(name), opts);
}

export function templatePath(graphic) {
  return `/templates/${graphic.template}.html`;
}

export { ROOT, resolve, join };
