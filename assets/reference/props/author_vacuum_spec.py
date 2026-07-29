#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment canister vacuum.

Every dimension is a ratio of ONE measured quantity - the canister's 646 px image width,
which is a true diameter because the canister is a vertical-axis revolve and the camera has
no roll. Ratios come from assets/reference/vacuum/evidence/part-measurement.json and
profile-measurement.json; the scripts that produced them sit beside those files.

Run:  python author_vacuum_spec.py
Writes: vacuum-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math

from spec_lib import (
    HERE, PROJECT, action, action_readiness, assemble, build_passes, chamfered_rect, colours,
    component, descriptor, detail, detail_inventory, dims, material, override, profile,
    quality_contract, surface, feature, feature_group, write_spec, xform,
)

PROP = "vacuum"
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "vacuum-reference.png")
OUT = HERE / f"{PROP}-sculpt-spec.json"
EVIDENCE = "full-object"

# ---------------------------------------------------------------------------
# THE SCALE ANCHOR, AND THE ONE NUMBER THAT WAS CORRECTED
#
# The canister is a solid of revolution about a vertical axis and the camera has yaw and
# pitch but no roll, so HORIZONTAL image extents are unforeshortened. The canister's 646 px
# image width is therefore its true diameter, and every ratio below is against it. Vertical
# image spans are NOT usable directly: they mix elevation with depth, which is what produced
# two retracted derivations recorded in assessment-seed.json.
#
# assessment-seed.json ALSO recorded a canister height of 297 px, H/D = 0.459, from
#     566 = H * cos(28.1) + 646 * sin(28.1)
# reading the silhouette's 566 px image height as one canister height plus one FULL-DIAMETER
# cap ellipse. That step is only valid for a cylinder. The reference is not one: the top face
# fits at 0.749 of the maximum radius and the bottom contact at 0.651, both measured as
# horizontal extents. With the rim radii measured instead of assumed the same equation gives
# H/D = 0.617; fitting both rim arcs so the base plane and the top face come out together,
# with no cap assumption at all, gives 0.664. A third route rejects the old value outright:
# the top button's image position needs a plan depth of +38 px under the corrected height,
# just forward of the axis where the reference shows it, against -209 px under the retracted
# one, which would put the button hard against the rear rim.
#
# ADOPTED H/D = 0.63, the midpoint of the two surviving routes. The spread is the error of an
# orthographic arc model against a perspective render and is recorded rather than argued
# away. measure_vacuum_profile.py carries the whole derivation.
# ---------------------------------------------------------------------------
CANISTER_PX = 646.0


def across(pixels: float) -> float:
    """A horizontal image span as a fraction of the canister's true diameter."""
    return round(pixels / CANISTER_PX, 4)


# Measured ratios, all against the canister diameter. Sources in the comment on each line.
R_HEIGHT = 0.63             # profile-measurement.json canisterHeight.ADOPTED
R_WIDEST_AT = 0.575         # centre of the near-maximum BAND, 0.535 to 0.720 in the scan
R_BOTTOM_CONTACT = 0.6508   # profileLandmarks.bottomContactRadiusPerMaxRadius
R_TOP_FACE = 0.7492         # profileLandmarks.topFaceRadiusPerMaxRadius
R_BELT_BAND = across(38.0)  # navy run on the canister's right flank, median of 98 columns
R_HOSE_TUBE = 0.1649        # part-measurement.json hoseCorrugation
R_HOSE_PITCH = 0.0364       # part-measurement.json hoseCorrugation
R_COLLAR = 0.277            # navy boss bbox, 179 px wide
R_BUTTON = across(159.0)    # yellow blob bbox width; a horizontal circle, so unforeshortened
R_WHEEL = 0.3529            # 222 px vertical extent / 0.975, the YZ-circle correction
R_HUBCAP = 0.2093           # 132 px / 0.975
R_WHEEL_THICK = 0.158       # 2 * (1044 - 993) px, the wheel's reach past its own hub centre
R_WHEEL_STANDOFF = 0.520    # (993 - 657) px, the wheel's plan distance from the canister axis
R_HANDLE_SPAN = 0.503       # mint blob bbox width, 325 px
R_HANDLE_RISE = 0.212       # crown above the foot-to-foot chord at matched image x, 137 px
R_HANDLE_BAR = 0.100        # 69 px, the arch's minimum column span, which is at the crown
R_NOZZLE_LENGTH = 0.649     # floor-contact contour un-squashed into plan, 419 px
R_NOZZLE_WIDTH = 0.291      # the head's end edge un-squashed, 188 px
R_NOZZLE_THICK = 0.0878     # 56.7 px, from the head's extreme columns where the plan vanishes
R_CUFF = 0.170              # mint blob at the nozzle, 110 px
R_NUB = 0.110               # coral above the wheel, 71 px

# ---------------------------------------------------------------------------
# THE ENVELOPE, AND THE AUTHORED DEVIATION IT FORCES
#
# TrapRenderer mounts the prop at [0, -0.55, 0] inside CuboidCollider args=[0.5, 0.55, 0.45],
# so the world box is 1.00 x 1.10 x 0.90 with the prop's origin on the deck.
#
# THE REFERENCE POSE DOES NOT FIT, AND THE VERDICT NEEDS NO CAMERA AT ALL. That matters
# here, because the pitch is single-sourced and marked NOT CONFIRMED (see referenceCamera):
# a verdict resting on it would inherit that doubt, and this one does not.
#
# The canister's underside and the nozzle's front underside both rest on the floor, so their
# 342 px image separation is pure depth and converts as 342 / sin(pitch). The canister is a
# revolve, so its 646 px diameter is also its depth. Total depth is therefore
# 646 + 342 / sin(pitch) against a clean silhouette width of 877 px. Fitting the collider's
# 0.900 depth against 1.000 width needs
#
#     (646 + 342 / sin(pitch)) / 877  <=  0.900 / 1.000     ->     sin(pitch) >= 2.387
#
# which no angle satisfies. Even a camera looking straight down, sin(pitch) = 1, leaves the
# prop 988 px deep against 877 wide, a ratio of 1.127 against the 0.900 allowed. The pose
# fails for every possible camera, so the ruling below stands on arithmetic rather than on
# the contested 28.1 degrees.
#
# AUTHORED DEVIATION: every part keeps its measured proportions and only the POSE is
# abandoned. The nozzle is parked beneath the body's forward bulge rather than out in front
# of it. The precedent is the toilet's shortened lid and the spring pad's chevrons, both
# recorded the same way: the reference sets what the parts ARE, the collider sets where they
# go.
# ---------------------------------------------------------------------------
BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH = 1.00, 1.10, 0.90

# Which axis binds is solved rather than assumed. Two candidate limits on the canister
# diameter D, from the two plan directions:
#   X: the two wheels reach R_WHEEL_STANDOFF + R_WHEEL_THICK/2 = 0.599 D each side
#   Z: canister rear on the box, then the body's forward floor contact, then the nozzle
#      -> 0.5 D + R_BOTTOM_CONTACT * 0.5 D + R_NOZZLE_WIDTH D per the layout below
D_LIMIT_X = round(BOX_WIDTH / (2 * (R_WHEEL_STANDOFF + R_WHEEL_THICK / 2)), 4)
D_LIMIT_Z = round(BOX_DEPTH / (0.5 + R_BOTTOM_CONTACT * 0.5 + R_NOZZLE_WIDTH), 4)

# A THIRD LIMIT, AND THE ONE THAT BINDS: the hose has to fit past the shell.
#
# The first build sized the canister to the plan limits above, at 0.80, and the hose then had
# nowhere to go. The shell holds its full radius across a measured band from 0.53 to 0.72 of
# its height, and a hose clearing that band at the front needs a radial distance of
# R + tube/2 + a standoff while the box's front face sits (BOX_DEPTH/2 - CANISTER_Z) away.
# Setting those equal and solving for the diameter:
#
#     D/2 + R_HOSE_TUBE*D/2 + standoff  <=  BOX_DEPTH - D/2 - D*R_BOTTOM_CONTACT/2
#
# which lands at D <= 0.748. At 0.80 the two sides were equal to three decimals - zero
# clearance - so the hose could only spend its length in the free HEIGHT above the shell,
# where it is edge-on to the chase camera and reads as a navy mass rather than as a tube.
#
# RULING (adopted): take the smaller canister. The prop's identity is the two-part read and
# the quality contract requires the hose to read as a curved tube from the camera the game
# actually uses; twelve points of plan fill is a number in a note. The precedent is the
# floor fan's round guard and the toilet's visible-but-shortened lid, both of which traded
# fill for identity once the measurements were complete.
D_LIMIT_HOSE = 0.748
DIAMETER = 0.70             # inside all three limits: 0.8347, 0.8075 and 0.748
RADIUS = DIAMETER / 2.0

HEIGHT = round(R_HEIGHT * DIAMETER, 4)                  # 0.504, the canister's top face
WIDEST_Y = round(R_WIDEST_AT * HEIGHT, 4)               # 0.2817
# Both rim ratios are against the MAXIMUM radius, not the diameter.
BOTTOM_R = round(R_BOTTOM_CONTACT * RADIUS, 4)          # 0.2603
TOP_R = round(R_TOP_FACE * RADIUS, 4)                   # 0.2997

# Plan layout. The canister's rear sits on the box's rear face; the nozzle tucks under the
# body's forward bulge, which is where the measured roll-under leaves room: the body's floor
# contact stops at BOTTOM_R while its widest band reaches RADIUS, and the nozzle is thinner
# than the height of that overhang.
# The belt stands proud of the shell, so it and not the shell is the prop's rearmost
# surface. Seating the SHELL on the box's rear face leaves the belt 0.0023 outside it, which
# the per-part bounds show and a render never would.
CANISTER_Z = round(-BOX_DEPTH / 2 + RADIUS + 0.004, 4)
NOZZLE_LENGTH = round(R_NOZZLE_LENGTH * DIAMETER, 4)
NOZZLE_WIDTH = round(R_NOZZLE_WIDTH * DIAMETER, 4)
NOZZLE_THICK = round(R_NOZZLE_THICK * DIAMETER, 4)
NOZZLE_Z = round(CANISTER_Z + BOTTOM_R + NOZZLE_WIDTH / 2, 4)
NOZZLE_FRONT_Z = round(NOZZLE_Z + NOZZLE_WIDTH / 2, 4)

# ---------------------------------------------------------------------------
# The suction slot, MEASURED off the reference rather than styled.
#
# Masking the head by colour distance to the cream and then looking for a dark run ENCLOSED
# by that mask finds one linear feature and only one: a band of constant thickness running
# from image (819, 992) to (635, 1080), which is 88 rows of steady 29.5 px horizontal chords
# marching left at 2.17 px per row. A constant-thickness straight band is a slot; the row
# scan that found it is in this file's history rather than a separate script because it is
# nine lines of numpy.
#
# Un-squashing it is the same step the head's own plan needed. Horizontal image extents are
# true, vertical ones are compressed by sin(pitch), so the band's plan run is
# (-184, 186.8) px for a true length of 262.2, and its perpendicular thickness is the
# horizontal chord times the sine of its plan bearing, 29.5 x 0.7124 = 21.0 px. Against the
# canister's 646 px that is 0.4059 and 0.0325 of the diameter.
#
# THE SIZE IS MEASURED AND THE POSITION IS NOT, and the two must not be quoted alike. The
# slot's setback from the front edge cannot be recovered from this view: it would need the
# head's own plan frame in the image, and that frame is this spec's weakest measurement -
# its two recovered edges meet at 75 degrees rather than 90. So the setback below is authored
# to put the slot where the reference shows it, near the front lip, and is an assumption.
#
# IT IS BUILT AS A HOLE IN THE HEAD'S OWN PROFILE, NOT AS A PART. buildExtrudeGeometry takes
# profile2D.holes and cuts them through the tessellator, the same route the soap dish's
# cutter hole uses, so the slot costs NO draw call. That is what makes it affordable: the
# prop already spends all 14 of its 14, so a fifteenth part would break the budget outright.
# A through-slot is also the truer object - a floor head's suction opening really is a hole,
# and the hose boss really does sit over it as the plenum that draws through it.
R_NOZZLE_SLOT_LENGTH = 0.4059   # 262.2 px of un-squashed plan run against the canister's 646
R_NOZZLE_SLOT_WIDTH = 0.0325    # 21.0 px perpendicular, from the 29.5 px horizontal chord
SLOT_LENGTH = round(R_NOZZLE_SLOT_LENGTH * DIAMETER, 4)
SLOT_WIDTH = round(R_NOZZLE_SLOT_WIDTH * DIAMETER, 4)
SLOT_FRONT_WALL = 0.025         # ASSUMED, see above: the lip left ahead of the slot
# profile2D with axis "y" maps the profile's +y to world -z, so the head's FRONT edge - the
# one with the larger world z - is at NEGATIVE profile y. Getting this backwards would put
# the slot along the head's hidden rear edge and no gate here would have said so.
SLOT_CENTRE_Y2D = round(-(NOZZLE_WIDTH / 2 - SLOT_FRONT_WALL - SLOT_WIDTH / 2), 4)
# The chamfer eats the corners, so the front edge's straight run is shorter than the head.
# The slot has to fit inside that run or it would open through a chamfered corner.
assert SLOT_LENGTH / 2 <= NOZZLE_LENGTH / 2 - 0.05, (
    f"the {SLOT_LENGTH} slot runs into the head's chamfered corners")
assert SLOT_WIDTH + SLOT_FRONT_WALL < NOZZLE_WIDTH / 2, (
    f"the slot and its {SLOT_FRONT_WALL} lip do not fit in the head's front half")
# Counter-clockwise, matching chamfered_rect's own winding. buildExtrudeShape pushes each
# loop onto shape.holes and lets three.js's tessellator subtract it.
SLOT_LOOP = [
    [round(SLOT_LENGTH / 2, 5), round(SLOT_CENTRE_Y2D - SLOT_WIDTH / 2, 5)],
    [round(SLOT_LENGTH / 2, 5), round(SLOT_CENTRE_Y2D + SLOT_WIDTH / 2, 5)],
    [round(-SLOT_LENGTH / 2, 5), round(SLOT_CENTRE_Y2D + SLOT_WIDTH / 2, 5)],
    [round(-SLOT_LENGTH / 2, 5), round(SLOT_CENTRE_Y2D - SLOT_WIDTH / 2, 5)],
]

WHEEL_DIAMETER = round(R_WHEEL * DIAMETER, 4)
WHEEL_RADIUS = WHEEL_DIAMETER / 2.0
WHEEL_HALF_THICK = round(R_WHEEL_THICK * DIAMETER / 2, 4)
WHEEL_X = round(R_WHEEL_STANDOFF * DIAMETER, 4)
WHEEL_Z = round(CANISTER_Z - 0.07, 4)
WHEEL_OUTER_X = round(WHEEL_X + WHEEL_HALF_THICK, 4)
# THE 0.02 SEAM FLOOR IS A CONTRACT, NOT A GUIDELINE. qualityContract's
# antiShallowSpecRules forbids adjacent separate-geometry parts below it, and structural-pass
# acceptance repeats it. An audit of the declared seams found SEVEN violations across three
# parts - the belt at 0.009, the button at 0.004 and both hub caps at 0.004 - every one of
# which the renders showed as fine, because a shallow seam only opens up under a grazing
# light or a small transform change.
#
# Each is fixed by burying MORE of the part, never by moving the visible surface: the caps
# are made thicker and sunk further, so their proud height is untouched, and the belt's inner
# radius drops while its outer radius stays. Below, every seam is derived FROM the floor
# rather than typed next to it, and __main__ asserts the whole set, so the contract cannot
# quietly rot again.
SEAM_FLOOR = 0.02

HUBCAP_RADIUS = round(R_HUBCAP * DIAMETER / 2, 4)
HUB_PROUD = 0.005                          # what stands off the tyre, as before
HUB_THICK = round(HUB_PROUD + SEAM_FLOOR, 4)

BELT_Y = 0.32               # see BELT_HEIGHT_NOTE; carries +/- 0.04 from the perspective error
BELT_BAND = round(R_BELT_BAND * DIAMETER, 4)

BELT_PROUD = 0.005

COLLAR_ANGLE = math.radians(140.0)     # front-left, where the reference puts the hose mouth
COLLAR_Y = round(0.45 * HEIGHT, 4)
COLLAR_DIAMETER = round(R_COLLAR * DIAMETER, 4)
COLLAR_LENGTH = 0.075

BUTTON_DIAMETER = round(R_BUTTON * DIAMETER, 4)
BUTTON_PROUD = 0.014                       # what stands above the top face, as before
BUTTON_THICK = round(BUTTON_PROUD + SEAM_FLOOR, 4)
BUTTON_X = round(-0.088 * DIAMETER, 4)   # (586 - 657) px / 646, straight off the image
BUTTON_Z = round(CANISTER_Z + 0.0588 * DIAMETER, 4)   # +38 px, the depth the height solve implies

HANDLE_SPAN = round(R_HANDLE_SPAN * DIAMETER, 4)
HANDLE_RISE = round(R_HANDLE_RISE * DIAMETER, 4)
HANDLE_BAR_R = round(R_HANDLE_BAR * DIAMETER / 2, 4)
HANDLE_YAW = math.radians(20.0)        # the reference's arch runs back-left to front-right
HANDLE_TOP_Y = round(HEIGHT + HANDLE_RISE, 4)
# THE CROWN IS A TUBE SURFACE, NOT A CENTRELINE, and PROP_HEIGHT read the centreline.
# HANDLE_TOP_Y is where the handle's PATH peaks, which is correct for HANDLE_PATH and wrong
# for every question about how tall the prop is: the bar is swept round that path, so the
# highest geometry stands one bar radius above it. PROP_HEIGHT feeds the silhouette's
# boundingShape, the prop-height-to-collider-height ratio and the fairness note's "how empty
# is the hitbox", and all three are questions about the OUTER SURFACE.
#
# Measured, not reasoned: the per-part world Box3 dump puts vacuum-handle's top at 0.6225
# against a declared PROP_HEIGHT of 0.5894. The analytic outer crown is 0.6244; the built
# tube lands 0.0019 inside it because TubeGeometry is a polygon and its topmost vertex ring
# sits at bar_r * cos(pi/radialSegments) rather than at bar_r. The analytic value is adopted
# because it is the authored surface and does not move when the tessellation does - the
# 0.0019 is recorded here rather than trimmed off the constant to make the two agree.
#
# Same family as the fan's rear cage, which solved a torus scale off a centreline radius and
# put the guard 0.019 outside its collider. A radius omitted from a derived constant does not
# show in a render; it shows in the dump.
HANDLE_CROWN_Y = round(HANDLE_TOP_Y + HANDLE_BAR_R, 4)
PROP_HEIGHT = HANDLE_CROWN_Y

