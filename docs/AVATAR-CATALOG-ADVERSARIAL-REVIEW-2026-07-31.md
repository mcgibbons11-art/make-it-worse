# Build Your Runner adversarial catalog review — 2026-07-31

Status: **PASS for the current idle catalog; animation/combo certification remains open.**

## Remediation acceptance — 2026-07-31

The failing baseline below is retained as the defect record, but its item verdicts are superseded for the current idle catalog by three generated remediation passes and a fresh runtime review. The source authoring scripts and generated factories now cover all 20 hairstyles plus the complete selectable head, face, eyewear, clothing, footwear, back, and held-item catalog.

- All 86 non-empty selectable items have current-runtime front and side evidence.
- The final 75 affected items were recaptured after the last geometry and framing corrections in `artifacts/avatar-catalog-acceptance-2026-07-31/`.
- The reopened waist/feet/layering finding was corrected and recertified across 13 naked/dressed front-and-profile combinations in `artifacts/avatar-seam-acceptance-2026-07-31-pass8/`: `None` adds no clothing, shirts overlap pants without a body-colored bar or intersecting dark teeth, a real crotch gusset joins trouser legs, the bare foot is a connected heel/instep/toe volume, and five inner/outer combinations retain the inner garment beneath visibly proud outer geometry.
- The unchanged eyewear and footwear acceptance sheets remain in `artifacts/avatar-catalog-final-2026-07-31/`.
- The preview now fits the dressed runner without clipping the head or feet and supports drag, arrow-key, and on-screen rotation.
- Hair is connected and seated; helmet, hats, facial hair, transparent eyewear, layered clothes, footwear, back items, and hand grips received dedicated geometry/material/attachment corrections.
- Manual picking and Randomize now share one compatibility resolver; a newly selected item wins and the UI reports any cleared conflict.
- `None` removes tops and pants, a selected shirt tail overlaps the selected raised waistband without manufacturing base clothes, and every authored color remains available.

This is not a claim that every possible outfit combination is certified in every animation. Rear/profile run, jump, failure, and victory sheets plus representative cross-slot stress combinations remain the final evidence gate for full animation certification.

## Original failing baseline (retained for traceability)

This supersedes any earlier claim that the wearable quality pass was complete. Three independent reviews inspected source, tests, retained renders, current local runtime, every selectable hair/head/face/eyewear state, every held item from multiple angles, and the remaining clothing catalog. Geometry/socket tests are useful, but they are not visual sign-off.

## Honest coverage

- 10 picker slots, 96 visible choices, 86 non-empty choices.
- 20 player colors are now enabled for Body plus all 10 colorable wardrobe surfaces.
- One reviewer exercised all 51 selectable Hair/Head/Face/Eyewear states at a current-runtime front three-quarter view.
- All 8 held states were reviewed from front, profile, and rear.
- Tops/Outer/Legs/Feet/Back have much weaker evidence: only a small subset has retained current-runtime imagery. Source and automated geometry coverage do not count as a rendered review.
- Legacy decode-only Shades, outer Cape/Wings, and Back Shell/Satchel/Air tanks are not selectable and remain visually uncertified.
- No complete catalog currently has retained front, rear, both profiles, run, jump, failure, victory, and chase-camera evidence.

## Systemic findings

1. Most of the catalog is still primitive blockout art. Many hair styles read as detached spheres, pellets, pancakes, or cones rather than connected hair.
2. Manual combinations can hide or intersect active selections. Randomize already avoids several of these combinations, but manual selection does not share a compatibility policy.
3. Opaque steel/main materials are being used as lenses and visors. Several eyewear items read as blindfolds.
4. One cloth-like material recipe is reused for knit, denim, leather, rubber, plastic, wood, and most hard-surface props.
5. The existing tests prove attachment, bounds, serialization, and selected clearances. They do not prove fit, z-fighting, layer compatibility, material identity, reference fidelity, rear/profile quality, or animation quality.
6. The previous quality audit contains claims unsupported by runtime geometry or retained renders. It must not be used as sign-off.
7. Product decision: **do not restore color restrictions.** All colors remain selectable. Readability must come from the new invariant ink silhouette/edge treatment, lighting, and contact shadow—not from disabling Cream, Butter, Blush, or any other swatch.

