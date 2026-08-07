import { chromium } from '@playwright/test';

// Software GL: there is no display here, and the game is WebGL top to bottom.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--hide-scrollbars', '--mute-audio'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.goto('http://127.0.0.1:4213/index.html', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const size = await page.evaluate(() => {
  const c = document.querySelector('.game-canvas canvas') || document.querySelector('canvas');
  return { canvas: c ? `${c.width}x${c.height}` : 'none', hidden: document.hidden };
});
console.log('BEFORE START', JSON.stringify(size));
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(14000);
const after = await page.evaluate(() => {
  const c = document.querySelector('.game-canvas canvas') || document.querySelector('canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return {
    canvas: c ? `${c.width}x${c.height}` : 'none',
    renderer: gl ? gl.getParameter(gl.getParameter ? 0x1F01 : 0) : 'n/a',
  };
});
console.log('IN GAME', JSON.stringify(after));
await page.screenshot({ path: process.argv[2] + '/probe.png' });
await browser.close();
