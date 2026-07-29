// Report a built prop's whole-model and per-part world bounds from the preview harness.
// Renders do not show a part that inherited a pivot scale or a slab hinged through its
// own middle; both measure wrong here.
//
// Usage: node probe.mjs <model> [query]
//   node probe.mjs toilet
//   node probe.mjs toilet 'view=front'

import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/props/preview/index.html`;

const [model, extra = ''] = process.argv.slice(2);
if (!model) {
  console.error('usage: node probe.mjs <model> [query]');
  process.exit(2);
}

// yscale=1 defeats the review squash correction, so the numbers reported are the ones
// the game ships rather than the ones the Tier-1 aspect gate scores.
const query = new URLSearchParams({ model, yscale: '1', tex: '64' });
for (const pair of extra.split('&').filter(Boolean)) {
  const [key, value] = pair.split('=');
  query.set(key, value ?? '');
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console:', message.text());
});

await page.goto(`${PAGE}?${query.toString()}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__propReady === true, null, { timeout: 60000 });
const [stats, parts] = await page.evaluate(() => [window.__propStats, window.__propPartBounds]);
await browser.close();

console.log(JSON.stringify({ model, whole: stats.boundingBox, parts }, null, 2));
