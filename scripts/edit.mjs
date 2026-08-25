// Local editor: form on the left, the real template live-rendering on the right.
//
//   npm run edit            # opens the browser at the first graphic
//   npm run edit august     # opens a specific one
//
// Binds to loopback only. The preview iframe loads the same template the PNG
// build uses and is repainted by calling its __RENDER__ directly, so what you
// see while editing is what gets exported.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadDiaryIndex, loadFilmUris } from '../lib/join.mjs';
import { filmKey, posterStem, slugify } from '../lib/slug.mjs';
import { resolveGraphic, listGraphics, THEME_DEFAULTS } from '../lib/graphic.mjs';
import { startStaticServer } from '../lib/render.mjs';
import {
  ROOT, letterboxdFilmInfo, tmdbCredential, hasTmdbCredential, authFor,
  tmdbPosterOptions, tmdbSearch, downloadPoster, findPosterFile, TMDB_HELP,
  normalisePosterUrl,
} from '../lib/posters.mjs';

// A graphic name becomes a filename, so it never gets to contain a dot or a
// slash — the browser is not trusted to pick a write path.
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const safeName = (n) => typeof n === 'string' && NAME_RE.test(n) && !n.includes('..') && !n.includes('/');

let diaryIndex = null;
let uriIndex = null;
const infoCache = new Map();   // filmKey -> letterboxdFilmInfo result

async function diary() { return (diaryIndex ||= await loadDiaryIndex()); }
async function uris()  { return (uriIndex   ||= await loadFilmUris()); }

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('body was not JSON')); }
    });
    req.on('error', reject);
  });
}

// A config must look like a config before it is allowed to overwrite one.
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'config must be an object';
  if (typeof cfg.title !== 'string') return 'config.title must be a string';
  if (!Array.isArray(cfg.films)) return 'config.films must be an array';
  for (const [i, f] of cfg.films.entries()) {
    if (!f || typeof f.title !== 'string' || !f.title.trim()) return `films[${i}].title is required`;
    if (f.year === undefined || f.year === null || String(f.year).trim() === '') return `films[${i}].year is required`;
  }
  return null;
}

// Look up a film's Letterboxd page once per process — it yields both the poster
// and the TMDB id the picker needs.
async function filmInfo(film) {
  const key = filmKey(film.title, film.year);
  if (infoCache.has(key)) return infoCache.get(key);
  const uri = (await uris()).get(key);
  if (!uri) return null;
  const info = await letterboxdFilmInfo(uri);
  infoCache.set(key, info);
  return info;
}

