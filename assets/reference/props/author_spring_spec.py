#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment spring jump pad.

Every dimension is derived from measurements of assets/reference/spring-reference.png
made with measure_reference.py, measure_regions.py and measure_parts.py, all recorded in
`measurementBasis` so a later session can re-check them.

Run:  python author_spring_spec.py
Writes: spring-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math

from spec_lib import (
    HERE, PROJECT, action, action_readiness, assemble, build_passes, colours, component,
    descriptor, detail, detail_inventory, dims, feature, feature_group, material, override,
    profile, quality_contract, surface, write_spec, xform,
)

PROP = "spring"
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "spring-reference.png")
OUT = HERE / "spring-sculpt-spec.json"
EVIDENCE = "full-object"

# ---------------------------------------------------------------------------
# Measured geometry.
#
# Silhouette box x[142,938] y[181,1237] of a 1086x1448 image: 797 wide by 1057 tall.
# measure_parts.py separates the three albedos (coral cap #F56058, yellow coil #F5C321,
# navy base #27334C) with a shadow sink so an antialiased edge cannot claim a part:
#
#   cap    x[143,937] w=795   y[182,633]  h=452
#   coil   x[246,846] w=601   y[576,1040] h=465
#   base   x[151,928] w=778   y[834,1235] h=402
#
# ELEVATION. A disc at elevation e projects as two ellipses joined by tangent lines, so
# the band of CONSTANT maximum width has projected height T cos(e) and the whole disc has
# D sin(e) + T cos(e). The base holds its 774 px maximum across y 934..1034, so
# T cos(e) = 100 and D sin(e) = 402 - 100 = 302, giving sin(e) = 302/774 = 0.390.
# That is 22.96 degrees, and it reproduces the cap independently: 794 * 0.390 = 310 leaves
# 142 px for T cos(e) against the 141 measured from its own constant-width band.
# ---------------------------------------------------------------------------
ELEVATION_DEG = 22.96
SIN_E = math.sin(math.radians(ELEVATION_DEG))          # 0.3902
COS_E = math.cos(math.radians(ELEVATION_DEG))          # 0.9207

# Ellipse half-depth of each disc, D sin(e) / 2, which is what converts a silhouette
# top or bottom into the ellipse CENTRE the part's axial extent is measured between.
PX_CAP_D = 794.0
PX_BASE_D = 774.0
PX_COIL_OUTER_D = 601.0

CAP_TOP_C = 182 + PX_CAP_D * SIN_E / 2                 # 337
CAP_BOTTOM_C = 633 - PX_CAP_D * SIN_E / 2              # 478
BASE_TOP_C = 834 + PX_BASE_D * SIN_E / 2               # 985
BASE_BOTTOM_C = 1235 - PX_BASE_D * SIN_E / 2           # 1084

# Axial (world) heights in reference pixels: a projected vertical span between two points
# on the same axis is H cos(e), so H = span / cos(e).
PX_CAP_T = (CAP_BOTTOM_C - CAP_TOP_C) / COS_E          # 153
PX_BASE_T = (BASE_BOTTOM_C - BASE_TOP_C) / COS_E       # 108
PX_COIL_SPAN = (BASE_TOP_C - CAP_BOTTOM_C) / COS_E     # 551, base top face to cap underside
PX_TOTAL_H = PX_CAP_T + PX_COIL_SPAN + PX_BASE_T       # 812

# COIL. At the centre column the tube runs horizontally, so its projected vertical
# thickness IS the tube diameter with no foreshortening. Column x=540 gives three clean
# bands of 92, 99 and 99 px and centre-to-centre steps of 132 and 147 px.
PX_TUBE_D = 97.0
PX_COIL_PITCH = 139.5 / COS_E                          # 151.5 axial rise per turn
COIL_TURNS = 3
# 3 * 151.5 + 97 = 551.5 against the 551 measured span: the turn count is not a guess.

# ---------------------------------------------------------------------------
# The envelope, and the deviation it forces.
#
# The spring pad has NO collider: TrapRenderer's Spring mounts it in a plain group and
# launches on a distance test. Its gameplay contract is therefore two numbers, and both
# are call-site facts rather than art direction:
#
#   footprint  the launch test is |dx| < 0.7 and |dz| < 0.7 about trap.position, so
#              anything wider than 1.40 is visible pad that does not launch.
#   height     PLAYER.stepAssistHeight is 0.45, the tallest riser PlayerController lifts
#              the runner over. A pad taller than that stops being a pad and becomes a
#              wall the runner has to jump before it can throw him.
#
# The reference is a stool: 812 px of height against 794 px of cap diameter, an aspect of
# 1.023. The envelope's aspect is 0.45 / 1.40 = 0.321. There is no spring that satisfies
# both, so the plan is taken from the reference and the height is compressed to 31.4% of
# what that plan implies. This is the largest reference deviation of the four props and it
# is recorded here rather than presented as a match. The preview harness renders the
# review pass at ?yscale=3.181, which undoes exactly this factor, so the Tier-1 aspect
# gate scores the shape rather than the squash.
# ---------------------------------------------------------------------------
FOOTPRINT = 1.40
STAND_HEIGHT = 0.45
PLAN_SCALE = FOOTPRINT / PX_CAP_D                      # world units per reference pixel, in plan
SQUASH = round(STAND_HEIGHT / (PX_TOTAL_H * PLAN_SCALE), 5)   # 0.31429
YSCALE_FOR_REVIEW = round(1 / SQUASH, 3)               # 3.181


def plan(pixels: float) -> float:
    """A horizontal reference span in world units."""
    return round(pixels * PLAN_SCALE, 4)


def rise(pixels: float) -> float:
    """An axial reference span in world units, after the envelope squash."""
    return round(pixels * PLAN_SCALE * SQUASH, 4)


CAP_DIAMETER = plan(PX_CAP_D)                          # 1.4000
CAP_THICKNESS = rise(PX_CAP_T)                         # 0.0848
BASE_DIAMETER = plan(PX_BASE_D)                        # 1.3647
BASE_THICKNESS = rise(PX_BASE_T)                       # 0.0598
COIL_OUTER_DIAMETER = plan(PX_COIL_OUTER_D)            # 1.0597
COIL_TUBE_RADIUS = plan(PX_TUBE_D / 2)                 # 0.0855
COIL_MEAN_RADIUS = round((COIL_OUTER_DIAMETER - 2 * COIL_TUBE_RADIUS) / 2, 4)   # 0.4444
COIL_PITCH = rise(PX_COIL_PITCH)                       # 0.0839
COIL_SPAN = rise(PX_COIL_SPAN)                         # 0.3053

BASE_RADIUS = round(BASE_DIAMETER / 2, 4)
CAP_RADIUS = round(CAP_DIAMETER / 2, 4)
# The chevron inlays stand this far proud of the cap, and the cap top drops by the same
# amount so the assembly still tops out at exactly STAND_HEIGHT. Flush was tried and is
# wrong twice over: two coplanar faces z-fight, which broke the inlays into slivers from
# the top-down view the chase camera actually has, and standing them proud WITHOUT paying
# for it put the prop at 0.4627 against a 0.45 ceiling.
CHEVRON_PROUD = 0.006
CAP_TOP_Y = round(STAND_HEIGHT - CHEVRON_PROUD, 4)
CAP_CENTRE_Y = round(CAP_TOP_Y - CAP_THICKNESS / 2, 4)
CAP_UNDERSIDE_Y = round(CAP_TOP_Y - CAP_THICKNESS, 4)

