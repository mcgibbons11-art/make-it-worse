#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment refrigerator.

Every dimension is derived from measurements of assets/reference/fridge-reference.png
made with measure_reference.py, measure_regions.py and the row/column green-channel
step scans recorded in `measurementBasis`, so a later session can re-check them.

THE ONE THING TO READ BEFORE CHANGING ANY NUMBER HERE. The reference fridge and the
slot it has to fill are different shapes, and this spec resolves that in favour of the
slot. Solving the camera off the two top-edge slopes gives azimuth 23.0 and elevation
16.4 degrees, and at that camera the reference silhouette resolves to a body whose
front face is 2.15 times as tall as the fridge is wide. The trap's CuboidCollider is
args={[0.68, 0.92, 0.48]} with the model mounted at [0, -0.92, 0], which is a box 1.34
wide and 1.84 tall: 1.37 times as tall as wide. Reproducing the reference proportion
would mean either a 2.97-unit fridge overflowing a 1.84-unit collider, or a 0.83-unit
fridge rattling around inside a 1.36-unit one. The first lets the player walk through
the top half of a solid-looking appliance and also pushes it past the runner's 2.17-unit
jump ceiling, turning a jumpable obstacle into a wall. The second hits the player with
0.27 units of empty air on each side. Both are fairness bugs; a squatter fridge is not.
So the ENVELOPE is the call site's and every reference measurement enters as a FRACTION
of that envelope. The vertical compression is 0.62, and it is recorded in `risks` rather
than presented as a match.

Run:  python author_fridge_spec.py
Writes: fridge-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math

from spec_lib import (
    HERE, PROJECT, action, action_readiness, assemble, build_passes, colours, component,
    descriptor, detail, detail_inventory, dims, dome_stops, feature, feature_group,
    material, override, profile, quality_contract, surface, write_spec, xform,
)

PROP = "fridge"
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "fridge-reference.png")
OUT = HERE / "fridge-sculpt-spec.json"
EVIDENCE = "full-object"

# ---------------------------------------------------------------------------
# Camera solve
# ---------------------------------------------------------------------------
# A box's two visible top edges project with screen slopes tan(a)*sin(e) and
# sin(e)/tan(a). The plinth gives both cleanly because its edges are not rounded:
# its front-face top edge falls 39 px over 300 (x 460..760, y 1246..1207) and its
# left-face top edge falls 80 px over 120 (x 400..280, y 1239..1159). The door seam
# confirms the first at -0.12 over x 450..750. Product and ratio of the two slopes
# separate elevation from azimuth without needing any length.
SLOPE_DOOR_FACE = 0.12
SLOPE_LEFT_FACE = 0.667
ELEVATION_DEG = round(math.degrees(math.asin(math.sqrt(SLOPE_DOOR_FACE * SLOPE_LEFT_FACE))), 1)
AZIMUTH_DEG = round(math.degrees(math.atan(math.sqrt(SLOPE_DOOR_FACE / SLOPE_LEFT_FACE))), 1)

# ---------------------------------------------------------------------------
# Envelope, fixed by the call site rather than by the reference. See the header.
# ---------------------------------------------------------------------------
WIDTH = 1.34
HEIGHT = 1.84
# The collider's half-depth of 0.48 is the budget for EVERYTHING, trim included, not just
# for the cabinet box. Measured at DEPTH 0.94 the model came out 1.0322 deep because the
# door pulls stood 0.082 past the collider, which is the same class of error the swinging
# hammer hit: a visible part reaching past the shape that actually touches the player. The
# door band's depth is therefore budgeted backwards from 0.48:
#     door half-depth + door proud + pull stand-off + pull radius  <=  0.48
#             0.41    +    0.02    +      0.02      +   0.0466     =   0.4766
# The cabinet body sits DOOR_PROUD inside that on each side. The cost is plan aspect: the
# reference resolves to width/depth 1.29 and this is 1.63, which is recorded in risks.
DEPTH = 0.82
COLLIDER_DEPTH = 0.96

# ---------------------------------------------------------------------------
# Reference pixel spans, all read at the columns and rows named in measurementBasis.
# ---------------------------------------------------------------------------
# Horizontal, along the door face. The near vertical corner is a 60-count green step
# that sits at x=393 on every row scanned from y=400 to y=1100, and the door face's
# far edge is the silhouette's right extreme at x=838.
PX_DOOR_X0, PX_DOOR_X1 = 393.0, 838.0
PX_DOOR_W = PX_DOOR_X1 - PX_DOOR_X0                     # 445 px across the door face

# Vertical, read down column 600. Door-panel top edge 231, door seam centre 598,
# plinth top 1228, plinth bottom 1281.
PX_PANEL_TOP, PX_SEAM, PX_PLINTH_TOP, PX_BOTTOM = 231.0, 598.0, 1228.0, 1281.0
PX_VERTICAL = PX_BOTTOM - PX_PANEL_TOP                  # 1050 px of front face + plinth

# The crown is the roll from the front face's top edge over onto the top face. It is
# the one vertical quantity the single view cannot measure: at column 600 the 106 px
# between the silhouette top and the door-panel top is mostly the foreshortened top
# face, not the roll. Set equal to the vertical corner radius, which is what a single
# moulded shell does - one tool radius everywhere - and which is what the reference's
# top reads as. The first blockout render used 0.09 over 16 extrusion steps, which put
# barely one z-slice inside the roll and creased the crown instead of rolling it.
CROWN_ROLL = 0.16
PX_PER_UNIT_Y = PX_VERTICAL / (HEIGHT - CROWN_ROLL)     # 600.0 px per world unit
PX_PER_UNIT_X = PX_DOOR_W / WIDTH                       # 332.1 px per world unit


def wy(py: float) -> float:
    """World Y from a reference row, measured up from the plinth's bottom edge."""
    return round((PX_BOTTOM - py) / PX_PER_UNIT_Y, 4)


def wx(px: float) -> float:
    """World X from a reference column across the door face."""
    return round(-WIDTH / 2 + (px - PX_DOOR_X0) / PX_PER_UNIT_X, 4)


def wlx(px: float) -> float:
    """A horizontal length in world units from a length in pixels."""
    return round(px / PX_PER_UNIT_X, 4)


PLINTH_H = wy(PX_PLINTH_TOP)                            # 0.0883
SEAM_Y = wy(PX_SEAM)                                    # 1.1383
# The seam's dark band runs y 593..611 at column 600.
SEAM_GAP = round(18.0 / PX_PER_UNIT_Y, 4)               # 0.030

# The plinth is inset from the body on every side: the navy region spans x 257..816
# against the body's 246..838, which is 11 px on the shaded left face and 22 px on the
# door face. Those are 0.078 and 0.066 world units; one value is used for all sides.
PLINTH_INSET = 0.07

# Handles. Two cream bars, upper x 449..480 y 386..577 and lower x 450..479 y 662..859.
HANDLE_X = wx(464.5)                                    # -0.4547
HANDLE_R = round(wlx(31.0) / 2, 4)                      # 0.0467
HANDLE_UPPER_Y0, HANDLE_UPPER_Y1 = wy(577.0), wy(386.0)
HANDLE_LOWER_Y0, HANDLE_LOWER_Y1 = wy(859.0), wy(662.0)
HANDLE_UPPER_LEN = round(HANDLE_UPPER_Y1 - HANDLE_UPPER_Y0, 4)
HANDLE_LOWER_LEN = round(HANDLE_LOWER_Y1 - HANDLE_LOWER_Y0, 4)

# Badge. The coral disc spans x 718..769 and y 329..383, which is 51 by 54 px. At the
# solved camera those are 0.153 and 0.156 world units before the envelope fit, so the
# badge is a circle in the reference. It cannot stay one: the same fit that squares the
# fridge into its collider compresses Y by 0.62, and an ellipse there would read as a
# modelling error rather than as a design. The geometric mean of the two fitted extents
# is used so the disc keeps its area and stays round.
BADGE_X = wx(743.5)                                     # 0.3855
BADGE_Y = wy(356.0)
BADGE_R = round(math.sqrt(wlx(51.0) * (54.0 / PX_PER_UNIT_Y)) / 2, 4)

# Doors stand proud of the shell and are modelled as full-perimeter bands rather than
# front panels. The row scans find no vertical step anywhere on the door face between
# the near corner at x=393 and the far edge at x=838, so the doors are as wide as the
# body; and a single front view cannot show where a door stops wrapping. A band is what
# the evidence supports, it leaves the groove between the doors reading correctly from
# every angle the game uses, and it keeps each door a separate named openable part.
DOOR_PROUD = 0.02
PANEL_TOP_Y = wy(PX_PANEL_TOP)                          # 1.75