async function api(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  try {
    // ---- list graphics -------------------------------------------------
    if (path === '/api/graphics' && req.method === 'GET') {
      json(res, 200, { graphics: await listGraphics(), tmdb: await hasTmdbCredential(), defaults: THEME_DEFAULTS });
      return true;
    }

    // ---- read one ------------------------------------------------------
    let m = path.match(/^\/api\/graphic\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const name = decodeURIComponent(m[1]);
      if (!safeName(name)) { json(res, 400, { error: 'bad graphic name' }); return true; }
      const cfg = JSON.parse(await readFile(join(ROOT, 'graphics', `${name}.json`), 'utf8'));
      const { graphic, problems } = await resolveGraphic(cfg, { strict: false, index: await diary() });
      json(res, 200, { config: cfg, graphic, problems });
      return true;
    }

    // ---- save one ------------------------------------------------------
    if (m && req.method === 'PUT') {
      const name = decodeURIComponent(m[1]);
      if (!safeName(name)) { json(res, 400, { error: 'bad graphic name' }); return true; }
      const cfg = await readBody(req);
      const bad = validateConfig(cfg);
      if (bad) { json(res, 400, { error: bad }); return true; }
      await writeFile(join(ROOT, 'graphics', `${name}.json`), JSON.stringify(cfg, null, 2) + '\n');
      json(res, 200, { saved: name });
      return true;
    }

    // ---- resolve a draft (live preview data) ---------------------------
    if (path === '/api/resolve' && req.method === 'POST') {
      const cfg = await readBody(req);
      const bad = validateConfig(cfg);
      if (bad) { json(res, 400, { error: bad }); return true; }
      const { graphic, problems } = await resolveGraphic(cfg, { strict: false, index: await diary() });
      json(res, 200, { graphic, problems });
      return true;
    }

    // ---- diary search (adding films) -----------------------------------
    if (path === '/api/diary' && req.method === 'GET') {
      const q = slugify(url.searchParams.get('q') || '');
      if (q.length < 2) { json(res, 200, { results: [] }); return true; }
      const out = [];
      for (const rec of (await diary()).values()) {
        const s = slugify(rec.title);
        if (s.includes(q)) out.push({ title: rec.title, year: rec.year, rating: rec.rating, logs: rec.logs });
        if (out.length > 300) break;
      }
      // Prefix matches first, then the most-logged — a search for "before" should
      // surface the trilogy, not an obscure film with "before" buried in it.
      out.sort((a, b) => {
        const ap = slugify(a.title).startsWith(q), bp = slugify(b.title).startsWith(q);
        if (ap !== bp) return ap ? -1 : 1;
        return (b.logs || 0) - (a.logs || 0);
      });
      json(res, 200, { results: out.slice(0, 25) });
      return true;
    }

    // ---- poster options -------------------------------------------------
    if (path === '/api/posters' && req.method === 'GET') {
      const title = url.searchParams.get('title') || '';
      const year = url.searchParams.get('year') || '';
      const film = { title, year };
      const options = [];
      let note = null;

      const current = await findPosterFile(film);
      if (current) {
        options.push({ label: 'current', url: `/posters/${encodeURIComponent(current)}`,
                       thumb: `/posters/${encodeURIComponent(current)}`, current: true });
      }

      let info = null;
      try { info = await filmInfo(film); }
      catch (err) { note = `Letterboxd lookup failed: ${err.message}`; }

      if (info?.poster) {
        options.push({ label: 'letterboxd', url: info.poster, thumb: info.poster });
      }

      // Alternate art is the one thing Letterboxd cannot give — it serves a
      // single poster per film. That is what TMDB is here for.
      if (info?.tmdbId) {
        try {
          const auth = authFor(await tmdbCredential());
          for (const p of await tmdbPosterOptions(info.tmdbId, auth)) {
            options.push({ label: p.lang, url: p.full, thumb: p.thumb, width: p.width, height: p.height });
          }
        } catch (err) {
          note = /No TMDB|find-generic-password|empty TMDB/.test(err.message) ? TMDB_HELP : `TMDB: ${err.message}`;
        }
      } else if (!info) {
        // Not in the diary: fall back to a TMDB title search.
        try {
          const auth = authFor(await tmdbCredential());
          const hits = await tmdbSearch(title, year, auth);
          for (const h of hits.slice(0, 6)) {
            const alts = await tmdbPosterOptions(h.id, auth, { limit: 6 });
            for (const p of alts) options.push({ label: `${h.title} ${(h.release_date || '').slice(0, 4)}`, url: p.full, thumb: p.thumb });
          }
        } catch (err) {
          note = /No TMDB|find-generic-password|empty TMDB/.test(err.message) ? TMDB_HELP : `TMDB: ${err.message}`;
        }
      }

      const links = {
        letterboxd: info?.page || null,
        tmdb: info?.tmdbId ? `https://www.themoviedb.org/movie/${info.tmdbId}` : null,
        tmdbPosters: info?.tmdbId
          ? `https://www.themoviedb.org/movie/${info.tmdbId}/images/posters`
          : `https://www.themoviedb.org/search?query=${encodeURIComponent(title)}`,
      };

      json(res, 200, { options, note, links, tmdbId: info?.tmdbId ?? null, stem: posterStem(title, year) });
      return true;
    }

    // ---- choose a poster -------------------------------------------------
    if (path === '/api/poster' && req.method === 'POST') {
      const { title, year, url: src } = await readBody(req);
      if (!title || !year || !src) { json(res, 400, { error: 'title, year and url are required' }); return true; }
      if (String(src).startsWith('/posters/')) { json(res, 200, { unchanged: true }); return true; }
      let url;
      try { url = normalisePosterUrl(src); }
      catch (err) { json(res, 400, { error: err.message }); return true; }
      const saved = await downloadPoster(url, { title, year });
      json(res, 200, saved);
      return true;
    }

    // ---- render ----------------------------------------------------------
    m = path.match(/^\/api\/render\/([^/]+)$/);
    if (m && req.method === 'POST') {
      const name = decodeURIComponent(m[1]);
      if (!safeName(name)) { json(res, 400, { error: 'bad graphic name' }); return true; }
      const args = [join(ROOT, 'scripts', 'build.mjs'), name];
      const { scale } = await readBody(req).catch(() => ({}));
      if (scale === 1) args.push('--1x');
      const child = spawn(process.execPath, args, { cwd: ROOT });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const code = await new Promise((r) => child.on('close', r));
      json(res, code === 0 ? 200 : 500, {
        ok: code === 0,
        // Surface the real join/poster error in the UI instead of a blank 500.
        output: (out + err).trim(),
        png: code === 0 ? `/out/${name}.png` : null,
      });
      return true;
    }

    json(res, 404, { error: 'no such endpoint' });
    return true;
  } catch (err) {
    json(res, 500, { error: err.message });
    return true;
  }
}

// The editor page itself lives outside the static root's normal paths.
async function routes(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' ) {
    const html = await readFile(join(ROOT, 'editor', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }
  return api(req, res);
}

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const wanted = argv.find((a) => !a.startsWith('-'));
  const all = await listGraphics();
  if (!all.length) {
    console.error('No graphics found. Create graphics/<name>.json first.');
    process.exit(2);
  }
  const start = wanted && all.includes(wanted) ? wanted : all[0];

  const server = await startStaticServer(ROOT, routes);
  const url = `http://127.0.0.1:${server.port}/#${start}`;
  console.log(`\n  letterboxd-graphics editor\n  ${url}\n`);
  if (!await hasTmdbCredential()) {
    console.log('  (no TMDB credential — poster picker will show Letterboxd art only)\n');
  }
  if (!noOpen) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
