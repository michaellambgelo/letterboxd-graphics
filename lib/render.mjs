// The one place a graphic becomes pixels. The PNG build and the editor preview
// both call in here, so what you see while editing is what gets exported.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

export function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

// Serves `root` on a random loopback port. `extra` gets first refusal on a
// request, so the editor can mount its API on the same origin as the preview.
export function startStaticServer(root, extra = null) {
  const server = http.createServer(async (req, res) => {
    if (extra && await extra(req, res)) return;
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = resolve(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({
      port: server.address().port,
      close: () => server.close(),
      server,
    }));
  });
}

// Open the template with the graphic injected, wait for it to settle, and
// screenshot the sheet element.
export async function screenshotGraphic({ browser, url, graphic, scale = 2, timeout = 20000 }) {
  const page = await browser.newPage({
    viewport: { width: graphic.width, height: graphic.height },
    deviceScaleFactor: scale,
  });
  try {
    await page.addInitScript((g) => { window.__GRAPHIC__ = g; }, graphic);
    const res = await page.goto(url, { waitUntil: 'load' });
    if (!res || !res.ok()) throw new Error(`template failed to load: ${url}`);

    // Never screenshot before the posters have decoded — that is how you get a
    // PNG with empty rectangles where the art should be.
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout });

    // A poster that 404'd "loads successfully" as a broken image with
    // naturalWidth 0, which would otherwise ship silently.
    const broken = await page.$$eval('img.poster', (imgs) =>
      imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
    if (broken.length) {
      throw new Error(`${broken.length} poster(s) failed to decode:\n  ${broken.join('\n  ')}`);
    }

    return await page.locator('#sheet').screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}
