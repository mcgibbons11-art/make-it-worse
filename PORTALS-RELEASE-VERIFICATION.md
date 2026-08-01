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

The public `/g/make-it-worse` page still serves the pre-duel published build: GitHub sync updates the editor and its previews, and only the user-owned Publish action updates the public page.

### Completed two-player duel pass — 2026-08-01, snapshot `9e39cce`

User testing surfaced that Join, lobby Post, and chat Send did nothing in the editor. Three defects were found and fixed: the duel's net.join raced the still-attached map-relay session (the hand-off is now serialized and awaited, with a 12s join timeout instead of a silent hang, `ead7006`); every duel input row used form submission, which the preview's sandboxed iframes block outright, so they are now plain-button click and Enter handlers (`87a0a02`); and the duel identity moved to a per-frame `window.name` token because the preview panes share web storage and a shared token made both panes seat A (`58bc31d`). Seat claiming was then made joiner-owned with stale-record recovery and a live status line on the waiting panel (`9e39cce`).

With those fixes synced, a full best-of-3 match ran to completion in the processed editor 2p preview over real Portals.net: player 1 hosted `MIW-NRLH` (status line: record #1, seat A, opponent open), player 2 typed the code and joined, both panes flipped to Round 1 · Turn 1 with the host as runner and a freshly minted course. The spectator pane rendered the runner as a live streamed ghost with a floating name label and follow camera, with "started a run" and "went down" events arriving in its feed. Three burned hearts handed round 1 over, round 2 opened with the round loser running first on a fresh course and mirrored score strips (`YOU 0-1` vs `YOU 1-0`), and three more burns ended the match with mirrored result screens ("Bouncy Otter took the match. Final score 0-2" / "You took the match. Final score 2-0") and rematch offered. Not exercised live in this pass: the worsening hand-off (clear -> trap picker -> opponent runs the worsened course), the open lobby, forfeit claims, and rematch - their logic is unit-tested but has not been driven in the editor.

## Deliberately not performed

- The final Portals **Publish Game** action was not pressed.
- The Shop remains blocked. The official Portals SDK v1.4.0 and current advanced-tooling documentation were rechecked on 2026-07-31: they expose identity, 64 KB player save state, casual scores/leaderboards, session networking, voice, and quit, but no Credits balance, in-game purchase, receipt, entitlement, or restore API. Client-reported scores are explicitly forbidden for currency, prizes, or access, so paid ownership cannot be implemented safely yet.
