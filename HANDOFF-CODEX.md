# MAKE IT WORSE — Handoff for Codex

Written 2026-07-29, late evening, by the Claude session that ran the day. This is the
complete pick-up-from-here document: current state, every open task with exact file
paths and acceptance criteria, and the standing rules that keep you from breaking
things that were tuned on purpose. Read the whole thing before touching anything.

## Codex update — 2026-07-29

The later sections preserve the original handoff for provenance, but several of
their status claims are now stale. This is the current boundary:

- Retry-after-failure is verified, not an open bug. The focused Chromium test
  completes the `failed -> playing` transition without a page reload.
- Touch controls now mount in both editions when `ontouchstart` is present. The
  Portals shell includes movement, jump, grab, touch-specific onboarding, and the
  existing drag-camera path without changing movement constants or physics.
- The Portals SDK loader is explicitly present as `./_portals/sdk.js` before the
  application module. Its absent-host, signed-in, sign-in-required, rejection,
  score-mapping, and leaderboard-limit paths have unit coverage.
- The Portals title shell is split from the game engines. Its production HTML
  preloads only the React chunk; Three, Rapier, Tone, the wardrobe, and
  `GameCanvas` load after their corresponding dynamic boundaries.
- `pnpm measure:portals -- <url> [width] [height]` is a bounded rAF sampler. Its
  headless SwiftShader numbers are intentionally not accepted as a hardware
  performance result; the final 1080p measurement still needs a focused,
  GPU-backed browser tab.
- The apartment already has authored architecture, four furnishing variants,
  detail/practical-light contracts, refinement provenance, and extensive geometry
  tests. Do not fabricate formal pipeline review entries; further work is optional
  visual polish, not an objectively closable acceptance item.
- The remaining 37 Pixabay files are still absent (`CREDITS.json`: 30 filed,
  37 planned). They require real manual downloads and attribution; automation or
  invented provenance remains forbidden.
- Portals dashboard folder/sync, mobile-preview, hosted SDK score round-trip, and
  featured-image checks still require the user's authenticated Portals browser.

Local gate at this update: lint and TypeScript clean; 55 test files, 711 passed and
1 skipped; Next and Portals production builds clean; focused retry E2E passed.

---

## 1. What this project is

A 3D "traps course" game: players run an obstacle course, then place a trap to make it
worse for the next player, then share the chain. React Three Fiber v9 / three.js r185 /
@react-three/rapier 2.2.0 / zustand. TypeScript strict.

Two deployment targets share one codebase via `@`-aliased imports to the repo root:

- **Next.js edition** (repo root, `app/`) — dev shell + Supabase-backed sharing.
  `pnpm dev` to run. Full challenge-chain backend under `supabase/`.
- **Portals static edition** (`portals/`) — a self-contained Vite build for the
  portals.to platform. No Supabase, no external fetches; leaderboard adapts the
  Portals SDK (`portals/src/leaderboard.ts`).

Key directories:

| Path | What it is |
|---|---|
| `components/game/` | Scene, player controller, trap renderer, camera, models |
| `components/game/models/create*.ts` | Generated procedural model factories (img2threejs pipeline output) |
| `components/game/AssetModel.tsx` | THE prop registry: ModelName → component, template/clone cache |
| `components/game/TrapRenderer.tsx` | All 54 trap behaviors + colliders |
| `components/hud/` | Onboarding, avatar customizer, HUD |
| `lib/game/` | Catalog, schemas, placement, tracks, input, constants |
| `lib/audio/AudioManager.ts` | Sample loading/normalization |
| `public/audio/` | Sound effects + `CREDITS.json` (attribution manifest) |
| `tests/unit/`, `tests/e2e/` | Vitest suites (53 files, 701 green as of handoff) |
| `assets/reference/` | img2threejs pipeline: reference images, specs, evidence. 137 MB. NOT in download archives (see §4) |
| `supabase/migrations/` | 0001–0019; `sql-parity` test auto-discovers them |

Verification gate (run after any change):

```powershell
npx tsc --noEmit
npx vitest run          # full suite; do NOT trust failures while the machine is loaded — re-run quiet
npx next lint           # eslint
```

Current HEAD at handoff: `a9266c3` on `main`, pushed to
`github.com/mcgibbons11-art/make-it-worse`. Working tree at handoff has ONLY the
in-flight vacuum files uncommitted (see §3).

---

## 2. What is DONE and verified (do not redo, do not "improve")

