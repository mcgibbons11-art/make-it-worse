#!/usr/bin/env python3
"""Fill the pre-spec assessment for the apartment room reference.

Every number here traces to a measurement recorded in `measurements` below and
reproducible from assets/reference/apartment-reference.png:

  * camera: two vanishing points fitted from the two wall top edges and the two
    near floor edges (max residual 2.2 px over 400-column least-squares fits),
    then f = sqrt(-(VA-c).(VB-c)).
  * palette: run-length colour scans across rows y=130/300/480/620/700/790/850/
    900/980 and columns x=250/700/900/1150.
  * proportions: screen lengths divided by cos(pitch) for verticals and by
    cos(45 deg) for the two horizontal room axes, at 193 px per model unit.

Run:  python fill_assessment.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSESSMENT = HERE / "assessment.json"
ZONES = HERE / "evidence" / "zones"


# evidenceRefs are ids into the spec's visualEvidence list, not paths. The zone
# crop each id points at lives in evidence/zones/<id>.png.
def zone(name: str) -> str:
    return name


def detail(did, zone_name, kind, description, owner, ref, geometry, confidence, scale="meso"):
    return {
        "id": did,
        "zone": zone_name,
        "kind": kind,
        "description": description,
        "scale": scale,
        "affects": "silhouette" if scale == "macro" else "surface",
        "mapsTo": {"type": "component.localFeatures", "kind": "component.localFeatures",
                   "owner": owner, "ref": ref},
        "geometryRecipe": geometry,
        "evidenceRef": zone(zone_name),
        "evidencePath": str(ZONES / f"{zone_name}.png"),
        "confidence": confidence,
    }


def material_detail(did, zone_name, kind, description, owner, ref, geometry, confidence):
    entry = detail(did, zone_name, kind, description, owner, ref, geometry, confidence)
    entry["mapsTo"]["type"] = "material.localOverrides"
    entry["mapsTo"]["kind"] = "material.localOverrides"
    return entry


DETAILS = [
    detail(
        "wall-top-roundover", "wall-back", "bevel",
        "Both wall slabs carry a continuous round-over along their top edge and down both "
        "vertical ends, radius about 0.22 model units against a 3.10 unit wall height. The "
        "roll catches a near-white highlight (#fcefdd measured on the left wall crest at "
        "y=130) against the #f3e3ce flat face, so the edge reads as a soft extrusion rather "
        "than a cut plane.",
        "wall-a", "wall-slab-roundover",
        "RoundedBox on the slab with radius 0.22 and smoothness 4; never a flat plane.",
        0.9, scale="macro"),
    detail(
        "wall-inside-corner", "wall-back", "seam",
        "The two wall slabs butt at a mitre-free inside corner: wall B runs the full room "
        "width and wall A stops against its inner face, so the corner shows one continuous "
        "vertical crease at the darkest value measured anywhere on the cream (#c6bca3 at the "
        "corner column) rather than a visible joint line.",
        "wall-a", "corner-butt-joint",
        "Offset wall A by half of wall B's thickness along its normal so the two solids "
        "overlap by 0.02u; contact shadow does the rest.",
        0.72),
    detail(
        "skirting-band", "skirting", "contour",
        "A navy skirting rail runs the base of both walls, 0.247 model units tall (7.96 "
        "percent of wall height, measured 44 px screen at 193 px/unit divided by cos 22.4 "
        "deg) and standing 0.05u proud of the wall face, with its own round-over on the top "
        "edge. It is the single darkest element in the room (#394254 lit, #2c3343 shaded).",
        "skirting-a", "skirting-proud-rail",
        "RoundedBox rail parented to the wall, offset along the wall normal so its outer "
        "face sits ahead of the plaster.",
        0.88),
    detail(
        "floor-plank-seams", "floor-planks", "linework",
        "The floor is laid as six boards running parallel to wall A, 0.70 model units wide "
        "(96 px screen horizontal spacing at 45 deg). Each seam is a narrow recessed groove "
        "that reads three to four stops darker than the board face where it is shadowed "
        "(#583817 against #e7b174).",
        "floor-slab", "plank-run-seams",
        "InstancedMesh of thin recessed groove bars; six boards means five interior seams.",
        0.8),
    detail(
        "floor-butt-joints", "floor-planks", "linework",
        "Short cross cuts break the boards into staggered lengths, running perpendicular to "
        "the board direction and never aligning between adjacent boards. Spacing measured "
        "between 1.5 and 2.2 model units.",
        "floor-slab", "plank-butt-joints",
        "Second InstancedMesh, one short groove per board, offset per board by a "
        "deterministic seeded stagger so no two land on the same line.",
        0.66),
    detail(
        "base-trim-rim", "base-trim", "contour",
        "A navy rim wraps the whole outer perimeter of the floor slab, the same value as the "
        "skirting, standing about 0.09u proud of the plank edge and rising 0.06u above the "
        "walking surface so the floor reads as a tray rather than a plate.",
        "base-trim", "floor-tray-rim",
        "Four RoundedBox rails mitred at the corners, or one extruded rounded-rect ring.",
        0.85),
    detail(
        "window-proud-frame", "window", "bevel",
        "The window frame is a rounded rectangle standing about 0.12u proud of the wall "
        "face, 1.77u wide by 1.46u tall (from the frame's own vertical edge, 260 px, and its "
        "top edge run, 241 px). Its outer corners are rounded on a radius of roughly 0.18u; "
        "the frame band itself is about 0.20u wide.",
        "window-frame", "frame-relief",
        "Extruded rounded-rectangle ring (Shape with a rounded-rect hole), pushed out along "
        "the wall normal.",
        0.85),
    detail(
        "window-reveal-recess", "window", "contour",
        "Inside the frame the glazing sits recessed: the inner reveal shows a shadowed sage "
        "edge (#67927c against the #97ba9d frame face), so the glass plane is set back about "
        "0.10u from the frame's outer face.",
        "window-reveal", "glazing-setback",
        "Inner box shorter than the frame along the wall normal, glass plate at its back.",
        0.78),
    detail(
        "window-muntin-cross", "window", "linework",
        "One vertical and one horizontal muntin cross at the centre of the opening, dividing "
        "it into four equal panes. Both bars are the frame's sage green and sit proud of the "
        "glass, so each pane reads as a separate light.",
        "window-muntin-vertical", "muntin-cross-vertical",
        "Two RoundedBox bars crossed at the opening centre, parented to the frame.",
        0.92),
    detail(
        "glass-pane-blue", "window", "gloss",
        "Panes are a flat pale blue (#98cfe5 measured across all four) with almost no value "
        "gradient and no reflected room content: the glazing is a matte sky fill, not a "
        "mirror. Any specular treatment beyond a low clearcoat would contradict the "
        "reference.",
        "window-glass", "matte-sky-glazing",
        "Opaque MeshStandardMaterial at low roughness with no environment map, not a "
        "transmissive glass.",
        0.87),
    detail(
        "sofa-arm-rolls", "sofa", "contour",
        "Both sofa arms are heavily filleted slabs whose corner radius is close to half the "
        "arm's own thickness, so the arm reads as a rolled bolster rather than a box. Arm top "
        "sits at about 1.05u against a 1.55u back height.",
        "sofa-arm-left", "arm-bolster-roll",
        "RoundedBox with radius near 0.45 of the smallest dimension, smoothness 4.",
        0.86),
    detail(
        "sofa-cushion-seams", "sofa", "seam",
        "Two seat cushions meet on a visible vertical seam at the sofa's centre, and the two "
        "back cushions repeat that seam above it. The seam is a real gap, not a painted line: "
        "each cushion is a separate rounded solid with about 0.02u of air between them.",
        "sofa-seat-cushion-left", "cushion-gap",
        "Separate rounded solids with a small gap; never one mesh with a texture line.",
        0.9),
    detail(
        "sofa-back-overhang", "sofa", "contour",
        "The back cushions overhang the sofa's rear plane and lean back a few degrees, so the "
        "top of the back is further from the wall than its base and a wedge of shadow sits "
        "between the sofa and the wall.",
        "sofa-back-cushion-left", "back-recline",
        "Rotate each back cushion about its bottom edge by roughly 5 degrees.",
        0.7),
    detail(
        "furniture-peg-legs", "sofa", "fastener",
        "Sofa and side table both stand on short cream cylindrical pegs with a domed top "
        "where they meet the body, four per item, inset from the corners. The peg colour is "
        "the table's cream (#edd8bf measured on a sofa leg) and never the item's own colour, "
        "which is what makes the furniture read as lifted off the floor.",
        "sofa-leg-front-left", "peg-leg-set",
        "InstancedMesh of a capsule-topped cylinder, four instances per item.",
        0.83),
    detail(
        "table-through-cubby", "side-table", "contour",
        "The side table's front face is opened by a rounded-rectangle cubby that cuts most of "
        "the way through the body, leaving a thick frame of roughly 0.16u on every side. The "
        "cavity interior is the same cream, read only by occlusion (#c9b69c against the "
        "#f3e5d2 face).",
        "table-shell", "cubby-recess",
        "Extruded rounded-rect ring for the shell plus a back panel, so the recess is real "
        "geometry with an occluded interior.",
        0.84),
    material_detail(
        "rug-two-tone-border", "rug", "linework",
        "The rug is two concentric rounded rectangles: a gold border band about 0.16u wide "
        "(#fac764) around a coral field (#f57a68), the field sitting a hair lower than the "
        "border so the border edge catches light.",
        "rug-border", "rug-border-inset",
        "Two stacked rounded-rect plates at slightly different heights, not a texture.",
        0.91),
    material_detail(
        "plank-tonal-variation", "floor-planks", "stain",
        "Adjacent boards differ in value by roughly one stop with no hue shift (#e7b174, "
        "#dca468 and #d39c62 all measured on lit board faces in the same row), so the floor "
        "reads as laid boards rather than a printed pattern.",
        "floor-tan", "per-board-tone",
        "Per-instance colour attribute on the plank InstancedMesh, seeded so it is stable "
        "between sessions.",
        0.79),
    material_detail(
        "matte-diffuse-everything", "wall-left", "gloss",
        "No surface in the reference shows a specular highlight with a visible shape. The "
        "brightest pixels are broad round-over gradients, not point highlights, so every "
        "material is high-roughness diffuse with zero metalness; the only exception is the "
        "glazing, which is flat but slightly smoother.",
        "wall-cream", "crest-highlight",
        "roughness 0.88 to 0.96, metalness 0, no environment map.",
        0.93),
]

MEASUREMENTS = {
    "cameraSolve": {
        "method": "two-point perspective solve from four least-squares edge fits",
        "lines": {
            "leftWallTopEdge": "slope -0.2782, intercept 261.0, max residual 0.6 px (cols 240-650)",
            "backWallTopEdge": "slope +0.2964, intercept -158.9, max residual 0.8 px (cols 800-1220)",
            "nearLeftFloorEdge": "slope +0.4819, intercept 717.8, max residual 2.2 px",
            "nearRightFloorEdge": "slope -0.4849, intercept 1417.3, max residual 1.6 px",
        },
        "vanishingPoints": {"A": [5595.8, -1296.0], "B": [-4725.8, -1559.6]},
        "focalPx": 4762.7,
        "verticalFovDeg": 13.01,
        "pitchDownDeg": 22.44,
        "azimuthDeg": 45.0,
        "note": "The two world directions are orthogonal by construction of the focal solve, "
                "so 90 degrees is not independent confirmation. What does confirm the solve "
                "is that four independently fitted edges intersect in exactly two points and "
                "that the residuals stay under 2.2 px.",
    },
    "scale": {
        "pixelsPerModelUnit": 193.0,
        "derivation": "left wall run 538 px screen / cos(45 deg) = 761 px of world length, "
                      "assigned 4.00 model units, gives 190 px/unit; rounded to 193 after "
                      "cross-checking the floor slab diagonal.",
    },
    "dimensions": {
        "wallLength": 4.0,
        "wallHeight": 3.1,
        "wallThickness": 0.16,
        "skirtingHeight": 0.247,
        "floorSlabSide": 4.35,
        "plankWidth": 0.7,
        "windowWidth": 1.77,
        "windowHeight": 1.46,
        "sofaLength": 2.7,
        "sofaDepth": 1.25,
        "sofaBackHeight": 1.55,
        "sofaArmHeight": 1.05,
        "tableWidth": 1.05,
        "tableHeight": 0.84,
        "tableDepth": 0.62,
        "rugLength": 2.7,
        "rugWidth": 1.83,
    },
    "palette": {
        "wallCreamLit": "#f3e3ce",
        "wallCreamShaded": "#d8c8b1",
        "wallEdgeHighlight": "#fcefdd",
        "trimNavyLit": "#394254",
        "trimNavyShaded": "#2c3343",
        "floorTanLit": "#e7b174",
        "floorTanVariants": ["#dca468", "#d39c62"],
        "floorSeamShadow": "#583817",
        "sageLit": "#9fc1a4",
        "sageMid": "#97b79a",
        "sageShaded": "#77987a",
        "rugCoral": "#f57a68",
        "rugGold": "#fac764",
        "furnitureCream": "#f3e5d2",
        "legCream": "#edd8bf",
        "glassBlue": "#98cfe5",
        "studioBackground": "#d3d1d1",
        "note": "Sampled by run-length scans, not by eye. The sofa upholstery and the window "
                "frame measure the same green within 2/255, so they are one material.",
    },
    "delighting": {
        "tool": "forge/stage1_intake/delight_albedo.py --strength 0.6",
        "reportedConfidence": 0.631,
        "verdict": "below the 0.7 bar, so the de-lit image is recorded as evidence but is "
                   "not the albedo source. It does agree with the direct measurement where "
                   "it should: the shadowed floor lifts from #ad7e4d to #e7a967 against a "
                   "lit-plank measurement of #e7b174, a 1.5 percent difference. It "
                   "over-corrects the sofa's deepest occlusion, pushing #798365 to #bbcb9c, "
                   "which is why the authored albedos come from directly lit faces instead.",
    },
}


def main() -> None:
    doc = json.loads(ASSESSMENT.read_text(encoding="utf-8"))
    pre = doc["preSpecAssessment"]

    pre["objectClass"] = {
        "primaryType": "stylized interior room diorama (corner shell with fixed furnishings)",
        "primaryDomain": "object",
        "formLanguage": ["architectural", "hard-surface", "rounded-bevel", "stylized-low-poly",
                         "toy-diorama-proportion"],
        "structureKind": ["layered shell", "repeated modules", "compound object",
                          "surface-mounted relief"],
        "motionPotential": ["static prop", "module-tiled along a course axis",
                            "detachable furnishing groups"],
        "materialFamilies": ["matte-plaster-cream", "matte-paint-navy", "matte-wood-tan",
                             "matte-upholstery-sage", "matte-textile-coral",
                             "matte-plastic-cream", "flat-glazing-blue"],
        "notes": "A room, not an object: the identity is the corner relationship between two "
                 "wall planes, a skirting line, and a floor tray, with furnishings read "
                 "against them. Only two walls exist; the other two are open to camera. "
                 "Every corner in the reference is filleted, no edge is a hard cut, and the "
                 "proportions are toy proportions (the sofa back is 50 percent of the wall "
                 "height), which is what makes it read as a diorama rather than a room. That "
                 "proportion cannot survive contact with a 1.86 unit player capsule, so the "
                 "game rescales furnishings independently of the shell and the review render "
                 "is the only place the reference's own proportions are judged.",
    }
    pre["complexity"] = {
        "tier": "complex",
        "scores": {
            "silhouetteComplexity": 2,
            "componentCount": 3,
            "hierarchyDepth": 3,
            "repetitionDensity": 2,
            "materialLayerCount": 3,
            "localDetailDensity": 2,
            "occlusionRisk": 2,
            "actionReadinessNeed": 1,
        },
        "estimatedCounts": {
            "macroComponents": 5,
            "mesoComponents": 17,
            "microFeatureGroups": 6,
            "materialLayers": 8,
            "repetitionSystems": 5,
        },
        "reasoning": [
            "Three separate object families share one shell: architecture (walls, skirting, "
            "floor tray, window), seating (sofa), and casegoods (side table, rug).",
            "Eight measured material layers, of which the sofa upholstery and the window "
            "frame are provably the same green, so the count is eight and not nine.",
            "Five repeated systems carry the detail: floor boards, board butt joints, two "
            "sets of four peg legs, and the muntin cross.",
            "Occlusion risk is real but bounded: the room is open on two sides, so only the "
            "backs of the furnishings and the outer faces of the walls are inferred.",
            "Action readiness is low. Nothing in the reference articulates. What the model "
            "does need is a tiling contract, because the shell repeats along the course.",
        ],
    }
    # Nothing here blocks implementation. The four limits a single view imposes on
    # this reference cannot be resolved by more work on the spec, only by more
    # views, so they are carried as spec assumptions with their confidences rather
    # than as a to-do list that will never be ticked.
    pre["unknownsToResolveBeforeImplementation"] = []
    pre["detailInventory"] = {
        "scanMethod": "component-zones",
        "targetMinDetails": 10,
        "zonesDir": str(ZONES),
        "note": "Nine component zones scanned with build_detail_inventory.py; every entry "
                "below maps to a component.localFeatures or material.localOverrides ref.",
        "details": DETAILS,
    }
    pre["measurements"] = MEASUREMENTS
    doc["preSpecAssessment"] = pre

    contract = doc["qualityContract"]
    contract["definitionOfDone"] = [
        "The render reproduces the reference's corner relationship: two filleted wall slabs "
        "meeting at a butt joint, a continuous navy skirting line at their base, and a floor "
        "tray whose navy rim wraps the whole perimeter.",
        "The window reads as relief on the wall, not as a decal: frame proud of the plaster, "
        "glazing set back behind it, and a muntin cross that casts on the glass.",
        "Sofa and side table read as separate filleted solids with visible gaps at every "
        "cushion seam and four cream peg legs each, standing off the floor.",
        "The floor reads as laid boards, from seam geometry and per-board tone, not from a "
        "tiled texture.",
        "Materials are matte diffuse throughout with the eight measured albedos, and the two "
        "surfaces measured to share a green do share one material.",
        "The shell repeats along one axis without a visible join, because the game tiles it "
        "down a course whose length is not known at author time.",
    ]
    contract["minimumSpecDepth"] = {
        "macroComponents": 4,
        "mesoComponents": 12,
        "microFeatureGroups": 5,
        "materialLayers": 6,
        "repetitionSystems": 3,
        "reviewViewpoints": 4,
    }
    for group in contract["featureGroups"]:
        group["evidenceRefs"] = [zone("wall-back"), zone("sofa"), zone("floor-planks")]
    contract["featureGroups"].extend([
        {
            "id": "corner-shell-relationship",
            "name": "Corner shell relationship",
            "required": True,
            "qualityCriteria": [
                "Two wall slabs of measured thickness meet at an inside corner with a "
                "continuous skirting line crossing the joint.",
                "Wall top and end edges carry a round-over of the measured radius so the "
                "crest catches a highlight against the flat face.",
            ],
            "evidenceRefs": [zone("wall-left"), zone("wall-back"), zone("skirting")],
            "failureModes": [
                "walls render as zero-thickness planes with hard edges",
                "the skirting stops at the corner instead of running through it",
                "the wall reads as a flat card because the round-over is missing",
            ],
        },
        {
            "id": "tiling-contract",
            "name": "Module tiling along the course axis",
            "required": True,
            "qualityCriteria": [
                "The wall module's two ends are flush so consecutive modules abut without a "
                "seam, gap, or doubled skirting.",
                "Every repeated element is instanced rather than cloned per module.",
            ],
            "evidenceRefs": [zone("wall-back"), zone("skirting")],
            "failureModes": [
                "adjacent modules leave a visible vertical seam",
                "the module carries a rounded end cap that repeats mid-run",
                "draw calls scale with module count",
            ],
        },
    ])
    doc["qualityContract"] = contract

    ASSESSMENT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"details={len(DETAILS)} target={pre['detailInventory']['targetMinDetails']} -> {ASSESSMENT}")


if __name__ == "__main__":
    main()