## Hair — all states

| Style | Verdict | Required change |
|---|---|---|
| Bald | Pass baseline | Retain; add side/rear/animation evidence. |
| Classic crop | Fail | Replace forehead bead-chain blobs with connected tapered locks embedded in one cap. |
| Buzz cut | Fail | Remove floating pellets; use a low scalp-hugging textured/studded cap. |
| Crew cut | Fail | Seat and bevel/taper the flat top into the side mass. |
| Chunky spikes | Fail | Use a filled low cap and base-embedded radially oriented spikes. |
| Mohawk | Fail | Add a visible stubble strip and a continuous front-to-rear crest. |
| Fauxhawk | Fail | Build a lower, wider connected ridge on a visible crop. |
| Swept quiff | Fail | Replace three boulders with overlapping elongated lobes swept in one direction. |
| Pompadour | Fail | Replace the row of balls with one connected high front roll tapering rearward. |
| Side part | Fail | Seat the sweep into the cap and turn the black gash into a shallow part. |
| Slick back | Fail | Add visible front-to-rear ridges and a swept-back hairline. |
| Bob | Warn | Flatten/segment side masses, open the face, and verify shoulder clearance. |
| Curly bob | Fail | Use smaller overlapping curls over a continuous under-cap. |
| Afro | Warn | Vary curl size/placement and reduce checkerboard shadow contrast. |
| Puff buns | Fail | Add a clear cap/parting, roots, and ties connecting both puffs. |
| Low ponytail | Warn | Add side sweep/tie and a tapered segmented tail; verify back collisions. |
| High ponytail | Fail | Replace horn-like blobs with a curved tail and clear high tie. |
| Twin braids | Warn | Overlap/twist segments and restore a complete visible scalp cap. |
| Locs | Critical fail | Rebuild as rounded tubes/capsules; move front locks away from eyes, nose, and mouth. |
| Shag | Fail | Add distinct side/rear layers and eyebrow-safe front locks. |
| Swept undercut | Critical fail | Seat the sweep against a visible undercut; remove the floating pancake. |

## Head, face, and eyewear — all states

### Head

| Item | Verdict | Required change |
|---|---|---|
| No hat | Pass | Retain; expose the selected hair. |
| Cap | Warn | Add a projecting curved brim, panels, and larger top button. |
| Headband | Fail | Fit above/through hair intentionally and make the front band readable. |
| Bobble hat | Fail | Enlarge pom, separate crown/cuff, and add rib structure. |
| Bucket hat | Fail | Shorten/lift crown and replace the lampshade disc with a curved annular brim. |
| Beanie | Warn | Add crown ribs and soften/bevel the cuff. |
| Visor | Fail | Extend/lift the brim and manage hair immediately beneath it. |
| Helmet | Critical fail | Rebuild as a coherent motorcycle helmet with a curved translucent visor, jaw guards, and chin opening. |
| Top hat | Warn | Bevel stack/brim and remove embedded cap geometry beneath the brim. |
| Crown | Fail | Lower/widen points around the full band; add metallic trim/gem identity. |
| Cowboy hat | Critical fail | Replace detached side blobs with a complete oval brim and curled edges. |
| Earmuffs | Warn | Make band/cups distinct from hair and fit bulky styles. |
| Beret | Critical fail | Drape onto the skull and remove/fully embed the floating support ring. |
| Headphones | Pass/warn | Strongest head accessory; add fit variants for bulky hair. |

### Face

