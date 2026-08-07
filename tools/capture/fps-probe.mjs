import { chromium } from '@playwright/test';
const mode = process.argv[3];
const argsFor = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  gpu: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
  gl: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
}[mode];
const browser = await chromium.launch({ args: [...argsFor, '--mute-audio', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(process.argv[2] + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /Start game/i }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Play a clean level/i }).click();
await page.waitForTimeout(13000);
const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0; const start = performance.now();
  const tick = () => { frames += 1; if (performance.now() - start < 3000) requestAnimationFrame(tick); else resolve((frames / ((performance.now() - start) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));
const renderer = await page.evaluate(() => {
  const c = document.querySelector('.game-canvas canvas'); const gl = c && c.getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(mode, 'fps=' + fps, '|', renderer);
await browser.close();
