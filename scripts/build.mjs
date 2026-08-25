// Render a graphic config to a PNG via headless Chromium.
//
//   npm run build august            # out/august.png at 2x (2160x2700)
//   npm run build august -- --1x    # nominal size (1080x1350)
//   npm run build august -- --out /tmp/foo.png
//
// Modeled on ~/Workspace/claude-design-mp4/templates/export-mp4.mjs: a local
// static server plus playwright. Serving over HTTP rather than file:// is
// deliberate — file:// blocks the XHR/font loads the template may want.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { loadGraphic, templatePath, ROOT } from '../lib/graphic.mjs';
import { startStaticServer, screenshotGraphic } from '../lib/render.mjs';

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

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    console.error('usage: npm run build <graphic-name> [-- --1x] [-- --out path.png]');
    process.exit(2);
  }

  // Join and poster resolution happen before the browser starts: a bad title or
  // a missing poster should fail fast, not after a Chromium launch.
  let graphic;
  try {
    ({ graphic } = await loadGraphic(args.name, { strict: true }));
  } catch (err) {
    console.error('\n' + err.message);
    process.exit(2);
  }

  for (const f of graphic.films) {
    console.log(`  ${f.title} (${f.year})  ${f.rating ?? '—'}★  ${f.logs ?? '—'} logs  [${f.matched ? 'diary' : 'config'}]`);
  }

  const server = await startStaticServer(ROOT);
  const browser = await chromium.launch();
  try {
    const buf = await screenshotGraphic({
      browser,
      url: `http://127.0.0.1:${server.port}${templatePath(graphic)}`,
      graphic,
      scale: args.scale,
    });

    const outPath = args.out
      ? resolve(process.cwd(), args.out)
      : join(ROOT, 'out', `${args.name}.png`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, buf);

    console.log(`\n  ${outPath}`);
    console.log(`  ${graphic.width * args.scale}x${graphic.height * args.scale}  (${(buf.length / 1024).toFixed(0)} KB)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