HOSE_TUBE_R = round(R_HOSE_TUBE * DIAMETER / 2, 4)
HOSE_PITCH = round(R_HOSE_PITCH * DIAMETER, 4)

NUB_DIAMETER = round(R_NUB * DIAMETER, 4)
CUFF_DIAMETER = round(R_CUFF * DIAMETER, 4)
CUFF_LENGTH = 0.09

SIDES = 24
TUBE_RADIAL = 8

BELT_HEIGHT_NOTE = (
    "The belt's height is the least certain number on this prop and is stated as such. Its "
    "arc could not be fitted at all, because the reference is a perspective render and the "
    "belt's left and right extreme meridians - which an orthographic camera puts on the same "
    "image row - sit 77 px apart. The two readings give heights of 0.386 and 0.294 world; "
    f"{BELT_Y} is their mean, carrying +/- 0.04."
)

# ---------------------------------------------------------------------------
# colours
#
# All six are median-sampled per albedo and verified against evidence/masks.png, where every
# mask lands on the part it names. They are shipped AS MEASURED rather than corrected to
# PALETTE, which is a departure from the toilet and the spring and is deliberate: those two
# had reference colours that were near-misses for a PALETTE entry, while this prop's identity
# is a six-pastel scheme with no PALETTE analogue - the body's #bca6da against PALETTE.purple
# #8b72ff is a different colour, not a corrected one. The contrast check was run on the
# measured values and passed: the body reads 3.34:1 against the palest deck wash.
# ---------------------------------------------------------------------------
BODY_LILAC = "#bca6da"
NAVY = "#374c72"
NOZZLE_CREAM = "#f9e9c4"
WHEEL_CORAL = "#eb8273"
MINT = "#91c4ae"
BUTTON_YELLOW = "#fdda9c"


def joint(parent_id: str, socket: str, contact: str, start, end, overlap: float,
          radius: float, notes: str) -> dict:
    """An attachment records the JOINT. It must NOT be allowed to define the geometry.

    validate_sculpt_spec's ATTACHMENT_PRIMITIVES holds cylinder, cone, capsule, tube and
    curve-sweep, so every one of those with a parent FAILS --strict-quality without an
    attachment. generate_threejs_factory then reads that attachment and replaces the
    component's geometry with a CylinderGeometry between localStart and localEnd, discarding
    the component's transform as well. On this prop that would cost the hose: a quarter of
    the silhouette would ship as a straight navy rod between two points and every pixel gate
    would still pass. geometryFromSpec is the guard refine_props.py installs, and it is set
    on every joint here.
    """
    return {
        "parentId": parent_id,
        "parentSocket": socket,
        "contactType": contact,
        "localStart": [round(v, 4) for v in start],
        "localEnd": [round(v, 4) for v in end],
        "contactNormal": [0.0, 1.0, 0.0],
        "embedDepth": overlap,
        "overlap": overlap,
        "gapTolerance": 0.0,
        "baseRadius": radius,
        "endRadius": radius,
        "geometryFromSpec": True,
        "notes": notes,
    }


def to_body(x: float, y: float, z: float) -> tuple[float, float, float]:
    """A world position expressed in the shell node's own frame.

    Every position on this prop is authored in WORLD, because that is the frame the
    collider is in and the only frame a clearance check means anything in. The shell node
    then sits at z = CANISTER_Z, so everything hanging off it must have that subtracted
    before it becomes a transform. Authoring the world value straight into a child's
    transform applies the offset twice, which the per-part world Box3 dump catches in
    seconds and a render does not catch at all: the whole assembly simply sits 0.05 further
    forward than it should and still looks like a vacuum.
    """
    return (round(x, 5), round(y, 5), round(z - CANISTER_Z, 5))


def to_nozzle(x: float, y: float, z: float) -> tuple[float, float, float]:
    """A world position in the floor head's frame. The head carries no rotation, so this is
    a translation only."""
    return (round(x, 5), round(y, 5), round(z - NOZZLE_Z, 5))


def radial_rotation(theta: float) -> tuple[float, float, float]:
    """Euler XYZ that points a primitive's own +Y along the horizontal bearing `theta`.

    three.js composes 'XYZ' as Rx * Ry * Rz, so Rz(-pi/2) turns the primitive's +Y into +X
    and Ry(-theta) then swings that into the plan bearing. Cylinders, capsules and lathes all
    build about +Y, so this is what stands a boss off a curved flank or lays a wheel on a
    horizontal axle without ever putting a non-uniform scale on the node.
    """
    return (0.0, round(-theta, 6), round(-math.pi / 2, 6))


def direction_rotation(direction: tuple[float, float, float]) -> tuple[float, float, float]:
    """Euler XYZ that points a primitive's own +Y along an arbitrary direction.

    radial_rotation handles the horizontal case; a cuff sleeved over the hose needs the
    general one, because the hose arrives at the head travelling down and forward and a
    yaw-only rotation leaves the sleeve crossing the tube at an angle. Composing 'XYZ' as
    Rx * Ry * Rz and fixing Rz at -pi/2 sends +Y to +X, after which
        Rx(a) Ry(b) (1,0,0) = (cos b, sin b sin a, -sin b cos a)
    so b comes from the direction's x against the length of its yz part, and a from its y
    against the negative of its z.
    """
    dx, dy, dz = direction
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-9:
        return (0.0, 0.0, round(-math.pi / 2, 6))
    dx, dy, dz = dx / length, dy / length, dz / length
    lateral = math.hypot(dy, dz)
    a = 0.0 if lateral < 1e-9 else math.atan2(dy, -dz)
    b = math.atan2(lateral, dx)
    return (round(a, 6), round(b, 6), round(-math.pi / 2, 6))


# ---------------------------------------------------------------------------
# the canister profile
#
# A revolved drum, authored from a row scan of the reference's own silhouette rather than
# from an interpolation between three landmarks. THE FIRST ATTEMPT WAS THE INTERPOLATION AND
# IT RENDERED AS A SPHERE: given a single maximum at 0.559 of the height, a smooth curve
# narrows straight off it in both directions, and the reference does not - it holds within 4
# percent of its maximum radius across a band from 0.53 to 0.73 of the height, which is what
# makes it read as a drum rather than a ball. That band is the finding, and it is only
# visible in the scan.
#
# For a revolve the silhouette's extreme point at an image row IS the radius at that height,
# because that meridian's depth is zero. Both flanks are scanned because each is blocked over
# a different range - the hose crosses the left below the equator, the wheel the right - and
# the rows below are their average. The two flanks disagree about where the widest band sits
# by about 0.06 of the height, which cannot happen for a revolve under an orthographic camera
# and is the same perspective error the belt shows; the average is what is authored and the
# spread is recorded in risks.
#
# MEASURED rows are marked. Below 0.53 neither flank is clean, so the roll from the widest
# band down to the fitted floor contact is authored, and is NOT presented as a measurement.
# The toilet's pedestal is the precedent for what happens otherwise: a waist invented on no
# evidence put a concave notch down both sides of the silhouette.
# ---------------------------------------------------------------------------
BODY_PROFILE_ROWS = [
    # (height / canister height, radius / maximum radius, measured?)
    (0.000, 0.651, True),    # bottom rim fit; predicts the silhouette's lowest pixel to 1.1 px
    (0.080, 0.740, False),
    (0.180, 0.850, False),
    (0.300, 0.930, False),
    (0.420, 0.975, False),
    (0.535, 1.000, True),    # left flank 1.009
    (0.614, 0.994, True),    # left 0.985, right 1.003
    (0.667, 0.980, True),    # left 0.957, right 1.003
    (0.720, 0.963, True),    # left 0.945, right 0.982
    (0.773, 0.949, True),    # left 0.926, right 0.972
    (0.799, 0.942, True),    # left 0.917, right 0.966
    (0.879, 0.911, True),    # left 0.880, right 0.942
    (0.940, 0.855, False),   # the dome roll; the flanks are cap here, not profile
    (1.000, R_TOP_FACE, True),
]
BODY_PROFILE = (
    [[0.0, 0.0], [round(BOTTOM_R * 0.72, 4), 0.0]]
    + [[round(RADIUS * r, 4), round(HEIGHT * h, 4)] for h, r, _ in BODY_PROFILE_ROWS]
    + [[round(TOP_R * 0.93, 4), HEIGHT], [0.0, HEIGHT]]
)
MEASURED_PROFILE_ROWS = sum(1 for _, _, m in BODY_PROFILE_ROWS if m)


def body_radius_at(y: float) -> float:
    """The profile's radius at a height, by linear interpolation between its own points.

    Used to seat the belt, the collar and the wheels ON the body rather than near it. Every
    contact on this prop is a curved-flank contact, and eyeballing those is what leaves a
    part floating a hair off its parent from one camera angle and buried from another.
    """
    points = BODY_PROFILE[1:-1]
    if y <= points[0][1]:
        return points[0][0]
    for (r0, y0), (r1, y1) in zip(points, points[1:]):
        if y0 <= y <= y1:
            span = y1 - y0
            k = 0.0 if span <= 1e-9 else (y - y0) / span
            return r0 + (r1 - r0) * k
    return points[-1][0]


BELT_RADIUS = round(body_radius_at(BELT_Y), 4)
COLLAR_RADIUS_AT = round(body_radius_at(COLLAR_Y), 4)
COLLAR_POS = (round(COLLAR_RADIUS_AT * math.cos(COLLAR_ANGLE), 4), COLLAR_Y,
              round(CANISTER_Z + COLLAR_RADIUS_AT * math.sin(COLLAR_ANGLE), 4))

BELT_PROFILE = [
    [round(BELT_RADIUS - SEAM_FLOOR, 4), round(BELT_Y - BELT_BAND / 2, 4)],
    [round(BELT_RADIUS + BELT_PROUD, 4), round(BELT_Y - BELT_BAND * 0.30, 4)],
    [round(BELT_RADIUS + BELT_PROUD, 4), round(BELT_Y + BELT_BAND * 0.30, 4)],
    [round(BELT_RADIUS - SEAM_FLOOR, 4), round(BELT_Y + BELT_BAND / 2, 4)],
]

# A fat toy wheel: a rounded-edge disc, authored centred so the node carries no offset and
# the rotation alone lays it on its axle.
WHEEL_PROFILE = [
    [0.0, round(-WHEEL_HALF_THICK, 4)],
    [round(WHEEL_RADIUS * 0.42, 4), round(-WHEEL_HALF_THICK, 4)],
    [round(WHEEL_RADIUS * 0.76, 4), round(-WHEEL_HALF_THICK * 0.94, 4)],
    [round(WHEEL_RADIUS * 0.94, 4), round(-WHEEL_HALF_THICK * 0.62, 4)],
    [round(WHEEL_RADIUS, 4), 0.0],
    [round(WHEEL_RADIUS * 0.94, 4), round(WHEEL_HALF_THICK * 0.62, 4)],
    [round(WHEEL_RADIUS * 0.76, 4), round(WHEEL_HALF_THICK * 0.94, 4)],
    [round(WHEEL_RADIUS * 0.42, 4), round(WHEEL_HALF_THICK, 4)],
    [0.0, round(WHEEL_HALF_THICK, 4)],
]

# The boss is a LATHE, not a cylinder. As a flat-capped cylinder its outer face read as a
# squared tab standing off the flank - invisible under colour and obvious in the clay render,
# which is the view the blockout gate actually scores. Rounding the outer end turns it back
# into the moulded boss the reference shows. A lathe is not in ATTACHMENT_PRIMITIVES, but the
# component's role is "socket", which is in ATTACHMENT_ROLES, so the joint contract stays
# required either way.
COLLAR_PROFILE = [
    [0.0, round(-COLLAR_LENGTH / 2, 4)],
    [round(COLLAR_DIAMETER / 2, 4), round(-COLLAR_LENGTH / 2, 4)],
    [round(COLLAR_DIAMETER / 2, 4), round(COLLAR_LENGTH * 0.20, 4)],
    [round(COLLAR_DIAMETER / 2 * 0.88, 4), round(COLLAR_LENGTH * 0.40, 4)],
    [round(COLLAR_DIAMETER / 2 * 0.60, 4), round(COLLAR_LENGTH * 0.49, 4)],
    [0.0, round(COLLAR_LENGTH * 0.52, 4)],
]

NUB_PROFILE = [
    [0.0, 0.0],
    [round(NUB_DIAMETER * 0.42, 4), 0.0],
    [round(NUB_DIAMETER * 0.48, 4), round(NUB_DIAMETER * 0.18, 4)],
    [round(NUB_DIAMETER * 0.40, 4), round(NUB_DIAMETER * 0.40, 4)],
    [round(NUB_DIAMETER * 0.22, 4), round(NUB_DIAMETER * 0.52, 4)],
    [0.0, round(NUB_DIAMETER * 0.56, 4)],
]

# The hose meets the head LEFT OF ITS CENTRE, as the reference shows: its mint cuff sits
# at image x 503-613 against a head spanning 448-839, so about a third of the way in
# rather than in the middle. With the smaller canister the route can now reach that point
# from the front, so the reference's own handedness is buildable rather than a compromise.
BOSS_X = round(-0.33 * NOZZLE_LENGTH / 2, 4)
BOSS_Z = round(NOZZLE_Z + NOZZLE_WIDTH * 0.22, 4)
BOSS_WIDTH = round(0.20 * DIAMETER, 4)
BOSS_RISE = round(0.068 * DIAMETER, 4)
BOSS_PROFILE = [
    [0.0, 0.0],
    [round(BOSS_WIDTH / 2, 4), 0.0],
    [round(BOSS_WIDTH * 0.46, 4), round(BOSS_RISE * 0.34, 4)],
    [round(BOSS_WIDTH * 0.36, 4), round(BOSS_RISE * 0.68, 4)],
    [round(BOSS_WIDTH * 0.20, 4), round(BOSS_RISE * 0.92, 4)],
    [0.0, BOSS_RISE],
]


# ---------------------------------------------------------------------------
# the hose
#
# THE HOSE IS THE PART THAT SAYS VACUUM. It is also the part the pipeline is most likely to
# lose, twice over: the generator swaps an attached tube for a cylinder unless the guard in
# joint() fires, and the adopted pose ruling shortens the run so far that a straight hop from
# the collar to the nozzle would read as a navy strut rather than a hose.
#
# The route answers that with the one budget this prop has spare. Plan is fully committed -
# X is 96 percent used by the wheels and Z 98 percent by the canister and the nozzle - but
# the prop stands 0.674 tall inside a 1.10 collider, so HEIGHT is free. The hose therefore
# leaves the collar on the front-left flank, arcs UP and forward clear of the body, crosses
# in front of the canister above the nozzle, and drops onto the cuff. That buys the length
# the read needs without costing a millimetre of plan, and it puts the slack where the
# reference's own hose puts it: outside the body's silhouette, curving.
#
# THE ROUTE SWEEPS THE FRONT, which is what the smaller canister bought and the whole
# reason for taking it. At 0.80 diameter the clearance in front of the widest band was zero
# to three decimals, so the hose could only climb into the free height above the shell,
# where it is edge-on to the chase camera and reads as a mass. At 0.70 the same bearing has
# 0.06 of slack, so the hose can make an open C around the front where the camera sees it
# broadside - which is the read the reference has and the one the quality contract requires.
#
# The control points are authored in CYLINDRICAL coordinates about the canister's axis, as
# (bearing, height, extra standoff). hose_point then places each one at the body's own
# profile radius at that height plus the tube and the standoff, so clearance from the shell
# is guaranteed by construction rather than checked after the fact. Only the box has to be
# verified afterwards, and clearance_report does that at the tube's OUTER surface.
#
# Two failures this replaces, both kept because they are cheap to repeat. The first route
# FOLDED visibly: its second control point sat 0.055 BEHIND the collar mouth in z, so the
# hose left the socket, went backwards and came forward through itself. The second hugged
# the left flank at nearly constant bearing, which cleared everything and read as a lump,
# because a curve seen along its own axis has no curvature to show.
# ---------------------------------------------------------------------------
HOSE_STANDOFF = 0.02


def hose_point(bearing_deg: float, y: float, extra: float = 0.0) -> tuple:
    """A centreline point at a guaranteed clearance outside the shell at that height."""
    radius = body_radius_at(min(max(y, 0.0), HEIGHT)) + HOSE_TUBE_R + HOSE_STANDOFF + extra
    angle = math.radians(bearing_deg)
    return (round(radius * math.cos(angle), 4), round(y, 4),
            round(CANISTER_Z + radius * math.sin(angle), 4))

# The second point is the collar's OUTER FACE, not the standoff radius. Jumping straight to
# the standoff put a radial spur one segment long against a tube radius nearly as large, and
# the Catmull-Rom overshot it into a visible fold right at the socket. Stepping out to the
# boss's face first, then letting the bearing carry the rest, keeps every turn gentle.
HOSE_CONTROL = [
    (COLLAR_POS[0], COLLAR_POS[1], COLLAR_POS[2]),   # buried in the collar
    (round((COLLAR_RADIUS_AT + COLLAR_LENGTH * 0.6) * math.cos(COLLAR_ANGLE), 4),
     round(COLLAR_Y + 0.005, 4),
     round(CANISTER_Z + (COLLAR_RADIUS_AT + COLLAR_LENGTH * 0.6) * math.sin(COLLAR_ANGLE), 4)),
    hose_point(132.0, COLLAR_Y + 0.05, 0.01),
    hose_point(118.0, COLLAR_Y + 0.09, 0.04),
    hose_point(102.0, COLLAR_Y + 0.10, 0.05),   # the crown of the C, broadside to the camera
    hose_point(88.0, COLLAR_Y + 0.08, 0.04),
    hose_point(79.0, COLLAR_Y + 0.01, 0.02),    # coming down toward the head
    hose_point(75.0, COLLAR_Y - 0.07),
    # ENDS INSIDE THE BOSS, not on top of it. TubeGeometry leaves its ends open, so a path
    # that stops at the surface shows a hollow tube mouth; burying the last sample below the
    # dome's crown puts that mouth inside solid geometry.
    (BOSS_X, round(NOZZLE_THICK + BOSS_RISE * 0.55, 4), BOSS_Z),
]


