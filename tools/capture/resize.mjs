import { chromium } from '@playwright/test';
const [, , base, out] = process.argv;
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(4500);
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(13000);
const read = () => page.evaluate(() => {
  const c = document.querySelector('.game-canvas canvas');
  return c ? { drawing: `${c.width}x${c.height}`, css: `${c.clientWidth}x${c.clientHeight}` } : null;
});
console.log('AT MOUNT     ', JSON.stringify(await read()));
await page.setViewportSize({ width: 620, height: 760 });
await page.waitForTimeout(2500);
console.log('AFTER RESIZE ', JSON.stringify(await read()));
await page.screenshot({ path: out });
await browser.close();