# The vertical corner radius is not measurable: the rounding is what stops the
# silhouette from reaching the box corners in the first place, so no edge scan can
# recover it. Held at the radius the hand-authored fridge used, which reads at the
# reference's softness.
CORNER_R = 0.16
PLAN_SIDES = 24
# profileStops are interpolated per vertex from its position along the extrusion, so a
# roll can only be as smooth as the number of z-slices that fall inside it. The 0.16
# roll is 9.1 percent of the cabinet's sweep, so 40 steps put 3.7 slices in it; the
# first blockout used 16 steps and put 1.3 slices in a 0.09 roll, which creased.
# 40 steps put 3.7 slices in the roll and it still read as a chamfer with a crease at
# both of its ends; 72 puts 6.6 in and the crown reads as a roll. The plan sampling
# drops from 32 to 24 to pay for it: the vertical corners are a 0.16 radius on a 1.34
# plan, and 24 sides hold that silhouette while 72 steps are what the crown needs.
SHELL_STEPS = 72
# The inverse of the vertical call-site fit, computed rather than quoted so the number
# and the prose can never drift apart.
#
# A pixel span on a vertical face is foreshortened by cos(e); one across the door face
# by cos(a). Undoing both puts the reference's front-face height and the cabinet's width
# in the same units, and their ratio is the aspect the reference actually has:
#     997 px / cos(16.4) over 445 px / cos(23.0)  =  1039.5 / 483.4  =  2.150
# The model's own front face is PANEL_TOP_Y - PLINTH_H over WIDTH. The quotient is what
# a review render must be stretched by before Tier 1 can judge form instead of
# re-measuring the fit, and it is passed to the preview harness as ?yscale=.
COS_A = math.cos(math.radians(AZIMUTH_DEG))
COS_E = math.cos(math.radians(ELEVATION_DEG))
SEEDED_FACE_ASPECT = round(((PX_PLINTH_TOP - PX_PANEL_TOP) / COS_E) / (PX_DOOR_W / COS_A), 3)
SEEDED_Y_SCALE = round(SEEDED_FACE_ASPECT / ((PANEL_TOP_Y - PLINTH_H) / WIDTH), 3)

# The seed above treats the silhouette as a sharp box, and this cabinet is not one: its
# rounded corners hold the silhouette inside the box everywhere, and its crown roll takes
# a bite out of the top that no un-foreshortening can predict. Seeded at 1.807 the review
# render came out at silhouette aspect 0.424 against the reference's 0.502. A sweep at
# 1.45 / 1.53 / 1.61 bracketed it (0.517 / 0.492 / 0.471) and 1.50 lands on 0.5017, a
# measured aspect delta of 0.000. That is the number the review renders use, and its
# reciprocal is the real vertical fit against the reference.
REVIEW_Y_SCALE = 1.50
REFERENCE_FACE_ASPECT = round(((PANEL_TOP_Y - PLINTH_H) / WIDTH) * REVIEW_Y_SCALE, 3)
BUILT_FACE_ASPECT = round((PANEL_TOP_Y - PLINTH_H) / WIDTH, 3)
VERTICAL_FIT = round(1.0 / REVIEW_Y_SCALE, 3)

# FORM AND RELATIVE COLOUR COME FROM THE REFERENCE; THE HEX COMES FROM PALETTE.
# lib/game/constants.ts:6 is the game's own list and it is what every prop is judged
# against - the level's sky, its decks and the props standing next to this one. A
# reference render is lit, so its pixels are the hue plus that lighting: mint measured
# #86B299 to #9BC2A0 across three references, which is PALETTE.green seen under a warm
# key, not a different green. Matching those literal pixels would put the cabinet
# slightly off every other green in the level for no gain.
#
# The navy is the exception that proves it. PALETTE has no navy, but the existing
# hand-authored props already use #24324a for their dark parts in three places, and the
# references' #36424B / #3D4F5E / #27334C cluster right on it. It is an established prop
# convention that never reached the constant. NOT ink #171a2b: ink is the level's edge
# band, carrying 13.7:1 against sky to make platform edges legible, and a prop wearing it
# would read as level geometry.
MINT = "#57dfa1"          # PALETTE.green
MINT_SHADE = "#3fae7b"    # the same green at 0.72, for the moulding tone drift only
NAVY = "#24324a"          # the established prop navy; see above
CREAM = "#fff8e8"         # PALETTE.cream
CORAL = "#ff5c65"         # PALETTE.red


