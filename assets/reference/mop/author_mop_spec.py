#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the robot mop.

Generated rather than hand-edited because every component carries a topology
classification, a colour recipe, an action profile and evidence links, and that is
too repetitive to keep correct by hand.

Every dimension traces to evidence/measurements.json, evidence/profile.json or
evidence/ellipse-fit.json. The derivation is recorded in `measurementBasis` so a later
session can re-check it rather than trusting these numbers.

Run:  python author_mop_spec.py
Writes: mop-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "mop-reference.png")
OUT = HERE / "mop-sculpt-spec.json"
ASSESSMENT = HERE / "assessment.json"
PBR_DIR = HERE / "evidence" / "pbr"
CROP_DIR = HERE / "evidence" / "crops"

# ---------------------------------------------------------------------------
# Measured geometry.
#
# Scale: the silhouette's widest half-width is 470 reference pixels and is authored as
# the collider radius, 0.36 world units, so 1 world unit = 1305.6 reference pixels.
# The mop is authored directly in game units with its base at y = 0, which is the
# convention every other trap prop follows (AssetModel is then offset down by the
# collider half-height).
#
# Camera: elevation 29.46 degrees, solved from the top deck's ellipse. The deck is a
# circle, so its projected minor/major ratio is sin(elevation): 387/787 = 0.4917.
# The solve is self-consistent to the pixel (787 * 0.4917 = 387.0). Azimuth is not
# observable from a solid of revolution; it is fixed by the button and the front latch,
# which both sit on one centreline, so the reference view is azimuth 0 with front = +Z.
# ---------------------------------------------------------------------------
PX_PER_UNIT = 1305.6

R_MAX = 0.36            # navy bumper outer and fringe outer; equals the trap's MOP_RADIUS
R_CREAM = 0.3512        # cream shell max radius (458.5px of 470px)
R_DECK = 0.3013         # mint deck radius (393.5px of 470px)

# Height over diameter. The analytic solve is weakly conditioned: fitting the top and
# bottom cap ellipses gives 0.196 with an admissible band of [0.194, 0.298], because the
# bottom cap is the ragged fringe rather than a clean ellipse (fit RMS 82px). 0.22 is the
# authored starting proportion; the blockout pass sweeps vertical scale against
# silhouette IoU and VS below records the result, exactly as the toaster did for its own
# 14 percent height error.
HEIGHT_OVER_DIAMETER = 0.22
VS = 1.0                # vertical-scale correction from the blockout sweep

HEIGHT = R_MAX * 2 * HEIGHT_OVER_DIAMETER * VS   # 0.1584 before any sweep correction

# Vertical layout as fractions of HEIGHT, read off the front centre column where the
# band order is unambiguous (screen rows 823-1042 below the deck's near edge).
FRINGE_TOP_F = 0.230        # cream shell's lower edge; tufts hang from here to y = 0
LOWER_WALL_TOP_F = 0.330
BAND_BOTTOM_F = 0.330
BAND_TOP_F = 0.570
DECK_PLANE_F = 0.960
RIM_CROWN_F = 1.000

Y_FRINGE_TOP = HEIGHT * FRINGE_TOP_F
Y_BAND_BOTTOM = HEIGHT * BAND_BOTTOM_F
Y_BAND_TOP = HEIGHT * BAND_TOP_F
Y_BAND_MID = (Y_BAND_BOTTOM + Y_BAND_TOP) / 2.0
Y_DECK = HEIGHT * DECK_PLANE_F
Y_CROWN = HEIGHT * RIM_CROWN_F

BAND_THICKNESS = Y_BAND_TOP - Y_BAND_BOTTOM
BAND_PROUD = R_MAX - R_CREAM      # 0.0088: how far the bumper stands off the shell wall

# Button. Bounding box 134 x 71 px gives radius 67px = 0.0513 world. Its centre sits
# 112 screen px above the deck's projected centre; at fixed height that is a pure depth
# offset, z = -112 / (sin(e) * PX_PER_UNIT) = -0.1745, i.e. 58 percent of the deck
# radius toward the BACK, on the centreline (its centre x matches the deck's to 0.5px).
BUTTON_R = 0.0513
BUTTON_Z = -0.1745
BUTTON_H = 0.0110

# Bumper segments. Gaps are measured on the front: the two visible slots sit at
# x = 350 and x = 730 against a centre of 540 and a radius of 470, so
# sin(theta) = +/-0.404 and theta = +/-23.8 degrees. The front segment therefore spans
# about 48 degrees. The rear gap and the rear segment are NOT visible in this view and
# are an inference from the symmetry of the two that are.
GAP_HALF_DEG = 2.5
SEGMENTS_DEG = [
    ("bumper-front", -21.5, 21.5, 0.9, "Front segment, both ends measured from the visible gaps."),
    ("bumper-right", 26.5, 153.5, 0.55, "Right segment; its front end is measured, its rear end is inferred."),
    ("bumper-rear", 158.5, 201.5, 0.3, "Rear segment; entirely inferred from front/side symmetry, not visible."),
    ("bumper-left", 206.5, 333.5, 0.55, "Left segment; its front end is measured, its rear end is inferred."),
]

# Latch recess, centred on the front centreline below the bumper.
LATCH_W, LATCH_H, LATCH_DEPTH = 0.184, 0.054, 0.012
LATCH_Y = HEIGHT * 0.265

# Fringe. Reference tufts are about 14px across (0.0107 world) and there are roughly 200
# per row. Building them at reference density would cost far more than the whole prop's
# triangle budget, so the fringe is a deliberate stylisation: fewer, larger tufts that
# preserve the scalloped silhouette, which is the identity-defining property.
FRINGE_OUTER_COUNT = 88
FRINGE_INNER_COUNT = 56
FRINGE_TUFT_D = 0.0190
FRINGE_OUTER_R = R_MAX - FRINGE_TUFT_D * 0.45
FRINGE_INNER_R = FRINGE_OUTER_R - FRINGE_TUFT_D * 0.85
FRINGE_OUTER_Y = Y_FRINGE_TOP * 0.52
FRINGE_INNER_Y = Y_FRINGE_TOP * 0.62

EVIDENCE_FULL = "full-object"


# ---------------------------------------------------------------------------
# profile helpers
# ---------------------------------------------------------------------------
def lathe(points: list[tuple[float, float]], segments: int) -> dict:
    """geometryDescriptor.latheProfile payload consumed by buildLatheGeometry.

    LatheGeometry revolves (x=radius, y=height) about Y, so the profile is authored in
    world units and the component's transform.scale stays 1.
    """
    return {
        "points": [[round(r, 5), round(y, 5)] for r, y in points],
        "segments": segments,
    }


def arc_spine(start_deg: float, end_deg: float, radius: float, y: float, steps: int = 14):
    """Sample an arc for a curve-sweep spine, in world units.

    Angle 0 is +Z (the front, where the latch is) and increases toward +X, which is the
    same convention the bumper gap measurements were taken in.
    """
    points = []
    for index in range(steps + 1):
        t = index / steps
        angle = math.radians(start_deg + (end_deg - start_deg) * t)
        points.append([
            round(math.sin(angle) * radius, 5),
            round(y, 5),
            round(math.cos(angle) * radius, 5),
        ])
    return points


def rounded_section(half_height: float, half_depth: float, corner: float, steps: int = 3):
    """A stadium-ish cross-section for the bumper: a flat outer face with generous top
    and bottom fillets, which is what the 2x gap crop shows. Authored counter-clockwise
    in the sweep's local (x = outward, y = up) plane."""
    points: list[tuple[float, float]] = []
    inner, outer = -half_depth, half_depth
    top, bottom = half_height, -half_height
    points.append((inner, bottom + corner))
    points.append((inner, top - corner))
    for index in range(1, steps + 1):
        angle = math.pi * 0.5 * index / (steps + 1)
        points.append((inner + corner * (1 - math.cos(angle)), top - corner + corner * math.sin(angle)))
    points.append((outer - corner, top))
    for index in range(1, steps + 1):
        angle = math.pi * 0.5 * index / (steps + 1)
        points.append((outer - corner + corner * math.sin(angle), top - corner + corner * math.cos(angle)))
    points.append((outer, bottom + corner))
    for index in range(1, steps + 1):
        angle = math.pi * 0.5 * index / (steps + 1)
        points.append((outer - corner + corner * math.cos(angle), bottom + corner - corner * math.sin(angle)))
    points.append((inner + corner, bottom))
    for index in range(1, steps + 1):
        angle = math.pi * 0.5 * index / (steps + 1)
        points.append((inner + corner - corner * math.sin(angle), bottom + corner - corner * math.cos(angle)))
    return [[round(x, 5), round(y, 5)] for x, y in points]


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def pbr_provenance(material_id: str, confidence: float) -> dict:
    channels = ("albedo", "roughness", "height", "normal", "ao")
    return {
        "version": "1.0",
        "sourceImage": str(CROP_DIR / f"{material_id}-crop.png"),
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": "pass",
        "confidence": confidence,
        "estimatedFidelity": confidence,
        "targetThreshold": 0.7,
        "hardLimit": (
            "A single image cannot uniquely recover true albedo/roughness/normal/AO; these "
            "maps are reference-derived estimates."
        ),
        "limitationNote": PBR_NOTE,
        "maps": {
            channel: {
                "path": str(PBR_DIR / f"{material_id}_{channel}.png"),
                "channel": channel,
                "source": "reference-pixel-extraction",
            }
            for channel in channels
        },
    }


