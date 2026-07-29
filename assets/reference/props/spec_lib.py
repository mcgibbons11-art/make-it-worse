#!/usr/bin/env python3
"""Shared ObjectSculptSpec authoring helpers for the apartment props.

`assets/reference/toaster/author_toaster_spec.py` proved the shape a spec has to
have to clear `validate_sculpt_spec.py --strict-quality`, but it is one 2000-line
file for one object. Five props would be five copies of the same scaffolding, so
the parts that do not vary per object - the quality contract, the build passes,
the self-correction loop, the component and material record shapes - live here,
and each `author_<prop>_spec.py` supplies only what it measured off its own
reference.

Nothing in here invents geometry. Every number a prop spec cites comes from its
own author script, which cites the pixel measurement it came from.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]


# ---------------------------------------------------------------------------
# 2D profile helpers
# ---------------------------------------------------------------------------
def chamfered_rect(w: float, d: float, c: float, cx: float = 0.0, cy: float = 0.0):
    """Counter-clockwise octagon: a rectangle with all four corners cut at 45 degrees."""
    hw, hd = w / 2.0, d / 2.0
    pts = [
        (hw, -(hd - c)), (hw, hd - c), (hw - c, hd), (-(hw - c), hd),
        (-hw, hd - c), (-hw, -(hd - c)), (-(hw - c), -hd), (hw - c, -hd),
    ]
    return [[round(x + cx, 5), round(y + cy, 5)] for x, y in pts]


def regular_polygon(radius: float, sides: int, cx: float = 0.0, cy: float = 0.0,
                    phase: float | None = None):
    """Counter-clockwise regular polygon. `phase` defaults to half a step so a
    flat facet, not a vertex, faces +X."""
    offset = math.pi / sides if phase is None else phase
    return [[round(cx + radius * math.cos(i / sides * 2 * math.pi + offset), 5),
             round(cy + radius * math.sin(i / sides * 2 * math.pi + offset), 5)]
            for i in range(sides)]


def ellipse_polygon(rx: float, ry: float, sides: int, cx: float = 0.0, cy: float = 0.0):
    """Counter-clockwise ellipse sampled as a polygon. Used where the reference
    shows a stadium or oval plan that a circle would not match."""
    return [[round(cx + rx * math.cos(i / sides * 2 * math.pi), 5),
             round(cy + ry * math.sin(i / sides * 2 * math.pi), 5)]
            for i in range(sides)]


def stadium_polygon(length: float, width: float, sides: int, cx: float = 0.0, cy: float = 0.0):
    """Counter-clockwise stadium (obround): a rectangle capped by semicircles.
    A soap dish is a stadium, not an ellipse - its long sides are straight."""
    r = width / 2.0
    straight = max(0.0, length / 2.0 - r)
    per_cap = max(3, sides // 2)
    pts: list[list[float]] = []
    for i in range(per_cap + 1):
        a = -math.pi / 2 + math.pi * i / per_cap
        pts.append([round(cx + straight + r * math.cos(a), 5), round(cy + r * math.sin(a), 5)])
    for i in range(per_cap + 1):
        a = math.pi / 2 + math.pi * i / per_cap
        pts.append([round(cx - straight + r * math.cos(a), 5), round(cy + r * math.sin(a), 5)])
    return pts


def inset_scale(half_extent: float, inset: float) -> float:
    return round((half_extent - inset) / half_extent, 4)


def profile(points, depth, axis="z", axis_offset=0.0, steps=1, stops=None, exempt=None,
            holes=None):
    """geometryDescriptor.profile2D payload. `axis` / `axisOffset` / `steps` /
    `profileStops` / `profileExempt` are consumed by the extended
    buildExtrudeGeometry that refine_props.py installs in the generated factory."""
    item: dict[str, Any] = {"points": points, "depth": round(depth, 5), "axis": axis,
                            "axisOffset": round(axis_offset, 5)}
    if steps != 1:
        item["steps"] = steps
    if stops:
        item["profileStops"] = stops
    if exempt:
        item["profileExempt"] = exempt
    if holes:
        item["holes"] = holes
    return item


def bevel_stops(half_extent_x: float, half_extent_y: float, inset: float,
                lo: float = 0.18, hi: float = 0.82):
    """profileStops for a slab bevelled inward at both ends of the extrusion."""
    sx = inset_scale(half_extent_x, inset)
    sy = inset_scale(half_extent_y, inset)
    return [[0.0, sx, sy], [lo, 1.0, 1.0], [hi, 1.0, 1.0], [1.0, sx, sy]]


def dome_stops(half_extent_x: float, half_extent_y: float, inset: float, steps: int,
               start: float = 0.55):
    """profileStops that round the far end of an extrusion into a dome by easing
    the plan inward over the last `1 - start` of the sweep. A quarter-cosine, so
    the crown is tangent to the axis instead of meeting it at a cone point."""
    out = [[0.0, 1.0, 1.0]]
    rings = max(2, int(round(steps * (1.0 - start))))
    for i in range(1, rings + 1):
        t = start + (1.0 - start) * i / rings
        k = math.cos((i / rings) * math.pi / 2)
        out.append([round(t, 4),
                    round(1.0 - (1.0 - inset_scale(half_extent_x, inset)) * (1 - k), 4),
                    round(1.0 - (1.0 - inset_scale(half_extent_y, inset)) * (1 - k), 4)])
    return out


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def pbr_provenance(prop_id: str, material_id: str, confidence: float, note: str) -> dict:
    channels = ("albedo", "roughness", "height", "normal", "ao")
    crop = HERE / "evidence" / prop_id / "crops" / f"{material_id}-crop.png"
    pbr_dir = HERE / "evidence" / prop_id / "pbr"
    return {
        "version": "1.0",
        "sourceImage": str(crop),
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": "pass",
        "confidence": confidence,
        "estimatedFidelity": confidence,
        "targetThreshold": 0.7,
        "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; "
                     "maps are reference-derived estimates.",
        "limitationNote": note,
        "maps": {ch: {"path": str(pbr_dir / f"{material_id}_{ch}.png"), "channel": ch,
                      "source": "reference-pixel-extraction"} for ch in channels},
    }


PBR_NOTE = (
    "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime "
    "material. These references are flat-paint stylised studio renders with no surface pattern, so "
    "the extracted crops carry only baked lighting and crop-boundary contamination; tiling them "
    "would paint the reference's shading onto every facet. The runtime instead builds five "
    "independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays "
    "self-contained with no network-fetched textures. The extracted palettes and roughness "
    "estimates were used as evidence for the albedo and roughness scalars."
)


def material(prop_id: str, mid: str, name: str, base: str, palette: list[str],
             rough_base: float, rough_var: float, ao_cavity: float, confidence: float,
             overrides: list[dict], notes: str, texture_resolution: int = 1024,
             shader_model: str = "MeshPhysicalMaterial (matte injection-moulded ABS)") -> dict:
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
            "samplingNotes": "Median-sampled from named regions of the reference, cross-checked "
                             "against the extract_pbr_evidence palette for the same crop.",
            "map": None,
        },
        "colorVariation": {
            "palette": palette,
            "pattern": "very low amplitude injection-moulding tone drift; the reference shows "
                       "almost no albedo variance",
            "amplitude": 0.018,
            "heightCorrelation": 0.18,
        },
        "textureResolution": texture_resolution,
        "textureProjection": {
            "mode": "uv",
            "repeat": [1.0, 1.0],
            "anisotropy": 8,
            "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly "
                                  "on a small control; detail stays at object scale rather than "
                                  "stretching with component scale.",
        },
        "surfaceFrequencyBands": [
            {"id": "macro", "frequency": 3.0, "amplitude": 0.30,
             "role": "broad tone drift across a moulded panel"},
            {"id": "meso", "frequency": 14.0, "amplitude": 0.16,
             "role": "shallow moulding flow and sink-mark relief"},
            {"id": "micro", "frequency": 64.0, "amplitude": 0.05,
             "role": "matte-texture highlight breakup visible under grazing light"},
        ],
        "roughness": {
            "base": rough_base,
            "variation": rough_var,
            "map": "independent-procedural-field",
            "localResponse": "cavities and recessed channels trend rougher; crowns and handled "
                             "edges trend slightly smoother",
        },
        "metalness": {"base": 0.0, "variation": 0.0},
        "clearcoat": {"base": 0.0},
        "normal": {
            "pattern": "derived-from-independent-height-field",
            "strength": 0.18,
            "scale": 18.0,
            "space": "tangent",
        },
        "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0},
        "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0,
                         "silhouetteAffects": False},
        "ambientOcclusion": {
            "cavityStrength": ao_cavity,
            "contactShadowBias": 0.30,
            "notes": "Darken every part seam, recess and contact ring.",
        },
        "wear": {"edgeWear": 0.05, "scratches": [], "chips": []},
        "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"},
        "localOverrides": overrides,
        "envMapIntensity": 0.5,
        "shaderNotes": [
            "MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is "
            "matte unpolished plastic with no specular coat.",
            "Albedo, roughness, height, normal and AO are generated as five independent "
            "procedural fields; albedo is never aliased into another channel.",
            "Deterministic seed: the factory hashes the material id, so the noise fields are "
            "stable across reloads.",
        ],
        "referencePbr": pbr_provenance(prop_id, mid, confidence, PBR_NOTE),
        "notes": notes,
    }


def override(oid: str, target: str, notes: str, evidence: list[str], **fields) -> dict:
    item = {"id": oid, "target": target, "notes": notes, "evidenceRefs": evidence}
    item.update(fields)
    return item


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
def recipe(dominant: str, secondary: str, material_class: str = "plastic",
           confidence: float = 0.9) -> dict:
    return {
        "dominantAlbedo": dominant,
        "secondaryAlbedo": secondary,
        "materialClass": material_class,
        "materialClassConfidence": confidence,
    }


def rgba(hex_color: str, scale: float = 1.0) -> str:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return "rgba(%d, %d, %d, 1.0)" % (min(255, int(r * scale)), min(255, int(g * scale)),
                                      min(255, int(b * scale)))


def colours(hex_color: str, shade: float = 0.9) -> tuple[str, str]:
    return (rgba(hex_color), rgba(hex_color, shade))


def action(role: str, pivot_mode: str = "center", pivot_pos=(0, 0, 0), axis=(0, 1, 0),
           confidence: float = 0.85, channels: dict | None = None, sockets=None,
           collider: dict | None = None, fracture: str = "body", breakable: bool = False,
           detach=None, constraints=None, debris: str = "") -> dict:
    base_channels = {"translate": False, "rotate": False, "scale": False, "bend": False,
                     "twist": False, "detach": False, "visibility": True, "materialState": True}
    base_channels.update(channels or {})
    return {
        "animationRole": role,
        "pivot": {"mode": pivot_mode,
                  "localPosition": [round(float(v), 5) for v in pivot_pos],
                  "axis": [float(v) for v in axis],
                  "confidence": confidence},
        "transformChannels": base_channels,
        "sockets": sockets or [],
        "collider": collider or {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                                 "isTrigger": False,
                                 "notes": "Box proxy sized to the part bounds."},
        "constraints": constraints or [],
        "destruction": {"breakable": breakable, "fractureGroup": fracture, "seamRefs": [],
                        "detachableFragments": detach or [], "breakImpulse": 0.0,
                        "debrisMaterial": debris or "body"},
    }


def xform(position=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)) -> dict:
    """`scale=None` omits the key so the factory falls back to `dimensions` for the
    node scale. Box and sphere primitives are unit sized and need that; extrudes
    carry their real size in the profile and must stay at unit scale."""
    item: dict[str, Any] = {"position": [round(float(v), 5) for v in position],
                            "rotation": [round(float(v), 6) for v in rotation]}
    if scale is not None:
        item["scale"] = [round(float(v), 5) for v in scale]
    return item


def dims(w: float, h: float, d: float, confidence: float = 0.75) -> dict:
    return {"width": round(w, 4), "height": round(h, 4), "depth": round(d, 4),
            "units": "world", "confidence": confidence}


def surface(macro: float, micro: float, bump: float, normal_pattern: str, occlusion: str,
            edge_wear: str, notes: str) -> dict:
    return {"macroRoughness": macro, "microRoughness": micro, "bumpAmplitude": bump,
            "normalPattern": normal_pattern, "displacementPattern": "none",
            "occlusionPattern": occlusion, "edgeWearPattern": edge_wear, "notes": notes}


def feature(fid: str, description: str, geometry: str, evidence: list[str],
            confidence: float = 0.85) -> dict:
    return {"id": fid, "description": description, "geometry": geometry,
            "evidenceRefs": evidence, "confidence": confidence}


def component(cid: str, name: str, level: str, role: str, primitive: str, material_id: str,
              topology: str, rationale: str, colour_pair: tuple[str, str], descriptor: dict,
              transform: dict, dimensions: dict, action_profile: dict, local_features: list,
              surface_detail: dict, evidence: list[str], importance: float = 0.6,
              confidence: float = 0.85, parent: str | None = None, seams=None, details=None,
              joints=None, fidelity: str = "form-refinement",
              material_class: str = "plastic") -> dict:
    return {
        "id": cid,
        "name": name,
        "level": level,
        "role": role,
        "importance": importance,
        "confidence": confidence,
        "primitive": primitive,
        "topologyClass": topology,
        "topologyRationale": rationale,
        "colorMaterialRecipe": recipe(colour_pair[0], colour_pair[1], material_class),
        "geometryDescriptor": descriptor,
        "parent": parent,
        "attachment": None,
        "dimensions": dimensions,
        "transform": transform,
        "actionProfile": action_profile,
        "material": material_id,
        "materialLayers": [material_id],
        "deformations": [],
        "joints": joints or [],
        "seams": seams or [],
        "localFeatures": local_features,
        "surfaceDetail": surface_detail,
        "evidenceRefs": evidence,
        "details": details or [],
        "fidelityTier": fidelity,
    }


def descriptor(intent: str, edge_type: str, bevel_radius: float = 0.0, segments: int = 1,
               deformations: list[str] | None = None, uv: str = "generated primitive UVs",
               normals: str = "vertex normals from generated geometry",
               profile2d: dict | None = None) -> dict:
    item: dict[str, Any] = {
        "topologyIntent": intent,
        "edgeTreatment": {"type": edge_type, "bevelRadius": bevel_radius, "segments": segments},
        "deformationStack": deformations or [],
        "uvStrategy": uv,
        "normalStrategy": normals,
    }
    if profile2d:
        item["profile2D"] = profile2d
    return item


# ---------------------------------------------------------------------------
# detail inventory
# ---------------------------------------------------------------------------
def detail(did: str, zone: str, kind: str, description: str, ref: str, geometry: str,
           evidence: str, confidence: float, material_ids: set[str]) -> dict:
    """`mapsTo.ref` is the bare local-feature or local-override id, not `owner/id`:
    check_part_coverage folds the whole string to alphanumerics and only ever
    matches a bare id, so the composite form reads as a dangling detail there."""
    owner, _, leaf = ref.partition("/")
    return {
        "id": did,
        "zone": zone,
        "kind": kind,
        "description": description,
        "mapsTo": {"ref": leaf or owner, "owner": owner,
                   "kind": "material.localOverrides" if owner in material_ids
                           else "component.localFeatures"},
        "geometryRecipe": geometry,
        "evidenceRef": evidence,
        "confidence": confidence,
    }


def detail_inventory(details: list[dict], target_min: int, scan_method: str) -> dict:
    return {
        "scanMethod": scan_method,
        "targetMinDetails": target_min,
        "note": "Every detail below resolves to a component.localFeatures id or a "
                "material.localOverrides id; none is prose only.",
        "details": details,
    }


# ---------------------------------------------------------------------------
# build passes and quality contract
# ---------------------------------------------------------------------------
def build_passes(blockout_refs: list[str], all_refs: list[str], blockout_goal: str,
                 structural_goal: str, form_goal: str, material_goal: str,
                 form_acceptance: list[str], has_repetition: bool) -> list[dict]:
    def acc(*items: str) -> list[str]:
        return list(items) + ["AI vision comparison score meets "
                              "selfCorrectLoop.visualAcceptance.threshold."]

    passes = [
        {"id": "blockout", "goal": blockout_goal, "componentRefs": blockout_refs,
         "acceptance": acc("Silhouette reads correctly without materials.",
                           "Quality contract has named all required macro feature groups before "
                           "code generation.",
                           "Macro proportions match the measured reference bounding box.")},
        {"id": "structural-pass", "goal": structural_goal, "componentRefs": all_refs,
         "acceptance": acc("Macro, meso and repeated structures meet "
                           "qualityContract.minimumSpecDepth.",
                           "Parent-child relations, seams and contact points are explicit.",
                           "Every part that touches another overlaps it by at least 0.02 world "
                           "units.")},
        {"id": "form-refinement", "goal": form_goal, "componentRefs": all_refs,
         "acceptance": acc(*form_acceptance)},
        {"id": "material-pass", "goal": material_goal, "componentRefs": all_refs,
         "acceptance": acc("Reference-derived albedo palette records dominant, secondary and "
                           "accent colours per material.",
                           "Each material defines roughness variation and an independent normal "
                           "response.",
                           "Local material overrides are tied to evidenceRefs.",
                           "Albedo, roughness, height, normal and AO are generated independently.",
                           "Macro, meso and micro surface frequency bands are present without "
                           "visible tiling.")},
        {"id": "surface-pass",
         "goal": "Add seam occlusion, contact darkening and crown polish.",
         "componentRefs": all_refs,
         "acceptance": acc("Every material feature group has local overrides or surfaceDetail "
                           "tied to evidenceRefs.",
                           "A grazing-angle render shows form breaks without plastic-looking "
                           "uniform highlights.")},
        {"id": "lighting-pass",
         "goal": "Reproduce the reference key/fill/rim structure and prove the form survives "
                 "relighting.",
         "componentRefs": all_refs,
         "acceptance": acc("lightingFromPhoto names key direction, fill, rim or environment, "
                           "exposure, tone mapping and contact shadow behaviour.",
                           "Neutral, grazing and reference-matched renders distinguish material "
                           "errors from lighting errors.")},
        {"id": "interaction-pass",
         "goal": "Expose the runtime rig: named pivots, sockets and collider proxies.",
         "componentRefs": all_refs,
         "acceptance": acc("root.userData.sculptRuntime exposes nodes, meshes, sockets, colliders "
                           "and destruction groups.",
                           "Every moving node carries its children instead of detaching them.")},
        {"id": "optimization-pass",
         "goal": "Protect real-time budget after fidelity is accepted.",
         "componentRefs": all_refs,
         "acceptance": ["Triangle count, draw calls and instancing are measured against "
                        "performanceBudget.",
                        "Repeated detail stays instanced." if has_repetition
                        else "Segment counts are reduced wherever the silhouette does not change."]},
    ]
    return passes


def quality_contract(quality_bar: str, done: list[str], min_depth: dict,
                     feature_groups: list[dict], delta_checks: list[str]) -> dict:
    rules = [
        "Do not proceed to code if qualityContract.qualityBar is unassessed.",
        "Do not proceed to code if the spec only contains a root component for a moderate object.",
        "Do not proceed to code if required featureGroups are not represented by componentTree, "
        "materials or repetitionSystems.",
        "Do not proceed to code if visible local features are described only in prose and not "
        "attached to components, materials and evidenceRefs.",
        "Do not proceed past structural-pass if a contacting part lacks a seam overlap record.",
        "Do not pass material look-dev when albedo is reused as roughness, height, normal or AO.",
        "Do not pass material look-dev without macro, meso and micro surface frequency bands.",
        "Do not pass reference-fidelity material look-dev from a source image without usable "
        "referencePbr maps or an explicit documented limitation.",
        "Do not claim a procedural finish reproduces a patterned reference finish.",
        "Do not place adjacent separate-geometry parts below 0.02 world-unit seam overlap "
        "(source: grimoire/build/geometry_patterns.md).",
        "Do not satisfy raised or recessed relief with a map alone when the feature affects form; "
        "use geometry or displacement (source: grimoire/build/geometry_patterns.md).",
    ]
    contract = {
        "qualityBar": quality_bar,
        "definitionOfDone": done,
        "minimumSpecDepth": min_depth,
        "featureGroups": feature_groups,
        "visualDeltaChecks": delta_checks,
        "antiShallowSpecRules": rules,
    }
    contract["mustNotDo"] = list(rules)
    return contract


def feature_group(gid: str, name: str, criteria: list[str], evidence: list[str],
                  failures: list[str], required: bool = True) -> dict:
    return {"id": gid, "name": name, "required": required, "qualityCriteria": criteria,
            "evidenceRefs": evidence, "failureModes": failures}


TERMINOLOGY_PROFILE = {
    "domain": "real-time procedural Three.js game prop",
    "geometryTerms": ["silhouette", "topology", "primitive", "chamfer", "facet", "taper",
                      "extrude profile", "profile stop", "edge crease", "surface normal",
                      "lathe profile", "instanced cluster"],
    "materialTerms": ["albedo", "baseColor", "roughness", "metalness", "normal map",
                      "ambient occlusion", "cavity darkening", "edge wear", "clearcoat"],
    "lightingTerms": ["key light", "fill light", "rim light", "environment reflection",
                      "contact shadow", "tone mapping", "exposure"],
    "descriptionRule": "Use measurable 3D graphics terms. Every shape claim carries a number or a "
                       "named geometry operation.",
}


def self_correct_loop(passes: list[dict]) -> dict:
    return {
        "enabled": True,
        "visualAcceptance": {
            "reviewer": "ai-vision",
            "threshold": 0.7,
            "comparisonArtifactRequired": True,
            "layerScoresRequired": True,
            "codePixelDiffIsAcceptanceAuthority": False,
            "scoringRule": "AI vision must inspect a side-by-side reference/render sheet and score "
                           "the current pass from 0 to 1. Pixel-diff code may assist diagnostics "
                           "but cannot approve a pass.",
            "requiredLayerScores": ["silhouetteProportion", "componentStructure", "formDetail",
                                    "materialSurface", "lightingCamera"],
            "featureReviewPolicy": {
                "enabled": True,
                "reviewUnit": "semantic-subsystem",
                "maxCriticalFeaturesPerPass": 5,
                "maxImportantFeaturesPerPass": 3,
                "criticalDefaultThreshold": 0.8,
                "importantAverageThreshold": 0.65,
                "adaptiveEscalation": True,
                "singleImagePairOnly": True,
                "selectionRule": "Score only identity-defining semantic systems, never generic "
                                 "quality adjectives.",
            },
        },
        "reviewAfterPasses": [p["id"] for p in passes],
        "allowedActions": ["continue", "refine-spec", "refine-code", "request-input", "stop"],
        "specRefineTriggers": ["missing component", "wrong primitive family", "wrong proportions",
                               "material layer under-specified",
                               "local feature not traceable to viewEvidence",
                               "reference ambiguity discovered during implementation"],
        "codeRefineTriggers": ["spec is adequate but generated geometry or material does not match",
                               "browser render differs from reference",
                               "performance budget exceeded",
                               "lighting hides geometry or material response"],
        "stopCriteria": ["target fidelity reached or the user accepts the current approximation",
                         "remaining gaps require reference views the single image does not cover"],
        "screenshotPolicy": {
            "requiredForPasses": [p["id"] for p in passes if p["id"] != "optimization-pass"],
            "preferredCapture": "playwright screenshot of the shared props preview harness",
            "fallbackCapture": "user-supplied-screenshot-path",
            "minimumEvidence": "Each visual pass needs a reference image, a rendered screenshot "
                               "framed to the reference bounding box, a side-by-side comparison "
                               "sheet, an AI vision score, layer scores and a critique before "
                               "choosing continue.",
            "reviewPairRule": "The review render always uses the solved reference camera; orbit "
                              "views are judged for self-consistency only, never against the "
                              "reference angle.",
            "acceptanceAuthority": "AI vision review of the comparison sheet. Code-generated pixel "
                                   "similarity is not sufficient evidence.",
        },
    }


LOOK_DEV_TARGETS = {
    "qualityPriority": "reference-fidelity",
    "materialPass": {
        "albedoPaletteRequired": True,
        "roughnessVariationRequired": True,
        "normalOrBumpRequired": True,
        "localOverridesRequired": True,
        "minimumTextureResolution": 256,
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
            "acceptedLimitation": PBR_NOTE,
        },
        "mustAvoid": ["single flat albedo per material", "uniform roughness",
                      "albedo texture reused as roughness, height, normal or AO",
                      "single-frequency random noise",
                      "glossy toy-plastic highlights on a matte moulded surface",
                      "local colour described only in prose without material masks",
                      "claiming exact PBR recovery from one image"],
    },
    "lightingPass": {
        "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure",
                          "tone mapping", "background", "contact shadow"],
        "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow",
                      "reference lighting copied without separating material readability"],
    },
    "screenshotReview": [
        "Compare the albedo palette and the local colour zones.",
        "Compare roughness and normal response under the key light.",
        "Compare contact darkening, seam occlusion and crown polish.",
        "Compare key, fill and rim structure, exposure, tone mapping and background.",
        "Capture a neutral-light render to verify material readability without reference lighting.",
        "Capture a grazing-light close-up to expose flat normals and uniform roughness.",
        "Capture a reference-matched render from the solved camera.",
    ],
}


# ---------------------------------------------------------------------------
# spec assembly
# ---------------------------------------------------------------------------
CARRIED_FIELDS = ("reviewHistory", "visualEvidence", "tier1Results", "sculptPipeline")


def assemble(*, target_name: str, target_id: str, source_image: str, reference_camera: dict,
             measurement_basis: dict, suitability: str, scores: dict, pre_spec: dict,
             contract: dict, quality_targets: dict, feature_review_targets: list[dict],
             view_evidence: list[dict], components: list[dict], materials: list[dict],
             repetition_systems: list[dict], passes: list[dict], lighting: list[str],
             action_readiness: dict, assumptions: list[str], coordinate_frame: dict,
             silhouette: dict, lod_plan: list[dict], performance_budget: dict,
             procedural_strategy: list[str], animation_anchors: list[str],
             destruction_anchors: list[str], risks: list[str]) -> dict:
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
            "blockedReason": "blockout requires a browser screenshot and self-correction review "
                             "before structural-pass unlocks",
            "nextRequiredEvidence": [
                "blockout browser render screenshot from the preview harness",
                "map-stripped clay render for the Tier 1 blockout gate",
                "side-by-side reference/render comparison sheet",
                "AI vision score >= 0.7 with layer scores and mismatch critique",
                "critical semantic feature scores from the same image pair meeting their thresholds",
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
        "performanceBudget": performance_budget,
        "lightingFromPhoto": lighting,
        "proceduralStrategy": procedural_strategy,
        "animationAnchors": animation_anchors,
        "destructionAnchors": destruction_anchors,
        "risks": risks,
        "localSpecSearch": {"collection": "core_3d", "query": target_name,
                            "index": {"status": "reused", "reason": "present"}, "matches": []},
    }


def write_spec(out: Path, spec: dict) -> None:
    """The review ledger is history, not authored content: re-running an author
    script must not erase which passes were reviewed or their evidence."""
    if out.exists():
        previous = json.loads(out.read_text(encoding="utf-8"))
        carried = [f for f in CARRIED_FIELDS if f in previous]
        for field in carried:
            spec[field] = previous[field]
        if carried:
            print(f"carried forward: {', '.join(carried)}")
    out.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    print(f"components={len(spec['componentTree'])} materials={len(spec['materials'])} "
          f"repetitionSystems={len(spec['repetitionSystems'])} "
          f"details={len(spec['preSpecAssessment']['detailInventory']['details'])}")


def action_readiness(root: str, runtime_contract: dict, fracture_naming: str,
                     debris_strategy: str) -> dict:
    return {
        "contract": "Every macro and meso component is a named Object3D pivot node with a mesh "
                    "child, action metadata, sockets where relevant, a collider proxy and "
                    "destruction metadata. The runtime reads root.userData.sculptRuntime.",
        "defaultRigType": "action-ready-prop-rig",
        "rootMotionNode": root,
        "requiredComponentFields": ["id", "parent", "transform", "seams for every contacting part",
                                    "actionProfile.animationRole", "actionProfile.pivot",
                                    "actionProfile.collider", "actionProfile.destruction"],
        "transformChannels": ["translate", "rotate", "scale", "detach", "visibility",
                              "material-state"],
        "authoringRules": [
            "Do not collapse independently movable parts into one mesh.",
            "Put transforms on component pivot groups, not on raw meshes.",
            "Animated parts keep their pivot node at the axis of motion so children ride along.",
            "Represent hinge, socket, detachable and breakable intent even when no animation is "
            "implemented yet.",
            "Use simplified collider proxies for runtime physics instead of visual mesh colliders.",
        ],
        "runtimeContract": runtime_contract,
        "destructionPolicy": {"defaultBreakable": False,
                              "fractureGroupNaming": fracture_naming,
                              "debrisStrategy": debris_strategy},
    }
