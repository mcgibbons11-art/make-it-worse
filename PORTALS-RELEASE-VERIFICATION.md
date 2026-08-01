# Portals release verification — 2026-07-31

Release snapshot: `736b440` (`main`)

## Automated gates

- ESLint and TypeScript passed with zero errors.
- Vitest: 71 files, 800 passed, 1 skipped.
- Full Playwright regression: 21/21 passed across Chromium, Firefox, WebKit, mobile, CPU-throttled, retry, gameplay, and trap flows.
- Device flow: 45 checks passed at 390×844, 768×1024, and 1440×900.
- Exact map-code flow passed between two fresh browser profiles: publish, immutable Copy Code, recipient import, exact geometry/traps/markers, gameplay, and creator-side deletion isolation.
- Portals bundle validator passed: 99 regular bounded files, 8,462,071 bytes total, largest file 2,237,128 bytes.

## Processed Portals editor pass

Portals synced GitHub commit `736b440` from `portals/dist` as a static bundle and loaded it in the authenticated editor preview.

- Opening splash and main menu rendered with the new sky/cloud presentation and emoji actions.
- Clean play loaded the normal timer, disaster, personal-best, progress, pause, camera, runner, traps, goal, and environmental ambience.
- Build Your Runner rendered the dressed movable 3D preview, all wardrobe categories, and the 20-style hair category.
- Apartment Explore and Decorate rendered the continuous wood floor, modular walls/furniture, mode controls, undo/redo, catalog scrolling, and Floor Fan entry.
- Build Your Game rendered the 55-trap catalog, editor controls, My Maps, persistent Copy Code, Publish, and Test Map. Test mode loaded the authored map with finished-game movement/camera/traps/goal behavior and returned to the intact draft.
- A previously published map produced a 1,732-character `MIW-MAP-1` code from My Maps. Pasting it through Use Map Code opened the correct “rotating toilet” version with all three emoji actions, and Beat Their Version launched the matching Disaster 8 course with its normal HUD.
- Portals' official 2p preview was used as two distinct processed player connections. Player 1 joined alone and published `Mirror Late Join 0731` while player 2 remained on the unjoined splash. After player 2 pressed Start, it received the exact same-session publication and registered it for Trending.
- With both players joined, player 1 added a Soap Slick and published `Mirror Live Update 0731`. The self-contained code changed from version `clean-1sx7wnk` to `clean-1my5bnz` (1,917 characters), and player 2 received the changed version automatically through the shared-state mirror fallback.
- The same-session protocol now combines bounded announcement/request/response messages, late-join shared state, a `playerjoin` recovery signal, an explicit latest-map request, and a 1.5-second deduplicated read of the documented state mirror so a missed host event cannot strand an active player on an older version.
- The original featured thumbnail was restored after the sync settings pass.

## 1v1 duel verification — 2026-08-01

Release snapshots: `4f344bb` (duel mode) and `5c1f920` (tab-scoped identity fix), both synced to the Portals editor with the last-commit hash confirmed on the settings card.

Verified:

- TypeScript, ESLint, and Vitest passed (73 files, 840 passed, 1 skipped), including 25 new duel protocol/transport tests covering the best-of-3 walk, hearts, forfeit gates, rematch seat swap, invite codes, wire validation, seq ordering, and the lobby/channel adapters against a mocked SDK.
- A 10-check Playwright smoke pass against the built static preview: menu entry, popup, host/join/lobby paths, bad-code rejection, and graceful no-SDK failures.
- In the processed editor 2p preview (real Portals.net): the duel popup renders, hosting connects to a live channel and mints an invite code, and after a preview reload the same pane reclaimed its seat through the tab-scoped duel token ("Rejoin MIW-XXXX" -> waiting on the same channel), which is the reload-recovery path working end to end.
- The invite-input layout fix (`5c1f920`) confirmed rendering correctly in the processed build.

Not verified live, honestly: the full two-seat handshake, live spectating, and the turn loop were not driven to completion in the 2p preview. Editor iframe clicks became unreliable mid-session (window resizes changed the capture scale and stalled iframe hit-testing), and one stray click left player 2 in a solo run. The protocol behind those flows is unit-tested, but the live two-player pass remains open.

The public `/g/make-it-worse` page still serves the pre-duel published build: GitHub sync updates the editor and its previews, and only the user-owned Publish action updates the public page.

## Deliberately not performed

- The final Portals **Publish Game** action was not pressed.
- The Shop remains blocked. The official Portals SDK v1.4.0 and current advanced-tooling documentation were rechecked on 2026-07-31: they expose identity, 64 KB player save state, casual scores/leaderboards, session networking, voice, and quit, but no Credits balance, in-game purchase, receipt, entitlement, or restore API. Client-reported scores are explicitly forbidden for currency, prizes, or access, so paid ownership cannot be implemented safely yet.