PBR_NOTE = (
    "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk "
    "path, which cannot load in a browser, so binding them would break the runtime asset. "
    "The reference is also a soft studio render of flat matte plastic with no surface "
    "pattern, so the crops carry baked lighting rather than albedo; tiling them would "
    "paint the reference's own shading onto every facet. The runtime instead builds "
    "independent procedural canvas maps and the extracted palettes and roughness "
    "estimates are used as evidence for the scalars below."
)


def material(
    mid: str,
    name: str,
    base: str,
    palette: list[str],
    rough_base: float,
    rough_var: float,
    ao_cavity: float,
    confidence: float,
    overrides: list[dict],
    notes: str,
    shader_model: str,
) -> dict:
    return {
        "id": mid,
        "name": name,
        "type": "physical",
        "shaderModel": shader_model,
        "baseColor": base,
        "color": base,
        "albedo": {
            "dominant": base,
            "secondary": palette[1:],
            "samplingNotes": (
                "Median-sampled from the named region of the reference and cross-checked "
                "against the magnified crop. The sampled values are lit pixels, so the "
                "authored albedo is darkened from the sample to remove the key light's "
                "contribution."
            ),
            "textureStrategy": "procedural canvas albedo with low-amplitude mottle",
        },
        "roughness": {
            "base": rough_base,
            "variation": rough_var,
            # Must not name albedo: the validator rejects a roughness map whose description
            # mentions it, because aliasing albedo into roughness is the classic PBR error.
            "map": "independent-procedural-field",
            "localResponse": (
                "recesses and the gaps between tufts trend rougher; convex crowns trend "
                "marginally smoother, though nothing on this prop becomes glossy"
            ),
        },
        "metalness": 0.0,
        "normal": {
            "pattern": "derived-from-independent-height-field",
            "strength": 0.16,
            "scale": 20.0,
            "space": "tangent",
        },
        "ambientOcclusion": {
            "cavityStrength": ao_cavity,
            "contactShadowBias": 0.3,
            "notes": (
                "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper "
                "gaps, the latch recess and the roots between fringe tufts."
            ),
        },
        "surfaceFrequencyBands": [
            {"id": "macro", "frequency": 3.0, "amplitude": 0.28,
             "role": "broad tone drift across a moulded panel"},
            {"id": "meso", "frequency": 15.0, "amplitude": 0.14,
             "role": "shallow moulding flow and sink-mark relief"},
            {"id": "micro", "frequency": 60.0, "amplitude": 0.05,
             "role": "matte-texture breakup that only reads under grazing light"},
        ],
        "textureResolution": 1024,
        "textureProjection": {
            "mode": "triplanar-world",
            "texelDensityIntent": (
                "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel "
                "at gameplay distance and only reads under review framing"
            ),
        },
        "localOverrides": overrides,
        "referencePbr": pbr_provenance(mid, confidence),
        "notes": notes,
    }


MATERIALS = [
    material(
        "shell-cream",
        "Cream shell ABS",
        "#e6dccb",
        ["#e6dccb", "#f2ece0", "#cfc4b2"],
        0.62,
        0.08,
        0.55,
        0.83,
        [
            {
                "id": "under-rim-occlusion",
                "kind": "ambient-occlusion",
                "region": "cream wall directly beneath the rim overhang and inside each bumper gap",
                "aoStrength": 0.8,
                "roughness": 0.66,
                "notes": (
                    "The cream under the rim reads 12-18 levels darker than the lit crown. It is "
                    "contact occlusion, not a change of colour, so it is an AO override rather "
                    "than a second albedo."
                ),
            },
            {
                "id": "rim-crown-lightening",
                "kind": "albedo",
                "region": "the convex crown of the rim where the key light grazes it",
                "color": "#f4eee3",
                "roughness": 0.58,
                "notes": (
                    "A broad soft sheen, not a specular hotspot: the rim is the same matte "
                    "plastic and only its curvature makes it brighter."
                ),
            },
        ],
        "Matte injection-moulded ABS. No clearcoat anywhere: the reference has no specular hotspot on any surface.",
        "MeshPhysicalMaterial (matte injection-moulded ABS)",
    ),
    material(
        "deck-mint",
        "Mint deck ABS",
        "#9cc4ab",
        ["#9cc4ab", "#a9ceb7", "#8bb59c"],
        0.66,
        0.06,
        0.5,
        0.85,
        [
            {
                "id": "button-contact-shadow",
                "kind": "ambient-occlusion",
                "region": "a tight arc on the deck hugging the button's base",
                "aoStrength": 0.9,
                "roughness": 0.68,
                "notes": (
                    "Strongest at the button's left and right where the deck turns away from the "
                    "key. Visible as a 2-4px dark rim in the 3x button crop."
                ),
            }
        ],
        "The largest single colour field in the reference and the one a viewer identifies the prop by.",
        "MeshPhysicalMaterial (matte injection-moulded ABS)",
    ),
    material(
        "bumper-navy",
        "Navy bumper elastomer",
        "#3a4150",
        ["#3a4150", "#404650", "#2f3542"],
        0.74,
        0.07,
        0.6,
        0.8,
        [
            {
                "id": "segment-gap-occlusion",
                "kind": "ambient-occlusion",
                "region": "the rounded end caps where each segment meets its cream gap",
                "aoStrength": 0.85,
                "roughness": 0.78,
                "notes": "Darkens the end caps so the gaps read as real slots rather than painted lines.",
            }
        ],
        "Soft-touch matte elastomer, noticeably rougher than the ABS shell and with no sheen at all.",
        "MeshPhysicalMaterial (soft-touch matte elastomer)",
    ),
    material(
        "button-coral",
        "Coral button ABS",
        "#e0665f",
        ["#e0665f", "#ec7e79", "#c9544e"],
        0.6,
        0.06,
        0.5,
        0.82,
        [],
        (
            "The only saturated accent on the prop. Deliberately distinct from PALETTE.danger "
            "(#b3123c), which is reserved for hazard ground markers and must never appear on a prop."
        ),
        "MeshPhysicalMaterial (matte injection-moulded ABS)",
    ),
    material(
        "fringe-grey",
        "Microfibre fringe",
        "#a8a49f",
        ["#a8a49f", "#b0aca8", "#918d88"],
        0.92,
        0.05,
        0.75,
        0.71,
        [
            {
                "id": "tuft-root-occlusion",
                "kind": "ambient-occlusion",
                "region": "between adjacent tufts and where each tuft meets the shell underside",
                "aoStrength": 0.95,
                "roughness": 0.94,
                "notes": "Self-shadowing between tufts is most of what makes the fringe read as fibrous.",
            }
        ],
        (
            "Flocked microfibre: the roughest material on the prop and fully diffuse. Its "
            "extraction confidence is the lowest of the five because the crop is small and "
            "sits against the backdrop."
        ),
        "MeshPhysicalMaterial (flocked microfibre, fully diffuse)",
    ),
]


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
def action_profile(
    role: str,
    pivot_axis: list[float],
    sockets: list[dict],
    collider: dict | None,
    fracture_group: str,
    rotate: bool = False,
    translate: bool = False,
) -> dict:
    return {
        "animationRole": role,
        "pivot": {
            "mode": "socket",
            "localPosition": [0.0, 0.0, 0.0],
            "axis": pivot_axis,
            "confidence": 0.8,
        },
        "transformChannels": {
            "translate": translate,
            "rotate": rotate,
            "scale": False,
            "bend": False,
            "twist": False,
            "detach": True,
            "visibility": True,
            "materialState": True,
        },
        "sockets": sockets,
        "collider": collider,
        "constraints": [],
        "destruction": {
            "breakable": False,
            "fractureGroup": fracture_group,
            "seamRefs": [],
            "detachableFragments": [],
            "breakImpulse": 0.0,
            "debrisMaterial": "shell-cream",
        },
    }


