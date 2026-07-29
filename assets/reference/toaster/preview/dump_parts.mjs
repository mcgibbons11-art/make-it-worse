// Dump the built part tree and the runtime rig from the harness, for
// stage4_review/check_part_coverage.py and for the interaction-pass evidence.
// Usage: node dump_parts.mjs ../renders/parts.json

import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/toaster/preview/index.html?view=reference&tex=256`;

const out = resolve(HERE, process.argv[2] ?? '../renders/parts.json');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__toasterReady === true, null, { timeout: 45000 });

const parts = await page.evaluate(() => window.__toasterParts);
const stats = await page.evaluate(() => window.__toasterStats);
await writeFile(out, JSON.stringify(parts, null, 2));
console.log(`parts=${parts.parts.length} unnamedMeshes=${parts.unnamedMeshes} triangles=${stats.triangles} drawCalls=${stats.drawCalls}`);
console.log('nodes:', stats.nodeIds.join(', '));
console.log('sockets:', stats.socketIds.join(', '));
await browser.close();