# The coil is authored at reference proportion and squashed by its own node, because the
# tube's CROSS-SECTION has to squash with the pitch. Squashing the path alone would leave
# a 0.171-wide tube on a 0.0839 pitch, which is a solid cone rather than a spring; the
# node scale gives the 0.171 by 0.0538 elliptical section the reference's tube-to-pitch
# ratio of 0.64 actually implies at this height.
COIL_PITCH_UNSQUASHED = round(COIL_PITCH / SQUASH, 4)
COIL_BASE_Y_UNSQUASHED = round(BASE_THICKNESS / SQUASH, 4)
COIL_SAMPLES_PER_TURN = 24

# Seat groove in the base's top face, centred on the coil so the bottom turn sits IN the
# base rather than on it. The reference shows the lowest turn disappearing behind a raised
# inner step, which is what this groove and the boss inside it reproduce.
GROOVE_INNER_R = round(COIL_MEAN_RADIUS - COIL_TUBE_RADIUS * 0.8, 4)
GROOVE_OUTER_R = round(COIL_MEAN_RADIUS + COIL_TUBE_RADIUS * 0.8, 4)
SEAM_OVERLAP = 0.02          # the project's minimum overlap for two contacting parts
GROOVE_DEPTH = SEAM_OVERLAP
CAP_SEAT_OVERLAP = SEAM_OVERLAP
RIM_ROLL = round(BASE_THICKNESS * 0.45, 4)

# The coil's PITCH is the one measured number this prop cannot keep, and the reason is
# arithmetic rather than taste. Three turns of a 97 px section at a 151.5 px pitch span
# exactly the 551 px the reference measures between the base's top face and the cap's
# underside: the coil is TANGENT to both, with no overlap at either end. Three fixed
# turns of a fixed section have one fixed length, so overlapping both ends by the 0.02 the
# seam rule requires means the pitch has to grow by that 0.04 spread over three turns.
#
# The pitch is the right number to give up. Turn count and round section are what make the
# prop read as a spring; the gap between turns is not, and after a 3.18x vertical squash
# the reference's own gap is unrecoverable anyway. The built pitch and the measured one are
# both reported, and the delta is stated rather than absorbed.
COIL_BOTTOM_OUTER_Y = round(BASE_THICKNESS - GROOVE_DEPTH, 4)
COIL_TOP_OUTER_Y = round(STAND_HEIGHT - CAP_THICKNESS + CAP_SEAT_OVERLAP, 4)
COIL_TUBE_HALF_Y = round(COIL_TUBE_RADIUS * SQUASH, 4)
COIL_PITCH_BUILT = round(
    (COIL_TOP_OUTER_Y - COIL_BOTTOM_OUTER_Y - 2 * COIL_TUBE_HALF_Y) / COIL_TURNS, 4)
COIL_PITCH_DELTA = round(COIL_PITCH_BUILT / COIL_PITCH - 1, 4)

# Launch chevrons. NOT in the reference, and the only part of this prop that is not.
# TrapRenderer's Spring renders the AssetModel and nothing else, so the four chevrons and
# the glowing top of the hand-authored ProceduralJumpPad are the trap's ENTIRE affordance:
# strip them to match the reference and the pad stops telling the player it launches.
# Built as a named, separately fractured group so a reviewer can hide it the way
# AssetModel hides the hammer's wall bracket, and flagged in risks and assumptions.
CHEVRON_COUNT = 4
CHEVRON_RADIUS = round(CAP_RADIUS * 0.66, 4)
CHEVRON_HALF_WIDTH = round(CAP_RADIUS * 0.115, 4)
CHEVRON_LIMB = round(CAP_RADIUS * 0.085, 4)
CHEVRON_RELIEF = round(CAP_THICKNESS * 0.30, 4)

SIDES = 32

# Reference albedos, and the palette entries they map to. spring-reference.png is the one
# off-palette reference in the set: its coil measures #F5C321 against PALETTE.yellow's
# #ffd84d and its cap #F56058 against PALETTE.red's #ff5c65. Both are corrected toward the
# palette here, because a prop painted in the reference's own pigment reads as a different
# game's prop standing on this game's deck. The navy is not corrected: #27334C measured
# here, #3A495D in the floor fan and #374867 in the vacuum all land on the #24324a the
# existing props already use three times.
CAP_CORAL = "#ff5c65"
COIL_YELLOW = "#ffd84d"
BASE_NAVY = "#24324a"
CHEVRON_CREAM = "#fff8e8"

# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
MATERIALS = [
    material(PROP, "base-navy", "Base plastic", BASE_NAVY, [BASE_NAVY, "#1a2536", "#37496b"],
             0.80, 0.08, 0.42, 0.812,
             [override("rim-crown-sheen", "pad-base/rim-roll",
                       "The base's rolled outer rim is its brightest navy, measured at (58,74,108) "
                       "against (33,43,64) on the shaded lower wall.",
                       [EVIDENCE, "base-zone"], roughness=0.70,
                       mask="the rolled rim band, the outer 12 percent of the top face"),
              override("seat-groove-occlusion", "pad-base/coil-seat-groove",
                       "The groove the coil seats in is the darkest navy in the frame; the "
                       "reference loses the lowest turn into it entirely.",
                       [EVIDENCE, "base-zone"], roughness=0.86, aoBoost=0.65,
                       mask="the annular groove and the boss wall inside it")],
             "Single moulded base. Matte, and the darkest value in the reference by a wide "
             "margin.",
             shader_model="MeshPhysicalMaterial (matte injection-moulded ABS)"),
    material(PROP, "coil-yellow", "Coil plastic", COIL_YELLOW,
             [COIL_YELLOW, "#c9a52c", "#ffe98a"],
             0.62, 0.10, 0.34, 0.795,
             [override("coil-crown-sheen", "pad-coil/tube-crown",
                       "Each turn's upper surface catches the key and reads (245,195,33) against "
                       "(176,116,10) on its underside: a full stop of range around a round "
                       "section, which is what makes the coil read as a tube.",
                       [EVIDENCE, "coil-zone"], roughness=0.52,
                       mask="the upper third of the tube section, following the helix"),
              override("inter-turn-occlusion", "pad-coil/turn-gap",
                       "The gaps between turns are occluded from both sides and are markedly "
                       "darker than either turn's underside.",
                       [EVIDENCE, "coil-zone"], roughness=0.70, aoBoost=0.55,
                       mask="the tube's lower flank where it faces the adjacent turn")],
             "Corrected from the reference's own #F5C321 to PALETTE.yellow. The reference is a "
             "render under its own lighting, not a paint chip."),
    material(PROP, "cap-coral", "Cap plastic", CAP_CORAL, [CAP_CORAL, "#cc4750", "#ff8f95"],
             0.58, 0.09, 0.30, 0.803,
             [override("cap-crown-flat", "pad-cap/top-face",
                       "The cap's top face is the largest single-value surface in the frame and "
                       "carries almost no gradient: it is a flat disc, not a dome.",
                       [EVIDENCE, "cap-zone"], roughness=0.55,
                       mask="the top face inside the rolled edge"),
              override("cap-underside-shade", "pad-cap/edge-roll",
                       "The cap's rolled edge turns under and loses the key completely along the "
                       "bottom of its silhouette.",
                       [EVIDENCE, "cap-zone"], roughness=0.64, aoBoost=0.40,
                       mask="the lower half of the rolled edge")],
             "Corrected from the reference's own #F56058 to PALETTE.red."),
    material(PROP, "chevron-cream", "Chevron inlay", CHEVRON_CREAM,
             [CHEVRON_CREAM, "#e6dcc9", "#fffdf6"],
             0.55, 0.08, 0.26, 0.30,
             [override("chevron-relief-edge", "pad-chevron-0/chevron-relief",
                       "Not observed in the reference: this part is a gameplay affordance carried "
                       "over from the prop it replaces, so its finish is matched to the cap's "
                       "rather than sampled.",
                       ["not-in-reference"], roughness=0.55, aoBoost=0.35,
                       mask="the chamfer around each chevron")],
             "NOT IN THE REFERENCE. Cream so the launch arrows carry against the coral cap; see "
             "assumptions and risks.",
             shader_model="MeshPhysicalMaterial (matte injection-moulded ABS)"),
]

# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
# Lathe profile for the base: flat underside, rolled outer rim, a top face broken by the
# annular groove the coil seats in, and a raised centre boss inside it. Runs bottom to top
# so the generated normals face outwards.
BASE_PROFILE = [
    [0.0, 0.0],
    [BASE_RADIUS - RIM_ROLL, 0.0],
    [BASE_RADIUS - RIM_ROLL * 0.3, round(RIM_ROLL * 0.18, 4)],
    [BASE_RADIUS, round(BASE_THICKNESS * 0.45, 4)],
    [BASE_RADIUS - RIM_ROLL * 0.3, round(BASE_THICKNESS - RIM_ROLL * 0.18, 4)],
    [BASE_RADIUS - RIM_ROLL, BASE_THICKNESS],
    [GROOVE_OUTER_R, BASE_THICKNESS],
    [round(GROOVE_OUTER_R - 0.012, 4), round(BASE_THICKNESS - GROOVE_DEPTH, 4)],
    [round(GROOVE_INNER_R + 0.012, 4), round(BASE_THICKNESS - GROOVE_DEPTH, 4)],
    [GROOVE_INNER_R, BASE_THICKNESS],
    [round(GROOVE_INNER_R * 0.55, 4), BASE_THICKNESS],
    [0.0, BASE_THICKNESS],
]