- **54 traps** live (38 wave A + 16 wave B), each with catalog pricing
  (`lib/game/trap-catalog.ts` riskWeight rule) and fairness-gated phase timings
  (`lib/game/traps-wave-b.ts` — note pileOn wobbleMs 480, a deliberate escape-budget
  retune; the comment explains the arithmetic. Do not shrink it back).
- **Placement system**: drag anywhere, offsets clamp into the resolved surface
  (`lib/game/placement.ts`), aerial camera framing while placing
  (`components/game/CameraRig.tsx` EditorFraming), WASD nudging of a held trap,
  left-click-drag camera yaw (`lib/game/input.ts` cameraYaw singleton; PlayerController
  rotates steering by yaw).
- **9 of 10 sculpted props wired** through `AssetModel.tsx`: toaster, soap dish, beach
  ball, refrigerator, claw hammer, spring pad, robot mop, **fan** (SculptedFloorFan —
  spins "blades__pivot" found by node name; collider trimmed to [0.47, 0.65, 0.34]),
  **toilet** (SculptedToilet — collider deliberately NOT trimmed, see §5 rulings).
  The old hand-authored fan/toilet/refrigerator components (`MechProps.tsx`,
  `LargeProps.tsx`) are DELETED.
- **6 named maps** (`lib/game/track.ts` NAMED_TRACKS) + editor share loop + custom
  build mode; track field flows through Supabase (`0019_track_on_supabase.sql`,
  `challengeSchema` with optional `track`).
- **Wardrobe**: 69 garments, avatar customizer (manual open only — the auto-open modal
  used to eat every e2e first-click), rounded sneakers (direction pinned by test).
- **Animation pass**: squash/stretch, arm swing, landing settle in PlayerController/runner.
- **Onboarding**: FirstRunTour, CoachHint, DeathNote, TrapDetailsRow, countdown pill,
  WASD/Space keycaps on the intro card (off the attempt clock).
- **Audio plumbing**: `AudioManager` derives RECORDED_TRAPS from TRAP_TYPES; per-file
  peak normalization to SAMPLE_PEAK 0.8414 (−1.5 dBFS); missing files are silent
  no-ops until present. Dropping a correctly-named mp3 into `public/audio/` is the
  entire wiring for a trap sound. 17 trap sounds present; 37 missing (see §4 task A).
- **Portals sync unblocked twice** (see §4 task B for the one remaining step).

---

## 3. In-flight RIGHT NOW (check before you start)

FINAL UPDATE (end of evening): **task C is COMPLETE — skip it.** The vacuum is
wired (all TEN props sculpted), the cage-direct refactor landed (4708 real
triangles vs the 6000 budget, collar folds gone, exposed fold re-measured at
0.42× — marginally gentler), and the collider trim landed as
`[0.43, 0.32, 0.45]` via `VACUUM_HOVER_HEIGHT = 0.32` in TrapRenderer (Z is 0.45,
NOT the once-proposed 0.44 — vacuum-body reaches z −0.446). Full suite green
after everything (53 files / 701 passed), Portals dist rebuilt. Two recorded,
ACCEPTED deviations you should not "fix": the exposed hose fold at t ~0.84–0.89
(ruled to ship; re-route rejected), and the structural pass having a real Tier-1
entry + comparison sheet but NO reviewHistory entry (fast-mode eyeball is recorded
in the component comment instead; the ledger only advances on a real review —
leave it). Remaining work is §4 A (sounds), B (Portals folder switch), D, E, F, G.

---

## 4. THE TASK LIST, in priority order

### A. Pixabay sound effects — 37 traps still silent  *(user-facing, mechanical)*

**State**: `public/audio/CREDITS.json` has a `planned` array — one row per missing
trap with `trap`, `file` (target filename), `seconds` (duration window), `mechanic`,
`brief` (what it must sound like), and `url` (a verified Pixabay search URL, or for
`spin_cycle` a direct sound page). 1 of 38 is done (`paint_bucket.mp3`, filed with
attribution). `spin_cycle` was open in a browser mid-download when work stopped —
its direct page is
`https://pixabay.com/sound-effects/household-waching-machine-spin-cycle-66595/`
("Waching Machine (Spin Cycle)" by Breviceps, ~1:01 — will need trimming to the
1.2–1.8 s window described in the brief, or pick a shorter alternative).

