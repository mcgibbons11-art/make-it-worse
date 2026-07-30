import { chromium } from "../node_modules/@playwright/test/index.mjs";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const width = Number(process.argv[3] ?? 1920);
const height = Number(process.argv[4] ?? 1080);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});

try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("console:", message.text());
  });
  console.error("opening", url);
  await page.goto(url, { waitUntil: "networkidle" });
  console.error("opening a clean course");
  await page.getByRole("button", { name: "Play a clean level" }).click();
  console.error("waiting for generated assets");
  await page.getByRole("button", { name: /Beat it\. Add the first problem/i }).click();
  console.error("starting gameplay");
  await page.locator(".game-hud").waitFor({ state: "visible" });
  await page.locator(".game-canvas canvas").click();
  await page.bringToFront();
  await page.waitForTimeout(3000);
  console.error("sampling 240 steady-state frames");

  const report = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        const step = (now) => {
          samples.push(now - last);
          last = now;
          if (samples.length < 300) return requestAnimationFrame(step);
          const sorted = samples.slice(60).sort((a, b) => a - b);
          const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
          const canvas = document.querySelector(".game-canvas canvas");
          resolve({
            meanMs: +mean.toFixed(2),
            p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
            fps: +(1000 / mean).toFixed(1),
            dpr: devicePixelRatio,
            width: canvas?.width ?? null,
            height: canvas?.height ?? null,
            renderer: navigator.userAgent,
          });
        };
        requestAnimationFrame(step);
      }),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