PAD_BASE = component(
    "pad-base", "Base disc", "macro", "shell", "lathe", "base-navy",
    "continuous-sculpt",
    "One revolved moulded body. The reference's outer wall rolls continuously from the top "
    "face down and under with no chamfer facet anywhere, so it is a revolved profile rather "
    "than a stack of discs.",
    colours(BASE_NAVY),
    descriptor("profile revolved about Y: flat underside, rolled outer rim, top face broken by "
               "the annular coil groove and a raised centre boss",
               "rolled", RIM_ROLL, SIDES,
               deformations=[f"outer rim roll {RIM_ROLL}", f"coil seat groove {GROOVE_DEPTH} deep"],
               uv="LatheGeometry cylindrical UVs; one tile per part",
               normals="smooth vertex normals from the revolved profile"),
    xform(),
    dims(BASE_DIAMETER, BASE_THICKNESS, BASE_DIAMETER, 0.85),
    action("root", "center", (0.0, BASE_THICKNESS / 2, 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "rotate": True, "scale": True},
           sockets=[{"id": "pad-floor", "localPosition": [0.0, 0.0, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Underside of the base; sits on the deck plane at y = 0."},
                    {"id": "coil-seat",
                     "localPosition": [0.0, round(BASE_THICKNESS - GROOVE_DEPTH, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Floor of the annular groove, where the coil's bottom turn sits."}],
           collider={"type": "cylinder", "offset": [0.0, round(STAND_HEIGHT / 2, 4), 0.0],
                     "scale": [FOOTPRINT, STAND_HEIGHT, FOOTPRINT], "isTrigger": False,
                     "notes": "Advisory proxy over the whole pad. TrapRenderer's Spring adds no "
                              "collider: it launches on a distance test of |dx| and |dz| < 0.7, "
                              "which is the 1.40 this proxy matches."},
           fracture="base"),
    [feature("rim-roll",
             f"The outer wall rolls by {RIM_ROLL} units over both the top and the bottom edge, so "
             "the base's silhouette curves in at the deck instead of meeting it square.",
             "lathe profile with the widest radius at 45 percent of the thickness rather than at "
             "either face",
             [EVIDENCE, "base-zone"], 0.85),
     feature("coil-seat-groove",
             f"An annular groove {GROOVE_DEPTH} deep between radii {GROOVE_INNER_R} and "
             f"{GROOVE_OUTER_R} takes the coil's bottom turn. The reference loses that turn behind "
             "a raised step, which is this groove's outer wall.",
             "profile stepping down and back up inside the top face",
             [EVIDENCE, "base-zone", "coil-zone"], 0.7),
     feature("base-proportion",
             f"The base is {BASE_DIAMETER} across and {BASE_THICKNESS} thick. The diameter is "
             "measured; the thickness is the reference's 0.140 of diameter after the envelope "
             "squash, and is stated as a deviation rather than a match.",
             "lathe profile extents",
             [EVIDENCE, "base-zone"], 0.85)],
    surface(0.80, 0.08, 0.0, "matte moulded ABS with very low tone drift",
            "occlusion in the coil groove and under the rolled rim",
            "none - the reference base shows no wear",
            "The darkest and most matte surface in the reference."),
    [EVIDENCE, "base-zone"],
    importance=1.0, confidence=0.85, parent=None, fidelity="blockout",
)
PAD_BASE["geometryDescriptor"]["latheProfile"] = {
    "points": BASE_PROFILE, "segments": SIDES, "phiStart": 0.0, "phiLength": round(math.tau, 6),
}

# Helix path, authored at reference proportion; the node's own scale.y applies the squash,
# so every Y here is the shipped value divided by SQUASH. The centreline runs one tube
# radius inside each end, which is what puts the tube's OUTER surface on the groove floor
# and inside the cap's underside rather than its axis.
COIL_CENTRE_BOTTOM = round((COIL_BOTTOM_OUTER_Y + COIL_TUBE_HALF_Y) / SQUASH, 5)
COIL_PATH = []
_samples = COIL_TURNS * COIL_SAMPLES_PER_TURN
for _index in range(_samples + 1):
    _t = _index / _samples
    _angle = _t * COIL_TURNS * math.tau
    COIL_PATH.append([
        round(math.cos(_angle) * COIL_MEAN_RADIUS, 5),
        round(COIL_CENTRE_BOTTOM + _t * COIL_TURNS * COIL_PITCH_BUILT / SQUASH, 5),
        round(math.sin(_angle) * COIL_MEAN_RADIUS, 5),
    ])

PAD_COIL = component(
    "pad-coil", "Compression coil", "macro", "spring", "tube", "coil-yellow",
    "continuous-sculpt",
    "A round section swept along a helix. There is no face and no edge on it anywhere in the "
    "reference; every turn shades as a cylinder rolling away from the key.",
    colours(COIL_YELLOW),
    descriptor(f"{COIL_TURNS}-turn helix of mean radius {COIL_MEAN_RADIUS}, swept with a round "
               f"section of radius {COIL_TUBE_RADIUS}",
               "none", 0.0, COIL_SAMPLES_PER_TURN,
               deformations=[f"node scale.y {SQUASH} squashes pitch and tube section together"],
               uv="TubeGeometry UVs running along the helix",
               normals="smooth vertex normals from the swept section"),
    xform(position=(0.0, 0.0, 0.0), scale=(1.0, SQUASH, 1.0)),
    dims(COIL_OUTER_DIAMETER, COIL_SPAN, COIL_OUTER_DIAMETER, 0.8),
    action("spring", "center", (0.0, round(BASE_THICKNESS + COIL_SPAN / 2, 4), 0.0), (0, 1, 0), 0.85,
           channels={"scale": True},
           sockets=[{"id": "coil-crown",
                     "localPosition": [0.0, round(COIL_TOP_OUTER_Y / SQUASH, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Top of the coil, where the cap seats. Local to the squashed node."}],
           collider={"type": "cylinder", "offset": [0.0, round(COIL_SPAN / 2 / SQUASH, 4), 0.0],
                     "scale": [COIL_OUTER_DIAMETER, round(COIL_SPAN / SQUASH, 4),
                               COIL_OUTER_DIAMETER],
                     "isTrigger": False,
                     "notes": "Advisory; the coil never touches the player."},
           fracture="coil"),
    [feature("tube-crown",
             "Each turn is a round section: its crown catches the key and its underside falls a "
             "full stop away, which is the whole reason the coil reads as a spring rather than as "
             "three stacked rings.",
             "TubeGeometry round cross-section, 8 radial segments",
             [EVIDENCE, "coil-zone"], 0.9),
     feature("turn-gap",
             f"Three turns at a built pitch of {COIL_PITCH_BUILT} against the {COIL_PITCH} "
             f"measured, with a {round(COIL_TUBE_RADIUS * 2 * SQUASH, 4)} "
             "section leave a real gap between turns. The reference's column scan at x=540 gives "
             "bands of 92, 99 and 99 px separated by gaps of 41 and 49 px.",
             "helix pitch against tube diameter, both measured",
             [EVIDENCE, "coil-zone"], 0.85),
     feature("turn-count",
             f"{COIL_TURNS} turns. Not a guess: {COIL_TURNS} pitches of 151.5 px plus one tube "
             "diameter of 97 px reproduces the 551 px span measured between the base's top face "
             "and the cap's underside to within a pixel.",
             "helix sample count",
             [EVIDENCE, "coil-zone"], 0.9)],
    surface(0.62, 0.10, 0.0, "matte moulded ABS, smoother than the base",
            "deep occlusion in the gaps between turns", "none",
            "The only round-section part in the prop."),
    [EVIDENCE, "coil-zone"],
    importance=1.0, confidence=0.8, parent="pad-base", fidelity="blockout",
    seams=[{"id": "coil-base-seam", "with": "pad-base", "overlap": GROOVE_DEPTH,
            "notes": "The bottom turn sits inside the base's annular groove, not on its face."}],
)
PAD_COIL["geometryDescriptor"]["tubePath"] = {
    "points": COIL_PATH, "radius": COIL_TUBE_RADIUS, "radialSegments": 8, "closed": False,
}
# The coil runs between two real endpoints and the contract below states them. It is
# required: validate_sculpt_spec's ATTACHMENT_PRIMITIVES includes "tube", so a tube
# primitive with a parent fails --strict-quality without one.
#
# It is also the one place in this spec where the generator and the validator disagree.
# generate_threejs_factory's makeAttachmentEndpoint fires on any attachment whose
# localStart and localEnd differ, and it then REPLACES the component's geometry with a
# plain CylinderGeometry between those points and discards the component's transform. For
# a tube that is the whole prop: the helix would silently become a smooth cone and every
# pixel gate would still pass, because a cone at this size fills nearly the same
# silhouette. refine_props.py carries the edit that keeps an explicitly specified
# primitive, and tests/unit/sculpted-props.test.ts pins the turn count so a regenerated
# factory that drops that edit fails rather than shipping a cone.
PAD_COIL["attachment"] = {
    "parentId": "pad-base",
    "parentSocket": "coil-seat",
    "contactType": "seated-in-recess",
    "localStart": [0.0, round(COIL_BOTTOM_OUTER_Y / SQUASH, 4), 0.0],
    "localEnd": [0.0, round(COIL_TOP_OUTER_Y / SQUASH, 4), 0.0],
    "contactNormal": [0.0, 1.0, 0.0],
    "embedDepth": GROOVE_DEPTH,
    "overlap": GROOVE_DEPTH,
    "gapTolerance": 0.0,
    "baseRadius": COIL_TUBE_RADIUS,
    "endRadius": COIL_TUBE_RADIUS,
    "geometryFromSpec": True,
    "notes": "The coil's axis, from the groove floor in the base to the cap's underside. "
             "Declared because it is true and because the strict gate requires it; the "
             "generator's cylinder substitution for attached tubes is undone in "
             "refine_props.py, which is recorded in risks.",
}

CAP_PROFILE = [
    [0.0, 0.0],
    [round(CAP_RADIUS - CAP_THICKNESS * 0.45, 4), 0.0],
    [round(CAP_RADIUS - CAP_THICKNESS * 0.12, 4), round(CAP_THICKNESS * 0.14, 4)],
    [CAP_RADIUS, round(CAP_THICKNESS * 0.50, 4)],
    [round(CAP_RADIUS - CAP_THICKNESS * 0.12, 4), round(CAP_THICKNESS * 0.86, 4)],
    [round(CAP_RADIUS - CAP_THICKNESS * 0.45, 4), CAP_THICKNESS],
    [0.0, CAP_THICKNESS],
]

PAD_CAP = component(
    "pad-cap", "Strike cap", "macro", "cap", "lathe", "cap-coral",
    "continuous-sculpt",
    "A revolved disc whose edge rolls continuously from the flat top face down and under. The "
    "reference shows one broad flat top and no chamfer anywhere on the edge.",
    colours(CAP_CORAL),
    descriptor("profile revolved about Y: flat top face inside a fully rolled edge",
               "rolled", round(CAP_THICKNESS * 0.5, 4), SIDES,
               deformations=[f"edge roll {round(CAP_THICKNESS * 0.5, 4)} on both faces"],
               uv="LatheGeometry cylindrical UVs",
               normals="smooth vertex normals from the revolved profile"),
    xform(position=(0.0, CAP_UNDERSIDE_Y, 0.0)),
    dims(CAP_DIAMETER, CAP_THICKNESS, CAP_DIAMETER, 0.85),
    action("strike-surface", "center", (0.0, round(CAP_THICKNESS / 2, 4), 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "scale": True},
           sockets=[{"id": "launch-face", "localPosition": [0.0, CAP_THICKNESS, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "The surface the runner lands on; the launch impulse is applied "
                              "here by TrapRenderer's distance test."}],
           collider={"type": "cylinder", "offset": [0.0, round(CAP_THICKNESS / 2, 4), 0.0],
                     "scale": [CAP_DIAMETER, CAP_THICKNESS, CAP_DIAMETER], "isTrigger": False,
                     "notes": "The widest part of the prop, and the part the launch footprint is "
                              "matched to."},
           fracture="cap"),
    [feature("top-face",
             "The cap's flat top is the largest single surface in the reference and carries almost "
             "no gradient across it. A domed cap would show a clear falloff to its edge.",
             "lathe profile running flat from the axis to the edge roll",
             [EVIDENCE, "cap-zone"], 0.9),
     feature("edge-roll",
             "The edge rolls fully: the widest radius is at half the thickness, so the cap tucks "
             "under as well as over and its underside is never seen as a flat face.",
             "lathe profile with maximum radius at 0.5 of the thickness",
             [EVIDENCE, "cap-zone"], 0.85),
     feature("cap-overhangs-coil",
             f"The cap is {CAP_DIAMETER} across against the coil's {COIL_OUTER_DIAMETER}: it "
             "overhangs the spring by a third of the coil's radius on every side, which is what "
             "makes the reference read as a stool rather than as a coil with a lid.",
             "measured diameters",
             [EVIDENCE, "cap-zone", "coil-zone"], 0.85)],
    surface(0.58, 0.09, 0.0, "matte moulded ABS", "occlusion under the rolled edge", "none",
            "The brightest and largest surface in the reference."),
    [EVIDENCE, "cap-zone"],
    importance=1.0, confidence=0.85, parent="pad-coil", fidelity="blockout",
    seams=[{"id": "cap-coil-seam", "with": "pad-coil", "overlap": CAP_SEAT_OVERLAP,
            "notes": "The coil's top turn is buried in the cap's underside roll."}],
)
PAD_CAP["geometryDescriptor"]["latheProfile"] = {
    "points": CAP_PROFILE, "segments": SIDES, "phiStart": 0.0, "phiLength": round(math.tau, 6),
}
# The cap hangs off the coil node, which carries scale.y = SQUASH, so its own transform and
# profile have to be pre-divided by that factor or the cap would be squashed twice.
PAD_CAP["transform"]["position"] = [0.0, round(CAP_UNDERSIDE_Y / SQUASH, 4), 0.0]
PAD_CAP["transform"]["scale"] = [1.0, round(1 / SQUASH, 5), 1.0]

CHEVRON_POINTS = [
    [0.0, CHEVRON_LIMB],
    [CHEVRON_HALF_WIDTH, 0.0],
    [CHEVRON_HALF_WIDTH, round(-CHEVRON_LIMB * 0.62, 4)],
    [0.0, round(CHEVRON_LIMB * 0.38, 4)],
    [-CHEVRON_HALF_WIDTH, round(-CHEVRON_LIMB * 0.62, 4)],
    [-CHEVRON_HALF_WIDTH, 0.0],
]

# Four separate components rather than a repetitionSystem. The generator's repetition
# emitter resolves its geometry through geometry_for() with the SYSTEM dict as the
# component, and a system carries no geometryDescriptor, so an "extrude" system silently
# falls back to _DEFAULT_EXTRUDE_PROFILE: a 0.6 by 0.6 by 0.1 slab. Four of those stood
# through the whole prop and dropped Tier 1 from 0.932 to 0.810. Four explicit components
# are 4 draw calls against this prop's 6, which the budget carries, and they are the part
# a reviewer is most likely to want to delete.
CHEVRONS = []
for _slot in range(CHEVRON_COUNT):
    _angle = _slot * math.tau / CHEVRON_COUNT
    _chevron = component(
        f"pad-chevron-{_slot}", f"Launch chevron {_slot}", "meso", "affordance", "extrude",
        "chevron-cream", "assembled-solid",
        "A flat inlay with a hard edge, deliberately unlike every other part of this prop: it "
        "is signage, not moulding.",
        colours(CHEVRON_CREAM),
        descriptor("chevron outline extruded as a shallow relief on the cap's top face",
                   "chamfer", round(CHEVRON_RELIEF * 0.3, 4), 1,
                   uv="ExtrudeGeometry cap UVs", normals="flat facet normals"),
        xform(),
        dims(round(CHEVRON_HALF_WIDTH * 2, 4), CHEVRON_RELIEF, round(CHEVRON_LIMB * 1.62, 4), 0.3),
        action("static", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.3, fracture="cap"),
        [feature("chevron-relief",
                 f"Standing {CHEVRON_PROUD} proud of the cap face at radius {CHEVRON_RADIUS}, "
                 f"pointing outward at {round(math.degrees(_angle))} degrees. NOT OBSERVED IN "
                 "THE REFERENCE.",
                 "extruded outline placed on the cap's top face",
                 ["not-in-reference"], 0.3)],
        surface(0.55, 0.08, 0.0, "matte moulded ABS matched to the cap",
                "chamfer occlusion around the inlay", "none",
                "Not observed in the reference; finish matched to the cap it sits on."),
        ["not-in-reference"],
        importance=0.35, confidence=0.3, parent="pad-cap",
        seams=[{"id": f"chevron-{_slot}-cap-seam", "with": "pad-cap",
                "overlap": round(CHEVRON_RELIEF - CHEVRON_PROUD, 4),
                "notes": "The inlay is buried all but its visible relief; the cap top drops by that same amount so the prop still tops out at 0.45."}],
    )
    # Set FLUSH with the cap's top face, not proud of it. Standing the inlays half their
    # relief above the cap put the prop at 0.4627 against a 0.45 step-assist ceiling: a
    # 0.013 overshoot that turns the launcher into something the runner has to jump. The
    # chevrons carry on colour against the coral cap and need no relief to be read.
    # The cap node's world scale is already 1, so this offset is NOT pre-divided by the
    # squash the way the coil's children are.
    _chevron["transform"]["position"] = [
        round(math.sin(_angle) * CHEVRON_RADIUS, 5),
        round(CAP_THICKNESS - CHEVRON_RELIEF + CHEVRON_PROUD, 4),
        round(math.cos(_angle) * CHEVRON_RADIUS, 5),
    ]
    _chevron["transform"]["rotation"] = [0.0, round(_angle, 6), 0.0]
    _chevron["transform"]["scale"] = [1.0, 1.0, 1.0]
    _chevron["geometryDescriptor"]["profile2D"] = profile(
        CHEVRON_POINTS, CHEVRON_RELIEF, axis="y", axis_offset=0.0, steps=1,
    )
    CHEVRONS.append(_chevron)

COMPONENTS = [PAD_BASE, PAD_COIL, PAD_CAP, *CHEVRONS]
ALL_REFS = [c["id"] for c in COMPONENTS]

REPETITION_SYSTEMS: list[dict] = []

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
MATERIAL_IDS = {m["id"] for m in MATERIALS}
DETAILS = [
    detail("base-rim-roll", "base", "bevel",
           f"The base's outer wall rolls {RIM_ROLL} units over both edges, so its widest radius is "
           "at mid-thickness and the silhouette curves in at the deck.",
           "pad-base/rim-roll",
           "Lathe profile whose maximum radius sits at 45 percent of the thickness.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("coil-seat", "base", "contour",
           f"An annular groove {GROOVE_DEPTH} deep takes the coil's bottom turn; the reference "
           "loses that turn behind the step at its outer wall.",
           "pad-base/coil-seat-groove",
           "Lathe profile stepping down and back up inside the top face.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("tube-section", "coil", "contour",
           "The coil is a round section, not a flat ribbon: each turn runs a full stop of value "
           "from crown to underside.",
           "pad-coil/tube-crown",
           "TubeGeometry swept along the helix with 8 radial segments.",
           EVIDENCE, 0.9, MATERIAL_IDS),
    detail("turn-gap", "coil", "contour",
           "Three turns leave visible gaps: column x=540 measures bands of 92, 99 and 99 px "
           "separated by gaps of 41 and 49 px.",
           "pad-coil/turn-gap",
           "Helix pitch of 151.5 reference px against a 97 px tube diameter.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("turn-count", "coil", "contour",
           "Exactly three turns, cross-checked against the 551 px span between the base's top face "
           "and the cap's underside.",
           "pad-coil/turn-count",
           "Helix sample count of 3 turns at 24 samples each.",
           EVIDENCE, 0.9, MATERIAL_IDS),
    detail("cap-flat-top", "cap", "contour",
           "The cap's top is flat and nearly gradient-free across its whole width; a dome would "
           "fall off visibly toward the edge.",
           "pad-cap/top-face",
           "Lathe profile running flat from the axis to the edge roll.",
           EVIDENCE, 0.9, MATERIAL_IDS),
    detail("cap-edge-roll", "cap", "bevel",
           "The cap's edge rolls fully under, so no flat underside face is ever seen.",
           "pad-cap/edge-roll",
           "Lathe profile with maximum radius at half the thickness.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("cap-overhang", "cap", "contour",
           f"The cap is {CAP_DIAMETER} across against the coil's {COIL_OUTER_DIAMETER}, so it "
           "overhangs the spring on every side.",
           "pad-cap/cap-overhangs-coil",
           "Measured diameters; no geometry of its own.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("coil-crown-sheen", "coil", "gloss",
           "Each turn's crown reads (245,195,33) against (176,116,10) on its underside.",
           "coil-yellow/coil-crown-sheen",
           "Material local override lowering roughness along the upper third of the section.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("base-rim-sheen", "base", "gloss",
           "The rolled rim is the brightest navy in the frame, (58,74,108) against (33,43,64).",
           "base-navy/rim-crown-sheen",
           "Material local override on the rim band.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("groove-occlusion", "base", "stain",
           "The coil groove is the darkest value in the reference.",
           "base-navy/seat-groove-occlusion",
           "Material local override with an AO boost in the groove.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("cap-underside-shade", "cap", "stain",
           "The cap's rolled edge loses the key entirely along the bottom of its silhouette.",
           "cap-coral/cap-underside-shade",
           "Material local override raising AO on the lower half of the roll.",
           EVIDENCE, 0.75, MATERIAL_IDS),
]

DETAIL_INVENTORY = detail_inventory(
    DETAILS, 9,
    "measure_parts.py albedo separation of the three reference colours with a shadow sink, plus "
    "column runs at x = 300, 540 and 790 to read the tube diameter and helix pitch directly, and "
    "the constant-width bands of the cap and base to solve the 22.96 degree elevation.")

# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
PASSES = build_passes(
    ["pad-base", "pad-coil", "pad-cap"], ALL_REFS,
    "Match the macro silhouette: a rolled navy disc, a three-turn helix seated in it, and a coral "
    "cap overhanging the coil, all inside the 1.40 by 0.45 envelope.",
    "Build base, coil, cap and the chevron ring as separate named parts with recorded seams, and "
    "seat the coil in the base groove rather than on its face.",
    "Deliver the rim roll, the cap's full edge roll, the groove, and a coil whose turns are "
    "separated by a real gap at the squashed pitch.",
    "Match the three-albedo palette corrected to PALETTE and the matte moulded-plastic response.",
    ["The coil reads as a round-section spring with visible gaps, not a solid cone.",
     "The cap's top is flat and its edge rolls fully under with no chamfer facet.",
     "The base's widest radius is at mid-thickness, so its silhouette curves in at the deck.",
     "The coil's bottom turn is inside the base groove with no gap under it."],
    has_repetition=False)

FEATURE_REVIEW_TARGETS = [
    {"id": "three-part-stack", "name": "Base, coil and cap stack",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["pad-base", "pad-coil", "pad-cap"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["cap narrower than the coil", "coil sitting on the base instead of in it",
                      "base and cap read as the same diameter"]},
    {"id": "coil-reads-as-spring", "name": "Coil reads as a round-section helix",
     "tier": "critical", "passIds": ["blockout", "form-refinement", "surface-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["pad-coil"], "evidenceRefs": [EVIDENCE, "coil-zone"],
     "failureModes": ["turns fused into a solid cone by the squash",
                      "coil reads as stacked flat rings", "fewer or more than three turns"]},
    {"id": "rolled-edges", "name": "Rolled edges on base and cap",
     "tier": "critical", "passIds": ["form-refinement", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["pad-base", "pad-cap"], "evidenceRefs": [EVIDENCE, "cap-zone", "base-zone"],
     "failureModes": ["edges read as chamfers", "cap reads as a plain cylinder",
                      "facets visible around the revolve"]},
    {"id": "palette-correction", "name": "Three albedos corrected to PALETTE",
     "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["pad-base", "pad-coil", "pad-cap"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["coil shipped at the reference's own #F5C321 rather than PALETTE.yellow",
                      "cap shipped at #F56058 rather than PALETTE.red",
                      "base reaches for PALETTE.ink instead of the #24324a the props already use"]},
    {"id": "envelope-fit", "name": "Fits the launch footprint and the step-assist height",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "optimization-pass"],
     "minimumScore": 0.9, "mustPass": True,
     "componentRefs": ALL_REFS, "evidenceRefs": ["call-site"],
     "failureModes": ["wider than 1.40, so visible pad does not launch",
                      "taller than 0.45, so the runner has to jump the launcher"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "reference three-quarter elevated",
     "path": SOURCE_IMAGE, "covers": ["overall silhouette", "part stack", "part diameters"],
     "confidence": 0.9},
    {"id": "cap-zone", "view": "reference crop, cap", "path": SOURCE_IMAGE,
     "covers": ["cap flat top", "cap edge roll", "cap albedo"], "confidence": 0.9},
    {"id": "coil-zone", "view": "reference crop, coil", "path": SOURCE_IMAGE,
     "covers": ["tube diameter", "helix pitch", "turn count"], "confidence": 0.85},
    {"id": "base-zone", "view": "reference crop, base", "path": SOURCE_IMAGE,
     "covers": ["rim roll", "seat groove", "base albedo"], "confidence": 0.85},
    {"id": "call-site", "view": "not an image: TrapRenderer.tsx Spring and lib/game/constants.ts",
     "path": str(PROJECT / "components" / "game" / "TrapRenderer.tsx"),
     "covers": ["launch footprint 1.40", "step assist height 0.45"], "confidence": 1.0},
    {"id": "not-in-reference", "view": "not an image: the prop this replaces",
     "path": str(PROJECT / "components" / "game" / "models" / "SmallProps.tsx"),
     "covers": ["the four launch chevrons, which the reference does not have"], "confidence": 1.0},
]

SPEC = assemble(
    target_name="Apartment Spring Jump Pad",
    target_id="apartment-spring-jump-pad",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": True,
        "solveMethod": "elevation from the constant-width bands of the cap and the base, which "
                       "project T cos(e) tall; cross-checked between the two parts. Azimuth is "
                       "unconstrained: the prop is a solid of revolution apart from the chevrons.",
        "fovDegrees": 14.0,
        "aspect": round(1086 / 1448, 4),
        "orientation": {"yaw": 0.0, "pitch": -ELEVATION_DEG, "roll": 0.0},
        "targetHint": [0.0, 0.5, 0.0],
        "note": "Distance is not fixed here: the preview harness solves it by fitting the render's "
                "projected bounding box to the reference box (x 142-938, y 181-1237 of 1086x1448). "
                f"The review render also passes yscale={YSCALE_FOR_REVIEW}, which undoes the "
                "envelope squash so the Tier-1 aspect gate scores shape rather than the squash.",
    },
    measurement_basis={
        "pixelsPerWorldUnit": round(1 / PLAN_SCALE, 1),
        "referenceBBox": {"x0": 142, "y0": 181, "x1": 938, "y1": 1237, "imageSize": [1086, 1448]},
        "derivations": [
            "measure_parts.py albedo separation: cap 795 px wide by 452 tall, coil 601 by 465, "
            "base 778 by 402, with a shadow sink so an antialiased edge cannot claim a part.",
            "Elevation 22.96 degrees: the base holds its 774 px maximum width across a 100 px band, "
            "which is T cos(e); D sin(e) is then 302 and sin(e) = 0.390. The cap reproduces it to "
            "within a pixel.",
            f"Axial heights: cap {round(PX_CAP_T)} px, coil span {round(PX_COIL_SPAN)} px, base "
            f"{round(PX_BASE_T)} px, total {round(PX_TOTAL_H)} px, each a projected span divided "
            "by cos(e).",
            "Coil section and pitch read directly off column x=540, where the tube runs horizontal "
            "and is not foreshortened: bands of 92, 99, 99 px and steps of 132 and 147 px.",
            f"Plan scale: the cap's 794 px becomes {CAP_DIAMETER} world units, the launch "
            "footprint. Every horizontal number follows from that one choice.",
            f"Envelope squash {SQUASH}: the reference's 812 px of height would be "
            f"{round(PX_TOTAL_H * PLAN_SCALE, 3)} world units at this plan scale, against the "
            f"{STAND_HEIGHT} the step-assist ceiling allows.",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 3,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2,
            "interaction_fit": 1},
    pre_spec={
        "objectClass": {
            "primaryType": "coil-sprung stool used as a jump pad",
            "primaryDomain": "object",
            "formLanguage": ["smooth-organic", "stylized-toy", "rolled-moulded-edge"],
            "structureKind": ["stacked-assembly", "helical-member", "seated-joint"],
            "motionPotential": ["compress", "rebound", "cap-translate"],
            "materialFamilies": ["matte-plastic-navy", "matte-plastic-yellow", "matte-plastic-coral"],
            "notes": "Three parts, three albedos, one of them a helix. The identity is the round "
                     "coil section with real gaps between turns; a stack of three flat rings gives "
                     "the same silhouette from the reference angle and is wrong from every other.",
        },
        "complexity": {
            "tier": "moderate",
            "scores": {"silhouetteComplexity": 2, "componentCount": 2, "hierarchyDepth": 2,
                       "repetitionDensity": 0, "materialLayerCount": 2, "localDetailDensity": 1,
                       "occlusionRisk": 2, "actionReadinessNeed": 2},
            "estimatedCounts": {"macroComponents": 3, "mesoComponents": 1, "microFeatureGroups": 1,
                                "materialLayers": 4, "repetitionSystems": 1},
            "reasoning": [
                "Three macro parts with a genuine hierarchy: the cap rides the coil, which seats "
                "in the base.",
                "The helix is a swept round section, which no primitive gives directly.",
                "Action readiness is real: the trap scales the whole group to squash the pad on "
                "impact, so the parts have to ride their parents.",
                "Occlusion risk is moderate: the underside and the base's inner boss are inferred.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "moderate",
            "minimumComponentLevels": ["macro", "meso"],
            "needsRepetitionSystems": False,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": True,
            "rationale": "The coil's read depends entirely on a round section against a measured "
                         "pitch, and the trap compresses the assembly, so both the material "
                         "response and the parent-child rig have to be specified.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "The base's top face inside the coil is largely hidden by the coil itself.",
             "resolution": f"Modelled as an annular groove {GROOVE_DEPTH} deep with a raised centre "
                           "boss, which is what the reference's step at the coil's outer edge "
                           "implies. Inferred, not measured.",
             "confidence": 0.6},
            {"unknown": "The prop's underside is never visible.",
             "resolution": "Closed flat at y = 0 with the same roll as the outer rim.",
             "confidence": 0.7},
            {"unknown": "Whether the reference's height can be carried into the game at all.",
             "resolution": f"It cannot. The launch footprint is 1.40 and the step-assist ceiling is "
                           f"{STAND_HEIGHT}, so the height is compressed to {SQUASH} of the "
                           "reference's proportion and the deviation is recorded in risks.",
             "confidence": 1.0},
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
        ["The rendered pad matches the reference's part stack, part diameters, rolled edges and "
         "three-turn round-section coil.",
         "The coil's turns stay visibly separate after the envelope squash.",
         f"The pad stays within {FOOTPRINT} across and {STAND_HEIGHT} tall so the launch footprint "
         "and the step-assist ceiling both hold.",
         "The chevron ring is present, named and separately fractured, and is declared as a "
         "non-reference gameplay affordance everywhere it appears."],
        {"macroComponents": 3, "mesoComponents": 4, "microFeatureGroups": 0, "materialLayers": 4,
         "repetitionSystems": 0, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Cap, coil and base diameters are stated as measured pixel spans "
                           "converted at one declared plan scale.",
                           "The vertical deviation from the reference is stated as a single "
                           "factor rather than absorbed silently into part heights."],
                          [EVIDENCE],
                          ["model reads as a flat disc with a stripe",
                           "part diameters guessed rather than measured"]),
            feature_group("primary-structure", "Primary structure and hierarchy",
                          ["Base, coil, cap and chevron ring are separate named parts.",
                           "The cap is parented to the coil and the coil to the base, so a "
                           "compression scale on the root carries the whole stack.",
                           "Every contact records a seam overlap of at least 0.02 world units."],
                          [EVIDENCE, "coil-zone"],
                          ["parts stacked as siblings so compression tears them apart",
                           "coil fused into the base"]),
            feature_group("attachment-joint-correctness", "Contact and joint correctness",
                          ["The coil's bottom turn is buried in the base's groove.",
                           "The coil's top turn is buried in the cap's underside roll."],
                          [EVIDENCE, "coil-zone"],
                          ["coil floats above the base", "gap opens between coil and cap"]),
            feature_group("surface-material-response", "Surface material response",
                          ["Albedo zones, roughness, normal intent and local overrides are "
                           "specified per material and tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are independent fields.",
                           "Surface response is decomposed into macro, meso and micro bands."],
                          [EVIDENCE, "coil-zone"],
                          ["coil reads as a flat ribbon", "no value range around the tube section"]),
            feature_group("reference-lookdev", "Reference colour, material and lighting response",
                          ["Each albedo records both the reference measurement and the PALETTE "
                           "entry it was corrected to.",
                           "Lighting names key, fill, rim or environment, exposure, tone mapping, "
                           "background and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders prove the coil's round "
                           "section survives relighting."],
                          [EVIDENCE],
                          ["ships the reference's own off-palette pigment",
                           "base reaches for PALETTE.ink", "lighting evenly ambient"]),
        ],
        ["silhouette and negative-space delta", "part diameter ratio delta",
         "coil turn-gap delta", "component hierarchy depth delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.78,
        "mustMatch": ["three-part stack with the cap overhanging the coil",
                      "round-section coil of three turns with visible gaps",
                      "rolled edges on both base and cap",
                      "three-albedo palette corrected to PALETTE"],
        "niceToHave": ["the exact groove depth, which the coil hides",
                       "the base's inner boss profile"],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-elevated", "front", "top-down", "grazing"],
    },
    feature_review_targets=FEATURE_REVIEW_TARGETS,
    view_evidence=VIEW_EVIDENCE,
    components=COMPONENTS,
    materials=MATERIALS,
    repetition_systems=REPETITION_SYSTEMS,
    passes=PASSES,
    lighting=[
        "Ambient dominance: a soft studio render. The coil's crown reads (245,195,33) against "
        "(176,116,10) on its underside, a range a bright neutral hemisphere plus a gentle key "
        "reproduces without a hard terminator.",
        "Key light: warm-neutral directional at about 1.15 from high and camera left, which is "
        "where the cap's brightest band and the base's rim highlight both sit.",
        "Rim and environment light: weak neutral back light at about 0.3 so the far side of the "
        "base does not crush to black. No environment map: the reference shows no reflection.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.",
        "Contact shadow: the reference floats with a soft contact shadow below the base. The review "
        "render has no ground plane so the silhouette mask stays clean.",
    ],
    action_readiness=action_readiness(
        "pad-base",
        {"rootMotion": "sculptRuntime.nodes['pad-base'] carries translation, rotation and scale; "
                       "the coil is its child and the cap the coil's, so TrapRenderer's compression "
                       "scale on the enclosing group squashes the whole stack together.",
         "launchFace": "sculptRuntime.sockets['pad-cap:launch-face'] is the surface the runner "
                       "lands on; sculptRuntime.sockets['pad-base:coil-seat'] is the groove floor.",
         "collider": "colliders['pad-base'] is an advisory cylinder proxy over the whole pad. "
                     "TrapRenderer's Spring adds no collider and launches on a distance test, so "
                     "the proxy's 1.40 diameter is matched to that test rather than driving it.",
         "affordance": "destructionGroups['cap'] holds the cap and the chevron ring together; the "
                       "chevrons are reachable as sculptRuntime.nodes['pad-chevron-0'] through ['pad-chevron-3'] so a caller "
                       "can hide the non-reference affordance the way AssetModel hides the "
                       "hammer's wall bracket."},
        "base, coil, cap",
        "Detach the cap with its chevrons; the coil and base are not fractured."),
    assumptions=[
        f"The pad is {FOOTPRINT} across because that is the launch test's own footprint, and "
        f"{STAND_HEIGHT} tall because that is PLAYER.stepAssistHeight. Both are call-site facts, "
        "not readings of the reference.",
        f"The reference's height is compressed by {SQUASH}. Every axial number in this spec "
        "carries that factor; every plan number does not.",
        "The coil's node carries the squash rather than the root, because the tube's cross-section "
        "has to squash with the pitch. Its children pre-divide by the same factor.",
        "The base's inner boss and groove are inferred from the step visible at the coil's outer "
        "edge; the coil hides the rest of that face.",
        "One world unit is about 12 cm, making the modelled pad about 17 cm across.",
        "THE FOUR LAUNCH CHEVRONS ARE NOT IN THE REFERENCE. They are carried over from the "
        "hand-authored ProceduralJumpPad because TrapRenderer's Spring draws no other affordance, "
        "so removing them would take the trap's only signal that it launches. They are built as a "
        "separate named part with confidence 0.3 and evidenceRef 'not-in-reference' so a reviewer "
        "can strip them in one place.",
        "The hand-authored pad's glowing green top is NOT carried over: the reference's cap is "
        "coral and an emissive top is a lighting decision rather than an affordance the chevrons "
        "do not already carry.",
    ],
    coordinate_frame={
        "front": "+Z; the prop is a solid of revolution apart from the chevron ring",
        "up": "+Y, with the underside of the base at y = 0",
        "right": "+X",
        "scaleReference": f"cap diameter = {CAP_DIAMETER} world units; {round(1 / PLAN_SCALE)} "
                          "reference pixels per world unit in plan",
    },
    silhouette={
        "boundingShape": f"stacked discs {CAP_DIAMETER} across and {STAND_HEIGHT} tall: a navy base "
                         f"{BASE_DIAMETER} across, a {COIL_OUTER_DIAMETER} coil, a coral cap",
        "aspectRatios": [
            {"id": "reference-height-to-width", "value": round(PX_TOTAL_H / PX_CAP_D, 3),
             "notes": "what the reference implies: the prop is as tall as it is wide"},
            {"id": "shipped-height-to-width", "value": round(STAND_HEIGHT / CAP_DIAMETER, 3),
             "notes": "what the call site allows. The ratio of these two is the squash factor and "
                      "is the single largest reference deviation in this prop set."},
            {"id": "cap-to-coil-diameter", "value": round(CAP_DIAMETER / COIL_OUTER_DIAMETER, 3),
             "notes": "how far the cap overhangs the spring"},
            {"id": "base-to-cap-diameter", "value": round(BASE_DIAMETER / CAP_DIAMETER, 3),
             "notes": "the base is slightly narrower than the cap, which the reference shows"},
        ],
        "symmetry": "solid of revolution about Y, with a four-fold chevron ring on the cap",
        "dominantCurves": ["the helix", "the cap's rolled edge", "the base's rolled rim"],
        "negativeSpaces": ["the gaps between the coil's turns",
                           "the annular groove between the base's rim and its centre boss",
                           "the undercut where the cap's edge rolls back"],
        "landmarks": [f"base top face at y = {BASE_THICKNESS}",
                      f"cap underside at y = {CAP_UNDERSIDE_Y}",
                      f"launch face at y = {STAND_HEIGHT}"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "base, coil, cap and chevron ring at full sampling; 256px procedural maps"},
        {"tier": "mid", "distance": 12,
         "strategy": "halve the helix sampling to 12 per turn and the revolve to 20 sides"},
        {"tier": "far", "distance": 30,
         "strategy": "drop the chevron ring and the groove stops; base, coil and cap only"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 4200,
        "maxDrawCalls": 9,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "Reach accepted visual fidelity first, then cut the revolve from 32 "
                              "sides. The helix sets the floor: below about 12 samples per turn the "
                              "tube visibly facets along its length, which is the one thing that "
                              "makes the coil stop reading as a round section.",
    },
    procedural_strategy=[
        "Block out base, coil and cap and confirm the silhouette matches the measured bounding box "
        "with the review render's yscale applied.",
        "Seat the coil in the base's groove and bury its top turn in the cap's roll, so no gap can "
        "open at either end.",
        "Parent the cap to the coil and the coil to the base so the trap's compression scale "
        "carries the whole stack.",
        "Roll the base rim and the cap edge with lathe profile stops, then confirm no chamfer facet "
        "survives under grazing light.",
        "Add the chevron ring last, as an instanced cluster on the cap, and record it as "
        "non-reference in the spec, the material notes and the component evidenceRefs.",
        "Correct the two off-palette albedos to PALETTE and record both the measured and the "
        "shipped hex.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['pad-base'] carries whole-object translation, rotation and scale",
        "sculptRuntime.nodes['pad-coil'] is the compression axis; scaling it in Y squashes the "
        "spring and carries the cap down with it",
        "sculptRuntime.sockets['pad-cap:launch-face'] anchors a launch effect",
    ],
    destruction_anchors=["the cap detaches with its chevron ring",
                         "the coil and the base are not fractured"],
    risks=[
        f"THE LARGEST REFERENCE DEVIATION IN THE PROP SET. The reference is a stool at an aspect of "
        f"{round(PX_TOTAL_H / PX_CAP_D, 3)}; the call site allows "
        f"{round(STAND_HEIGHT / CAP_DIAMETER, 3)}. The sculpt keeps {round(SQUASH * 100, 1)} "
        "percent of the reference's height-to-width ratio and no camera angle hides that.",
        "The Tier-1 aspect gate cannot be passed by construction against this reference. The review "
        f"render passes yscale={YSCALE_FOR_REVIEW} to undo the squash so the gate scores shape, and "
        "that substitution is recorded in every review rather than left implicit.",
        "The squash is what puts the coil at risk: at the shipped pitch the turns clear each other "
        "by only 0.030 world units. If the coil node's scale.y is dropped, the tube's own diameter "
        "exceeds the pitch and the spring silently becomes a solid cone.",
        "The four launch chevrons are not in the reference. They are a deliberate carry-over of the "
        "trap's only affordance and are flagged as such in the material, the component, the detail "
        "inventory and the assumptions. If the reviewer wants a reference-pure prop, hiding "
        "nodes['pad-chevron-0'] through ['pad-chevron-3'] is the whole change, and the trap then ships with no launch signal.",
        "The base's groove and inner boss are inferred: the coil covers that face in the reference.",
        "Reference PBR extraction is cited rather than bound: the runtime uses independent "
        "procedural canvas maps, as every other prop in this set does.",
    ],
)


if __name__ == "__main__":
    write_spec(OUT, SPEC)