| Item | Verdict | Required change |
|---|---|---|
| Neutral | Pass | Retain. |
| Grin | Fail | Use a curved dark mouth opening with a smaller inset tooth strip. |
| Focused | Pass | Retain; verify eyewear combinations. |
| Legacy shades | Unverified | Preserve decode; capture and rebuild separated lenses/bridge if retained. |
| Big brows | Warn | Curve/seat closer to forehead and verify every eyewear combination. |
| Moustache | Warn | Add center join and tapered/upturned ends. |
| Beard | Critical fail | Replace flat shards with a jaw-hugging shell/tufts and a clean mouth opening. |
| Goatee | Critical fail | Shorten and attach below the lip/chin with rounded tapered tufts. |
| Freckles | Fail | Replace raised balls with tiny shallow cheek marks. |
| War paint | Fail | Use separated cheek stripes with a clear nose gap. |
| Face mask | Warn/fail | Curve around cheeks, add shallow pleats, and seat loops at ears. |

### Eyewear

| Item | Verdict | Required change |
|---|---|---|
| None | Pass | Retain. |
| Round | Warn | Use transparent/tinted lenses, slightly reduce size, and close bridge gaps. |
| Square | Warn | Remove excess forward offset and use transparent lenses. |
| Goggles | Critical fail | Build one curved ski-goggle lens, hollow rim, and fitted continuous strap. |
| Aviators | Fail | Align rim and lens outlines; replace opaque jagged polygons with tinted lenses. |
| Visor band | Critical fail | Replace opaque wedge with a curved translucent shield and connected temples. |

## Tops and outer layers — all selectable states

| Item | Verdict | Required change |
|---|---|---|
| Top: None | Conditional pass | Bare state works; retain and certify animation views. |
| T-shirt | Unverified blockout | Connect shoulders/sleeves; add cuff/seam structure. |
| Tank top | Fail risk | Rebuild on torso profile with shaped armholes and continuous neckline. |
| Stripes | Marginal fail | Continue stripes intentionally across sleeves or create a deliberate boundary. |
| Hoodie | Pass after remediation | Hollow folded hood, pocket opening, drawstrings and ribbing retained; reclassified as Outer layer so it can cover a T-shirt, with legacy saved runners migrated. |
| Jersey | Fail risk | Continue repeated sleeve hoops and add real polo collar/placket. |
| Overalls | Fail, immediate defect fixed | Lower half now always renders, selected pants no longer stack through it, and fake shoulder sleeves are removed; still needs visual certification. |
| Turtleneck | Fail fidelity | Add knit response, body ribbing, and sculpted rolled collar. |
| Racer | Weak | Add panel seams, neckline/cuffs, and side/rear stripe continuation. |
| Outer: None | Pass | Retain. |
| Jacket | Fail fidelity | Add actual pockets, zipper/placket, seams, and lapel depth. |
| Puffer | Fail, first correction applied | Rounded baffle volumes now replace painted seam lines; still needs split panels, zipper hardware, materials, and rendered review. |
| Vest | Fail, first correction applied | Rounded baffles now present; still needs shaped armholes/front panels/materials. |
| Poncho | Fail risk | Add arm openings, drape folds, and a hollow hood. |
| Harness | Pass after remediation | Straps sit proud of the torso and retain the selected striped/T-shirt underlayer instead of deleting it. |
| Scarf | Fail | Use curved/tapered knit tails and individual fringe strands. |

## Legs, feet, and back — all selectable states

### Legs

| Item | Verdict | Required change |
|---|---|---|
| None | Conditional pass | Bare legs work; retain and certify animation views. |
| Shorts | Fail | Build one coherent waist; add drawstring/pocket/hem cues. |
| Joggers | Fail | Add promised drawstring, fuller silhouette, knee break, and gathered ankles. |
| Jeans | Fail | Add front/rear denim construction, pockets, fly/yoke, and topstitching. |
| Cargo pants | Fail, waist color fixed | Add pocket volume, waist/fly cues, and proper trouser shaping. |
| Knee pads | Fail | Enlarge/project pad shells and separate hard pads from straps. |
| Kilt | Fail, taper fixed | Hem now flares correctly; carry pleats around sides/rear and certify motion. |
| Tights | Weak | Add side seams/paneling so same-body colors still read as a garment. |