**Workflow per sound** (Pixabay blocks headless/automated browsers — a real browser
session works; downloads are free, NO account, NO login):

1. Open the row's `url`. Pick the result whose title/duration best matches `brief`
   and `seconds`. Prefer single-purpose sounds over compilations.
2. Click the download icon (search results) or "Free download" (detail pages).
3. Move from `Downloads/` to `public/audio/<trap>.mp3` (exact filename from the row).
4. Update `CREDITS.json`: append to `files` an object with `file`, `source` (page or
   search URL), `title`, `author`, `originalFilename`, `license: "Pixabay Content
   License"`, and a one-line `note`; REMOVE the row from `planned`. See the
   `paint_bucket.mp3` entry for the exact shape.
5. Long files: trim to the brief's window (ffmpeg is fine; keep mp3). Loopable
   entries (`sticky_gum`, `conveyor_strip`, `kettle_boil` bed) must loop seamlessly —
   trim at zero crossings.

**Acceptance**: all 38 rows moved from `planned` to `files` with real attribution;
`npx vitest run tests/unit/` audio tests green; then rebuild the Portals bundle
(§B step 3) so `portals/dist/audio/` picks the files up.

**Do NOT** invent direct sound-page URLs. The search URLs are the honest manifest.
Do NOT scrape Pixabay's API or bypass their site.

### B. Portals deployment — ONE step left, then a repeatable flow  *(user-facing, small)*

**History you need**: the Portals GitHub import failed twice for different reasons,
both fixed:

1. `SOURCE_ARCHIVE_FAILED` — the repo snapshot was 147 MB (137 MB is
   `assets/reference`). Fixed: `.gitattributes` marks `/assets/ export-ignore`, so
   GitHub archives are now ~2 MB. Never remove that line; never add game-runtime
   files under `assets/`.
2. Blank white preview — Portals serves the game folder STATICALLY, it does not run
   builds. The import pointed at `portals/` (raw Vite source; its index.html loads
   `/src/main.tsx`, which no browser executes). Fixed: the built `portals/dist/` is
   now COMMITTED (un-ignored in `.gitignore`).

**The one remaining step** (the user may have already done it — verify): in Portals'
game settings (`portals.to/my-games` → make-it-worse → settings → "GitHub source"),
the **game folder must be `portals/dist`** (entry file `index.html`). The settings
panel's fields render read-only; if there is no edit affordance, the import must be
recreated with the right folder (the game id is `g7fedf97ae213e1f8744fae14`; the
"⋮" menu has duplicate/archive/delete — deleting the import config and re-adding the
repo with folder `portals/dist` is acceptable; do NOT delete the game if it holds
published state without the user's say-so).

**Verify**: after "sync latest from GitHub", the editor preview at
`portals.to/editor/g7fedf97ae213e1f8744fae14` must render the game's title screen,
not a white page. The panel's "last commit" must show the synced commit.

**Repeatable flow for every future code change**:

```powershell
pnpm --filter @make-it-worse/portals build   # regenerates portals/dist
git add portals/dist; git commit; git push
# then: Portals settings → "sync latest from GitHub"
```

This is documented in `README.md` §"Portals build and import" — keep that section
truthful if you change the flow.

### C. Vacuum — the last unwired prop  *(finishes the 10/10 prop set)*

**State**: blockout complete and honest; structural pass was being run at handoff.
Geometry facts you must not re-litigate (each was measured and ruled):

- Canister sized 0.70 (down from reference-proportional 0.80) so the hose clears the
  shell. The height gap vs its collider is real and recorded (a canister vacuum is
  0.63 as tall as wide; the box was authored for the old prop).
- The hose has a known exposed fold at t 0.82–0.885 (0.42× tube radius). RULED:
  ships as a recorded deviation. It is a few cm of pinch on a ~6 cm hose viewed from
  meters away. Do NOT re-route the hose to fix it; the fold-free route is 1.40×
  centreline (a different hose) and the tail re-route breaks the recorded
  "sweeps the front" framing ruling.
- FREE WIN, ruled to land: feed the 9-point hose cage DIRECTLY to
  `buildTubeGeometry` instead of double-interpolating through 25 samples. Better bow
  (0.1841 vs 0.1826 target metric), truer centreline, 864 vs 2400 triangles, and it
  removes two concealed collar folds. No test blocks it. If the spec's risk text
  claims a sample-count pin that does not exist, correct that text in the same change.
- The spec has a `fold_report()` that measures hose self-intersection on every author
  run using three.js's own centripetal Catmull-Rom parameterisation (verified against
  three.js to 5 decimals). Keep it running; its discrete-estimate caveat is recorded.

