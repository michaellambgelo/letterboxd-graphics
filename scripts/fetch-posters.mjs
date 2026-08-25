// Fill gaps in posters/. Only fetches films that have no file yet — anything you
// dropped in by hand always wins.
//
//   npm run fetch-posters august
//   npm run fetch-posters august -- --yes      # don't prompt on the TMDB fallback
//   npm run fetch-posters august -- --tmdb     # force the TMDB path
//
// Two sources, in order:
//
//   1. Letterboxd (default, no credential). The archive's watched.csv carries a
//      film-level boxd.it URI for everything you have logged. That URI *is* the
//      film — following it and reading the page's JSON-LD gives a 600x900 poster
//      with no title search and no same-title collision to resolve.
//   2. TMDB (fallback). Used only for a film with no boxd.it URI — something you
//      have not watched, included via config overrides. Needs a credential.

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { posterStem, filmKey } from '../lib/slug.mjs';
import { loadFilmUris } from '../lib/join.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

// Letterboxd serves a challenge to obviously-automated clients; a normal browser
// UA is what the rest of the pipeline uses too.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- letterboxd

async function posterFromLetterboxd(uri) {
  const res = await fetch(uri, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Letterboxd returned ${res.status}`);
  const html = await res.text();

  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no JSON-LD on the film page');

  const raw = m[1].replace('/* <![CDATA[ */', '').replace('/* ]]> */', '').trim();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('film page JSON-LD did not parse'); }

  if (!data.image) throw new Error('film page JSON-LD carried no poster');
  return { url: data.image, film: data.name, page: res.url };
}

// --------------------------------------------------------------------- tmdb

async function tmdbCredential() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-a', process.env.USER, '-s', 'dotfiles.TMDB_API_KEY', '-w',
    ]);
    const v = stdout.trim();
    if (v) return v;
  } catch { /* fall through */ }
  throw new Error(
    'No TMDB credential found, and this film has no Letterboxd URI to fall back on.\n' +
    '  Either drop the poster into posters/ by hand, or store a key:\n' +
    '    ~/.dotfiles/secrets/keychain-secrets.sh set TMDB_API_KEY'
  );
}

// v4 read-access tokens are JWTs; v3 keys are 32 hex chars.
function authFor(cred) {
  return cred.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${cred}` }, query: '' }
    : { headers: {}, query: `api_key=${encodeURIComponent(cred)}` };
}

async function posterFromTmdb(film, auth, opts) {
  const qs = new URLSearchParams({
    query: film.title, year: String(film.year), include_adult: 'false',
  });
  const url = `https://api.themoviedb.org/3/search/movie?${qs}${auth.query ? '&' + auth.query : ''}`;
  const res = await fetch(url, { headers: auth.headers });
  if (!res.ok) {
    throw new Error(`TMDB ${res.status}${res.status === 401 ? ' (check the stored credential)' : ''}`);
  }
  const hits = ((await res.json()).results || []).filter((r) => r.poster_path);
  if (!hits.length) throw new Error('no TMDB result with a poster');

  // Same-titled films are common, so show the year on every candidate.
  hits.slice(0, 5).forEach((r, i) => {
    console.log(`      [${i}] ${r.id}  ${r.title}  ${r.release_date || '????'}`);
  });

  let pick = hits[0];
  if (!opts.yes && opts.rl) {
    const ans = (await opts.rl.question('      take [0]? (index / s to skip) ')).trim();
    if (ans.toLowerCase() === 's') return null;
    if (ans) {
      const i = Number(ans);
      if (!Number.isInteger(i) || !hits[i]) throw new Error('bad index');
      pick = hits[i];
    }
  }
  return { url: `https://image.tmdb.org/t/p/${opts.size}${pick.poster_path}`, film: pick.title };
}

// --------------------------------------------------------------------- main

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function hasPoster(film) {
  const stem = posterStem(film.title, film.year);
  for (const ext of POSTER_EXTS) {
    if (await exists(join(ROOT, 'posters', stem + ext))) return stem + ext;
  }
  return null;
}

function parseArgs(argv) {
  const out = { name: null, yes: false, size: 'w500', tmdb: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--tmdb') out.tmdb = true;
    else if (a === '--size') out.size = argv[++i];
    else if (!a.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    console.error('usage: npm run fetch-posters <graphic-name> [-- --yes] [-- --tmdb]');
    process.exit(2);
  }

  const cfg = JSON.parse(await readFile(join(ROOT, 'graphics', `${args.name}.json`), 'utf8'));
  await mkdir(join(ROOT, 'posters'), { recursive: true });

  const missing = [];
  for (const film of cfg.films) {
    if (film.poster) continue;                 // explicit path, not ours to manage
    const have = await hasPoster(film);
    if (have) console.log(`  have  ${have}`);
    else missing.push(film);
  }
  if (!missing.length) {
    console.log('\nAll posters present. Nothing to fetch.');
    return;
  }

  const uris = args.tmdb ? new Map() : await loadFilmUris();

  let auth = null;
  let rl = null;
  let failures = 0;

  try {
    for (const film of missing) {
      const uri = uris.get(filmKey(film.title, film.year));
      console.log(`\n  ${film.title} (${film.year})`);

      let got = null;
      if (uri) {
        try {
          got = await posterFromLetterboxd(uri);
          console.log(`      letterboxd ${got.page.replace('https://letterboxd.com', '')}`);
        } catch (err) {
          // This source can start challenging without notice. Say so and move on
          // rather than hammering it — TMDB or a hand-dropped file is the answer.
          console.error(`      letterboxd failed: ${err.message}`);
          console.error(`      -> retry with --tmdb, or drop the file in posters/`);
          failures++;
          continue;
        }
      } else {
        console.log('      no boxd.it URI (unwatched?) — falling back to TMDB');
        try {
          if (!auth) auth = authFor(await tmdbCredential());
          if (!args.yes && !rl) rl = createInterface({ input: process.stdin, output: process.stdout });
          got = await posterFromTmdb(film, auth, { ...args, rl });
          if (!got) { console.log('      skipped'); continue; }
        } catch (err) {
          console.error(`      ${err.message}`);
          failures++;
          continue;
        }
      }

      const img = await fetch(got.url, { headers: { 'User-Agent': UA } });
      if (!img.ok) {
        console.error(`      download failed: ${img.status}`);
        failures++;
        continue;
      }
      const buf = Buffer.from(await img.arrayBuffer());
      const name = `${posterStem(film.title, film.year)}.jpg`;
      await writeFile(join(ROOT, 'posters', name), buf);
      console.log(`      -> posters/${name}  (${(buf.length / 1024).toFixed(0)} KB)`);

      await sleep(1200);   // be a polite client
    }
  } finally {
    rl?.close();
  }

  if (failures) {
    console.error(`\n${failures} poster(s) could not be fetched.`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