# ---------------------------------------------------------------------------
# THE CAGE GOES STRAIGHT TO THE TUBE, AND THIS SCRIPT MEASURES THE CURVE THAT SHIPS.
#
# It used to sample the cage into 25 points with a UNIFORM Catmull-Rom and hand those to
# buildTubeGeometry, which builds its OWN CatmullRomCurve3 through them - a CENTRIPETAL one,
# because that is three.js's default. So the shipped shape was an interpolation of an
# interpolation under two different parameterisations, and every check here ran on the inner
# one rather than on the object.
#
# That cost more than tidiness. Measured both ways: feeding the 9-point cage direct gives bow
# 0.1841 against 0.1826, centreline 0.8930 against 0.8955, and 864 triangles against 2400 -
# because tubularSegments is max(8, points * 6), so 25 samples bought 150 rings where the cage
# needs 54. It also removes the collar-end self-intersections outright. Ruling by team-lead:
# take it, and land it alone so its effect is measurable.
#
# The sampler below is three.js's own algorithm, VERIFIED against three.js rather than assumed:
# both return min radius 0.01882 at t 0.083 on the old path and the same folding stretches to
# five decimals. It is what HOSE_PATH is now built with, so clearance, curvature, the cuff's
# seat and the rib count all read the shipped curve. The uniform sampler it replaces reported
# 0.65 of the tube radius at the collar where the truth was 0.33 - wrong by a factor of two,
# in the reassuring direction, which is why the instrument had to become the object.
# ---------------------------------------------------------------------------
def _centripetal_point(points: list, t: float) -> list[float]:
    """THREE.CatmullRomCurve3.getPoint for the default centripetal type, tension 0.5."""
    count = len(points)
    span = (count - 1) * t
    index = min(int(math.floor(span)), count - 2)
    weight = span - index
    p1, p2 = points[index], points[index + 1]
    p0 = points[index - 1] if index > 0 else [2 * p1[k] - p2[k] for k in range(3)]
    p3 = (points[index + 2] if index + 2 < count
          else [2 * p2[k] - p1[k] for k in range(3)])

    def squared(a, b):
        return sum((a[k] - b[k]) ** 2 for k in range(3))

    dt1 = squared(p1, p2) ** 0.25 or 1.0
    dt0 = squared(p0, p1) ** 0.25 or dt1
    dt2 = squared(p2, p3) ** 0.25 or dt1
    out = []
    for k in range(3):
        # Nonuniform Catmull-Rom tangents, then the cubic three.js evaluates.
        m1 = ((p1[k] - p0[k]) / dt0 - (p2[k] - p0[k]) / (dt0 + dt1)
              + (p2[k] - p1[k]) / dt1) * dt1
        m2 = ((p2[k] - p1[k]) / dt1 - (p3[k] - p1[k]) / (dt1 + dt2)
              + (p3[k] - p2[k]) / dt2) * dt1
        c0, c1 = p1[k], m1
        c2 = -3 * p1[k] + 3 * p2[k] - 2 * m1 - m2
        c3 = 2 * p1[k] - 2 * p2[k] + m1 + m2
        out.append(c0 + c1 * weight + c2 * weight ** 2 + c3 * weight ** 3)
    return out


# Dense enough that a walk along it is a fair stand-in for arc length and that the cuff lands
# where it should. This polyline is NOT shipped - HOSE_CAGE_LOCAL is - so its density costs
# geometry nothing and only sharpens the measurements.
HOSE_PATH_SAMPLES = 240
HOSE_PATH = [[round(v, 5) for v in _centripetal_point(HOSE_CONTROL, i / (HOSE_PATH_SAMPLES - 1))]
             for i in range(HOSE_PATH_SAMPLES)]
HOSE_LENGTH = round(sum(
    math.dist(a, b) for a, b in zip(HOSE_PATH, HOSE_PATH[1:])), 4)
# Not counted off the projection: the reference foreshortens the far limb of the loop, so a
# rib count read there is wrong by however much of the run is depth. The pitch IS measured,
# and the count is what the pitch and the authored centreline together imply.
HOSE_RIB_COUNT = int(round(HOSE_LENGTH / HOSE_PITCH))

# What actually ships: the authored cage, in the body's frame. buildTubeGeometry interpolates
# it once, centripetally, which is exactly the curve HOSE_PATH samples above.
HOSE_CAGE_LOCAL = [list(to_body(*p)) for p in HOSE_CONTROL]

def _walk_back(distance: float) -> int:
    """Index of the sample roughly `distance` of arc back from the hose's end."""
    travelled, index = 0.0, len(HOSE_PATH) - 1
    while index > 1 and travelled < distance:
        travelled += math.dist(HOSE_PATH[index], HOSE_PATH[index - 1])
        index -= 1
    return index


# The cuff is centred ON the tube, about a cuff length back from its buried end, so the tube
# runs through it rather than stopping at its face. Its axis is the tube's own tangent there:
# a yaw-only rotation left it crossing the hose at an angle and reading as a notched ring,
# which is what direction_rotation exists to fix.
_cuff_index = _walk_back(CUFF_LENGTH * 0.9)
CUFF_POS = tuple(HOSE_PATH[_cuff_index])
CUFF_TANGENT = tuple(HOSE_PATH[min(_cuff_index + 1, len(HOSE_PATH) - 1)][i]
                     - HOSE_PATH[max(_cuff_index - 1, 0)][i] for i in range(3))


def clearance_report() -> list[str]:
    """Fail loudly rather than shipping a hose through the body or out of the box.

    Renders do not show this: a hose limb buried in the canister is invisible from the
    reference angle and obvious from the chase camera in motion, which is the same class of
    error the per-part world Box3 dump exists to catch.
    """
    problems = []
    for index, (x, y, z) in enumerate(HOSE_PATH):
        if abs(x) + HOSE_TUBE_R > BOX_WIDTH / 2 + 1e-6:
            problems.append(f"hose sample {index} breaks the box in X at {abs(x) + HOSE_TUBE_R:.4f}")
        if abs(z) + HOSE_TUBE_R > BOX_DEPTH / 2 + 1e-6:
            problems.append(f"hose sample {index} breaks the box in Z at {abs(z) + HOSE_TUBE_R:.4f}")
        if y + HOSE_TUBE_R > BOX_HEIGHT + 1e-6:
            problems.append(f"hose sample {index} breaks the box in Y at {y + HOSE_TUBE_R:.4f}")
        if index in (0, len(HOSE_PATH) - 1):
            continue
        radial = math.hypot(x, z - CANISTER_Z)
        if 0.0 <= y <= HEIGHT and radial + HOSE_TUBE_R < body_radius_at(y) - 1e-6:
            problems.append(
                f"hose sample {index} at y={y:.3f} is inside the body: radial "
                f"{radial:.4f} + tube {HOSE_TUBE_R} < profile {body_radius_at(y):.4f}")
        # The route descends outboard of the shell, which is also where the wheels are, so
        # clearing the body is not on its own enough.
        for side in (1.0, -1.0):
            if (abs(x - side * WHEEL_X) < WHEEL_HALF_THICK + HOSE_TUBE_R
                    and math.hypot(y - WHEEL_RADIUS, z - WHEEL_Z)
                    < WHEEL_RADIUS + HOSE_TUBE_R):
                problems.append(f"hose sample {index} intersects the "
                                f"{'right' if side > 0 else 'left'} wheel")
    if max(p[1] for p in HOSE_PATH) + HOSE_TUBE_R > HANDLE_TOP_Y:
        problems.append("the hose tops the handle; the handle's crown is a feature-review "
                        "target and must stay the prop's highest point")
    return problems


def _inside_collar(point: list[float]) -> bool:
    """Whether a fold at this point is hidden inside the collar's solid revolve.

    The collar is a closed lathe, so a self-intersection buried in it cannot be seen. This is
    the arithmetic half of the concealment argument the fan's blade web also rests on: the
    physics says the hose must enter the socket, and this says the entry is covered.
    """
    delta = [point[0] - COLLAR_POS[0], point[1] - COLLAR_POS[1], point[2] - COLLAR_POS[2]]
    along = delta[0] * math.cos(COLLAR_ANGLE) + delta[2] * math.sin(COLLAR_ANGLE)
    perpendicular = math.sqrt(max(sum(q * q for q in delta) - along * along, 0.0))
    return (-0.02 <= along <= COLLAR_LENGTH
            and perpendicular + HOSE_TUBE_R <= COLLAR_DIAMETER / 2)


# The curvature is a three-point circumradius, so it is a DISCRETE estimate and it converges
# downward as the sampling tightens: the exposed stretch reads 0.438 of the tube radius at 300
# samples, 0.428 at 500, 0.421 here and 0.414 at 2400. The verdict never changes - every one of
# those is a fold - but the ratio is not a number to quote to three decimals.
FOLD_SAMPLES = 900


def fold_report() -> list[tuple[float, float, float, list[float]]]:
    """Every stretch of the shipped hose that passes through itself and is not concealed.

    Returns (t_start, t_end, min_radius, midpoint) per stretch. Reported rather than
    asserted: the one stretch this currently finds needs a route change to remove, which is
    a design decision, so failing the build here would only stop the pipeline.
    """
    # Sampled from the CAGE, not from HOSE_PATH: interpolating an already-interpolated
    # polyline is the very double pass this prop just stopped shipping.
    dense = [_centripetal_point(HOSE_CONTROL, i / (FOLD_SAMPLES - 1))
             for i in range(FOLD_SAMPLES)]
    runs: list[list] = []
    open_run = False
    for i in range(1, len(dense) - 1):
        a, b, c = dense[i - 1], dense[i], dense[i + 1]
        side_a = math.dist(b, c)
        side_b = math.dist(a, c)
        side_c = math.dist(a, b)
        half = (side_a + side_b + side_c) / 2
        area = math.sqrt(max(half * (half - side_a) * (half - side_b) * (half - side_c), 0.0))
        if area < 1e-15:
            open_run = False
            continue
        radius = side_a * side_b * side_c / (4 * area)
        if radius >= HOSE_TUBE_R or _inside_collar(b):
            open_run = False
            continue
        t = i / (FOLD_SAMPLES - 1)
        if not open_run:
            runs.append([t, t, radius, b])
            open_run = True
        else:
            runs[-1][1] = t
            if radius < runs[-1][2]:
                runs[-1][2], runs[-1][3] = radius, b
    return [(round(r[0], 4), round(r[1], 4), round(r[2], 5),
             [round(q, 4) for q in r[3]]) for r in runs]


# ---------------------------------------------------------------------------
# the handle
#
# A round bar arching over the top face. Its feet are buried below the face so the joint is a
# contact rather than a butt, and the crown is the prop's highest point.
# ---------------------------------------------------------------------------
HANDLE_FOOT_R = HANDLE_SPAN / 2.0
HANDLE_A = (round(HANDLE_FOOT_R * math.cos(HANDLE_YAW), 4),
            round(CANISTER_Z + HANDLE_FOOT_R * math.sin(HANDLE_YAW), 4))
HANDLE_B = (round(-HANDLE_FOOT_R * math.cos(HANDLE_YAW), 4),
            round(CANISTER_Z - HANDLE_FOOT_R * math.sin(HANDLE_YAW), 4))
HANDLE_FOOT_Y = round(HEIGHT - 0.020, 4)   # buried below the top face, not butted onto it
HANDLE_SAMPLES = 10   # 11 points, for the same reason as the hose
# A super-ellipse rather than a sine: a carry handle leaves its seat steeply and flattens at
# the crown, and sin(pi*t) leaves the foot at 53 degrees, which reads as a croquet hoop.
HANDLE_PATH = []
for _i in range(HANDLE_SAMPLES + 1):
    _t = _i / HANDLE_SAMPLES
    _rise = (1.0 - abs(2 * _t - 1) ** 2.2) ** (1 / 2.2)
    HANDLE_PATH.append([
        round(HANDLE_A[0] + (HANDLE_B[0] - HANDLE_A[0]) * _t, 5),
        round(HANDLE_FOOT_Y + (HANDLE_TOP_Y - HANDLE_FOOT_Y) * _rise, 5),
        round(HANDLE_A[1] + (HANDLE_B[1] - HANDLE_A[1]) * _t, 5),
    ])
HANDLE_PATH_LOCAL = [list(to_body(*p)) for p in HANDLE_PATH]

# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
MATERIALS = [
    material(PROP, "body-lilac", "Canister shell", BODY_LILAC,
             [BODY_LILAC, "#a690c6", "#d3c2ea"],
             0.58, 0.07, 0.36, 0.84,
             [override("body-underside-occlusion", "vacuum-body/body-roll-under",
                       "The canister's underside turns away from the key and is the darkest "
                       "lilac in the frame; the reference's roll-under reads as a soft band "
                       "rather than a terminator, so the falloff is broad.",
                       [EVIDENCE, "body-zone"], roughness=0.64, aoBoost=0.58,
                       mask="the body below the widest band and the throat behind the wheels"),
              override("body-crown-sheen", "vacuum-body/body-top-face",
                       "The top face is the one broad soft highlight on the body and is what "
                       "makes the shell read as a moulded lid rather than a painted drum.",
                       [EVIDENCE, "body-zone"], roughness=0.50,
                       mask="the top face inside the rim roll")],
             "Matte injection-moulded ABS. Measured #bca6da and SHIPPED at that value rather "
             "than corrected to PALETTE.purple, which is a different colour at #8b72ff, not a "
             "correction of this one."),
    material(PROP, "hose-navy", "Hose, belt and collar", NAVY,
             [NAVY, "#26365a", "#4d6591"],
             0.66, 0.08, 0.42, 0.82,
             [override("hose-groove-occlusion", "vacuum-hose/hose-corrugation",
                       "Each corrugation groove holds shadow the crown does not, which is the "
                       "whole reason the hose reads as ribbed at distance rather than as a "
                       "smooth navy tube.",
                       [EVIDENCE, "hose-zone"], roughness=0.72, aoBoost=0.66,
                       mask="the rib valleys along the hose"),
              override("collar-seat-shadow", "vacuum-collar/collar-boss",
                       "The collar's root darkens hard where it meets the curved flank; the "
                       "reference shows a crisp crescent there rather than a soft blend.",
                       [EVIDENCE, "collar-zone"], aoBoost=0.62,
                       mask="the ring where the boss meets the body")],
             "The darkest value on the prop and the one that carries its read at distance. "
             f"Measured {NAVY}, which is not the #24324a the hand-authored props share; the "
             "reference's own value is shipped, because this rebuild's whole premise is that "
             "the reference is the source of truth."),
    material(PROP, "nozzle-cream", "Floor head", NOZZLE_CREAM,
             [NOZZLE_CREAM, "#e6d5ac", "#fffbee"],
             0.60, 0.06, 0.34, 0.82,
             [override("nozzle-slot-occlusion", "vacuum-nozzle/nozzle-slot",
                       "A long recessed slot runs the head's front face and is the only hard "
                       "dark line on the cream.",
                       [EVIDENCE, "nozzle-zone"], roughness=0.68, aoBoost=0.70,
                       mask="the suction slot along the front face"),
              override("nozzle-crown-sheen", "vacuum-nozzle-boss/boss-dome",
                       "The boss where the hose lands is the head's only convex crown and "
                       "takes the key cleanly.",
                       [EVIDENCE, "nozzle-zone"], roughness=0.52,
                       mask="the dome of the hose boss")],
             "The palest value on the prop. Warm cream, distinctly lighter than the yellow it "
             "sits near, which is why the two masks needed a saturation split rather than a "
             "luminance one."),
    material(PROP, "wheel-coral", "Wheel and nub", WHEEL_CORAL,
             [WHEEL_CORAL, "#cf6a5c", "#f79c8d"],
             0.62, 0.07, 0.38, 0.80,
             [override("tyre-crown-sheen", "vacuum-wheel-right/wheel-tyre-roll",
                       "The tyre's rolled edge catches a bright rim all the way round, which "
                       "is what separates the wheel from the body behind it.",
                       [EVIDENCE, "wheel-zone"], roughness=0.54,
                       mask="the outer roll of the tyre"),
              override("wheel-body-shadow", "vacuum-wheel-right/wheel-standoff",
                       "The body throws a hard shadow onto the wheel's inboard face where the "
                       "two nearly meet.",
                       [EVIDENCE, "wheel-zone"], aoBoost=0.64,
                       mask="the wheel's inboard face")],
             "The prop's only warm saturated accent, and the second strongest value after the "
             "navy."),
    material(PROP, "trim-mint", "Carry handle and hose cuff", MINT,
             [MINT, "#77a894", "#b0dcc7"],
             0.57, 0.07, 0.34, 0.82,
             [override("handle-crown-sheen", "vacuum-handle/handle-arch",
                       "The arch's crown carries a continuous soft highlight along its length, "
                       "which is what reads as a round bar rather than a flat strap.",
                       [EVIDENCE, "handle-zone"], roughness=0.50,
                       mask="the upper third of the arch")],
             "Matte plastic, marginally smoother than the shell. Measured #91c4ae and shipped "
             "at that value; PALETTE.green #57dfa1 is a far more saturated mint and would pull "
             "the handle forward of the body it sits on."),
    material(PROP, "accent-yellow", "Top button and hub caps", BUTTON_YELLOW,
             [BUTTON_YELLOW, "#e5c184", "#fff0c4"],
             0.55, 0.06, 0.32, 0.80,
             [override("button-edge-catch", "vacuum-button/button-cap",
                       "The button is a moulded cap with a rounded edge, not a printed disc: "
                       "its side wall adds about 15 px of image height beyond what a flat "
                       "circle at this pitch would, which is the measurement that reconciled "
                       "its bounding box with the solved camera.",
                       [EVIDENCE, "body-zone"], roughness=0.48,
                       mask="the button's rounded side wall")],
             "The smallest albedo on the prop at 2.8 percent of its area, and the one the "
             "camera solve was taken from."),
]

