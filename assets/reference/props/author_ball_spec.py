#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment beach ball.

Every dimension is derived from measurements of assets/reference/ball-reference.png
made with measure_reference.py and the row/column colour scans recorded in
`measurementBasis`, so a later session can re-check them.

Run:  python author_ball_spec.py
Writes: ball-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import math

from spec_lib import (
    HERE, PROJECT, action, action_readiness, assemble, build_passes, colours, component,
    descriptor, detail, detail_inventory, dims, feature, feature_group, material, override,
    quality_contract, surface, write_spec, xform,
)

PROP = "ball"
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "ball-reference.png")
OUT = HERE / "ball-sculpt-spec.json"
EVIDENCE = "full-object"

# ---------------------------------------------------------------------------
# Measured geometry.
#
# Silhouette box x[109,971] y[266,1147] of a 1086x1448 image: 863 wide by 882 tall.
# A sphere's horizontal extent is its true diameter under a centred camera, so the
# radius is 431.5 px and the scale is set from that. The 19 px (2.2 percent) vertical
# excess is NOT modelled - see risks.
#
# The trap's BallCollider is radius 0.75, so the sphere is authored at exactly that
# radius and needs no rescale to reach the play space.
# ---------------------------------------------------------------------------
R = 0.75
PX_PER_UNIT = 431.5 / R                              # 575.3 px per world unit

# Gore count. Colour-boundary longitudes solved from the row-500 and row-707 scans with
# the pole tilted 40.6 degrees toward the camera come out at -87, -34, +31 and +86
# degrees: three gores spanning 173 degrees, so 57.7 degrees each. Six gores of 60 is
# the only regular fit; eight gores of 45 is excluded by more than three standard
# boundary-estimate errors.
GORE_COUNT = 6
GORE_SPAN = 360.0 / GORE_COUNT
# Each gore stops short of its neighbour so the darker core sphere shows as a recessed seam
# groove. The reference seams are grooves, not painted lines, so they have to be geometry.
# refine-spec after blockout: 1.1 degrees rendered as an 8 px pale band against the
# reference's thin dark crease, so the gap halves and the core albedo drops below every
# panel's.
SEAM_GAP_DEG = 0.6
# refine-spec after structural-pass: 0.014 of groove depth rendered as a near-black
# hairline against the reference's soft crease, which sits about 20 percent below the
# adjacent panel rather than 70.
CORE_R = R - 0.009
# Gores stop short of both poles; the core closes them and the valve covers the north.
POLE_INSET_DEG = 7.0

# Valve cap. Its projected ellipse is 190 px across and 124 px tall; 124/190 = 0.653
# matches cos(40.6 deg), confirming a flat disc lying on the surface at the pole.
VALVE_R = 95.0 / PX_PER_UNIT                          # 0.165
VALVE_PROUD = 0.012
VALVE_PLUG_R = VALVE_R * 0.62
VALVE_PLUG_PROUD = 0.019

# Tessellation. A panel spans 60 degrees, so 18 segments is 3.3 degrees of faceting on the
# limb silhouette, and 18 meridian samples is 10 degrees. Below that the silhouette flats
# are visible at play distance; above it the ball alone eats the whole triangle budget.
MERIDIAN_SAMPLES = 18
GORE_SEGMENTS = 18
CORE_SEGMENTS = 24

CORAL = "#F2685C"
YELLOW = "#FCC348"
MINT = "#86C0A0"
CREAM = "#EFE6D6"
CORE_GREY = "#94897A"

# g5 (150..210 degrees) faces directly away from the camera and is not observed.
GORES = [
    ("coral", -90.0, "gore-coral-front", "Coral gore", CORAL, "gore-coral", 0.9),
    ("yellow", -30.0, "gore-yellow", "Yellow gore", YELLOW, "gore-yellow", 0.92),
    ("mint", 30.0, "gore-mint", "Mint gore", MINT, "gore-mint", 0.9),
    ("cream-right", 90.0, "gore-cream-right", "Right cream gore", CREAM, "gore-cream", 0.7),
    ("coral-back", 150.0, "gore-coral-back", "Rear coral gore", CORAL, "gore-coral", 0.3),
    ("cream-left", 210.0, "gore-cream-left", "Left cream gore", CREAM, "gore-cream", 0.7),
]


def meridian(radius: float, inset_deg: float, samples: int = MERIDIAN_SAMPLES):
    """Half-circle profile for LatheGeometry, south pole to north pole, stopping
    `inset_deg` short of each pole so the lathe has no degenerate fan at the axis."""
    lo = math.radians(inset_deg)
    hi = math.pi - lo
    return [[round(radius * math.sin(lo + (hi - lo) * i / samples), 5),
             round(-radius * math.cos(lo + (hi - lo) * i / samples), 5)]
            for i in range(samples + 1)]