### Feet

| Item | Verdict | Required change |
|---|---|---|
| None | Pass after remediation | One lofted heel-to-toe foot with raised instep and a tapered ankle bridge now intersects the calf cleanly; pass-8 front/profile evidence retained. |
| High-tops | Fail | Add tongue, lace crossings, quarter panels, and rubber outsole. |
| Boots | Fail | Replace stock sneaker layering with one complete boot and tread. |
| Sandals | Fail | Refine foot outline/bed thickness and seat readable straps. |
| Cleats | Fail identity | Add visible outsole/heel profile and larger readable studs. |
| Skates | Fail fidelity | Add trucks, axles, toe stop, laces, heel structure, and rubber wheels. |
| Long socks | Critical fail, immediate defect fixed | Stock shoe is now hidden and a sock-colored rounded foot is authored; still needs retained render proof. |

### Back

| Item | Verdict | Required change |
|---|---|---|
| None | Conditional pass | Stock straps hidden correctly. |
| Daypack | Weak | Add zipper/piping and visible strap-to-pack attachments. |
| Bedroll | Fail risk | Add a carrier frame/ties that visibly attach it to the runner. |
| Jetpack | Fail | Rebuild hard-surface tanks/body, nozzle rings, harness, and material response. |
| Cape | Fail, strap leakage fixed | Add thickness, curvature, folds, hem roll, and cape-specific neck attachment. |
| Wings | Fail, strap leakage fixed | Add thickness, frame/veins, articulation, and a dedicated back mount. |

Stock backpack straps now appear only with Daypack; they no longer leak onto Bedroll, Jetpack, Cape, or Wings.

## Held items — every state, multi-angle review

| Item | Verdict | Required change |
|---|---|---|
| Empty hand | Pass | Retain. |
| Flag | Fail/medium | Increase cloth wave/asymmetry, reduce dotted seam noise, separate pole/material. |
| Torch | Fail/medium | Build a recognizable two-lobe flame with warm emissive core and clearer bowl/handle. |
| Umbrella | Pass/low | Move slightly outward so profile is less body-occluded. |
| Baguette | Pass | Retain; preview scaling must stay stable. |
| Plunger | Pass | Retain. |
| Balloon | Fail/high | Rotation-safe radial preview framing is now implemented; retain evidence proving profile/rear stay in frame. |
| Trophy | Pass | Retain. |

## Priority order

1. Critical rebuilds: Locs, Helmet, Cowboy hat, Beret, Visor band, Beard, Goatee, Goggles, Aviators.
2. Rebuild the remaining floating/primitive hair family into connected sculpted silhouettes.
3. Add transparent lens/glass roles and cloth/knit/denim/leather/rubber/plastic/metal material families.
4. Apply one shared manual/Randomize compatibility system with visible feedback; never leave a selected chip silently hidden.
5. Finish torso/legs/feet/back item geometry in the per-item order above.
6. Build a retained automated review sheet for every selectable choice: front, rear, both profiles, idle, run, jump, failure, victory, and representative cross-slot combinations.
7. Re-run adversarial review against those current rendered sheets. Automated geometry tests remain necessary but cannot sign off the art.

## Immediate corrections made during this review

- Restored all 20 colors to every picker and shared-code validation path.
- Added an invariant ink silhouette instead of restricting pale colors.
- Deepened/recolored the pants waist bridge to close the groin/waist bar.
- Fixed Long socks stock-shoe leakage.
- Fixed Overalls losing their lower half and fake shoulder sleeves.
- Limited stock backpack straps to Daypack.
- Added true padded baffle volumes to Puffer/Vest.
- Corrected the Kilt's inverted taper.
- Made preview framing rotation-safe for long held props.
- Corrected the picker copy from nine to ten slots.