# ---------------------------------------------------------------------------
# components
#
# STRUCTURAL RULE, BY CONSTRUCTION: no node that has children may carry a non-uniform scale.
# spec_lib's xform omits `scale` when it is passed None, and the factory then falls back to
# `dimensions` for the node scale - which is what a unit-sized box, sphere or cylinder needs
# and what a lathe, tube or extrude must never get, because those carry their real size in
# their own geometry. So every parent here (body, nozzle, both wheels) is a lathe, tube or
# extrude at explicit scale 1, and only leaves are left to take a dimensions-derived scale.
# This is the pivot-scale leak that cost the toilet its raised lid twice, closed by making it
# impossible rather than by remembering not to do it.
# ---------------------------------------------------------------------------
BODY = component(
    "vacuum-body", "Canister shell", "macro", "shell", "lathe", "body-lilac",
    "continuous-sculpt",
    "One revolved drum. The reference shows no face, seam or edge anywhere on the shell: the "
    "floor contact, the widest band and the top face run into each other as one moulded "
    "casting, and every shading break on it is curvature rather than geometry.",
    colours(BODY_LILAC),
    descriptor(f"profile revolved about Y: floor contact at {R_BOTTOM_CONTACT} of the maximum "
               f"radius, widest band at {R_WIDEST_AT} of the height, top face at {R_TOP_FACE}",
               "rolled", 0.04, SIDES,
               deformations=["rim roll into the top face", "roll-under to the floor contact"],
               uv="LatheGeometry cylindrical UVs",
               normals="smooth vertex normals from the revolved profile"),
    xform(position=(0.0, 0.0, CANISTER_Z), scale=(1.0, 1.0, 1.0)),
    dims(DIAMETER, HEIGHT, DIAMETER, 0.8),
    action("root", "center", (0.0, WIDEST_Y, 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "rotate": True, "scale": True},
           sockets=[{"id": "floor", "localPosition": [0.0, 0.0, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Underside of the shell, on the deck plane at y = 0."},
                    {"id": "hose-port",
                     "localPosition": [COLLAR_POS[0], COLLAR_Y,
                                       round(COLLAR_POS[2] - CANISTER_Z, 4)],
                     "localRotation": [0.0, round(-COLLAR_ANGLE, 6), 0.0],
                     "notes": "Where the collar stands off the flank and the hose leaves."},
                    {"id": "top-face", "localPosition": [0.0, HEIGHT, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Centre of the top face, where the handle and button seat."},
                    {"id": "axle-right", "localPosition": [WHEEL_X, WHEEL_RADIUS,
                                                           round(WHEEL_Z - CANISTER_Z, 4)],
                     "localRotation": [0.0, 0.0, 0.0], "notes": "Right wheel centre."},
                    {"id": "axle-left", "localPosition": [-WHEEL_X, WHEEL_RADIUS,
                                                          round(WHEEL_Z - CANISTER_Z, 4)],
                     "localRotation": [0.0, 0.0, 0.0], "notes": "Left wheel centre."}],
           collider={"type": "cylinder", "offset": [0.0, round(HEIGHT / 2, 4), 0.0],
                     "scale": [DIAMETER, HEIGHT, DIAMETER], "isTrigger": False,
                     "notes": "Advisory proxy over the shell only. The gameplay collider is "
                              "the CuboidCollider at the call site and is not derived from "
                              "this."},
           fracture="body"),
    [feature("body-roll-under",
             f"The shell's underside rolls in from the widest {RADIUS} to a floor contact of "
             f"{BOTTOM_R}, so it overhangs its own footprint all round. That overhang is not "
             "decoration: it is the room the nozzle parks in.",
             "lathe profile narrowing below the widest band, fitted from the lower silhouette",
             [EVIDENCE, "body-zone"], 0.8),
     feature("body-widest-band",
             "The body holds within 4 percent of its maximum radius across a BAND from 0.535 "
             f"to 0.720 of its height, not at a single point. {MEASURED_PROFILE_ROWS} of the "
             f"{len(BODY_PROFILE_ROWS)} profile rows are measured off the reference's own "
             "silhouette scan. This is the finding that separates a drum from a ball: an "
             "earlier profile interpolated between three landmarks, narrowed straight off its "
             "single maximum, and rendered as a sphere.",
             "lathe profile from a two-flank silhouette row scan",
             [EVIDENCE, "body-zone"], 0.8),
     feature("body-top-face",
             f"The top face is {R_TOP_FACE} of the maximum radius, a domed lid rather than a "
             "full-width cap. This is the measurement that corrected the recorded height: a "
             "full-width cap is what the retracted H/D = 0.459 assumed.",
             "lathe profile rolling in to the top face",
             [EVIDENCE, "body-zone"], 0.7)],
    surface(0.58, 0.07, 0.0, "matte moulded ABS with very low tone drift",
            "broad occlusion under the widest band and behind both wheels",
            "none - the reference shell shows no wear",
            "The largest single albedo field on the prop at 32.5 percent of its area."),
    [EVIDENCE, "body-zone"],
    importance=1.0, confidence=0.8, parent=None, fidelity="blockout",
)
BODY["geometryDescriptor"]["latheProfile"] = {
    "points": BODY_PROFILE, "segments": SIDES, "phiStart": 0.0,
    "phiLength": round(math.tau, 6),
}

BELT = component(
    "vacuum-belt", "Waist belt", "meso", "trim", "lathe", "hose-navy",
    "continuous-sculpt",
    "A navy band wrapping the shell just above its widest point, standing marginally proud of "
    "it. The reference shows it as an unbroken ring with no fastener anywhere on its run.",
    colours(NAVY),
    descriptor(f"band of height {BELT_BAND} revolved about Y at radius {BELT_RADIUS}, standing "
               f"{BELT_PROUD} proud of the shell",
               "rolled", 0.006, SIDES,
               deformations=[],
               uv="LatheGeometry cylindrical UVs",
               normals="smooth vertex normals from the revolved profile"),
    xform(position=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)),
    dims(round((BELT_RADIUS + BELT_PROUD) * 2, 4), BELT_BAND,
         round((BELT_RADIUS + BELT_PROUD) * 2, 4), 0.6),
    action("trim", "center", (0.0, BELT_Y, 0.0), (0, 1, 0), 0.7,
           collider={"type": "cylinder", "offset": [0.0, BELT_Y, 0.0],
                     "scale": [round((BELT_RADIUS + BELT_PROUD) * 2, 4), BELT_BAND,
                               round((BELT_RADIUS + BELT_PROUD) * 2, 4)],
                     "isTrigger": False, "notes": "Advisory; the belt never touches anything."},
           fracture="body"),
    [feature("belt-band",
             f"The band is {R_BELT_BAND} of the canister's diameter tall, the median of 98 "
             "column samples down the shell's right flank.",
             "lathe profile height",
             [EVIDENCE, "body-zone"], 0.8),
     feature("belt-standoff",
             f"It stands {BELT_PROUD} proud rather than being painted on: the reference's "
             "navy silhouette is 8 px wider than the lilac's at the same rows, which is a "
             "raised band seen edge-on.",
             "lathe profile radius above the shell's own",
             [EVIDENCE, "body-zone"], 0.65)],
    surface(0.66, 0.08, 0.0, "matte plastic, marginally rougher than the shell",
            "a hard occlusion line along both of the band's roots", "none",
            "The darkest band on the body and the value that separates its two lilac halves."),
    [EVIDENCE, "body-zone"],
    importance=0.6, confidence=0.6, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "belt-body-seam", "with": "vacuum-body", "overlap": SEAM_FLOOR,
            "notes": f"The band's inner radius runs {SEAM_FLOOR} inside the shell's own "
                     "surface. It was 0.004, below the contract's floor; the inner radius "
                     "dropped and the outer one did not, so nothing visible moved."}],
)
BELT["geometryDescriptor"]["latheProfile"] = {
    "points": BELT_PROFILE, "segments": SIDES, "phiStart": 0.0, "phiLength": round(math.tau, 6),
}

COLLAR = component(
    "vacuum-collar", "Hose collar", "meso", "socket", "lathe", "hose-navy",
    "continuous-sculpt",
    "A short navy boss standing off the shell's front-left flank, the socket the hose leaves "
    "through. The reference shows it as a stepped cylinder with a clear shoulder, not as a "
    "hole in the body.",
    colours(NAVY),
    descriptor(f"profile revolved about the outward radial at "
               f"{round(math.degrees(COLLAR_ANGLE), 1)} degrees: a barrel of diameter "
               f"{COLLAR_DIAMETER} rounding over at its outer end",
               "rolled", 0.012, 20,
               uv="LatheGeometry cylindrical UVs about the boss axis",
               normals="smooth around the barrel and over the outer roll"),
    xform(position=to_body(*COLLAR_POS), rotation=radial_rotation(COLLAR_ANGLE),
          scale=(1.0, 1.0, 1.0)),
    dims(COLLAR_DIAMETER, COLLAR_LENGTH, COLLAR_DIAMETER, 0.7),
    action("socket", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.7,
           sockets=[{"id": "hose-mouth", "localPosition": [0.0, round(COLLAR_LENGTH / 2, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "The outboard face, where the hose's first sample sits."}],
           collider={"type": "cylinder", "offset": [0.0, 0.0, 0.0],
                     "scale": [COLLAR_DIAMETER, COLLAR_LENGTH, COLLAR_DIAMETER],
                     "isTrigger": False, "notes": "Advisory."},
           fracture="body"),
    [feature("collar-boss",
             f"The boss is {R_COLLAR} of the canister's diameter across, measured from the "
             "navy region that survives once the hose limb is windowed out.",
             "cylinder diameter on the body's outward radial",
             [EVIDENCE, "collar-zone"], 0.7)],
    surface(0.66, 0.08, 0.0, "matte plastic matching the belt",
            "a crescent of hard occlusion where the boss meets the curved flank", "none",
            "The joint the hose's whole read depends on."),
    [EVIDENCE, "collar-zone"],
    importance=0.7, confidence=0.7, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "collar-body-seam", "with": "vacuum-body", "overlap": 0.03,
            "notes": "The boss is sunk 0.03 into the shell so no gap opens on the curve."}],
)
COLLAR["geometryDescriptor"]["latheProfile"] = {
    "points": COLLAR_PROFILE, "segments": 20, "phiStart": 0.0,
    "phiLength": round(math.tau, 6),
}
COLLAR["attachment"] = joint(
    "vacuum-body", "hose-port", "seated-on-flank",
    (0.0, round(-COLLAR_LENGTH / 2, 4), 0.0), (0.0, round(COLLAR_LENGTH / 2, 4), 0.0),
    0.03, round(COLLAR_DIAMETER / 2, 4),
    "The boss's axis, from inside the shell to its outboard face. Declared because it is true "
    "and because a cylinder with a parent fails --strict-quality without one.")

BUTTON = component(
    "vacuum-button", "Top button", "meso", "control", "cylinder", "accent-yellow",
    "assembled-solid",
    "A yellow moulded cap on the top face, forward and left of the axis. It is a cap with a "
    "rounded side wall rather than a printed disc, which is what its silhouette shows.",
    colours(BUTTON_YELLOW),
    descriptor(f"cylinder of diameter {BUTTON_DIAMETER} and thickness {BUTTON_THICK} standing "
               "on the top face",
               "rolled", 0.006, 20,
               uv="planar UVs on the cap face",
               normals="smooth over the rolled edge, flat across the face"),
    xform(position=to_body(BUTTON_X, HEIGHT + BUTTON_PROUD - BUTTON_THICK / 2, BUTTON_Z),
          scale=None),
    dims(BUTTON_DIAMETER, BUTTON_THICK, BUTTON_DIAMETER, 0.8),
    action("control", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.8,
           channels={"translate": True},
           collider={"type": "cylinder", "offset": [0.0, 0.0, 0.0],
                     "scale": [BUTTON_DIAMETER, BUTTON_THICK, BUTTON_DIAMETER],
                     "isTrigger": False, "notes": "Advisory; the button is press-capable."},
           fracture="body"),
    [feature("button-cap",
             f"The cap is {R_BUTTON} of the canister's diameter across, read as a horizontal "
             "image extent and so unforeshortened. Its ellipse is what the camera pitch was "
             "solved from.",
             "cylinder diameter on the top face",
             [EVIDENCE, "body-zone"], 0.85),
     feature("button-placement",
             f"It sits {abs(BUTTON_X)} left of the axis and {round(BUTTON_Z - CANISTER_Z, 4)} "
             "forward of it. The forward offset is not a style choice: it is what the "
             "corrected canister height implies, and it is the third route that rejected the "
             "retracted height.",
             "component position on the top face",
             [EVIDENCE, "body-zone"], 0.7)],
    surface(0.55, 0.06, 0.0, "matte plastic with a slightly polished crown",
            "a thin ring of occlusion at the cap's root", "none",
            "The smallest part on the prop and the one the camera was solved from."),
    [EVIDENCE, "body-zone"],
    importance=0.5, confidence=0.8, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "button-body-seam", "with": "vacuum-body", "overlap": SEAM_FLOOR,
            "notes": f"The cap is {BUTTON_THICK} thick and sunk {SEAM_FLOOR} into the top "
                     f"face, leaving the measured {BUTTON_PROUD} proud. It was a {0.018} cap "
                     "sunk 0.004 - below the floor, and a cap that thin CANNOT meet it, which "
                     "is why the fix was to make it thicker and bury the difference rather "
                     "than to raise the embed."}],
)
BUTTON["attachment"] = joint(
    "vacuum-body", "top-face", "seated-on-face",
    (0.0, round(-BUTTON_THICK / 2, 4), 0.0), (0.0, round(BUTTON_THICK / 2, 4), 0.0),
    SEAM_FLOOR, round(BUTTON_DIAMETER / 2, 4),
    "The cap's axis through the top face.")

HANDLE = component(
    "vacuum-handle", "Carry handle", "meso", "handle", "tube", "trim-mint",
    "continuous-sculpt",
    "A round mint bar arching across the top face from back-left to front-right. There is no "
    "flat anywhere on it in the reference; its crown carries one continuous highlight, which "
    "is a round section rolling away from the key.",
    colours(MINT),
    descriptor(f"round section of radius {HANDLE_BAR_R} swept along an arch spanning "
               f"{HANDLE_SPAN} and rising {HANDLE_RISE}",
               "none", 0.0, HANDLE_SAMPLES,
               deformations=[],
               uv="TubeGeometry UVs running along the arch",
               normals="smooth vertex normals from the swept section"),
    xform(position=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)),
    dims(HANDLE_SPAN, round(HANDLE_TOP_Y - HANDLE_FOOT_Y, 4),
         round(HANDLE_SPAN * math.sin(HANDLE_YAW) + HANDLE_BAR_R * 2, 4), 0.7),
    action("handle", "center", (0.0, round((HANDLE_FOOT_Y + HANDLE_TOP_Y) / 2, 4), 0.0),
           (0, 1, 0), 0.7,
           sockets=[{"id": "grip", "localPosition": [0.0, HANDLE_TOP_Y, 0.0],
                     "localRotation": [0.0, round(HANDLE_YAW, 6), 0.0],
                     "notes": "The crown, and the prop's highest point."}],
           collider={"type": "box",
                     "offset": [0.0, round((HANDLE_FOOT_Y + HANDLE_TOP_Y) / 2, 4), 0.0],
                     "scale": [HANDLE_SPAN, round(HANDLE_TOP_Y - HANDLE_FOOT_Y, 4),
                               round(HANDLE_BAR_R * 2, 4)],
                     "isTrigger": False, "notes": "Advisory."},
           fracture="trim"),
    [feature("handle-arch",
             f"The arch spans {R_HANDLE_SPAN} of the canister's diameter and rises "
             f"{R_HANDLE_RISE} of it. The rise is measured as the crown's height above the "
             "chord between the two feet AT MATCHED IMAGE X, so the depth term cancels and "
             "the 137 px is pure elevation.",
             "tube path rise over its own chord",
             [EVIDENCE, "handle-zone"], 0.75),
     feature("handle-section",
             f"A round bar of radius {HANDLE_BAR_R}, which at this span is a chunky toy handle "
             "rather than a wire loop.",
             "TubeGeometry round cross-section, 8 radial segments",
             [EVIDENCE, "handle-zone"], 0.7),
     feature("handle-foot-angle",
             "The arch leaves its feet steeply and flattens at the crown. Authored as a "
             "super-ellipse: a sine arch of the same span and rise leaves the foot at 53 "
             "degrees from horizontal, which reads as a croquet hoop rather than a handle.",
             "super-ellipse exponent 2.2 on the rise",
             [EVIDENCE, "handle-zone"], 0.6)],
    surface(0.57, 0.07, 0.0, "matte plastic, marginally smoother than the shell",
            "deep occlusion in the gap between the arch and the top face", "none",
            "The only part of the prop above the canister."),
    [EVIDENCE, "handle-zone"],
    importance=0.7, confidence=0.7, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "handle-body-seam", "with": "vacuum-body", "overlap": 0.02,
            "notes": "Both feet run 0.02 below the top face rather than butting onto it."}],
)
HANDLE["geometryDescriptor"]["tubePath"] = {
    "points": HANDLE_PATH_LOCAL, "radius": HANDLE_BAR_R, "radialSegments": TUBE_RADIAL,
    "closed": False,
}
HANDLE["attachment"] = joint(
    "vacuum-body", "top-face", "seated-in-face",
    to_body(HANDLE_A[0], HANDLE_FOOT_Y, HANDLE_A[1]),
    to_body(HANDLE_B[0], HANDLE_FOOT_Y, HANDLE_B[1]),
    0.02, HANDLE_BAR_R,
    "Foot to foot across the top face. THE GEOMETRY IS NOT THIS LINE: without "
    "geometryFromSpec the generator would build a straight bar between these two points and "
    "throw the arch away, and the render would still pass every pixel gate from the reference "
    "angle because the arch is nearly edge-on there.")

