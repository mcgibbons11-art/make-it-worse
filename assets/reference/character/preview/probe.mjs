// Final measurement of the shipped model: bounds, per-mesh material identity, transforms.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM
  ?? resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto('http://127.0.0.1:8899/assets/reference/character/preview/index.html?view=reference&tex=256', { waitUntil: 'load' });
await page.waitForFunction(() => window.__runnerReady === true, null, { timeout: 60000 });
const out = await page.evaluate(() => {
  const model = window.__runnerModel;
  model.updateMatrixWorld(true);
  const byMaterial = {};
  const rot = [];
  model.traverse((n) => {
    if (n.isMesh) {
      const id = n.material?.userData?.sculptMaterial?.id ?? '(none)';
      (byMaterial[id] ??= []).push(n.name);
    }
    const r = n.rotation;
    if (Math.abs(r.x) > 1e-4 || Math.abs(r.y) > 1e-4 || Math.abs(r.z) > 1e-4) {
      rot.push(`${n.name} [${n.type}] x=${r.x.toFixed(3)} y=${r.y.toFixed(3)} z=${r.z.toFixed(3)}`);
    }
  });
  return { byMaterial, rot, all: window.__bbox(true), visible: window.__bbox(false) };
});
console.log('bbox all meshes    :', JSON.stringify(out.all));
console.log('bbox visible meshes:', JSON.stringify(out.visible));
console.log('\nmeshes grouped by material id (mesh.material.userData.sculptMaterial.id):');
for (const [id, names] of Object.entries(out.byMaterial)) console.log(`  ${id.padEnd(14)} ${names.join(', ')}`);
console.log('\nnon-identity rotations:');
for (const r of out.rot) console.log('  ' + r);
await browser.close();
