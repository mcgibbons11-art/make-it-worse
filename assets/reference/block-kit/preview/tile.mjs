// One command to lay a block out, shoot every review view, and print the seam,
// edge-band and cost numbers.
//
//   node tile.mjs <block> <label> [--pitch 0.6] [--axis z] [--count 8]
//                 [--platform 4.0] [--out ../renders] [view ...]
//
// With no views it shoots the set every block pass needs: the hero three-quarter,
// a raking seam close-up, the run seen from the player's eye, and a clay pass with
// the maps stripped for the Tier 1 silhouette gate.

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:8899';
const PAGE = `${BASE}/assets/reference/block-kit/preview/index.html`;

const DEFAULT_VIEWS = ['single', 'seam', 'course', 'tile-run', 'single:clay'];

const argv = process.argv.slice(2);
const positional = [];
const options = { pitch: '0.6', axis: 'z', count: '8', platform: '0', out: '../renders', tex: '256' };
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (token.startsWith('--')) {
    options[token.slice(2)] = argv[i + 1];
    i += 1;
  } else {
    positional.push(token);
  }
}
const [block, label, ...views] = positional;
if (!block || !label) {
  console.error('usage: node tile.mjs <block> <label> [--pitch N] [--axis x|z] [--count N] '
    + '[--platform N] [--out DIR] [view[:clay] ...]');
  process.exit(2);
}
const shots = views.length > 0 ? views : DEFAULT_VIEWS;
const outDir = resolve(HERE, options.out);
await mkdir(outDir, { recursive: true });

// The installed browser revision does not match this playwright build's expected
// headless-shell revision, so point at the chromium already on disk rather than
// downloading another. Override with PLAYWRIGHT_CHROMIUM.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console:', message.text());
});

const results = [];
for (const shot of shots) {
  const [view, mode = 'lit'] = shot.split(':');
  const query = new URLSearchParams({
    block, view, pitch: options.pitch, axis: options.axis, count: options.count,
    platform: options.platform, tex: options.tex,
  });
  if (mode === 'clay') query.set('mode', 'clay');
  const url = `${PAGE}?${query.toString()}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__blockReady === true, null, { timeout: 60000 });
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const file = resolve(outDir, `${label}-${view}${mode === 'clay' ? '-clay' : ''}.png`);
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const stats = await page.evaluate(() => window.__blockStats);
  results.push({ file, stats });
  console.log(`${file}  triangles=${stats.triangles} drawCalls=${stats.drawCalls} copies=${stats.copies}`);
}

await browser.close();

const last = results.at(-1).stats;
const report = resolve(outDir, `${label}-tiling.json`);
await writeFile(report, `${JSON.stringify(last, null, 2)}\n`);

console.log('');
console.log(`block            ${last.block}`);
console.log(`footprint        ${last.measured.extent.join(' x ')}  (world units)`);
if (last.measured.boxPoisonedByStubs) {
  console.log(`STUB WARNING     raw box ${last.measured.rawExtentIncludingStubs.join(' x ')} `
    + `differs; skipped ${last.measured.skippedStubMeshes.join(', ')}`);
}
if (last.seam) {
  const s = last.seam;
  console.log(`seam             pitch ${s.pitch}  footprint ${s.footprintAlongAxis} `
    + ` slack ${s.pitchMinusFootprint}`);
  console.log(`                 gaps ${s.gaps.join(', ')}`);
  console.log(`                 worst ${s.worstGap}  spread ${s.gapSpread}  `
    + `${s.meets ? 'EDGES MEET' : 'EDGES DO NOT MEET'}`);
}
if (last.edgeBand) {
  const e = last.edgeBand;
  console.log(`edge band        width ${e.bandWidth}  deck half ${e.deckHalfExtent}  block half ${e.blockHalfExtent.x}/${e.blockHalfExtent.z}  max offset ${e.maxCentreOffset.x}/${e.maxCentreOffset.z}  `
    + `${e.swallowsBand ? 'SWALLOWS THE BAND' : 'band intact'}`);
}
const c = last.cost;
console.log(`cost             ${c.trianglesPerBlock} tris/block x ${c.instancesOverCourse} `
  + `instances = ${c.courseTriangles.toLocaleString()} over a 285u course`);
console.log(`                 draw calls: ${c.drawCallsCloned} cloned vs `
  + `${c.drawCallsInstanced} instanced`);
console.log(`wrote            ${report}`);

const failed = (last.seam && !last.seam.meets) || (last.edgeBand && last.edgeBand.swallowsBand);
process.exit(failed ? 1 : 0);
