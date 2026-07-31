# Ten-round visual review record

Completed 2026-07-30 against rendered 1440×900 Portals static builds. Every
round was performed by a separate review agent against the PNG evidence in
`artifacts/portals-polish`; no round was counted from source inspection alone.
Screens were recaptured after material fixes, so the folder represents the
final pass rather than preserving obsolete failures as the release evidence.

| Round | Main findings | Disposition |
|---|---|---|
| 1 | Random outfit layering failed; the menu overflowed; builder selection had a diagonal artifact and orphan notice; apartment/builder needed scroll cues. | Fixed menu sizing, selection edges, empty-notice collapse, and inventory cues. Began compatibility-aware randomization. |
| 2 | Random wearable stack remained the blocker; builder framing and inventory continuation were weak; menu still needed containment. | Tightened menu card, builder selection, scroll styling, and wardrobe layering rules. |
| 3 | Repeated avatar/menu/builder concerns; also reported missing controls that were visibly present. | Fixed evidence-backed findings. Claims contradicted by the pixels were recorded as false positives, not used to create churn. |
| 4 | No blockers. Random avatar still failed; apartment inventory clipped; builder was underscaled; clean play passed. | Added persistent scroll affordances, closer layout framing, and curated full-body random combinations. |
| 5 | Random avatar was the sole blocker. Apartment, builder, play, and menu passed with polish debt; progress looked ambiguous. | Added START/GOAL progress labels and stronger outfit exclusion rules. |
| 6 | Builder/apartment scrolling and progress clarity remained; report that apartment header buttons were blank contradicted the screenshot. | Made scrollbars/cues persistent and retained the functioning header. |
| 7 | Avatar face layers and held flag still collided; apartment and builder passed; the plane and an authored trap were mistaken for debris. | Prevented visor/mask/eyewear and harness/top/pack collisions; corrected held-item grip/presentation. Kept requested plane and functional trap. |
| 8 | Builder’s partial next trap card was visually abrupt; clean-play help was opt-in behind `?`; other surfaces passed. | Retained the requested opt-in help policy, strengthened the tray cue/scrollbar, and continued editor framing work. |
| 9 | Pre-fix random avatar and builder composition failed; material/lighting consistency received a broader art-direction critique. | Reduced sandals, moved the balloon outside the face silhouette, suppressed hidden hair selections under full hats, and centered the authored layout. |
| 10 | No blocker or high findings. Menu, avatar, apartment, and clean play passed. Builder failed only because the near platform sat behind its permanent action dock. | Added UI-aware camera aim and moved the transform inspector above the two-row dock so the complete map and every toolbar action remain available. |

## Final release evidence

- `main-menu.png`: complete menu hierarchy, animated cloud setting, no crop.
- `avatar-default.png` and `avatar-random.png`: full head-to-feet viewer,
  readable layering, held item in the hand, no automatic spin.
- `apartment-explore.png` and `apartment-decorate.png`: coherent permanent
  apartment, continuous wood floor, modular rooms, visible furniture scrolling.
- `custom-builder.png`: required endpoints, full asset tray, editor controls,
  selection outline, and map framed above the action dock.
- `clean-play.png`: normal HUD/runtime, sky ambience, readable route and goal.

The final automated capture was also checked locally after round 10. The only
remaining review comments are subjective future refinements (denser apartment
staging, richer world materials, and less dense compact control copy), not
clipping, broken interaction, or a release blocker.
