import { chromium } from '@playwright/test';
const [, , base, out] = process.argv;
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(4500);
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(13000);
await page.getByRole('button', { name: /Pause game/i }).click();
await page.waitForTimeout(1200);
console.log('PAUSED OK:', (await page.locator('text=PAUSED').count()) > 0);
await page.getByRole('button', { name: /Main menu/i }).click();
await page.waitForTimeout(4000);
const text = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 200));
console.log('AFTER MAIN MENU:', JSON.stringify(text));
console.log('CANVAS STILL MOUNTED:', await page.evaluate(() => !!document.querySelector('.game-canvas canvas')));
await page.screenshot({ path: out });
await browser.close();