HOSE = component(
    "vacuum-hose", "Corrugated hose", "macro", "tube", "tube", "hose-navy",
    "continuous-sculpt",
    "A round navy section swept along a curve from the collar to the floor head. This is the "
    "part that says vacuum rather than kettle: a quarter of the reference's silhouette is "
    "hose, and it is the only long curve on the prop.",
    colours(NAVY),
    descriptor(f"round section of radius {HOSE_TUBE_R} swept along a {HOSE_LENGTH} centreline "
               f"from the collar, over the body's forward shoulder, down onto the head",
               "none", 0.0, TUBE_RADIAL,
               deformations=[],
               uv="TubeGeometry UVs running along the hose",
               normals="smooth vertex normals from the swept section"),
    xform(position=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)),
    dims(round(max(p[0] for p in HOSE_PATH) - min(p[0] for p in HOSE_PATH) + HOSE_TUBE_R * 2, 4),
         round(max(p[1] for p in HOSE_PATH) - min(p[1] for p in HOSE_PATH) + HOSE_TUBE_R * 2, 4),
         round(max(p[2] for p in HOSE_PATH) - min(p[2] for p in HOSE_PATH) + HOSE_TUBE_R * 2, 4),
         0.6),
    action("tube", "center", (0.0, 0.30, 0.25), (0, 1, 0), 0.6,
           channels={"bend": True},
           sockets=[{"id": "hose-root", "localPosition": list(to_body(*HOSE_PATH[0])),
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "The collar end."},
                    {"id": "hose-tip", "localPosition": list(to_body(*HOSE_PATH[-1])),
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "The cuff end, on the head's boss."}],
           collider={"type": "capsule", "offset": [-0.15, 0.32, 0.28],
                     "scale": [0.42, 0.30, 0.40], "isTrigger": False,
                     "notes": "Advisory only, and deliberately crude: the hose is a curve and "
                              "no single proxy fits it. Nothing in the game tests against it."},
           fracture="hose"),
    [feature("hose-curve",
             f"The hose runs {HOSE_LENGTH} of centreline between two points only "
             f"{round(math.dist(HOSE_PATH[0], HOSE_PATH[-1]), 4)} apart, so most of its length "
             "is slack. That slack is what makes it read as a hose; a taut run between the "
             "same two points reads as a strut.",
             "Catmull-Rom through 8 control points, sampled at 14 per segment",
             [EVIDENCE, "hose-zone"], 0.6),
     feature("hose-section",
             f"A round section of radius {HOSE_TUBE_R}, from a tube diameter measured at "
             f"{R_HOSE_TUBE} of the canister's, held between 101.5 and 110.0 px across three "
             "independently chosen locally-straight runs.",
             "TubeGeometry round cross-section, 8 radial segments",
             [EVIDENCE, "hose-zone"], 0.8),
     feature("hose-corrugation",
             f"{HOSE_RIB_COUNT} ribs at a pitch of {HOSE_PITCH}, which is {R_HOSE_PITCH} of "
             "the canister's diameter. The pitch is measured; the COUNT is derived from it and "
             "the authored centreline, because the reference foreshortens the far limb of the "
             "loop and a count read off the projection would be short by however much of the "
             "run is depth. NOT BUILT AT BLOCKOUT - see risks.",
             "repetition system hose-corrugation, delivered at form-refinement",
             [EVIDENCE, "hose-zone"], 0.75)],
    surface(0.66, 0.08, 0.0, "matte plastic, the same family as the belt",
            "deep occlusion in every rib valley and where the hose passes the body",
            "none",
            "The prop's value anchor: the darkest, longest continuous form on it."),
    [EVIDENCE, "hose-zone"],
    importance=1.0, confidence=0.6, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "hose-collar-seam", "with": "vacuum-collar", "overlap": 0.025,
            "notes": "The first sample sits inside the collar's mouth."},
           {"id": "hose-cuff-seam", "with": "vacuum-cuff", "overlap": 0.025,
            "notes": "The last sample sits inside the cuff."}],
)
HOSE["geometryDescriptor"]["tubePath"] = {
    "points": HOSE_CAGE_LOCAL, "radius": HOSE_TUBE_R, "radialSegments": TUBE_RADIAL, "closed": False,
}
HOSE["attachment"] = joint(
    "vacuum-body", "hose-port", "seated-in-socket",
    to_body(*HOSE_PATH[0]), to_body(*HOSE_PATH[-1]), 0.025, HOSE_TUBE_R,
    "Collar mouth to cuff. THIS IS THE HIGHEST-RISK LINE IN THE SPEC. Without "
    "geometryFromSpec the generator replaces the swept curve with a CylinderGeometry between "
    "exactly these two points and discards the component's transform, so the hose ships as a "
    "straight navy rod - and every pixel gate still passes, because a rod between the same "
    "endpoints fills a similar silhouette. refine_props.py installs the guard and fails the "
    "build loudly if it cannot; tests/unit/sculpted-props.test.ts pins the sample count so a "
    "regenerated factory that drops the guard fails rather than shipping the rod.")

NOZZLE = component(
    "vacuum-nozzle", "Floor head", "macro", "shell", "extrude", "nozzle-cream",
    "assembled-solid",
    "A cream slab lying flat on the deck, longer than it is deep, with rounded corners and a "
    "recessed suction slot down its front face. The reference shows it as a squared moulding, "
    "not a revolve: its two long edges are straight.",
    colours(NOZZLE_CREAM),
    descriptor(f"chamfered rectangle {NOZZLE_LENGTH} by {NOZZLE_WIDTH} extruded {NOZZLE_THICK} "
               "along +Y",
               "chamfered", 0.05, 8,
               deformations=[],
               uv="planar UVs from the extrusion",
               normals="hard normals on the walls, flat on the top face",
               profile2d=profile(chamfered_rect(NOZZLE_LENGTH, NOZZLE_WIDTH, 0.05),
                                 NOZZLE_THICK, axis="y",
                                 holes=[SLOT_LOOP])),
    xform(position=to_body(0.0, 0.0, NOZZLE_Z), scale=(1.0, 1.0, 1.0)),
    dims(NOZZLE_LENGTH, NOZZLE_THICK, NOZZLE_WIDTH, 0.7),
    action("shell", "center", (0.0, round(NOZZLE_THICK / 2, 4), 0.0), (0, 1, 0), 0.75,
           channels={"translate": True, "rotate": True},
           sockets=[{"id": "boss-seat", "localPosition": [BOSS_X, NOZZLE_THICK,
                                                          round(BOSS_Z - NOZZLE_Z, 4)],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Where the hose boss stands on the head's top face."}],
           collider={"type": "box", "offset": [0.0, round(NOZZLE_THICK / 2, 4), 0.0],
                     "scale": [NOZZLE_LENGTH, NOZZLE_THICK, NOZZLE_WIDTH], "isTrigger": False,
                     "notes": "Advisory."},
           fracture="head"),
    [feature("nozzle-plan",
             f"The head is {R_NOZZLE_LENGTH} by {R_NOZZLE_WIDTH} of the canister's diameter in "
             "plan. Both come from the floor-contact contour un-squashed by 1/sin(pitch): that "
             "contour lies in the ground plane everywhere, unlike the head's top edge, which "
             "the raised boss lifts out of it.",
             "chamfered rectangle in the extrusion profile",
             [EVIDENCE, "nozzle-zone"], 0.65),
     feature("nozzle-slot",
             f"The suction slot runs {SLOT_LENGTH} along the head and is {SLOT_WIDTH} across, "
             f"which is {R_NOZZLE_SLOT_LENGTH} and {R_NOZZLE_SLOT_WIDTH} of the canister's "
             "diameter. Both come from the one dark band enclosed by the head's cream mask, "
             "un-squashed into plan by 1/sin(pitch) the same way the head's own outline was. "
             f"Its {SLOT_FRONT_WALL} setback from the front lip is ASSUMED, because recovering "
             "it would need the head's image plan frame and that frame is this spec's weakest "
             "measurement.",
             "a hole cut through the head's own extrusion profile, so it costs no draw call",
             [EVIDENCE, "nozzle-zone"], 0.7),
     feature("nozzle-parks-under-body",
             f"The head's rear edge sits at z {round(NOZZLE_Z - NOZZLE_WIDTH / 2, 4)}, which is "
             f"the body's forward floor contact. It tucks UNDER the shell's overhang: the "
             f"body's widest band reaches {RADIUS} while its floor contact stops at "
             f"{BOTTOM_R}, and the head is thinner than the height of that overhang. This is "
             "the authored deviation from the reference pose, and it is what makes the prop "
             "fit at all.",
             "component placement against the measured roll-under",
             [EVIDENCE, "call-site"], 0.8)],
    surface(0.60, 0.06, 0.0, "matte moulded plastic, flatter than the shell",
            "hard occlusion in the suction slot and under the head's overhang",
            "none",
            "The palest field on the prop and the one nearest the deck."),
    [EVIDENCE, "nozzle-zone"],
    importance=0.9, confidence=0.7, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "nozzle-boss-seam", "with": "vacuum-nozzle-boss", "overlap": 0.02,
            "notes": "The boss's base is sunk into the head's top face."}],
)

NOZZLE_BOSS = component(
    "vacuum-nozzle-boss", "Hose boss", "meso", "shell", "lathe", "nozzle-cream",
    "continuous-sculpt",
    "The rounded cream dome on the head's top face where the hose lands. In the reference it "
    "is the only convex crown on the head and the reason its middle columns span four times "
    "what its end columns do.",
    colours(NOZZLE_CREAM),
    descriptor(f"dome of base width {BOSS_WIDTH} and rise {BOSS_RISE} revolved about Y",
               "rolled", 0.02, 16,
               uv="LatheGeometry cylindrical UVs",
               normals="smooth vertex normals from the revolved profile"),
    xform(position=to_nozzle(BOSS_X, NOZZLE_THICK, BOSS_Z), scale=(1.0, 1.0, 1.0)),
    dims(BOSS_WIDTH, BOSS_RISE, BOSS_WIDTH, 0.6),
    action("shell", "center", (0.0, round(BOSS_RISE / 2, 4), 0.0), (0, 1, 0), 0.6,
           collider={"type": "cylinder", "offset": [0.0, round(BOSS_RISE / 2, 4), 0.0],
                     "scale": [BOSS_WIDTH, BOSS_RISE, BOSS_WIDTH], "isTrigger": False,
                     "notes": "Advisory."},
           fracture="head"),
    [feature("boss-dome",
             f"The dome rises {BOSS_RISE} above the head's {NOZZLE_THICK} slab, so the head's "
             "silhouette is more than twice as tall through its middle as at either end. The "
             "reference's column scan gives 208 px through the boss against 46 and 53 at the "
             "ends.",
             "lathe profile rise",
             [EVIDENCE, "nozzle-zone"], 0.7)],
    surface(0.52, 0.06, 0.0, "matte plastic with a soft crown highlight",
            "occlusion in the fillet where the dome meets the slab", "none",
            "The head's only convex form."),
    [EVIDENCE, "nozzle-zone"],
    importance=0.5, confidence=0.6, parent="vacuum-nozzle", fidelity="blockout",
    seams=[{"id": "boss-head-seam", "with": "vacuum-nozzle", "overlap": 0.02,
            "notes": "The dome's base is sunk 0.02 into the head."}],
)
NOZZLE_BOSS["geometryDescriptor"]["latheProfile"] = {
    "points": BOSS_PROFILE, "segments": 16, "phiStart": 0.0, "phiLength": round(math.tau, 6),
}

CUFF = component(
    "vacuum-cuff", "Hose cuff", "meso", "connector", "cylinder", "trim-mint",
    "assembled-solid",
    "The mint collar where the hose meets the head. It is the second mint field on the prop "
    "and the only one that is not the handle.",
    colours(MINT),
    descriptor(f"cylinder of diameter {CUFF_DIAMETER} and length {CUFF_LENGTH} laid on the "
               "hose's own tangent at its last sample",
               "chamfered", 0.008, 16,
               uv="cylindrical UVs about the cuff axis",
               normals="smooth around the barrel"),
    xform(position=to_nozzle(*CUFF_POS), rotation=direction_rotation(CUFF_TANGENT),
          scale=None),
    dims(CUFF_DIAMETER, CUFF_LENGTH, CUFF_DIAMETER, 0.6),
    action("connector", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.6,
           collider={"type": "cylinder", "offset": [0.0, 0.0, 0.0],
                     "scale": [CUFF_DIAMETER, CUFF_LENGTH, CUFF_DIAMETER], "isTrigger": False,
                     "notes": "Advisory."},
           fracture="head"),
    [feature("cuff-band",
             f"The cuff is {R_CUFF} of the canister's diameter across, from a 110 px mint blob "
             f"against the hose's own {R_HOSE_TUBE}, so it is a genuine step out from the tube "
             "rather than a painted band.",
             "cylinder diameter over the hose's section",
             [EVIDENCE, "nozzle-zone"], 0.7)],
    surface(0.57, 0.07, 0.0, "matte plastic matching the handle",
            "occlusion at both of the cuff's shoulders", "none",
            "A small part carrying a large share of the prop's colour rhythm."),
    [EVIDENCE, "nozzle-zone"],
    importance=0.5, confidence=0.6, parent="vacuum-nozzle", fidelity="blockout",
    seams=[{"id": "cuff-hose-seam", "with": "vacuum-hose", "overlap": 0.025,
            "notes": "The hose's last sample runs inside the cuff."}],
)
CUFF["attachment"] = joint(
    "vacuum-nozzle", "boss-seat", "sleeved-over-tube",
    (0.0, round(-CUFF_LENGTH / 2, 4), 0.0), (0.0, round(CUFF_LENGTH / 2, 4), 0.0),
    0.025, round(CUFF_DIAMETER / 2, 4),
    "The cuff's axis along the hose's tangent where it lands on the boss.")


def wheel(side: str, sign: float) -> dict:
    node = component(
        f"vacuum-wheel-{side}", f"{side.capitalize()} wheel", "macro", "wheel", "lathe",
        "wheel-coral", "continuous-sculpt",
        "A fat coral disc with a rolled tyre edge, mounted on a horizontal axle at the "
        "shell's flank. The reference shows the outer face square to its axle with a "
        "generous roll all round the rim, which is a toy wheel rather than a castor.",
        colours(WHEEL_CORAL),
        descriptor(f"disc of radius {WHEEL_RADIUS} and thickness "
                   f"{round(WHEEL_HALF_THICK * 2, 4)} revolved about Y, then laid on a "
                   "horizontal axle by the node's rotation alone",
                   "rolled", 0.03, SIDES,
                   deformations=[],
                   uv="LatheGeometry cylindrical UVs",
                   normals="smooth vertex normals from the revolved profile"),
        xform(position=to_body(sign * WHEEL_X, WHEEL_RADIUS, WHEEL_Z),
              rotation=radial_rotation(0.0 if sign > 0 else math.pi), scale=(1.0, 1.0, 1.0)),
        dims(round(WHEEL_HALF_THICK * 2, 4), WHEEL_DIAMETER, WHEEL_DIAMETER, 0.7),
        action("wheel", "center", (0.0, 0.0, 0.0), (1, 0, 0), 0.8,
               channels={"rotate": True},
               sockets=[{"id": "hub-face",
                         "localPosition": [0.0, round(WHEEL_HALF_THICK, 4), 0.0],
                         "localRotation": [0.0, 0.0, 0.0],
                         "notes": "The outboard face, where the hub cap seats. Local to the "
                                  "rotated node, so its +Y is the world outward direction."}],
               collider={"type": "cylinder", "offset": [0.0, 0.0, 0.0],
                         "scale": [WHEEL_DIAMETER, round(WHEEL_HALF_THICK * 2, 4),
                                   WHEEL_DIAMETER],
                         "isTrigger": False,
                         "notes": "Advisory. The wheel spins in the runtime but never carries "
                                  "the prop's motion, which the root does."},
               fracture="wheel"),
        [feature("wheel-tyre-roll",
                 f"The tyre rolls over its full {WHEEL_HALF_THICK} half-thickness at the rim "
                 "rather than meeting the face at an edge, which is what gives it a "
                 "continuous bright ring all the way round.",
                 "lathe profile with its maximum radius at the mid-thickness",
                 [EVIDENCE, "wheel-zone"], 0.7),
         feature("wheel-standoff",
                 f"The wheel's centre sits {R_WHEEL_STANDOFF} of the canister's diameter from "
                 f"the axis, which is {round(WHEEL_X - body_radius_at(WHEEL_RADIUS), 4)} "
                 "outside the shell's own surface at that height. It is mounted proud on a "
                 "stub, not sunk into the flank.",
                 "component position against the body profile at the wheel's height",
                 [EVIDENCE, "wheel-zone"], 0.65),
         feature("wheel-proportion",
                 f"Diameter {R_WHEEL} of the canister's and thickness {R_WHEEL_THICK}, so the "
                 "wheel is 0.45 as thick as it is wide. The diameter is the disc's image "
                 "vertical extent divided by 0.975: a circle in a vertical plane projects its "
                 "true diameter vertically to within 2.5 percent at any plausible axle "
                 "bearing, which is what makes that reading safe when its horizontal one is "
                 "not.",
                 "lathe profile extents",
                 [EVIDENCE, "wheel-zone"], 0.7)],
        surface(0.62, 0.07, 0.0, "matte moulded plastic",
                "hard occlusion on the inboard face where the body nearly touches it",
                "none",
                "The prop's only saturated warm accent."),
        [EVIDENCE, "wheel-zone"],
        importance=0.8, confidence=0.7, parent="vacuum-body", fidelity="blockout",
        seams=[{"id": f"wheel-{side}-body-seam", "with": "vacuum-body", "overlap": 0.02,
                "notes": "The inboard face laps the shell's flank."}],
    )
    node["geometryDescriptor"]["latheProfile"] = {
        "points": WHEEL_PROFILE, "segments": SIDES, "phiStart": 0.0,
        "phiLength": round(math.tau, 6),
    }
    return node