def component(
    cid: str,
    name: str,
    level: str,
    role: str,
    primitive: str,
    topology_class: str,
    topology_rationale: str,
    descriptor: dict,
    parent: str | None,
    dimensions: dict,
    transform: dict,
    material_id: str,
    profile: dict,
    recipe: dict,
    local_features: list[dict],
    seams: list[dict],
    importance: float,
    confidence: float,
    evidence: list[str],
    notes: str,
    attachment: dict | None = None,
    scale: list[float] | None = None,
) -> dict:
    return {
        "id": cid,
        "name": name,
        "level": level,
        "role": role,
        "importance": importance,
        "confidence": confidence,
        "primitive": primitive,
        "topologyClass": topology_class,
        "topologyRationale": topology_rationale,
        "colorMaterialRecipe": recipe,
        "geometryDescriptor": descriptor,
        "parent": parent,
        "attachment": attachment,
        "dimensions": dimensions,
        "transform": {
            "position": [round(v, 5) for v in transform["position"]],
            "rotation": [round(v, 5) for v in transform.get("rotation", [0.0, 0.0, 0.0])],
            "scale": [round(v, 5) for v in (scale or [1.0, 1.0, 1.0])],
        },
        "actionProfile": profile,
        "material": material_id,
        "materialLayers": [material_id],
        "deformations": [],
        "joints": [],
        "seams": seams,
        "localFeatures": local_features,
        "evidenceRefs": evidence,
        "notes": notes,
    }


def recipe(dominant: str, secondary: str, material_class: str, confidence: float) -> dict:
    return {
        "dominantAlbedo": dominant,
        "secondaryAlbedo": secondary,
        "materialClass": material_class,
        "materialClassConfidence": confidence,
    }


# --- shell lathe profile ---------------------------------------------------
# Bottom to top. The profile doubles back at the top so the rim's inner lip and the
# recess the deck sits in are part of the same revolved surface, which is how the
# reference reads: the deck is recessed inside a raised cream lip, not laid on top.
SHELL_PROFILE = [
    (0.0000, Y_FRINGE_TOP - 0.0020),
    (0.2400, Y_FRINGE_TOP - 0.0020),
    (0.3000, Y_FRINGE_TOP + 0.0004),
    (R_CREAM * 0.900, Y_FRINGE_TOP + 0.0040),
    (R_CREAM * 0.949, Y_BAND_BOTTOM),
    (R_CREAM * 0.985, Y_BAND_BOTTOM + BAND_THICKNESS * 0.35),
    (R_CREAM * 1.000, Y_BAND_MID),
    (R_CREAM * 0.998, Y_BAND_TOP),
    (R_CREAM * 0.982, Y_BAND_TOP + (Y_DECK - Y_BAND_TOP) * 0.30),
    (R_CREAM * 0.955, Y_BAND_TOP + (Y_DECK - Y_BAND_TOP) * 0.58),
    (R_CREAM * 0.912, Y_BAND_TOP + (Y_DECK - Y_BAND_TOP) * 0.80),
    (R_CREAM * 0.878, Y_DECK),
    (R_CREAM * 0.868, Y_CROWN - 0.0016),
    (R_DECK + 0.0031, Y_CROWN),
    (R_DECK + 0.0027, Y_CROWN - 0.0020),
    (R_DECK + 0.0022, Y_DECK + 0.0008),
    (R_DECK - 0.0060, Y_DECK - 0.0018),
    (R_DECK * 0.55, Y_DECK - 0.0020),
    (0.0000, Y_DECK - 0.0020),
]

DECK_PROFILE = [
    (0.0000, Y_DECK - 0.0018),
    (R_DECK - 0.0090, Y_DECK - 0.0018),
    (R_DECK - 0.0016, Y_DECK - 0.0006),
    (R_DECK, Y_DECK + 0.0009),
    (R_DECK - 0.0028, Y_DECK + 0.0021),
    (R_DECK * 0.72, Y_DECK + 0.0028),
    (R_DECK * 0.55, Y_DECK + 0.0030),
    (0.0000, Y_DECK + 0.0030),
]

BUTTON_PROFILE = [
    (0.0000, Y_DECK + 0.0026),
    (BUTTON_R * 0.94, Y_DECK + 0.0026),
    (BUTTON_R, Y_DECK + 0.0034),
    (BUTTON_R, Y_DECK + BUTTON_H - 0.0022),
    (BUTTON_R - 0.0016, Y_DECK + BUTTON_H - 0.0007),
    (BUTTON_R - 0.0042, Y_DECK + BUTTON_H),
    (BUTTON_R * 0.5, Y_DECK + BUTTON_H + 0.0004),
    (0.0000, Y_DECK + BUTTON_H + 0.0004),
]


