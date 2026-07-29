#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment soap dish.

Every dimension is derived from measurements of assets/reference/soap-reference.png
made with measure_reference.py and the row/column colour scans recorded in
`measurementBasis`, so a later session can re-check them.

Run:  python author_soap_spec.py
Writes: soap-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math

from spec_lib import (
    HERE, PROJECT, action, action_readiness, assemble, build_passes, colours, component,
    descriptor, detail, detail_inventory, dims, feature, feature_group, material, override,
    profile, quality_contract, stadium_polygon, surface, write_spec, xform,
)

PROP = "soap"
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "soap-reference.png")
OUT = HERE / "soap-sculpt-spec.json"
EVIDENCE = "full-object"

# ---------------------------------------------------------------------------
# Measured geometry.
#
# Silhouette box x[80,1011] y[378,1035] of a 1086x1448 image: 932 wide by 658 tall.
# The extreme points are leftmost (80,679), rightmost (1011,614), topmost (631,378) and
# bottommost (421,1035). The left-to-right line falls 65 px over 931, so the dish's long
# axis is 4 degrees off screen horizontal: the view is essentially down the short axis and
# the plan rotation is modelled as zero.
#
# Screen quantities, all read from the row and column scans:
#   projected length                       L         = 932 px
#   projected height                       W sin(e) + Ho cos(e) = 658 px
#   far rim band (wall top face only)      t sin(e)  = 47 px  (col 545: 388..435)
#   near rim band (top face + outer wall)  t sin(e) + Ho cos(e) = 146 px (col 545: 876..1021)
#   opening between the inner rim edges    (W - 2t) sin(e) = 441 px (col 545: 435..876)
#
# Those give W sin(e) = 560, Ho cos(e) = 91 and t sin(e) = 55 (the mean of the 47 measured
# off-axis and the 59.5 implied by the opening). Elevation cannot be separated from the
# plan aspect by one view, so it is set at 58 degrees and refined by a camera sweep scored
# on Tier-1 silhouette IoU, which is recorded in referenceCamera.
# ---------------------------------------------------------------------------
ELEVATION_DEG = 58.0
SIN_E = math.sin(math.radians(ELEVATION_DEG))
COS_E = math.cos(math.radians(ELEVATION_DEG))

PX_LENGTH = 932.0
# The dish has no collider: the soap slick is a distance trigger and the dish is dressing.
# The long axis is set to 0.70 world units, the width the hand-authored dish it replaces
# occupied, so the level's read of the slick does not change.
LENGTH = 0.70
PX_PER_UNIT = PX_LENGTH / LENGTH                      # 1331.4 px per world unit

WIDTH = round(560.0 / SIN_E / PX_PER_UNIT, 4)         # 0.496
HEIGHT = round(91.0 / COS_E / PX_PER_UNIT, 4)         # 0.129
WALL_T = round(55.0 / SIN_E / PX_PER_UNIT, 4)         # 0.049
# The interior floor is not measurable: the bar covers it. Set so the recess is deep
# enough to hold the bar's lower third, which is what the reference's shadow line implies.
FLOOR_H = round(HEIGHT * 0.45, 4)
RECESS_DEPTH = round(HEIGHT - FLOOR_H, 4)

INNER_LENGTH = round(LENGTH - 2 * WALL_T, 4)
INNER_WIDTH = round(WIDTH - 2 * WALL_T, 4)

# Bar. Row 660 puts its projected length at 682 px; column 545 puts its projected height
# at 436 px, which is bar width * sin(e) + bar height * cos(e).
BAR_LENGTH = round(682.0 / PX_PER_UNIT, 4)            # 0.512
BAR_WIDTH = round(0.62 * WIDTH, 4)
BAR_HEIGHT = round((436.0 - BAR_WIDTH * PX_PER_UNIT * SIN_E) / COS_E / PX_PER_UNIT, 4)
BAR_LIFT = FLOOR_H - 0.006                            # buried in the floor, no floating gap

SIDES = 28

DISH_BLUE = "#3C8AD6"
BAR_CREAM = "#FBF3E4"

# Rounded moulded edges. The reference dish has no hard crease anywhere: its outer wall
# rolls over at the top and tucks under at the bottom, which is a bevel at both ends of the
# extrusion rather than a chamfer.
RIM_ROLL = round(WALL_T * 0.55, 4)
BAR_ROLL_STOPS = 6


