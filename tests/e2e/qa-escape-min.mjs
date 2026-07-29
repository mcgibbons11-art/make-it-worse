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
await page.evaluate(() => window.__MIW_TEST__.completeAttempt());
await poll(async () => (await state())?.phase === "finished", "finished");
await page.getByRole("button", { name: /make it worse/i }).click();
await poll(async () => (await state())?.phase === "choosing_trap", "choosing");
await page.locator(".trap-card").first().click();
await poll(async () => (await state())?.phase === "placing_trap", "placing");

const b = await state();
log("BEFORE  phase=", b.phase, "offers=", JSON.stringify(b.offeredTraps), "selected=", b.selectedTrap);
log("buttons:", await page.evaluate(()=>JSON.stringify([...document.querySelectorAll("button")].filter(x=>x.offsetParent).map(x=>x.textContent.trim().slice(0,32)))));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const a = await state();
log("AFTER   phase=", a.phase, "offers=", JSON.stringify(a.offeredTraps), "selected=", a.selectedTrap);
log("buttons:", await page.evaluate(()=>JSON.stringify([...document.querySelectorAll("button")].filter(x=>x.offsetParent).map(x=>x.textContent.trim().slice(0,32)))));

// And Escape while a HUD button holds focus, from `playing`.
log("\n-- pause/resume via Escape --");
await page.goto(BASE + "/");
await page.getByRole("button", { name: /start a fresh chain/i }).click();
await poll(async () => (await state())?.phase === "intro", "intro2");
await page.getByRole("button", { name: /beat it/i }).click();
await poll(async () => (await state())?.phase === "playing", "playing2");
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
log("playing + Escape ->", (await state()).phase);
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
log("paused  + Escape ->", (await state()).phase);
// Now with a button focused, which is the regression that killed Escape before.
const anyBtn = page.locator("button").filter({ hasText: /./ }).first();
await anyBtn.focus();
log("focused:", await page.evaluate(()=>document.activeElement?.textContent?.trim().slice(0,32)));
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
log("playing + Escape while a button has focus ->", (await state()).phase);
await browser.close();
