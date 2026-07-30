# Make It Worse — Active Work List

Updated continuously from playtest feedback. New requests are added here before being closed.

## Fix first

- [ ] Make Build Your Runner reliable in the user's actual playtest session; the editor and garment preview must both render and respond.
- [ ] Fix builder drag-and-drop for traps and non-block items so they move exactly like blocks.
- [ ] Keep every trap on its authored base colors; never expose trap color customization.
- [ ] Keep the builder asset tray wide enough that it never needs horizontal scrolling.
- [ ] Keep the builder's maximum vertical jump warning 20% below the previous estimate.
- [ ] Restore the full completion → reward → choose trap → place trap → publish/share sequence after Play a clean level.
- [ ] Give randomized clean levels varied game colors instead of making the whole room yellow.
- [ ] Replace “Play one somebody already ruined” with a trending-map browser.

## Traps and movement

- [ ] Redesign Junk Drift/trash pile and finish its animation/effect pass.
- [ ] Make the pedal bin eject trash debris that causes slipping.
- [ ] Make Mattress Rebound launch the runner much harder.
- [ ] Increase trap disruption globally: knockback, bounce, slow, and slip.
- [ ] Audit every trap for a meaningful effect and visible animation; remove passive filler behavior.
- [ ] Fix ledge physics so the runner falls instead of snagging.
- [ ] Improve the run cycle with more knee bend and arm swing.

## Builder and sharing

- [ ] Connect published custom maps to a real shared backend and cross-player browser.
- [ ] Keep spawn and finish mandatory and undeletable, but freely placeable in 3D.
- [ ] Continue builder usability testing for vertical layouts, jump warnings, Test mode, colors, and all runtime assets.

## Apartment

- [x] Replace apartment movement/camera with the same controller, physics, and camera settings used by the main game and builder Test mode.
- [ ] Expand the apartment substantially and turn the asset set into connected rooms the runner can explore.
- [ ] Add richer decorating with drag/drop floor placement, moving, organizing, and color customization.

## Audio and assets

- [x] Replace the synthesized menu score with the supplied `menu music.mp3` track.
- [ ] Cut, normalize, resample, and integrate the remaining supplied sound effects.
- [ ] Continue using img2threejs for every new 3D asset, with generated reference images where useful.

## Completed recently

- [x] Add a one-button opening splash and clouds to the main menu.
- [x] Remove the desktop keyboard footer, no-traps message, Portals Edition label, and builder instruction tooltip.
- [x] Add global recorded button/select click audio.
- [x] Make builder camera rotation right-drag and object movement left-drag.
- [x] Add mandatory pre-placed spawn and finish markers; keep them out of the add/remove/copy controls.
- [x] Add distinct vector-style trap icons to the builder tray and rename the tray “Assets.”
- [x] Hide builder chrome during clean-level play.
- [x] Add Charles the Murder Baby and integrate the complete trap roster.
