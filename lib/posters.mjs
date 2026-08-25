// Poster sourcing. Two providers, and the id plumbing that connects them.
//
// Letterboxd is primary and needs no credential: the archive's watched.csv
// carries an exact boxd.it URI per logged film, and the film page's JSON-LD
// gives a 600x900 poster. The same page also carries `data-tmdb-id`, which is
// how the poster picker reaches TMDB's full art set without a title search.

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { posterStem } from './slug.mjs';

const execFileAsync = promisify(execFile);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const POSTER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

// Letterboxd serves a challenge to obviously-automated clients.
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) { try { await access(p); return true; } catch { return false; } }

// The poster a film currently has, or null. A file the user dropped in always wins.
export async function findPosterFile(film) {
  const stem = posterStem(film.title, film.year);
  for (const ext of POSTER_EXTS) {
    if (await exists(join(ROOT, 'posters', stem + ext))) return stem + ext;
  }
  return null;
}

// ---------------------------------------------------------------- letterboxd

// One request, two answers: the poster URL and the TMDB id. Callers that want
// both should not fetch the page twice.
export async function letterboxdFilmInfo(uri) {
  const res = await fetch(uri, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Letterboxd returned ${res.status}`);
  const html = await res.text();

  let poster = null, name = null;
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (m) {
    const raw = m[1].replace('/* <![CDATA[ */', '').replace('/* ]]> */', '').trim();
    try {
      const data = JSON.parse(raw);
      poster = data.image || null;
      name = data.name || null;
    } catch { /* fall through — poster stays null */ }
  }
  if (!poster) throw new Error('film page carried no JSON-LD poster');

  const idMatch = html.match(/data-tmdb-id="(\d+)"/);
  const typeMatch = html.match(/data-tmdb-type="(\w+)"/);

  return {
    poster,
    name,
    page: res.url,
    tmdbId: idMatch ? Number(idMatch[1]) : null,
    tmdbType: typeMatch ? typeMatch[1] : null,
  };
}

// --------------------------------------------------------------------- tmdb

export async function tmdbCredential() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
  const { stdout } = await execFileAsync('security', [
    'find-generic-password', '-a', process.env.USER, '-s', 'dotfiles.TMDB_API_KEY', '-w',
  ]);
  const v = stdout.trim();
  if (!v) throw new Error('empty TMDB credential in the Keychain');
  return v;
}

export async function hasTmdbCredential() {
  try { await tmdbCredential(); return true; } catch { return false; }
}

export const TMDB_HELP =
  'No TMDB credential stored. Alternate poster art needs one:\n' +
  '  ~/.dotfiles/secrets/keychain-secrets.sh set TMDB_API_KEY\n' +
  'plus TMDB_API_KEY in ~/.dotfiles/secrets/secrets.manifest.';

// v4 read-access tokens are JWTs; v3 keys are 32 hex chars.
export function authFor(cred) {
  return cred.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${cred}` }, query: '' }
    : { headers: {}, query: `api_key=${encodeURIComponent(cred)}` };
}

async function tmdbGet(path, params, auth) {
  const qs = new URLSearchParams(params);
  const url = `https://api.themoviedb.org/3${path}?${qs}${auth.query ? '&' + auth.query : ''}`;
  const res = await fetch(url, { headers: auth.headers });
  if (!res.ok) {
    throw new Error(`TMDB ${res.status}${res.status === 401 ? ' (check the stored credential)' : ''}`);
  }
  return res.json();
}

// Every poster TMDB holds for a film. include_image_language picks up the
// no-language variants (textless art), which are often the nicest ones.
export async function tmdbPosterOptions(tmdbId, auth, { limit = 24 } = {}) {
  const data = await tmdbGet(`/movie/${tmdbId}/images`,
    { include_image_language: 'en,null' }, auth);
  return (data.posters || [])
    .slice(0, limit)
    .map((p) => ({
      thumb: `https://image.tmdb.org/t/p/w185${p.file_path}`,
      full: `https://image.tmdb.org/t/p/w780${p.file_path}`,
      width: p.width,
      height: p.height,
      lang: p.iso_639_1 || 'textless',
      vote: p.vote_average,
    }));
}

// Fallback discovery for a film with no boxd.it URI (not in the diary).
export async function tmdbSearch(title, year, auth) {
  const data = await tmdbGet('/search/movie',
    { query: title, year: String(year), include_adult: 'false' }, auth);
  return (data.results || []).filter((r) => r.poster_path);
}

// ------------------------------------------------------------------ writing

export async function downloadPoster(url, film) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(join(ROOT, 'posters'), { recursive: true });
  const name = `${posterStem(film.title, film.year)}.jpg`;
  await writeFile(join(ROOT, 'posters', name), buf);
  return { name, bytes: buf.length };
}

export async function readConfig(name) {
  return JSON.parse(await readFile(join(ROOT, 'graphics', `${name}.json`), 'utf8'));
}
