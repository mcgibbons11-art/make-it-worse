# Apartment redesign review record

Review date: 2026-07-30  
Reviewer: `apartment_design_review` (Epicurus)  
Scope: five rendered-build reviews of the permanent apartment remake.

## Round 1 — Existing design audit

Evidence: `miw-apartment-round1.png`, `miw-apartment-round1-decor.png`

- Failed the repeated-corner-room approach: it read as cloned booths, not an apartment.
- Retained the reusable img2threejs furniture/material work, but rejected the shell layout.
- Established the replacement plan: one continuous 25.8 × 17.2 home with foyer, hall, living/dining, kitchen, bedroom, study, bathroom, and utility room.

Result: rebuilt the shell from modular floor zones, wall runs, openings, windows, trim, and exact colliders; removed every cloned room tray.

## Round 2 — Shell and circulation

Evidence: `miw-apartment-round2-shell-v2.png`, `miw-apartment-round2-decor-v2.png`

- Passed the continuous footprint and player-scale circulation.
- Flagged the institutional central corridor, heavy navy wall caps, blocked cutaway view, and weak room identity.

Result: opened the living threshold, terminated the hall with a window, removed door slabs, thinned and warmed wall caps/frames, added camera-side wall fading, created apartment-specific explore/decor framing, widened the utility opening, and differentiated room floors and lighting.

## Round 3 — Furnishing, scale, and materials

Evidence: `miw-apartment-round3-entry-v2.png`, `miw-apartment-round3-rotated.png`, `miw-apartment-round3-decor-v2.png`

- Passed the shell and camera.
- Flagged incomplete room compositions, miniature plant/desk/chair scale, flat floor materials, outdoor motes indoors, blank walls, and the unfinished entrance door.

Result: composed all rooms with 37 starter objects; added a four-chair dining set, L-shaped kitchen, balanced bedroom, study, sink vanity, and utility grouping; corrected prop scale; added wood/tile seams, modular art/shelf/radiator/curtain decor, smoother interior light, and a detailed framed entrance door; removed indoor motes/clouds.

## Round 4 — Decorating UX, collision, and persistence

Evidence: `miw-apartment-round4-entry.png`, `miw-apartment-round4-rotated.png`, `miw-apartment-round4-decor.png`, `miw-apartment-round4-movement.png`

- Passed movement, the living-room route, wall colliders, pointer capture over overlapping objects, reload persistence, migration, the opt-in guide, and the separate-object catalog.
- Flagged untyped placement, unchecked invalid drops, a long catalog, synchronous autosave, destructive-reset risk, coarse rotation, and missing Undo.

Result: introduced the v2 floor/wall/surface anchor schema with v1 migration, wall snapping, parent-following surface items, wall/object/runner drop checks with a red invalid state and last-valid retention, grouped filters, sticky selection controls, collapsible colors, 15° turns, Duplicate, one-level Undo, an 80-item cap, confirmed reset, debounced/flushable error-aware persistence, and correct Escape/focus behavior for the guide.

## Round 5 — Final release review

Evidence: `miw-apartment-round5-explore-final.png`, `miw-apartment-round5-rotate-final.png`, `miw-apartment-round5-editor-final.png`, `miw-apartment-round5-editor.png`

Verdict: **PASS.** No apartment-specific release blockers remained. The reviewer confirmed the coherent walkable home, distinct rooms, continuous circulation, cutaway camera, typed placement, invalid-drop protection, parent-following surface objects, bounded/grouped editor, Undo/Duplicate/rotation/color/reset workflow, migration, exact persistence, opt-in guide behavior, and final curtain correction.

## Verification evidence

- Browser: 26 catalog buttons; floor, wall, and surface anchors present; drag succeeded; Undo restored exact coordinates; guide did not auto-open; Escape closed it and restored focus; v2 decor and style persisted exactly through reload; zero page errors.
- Automated: 69 test files passed, 769 tests passed, 1 skipped; TypeScript and ESLint passed.