def lathe_profile(radius: float, inset_deg: float, phi_start_deg: float, phi_len_deg: float,
                  segments: int):
    return {"points": meridian(radius, inset_deg), "segments": segments,
            "phiStart": round(math.radians(phi_start_deg), 6),
            "phiLength": round(math.radians(phi_len_deg), 6)}


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
MATERIALS = [
    material(PROP, "gore-coral", "Coral panel vinyl", CORAL, [CORAL, "#E45B50", "#F8776B"],
             0.62, 0.08, 0.20, 0.831,
             [override("coral-seam-shade", "gore-coral-front/gore-seam-edge",
                       "The panel darkens into its seam groove; the groove is the darkest coral "
                       "value in the frame.",
                       [EVIDENCE, "equator-zone"], roughness=0.70, aoBoost=0.45,
                       mask="outer 4 percent of the gore width")],
             "Two coral gores. Matte inflated vinyl, no specular coat.",
             shader_model="MeshPhysicalMaterial (matte inflated PVC)"),
    material(PROP, "gore-yellow", "Yellow panel vinyl", YELLOW, [YELLOW, "#EDB63C", "#FFD25C"],
             0.62, 0.08, 0.20, 0.804,
             [override("yellow-crown-sheen", "gore-yellow/panel-crown",
                       "The panel crown facing the key light is the brightest value in the frame "
                       "and reads slightly smoother than the panel flanks.",
                       [EVIDENCE, "equator-zone"], roughness=0.55,
                       mask="central 30 percent of the gore width")],
             "One yellow gore, centred on the reference view."),
    material(PROP, "gore-mint", "Mint panel vinyl", MINT, [MINT, "#78B392", "#93CCAC"],
             0.62, 0.08, 0.20, 0.812,
             [override("mint-limb-falloff", "gore-mint/gore-seam-edge",
                       "The mint panel turns away from the key toward the right limb and loses "
                       "about 12 percent of its value.",
                       [EVIDENCE, "equator-zone"], roughness=0.68, aoBoost=0.30,
                       mask="outer 20 percent toward the limb")],
             "One mint gore."),
    material(PROP, "gore-cream", "Cream panel vinyl", CREAM, [CREAM, "#E4D9C6", "#F7EFE2"],
             0.60, 0.08, 0.20, 0.786,
             [override("cream-seam-shade", "gore-cream-right/gore-seam-edge",
                       "Cream shows the seam groove more strongly than any other panel because it "
                       "carries the widest value range.",
                       [EVIDENCE, "equator-zone"], roughness=0.70, aoBoost=0.50,
                       mask="outer 4 percent of the gore width")],
             "Two cream gores, both seen edge-on at the limbs in the reference."),
    material(PROP, "seam-core", "Seam core shell", CORE_GREY, [CORE_GREY, "#847A6C", "#A79B8B"],
             0.80, 0.06, 0.55, 0.702,
             [override("groove-depth-shade", "ball-core/seam-groove-floor",
                       f"Only the {SEAM_GAP_DEG} degree strips between panels are ever visible, "
                       "and they read as the darkest lines on the ball.",
                       [EVIDENCE, "equator-zone"], roughness=0.88, aoBoost=0.70,
                       mask="entire visible surface")],
             "Inner shell 0.014 units under the panels. It is what a seam groove shows, and it "
             "stops the panel gaps reading through to the inside of the ball."),
    material(PROP, "valve-coral", "Valve cap vinyl", CORAL, [CORAL, "#DE564B", "#F8776B"],
             0.55, 0.07, 0.28, 0.744,
             [override("valve-rim-step", "valve-collar/collar-step",
                       "A hard shadow ring runs where the collar meets the panels.",
                       [EVIDENCE, "pole-zone"], roughness=0.66, aoBoost=0.55,
                       mask="collar outer wall")],
             "Valve collar and plug. Slightly smoother than the panels; it is moulded, not welded."),
]


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
CORE = component(
    "ball-core", "Seam core shell", "macro", "shell", "lathe", "seam-core",
    "continuous-sculpt",
    "One smoothly varying closed volume with no internal seam and no flat face: the reference "
    "silhouette is circular to within 2.2 percent, so this is a single continuous mass rather "
    "than an assembly.",
    colours(CORE_GREY),
    # A full revolution of the same meridian the panels use, rather than SphereGeometry,
    # for one structural reason: the generator scales a unit primitive by `dimensions`, and
    # that scale would propagate to the panels parented under it. A lathe carries its real
    # radius in its profile, so this node stays at unit scale and its children inherit 1.
    descriptor("full revolution of the panel meridian at 0.009 units under the panel radius, so "
               "every seam gap shows a recessed groove floor instead of a hole",
               "none", uv="lathe UVs",
               normals="smooth vertex normals; the core has no creases"),
    xform(),
    dims(CORE_R * 2, CORE_R * 2, CORE_R * 2, 0.85),
    action("root", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.9,
           channels={"translate": True, "rotate": True, "scale": True},
           sockets=[{"id": "ball-center", "localPosition": [0.0, 0.0, 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Centre of mass; the trap's BallCollider is concentric with this."},
                    {"id": "valve-pole", "localPosition": [0.0, round(R + VALVE_PROUD, 4), 0.0],
                     "localRotation": [0.0, 0.0, 0.0],
                     "notes": "Outer face of the valve; an inflate or deflate effect anchors here."}],
           collider={"type": "sphere", "offset": [0.0, 0.0, 0.0],
                     "scale": [R * 2, R * 2, R * 2], "isTrigger": False,
                     "notes": "Sphere proxy at the panel radius, matching the trap's BallCollider."},
           fracture="ball-shell"),
    [feature("seam-groove-floor",
             f"The {SEAM_GAP_DEG} degree strip between each pair of panels exposes this shell "
             "0.009 units below them, which is what makes the six seams read as grooves rather "
             "than lines.",
             "sphere radius set 0.014 under the panel radius; no map involved",
             [EVIDENCE, "equator-zone"], 0.8),
     feature("polar-closure",
             "Panels stop 7 degrees short of each pole, so this shell closes the ball at the top "
             "under the valve and at the bottom where the reference cannot see.",
             "full sphere behind the six partial lathes",
             [EVIDENCE, "pole-zone"], 0.6)],
    surface(0.80, 0.06, 0.0, "smooth vinyl with no relief",
            "deep occlusion in every seam groove", "none",
            "Only 6.6 degrees of this shell's circumference is ever visible."),
    [EVIDENCE, "equator-zone", "pole-zone"],
    importance=0.8, confidence=0.8, parent=None, fidelity="blockout",
)

GORE_COMPONENTS = []
for tag, phi_start, cid, name, colour, material_id, confidence in GORES:
    GORE_COMPONENTS.append(component(
        cid, name, "meso", "panel", "lathe", material_id,
        "conforming-shell",
        "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing "
        "a volume of its own; it has no flat face and no crease except at its two meridian edges.",
        colours(colour),
        descriptor(f"60 degree spherical gore from pole to pole, inset {SEAM_GAP_DEG / 2} degrees "
                   "at each meridian edge so the seam groove opens",
                   "none", uv="lathe UVs; one tile per panel",
                   normals="smooth vertex normals across the panel, hard at its meridian edges",
                   profile2d=None),
        # A lathe carries its real size in its profile, so the node stays at unit scale;
        # only the primitives the generator emits at unit size read `dimensions`.
        xform(),
        dims(R * 2, R * 2, R * 2, 0.8),
        action("static", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.8, fracture="ball-shell"),
        [feature("gore-seam-edge",
                 f"The panel spans {GORE_SPAN - SEAM_GAP_DEG} degrees of longitude from "
                 f"{phi_start + SEAM_GAP_DEG / 2} degrees, leaving a {SEAM_GAP_DEG} degree groove "
                 "against each neighbour.",
                 "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is "
                 "extended to honour",
                 [EVIDENCE, "equator-zone"], confidence),
         feature("panel-crown",
                 "The panel's own curvature carries the value gradient across it; the reference "
                 "shows about 14 percent falloff from crown to seam on the coral panel.",
                 "spherical curvature, shaded rather than painted",
                 [EVIDENCE, "equator-zone"], 0.75)],
        surface(0.62, 0.08, 0.0, "smooth inflated vinyl", "groove occlusion at both meridian edges",
                "none", "Matte vinyl. No gloss anywhere in the reference."),
        [EVIDENCE, "equator-zone"],
        importance=0.9 if confidence > 0.5 else 0.4, confidence=confidence, parent="ball-core",
        seams=[{"id": f"{cid}-core-seam", "with": "ball-core", "overlap": 0.009,
                "notes": "Panel floats 0.009 units proud of the core; the gap between panels is "
                         "the groove."}],
        fidelity="blockout" if tag in ("coral", "yellow", "mint") else "structural-pass",
    ))

# Geometry the descriptor cannot carry through the shared helper: the lathe profile.
for entry, (tag, phi_start, cid, _n, _c, _m, _conf) in zip(GORE_COMPONENTS, GORES):
    entry["geometryDescriptor"]["latheProfile"] = lathe_profile(
        R, POLE_INSET_DEG, phi_start + SEAM_GAP_DEG / 2, GORE_SPAN - SEAM_GAP_DEG,
        GORE_SEGMENTS)

VALVE_COLLAR = component(
    "valve-collar", "Valve collar", "meso", "fitting", "lathe", "valve-coral",
    "assembled-solid",
    "A separate moulded disc welded onto the panels: the reference shows a hard step where it "
    "meets them and a flat crown, which no continuous inflation of the ball surface would give.",
    colours(CORAL),
    descriptor("flat-crowned disc lying on the sphere at the north pole",
               "flat-chamfer", 0.0, 1,
               deformations=["crown flattened to the tangent plane at the pole"],
               uv="lathe UVs", normals="flat crown normals, smooth outer wall"),
    xform(),
    dims(VALVE_R * 2, VALVE_PROUD, VALVE_R * 2, 0.7),
    action("static", "socket", (0.0, R, 0.0), (0, 1, 0), 0.75, fracture="valve-assembly",
           detach=["valve-collar", "valve-plug"]),
    [feature("collar-step",
             "The collar stands 0.012 units proud of the panels, so a hard shadow ring runs all "
             "the way round it.",
             "lathe profile whose outer wall is vertical, seated 0.02 units into the panels",
             [EVIDENCE, "pole-zone"], 0.8),
     feature("collar-crown-flat",
             "The crown is flat, not domed: its projected ellipse has straight-sided shading with "
             "no terminator across it.",
             "profile ends with a horizontal run to the axis",
             [EVIDENCE, "pole-zone"], 0.75)],
    surface(0.55, 0.07, 0.0, "smooth moulded vinyl", "shadow ring at the panel step", "none",
            "Same coral pigment as the coral gores; measured within 3 of 255 on each channel."),
    [EVIDENCE, "pole-zone"],
    importance=0.6, confidence=0.75, parent="ball-core",
    seams=[{"id": "collar-panel-seam", "with": "gore-yellow", "overlap": 0.02,
            "notes": "Collar base is buried 0.02 units inside the panel radius."}],
)
VALVE_COLLAR["geometryDescriptor"]["latheProfile"] = {
    "points": [[0.0001, R - 0.02], [VALVE_R, R - 0.008], [VALVE_R, R + VALVE_PROUD],
               [VALVE_R * 0.88, R + VALVE_PROUD], [0.0001, R + VALVE_PROUD]],
    "segments": CORE_SEGMENTS, "phiStart": 0.0, "phiLength": round(2 * math.pi, 6),
}

VALVE_PLUG = component(
    "valve-plug", "Valve plug", "micro", "fitting", "lathe", "valve-coral",
    "assembled-solid",
    "A second smaller disc standing on the collar crown, visible in the reference as a concentric "
    "step with its own shadow ring.",
    colours(CORAL, 0.94),
    descriptor("inner plug disc on the collar crown", "flat-chamfer", 0.0, 1,
               uv="lathe UVs", normals="flat crown normals"),
    xform(),
    dims(VALVE_PLUG_R * 2, VALVE_PLUG_PROUD - VALVE_PROUD, VALVE_PLUG_R * 2, 0.6),
    action("static", "center", (0.0, 0.0, 0.0), (0, 1, 0), 0.6, fracture="valve-assembly"),
    [feature("plug-step",
             "The plug stands a further 0.007 units above the collar crown, giving the cap the "
             "two-step read the reference shows.",
             "second lathe disc seated 0.004 units into the collar",
             [EVIDENCE, "pole-zone"], 0.7)],
    surface(0.55, 0.07, 0.0, "smooth moulded vinyl", "shadow ring at the collar step", "none",
            "Slightly darker than the collar in the reference, which is shading rather than a "
            "second pigment; modelled as a 6 percent albedo step."),
    [EVIDENCE, "pole-zone"],
    importance=0.35, confidence=0.65, parent="valve-collar",
    seams=[{"id": "plug-collar-seam", "with": "valve-collar", "overlap": 0.02,
            "notes": "Plug base is buried in the collar crown."}],
)
VALVE_PLUG["geometryDescriptor"]["latheProfile"] = {
    "points": [[0.0001, R + VALVE_PROUD - 0.008], [VALVE_PLUG_R, R + VALVE_PROUD - 0.004],
               [VALVE_PLUG_R, R + VALVE_PLUG_PROUD], [VALVE_PLUG_R * 0.8, R + VALVE_PLUG_PROUD],
               [0.0001, R + VALVE_PLUG_PROUD]],
    "segments": CORE_SEGMENTS, "phiStart": 0.0, "phiLength": round(2 * math.pi, 6),
}

CORE["geometryDescriptor"]["latheProfile"] = {
    "points": meridian(CORE_R, 0.0), "segments": CORE_SEGMENTS,
    "phiStart": 0.0, "phiLength": round(2 * math.pi, 6),
}

COMPONENTS = [CORE] + GORE_COMPONENTS + [VALVE_COLLAR, VALVE_PLUG]
ALL_REFS = [c["id"] for c in COMPONENTS]
BLOCKOUT_REFS = ["ball-core", "gore-coral-front", "gore-yellow", "gore-mint"]

# ---------------------------------------------------------------------------
# repetition system
# ---------------------------------------------------------------------------
REPETITION_SYSTEMS = [
    {
        "id": "gore-panel-ring",
        "name": "Six-panel gore ring",
        "level": "meso",
        "parent": "ball-core",
        "count": GORE_COUNT,
        "primitive": "lathe",
        "material": "gore-cream",
        "instanceScale": [1.0, 1.0, 1.0],
        "buildsGeometry": False,
        "realization": "authored-components",
        "placement": {
            "mode": "radial",
            "axis": [0, 1, 0],
            "radius": 0.0,
            "startAngleDeg": -90.0,
            "stepAngleDeg": GORE_SPAN,
            "notes": "Six 60 degree steps about the polar axis. Declared as a repetition system "
                     "because the placement rule is what makes the pattern read, but realised as "
                     "six authored components rather than one InstancedMesh: the panels carry "
                     "four different albedos, and an InstancedMesh shares one material.",
        },
        "evidenceRefs": [EVIDENCE, "equator-zone"],
        "notes": "Boundary longitudes measured at -87, -34, +31 and +86 degrees; the regular "
                 "60 degree ring fits those to within 4 degrees.",
    },
]

# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
MATERIAL_IDS = {m["id"] for m in MATERIALS}
DETAILS = [
    detail("panel-seam-grooves", "equator", "groove",
           f"Six meridian seams run pole to pole as recessed grooves, not painted lines; each is "
           f"{SEAM_GAP_DEG} degrees of longitude and 0.009 units deep.",
           "ball-core/seam-groove-floor",
           "Panels stop short of each other over a darker core sphere; geometry, never a map.",
           EVIDENCE, 0.85, MATERIAL_IDS),
    detail("gore-longitude-span", "equator", "contour",
           "Each panel spans 60 degrees of longitude; boundaries were solved at -87, -34, +31 and "
           "+86 degrees from the row-500 and row-707 colour scans.",
           "gore-yellow/gore-seam-edge",
           "LatheGeometry phiStart/phiLength per panel.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("panel-crown-gradient", "equator", "contour",
           "Value falls about 14 percent from each panel's crown to its seam edge, which is the "
           "sphere's own curvature under a single key rather than a painted gradient.",
           "gore-coral-front/panel-crown",
           "Spherical curvature plus a low-roughness crown override.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("valve-collar-step", "pole", "ridge",
           "A coral disc 0.33 units across stands 0.012 units proud at the north pole with a hard "
           "shadow ring where it meets the panels.",
           "valve-collar/collar-step",
           "Lathe disc with a vertical outer wall seated 0.02 units into the panel radius.",
           EVIDENCE, 0.8, MATERIAL_IDS),
    detail("valve-plug-step", "pole", "ridge",
           "A second smaller disc stands a further 0.007 units above the collar crown, giving the "
           "cap two concentric steps.",
           "valve-plug/plug-step",
           "Second lathe disc on the collar crown.",
           EVIDENCE, 0.7, MATERIAL_IDS),
    detail("polar-panel-convergence", "pole", "seam",
           "The panels stop 7 degrees short of the pole and the core closes the gap, which is what "
           "the valve then covers.",
           "ball-core/polar-closure",
           "Lathe profiles inset from both poles behind a full core sphere.",
           EVIDENCE, 0.6, MATERIAL_IDS),
    detail("seam-groove-darkening", "equator", "stain",
           "The groove floors are the darkest values on the ball, roughly 30 percent below the "
           "adjacent panel.",
           "seam-core/groove-depth-shade",
           "Material local override raising roughness and AO across the whole core shell.",
           EVIDENCE, 0.75, MATERIAL_IDS),
    detail("cream-limb-slivers", "limb", "contour",
           "Cream panels appear at both limbs as 57 and 58 pixel slivers, which is what fixes the "
           "panel phase against the camera.",
           "gore-cream-left/gore-seam-edge",
           "Panel phase offset chosen so the cream panels straddle plus and minus 90 degrees.",
           EVIDENCE, 0.7, MATERIAL_IDS),
]

DETAIL_INVENTORY = detail_inventory(
    DETAILS, 6,
    "component-zone scan of the reference at 3x, with colour-run scans along rows 380, 420, 500, "
    "707, 900 and 1050 and column 540 to place every panel boundary in pixels before converting "
    "to longitude.")

# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
PASSES = build_passes(
    BLOCKOUT_REFS, ALL_REFS,
    "Match the macro silhouette: a sphere of radius 0.75 with the three front panels in place.",
    "Build the full panel ring, the seam core and the valve assembly under one root.",
    "Deliver the seam grooves, the polar insets and the valve's two-step crown.",
    "Match the four-panel palette and the matte inflated-vinyl response.",
    ["Seam grooves are visible as recessed geometry from at least two camera angles.",
     "Panel boundaries land within 5 degrees of the measured longitudes.",
     "The valve cap reads as two concentric steps, not one flat disc."],
    has_repetition=True)

FEATURE_REVIEW_TARGETS = [
    {"id": "panel-ring-phase", "name": "Six-panel ring and its phase against the camera",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["gore-coral-front", "gore-yellow", "gore-mint", "gore-cream-left",
                       "gore-cream-right"],
     "evidenceRefs": [EVIDENCE, "equator-zone"],
     "failureModes": ["wrong panel count", "panels evenly coloured so the ring reads as stripes",
                      "cream panels not at the limbs"]},
    {"id": "sphere-proportion", "name": "Spherical massing and scale",
     "tier": "critical", "passIds": ["blockout", "structural-pass", "optimization-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["ball-core"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["silhouette not circular", "ball radius drifts from the collider radius"]},
    {"id": "seam-groove-read", "name": "Seams as recessed grooves",
     "tier": "critical", "passIds": ["form-refinement", "surface-pass", "lighting-pass"],
     "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["ball-core", "gore-yellow"], "evidenceRefs": [EVIDENCE, "equator-zone"],
     "failureModes": ["seams read as painted lines", "panels fused into one sphere",
                      "gaps show through to the inside"]},
    {"id": "matte-vinyl-response", "name": "Matte inflated-vinyl response",
     "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"],
     "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["gore-coral-front", "gore-yellow", "gore-mint"], "evidenceRefs": [EVIDENCE],
     "failureModes": ["specular hotspot on a matte ball", "flat unshaded panels",
                      "palette drifts from the measured four"]},
    {"id": "valve-cap-read", "name": "Valve cap at the pole",
     "tier": "important", "passIds": ["structural-pass", "form-refinement", "surface-pass"],
     "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["valve-collar", "valve-plug"], "evidenceRefs": [EVIDENCE, "pole-zone"],
     "failureModes": ["cap missing", "cap centred off the pole", "cap flush with the panels"]},
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "primary elevated view (pole tilted 40.6 degrees toward the camera)",
     "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": [
         "Silhouette box spans x 109-971 and y 266-1147 of a 1086x1448 image: 863 by 882 pixels.",
         "The silhouette is circular to within 2.2 percent, so the form is a sphere.",
         "Four albedos appear: coral, yellow, mint and cream. No blue anywhere.",
         "The rear panel is not visible and its colour is inferred.",
     ],
     "confidence": 0.9},
    {"id": "equator-zone", "view": "panel boundaries at the screen equator",
     "imageRegion": {"x": 0.10, "y": 0.32, "width": 0.80, "height": 0.30, "units": "normalized"},
     "observations": [
         "Row 707 gives boundaries at x 117, 355, 703 and 961, which solve to longitudes -87, -34, "
         "+31 and +86 degrees.",
         "Row 500 independently gives -87, -34.5, +31.1 and -34 within 3 degrees of the same set.",
         "Each boundary reads as a darkened groove, not a hard colour step.",
     ],
     "confidence": 0.85},
    {"id": "pole-zone", "view": "valve cap",
     "imageRegion": {"x": 0.38, "y": 0.20, "width": 0.24, "height": 0.12, "units": "normalized"},
     "observations": [
         "The cap's projected ellipse is about 190 by 124 pixels; 124/190 matches cos(40.6 deg), so "
         "it is a flat disc on the surface at the pole.",
         "Two concentric steps are visible: an outer collar and an inner plug.",
         "The panel seams converge on the cap centre, which fixes it at the pole.",
     ],
     "confidence": 0.8},
]

SPEC = assemble(
    target_name="Apartment Beach Ball",
    target_id="apartment-beach-ball",
    source_image=SOURCE_IMAGE,
    reference_camera={
        "solved": True,
        "solveMethod": "elevation from the valve cap's screen offset from the sphere centre "
                       "(327 px of a 431.5 px radius gives 49.4 degrees from the view axis, so "
                       "40.6 degrees of camera elevation); azimuth from the measured panel "
                       "boundary longitudes",
        "fovDegrees": 26.0,
        "aspect": round(1086 / 1448, 4),
        "orientation": {"yaw": 0.0, "pitch": -40.6, "roll": 0.0},
        "targetHint": [0.0, 0.0, 0.0],
        "note": "A sphere's silhouette carries no camera information, so elevation had to come "
                "from the valve cap and the panel boundaries instead. Distance is not fixed here: "
                "the preview harness solves it by fitting the render's projected bounding box to "
                "the reference bounding box (x 109-971, y 266-1147 of 1086x1448).",
    },
    measurement_basis={
        "pixelsPerWorldUnit": round(PX_PER_UNIT, 1),
        "referenceBBox": {"x0": 109, "y0": 266, "x1": 971, "y1": 1147, "imageSize": [1086, 1448]},
        "derivations": [
            "Silhouette 863 px wide gives a sphere radius of 431.5 px, set to 0.75 world units to "
            "match the trap's BallCollider radius, hence 575.3 px per world unit.",
            "Valve cap 190 px across gives a cap radius of 95 px = 0.165 world units.",
            "Cap ellipse 124/190 = 0.653 = cos(40.6 deg), which is the camera elevation.",
            "Panel boundaries at row 707 (x 117, 355, 703, 961) and row 500 (x 219, 442, 627, 859) "
            "both solve to a 57-60 degree panel width once the 40.6 degree pole tilt is removed.",
        ],
    },
    suitability="pass",
    scores={"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 3,
            "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2,
            "interaction_fit": 3},
    pre_spec={
        "objectClass": {
            "primaryType": "inflatable beach ball (six-panel gore construction)",
            "primaryDomain": "object",
            "formLanguage": ["smooth-organic", "stylized-toy", "panelled-sphere"],
            "structureKind": ["closed-inflated-shell", "meridian-panel-ring", "polar-fitting"],
            "motionPotential": ["free-roll", "bounce", "spin-about-any-axis"],
            "materialFamilies": ["matte-vinyl-coral", "matte-vinyl-yellow", "matte-vinyl-mint",
                                 "matte-vinyl-cream"],
            "notes": "Smooth organic object. The identity is the panel ring and its grooved seams, "
                     "not the sphere, which any primitive would give. One view: the rear panel and "
                     "the south pole are inferred.",
        },
        "complexity": {
            "tier": "moderate",
            "scores": {"silhouetteComplexity": 1, "componentCount": 2, "hierarchyDepth": 2,
                       "repetitionDensity": 2, "materialLayerCount": 3, "localDetailDensity": 2,
                       "occlusionRisk": 2, "actionReadinessNeed": 1},
            "estimatedCounts": {"macroComponents": 1, "mesoComponents": 7, "microFeatureGroups": 1,
                                "materialLayers": 6, "repetitionSystems": 1},
            "reasoning": [
                "The silhouette is trivial but the panel ring is the whole identity, so the spec "
                "needs one component per panel rather than a textured sphere.",
                "Four albedos over six panels means six material layers including the seam core "
                "and the valve.",
                "Action readiness is low: the ball is a dynamic rigid body with no articulation.",
                "Occlusion risk is moderate: the rear panel and the south pole are never seen.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "moderate",
            "minimumComponentLevels": ["macro", "meso", "micro"],
            "needsRepetitionSystems": True,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": False,
            "rationale": "One repeated system and six material zones are visible, so the spec needs "
                         "meso components and material local overrides rather than a macro-only "
                         "tree, even though the silhouette is a single sphere.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {"unknown": "The rear panel's colour is not visible.",
             "resolution": "Set to coral, giving two coral, two cream, one yellow and one mint. "
                           "Recorded as an inference at confidence 0.3 on gore-coral-back.",
             "confidence": 0.3},
            {"unknown": "The south pole is not visible.",
             "resolution": "Closed by the core shell with no second valve. Beach balls carry one "
                           "valve; a second would have shown as a silhouette bump.",
             "confidence": 0.6},
            {"unknown": "Seam groove depth cannot be measured from one view.",
             "resolution": "Set to 0.009 world units, about 1.2 percent of the radius, which is "
                           "the smallest depth that still reads as a groove at play distance.",
             "confidence": 0.5},
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
        ["The rendered ball matches the reference silhouette, the six-panel ring and its phase, "
         "the four-albedo palette, the grooved seams and the polar valve at the moderate fidelity "
         "tier.",
         "The seams read as recessed geometry from at least two camera angles.",
         "The panel radius equals the trap's BallCollider radius so the visual and the hitbox "
         "cannot disagree."],
        {"macroComponents": 1, "mesoComponents": 3, "microFeatureGroups": 1, "materialLayers": 4,
         "repetitionSystems": 1, "reviewViewpoints": 3},
        [
            feature_group("overall-silhouette", "Overall silhouette and proportions",
                          ["Radius, panel span and valve size are stated as measured numbers.",
                           "The sphere radius traces to the reference silhouette width."],
                          [EVIDENCE],
                          ["model reads as a generic sphere with a texture",
                           "radius guessed rather than measured"]),
            feature_group("primary-structure", "Primary structure and hierarchy",
                          ["Each panel, the seam core and the valve are separate named parts.",
                           "Every contact records a seam overlap of at least 0.02 world units, or "
                           "states the panel-to-core offset that replaces it."],
                          [EVIDENCE, "equator-zone"],
                          ["panels merged into one mesh",
                           "component hierarchy too shallow for the observed panel ring"]),
            feature_group("attachment-joint-correctness", "Contact and joint correctness",
                          ["The ball has no cantilevered appendage, so contact correctness is "
                           "carried by the panel-to-core radial offset and the valve's seam "
                           "overlap.",
                           "The valve plug rides the collar so both detach as one group."],
                          [EVIDENCE, "pole-zone"],
                          ["valve floats off the surface", "panel gap shows through to the inside"]),
            feature_group("surface-material-response", "Surface material response",
                          ["Albedo zones, roughness, normal intent and local overrides are "
                           "specified per material and tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are independent fields.",
                           "Surface response is decomposed into macro, meso and micro bands."],
                          [EVIDENCE, "equator-zone"],
                          ["surface looks like glossy toy plastic",
                           "local material variation missing or untraceable to the image"]),
            feature_group("reference-lookdev", "Reference colour, material and lighting response",
                          ["The four-panel palette traces to median-sampled reference pixels.",
                           "Reference PBR extraction ran on every material crop and its confidence "
                           "and binding decision are both recorded.",
                           "Lighting names key, fill, rim or environment, exposure, tone mapping, "
                           "background and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders prove the seam relief "
                           "survives relighting."],
                          [EVIDENCE],
                          ["acceptable shape but flat-shaded read",
                           "colours are a generic average instead of the measured four",
                           "lighting is evenly ambient"]),
        ],
        ["silhouette and negative-space delta", "panel boundary longitude delta",
         "component hierarchy depth delta", "seam groove depth and darkness delta",
         "material albedo, roughness and normal response delta"]),
    quality_targets={
        "targetFidelity": 0.8,
        "mustMatch": ["circular silhouette at the collider radius",
                      "six-panel gore ring with the measured phase",
                      "four-albedo palette with no blue",
                      "recessed seam grooves",
                      "two-step coral valve cap at the pole"],
        "niceToHave": ["the 2.2 percent vertical elongation of the reference silhouette",
                       "panel-to-panel inflation bulge between seams"],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-elevated", "front", "right", "top-down", "rear-orbit"],
    },
    feature_review_targets=FEATURE_REVIEW_TARGETS,
    view_evidence=VIEW_EVIDENCE,
    components=COMPONENTS,
    materials=MATERIALS,
    repetition_systems=REPETITION_SYSTEMS,
    passes=PASSES,
    lighting=[
        "Ambient dominance: the reference is a soft studio render. Measured yellow reads 255,200,69 "
        "at the panel crown and 196,152,55 at the seam, a 23 percent range across a full "
        "hemisphere of curvature, which needs a bright neutral hemisphere rather than a hard key.",
        "Key light: a gentle warm directional source at about 1.15 from high and camera left, "
        "enough to put the crown 20 percent above the flank without crushing the limb.",
        "Rim and environment light: weak neutral back light at about 0.3. No environment map: the "
        "reference shows no reflected detail anywhere on the ball.",
        "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The "
        "reference holds a narrow value range with no blown highlights.",
        "Contact shadow: seam-groove ambient occlusion only. The reference ball floats with no "
        "ground contact, so the review render has no ground plane and the silhouette mask stays "
        "clean.",
    ],
    action_readiness=action_readiness(
        "ball-core",
        {"rootMotion": "sculptRuntime.nodes['ball-core'] carries translation, rotation and scale; "
                       "the panels and the valve are its children so the ball spins as one body.",
         "valvePole": "sculptRuntime.sockets['ball-core:valve-pole'] marks the outer face of the "
                      "valve for an inflate or deflate effect.",
         "collider": "colliders['ball-core'] is a sphere proxy at radius 0.75, the same radius the "
                     "trap's BallCollider uses."},
        "ball-shell, valve-assembly",
        "Detach the valve assembly as a group; the panel ring is not fractured."),
    assumptions=[
        "The rear panel is coral. It is never visible in the reference.",
        "The south pole carries no second valve.",
        "One world unit is about 20 cm, making the modelled ball about 30 cm across.",
        "The 2.2 percent vertical excess in the reference silhouette is treated as reference "
        "geometry that is deliberately not reproduced, because a prolate visual would poke through "
        "the trap's spherical collider.",
    ],
    coordinate_frame={
        "front": "+Z, the hemisphere facing the reference camera",
        "up": "+Y, the polar axis, with the valve at +Y",
        "right": "+X",
        "scaleReference": "panel radius = 0.75 world units; 575.3 reference pixels per world unit",
    },
    silhouette={
        "boundingShape": f"sphere of radius {R}, plus a {VALVE_PLUG_PROUD} unit valve bump at +Y",
        "aspectRatios": [
            {"id": "width-to-height", "value": round(863 / 882, 3),
             "notes": "reference silhouette 863 px over 882 px; a sphere would be 1.000"},
            {"id": "valve-to-ball-radius", "value": round(VALVE_R / R, 3),
             "notes": "valve collar radius over panel radius"},
            {"id": "seam-depth-to-radius", "value": round(R - CORE_R, 4) and round((R - CORE_R) / R, 4),
             "notes": "groove depth over panel radius"},
        ],
        "symmetry": "rotationally symmetric about the polar axis in form; six-fold in albedo",
        "dominantCurves": ["one constant-curvature spherical surface broken only by six meridian "
                           "grooves"],
        "negativeSpaces": ["the six seam grooves", "the step ring around the valve collar"],
        "landmarks": [f"panel radius {R}", f"core radius {CORE_R}",
                      f"valve crown at y = {round(R + VALVE_PLUG_PROUD, 3)}",
                      "panel boundaries at longitudes -90, -30, 30, 90, 150 and 210 degrees"],
    },
    lod_plan=[
        {"tier": "near", "distance": 0,
         "strategy": "six panels, seam core and two-piece valve; 256px procedural maps"},
        {"tier": "mid", "distance": 12, "strategy": "drop the valve plug; keep the collar"},
        {"tier": "far", "distance": 30,
         "strategy": "single sphere with the dominant panel albedo; no seams"},
    ],
    performance_budget={
        "qualityPriority": "balanced",
        "targetTriangles": 6000,
        "maxDrawCalls": 12,
        "textureSize": 256,
        "fpsTarget": 60,
        "optimizationPolicy": "Reach accepted visual fidelity first, then cut lathe segment counts "
                              "and the sphere tessellation. The seam grooves set the floor on "
                              "segment count: below about 20 segments per 60 degree panel the "
                              "groove edges facet visibly.",
    },
    procedural_strategy=[
        "Block out the core sphere and the three front panels first, and confirm the silhouette is "
        "circular at the collider radius.",
        "Add the remaining three panels, then the valve collar and plug as separate named parts.",
        "Create pivot nodes, the centre and valve sockets and the sphere collider proxy before "
        "visual polish.",
        "Open the seam grooves by insetting each panel 0.55 degrees at both meridian edges over the "
        "darker core shell.",
        "Run reference PBR extraction on per-material crops, record its confidence, and decide "
        "explicitly whether to bind or only cite the maps.",
        "Add panel tone drift and groove darkening before any micro geometry.",
    ],
    animation_anchors=[
        "sculptRuntime.nodes['ball-core'] carries whole-object translation, rotation and scale",
        "sculptRuntime.sockets['ball-core:ball-center'] is the centre of mass",
        "sculptRuntime.sockets['ball-core:valve-pole'] anchors an inflate or deflate effect",
    ],
    destruction_anchors=["valve-assembly detaches as collar plus plug",
                         "the panel ring is not fractured; a burst would be a material state, not "
                         "a fracture"],
    risks=[
        "Single reference view: the rear panel's colour and the south pole are inferred.",
        "The reference silhouette is 2.2 percent taller than it is wide. That is reproducible with "
        "a vertical scale, but it would push the visual outside the trap's spherical collider, so "
        "it is deliberately not reproduced and the render will read 2.2 percent short.",
        "Panel count rests on a longitude solve that assumes the valve marks the true pole. If the "
        "valve is offset from the pole, the solved elevation and therefore the panel count move.",
        "One refine-code edit to the generated factory is required and is not expressible through "
        "the generator as shipped: buildLatheGeometry must honour latheProfile.phiStart and "
        "phiLength, which the spec already carries. Without it every panel is a full revolution "
        "and only the last one drawn is visible.",
        "Reference PBR maps were extracted and passed their confidence gate but are deliberately "
        "not bound to the runtime material; the runtime uses independent procedural canvas maps so "
        "the prop stays self-contained.",
    ],
)


if __name__ == "__main__":
    write_spec(OUT, SPEC)
