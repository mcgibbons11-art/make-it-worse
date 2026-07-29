import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://127.0.0.1:5361";
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => log("PAGEERROR", e.message));
const state = () => page.evaluate(() => window.__MIW_TEST__?.getState() ?? null);
const poll = async (fn, label, ms = 25000) => {
  const t0 = Date.now();
  for (;;) { if (await fn()) return; if (Date.now()-t0>ms) throw new Error("timeout: "+label); await page.waitForTimeout(150); }
};
await page.addInitScript(() => localStorage.setItem("miw-settings-v1", JSON.stringify({state:{avatarPrompted:true},version:0})));
await page.goto(BASE + "/");
await page.evaluate(() => new Promise((r)=>{const q=indexedDB.deleteDatabase("make-it-worse-v1");q.onsuccess=q.onerror=q.onblocked=()=>r();}));
await page.reload();
await page.getByRole("button", { name: /start a fresh chain/i }).click();
await poll(async () => (await state())?.phase === "intro", "intro");
await page.getByRole("button", { name: /beat it/i }).click();
await poll(async () => (await state())?.phase === "playing", "playing");
await page.waitForTimeout(600);

log("inputZ at rest:", (await state()).inputZ);
await page.keyboard.down("w");
await page.waitForTimeout(200);
log("inputZ while W held (canvas focused):", (await state()).inputZ);

// A player taps a HUD button mid-run. Focus lands on it.
const hud = page.locator("button").filter({ hasText: /./ }).first();
await hud.focus();
log("focus is now on:", await page.evaluate(()=>document.activeElement?.textContent?.trim().slice(0,24)));

// They let go of W. The keyup is delivered to the focused BUTTON, and
// PlayerController's `up` handler returns early on isInterfaceTarget.
await page.keyboard.up("w");
await page.waitForTimeout(500);
const after = (await state()).inputZ;
log("inputZ AFTER releasing W with a button focused:", after);
log(after !== 0 ? ">>> STUCK: the runner keeps moving with no key held" : "    released cleanly");

// Can they steer at all now?
await page.keyboard.down("a"); await page.waitForTimeout(200);
log("inputZ after pressing A with the button still focused:", (await state()).inputZ);
await page.keyboard.up("a");

// Recovery: click the canvas.
await page.mouse.click(640, 400);
await page.waitForTimeout(300);
log("inputZ after clicking the canvas:", (await state()).inputZ);
await browser.close();