def build_components() -> list[dict]:
    components: list[dict] = []

    components.append(component(
        "shell-body", "Cream shell body", "macro", "structure", "lathe",
        "continuous-sculpt",
        "One continuously revolved cream surface: the reference shows an unbroken curve from "
        "the base, out to the widest wall, over the rim crown and back down into the deck "
        "recess, with no crease anywhere along it.",
        {
            "topologyIntent": "solid of revolution carrying the wall taper, the rim crown and the deck recess",
            "edgeTreatment": {"type": "filleted", "bevelRadius": 0.004, "segments": 3},
            "deformationStack": [],
            "uvStrategy": "LatheGeometry cylindrical UVs",
            "normalStrategy": "smooth vertex normals along the profile, so the rim reads as a curve",
            "latheProfile": lathe(SHELL_PROFILE, 48),
        },
        None,
        {"width": R_CREAM * 2, "height": Y_CROWN - Y_FRINGE_TOP, "depth": R_CREAM * 2,
         "units": "world", "confidence": 0.7},
        {"position": [0.0, 0.0, 0.0]},
        "shell-cream",
        action_profile("root", [0.0, 1.0, 0.0], [
            {"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0],
             "localRotation": [0.0, 0.0, 0.0],
             "notes": "Model base. The trap offsets the whole prop down by its collider half-height from here."},
        ], {
            "type": "cylinder", "offset": [0.0, HEIGHT / 2, 0.0],
            "scale": [R_MAX * 2, HEIGHT, R_MAX * 2], "isTrigger": False,
            "notes": "Matches the trap's CylinderCollider(MOP_HALF_HEIGHT, MOP_RADIUS).",
        }, "chassis"),
        recipe("rgba(230, 220, 203, 1.0)", "rgba(207, 196, 178, 1.0)", "plastic", 0.9),
        [
            {"id": "wall-taper",
             "description": "Below the bumper the wall draws inward toward the base; the silhouette "
                            "half-width falls from 470px at the band to roughly 440px near the floor.",
             "kind": "contour"},
            {"id": "base-underside",
             "description": "A flat underside disc that closes the shell; never seen in the reference "
                            "and carried at low confidence.",
             "kind": "contour"},
        ],
        [{"id": "deck-seat-seam", "with": "deck-plate",
          "notes": "The deck sits into the recess this profile turns back down to form."}],
        1.0, 0.75, [EVIDENCE_FULL, "side-profile"],
        "Authored base-at-origin in game units so the prop needs no rescaling to fit its collider.",
    ))

    components.append(component(
        "shell-rim", "Raised rim lip", "meso", "trim", "lathe",
        "continuous-sculpt",
        "The crown between the deck seam and the outer wall is a smooth convex band in the "
        "reference, catching one broad soft highlight with no facet break across it.",
        {
            "topologyIntent": "convex annular crown standing proud of the recessed deck",
            "edgeTreatment": {"type": "filleted", "bevelRadius": 0.003, "segments": 3},
            "deformationStack": [],
            "uvStrategy": "LatheGeometry cylindrical UVs",
            "normalStrategy": "smooth vertex normals",
            "latheProfile": lathe([
                (R_DECK + 0.0026, Y_DECK + 0.0010),
                (R_DECK + 0.0034, Y_CROWN - 0.0012),
                (R_DECK + 0.0090, Y_CROWN),
                (R_CREAM * 0.868, Y_CROWN - 0.0018),
                (R_CREAM * 0.878, Y_DECK),
            ], 48),
        },
        "shell-body",
        {"width": (R_CREAM * 0.878) * 2, "height": Y_CROWN - Y_DECK, "depth": (R_CREAM * 0.878) * 2,
         "units": "world", "confidence": 0.6},
        {"position": [0.0, 0.0, 0.0]},
        "shell-cream",
        action_profile("static", [0.0, 1.0, 0.0], [], None, "chassis"),
        recipe("rgba(244, 238, 227, 1.0)", "rgba(230, 220, 203, 1.0)", "plastic", 0.88),
        [
            {"id": "rim-inner-lip",
             "description": "The cream rises above the mint deck as a raised lip, so the deck reads "
                            "as recessed; visible as a bright crown line along the far rim.",
             "kind": "ridge"},
            {"id": "rim-crown-sheen",
             "description": "A broad soft value gradient across the crown from curvature alone, not a "
                            "specular hotspot.",
             "kind": "contour"},
        ],
        [{"id": "rim-shell-seam", "with": "shell-body", "notes": "Coincident revolved surfaces; no visible seam."}],
        0.75, 0.6, [EVIDENCE_FULL, "rim-zone"],
        "Split out from the shell so the crown can be reviewed and re-profiled without touching the wall.",
    ))

    components.append(component(
        "deck-plate", "Mint top deck", "meso", "panel", "lathe",
        "continuous-sculpt",
        "A single revolved disc with a very slight crown and a rolled edge; the reference "
        "shows a continuous tone across it with no flat-to-wall crease.",
        {
            "topologyIntent": "shallow crowned disc seated in the rim recess",
            "edgeTreatment": {"type": "filleted", "bevelRadius": 0.0016, "segments": 2},
            "deformationStack": [],
            "uvStrategy": "LatheGeometry cylindrical UVs",
            "normalStrategy": "smooth vertex normals",
            "latheProfile": lathe(DECK_PROFILE, 48),
        },
        "shell-body",
        {"width": R_DECK * 2, "height": 0.0048, "depth": R_DECK * 2, "units": "world", "confidence": 0.85},
        {"position": [0.0, 0.0, 0.0]},
        "deck-mint",
        action_profile("static", [0.0, 1.0, 0.0], [
            {"id": "deck-centre", "localPosition": [0.0, Y_DECK + 0.003, 0.0],
             "localRotation": [0.0, 0.0, 0.0], "notes": "Deck surface centre; anchor for any decal."},
        ], None, "chassis"),
        recipe("rgba(156, 196, 171, 1.0)", "rgba(139, 181, 156, 1.0)", "plastic", 0.92),
        [
            {"id": "deck-rim-seam",
             "description": "A fine dark groove where the mint deck meets the cream rim, running the "
                            "full circumference at 83.7 percent of the plan radius.",
             "kind": "seam"},
            {"id": "deck-crown",
             "description": "The deck is very slightly domed rather than dead flat, which is why its "
                            "tone brightens toward the key side.",
             "kind": "contour"},
        ],
        [{"id": "deck-seat-seam", "with": "shell-body", "notes": "Deck edge against the rim's inner lip."}],
        0.95, 0.85, [EVIDENCE_FULL, "deck-zone"],
        "Largest single colour field and the strongest identity cue after the overall disc proportion.",
    ))

    components.append(component(
        "power-button", "Coral power button", "meso", "control", "lathe",
        "assembled-solid",
        "A separately moulded disc sitting on the deck with its own filleted rim and a "
        "visible contact shadow around its base, not a printed circle.",
        {
            "topologyIntent": "shallow filleted disc button seated in a slight recess",
            "edgeTreatment": {"type": "filleted", "bevelRadius": 0.0022, "segments": 3},
            "deformationStack": [],
            "uvStrategy": "LatheGeometry cylindrical UVs",
            "normalStrategy": "smooth vertex normals with a crease held at the fillet tangent",
            "latheProfile": lathe(BUTTON_PROFILE, 32),
        },
        "deck-plate",
        {"width": BUTTON_R * 2, "height": BUTTON_H, "depth": BUTTON_R * 2, "units": "world", "confidence": 0.8},
        {"position": [0.0, 0.0, BUTTON_Z]},
        "button-coral",
        action_profile("presser", [0.0, 1.0, 0.0], [
            {"id": "button-top", "localPosition": [0.0, Y_DECK + BUTTON_H, BUTTON_Z],
             "localRotation": [0.0, 0.0, 0.0], "notes": "Press target; travels down the deck normal."},
        ], {
            "type": "cylinder", "offset": [0.0, Y_DECK + BUTTON_H / 2, BUTTON_Z],
            "scale": [BUTTON_R * 2, BUTTON_H, BUTTON_R * 2], "isTrigger": True,
            "notes": "Press proxy.",
        }, "control", translate=True),
        recipe("rgba(224, 102, 95, 1.0)", "rgba(201, 84, 78, 1.0)", "plastic", 0.9),
        [
            {"id": "button-edge-fillet",
             "description": "The top face meets the side wall through a soft fillet that catches a "
                            "light band around the button's upper rim.",
             "kind": "bevel"},
            {"id": "button-recess-ring",
             "description": "The side wall is slightly wider at the top than at the bottom, so the "
                            "button reads as seated in a shallow recess rather than stuck on.",
             "kind": "contour"},
        ],
        [{"id": "button-deck-seam", "with": "deck-plate", "notes": "Button base against the deck surface."}],
        0.85, 0.8, [EVIDENCE_FULL, "deck-zone"],
        "Offset 0.1745 toward the back on the centreline, measured from its 112px screen offset.",
    ))

    # --- bumper band group and its four segments ---------------------------
    components.append(component(
        "bumper-band", "Segmented bumper band", "meso", "trim", "lathe",
        "material-only",
        "A grouping node only. It owns the band's shared local features and carries no "
        "geometry of its own, so the four segments below stay independently pickable.",
        {
            "topologyIntent": "grouping node for the four bumper segments",
            "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
            "deformationStack": [],
            "uvStrategy": "none",
            "normalStrategy": "none",
            "latheProfile": lathe([(0.0001, Y_BAND_MID), (0.0002, Y_BAND_MID + 0.0001)], 3),
        },
        "shell-body",
        {"width": R_MAX * 2, "height": BAND_THICKNESS, "depth": R_MAX * 2, "units": "world", "confidence": 0.7},
        {"position": [0.0, 0.0, 0.0]},
        "bumper-navy",
        action_profile("static", [0.0, 1.0, 0.0], [], None, "bumper"),
        recipe("rgba(58, 65, 80, 1.0)", "rgba(47, 53, 66, 1.0)", "rubber", 0.85),
        [
            {"id": "segment-gap",
             "description": "Narrow cream slots split the navy into segments; the two on the front "
                            "half are measured at plus and minus 23.8 degrees.",
             "kind": "groove"},
            {"id": "segment-end-cap",
             "description": "Each segment terminates in a generously rounded end cap rather than a "
                            "square cut.",
             "kind": "bevel"},
            {"id": "segment-standoff",
             "description": "The band stands 0.0088 proud of the cream wall and casts its own soft "
                            "shadow onto it; it is an applied bumper, not a painted stripe.",
             "kind": "ridge"},
        ],
        [],
        0.9, 0.65, [EVIDENCE_FULL, "bumper-zone"],
        "A named group of named parts stays a container under the assembly gate, which is what this is.",
    ))

    section = rounded_section(BAND_THICKNESS / 2, (BAND_PROUD + 0.0065) / 2, BAND_THICKNESS * 0.34)
    for cid, start_deg, end_deg, confidence, note in SEGMENTS_DEG:
        # Seated so the band's OUTER face lands on R_MAX, not its centreline. At
        # R_CREAM + BAND_PROUD * 0.42 the section's outer half pushed the prop to 0.7251
        # across against the trap's 0.72 CylinderCollider - only 0.0025 a side, but the
        # bumper is the widest thing on the mop and the widest thing is exactly what a
        # collider contract is about.
        spine_radius = R_MAX - (BAND_PROUD + 0.0065) / 2
        components.append(component(
            # A PARTIAL LATHE, not a curve-sweep. The band is a constant-radius arc at a
            # constant height, which is a partial surface of revolution and nothing more;
            # a swept cross-section was always the more general tool than the shape needs.
            # It is also the only one that works here: curve-sweep is an ATTACHMENT_PRIMITIVE,
            # so the validator requires attachment.localStart/localEnd, and those two fields
            # put the generator on its appendage path, which drops geometryDescriptor
            # entirely and rebuilds each segment as a straight bar between the endpoints.
            # Measured that way the four segments were 0.12-thick blocks and the prop went
            # to 0.7804 deep against the trap's 0.72 cylinder. phiStart/phiLength are
            # already honoured by refine_props.py's buildLatheGeometry, which the beach
            # ball's gores needed first.
            cid, cid.replace("-", " ").title(), "meso", "trim", "lathe",
            "conforming-shell",
            "An applied band that follows the shell wall's curvature at a constant standoff. "
            "Constant radius and constant height over its arc, so it is a partial revolution "
            "of the band's own section rather than a sweep along a free 3D spine.",
            {
                "topologyIntent": "band section revolved through the segment's own arc",
                "edgeTreatment": {"type": "filleted", "bevelRadius": BAND_THICKNESS * 0.34, "segments": 3},
                "deformationStack": [],
                "uvStrategy": "lathe UVs",
                "normalStrategy": "smooth normals around the section, creased at the arc ends",
                "latheProfile": {
                    "points": [[round(spine_radius + sx, 5), round(Y_BAND_MID + sy, 5)]
                               for sx, sy in section],
                    "segments": max(8, int(round(abs(end_deg - start_deg) / 4.0))),
                    "phiStart": round(math.radians(start_deg), 5),
                    "phiLength": round(math.radians(end_deg - start_deg), 5),
                },
            },
            "bumper-band",
            {"width": R_MAX * 2, "height": BAND_THICKNESS, "depth": R_MAX * 2,
             "units": "world", "confidence": confidence},
            {"position": [0.0, 0.0, 0.0]},
            "bumper-navy",
            action_profile("static", [0.0, 1.0, 0.0], [], {
                "type": "box",
                "offset": [0.0, Y_BAND_MID, 0.0],
                "scale": [R_MAX * 2, BAND_THICKNESS, R_MAX * 2],
                "isTrigger": False,
                "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop.",
            }, "bumper"),
            recipe("rgba(58, 65, 80, 1.0)", "rgba(47, 53, 66, 1.0)", "rubber", 0.85),
            [],
            [{"id": f"{cid}-shell-seam", "with": "shell-body",
              "notes": "Band inner face against the cream wall."}],
            0.8, confidence, [EVIDENCE_FULL, "bumper-zone"],
            note,
            # NO attachment record at all. An attachment without localStart/localEnd is
            # worse than none: makeAttachmentEndpoint still returns an endpoint, defaulted
            # to a unit segment, and the generator then builds a CylinderGeometry from it
            # and ignores latheProfile entirely - which is how these came out as 0.12 by
            # 1.00 by 0.12 posts. With the primitive now a lathe, neither the role, the
            # name nor the primitive is an attachment trigger, so the record is not
            # required; the contact it described is already in the shell seam below and
            # the arc is fully described by phiStart/phiLength.
        ))

        for end_name, angle in (("start", start_deg), ("end", end_deg)):
            components.append(component(
                f"{cid}-cap-{end_name}", f"{cid.replace('-', ' ').title()} {end_name} cap",
                "micro", "trim", "sphere",
                "assembled-solid",
                "The band's terminations are rounded blobs in the reference, so each is its own "
                "small solid rather than the flat cut an open sweep would leave.",
                {
                    "topologyIntent": "rounded end cap closing the swept band",
                    "edgeTreatment": {"type": "filleted", "bevelRadius": 0.0, "segments": 1},
                    "deformationStack": [],
                    "uvStrategy": "spherical",
                    "normalStrategy": "smooth vertex normals",
                },
                cid,
                {"width": BAND_PROUD + 0.0065, "height": BAND_THICKNESS, "depth": BAND_THICKNESS,
                 "units": "world", "confidence": confidence * 0.9},
                {"position": [round(math.sin(math.radians(angle)) * spine_radius, 5),
                              round(Y_BAND_MID, 5),
                              round(math.cos(math.radians(angle)) * spine_radius, 5)],
                 "rotation": [0.0, round(math.radians(angle), 5), 0.0]},
                "bumper-navy",
                action_profile("static", [0.0, 1.0, 0.0], [], None, "bumper"),
                recipe("rgba(58, 65, 80, 1.0)", "rgba(47, 53, 66, 1.0)", "rubber", 0.85),
                [],
                [{"id": f"{cid}-cap-{end_name}-seam", "with": cid, "notes": "Cap against the swept band end."}],
                0.45, confidence * 0.9, [EVIDENCE_FULL, "bumper-zone"],
                "Scaled to the band's own cross-section so the cap and the sweep share a silhouette.",
                scale=[BAND_PROUD + 0.0065, BAND_THICKNESS, BAND_THICKNESS],
            ))

    components.append(component(
        "latch-recess", "Front latch recess", "micro", "detail", "box",
        "surface-relief",
        "A stadium-shaped panel let into the cream wall. It is relief on the shell rather "
        "than a separate body, so it rides the shell when the model is exploded.",
        {
            "topologyIntent": "recessed stadium panel on the front lower wall",
            "edgeTreatment": {"type": "filleted", "bevelRadius": 0.006, "segments": 3},
            "deformationStack": ["inset along the wall normal by 0.012"],
            "uvStrategy": "planar on the wall tangent",
            "normalStrategy": "chamfered border normals so the recess edge catches light",
        },
        "shell-body",
        {"width": LATCH_W, "height": LATCH_H, "depth": LATCH_DEPTH, "units": "world", "confidence": 0.75},
        {"position": [0.0, LATCH_Y, R_CREAM * 0.952]},
        "shell-cream",
        action_profile("static", [0.0, 0.0, 1.0], [
            {"id": "bin-release", "localPosition": [0.0, LATCH_Y, R_CREAM * 0.97],
             "localRotation": [0.0, 0.0, 0.0], "notes": "Where a hand would pull the tank out."},
        ], None, "chassis"),
        recipe("rgba(236, 229, 216, 1.0)", "rgba(207, 196, 178, 1.0)", "plastic", 0.85),
        [
            {"id": "recess-outline",
             "description": "A stadium-shaped recessed panel centred on the front centreline, about "
                            "240 by 70 source pixels.",
             "kind": "groove"},
            {"id": "recess-chamfer",
             "description": "The recess is let in through a soft chamfer with a darker band along its "
                            "upper edge where the shell overhangs it.",
             "kind": "bevel"},
        ],
        [{"id": "latch-shell-seam", "with": "shell-body", "notes": "Recess border against the wall."}],
        0.55, 0.75, [EVIDENCE_FULL, "front-lower-zone"],
        "Marked surface relief so the assembly gate keeps it attached to the shell it is cut into.",
    ))

    components.append(component(
        # This carried a two-point lathe at radius 0.0002 and a "builds no geometry itself"
        # rationale, which had two consequences. The tuft rows are micro, so a macro
        # component that builds nothing left the blockout with no fringe at all: Tier 1
        # read silhouette IoU 0.819 and aspect delta 0.138 against a reference whose
        # bottom third IS the fringe. And in the finished model the tufts had nothing
        # behind them, so the band read as a picket line with the background showing
        # through the gaps rather than as dense microfibre. It is now a real backing
        # skirt, sized just inside the tuft ring so every tuft still stands proud of it.
        "fringe-skirt", "Microfibre fringe skirt", "macro", "structure", "lathe",
        "assembled-solid",
        "The solid backing band the tuft rows stand on. The reference fringe is opaque: no "
        "background shows between tufts anywhere around the rim, so there is a skirt behind "
        "them and the tufts are its surface relief rather than the whole part.",
        {
            "topologyIntent": "shallow revolved skirt filling the band between the shell's "
                              "underside and the floor, held just inside the tuft ring",
            "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1},
            "deformationStack": [],
            "uvStrategy": "lathe UVs",
            "normalStrategy": "vertex normals from the revolved profile",
            "latheProfile": lathe([
                (0.0001, Y_FRINGE_TOP),
                (FRINGE_INNER_R - FRINGE_TUFT_D * 0.5, Y_FRINGE_TOP),
                (FRINGE_OUTER_R - FRINGE_TUFT_D * 0.5, Y_FRINGE_TOP * 0.62),
                (FRINGE_OUTER_R - FRINGE_TUFT_D * 0.9, Y_FRINGE_TOP * 0.22),
                (FRINGE_OUTER_R - FRINGE_TUFT_D * 1.6, 0.0),
                (0.0001, 0.0),
            ], 40),
        },
        "shell-body",
        {"width": R_MAX * 2, "height": Y_FRINGE_TOP, "depth": R_MAX * 2, "units": "world", "confidence": 0.6},
        {"position": [0.0, 0.0, 0.0]},
        "fringe-grey",
        action_profile("spinner", [0.0, 1.0, 0.0], [
            {"id": "brush-ring", "localPosition": [0.0, Y_FRINGE_TOP * 0.5, 0.0],
             "localRotation": [0.0, 0.0, 0.0],
             "notes": "Spin the whole skirt about Y; the trap already animates a brush ring."},
        ], None, "skirt", rotate=True),
        recipe("rgba(168, 164, 159, 1.0)", "rgba(145, 141, 136, 1.0)", "fabric", 0.75),
        [
            {"id": "tuft-scallop",
             "description": "Individual rounded tufts give the bottom of the silhouette a scalloped "
                            "rather than a smooth outline; this is what makes it a mop and not a vacuum.",
             "kind": "contour"},
            {"id": "tuft-row-stagger",
             "description": "Two staggered rows, so the lower row shows through the gaps in the upper "
                            "one and the band reads dense rather than as a picket line.",
             "kind": "contour"},
        ],
        [{"id": "fringe-shell-seam", "with": "shell-body", "notes": "Tuft roots against the shell underside."}],
        0.9, 0.6, [EVIDENCE_FULL, "fringe-zone"],
        "Rotating this node is the cheapest way to animate the mop's brush action.",
    ))

    return components