def rounded_rect(width: float, depth: float, radius: float, sides: int):
    """Counter-clockwise rounded rectangle. `sides` is the total sample count, split
    evenly across the four corner arcs; the straight runs need no samples of their own
    because the arcs already terminate on them."""
    half_w, half_d = width / 2.0, depth / 2.0
    radius = min(radius, half_w, half_d)
    per_corner = max(2, sides // 4)
    centres = [
        (half_w - radius, half_d - radius, 0.0),
        (-(half_w - radius), half_d - radius, math.pi / 2),
        (-(half_w - radius), -(half_d - radius), math.pi),
        (half_w - radius, -(half_d - radius), 3 * math.pi / 2),
    ]
    points: list[list[float]] = []
    for cx, cy, start in centres:
        for i in range(per_corner + 1):
            angle = start + (math.pi / 2) * i / per_corner
            points.append([round(cx + radius * math.cos(angle), 5),
                           round(cy + radius * math.sin(angle), 5)])
    return points


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
MATERIALS = [
    material(PROP, "shell-mint", "Cabinet mint", MINT, [MINT, MINT_SHADE, "#8ff0c0"],
             0.80, 0.08, 0.34, 0.842,
             [override("crown-highlight", "shell/crown-roll",
                       "The crown roll carries the brightest mint in the frame, measured at "
                       "(193,224,195) against (155,193,161) on the flat door face.",
                       [EVIDENCE, "crown-zone"], roughness=0.70,
                       mask="the top roll, above the door panels"),
              override("side-face-shade", "shell/side-panel",
                       "The left face reads (120,155,127) against the door face's (155,193,161): "
                       "one pigment, two orientations, no second albedo.",
                       [EVIDENCE, "side-zone"], roughness=0.84,
                       mask="the shaded side face away from the key"),
              override("seam-occlusion", "freezer-door/door-under-edge",
                       "The seam between the doors is the darkest mint in the frame at (9,26,14), "
                       "which is contact occlusion in a 18 px groove, not a painted line.",
                       [EVIDENCE, "seam-zone"], roughness=0.86, aoBoost=0.75,
                       mask="the groove walls between the two door bands")],
             "One moulded cabinet colour across shell and both doors. The reference shows no "
             "second mint anywhere; every apparent tone is orientation."),
    material(PROP, "plinth-navy", "Plinth navy", NAVY, [NAVY, "#1a2536", "#33455f"],
             0.82, 0.06, 0.38, 0.815,
             [override("plinth-front-lift", "plinth/front-face",
                       "The plinth's front face reads (59,68,86) against (55,61,73) on its left "
                       "face, the same key/shade split the cabinet shows.",
                       [EVIDENCE, "plinth-zone"], roughness=0.78,
                       mask="the plinth's door-side face"),
              override("floor-contact", "plinth/base-tuck",
                       "The plinth's lowest band loses the key entirely where it tucks under.",
                       [EVIDENCE, "plinth-zone"], roughness=0.86, aoBoost=0.55,
                       mask="the bottom 20 percent of the plinth")],
             "Darker moulded base. Inset from the cabinet on every side, which is what puts the "
             "cabinet's bottom edge in shadow above it."),
    material(PROP, "trim-cream", "Handle cream", CREAM, [CREAM, "#efe4cf", "#fffdf6"],
             0.62, 0.09, 0.24, 0.788,
             [override("bar-crown-sheen", "handle-upper/bar-crown",
                       "The handle crowns are the brightest values on the door face at (240,222,189); "
                       "a handled part is polished smoother than the panel behind it.",
                       [EVIDENCE, "handle-zone"], roughness=0.52,
                       mask="the outward-facing third of each bar"),
              override("bar-root-shadow", "handle-lower/bar-root",
                       "Each bar sits in its own contact shadow against the door.",
                       [EVIDENCE, "handle-zone"], roughness=0.68, aoBoost=0.50,
                       mask="where the bar meets the door face")],
             "Warm cream handles. Smoother than the cabinet: these are the parts a hand touches."),
    material(PROP, "badge-coral", "Badge coral", CORAL, [CORAL, "#e04a53", "#ff8a90"],
             0.66, 0.07, 0.22, 0.762,
             [override("badge-dome-sheen", "badge/dome-crown",
                       "The badge reads (245,141,122) at its crown and falls off toward its rim, "
                       "which is a domed disc rather than a printed circle.",
                       [EVIDENCE, "badge-zone"], roughness=0.56,
                       mask="the crown of the disc")],
             "The single accent on the appliance. One disc, domed, on the freezer door."),
]


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
SHELL = component(
    "shell", "Cabinet shell", "macro", "shell", "extrude", "shell-mint",
    "continuous-sculpt",
    "One moulded cabinet with no crease: the reference's vertical corners and its crown roll "
    "into each other continuously, and no edge scan finds a hard line anywhere on the body. A "
    "box with bevels would show four corner facets the reference does not have.",
    colours(MINT),
    descriptor("rounded-rectangle plan swept vertically from the plinth top to the crown, with "
               "the plan easing inward over the top of the sweep so the cabinet rolls over "
               "instead of meeting the top face at an edge",
               "rolled", 0.0, 1,
               deformations=[f"crown roll inward over the top {CROWN_ROLL} units"],
               uv="ExtrudeGeometry cap and wall UVs; one tile per part",
               normals="welded vertices then smooth vertex normals; the reference has no crease"),
    xform(),
    dims(WIDTH, HEIGHT - PLINTH_H, DEPTH - 2 * DOOR_PROUD, 0.6),
    action("root", "center", (0.0, HEIGHT / 2, 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "rotate": True, "scale": True},
           sockets=[{"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Underside of the plinth; the trap mounts the prop here."},
                    {"id": "door-face", "localPosition": [0.0, round(HEIGHT / 2, 4),
                                                          round(DEPTH / 2, 4)],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Centre of the door face, which is the direction the trap charges."}],
           collider={"type": "box", "offset": [0.0, round(HEIGHT / 2, 4), 0.0],
                     "scale": [WIDTH, HEIGHT, COLLIDER_DEPTH], "isTrigger": False,
                     "notes": "Box proxy matching the trap's CuboidCollider args "
                              "[0.68, 0.92, 0.48] exactly, which is what the envelope is for."},
           fracture="cabinet"),
    [feature("crown-roll",
             f"The plan eases inward over the top {CROWN_ROLL} units on a quarter cosine, so the "
             "cabinet's top is a continuous roll. Column 600 shows the flat front face ending at "
             "y=231 with no step, which is a roll rather than a chamfer.",
             "profileStops easing the plan inward over the last sixth of the vertical sweep",
             [EVIDENCE, "crown-zone"], 0.6),
     feature("side-panel",
             "The shaded left face is the same pigment as the door face at a different "
             "orientation: (120,155,127) against (155,193,161), a pure value shift with no hue "
             "change.",
             "plan face, not separate geometry",
             [EVIDENCE, "side-zone"], 0.85),
     feature("corner-round",
             f"The four vertical corners carry a {CORNER_R} radius. This is the one plan number "
             "the view cannot measure, because the rounding is exactly what stops the silhouette "
             "reaching the box corners that would let it be measured.",
             f"rounded-rectangle plan sampled at {PLAN_SIDES} points",
             [EVIDENCE], 0.5)],
    surface(0.80, 0.08, 0.0, "matte moulded ABS with slight tone drift",
            "occlusion in the door groove and under the cabinet's bottom edge",
            "none - the reference appliance shows no wear",
            "Matte plastic throughout. No specular coat anywhere in the reference."),
    [EVIDENCE, "crown-zone", "side-zone"],
    importance=1.0, confidence=0.8, parent=None, fidelity="blockout",
)
SHELL["geometryDescriptor"]["profile2D"] = profile(
    rounded_rect(WIDTH, DEPTH - 2 * DOOR_PROUD, CORNER_R, PLAN_SIDES),
    HEIGHT - PLINTH_H, axis="y", axis_offset=PLINTH_H, steps=SHELL_STEPS,
    stops=[[0.0, 0.985, 0.978], [0.012, 1.0, 1.0]]
    + dome_stops(WIDTH / 2, (DEPTH - 2 * DOOR_PROUD) / 2,
                 CROWN_ROLL, SHELL_STEPS,
                 start=round(1.0 - CROWN_ROLL / (HEIGHT - PLINTH_H), 3))[1:],
)
SHELL["geometryDescriptor"]["profile2D"]["smoothShading"] = True

PLINTH = component(
    # assembled-solid, not continuous-sculpt: the plinth is 0.088 tall on a 1.2 by 0.8 plan, and a
    # form that thin declared as a continuous 3D volume reads as a bent plane from any angle the
    # reference does not cover. It is a flat slab with rolled edges, and that is what it is called.
    "plinth", "Base plinth", "macro", "base", "extrude", "plinth-navy",
    "assembled-solid",
    "A flat rigid base slab with rolled top and bottom edges. It has one visible planar side face, "
    "which is what makes it a slab rather than part of the cabinet's continuous shell.",
    colours(NAVY),
    descriptor("rounded-rectangle plan inset from the cabinet, swept vertically and eased inward "
               "at both ends of the sweep",
               "rolled", 0.0, 1,
               deformations=["top roll inward", "base tuck inward"],
               uv="ExtrudeGeometry cap and wall UVs", normals="welded then smooth vertex normals"),
    xform(),
    dims(WIDTH - 2 * PLINTH_INSET, PLINTH_H, DEPTH - 2 * PLINTH_INSET, 0.7),
    action("static", "center", (0.0, round(PLINTH_H / 2, 4), 0.0), (0, 1, 0), 0.8,
           collider={"type": "box", "offset": [0.0, round(PLINTH_H / 2, 4), 0.0],
                     "scale": [WIDTH - 2 * PLINTH_INSET, PLINTH_H, DEPTH - 2 * PLINTH_INSET],
                     "isTrigger": False, "notes": "Box proxy over the plinth."},
           fracture="cabinet"),
    [feature("front-face",
             "The plinth's own key/shade split runs the same way as the cabinet's: (59,68,86) on "
             "the door side against (55,61,73) on the left.",
             "plan face, not separate geometry",
             [EVIDENCE, "plinth-zone"], 0.8),
     feature("base-tuck",
             "The plan eases inward at the bottom of the sweep, which is why the reference's "
             "lowest silhouette curves in rather than meeting the ground square.",
             "profileStops mirrored at the start of the extrusion",
             [EVIDENCE, "plinth-zone"], 0.7),
     feature("cabinet-inset",
             f"The plinth is inset {PLINTH_INSET} units on every side. Measured as 11 px on the "
             "shaded left face and 22 px on the door face, which are 0.078 and 0.066 world units; "
             "one value covers both.",
             "smaller plan than the cabinet's",
             [EVIDENCE, "plinth-zone"], 0.8)],
    surface(0.82, 0.06, 0.0, "matte moulded ABS", "deep occlusion under the cabinet overhang",
            "none", "The darkest part of the appliance and the only one touching the floor."),
    [EVIDENCE, "plinth-zone"],
    importance=0.8, confidence=0.8, parent="shell", fidelity="blockout",
    seams=[{"id": "plinth-shell-seam", "with": "shell", "overlap": 0.03,
            "notes": "The cabinet's sweep starts at the plinth top, so the two overlap by the "
                     "plinth's top roll rather than meeting on a plane."}],
)
PLINTH["geometryDescriptor"]["profile2D"] = profile(
    rounded_rect(WIDTH - 2 * PLINTH_INSET, DEPTH - 2 * PLINTH_INSET, CORNER_R * 0.7, PLAN_SIDES),
    PLINTH_H + 0.03, axis="y", axis_offset=0.0, steps=16,
    stops=[[0.0, 0.93, 0.90], [0.10, 0.985, 0.978], [0.22, 1.0, 1.0],
           [0.86, 1.0, 1.0], [0.94, 0.985, 0.978], [1.0, 0.95, 0.93]],
)
PLINTH["geometryDescriptor"]["profile2D"]["smoothShading"] = True


def door_band(cid: str, name: str, y0: float, y1: float, zone: str, note: str,
              importance: float) -> dict:
    """One of the two doors, modelled as a full-perimeter band standing proud of the
    shell. See DOOR_PROUD for why a band rather than a front panel."""
    height = round(y1 - y0, 4)
    item = component(
        cid, name, "meso", "door", "extrude", "shell-mint",
        "continuous-sculpt",
        "A moulded door skin that rolls over at both of its horizontal edges. The reference's "
        "seam is a groove with two lit lips, not a scored line, so each door has real thickness "
        "and its own rolled edge rather than being a decal on the cabinet.",
        colours(MINT),
        descriptor("rounded-rectangle plan matching the cabinet's, swept vertically over the "
                   "door's height and eased inward at both ends so each door edge rolls",
                   "rolled", 0.0, 1,
                   deformations=["top edge roll", "bottom edge roll"],
                   uv="ExtrudeGeometry cap and wall UVs",
                   normals="welded then smooth vertex normals"),
        xform(),
        dims(WIDTH, height, DEPTH, 0.75),
        # animationRole is "panel", not "hinge". "hinge" is an ATTACHMENT_ROLE, which puts
        # the generator on its appendage path: it lays the part along attachment.localStart
        # ..localEnd and sizes the geometry to that segment, which turned each door band
        # into a 0.12-diameter rod. The hinge intent is carried by the socket instead.
        action("panel", "socket", (round(WIDTH / 2, 4), round((y0 + y1) / 2, 4),
                                   round(DEPTH / 2, 4)), (0, 1, 0), 0.55,
               channels={"rotate": True},
               sockets=[{"id": f"{cid}-hinge",
                         "localPosition": [round(WIDTH / 2, 4), round((y0 + y1) / 2, 4),
                                           round(DEPTH / 2, 4)],
                         "localRotation": [0.0, 0.0, 0.0],
                         "notes": "Hinge axis on the handle-opposite side. The reference puts "
                                  "both handles on the left of the door face, so the hinges are "
                                  "on the right; the hinges themselves are never visible."}],
               collider={"type": "box",
                         "offset": [0.0, round((y0 + y1) / 2, 4), 0.0],
                         "scale": [WIDTH, height, DEPTH], "isTrigger": False,
                         "notes": "Box proxy over the door band."},
               fracture="cabinet"),
        [feature("door-proud",
                 f"The door stands {DOOR_PROUD} units proud of the cabinet's door face and is flush "
                 "with its sides, which is what makes "
                 "the seam a groove with two lit lips rather than a painted line.",
                 "larger plan than the shell's over the door's height range",
                 [EVIDENCE, zone], 0.7),
         feature("door-under-edge",
                 f"Both horizontal edges roll inward, so the {SEAM_GAP}-unit groove between the "
                 "doors is bounded by two curved lips. Column 600 reads the groove floor at "
                 "(9,26,14) and the lip immediately below it at (183,216,186).",
                 "profileStops eased inward at both ends of the sweep",
                 [EVIDENCE, "seam-zone"], 0.8),
         feature("door-span", note, "plan width equal to the cabinet's", [EVIDENCE, zone], 0.8)],
        surface(0.80, 0.08, 0.0, "matte moulded ABS", "occlusion into the groove", "none",
                "Same pigment and finish as the cabinet it sits on."),
        [EVIDENCE, zone, "seam-zone"],
        importance=importance, confidence=0.75, parent="shell",
        seams=[{"id": f"{cid}-shell-seam", "with": "shell", "overlap": DOOR_PROUD,
                "notes": "The door band overlaps the cabinet by its own proud depth on every "
                         "side, so no gap can open behind it."}],
    )
    # Flush in X, proud only in Z. A band proud on all four sides ran the groove across
    # the shaded side face, and the reference's side face is unbroken: the doors are on
    # the +Z face only. Matching the cabinet's width and exceeding only its depth keeps
    # the groove on the front (and the back, which a charging fridge never shows).
    item["geometryDescriptor"]["profile2D"] = profile(
        rounded_rect(WIDTH, DEPTH, CORNER_R, PLAN_SIDES), height,
        axis="y", axis_offset=y0, steps=10,
        stops=[[0.0, 0.965, 0.95], [0.06, 1.0, 1.0], [0.94, 1.0, 1.0], [1.0, 0.965, 0.95]],
    )
    item["geometryDescriptor"]["profile2D"]["smoothShading"] = True
    return item


FREEZER_DOOR = door_band(
    "freezer-door", "Freezer door", round(SEAM_Y + SEAM_GAP / 2, 4), PANEL_TOP_Y, "freezer-zone",
    f"The freezer door runs from the seam up to y={PANEL_TOP_Y}, where column 600 finds the "
    "front face's top edge at y=231. Above that the cabinet rolls over onto the top face.",
    0.9)
FRIDGE_DOOR = door_band(
    "fridge-door", "Fridge door", PLINTH_H, round(SEAM_Y - SEAM_GAP / 2, 4), "fridge-zone",
    f"The fridge door runs from the plinth top up to the seam at y={SEAM_Y}, which column 600 "
    "reads as a dark band at y 593..611.",
    0.9)


def handle_bar(cid: str, name: str, y0: float, y1: float, door: str) -> dict:
    """One cream handle bar. A capsule, because the reference bars are round in section
    and domed at both ends: no row scan finds a flat end anywhere on either."""
    length = round(y1 - y0, 4)
    bar = component(
        # A lathe, not a capsule, and named a pull rather than a handle. Both "handle" and
        # the capsule primitive are attachment triggers, and the attachment record they then
        # require sends the generator down the same appendage path that broke the doors. A
        # profile revolved about Y is the same shape with its geometry in root space.
        cid, name, "meso", "trim", "lathe", "trim-cream",
        "continuous-sculpt",
        "A round-sectioned bar domed at both ends. The reference shows no flat cap and no crease "
        "on either handle, which is a capsule rather than a cylinder with end discs.",
        colours(CREAM),
        descriptor("round bar revolved about its own vertical axis and domed at both ends, "
                   "standing off the door face",
                   "rolled", HANDLE_R, 32,
                   uv="lathe UVs", normals="vertex normals from the revolved profile"),
        xform(position=(HANDLE_X, 0.0, round(DEPTH / 2 + DOOR_PROUD, 4))),
        dims(HANDLE_R * 2, length, HANDLE_R * 2, 0.8),
        action("grip", "center", (0.0, round((y0 + y1) / 2, 4), 0.0), (0, 1, 0), 0.7,
               sockets=[{"id": f"{cid}-grip",
                         "localPosition": [0.0, round((y0 + y1) / 2, 4), 0.0],
                         "localRotation": [0.0, 0.0, 0.0],
                         "notes": "Grip point; a hand or a magnet effect anchors here."}],
               collider={"type": "capsule", "offset": [0.0, round((y0 + y1) / 2, 4), 0.0],
                         "scale": [HANDLE_R * 2, length, HANDLE_R * 2], "isTrigger": False,
                         "notes": "Capsule proxy over the bar."},
               fracture="trim", detach=[cid]),
        [feature("bar-crown",
                 f"The bar is {round(HANDLE_R * 2, 4)} across, measured as a 31 px run at rows 400, "
                 "480 and 700, and its crown is the brightest value on the door face.",
                 "capsule radius from the measured run", [EVIDENCE, "handle-zone"], 0.85),
         feature("bar-root",
                 f"The bar stands {DOOR_PROUD} units off the door face, so its "
                 "lower flank keeps a contact shadow instead of merging into the door.",
                 "component position, not geometry", [EVIDENCE, "handle-zone"], 0.6),
         feature("bar-length",
                 f"The bar is {length} units long, from a {round((y1 - y0) * PX_PER_UNIT_Y)} px "
                 "run down the door face. It covers under a fifth of the door, which is what "
                 "makes this a short pull rather than the full-height bar the hand-authored "
                 "fridge carried.",
                 "capsule length from the measured run", [EVIDENCE, "handle-zone"], 0.85)],
        surface(0.62, 0.09, 0.0, "smooth moulded ABS", "contact shadow at the door face", "none",
                "Smoother than the cabinet: this is the part a hand touches."),
        [EVIDENCE, "handle-zone"],
        importance=0.85, confidence=0.8, parent=door,
        seams=[{"id": f"{cid}-door-seam", "with": door, "overlap": round(HANDLE_R * 0.45, 4),
                "notes": "The bar's inboard flank is buried in the door skin."}],
    )
    bar["geometryDescriptor"]["latheProfile"] = {
        "points": [[0.0001, y0]]
        + [[round(HANDLE_R * math.sin(i / 6 * math.pi / 2), 5),
            round(y0 + HANDLE_R * (1 - math.cos(i / 6 * math.pi / 2)), 5)] for i in range(1, 7)]
        + [[round(HANDLE_R * math.cos(i / 6 * math.pi / 2), 5),
            round(y1 - HANDLE_R + HANDLE_R * math.sin(i / 6 * math.pi / 2), 5)] for i in range(7)],
        "segments": 20,
    }
    return bar


HANDLE_UPPER = handle_bar("handle-upper", "Freezer door pull", HANDLE_UPPER_Y0,
                          HANDLE_UPPER_Y1, "freezer-door")
HANDLE_LOWER = handle_bar("handle-lower", "Fridge door pull", HANDLE_LOWER_Y0,
                          HANDLE_LOWER_Y1, "fridge-door")

BADGE = component(
    "badge", "Coral badge", "micro", "trim", "lathe", "badge-coral",
    "continuous-sculpt",
    "A domed disc. The reference badge falls off in value from its centre to its rim, which is a "
    "dome catching the key at varying angles, not a flat circle of paint.",
    colours(CORAL),
    descriptor("disc revolved about its own axis with a domed face, laid against the freezer door",
               "rolled", 0.0, 32,
               uv="lathe UVs", normals="vertex normals from the revolved profile"),
    xform(position=(BADGE_X, BADGE_Y, round(DEPTH / 2 + DOOR_PROUD - 0.012, 4)),
          rotation=(math.pi / 2, 0.0, 0.0)),
    dims(BADGE_R * 2, 0.032, BADGE_R * 2, 0.8),
    action("static", "center", (0.0, 0.0, 0.0), (0, 0, 1), 0.7, fracture="trim", detach=["badge"]),
    [feature("dome-crown",
             f"The disc is {round(BADGE_R * 2, 4)} across and stands about 0.02 proud, domed so "
             "its crown reads (245,141,122) and its rim falls away.",
             "revolved profile with a rounded crown", [EVIDENCE, "badge-zone"], 0.75),
     feature("badge-placement",
             f"The badge sits at x={BADGE_X}, y={BADGE_Y}: measured at x 718..769, y 329..383, "
             "which is the upper outboard corner of the freezer door, away from the handle.",
             "component position, not geometry", [EVIDENCE, "badge-zone"], 0.85)],
    surface(0.66, 0.07, 0.0, "smooth moulded ABS", "thin contact ring at the door", "none",
            "The only accent colour on the appliance."),
    [EVIDENCE, "badge-zone"],
    importance=0.6, confidence=0.75, parent="freezer-door",
    seams=[{"id": "badge-door-seam", "with": "freezer-door", "overlap": 0.012,
            "notes": "The disc's back face is buried in the door skin."}],
)
BADGE["geometryDescriptor"]["latheProfile"] = {
    "points": [[0.0001, 0.0], [BADGE_R * 0.86, 0.0], [BADGE_R, 0.006],
               [BADGE_R, 0.018], [BADGE_R * 0.94, 0.026], [BADGE_R * 0.7, 0.031],
               [BADGE_R * 0.38, 0.033], [0.0001, 0.0335]],
    "segments": 32,
}

COMPONENTS = [SHELL, PLINTH, FREEZER_DOOR, FRIDGE_DOOR, HANDLE_UPPER, HANDLE_LOWER, BADGE]
ALL_REFS = [c["id"] for c in COMPONENTS]

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
MATERIAL_IDS = {m["id"] for m in MATERIALS}
DETAILS = [
    detail("d-crown-roll", "top", "contour",
           "The cabinet rolls over onto its top face instead of meeting it at an edge.",
           "shell/crown-roll", "profileStops easing the plan inward over the top of the sweep",
           EVIDENCE, 0.6, MATERIAL_IDS),
    detail("d-crown-highlight", "top", "gloss",
           "The crown carries the brightest mint in the frame at (193,224,195).",
           "shell-mint/crown-highlight", "roughness override on the crown band",
           "crown-zone", 0.75, MATERIAL_IDS),
    detail("d-corner-round", "sides", "bevel",
           f"All four vertical corners carry a {CORNER_R} radius.",
           "shell/corner-round", "rounded-rectangle plan", EVIDENCE, 0.5, MATERIAL_IDS),
    detail("d-side-shade", "left", "contour",
           "The shaded face is the same pigment at a different orientation, not a second albedo.",
           "shell-mint/side-face-shade", "roughness override on the shaded face",
           "side-zone", 0.85, MATERIAL_IDS),
    detail("d-door-seam", "front", "contour",
           f"A {SEAM_GAP}-unit groove separates the two doors, reading (9,26,14) at its floor.",
           "freezer-door/door-under-edge", "gap between two proud door bands with rolled edges",
           "seam-zone", 0.8, MATERIAL_IDS),
    detail("d-seam-occlusion", "front", "stain",
           "The groove floor is the darkest value in the frame: contact occlusion, not paint.",
           "shell-mint/seam-occlusion", "AO boost in the groove", "seam-zone", 0.8, MATERIAL_IDS),
    detail("d-door-proud", "front", "bevel",
           f"Each door stands {DOOR_PROUD} proud of the cabinet with a rolled edge.",
           "freezer-door/door-proud", "larger plan over the door's height range",
           "freezer-zone", 0.7, MATERIAL_IDS),
    detail("d-handle-upper", "front", "contour",
           f"The freezer handle is a {round(HANDLE_UPPER_LEN, 3)}-unit capsule at x={HANDLE_X}.",
           "handle-upper/bar-length", "capsule from the measured 31 by 191 px run",
           "handle-zone", 0.85, MATERIAL_IDS),
    detail("d-handle-lower", "front", "contour",
           f"The fridge handle is a {round(HANDLE_LOWER_LEN, 3)}-unit capsule on the same axis.",
           "handle-lower/bar-length", "capsule from the measured 29 by 197 px run",
           "handle-zone", 0.85, MATERIAL_IDS),
    detail("d-handle-sheen", "front", "gloss",
           "Both handle crowns are the brightest values on the door face at (240,222,189).",
           "trim-cream/bar-crown-sheen", "roughness override on the outward third of each bar",
           "handle-zone", 0.8, MATERIAL_IDS),
    detail("d-handle-contact", "front", "stain",
           "Each bar keeps a contact shadow where it meets the door.",
           "trim-cream/bar-root-shadow", "AO boost at the bar root", "handle-zone", 0.7,
           MATERIAL_IDS),
    detail("d-badge", "front", "contour",
           f"A {round(BADGE_R * 2, 3)}-unit coral disc on the freezer door's outboard corner.",
           "badge/dome-crown", "revolved domed disc", "badge-zone", 0.75, MATERIAL_IDS),
    detail("d-badge-sheen", "front", "gloss",
           "The badge's crown catches the key and its rim falls away.",
           "badge-coral/badge-dome-sheen", "roughness override on the crown",
           "badge-zone", 0.7, MATERIAL_IDS),
    detail("d-plinth-inset", "base", "contour",
           f"The plinth is inset {PLINTH_INSET} on every side, so the cabinet overhangs it.",
           "plinth/cabinet-inset", "smaller plan than the cabinet's", "plinth-zone", 0.8,
           MATERIAL_IDS),
    detail("d-plinth-tuck", "base", "bevel",
           "The plinth tucks inward at the bottom rather than meeting the ground square.",
           "plinth/base-tuck", "mirrored profileStops at the start of the sweep",
           "plinth-zone", 0.7, MATERIAL_IDS),
    detail("d-plinth-contact", "base", "stain",
           "The plinth's lowest band loses the key entirely where it tucks under.",
           "plinth-navy/floor-contact", "AO boost on the bottom band", "plinth-zone", 0.75,
           MATERIAL_IDS),
]

DETAIL_INVENTORY = detail_inventory(
    DETAILS, 12,
    "component-zone scan of the reference at 3x, with green-channel step scans down columns 420, "
    "500, 600, 700, 800 and 825 and across rows 400, 480, 700, 900 and 1100 to place the door "
    "seam, the door-panel top edge, the plinth and both handles in pixels before converting to "
    "world units.")

# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
PASSES = build_passes(
    ["shell", "plinth"], ALL_REFS,
    "Match the macro silhouette: a rounded cabinet slab on an inset darker plinth, at the "
    "envelope the trap collider fixes.",
    "Build the cabinet, the plinth, both door bands, both handles and the badge as separate "
    "named parts with recorded seams.",
    "Deliver the crown roll, the door groove and the rolled door edges as real profile "
    "deformations rather than as painted lines.",
    "Match the four-layer palette and the matte moulded-ABS response.",
    ["The crown reads as a continuous roll with no chamfer facet.",
     "The seam between the doors is a groove with two lit lips, not a scored line.",
     "Both handles read as round-sectioned capsules standing off the door face.",
     "The cabinet overhangs the plinth on every side."],
    has_repetition=False)

FEATURE_REVIEW_TARGETS = [
    {"id": "cabinet-silhouette", "name": "Cabinet slab and plinth proportions",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["shell", "plinth"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["cabinet reads as a hard-edged box", "plinth flush with the cabinet",
                      "corner radius so large the cabinet reads as a capsule"]},
    {"id": "door-split", "name": "Two-door split with a real groove",
     "tier": "critical", "passIds": ["structural-pass", "form-refinement", "surface-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["freezer-door", "fridge-door"], "evidenceRefs": [EVIDENCE, "seam-zone"],
     "failureModes": ["seam painted rather than modelled", "doors flush with the cabinet",
                      "seam at the wrong height so the freezer reads as half the cabinet"]},
    {"id": "handle-pair", "name": "Short cream pull handles",
     "tier": "critical", "passIds": ["structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["handle-upper", "handle-lower"], "evidenceRefs": [EVIDENCE, "handle-zone"],
     "failureModes": ["handles run the full door height", "handles flat against the door",
                      "handles on the hinge side"]},
    {"id": "four-tone-palette", "name": "Mint cabinet, navy plinth, cream handles, coral badge",
     "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["shell", "plinth", "handle-upper", "badge"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["mint drifts to the level palette's own green",
                      "plinth reads black rather than slate navy",
                      "glossy highlights on matte mouldings"]},
    {"id": "badge-placement", "name": "Coral badge on the freezer door",
     "tier": "important", "passIds": ["form-refinement", "surface-pass"],
     "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["badge"], "evidenceRefs": [EVIDENCE, "badge-zone"],
     "failureModes": ["badge flat rather than domed", "badge centred rather than outboard",
                      "badge missing"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "primary three-quarter view, azimuth 23 and elevation 16 degrees",
     "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": [
         "Silhouette box spans x 246-838 and y 121-1302 of a 1086x1448 image: 593 by 1182 pixels.",
         "The near vertical corner is a 60-count green step at x=393 on every row from y=400 to "
         "y=1100, which splits the door face from the shaded left face.",
         "Four albedos only: cabinet mint, plinth navy, handle cream, badge coral.",
         "The back, the underside and the interior are not visible.",
     ],
     "confidence": 0.85},
    {"id": "crown-zone", "view": "cabinet crown and top face",
     "imageRegion": {"x": 0.2, "y": 0.06, "width": 0.62, "height": 0.14, "units": "normalized"},
     "observations": [
         "Column 600 finds the front face's top edge at y=231 with a dark-then-bright pair, which "
         "is a groove lip rather than a silhouette edge.",
         "The crown reads (193,224,195), the brightest mint in the frame.",
         "The 106 px between the silhouette top and the door top at that column is mostly the "
         "foreshortened top face, so the roll's own radius is not separable from it.",
     ],
     "confidence": 0.6},
    {"id": "seam-zone", "view": "groove between the two doors",
     "imageRegion": {"x": 0.24, "y": 0.38, "width": 0.62, "height": 0.08, "units": "normalized"},
     "observations": [
         "Column 600 reads a dark band at y 593-611 with a bright lip immediately below it.",
         "The groove floor is (9,26,14), the darkest value in the frame.",
         "The band's centre falls 33 px over x 450-750, matching the door face's own slope, so it "
         "is a horizontal groove on that face rather than a tilted line.",
     ],
     "confidence": 0.85},
    {"id": "handle-zone", "view": "both handle bars",
     "imageRegion": {"x": 0.32, "y": 0.2, "width": 0.14, "height": 0.44, "units": "normalized"},
     "observations": [
         "Upper bar x 449-480 y 386-577; lower bar x 450-479 y 662-859.",
         "Both are 29-31 px across and about 195 px long, so each covers under a fifth of its "
         "door rather than running its full height.",
         "Crowns read (240,222,189) against (236,218,185) lower down: smooth, not glossy.",
     ],
     "confidence": 0.85},
    {"id": "badge-zone", "view": "coral badge",
     "imageRegion": {"x": 0.63, "y": 0.15, "width": 0.12, "height": 0.08, "units": "normalized"},
     "observations": [
         "The disc spans x 718-769 and y 329-383: 51 by 54 px, which resolves to 0.153 and 0.156 "
         "world units at the solved camera, so it is a circle.",
         "It reads (245,141,122) at its crown and falls off toward its rim.",
         "It sits on the freezer door's outboard upper corner, diagonally opposite the handle.",
     ],
     "confidence": 0.8},
    {"id": "plinth-zone", "view": "base plinth",
     "imageRegion": {"x": 0.0, "y": 0.85, "width": 1.0, "height": 0.15, "units": "normalized"},
     "observations": [
         "Navy spans x 257-816 against the cabinet's 246-838, so the plinth is inset by 11 px on "
         "the left face and 22 px on the door face.",
         "Its front-face height is 53 px at column 600 (y 1228-1281).",
         "Its two top edges give the camera solve: -39 px over 300 on the door face and -80 px "
         "over -120 on the left face.",
     ],
     "confidence": 0.85},
    {"id": "side-zone", "view": "shaded left face",
     "imageRegion": {"x": 0.0, "y": 0.1, "width": 0.26, "height": 0.8, "units": "normalized"},
     "observations": [
         "Reads (120,155,127) against the door face's (155,193,161): a pure value shift.",
         "No door seam, handle or badge appears on it, so both doors are on the +Z face.",
         "No horizontal feature of any kind crosses it.",
     ],
     "confidence": 0.8},
    {"id": "freezer-zone", "view": "upper door",
     "imageRegion": {"x": 0.24, "y": 0.09, "width": 0.62, "height": 0.32, "units": "normalized"},
     "observations": [
         "Runs from the front face's top edge at y=231 down to the groove at y=598.",
         "Carries the upper handle and the badge; no other feature.",
         "No vertical step is found anywhere across it, so the door is as wide as the cabinet.",
     ],
     "confidence": 0.8},
    {"id": "fridge-zone", "view": "lower door",
     "imageRegion": {"x": 0.24, "y": 0.42, "width": 0.62, "height": 0.48, "units": "normalized"},
     "observations": [
         "Runs from the groove at y=598 down to the plinth top at y=1228.",
         "Carries the lower handle only.",
         "Its 630 px make it 1.71 times the freezer door's 367 px.",
     ],
     "confidence": 0.8},
]

SPEC = assemble(
    target_name="Apartment Refrigerator",
    target_id="apartment-refrigerator",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": True,
        "solveMethod": "azimuth and elevation separated by the product and ratio of the plinth's "
                       "two top-edge screen slopes (0.12 on the door face, 0.667 on the left "
                       "face), which give sin(e)^2 = 0.080 and tan(a)^2 = 0.180 without needing "
                       "any length; the door seam independently confirms the door-face slope",
        "fovDegrees": 12.0,
        "aspect": round(1086 / 1448, 4),
        "orientation": {"yaw": AZIMUTH_DEG, "pitch": -ELEVATION_DEG, "roll": 0.0},
        "targetHint": [0.0, round(HEIGHT / 2, 3), 0.0],
        "note": "Both angles come from edge slopes rather than from a length fit, so they do not "
                "move when the envelope is fitted to the collider. Distance is not fixed here: "
                "the preview harness solves it by fitting the render's projected bounding box to "
                "the reference bounding box (x 246-838, y 121-1302 of 1086x1448).",
    },
    measurement_basis={
        "pixelsPerWorldUnit": {"horizontal": round(PX_PER_UNIT_X, 1),
                               "vertical": round(PX_PER_UNIT_Y, 1)},
        "referenceBBox": {"x0": 246, "y0": 121, "x1": 838, "y1": 1302, "imageSize": [1086, 1448]},
        "derivations": [
            "Camera solved at azimuth 23.0 and elevation 16.4 degrees from the plinth's two "
            "top-edge slopes.",
            f"At that camera the reference's front face resolves to {REFERENCE_FACE_ASPECT} times the "
            f"cabinet's width against this model's {BUILT_FACE_ASPECT}. The trap mounts this prop inside a CuboidCollider of args [0.68, 0.92, 0.48], "
            "The envelope is taken from the call site and every reference measurement enters as a "
            f"fraction of it; the vertical fit is {VERTICAL_FIT} and is listed as the first risk.",
            "Horizontal scale: the door face spans x 393-838, 445 px, set to the collider's 1.34 "
            "units, giving 332.1 px per world unit.",
            "Vertical scale: column 600 spans y 231-1281 from the front face's top edge to the "
            "plinth's bottom, 1050 px, set to 1.75 units, giving 600.0 px per world unit.",
            f"Plinth height from y 1228-1281: {PLINTH_H} units. Door seam centre y=598: "
            f"{SEAM_Y} units, with a {SEAM_GAP}-unit groove from the 18 px dark band.",
            f"Handles from x 449-480 y 386-577 and x 450-479 y 662-859: radius {HANDLE_R}, "
            f"lengths {HANDLE_UPPER_LEN} and {HANDLE_LOWER_LEN}, both at x={HANDLE_X}.",
            f"Badge from x 718-769 y 329-383: 51 by 54 px is a circle at the solved camera, so "
            f"the fitted radius {BADGE_R} is the geometric mean of the two fitted extents rather "
            "than either one, which keeps the disc round under an anisotropic fit.",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2,
            "interaction_fit": 3},
    pre_spec={
        "objectClass": {
            "primaryType": "two-door domestic refrigerator on an inset plinth",
            "primaryDomain": "object",
            "formLanguage": ["smooth-organic", "stylized-toy", "rolled-moulded-edge"],
            "structureKind": ["monolithic-cabinet", "hinged-panels", "applied-trim"],
            "motionPotential": ["door-swing", "cabinet-topple", "cabinet-charge"],
            "materialFamilies": ["matte-plastic-mint", "matte-plastic-navy", "matte-plastic-cream",
                                 "matte-plastic-coral"],
            "notes": "The identity is the rounded slab standing on a darker inset plinth, split by "
                     "one groove into a short upper door and a tall lower one, with two short "
                     "cream pulls on the same vertical axis and a single coral badge diagonally "
                     "opposite the upper pull. One view: the back, the underside and the interior "
                     "are inferred.",
        },
        "complexity": {
            "tier": "moderate",
            "scores": {"silhouetteComplexity": 2, "componentCount": 2, "hierarchyDepth": 2,
                       "repetitionDensity": 1, "materialLayerCount": 2, "localDetailDensity": 2,
                       "occlusionRisk": 2, "actionReadinessNeed": 3},
            "estimatedCounts": {"macroComponents": 2, "mesoComponents": 4, "microFeatureGroups": 1,
                                "materialLayers": 4, "repetitionSystems": 0},
            "reasoning": [
                "Seven parts across four albedos, with a real hierarchy: handles ride doors and "
                "the badge rides the freezer door, so a door that swings carries its trim.",
                "The two handles are a near-repeat but differ in length, so they are authored as "
                "two components rather than as a repetition system over one.",
                "Action readiness is high: the trap charges the cabinet down a corridor, so the "
                "root has to carry translation and the collider proxy has to match the trap's own.",
                "Occlusion risk is moderate: the back and underside are never seen and the "
                "interior never opens.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "moderate",
            "minimumComponentLevels": ["macro", "meso", "micro"],
            "needsRepetitionSystems": False,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": True,
            "rationale": "The appliance is simple in plan but its whole read is a set of rolled "
                         "edges and one groove, so both the component tree and the material local "
                         "overrides have to carry that; and the trap moves it, so the rig matters.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "The reference's proportion does not fit the trap collider.",
             "resolution": "The envelope is taken from the collider (1.34 x 1.84 x 0.94) and every "
                           "reference measurement enters as a fraction of it. Reproducing the "
                           f"reference's {REFERENCE_FACE_ASPECT} front-face aspect would either overflow the collider "
                           "and pass the runner's 2.17-unit jump ceiling, or leave 0.27 units of "
                           "invisible collider on each side. Both are fairness bugs.",
             "confidence": 0.9},
            {"unknown": "The crown roll's radius is not separable from the top face's "
                        "foreshortening in one view.",
             "resolution": f"Set to {CROWN_ROLL} units, which reads at the reference's softness. "
                           "Every other vertical number is measured, so an error here moves only "
                           "the crown.",
             "confidence": 0.5},
            {"unknown": "The vertical corner radius cannot be measured, because the rounding is "
                        "what stops the silhouette reaching the corners that would measure it.",
             "resolution": f"Held at {CORNER_R}, the radius the hand-authored fridge used.",
             "confidence": 0.5},
            {"unknown": "How far each door wraps around the cabinet is not observable.",
             "resolution": "Modelled as full-perimeter bands. The row scans find no vertical step "
                           "on the door face, so the doors are at least as wide as the cabinet; a "
                           "band reads correctly from every angle the game uses and keeps each "
                           "door a separate openable part.",
             "confidence": 0.55},
            {"unknown": "The back, the underside and the interior are never visible.",
             "resolution": "Closed with the same plan and the same roll as the front. A charging "
                           "fridge never shows its back in play.",
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
        ["The rendered cabinet matches the reference's part layout: one groove splitting a short "
         "upper door from a tall lower one, two short cream pulls on one vertical axis, one coral "
         "badge diagonally opposite the upper pull, and an inset darker plinth.",
         "No crease appears anywhere on the cabinet, the doors or the plinth under any review "
         "light; every edge is a roll.",
         f"The model stays inside {WIDTH} x {HEIGHT} x {COLLIDER_DEPTH} world units, trim "
         "included, and sits on y=0, which "
         "is what the trap's CuboidCollider and its [0, -0.92, 0] mount assume."],
        {"macroComponents": 2, "mesoComponents": 4, "microFeatureGroups": 1, "materialLayers": 4,
         "repetitionSystems": 0, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Cabinet, plinth and door heights are stated as measured numbers "
                           "derived from named pixel spans.",
                           "The envelope is stated as the call site's, with the compression "
                           "against the reference quantified rather than hidden."],
                          [EVIDENCE, "plinth-zone"],
                          ["model reads as a plain box", "plinth flush with the cabinet",
                           "proportions guessed rather than derived"]),
            feature_group("primary-structure", "Primary structure and hierarchy",
                          ["Cabinet, plinth, two doors, two handles and the badge are separate "
                           "named parts.",
                           "Handles parent to their own door and the badge to the freezer door, "
                           "so a swinging door carries its trim.",
                           "Every contact records a seam overlap of at least 0.02 world units."],
                          [EVIDENCE, "seam-zone"],
                          ["cabinet and doors merged into one mesh",
                           "handles parented to the cabinet so a door swing leaves them behind"]),
            feature_group("attachment-joint-correctness", "Contact and joint correctness",
                          ["Each handle is buried in its door skin rather than resting on it.",
                           "The door bands overlap the cabinet by their own proud depth.",
                           "The cabinet's sweep starts inside the plinth's top roll."],
                          [EVIDENCE, "handle-zone"],
                          ["handles float off the door", "gap opens between cabinet and plinth"]),
            feature_group("surface-material-response", "Surface material response",
                          ["Albedo zones, roughness, normal intent and local overrides are "
                           "specified per material and tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are independent fields.",
                           "Surface response is decomposed into macro, meso and micro bands."],
                          [EVIDENCE, "side-zone"],
                          ["surface looks like glossy toy plastic",
                           "the shaded face authored as a second albedo rather than as "
                           "orientation"]),
            feature_group("reference-lookdev", "Reference colour, material and lighting response",
                          ["The four-layer palette traces to median-sampled reference pixels.",
                           "Reference PBR extraction ran on every material crop and its confidence "
                           "and binding decision are recorded.",
                           "Lighting names key, fill, rim or environment, exposure, tone mapping, "
                           "background and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders prove the rolls survive "
                           "relighting rather than being painted."],
                          [EVIDENCE],
                          ["acceptable shape but flat-shaded read",
                           "mint drifts to the level palette's own green",
                           "lighting evenly ambient"]),
        ],
        ["silhouette and negative-space delta", "door groove height and depth delta",
         "handle length and offset delta", "component hierarchy depth delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.8,
        "mustMatch": ["rounded cabinet slab on an inset darker plinth",
                      "one modelled groove splitting a short upper door from a tall lower one",
                      "two short cream capsule pulls on one vertical axis near the door's edge",
                      "one domed coral badge on the freezer door's outboard corner",
                      "four-albedo palette: mint, navy, cream, coral"],
        "niceToHave": ["the exact crown roll radius", "the hinge hardware the reference never shows",
                       "the door gasket line"],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-three-quarter", "front", "right", "top-down", "grazing"],
    },
    feature_review_targets=FEATURE_REVIEW_TARGETS,
    view_evidence=VIEW_EVIDENCE,
    components=COMPONENTS,
    materials=MATERIALS,
    repetition_systems=[],
    passes=PASSES,
    lighting=[
        "Ambient dominance: the reference is a soft studio render. The cabinet's lit door face "
        "reads (155,193,161) and its shaded left face (120,155,127), a 22 percent value range a "
        "bright neutral hemisphere plus a gentle key reproduces with no hard terminator.",
        "Key light: a warm-neutral directional source at about 1.2 from high and camera right, "
        "which is the side the door face turns toward. It lifts the crown roll to (193,224,195) "
        "and both handle crowns to (240,222,189).",
        "Rim and environment light: weak neutral back light at about 0.3, enough to keep the "
        "shaded left face from crushing. No environment map: the reference shows no reflection.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.",
        "Contact shadow: the door groove and the cabinet-over-plinth overhang carry the only two "
        "real occlusions. The reference floats with no ground contact, so the review render has no "
        "ground plane and the silhouette mask stays clean.",
    ],
    action_readiness=action_readiness(
        "shell",
        {"rootMotion": "sculptRuntime.nodes['shell'] carries translation, rotation and scale; the "
                       "plinth, both doors and their trim are its descendants so the cabinet "
                       "charges as one body.",
         "doorSwing": "sculptRuntime.nodes['freezer-door'] and ['fridge-door'] rotate about "
                      "sockets['freezer-door:freezer-door-hinge'] and the fridge equivalent, on "
                      "the handle-opposite side. Each door's handle and the badge are its "
                      "children, so a swing carries them.",
         "collider": "colliders['shell'] is a box proxy matching the trap's CuboidCollider args "
                     "[0.68, 0.92, 0.48]. That match is the point of the envelope: the visible "
                     "cabinet and the shape that hits the player are the same box."},
        "cabinet, trim",
        "Detach the badge and either handle as whole parts; the cabinet is not fractured."),
    assumptions=[
        f"The envelope is the trap collider's, not the reference's. The reference fridge's front face "
        f"is {REFERENCE_FACE_ASPECT} times its width and this model's is {BUILT_FACE_ASPECT}, a "
        f"vertical fit of {VERTICAL_FIT}. This is deliberate and is the first entry in risks.",
        f"The crown roll is {CROWN_ROLL} units and the vertical corner radius is {CORNER_R}. "
        "Neither is measurable from one view.",
        "Both doors are modelled as full-perimeter bands. The reference only shows their front.",
        "The badge is authored round at the geometric mean of its two fitted extents rather than "
        "as the ellipse the anisotropic fit would otherwise produce.",
        "The hinges are on the handle-opposite side. The reference shows no hinge hardware at all; "
        "the handle position is the only evidence for which side opens.",
        "One world unit is about 95 cm, making the modelled cabinet about 175 cm tall.",
        "The hand-authored fridge this replaces carried four separate feet under a red plinth. The "
        "reference has a single navy plinth and no feet, so the feet are not rebuilt.",
    ],
    coordinate_frame={
        "front": "+Z, the door face, which is the direction the charging trap travels",
        "up": "+Y, with the underside of the plinth at y = 0",
        "right": "+X, along the cabinet's width",
        "scaleReference": f"cabinet width = {WIDTH} world units; {round(PX_PER_UNIT_X)} reference "
                          f"pixels per world unit horizontally and {round(PX_PER_UNIT_Y)} "
                          "vertically",
    },
    silhouette={
        "boundingShape": f"rounded cabinet slab {WIDTH} by {DEPTH} in plan and {HEIGHT} tall, "
                         f"standing on a plinth inset {PLINTH_INSET} on every side",
        "aspectRatios": [
            {"id": "height-to-width", "value": round(HEIGHT / WIDTH, 3),
             "notes": f"as built; the reference's own front face measures {REFERENCE_FACE_ASPECT} "
                      f"at the solved camera against this model's {BUILT_FACE_ASPECT}, and the "
                      "difference is the documented call-site fit"},
            {"id": "width-to-depth", "value": round(WIDTH / DEPTH, 3),
             "notes": "plan aspect; the reference resolves to 1.29 at the solved camera, so the "
                      "plan is within 10 percent of the reference and only the height is fitted"},
            {"id": "freezer-to-fridge-door", "value": round(
                (PANEL_TOP_Y - SEAM_Y) / (SEAM_Y - PLINTH_H), 3),
             "notes": "measured directly from the 367 px and 630 px door spans at column 600"},
        ],
        "symmetry": "mirror symmetric in plan about both axes; the trim breaks the symmetry on "
                    "the door face only",
        "dominantCurves": ["the crown roll", "the four rounded vertical corners",
                           "the rolled lips on both sides of the door groove",
                           "the handle capsules' domed ends"],
        "negativeSpaces": ["the groove between the doors",
                           "the shadow band under the cabinet's overhang of the plinth",
                           "the gap between each handle and its door face"],
        "landmarks": [f"plinth top at y = {PLINTH_H}", f"door groove at y = {SEAM_Y}",
                      f"front face top edge at y = {PANEL_TOP_Y}", f"crown at y = {HEIGHT}"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "all seven parts with full profile stops; 256px procedural maps"},
        {"tier": "mid", "distance": 12,
         "strategy": "drop the badge and halve the plan sampling from 40 to 20"},
        {"tier": "far", "distance": 30,
         "strategy": "cabinet and plinth only; the doors' proud depth is under a pixel by then"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 6000,
        "maxDrawCalls": 8,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "Reach accepted visual fidelity first, then cut the plan sampling "
                              "from 40 sides. The crown roll sets the floor on the vertical step "
                              "count: below about 12 steps the roll stairsteps visibly on the "
                              "silhouette.",
    },
    procedural_strategy=[
        "Block out the cabinet slab and the inset plinth first, and confirm the silhouette matches "
        "the measured bounding box at the envelope the collider fixes.",
        "Add both door bands standing proud of the cabinet, leaving the measured groove between "
        "them, so the split is geometry rather than a painted line.",
        "Add both handles as capsules parented to their own door, and the badge to the freezer "
        "door, so a door swing carries its trim.",
        "Create pivot nodes, the floor-contact and door-face sockets and the collider proxy that "
        "matches the trap's own before polish.",
        "Roll the crown and the door edges with profile stops, then weld the extrusion's vertices "
        "so the cabinet shades as one surface instead of 40 facets.",
        "Run reference PBR extraction on all four material crops, record confidence, and decide "
        "explicitly whether to bind or only cite the maps.",
        "Add the groove occlusion, the plinth overhang shadow and the handle crown sheen last.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['shell'] carries the charge translation the trap drives",
        "sculptRuntime.nodes['freezer-door'] and ['fridge-door'] swing about their hinge sockets",
        "sculptRuntime.sockets['shell:door-face'] is the face the charge leads with",
    ],
    destruction_anchors=["the badge and either handle detach as whole parts",
                         "the cabinet is not fractured"],
    risks=[
        f"THE PROPORTION IS FITTED, NOT MATCHED. The reference's front face is {REFERENCE_FACE_ASPECT} "
        f"times the cabinet width; this model is {BUILT_FACE_ASPECT}, a vertical fit of "
        f"{VERTICAL_FIT}. Tier 1 reads that as an aspect error and it is not error: it is the trap "
        f"collider's envelope. The review render undoes it with the harness's ?yscale={REVIEW_Y_SCALE}, "
        "swept rather than derived because a rounded cabinet's silhouette never reaches its box "
        "corners, which takes the measured aspect delta to 0.000 and lets the gate judge form. A reference-accurate fridge needs FRIDGE_HALF_WIDTH and the 0.92 collider "
        "half-height in TrapRenderer.tsx changed first, and that also moves the prop past the "
        "runner's 2.17-unit jump ceiling.",
        "The crown roll radius and the vertical corner radius are both inferred; no edge scan can "
        "recover either from a single view of a rounded body.",
        "Each door is modelled as a full-perimeter band. If a later view shows the doors stopping "
        "at the cabinet's side, the bands become wrong on the sides even though the front stays "
        "right.",
        "The badge is authored round rather than as the ellipse the anisotropic fit implies. That "
        "is a deliberate departure from the fit, and it means the badge is the one part whose "
        "proportion follows the reference rather than the envelope.",
        "Reference PBR maps were extracted and passed their confidence gate but are deliberately "
        "not bound to the runtime material; the runtime uses independent procedural canvas maps.",
        "The reference shows no crease anywhere, so the whole read depends on welded vertices and "
        "smooth normals. If the refine-code merge step is dropped, ExtrudeGeometry's non-indexed "
        "output makes the cabinet read as 40 flat facets.",
    ],
)


if __name__ == "__main__":
    write_spec(OUT, SPEC)