def hub(side: str, sign: float) -> dict:
    node = component(
        f"vacuum-hub-{side}", f"{side.capitalize()} hub cap", "meso", "trim", "cylinder",
        "accent-yellow", "assembled-solid",
        "A yellow disc on the wheel's outer face. It is the second yellow field on the prop "
        "and reads at distance as the wheel's eye.",
        colours(BUTTON_YELLOW),
        descriptor(f"cylinder of diameter {round(HUBCAP_RADIUS * 2, 4)} standing on the "
                   "wheel's outboard face",
                   "rolled", 0.005, 16,
                   uv="planar UVs on the cap face",
                   normals="smooth over the rolled edge"),
        # LOCAL TO THE ROTATED WHEEL. The wheel node already carries the rotation that
        # lays it on a horizontal axle, so the cap inherits it and needs none of its own;
        # in that frame the wheel's +Y IS the outward direction, which is why this is a
        # bare offset along Y. Authoring the cap's world position here instead spins it
        # by the parent's 90 degrees and flings it off the prop entirely.
        xform(position=(0.0, round(WHEEL_HALF_THICK + HUB_PROUD - HUB_THICK / 2, 4), 0.0),
              scale=None),
        dims(round(HUBCAP_RADIUS * 2, 4), HUB_THICK, round(HUBCAP_RADIUS * 2, 4), 0.7),
        action("trim", "center", (0.0, 0.0, 0.0), (1, 0, 0), 0.7,
               collider={"type": "cylinder", "offset": [0.0, 0.0, 0.0],
                         "scale": [round(HUBCAP_RADIUS * 2, 4), 0.018,
                                   round(HUBCAP_RADIUS * 2, 4)],
                         "isTrigger": False, "notes": "Advisory."},
               fracture="wheel"),
        [feature("hub-cap",
                 f"The cap is {R_HUBCAP} of the canister's diameter, which is 0.59 of its own "
                 "wheel. Both come from vertical image extents corrected by the same 0.975 "
                 "factor, so their ratio is firmer than either absolute value.",
                 "cylinder diameter on the wheel's face",
                 [EVIDENCE, "wheel-zone"], 0.75)],
        surface(0.55, 0.06, 0.0, "matte plastic with a slightly polished crown",
                "a thin ring of occlusion at the cap's root", "none",
                "Shares its material with the top button."),
        [EVIDENCE, "wheel-zone"],
        importance=0.4, confidence=0.7, parent=f"vacuum-wheel-{side}", fidelity="blockout",
        seams=[{"id": f"hub-{side}-wheel-seam", "with": f"vacuum-wheel-{side}",
                "overlap": SEAM_FLOOR,
                "notes": f"The cap is {HUB_THICK} thick and sunk {SEAM_FLOOR} into the tyre's "
                         f"outer face, leaving {HUB_PROUD} proud. Same fix as the top button, "
                         "for the same reason."}],
    )
    node["attachment"] = joint(
        f"vacuum-wheel-{side}", "hub-face", "seated-on-face",
        (0.0, round(-HUB_THICK / 2, 4), 0.0), (0.0, round(HUB_THICK / 2, 4), 0.0),
        SEAM_FLOOR, HUBCAP_RADIUS,
        "The cap's axis through the wheel's outer face.")
    return node


NUB = component(
    "vacuum-nub", "Axle nub", "meso", "trim", "lathe", "wheel-coral",
    "continuous-sculpt",
    "A small coral bump on the shell above the right wheel. The reference shows exactly one, "
    "and it is what ties the wheel's colour up into the body instead of leaving the wheel as "
    "an unrelated disc.",
    colours(WHEEL_CORAL),
    descriptor(f"dome of base width {round(NUB_DIAMETER * 0.96, 4)} revolved about Y on the "
               "shell's outward radial",
               "rolled", 0.01, 14,
               uv="LatheGeometry cylindrical UVs",
               normals="smooth vertex normals from the revolved profile"),
    xform(position=to_body(body_radius_at(0.34) - 0.01, 0.34, WHEEL_Z + 0.02),
          rotation=radial_rotation(0.0), scale=(1.0, 1.0, 1.0)),
    dims(NUB_DIAMETER, round(NUB_DIAMETER * 0.56, 4), NUB_DIAMETER, 0.5),
    action("trim", "center", (0.0, 0.0, 0.0), (1, 0, 0), 0.5,
           collider={"type": "sphere", "offset": [0.0, 0.0, 0.0],
                     "scale": [NUB_DIAMETER, NUB_DIAMETER, NUB_DIAMETER], "isTrigger": False,
                     "notes": "Advisory."},
           fracture="body"),
    [feature("nub-dome",
             f"A dome {R_NUB} of the canister's diameter across, standing on the flank above "
             "the wheel. ONE, not two: the reference shows a single nub and the prop is "
             "mirrored only in its wheels, which is recorded in assumptions.",
             "lathe dome on the body's outward radial",
             [EVIDENCE, "wheel-zone"], 0.55)],
    surface(0.62, 0.07, 0.0, "matte plastic matching the wheel",
            "a ring of occlusion where the dome meets the flank", "none",
            "The smallest coral field."),
    [EVIDENCE, "wheel-zone"],
    importance=0.3, confidence=0.55, parent="vacuum-body", fidelity="blockout",
    seams=[{"id": "nub-body-seam", "with": "vacuum-body", "overlap": 0.02,
            "notes": "The dome's base is sunk into the flank."}],
)
NUB["geometryDescriptor"]["latheProfile"] = {
    "points": NUB_PROFILE, "segments": 14, "phiStart": 0.0, "phiLength": round(math.tau, 6),
}

COMPONENTS = [BODY, BELT, COLLAR, BUTTON, HANDLE, HOSE, NOZZLE, NOZZLE_BOSS, CUFF,
              wheel("right", 1.0), wheel("left", -1.0), hub("right", 1.0), hub("left", -1.0),
              NUB]
ALL_REFS = [c["id"] for c in COMPONENTS]
MACRO_REFS = [c["id"] for c in COMPONENTS if c["level"] == "macro"]

# ---------------------------------------------------------------------------
# repetition system
#
# DECLARED, MEASURED AND NOT BUILT AT BLOCKOUT, which is stated here rather than discovered
# in a render. generate_threejs_factory's repetition emitter places every instance by
# `radius * 0.5` around an axis - it can only do RADIAL arrays. A corrugation swept along a
# curve is not one, so the emitter cannot build this system at any level and no amount of
# spec authoring will make it. The system is declared because the pitch is measured and the
# count follows from it, and it is pinned at micro level so the passes this spec has actually
# earned do not emit it. Delivering it needs a refine_props.py edit that walks the tube path,
# and that is form-refinement work.
# ---------------------------------------------------------------------------
REPETITION_SYSTEMS = [{
    "id": "hose-corrugation",
    "name": "Hose corrugation",
    "level": "micro",
    "parent": "vacuum-hose",
    "count": HOSE_RIB_COUNT,
    "primitive": "torus",
    "material": "hose-navy",
    "instanceScale": [round(HOSE_TUBE_R * 2.3, 4), round(HOSE_TUBE_R * 2.3, 4),
                      round(HOSE_PITCH * 0.55, 4)],
    "placement": {"mode": "along-path", "axis": [0.0, 0.0, 1.0], "radius": 0.0,
                  "startAngleDeg": 0.0,
                  "pathRef": "vacuum-hose/geometryDescriptor.tubePath"},
    "notes": f"{HOSE_RIB_COUNT} ribs at pitch {HOSE_PITCH}, which is {R_HOSE_PITCH} of the "
             "canister's diameter. The pitch is measured on three independently chosen "
             "locally-straight runs of the reference hose, smoothed AT RIB SCALE: an earlier "
             "pass smoothed at pixel scale and returned a 5 px pitch that was image noise, "
             "with the true ribs showing only as 21-28 px outliers. The count is derived from "
             "the pitch and the authored centreline rather than counted off the projection, "
             "which foreshortens the loop's far limb. `along-path` is NOT a placement mode the "
             "generator implements; this is a declaration of what must be built, not a "
             "buildable instruction, and the level pins it out of every pass this spec has "
             "earned. TWO FURTHER LIMITS, confirmed from the generator's source rather than "
             "inferred: it composes every instance matrix about the PARENT NODE'S ORIGIN and "
             "ignores sockets entirely, and it places each instance at radius * 0.5, so a ring "
             "must be authored at twice its radius. Whoever builds this corrugation needs all "
             "three facts, because the parent choice alone can put a ring on the floor while "
             "every number in the spec still reads correct.",
    "evidenceRefs": [EVIDENCE, "hose-zone"],
    "confidence": 0.75,
}]

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
MATERIAL_IDS = {m["id"] for m in MATERIALS}
DETAILS = [
    detail("body-drum", "body", "contour",
           f"The shell reaches {RADIUS} at y {WIDEST_Y} and rolls in both above and below, to "
           f"{TOP_R} at the top face and {BOTTOM_R} at the floor.",
           "vacuum-body/body-widest-band",
           "Lathe profile from a two-flank silhouette row scan; the maximum is a band from "
           "0.535 to 0.720 of the height, not a point.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("body-overhang", "body", "contour",
           f"The shell overhangs its own footprint by {round(RADIUS - BOTTOM_R, 4)} all round, "
           "which is the space the floor head parks in.",
           "vacuum-body/body-roll-under",
           "Lathe profile roll-under, fitted from the lower silhouette.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("top-face-dome", "body", "contour",
           f"The top face is {R_TOP_FACE} of the maximum radius, a domed lid rather than a "
           "full-width cap.",
           "vacuum-body/body-top-face",
           "Lathe profile at the top, fitted as a horizontal circle's upper arc.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("waist-belt", "body", "seam",
           f"A navy band {BELT_BAND} tall wraps the shell at y {BELT_Y}, standing "
           f"{BELT_PROUD} proud.",
           "vacuum-belt/belt-band",
           "Lathe band at a radius above the shell's own.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("hose-collar", "collar", "contour",
           f"A navy boss {COLLAR_DIAMETER} across stands off the front-left flank at "
           f"{round(math.degrees(COLLAR_ANGLE), 1)} degrees.",
           "vacuum-collar/collar-boss",
           "Cylinder on the body's outward radial.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("hose-slack", "hose", "contour",
           f"The hose runs {HOSE_LENGTH} of centreline between endpoints "
           f"{round(math.dist(HOSE_PATH[0], HOSE_PATH[-1]), 4)} apart, arcing up and forward "
           "clear of the shell.",
           "vacuum-hose/hose-curve",
           "Catmull-Rom centreline swept with a round section.",
           EVIDENCE, 0.6, MATERIAL_IDS),
    detail("hose-ribs", "hose", "ridge",
           f"{HOSE_RIB_COUNT} corrugation ribs at pitch {HOSE_PITCH}.",
           "vacuum-hose/hose-corrugation",
           "Repetition system hose-corrugation, declared and not built at blockout.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("hose-groove-shadow", "hose", "stain",
           "Every rib valley holds shadow the crown does not, which is what makes the hose "
           "read as ribbed at distance.",
           "hose-navy/hose-groove-occlusion",
           "Material local override with an AO boost in the valleys.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("nozzle-slab", "nozzle", "contour",
           f"The head is {NOZZLE_LENGTH} by {NOZZLE_WIDTH} by {NOZZLE_THICK}, with corners "
           "rounded at 0.05.",
           "vacuum-nozzle/nozzle-plan",
           "Chamfered rectangle extruded along +Y.",
           EVIDENCE, 0.65, MATERIAL_IDS),
    detail("nozzle-boss", "nozzle", "contour",
           f"A cream dome rises {BOSS_RISE} off the head's top face where the hose lands.",
           "vacuum-nozzle-boss/boss-dome",
           "Lathe dome on the head's top face.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("suction-slot", "nozzle", "seam",
           "A long recessed slot runs the head's front face, the only hard dark line on the "
           "cream.",
           "nozzle-cream/nozzle-slot-occlusion",
           "Material local override with an AO boost along the slot.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("mint-cuff", "nozzle", "contour",
           f"A mint cuff {CUFF_DIAMETER} across steps out from the hose where it meets the "
           "boss.",
           "vacuum-cuff/cuff-band",
           "Cylinder over the hose's section.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("carry-handle", "handle", "contour",
           f"A round mint bar spans {HANDLE_SPAN} across the top face and rises "
           f"{HANDLE_RISE}.",
           "vacuum-handle/handle-arch",
           "Round section swept along a super-elliptical arch.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("fat-wheel", "wheel", "contour",
           f"A coral wheel {WHEEL_DIAMETER} across and {round(WHEEL_HALF_THICK * 2, 4)} thick "
           "stands proud on each flank.",
           "vacuum-wheel-right/wheel-proportion",
           "Lathe disc laid on a horizontal axle.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("hub-cap", "wheel", "contour",
           f"A yellow cap {round(HUBCAP_RADIUS * 2, 4)} across sits on each wheel's outer "
           "face, 0.59 of its own wheel.",
           "vacuum-hub-right/hub-cap",
           "Cylinder on the wheel's face.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("axle-nub", "wheel", "contour",
           f"A coral dome {NUB_DIAMETER} across sits on the shell above the right wheel.",
           "vacuum-nub/nub-dome",
           "Lathe dome on the body's outward radial.",
           EVIDENCE, 0.55, MATERIAL_IDS),
    detail("top-button", "body", "contour",
           f"A yellow cap {BUTTON_DIAMETER} across sits forward and left of the top face's "
           "centre.",
           "vacuum-button/button-cap",
           "Cylinder on the top face.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("button-side-wall", "body", "gloss",
           "The button is a moulded cap with a rounded side wall, adding about 15 px of image "
           "height beyond a flat circle at this pitch.",
           "accent-yellow/button-edge-catch",
           "Material local override on the cap's side wall.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("body-underside", "body", "stain",
           "The shell's underside loses the key entirely and is the darkest lilac on the prop.",
           "body-lilac/body-underside-occlusion",
           "Material local override with an AO boost below the widest band.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("tyre-rim-light", "wheel", "gloss",
           "The tyre's rolled edge catches a bright continuous rim, which is what separates "
           "the wheel from the body behind it.",
           "wheel-coral/tyre-crown-sheen",
           "Material local override lowering roughness on the outer roll.",
           EVIDENCE, 0.7, MATERIAL_IDS),
]
DETAIL_INVENTORY = detail_inventory(
    DETAILS, 10,
    "channel-dominance albedo separation verified against evidence/masks.png, then a "
    "connected-component census per albedo that splits the parts sharing one - the wheel from "
    "its nub, the handle from the cuff, the belt from the hose from the collar - followed by "
    "horizontal-extent readings and two horizontal-circle arc fits for the body profile.")

# ---------------------------------------------------------------------------
# assembly
#
# THE BLOCKOUT INCLUDES THE HOSE AND THE HEAD, not just the canister. The blockout's own
# acceptance is that macro proportions match the measured reference bounding box, and a
# quarter of that box is hose and head; a blockout of the drum alone would pass its silhouette
# check while being the wrong object. The wheels are in for the same reason - they set the
# prop's full width and are what makes X the binding plan axis.
# ---------------------------------------------------------------------------
PASSES = build_passes(
    MACRO_REFS + ["vacuum-collar"],
    ALL_REFS,
    "Match the macro silhouette: a squat revolved drum, two fat wheels setting the width, a "
    "curved hose leaving the front-left flank, and a flat head parked under the body's "
    f"forward overhang, all inside {BOX_WIDTH} by {BOX_HEIGHT} by {BOX_DEPTH}.",
    "Build shell, belt, collar, button, handle, hose, head, boss, cuff, both wheels, both hub "
    "caps and the nub as separate named parts with recorded seams.",
    "Deliver the shell's roll-under and domed top as real profile curvature, the hose as a "
    "swept curve rather than a rod, and the handle as an arch that leaves its feet steeply.",
    "Match the six-albedo palette as measured, with the navy reading clearly darkest and the "
    "cream clearly palest.",
    ["The hose reads as a curved corrugated tube, not as a straight rod between two points.",
     "The shell's widest band sits above its middle rather than at its rim or its base.",
     "The head reads as parked under the body's overhang rather than floating in front of it.",
     "The handle's crown, not the shell, is the prop's highest point."],
    has_repetition=True)