**Remaining work**:

1. Finish/verify the structural pass end to end (`python assets/reference/props/author_vacuum_spec.py`
   regenerates `createVacuumModel.ts` deterministically — the factory is generated,
   never hand-edit it). Render, eyeball at the chase-camera angle, note
   "fast-mode eyeball, no formal review" honestly in the pass header. Do not
   fabricate review entries.
2. Nozzle-slot feature as form-refinement (the spec's own ladder places it there).
3. Wire it: in `components/game/AssetModel.tsx` replace `OriginalAngryVacuum` with a
   `Sculpted id="vacuum"` entry (pattern: see SculptedToilet / SculptedRefrigerator).
   The vacuum has no moving part contract (unlike the fan), so the plain `Sculpted`
   wrapper works.
4. **In the same change**, land the ruled collider trim: TrapRenderer's angry_vacuum
   `CuboidCollider` → `args={[0.43, 0.32, 0.44]}` mounted so the box centre sits at
   y+0.32 (box spans 0→0.64 on the deck), replacing the old [0.5, 0.55, 0.45] at
   −0.55. Update the vacuum fit test in `tests/unit/sculpted-props.test.ts` to the
   new envelope — including BOTH z extremes against the half-extent (see the fan fit
   test for the containment pattern; size alone cannot prove containment).
5. Gate: `npx vitest run tests/unit/sculpted-props.test.ts tests/unit/trap-collider-fit.test.ts`
   then full suite + tsc. Then §B step 3 (rebuild dist, commit, push, sync).

### D. Frame-time verification (task #18)  *(diagnostic, blocked on a live browser)*

Claim to verify: the environment may be fill-bound near the frame budget. Method:
run the game (either shell), focus the tab (hidden tabs suspend rAF — the canvas
sticks at 300×150), and sample ~240 frames of `requestAnimationFrame` deltas,
trimming warmup; report meanMs / p95Ms / fps / devicePixelRatio / canvas size.
Numbers >16.7 ms p95 at 1080p mean a real problem: first suspects are the two big
chunks (`GameCanvas` 3.2 MB) and shadow-pass draw-call doubling (renderer.info
counts shadows; halve before comparing). A bounded sampler script existed in the
session but was never run — write your own, it is 15 lines.

### E. Retry-after-failure bug (task #20)  *(possible real gameplay bug)*

Symptom report: after failing a run and clicking "Try again", the player may land on
a dead failure card instead of a restarted run. Two diagnosis paths:

- Live: fail a run, click Try again, watch the phase store (`useGameStore` phase
  field) — does it re-enter "playing" and then immediately "failed" (died-again,
  e.g. spawn inside a trap), or never leave the failure card (UI bug)?
- Test: `tests/e2e/challenge-loop` test 2 has a `phaseAfterLeaving` probe written to
  distinguish exactly never-restarted vs died-again. Run it on a QUIET machine
  (suite under load produces phantom worker-spawn failures — a dirty-run failure
  proves nothing until a quiet run agrees).

Fix whatever it turns out to be; add a regression test that pins the phase sequence.

### F. Apartment pipeline (task #3)  *(long-running, lower priority)*

The apartment room factory (`createApartmentModel.ts`) is wired and furnished
(APARTMENT_VARIANTS, blank-wall fix landed, contrast washes tuned — DECK_WASH 0.62,
PALETTE.danger 4.74:1). Remaining ambition, not started: push the apartment through
later img2threejs passes (form/material) for AAA interior detail. The honest-ladder
rules in §5 apply. This is polish; everything above outranks it.

### G. Backlog (nice-to-have, in rough order)

- Code-split the Portals bundle (vite warns: index 1.6 MB, GameCanvas 3.2 MB —
  dynamic-import the game canvas, manualChunks for three/rapier).
- More shoe/wearable variants (the four `wear-*.png` refs in Downloads at handoff
  were unprocessed).
- Toilet collider trim IF AND ONLY IF the user asks: one constant
  (TOILET_HAZARD_HALF_X, TrapRenderer.tsx ~line 663) + its test floor — but it
  narrows the telegraph ring and hitbox together; it was ruled OFF absent the
  user's explicit word. Same for any other tuned trap collider.
- Frame the 147-item my-games thumbnail (Portals settings "Add featured image") —
  needs a cover render; `assets/reference` has candidates.

---

## 5. STANDING RULES AND RULINGS (violating these undoes finished work)

1. **Do not touch**: `lib/game/constants.ts` (PLAYER block especially),
   PlayerController movement math, or any tuned trap collider not named in §4.
   Movement feel was tuned across the whole day against real play.
2. **Flush risers at 0.50u+ are authored map design** (named segment mechanics), not
   bugs. Only 0.40u risers were bugs, already fixed. Do not "fix" the map.
3. **jsdom tests assert GEOMETRY ONLY.** Under jsdom there is no canvas 2D context, so
   factories take the no-texture material path (baseColor visible); in a real browser
   they take white+procedural-maps. A color assertion in a unit test describes
   NOTHING about shipped appearance. Appearance is verified by rendering in a
   browser. This is documented at the top of `tests/unit/sculpted-props.test.ts`.
4. **Generated factories are outputs.** `create*Model.ts` files are emitted from
   `assets/reference/props/author_*_spec.py`. Edit the spec/author script and
   regenerate (then re-apply `refine_props.py` if the header says so). Hand-edits to
   generated files get destroyed on the next regeneration.
5. **img2threejs honesty**: pass ledgers/reviewHistory must record what actually
   happened. Never fabricate a review entry; "fast-mode eyeball, no formal review"
   is an acceptable honest entry. Never author geometry to move a score; never edit
   a gate your own change trips.
6. **Trap fairness pricing**: a trap's riskWeight derives from its impulse + repeat
   gate (rule at the top of `trap-catalog.ts`). If you change what a trap does to a
   runner, the table in `traps-wave-b.ts` and the catalog price must move together —
   `tests/unit/traps-wave-b.test.ts` enforces it.
7. **Suite hygiene**: the full suite spawns many node workers; on a loaded machine it
   produces phantom timeouts. A failure only counts when a quiet re-run reproduces it.
8. **Dropbox lag**: this working tree lives in Dropbox. A grep returning zero matches
   on a file another process just wrote may be mid-sync — re-read with mtime before
   concluding anything.
9. **Commits**: conventional, descriptive, explain the WHY in the body. The repo
   pushes to `github.com/mcgibbons11-art/make-it-worse` main. The user decides when
   to publish in Portals ("publish game" button) — never click that for them.
10. **CREDITS.json is a provenance manifest.** Every audio file gets a real source
    entry. Files predating the manifest say so honestly. Keep it that way.

---

## 6. Quick-start checklist for your first hour

1. `git log --oneline -5` and `git status` — reconcile against §3.
2. Run the verification gate (§1) on a quiet machine — expect 53 files / ~701 green,
   tsc exit 0. If not, something landed after this handoff; read the diff first.
3. Check whether the Portals game folder was already switched to `portals/dist`
   (§4B) — that plus one sync click makes the user's game playable, which is the
   thing they care about most tonight.
4. Then task A (sounds — biggest user-visible gap, pure grind), then C (vacuum),
   then D/E diagnostics, then F/G.

---

## 7. More pickup items (second pass, same evening)

Added after the vacuum closed. These are real, scoped, and unclaimed.

### 7.1 Touch controls — the game is unplayable on phones  *(biggest untapped audience)*

The Portals editor previews desktop AND mobile, and Portals games get mobile
players — but this game is keyboard-only (WASD/Space, pointer-drag camera). A
mobile player gets a renderer and no way to move. Scope: an on-screen thumbstick
(left half of `.game-canvas`'s wrapper) driving the same `lib/game/input.ts`
state the keyboard writes, a jump button, and drag-anywhere-else for camera yaw
(the yaw plumbing already exists — `setCameraYaw`). Trap placement already works
by pointer. Gate on `('ontouchstart' in window)`, keep the HUD keycaps hidden on
touch. Test on the Portals mobile preview tab. No physics or movement-math
changes — the thumbstick writes the same input vector the keys do (do not touch
PLAYER constants).

### 7.2 Portals SDK leaderboard — wired but NEVER verified on the real host

`portals/src/leaderboard.ts` adapts the Portals SDK
(portals.to/documentation/advanced-tooling/portals-sdk) for the global
leaderboard the static edition can't otherwise have. It has never run against
the real host — the game has never successfully loaded inside Portals until the
game-folder switch lands. First session after the game boots there: exercise a
full run → score submit → leaderboard read, and check the browser console for
SDK errors. Expect the SDK to only exist inside the Portals iframe; the adapter
is supposed to no-op gracefully outside it — verify that too (the game must not
crash when played from a plain URL).

### 7.3 Frame-time sampler (task D) — paste-ready

Run in the browser console on a FOCUSED game tab, after gameplay starts:

```js
(() => new Promise(res => {
  const t = []; let last = performance.now(); let n = 0;
  const step = now => { t.push(now - last); last = now;
    (++n < 300) ? requestAnimationFrame(step) : res(report()); };
  const report = () => { const s = t.slice(60).sort((a,b)=>a-b);
    const mean = s.reduce((a,b)=>a+b,0)/s.length;
    const c = document.querySelector('.game-canvas canvas');
    return { meanMs:+mean.toFixed(2), p95Ms:+s[Math.floor(s.length*0.95)].toFixed(2),
      fps:+(1000/mean).toFixed(1), dpr:devicePixelRatio, w:c?.width, h:c?.height }; };
  requestAnimationFrame(step);
}))().then(console.log)
```

Warmup-trimmed (drops first 60 frames). Hidden tabs suspend rAF — the tab must
be foregrounded or every number is fiction. If p95 > 16.7ms at 1080p, suspects
in order: fill-bound environment (shrink canvas to test), shadow pass (halve
renderer.info draw calls before comparing), the 3.2MB GameCanvas chunk's parse
cost (one-time, not per-frame — don't confuse startup jank with steady-state).

### 7.4 Audio finishing details (extends task A)

- AudioManager normalizes per-file to SAMPLE_PEAK (−1.5 dBFS) at decode time, so
  don't loudness-match files by hand — just avoid clipped sources.
- Trimming long files: `ffmpeg -i in.mp3 -ss <start> -t <dur> -c:a libmp3lame -q:a 4 out.mp3`.
  For the loopable entries (`sticky_gum`, `conveyor_strip`, kettle's bed), cut at
  zero crossings and verify the seam by playing the file on repeat before filing.
- `spin_cycle`'s verified source is 1:01 long; the brief wants 1.2–1.8s of rising
  whine INTO a thump — cut the segment where the drum peaks, don't fade.
- After all 38 land: run the audio unit tests, rebuild the Portals bundle
  (README flow) so `portals/dist/audio/` picks them up, and spot-check three
  traps in-game for level sanity against the 17 originals.

### 7.5 Code-splitting the Portals bundle (backlog G, concrete recipe)

Vite warns: index 1.6MB + GameCanvas 3.2MB. Cheapest wins in order:
`React.lazy` the GameCanvas import in `portals/src/PortalsApp.tsx` (menu paints
while the game loads); `manualChunks` splitting `three`, `@react-three/*`, and
`@dimforge/rapier3d-compat` into their own chunks (rapier's WASM-adjacent JS is
the single biggest module); then re-measure. Keep `portals/dist` committed —
the chunk names change every build, which is normal; commit the whole folder.

### 7.6 Supabase edition parity (only if touching the Next.js shell)

Migrations are auto-discovered by the sql-parity test — numbered files in
`supabase/migrations/` are picked up without registration. `challenges.track`
is optional-absent-means-classic (never null); descendants inherit the parent's
track via trigger AND publishChild's spread — if you add fields to the
challenge payload, bump the codec version and extend `challengeSchema` in
`lib/game/schemas.ts` (trackSchema shows the pattern).

### 7.7 Small polish items, verified real

- Featured thumbnail: Portals settings has "Add featured image" (empty today).
  A cover render of the apartment with traps would do; `assets/reference` has
  candidates but they are export-ignored — copy the chosen one into the
  settings upload by hand, don't move it into the runtime tree.
- The Portals editor has a "2p" preview tab — the game is single-player. A
  second-runner ghost (replay of the chain's best attempt) would be the cheap
  first multiplayer-ish feature and needs no netcode, just recording the
  attempt's position stream (the attempt lifecycle in the store already has
  clean start/finish hooks).
- `git status` should stay clean after every work session — this tree is in
  Dropbox, and uncommitted work is exposed to sync conflicts. Commit early.

---

Good luck. The test suite is the contract — trust it over any prose here if the two
ever disagree, and update whichever one is wrong. A project CLAUDE.md now exists at
the repo root with the durable rules; read it first, it is shorter than this file.
