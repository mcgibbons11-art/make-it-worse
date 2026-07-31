# Make It Worse — Active Work List

Updated continuously from playtest feedback. New requests are added here before being closed.

## Full polish pass — 2026-07-30

- [x] Add a lightweight, broad sky setting to generated rooms: attractive layered clouds, a sun, distant birds, and an occasional passing plane. These elements are visual-only, non-interactable, restrained, and kept outside the playable course.
- [x] Give every trap stronger personality and readable feedback through anticipation, reaction, particles, synchronized sound, impact readability, and restrained camera response without making every contact fatal.
- [x] Finish movement and camera polish: ledge stutter/snagging, camera obstruction, continuous 360-degree rotation, spawn orientation, and seamless gameplay/placement/retry transitions.
- [x] Complete a massive wearable quality pass: inventory and inspect every option on the actual runner from multiple angles; score fit, clipping, silhouette, material/readability, and personality; create a concrete rebuild plan; and substantially improve weak items through the required reference/img2threejs workflow. Add a dedicated hair category with about 20 clearly distinct procedural hairstyles and full custom color controls. Remove the baked-in base shirt and pants so `None` leaves the runner genuinely unclothed, extend/refit short tops and hoodies to meet the pants line when garments are worn, fix handheld alignment, and improve the running pose.
- [x] Make the custom builder feel like a complete editor: undo/redo, clearer selection and placement previews, multi-select/group movement, copy/paste feedback, non-restrictive reachability warnings, Unity-style position/rotation/X-Y-Z scale controls for customizable blocks, a confirmed way for players to delete their own saved maps from My Maps, and a persistent Copy Code action for an already-published map without forcing a republish.
- [x] Finish apartment decorating polish: selection and movement, undo/redo, floor/wall customization, materials, lighting, and lived-in environmental detail.
- [x] Complete a user-centered controls and task-discovery pass across gameplay, custom builder, and apartment: every page must clearly expose what the player can do through concise contextual controls, opt-in tutorial modes, and useful help. Remember dismissed/completed guidance, never replay load-in coaching on Try Again, never stack duplicate tips, and keep help available without spamming or blocking play. Also polish emoji consistency, spacing, control states, panel sizing, loading, game-over/victory presentation, and responsive menu behavior.
- [x] Perform a full audio-mix pass and add small original/procedural cues where the game needs feedback, while preserving source provenance for recorded audio.
- [x] Strengthen replayability with meaningful room variation, better run statistics, personal-best feedback, room-scoped records, and clearer replay/add-a-trap motivation.
- [ ] Verify sharing and publishing end to end: map codes, exact reproduction, child rounds, persistence, local map management, Trending behavior, and real processed-Portals session boundaries.
- [ ] Optimize initial loading and steady-state runtime performance, including full-resolution frame pacing, shadows/draw calls, and avatar/apartment/builder transitions.
- [ ] Complete the desktop, mobile, responsive, Portals-iframe, retry, long-chain, large-map, and reload-persistence regression matrix.
- [x] After all implementation is complete, run ten genuine adversarial art/design review rounds against rendered builds using separate review agents. Every round must cover the apartment, avatar builder, custom game builder, and main clean-room play; retain evidence and actionable findings, fix material issues between rounds, and never count a fabricated or code-only review as a completed visual round.
- [ ] Rebuild and commit `portals/dist`, push `main`, drive the authenticated Portals GitHub-source sync, and verify every major flow in the processed Portals editor build. Do not press the final Publish Game control; that remains the user's action.

## Blocked on Portals platform support

- [ ] Revisit a main-menu Shop tab for outfits/wearables and apartment furniture only after Portals exposes a documented, server-verifiable Credits balance, purchase, receipt, entitlement, and restore API. Never grant paid ownership from local storage, client-reported scores, or an unverified client callback; verified entitlements must survive migrations and partial-save recovery forever.

## Fix first

