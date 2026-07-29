#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment claw hammer on its wall bracket.

Every dimension below is derived from pixel measurements of
assets/reference/hammer-reference.png; the derivation is recorded in
`measurementBasis` inside the spec so a later session can re-check it. The spec is
large and repetitive, so it is generated here rather than hand-edited as JSON.

Run:  python author_hammer_spec.py
Writes: hammer-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math
from pathlib import Path

from spec_lib import (
    action, action_readiness, assemble, build_passes, colours, component,
    descriptor, detail, detail_inventory, dims, feature, feature_group,
    material, override, quality_contract, surface, write_spec, xform,
)

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "hammer-reference.png")
OUT = HERE / "hammer-sculpt-spec.json"

# ---------------------------------------------------------------------------
# Frame contract
# ---------------------------------------------------------------------------
# The origin is the butt of the handle and the head extends along +Y, because that
# is the frame components/game/models/MechProps.tsx documents for the prop this
# replaces, and components/game/TrapRenderer.tsx already positions and rotates for
# it (AssetModel at [0,-2.25,0], rotation [0,0,pi/2]). Authoring in any other frame
# would require editing TrapRenderer, which this asset does not own, so the frame
# is treated as fixed. Striking face points along -X, the claw hooks along +X,
# depth runs in Z.

# ---------------------------------------------------------------------------
# Measured geometry
# ---------------------------------------------------------------------------
# The reference is 1086x1448 with the object mask spanning x 153-974, y 144-1290,
# so the silhouette is 822 x 1147 px. Overall prop length is held at 2.20 world
# units to preserve the envelope of the prop being replaced, which puts 1146 px of
# silhouette height on 2.20 units.
PX_PER_UNIT = 1146.0 / 2.20               # 520.9 px per world unit
K = 1.0 / PX_PER_UNIT                     # 0.0019197 world units per px
HANDLE_AXIS_PX = 586.0                    # median x of the cream handle runs
BASE_PY = 1290.0                          # bottom row of the handle butt


def wy(py: float) -> float:
    """Model Y from a reference row."""
    return round((BASE_PY - py) * K, 4)


def wx(px: float) -> float:
    """Model X from a reference column, measured off the handle axis."""
    return round((px - HANDLE_AXIS_PX) * K, 4)


def wl(px: float) -> float:
    """A length in world units from a length in pixels."""
    return round(px * K, 4)


# Handle. Each radius is half the measured cream run at that row; the run widths
# are quoted in measurementBasis. The handle is ONE cream lathe from the butt at
# y=0 to the crown at y=2.20, because in the reference the shaft passes through the
# head's eye and its end shows on top of the head as a cream boss. Modelling it as
# a single revolved part is what the photo shows, rather than two parts that happen
# to line up.
HANDLE_PROFILE = [
    [0.010, 0.000],        # closed butt tip
    [0.079, wy(1280)],     # 0.0192  run 553-634
    [0.170, wy(1240)],     # 0.0960  run 506-682
    [0.190, wy(1180)],     # 0.2112  run 495-692
    [0.207, wy(1120)],     # 0.3264  run 478-693, the widest point
    [0.199, wy(1060)],     # 0.4415  run 482-689
    [0.188, wy(1000)],     # 0.5567  run 488-684
    [0.181, wy(960)],      # 0.6335  run 492-681
    [0.166, wy(880)],      # 0.7871  interpolated across the collar occlusion
    [0.155, wy(720)],      # 1.0942  run 506-668
    [0.150, wy(600)],      # 1.3246  run 508-664
    [0.156, wy(510)],      # 1.4974  run 504-667
    [0.158, wy(430)],      # 1.6510  inside the head eye
    [0.158, wy(205)],      # 2.0829  emerges as the crown boss
    [0.150, wy(160)],      # 2.1693  boss crown chamfer
    [0.010, wy(144)],      # 2.2000  closed crown
]

HEAD_TOP = wy(200)         # 2.0925  coral begins below the cream boss
HEAD_BOTTOM = wy(490)      # 1.5358  coral ends and the handle emerges
HEAD_MID = round((HEAD_TOP + HEAD_BOTTOM) / 2, 4)
HEAD_HEIGHT = round(HEAD_TOP - HEAD_BOTTOM, 4)
HEAD_BODY_X0 = wx(462)     # -0.2381 poll side of the body block
HEAD_BODY_X1 = wx(800)     #  0.4108 claw side of the body block, at the throat apex
HEAD_BODY_W = round(HEAD_BODY_X1 - HEAD_BODY_X0, 4)
HEAD_BODY_CX = round((HEAD_BODY_X1 + HEAD_BODY_X0) / 2, 4)
# Inferred from the poll drum: its projected face is 260 px tall and the drum axis
# is horizontal, so that vertical extent is the drum's true diameter and it sets
# the head's depth. A single view cannot measure Z directly.
HEAD_DEPTH = 0.500

# The head's side outline, measured by scanning each column for the coral run's top
# and bottom rows. The block is NOT a rectangle: its underside runs flat at y 1.54
# out to x 0.19, then climbs steeply to a throat apex at (0.449, 1.810). That climb
# is the crescent's left wall, and it is half of what makes the gap under the claw
# read as a crescent rather than as a slot cut in a brick. Column samples, x then
# bottom y: 0.161/1.568, 0.219/1.590, 0.276/1.639, 0.334/1.760, 0.392/1.791,
# 0.449/1.810. The top edge is flat at the measured coral top of row 200.
HEAD_PROFILE_POINTS = [
    (HEAD_BODY_X0, 1.5358),
    (0.1900, 1.5400),
    (0.2760, 1.6390),
    (0.3340, 1.7600),
    (HEAD_BODY_X1, 1.8100),
    (HEAD_BODY_X1, 2.0983),
    (HEAD_BODY_X0, 2.0925),
]
HEAD_CORNER = 0.055        # the chamfer the reference reads as a bright rim line
# Per-corner, in HEAD_PROFILE_POINTS order. The throat apex and the crown both carry
# a much larger radius than the rest: in the reference the underside sweeps into the
# crescent on a curve, and the head's top rolls over into the claw shoulder instead
# of meeting it at an edge. Left square, that shoulder is the one place the head
# still reads as a brick with a claw stuck on it.
HEAD_CORNER_RADII = [0.055, 0.055, 0.045, 0.045, 0.110, 0.150, 0.055]

POLL_R = round(260 / 2 * K, 4)         # 0.2496
POLL_TIP_X = wx(254)                   # -0.6373 leftmost coral
POLL_ROOT_X = wx(490)                  # -0.1843 where the poll enters the body
POLL_LEN = round(POLL_ROOT_X - POLL_TIP_X, 4)

# Poll profile, revolved about the local lathe axis and then laid along -X. Reads
# from the body end (t=0) out to the face (t=POLL_LEN), and reproduces the two-step
# drum the reference shows: a collar, a recessed groove, then the wide face drum.
POLL_LATHE = [
    [0.185, 0.000],
    [0.215, 0.045],
    [0.215, 0.105],
    [0.192, 0.130],        # the step groove between collar and drum
    [0.240, 0.160],
    [POLL_R, 0.205],
    [POLL_R, 0.380],
    [0.236, 0.418],        # face chamfer
    [0.196, 0.445],
    [0.010, POLL_LEN],
]

# Claw. Sampled by scanning the coral mask right of the shaft row by row and taking
# the outermost run. Above row 345 the head and the claw are one mass and only the
# outer edge is measurable, at columns 825, 874, 904 and 934 for rows 200, 240, 280
# and 320. Below row 345 the crescent opens and the claw's own run is separate, so
# both edges are measurable and the run midpoint is the centreline: columns 831-953,
# 872-962, 905-971 and 918-957 for rows 350, 370, 400 and 440.
#
# The spine is that centreline, and it is a hook: out from the shoulder, over the
# top, down, and curling back left at the tip. Sampled instead along the inner edge
# from column 700 to 952 across rows 240-438, the points are nearly collinear, a
# CatmullRom through them has no curvature to find, and the claw renders as a flat
# fin standing off the head.
CLAW_SPINE = [
    [0.3000, 2.0200, 0.0],      # embedded in the head, back from the throat apex
    [0.4490, 1.9540, 0.0],      # column 800, coral 1.810-2.098
    [0.5070, 1.8990, 0.0],      # column 850, coral 1.737-2.060
    [0.5640, 1.8410, 0.0],      # column 880, coral 1.678-2.004
    [0.6220, 1.7790, 0.0],      # column 910, coral 1.639-1.918
    [0.6900, 1.7000, 0.0],      # column 940, coral 1.616-1.847
    [0.6600, 1.6400, 0.0],      # the tip, curling back left: row 440 spans x 0.637-0.712
]
# The root carries the crescent, the tines carry the forked tip. The fork itself is
# measurable: rows 380-430 show two runs with a slot between them, rows above show one.
# The split is also how the claw tapers at all, because the sweep builder carries one
# cross-section for a whole spine: run the root's 0.28 section all the way to the tip
# and the hook fattens into a wedge and loses its curl.
CLAW_ROOT_SPINE = CLAW_SPINE[:5]
# The tines start one sample back inside the root, which is the 0.048 overlap the
# root-to-tines seam records. Started at the root's last point instead, they butt
# onto its flat end cap and the fork reads as a break rather than as a split.
CLAW_TINE_SPINE = CLAW_SPINE[3:]
# Half-depth in Z, half-height across the sweep. The claw's vertical extent runs
# 0.288, 0.323, 0.326, 0.279 and 0.231 across the five sampled columns, and the band
# is shallow enough over that stretch for the vertical extent to be its perpendicular
# thickness. The sweep builder carries one section for the whole spine, so 0.28 sits
# in that range and puts the claw's underside on the throat apex at x 0.449.
CLAW_ROOT_SECTION = [0.150, 0.140]
CLAW_TINE_SECTION = [0.058, 0.080]
CLAW_TINE_Z = 0.086                    # the fork gap the reference shows on the claw

EYE_COLLAR_R = 0.196
EYE_COLLAR_H = 0.070
EYE_COLLAR_Y = round(HEAD_TOP - EYE_COLLAR_H / 2 + 0.012, 4)

# Bracket. The plate mask spans x 153-350, y 555-965.
PLATE_W = wl(197)          # 0.3782
PLATE_H = wl(410)          # 0.7871
PLATE_T = 0.120            # inferred; the plate reads about a third of its width thick
PLATE_CX = wx(251.5)       # -0.6421
PLATE_CY = wy(760)         # 1.0174
PLATE_CORNER = 0.075
SCREW_R = wl(25)           # 0.0480
SCREW_Y_TOP = wy(640)      # 1.2478
SCREW_Y_BOTTOM = wy(880)   # 0.7871

ARM_X0 = wx(345)           # -0.4626 plate face
ARM_X1 = wx(512)           # -0.1421 into the pivot boss
ARM_W = round(ARM_X1 - ARM_X0, 4)
ARM_CX = round((ARM_X1 + ARM_X0) / 2, 4)
ARM_H = wl(80)             # 0.1536
ARM_D = 0.130
ARM_Y = wy(800)            # 0.9407

