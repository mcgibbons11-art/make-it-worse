import { chromium } from '@playwright/test';
const [, , base, out] = process.argv;
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 160)); });
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(4500);
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(13000);

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll('button')].map((b) => ({
    label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 28),
    disabled: b.disabled,
  })));
console.log('IN-GAME BUTTONS:', JSON.stringify(buttons));

// The pause/menu control in the HUD.
const pause = page.locator('button', { hasText: /^Ⅱ$|^\|\|$/ }).first();
const byLabel = page.getByRole('button', { name: /pause|menu/i }).first();
const target = (await byLabel.count()) ? byLabel : pause;
if (await target.count()) {
  await target.click({ force: true });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 260));
  console.log('AFTER MENU CLICK:', JSON.stringify(after));
} else {
  console.log('NO PAUSE/MENU BUTTON FOUND');
}
await page.screenshot({ path: out });
await browser.close();