def build_repetition_systems() -> list[dict]:
    # placement.radius is stored DOUBLED: the factory places instances at radius * 0.5.
    return [
        {
            "id": "fringe-tufts-outer",
            "name": "Outer microfibre tuft row",
            "level": "micro",
            "parent": "fringe-skirt",
            "count": FRINGE_OUTER_COUNT,
            "primitive": "instanced-cluster",
            "material": "fringe-grey",
            "instanceScale": [FRINGE_TUFT_D, FRINGE_TUFT_D * 1.15, FRINGE_TUFT_D],
            "buildsGeometry": True,
            "realization": "instanced-mesh",
            "geometryDescriptor": {"baseGeometry": "sphere"},
            "placement": {
                "mode": "radial",
                "axis": [0, 1, 0],
                "radius": round(FRINGE_OUTER_R * 2, 5),
                "startAngleDeg": 0,
                "notes": "radius is stored doubled because the factory places instances at radius*0.5.",
            },
            "evidenceRefs": [EVIDENCE_FULL, "fringe-zone"],
            "notes": (
                "The row that forms the scalloped silhouette. Reference density is roughly 200 tufts "
                "of 0.0107 world units; this builds 88 of 0.019 because reference density would cost "
                "more triangles than the whole prop's budget. The scallop is preserved, its pitch is not."
            ),
        },
        {
            "id": "fringe-tufts-inner",
            "name": "Inner microfibre tuft row",
            "level": "micro",
            "parent": "fringe-skirt",
            "count": FRINGE_INNER_COUNT,
            "primitive": "instanced-cluster",
            "material": "fringe-grey",
            "instanceScale": [FRINGE_TUFT_D * 0.9, FRINGE_TUFT_D, FRINGE_TUFT_D * 0.9],
            "buildsGeometry": True,
            "realization": "instanced-mesh",
            "geometryDescriptor": {"baseGeometry": "sphere"},
            "placement": {
                "mode": "radial",
                "axis": [0, 1, 0],
                "radius": round(FRINGE_INNER_R * 2, 5),
                "startAngleDeg": round(360.0 / FRINGE_INNER_COUNT / 2.0, 3),
                "notes": (
                    "Half-pitch start angle so this row staggers against the outer one, which is "
                    "what makes the fringe read dense. radius is stored doubled."
                ),
            },
            "evidenceRefs": [EVIDENCE_FULL, "fringe-zone"],
            "notes": "Mostly occluded by the outer row; it fills the gaps rather than forming silhouette.",
        },
    ]


