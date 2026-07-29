// Frame cost inside the real game, not the corridor harness.
//
// The harness isolates the environment, which is the right measurement for
// deciding whether a change to the environment paid for itself, but it leaves
// out physics, traps, the HUD and the player. This drives the shipped bundle
// into an actual attempt and samples requestAnimationFrame deltas over it.
//
// Same two rules as shoot.mjs: a private dist, and a real foregrounded window,
// because R3F stops rendering in a background tab and reports a frame time of
// whatever the throttled timer gives it.
//
// usage: node measure-run.mjs <distDir> <label> [seconds]
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const [distArg, label, secondsArg] = process.argv.slice(2);
if (!distArg || !label) {
  console.error('usage: node measure-run.mjs <distDir> <label> [seconds]');
  process.exit(2);
}
const dist = resolve(distArg);
const seconds = Number(secondsArg ?? 10);
const outDir = resolve(dist, '..');
await mkdir(outDir, { recursive: true });

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

await page.goto(`${base}/index.html`, { waitUntil: 'load' });
// The shell is a menu before it is a game. Walk whatever call to action is on
// screen until a canvas exists and is being driven.
for (const name of [/start a fresh chain/i, /play/i, /beat it/i, /run it/i]) {
  const button = page.getByRole('button', { name }).first();
  if (await button.count().catch(() => 0)) {
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
}
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForTimeout(3000);
// Hold forward so the runner actually travels the course and the camera moves
// past the rooms rather than measuring one static frame.
await page.keyboard.down('KeyW');

const samples = await page.evaluate(async (duration) => {
  const deltas = [];
  let last = performance.now();
  const started = last;
  await new Promise((done) => {
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - started >= duration * 1000) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return deltas;
}, seconds);
await page.keyboard.up('KeyW');

// The first few frames carry shader compilation and are not a steady state.
const steady = samples.slice(10).sort((a, b) => a - b);
const at = (q) => steady[Math.min(steady.length - 1, Math.floor(steady.length * q))];
const mean = steady.reduce((sum, value) => sum + value, 0) / steady.length;
const report = {
  label,
  frames: steady.length,
  meanMs: Number(mean.toFixed(3)),
  medianMs: Number(at(0.5).toFixed(3)),
  p95Ms: Number(at(0.95).toFixed(3)),
  worstMs: Number(steady.at(-1).toFixed(3)),
  fpsFromMean: Number((1000 / mean).toFixed(1)),
};
console.log(JSON.stringify(report));
await writeFile(join(outDir, `${label}-ingame.json`), JSON.stringify(report, null, 2));
await page.screenshot({ path: join(outDir, `${label}-ingame.png`) });
await browser.close();
server.close();
