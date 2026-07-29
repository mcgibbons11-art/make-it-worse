// Sample a handful of pixels from a set of harness URLs. Used to match the review
// render's value range and chroma to the reference before scoring any pass, because the
// Tier-1 foreground mask drops a face that desaturates into the background grey.
//
// Usage: node probe.mjs "env=0&exposure=0.8" "env=1&exposure=1" ...

import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/toaster/preview/index.html`;
const SAMPLES = [
  ['front', 380, 500],
  ['top', 520, 260],
  ['right', 980, 560],
  ['plinth-front', 400, 1000],
];

const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));

for (const extra of process.argv.slice(2)) {
  const url = `${PAGE}?view=reference&mode=lit&tex=256&${extra}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__toasterReady === true, null, { timeout: 45000 });
  const values = await page.evaluate((samples) => {
    const canvas = document.querySelector('canvas');
    const readback = document.createElement('canvas');
    readback.width = canvas.width;
    readback.height = canvas.height;
    const ctx = readback.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    return samples.map(([name, x, y]) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [name, d[0], d[1], d[2]];
    });
  }, SAMPLES);
  const formatted = values
    .map(([name, r, g, b]) => `${name}=(${r},${g},${b}) sat=${((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b))).toFixed(3)}`)
    .join('  ');
  console.log(`${extra}\n   ${formatted}`);
}

await browser.close();
