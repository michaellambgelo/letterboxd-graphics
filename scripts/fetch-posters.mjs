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
//      film-level boxd.it URI for everything logged. That URI *is* the film, so
//      the page's JSON-LD gives a 600x900 poster with no title search and no
//      same-title collision to resolve.
//   2. TMDB (fallback). Only for a film with no boxd.it URI — something not in
//      the diary, included via config overrides.
//
// For picking *between* poster variants, use the editor: `npm run edit`.

import { createInterface } from 'node:readline/promises';
import { filmKey, posterStem } from '../lib/slug.mjs';
import { loadFilmUris } from '../lib/join.mjs';
import {
  letterboxdFilmInfo, tmdbCredential, authFor, tmdbSearch,
  downloadPoster, findPosterFile, readConfig, sleep,
} from '../lib/posters.mjs';

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

  const cfg = await readConfig(args.name);

  const missing = [];
  for (const film of cfg.films) {
    if (film.poster) continue;                 // explicit path, not ours to manage
    const have = await findPosterFile(film);
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

      let url = null;
      if (uri) {
        try {
          const info = await letterboxdFilmInfo(uri);
          url = info.poster;
          console.log(`      letterboxd ${info.page.replace('https://letterboxd.com', '')}`);
        } catch (err) {
          // This source can start challenging without notice. Say so and move on
          // rather than hammering it.
          console.error(`      letterboxd failed: ${err.message}`);
          console.error('      -> retry with --tmdb, or drop the file in posters/');
          failures++;
          continue;
        }
      } else {
        console.log('      no boxd.it URI (unwatched?) — falling back to TMDB');
        try {
          if (!auth) auth = authFor(await tmdbCredential());
          const hits = await tmdbSearch(film.title, film.year, auth);
          if (!hits.length) throw new Error('no TMDB result with a poster');

          hits.slice(0, 5).forEach((r, i) => {
            console.log(`      [${i}] ${r.id}  ${r.title}  ${r.release_date || '????'}`);
          });

          let pick = hits[0];
          if (!args.yes) {
            rl ||= createInterface({ input: process.stdin, output: process.stdout });
            const ans = (await rl.question('      take [0]? (index / s to skip) ')).trim();
            if (ans.toLowerCase() === 's') { console.log('      skipped'); continue; }
            if (ans) {
              const i = Number(ans);
              if (!Number.isInteger(i) || !hits[i]) { console.log('      bad index — skipped'); continue; }
              pick = hits[i];
            }
          }
          url = `https://image.tmdb.org/t/p/${args.size}${pick.poster_path}`;
        } catch (err) {
          console.error(`      ${err.message}`);
          failures++;
          continue;
        }
      }

      try {
        const saved = await downloadPoster(url, film);
        console.log(`      -> posters/${saved.name}  (${(saved.bytes / 1024).toFixed(0)} KB)`);
      } catch (err) {
        console.error(`      ${err.message}`);
        failures++;
        continue;
      }

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