PIVOT_X = wx(440)          # -0.2803
PIVOT_R = wl(60)           # 0.1152
PIVOT_LEN = 0.150
PIVOT_CHAMFER = 0.016
# Revolved about the local lathe axis and straddling y=0, so the boss keeps its
# centre as its origin. Both ends close through the chamfer the reference reads as
# a bright ring around a flat face rather than a dome.
PIVOT_LATHE = [
    [0.010, -PIVOT_LEN / 2],
    [PIVOT_R - PIVOT_CHAMFER, -PIVOT_LEN / 2],
    [PIVOT_R, -PIVOT_LEN / 2 + PIVOT_CHAMFER],
    [PIVOT_R, PIVOT_LEN / 2 - PIVOT_CHAMFER],
    [PIVOT_R - PIVOT_CHAMFER, PIVOT_LEN / 2],
    [0.010, PIVOT_LEN / 2],
]
PIVOT_RING_R = 0.072
PIVOT_RING_TUBE = 0.016

COLLAR_Y = wy(840)         # 0.8639
COLLAR_R = 0.203           # ring centreline; outer edge lands on the measured 0.240
COLLAR_TUBE = 0.047
LUG_X = wx(690)            # 0.1996
LUG_W = wl(80)             # 0.1536
LUG_H = 0.140
LUG_D = 0.115              # inferred; the lug reads a little narrower than it is tall
BOLT_R = 0.042
BOLT_LEN = 0.090

EVIDENCE = "full-object"
HEAD_ZONE = "head-zone"
BRACKET_ZONE = "bracket-zone"
HANDLE_ZONE = "handle-zone"

# The reference fixes which parts share a colour and how they sit against each
# other; it does not fix the hex. A reference render carries its own lighting, and
# median-sampling it here gave #EE6153, #F0D9B4 and #2C3A4E, none of which is a
# colour this game owns. So the relative reading is taken from the reference and the
# values from PALETTE in lib/game/constants.ts, which is what every other prop and
# every piece of level geometry is painted from.
#
# The navy is #24324a rather than PALETTE.ink. Ink is the level's edge-band colour
# and carries 13.7:1 against the sky, so a prop painted in it reads as level geometry
# rather than as a prop. #24324a is the value the hand-authored props already use for
# hoses, trims and bases.
CORAL = "#ff5c65"          # PALETTE.red
CREAM = "#fff3cf"          # the warmer cream the hand-authored hammer handle uses,
                           # kept because PALETTE.cream is the level's trim colour
NAVY = "#24324a"

MATERIAL_IDS = {"head-coral", "handle-cream", "bracket-navy"}


# ---------------------------------------------------------------------------
# geometry descriptor helpers
# ---------------------------------------------------------------------------
def geo(intent: str, edge: str, key: str | None = None, payload=None, **kw) -> dict:
    """descriptor() only carries profile2D, but the generator also reads
    latheProfile, tubePath and curveSweep, so the extra payload is attached here."""
    item = descriptor(intent, edge, **kw)
    if key:
        item[key] = payload
    return item


def ring_points(radius: float, segments: int, axis: str, offset: float = 0.0):
    """A closed CatmullRom loop. buildTubeGeometry turns this into a real torus with
    an explicit radius, which the unit torus primitive can only reach through a
    scale factor that hides the measurement."""
    points = []
    for index in range(segments):
        angle = index / segments * 2 * math.pi
        c = round(radius * math.cos(angle), 5)
        s = round(radius * math.sin(angle), 5)
        points.append({"x": [offset, c, s], "y": [c, offset, s], "z": [c, s, offset]}[axis])
    return points


def rounded_rect(width: float, height: float, radius: float, segments: int = 4):
    """Rounded-rectangle outline for the wall plate, counter-clockwise."""
    half_w, half_h = width / 2 - radius, height / 2 - radius
    points = []
    for cx, cy, start in ((half_w, half_h, 0.0), (-half_w, half_h, math.pi / 2),
                          (-half_w, -half_h, math.pi), (half_w, -half_h, 3 * math.pi / 2)):
        for step in range(segments + 1):
            angle = start + step / segments * (math.pi / 2)
            points.append([round(cx + radius * math.cos(angle), 5),
                           round(cy + radius * math.sin(angle), 5)])
    return points


def round_corners(points, radius: float, segments: int = 3, radii=None):
    """Replace each corner of a closed polygon with a small arc.

    `radii` gives a per-corner radius where one value will not do. The head's crown
    carries a much larger radius than its other corners, because the reference rolls
    it over into the claw shoulder rather than meeting it at an edge.

    buildExtrudeGeometry runs with bevelEnabled off, so an outline's corners are the
    only place a chamfer can come from. Every coral and navy edge in the reference
    carries one, which is what puts a bright rim line on each corner rather than a
    hard crease.
    """
    count = len(points)
    rounded = []
    for index in range(count):
        corner_radius = radius if radii is None else radii[index]
        previous = points[index - 1]
        current = points[index]
        following = points[(index + 1) % count]
        for neighbour, sign in ((previous, 1), (following, 1)):
            dx, dy = neighbour[0] - current[0], neighbour[1] - current[1]
            length = math.hypot(dx, dy)
            if length < 1e-9:
                continue
            step = min(corner_radius, length / 2) * sign
            rounded.append((current[0] + dx / length * step, current[1] + dy / length * step))
        # A single midpoint between the two trims reads as a chamfer; more read as a
        # fillet. Three is enough at this scale and keeps the triangle count down.
        entry, exit_ = rounded[-2], rounded[-1]
        arc = []
        for step in range(1, segments):
            t = step / segments
            ax = (1 - t) ** 2 * entry[0] + 2 * (1 - t) * t * current[0] + t ** 2 * exit_[0]
            ay = (1 - t) ** 2 * entry[1] + 2 * (1 - t) * t * current[1] + t ** 2 * exit_[1]
            arc.append((ax, ay))
        rounded[-1:-1] = arc
    return [[round(x, 5), round(y, 5)] for x, y in rounded]


def rect_section(half_depth: float, half_height: float):
    return {"points": [[-half_depth, -half_height], [half_depth, -half_height],
                       [half_depth, half_height], [-half_depth, half_height]]}


