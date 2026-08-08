import { chromium } from '@playwright/test';
const [, , base, out, w, h] = process.argv;
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(4500);
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(13000);
const info = await page.evaluate(() => {
  const c = document.querySelector('.game-canvas canvas');
  return { drawing: c ? `${c.width}x${c.height}` : 'none', css: c ? `${c.clientWidth}x${c.clientHeight}` : 'none' };
});
console.log(`${w}x${h}`, JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
