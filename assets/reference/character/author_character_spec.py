#!/usr/bin/env python3
"""Rebuild the measured parts of character-sculpt-spec.json from reference evidence.

Everything this writes is either (a) copied from an extract_pbr_evidence.py report in
evidence/pbr, or (b) a world-space number measured off assets/reference/character-reference.png
by the row/segment scan recorded in MEASURED below. Nothing here is a guessed PBR value.

Run from anywhere:  python assets/reference/character/author_character_spec.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = HERE / "character-sculpt-spec.json"
PBR = HERE / "evidence" / "pbr"
CROPS = HERE / "evidence" / "crops"
REFERENCE = "assets/reference/character-reference.png"

# ---------------------------------------------------------------------------
# Measured frame. Ground y=0, crown y=1.898, centre x=0, +Z out of the screen.
# Source: colour-segmented row/segment scan of the 1086x1448 reference. The figure
# occupies y_px 102..1337 (1236 px) and 1236 px == 1.9 world units, so 1 px == 0.0015372u.
# ---------------------------------------------------------------------------
UNITS_PER_PX = 1.9 / 1236.0
MEASURED = {
    "figureBboxPx": {"x0": 161, "x1": 924, "y0": 102, "y1": 1337},
    "centreXPx": 542.5,
    "unitsPerPx": round(UNITS_PER_PX, 7),
    "crownY": 1.898,
    "neckPinchY": 1.279,
    "chinY": 1.385,
    "eyeLineY": 1.484,
    "eyeCentreX": 0.108,
    "eyeDiameter": 0.059,
    "mouthLineY": 1.400,
    "headWidestY": 1.479,
    "headWidthWithEars": 0.733,
    "headWidthNoEars": 0.634,
    "shoulderY": 1.250,
    "torsoWidestY": 0.948,
    "torsoWidestWidth": 0.524,
    "shirtHemY": 0.660,
    "ankleY": 0.287,
    "shoeTopY": 0.280,
    "soleTopY": 0.090,
    "groundY": 0.0,
    "referenceArmSpan": 1.173,
    "shippedArmSpan": 0.815,
}

# Landmark cross-check against the pre-existing anatomy.json fractions. jaw and
# torsoWidest reproduce; eyeLine does not, and that disagreement is recorded rather
# than silently averaged away.
LANDMARK_CROSSCHECK = [
    {
        "landmark": "jaw (neck pinch)",
        "anatomyFraction": 0.327,
        "anatomyImpliedY": 1.279,
        "measuredY": 1.279,
        "agrees": True,
    },
    {
        "landmark": "torso widest",
        "anatomyFraction": 0.501,
        "anatomyImpliedY": 0.948,
        "measuredY": 0.948,
        "agrees": True,
    },
    {
        "landmark": "eye line",
        "anatomyFraction": 0.176,
        "anatomyImpliedY": 1.566,
        "measuredY": 1.484,
        "agrees": False,
        "note": (
            "anatomy.json records the eye line 0.176 of figure height below the crown "
            "(0.54 head units, y_px 320). The eye pupils in the reference are centred at "
            "y_px 372, which is 0.218 of figure height / 0.667 head units below the crown. "
            "The 52 px disagreement is 4.2% of figure height and moves the eyes a visible "
            "amount. This spec builds to the directly measured y_px 372; anatomy.json is "
            "left untouched and the conflict is reported rather than resolved silently."
        ),
    },
]

# ---------------------------------------------------------------------------
# Reference PBR evidence. Which crop backs which material, and why.
# ---------------------------------------------------------------------------
MATERIAL_EVIDENCE = {
    "skin": {
        "crop": "skin",
        "cropBox": [445, 436, 641, 493],
        "cropRegion": "chin and jaw band below the mouth line, the largest rectangle that is 100% face skin",
        "albedoDecision": (
            "Keeps the recorded flat-lit median #fbdfb4. The extractor's de-lit palette for this "
            "crop is #E8C89C, about 8% darker, because the only fully clean skin rectangle sits in "
            "the chin's own shadow and the de-lighting under-corrects it. The extractor palette is "
            "kept below as measured evidence, not promoted to base colour."
        ),
    },
    "hair-ink": {
        "crop": "hair-ink",
        "cropBox": [409, 149, 678, 253],
        "cropRegion": "hair cap crown, clear of the forehead and of the fringe notch",
        "albedoDecision": (
            "Extractor de-lit palette #333D54 confirms the recorded #313a51 to within 2/255 per "
            "channel. Recorded value kept."
        ),
        "crossCheckCrop": "hair-ink-alt-trouser",
    },
    "torso-purple": {
        "crop": "torso-purple",
        "cropBox": [451, 571, 633, 873],
        "cropRegion": "shirt front between the two backpack straps",
        "albedoDecision": "Extractor de-lit palette #8D66D7 confirms the recorded #8e67d8 to within 1/255 per channel.",
    },
    "strap-coral": {
        "crop": "strap-coral",
        "cropBox": [412, 572, 428, 619],
        "cropRegion": "left backpack strap over the shoulder, the widest fully-coral rectangle in the frame",
        "albedoDecision": "Extractor de-lit palette #F28B78 confirms the recorded #f18979 to within 2/255 per channel.",
    },
    "shoe-cream": {
        "crop": "shoe-cream",
        "cropBox": [388, 1246, 505, 1276],
        "cropRegion": "left sneaker upper above the welt line",
        "albedoDecision": "Extractor de-lit palette #F0E8DA confirms the recorded #efe6d9 to within 2/255 per channel.",
    },
    "shoe-sole": {
        "crop": "shoe-sole",
        "cropBox": [389, 1286, 492, 1325],
        "cropRegion": "left sneaker outsole band below the welt line",
        "albedoDecision": (
            "Deliberate departure from the reference. The extractor reads the outsole at #F1E8DA, "
            "which is the same cream as the upper: a seeded region grow at a 5/255 step tolerance "
            "cannot separate sole from upper at all, so the reference genuinely paints them one "
            "colour. Against the pale walking deck that cream measures 1.17:1 contrast, which is "
            "invisible at the moment a player needs to judge footing, so the shipped sole is "
            "darkened to #252d42. Roughness, height, normal and AO evidence still come from this crop."
        ),
    },
    "eye-ink": {
        "crop": "eye-ink",
        "cropBox": [463, 362, 483, 382],
        "cropRegion": "left eye dot, inside the ink rim",
        "albedoDecision": (
            "Keeps the recorded #1a1c22. The extractor de-lights this 20 px crop to #272B31 and the "
            "raw pixel at the pupil centre is #24272C, so the shipped ink is about 0.05 luminance "
            "darker than measured. That is a legibility choice for a dot eye seen at game scale, "
            "and it is recorded here rather than presented as a measurement."
        ),
    },
}

# Roughness note that applies to every material: the extractor returns 0.680-0.714 across
# seven visually distinct surfaces, a 0.034 spread. That is the honest reading of a uniformly
# matte clay render, and it replaces the hand-set 0.55-0.78 spread the spec carried before.
ROUGHNESS_NOTE = (
    "roughness.base is the extractor's measured estimate for this material's own crop. Across all "
    "seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity "
    "in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread "
    "was not measured and has been replaced."
)

LIMITATION = (
    "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted "
    "maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in "
    "order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying "
    "the reference's own lighting falloff, the height/normal/roughness channels are the render's "
    "compression grain upsampled from a small crop, and the AO channel is essentially white; tiling "
    "them would paint the reference's shading and its codec noise onto every surface. (2) The "
    "factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a "
    "browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable "
    "budget for a player character in a web game. The runtime instead builds five independent "
    "procedural canvas fields per material, and the extracted palettes and roughness estimates are "
    "used as evidence for the scalars."
)


def shade(hex_color: str, factor: float) -> str:
    rgb = [int(hex_color[index:index + 2], 16) for index in (1, 3, 5)]
    return "#" + "".join(f"{max(0, min(255, round(channel * factor))):02x}" for channel in rgb)


def load_report(material_id: str) -> dict:
    return json.loads((PBR / f"{material_id}-report.json").read_text(encoding="utf-8"))


def reference_pbr_block(material_id: str, evidence: dict) -> dict:
    report = load_report(evidence["crop"])
    stats = report["diagnostics"]["mapStats"]
    prefix = evidence["crop"]
    block = {
        "version": "1.0",
        "sourceImage": str((CROPS / f"{prefix}-crop.png").resolve()),
        "sourceCropBoxPx": evidence["cropBox"],
        "sourceCropRegion": evidence["cropRegion"],
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": report["verdict"],
        "confidence": report["confidence"],
        "estimatedFidelity": report["estimatedFidelity"],
        "targetThreshold": report["targetThreshold"],
        "extractorPalette": report["palette"],
        "extractorWarnings": report["warnings"],
        "measuredStats": stats,
        "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.",
        "limitationNote": LIMITATION,
        "albedoDecision": evidence["albedoDecision"],
        "maps": {
            channel: {
                "path": str((PBR / f"{prefix}_{channel}.png").resolve()),
                "channel": channel,
                "source": "reference-pixel-extraction",
            }
            for channel in ("albedo", "roughness", "height", "normal", "ao")
        },
    }
    if report["confidence"] < report["targetThreshold"]:
        block["belowTargetThreshold"] = (
            f"Extraction confidence {report['confidence']} is below the {report['targetThreshold']} "
            "target. Cause is recorded in extractorWarnings: the only clean rectangle for this "
            "material is small and low-relief, so the resolution and detail terms of the "
            "extractor's confidence model are pinned near their floor. This is reported as a "
            "conditional result, not upgraded."
        )
    cross = evidence.get("crossCheckCrop")
    if cross:
        alt = load_report(cross)
        block["crossCheck"] = {
            "crop": str((CROPS / f"{cross}-crop.png").resolve()),
            "region": "left trouser leg, the other surface that shares this navy",
            "confidence": alt["confidence"],
            "palette": alt["palette"],
            "finding": (
                "The trouser crop de-lights to #232B3F against the hair crop's #333D54. The trouser "
                "sits further from the top key so it reads darker; the hair crop is the higher "
                "confidence of the two and is the bound evidence."
            ),
        }
    return block


def surface_bands(stats: dict) -> list[dict]:
    """Same derivation extract_pbr_evidence.surface_bands_from_stats applies, fed the measured stats."""
    value_range = float(stats["valueRange"])
    detail = float(stats["heightP90Gradient"])
    clamp = lambda v, lo, hi: max(lo, min(hi, v))
    return [
        {
            "id": "macro",
            "frequency": 2.0,
            "amplitude": round(clamp(0.28 + value_range * 0.35, 0.22, 0.52), 3),
            "role": "reference-derived broad albedo and height breakup",
        },
        {
            "id": "meso",
            "frequency": 14.0,
            "amplitude": round(clamp(0.15 + detail * 4.2, 0.12, 0.35), 3),
            "role": "reference-derived moulding flow and seam relief",
        },
        {
            "id": "micro",
            "frequency": 72.0,
            "amplitude": round(clamp(0.055 + detail * 2.4, 0.045, 0.14), 3),
            "role": "reference-derived micro highlight breakup under grazing light",
        },
    ]


def patch_materials(spec: dict) -> None:
    by_id = {m["id"]: m for m in spec["materials"]}
    for material_id, evidence in MATERIAL_EVIDENCE.items():
        material = by_id[material_id]
        report = load_report(evidence["crop"])
        stats = report["diagnostics"]["mapStats"]
        material["referencePbr"] = reference_pbr_block(material_id, evidence)
        material["textureResolution"] = 1024
        material["textureProjection"] = {
            "mode": "uv",
            "repeat": [1.0, 1.0],
            "anisotropy": 8,
            "texelDensityIntent": (
                "One tile per part. The figure is a smooth clay render with no repeating pattern, so "
                "detail stays at object scale and never stretches with component scale or tiles visibly."
            ),
        }
        material["surfaceFrequencyBands"] = surface_bands(stats)
        material["roughness"] = {
            "base": stats["roughnessBase"],
            "variation": stats["roughnessVariation"],
            "map": "independent-procedural-field",
            "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother",
            "evidence": ROUGHNESS_NOTE,
        }
        material["metalness"] = {"base": 0.0, "variation": 0.0}
        material["normal"] = {
            "pattern": "derived-from-independent-height-field",
            "strength": stats["normalStrength"],
            "scale": 24.0,
            "space": "tangent",
        }
        material["bump"] = {"pattern": "none", "amplitude": 0.0, "scale": 1.0}
        material["ambientOcclusion"] = {
            "cavityStrength": 0.28,
            "contactShadowBias": 0.35,
            "map": "independent-procedural-field",
            "notes": (
                "Darken where parts meet: under the hair fringe, under the chin, along the strap "
                "channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."
            ),
        }
        palette = report["palette"]
        material["albedo"]["secondary"] = palette[1:4]
        material["albedo"]["map"] = None
        material["albedo"]["samplingNotes"] = (
            f"Base colour is the recorded flat-lit median. {evidence['albedoDecision']}"
        )
        # The runtime palette drives the procedural albedo canvas, and the factory blends across
        # it. Feeding the extractor's de-lit palette straight in shifts every rendered surface off
        # its measured colour, and for shoe-sole it is catastrophic: the extractor reads the
        # reference's cream outsole, so blending it with the shipped ink turns the sole light grey,
        # which is exactly what the structural side render showed. The palette is therefore built
        # as tonal steps around the material's own base colour, and the extractor palette stays in
        # referencePbr.extractorPalette as evidence.
        material["colorVariation"] = {
            "palette": [material["baseColor"], shade(material["baseColor"], 0.93),
                        shade(material["baseColor"], 1.05)],
            "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part",
            "amplitude": round(min(0.20, max(0.05, float(stats["valueRange"]) * 0.30)), 3),
            "heightCorrelation": 0.42,
        }
        material["shaderNotes"] = [
            "MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.",
            "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.",
            "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.",
            ROUGHNESS_NOTE,
        ]

    hidden = by_id["hidden"]
    hidden["qualityTier"] = "utility"
    hidden["opacity"] = {"base": 0.0}
    hidden["alpha"] = {"cutoff": 0.5}
    hidden["notes"] = (
        "Transform-only node material for the four grouping nodes. The factory emits a mesh for every "
        "component including pure transform groups and does not read a 'visible' flag, so the group "
        "boxes are made invisible with opacity 0 plus an alpha cutoff; the cutoff is what also keeps "
        "them out of the shadow pass."
    )
    hidden.pop("roughnessMap", None)
    # No referencePbr at all: there is no reference surface for a transform-only node, and an
    # empty extraction record would be a claim about pixels that were never sampled.
    hidden.pop("referencePbr", None)


def patch_lookdev(spec: dict) -> None:
    extraction = spec["lookDevTargets"]["materialPass"]["referencePbrExtraction"]
    extraction["requiredWhenSourceImagePresent"] = False
    extraction["ranAnyway"] = True
    extraction["script"] = "forge/stage1_intake/extract_pbr_evidence.py"
    extraction["targetThreshold"] = 0.7
    extraction["stopOnLowConfidence"] = True
    extraction["measuredConfidence"] = {
        crop: load_report(crop)["confidence"]
        for crop in sorted({e["crop"] for e in MATERIAL_EVIDENCE.values()} | {"hair-ink-alt-trouser"})
    }
    extraction["belowTarget"] = [
        crop for crop, value in extraction["measuredConfidence"].items() if value < 0.7
    ]
    extraction["acceptedLimitation"] = LIMITATION
    spec["lookDevTargets"]["materialPass"]["preferredTextureResolution"] = 1024


def patch_lighting(spec: dict) -> None:
    """Every number below is a luminance read off the reference, not a studio recipe."""
    spec["lightingFromPhoto"] = [
        (
            "Key light: a single soft source high and very slightly camera-right. Sampled around the "
            "face at a fixed 110 px radius, relative luminance peaks at 0.901 at the top of the ring "
            "and falls to 0.602 directly under the chin, and the right cheek reads 0.852 against the "
            "left cheek's 0.818. A 4% left-right difference against a 50% top-bottom difference means "
            "elevation dominates and the horizontal bias is small."
        ),
        (
            "Fill light: dominant. The shadow side of the head never falls below 0.602 while the lit "
            "side peaks at 0.901, so fill sits at about 67% of key. A warm hemisphere reproduces that "
            "near-shadowless range; anything approaching a 3:1 key-to-fill ratio drives the underside "
            "of the chin far darker than the reference."
        ),
        (
            "Rim and environment light: the reference has none. The shirt silhouette edge reads 0.411 "
            "against 0.477 at the shirt's centre, so the outline is darker than the interior rather "
            "than lifted. The background is flat #DBDBDB with no gradient, measured within 2/255 at "
            "all four corners and at centre. The reference-matched review render therefore disables "
            "the rim; the game scene supplies its own environment."
        ),
        (
            "Exposure and tone mapping: ACES filmic with sRGB output at exposure 1.0. Nothing in the "
            "reference clips. The brightest face pixel is 0.901 relative luminance, well under 1.0, "
            "and the darkest hair pixel is 0.19, so the render must hold a narrow band with no blown "
            "highlight and no crushed black."
        ),
        (
            "Contact shadow: absent from the reference and supplied by the game instead. The pixels "
            "directly under both shoes measure (219,219,219), identical to the background 400 px "
            "away, so the figure is floating on a flat backdrop with no ground shadow. All occlusion "
            "in the reference-matched render therefore has to come from the materials' own ambient "
            "occlusion response at part intersections."
        ),
    ]


# ---------------------------------------------------------------------------
# Component tree. Rebuilt against the generator's actual semantics:
#   * a component carrying attachment.localStart != localEnd is built as a TAPERED CYLINDER
#     from start to end, with its node placed at start and its transform.position ignored.
#     That is right for the tube-like parts and wrong for every blob, so blobs carry no attachment.
#   * transform.scale, when present, wins over dimensions in scale_vector(), and node scale
#     cascades to child components. Only nodes that must stay at unit scale keep an explicit
#     scale; leaves drop it so their dimensions drive the geometry.
#   * therefore no scaled node is ever given children.
# Every position is world space; the three group nodes carry the world offset and the leaves
# are expressed relative to their group, so the tree is two levels deep plus limb children.
# ---------------------------------------------------------------------------
HEAD_Y = 1.560
TORSO_DEPTH_FACTOR = 0.80
BODY_Y = 0.950
HIP_Y = 0.660
# The shoulder end of the sleeve is pushed well inboard so the cylinder's tilted top cap ends up
# buried inside the shirt's shoulder dome. Starting it on the surface leaves the cap ellipse
# projecting past the torso with background between the two, which is what the first blockout
# render showed. The sleeve therefore emerges from the shirt at about y=1.11 rather than the
# reference's y=1.19; that difference is recorded in risks.
SHOULDER = (0.150, 1.130)
WRIST = (0.336, 0.790)
# Deltoid cap. The reference's shoulder is a rounded ball where sleeve meets shirt; without it a
# tapered cylinder butting into a lathe leaves its tilted top cap projecting past the torso as a
# flat wedge, which is exactly what the first two blockout renders showed.
SHOULDER_BALL = (0.168, 1.140, 0.165)

# The four grouping nodes are pure transform parents, but the factory emits a mesh for every
# component and has no "no geometry" primitive. Left as boxes they render as unit cubes: invisible
# because the hidden material is opacity 0, yet still 1x1x1 in the bounding box, which pushed the
# model's measured bounds to 1.000 x 2.560 x 1.000 around a centred origin instead of the real
# 0.817 x 1.898 x 0.680 standing on y=0. Anything that normalises the model by its bounds, or that
# checks the 0.94u silhouette cap from them, reads the cubes instead of the figure. A degenerate
# 2mm tube is the smallest real geometry the factory can build, so the bounds now describe the
# character. They keep their own transform.scale of 1 so the scale never cascades to children.
GROUP_STUB = {"tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001,
                           "radialSegments": 3, "closed": False}}
GEOMETRY = {
    # id: (parent, primitive, position, dimensions, scaleOne, attachment, descriptor)
    "root": ("root-none", "tube", [0, 0, 0], [0.94, 1.9, 0.4], True, None, GROUP_STUB),
    "head-group": ("root", "tube", [0, HEAD_Y, 0], [0.733, 0.62, 0.6], True, None, GROUP_STUB),
    "body-group": ("root", "tube", [0, BODY_Y, 0], [0.524, 0.59, 0.44], True, None, GROUP_STUB),
    "legs-group": ("root", "tube", [0, HIP_Y, 0], [0.564, 0.66, 0.32], True, None, GROUP_STUB),
}

MOUTH_SPINE = [
    [-0.048, -0.152, 0.258],
    [-0.025, -0.162, 0.270],
    [0.000, -0.165, 0.274],
    [0.025, -0.162, 0.270],
    [0.048, -0.152, 0.258],
]

# Lathe profile for the shirt, as [radius, y] pairs measured off the reference and expressed
# relative to body-group. Reproduces the pear: narrow at the shoulder, widest at the belly,
# tucked back in at the hem.
# Detail strings shared between component.localFeatures and preSpecAssessment.detailInventory.
# The inventory shipped with numbers (0.227u shoulder, 0.356u hem) that the row scan does not
# reproduce, so both sides are restated here from the measurement.
TORSO_DETAIL = (
    "pear profile: 0.300u across at the shoulder, widening to 0.524u at the belly (y=0.948) "
    "and tucking back to 0.376u at the hem"
)
MOUTH_DETAIL = "single upward-curved line, no opening: corners at y=1.407 sit above the centre at y=1.393"
ARM_DETAIL = "sleeve ends in a purple-to-cream cuff at the wrist, where the mitten hand takes over"
SOLE_DETAIL = "raised rim proud of the upper by 0.005u per side; the ground-contact read"

TORSO_PROFILE = [
    [0.001, 0.325],
    [0.110, 0.320],
    [0.160, 0.308],
    [0.185, 0.291],
    [0.205, 0.262],
    [0.222, 0.215],
    [0.238, 0.150],
    [0.250, 0.080],
    [0.258, 0.010],
    [0.262, -0.030],
    [0.257, -0.078],
    [0.244, -0.109],
    [0.229, -0.171],
    [0.205, -0.230],
    [0.188, -0.290],
    [0.130, -0.310],
    [0.001, -0.318],
]


def smooth_profile(points: list[list[float]], samples: int = 48) -> list[list[float]]:
    """Resample a [radius, y] control polygon with a Catmull-Rom spline.

    LatheGeometry interpolates linearly between profile points, so every slope change in the
    measured control polygon becomes a hard crease. The blockout review scored the torso down
    for exactly that: a facet band across the chest. Resampling keeps the measured radii on the
    surface while removing the creases between them.
    """
    ys = [p[1] for p in points]
    lo, hi = min(ys), max(ys)
    ordered = sorted(points, key=lambda p: p[1])

    def radius_at(y: float) -> float:
        for index in range(len(ordered) - 1):
            y0, y1 = ordered[index][1], ordered[index + 1][1]
            if y0 <= y <= y1:
                span = y1 - y0
                t = 0.0 if span == 0 else (y - y0) / span
                p0 = ordered[max(0, index - 1)][0]
                p1, p2 = ordered[index][0], ordered[index + 1][0]
                p3 = ordered[min(len(ordered) - 1, index + 2)][0]
                return 0.5 * (
                    (2 * p1)
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
                )
        return ordered[-1][0]

    out = []
    for index in range(samples + 1):
        y = lo + (hi - lo) * index / samples
        out.append([round(max(0.001, radius_at(y)), 4), round(y, 4)])
    return out


def leaf(component: dict, parent: str, primitive: str, position, dimensions, *, scale_one=False,
         attachment=None, descriptor=None) -> None:
    component["parent"] = parent
    component["primitive"] = primitive
    component["dimensions"] = {
        "width": dimensions[0],
        "height": dimensions[1],
        "depth": dimensions[2],
        "units": "world",
        "confidence": dimensions[3] if len(dimensions) > 3 else 0.85,
    }
    transform = component.setdefault("transform", {})
    transform["position"] = list(position)
    transform["rotation"] = [0, 0, 0]
    if scale_one:
        transform["scale"] = [1, 1, 1]
    else:
        transform.pop("scale", None)
    component["attachment"] = attachment
    if descriptor is not None:
        component.setdefault("geometryDescriptor", {}).update(descriptor)


def segment(parent_id: str, socket: str, start, end, base_radius, end_radius, contact, overlap, note):
    return {
        "parentId": parent_id,
        "parentSocket": socket,
        "localStart": list(start),
        "localEnd": list(end),
        "contactType": contact,
        "embedDepth": overlap,
        "gapTolerance": 0.004,
        "baseRadius": base_radius,
        "endRadius": end_radius,
        "notes": note,
        "evidenceRefs": ["full-object"],
    }


def seated(parent_id: str, socket: str, point, contact, overlap, note):
    """A blob that sits on its parent at one contact point rather than sweeping along a segment.

    localStart and localEnd are deliberately equal. A non-degenerate segment instructs
    generate_threejs_factory to discard the primitive and build a tapered cylinder instead, which
    is correct for a limb and wrong for a sphere or a box. Equal endpoints record the single
    contact point and leave the authored primitive in place.
    """
    return {
        "parentId": parent_id,
        "parentSocket": socket,
        "localStart": list(point),
        "localEnd": list(point),
        "contactType": contact,
        "embedDepth": overlap,
        "gapTolerance": 0.004,
        "notes": note,
        "evidenceRefs": ["full-object"],
    }


def ensure_component(spec: dict, template_id: str, new_id: str, name: str) -> dict:
    """Clone an existing component as the starting point for one the template did not ship."""
    by_id = {c["id"]: c for c in spec["componentTree"]}
    if new_id in by_id:
        return by_id[new_id]
    clone = json.loads(json.dumps(by_id[template_id]))
    clone["id"] = new_id
    clone["name"] = name
    clone["localFeatures"] = []
    clone["details"] = []
    spec["componentTree"].append(clone)
    return clone


def patch_components(spec: dict) -> None:
    for side in ("l", "r"):
        ensure_component(spec, "hand-l", f"shoulder-{side}", f"Shoulder cap {'left' if side == 'l' else 'right'}")
    by_id = {c["id"]: c for c in spec["componentTree"]}

    for cid, (parent, primitive, position, dims, scale_one, attachment, descriptor) in GEOMETRY.items():
        leaf(by_id[cid], None if parent == "root-none" else parent, primitive, position,
             [*dims, 0.9], scale_one=scale_one, attachment=attachment, descriptor=descriptor)

    # --- head group (world offset [0, 1.588, 0]); PlayerVisual rotates this node -------------
    leaf(by_id["head"], "head-group", "sphere", [0, 0, 0], [0.650, 0.650, 0.620, 0.9])
    leaf(by_id["hair-cap"], "head-group", "sphere", [0, 0.103, -0.012], [0.690, 0.470, 0.680, 0.8])
    leaf(by_id["ear-l"], "head-group", "sphere", [-0.330, -0.082, -0.010], [0.078, 0.120, 0.062, 0.75])
    leaf(by_id["ear-r"], "head-group", "sphere", [0.330, -0.082, -0.010], [0.078, 0.120, 0.062, 0.75])
    leaf(by_id["eye-l"], "head-group", "sphere", [-0.108, -0.076, 0.272], [0.062, 0.062, 0.048, 0.9])
    leaf(by_id["eye-r"], "head-group", "sphere", [0.108, -0.076, 0.272], [0.062, 0.062, 0.048, 0.9])
    leaf(by_id["nose"], "head-group", "sphere", [0, -0.123, 0.286], [0.055, 0.045, 0.050, 0.6])
    leaf(by_id["mouth"], "head-group", "tube", [0, 0, 0], [0.096, 0.018, 0.018, 0.7],
         scale_one=True,
         attachment=seated("head-group", "face-front", [0, -0.165, 0.274], "fused", 0.006,
                           "Smile arc laid on the face front. The tube spine already carries its own world placement, so the node stays at the head-group origin."),
         descriptor={"tubePath": {"points": MOUTH_SPINE, "radius": 0.009, "radialSegments": 8, "closed": False}})
    by_id["mouth"]["primitive"] = "tube"

    # --- body group (world offset [0, 0.950, 0]) --------------------------------------------
    leaf(by_id["torso"], "body-group", "lathe", [0, 0, 0], [0.524, 0.618, 0.42, 0.9],
         descriptor={"latheProfile": {"points": smooth_profile(TORSO_PROFILE), "segments": 48}})
    # A lathe is circular in plan. Left at unit scale the shirt is as deep as it is wide and the
    # figure reads as a barrel from the side, which the structural side render showed. The depth
    # factor is inferred: a single front view cannot measure it.
    by_id["torso"]["transform"]["scale"] = [1, 1, TORSO_DEPTH_FACTOR]
    leaf(by_id["neck"], "body-group", "cylinder", [0, 0.360, 0], [0.280, 0.155, 0.280, 0.85],
         attachment=segment("body-group", "torso-shoulder-line", [0, 0.285, 0], [0, 0.440, 0],
                            0.140, 0.135, "socket", 0.045,
                            "Neck runs from the shirt collar at y=1.235 up into the jaw at y=1.390; both ends are embedded."))
    for side, sign in (("l", -1.0), ("r", 1.0)):
        leaf(by_id[f"strap-{side}"], "body-group", "capsule", [sign * 0.175, 0.105, 0.145],
             [0.058, 0.380, 0.058, 0.7],
             attachment=segment("body-group", f"shoulder-{side}", [sign * 0.135, 0.290, 0.110],
                                [sign * 0.215, -0.080, 0.180], 0.030, 0.028, "seated", 0.012,
                                "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure."))
        shoulder = by_id[f"shoulder-{side}"]
        shoulder["role"] = "detail"
        shoulder["material"] = "torso-purple"
        shoulder["materialLayers"] = ["torso-purple"]
        shoulder["actionProfile"]["animationRole"] = "static"
        leaf(shoulder, "body-group", "sphere",
             [sign * SHOULDER_BALL[0], SHOULDER_BALL[1] - BODY_Y, 0],
             [SHOULDER_BALL[2], SHOULDER_BALL[2], SHOULDER_BALL[2], 0.7],
             attachment=seated("body-group", f"shoulder-{side}",
                               [sign * SHOULDER_BALL[0], SHOULDER_BALL[1] - BODY_Y, 0],
                               "fused", 0.055,
                               "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap."))
        leaf(by_id[f"arm-{side}"], "body-group", "capsule",
             [sign * (SHOULDER[0] + WRIST[0]) / 2, (SHOULDER[1] + WRIST[1]) / 2 - BODY_Y, 0],
             [0.170, 0.445, 0.170, 0.8],
             attachment=segment("body-group", f"shoulder-{side}",
                                [sign * SHOULDER[0], SHOULDER[1] - BODY_Y, 0],
                                [sign * WRIST[0], WRIST[1] - BODY_Y, 0],
                                0.082, 0.066, "socket", 0.05,
                                "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it."))
        # hand hangs off the arm node, which the cylinder path leaves at unit scale.
        leaf(by_id[f"hand-{side}"], f"arm-{side}", "sphere",
             [sign * (0.336 - SHOULDER[0]), (WRIST[1] - SHOULDER[1]) - 0.062, 0.010],
             [0.145, 0.150, 0.105, 0.7],
             attachment=seated(f"arm-{side}", f"wrist-{side}",
                               [sign * (WRIST[0] - SHOULDER[0]), WRIST[1] - SHOULDER[1], 0.010],
                               "socket", 0.030,
                               "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced."))

    # --- legs group (world offset [0, 0.660, 0]) ---------------------------------------------
    for side, sign in (("l", -1.0), ("r", 1.0)):
        leaf(by_id[f"leg-{side}"], "legs-group", "capsule",
             [sign * 0.119, -0.187, 0], [0.150, 0.373, 0.150, 0.9],
             attachment=segment("legs-group", f"hip-{side}", [sign * 0.105, 0.0, 0],
                                [sign * 0.133, -0.373, 0], 0.083, 0.067, "socket", 0.06,
                                "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured."))
        leaf(by_id[f"shoe-{side}"], f"leg-{side}", "box",
             [sign * 0.055, -0.4725, 0.060], [0.198, 0.205, 0.300, 0.6],
             attachment=seated(f"leg-{side}", f"ankle-{side}", [sign * 0.055, -0.395, 0.030],
                               "socket", 0.035,
                               "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length."))
        leaf(by_id[f"sole-{side}"], f"leg-{side}", "box",
             [sign * 0.055, -0.6175, 0.060], [0.232, 0.085, 0.318, 0.6],
             attachment=seated(f"leg-{side}", f"ankle-{side}", [sign * 0.055, -0.570, 0.055],
                               "fused", 0.020,
                               "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it."))

    # macro groups get a real attachment record; equal endpoints keep them as transform nodes.
    by_id["head-group"]["attachment"] = seated(
        "root", "root-spine-top", [0, HEAD_Y, 0], "fused", 0.045,
        "Head mass. Spans the crown at y=1.898 down to the neck pinch at y=1.279, one head unit of 0.619u. Overlap is the neck embed into the jaw.")
    by_id["body-group"]["attachment"] = seated(
        "root", "root-spine", [0, BODY_Y, 0], "fused", 0.060,
        "Body mass. Spans the shirt collar at y=1.250 down to the hem at y=0.660, widest at y=0.948 as measured. Overlap is the hem over the hip.")
    by_id["legs-group"]["attachment"] = seated(
        "root", "root-hips", [0, HIP_Y, 0], "fused", 0.060,
        "Leg mass. Spans the hip at y=0.660 down to the ground at y=0.000. Overlap is the hip into the shirt hem.")

    # localFeatures that are now geometry rather than prose. The first entry of each list is the
    # string the detailInventory maps to, so both are re-stated together whenever a measurement
    # changes; leaving them to drift apart is what the mapping gate exists to catch.
    by_id["torso"]["localFeatures"] = [
        TORSO_DETAIL,
        "widest row reproduces anatomy.json landmarkFraction torsoWidest = 0.501",
    ]
    by_id["mouth"]["localFeatures"] = [MOUTH_DETAIL]
    for side in ("l", "r"):
        by_id[f"arm-{side}"]["localFeatures"] = [
            ARM_DETAIL,
            "shoulder pivot for the run cycle swing",
            f"wrist held at x={WRIST[0]}u: deliberate inboard departure from the reference's 1.173u span",
        ]
        by_id[f"sole-{side}"]["localFeatures"] = [SOLE_DETAIL]

    # keep the detailInventory refs pointing at the strings above
    for item in spec["preSpecAssessment"]["detailInventory"]["details"]:
        ref = item.get("mapsTo", {}).get("ref", "")
        for owner, text in (("mouth", MOUTH_DETAIL), ("torso", TORSO_DETAIL),
                            ("arm-l", ARM_DETAIL), ("sole-l", SOLE_DETAIL)):
            if ref.startswith(owner + "/"):
                item["detail"] = text
                item["mapsTo"]["ref"] = f"{owner}/{text}"


# Identity-defining systems, each bound to the passes where it can actually be judged. The
# template shipped twelve targets with no passIds at all, which meant the feature gate had
# nothing to check on any pass. Duplicates are merged: proportion-3heads into anatomy-proportion,
# silhouette-width into pose-silhouette. Policy caps are 5 critical and 3 important per pass.
FEATURE_TARGETS = [
    {
        "id": "anatomy-proportion", "name": "anatomy proportion", "tier": "critical",
        "target": "3.06 head units over a 1.9u figure: crown 1.898, neck pinch 1.279, shirt hem 0.660, ground 0",
        "passIds": ["blockout", "structural-pass", "proportion-lock"], "minimumScore": 0.8,
    },
    {
        "id": "pose-silhouette", "name": "pose silhouette", "tier": "critical",
        "target": "relaxed A-pose, arms clear of the torso, resting silhouette at or under 0.94u",
        "passIds": ["blockout", "proportion-lock", "interaction-pass"], "minimumScore": 0.8,
    },
    {
        "id": "face-landmark-placement", "name": "face landmark placement", "tier": "critical",
        "target": "eyes at y=1.484 and x=+/-0.108; mouth arc at y=1.400; ears spanning y=1.41 to 1.53",
        "passIds": ["feature-placement"], "minimumScore": 0.8,
    },
    {
        "id": "outfit-and-palette", "name": "outfit and palette", "tier": "critical",
        "target": "purple shirt #8e67d8, coral straps #f18979, navy hair and trousers #313a51, "
                  "cream skin #fbdfb4, cream sneaker upper #efe6d9 on an ink sole #252d42",
        "passIds": ["material-pass", "lighting-pass"], "minimumScore": 0.8,
    },
    {
        "id": "pear-torso", "name": "pear torso", "tier": "important",
        "target": "shirt 0.300u across at the shoulder, 0.524u at the belly (y=0.948), 0.376u at the hem",
        "passIds": ["blockout", "structural-pass"], "minimumScore": 0.65,
    },
    {
        "id": "mitten-hands", "name": "mitten hands", "tier": "important",
        "target": "rounded mitten mass at the cuff, no separated fingers",
        "passIds": ["structural-pass"], "minimumScore": 0.65,
    },
    {
        "id": "coral-straps", "name": "coral straps", "tier": "important",
        "target": "two coral straps over the shoulders, the only warm accent on the figure",
        "passIds": ["feature-placement"], "minimumScore": 0.65,
    },
    {
        "id": "dot-eyes-no-sclera", "name": "dot eyes no sclera", "tier": "important",
        "target": "opaque near-black dots, no whites, no specular highlight",
        "passIds": ["feature-placement"], "minimumScore": 0.65,
    },
    {
        "id": "sole-rim", "name": "sole rim", "tier": "important",
        "target": "dark sole rim proud of the cream upper on every side",
        "passIds": ["feature-placement", "material-pass"], "minimumScore": 0.65,
    },
    {
        "id": "uniform-bevel", "name": "uniform bevel", "tier": "important",
        "target": "no hard edge anywhere on the figure; every mass reads rounded",
        "passIds": ["material-pass", "optimization-pass"], "minimumScore": 0.65,
    },
]


def patch_passes(spec: dict) -> None:
    # The four grouping nodes are rig scaffolding and render as nothing, so the blockout pass
    # carries the masses that actually make the macro silhouette: head, torso and the four limbs.
    macro = ["root", "head-group", "body-group", "legs-group",
             "head", "torso", "shoulder-l", "shoulder-r", "arm-l", "arm-r", "leg-l", "leg-r"]
    structure = macro + ["neck", "hair-cap", "hand-l", "hand-r", "shoe-l", "shoe-r", "sole-l", "sole-r"]
    features = structure + ["ear-l", "ear-r", "eye-l", "eye-r", "nose", "mouth", "strap-l", "strap-r"]
    spec["buildPasses"] = [
        {
            "id": "blockout",
            "goal": "Land the three macro masses on the measured head-unit ladder: crown 1.898, neck pinch 1.279, hem 0.660, ground 0.",
            "componentRefs": macro,
            "acceptance": ["Total height 1.9u across 3.06 head units, with the group centres on the measured landmarks."],
        },
        {
            "id": "structural-pass",
            "goal": "Build the component hierarchy: torso lathe, neck, limbs on their swing pivots, hands and shoes.",
            "componentRefs": structure,
            "acceptance": [
                "Every mass from the reference exists as its own named component, with no two fused onto one mesh.",
                "Limb nodes sit on their pivots so the run cycle can drive them.",
            ],
        },
        {
            "id": "proportion-lock",
            "goal": "Lock the measured ratios and the gameplay silhouette cap.",
            "componentRefs": structure,
            "acceptance": [
                "Head 0.733u wide against a 1.9u figure; torso widest 0.524u at y=0.948; legs 0.373u of visible trouser.",
                "Resting silhouette at or under 0.94u.",
            ],
        },
        {
            "id": "feature-placement",
            "goal": "Place the face landmarks, hair cap, straps and soles against measured pixel positions.",
            "componentRefs": features,
            "acceptance": [
                "Eyes centred at y=1.484 and x=+/-0.108; mouth arc at y=1.400; ears spanning y=1.41 to 1.53.",
                "Coral straps read as the only warm accent; sole reads dark against the upper.",
            ],
        },
        {
            "id": "material-pass",
            "goal": "Match the measured palette and the uniformly matte clay response.",
            "componentRefs": features,
            "acceptance": [
                "Per-part albedo within measurement tolerance of the recorded palette.",
                "No specular hotspot anywhere: the reference has none.",
            ],
        },
        {
            "id": "lighting-pass",
            "goal": "Reproduce the measured key/fill ratio and prove the form survives relighting.",
            "componentRefs": features,
            "acceptance": [
                "Face luminance falls from about 0.90 at the crown to about 0.60 under the chin, as measured.",
                "Form still reads under neutral light with no reference lighting to lean on.",
            ],
        },
        {
            "id": "interaction-pass",
            "goal": "Expose the runtime rig the game drives: shoulder and hip swing pivots, head node, collider proxy.",
            "componentRefs": features,
            "acceptance": ["Swinging the limb nodes moves hands and shoes with them and never detaches a part."],
        },
        {
            "id": "optimization-pass",
            "goal": "Hold the real-time budget for a cloned player character.",
            "componentRefs": features,
            "acceptance": ["Triangle and draw-call counts inside the performance budget with the template cloned per instance."],
        },
    ]
    spec["sculptPipeline"]["passOrder"] = [item["id"] for item in spec["buildPasses"]]
    spec["selfCorrectLoop"]["reviewAfterPasses"] = spec["sculptPipeline"]["passOrder"]
    spec["featureReviewTargets"] = FEATURE_TARGETS

    # fidelityTier decides which pass first renders a component. The character template shipped
    # every component tagged "blockout", which made the blockout render the finished figure and
    # left the staged review with nothing to stage.
    first_pass = {}
    for item in spec["buildPasses"]:
        for ref in item["componentRefs"]:
            first_pass.setdefault(ref, item["id"])
    for component in spec["componentTree"]:
        component["fidelityTier"] = first_pass.get(component["id"], "structural-pass")
        component["level"] = {
            "blockout": "macro",
            "structural-pass": "meso",
        }.get(component["fidelityTier"], "micro")


def patch_repetition(spec: dict) -> None:
    """The bilateral-mirror system builds no geometry of its own.

    The template shipped it with count 2, primitive box and the hidden material, and the factory
    turned that into an InstancedMesh of two unit cubes at the origin. They are invisible, but they
    spanned -0.5 to 0.5 on every axis and so set the model's measured bounds to 1.000 wide instead
    of the figure's 0.817 - which is the number the 0.94u gameplay cap is checked against. Every
    mirrored pair on this figure is authored explicitly as a left and a right component, so the
    record stays as documentation of the symmetry and the geometry is switched off.
    """
    for system in spec.get("repetitionSystems", []):
        if system.get("id") != "bilateral-mirror":
            continue
        system["count"] = 0
        system["buildsGeometry"] = False
        system["realization"] = "authored-pairs"
        system["notes"] = (
            "Eight part families exist only as mirrored pairs and the reference is symmetric about "
            "the centre axis to within measurement error. Both sides are authored explicitly as "
            "components rather than instanced, so this system builds no geometry: count is 0 and "
            "buildsGeometry is false. Left as count 2 the factory emitted two unit cubes at the "
            "origin that were invisible but still set the model's bounding box to 1.000u wide."
        )


def patch_records(spec: dict) -> None:
    spec["measuredFrame"] = MEASURED
    spec["landmarkCrossCheck"] = LANDMARK_CROSSCHECK
    risks = spec.setdefault("risks", [])
    existing = " ".join(str(r) for r in risks)
    additions = [
        (
            "anatomy.json records the eye line at 0.176 of figure height below the crown; the pupils "
            "measure at 0.218. This spec builds to the measured position and leaves anatomy.json "
            "unchanged. See landmarkCrossCheck."
        ),
        (
            "Shoe length, torso depth and everything behind the figure are inferred. The reference is "
            "a single front view, so depth carries the lowest confidence of any dimension here."
        ),
        (
            "The hair is a single ellipsoid cap. The reference's fringe notch over the forehead and "
            "the parting are not reproduced."
        ),
        (
            "The hand is one rounded blob. The reference's three-lobed mitten with a separated thumb "
            "is not reproduced."
        ),
        (
            "referencePbr.usable is false on every material by design. The extracted maps carry the "
            "reference's baked lighting and the render's compression grain, the factory would try to "
            "load them by absolute disk path in a browser, and the runtime builds independent "
            "procedural fields instead."
        ),
    ]
    for item in additions:
        if item[:60] not in existing:
            risks.append(item)


def main() -> None:
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    patch_materials(spec)
    patch_lookdev(spec)
    patch_lighting(spec)
    patch_components(spec)
    patch_passes(spec)
    patch_repetition(spec)
    patch_records(spec)
    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {SPEC}")


if __name__ == "__main__":
    main()
