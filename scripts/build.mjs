// Render a graphic config to a PNG via headless Chromium.
//
//   npm run build august            # out/august.png at 2x (2160x2700)
//   npm run build august -- --1x    # nominal size (1080x1350)
//   npm run build august -- --out /tmp/foo.png
//
// Modeled on ~/Workspace/claude-design-mp4/templates/export-mp4.mjs: a local
// static server plus playwright. Serving over HTTP rather than file:// is
// deliberate — file:// blocks the XHR/font loads the template may want.

import http from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadDiaryIndex, resolveFilm } from '../lib/join.mjs';
import { posterStem } from '../lib/slug.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const POSTER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

function parseArgs(argv) {
  const out = { name: null, scale: 2, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--1x') out.scale = 1;
    else if (a === '--2x') out.scale = 2;
    else if (a === '--out') out.out = argv[++i];
    else if (!a.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// A poster is whichever file the user dropped in posters/ under the film's
// stem. An explicit "poster" in the config overrides the convention.
async function resolvePoster(film) {
  if (film.poster) {
    const p = resolve(ROOT, film.poster);
    if (!(await exists(p))) {
      throw new Error(`Poster not found for "${film.title}": ${film.poster}`);
    }
    return '/' + p.slice(ROOT.length + 1).split('/').map(encodeURIComponent).join('/');
  }
  const stem = posterStem(film.title, film.year);
  for (const ext of POSTER_EXTS) {
    if (await exists(join(ROOT, 'posters', stem + ext))) {
      return `/posters/${encodeURIComponent(stem + ext)}`;
    }
  }
  throw new Error(
    `No poster for "${film.title}" (${film.year}).\n` +
    `  Expected: posters/${stem}{${POSTER_EXTS.join(',')}}\n` +
    `  Drop the file there, or run: npm run fetch-posters ${process.argv[2] || ''}`.trimEnd()
  );
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = resolve(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server)));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    console.error('usage: npm run build <graphic-name> [-- --1x] [-- --out path.png]');
    process.exit(2);
  }

  const cfgPath = join(ROOT, 'graphics', `${args.name}.json`);
  let cfg;
  try {
    cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read ${cfgPath}\n  ${err.message}`);
    process.exit(2);
  }

  const width = cfg.width ?? 1080;
  const height = cfg.height ?? 1350;
  const template = cfg.template ?? 'letterboxd-dark';

  // Join first: a bad title should fail before we spin up a browser.
  const index = await loadDiaryIndex();
  const films = [];
  const problems = [];
  for (const f of cfg.films) {
    try {
      const joined = resolveFilm(index, f);
      joined.poster = await resolvePoster(joined);
      films.push(joined);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length) {
    console.error(`\n${problems.length} film(s) could not be resolved:\n`);
    for (const p of problems) console.error(p + '\n');
    process.exit(2);
  }

  const graphic = { ...cfg, width, height, columns: cfg.columns ?? 4, films };

  for (const f of films) {
    const src = f.matched ? 'diary' : 'config';
    console.log(`  ${f.title} (${f.year})  ${f.rating ?? '—'}★  ${f.logs ?? '—'} logs  [${src}]`);
  }

  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: args.scale,
    });
    await page.addInitScript((g) => { window.__GRAPHIC__ = g; }, graphic);
    const res = await page.goto(`http://127.0.0.1:${port}/templates/${template}.html`,
      { waitUntil: 'load' });
    if (!res || !res.ok()) throw new Error(`template ${template}.html failed to load`);

    // Never screenshot before the posters have decoded — that is how you get a
    // PNG with empty rectangles where the art should be.
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 20000 });

    // Belt and braces: a poster that 404'd loads "successfully" as a broken
    // image with naturalWidth 0, which would otherwise ship silently.
    const broken = await page.$$eval('img.poster', (imgs) =>
      imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
    if (broken.length) {
      throw new Error(`${broken.length} poster(s) failed to decode:\n  ${broken.join('\n  ')}`);
    }

    const outPath = args.out
      ? resolve(process.cwd(), args.out)
      : join(ROOT, 'out', `${args.name}.png`);
    await mkdir(dirname(outPath), { recursive: true });
    const buf = await page.locator('#sheet').screenshot({ type: 'png' });
    await writeFile(outPath, buf);

    console.log(`\n  ${outPath}`);
    console.log(`  ${width * args.scale}x${height * args.scale}  (${(buf.length / 1024).toFixed(0)} KB)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