def bevel_both_ends(half_x: float, half_y: float, inset: float, lo: float, hi: float, rings: int):
    """profileStops that roll the plan inward at BOTH ends of the extrusion over `rings`
    samples, so a slab reads as a moulded part with a soft edge instead of a prism with a
    chamfer. A quarter-cosine easing keeps the crown tangent to the extrusion axis."""
    sx = (half_x - inset) / half_x
    sy = (half_y - inset) / half_y
    stops: list[list[float]] = []
    for i in range(rings + 1):
        k = math.cos((1 - i / rings) * math.pi / 2)
        stops.append([round(lo * i / rings, 4),
                      round(sx + (1 - sx) * k, 4), round(sy + (1 - sy) * k, 4)])
    for i in range(rings + 1):
        k = math.cos((i / rings) * math.pi / 2)
        stops.append([round(hi + (1 - hi) * i / rings, 4),
                      round(sx + (1 - sx) * k, 4), round(sy + (1 - sy) * k, 4)])
    return stops


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
MATERIALS = [
    material(PROP, "dish-blue", "Dish plastic", DISH_BLUE, [DISH_BLUE, "#2A72BA", "#4E9CE6"],
             0.58, 0.09, 0.30, 0.847,
             [override("rim-crown-sheen", "dish-wall/rim-roll-over",
                       "The rolled rim crown is the brightest blue in the frame, measured at "
                       "(64,148,229) against (26,101,174) on the shaded inner wall.",
                       [EVIDENCE, "rim-zone"], roughness=0.50,
                       mask="rim crown band, the top 25 percent of the wall"),
              override("inner-wall-occlusion", "dish-wall/inner-wall",
                       "The inner wall darkens sharply toward the floor; it is the darkest blue "
                       "in the frame.",
                       [EVIDENCE, "interior-zone"], roughness=0.66, aoBoost=0.60,
                       mask="inner wall below the rim crown"),
              override("underside-shade", "dish-wall/outer-tuck",
                       "The outer wall tucks under and loses the key entirely along the bottom "
                       "silhouette.",
                       [EVIDENCE, "rim-zone"], roughness=0.64, aoBoost=0.35,
                       mask="lower third of the outer wall")],
             "Single moulded dish: wall and floor share one pigment and one finish.",
             shader_model="MeshPhysicalMaterial (matte injection-moulded polypropylene)"),
    material(PROP, "bar-cream", "Soap bar", BAR_CREAM, [BAR_CREAM, "#EFE0CB", "#FFFCF4"],
             0.48, 0.10, 0.22, 0.803,
             [override("bar-crown-sheen", "soap-bar/pillow-crown",
                       "The bar's crown reads (255,251,242), the brightest value in the frame, and "
                       "slightly smoother than its flanks: cast soap is polished by the mould.",
                       [EVIDENCE, "bar-zone"], roughness=0.40,
                       mask="upper 35 percent of the pillow"),
              override("bar-contact-shadow", "soap-bar/dish-contact",
                       "A contact shadow runs where the bar meets the dish floor and darkens the "
                       "bar's lowest band.",
                       [EVIDENCE, "interior-zone"], roughness=0.55, aoBoost=0.55,
                       mask="lowest 12 percent of the bar")],
             "Cast soap. Slightly smoother than the dish and with no colour variation of its own."),
]


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
DISH_WALL = component(
    "dish-wall", "Dish rim wall", "macro", "shell", "extrude", "dish-blue",
    "continuous-sculpt",
    "One smoothly varying moulded wall with no flat face and no crease: the reference shows the "
    "outer surface rolling continuously from the rim crown down and under, so it is a continuous "
    "form rather than an assembly of panels.",
    colours(DISH_BLUE),
    descriptor("stadium ring swept vertically, rolled inward at both the crown and the base so "
               "the section is a rounded moulded rim",
               "rolled", 0.0, 1,
               deformations=[f"crown roll inward {RIM_ROLL}", f"base tuck inward {RIM_ROLL}"],
               uv="ExtrudeGeometry cap and wall UVs; one tile per part",
               normals="welded vertices then smooth vertex normals; the reference has no crease"),
    xform(),
    dims(LENGTH, HEIGHT, WIDTH, 0.75),
    action("root", "center", (0.0, HEIGHT / 2, 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "rotate": True, "scale": True},
           sockets=[{"id": "dish-base", "localPosition": [0.0, 0.0, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Underside of the dish; sits on the floor plane."},
                    {"id": "bar-seat", "localPosition": [0.0, round(FLOOR_H, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Centre of the interior floor, where the bar rests."}],
           collider={"type": "box", "offset": [0.0, round(HEIGHT / 2, 4), 0.0],
                     "scale": [LENGTH, HEIGHT, WIDTH], "isTrigger": False,
                     "notes": "Box proxy over the dish. The soap-slick trap is a distance "
                              "trigger and adds no collider of its own."},
           fracture="dish"),
    [feature("rim-roll-over",
             f"The wall's plan rolls inward by {RIM_ROLL} units over the top of the extrusion, so "
             "the crown is a continuous curve rather than a chamfer.",
             "profileStops easing on a quarter cosine over the last sixth of the sweep",
             [EVIDENCE, "rim-zone"], 0.85),
     feature("outer-tuck",
             f"The wall tucks inward by the same {RIM_ROLL} at the base, which is why the bottom "
             "silhouette curves in rather than meeting the ground square.",
             "mirrored profileStops at the start of the sweep",
             [EVIDENCE, "rim-zone"], 0.8),
     feature("inner-wall",
             f"The opening is a stadium {INNER_LENGTH} by {INNER_WIDTH}, which is the outer plan "
             f"inset by the measured wall thickness of {WALL_T} on every side.",
             "profile2D hole sharing the outer plan's stadium construction",
             [EVIDENCE, "interior-zone"], 0.85),
     feature("stadium-plan",
             "The plan is a stadium, not an ellipse: the reference's long sides run straight for "
             "about 30 percent of the length before the end caps begin.",
             "stadium outline of a rectangle capped by two semicircles",
             [EVIDENCE], 0.75)],
    surface(0.58, 0.09, 0.0, "smooth moulded polypropylene with slight tone drift",
            "occlusion down the inner wall and under the outer tuck",
            "none - the reference dish shows no wear",
            "Matte plastic. No specular coat anywhere in the reference."),
    [EVIDENCE, "rim-zone", "interior-zone"],
    importance=1.0, confidence=0.85, parent=None, fidelity="blockout",
)
DISH_WALL["geometryDescriptor"]["profile2D"] = profile(
    stadium_polygon(LENGTH, WIDTH, SIDES), HEIGHT, axis="y", axis_offset=0.0, steps=12,
    stops=bevel_both_ends(LENGTH / 2, WIDTH / 2, RIM_ROLL, 0.16, 0.84, 3),
    holes=[stadium_polygon(INNER_LENGTH, INNER_WIDTH, SIDES)],
)
DISH_WALL["geometryDescriptor"]["profile2D"]["smoothShading"] = True

DISH_FLOOR = component(
    "dish-floor", "Dish floor", "meso", "floor", "extrude", "dish-blue",
    "assembled-solid",
    "A flat rigid plate closing the bottom of the dish; it has one visible planar face, which is "
    "why it is a plate rather than part of the sculpted wall.",
    colours(DISH_BLUE, 0.92),
    descriptor("flat stadium plate closing the dish, overlapping the wall so no gap opens at the "
               "join",
               "none", uv="ExtrudeGeometry cap UVs", normals="flat facet normals"),
    xform(),
    dims(INNER_LENGTH, FLOOR_H, INNER_WIDTH, 0.5),
    action("static", "center", (0.0, FLOOR_H / 2, 0.0), (0, 1, 0), 0.6, fracture="dish"),
    [feature("floor-plate",
             f"Closes the dish {RECESS_DEPTH} units below the rim, which is the recess depth the "
             "reference's shadow line implies.",
             "plate wider than the opening so it is buried in the wall",
             [EVIDENCE, "interior-zone"], 0.5)],
    surface(0.60, 0.08, 0.0, "matte moulded plastic", "deep occlusion where it meets the wall",
            "none", "Not directly observed: the bar covers most of it in the reference."),
    [EVIDENCE, "interior-zone"],
    importance=0.4, confidence=0.5, parent="dish-wall",
    seams=[{"id": "floor-wall-seam", "with": "dish-wall", "overlap": round(WALL_T * 0.8, 4),
            "notes": "Plate contour is buried inside the wall."}],
)
DISH_FLOOR["geometryDescriptor"]["profile2D"] = profile(
    stadium_polygon(INNER_LENGTH + WALL_T * 1.6, INNER_WIDTH + WALL_T * 1.6, SIDES), FLOOR_H,
    axis="y", axis_offset=0.0, steps=1,
)

SOAP_BAR = component(
    "soap-bar", "Soap bar", "meso", "contents", "extrude", "bar-cream",
    "continuous-sculpt",
    "One smoothly varying rounded mass with no flat face and no crease anywhere: a cast pillow, "
    "not a box with bevels.",
    colours(BAR_CREAM),
    descriptor("stadium plan swept vertically and rolled inward at both ends over most of the "
               "sweep, giving a pillow whose top and bottom are domed",
               "rolled", 0.0, 1,
               deformations=["crown dome", "base dome"],
               uv="ExtrudeGeometry cap and wall UVs",
               normals="welded vertices then smooth vertex normals"),
    xform(),
    dims(BAR_LENGTH, BAR_HEIGHT, BAR_WIDTH, 0.7),
    action("static", "socket", (0.0, round(BAR_LIFT + BAR_HEIGHT / 2, 4), 0.0), (0, 1, 0), 0.7,
           sockets=[{"id": "bar-crown",
                     "localPosition": [0.0, round(BAR_LIFT + BAR_HEIGHT, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Top of the bar; a lather or bubble effect anchors here."}],
           collider={"type": "box",
                     "offset": [0.0, round(BAR_LIFT + BAR_HEIGHT / 2, 4), 0.0],
                     "scale": [BAR_LENGTH, BAR_HEIGHT, BAR_WIDTH], "isTrigger": False,
                     "notes": "Box proxy over the bar."},
           fracture="bar", detach=["soap-bar"]),
    [feature("pillow-crown",
             f"The bar's plan rolls inward over the top {BAR_ROLL_STOPS} sweep samples so the "
             "crown is domed; the reference shows no flat top and no edge anywhere on it.",
             "profileStops easing on a quarter cosine at both ends of the extrusion",
             [EVIDENCE, "bar-zone"], 0.85),
     feature("dish-contact",
             f"The bar is buried {round(FLOOR_H - BAR_LIFT, 4)} units into the dish floor so no "
             "gap can open under it, and it stands "
             f"{round(BAR_LIFT + BAR_HEIGHT - HEIGHT, 4)} units above the rim, which is what the "
             "reference shows.",
             "component position, not geometry",
             [EVIDENCE, "interior-zone"], 0.8),
     feature("bar-proportion",
             f"The bar is {BAR_LENGTH} by {BAR_WIDTH} by {BAR_HEIGHT}, which is 85 percent of the "
             "interior length: the reference bar nearly fills the dish.",
             "stadium plan scaled from the measured projected extents",
             [EVIDENCE, "bar-zone"], 0.75)],
    surface(0.48, 0.10, 0.0, "smooth cast soap", "contact shadow at the dish floor", "none",
            "The brightest and smoothest surface in the frame."),
    [EVIDENCE, "bar-zone"],
    importance=0.9, confidence=0.8, parent="dish-wall",
    seams=[{"id": "bar-floor-seam", "with": "dish-floor", "overlap": round(FLOOR_H - BAR_LIFT, 4),
            "notes": "Bar base is buried in the floor plate."}],
    fidelity="blockout",
)
SOAP_BAR["geometryDescriptor"]["profile2D"] = profile(
    stadium_polygon(BAR_LENGTH, BAR_WIDTH, SIDES), BAR_HEIGHT, axis="y", axis_offset=BAR_LIFT,
    steps=14, stops=bevel_both_ends(BAR_LENGTH / 2, BAR_WIDTH / 2, BAR_WIDTH * 0.30, 0.42, 0.58,
                                    BAR_ROLL_STOPS),
)
SOAP_BAR["geometryDescriptor"]["profile2D"]["smoothShading"] = True

COMPONENTS = [DISH_WALL, DISH_FLOOR, SOAP_BAR]
ALL_REFS = [c["id"] for c in COMPONENTS]

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
MATERIAL_IDS = {m["id"] for m in MATERIALS}
DETAILS = [
    detail("rim-roll", "rim", "bevel",
           f"The dish wall rolls inward {RIM_ROLL} units over its crown with no crease, so the rim "
           "reads as a continuous moulded curve.",
           "dish-wall/rim-roll-over",
           "profileStops on a quarter cosine plus welded vertices before normal generation.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("base-tuck", "base", "contour",
           "The outer wall tucks back in at the base by the same amount, which is why the bottom "
           "silhouette curves inward instead of meeting the ground square.",
           "dish-wall/outer-tuck",
           "Mirrored profileStops at the start of the sweep.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("stadium-plan", "plan", "contour",
           "The plan is a stadium: the long sides run straight for about 30 percent of the length "
           "before the semicircular caps begin. An ellipse would bow those sides.",
           "dish-wall/stadium-plan",
           "Rectangle capped by two semicircles, sampled at 28 sides.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("wall-thickness", "rim", "contour",
           f"The wall is {WALL_T} units thick, measured from the 441 pixel opening against the 560 "
           "pixel outer width at the solved elevation.",
           "dish-wall/inner-wall",
           "profile2D hole inset from the outer plan.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("bar-pillow", "bar", "contour",
           "The bar is domed at both ends with no flat face and no edge; it is a cast pillow.",
           "soap-bar/pillow-crown",
           "Symmetric profileStops rolling the plan inward at both ends of the extrusion.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("bar-stands-proud", "bar", "contour",
           f"The bar rises {round(BAR_LIFT + BAR_HEIGHT - HEIGHT, 4)} units above the rim, which is "
           "what makes the dish read as full rather than empty.",
           "soap-bar/dish-contact",
           "Component position derived from the measured projected heights.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("rim-crown-sheen", "rim", "gloss",
           "The rim crown is the brightest blue in the frame, measured at (64,148,229) against "
           "(26,101,174) on the shaded inner wall.",
           "dish-blue/rim-crown-sheen",
           "Material local override lowering roughness on the crown band.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("interior-occlusion", "interior", "stain",
           "The inner wall darkens sharply toward the floor and carries the darkest blue in the "
           "frame.",
           "dish-blue/inner-wall-occlusion",
           "Material local override with an AO boost on the inner wall.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("bar-contact-shadow", "interior", "seam",
           "A contact shadow runs where the bar meets the dish floor.",
           "bar-cream/bar-contact-shadow",
           "Material local override raising AO on the bar's lowest band.",
           EVIDENCE, 0.7, MATERIAL_IDS),
]

DETAIL_INVENTORY = detail_inventory(
    DETAILS, 6,
    "component-zone scan of the reference at 3x, with colour-run scans along rows 480, 560, 660, "
    "760, 860 and 950 and columns 250, 400, 545, 700 and 880 to place the rim bands, the opening "
    "and the bar in pixels before converting to world units.")

# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
PASSES = build_passes(
    ["dish-wall", "soap-bar"], ALL_REFS,
    "Match the macro silhouette: a stadium dish of the measured plan with the bar standing proud "
    "of its rim.",
    "Build the wall, the floor plate and the bar as separate named parts with recorded seams.",
    "Deliver the rim roll, the base tuck and the bar's double dome as real profile deformations.",
    "Match the two-layer palette and the matte moulded-plastic response.",
    ["The rim crown and the base tuck read as continuous curves, with no chamfer facet anywhere.",
     "The bar reads as a pillow with no flat top.",
     "The opening's inner edge sits at the measured wall thickness on every side."],
    has_repetition=False)

FEATURE_REVIEW_TARGETS = [
    {"id": "stadium-plan-and-proportion", "name": "Stadium plan and dish proportions",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["dish-wall"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["plan reads as an ellipse with bowed sides", "dish too deep or too shallow",
                      "opening inset by the wrong wall thickness"]},
    {"id": "rim-roll-continuity", "name": "Rolled rim with no crease",
     "tier": "critical", "passIds": ["form-refinement", "surface-pass", "lighting-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["dish-wall"], "evidenceRefs": [EVIDENCE, "rim-zone"],
     "failureModes": ["rim reads as a chamfer or a hard edge", "wall facets visibly",
                      "crown and outer wall shade as separate surfaces"]},
    {"id": "bar-pillow-form", "name": "Soap bar as a cast pillow",
     "tier": "critical", "passIds": ["blockout", "form-refinement", "surface-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["soap-bar"], "evidenceRefs": [EVIDENCE, "bar-zone"],
     "failureModes": ["bar reads as a rounded box", "flat top", "bar sits below the rim"]},
    {"id": "two-tone-palette", "name": "Blue dish against cream bar",
     "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["dish-wall", "soap-bar"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["blue drifts toward the level's own blue rather than the reference's",
                      "bar reads white rather than warm cream", "glossy highlights on matte plastic"]},
    {"id": "interior-read", "name": "Recessed interior with a visible floor",
     "tier": "important", "passIds": ["structural-pass", "form-refinement", "surface-pass"],
     "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["dish-floor", "dish-wall"], "evidenceRefs": [EVIDENCE, "interior-zone"],
     "failureModes": ["dish reads solid with no recess", "floor missing so the dish is see-through",
                      "no occlusion gradient down the inner wall"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "primary elevated view down the short axis (elevation about 58 deg)",
     "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": [
         "Silhouette box spans x 80-1011 and y 378-1035 of a 1086x1448 image: 932 by 658 pixels.",
         "The long axis is 4 degrees off screen horizontal, so the plan rotation is effectively "
         "zero and the view is down the short axis.",
         "Exactly two albedos: one blue for the whole dish and one cream for the bar.",
         "The underside and the far end of the interior floor are not visible.",
     ],
     "confidence": 0.85},
    {"id": "rim-zone", "view": "rim section at the near and far edges",
     "imageRegion": {"x": 0.06, "y": 0.24, "width": 0.88, "height": 0.48, "units": "normalized"},
     "observations": [
         "Column 545 gives a 47 pixel far rim band and a 146 pixel near rim band, which separate "
         "the wall's top face from its outer wall.",
         "No crease appears anywhere on the wall: the crown rolls continuously into the outer face.",
         "The crown reads (64,148,229) against (26,101,174) on the shaded inner wall.",
     ],
     "confidence": 0.8},
    {"id": "interior-zone", "view": "opening and inner wall",
     "imageRegion": {"x": 0.14, "y": 0.28, "width": 0.72, "height": 0.36, "units": "normalized"},
     "observations": [
         "The opening between the inner rim edges is 441 pixels at column 545.",
         "The inner wall darkens toward the floor; the floor itself is almost entirely covered.",
         "A contact shadow runs where the bar meets the floor.",
     ],
     "confidence": 0.7},
    {"id": "bar-zone", "view": "soap bar",
     "imageRegion": {"x": 0.18, "y": 0.28, "width": 0.62, "height": 0.34, "units": "normalized"},
     "observations": [
         "Row 660 puts the bar's projected length at 682 pixels; column 545 puts its projected "
         "height at 436 pixels.",
         "The bar has no flat face and no edge: it is domed at both ends.",
         "Its crown reads (255,251,242), the brightest value in the frame.",
     ],
     "confidence": 0.8},
]

SPEC = assemble(
    target_name="Apartment Soap Dish",
    target_id="apartment-soap-dish",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": True,
        "solveMethod": "azimuth from the 4 degree tilt of the long axis in the silhouette; "
                       "elevation seeded at 58 degrees from the rim-band ratios and refined by a "
                       "harness sweep scored on Tier-1 silhouette IoU",
        "fovDegrees": 12.0,
        "aspect": round(1086 / 1448, 4),
        "orientation": {"yaw": 4.0, "pitch": -58.0, "roll": 0.0},
        "targetHint": [0.0, 0.06, 0.0],
        "note": "Elevation and plan aspect cannot be separated from one view: a wider dish seen "
                "from a steeper angle projects the same silhouette. 58 degrees is the seed; the "
                "sweep result is recorded in reviewHistory. Distance is not fixed here: the "
                "preview harness solves it by fitting the render's projected bounding box to the "
                "reference bounding box (x 80-1011, y 378-1035 of 1086x1448).",
    },
    measurement_basis={
        "pixelsPerWorldUnit": round(PX_PER_UNIT, 1),
        "referenceBBox": {"x0": 80, "y0": 378, "x1": 1011, "y1": 1035, "imageSize": [1086, 1448]},
        "derivations": [
            "Projected length 932 px set to 0.70 world units, the width of the hand-authored dish "
            "this replaces, so the soap-slick trap's layout does not move.",
            "Column 545: far rim band 47 px, near rim band 146 px, opening 441 px. With outer "
            "height 658 px these give W sin(e) = 560, Ho cos(e) = 91 and t sin(e) = 55.",
            f"At the seeded 58 degrees those become width {WIDTH}, height {HEIGHT} and wall "
            f"thickness {WALL_T} world units.",
            f"Row 660 gives the bar 682 px of projected length = {BAR_LENGTH} world units; column "
            f"545 gives 436 px of projected height, which resolves to {BAR_HEIGHT}.",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2,
            "interaction_fit": 2},
    pre_spec={
        "objectClass": {
            "primaryType": "bathroom soap dish with a cast bar",
            "primaryDomain": "object",
            "formLanguage": ["smooth-organic", "stylized-toy", "rolled-moulded-edge"],
            "structureKind": ["open-tray", "recessed-interior", "loose-contents"],
            "motionPotential": ["bar-lift", "dish-slide", "bar-detach"],
            "materialFamilies": ["matte-plastic-blue", "matte-cast-soap-cream"],
            "notes": "Smooth organic object with no crease anywhere. The identity is the rolled "
                     "rim section and the pillow bar standing proud of it, not the oval outline, "
                     "which a flat disc would also give. One view: the underside and most of the "
                     "interior floor are inferred.",
        },
        "complexity": {
            "tier": "simple",
            "scores": {"silhouetteComplexity": 1, "componentCount": 1, "hierarchyDepth": 1,
                       "repetitionDensity": 0, "materialLayerCount": 1, "localDetailDensity": 1,
                       "occlusionRisk": 2, "actionReadinessNeed": 1},
            "estimatedCounts": {"macroComponents": 1, "mesoComponents": 2, "microFeatureGroups": 0,
                                "materialLayers": 2, "repetitionSystems": 0},
            "reasoning": [
                "Three parts and two albedos: this is a genuinely simple object and inflating the "
                "component tree would not make it more like the reference.",
                "There is no repeated structure anywhere in the reference.",
                "Action readiness is low: the dish is dressing on a distance-triggered slick.",
                "Occlusion risk is moderate: the underside and most of the interior floor are "
                "never seen.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "simple",
            "minimumComponentLevels": ["macro", "meso"],
            "needsRepetitionSystems": False,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": False,
            "rationale": "The object has no repeated structure and no micro parts, but its whole "
                         "identity is a shading response on rolled surfaces, so material local "
                         "overrides are required even though the component tree is shallow.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "Camera elevation cannot be separated from the plan aspect by one view.",
             "resolution": "Seeded at 58 degrees from the rim-band ratios and refined by a harness "
                           "sweep scored on Tier-1 silhouette IoU. Every derived width and height "
                           "moves with it, which is recorded in measurementBasis.",
             "confidence": 0.6},
            {"unknown": "The interior floor depth is not measurable: the bar covers it.",
             "resolution": f"Set so the recess is {RECESS_DEPTH} units deep, which holds the bar's "
                           "lower third and matches the reference's shadow line.",
             "confidence": 0.5},
            {"unknown": "The underside is not visible.",
             "resolution": "Closed flat with the same tuck radius as the outer wall. A soap dish "
                           "has no feature there that would show in play.",
             "confidence": 0.6},
        ],
        "detailInventory": DETAIL_INVENTORY,
        "anatomy": {"applies": False, "styleHeads": 0.0,
                    "proportions": {"headUnit": 0.0, "torso": 0.0, "legs": 0.0,
                                    "shoulderWidth": 0.0, "hipWidth": 0.0},
                    "pose": {"type": "not-applicable", "jointAngles": {}},
                    "faceLandmarks": {"eyeLine": 0.0, "eyeSpacing": 0.0, "noseBase": 0.0,
                                      "mouthLine": 0.0, "hairline": 0.0},
                    "features": [], "confidence": 0.0,
                    "note": "primaryDomain is object, so the character track does not apply."},
        "sourceImage": SOURCE_IMAGE,
    },
    contract=quality_contract(
        "moderate",
        ["The rendered dish matches the reference silhouette, the stadium plan, the rolled rim "
         "section, the recessed interior and the pillow bar standing proud of the rim.",
         "No crease appears anywhere on the dish or the bar under any of the review lights.",
         "The dish's long axis stays at 0.70 world units so the soap-slick trap's layout does not "
         "move."],
        {"macroComponents": 1, "mesoComponents": 2, "microFeatureGroups": 0, "materialLayers": 2,
         "repetitionSystems": 0, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Length, width, height and wall thickness are stated as measured "
                           "numbers derived from named pixel spans.",
                           "The plan is stated as a stadium with its straight run quantified."],
                          [EVIDENCE],
                          ["model reads as a generic oval bowl",
                           "proportions guessed rather than derived from the rim bands"]),
            feature_group("primary-structure", "Primary structure and hierarchy",
                          ["Wall, floor and bar are separate named parts.",
                           "Every contact records a seam overlap of at least 0.02 world units."],
                          [EVIDENCE, "interior-zone"],
                          ["dish and bar merged into one mesh", "no floor, so the dish reads through"]),
            feature_group("attachment-joint-correctness", "Contact and joint correctness",
                          ["The bar is buried in the floor plate rather than resting on it, so no "
                           "gap can open under it.",
                           "The floor plate's contour is buried in the wall."],
                          [EVIDENCE, "interior-zone"],
                          ["bar floats above the floor", "gap opens between floor and wall"]),
            feature_group("surface-material-response", "Surface material response",
                          ["Albedo zones, roughness, normal intent and local overrides are "
                           "specified per material and tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are independent fields.",
                           "Surface response is decomposed into macro, meso and micro bands."],
                          [EVIDENCE, "rim-zone"],
                          ["surface looks like glossy toy plastic",
                           "no value gradient down the inner wall"]),
            feature_group("reference-lookdev", "Reference colour, material and lighting response",
                          ["The two-layer palette traces to median-sampled reference pixels.",
                           "Reference PBR extraction ran on both material crops and its confidence "
                           "and binding decision are recorded.",
                           "Lighting names key, fill, rim or environment, exposure, tone mapping, "
                           "background and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders prove the rolled rim "
                           "survives relighting rather than being painted."],
                          [EVIDENCE],
                          ["acceptable shape but flat-shaded read",
                           "blue drifts to the level palette's own blue", "lighting evenly ambient"]),
        ],
        ["silhouette and negative-space delta", "rim band width delta",
         "component hierarchy depth delta", "interior occlusion gradient delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.8,
        "mustMatch": ["stadium plan with straight long sides",
                      "rolled rim crown and base tuck with no crease",
                      "recessed interior with a visible occlusion gradient",
                      "pillow bar standing proud of the rim",
                      "two-albedo palette: one blue, one cream"],
        "niceToHave": ["the faint mould parting line along the bar's flank",
                       "the exact interior floor depth"],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-elevated", "front", "right", "top-down", "grazing"],
    },
    feature_review_targets=FEATURE_REVIEW_TARGETS,
    view_evidence=VIEW_EVIDENCE,
    components=COMPONENTS,
    materials=MATERIALS,
    repetition_systems=[],
    passes=PASSES,
    lighting=[
        "Ambient dominance: the reference is a soft studio render. The dish's lit crown reads "
        "(64,148,229) and its shaded inner wall (26,101,174), a range a bright neutral hemisphere "
        "plus a gentle key reproduces without a hard terminator anywhere.",
        "Key light: a warm-neutral directional source at about 1.15 from high and camera left. It "
        "only has to lift the bar's crown to (255,251,242), about 8 percent above its flanks.",
        "Rim and environment light: weak neutral back light at about 0.3, enough to keep the far "
        "rim from crushing. No environment map: the reference shows no reflected detail.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.",
        "Contact shadow: interior ambient occlusion plus the bar's contact ring. The reference "
        "dish floats with no ground contact, so the review render has no ground plane and the "
        "silhouette mask stays clean.",
    ],
    action_readiness=action_readiness(
        "dish-wall",
        {"rootMotion": "sculptRuntime.nodes['dish-wall'] carries translation, rotation and scale; "
                       "the floor and the bar are its children so the dish moves as one.",
         "barSeat": "sculptRuntime.sockets['dish-wall:bar-seat'] is the interior floor centre; "
                    "sculptRuntime.sockets['soap-bar:bar-crown'] is where a lather effect anchors.",
         "collider": "colliders['dish-wall'] is a box proxy over the dish. The soap-slick trap "
                     "uses a distance trigger and adds no collider of its own, so this proxy is "
                     "advisory."},
        "dish, bar",
        "Detach the bar as a whole; the dish is not fractured."),
    assumptions=[
        "Camera elevation is 58 degrees. Every derived width and height scales with that choice, "
        "which is why the sweep result is recorded rather than the seed being presented as "
        "measured.",
        f"The interior recess is {RECESS_DEPTH} units deep; the bar covers the floor in the "
        "reference so this is inferred.",
        "The underside is flat with the same tuck as the outer wall.",
        "One world unit is about 12 cm, making the modelled dish about 8 cm long.",
        "The hand-authored dish this replaces carried a rubber duck. The reference has no duck, so "
        "it is not rebuilt.",
    ],
    coordinate_frame={
        "front": "+Z, the near long side in the reference",
        "up": "+Y, with the underside of the dish at y = 0",
        "right": "+X, along the dish's long axis",
        "scaleReference": f"dish length = {LENGTH} world units; {round(PX_PER_UNIT)} reference "
                          "pixels per world unit",
    },
    silhouette={
        "boundingShape": f"stadium tray {LENGTH} by {WIDTH} by {HEIGHT}, with a "
                         f"{BAR_LENGTH} by {BAR_WIDTH} by {BAR_HEIGHT} pillow standing proud of it",
        "aspectRatios": [
            {"id": "length-to-width", "value": round(LENGTH / WIDTH, 3),
             "notes": "outer plan length over width at the solved elevation"},
            {"id": "length-to-height", "value": round(LENGTH / HEIGHT, 3),
             "notes": "outer plan length over dish height"},
            {"id": "bar-to-interior-length", "value": round(BAR_LENGTH / INNER_LENGTH, 3),
             "notes": "how much of the opening the bar fills"},
        ],
        "symmetry": "mirror symmetric on both plan axes",
        "dominantCurves": ["the rim's rolled section", "the bar's double dome",
                           "the stadium plan's semicircular end caps"],
        "negativeSpaces": ["the recessed interior between the bar and the inner wall",
                           "the undercut where the outer wall tucks back at the base"],
        "landmarks": [f"rim crown at y = {HEIGHT}", f"interior floor at y = {FLOOR_H}",
                      f"bar crown at y = {round(BAR_LIFT + BAR_HEIGHT, 3)}"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "wall, floor and bar with full profile stops; 256px procedural maps"},
        {"tier": "mid", "distance": 12, "strategy": "drop the floor plate; the bar hides it"},
        {"tier": "far", "distance": 30, "strategy": "wall and bar only, halved stadium sampling"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 3500,
        "maxDrawCalls": 8,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "Reach accepted visual fidelity first, then cut the stadium sampling "
                              "from 28 sides. The rolled rim sets the floor on the extrusion step "
                              "count: below about 10 steps the roll stairsteps visibly.",
    },
    procedural_strategy=[
        "Block out the stadium wall and the pillow bar first, and confirm the silhouette matches "
        "the measured bounding box.",
        "Add the floor plate, buried in the wall, so the dish is not see-through.",
        "Create pivot nodes, the base and bar-seat sockets and the collider proxy before polish.",
        "Roll the rim crown and the base tuck with profile stops, then weld the extrusion's "
        "vertices so the wall shades as one surface instead of 28 facets.",
        "Run reference PBR extraction on both material crops, record its confidence, and decide "
        "explicitly whether to bind or only cite the maps.",
        "Add the interior occlusion gradient and the crown sheen last.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['dish-wall'] carries whole-object translation, rotation and scale",
        "sculptRuntime.nodes['soap-bar'] can be lifted or detached without rebuilding geometry",
        "sculptRuntime.sockets['soap-bar:bar-crown'] anchors a lather or bubble effect",
    ],
    destruction_anchors=["the bar detaches as a whole", "the dish is not fractured"],
    risks=[
        "Elevation and plan aspect are not separable from one view. Width, height and wall "
        "thickness all move with the 58 degree seed; a 10 degree error moves the height by about "
        "20 percent.",
        "The interior floor depth is inferred, not measured: the bar covers it.",
        "The reference shows no crease anywhere, so the whole read depends on welded vertices and "
        "smooth normals. If the refine-code merge step is dropped, ExtrudeGeometry's non-indexed "
        "output makes the wall read as 28 flat facets.",
        "One refine-code edit to the generated factory is required and is not expressible through "
        "the generator as shipped: buildExtrudeGeometry must honour profile2D axis, axisOffset, "
        "steps, profileStops and smoothShading, all of which the spec already carries.",
        "Reference PBR maps were extracted and passed their confidence gate but are deliberately "
        "not bound to the runtime material; the runtime uses independent procedural canvas maps.",
    ],
)


if __name__ == "__main__":
    write_spec(OUT, SPEC)
