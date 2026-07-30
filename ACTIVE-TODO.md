# Make It Worse — Active Work List

Updated continuously from playtest feedback. New requests are added here before being closed.

## Fix first

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

- [x] Redesign Junk Drift/trash pile and finish its animation/effect pass.
- [x] Make the pedal bin eject trash debris that causes slipping.
- [x] Make Mattress Rebound launch the runner much harder.
- [x] Increase trap disruption globally: knockback, bounce, slow, and slip.
- [x] Audit every trap for a meaningful effect and visible animation; remove passive filler behavior.
- [x] Fix ledge physics so the runner falls instead of snagging.
- [x] Improve the run cycle with more knee bend and arm swing.

## Builder and sharing

- [ ] Connect published custom maps to a real shared backend and cross-player browser.
- [ ] Replace the assumed Portals invite URL with an SDK-supported sharing flow: session state for players together and a self-contained challenge code for players in different sessions.
  - [x] Add self-contained authored-room links and raw challenge codes, plus import from either form.
  - [x] Persist authored geometry across reloads and every child round in the local repository.
  - [ ] Add Portals.net same-session announcement/state exchange after the host multiplayer API is available in the processed build.
- [ ] Design and test the entire share-game system end to end: create/share/import, same-room Portals delivery, different-session challenge codes, authored-room persistence, child rounds, payload limits, failure recovery, and recipient playthrough.
  - [x] Browser-test publish → local trending → link recipient and raw-code recipient.
  - [x] Unit/integration-test payload limits, authored geometry round-trip, repository reload, and child persistence.
  - [ ] Test same-room delivery inside a processed Portals multiplayer session.
- [ ] Define and implement the full custom-built-game sharing path.
  - [x] Document the Portals SDK boundary, same-session message path, required global backend, data model, ranking approach, and release test matrix in `CUSTOM-GAME-SHARING.md`.
  - [x] Ship immutable self-contained map links/codes, recipient import, local persistence, child-round inheritance, and local Trending registration.
  - [ ] Add stable map ownership plus immutable version records, publish/update history, titles/descriptions, visibility, and rollback.
  - [ ] Implement the approved shared storage/API for cross-player publishing and loading; never label per-device data global.
  - [ ] Build the global browse experience: pagination, search/filtering, creator attribution, version compatibility, and recipient loading/failure recovery.
  - [ ] Implement real Trending events/ranking: unique impressions/starts, clears, likes, shares, reports, freshness decay, smoothing, and author diversity.
  - [ ] Add reporting, moderation/quarantine states, private/unlisted visibility enforcement, and moderator rollback/removal controls.
  - [ ] Add the bounded/versioned Portals.net announcement/request/response protocol for players already in the same processed Portals session.
  - [ ] Test payload ceilings, corruption/replay, old-version link immutability, browser restart, different-player import, same-room late join, child rounds, and backend rollback end to end.
- [x] Keep spawn and finish mandatory and undeletable, but freely placeable in 3D.
- [ ] Continue builder usability testing for vertical layouts, jump warnings, Test mode, colors, and all runtime assets.

## Apartment

- [x] Replace apartment movement/camera with the same controller, physics, and camera settings used by the main game and builder Test mode.
- [ ] Expand the apartment substantially and turn the asset set into connected rooms the runner can explore.
- [ ] Add richer decorating with drag/drop floor placement, moving, organizing, and color customization.

## Audio and assets

- [x] Replace the synthesized menu score with the supplied `menu music.mp3` track.
- [ ] Cut, normalize, resample, and integrate the remaining supplied sound effects.
- [ ] Continue using img2threejs for every new 3D asset, with generated reference images where useful.

## Menu presentation

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
