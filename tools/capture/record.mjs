// Records real gameplay from the built Portals bundle, headless.
//
// Why this exists rather than a screen recorder: the game only renders in a
// VISIBLE tab, and a remote-driven browser tab is never visible, so rAF stays
// suspended and the canvas sticks at 300x150. Headless Chromium with software
// GL has no such idea of foreground, and MediaRecorder on the canvas gives a
// real 60fps stream instead of the frame-or-two-a-second a screenshot loop
// manages.
//
// Footage comes out as webm; cut.mjs does the editing and the music.

import { chromium } from "@playwright/test";

const [, , base, scenarioName, outName, secondsArg] = process.argv;
const SECONDS = Number(secondsArg ?? 10);

const wait = (page, ms) => page.waitForTimeout(ms);

/** Click a menu button by its visible text. */
async function press(page, label, settle = 1200) {
  await page.getByRole("button", { name: label }).first().click();
  await wait(page, settle);
}

/**
 * Hold a key for a while. The runner is driven with real key events rather
 * than by poking the physics, so what gets recorded is what a player would
 * actually see.
 */
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await wait(page, ms);
  await page.keyboard.up(key);
}

const scenarios = {
  /** Title screen: drifting clouds, logo, the one-line pitch. */
  async title(page) {
    await wait(page, 4000);
  },

  /** A clean course, run straight at it until something goes wrong. */
  async run(page) {
    await press(page, /Start game/i, 2500);
    await press(page, /Play a clean level/i, 12000);
    await page.mouse.click(640, 400);
    await wait(page, 600);
    await hold(page, "KeyW", 2200);
    await page.keyboard.down("KeyW");
    await page.keyboard.press("Space");
    await wait(page, 1400);
    await page.keyboard.press("Space");
    await wait(page, 2600);
    await page.keyboard.up("KeyW");
    await wait(page, 2500);
  },

  /** The daily course, which is built to be brutal - so, deaths. */
  async daily(page) {
    await press(page, /Start game/i, 2500);
    await press(page, /Daily Disaster/i, 13000);
    await page.mouse.click(640, 400);
    await wait(page, 600);
    await hold(page, "KeyW", 3000);
    await page.keyboard.down("KeyW");
    await page.keyboard.press("Space");
    await wait(page, 3000);
    await page.keyboard.up("KeyW");
    await wait(page, 3000);
  },
};

const browser = await chromium.launch({
  // The real GPU, not software rasterisation. Swiftshader manages about six
  // frames a second on this scene, which is a slideshow; d3d11 holds sixty.
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
await page.goto(`${base}/index.html`, { waitUntil: "load" });
await wait(page, 5000);

// Arm the recorder before the scenario runs, then start it once there is a
// canvas to record.
await page.evaluate(() => {
  window.__startClip = (name) =>
    new Promise((resolve) => {
      const canvas =
        document.querySelector(".game-canvas canvas") || document.querySelector("canvas");
      if (!canvas) return resolve("no-canvas");
      const chunks = [];
      const recorder = new MediaRecorder(canvas.captureStream(60), {
        mimeType: "video/webm;codecs=vp9",
        videoBitsPerSecond: 14_000_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        await fetch("/upload", { method: "POST", headers: { "X-Clip-Name": name }, body: blob });
        window.__clipDone = `${name}:${blob.size}`;
      };
      window.__clipDone = null;
      window.__stopClip = () => recorder.stop();
      recorder.start();
      resolve(`${canvas.width}x${canvas.height}`);
    });
});

const scenario = scenarios[scenarioName];
if (!scenario) throw new Error(`unknown scenario ${scenarioName}`);

// The title scenario records from the start; the others need the game open
// first, so the canvas exists to capture.
if (scenarioName === "title") {
  console.log("armed", await page.evaluate((name) => window.__startClip(name), outName));
  await scenario(page);
} else {
  const started = scenario(page);
  await wait(page, scenarioName === "daily" ? 16500 : 15500);
  console.log("armed", await page.evaluate((name) => window.__startClip(name), outName));
  await started;
}

await wait(page, SECONDS * 0);
await page.evaluate(() => window.__stopClip && window.__stopClip());
await page.waitForFunction(() => window.__clipDone !== null, null, { timeout: 30_000 });
console.log("saved", await page.evaluate(() => window.__clipDone));
await browser.close();
