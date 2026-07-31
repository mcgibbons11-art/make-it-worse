# Portals release verification — 2026-07-30

Release snapshot: `9e6ce19` (`main`)

## Automated gates

- ESLint and TypeScript passed with zero errors.
- Vitest: 71 files, 798 passed, 1 skipped.
- Full Playwright regression: 21/21 passed across Chromium, Firefox, WebKit, mobile, CPU-throttled, retry, gameplay, and trap flows.
- Device flow: 45 checks passed at 390×844, 768×1024, and 1440×900.
- Exact map-code flow passed between two fresh browser profiles: publish, immutable Copy Code, recipient import, exact geometry/traps/markers, gameplay, and creator-side deletion isolation.
- Portals bundle validator passed: 99 regular bounded files, 8,461,593 bytes total, largest file 2,237,128 bytes.

## Processed Portals editor pass

Portals synced GitHub commit `9e6ce19` from `portals/dist` as a static bundle and loaded it in the authenticated editor preview.

- Opening splash and main menu rendered with the new sky/cloud presentation and emoji actions.
- Clean play loaded the normal timer, disaster, personal-best, progress, pause, camera, runner, traps, goal, and environmental ambience.
- Build Your Runner rendered the dressed movable 3D preview, all wardrobe categories, and the 20-style hair category.
- Apartment Explore and Decorate rendered the continuous wood floor, modular walls/furniture, mode controls, undo/redo, catalog scrolling, and Floor Fan entry.
- Build Your Game rendered the 55-trap catalog, editor controls, My Maps, persistent Copy Code, Publish, and Test Map. Test mode loaded the authored map with finished-game movement/camera/traps/goal behavior and returned to the intact draft.
- A previously published map produced a 1,732-character `MIW-MAP-1` code from My Maps. Pasting it through Use Map Code opened the correct “rotating toilet” version with all three emoji actions, and Beat Their Version launched the matching Disaster 8 course with its normal HUD.
- The original featured thumbnail was restored after the sync settings pass.

## Deliberately not performed

- The final Portals **Publish Game** action was not pressed.
- Same-room late-join delivery still needs two distinct real players in one processed Portals multiplayer session; self-contained cross-session map codes are verified.
- The Shop remains blocked until Portals documents server-verifiable Credits purchasing, receipts, entitlements, and restore APIs.