- [x] Add emojis to all three post-code level intro actions: Beat their version, Edit/Make your runner, and Back to the main menu.
- [x] Add emojis to every button in the Use map code popup so its actions match the rest of the menu system.
- [x] Add custom-builder hotkeys: Delete removes the selected item, Ctrl/Cmd+C copies it, and Ctrl/Cmd+V pastes it without affecting protected spawn/finish markers or focused form controls.
- [x] Expand every ? help panel with complete room-specific guidance for the main game, custom build mode, and apartment explore/decorate modes.
- [x] Turn custom-builder Browse maps into a clear My maps area where locally saved/published custom maps can be viewed, reopened for editing, or played in Test mode.
- [x] Fix custom-built map shares producing recipient-side invalid-code errors without imposing editor asset-count limits: authored traps use free-build coordinate bounds, pasted links/codes are extracted robustly, and every generated code passes the recipient decoder before it can be copied.
- [x] Remove the remaining placed-asset count caps: trap-heavy authored rooms import/play, offer another trap after completion, publish/share the child, and free-build maps round-trip hundreds of blocks without a block or trap count limit.
- [x] Fix Try Again respawning the runner away from the map/spawn support and immediately dropping them into the void.
- [x] Add emoji icons to every action on the Try Again failure card and the game-beaten victory popup.
- [x] Remove snapping from every movable apartment object so furniture follows the pointer freely and does not stick to nearby furniture.
- [x] Make trap dragging pointer-captured and raycast against a stable deck plane, and freeze the follow camera only while the button is held so camera recentering cannot pin the trap at an edge.
- [x] Make Use map code fully work in the processed Portals iframe: open immediately and load through a sandbox-safe button instead of a blocked HTML form submission.
- [x] Replace the blocked native prompt behind Use map code with an in-game paste panel that works inside the Portals iframe.
- [x] Clear held keyboard/touch input at every run boundary so a new attempt can never inherit motion from the previous one.
- [x] Resolve every runtime spawn onto safe supporting geometry so imported/authored maps cannot drop the runner straight into the void.
- [x] Fix trap-placement picking so the cursor targets platform top faces and a click near a large trap does not pin it to a platform edge.
- [x] Make Build Your Runner reliable in the user's actual playtest session; the editor and garment preview must both render and respond.
  - [x] Contain the graphics-safe preview so it cannot cover or block the wardrobe controls.
  - [x] Restore and verify the real dressed 3D character viewer with left-drag rotation in the Portals build.
  - [x] Replace “Keep the stock runner” with a Randomize button that generates a complete valid runner.
- [x] Fix builder drag-and-drop for traps and non-block items so they move exactly like blocks.
- [x] Keep a dragged builder object exclusive so crossing stacked/overlapping objects never selects or moves them too.
- [x] Keep every trap on its authored base colors; never expose trap color customization.
- [x] Keep the builder asset tray wide enough that it never needs horizontal scrolling.
- [x] Keep the builder's maximum vertical jump warning 20% below the previous estimate.
- [x] Restore the full completion → reward → choose trap → place trap → publish/share sequence after Play a clean level.
- [x] Give randomized clean levels varied game colors instead of making the whole room yellow.
- [x] Replace “Play one somebody already ruined” with a trending-map browser.
- [x] Fix intermittent Add Trap submission failure where the camera flashes to the runner, returns to placement, and leaves the player stuck without placing the trap.
- [x] Preserve the same generated room between rounds after placing a trap; never replace it with a different/classic room when playing the child version.

## Traps and movement

- [x] Face the runner from the spawn point toward the room's end gate on every map load and every Try again attempt; never respawn looking backward.
- [x] Redesign Junk Drift/trash pile and finish its animation/effect pass.
- [x] Make the pedal bin eject trash debris that causes slipping.
- [x] Make Mattress Rebound launch the runner much harder.
- [x] Increase trap disruption globally: knockback, bounce, slow, and slip.
- [x] Audit every trap for a meaningful effect and visible animation; remove passive filler behavior.
- [x] Fix ledge physics so the runner falls instead of snagging.
- [x] Improve the run cycle with more knee bend and arm swing.

## Builder and sharing

- [x] Flash a concise controls/hotkeys banner at the top whenever Build mode opens; auto-fade it and provide an immediate × dismissal.
- [x] Remove the main-menu Global leaderboard and scope every leaderboard to the exact custom-built room or shared challenge version being played, so unrelated rooms and trap depths never share scores.
- [x] Move code redemption out of Trending: add a dedicated main-menu Use map code action that pastes and immediately loads the exact published map or shared challenge without treating ordinary challenge codes as Trending publications.
- [ ] Finish and prove the full Portals-native custom-game path: draft → publish to this device/session → durable map code → same-session automatic delivery or cross-session paste → Trending catalog → exact-version play → child rounds. This remains open until the processed Portals check below passes with different real players.
- [x] Resolve global backend feasibility for the Portals release: processed Portals games block every outside `fetch`, WebSocket, and WebRTC connection, and the SDK exposes no global user-content store. Use Portals session relay plus self-contained map codes instead of presenting local data as global Trending.
  - [x] Keep the completed Supabase schema/API/community browser as an optional standalone-web extension; it is not used by or required for the Portals release.
- [x] Replace the assumed Portals invite URL with an SDK-supported sharing flow: session state for players together and a self-contained challenge code for players in different sessions.
  - [x] Make Copy map code → Use map code the primary Portals cross-session flow; retain old link imports only for backward compatibility.
  - [x] Persist authored geometry across reloads and every child round in the local repository.
  - [x] Add a bounded/versioned Portals.net announcement/request/response exchange with late-join shared state and an unavailable-host fallback.
- [ ] Design and test the entire Portals share-game system end to end: create/share/import, same-room delivery, different-session map codes, authored-room persistence, child rounds, payload limits, failure recovery, and recipient playthrough.
  - [x] Browser-test publish → local Trending catalog → raw-code recipient.
  - [x] Unit/integration-test payload limits, authored geometry round-trip, repository reload, and child persistence.
  - [ ] Test same-room delivery inside a processed Portals multiplayer session.
