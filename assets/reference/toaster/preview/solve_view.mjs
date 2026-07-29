// Camera-and-proportion solve for the reference view. Renders a grid of
// (elevation, vertical scale) candidates from the same model and writes them to a
// scratch folder; score_view.py then reports the Tier-1 silhouette IoU for each so the
// reference camera and the height ratio are chosen from measured agreement rather than
// from a single fragile edge-slope estimate.
//
// Usage: node solve_view.mjs <outDir> "13,18,23,28" "0.90,0.95,1.00"

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/toaster/preview/index.html`;

const [outDirArg, elevList, scaleList, azimList = '41'] = process.argv.slice(2);
if (!outDirArg || !elevList || !scaleList) {
  console.error('usage: node solve_view.mjs <outDir> <elevations> <yscales> [azimuths]');
  process.exit(2);
}
const outDir = resolve(HERE, outDirArg);
await mkdir(outDir, { recursive: true });

const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));

for (const azim of azimList.split(',')) {
  for (const elev of elevList.split(',')) {
    for (const yscale of scaleList.split(',')) {
      const query = new URLSearchParams({ view: 'reference', mode: 'lit', tex: '256', azim, elev, yscale });
      await page.goto(`${PAGE}?${query.toString()}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__toasterReady === true, null, { timeout: 45000 });
      const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
      const file = resolve(outDir, `solve_a${azim}_e${elev}_y${yscale}.png`);
      await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(file);
    }
  }
}

await browser.close();
