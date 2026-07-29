// Capture review renders from the standalone preview harness.
// Usage: node shoot.mjs <outDir> <label> <view[:mode][:query]> [...]
//   node shoot.mjs ../renders blockout reference reference:clay top side

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/hammer/preview/index.html`;

const [outDirArg, label, ...specs] = process.argv.slice(2);
if (!outDirArg || !label || specs.length === 0) {
  console.error('usage: node shoot.mjs <outDir> <label> <view[:mode][:query]> ...');
  process.exit(2);
}
const outDir = resolve(HERE, outDirArg);
await mkdir(outDir, { recursive: true });

// The installed browser revision does not match this playwright build's expected
// headless-shell revision, so point at the chromium already on disk instead of
// downloading another one. Override with PLAYWRIGHT_CHROMIUM.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console:', message.text());
});

const results = [];
for (const spec of specs) {
  const [view, mode = 'lit', extra = ''] = spec.split(':');
  const query = new URLSearchParams({ view, mode });
  for (const pair of extra.split('&').filter(Boolean)) {
    const [key, value] = pair.split('=');
    query.set(key, value ?? '');
  }
  const url = `${PAGE}?${query.toString()}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hammerReady === true, null, { timeout: 60000 });
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const suffix = mode === 'clay' ? `${view}-clay` : view;
  const extraTag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '')}` : '';
  const file = resolve(outDir, `${label}-${suffix}${extraTag}.png`);
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const stats = await page.evaluate(() => window.__hammerStats);
  results.push({ file, url, stats });
  console.log(`${file}  triangles=${stats.triangles} drawCalls=${stats.drawCalls} `
    + `measured=${JSON.stringify(stats.measuredSize)} naive=${JSON.stringify(stats.naiveBox3Size)} `
    + `H/D=${stats.heightOverDiameter}`);
}

await browser.close();
console.log(JSON.stringify(results.map((r) => ({ file: r.file, stats: r.stats })), null, 2));
