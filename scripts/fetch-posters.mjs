// Fill gaps in posters/ from TMDB. Only fetches films that have no file yet —
// anything you dropped in by hand always wins.
//
//   npm run fetch-posters august
//   npm run fetch-posters august -- --yes     # accept the year-matched hit
//   npm run fetch-posters august -- --size original
//
// The key is never passed on the command line or exported into the environment.
// It is read per-run from the macOS Keychain:
//
//   ~/.dotfiles/secrets/keychain-secrets.sh set TMDB_API_KEY
//
// A v3 API key and a v4 read-access token both work; they are told apart by shape.

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { posterStem } from '../lib/slug.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

async function tmdbCredential() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-a', process.env.USER, '-s', 'dotfiles.TMDB_API_KEY', '-w',
    ]);
    const v = stdout.trim();
    if (v) return v;
  } catch { /* fall through to the message below */ }
  throw new Error(
    'No TMDB credential found.\n' +
    '  Store one in the Keychain (it is never printed or logged):\n' +
    '    ~/.dotfiles/secrets/keychain-secrets.sh set TMDB_API_KEY\n' +
    '  and add TMDB_API_KEY to ~/.dotfiles/secrets/secrets.manifest.\n' +
    '  Alternatively, drop poster files into posters/ by hand and skip this step.'
  );
}

// v4 read-access tokens are JWTs; v3 keys are 32 hex chars.
function authFor(cred) {
  return cred.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${cred}` }, query: '' }
    : { headers: {}, query: `api_key=${encodeURIComponent(cred)}` };
}

async function tmdb(path, params, auth) {
  const qs = new URLSearchParams(params);
  const url = `https://api.themoviedb.org/3${path}?${qs}${auth.query ? '&' + auth.query : ''}`;
  const res = await fetch(url, { headers: auth.headers });
  if (!res.ok) {
    const hint = res.status === 401 ? ' (check the stored TMDB credential)' : '';
    throw new Error(`TMDB ${res.status} on ${path}${hint}`);
  }
  return res.json();
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function hasPoster(film) {
  const stem = posterStem(film.title, film.year);
  for (const ext of POSTER_EXTS) {
    if (await exists(join(ROOT, 'posters', stem + ext))) return stem + ext;
  }
  return null;
}

function parseArgs(argv) {
  const out = { name: null, yes: false, size: 'w500' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--size') out.size = argv[++i];
    else if (!a.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    console.error('usage: npm run fetch-posters <graphic-name> [-- --yes] [-- --size w500|original]');
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

  const cred = await tmdbCredential();
  const auth = authFor(cred);
  const rl = args.yes ? null : createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (const film of missing) {
      const data = await tmdb('/search/movie', {
        query: film.title, year: String(film.year), include_adult: 'false',
      }, auth);

      const hits = (data.results || []).filter((r) => r.poster_path);
      if (!hits.length) {
        console.error(`\n  no TMDB result with a poster for "${film.title}" (${film.year}) — add the file by hand`);
        continue;
      }

      // Same-titled films are common (Luca 2021 vs 2008, Past Lives 2023 vs
      // others), so show the year on every candidate before committing.
      console.log(`\n  ${film.title} (${film.year})`);
      hits.slice(0, 5).forEach((r, i) => {
        console.log(`    [${i}] ${r.id}  ${r.title}  ${r.release_date || '????'}`);
      });

      let pick = hits[0];
      if (!args.yes) {
        const ans = (await rl.question(`    take [0]? (index / s to skip) `)).trim();
        if (ans.toLowerCase() === 's') { console.log('    skipped'); continue; }
        if (ans) {
          const i = Number(ans);
          if (!Number.isInteger(i) || !hits[i]) { console.log('    bad index — skipped'); continue; }
          pick = hits[i];
        }
      }

      const url = `https://image.tmdb.org/t/p/${args.size}${pick.poster_path}`;
      const res = await fetch(url);
      if (!res.ok) { console.error(`    download failed: ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const file = join(ROOT, 'posters', `${posterStem(film.title, film.year)}.jpg`);
      await writeFile(file, buf);
      console.log(`    -> posters/${posterStem(film.title, film.year)}.jpg  (${(buf.length / 1024).toFixed(0)} KB)`);
    }
  } finally {
    rl?.close();
  }
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
