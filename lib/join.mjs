// Join a film (title + year) to the ratings and log counts in letterboxd-viewer.
//
// Primary source is data/viewing_history.json — the merged archive+RSS diary,
// which carries both the watch count and the member rating per entry. The
// archive's ratings.csv is only a fallback, for a film that was rated without
// ever being logged in the diary.

import { readFile, readdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { filmKey, slugify } from './slug.mjs';

const DEFAULT_VIEWER_PATH = joinPath(homedir(), 'Workspace', 'letterboxd-viewer');

export function viewerPath() {
  return process.env.LETTERBOXD_VIEWER_PATH || DEFAULT_VIEWER_PATH;
}

// Minimal RFC4180 parser. Letterboxd review/list CSVs contain quoted commas and
// embedded newlines, so splitting on ',' is not good enough.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift();
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// The archive directory is date-stamped (letterboxd-<user>-YYYY-MM-DD-HH-MM-utc).
// Glob and take the newest rather than hardcoding a path that expires with the
// next export — this mirrors load_archive.get_export_date() on the Python side.
async function newestArchiveDir(root) {
  const dir = joinPath(root, 'data', 'archive');
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return null; }
  const dirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('letterboxd-'))
    .map(e => e.name)
    .sort();                       // name sorts chronologically: the date is fixed-width
  return dirs.length ? joinPath(dir, dirs[dirs.length - 1]) : null;
}

// Build { key -> { title, year, rating, logs } } once, then look films up.
export async function loadDiaryIndex() {
  const root = viewerPath();

  let history;
  try {
    history = JSON.parse(await readFile(joinPath(root, 'data', 'viewing_history.json'), 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not read viewing_history.json under ${root}\n` +
      `  ${err.message}\n` +
      `  Set LETTERBOXD_VIEWER_PATH if letterboxd-viewer lives elsewhere.`
    );
  }

  const index = new Map();
  for (const e of history) {
    const title = e.filmTitle, year = e.filmYear;
    if (!title || !year) continue;
    const key = filmKey(title, year);
    let rec = index.get(key);
    if (!rec) {
      rec = { title, year: String(year), logs: 0, rating: null, ratedOn: '', source: 'diary' };
      index.set(key, rec);
    }
    rec.logs++;
    // Latest non-null rating wins — a re-rate on a rewatch supersedes the old one.
    const r = e.memberRating;
    const watched = e.watchedDate || '';
    if (r !== null && r !== undefined && r !== '' && watched >= rec.ratedOn) {
      rec.rating = Number(r);
      rec.ratedOn = watched;
    }
  }

  // Fallback layer: films with a rating but no diary entry.
  const archive = await newestArchiveDir(root);
  if (archive) {
    try {
      const rows = parseCsv(await readFile(joinPath(archive, 'ratings.csv'), 'utf8'));
      for (const row of rows) {
        const title = row.Name, year = row.Year;
        if (!title || !year) continue;
        const key = filmKey(title, year);
        const rec = index.get(key);
        if (!rec) {
          index.set(key, {
            title, year: String(year), logs: 0,
            rating: Number(row.Rating), ratedOn: '', source: 'ratings.csv',
          });
        } else if (rec.rating === null) {
          rec.rating = Number(row.Rating);
        }
      }
    } catch { /* ratings.csv is optional */ }
  }

  return index;
}

// Resolve one film. Config values override the join, so a graphic can include
// something that isn't in the diary at all.
export function resolveFilm(index, film) {
  const key = filmKey(film.title, film.year);
  const hit = index.get(key);

  const rating = film.rating ?? hit?.rating ?? null;
  const logs   = film.logs   ?? hit?.logs   ?? null;

  if (!hit && (film.rating === undefined || film.logs === undefined)) {
    throw new Error(unmatchedMessage(index, film));
  }
  return { ...film, year: String(film.year), rating, logs, matched: Boolean(hit) };
}

// A silent zero on a graphic you are about to post is the bad outcome, so an
// unmatched title is fatal — with the near-misses spelled out.
function unmatchedMessage(index, film) {
  const wanted = slugify(film.title);

  const sameSlug = [];
  const scored = [];
  for (const rec of index.values()) {
    const s = slugify(rec.title);
    if (s === wanted) { sameSlug.push(rec); continue; }
    // Substring only counts for slugs long enough to be meaningful — otherwise
    // a film literally titled "X" matches everything containing an "x".
    const substring = wanted.length >= 5 && s.length >= 5 && (s.includes(wanted) || wanted.includes(s));
    const dist = editDistance(s, wanted);
    if (substring || dist <= Math.max(1, Math.floor(wanted.length / 5))) {
      scored.push({ rec, dist: substring ? 0 : dist });
    }
  }
  scored.sort((a, b) => a.dist - b.dist);

  const lines = [`No diary match for "${film.title}" (${film.year}).`];
  if (sameSlug.length) {
    lines.push(`  Same title, different year: ${sameSlug.map(r => `${r.title} (${r.year})`).join(', ')}`);
    lines.push(`  -> fix the "year" in the config, or set "rating"/"logs" explicitly.`);
  } else if (scored.length) {
    lines.push(`  Did you mean: ${scored.slice(0, 5).map(s => `${s.rec.title} (${s.rec.year})`).join(', ')}`);
  } else {
    lines.push(`  Nothing similar in the diary. Set "rating" and "logs" in the config to include it anyway.`);
  }
  return lines.join('\n');
}

// Levenshtein, capped: we only care whether two titles are a typo apart, so bail
// out early once the row minimum exceeds the budget.
function editDistance(a, b, max = 4) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}