# ---------------------------------------------------------------------------
# top-level blocks
# ---------------------------------------------------------------------------
FEATURE_REVIEW_TARGETS = [
    {
        "id": "disc-proportion",
        "name": "Squat disc proportion and circular plan",
        "tier": "critical",
        "minimumScore": 0.8,
        "checks": [
            "plan is a true circle with no D-front or flat leading edge",
            "height over diameter reads close to the measured 0.22, not a tall drum",
            "the widest point sits at the bumper band, not at the base or the rim",
        ],
    },
    {
        "id": "deck-rim-recess",
        "name": "Mint deck recessed inside a raised cream rim",
        "tier": "critical",
        "minimumScore": 0.8,
        "checks": [
            "deck radius is 0.837 of the plan radius",
            "the cream lip stands above the deck so the deck reads recessed",
            "a crisp seam separates deck from rim rather than a soft blend",
        ],
    },
    {
        "id": "segmented-bumper",
        "name": "Segmented navy bumper standing proud of the wall",
        "tier": "critical",
        "minimumScore": 0.8,
        "checks": [
            "the band is broken by visible cream gaps, not continuous",
            "the two front gaps sit near plus and minus 24 degrees",
            "each segment ends in a rounded cap and stands proud of the cream wall",
        ],
    },
    {
        "id": "fringe-scallop",
        "name": "Microfibre fringe skirt with a scalloped silhouette",
        "tier": "critical",
        "minimumScore": 0.75,
        "checks": [
            "the bottom outline is scalloped by individual tufts, not a smooth ring",
            "tufts reach slightly outboard of the cream shell",
            "the fringe is occluded behind the shell across the front centre",
        ],
    },
    {
        "id": "coral-button",
        "name": "Single off-centre coral button",
        "tier": "critical",
        "minimumScore": 0.8,
        "checks": [
            "exactly one button, on the centreline, offset toward the back",
            "its offset is near 58 percent of the deck radius",
            "it is a filleted disc with a contact shadow, not a flat circle",
        ],
    },
    {
        "id": "matte-response",
        "name": "Uniformly matte plastic response",
        "tier": "important",
        "minimumScore": 0.65,
        "checks": [
            "no specular hotspot anywhere; the rim sheen comes from curvature",
            "the fringe is visibly rougher and flatter than the shell",
            "navy reads softer and less reflective than the cream ABS",
        ],
    },
    {
        "id": "front-latch",
        "name": "Recessed stadium latch on the front lower wall",
        "tier": "important",
        "minimumScore": 0.6,
        "checks": [
            "a stadium-shaped recess centred on the front centreline",
            "it is inset with a chamfer and a shadow along its upper edge",
        ],
    },
]

BUILD_PASSES = [
    {"id": "blockout", "name": "Blockout", "goal": "Disc proportion and the vertical band order.",
     "acceptance": ["silhouette IoU against the reference at the solved elevation",
                    "height over diameter settled by a vertical-scale sweep"]},
    {"id": "structural-pass", "name": "Structural", "goal": "Every named part present and parented.",
     "acceptance": ["deck, rim, button, four bumper segments, latch and fringe all built",
                    "part coverage gate passes"]},
    {"id": "form-refinement", "name": "Form refinement", "goal": "Profiles and fillets.",
     "acceptance": ["rim crown curvature and deck recess read correctly",
                    "bumper end caps are rounded"]},
    {"id": "material-pass", "name": "Material", "goal": "Five-layer palette and matte response.",
     "acceptance": ["independent albedo/roughness/normal/AO channels", "no specular hotspot"]},
    {"id": "surface-pass", "name": "Surface", "goal": "Local overrides and occlusion.",
     "acceptance": ["under-rim occlusion and button contact shadow present"]},
    {"id": "lighting-pass", "name": "Lighting", "goal": "Reproduce the soft studio key.",
     "acceptance": ["value range across deck, wall and band matches the reference"]},
    {"id": "interaction-pass", "name": "Interaction", "goal": "Pivots and sockets.",
     "acceptance": ["fringe skirt spins about Y", "button presses along the deck normal"]},
    {"id": "optimization-pass", "name": "Optimization", "goal": "Triangle and draw-call budget.",
     "acceptance": ["within the stated triangle budget", "one draw call per instanced tuft row"]},
]


