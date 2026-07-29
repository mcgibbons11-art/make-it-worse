// Run the runner measurement page and write its report to disk.
// Usage: node measure.mjs [outFile]

import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8901';
const PAGE = `${BASE}/assets/reference/wardrobe/preview/measure.html`;
const out = resolve(HERE, process.argv[2] ?? '../runner-measurement.json');

const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console:', message.text());
});

await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__measurementReady === true, null, { timeout: 90000 });
const report = await page.evaluate(() => window.__measurement);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
console.log('visibleBox', JSON.stringify(report.factoryFrame.visibleBox));
console.log('rawBox    ', JSON.stringify(report.factoryFrame.rawBox));
console.log('playSpace ', JSON.stringify(report.playSpace));
await browser.close();