FEATURE_REVIEW_TARGETS = [
    {"id": "hose-is-a-curve", "name": "The hose is a swept curve",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["vacuum-hose", "vacuum-collar"], "evidenceRefs": [EVIDENCE, "hose-zone"],
     "failureModes": ["hose ships as a straight cylinder between its endpoints",
                      "hose limb buried inside the shell",
                      "hose so short it reads as a strut"]},
    {"id": "squat-drum", "name": "The shell is a squat rolled drum",
     "tier": "critical", "passIds": ["blockout", "structural-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["vacuum-body"], "evidenceRefs": [EVIDENCE, "body-zone"],
     "failureModes": ["shell reads as a cylinder with square caps",
                      "widest band at the base or the rim rather than at 0.559 of the height",
                      "shell shipped at the retracted H/D of 0.459 and reading as a pancake"]},
    {"id": "head-parks-under", "name": "The head parks under the body's overhang",
     "tier": "critical", "passIds": ["blockout", "structural-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["vacuum-nozzle", "vacuum-body"], "evidenceRefs": [EVIDENCE, "call-site"],
     "failureModes": ["head intersects the shell's floor contact",
                      "head pushed past the collider's front face",
                      "head floating clear in front, which is the pose that does not fit"]},
    {"id": "wheels-set-the-width", "name": "Two wheels, mounted proud, setting the plan width",
     "tier": "critical", "passIds": ["blockout", "structural-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["vacuum-wheel-right", "vacuum-wheel-left"],
     "evidenceRefs": [EVIDENCE, "wheel-zone"],
     "failureModes": ["one wheel only, so the prop reads broken from its far side",
                      "wheels sunk into the flank so they read as painted discs",
                      "wheels past the collider's side faces"]},
    {"id": "six-albedo-read", "name": "Six albedos, navy darkest and cream palest",
     "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["vacuum-body", "vacuum-hose", "vacuum-nozzle", "vacuum-wheel-right"],
     "evidenceRefs": [EVIDENCE],
     "failureModes": ["navy rendering near-black rather than at its measured (55,76,114)",
                      "cream and yellow collapsing into one warm value",
                      "lilac corrected to PALETTE.purple and losing the pastel scheme"]},
    # SPLIT BY RULING, 2026-07-29. This was ONE target, "Fills the plan without overhanging
    # the collider", critical and mustPass at 0.9, listing "plan much smaller than the
    # collider" among its failure modes. Option A then made that shortfall a DELIBERATE
    # trade - twelve points of plan width bought a hose that clears the shell and reads as a
    # hose - so the target was failing the prop for doing what it had been told to do.
    #
    # The two halves are different KINDS of claim and only one is a safety property.
    # CONTAINMENT - no part outside the box - stays a hard critical gate at its original bar,
    # because geometry outside the collider is the swinging hammer's bug and no ruling can
    # make it acceptable. FILL becomes a recorded outcome: still measured, still reported,
    # still feeding the collider-trim decision queued to the user, but scored against what
    # the ruling determined rather than against a bar the ruling superseded.
    #
    # The split was proposed, refused as a self-serving edit, and then explicitly approved
    # before being made. That order matters: a mustPass gate is not something an author
    # amends to let their own work through.
    {"id": "envelope-containment", "name": "No part outside the collider",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "optimization-pass"],
     "minimumScore": 0.9, "mustPass": True,
     "componentRefs": ALL_REFS, "evidenceRefs": ["call-site"],
     "failureModes": [f"any part past {BOX_WIDTH} wide, {BOX_HEIGHT} tall or {BOX_DEPTH} deep",
                      "the shell not seated on the deck at y = 0",
                      "a part that measures inside its own node but outside the box once its "
                      "parent's transform is applied"]},
    {"id": "envelope-fill", "name": "Plan and height fill are the ruled values, and recorded",
     "tier": "important", "passIds": ["blockout", "structural-pass", "optimization-pass"],
     "minimumScore": 0.7, "mustPass": False,
     "componentRefs": ALL_REFS, "evidenceRefs": ["call-site"],
     "notes": "Split from envelope-fit by ruling on 2026-07-29. The prop fills its plan to "
              "the extent Option A determined and its height to the extent a canister "
              "vacuum's measured proportion allows. Neither is a defect to tune away; both "
              "are inputs to the collider-trim decision queued to the user, and the risks "
              "section carries the numbers.",
     "failureModes": ["the fill changing without a ruling that says why",
                      "the shortfall going unrecorded, so the collider question loses its "
                      "evidence",
                      "the fill being quietly improved by stretching a measured proportion"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "reference three-quarter elevated", "path": SOURCE_IMAGE,
     "covers": ["overall silhouette", "part inventory", "six albedos"], "confidence": 0.9},
    {"id": "body-zone", "view": "reference crop, canister shell and top face", "path": SOURCE_IMAGE,
     "covers": ["body profile", "top face radius", "belt", "button"], "confidence": 0.75},
    {"id": "hose-zone", "view": "reference crop, the hose run", "path": SOURCE_IMAGE,
     "covers": ["tube diameter", "rib pitch", "hose curvature"], "confidence": 0.8},
    {"id": "nozzle-zone", "view": "reference crop, floor head", "path": SOURCE_IMAGE,
     "covers": ["head plan", "slab thickness", "boss", "cuff"], "confidence": 0.7},
    {"id": "wheel-zone", "view": "reference crop, wheel, hub cap and nub", "path": SOURCE_IMAGE,
     "covers": ["wheel diameter", "hub cap", "standoff", "nub"], "confidence": 0.7},
    {"id": "handle-zone", "view": "reference crop, carry handle", "path": SOURCE_IMAGE,
     "covers": ["arch span", "arch rise", "bar section"], "confidence": 0.75},
    {"id": "collar-zone", "view": "reference crop, hose collar", "path": SOURCE_IMAGE,
     "covers": ["boss diameter", "boss placement on the flank"], "confidence": 0.7},
    {"id": "call-site", "view": "not an image: TrapRenderer.tsx vacuum",
     "path": str(PROJECT / "components" / "game" / "TrapRenderer.tsx"),
     "covers": ["CuboidCollider args=[0.5, 0.55, 0.45] at the [0, -0.55, 0] mount"],
     "confidence": 1.0},
]

SPEC = assemble(
    target_name="Apartment Canister Vacuum",
    target_id="apartment-vacuum",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": False,
        "solveMethod": "SINGLE-SOURCED AND NOT CONFIRMED. Pitch comes from ONE measurement: "
                       "the ellipse axis ratio of the yellow top button, a circle in a "
                       "horizontal plane, fitted by second moments, giving 28.1 +/- 3. The "
                       "canister 'cross-check' that once accompanied it was one equation in "
                       "two unknowns and is a plausibility check, not an independent solve. "
                       "The contact-shadow route FAILED diagnostically: the shadow measures "
                       "855 px across against a 646 px canister at axis ratio 0.1854, flatter "
                       "than that circle can project at ANY pitch, so it carries a raked key "
                       "light's direction inseparably from the ground plane's foreshortening. "
                       "That failure is kept because it tells the lighting pass the key is low "
                       "and off to one side. The named honest second solve, if pitch precision "
                       "is ever needed, is a CONIC FIT to the waist belt's front arc - a "
                       "moment fit will not do, because only the front arc is visible, and the "
                       "wheel hub is degenerate, mixing pitch with the wheel's own azimuth. "
                       "YAW IS NOT SOLVED and is not needed: every reading this spec uses is "
                       "either a horizontal extent, which yaw does not affect, or a "
                       "horizontal-circle arc fit, which returns radius and height together.",
        "fovDegrees": 16.0,
        "aspect": 1.0,
        "orientation": {"yaw": 32.0, "pitch": -28.1, "roll": 0.0},
        "targetHint": [0.0, round(HEIGHT * 0.5, 3), 0.0],
        "note": "Pitch 28.1 +/- 3 degrees; the button reads as a disc but is a moulded cap "
                "with a rounded edge, so its silhouette is marginally wider than the true "
                "circle and the recovered pitch is a slight underestimate. Yaw is a harness "
                "seed only. The camera is ORTHOGRAPHIC in every derivation here and the "
                "reference is a perspective render, which is the dominant error in the "
                "height solve and is recorded in risks.",
    },
    measurement_basis={
        "pixelsPerWorldUnit": round(CANISTER_PX / DIAMETER, 1),
        "referenceBBox": {"x0": 167, "y0": 160, "x1": 1044, "y1": 1135,
                          "imageSize": [1254, 1254],
                          "note": "The CLEAN silhouette, 877 x 975, measured off the union of "
                                  "the part masks. An earlier box of 910 x 991 came from the "
                                  "object mask, which swallows the contact shadow; the same "
                                  "contamination reported the nozzle's underside at y 1151, "
                                  "which is its shadow, against the true 1135."},
        "scaleAnchor": f"the canister's {CANISTER_PX} px image width, which is a TRUE diameter "
                       "because the canister is a vertical-axis revolve and the camera has no "
                       "roll. Every ratio in this spec is against it. The silhouette's "
                       "vertical span is NOT used as a scale: it mixes elevation with depth, "
                       "which produced two retracted derivations recorded in "
                       "assessment-seed.json.",
        "derivations": [
            "Six albedos separated by channel dominance with a 3-unit antialiasing guard, each "
            "pixel claimed once, most saturated first, every mask verified against "
            "evidence/masks.png.",
            "A connected-component census per albedo, opened by 5 px first, splits the parts "
            "that share one: the wheel from its nub, the handle from the cuff, the belt from "
            "the hose from the collar.",
            f"CORRECTED: the canister's height. The recorded H/D = 0.459 assumed both cap "
            f"radii equal the maximum radius. Measured, the top face is {R_TOP_FACE} of it and "
            f"the floor contact {R_BOTTOM_CONTACT}, giving H/D = 0.617 by the same silhouette "
            f"equation and 0.664 by fitting both rim arcs. ADOPTED {R_HEIGHT}. The bottom fit "
            "predicts the silhouette's lowest pixel to 1.1 px; the button's plan position "
            "rejects the retracted value outright.",
            "The floor head's plan comes from its floor-contact contour un-squashed by "
            "1/sin(pitch). That contour lies in the ground plane everywhere; the head's top "
            "edge does not, because the raised boss lifts it out, and fitting to the top edge "
            "returned a plan 30 percent wrong.",
            f"The wheel's diameter is its image vertical extent divided by 0.975. A circle in "
            f"a vertical plane projects its true diameter vertically to within 2.5 percent at "
            f"any plausible axle bearing, while its horizontal extent depends on that bearing "
            f"entirely, so the vertical reading is the safe one.",
            f"The hose's rib pitch is {R_HOSE_PITCH} of the canister's diameter, from three "
            "independently chosen locally-straight runs smoothed AT RIB SCALE. An earlier pass "
            "smoothed at pixel scale and returned a 5 px pitch that was image noise.",
        ],
        "evidenceFiles": [
            "assets/reference/vacuum/evidence/part-measurement.json",
            "assets/reference/vacuum/evidence/profile-measurement.json",
            "assets/reference/vacuum/evidence/masks.png",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 1,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 3,
            "interaction_fit": 1},
    pre_spec={
        "objectClass": {
            "primaryType": "cylinder-body canister vacuum with a corrugated hose running to a "
                           "floor head",
            "primaryDomain": "object",
            "formLanguage": ["smooth-organic", "stylized-toy", "rolled-moulded-edge"],
            "structureKind": ["revolved-shell", "swept-tube", "stacked-assembly"],
            "motionPotential": ["whole-body-chase", "hose-flex", "wheel-spin"],
            "materialFamilies": ["matte-plastic-lilac", "matte-plastic-navy",
                                 "matte-plastic-cream"],
            "notes": "The identity is the two-part read: a fat lilac drum and the navy hose "
                     "that leaves it and ends in a cream floor head. The hose is the part that "
                     "says vacuum rather than kettle, and it is the part most likely to be "
                     "lost - a tube with a parent fails --strict-quality without an "
                     "attachment, and the generator then swaps it for a straight cylinder "
                     "between its endpoints.",
        },
        "complexity": {
            "tier": "complex",
            "scores": {"silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 3,
                       "repetitionDensity": 2, "materialLayerCount": 3, "localDetailDensity": 2,
                       "occlusionRisk": 1, "actionReadinessNeed": 2},
            "estimatedCounts": {"macroComponents": 5, "mesoComponents": 9,
                                "microFeatureGroups": 2, "materialLayers": 6,
                                "repetitionSystems": 1},
            "reasoning": [
                "Fourteen parts across six measured albedos, every one separately visible from "
                "the reference angle.",
                "Occlusion risk is LOW, the opposite of the floor fan: nothing is read through "
                "anything else.",
                "One repetition system only, the hose corrugation, and it is a swept rib along "
                "a curve rather than a radial array - which is why the generator cannot build "
                "it.",
                "The prop chases the player, so the root moves as a unit; the hose is the only "
                "part with an argument for its own deformation channel.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "complex",
            "minimumComponentLevels": ["macro", "meso"],
            "needsRepetitionSystems": True,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": True,
            "rationale": "Six albedos on one material response, a swept tube the validator "
                         "treats as an attachment primitive, and a silhouette where a quarter "
                         "of the footprint is a curve that has to survive generation.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "The reference camera was unsolved, so no vertical image measurement "
                        "converted to a world dimension.",
             "resolution": "PARTIALLY resolved and honestly labelled. Pitch is 28.1 +/- 3 from "
                           "the top button's ellipse, SINGLE-SOURCED and not confirmed; the "
                           "shadow route failed and the canister check was not independent. "
                           "The spec is built so this matters as little as possible: the "
                           "pose verdict needs no camera at all, and every part ratio is a "
                           "horizontal extent, which pitch does not affect. Only the canister "
                           "height depends on it, and its bracket is widened accordingly.",
             "confidence": 0.5},
            {"unknown": "Whether the reference's hose and head sprawl fits the 0.90 collider "
                        "depth.",
             "resolution": "IT DOES NOT, and the verdict is measured. True extents are "
                           "1.67 : 1 : 2.58 against a collider of 0.909 : 1 : 0.818, robust "
                           "across the camera's tolerance. The pose is abandoned and every "
                           "part's proportions kept - see assumptions and risks.",
             "confidence": 0.85},
            {"unknown": "The canister's height, recorded at H/D = 0.459.",
             "resolution": "CORRECTED to 0.63. The recorded value assumed both cap radii equal "
                           "the maximum radius; the measured top face is 0.749 of it and the "
                           "floor contact 0.651. Three routes agree on 0.617 to 0.664 and one "
                           "of them rejects 0.459 outright.",
             "confidence": 0.7},
            {"unknown": "Whether a second wheel exists on the hidden left side.",
             "resolution": "RULED, not measured: two wheels. The reference neither shows nor "
                           "excludes one - a mirrored wheel would sit behind the body and "
                           "project about 9 px past the shell's left silhouette, which is "
                           "inside the noise on that edge. Two is what a chase-camera prop "
                           "needs, because a single wheel reads as broken from the far side.",
             "confidence": 0.6},
            {"unknown": "The hose centreline in 3D, which the reference shows only in "
                        "projection.",
             "resolution": "Authored rather than measured. The tube's SECTION and rib PITCH are "
                           "measured; the route is designed to the envelope, arcing up over "
                           "the body's forward shoulder because height is the only budget this "
                           "prop has spare.",
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
        "complex",
        ["The rendered model matches the reference's part inventory, per-part proportions, "
         "component hierarchy, material response and most recognisable local features.",
         "The hose reads as a curved corrugated tube from the chase camera in motion, not as a "
         "straight rod.",
         f"Every part stays inside {BOX_WIDTH} by {BOX_HEIGHT} by {BOX_DEPTH} and the prop "
         "fills the PLAN of the collider that hits the player.",
         "The six albedos stay six: navy clearly darkest, cream clearly palest, and cream and "
         "yellow distinguishable from each other."],
        {"macroComponents": 5, "mesoComponents": 9, "microFeatureGroups": 2,
         "materialLayers": 6, "repetitionSystems": 1, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Every part's size is stated as a measured ratio of the canister's "
                           "true diameter, not of the silhouette's vertical span.",
                           "The deviation from the reference POSE is stated once, as a pose "
                           "change, rather than absorbed into part sizes."],
                          [EVIDENCE],
                          ["prop reads as a kettle because the hose was lost",
                           "shell shipped as a pancake at the retracted H/D",
                           "prop much narrower than its collider in plan"]),
            feature_group("primary-structure", "Primary structure and hierarchy",
                          ["Shell, belt, collar, button, handle, hose, head, boss, cuff, both "
                           "wheels, both hub caps and the nub are separate named parts.",
                           "Every part hangs off the shell or off a part that does, so the "
                           "chasing root carries the whole assembly.",
                           "Every contact records a seam overlap of at least 0.02 world units.",
                           "No node carrying children has a non-uniform scale."],
                          [EVIDENCE, "hose-zone"],
                          ["head parented to the root so it slides away from the body",
                           "hub caps parented to the body so they do not spin with the wheel",
                           "a pivot scale leaking from a parent into its children"]),
            feature_group("attachment-joint-correctness", "Contact and joint correctness",
                          ["The hose's first sample sits inside the collar and its last inside "
                           "the cuff.",
                           "Both wheels lap the shell's flank rather than floating off it.",
                           "The handle's feet are buried below the top face.",
                           "The head's rear edge meets the body's floor contact without "
                           "intersecting it."],
                          [EVIDENCE, "collar-zone"],
                          ["hose floats out of its collar",
                           "hose limb buried inside the shell",
                           "head intersecting the shell"]),
            feature_group("surface-material-response", "Surface material response",
                          ["Albedo zones, roughness, normal intent and local overrides are "
                           "specified per material and tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are independent fields.",
                           "The hose's rib valleys carry an AO response the crowns do not."],
                          [EVIDENCE, "hose-zone"],
                          ["one roughness across all six albedos",
                           "no occlusion gradient under the shell's overhang"]),
            feature_group("reference-lookdev", "Reference colour, material and lighting response",
                          ["Each albedo records its measured value and states whether it was "
                           "corrected.",
                           "Lighting names key, fill, rim or environment, exposure, tone "
                           "mapping and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders prove the shell's "
                           "roll-under survives relighting."],
                          [EVIDENCE],
                          ["navy rendering near-black rather than at (55,76,114)",
                           "lilac drifting to PALETTE.purple",
                           "lighting evenly ambient so the drum reads flat"]),
        ],
        ["silhouette and negative-space delta", "per-part proportion delta",
         "hose curvature delta", "component hierarchy depth delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.78,
        "mustMatch": ["a curved corrugated navy hose leaving the shell's front-left flank",
                      "a squat lilac drum widest above its middle",
                      "a flat cream head with a raised hose boss",
                      "fat coral wheels with yellow hub caps",
                      "a mint arch handle as the prop's highest point"],
        "niceToHave": ["the reference's hose ROUTE, which does not fit the collider",
                       "the corrugation ribs, which the generator's radial instancer cannot "
                       "place along a curve",
                       "the suction slot in the head's front face"],
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
        "Ambient dominance: a soft studio render on a (219,218,218) plate. The lilac runs from "
        "a lit crown to a shaded underside without a hard terminator anywhere, which a bright "
        "neutral hemisphere plus a gentle key reproduces.",
        "Key light: warm-neutral directional at about 1.1 from high and camera left, which is "
        "where the top face's sheen and the handle's crown highlight both sit.",
        "Rim and environment light: weak neutral back light at about 0.3 so the shell's "
        "underside and the hose's far limb do not crush to black. No environment map: the "
        "reference shows no reflection on any of the six materials.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. "
        "The navy at (55,76,114) is the value most at risk here - it is the darkest albedo on "
        "the prop and the one that will read near-black if exposure is pulled down.",
        "Contact shadow: the reference floats with a soft contact shadow under the shell and a "
        "second under the head. The review render has no ground plane so the silhouette mask "
        "stays clean.",
    ],
    action_readiness=action_readiness(
        "vacuum-body",
        {"rootMotion": "sculptRuntime.nodes['vacuum-body'] carries translation, rotation and "
                       "scale; every other part is its child or a child of one, so the "
                       "chasing trap moves the whole assembly as one.",
         "wheelSpin": "sculptRuntime.nodes['vacuum-wheel-right'] and 'vacuum-wheel-left' turn "
                      "about X and carry their hub caps with them.",
         "hoseFlex": "sculptRuntime.nodes['vacuum-hose'] declares a bend channel. Nothing "
                     "drives it yet; the channel is declared because the intent is real and "
                     "the rig should not have to be rebuilt to add it.",
         "sockets": "hose-port, top-face, axle-right, axle-left on the shell; hose-root and "
                    "hose-tip on the hose; boss-seat on the head; hub-face on each wheel."},
        "fractureGroup names the part family: body, trim, hose, head, wheel.",
        "Debris inherits the fractured part's own material rather than a shared debris "
        "material, because six albedos is the prop's identity."),
    assumptions=[
        f"The prop is sized to the PLAN of the collider that hits the player: X is "
        f"{round(WHEEL_OUTER_X * 2 / BOX_WIDTH * 100, 1)} percent used and Z "
        f"{round((NOZZLE_FRONT_Z + BOX_DEPTH / 2) / BOX_DEPTH * 100, 1)} percent. Which axis "
        f"binds was solved rather than assumed: the two candidate limits on the canister "
        f"diameter are {D_LIMIT_X} from the wheels in X and {D_LIMIT_Z} from the body and head "
        f"in Z, so Z binds and the diameter is {DIAMETER}.",
        "THE REFERENCE POSE IS ABANDONED AND EVERY PART'S PROPORTIONS ARE KEPT. This is the "
        "authored deviation, and it is forced: the reference pose is 2.58 deep for every 1 "
        "tall against a collider that allows 0.818, an overrun robust across the camera's "
        "tolerance. The hose is coiled tight and the head parks under the body's overhang.",
        f"The canister's height is {R_HEIGHT} of its diameter, CORRECTED from the recorded "
        "0.459. The correction is derived in measure_vacuum_profile.py and summarised in "
        "measurementBasis.",
        "TWO WHEELS, ruled rather than measured. A mirrored wheel would sit behind the body "
        "and project about 9 px past the shell's left silhouette, so the reference neither "
        "shows nor excludes it; a single wheel reads as broken from a chase camera's far side.",
        "ONE NUB, as the reference shows, so the prop is mirrored in its wheels but not in "
        "that detail.",
        "The hose's ROUTE is authored, not measured. Its section and rib pitch are measured; "
        "one view cannot give a curve's depth.",
        "Every part's DEPTH is authored. One three-quarter view cannot give it and the "
        "collider's 0.90 is the only constraint that exists.",
        "The six albedos ship as measured rather than corrected to PALETTE, which departs from "
        "the toilet and the spring. Those two had near-misses for a PALETTE entry; this prop's "
        "pastels have no analogue there.",
        "One world unit is about 12 cm, making the modelled vacuum about 8 cm tall.",
    ],
    coordinate_frame={
        "front": "+Z, the direction the floor head parks in; the shell's rear is at -Z",
        "up": "+Y, with the shell's floor contact at y = 0",
        "right": "+X, where the nub sits above the right wheel",
        "scaleReference": f"canister diameter = {DIAMETER} world units; "
                          f"{round(CANISTER_PX / DIAMETER)} reference pixels per world unit "
                          "horizontally",
    },
    silhouette={
        "boundingShape": f"{round(WHEEL_OUTER_X * 2, 3)} by {PROP_HEIGHT} by "
                         f"{round(NOZZLE_FRONT_Z + BOX_DEPTH / 2, 3)}: a squat revolved drum "
                         "between two fat wheels, a handle arching over it, a hose curving up "
                         "and forward off its front-left flank, and a flat head under its "
                         "forward overhang",
        "aspectRatios": [
            {"id": "canister-height-to-diameter", "value": R_HEIGHT,
             "notes": "corrected from the recorded 0.459; the single most consequential number "
                      "on this prop"},
            {"id": "prop-height-to-collider-height",
             "value": round(PROP_HEIGHT / BOX_HEIGHT, 3),
             "notes": "the prop uses this much of its height budget. The remainder is empty "
                      "hitbox and is recorded as a risk, not hidden."},
            {"id": "plan-width-used", "value": round(WHEEL_OUTER_X * 2 / BOX_WIDTH, 3),
             "notes": "set by the two wheels"},
            {"id": "plan-depth-used",
             "value": round((NOZZLE_FRONT_Z + BOX_DEPTH / 2) / BOX_DEPTH, 3),
             "notes": "set by the shell's rear and the head's front; this is the binding axis"},
            {"id": "hose-slack",
             "value": round(HOSE_LENGTH / math.dist(HOSE_PATH[0], HOSE_PATH[-1]), 3),
             "notes": "centreline length over the straight-line distance between its ends. "
                      "Below about 1.5 the hose starts reading as a strut."},
        ],
        "symmetry": "mirror symmetric about the X = 0 plane in its wheels and hub caps only; "
                    "the hose, collar, button, handle and nub all break it",
        "dominantCurves": ["the shell's roll-under", "the shell's domed top face",
                           "the hose's arc", "the handle's arch", "the tyre's rolled rim"],
        "negativeSpaces": ["the gap under the handle's arch",
                           "the space between the hose and the shell",
                           "the undercut beneath the shell's widest band"],
        "landmarks": [f"floor contact at y = 0", f"widest band at y = {WIDEST_Y}",
                      f"belt at y = {BELT_Y}", f"top face at y = {HEIGHT}",
                      f"handle crown at y = {HANDLE_CROWN_Y}"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "all fourteen parts at full sampling; 256px procedural maps"},
        {"tier": "mid", "distance": 12,
         "strategy": "halve the revolve to 12 sides, drop the nub and both hub caps, and cut "
                     "the hose to 6 radial segments"},
        {"tier": "far", "distance": 30,
         "strategy": "shell, hose, head and both wheels only; the belt, button, cuff and boss "
                     "stop reading"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 6000,
        "maxDrawCalls": 14,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "FOURTEEN DRAW CALLS IS ABOVE THE 8 THE SMALLER PROPS HOLD, and "
                              "that is stated rather than hidden. The generator emits one mesh "
                              "per component and this prop genuinely has fourteen parts; "
                              "sharing a material does not merge them. The cheapest real cut "
                              "is the nub and the two hub caps, which is what the mid LOD "
                              "takes. The hose dominates triangles at roughly 1500 of the "
                              "budget and its radial segment count is the lever: 8 is the "
                              "floor, because at 6 the tube's silhouette facets visibly where "
                              "it crosses in front of the shell.",
    },
    procedural_strategy=[
        "Block out the shell, hose, head, both wheels and the collar, then read the per-part "
        "world Box3 dump BEFORE looking at a render. A hose limb buried in the shell and a "
        "wheel floating off its flank are both invisible from the reference angle and obvious "
        "in the bounds.",
        f"Confirm the hose survived generation as a swept curve: its bounds should span about "
        f"{round(max(p[0] for p in HOSE_PATH) - min(p[0] for p in HOSE_PATH), 3)} in X, and a "
        "cylinder between its endpoints would span far less.",
        "Check the shell's widest band lands at 0.559 of its height rather than at its rim, "
        "which is what the corrected profile is for.",
        "Confirm nothing breaks the collider in plan; the clearance check in the author script "
        "already fails the build if the hose does.",
        "Deliver the shell's roll-under and domed top as profile curvature, not as a normal "
        "map: both change the silhouette.",
        "Ship the six albedos as measured and check the navy against its (55,76,114) rather "
        "than against how dark it looks.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['vacuum-body'] carries whole-object translation and rotation, "
        "which is what the chasing trap drives",
        "sculptRuntime.nodes['vacuum-wheel-right'] and 'vacuum-wheel-left' turn about X",
        "sculptRuntime.nodes['vacuum-hose'] declares a bend channel that nothing drives yet",
    ],
    destruction_anchors=["the head and its boss and cuff detach together",
                         "each wheel detaches with its hub cap",
                         "the shell and hose are not fractured"],
    risks=[
        "THE HOSE IS THE HIGHEST RISK ON THIS PROP AND THE FAILURE IS SILENT. "
        "validate_sculpt_spec puts `tube` in ATTACHMENT_PRIMITIVES, so a tube with a parent "
        "fails --strict-quality without an attachment; generate_threejs_factory then reads "
        "that attachment and replaces the geometry with a CylinderGeometry between its two "
        "endpoints, discarding the transform. The hose would ship as a straight navy rod and "
        "EVERY PIXEL GATE WOULD STILL PASS, because a rod between the same endpoints fills a "
        "similar silhouette from the reference angle. refine_props.py's geometryFromSpec guard "
        "is mandatory-anchored and fails generation loudly if it cannot apply; a unit test "
        "pins the sample count so a regenerated factory that drops the guard fails too.",
        f"FAIRNESS NOTE, AND IT IS ONE QUESTION RATHER THAN TWO. The prop stands "
        f"{PROP_HEIGHT} inside a {BOX_HEIGHT} collider and "
        f"{round(WHEEL_OUTER_X * 2, 3)} across a {BOX_WIDTH} one, so the box that kills the "
        f"player is about {round((1 - PROP_HEIGHT / BOX_HEIGHT) * 100)} percent empty in "
        f"height and {round((1 - WHEEL_OUTER_X * 2 / BOX_WIDTH) * 100)} percent thinner than "
        "its plan. The height gap is structural - a canister vacuum is a squat object and "
        "stretching it to 1.10 would destroy the measured H/D that is its identity - and the "
        "plan gap is the price of the ruling above, taken deliberately so the hose can clear "
        "the shell and read as a hose. Both are the toilet's named hazard: a hitbox larger "
        "than its prop kills a player who was never touched, and here a player judging "
        "clearance off the visible vacuum can clip a box that is not there. TOGETHER THEY "
        "STRENGTHEN THE CASE FOR A COLLIDER TRIM, which is queued as a user decision. The "
        "collider is tuned gameplay and is deliberately left untouched until that decision "
        "lands.",
        "THE CANISTER'S HEIGHT WAS CORRECTED, from a recorded H/D of 0.459 to 0.63, and the "
        "correction is load-bearing for every vertical number here. The recorded value read "
        "the silhouette's image height as one canister height plus one full-diameter cap "
        "ellipse, which holds only for a cylinder. Confidence 0.7, with a 0.617 to 0.664 "
        "bracket recorded rather than collapsed. THAT BRACKET IS NARROWER THAN THE TRUTH, "
        "because it holds the pitch fixed at a value that is single-sourced and unconfirmed: "
        "running the same silhouette equation across the pitch's own +/- 3 degrees moves H/D "
        "from 0.599 at 31 degrees to 0.638 at 25. The adopted 0.63 sits inside both bands, "
        "which is why it survives the camera's doubt - but a spec that needed this number to "
        "three decimals would have to solve the pitch again first, by the conic fit named in "
        "referenceCamera.",
        "EVERY HEIGHT DERIVATION ASSUMES AN ORTHOGRAPHIC CAMERA AND THE REFERENCE IS A "
        "PERSPECTIVE RENDER. The evidence for this is direct: the belt's left and right "
        "extreme meridians, which orthography puts on the same image row, sit 77 px apart, "
        "which is why the belt's arc could not be fitted and why its height carries +/- 0.04. "
        "Horizontal extents are unaffected, and this spec's ratios are horizontal wherever it "
        "had the choice.",
        "THE HOSE PASSES THROUGH ITSELF ONCE ON ITS DESCENT TO THE CUFF, AND IT SHIPS THAT "
        "WAY BY RULING. A swept tube self-intersects wherever its centreline's radius of "
        "curvature drops below its tube radius, and the shipped curve does that at "
        f"{' '.join(f'{s}-{e} at {round(r / HOSE_TUBE_R, 2)}x the tube radius' for s, e, r, _ in fold_report())}"
        ". It is NOT hidden by the cuff: the cuff's radius is "
        f"{round(CUFF_DIAMETER / 2, 4)} against the tube's {HOSE_TUBE_R}, too little to cover a "
        "bulge, and the fold ends before the cuff begins. The cause is the cage's 89 degree "
        "corner at the second-to-last control point - the route sweeps out to bearing 75 and "
        "doubles back to the cuff at 101.3.\n"
        "WHAT WAS TRIED AND REFUSED. Grids over the descent bearings, over arrival directions "
        "and over the crown all cap at 0.44x, so no small change removes it; the only fold-free "
        "route a search found runs 1.40 of centreline against the authored 0.89, which is a "
        "different hose rather than a corrected one. Re-routing the tail would also break the "
        "recorded decision that the hose sweeps the front. Ruled by team-lead: SHIP IT. The "
        "defect is a pinch a few centimetres across on a prop the chase camera sees from metres "
        "away in motion, and neither alternative is worth its price. This is a known, measured, "
        "accepted deviation rather than an unnoticed one, and fold_report() re-measures it on "
        "every author run so it cannot drift unseen.\n"
        "WHY NO GATE FOUND IT. The bounding boxes are identical with and without the fold, "
        "clearance_report only asks whether the centreline stays outside other parts, and bow "
        "does not fall when a tube crumples - the very contract meant to discriminate a real "
        "hose from a substituted rod is blind to this. It took reimplementing three.js's "
        "centripetal parameterisation to see it at all, because this script's own uniform "
        "sampler put the worst stretch at 0.65x when the truth was 0.33x: wrong by a factor of "
        "two, in the reassuring direction. Any future tube in this pipeline needs the same "
        "check, on the curve that ships rather than on the cage that feeds it.",
        "THE HOSE IS NOW INTERPOLATED ONCE, AND THE SECOND PASS WAS COSTING REAL GEOMETRY. "
        f"This script used to sample the {len(HOSE_CONTROL)}-point cage into 25 points with a "
        "UNIFORM Catmull-Rom, and buildTubeGeometry then built its own CENTRIPETAL curve "
        "through those - an interpolation of an interpolation under two different "
        "parameterisations, with every check running on the inner one instead of on the object. "
        "The cage now goes straight to the tube. Measured both ways: bow 0.1841 against 0.1826, "
        "centreline 0.8930 against 0.8955, and 864 triangles against 2400, because "
        "tubularSegments is max(8, points * 6) and 25 samples bought 150 rings where the cage "
        "needs 54. It also removed the two collar-end self-intersections outright, leaving only "
        "the accepted one above. HOSE_PATH is still built here, densely, but purely as the "
        "measuring polyline - it is not shipped, so its density is free.\n"
        "A CORRECTION TO THIS SPEC'S OWN CLAIM: an earlier version of this risk list said a "
        "unit test pinned the hose's sample count. No such test exists. The vacuum hose is "
        "pinned by BOW - the maximum distance from any vertex to the chord joining the mesh's "
        "two most distant vertices, which a straight rod cannot fake - in "
        "tests/unit/sculpted-props.test.ts. The sample-count pin is the SPRING's coil. Nothing "
        "blocked this change, and the spec should not have implied otherwise.",
        "THE CORRUGATION IS DECLARED AND NOT BUILT. generate_threejs_factory's repetition "
        "emitter places instances radially about an axis at radius * 0.5 and has no along-path "
        "mode, so it cannot lay ribs along a curve at any level. The pitch is measured and the "
        "count derived; delivering it needs a refine_props.py edit that walks the tube path. "
        "Until then the hose is a smooth tube, which is correct for a blockout and wrong for a "
        "finished prop.",
        "THE ASPECT DELTA IS THE RULING'S RECEIPT, NOT A DEFECT TO FIX. The reference's tall "
        "silhouette IS the forward-and-down sprawl the pose ruling removed, so a render that "
        "matched it would mean the ruling had been reverted. It is recorded as expected and "
        "accepted, and NO reviewYScale is applied: a review scale corrects an aspect the "
        "COLLIDER forced, never one a design ruling chose. The gates that stay comparable are "
        "the per-part reads, the proportions re-anchored to the canister's true diameter, and "
        "the silhouette regions the pose did not move.",
        "THE HEAD'S PLAN IS THE WEAKEST MEASUREMENT KEPT. Its length and width come from the "
        "floor-contact contour un-squashed by 1/sin(pitch), and the two edges it recovers meet "
        "at 75 degrees rather than 90, which is the rounded corners and the perspective error "
        "together. The ratio of 2.23 : 1 is what is authored and it is stated as approximate.",
        "The wheels' depth position along Z is authored, not measured. One view cannot place "
        "an axle in depth, and moving it changes nothing that any gate scores.",
        "TWO MATERIAL TRAPS THIS SPEC WILL HIT AT MATERIAL-PASS, recorded before being hit "
        "rather than after. FIRST, baseColor may be inert. A controlled three-build experiment "
        "on the floor fan showed a pure white albedo rendering identically to navy: the "
        "rendered value came from the procedural map built off colorVariation.palette, not "
        "from baseColor. That inertness is CONDITIONAL, not absolute - a palette with fewer "
        "than two entries DOES fall back to baseColor. Every one of this prop's six materials "
        "carries a three-entry palette, so every one of them is in the inert case, and "
        "correcting a colour here means correcting the PALETTE. I first reported that "
        "inertness as unconditional; it is not, and the narrower statement is the true one. "
        "SECOND, not yet hit by any prop: roughness.base is unread whenever textures exist, "
        "which is the same trap wearing different clothes. All six materials here set it and "
        "all six will be ignored. Neither is a defect in this spec - both are properties of "
        "the generated material - but a material pass that tunes baseColor or roughness.base "
        "and reports an improvement will be reporting one that did not happen.",
        "Reference PBR extraction is cited rather than bound, as every other prop here does.",
    ],
)


def seam_report() -> list[str]:
    """Every declared contact must meet the contract's floor, and be checked here.

    An audit found seven violations across three parts that no render had shown, because a
    shallow seam only opens under a grazing light or after a small transform change. Deriving
    the depths from SEAM_FLOOR fixed them; asserting the whole set is what stops the next
    hand-typed 0.004 from slipping back in.
    """
    problems = []
    for part in COMPONENTS:
        for seam in part.get("seams", []):
            if seam["overlap"] < SEAM_FLOOR - 1e-9:
                problems.append(f"{part['id']} seam {seam['id']} overlaps "
                                f"{seam['overlap']} against a floor of {SEAM_FLOOR}")
        attachment = part.get("attachment")
        if attachment and attachment["embedDepth"] < SEAM_FLOOR - 1e-9:
            problems.append(f"{part['id']} attachment embeds {attachment['embedDepth']} "
                            f"against a floor of {SEAM_FLOOR}")
    return problems


if __name__ == "__main__":
    seams = seam_report()
    if seams:
        raise SystemExit("seam contract failed:\n  " + "\n  ".join(seams))
    problems = clearance_report()
    if problems:
        raise SystemExit("hose clearance failed:\n  " + "\n  ".join(problems))
    print(f"seams: {len(COMPONENTS)} components, all contacts >= {SEAM_FLOOR}")
    print(f"hose: {len(HOSE_PATH)} samples, centreline {HOSE_LENGTH}, "
          f"{HOSE_RIB_COUNT} ribs at pitch {HOSE_PITCH}")
    folds = fold_report()
    if folds:
        for start, end, radius, midpoint in folds:
            print(f"hose FOLD: t {start}-{end} min radius {radius} "
                  f"({round(radius / HOSE_TUBE_R, 2)} x the {HOSE_TUBE_R} tube) at {midpoint}")
    else:
        print(f"hose: no exposed self-intersection at {FOLD_SAMPLES} samples")
    print(f"envelope: X {round(WHEEL_OUTER_X * 2, 4)}/{BOX_WIDTH}  "
          f"Y {PROP_HEIGHT}/{BOX_HEIGHT}  "
          f"Z {round(NOZZLE_FRONT_Z + BOX_DEPTH / 2, 4)}/{BOX_DEPTH}")
    write_spec(OUT, SPEC)