def main() -> None:
    scaffold = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    assessment_doc = json.loads(ASSESSMENT.read_text(encoding="utf-8"))

    spec = dict(scaffold)
    spec["targetName"] = "Robot Mop"
    spec["targetId"] = "robot-mop"
    spec["sourceImage"] = SOURCE_IMAGE
    spec["suitability"] = "pass"
    spec["preSpecAssessment"] = assessment_doc["preSpecAssessment"]
    spec["qualityContract"] = assessment_doc["qualityContract"]
    spec["localSpecSearch"] = assessment_doc.get("localSpecSearch", {})

    spec["referenceCamera"] = {
        "azimuthDeg": 0.0,
        "elevationDeg": 29.46,
        "rollDeg": 0.0,
        "fovDeg": 28.0,
        "projection": "perspective, long lens; the deck ellipse is consistent with a near-orthographic solve",
        "solveMethod": (
            "The deck is a circle, so its projected minor/major ratio is sin(elevation): "
            "387/787 = 0.4917 gives 29.46 degrees, and the solve closes to the pixel "
            "(787 * 0.4917 = 387.0)."
        ),
        "confidence": 0.85,
    }
    spec["measurementBasis"] = {
        "pixelsPerWorldUnit": PX_PER_UNIT,
        "anchor": "silhouette max half-width 470px authored as the trap collider radius 0.36",
        "derivations": {
            "R_MAX": "470px, the widest silhouette row; the bumper band and the fringe share it",
            "R_CREAM": "458.5px, the cream shell's own max half-width",
            "R_DECK": "393.5px, half the deck ellipse's major axis",
            "BUTTON_R": "67px, half the button ellipse's major axis",
            "BUTTON_Z": "-112 screen px / (sin(e) * pxPerUnit) = -0.1745",
            "bumperGaps": "front slots at x=350 and x=730 about a centre of 540, so sin(theta)=+/-0.404",
            "HEIGHT_OVER_DIAMETER": (
                "0.22 authored. The cap-ellipse solve gives 0.196 with an admissible band of "
                "[0.194, 0.298]; the bottom cap is the ragged fringe and fits poorly (RMS 82px), "
                "so this is a starting proportion the blockout sweep settles, not a measurement."
            ),
        },
        "unverified": [
            "the entire underside: wheels, caster, tank and brush layout are invisible in this view",
            "the rear bumper segment and the rear gap, inferred from front and side symmetry",
            "whether the deck carries any print or logo",
        ],
    }
    spec["scores"] = {
        "object_isolation": 3,
        "silhouette_readability": 3,
        "depth_inference": 1,
        "primitive_decomposition": 3,
        "material_procedurality": 3,
        "occlusion_risk": 1,
        "interaction_fit": 3,
    }
    spec["coordinateFrame"] = {
        "front": "+Z, the face carrying the latch recess and away from which the button is offset",
        "up": "+Y, with the lowest point of the fringe at y = 0",
        "right": "+X",
        "scaleReference": f"max radius = {R_MAX} world units; {PX_PER_UNIT} reference pixels per world unit",
    }
    spec["silhouette"] = {
        "boundingShape": f"squat disc, {R_MAX * 2:.3f} across by {HEIGHT:.4f} tall",
        "aspectRatios": [
            {"id": "height-to-diameter", "value": round(HEIGHT_OVER_DIAMETER, 4),
             "notes": "authored starting proportion; band [0.194, 0.298] from the cap-ellipse solve"},
            {"id": "deck-to-plan-radius", "value": round(R_DECK / R_MAX, 4),
             "notes": "393.5px over 470px, measured directly"},
            {"id": "cream-to-plan-radius", "value": round(R_CREAM / R_MAX, 4),
             "notes": "the bumper stands proud of the cream by this difference"},
        ],
        "symmetry": "rotationally symmetric about Y except for the button, the latch and the bumper gaps",
        "dominantCurves": [
            "the circular plan, which no view breaks",
            "the convex rim crown rolling from the deck seam out to the wall",
        ],
        "negativeSpaces": [
            "the cream gaps between bumper segments",
            "the recessed stadium latch on the front wall",
            "the shadowed gaps between fringe tufts",
        ],
        "landmarks": [
            f"deck plane at y = {Y_DECK:.4f}",
            f"rim crown at y = {Y_CROWN:.4f}",
            f"bumper band centre at y = {Y_BAND_MID:.4f}",
            f"shell lower edge at y = {Y_FRINGE_TOP:.4f}",
            f"button centre at z = {BUTTON_Z}",
        ],
    }
    spec["viewEvidence"] = [
        {"id": EVIDENCE_FULL, "view": "three-quarter high", "sourceImage": SOURCE_IMAGE,
         "covers": ["plan circle", "deck", "rim", "button", "front and side bumper", "front latch", "fringe"],
         "confidence": 0.9},
        {"id": "deck-zone", "view": "crop", "sourceImage": str(CROP_DIR / "button-red-crop.png"),
         "covers": ["button fillet", "button recess", "contact shadow"], "confidence": 0.85},
        {"id": "bumper-zone", "view": "crop", "sourceImage": str(CROP_DIR / "bumper-front-crop.png"),
         "covers": ["segment gaps", "rounded end caps", "band standoff"], "confidence": 0.8},
        {"id": "fringe-zone", "view": "crop", "sourceImage": str(CROP_DIR / "fringe-bottom-crop.png"),
         "covers": ["tuft scallop", "two-row stagger", "front occlusion"], "confidence": 0.75},
        {"id": "front-lower-zone", "view": "crop", "sourceImage": str(CROP_DIR / "latch-tab-crop.png"),
         "covers": ["latch recess outline", "recess chamfer"], "confidence": 0.8},
        {"id": "rim-zone", "view": "crop", "sourceImage": str(CROP_DIR / "bumper-left-gap-crop.png"),
         "covers": ["rim crown curvature", "deck seam", "inner lip"], "confidence": 0.8},
        {"id": "side-profile", "view": "derived", "sourceImage": str(HERE / "evidence" / "profile.json"),
         "covers": ["radius against height"], "confidence": 0.55},
    ]
    spec["componentTree"] = build_components()
    spec["materials"] = MATERIALS
    spec["repetitionSystems"] = build_repetition_systems()
    spec["buildPasses"] = BUILD_PASSES
    spec["featureReviewTargets"] = FEATURE_REVIEW_TARGETS
    spec["qualityTargets"] = {
        "targetFidelity": 0.8,
        "mustMatch": [
            "circular plan and squat disc proportion",
            "mint deck recessed inside a raised cream rim",
            "segmented navy bumper standing proud of the wall",
            "scalloped microfibre fringe below the shell",
            "one off-centre coral button",
        ],
        "niceToHave": [
            "exact tuft pitch",
            "the rear segment's true arc",
            "any print on the deck",
        ],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-three-quarter", "front", "top-down", "grazing", "rear-orbit"],
    }
    spec["sculptPipeline"] = {
        "passOrder": [p["id"] for p in BUILD_PASSES],
        "passGateMode": "locked-sequential",
        "currentPass": "blockout",
        "completedPasses": [],
        "reviewRequiredBetweenPasses": True,
        "generatorIsPassGated": True,
        "notes": "Only the unlocked pass is generated; a future pass id fails until earlier passes are reviewed.",
    }
    spec["lookDevTargets"] = {
        "qualityPriority": "reference-fidelity",
        "materialPass": {
            "albedoPaletteRequired": True,
            "roughnessVariationRequired": True,
            "normalOrBumpRequired": True,
            "localOverridesRequired": True,
            "minimumTextureResolution": 1024,
            "preferredTextureResolution": 1024,
            "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"],
            "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"],
            "geometryReliefRequiredWhenSilhouetteAffected": True,
            "referencePbrExtraction": {
                "requiredWhenSourceImagePresent": False,
                "ranAnyway": True,
                "targetThreshold": 0.7,
                "stopOnLowConfidence": True,
                "script": "forge/stage1_intake/extract_pbr_evidence.py",
                "measuredConfidence": {m["id"]: m["referencePbr"]["confidence"] for m in MATERIALS},
                "acceptedLimitation": PBR_NOTE,
            },
            "mustAvoid": ["single flat albedo per material", "uniform roughness",
                          "albedo reused as roughness, normal or AO"],
        },
        "lightingPass": {
            "keyFillRim": [
                {"role": "key", "type": "directional", "intensity": 1.15,
                 "direction": [-0.45, 0.78, 0.44], "color": "#fff6ea",
                 "notes": "Broad soft key from upper front left; the deck's gradient brightens toward it."},
                {"role": "fill", "type": "hemisphere", "intensity": 2.9,
                 "color": "#f4f2ef", "groundColor": "#cfcac4",
                 "notes": "Dominant ambient term; the reference has almost no fully dark side."},
                {"role": "rim", "type": "directional", "intensity": 0.3,
                 "direction": [0.7, 0.3, -0.62], "color": "#ffffff",
                 "notes": "Separates the rear of the rim from the backdrop."},
            ],
            "exposure": 1.0,
            "toneMapping": "ACESFilmic",
            "contactShadow": "soft ground shadow under the fringe; the object never touches a hard shadow edge",
        },
    }
    spec["actionReadiness"] = {
        "contract": "Every macro and meso component is a named pivot node with a mesh child, action metadata, sockets, a collider proxy and destruction metadata. The runtime reads root.userData.sculptRuntime.",
        "defaultRigType": "action-ready-prop-rig",
        "rootMotionNode": "shell-body",
        "requiredComponentFields": ["id", "parent", "transform", "seams for every contacting part",
                                    "actionProfile.animationRole", "actionProfile.pivot",
                                    "actionProfile.collider", "actionProfile.destruction"],
        "transformChannels": ["translate", "rotate", "scale", "detach", "visibility", "material-state"],
        "authoringRules": [
            "Do not collapse independently movable parts into one mesh.",
            "Put transforms on component pivot groups, not on raw meshes.",
            "Animated parts keep their pivot node at the axis of motion.",
            "Use simplified collider proxies for runtime physics.",
        ],
        "runtimeContract": {
            "skirtPivot": "sculptRuntime.nodes['fringe-skirt'] - rotate about local Y for the brush action.",
            "buttonPivot": "sculptRuntime.nodes['power-button'] - translate down the deck normal to press.",
            "floorContact": "sockets['shell-body:floor-contact'] sits at the model base, y = 0.",
            "colliderContract": (
                "The trap wraps this prop in CylinderCollider(halfHeight 0.10, radius 0.36) at "
                "trap.y + 0.12, so the prop is authored base-at-origin with a max radius of 0.36 "
                "and is placed at y = -0.10 inside that body."
            ),
        },
        "destructionGroups": ["chassis", "bumper", "control", "skirt"],
    }
    spec["assumptions"] = [
        "The rear bumper segment and the rear gap are inferred from the symmetry of the two measured front gaps; the reference never shows the back.",
        "The underside is invisible, so the base is closed with a plain disc and no wheels, caster or tank are modelled.",
        "Height over diameter is a starting proportion from a weakly-conditioned solve, settled by the blockout sweep rather than measured outright.",
        "Fringe tuft pitch is stylised: 88 outer tufts against a reference density near 200, to stay inside a sane triangle budget.",
        "Azimuth is unobservable on a solid of revolution and is fixed by the button and latch sharing one centreline.",
    ]
    spec["lodPlan"] = [
        {"id": "lod0", "distance": 0.0, "notes": "Full tuft rows and all four bumper segments."},
        {"id": "lod1", "distance": 8.0, "notes": "Drop the inner tuft row and halve the lathe segments."},
        {"id": "lod2", "distance": 18.0, "notes": "Shell, deck and band only; fringe becomes a plain skirt ring."},
    ]
    spec["performanceBudget"] = {
        "qualityPriority": "reference-fidelity",
        "targetTriangles": 12000,
        "maxDrawCalls": 24,
        "textureSize": 1024,
        "runtimeTextureSize": 256,
        "fpsTarget": 60,
        "measured": {},
        "optimizationPolicy": (
            "The fringe dominates the budget because it is the identity feature and it is made of "
            "many small solids. Reduce the instanced tuft base geometry before touching tuft count, "
            "because count controls the scallop pitch and the base mesh does not. The factory emits "
            "SphereGeometry(0.5, 64, 40) for every sphere, which at 5120 triangles per tuft would be "
            "fatal here; the refine-code step lowers it."
        ),
    }
    spec["lightingFromPhoto"] = [
        {"observation": "The deck is evenly lit with a gentle gradient brightening toward the upper left.",
         "inference": "A large soft key from the upper front left, close to the camera axis in azimuth."},
        {"observation": "The right side of the navy band is only slightly darker than the left.",
         "inference": "A dominant ambient or hemisphere term; the key-to-fill ratio is low."},
        {"observation": "No specular hotspot on any surface, including the convex rim.",
         "inference": "Every material is rough dielectric; no clearcoat and no metal anywhere."},
        {"observation": "Soft occlusion under the rim overhang and inside the bumper gaps.",
         "inference": "Contact occlusion rather than a cast shadow; there is no hard shadow edge on the object."},
        {"observation": "A soft contact shadow sits under the fringe against a flat grey backdrop.",
         "inference": "The object rests on a diffuse surface lit by the same broad source."},
        {"observation": "Nothing in the reference clips to pure white and nothing crushes to black; the whole image sits in a narrow mid band.",
         "inference": "Exposure 1.0 with ACES filmic tone mapping reproduces that range without blowing the cream rim."},
    ]
    spec["proceduralStrategy"] = [
        "LatheGeometry for every solid of revolution: shell, rim, deck and button.",
        "ExtrudeGeometry along an arc spine (curve-sweep) for each bumper segment, so the band conforms to the wall from every angle rather than only from the reference one.",
        "InstancedMesh for both tuft rows: one draw call per row.",
        "Procedural canvas maps for all five materials; no network-fetched or downloaded art.",
        "Deterministic seeds for every procedural map so a rebuild is byte-identical.",
        "Sphere end caps on each swept band so the segment terminations stay rounded.",
    ]
    spec["animationAnchors"] = [
        {"id": "skirt-spin", "node": "fringe-skirt", "channel": "rotate", "axis": [0, 1, 0],
         "notes": "Continuous spin for the brush action."},
        {"id": "button-press", "node": "power-button", "channel": "translate", "axis": [0, -1, 0],
         "range": [0.0, -0.004], "notes": "Short travel down the deck normal."},
        {"id": "body-yaw", "node": "shell-body", "channel": "rotate", "axis": [0, 1, 0],
         "notes": "The trap yaws the whole prop at each patrol turn."},
    ]
    spec["destructionAnchors"] = [
        {"id": "bumper-pop", "group": "bumper", "notes": "Segments detach individually; each is its own mesh."},
        {"id": "deck-pop", "group": "chassis", "notes": "Deck and button lift off the rim recess together."},
        {"id": "skirt-shed", "group": "skirt", "notes": "Tuft rows detach as two instanced clusters."},
    ]
    spec["risks"] = [
        {"id": "height-uncertainty", "severity": "medium",
         "detail": "Height over diameter is only pinned to [0.194, 0.298] analytically. If the blockout sweep does not converge, the prop will read either too flat or as a drum.",
         "mitigation": "Sweep vertical scale against silhouette IoU in the blockout pass and record the winner in VS."},
        {"id": "rear-inference", "severity": "low",
         "detail": "The rear bumper segment is invented from symmetry.",
         "mitigation": "Held at confidence 0.3 and flagged in assumptions; a rear view would settle it."},
        {"id": "fringe-cost", "severity": "medium",
         "detail": "The factory's default sphere is 5120 triangles, so 144 tufts would be 737k triangles.",
         "mitigation": "refine-code lowers the instanced base mesh; the optimisation pass verifies the measured count."},
        {"id": "collider-height-mismatch", "severity": "medium",
         "detail": "The trap's collider is 0.20 tall but the reference proportion gives 0.158 at a 0.72 diameter, so the hitbox is about 20 percent taller than the prop.",
         "mitigation": "Matched the radius exactly and reported the height delta; the trap file is not owned here."},
    ]
    # The review ledger is history, not authored content. These four fields used to be
    # cleared on every run, so re-authoring the spec to fix one component silently threw
    # away which passes had been reviewed and the evidence behind them - which locked the
    # build gate again and cost a full render-and-review cycle to notice. Carry them
    # forward, the way assets/reference/props/spec_lib.py's write_spec already does.
    carried = ("reviewHistory", "visualEvidence", "tier1Results", "sculptPipeline")
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for field in carried:
        spec[field] = previous.get(field, spec.get(field, []))
    if any(previous.get(field) for field in carried):
        print("carried forward: " + ", ".join(f for f in carried if previous.get(f)))

    OUT.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(f"components={len(spec['componentTree'])} materials={len(spec['materials'])} "
          f"repetition={len(spec['repetitionSystems'])} "
          f"details={len(spec['preSpecAssessment']['detailInventory']['details'])}")
    print(f"HEIGHT={HEIGHT:.5f} R_MAX={R_MAX} Y_DECK={Y_DECK:.5f} Y_CROWN={Y_CROWN:.5f}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