- [x] Define and implement the full Portals-native custom-built-game sharing path.
  - [x] Document the Portals SDK boundary, same-session message path, required global backend, data model, ranking approach, and release test matrix in `CUSTOM-GAME-SHARING.md`.
  - [x] Ship immutable self-contained map codes, recipient import, local persistence, child-round inheritance, and published-map Trending registration.
  - [x] Add stable map ownership plus immutable version records, publish/update history, titles/descriptions, visibility, and rollback.
  - [x] Implement shared Supabase storage/API code for cross-player publishing and loading; never label per-device data global.
  - [x] Build the global browse experience: pagination, search/filtering, creator attribution, version compatibility, and recipient loading/failure recovery.
  - [x] Implement real Trending events/ranking: unique impressions/starts, clears, likes, shares, reports, freshness decay, smoothing, and author diversity.
  - [x] Add reporting, moderation/quarantine states, private/unlisted visibility enforcement, and moderator rollback/removal controls.
  - [x] Add the bounded/versioned Portals.net announcement/request/response protocol for players already in the same processed Portals session.
  - [x] Test payload ceilings, corruption/replay, old-version immutability, browser restart, different-player code import, and two child rounds locally end to end.
  - [ ] Test same-room late join in a processed Portals session.
- [x] Keep spawn and finish mandatory and undeletable, but freely placeable in 3D.
- [x] Test builder vertical layouts, rotated jump footprints, conservative jump warnings, real-game Test mode, platform colors, trap base colors, overlap-safe dragging, and all 55 runtime trap assets.

## Apartment

- [x] Make the apartment shell floor continuous wood throughout and move tile sections plus several rugs into a movable, colorable, persistent Floors catalog.
- [x] Give the Decorate panel a visible vertical scrollbar and let either Backspace or Delete remove the selected apartment item without stealing text-input keys.
- [x] Make every interior wall and doorway a persistent modular apartment item: freely move, rotate, resize, duplicate, remove, and add more from the catalog; add WASD free-camera movement plus Ctrl/Cmd+C, Ctrl/Cmd+V, and Delete hotkeys in Decorate mode.
- [x] Rebuild the apartment completely from scratch as a believable permanent player home; do not line up preassembled corner-room chunks to fake a floor plan.
  - [x] Inventory and dismantle the existing apartment/corner-room assets into modular floors, wall runs, corners, doors, windows, trim, fixtures, and individual furniture/decor pieces.
  - [x] Design and assemble a coherent room-by-room apartment from those modular pieces with believable circulation, scale, sightlines, wall continuity, and distinct room purposes.
  - [x] Make every furniture and decor object individually selectable, movable, rotatable, and placeable by the player rather than baking furnishings into room chunks.
  - [x] Persist the complete apartment shell choices and exact furniture/decor layout across reloads so it functions as the player's permanent home.
  - [x] Complete five independent design-review rounds against rendered builds, address every material finding, and retain the review evidence before marking the remake complete.
- [x] Replace apartment movement/camera with the same controller, physics, and camera settings used by the main game and builder Test mode.
- [x] Expand the apartment to six times the original floor area and turn the asset set into connected rooms the runner can explore.
- [x] Add richer decorating with drag/drop floor placement, moving, organizing, color customization, and local persistence.

## Audio and assets

- [x] Replace the synthesized menu score with the supplied `menu music.mp3` track.
- [x] Cut, normalize, resample, and integrate all 37 supplied sound effects; keep long beds loop-safe and one-shots bounded.
- [x] Codify and enforce img2threejs as the permanent intake/build/review rule for every new 3D asset, with generated reference images where useful.

## Menu presentation

- [x] Remove automatic first-run and post-death coaching cards; guidance only opens after the player explicitly chooses How to play or a `?` guide.
- [x] Keep builder and apartment guidance behind their own opt-in `?` tutorial buttons; never prompt either tutorial automatically.
- [x] Remove native hover tooltips from game and builder controls so they cannot obscure the interface.
- [x] Redesign the main-menu clouds to be fluffy, puffy, layered, and gently animated like the supplied start-screen reference.
- [x] Restore and broadly audit every main-menu emoji/icon for missing assets, broken paths, and text-encoding corruption.

## Completed recently

- [x] Standardize custom-builder trap icon holders to yellow and remove the oversized Floor Fan overlay.
- [x] Add a one-button opening splash and clouds to the main menu.
- [x] Remove the desktop keyboard footer, no-traps message, Portals Edition label, and builder instruction tooltip.
- [x] Add global recorded button/select click audio.
- [x] Make builder camera rotation right-drag and object movement left-drag.
- [x] Add mandatory pre-placed spawn and finish markers; keep them out of the add/remove/copy controls.
- [x] Add distinct vector-style trap icons to the builder tray and rename the tray “Assets.”
- [x] Hide builder chrome during clean-level play.
- [x] Add Charles the Murder Baby and integrate the complete trap roster.
