// Drive the corridor harness and capture matched-viewpoint renders plus cost.
//
// Two things this must not do, both learned the hard way on this project. It must
// not build into portals/dist, because a live preview server there serves a
// half-written bundle and 404s the game chunk. And it must not run headless or in
// a background tab: R3F stops its render loop when the tab is not visible, so the
// canvas comes back blank and no devtools call brings it forward.
//
// usage: node shoot.mjs <distDir> <outDir> <label> [view ...]
import { chromium } from '@playwright/test';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const [distArg, outArg, label, ...views] = process.argv.slice(2);
if (!distArg || !outArg || !label) {
  console.error('usage: node shoot.mjs <distDir> <outDir> <label> [view ...]');
  process.exit(2);
}
const dist = resolve(distArg);
const outDir = resolve(outArg);
await mkdir(outDir, { recursive: true });
const wanted = views.length > 0 ? views : ['runway', 'bridge', 'ramp'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const file = join(dist, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => { if (message.type() === 'error') console.error('console:', message.text()); });

const measured = [];
for (const view of wanted) {
  // `room:<set>` shoots one room on its own; a bare name shoots the corridor.
  const query = view.startsWith('rooms:')
    ? `rooms=${view.slice(6).split('@')[0]}${view.includes('@') ? `&chase=${view.split('@')[1]}` : ''}`
    : view.startsWith('room:')
      ? `room=${view.slice(5).replace('!', '')}${view.includes('!') ? '&mirror=1' : ''}`
      : `view=${view}`;
  const withDpr = process.env.HARNESS_DPR ? `${query}&dpr=${process.env.HARNESS_DPR}` : query;
  await page.goto(`${base}/index.html?${withDpr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const file = join(outDir, `${label}-${view.replace(':', '-').replace('!', '-mirrored').replace('@', '-at')}.png`);
  await writeFile(file, Buffer.from(
    (await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'))).split(',')[1],
    'base64',
  ));
  const stats = await page.evaluate(() => window.__stats);
  measured.push({ view, file, ...stats });
  console.log(`${view}  drawCalls=${stats.calls} triangles=${stats.triangles} programs=${stats.programs} frameMs=${stats.frameMs.toFixed(3)}`);
}
await writeFile(join(outDir, `${label}-cost.json`), JSON.stringify(measured, null, 2));
await browser.close();
server.close();
