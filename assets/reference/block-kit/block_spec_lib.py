#!/usr/bin/env python3
"""ObjectSculptSpec authoring helpers for the level building blocks.

One library for every block because the blocks differ in geometry and in almost
nothing else: they share a palette, a grid, a material vocabulary, a review-pass
ladder, and a cost model. A per-block author script supplies the components, the
materials' colours, and the detail inventory read off its own reference; everything
structural comes from here.

Each block's author script is `assets/reference/block-<stem>/author_<stem>_spec.py`
and imports this module by relative path.
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import grid  # noqa: E402  (path is set immediately above)

PROJECT = pathlib.Path(__file__).resolve().parents[3]

# The game palette, mirrored from lib/game/constants.ts. `danger` is deliberately
# absent: #b3123c marks ground a hazard can reach and appears on nothing else, so a
# block that borrowed it would teach the player to fear a wall.
PALETTE = {
    "ink": "#171a2b",
    "cream": "#fff8e8",
    "yellow": "#ffd84d",
    "red": "#ff5c65",
    "green": "#57dfa1",
    "purple": "#8b72ff",
    "blue": "#4b8dff",
    "orange": "#ff9b4a",
    "muted": "#6e7487",
}
FORBIDDEN_COLOURS = {"#b3123c"}

TERMINOLOGY_PROFILE = {
    "domain": "stylised interior architecture, real-time",
    "geometryTerms": [
        "chamfer", "fillet", "reveal", "rebate", "nosing", "riser", "tread",
        "stile", "rail", "plinth", "soffit", "extrusion profile", "tiling pitch",
    ],
    "materialTerms": [
        "albedo", "roughness", "metalness", "ambient occlusion", "normal",
        "tone drift", "contact darkening", "edge wear",
    ],
    "lightingTerms": ["key", "fill", "rim", "hemisphere", "grazing", "contact shadow"],
    "descriptionRule": "3D-graphics vocabulary only; never nice, smooth, shiny or clean.",
}


# ---------------------------------------------------------------------------
# grid-aware geometry helpers
# ---------------------------------------------------------------------------
def snap(value: float) -> float:
    """Every authored dimension goes through this so nothing drifts off the grid."""
    return grid.snap(value)


def modules(count: float) -> float:
    """A length in tiling modules, snapped."""
    return snap(count * grid.MODULE)


def chamfered_rect(width: float, depth: float, chamfer: float,
                   cx: float = 0.0, cy: float = 0.0) -> list[list[float]]:
    """Plan outline with 45-degree corner facets, the shape language the shipped
    architecture already uses (RoundedBox arches, the toaster's plan chamfer).

    Authored on the grid, so two of these butted together share an edge plane
    exactly - a rounded corner would leave four crescents of background at every
    junction, which is the classic tiling failure.
    """
    hw, hd, c = width / 2, depth / 2, chamfer
    return [
        [snap(cx + hw), snap(cy - hd + c)], [snap(cx + hw), snap(cy + hd - c)],
        [snap(cx + hw - c), snap(cy + hd)], [snap(cx - hw + c), snap(cy + hd)],
        [snap(cx - hw), snap(cy + hd - c)], [snap(cx - hw), snap(cy - hd + c)],
        [snap(cx - hw + c), snap(cy - hd)], [snap(cx + hw - c), snap(cy - hd)],
    ]


def rect(width: float, depth: float, cx: float = 0.0, cy: float = 0.0) -> list[list[float]]:
    """Square-cornered plan outline, for the faces that have to meet a neighbour."""
    hw, hd = width / 2, depth / 2
    return [
        [snap(cx + hw), snap(cy - hd)], [snap(cx + hw), snap(cy + hd)],
        [snap(cx - hw), snap(cy + hd)], [snap(cx - hw), snap(cy - hd)],
    ]


def profile(points: list[list[float]], depth: float,
            holes: list[list[list[float]]] | None = None) -> dict:
    """A constant-section extrusion in the shape plane, swept along +Z.

    Deliberately no `axis` or `axisOffset`. The generator's buildExtrudeGeometry knows
    only points, depth and holes, so those fields would be silently dropped and the
    part would land as a flat prism at the origin - which typechecks and renders, and
    is wrong. Orientation comes from the component's own transform.rotation instead:
    a member running down the course needs none, an upright needs rotation.x of
    -PI/2. Blocks are straight prisms, so nothing here needs a taper; a block that
    genuinely does needs the profileStops extension ported first, not this quietly
    extended.
    """
    out = {"points": points, "depth": snap(depth)}
    if holes:
        out["holes"] = holes
    return out


# Rotations that stand a +Z extrusion up. Named because the sign is easy to get wrong
# and an inverted member is an inside-out mesh that still renders.
UPRIGHT = (-1.5707963267948966, 0.0, 0.0)     # profile in XY, swept up +Y
ACROSS = (0.0, 1.5707963267948966, 0.0)       # swept along +X, wall to wall


def xform(position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)) -> dict:
    """Container and root scale is always [1,1,1]: children inherit it, so a 'hide'
    scale shrinks the whole block to a speck. Hide with opacity, never with scale."""
    return {
        "position": [snap(v) for v in position],
        "rotation": [round(v, 6) for v in rotation],
        "scale": [round(v, 6) for v in scale],
    }


def dims(width: float, height: float, depth: float, confidence: float = 0.8) -> dict:
    return {"width": snap(width), "height": snap(height), "depth": snap(depth),
            "units": "world", "confidence": confidence}


def _rgba(hex_colour: str) -> str:
    raw = hex_colour.lstrip("#")
    r, g, b = (int(raw[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, 1.0)"


def shade(hex_colour: str, factor: float = 0.9) -> str:
    raw = hex_colour.lstrip("#")
    channels = [min(255, max(0, round(int(raw[i:i + 2], 16) * factor))) for i in (0, 2, 4)]
    return "#%02x%02x%02x" % tuple(channels)


def recipe(dominant: str, secondary: str | None = None,
           material_class: str = "plastic", confidence: float = 0.85) -> dict:
    if dominant.lower() in FORBIDDEN_COLOURS or (secondary or "").lower() in FORBIDDEN_COLOURS:
        raise ValueError("PALETTE.danger is reserved for hazard ground markers, "
                         "never for architecture")
    return {
        "dominantAlbedo": _rgba(dominant),
        "secondaryAlbedo": _rgba(secondary or shade(dominant)),
        "materialClass": material_class,
        "materialClassConfidence": confidence,
    }


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
def action(role: str = "static", pivot_mode: str = "center",
           pivot_position=(0.0, 0.0, 0.0), axis=(0.0, 1.0, 0.0),
           collider: dict | None = None, sockets: list[dict] | None = None,
           fracture_group: str = "", debris_material: str = "") -> dict:
    return {
        "animationRole": role,
        "pivot": {"mode": pivot_mode, "localPosition": [snap(v) for v in pivot_position],
                  "axis": list(axis), "confidence": 0.85},
        "transformChannels": {"translate": False, "rotate": False, "scale": False,
                              "bend": False, "twist": False, "detach": False,
                              "visibility": True, "materialState": True},
        "sockets": sockets or [],
        "collider": collider or {"type": "box", "offset": [0.0, 0.0, 0.0],
                                 "scale": [1.0, 1.0, 1.0], "isTrigger": False,
                                 "notes": "Box proxy sized to the part bounds."},
        "constraints": [],
        "destruction": {"breakable": False, "fractureGroup": fracture_group,
                        "seamRefs": [], "detachableFragments": [],
                        "breakImpulse": 0.0, "debrisMaterial": debris_material},
    }


def feature(fid: str, description: str, geometry: str, evidence: list[str],
            confidence: float = 0.8) -> dict:
    return {"id": fid, "description": description, "geometry": geometry,
            "evidenceRefs": evidence, "confidence": confidence}


def surface(macro_roughness: float, micro_roughness: float, normal_pattern: str,
            occlusion: str, bump: float = 0.0, edge_wear: str = "none",
            notes: str = "") -> dict:
    return {"macroRoughness": macro_roughness, "microRoughness": micro_roughness,
            "bumpAmplitude": bump, "normalPattern": normal_pattern,
            "displacementPattern": "none", "occlusionPattern": occlusion,
            "edgeWearPattern": edge_wear, "notes": notes}


def component(cid: str, name: str, level: str, role: str, primitive: str,
              topology_class: str, topology_rationale: str,
              material: str, colour_recipe: dict, geometry_descriptor: dict,
              dimensions: dict, transform: dict, action_profile: dict,
              evidence: list[str], local_features: list[dict],
              surface_detail: dict, parent: str | None = None,
              seams: list[dict] | None = None, importance: float = 0.7,
              confidence: float = 0.8, fidelity_tier: str = "form-refinement") -> dict:
    return {
        "id": cid, "name": name, "level": level, "role": role,
        "importance": importance, "confidence": confidence,
        "primitive": primitive,
        "topologyClass": topology_class, "topologyRationale": topology_rationale,
        "colorMaterialRecipe": colour_recipe,
        "geometryDescriptor": geometry_descriptor,
        "parent": parent, "attachment": None,
        "dimensions": dimensions, "transform": transform,
        "actionProfile": action_profile,
        "material": material, "materialLayers": [material],
        "deformations": [], "joints": [], "seams": seams or [],
        "localFeatures": local_features, "surfaceDetail": surface_detail,
        "evidenceRefs": evidence, "details": [], "fidelityTier": fidelity_tier,
    }


def descriptor(intent: str, edge_type: str = "flat-chamfer", bevel_radius: float = 0.0,
               segments: int = 1, deformations: list[str] | None = None,
               profile_2d: dict | None = None, base_geometry: str | None = None) -> dict:
    out = {
        "topologyIntent": intent,
        "edgeTreatment": {"type": edge_type, "bevelRadius": bevel_radius, "segments": segments},
        "deformationStack": deformations or [],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs, one tile per module so the "
                      "texel density does not change with block length",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
    }
    if profile_2d:
        out["profile2D"] = profile_2d
    if base_geometry:
        out["baseGeometry"] = base_geometry
    return out


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def reference_pbr(stem: str, material_id: str, confidence: float, note: str) -> dict:
    """referencePbr.usable stays FALSE on every block, deliberately.

    extract_pbr_evidence writes its maps to disk and referenceMapUrl() would load
    them by absolute disk path, which cannot resolve in a browser. The extracted
    palettes and roughness estimates are used as evidence for the scalars below; the
    runtime builds its own procedural canvas maps so the asset stays self-contained.
    """
    crop = PROJECT / "assets" / "reference" / stem / "evidence" / "crops" / f"{material_id}-crop.png"
    pbr = PROJECT / "assets" / "reference" / stem / "evidence" / "pbr"
    # extract_pbr_evidence.py writes these five files per material. They are recorded
    # so the provenance of every scalar above is traceable to a file on disk, and NOT
    # bound at runtime - see usable below.
    maps = {
        channel: {"path": str(pbr / f"{material_id}_{suffix}.png"), "channel": channel}
        for channel, suffix in (("albedo", "albedo"), ("roughness", "roughness"),
                                ("height", "height"), ("normal", "normal"), ("ao", "ao"))
    }
    return {
        "version": "1.0",
        "sourceImage": str(crop),
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": "pass" if confidence >= 0.7 else "low-confidence",
        "confidence": confidence,
        "estimatedFidelity": confidence,
        "targetThreshold": 0.7,
        "hardLimit": "A single image cannot uniquely recover true albedo, roughness, "
                     "normal and AO; the maps are reference-derived estimates.",
        "limitationNote": note,
        "maps": maps,
    }


def material(stem: str, mid: str, name: str, base: str, palette: list[str],
             roughness: float, overrides: list[dict], ao_note: str,
             pbr_confidence: float = 0.8, roughness_variation: float = 0.1,
             metalness: float = 0.0, dirt_amount: float = 0.04,
             edge_wear: float = 0.06, texture_resolution: int = 256,
             shader_notes: list[str] | None = None) -> dict:
    if base.lower() in FORBIDDEN_COLOURS:
        raise ValueError("PALETTE.danger is reserved for hazard ground markers")
    return {
        "id": mid, "name": name, "type": "physical",
        "shaderModel": "MeshPhysicalMaterial (matte moulded interior finish)",
        "baseColor": base, "color": base,
        "albedo": {"dominant": base, "secondary": palette[1:],
                   "samplingNotes": "Median-sampled from named regions of the reference "
                                    "and cross-checked against the extract_pbr_evidence "
                                    "palette for the same crop.",
                   "map": None},
        "colorVariation": {
            "palette": palette,
            # A block is seen hundreds of times, so its tone drift has to be low
            # amplitude AND anchored to object space rather than to the tile. Drift
            # keyed to the tile index would strobe down the run; drift keyed to world
            # position breaks the instancing. Low amplitude is the honest answer.
            "pattern": "low-amplitude moulding tone drift, one tile per module so the "
                       "pattern never lines up with the tiling pitch",
            "amplitude": 0.022, "heightCorrelation": 0.2,
        },
        "textureResolution": texture_resolution,
        "textureProjection": {
            "mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8,
            "texelDensityIntent": "One tile per module, so a two-module block and a "
                                  "one-module block carry the same texel density and "
                                  "a run of mixed lengths does not change grain.",
        },
        "surfaceFrequencyBands": [
            {"id": "macro", "frequency": 2.5, "amplitude": 0.3,
             "role": "broad tone drift across a moulded face"},
            {"id": "meso", "frequency": 12.0, "amplitude": 0.15,
             "role": "shallow moulding flow and panel relief"},
            {"id": "micro", "frequency": 58.0, "amplitude": 0.05,
             "role": "matte highlight breakup under grazing light"},
        ],
        "roughness": {"base": roughness, "variation": roughness_variation,
                      "map": "independent-procedural-field",
                      "localResponse": "reveals and rebates trend rougher; chamfer crowns "
                                       "trend slightly smoother"},
        "metalness": {"base": metalness, "variation": 0.0},
        "clearcoat": {"base": 0.0},
        "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16,
                   "scale": 16.0, "space": "tangent"},
        "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0},
        "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0,
                         "silhouetteAffects": False},
        "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.3,
                             "notes": ao_note},
        "wear": {"edgeWear": edge_wear, "scratches": [], "chips": []},
        "dirt": {"amount": dirt_amount, "cavityBias": 0.4, "color": "#3b372f"},
        "localOverrides": overrides,
        "envMapIntensity": 0.5,
        "shaderNotes": shader_notes or [
            "MeshPhysicalMaterial with clearcoat and transmission at zero: painted "
            "interior joinery, not a lacquered surface.",
            "Albedo, roughness, height, normal and AO are five independent procedural "
            "fields; albedo is never aliased into another channel.",
            "Deterministic seed: the factory hashes the material id, so a run of "
            "instances is identical rather than flickering between reloads.",
        ],
        "referencePbr": reference_pbr(stem, mid, pbr_confidence,
                                      "Extraction is evidence for the scalars above, not a "
                                      "runtime binding. referenceMapUrl() resolves maps by "
                                      "absolute disk path, which cannot load in a browser, so "
                                      "usable stays false and the runtime rasterises its own "
                                      "maps at 256px."),
    }


def override(oid: str, target: str, notes: str, evidence: list[str], **fields) -> dict:
    return {"id": oid, "target": target, "notes": notes, "evidenceRefs": evidence, **fields}


# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
# The validator's taxonomy. Authoring against it here rather than discovering a
# rejection at the gate: a kind outside this set is silently downgraded to a warning
# that then blocks strict-quality, which is a slow way to learn a spelling.
VALID_DETAIL_KINDS = {
    "gloss", "bevel", "fastener", "linework", "contour", "seam", "stitch",
    "stain", "scratch", "chip", "decal", "emissive", "hole", "groove", "ridge",
}


def detail(did: str, zone: str, kind: str, description: str, geometry: str,
           maps_to: str, evidence: str, confidence: float = 0.8) -> dict:
    """One identity-defining detail, bound to the thing that implements it.

    `maps_to` must name a component id, a localFeature id (bare or `component/feature`),
    a material id, or a localOverride id (bare or `material/override`). A detail that
    maps to nothing is prose, and the gate rejects prose.
    """
    if kind not in VALID_DETAIL_KINDS:
        raise ValueError(f"detail kind {kind!r} is not in the validator's taxonomy: "
                         f"{sorted(VALID_DETAIL_KINDS)}")
    return {"id": did, "zone": zone, "kind": kind, "description": description,
            "geometryOrMaterial": geometry, "mapsTo": {"ref": maps_to},
            "evidenceRef": evidence, "confidence": confidence}


def lighting_from_photo(key: str, fill: str, rim: str, extra: list[str] | None = None) -> list[str]:
    """The lighting read off the reference, plus the exposure and tone-mapping intent
    the gate requires.

    The last entry is not boilerplate: a block is reviewed in the harness and shipped
    into the game, and if the two disagree on tone mapping the reviewed contrast is
    not the shipped contrast. Stating it here is what keeps the review honest.
    """
    return [key, fill, rim, *(extra or []),
            "contact shadow onto the deck, shadow bias -0.0004, normal bias 0.02",
            "grazing pass across the seam, because a join that survives a hero angle "
            "still shows when the light rakes along the run",
            "exposure 1.0 with ACES filmic tone mapping, matching the game renderer so "
            "the contrast reviewed here is the contrast that ships"]


def suitability_scores(object_isolation: int, silhouette_readability: int,
                       depth_inference: int, primitive_decomposition: int,
                       material_procedurality: int, occlusion_risk: int,
                       interaction_fit: int) -> dict:
    """Each axis is an integer 0-3, not 0-5. The validator rejects anything else."""
    scores = {
        "object_isolation": object_isolation,
        "silhouette_readability": silhouette_readability,
        "depth_inference": depth_inference,
        "primitive_decomposition": primitive_decomposition,
        "material_procedurality": material_procedurality,
        "occlusion_risk": occlusion_risk,
        "interaction_fit": interaction_fit,
    }
    for name, value in scores.items():
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 3:
            raise ValueError(f"suitability score {name}={value!r} must be an integer 0-3")
    return scores


def detail_inventory(details: list[dict], target_min: int) -> dict:
    return {
        "scanMethod": "grid-3x3 zone scan of the reference at full resolution, then a "
                      "second pass along the tiling edges where a seam would show",
        "targetMinDetails": target_min,
        "note": "Every entry maps to a component.localFeatures or "
                "material.localOverrides entry; none is prose only.",
        "details": details,
    }


# ---------------------------------------------------------------------------
# repetition systems
# ---------------------------------------------------------------------------
def repetition_system(rid: str, name: str, parent: str, material: str, count: int,
                      instance_scale: tuple[float, float, float], placement: dict,
                      evidence: list[str], notes: str, primitive: str = "box",
                      level: str = "micro") -> dict:
    """Repeated detail inside one block becomes an InstancedMesh, one draw call.

    Blocks are also instanced ACROSS the course by the level renderer, so a
    repetition system here multiplies with that: N of these inside a block that is
    itself placed 950 times is N x 950 instances of the same geometry. Keep counts
    small, and say what the variation rule is, because unvaried repetition inside
    something already repeated hundreds of times is exactly what reads as wallpaper.
    """
    return {
        "id": rid, "name": name, "level": level, "parent": parent,
        "count": count, "primitive": primitive, "material": material,
        "instanceScale": [snap(v) for v in instance_scale],
        "buildsGeometry": True, "realization": "instanced-mesh",
        "placement": placement,
        "evidenceRefs": evidence,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# passes, contract, loop
# ---------------------------------------------------------------------------
PASS_ORDER = ["blockout", "structural-pass", "form-refinement", "material-pass",
              "lighting-pass", "interaction-pass", "optimization-pass"]

REVIEW_VIEWS = [
    "single: three-quarter hero at azimuth 41, elevation 19",
    "seam: raking close-up on the join between two copies",
    "course: player eye height looking down a 24-copy run",
    "tile-run: eight copies on the authored pitch, three-quarter",
    "single-clay: maps stripped, for the Tier 1 silhouette gate",
]


def build_passes(stem: str, goals: dict[str, str]) -> list[dict]:
    refs = [f"assets/reference/{stem}/renders"]
    return [
        {"id": pid, "goal": goals[pid], "acceptanceCriteria": _pass_criteria(pid),
         "evidenceRefs": refs, "reviewViewpoints": REVIEW_VIEWS}
        for pid in PASS_ORDER
    ]


def _pass_criteria(pass_id: str) -> list[str]:
    shared = [
        "render screenshot from the block preview harness",
        "side-by-side comparison sheet against the reference",
        "AI vision score >= 0.7 with per-layer scores",
        "every critical feature at or above its own threshold",
        # The two criteria a prop does not have. A block that scores well as a single
        # object and badly as a run has failed at the thing it is for.
        "measured seam gap between adjacent copies within 1e-4 world units",
        "measured triangle count at or under the block's budget in grid.py",
    ]
    if pass_id == "blockout":
        return ["silhouette reads as the reference's block type from the hero view",
                "footprint is a whole number of tiling modules"] + shared
    if pass_id == "optimization-pass":
        return ["merged geometry per material exported for course-level instancing",
                "draw calls per material constant in the number of instances"] + shared
    return shared


def quality_contract(quality_bar: str, done: list[str], feature_groups: list[dict],
                     delta_checks: list[str], min_depth: dict) -> dict:
    # Three is the gate's floor. Fewer means a whole visual layer - silhouette,
    # surface, or the tiling behaviour that makes this a block rather than a prop -
    # has no acceptance criteria attached to it.
    if len(feature_groups) < 3:
        raise ValueError(f"a block contract needs at least 3 feature groups, got "
                         f"{len(feature_groups)}")
    return {
        "qualityBar": quality_bar,
        "definitionOfDone": done,
        "minimumSpecDepth": min_depth,
        "featureGroups": feature_groups,
        "visualDeltaChecks": delta_checks,
        "antiShallowSpecRules": [
            "Every component carries a topologyClass and a rationale before a primitive "
            "is chosen.",
            "Every dimension is a multiple of the 0.05u level quantum.",
            "Every block footprint is a whole number of 0.6u tiling modules.",
            "Every detail in the inventory maps to a real component or material entry.",
            "Materials carry independent albedo, roughness, height, normal and AO fields.",
            "Local overrides name where, what changes, how strong, and the evidence.",
            "Repetition systems state their variation rule, not just their count.",
            "The seam between two copies is measured, not asserted.",
            "The triangle count is stated per block and multiplied out over the course.",
            "Colour comes from a sampled median, never from a visual estimate.",
            "PALETTE.danger never appears on architecture.",
        ],
        "mustNotDo": [
            "Do not round a block's tiling face, which leaves a crescent of background "
            "at every junction.",
            "Do not let a footprint fall off the tiling module.",
            "Do not vary a block by shifting its outer faces; vary the interior only.",
            "Do not place surface detail on the tiling face where the seam falls.",
            "Do not cover the platform ink edge band.",
            "Do not author per-instance draw calls for geometry repeated hundreds of times.",
            "Do not alias albedo into roughness, normal or AO.",
            "Do not bind reference PBR maps by absolute disk path.",
            "Do not use PALETTE.danger.",
            "Do not exceed the block's triangle ceiling in grid.py.",
            "Do not claim a seam meets without the measured gap.",
        ],
    }


def self_correct_loop(passes: list[dict]) -> dict:
    return {
        "enabled": True,
        "visualAcceptance": {
            "reviewer": "ai-agent",
            "threshold": 0.7,
            "comparisonArtifactRequired": True,
            "layerScoresRequired": True,
            "codePixelDiffIsAcceptanceAuthority": False,
            "scoringRule": "The global score never overrides a failed critical feature, "
                           "and neither overrides a measured seam gap: a block that looks "
                           "right and does not tile has failed.",
            "requiredLayerScores": ["silhouetteProportion", "componentStructure",
                                    "formDetail", "materialSurface", "lightingCamera"],
            "featureReviewPolicy": {
                "enabled": True, "maxCritical": 5, "maxImportant": 3,
                "criticalThreshold": 0.7, "importantThreshold": 0.6,
                "blockOnCriticalFailure": True,
                "blockOnImportantFailure": False,
                "requireAllCriticalScored": True,
                "requireEvidencePerFeature": True,
                "notes": "Tiering follows the ≤5 critical / ≤3 important policy in "
                         "forge/_shared/feature_acceptance_policy.py.",
            },
        },
        "reviewAfterPasses": [p["id"] for p in passes],
        "allowedActions": ["continue", "refine-spec", "refine-code", "request-input", "stop"],
        "specRefineTriggers": [
            "footprint is not a whole number of modules",
            "a component has no topologyClass",
            "a detail in the inventory maps to nothing",
            "the triangle ceiling cannot be met at the specified depth",
            "the reference shows a feature the component tree does not name",
            "the tiling face carries detail that would break at the seam",
        ],
        "codeRefineTriggers": [
            "measured seam gap is non-zero at a correct pitch",
            "measured footprint is off the grid",
            "a material reads flat where the reference shows relief",
            "the block covers the platform ink edge band",
        ],
        "stopCriteria": [
            "three consecutive passes without a fidelity gain",
            "the reference cannot support the requested tiling behaviour",
        ],
        "screenshotPolicy": {
            "requiredForPasses": [p["id"] for p in passes],
            "preferredCapture": "block preview harness via preview/tile.mjs",
            "fallbackCapture": "user-supplied screenshot",
            "minimumEvidence": "One hero render, one raking seam close-up of the join "
                               "between two copies, one player-eye course run, and the "
                               "tiling JSON report carrying the measured seam gaps, the "
                               "edge-band clearance and the course cost.",
            "reviewPairRule": "Reference and render at the same framing in one sheet.",
            "acceptanceAuthority": "Agent vision on the comparison sheet, gated by the "
                                   "measured seam and cost numbers.",
        },
    }


LOOK_DEV_TARGETS = {
    "qualityPriority": "balanced",
    "materialPass": {
        "albedoPaletteRequired": True,
        "roughnessVariationRequired": True,
        "normalOrBumpRequired": True,
        "localOverridesRequired": True,
        "minimumTextureResolution": 128,
        # 256, not the generator's 1024 default. A block's maps are rasterised once
        # per session and shared by every instance, but 1024 costs seconds of page
        # load per material for detail no player sees on a 0.6u module.
        "preferredTextureResolution": 256,
        "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambientOcclusion"],
        "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"],
        "geometryReliefRequiredWhenSilhouetteAffected": True,
        "referencePbrExtraction": {
            "required": True, "targetThreshold": 0.7, "bindMapsAtRuntime": False,
            "reason": "referenceMapUrl() resolves by absolute disk path and cannot load "
                      "in a browser; the extraction is evidence for the scalars.",
            "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
            "note": "Confidence below 0.7 is a refine-input signal, not a pass.",
            "channels": ["albedo", "roughness", "height", "normal", "ambientOcclusion"],
        },
        "mustAvoid": [
            "aliasing albedo into roughness, normal or AO",
            "one flat colour with no roughness variation",
            "a normal map standing in for relief that changes the silhouette",
            "tone drift keyed to the tile index, which strobes down a run",
            "surface detail on the tiling face",
            "reference maps bound by absolute disk path",
            "PALETTE.danger on architecture",
        ],
    },
    "lightingPass": {
        "requiredTerms": ["key directional", "hemisphere fill", "rim directional",
                          "contact shadow", "grazing check", "shadow bias",
                          "shadow normal bias", "exposure", "tone mapping"],
        "exposure": 1.0,
        "toneMapping": "ACESFilmic, matching the game renderer so a block reviewed in "
                       "the harness reads the same in play",
        "mustAvoid": ["a single ambient term", "lighting that flattens the chamfers",
                      "a key angle that hides the seam", "blown highlights on the deck"],
    },
    "screenshotReview": REVIEW_VIEWS,
}


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
CARRIED_FIELDS = ("reviewHistory", "visualEvidence", "tier1Results", "sculptPipeline")


def performance_budget(stem: str, measured: dict | None = None) -> dict:
    _, runs, instances, ceiling = grid.BLOCK_BUDGETS[stem]
    return {
        "qualityPriority": "balanced",
        "targetTriangles": ceiling,
        "maxDrawCalls": 4,
        "textureSize": 256,
        "fpsTarget": 60,
        "courseModel": {
            "maxCourseLength": grid.MAX_COURSE_LENGTH,
            "runsAlong": runs,
            "worstCaseInstances": instances,
            "courseTriangleAllowance": instances * ceiling,
            "architectureBudget": grid.ARCHITECTURE_TRIANGLE_BUDGET,
        },
        "instancingStrategy": (
            "One template per session. The level renderer merges the template's meshes "
            "per material and draws each merged geometry as a single THREE.InstancedMesh "
            "over every placement, so draw calls are constant in the number of blocks "
            f"rather than linear: {instances} placements cost the same "
            "as one. Per-instance clones would cost one call per material per placement, "
            "plus the same again in the shadow pass, which is what makes a long course "
            "unshippable. Variation rides in the instance matrix and an instanced colour "
            "attribute, never in a per-instance material."
        ),
        "measured": measured or {},
        "optimizationPolicy": (
            "Reach accepted fidelity first, then reduce box tessellation and merge "
            "same-material parts. Never remove a chamfer facet: the chamfers are what "
            "catch the key light and stop a run of identical blocks reading as one wall."
        ),
    }


def assemble(*, stem: str, target_name: str, target_id: str, source_image: str,
             reference_camera: dict, measurement_basis: dict, suitability: str,
             scores: dict, pre_spec: dict, contract: dict, quality_targets: dict,
             feature_review_targets: list[dict], view_evidence: list[dict],
             components: list[dict], materials: list[dict],
             repetition_systems: list[dict], passes: list[dict], lighting: list[str],
             action_readiness: dict, assumptions: list[str], coordinate_frame: dict,
             silhouette: dict, lod_plan: list[dict], procedural_strategy: list[str],
             animation_anchors: list[str], destruction_anchors: list[str],
             risks: list[str], tiling: dict) -> dict:
    return {
        "targetName": target_name,
        "targetId": target_id,
        "schemaVersion": "2.1",
        "terminologyProfile": TERMINOLOGY_PROFILE,
        "sourceImage": source_image,
        "referenceCamera": reference_camera,
        "measurementBasis": measurement_basis,
        "suitability": suitability,
        "scores": scores,
        "preSpecAssessment": pre_spec,
        "qualityContract": contract,
        "qualityTargets": quality_targets,
        "selfCorrectLoop": self_correct_loop(passes),
        "featureReviewTargets": feature_review_targets,
        "sculptPipeline": {
            "passGateMode": "locked-sequential",
            "passOrder": [p["id"] for p in passes],
            "currentPass": passes[0]["id"],
            "completedPasses": [],
            "lastCompletedPass": "",
            "blockedReason": "blockout requires a browser screenshot and a self-correction "
                             "review before structural-pass unlocks",
            "nextRequiredEvidence": [
                "blockout render from the block preview harness",
                "map-stripped clay render for the Tier 1 blockout gate",
                "raking seam close-up of the join between two copies",
                "tiling JSON report with the measured seam gaps and course cost",
                "side-by-side reference/render comparison sheet",
                "AI vision score >= 0.7 with layer scores and mismatch critique",
                "reviewHistory entry for blockout with action=continue",
            ],
        },
        "lookDevTargets": LOOK_DEV_TARGETS,
        "actionReadiness": action_readiness,
        "assumptions": assumptions,
        "coordinateFrame": coordinate_frame,
        "silhouette": silhouette,
        "viewEvidence": view_evidence,
        "componentTree": components,
        "materials": materials,
        "repetitionSystems": repetition_systems,
        "buildPasses": passes,
        "visualEvidence": [],
        "reviewHistory": [],
        "lodPlan": lod_plan,
        "performanceBudget": performance_budget(stem),
        "lightingFromPhoto": lighting,
        "proceduralStrategy": procedural_strategy,
        "animationAnchors": animation_anchors,
        "destructionAnchors": destruction_anchors,
        "risks": risks,
        "localSpecSearch": {"collection": "core_3d", "query": target_name,
                            "index": {"status": "reused", "reason": "present"}, "matches": []},
        # Not part of the img2threejs schema. It is the block contract: the numbers the
        # level renderer needs to lay these out and the harness checks against.
        "tilingContract": tiling,
    }


def tiling_contract(pitch_x: float, pitch_z: float, footprint: tuple[float, float, float],
                    tiling_faces: list[str], variation_rule: str,
                    edge_keepout: float, notes: list[str]) -> dict:
    for name, value in (("pitchX", pitch_x), ("pitchZ", pitch_z)):
        if value and not grid.on_grid(value, grid.MODULE):
            raise ValueError(f"{name} {value} is not a whole number of {grid.MODULE}u modules")
    for axis, value in zip("xyz", footprint):
        if not grid.on_grid(value):
            raise ValueError(f"footprint {axis} {value} is off the {grid.QUANTUM}u quantum")
    return {
        "quantum": grid.QUANTUM,
        "module": grid.MODULE,
        "riser": grid.RISER,
        "pitchX": pitch_x,
        "pitchZ": pitch_z,
        "footprint": list(footprint),
        "tilingFaces": tiling_faces,
        "variationRule": variation_rule,
        "edgeKeepout": edge_keepout,
        "bayPitch": grid.BAY_PITCH,
        "notes": notes,
    }


def write_spec(out: pathlib.Path, spec: dict) -> None:
    """The review ledger is history, not authored content: re-running an author script
    must not erase which passes were reviewed or the evidence behind them."""
    if out.exists():
        previous = json.loads(out.read_text(encoding="utf-8"))
        carried = [f for f in CARRIED_FIELDS if f in previous]
        for field in carried:
            spec[field] = previous[field]
        if carried:
            print(f"carried forward: {', '.join(carried)}")
    out.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tiling = spec["tilingContract"]
    print(f"wrote {out}")
    print(f"components={len(spec['componentTree'])} materials={len(spec['materials'])} "
          f"repetitionSystems={len(spec['repetitionSystems'])} "
          f"details={len(spec['preSpecAssessment']['detailInventory']['details'])}")
    print(f"footprint={tiling['footprint']} pitch=({tiling['pitchX']}, {tiling['pitchZ']}) "
          f"module={tiling['module']}")
