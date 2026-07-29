// Drive the shipped bundle into the track editor and prove the two new things
// work: a named map loads as an editable starting point, and the share button
// puts a decodable link on the clipboard.
//
// A unit test can prove middleOf strips the right ids. It cannot prove the
// button is wired, that the link is decodable, or that the course the recipient
// gets is the course that was built - which is the whole feature.
//
// usage: node editor-check.mjs <distDir> <outDir>
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const [distArg, outArg] = process.argv.slice(2);
if (!distArg || !outArg) {
  console.error('usage: node editor-check.mjs <distDir> <outDir>');
  process.exit(2);
}
const dist = resolve(distArg);
const outDir = resolve(outArg);
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

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.on('pageerror', (error) => console.error('pageerror:', error.message));

await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 120000 });
// The shell boots asynchronously (guest profile, asset gate), and under load
// that takes longer than a locator's default patience. Waiting for the menu to
// exist beats a bare timeout that fails as "button not found".
await page.getByRole('button', { name: /build your own/i }).waitFor({ timeout: 60000 });
const open = page.getByRole('button', { name: /build your own/i }).first();
await open.click({ timeout: 30000 });
await page.getByRole('heading', { name: /build the course/i }).waitFor({ timeout: 15000 });

// The curated maps must be offered as starting points, not just on the front screen.
const mapButton = page.locator('.track-editor-preset', { hasText: 'Rush Hour' }).first();
const mapCount = await page.locator('.track-editor-starters .track-editor-preset').count();
console.log(`starter buttons: ${mapCount}`);
await mapButton.click();
await page.waitForTimeout(400);
const loaded = await page.locator('.track-editor-course .track-editor-card').allInnerTexts();
console.log('after loading Rush Hour:', loaded.map((t) => t.split('\n')[1]).join(' | '));
await page.screenshot({ path: join(outDir, 'editor-maps.png') });

// Share must place a decodable link on the clipboard.
const share = page.getByRole('button', { name: /copy a link/i }).first();
console.log('share button present:', (await share.count()) > 0);
await share.click();
await page.waitForTimeout(1200);
const copied = await page.evaluate(() => navigator.clipboard.readText());
console.log('clipboard:', copied.slice(0, 140));
const match = /[?&]d=([^\s&]+)/.exec(copied);
console.log('link carries a payload:', Boolean(match));
if (match) {
  const decoded = await page.evaluate((param) => {
    const url = new URL(window.location.href);
    url.searchParams.set('d', param);
    return url.toString();
  }, match[1]);
  // Open the link the way a recipient would and see whether the game accepts it.
  const guest = await context.newPage();
  guest.on('pageerror', (error) => console.error('guest pageerror:', error.message));
  await guest.goto(decoded, { waitUntil: 'load' });
  await guest.waitForTimeout(3500);
  const damaged = await guest.getByText(/link|damaged|could not/i).count();
  console.log('recipient page shows a link error:', damaged > 0);
  await guest.screenshot({ path: join(outDir, 'editor-share-recipient.png') });
}
// Saving must survive a reload. A unit test can prove the storage functions
// round-trip; only the real page proves the button is wired to them and that
// the value written is the value the next visit reads.
await page.bringToFront();
// The panel scrolls inside its own container and the profile figure grew a
// band, so the field can sit below the fold. Bring it into view rather than
// waiting for it to become visible on its own.
await page.locator('.track-editor-savename').scrollIntoViewIfNeeded();
await page.fill('.track-editor-savename', 'My Rush Hour');
await page.getByRole('button', { name: /^Save$/ }).first().click();
await page.waitForTimeout(400);
const stored = await page.evaluate(() => localStorage.getItem('miw.track-editor.saves.v1'));
console.log('stored after save:', String(stored).slice(0, 160));

await page.reload({ waitUntil: 'load' });
await page.getByRole('button', { name: /build your own/i }).first().click({ timeout: 30000 });
await page.getByRole('heading', { name: /build the course/i }).waitFor({ timeout: 15000 });
const savedNames = await page.locator('.track-editor-savelist strong').allInnerTexts();
console.log('saves after reload:', JSON.stringify(savedNames));
await page.screenshot({ path: join(outDir, 'editor-saves.png') });

// And the migration, from the state a returning player is actually in.
await page.evaluate(() => {
  localStorage.removeItem('miw.track-editor.saves.v1');
  localStorage.setItem('miw.track-editor.draft.v1', JSON.stringify(['runway', 'bridge']));
});
await page.reload({ waitUntil: 'load' });
await page.getByRole('button', { name: /build your own/i }).first().click({ timeout: 30000 });
await page.getByRole('heading', { name: /build the course/i }).waitFor({ timeout: 15000 });
const migrated = await page.locator('.track-editor-savelist strong').allInnerTexts();
const course = await page.locator('.track-editor-course .track-editor-card').allInnerTexts();
console.log('after migration, saves:', JSON.stringify(migrated));
console.log('after migration, course:', course.map((x) => x.split(String.fromCharCode(10))[1]).join(' | '));

await writeFile(join(outDir, 'editor-check.txt'), copied);
await browser.close();
server.close();