def attach(parent_id: str, start, end, contact: str, overlap: float, notes: str,
           evidence: list[str], tolerance: float = 0.004) -> dict:
    """Joint record for a child appendage.

    `geometryFromEndpoint` is read by one refine-code edit to the generated
    factory. As shipped, the generator replaces the geometry of ANY component
    carrying an attachment with a tapered cylinder spanning localStart to
    localEnd, and overrides its authored transform with the endpoint. That is
    right for a tube-network member and wrong for every part here, whose form
    lives in a measured lathe, sweep or extrude profile. The flag lets those
    parts keep their geometry while still recording the joint, which is what the
    attachment contract is actually for: proving no part floats.
    """
    return {
        "parentId": parent_id,
        "localStart": [round(float(v), 5) for v in start],
        "localEnd": [round(float(v), 5) for v in end],
        "contactType": contact,
        "overlap": round(overlap, 5),
        "gapTolerance": tolerance,
        "geometryFromEndpoint": False,
        "evidenceRefs": evidence,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
# EVERY transform below is written in the prop's own world frame: butt at the
# origin, +Y up the shaft, measured straight off the reference by wx()/wy().
# localise() at the end of this block converts them to the parent-local frame the
# generator wants, so nothing here has to be read as an offset from a parent that
# is itself somewhere else. Three defects come out of that frame confusion and
# all three are fixed here.
#
# 1. The generator adds each component to nodes[parent] and applies
#    transform.position as a LOCAL offset. With poll-drum written at world
#    y 1.8141 under a head-body already at world y 1.8141, the drum landed at
#    3.63 and the claw at 4.04. That is where the 4.04u overall height came from.
#
# 2. xform() defaults scale to (1, 1, 1) and scale_vector() only falls back to
#    `dimensions` when the key is ABSENT, so a unit box or cylinder that leaves
#    the default in place ships at 1x1x1. That is what made the head a 1u cube.
#    Profile primitives carry their real size in the profile and keep
#    scale=(1, 1, 1); a bare primitive passes scale=None to get its dimensions.
#
# 3. That dimension scale lands on the NODE, and child nodes inherit it. So a
#    part with children cannot be a bare primitive: head-body would have squashed
#    the poll, the claw and the collar by (0.4684, 0.5567, 0.5). head-body,
#    bracket-arm, bracket-collar-lug and bracket-pivot-boss all have children and
#    are therefore authored as extrude and lathe profiles at unit scale. Only
#    leaves - eye-collar and bracket-bolt - take a dimension scale.
#
# An extrude runs from z 0 to z depth rather than straddling its origin, so an
# extruded part's position names its near face along the extrusion axis, not its
# centre. `dimensions` still records the world footprint either way.
COMPONENTS = [
    component(
        "handle-shaft", "Handle shaft", "macro", "structural-spine", "lathe", "handle-cream",
        "continuous-sculpt",
        "A single surface of revolution whose radius varies continuously from the butt swell to "
        "the crown, with no edge anywhere along it. A box stack or a plain cylinder would lose "
        "the swell that fixes the grip's read.",
        colours(CREAM), geo("revolved tapered shaft with a butt swell and a crown boss", "fillet",
                            "latheProfile", {"points": HANDLE_PROFILE, "segments": 28},
                            bevel_radius=0.02, segments=3),
        xform(position=(0, 0, 0), scale=(1, 1, 1)),
        dims(0.414, 2.200, 0.414, 0.9),
        action("root", "custom", (0, 0, 0), (0, 1, 0), 0.9,
               {"translate": True, "rotate": True, "scale": True},
               sockets=[{"id": "grip-centre", "position": [0, 0.55, 0]},
                        {"id": "swing-pivot", "position": [0, 2.20, 0]}],
               collider={"type": "capsule", "offset": [0, 1.1, 0], "scale": [0.414, 2.2, 0.414],
                         "isTrigger": False,
                         "notes": "Capsule proxy along the shaft; the trap's own colliders are "
                                  "authored in TrapRenderer and are not replaced by this prop."},
               fracture="handle"),
        [feature("butt-swell",
                 "The shaft widens from radius 0.150 at y 1.325 to 0.207 at y 0.326 before "
                 "rounding into the butt, which is the only bulge in the silhouette.",
                 "Lathe profile radius stops, not a separate part.", [EVIDENCE, HANDLE_ZONE], 0.85),
         feature("butt-round",
                 "The butt closes as a dome over the last 0.096 units rather than a flat disc.",
                 "Lathe profile collapses to radius 0.010 at y 0.", [EVIDENCE, HANDLE_ZONE], 0.8),
         feature("crown-boss",
                 "The shaft reappears above the head as a cream cylinder of radius 0.158 standing "
                 "0.117 proud of the coral, chamfered at its crown.",
                 "Same lathe, profile stops at y 2.083, 2.169 and 2.200.",
                 [EVIDENCE, HEAD_ZONE], 0.85)],
        surface(0.62, 0.55, 0.010, "fine moulded-plastic grain following the axis of revolution",
                "darken where the bracket collar and the head eye contact the shaft",
                "very light polish on the swell crown", "Matte injection-moulded plastic."),
        [EVIDENCE, HANDLE_ZONE], importance=0.9, confidence=0.9, parent=None,
        seams=[{"id": "shaft-to-head", "withComponent": "head-body", "overlapWorldUnits": 0.557,
                "notes": "The shaft runs through the whole head, so the overlap is the head's "
                         "full height rather than a lip."},
               {"id": "shaft-to-collar", "withComponent": "bracket-collar",
                "overlapWorldUnits": 0.037,
                "notes": "The collar ring's inner wall sits 0.037 inside the shaft radius."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "head-body", "Head body block", "macro", "primary-mass", "extrude", "head-coral",
        "assembled-solid",
        "A chamfered rectangular mass with distinct faces where the poll, the claw and the eye "
        "meet it. It is a manufactured block, not a continuous organic form.",
        colours(CORAL), geo("chamfered block that carries the poll and the claw", "chamfer",
                            "profile2D",
                            {"points": round_corners(HEAD_PROFILE_POINTS, HEAD_CORNER,
                                                     segments=5, radii=HEAD_CORNER_RADII),
                             "depth": HEAD_DEPTH},
                            bevel_radius=HEAD_CORNER, segments=3),
        # Extruded rather than scaled from a unit box for three reasons: the block
        # carries three children and a dimension scale on the node would squash all
        # of them, the 0.055 corner radius the reference shows as a bright rim line
        # is real geometry here rather than a metadata note, and the underside's
        # climb into the throat cannot be expressed by a box at all. The profile is
        # written in world XY, so the position only offsets the extrusion in Z.
        xform(position=(0, 0, -HEAD_DEPTH / 2)),
        dims(HEAD_BODY_W, HEAD_HEIGHT, HEAD_DEPTH, 0.75),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.85,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy on the head mass."},
               fracture="head"),
        [feature("body-edge-chamfer",
                 "Every edge of the block is softened by about 0.055 units, so the reference shows "
                 "a bright rim line rather than a hard corner.",
                 "edgeTreatment chamfer at bevelRadius 0.055, 3 segments.",
                 [EVIDENCE, HEAD_ZONE], 0.8),
         feature("eye-shoulder",
                 "The block's top face rises slightly toward the claw side, which is where the "
                 "coral meets the cream boss.",
                 "Top face carried by the eye collar rather than modelled as a taper.",
                 [HEAD_ZONE], 0.6)],
        surface(0.60, 0.52, 0.008, "broad moulded tone drift across each face",
                "darken the eye seam and both contact rings", "light polish on the chamfers",
                "Matte injection-moulded plastic, same family as the poll and claw."),
        [EVIDENCE, HEAD_ZONE], importance=0.9, confidence=0.8, parent="handle-shaft",
        seams=[{"id": "body-to-poll", "withComponent": "poll-drum", "overlapWorldUnits": 0.054,
                "notes": "The poll's lathe starts 0.054 inside the block's poll face."},
               {"id": "body-to-claw", "withComponent": "claw-root", "overlapWorldUnits": 0.035,
                "notes": "The claw sweep starts 0.035 inside the block's claw face."}],
        fidelity="blockout", material_class="plastic"),

    component(
        "poll-drum", "Poll drum and striking face", "macro", "striking-face", "lathe", "head-coral",
        "continuous-sculpt",
        "A surface of revolution about the horizontal poll axis: collar, recessed step, drum, then "
        "a chamfered face. A cylinder primitive would lose the step and the face chamfer, which "
        "are what make it read as a struck face rather than a peg.",
        colours(CORAL), geo("revolved two-step drum laid along the poll axis", "chamfer",
                            "latheProfile", {"points": POLL_LATHE, "segments": 26},
                            bevel_radius=0.03, segments=2),
        # The lathe axis is local +Y; rotating +pi/2 about Z lays it along -X, which is
        # the direction the striking face points in the reference.
        xform(position=(POLL_ROOT_X, HEAD_MID, 0), rotation=(0, 0, math.pi / 2), scale=(1, 1, 1)),
        dims(POLL_LEN, POLL_R * 2, POLL_R * 2, 0.8),
        action("static-part", "custom", (0, 0, 0), (1, 0, 0), 0.8,
               sockets=[{"id": "strike-face", "position": [POLL_TIP_X - POLL_ROOT_X, 0, 0]}],
               collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Cylinder proxy along the poll axis."},
               fracture="head"),
        [feature("poll-step-groove",
                 "A recessed ring 0.023 deep sits between the collar and the drum, 0.130 in from "
                 "the body face.",
                 "Lathe profile radius drops from 0.215 to 0.192 and back to 0.240.",
                 [EVIDENCE, HEAD_ZONE], 0.8),
         feature("poll-face-chamfer",
                 "The striking face is chamfered over its outer 0.065, so the face reads as a flat "
                 "disc inside a bright ring rather than a dome.",
                 "Lathe profile radius steps 0.2496 to 0.236 to 0.196 before closing.",
                 [EVIDENCE, HEAD_ZONE], 0.8)],
        surface(0.58, 0.50, 0.008, "concentric turning drift around the poll axis",
                "darken the step groove floor", "polish the face chamfer ring",
                "Matte plastic with a slightly smoother crown on the struck face."),
        [EVIDENCE, HEAD_ZONE], importance=0.85, confidence=0.8, parent="head-body",
        seams=[{"id": "poll-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.054,
                "notes": "Mirror of body-to-poll."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "claw-root", "Claw root sweep", "macro", "hook-root", "curve-sweep", "head-coral",
        "continuous-sculpt",
        "The claw leaves the block on a continuous curve. Swept along a measured 3D spine so it "
        "holds its hook from every camera angle; a flat extrude of the same outline would read "
        "correctly only from the reference angle.",
        colours(CORAL), geo("thick section swept along the claw spine", "fillet",
                            "curveSweep", {"spine": CLAW_ROOT_SPINE,
                                           "crossSection": rect_section(*CLAW_ROOT_SECTION),
                                           "closed": False},
                            bevel_radius=0.03, segments=2),
        xform(position=(0, 0, 0), scale=(1, 1, 1)),
        dims(0.37, 0.30, 0.30, 0.7),
        action("static-part", "custom", (0.195, HEAD_TOP, 0), (0, 0, 1), 0.7,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy over the claw root."},
               fracture="head"),
        [feature("claw-crescent",
                 "The underside of the claw is open to the background between rows 250 and 438, "
                 "which is the crescent that identifies a claw hammer.",
                 "Spine curvature, not a cut: the sweep leaves the gap open.",
                 [EVIDENCE, HEAD_ZONE], 0.85)],
        surface(0.60, 0.52, 0.008, "sweep-aligned moulding drift", "darken the root seam",
                "light polish along the outer curve", "Matte plastic, same family as the block."),
        [EVIDENCE, HEAD_ZONE], importance=0.85, confidence=0.7, parent="head-body",
        seams=[{"id": "claw-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.035,
                "notes": "Mirror of body-to-claw."},
               {"id": "root-to-tines", "withComponent": "claw-tine-near",
                "overlapWorldUnits": 0.048,
                "notes": "Both tines start 0.048 back inside the root sweep."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "claw-tine-near", "Claw tine, near side", "meso", "hook-tine", "curve-sweep", "head-coral",
        "continuous-sculpt",
        "A slim continuously curving tine. Swept along the same spine as the root so the fork "
        "reads as one hook split in two, not two separate hooks.",
        colours(CORAL), geo("slim section swept along the claw tip spine", "fillet",
                            "curveSweep", {"spine": CLAW_TINE_SPINE,
                                           "crossSection": rect_section(*CLAW_TINE_SECTION),
                                           "closed": False},
                            bevel_radius=0.015, segments=2),
        xform(position=(0, 0, CLAW_TINE_Z), scale=(1, 1, 1)),
        dims(0.16, 0.24, 0.116, 0.6),
        action("static-part", "custom", (0, 0, 0), (0, 0, 1), 0.6,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy over the tine."},
               fracture="head"),
        [feature("tine-taper",
                 "The tine section is 0.116 across against the root's 0.30, so the claw visibly "
                 "narrows toward the tip.",
                 "Smaller swept cross-section on the same spine.", [HEAD_ZONE], 0.6)],
        surface(0.60, 0.52, 0.006, "sweep-aligned drift", "darken the fork slot floor",
                "polish the tine crown", "Matte plastic."),
        [EVIDENCE, HEAD_ZONE], importance=0.6, confidence=0.6, parent="claw-root",
        seams=[{"id": "tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048,
                "notes": "Mirror of root-to-tines."}],
        fidelity="blockout", material_class="plastic"),

    component(
        "claw-tine-far", "Claw tine, far side", "meso", "hook-tine", "curve-sweep", "head-coral",
        "continuous-sculpt",
        "The mirror of the near tine across the fork slot, on the same measured spine.",
        colours(CORAL), geo("slim section swept along the claw tip spine", "fillet",
                            "curveSweep", {"spine": CLAW_TINE_SPINE,
                                           "crossSection": rect_section(*CLAW_TINE_SECTION),
                                           "closed": False},
                            bevel_radius=0.015, segments=2),
        xform(position=(0, 0, -CLAW_TINE_Z), scale=(1, 1, 1)),
        dims(0.16, 0.24, 0.116, 0.5),
        action("static-part", "custom", (0, 0, 0), (0, 0, 1), 0.5,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy over the tine."},
               fracture="head"),
        [feature("far-tine-inference",
                 "The far tine is only partly visible past the near one; its section and spine are "
                 "mirrored rather than measured.",
                 "Mirror of claw-tine-near about the fork plane.", [HEAD_ZONE], 0.5)],
        surface(0.60, 0.52, 0.006, "sweep-aligned drift", "darken the fork slot floor",
                "polish the tine crown", "Matte plastic."),
        [EVIDENCE, HEAD_ZONE], importance=0.5, confidence=0.5, parent="claw-root",
        seams=[{"id": "far-tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048,
                "notes": "Mirror of root-to-tines."}],
        fidelity="blockout", material_class="plastic"),

    component(
        "eye-collar", "Eye collar", "meso", "joint-collar", "cylinder", "head-coral",
        "assembled-solid",
        "A short coral ring standing proud of the head's top face where the handle passes through "
        "the eye. Assembled hardware, so a cylinder is the right family.",
        colours(CORAL), descriptor("proud collar around the handle at the head crown", "chamfer",
                                   bevel_radius=0.018, segments=2),
        xform(position=(0, EYE_COLLAR_Y, 0), scale=None),
        dims(EYE_COLLAR_R * 2, EYE_COLLAR_H, EYE_COLLAR_R * 2, 0.65),
        action("static-part", "center", (0, 0, 0), (0, 1, 0), 0.65,
               collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Cylinder proxy on the collar."},
               fracture="head"),
        [feature("eye-seam",
                 "A dark seam runs where the cream shaft meets the coral collar, about 0.012 wide.",
                 "AO local override on the contact ring, plus the collar's own chamfer.",
                 [HEAD_ZONE], 0.7)],
        surface(0.60, 0.52, 0.006, "ring-aligned drift", "darken the shaft contact ring",
                "polish the collar chamfer", "Matte plastic."),
        [EVIDENCE, HEAD_ZONE], importance=0.55, confidence=0.65, parent="head-body",
        seams=[{"id": "collar-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.023,
                "notes": "The collar sinks 0.023 into the block's top face."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "bracket-plate", "Wall plate", "macro", "mount-plate", "extrude", "bracket-navy",
        "assembled-solid",
        "A flat manufactured plate with rounded corners and two through holes. A plate genuinely "
        "is a slab, so an extrude with real holes is the honest primitive rather than a solid the "
        "holes are painted onto.",
        colours(NAVY), geo("rounded-rectangle plate extruded to its thickness with two bores",
                           "fillet", "profile2D",
                           {"points": rounded_rect(PLATE_W, PLATE_H, PLATE_CORNER),
                            "depth": PLATE_T,
                            "ovalHoles": [
                                {"cx": 0.0, "cy": round(SCREW_Y_TOP - PLATE_CY, 4),
                                 "rx": SCREW_R, "ry": SCREW_R},
                                {"cx": 0.0, "cy": round(SCREW_Y_BOTTOM - PLATE_CY, 4),
                                 "rx": SCREW_R, "ry": SCREW_R}]},
                           bevel_radius=0.02, segments=2),
        # The plate faces the camera in the reference: its mask spans columns 153-350,
        # which is the 0.3782 width, and its 0.120 thickness is never seen. So the
        # outline is drawn upright in local XY at its true width and height and the
        # thickness extrudes back along Z, with no node rotation. Authored the other
        # way up - long axis on X, then rotated a quarter turn twice - the plate stood
        # edge-on and showed only its 0.120 thickness, which cost 0.23 units off the
        # silhouette's width and was most of the blockout's 0.344 aspect-ratio delta.
        # The wall is behind the prop, so the plate straddles the handle's z=0 plane
        # like the arm and the collar do.
        xform(position=(PLATE_CX, PLATE_CY, round(-PLATE_T / 2, 4)), scale=(1, 1, 1)),
        dims(PLATE_W, PLATE_H, PLATE_T, 0.75),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.75,
               sockets=[{"id": "wall-face", "position": [0, 0, 0]}],
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy on the plate."},
               fracture="bracket"),
        [feature("plate-corner-radius",
                 "All four corners carry a 0.075 radius, which is a fifth of the plate's width.",
                 "Rounded-rectangle outline, four arcs of four segments each.",
                 [EVIDENCE, BRACKET_ZONE], 0.85),
         feature("plate-screw-bores",
                 "Two through holes of radius 0.048 sit on the plate centreline at y 1.248 and "
                 "0.787, 0.461 apart.",
                 "ExtrudeGeometry shape holes, so they are real openings rather than dark decals.",
                 [EVIDENCE, BRACKET_ZONE], 0.8)],
        surface(0.66, 0.58, 0.008, "flat moulded drift across the plate face",
                "darken both bore walls and the arm root", "light polish on the corner radii",
                "Matte navy plastic, the darkest material on the prop."),
        [EVIDENCE, BRACKET_ZONE], importance=0.7, confidence=0.75, parent="handle-shaft",
        seams=[{"id": "plate-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.030,
                "notes": "The arm starts 0.030 inside the plate's front face."}],
        fidelity="structural-pass", material_class="plastic"),

    component(
        "bracket-arm", "Bracket arm", "meso", "mount-arm", "extrude", "bracket-navy",
        "assembled-solid",
        "A straight rectangular bar between the plate and the pivot boss. Manufactured stock, so a "
        "chamfered bar section is correct.",
        colours(NAVY), geo("straight bar from plate to pivot", "chamfer", "profile2D",
                           {"points": rounded_rect(ARM_W, ARM_H, 0.022), "depth": ARM_D},
                           bevel_radius=0.022, segments=2),
        xform(position=(ARM_CX, ARM_Y, -ARM_D / 2)),
        dims(ARM_W, ARM_H, ARM_D, 0.7),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.7,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy on the arm."},
               fracture="bracket"),
        [feature("arm-edge-chamfer",
                 "The bar's long edges are softened by about 0.022, so it catches a highlight line "
                 "along its top.",
                 "edgeTreatment chamfer at bevelRadius 0.022.", [BRACKET_ZONE], 0.7)],
        surface(0.66, 0.58, 0.006, "drift along the bar axis", "darken both ends where it meets "
                "the plate and the boss", "polish the top chamfer", "Matte navy plastic."),
        [EVIDENCE, BRACKET_ZONE], importance=0.6, confidence=0.7, parent="bracket-plate",
        seams=[{"id": "arm-to-plate", "withComponent": "bracket-plate", "overlapWorldUnits": 0.030,
                "notes": "Mirror of plate-to-arm."},
               {"id": "arm-to-boss", "withComponent": "bracket-pivot-boss",
                "overlapWorldUnits": 0.040,
                "notes": "The boss overlaps the bar end by 0.040."}],
        fidelity="structural-pass", material_class="plastic"),

    component(
        "bracket-pivot-boss", "Pivot boss", "meso", "pivot-hardware", "lathe", "bracket-navy",
        "assembled-solid",
        "A short drum on the arm's outer end, its axis along the arm, with a flat chamfered face. "
        "Assembled hardware.",
        colours(NAVY), geo("revolved pivot drum at the arm end", "chamfer", "latheProfile",
                           {"points": PIVOT_LATHE, "segments": 20},
                           bevel_radius=0.016, segments=2),
        # A lathe rather than a scaled cylinder because the boss carries the ring and
        # the collar, and a dimension scale on this node would distort both. The
        # profile straddles y=0 so the position stays the boss centre; +pi/2 about Z
        # lays the lathe axis along -X, out toward the wall.
        xform(position=(PIVOT_X, ARM_Y, 0), rotation=(0, 0, math.pi / 2)),
        dims(PIVOT_LEN, PIVOT_R * 2, PIVOT_R * 2, 0.65),
        action("hinge", "custom", (0, 0, 0), (1, 0, 0), 0.65,
               {"rotate": True},
               sockets=[{"id": "pivot-axis", "position": [0, 0, 0]}],
               collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Cylinder proxy on the boss."},
               fracture="bracket"),
        [feature("boss-face-flat",
                 "The boss end reads as a flat disc, not a dome, with a bright chamfer ring.",
                 "Cylinder with a 0.016 chamfer, no cap dome.", [BRACKET_ZONE], 0.65)],
        surface(0.64, 0.56, 0.006, "concentric drift around the pivot axis",
                "darken the arm contact", "polish the face chamfer", "Matte navy plastic."),
        [EVIDENCE, BRACKET_ZONE], importance=0.55, confidence=0.65, parent="bracket-arm",
        seams=[{"id": "boss-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.040,
                "notes": "Mirror of arm-to-boss."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "bracket-pivot-ring", "Pivot face ring", "micro", "surface-relief", "tube", "bracket-navy",
        "surface-relief",
        "A raised concentric ring on the boss face. It belongs to the boss and rides it; it is "
        "relief, not an independent part.",
        colours(NAVY), geo("raised ring on the boss face", "fillet", "tubePath",
                           {"points": ring_points(PIVOT_RING_R, 16, "x"),
                            "radius": PIVOT_RING_TUBE, "radialSegments": 6, "closed": True},
                           bevel_radius=0.008, segments=1),
        xform(position=(round(PIVOT_X - PIVOT_LEN / 2 - 0.004, 4), ARM_Y, 0), scale=(1, 1, 1)),
        dims(PIVOT_RING_TUBE * 2, PIVOT_RING_R * 2, PIVOT_RING_R * 2, 0.55),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.55,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Not a separate collider in practice."},
               fracture="bracket"),
        [feature("ring-relief",
                 "A ring of radius 0.072 stands about 0.016 proud of the boss face and catches a "
                 "highlight along its crown.",
                 "Closed tube loop about the pivot axis, sunk 0.004 into the face.",
                 [BRACKET_ZONE], 0.6)],
        surface(0.62, 0.54, 0.010, "ring-aligned relief", "darken the ring root groove",
                "polish the ring crown", "Matte navy plastic."),
        [BRACKET_ZONE], importance=0.4, confidence=0.55, parent="bracket-pivot-boss",
        seams=[{"id": "ring-to-boss", "withComponent": "bracket-pivot-boss",
                "overlapWorldUnits": 0.020,
                "notes": "The ring sinks 0.020 into the boss face."}],
        fidelity="surface-pass", material_class="plastic"),

    component(
        "bracket-collar", "Clamp collar", "meso", "clamp-band", "tube", "bracket-navy",
        "conforming-shell",
        "A band that wraps the handle. It conforms to the shaft rather than being a solid of its "
        "own, so a closed swept loop is the right family.",
        colours(NAVY), geo("closed band wrapped around the handle", "fillet", "tubePath",
                           {"points": ring_points(COLLAR_R, 20, "y"),
                            "radius": COLLAR_TUBE, "radialSegments": 10, "closed": True},
                           bevel_radius=0.014, segments=2),
        xform(position=(0, COLLAR_Y, 0), scale=(1, 1, 1)),
        dims(round((COLLAR_R + COLLAR_TUBE) * 2, 4), COLLAR_TUBE * 2,
             round((COLLAR_R + COLLAR_TUBE) * 2, 4), 0.7),
        action("static-part", "center", (0, 0, 0), (0, 1, 0), 0.7,
               collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Cylinder proxy on the collar band."},
               fracture="bracket"),
        [feature("collar-grip",
                 "The band's inner wall sits 0.037 inside the shaft radius at that height, so it "
                 "reads as clamped rather than floating.",
                 "Ring centreline radius 0.203 against a shaft radius of 0.166 there.",
                 [EVIDENCE, BRACKET_ZONE], 0.75)],
        surface(0.66, 0.58, 0.008, "band-aligned drift", "darken the shaft contact ring",
                "polish the band crown", "Matte navy plastic."),
        [EVIDENCE, BRACKET_ZONE], importance=0.65, confidence=0.7, parent="bracket-pivot-boss",
        seams=[{"id": "collar-to-shaft", "withComponent": "handle-shaft",
                "overlapWorldUnits": 0.037, "notes": "Mirror of shaft-to-collar."},
               {"id": "collar-to-lug", "withComponent": "bracket-collar-lug",
                "overlapWorldUnits": 0.036, "notes": "The lug sinks 0.036 into the band."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "bracket-collar-lug", "Collar clamp lug", "micro", "clamp-lug", "extrude", "bracket-navy",
        "assembled-solid",
        "The raised block on the collar's claw side that a real split clamp bolts through.",
        colours(NAVY), geo("raised clamp lug on the collar", "chamfer", "profile2D",
                           {"points": rounded_rect(LUG_W, LUG_H, 0.012), "depth": LUG_D},
                           bevel_radius=0.012, segments=2),
        xform(position=(LUG_X, COLLAR_Y, -LUG_D / 2)),
        dims(LUG_W, LUG_H, LUG_D, 0.6),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.6,
               collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Box proxy on the lug."},
               fracture="bracket"),
        [feature("lug-split-line",
                 "A horizontal split runs across the lug where the two halves of the clamp meet.",
                 "Panel-line local override across the lug, no depth.", [BRACKET_ZONE], 0.55)],
        surface(0.66, 0.58, 0.006, "flat drift", "darken the split line and the band contact",
                "polish the lug chamfers", "Matte navy plastic."),
        [BRACKET_ZONE], importance=0.45, confidence=0.6, parent="bracket-collar",
        seams=[{"id": "lug-to-collar", "withComponent": "bracket-collar",
                "overlapWorldUnits": 0.036, "notes": "Mirror of collar-to-lug."}],
        fidelity="form-refinement", material_class="plastic"),

    component(
        "bracket-bolt", "Clamp bolt head", "micro", "fastener", "cylinder", "bracket-navy",
        "assembled-solid",
        "The bolt head standing proud of the lug. A cylinder is the correct family for a turned "
        "fastener head.",
        colours(NAVY), descriptor("bolt head on the lug face", "chamfer",
                                  bevel_radius=0.008, segments=2),
        xform(position=(round(LUG_X + LUG_W / 2 + BOLT_LEN / 2 - 0.020, 4), COLLAR_Y, 0),
              rotation=(0, 0, math.pi / 2),
              scale=(BOLT_R * 2, BOLT_LEN, BOLT_R * 2)),
        dims(BOLT_LEN, BOLT_R * 2, BOLT_R * 2, 0.5),
        action("static-part", "center", (0, 0, 0), (1, 0, 0), 0.5,
               collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1],
                         "isTrigger": False, "notes": "Cylinder proxy on the bolt head."},
               fracture="bracket"),
        [feature("bolt-crown-chamfer",
                 "The bolt crown is chamfered, which is what puts a small bright ring on it in the "
                 "reference.",
                 "Cylinder with a 0.008 chamfer.", [BRACKET_ZONE], 0.5)],
        surface(0.60, 0.50, 0.006, "concentric turning drift", "darken the lug contact",
                "polish the crown", "Matte navy plastic with a slightly smoother crown."),
        [BRACKET_ZONE], importance=0.4, confidence=0.5, parent="bracket-collar-lug",
        seams=[{"id": "bolt-to-lug", "withComponent": "bracket-collar-lug",
                "overlapWorldUnits": 0.020, "notes": "The bolt sinks 0.020 into the lug face."}],
        fidelity="form-refinement", material_class="plastic"),
]


# ---------------------------------------------------------------------------
# world frame -> parent-local frame
# ---------------------------------------------------------------------------
# Every transform above is written in the prop's world frame because that is the
# frame the reference was measured in. The generator applies transform.position
# and transform.rotation as offsets from the parent node, so they are rebased here
# rather than by hand: hand-rebasing under the plate's (0, pi/2, pi/2) and the
# boss's (0, 0, pi/2) is where an arithmetic slip would hide.
#
# Three's Euler order is XYZ, so R = Rx * Ry * Rz. Rows are m[row][col].
def euler_to_matrix(rotation) -> list[list[float]]:
    x, y, z = rotation
    c1, s1 = math.cos(x), math.sin(x)
    c2, s2 = math.cos(y), math.sin(y)
    c3, s3 = math.cos(z), math.sin(z)
    ae, af, be, bf = c1 * c3, c1 * s3, s1 * c3, s1 * s3
    return [
        [c2 * c3, -c2 * s3, s2],
        [af + be * s2, ae - bf * s2, -s1 * c2],
        [bf - ae * s2, be + af * s2, c1 * c2],
    ]


def matrix_to_euler(m) -> tuple[float, float, float]:
    y = math.asin(max(-1.0, min(1.0, m[0][2])))
    if abs(m[0][2]) < 0.9999999:
        return math.atan2(-m[1][2], m[2][2]), y, math.atan2(-m[0][1], m[0][0])
    return math.atan2(m[2][1], m[1][1]), y, 0.0


def transpose(m):
    return [[m[c][r] for c in range(3)] for r in range(3)]


def mat_mul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(3)) for c in range(3)] for r in range(3)]


def mat_apply(m, v):
    return [sum(m[r][c] * v[c] for c in range(3)) for r in range(3)]


def localise(components: list[dict]) -> None:
    """Rewrite each transform from the world frame into its parent's frame.

    Every component's WORLD placement is preserved exactly, which is what lets the
    curve-sweep spines stay in the world coordinates they were sampled in. Raises
    if a parent carries a non-unit scale, because the generator puts scale on the
    node and a child would silently inherit it.
    """
    by_id = {item["id"]: item for item in components}
    world: dict[str, tuple[list[float], list[list[float]]]] = {}

    for item in components:
        transform = item["transform"]
        position = [float(v) for v in transform["position"]]
        rotation = euler_to_matrix([float(v) for v in transform["rotation"]])
        parent_id = item.get("parent")
        if parent_id is None:
            world[item["id"]] = (position, rotation)
            continue

        parent = by_id[parent_id]
        parent_scale = parent["transform"].get("scale")
        if parent_scale is None or any(abs(v - 1.0) > 1e-9 for v in parent_scale):
            raise SystemExit(
                f"{parent_id} carries scale {parent_scale} and is the parent of {item['id']}; "
                "a parent must stay at unit scale or its children inherit the distortion"
            )
        parent_position, parent_rotation = world[parent_id]
        inverse = transpose(parent_rotation)
        offset = [position[axis] - parent_position[axis] for axis in range(3)]
        transform["position"] = [round(v, 5) for v in mat_apply(inverse, offset)]
        transform["rotation"] = [round(v, 6) for v in
                                 matrix_to_euler(mat_mul(inverse, rotation))]
        world[item["id"]] = (position, rotation)

    # Recompose and check every part landed back where it was authored. A rebase is
    # exactly the kind of edit that looks right and is off by a sign somewhere.
    for item in components:
        transform = item["transform"]
        position = [float(v) for v in transform["position"]]
        rotation = euler_to_matrix([float(v) for v in transform["rotation"]])
        parent_id = item.get("parent")
        if parent_id is not None:
            parent_position, parent_rotation = world[parent_id]
            position = [parent_position[axis] + v
                        for axis, v in enumerate(mat_apply(parent_rotation, position))]
            rotation = mat_mul(parent_rotation, rotation)
        expected_position, expected_rotation = world[item["id"]]
        for axis in range(3):
            if abs(position[axis] - expected_position[axis]) > 1e-4:
                raise SystemExit(f"{item['id']} position round-trip failed on axis {axis}")
        for row in range(3):
            for col in range(3):
                if abs(rotation[row][col] - expected_rotation[row][col]) > 1e-5:
                    raise SystemExit(f"{item['id']} rotation round-trip failed")


localise(COMPONENTS)

# Joint records. Every child appendage states where it meets its parent and by how
# much it embeds, so nothing floats. Endpoints are in the child's own local frame.
ATTACHMENTS = {
    "claw-root": attach(
        "head-body", (0.195, HEAD_TOP, 0.0), (wx(880), wy(300), 0.0), "embedded-root", 0.035,
        "The sweep starts 0.035 inside the block's claw face and runs out along the spine.",
        [EVIDENCE, HEAD_ZONE]),
    "claw-tine-near": attach(
        "claw-root", (wx(880), wy(300), CLAW_TINE_Z), (wx(952), wy(438), CLAW_TINE_Z),
        "embedded-root", 0.048,
        "The tine starts 0.048 back inside the root sweep so the fork has no gap at its throat.",
        [HEAD_ZONE]),
    "claw-tine-far": attach(
        "claw-root", (wx(880), wy(300), -CLAW_TINE_Z), (wx(952), wy(438), -CLAW_TINE_Z),
        "embedded-root", 0.048, "Mirror of the near tine.", [HEAD_ZONE]),
    "eye-collar": attach(
        "head-body", (0.0, -EYE_COLLAR_H / 2, 0.0), (0.0, EYE_COLLAR_H / 2, 0.0),
        "seated-ring", 0.023,
        "The collar sinks 0.023 into the block's top face around the shaft.",
        [HEAD_ZONE]),
    "bracket-arm": attach(
        "bracket-plate", (-ARM_W / 2, 0.0, 0.0), (ARM_W / 2, 0.0, 0.0), "embedded-root", 0.030,
        "The bar starts 0.030 inside the plate's front face.", [EVIDENCE, BRACKET_ZONE]),
    "bracket-pivot-boss": attach(
        "bracket-arm", (0.0, -PIVOT_LEN / 2, 0.0), (0.0, PIVOT_LEN / 2, 0.0), "butt-joint", 0.040,
        "The boss overlaps the bar's outer end by 0.040.", [BRACKET_ZONE]),
    "bracket-pivot-ring": attach(
        "bracket-pivot-boss", (0.0, 0.0, 0.0), (PIVOT_RING_TUBE, 0.0, 0.0), "surface-relief", 0.020,
        "Relief on the boss face, sunk 0.020 into it, so it rides the boss rather than "
        "exploding on its own.", [BRACKET_ZONE]),
    "bracket-collar": attach(
        "bracket-pivot-boss", (0.0, -COLLAR_TUBE, 0.0), (0.0, COLLAR_TUBE, 0.0), "clamped-band",
        0.037,
        "The band's inner wall sits 0.037 inside the shaft radius at that height, which is what "
        "makes it read as gripping rather than hovering.", [EVIDENCE, BRACKET_ZONE]),
    "bracket-bolt": attach(
        "bracket-collar-lug", (-BOLT_LEN / 2, 0.0, 0.0), (BOLT_LEN / 2, 0.0, 0.0), "fastener-seat",
        0.020, "The bolt sinks 0.020 into the lug face.", [BRACKET_ZONE]),
}

for _component in COMPONENTS:
    if _component["id"] in ATTACHMENTS:
        _component["attachment"] = ATTACHMENTS[_component["id"]]

# ---------------------------------------------------------------------------
# repetition systems
# ---------------------------------------------------------------------------
# One system only. The reference shows no grip bands, no rivet rows and no repeated
# ornament anywhere: the only repeated element on the whole prop is the pair of
# counter-bore rings around the plate's screw holes. Declaring a second system
# would mean inventing detail the photograph does not contain.
REPETITION_SYSTEMS = [
    {
        "id": "screw-counterbores",
        "name": "Wall plate screw counterbores",
        "primitive": "torus",
        "instanceCount": 2,
        "distribution": "linear along the plate centreline",
        "spacingWorldUnits": round(SCREW_Y_TOP - SCREW_Y_BOTTOM, 4),
        "parent": "bracket-plate",
        "material": "bracket-navy",
        "jitter": {"position": 0.0, "rotation": 0.0, "scale": 0.0,
                   "notes": "Machined holes, so no jitter. Even spacing is correct here and the "
                            "usual 'repeated detail is too evenly spaced' warning does not apply."},
        "transforms": [
            {"position": [round(PLATE_CX - PLATE_T / 2 - 0.004, 4), SCREW_Y_TOP, 0.0],
             "rotation": [0.0, 0.0, math.pi / 2], "scale": [0.16, 0.16, 0.16]},
            {"position": [round(PLATE_CX - PLATE_T / 2 - 0.004, 4), SCREW_Y_BOTTOM, 0.0],
             "rotation": [0.0, 0.0, math.pi / 2], "scale": [0.16, 0.16, 0.16]},
        ],
        "evidenceRefs": [EVIDENCE, BRACKET_ZONE],
        "notes": "Each bore is ringed by a shallow counterbore that darkens its rim in the "
                 "reference. Instanced rather than modelled twice.",
    },
]

# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
PBR_LIMITATION = (
    "Extraction passed its own confidence gate (coral 0.717, cream 0.703, navy 0.754), but the "
    "maps are deliberately NOT bound to the runtime material and referencePbr.usable stays false. "
    "Two reasons. First, referenceMapUrl() in the generated factory resolves maps by absolute disk "
    "path, which cannot load in a browser and would break the material at runtime. Second, this "
    "reference is a flat-lit studio render of unpatterned matte plastic, so the crops carry baked "
    "lighting rather than surface pattern and tiling them would paint the reference's own shading "
    "onto every facet. The runtime instead builds five independent procedural canvas maps "
    "(albedo, roughness, height, normal, AO). The extracted palettes and roughness estimates were "
    "used as evidence for the albedo and roughness scalars below."
)

MATERIALS = [
    material("hammer", "head-coral", "Head coral plastic", CORAL,
             [CORAL, "#F76B5D", "#DB564B", "#C44C42"], 0.60, 0.13, 0.55, 0.717,
             [override("poll-face-polish", "poll-drum striking face",
                       "The struck face is the smoothest zone on the head; the reference shows its "
                       "brightest, tightest highlight there.",
                       [HEAD_ZONE], roughness=0.48, clearcoat=0.06),
              override("poll-step-shade", "poll-drum step groove",
                       "The recessed ring between collar and drum reads about 12 percent darker "
                       "than the drum crown.",
                       [HEAD_ZONE], dirtAmount=0.0, cavityBias=0.75, roughness=0.68),
              override("claw-fork-shade", "claw fork slot floor",
                       "The slot between the tines is the darkest coral on the prop.",
                       [HEAD_ZONE], cavityBias=0.85, roughness=0.70),
              override("head-chamfer-catch", "head-body chamfers",
                       "Every chamfer carries a bright rim line under the key light.",
                       [EVIDENCE, HEAD_ZONE], roughness=0.52)],
             "Coral is the loudest colour on the prop and reads as one matte moulded plastic "
             "across poll, block and claw, with no metal response anywhere.",
             texture_resolution=256),

    material("hammer", "handle-cream", "Handle cream plastic", CREAM,
             [CREAM, "#F5E0BF", "#EBD3AB", "#DCC49B"], 0.62, 0.11, 0.50, 0.703,
             [override("swell-crown-polish", "handle-shaft butt swell crown",
                       "The swell's crown is the brightest cream on the prop, about 12 percent "
                       "above the flank.",
                       [HANDLE_ZONE], roughness=0.55),
              override("collar-contact-shade", "handle-shaft under the clamp collar",
                       "A dark contact ring where the navy band grips the shaft.",
                       [BRACKET_ZONE, HANDLE_ZONE], cavityBias=0.8, dirtAmount=0.04),
              override("eye-seam-shade", "handle-shaft at the head eye",
                       "The cream darkens where it enters the coral eye collar.",
                       [HEAD_ZONE], cavityBias=0.75)],
             "A warm cream, slightly lighter at the crown boss than at the grip because the boss "
             "faces the key light. One material, not two.",
             texture_resolution=256),

    material("hammer", "bracket-navy", "Bracket navy plastic", NAVY,
             [NAVY, "#334052", "#273140", "#212C3D"], 0.66, 0.12, 0.62, 0.754,
             [override("bore-wall-shade", "bracket-plate screw bores",
                       "Both bore walls fall to near black, which is what makes the holes read as "
                       "openings rather than dots.",
                       [BRACKET_ZONE], cavityBias=0.9, roughness=0.74),
              override("band-crown-polish", "bracket-collar band crown",
                       "The band's crown catches the strongest highlight on the bracket.",
                       [BRACKET_ZONE], roughness=0.58),
              override("lug-split-line", "bracket-collar-lug split",
                       "A thin dark line across the lug where the clamp halves meet, with no "
                       "measurable depth, so it is a panel line rather than a groove.",
                       [BRACKET_ZONE], cavityBias=0.6, roughness=0.70)],
             "The darkest material on the prop. Its plate sample reads 33,44,61 and its arm 39,49,64, "
             "a difference that is lighting rather than two materials.",
             texture_resolution=256),
]

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
DETAILS = [
    detail("poll-face-chamfer-ring", "head-poll", "bevel",
           "The striking face is a flat disc inside a bright chamfer ring about 0.065 wide.",
           "poll-drum/poll-face-chamfer", "Lathe profile steps 0.2496, 0.236, 0.196.",
           HEAD_ZONE, 0.8, MATERIAL_IDS),
    detail("poll-step-groove", "head-poll", "groove",
           "A recessed ring 0.023 deep separates the poll collar from the drum.",
           "poll-drum/poll-step-groove", "Lathe profile radius dip at t 0.130.",
           HEAD_ZONE, 0.8, MATERIAL_IDS),
    detail("poll-step-shading", "head-poll", "stain",
           "The step groove floor sits about 12 percent below the drum crown in value.",
           "head-coral/poll-step-shade", "Material local override, cavity bias 0.75.",
           HEAD_ZONE, 0.75, MATERIAL_IDS),
    detail("claw-crescent-opening", "head-claw", "hole",
           "The background shows through under the claw across rows 250-438, which is the single "
           "most identifying feature of the silhouette.",
           "claw-root/claw-crescent", "Spine curvature leaves the underside open.",
           HEAD_ZONE, 0.85, MATERIAL_IDS),
    detail("claw-fork-slot", "head-claw", "groove",
           "The claw splits into two tines separated by a 0.172 slot.",
           "claw-tine-near/tine-taper", "Two swept tines at z +/-0.086 on the same spine.",
           HEAD_ZONE, 0.7, MATERIAL_IDS),
    detail("claw-fork-shading", "head-claw", "stain",
           "The slot floor is the darkest coral on the prop.",
           "head-coral/claw-fork-shade", "Material local override, cavity bias 0.85.",
           HEAD_ZONE, 0.7, MATERIAL_IDS),
    detail("head-edge-chamfers", "head-body", "bevel",
           "Every edge of the head block is softened by about 0.055 and carries a rim highlight.",
           "head-body/body-edge-chamfer", "edgeTreatment chamfer, 3 segments.",
           HEAD_ZONE, 0.8, MATERIAL_IDS),
    detail("chamfer-highlight", "head-body", "gloss",
           "The chamfers read brighter than the faces they join, not as a separate colour.",
           "head-coral/head-chamfer-catch", "Roughness local override to 0.52 on the chamfers.",
           HEAD_ZONE, 0.7, MATERIAL_IDS),
    detail("crown-boss", "head-crown", "ridge",
           "The cream shaft stands 0.117 proud of the coral at the head crown, radius 0.158.",
           "handle-shaft/crown-boss", "Lathe profile stops at y 2.083, 2.169, 2.200.",
           HEAD_ZONE, 0.85, MATERIAL_IDS),
    detail("eye-seam", "head-crown", "seam",
           "A dark seam about 0.012 wide runs where the cream shaft meets the coral collar.",
           "eye-collar/eye-seam", "Collar chamfer plus an AO override on the contact ring.",
           HEAD_ZONE, 0.7, MATERIAL_IDS),
    detail("eye-seam-shading", "head-crown", "stain",
           "The cream darkens into the eye rather than meeting the coral at full value.",
           "handle-cream/eye-seam-shade", "Material local override, cavity bias 0.75.",
           HEAD_ZONE, 0.65, MATERIAL_IDS),
    detail("handle-swell", "handle", "ridge",
           "The shaft widens from radius 0.150 to 0.207 between y 1.325 and y 0.326.",
           "handle-shaft/butt-swell", "Lathe profile radius stops.",
           HANDLE_ZONE, 0.85, MATERIAL_IDS),
    detail("swell-crown-gloss", "handle", "gloss",
           "The swell crown is the brightest cream on the prop, about 12 percent over the flank.",
           "handle-cream/swell-crown-polish", "Roughness local override to 0.55.",
           HANDLE_ZONE, 0.7, MATERIAL_IDS),
    detail("handle-butt-dome", "handle", "bevel",
           "The butt closes as a dome over its last 0.096 rather than a flat disc.",
           "handle-shaft/butt-round", "Lathe profile collapses to radius 0.010.",
           HANDLE_ZONE, 0.8, MATERIAL_IDS),
    detail("collar-contact-ring", "bracket", "stain",
           "A dark ring marks where the navy band grips the cream shaft.",
           "handle-cream/collar-contact-shade", "Material local override, cavity bias 0.8.",
           BRACKET_ZONE, 0.75, MATERIAL_IDS),
    detail("plate-screw-bores", "bracket", "hole",
           "Two through holes of radius 0.048 on the plate centreline, 0.461 apart.",
           "bracket-plate/plate-screw-bores", "ExtrudeGeometry shape holes, real openings.",
           BRACKET_ZONE, 0.8, MATERIAL_IDS),
    detail("bore-wall-darkening", "bracket", "stain",
           "Both bore walls fall to near black, which is what reads as depth.",
           "bracket-navy/bore-wall-shade", "Material local override, cavity bias 0.9.",
           BRACKET_ZONE, 0.75, MATERIAL_IDS),
    detail("plate-corner-radius", "bracket", "bevel",
           "All four plate corners carry a 0.075 radius.",
           "bracket-plate/plate-corner-radius", "Rounded-rectangle outline arcs.",
           BRACKET_ZONE, 0.85, MATERIAL_IDS),
    detail("pivot-face-ring", "bracket", "ridge",
           "A ring of radius 0.072 stands proud of the pivot boss face.",
           "bracket-pivot-ring/ring-relief", "Closed tube loop sunk 0.004 into the face.",
           BRACKET_ZONE, 0.6, MATERIAL_IDS),
    detail("lug-split-line", "bracket", "linework",
           "A thin dark line crosses the clamp lug where its two halves meet. It has no measurable "
           "depth in the reference, so it is a panel line rather than a groove.",
           "bracket-navy/lug-split-line", "Material local override along the split, no relief.",
           BRACKET_ZONE, 0.55, MATERIAL_IDS),
    detail("band-crown-gloss", "bracket", "gloss",
           "The collar band's crown carries the strongest highlight on the bracket.",
           "bracket-navy/band-crown-polish", "Roughness local override to 0.58.",
           BRACKET_ZONE, 0.65, MATERIAL_IDS),
]

DETAIL_INVENTORY = detail_inventory(
    DETAILS, 10,
    "grid-4x4 zone scan of the reference, followed by colour-classified row scans at rows 150-490 "
    "for the head, 510-1280 for the handle and 540-960 for the bracket, so every part boundary was "
    "placed in pixels before being converted to world units.")

# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
BLOCKOUT_REFS = ["handle-shaft", "head-body", "poll-drum", "claw-root", "bracket-plate"]
ALL_REFS = [c["id"] for c in COMPONENTS]

PASSES = build_passes(
    BLOCKOUT_REFS, ALL_REFS,
    "Match the macro silhouette: a 2.20 unit shaft with the head block, the poll drum, the claw "
    "hook and the wall plate in place.",
    "Build the full head assembly, the claw fork and the whole bracket chain under one root.",
    "Deliver the poll's two-step profile, the claw crescent and fork, the crown boss and the "
    "plate's real screw bores.",
    "Match the coral, cream and navy palette and the matte moulded-plastic response.",
    ["The claw reads as an open hook with background visible under it from at least two angles.",
     "The poll shows a collar, a recessed step and a chamfered face, not a plain cylinder.",
     "The cream shaft is continuous from butt to crown boss with no visible joint."],
    has_repetition=True)

FEATURE_REVIEW_TARGETS = [
    {"id": "claw-hook-read", "name": "Claw reads as an open hook",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["claw-root", "claw-tine-near", "claw-tine-far"],
     "evidenceRefs": [EVIDENCE, HEAD_ZONE],
     "failureModes": ["claw is a solid wedge with no crescent",
                      "claw reads flat from an orbit view",
                      "fork slot missing so the claw is one blunt tine"]},
    {"id": "poll-drum-profile", "name": "Poll drum two-step profile",
     "tier": "critical", "passIds": ["structural-pass", "form-refinement", "surface-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["poll-drum"], "evidenceRefs": [EVIDENCE, HEAD_ZONE],
     "failureModes": ["poll is a plain cylinder", "step groove missing",
                      "striking face domed instead of chamfered flat"]},
    {"id": "shaft-proportion", "name": "Shaft proportion and swell",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "optimization-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["handle-shaft"], "evidenceRefs": [EVIDENCE, HANDLE_ZONE],
     "failureModes": ["shaft is a straight cylinder with no swell",
                      "overall length drifts from 2.20 units",
                      "crown boss missing so the head reads as capped"]},
    {"id": "bracket-chain", "name": "Bracket plate, arm, boss and collar chain",
     "tier": "critical", "passIds": ["structural-pass", "form-refinement", "interaction-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["bracket-plate", "bracket-arm", "bracket-pivot-boss", "bracket-collar"],
     "evidenceRefs": [EVIDENCE, BRACKET_ZONE],
     "failureModes": ["collar floats off the shaft", "arm does not reach the plate",
                      "screw bores painted on instead of cut through"]},
    {"id": "matte-plastic-response", "name": "Matte moulded-plastic response",
     "tier": "important", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["head-body", "handle-shaft", "bracket-plate"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["glossy toy highlights on matte plastic", "flat unshaded faces",
                      "palette drifts from the three measured albedos"]},
    {"id": "crown-boss-read", "name": "Crown boss at the head eye",
     "tier": "important", "passIds": ["form-refinement", "surface-pass"],
     "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["handle-shaft", "eye-collar"], "evidenceRefs": [HEAD_ZONE],
     "failureModes": ["boss missing", "boss flush with the coral", "boss the wrong colour"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "primary three-quarter view from slightly below and camera left",
     "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": [
         "Silhouette box spans x 153-974 and y 144-1290 of a 1086x1448 image: 822 by 1147 px.",
         "Three albedos only: coral head, cream shaft, navy bracket.",
         "The shaft passes through the head and reappears on top as a cream boss.",
         "The claw hooks to the right with open background beneath it.",
         "No grip bands, rivets, decals or wear marks appear anywhere on the prop.",
     ],
     "confidence": 0.9},
    {"id": HEAD_ZONE, "view": "head assembly",
     "imageRegion": {"x": 0.21, "y": 0.09, "width": 0.68, "height": 0.26, "units": "normalized"},
     "observations": [
         "Coral spans rows 175-490 and columns 254-941; the widest row is 330 at 688 px.",
         "The poll drum's projected face is about 260 px tall and 216 px wide, and because its "
         "axis is horizontal the 260 px is its true diameter.",
         "Rows 350-430 show a background gap between the head body and the claw hook.",
         "The cream boss spans columns 488-653 and rows 144-205.",
     ],
     "confidence": 0.8},
    {"id": HANDLE_ZONE, "view": "handle shaft",
     "imageRegion": {"x": 0.40, "y": 0.34, "width": 0.24, "height": 0.56, "units": "normalized"},
     "observations": [
         "Cream runs measure 110 px at row 510, 138 px at row 720, 170 px at row 1000, 198 px at "
         "rows 1120 and 1180, then 82 px at row 1280.",
         "The widest point is rows 1120-1180, about a quarter of the way up from the butt.",
         "The shaft carries no bands, wraps or texture: it is one smooth surface.",
     ],
     "confidence": 0.85},
    {"id": BRACKET_ZONE, "view": "wall bracket",
     "imageRegion": {"x": 0.13, "y": 0.37, "width": 0.55, "height": 0.29, "units": "normalized"},
     "observations": [
         "Navy plate spans columns 153-350 and rows 555-965: 197 by 410 px.",
         "Two circular gaps interrupt the plate at rows 640 and 880, centred near column 280.",
         "The arm runs from the plate to a pivot boss near column 440, row 840.",
         "A band crosses the shaft at rows 760-920 with a raised lug on its claw side.",
         "The plate's thickness in Z is never visible and is inferred.",
     ],
     "confidence": 0.75},
]

SPEC = assemble(
    target_name="Apartment Claw Hammer On Wall Bracket",
    target_id="apartment-claw-hammer",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": False,
        "solveMethod": "Bracketed rather than solved. The prop carries no circle whose projected "
                       "ellipse would fix the elevation the way the beach ball's valve cap did. "
                       "The poll drum's face is the only candidate and it is partly occluded by "
                       "its own collar, so its 216/260 axis ratio bounds the combined yaw and "
                       "elevation near 34 degrees without separating them.",
        "fovDegrees": 26.0,
        "aspect": round(1086 / 1448, 4),
        "orientation": {"yaw": -24.0, "pitch": -12.0, "roll": 0.0},
        "targetHint": [0.0, 1.1, 0.0],
        "note": "Yaw and pitch are a starting bracket for the review harness, not a solve. The "
                "harness fits camera distance by matching the render's projected bounding box to "
                "the reference box (x 153-974, y 144-1290 of 1086x1448), so framing error does not "
                "contaminate the Tier 1 scale delta.",
    },
    measurement_basis={
        "pixelsPerWorldUnit": round(PX_PER_UNIT, 1),
        "referenceBBox": {"x0": 153, "y0": 144, "x1": 974, "y1": 1290, "imageSize": [1086, 1448]},
        "derivations": [
            "Overall length is held at 2.20 world units to preserve the envelope of the prop being "
            "replaced, so 1146 px of silhouette height gives 520.9 px per world unit.",
            "The handle axis sits at column 586, the median centre of the cream runs at rows 600, "
            "1120 and 1180.",
            "Handle radii are half the cream run at each row: 110 px at 510, 138 at 720, 170 at "
            "1000, 198 at 1120 and 1180, 82 at 1280.",
            "Coral spans rows 200-490, giving a head height of 0.557 units.",
            "Coral spans columns 254-941, giving a head length of 1.319 units about the shaft axis.",
            "The poll drum's 260 px projected face height is its true diameter because its axis is "
            "horizontal, giving a radius of 0.2496 and setting the head's 0.500 depth.",
            "The plate mask spans 197 by 410 px, giving 0.378 by 0.787 units.",
            "Screw bore centres sit at rows 640 and 880, which is 0.461 units apart.",
            "Colours are median samples: head 244,103,89 lit and 236,95,82 shaded; handle "
            "235,211,171 and 240,216,178; plate 33,44,61 and arm 39,49,64.",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2,
            "interaction_fit": 3},
    pre_spec={
        "objectClass": {
            "primaryType": "stylised claw hammer suspended in a wall-mounted clamp bracket",
            "primaryDomain": "object",
            "formLanguage": ["hard-surface", "mechanical", "stylized-tool"],
            "structureKind": ["articulated assembly", "compound object", "layered shell"],
            "motionPotential": ["whole-object swing about the bracket pivot", "detachable bracket",
                                "static prop"],
            "materialFamilies": ["matte-plastic-coral", "matte-plastic-cream",
                                 "matte-plastic-navy"],
            "notes": "Hard-surface mechanical assembly in three flat matte plastics. The identity "
                     "is the claw's open hook and the poll's stepped drum, neither of which any "
                     "single primitive gives. One view: the far side of the head, the far claw "
                     "tine, the back of the plate and the far clamp bolt are inferred.",
        },
        "complexity": {
            "tier": "complex",
            "scores": {"silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 3,
                       "repetitionDensity": 1, "materialLayerCount": 2, "localDetailDensity": 2,
                       "occlusionRisk": 2, "actionReadinessNeed": 2},
            "estimatedCounts": {"macroComponents": 4, "mesoComponents": 6, "microFeatureGroups": 4,
                                "materialLayers": 3, "repetitionSystems": 1},
            "reasoning": [
                "The silhouette is heavily interrupted: an open claw crescent, a stepped drum and "
                "a bracket that crosses the shaft.",
                "Hierarchy is genuinely four deep, shaft to plate to arm to boss to collar to lug "
                "to bolt, and the bracket has to move as one assembly.",
                "Repetition density is the lowest axis: the reference shows exactly one repeated "
                "element, the pair of screw bores.",
                "Local detail density is moderate. The surfaces are clean matte plastic with no "
                "wear, dirt, decals or scratches anywhere, so inventing any would be wrong.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "complex",
            "minimumComponentLevels": ["macro", "meso", "micro"],
            "needsRepetitionSystems": True,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": True,
            "rationale": "The claw hook and the poll step are three-dimensional form, not texture, "
                         "so they need real geometry and more than one review angle. The bracket "
                         "chain needs a real parent hierarchy so it can be hidden or pivoted as "
                         "one unit.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "The head's depth in Z is never directly visible.",
             "resolution": "Set to 0.500 from the poll drum's true face diameter, since the drum "
                           "axis is horizontal and its projected face height is unforeshortened.",
             "confidence": 0.7},
            {"unknown": "The far claw tine is mostly hidden behind the near one.",
             "resolution": "Mirrored across the fork plane at z -0.086. Recorded at confidence 0.5 "
                           "on claw-tine-far.",
             "confidence": 0.5},
            {"unknown": "The wall plate's thickness is never visible.",
             "resolution": "Set to 0.120, about a third of the plate's 0.378 width, which is the "
                           "thinnest value that still reads as a plate rather than a card.",
             "confidence": 0.5},
            {"unknown": "Whether the clamp collar is split, and where.",
             "resolution": "Treated as a split clamp with one lug and one bolt on the claw side, "
                           "which is what the raised block at columns 641-727 shows. The far side "
                           "is not visible and carries no second lug.",
             "confidence": 0.55},
            {"unknown": "Whether the bracket belongs in the game scene at all.",
             "resolution": "Built, because it is in the reference, but parented as one named "
                           "sub-assembly under bracket-plate so a caller can hide it in one call. "
                           "The swinging_hammer trap draws its own pendulum rig, so the bracket "
                           "would be redundant there.",
             "confidence": 0.9},
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
        "complex",
        ["The rendered hammer matches the reference silhouette, the open claw crescent, the poll's "
         "two-step drum, the continuous cream shaft and the four-link bracket chain at the complex "
         "fidelity tier.",
         "The claw and the poll hold their form from at least two camera angles, so neither reads "
         "as a flat card when the prop swings.",
         "The prop is action-ready: the bracket hides as one named sub-assembly and the shaft "
         "carries the swing pivot socket, both drivable from root.userData.sculptRuntime."],
        {"macroComponents": 4, "mesoComponents": 4, "microFeatureGroups": 3, "materialLayers": 3,
         "repetitionSystems": 1, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Overall length, head length, head height and handle radii are stated "
                           "as measured numbers converted from named pixel runs.",
                           "The head-length to overall-length ratio traces to columns 254-941 over "
                           "rows 144-1290."],
                          [EVIDENCE, HEAD_ZONE, HANDLE_ZONE],
                          ["model reads as a mallet because the claw is missing or closed",
                           "handle is a straight cylinder with no swell",
                           "proportions guessed rather than measured"]),
            feature_group("claw-and-poll-form", "Claw hook and poll drum as three-dimensional form",
                          ["The claw is swept along a measured 3D spine, not extruded from a flat "
                           "outline.",
                           "The poll is revolved with a stated radius profile including its step "
                           "groove and face chamfer.",
                           "The fork is two separated tines, not a painted line."],
                          [EVIDENCE, HEAD_ZONE],
                          ["claw is a flat card that collapses when orbited",
                           "poll is a plain cylinder",
                           "fork drawn as a texture rather than modelled"]),
            feature_group("bracket-assembly", "Bracket plate, arm, boss, collar chain",
                          ["Every bracket part names its parent and its seam overlap.",
                           "The screw bores are real openings cut through the plate.",
                           "The collar's inner wall genuinely overlaps the shaft radius."],
                          [EVIDENCE, BRACKET_ZONE],
                          ["collar floats off the shaft",
                           "bores painted on as dark dots",
                           "bracket parts fused into one mesh so it cannot be hidden"]),
            feature_group("matte-plastic-materials", "Three matte plastics with local response",
                          ["Each material records a sampled albedo palette, roughness variation "
                           "and an independent normal response.",
                           "Local overrides are tied to named evidence regions.",
                           "No material claims metal, clearcoat gloss or wear the reference does "
                           "not show."],
                          [EVIDENCE, HEAD_ZONE, HANDLE_ZONE, BRACKET_ZONE],
                          ["glossy plastic highlights on a matte prop",
                           "albedo reused as roughness or normal",
                           "invented scratches, dirt or decals"]),
        ],
        ["silhouette and claw-crescent negative-space delta",
         "poll step and face chamfer profile delta",
         "handle radius profile delta at the measured rows",
         "bracket chain placement delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.8,
        "mustMatch": ["open claw crescent with background visible beneath the hook",
                      "poll drum with collar, step groove and chamfered face",
                      "continuous cream shaft from butt dome to crown boss",
                      "three-albedo palette with no fourth colour",
                      "wall plate with two real through bores"],
        "niceToHave": ["the clamp lug's split line",
                       "the raised ring on the pivot boss face"],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-matched", "front", "right", "rear", "top", "grazing"],
    },
    feature_review_targets=FEATURE_REVIEW_TARGETS,
    view_evidence=VIEW_EVIDENCE,
    components=COMPONENTS,
    materials=MATERIALS,
    repetition_systems=REPETITION_SYSTEMS,
    passes=PASSES,
    lighting=[
        "Ambient dominance: the reference is a soft studio render. Coral measures 244,103,89 lit "
        "against 236,95,82 shaded, a 6.5 percent luma spread across a full curve, which needs a "
        "bright neutral hemisphere rather than a hard key.",
        "Key light: a gentle warm directional source from high and camera left at about 1.15. The "
        "head's top faces and the swell crown are the brightest zones, which fixes the direction.",
        "Rim and environment light: weak neutral back light at about 0.3. No environment map: "
        "nothing on the prop reflects anything.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The "
        "reference holds a narrow range with no blown highlights, the brightest cream reading 237 "
        "at the 95th percentile.",
        "Contact shadow: seam and cavity occlusion only, at the eye collar, the collar band, the "
        "fork slot and both screw bores. The reference prop floats with no ground contact, so the "
        "review render has no ground plane and the silhouette mask stays clean.",
    ],
    action_readiness=action_readiness(
        "handle-shaft",
        {"rootMotion": "sculptRuntime.nodes['handle-shaft'] carries translation, rotation and "
                       "scale; the head and the bracket are its children so the prop swings as one "
                       "body.",
         "bracketAssembly": "sculptRuntime.nodes['bracket-plate'] is the parent of the whole "
                            "bracket chain, so setting it invisible removes arm, boss, ring, "
                            "collar, lug and bolt in one call. The swinging_hammer trap draws its "
                            "own pendulum rig and does not want the wall mount.",
         "swingPivot": "sculptRuntime.sockets['handle-shaft:swing-pivot'] marks the crown, which "
                       "is the end a pendulum hangs from.",
         "strikeFace": "sculptRuntime.sockets['poll-drum:strike-face'] marks the striking face for "
                       "an impact effect.",
         "collider": "colliders['handle-shaft'] is a capsule proxy along the shaft. The trap's own "
                     "CuboidColliders are authored in TrapRenderer and this prop does not replace "
                     "them."},
        "head, handle, bracket",
        "Detach the bracket chain as one group; the head assembly is not fractured."),
    assumptions=[
        "One world unit is about 12 cm, making the modelled hammer about 26 cm long.",
        "The head's depth in Z is 0.500, inferred from the poll drum's face diameter.",
        "The wall plate is 0.120 thick; its thickness is never visible.",
        "The far claw tine mirrors the near one.",
        "The clamp has one lug and one bolt, both on the claw side.",
        "The origin stays at the handle butt with the head along +Y, because TrapRenderer already "
        "positions and rotates for that frame and this asset does not own that file.",
    ],
    coordinate_frame={
        "front": "+Z, the face turned toward the reference camera",
        "up": "+Y, the shaft axis, with the head at +Y and the butt at the origin",
        "right": "+X, the claw side; the striking face points along -X",
        "scaleReference": "overall length = 2.20 world units; 520.9 reference pixels per world unit",
    },
    silhouette={
        "boundingShape": "a 2.20 unit vertical shaft carrying a 1.319 by 0.557 unit head at the "
                         "top, with a 0.378 by 0.787 unit plate standing off to -X at mid height",
        "aspectRatios": [
            {"id": "width-to-height", "value": round(822 / 1147, 3),
             "notes": "reference silhouette 822 px over 1147 px"},
            {"id": "head-length-to-overall", "value": round(687 / 1146, 3),
             "notes": "coral columns 254-941 over silhouette rows 144-1290"},
            {"id": "head-height-to-length", "value": round(290 / 687, 3),
             "notes": "coral rows 200-490 over coral columns 254-941"},
            {"id": "swell-to-neck-radius", "value": round(0.207 / 0.150, 3),
             "notes": "handle radius at row 1120 over radius at row 600"},
        ],
        "symmetry": "mirror symmetric about the XY plane in form; the bracket breaks that symmetry "
                    "only through its single clamp lug",
        "dominantCurves": ["the claw's hook, a continuous curve of decreasing radius from the head "
                           "block to the tip",
                           "the handle's swell, a single smooth radius maximum a quarter of the "
                           "way up from the butt"],
        "negativeSpaces": ["the crescent under the claw hook",
                           "the fork slot between the two tines",
                           "the two screw bores through the wall plate",
                           "the gap between the plate and the shaft, crossed only by the arm"],
        "landmarks": ["butt at y 0", "swell maximum radius 0.207 at y 0.326",
                      "collar band centre at y 0.864", "head bottom at y 1.536",
                      "head top at y 2.093", "crown at y 2.200",
                      "poll face at x -0.637", "claw tip at x 0.699"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "full tree: shaft lathe at 28 segments, poll lathe at 26, both claw tines, "
                     "the whole bracket chain; 256px procedural maps"},
        {"tier": "mid", "distance": 12,
         "strategy": "drop the pivot face ring, the clamp bolt and the far claw tine; shaft lathe "
                     "to 16 segments"},
        {"tier": "far", "distance": 30,
         "strategy": "shaft, head block, poll and claw root only, at the dominant albedo; no "
                     "bracket"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 9000,
        "maxDrawCalls": 14,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "Reach accepted visual fidelity first, then cut lathe and sweep "
                              "segment counts. The claw crescent sets the floor: below about 24 "
                              "sweep steps the hook's inner curve facets visibly and the crescent "
                              "stops reading as a curve.",
    },
    procedural_strategy=[
        "Block out the shaft lathe, the head block, the poll drum, the claw root and the wall "
        "plate first, and confirm the silhouette carries an open claw crescent.",
        "Add the claw tines, the eye collar and the whole bracket chain as named children.",
        "Create pivot nodes, the swing and strike sockets and the collider proxies before any "
        "visual polish.",
        "Cut the plate's screw bores as real ExtrudeGeometry holes rather than dark decals.",
        "Run reference PBR extraction on per-material crops, record its confidence, and decide "
        "explicitly whether to bind or only cite the maps.",
        "Add chamfer highlights, cavity darkening and the collar contact ring before any micro "
        "geometry.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['handle-shaft'] carries whole-object translation and rotation",
        "sculptRuntime.sockets['handle-shaft:swing-pivot'] is the crown a pendulum hangs from",
        "sculptRuntime.sockets['handle-shaft:grip-centre'] is the grip's centre",
        "sculptRuntime.sockets['poll-drum:strike-face'] anchors an impact effect",
        "sculptRuntime.nodes['bracket-pivot-boss'] rotates about its own axis if the bracket is "
        "ever animated",
    ],
    destruction_anchors=["the bracket chain detaches as one group from bracket-plate down",
                         "the head assembly is not fractured; a break would be a material state"],
    risks=[
        "Single reference view: the head's depth, the far claw tine, the plate's thickness and the "
        "far side of the clamp are all inferred, at confidences 0.7, 0.5, 0.5 and 0.55.",
        "The reference camera is bracketed, not solved. The prop carries no circle whose projected "
        "ellipse would separate yaw from elevation, so the review harness fits framing by bounding "
        "box and the orbit views are judged only for self-consistency.",
        "The reference includes a wall bracket that the swinging_hammer trap does not want, because "
        "that trap draws its own pendulum rig. The bracket is built because it is in the reference "
        "and is parented so a caller can hide it in one call, but shipping it visible would put two "
        "mounting systems on one prop.",
        "The prop's frame is fixed by TrapRenderer.tsx, which this asset does not own. Measured "
        "against that frame, the trap's head CuboidCollider and the prop's visible head do not "
        "occupy the same place: the collider sits at world (0, -1.75) with half extents "
        "(0.68, 0.42, 0.42) while the model's head lands at world (-1.93, -2.25). That is a "
        "pre-existing disagreement in the shipped code, it is not introduced here, and it cannot be "
        "corrected from inside the model.",
        "Reference PBR maps were extracted and passed their confidence gate at 0.717, 0.703 and "
        "0.754, but are deliberately not bound to the runtime material. referencePbr.usable stays "
        "false because the generated referenceMapUrl() resolves by absolute disk path, which cannot "
        "load in a browser.",
        "One refine-code edit to the generated factory is required and is not expressible through "
        "the generator as shipped. makeAttachmentEndpoint must honour attachment.geometryFromEndpoint "
        "= false. Without it, every component carrying a joint record - the claw sweeps, the collar "
        "band, the pivot ring, the boss and the bolt - has its authored geometry replaced by a "
        "tapered cylinder and its transform replaced by the endpoint, which discards the measured "
        "lathe, sweep and tube profiles those parts exist for.",
    ],
)


if __name__ == "__main__":
    write_spec(OUT, SPEC)
