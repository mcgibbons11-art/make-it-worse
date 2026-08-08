import { chromium } from '@playwright/test';
const base = process.argv[2];
const GUESTS = Number(process.argv[3] ?? 3);

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
});
// Separate contexts so each client gets its own storage, its own window.name
// token, and its own SDK connection - four browsers, not four tabs.
async function client(name) {
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] PAGE ERROR`, e.message));
  await page.addInitScript((n) => { window.name = `miwtok:token-${n}-000000`; }, name);
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  await page.getByRole('button', { name: /Start game/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Duel Mode/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Open lobby/i }).click();
  await page.waitForTimeout(4000);
  return { name, page };
}

const host = await client('host');
await host.page.getByRole('button', { name: /Start a party/i }).click();
await host.page.waitForTimeout(4000);
console.log('host party up');

const guests = [];
for (let i = 0; i < GUESTS; i += 1) guests.push(await client(`guest${i + 1}`));
await host.page.waitForTimeout(2000);

// Everyone asks at the same moment.
await Promise.all(guests.map(async (g) => {
  const listing = g.page.locator('button', { hasText: /ask to join/ }).first();
  if (await listing.count()) await listing.click();
}));
await host.page.waitForTimeout(3500);

const requests = await host.page.evaluate(() =>
  [...document.querySelectorAll('button')].filter((b) => /Let them in/.test(b.textContent || '')).length);
console.log('REQUESTS VISIBLE TO HOST:', requests, 'of', GUESTS);

// Accept every one of them.
for (let i = 0; i < GUESTS; i += 1) {
  const button = host.page.locator('button', { hasText: /Let them in/ }).first();
  if (await button.count()) { await button.click(); await host.page.waitForTimeout(1800); }
  else console.log('no accept button at index', i);
}
await host.page.waitForTimeout(3000);

const party = await host.page.evaluate(() => {
  const items = [...document.querySelectorAll('.duel-roster li strong')].map((e) => e.textContent);
  return items;
});
console.log('HOST PARTY:', JSON.stringify(party));
for (const g of guests) {
  const state = await g.page.evaluate(() => {
    const t = document.body.innerText;
    return {
      requesting: /Request sent/.test(t),
      inParty: /You are in/.test(t) || /Waiting for .* to start/.test(t),
    };
  });
  console.log(`  ${g.name}:`, JSON.stringify(state));
}

// The part that matters: pressing Start moves everybody into the duel
// channel at once, which is where a race would actually show.
const start = host.page.locator('button', { hasText: /Start with \d/ }).first();
if (await start.count()) { await start.click(); await host.page.waitForTimeout(9000); }
// The second Start is gated until the whole party has taken its seats, so
// wait for it to become enabled rather than clicking into a disabled button.
const start2 = host.page.locator('button', { hasText: /Start with \d/ }).first();
for (let i = 0; i < 30; i += 1) {
  if (await start2.count() && await start2.isEnabled()) break;
  await host.page.waitForTimeout(1000);
}
console.log('SEATED BEFORE START:', await host.page.evaluate(() => (document.body.innerText.match(/seated: \d\/\d/) || ['?'])[0]));
if (await start2.count() && await start2.isEnabled()) { await start2.click(); await host.page.waitForTimeout(12000); }
else console.log('START NEVER BECAME AVAILABLE');

const seatOf = async (page) => page.evaluate(() => {
  const line = document.body.innerText.match(/you: seat (\w)/);
  const roster = document.body.innerText.match(/seated: (\d)\/(\d)/);
  return {
    seat: line ? line[1] : null,
    seated: roster ? roster[1] : null,
    inMatch: /ROUND \d/.test(document.body.innerText),
  };
});
console.log('AFTER START host :', JSON.stringify(await seatOf(host.page)));
for (const g of guests) console.log(`AFTER START ${g.name}:`, JSON.stringify(await seatOf(g.page)));

await browser.close();
