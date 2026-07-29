#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment toaster.

The spec is large and highly repetitive (every component carries a topology
classification, a colour recipe, an action profile and evidence links), so it is
generated here rather than hand-edited as JSON. Every dimension below is derived
from measurements of assets/reference/toaster-reference.png; the derivation is
recorded in `measurementBasis` inside the spec so a later session can re-check it.

Run:  python author_toaster_spec.py
Writes: toaster-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "toaster-reference.png")
OUT = HERE / "toaster-sculpt-spec.json"
PBR_DIR = HERE / "evidence" / "pbr"

# ---------------------------------------------------------------------------
# Measured geometry. World unit ~= 12 cm; the toaster is 1.60 units wide.
# Camera solve from the reference top-face back edges: azimuth 41 deg,
# elevation 13.2 deg (orthographic approximation of a long-lens perspective).
# ---------------------------------------------------------------------------
W, D, C = 1.60, 1.32, 0.24          # shell plan: width X, depth Z, corner chamfer

# Vertical calibration. The first height estimate came from a screen-space solve that had
# to assume an elevation angle, and it made the model 14 percent too tall: at the fitted
# framing the render's bounding box aspect was 0.974 against the reference's 1.026. A
# sweep over (camera elevation, vertical scale) scored by Tier-1 silhouette IoU put the
# best agreement at elevation 17-21 degrees with every vertical dimension at 0.86, which
# is what VS applies. Horizontal dimensions are unchanged - they were measured from facet
# widths, which do not depend on the elevation.
VS = 0.86

SHELL_Y0, SHELL_H = 0.26 * VS, 1.22 * VS
SHELL_TOP = SHELL_Y0 + SHELL_H
# ExtrudeGeometry only creates vertex rings at k/steps along the extrusion, so every
# profile stop must land exactly on a ring or the profile is smeared across the gap and
# the chamfer band melts into a continuous cone. Keeping the chamfer at one eighth of the
# height puts its stop on ring 7 of 8.
SHELL_STEPS = 8
SHELL_CHAMFER_RINGS = 2
TOP_CHAMFER_H = SHELL_H * SHELL_CHAMFER_RINGS / SHELL_STEPS
TOP_CHAMFER_INSET = 0.15
WALL_TAPER_INSET = 0.03

PW, PD, PC = 1.70, 1.42, 0.28       # plinth plan (0.05 overhang per side)
PLINTH_Y0, PLINTH_H = 0.06 * VS, 0.22 * VS
PLINTH_CHAMFER = 0.05

FOOT_W, FOOT_H = 0.14, 0.045
FOOT_X, FOOT_Z = 0.58, 0.46

BORE_W, BORE_D, BORE_C = 0.97, 0.63, 0.11       # slot opening cut through the deck
BEZEL_W, BEZEL_D, BEZEL_C = 1.21, 0.87, 0.15
BEZEL_Y0, BEZEL_H = SHELL_TOP - 0.02 * VS, 0.055        # 0.017 seam overlap into the deck
DIVIDER_TOP = SHELL_TOP - 0.03

CAVITY_DEPTH = 0.48 * VS
CAVITY_TOP = SHELL_TOP - 0.002
CAVITY_FLOOR_TOP = CAVITY_TOP - CAVITY_DEPTH
DIVIDER_T = 0.09

LEVER_Z = 0.06
LEVER_CENTER_Y, LEVER_TRAVEL = 0.775, 0.20
TRACK_CENTER_Y, TRACK_H, TRACK_D = LEVER_CENTER_Y, 0.53, 0.26
SLOT_W = 0.10
KNOB_D, KNOB_H, KNOB_OUT, KNOB_C = 0.39, 0.165, 0.225, 0.035

DIAL_Y, DIAL_Z = 0.34, 0.07
DIAL_R, DIAL_OUT = 0.15, 0.088
PLATE_D, PLATE_H, PLATE_C, PLATE_PROUD = 0.62, 0.516, 0.11, 0.010
TICK_COUNT, TICK_RADIUS = 9, 0.195

SHELL_FACE_X = W / 2.0                      # 0.80

EVIDENCE = "full-object"


# ---------------------------------------------------------------------------
# profile helpers
# ---------------------------------------------------------------------------
def chamfered_rect(w: float, d: float, c: float, cx: float = 0.0, cy: float = 0.0):
    """Counter-clockwise octagonal outline: a rectangle with all four corners cut
    at 45 degrees. This outline is the toaster's identity - a rounded box is wrong."""
    hw, hd = w / 2.0, d / 2.0
    pts = [
        (hw, -(hd - c)), (hw, hd - c), (hw - c, hd), (-(hw - c), hd),
        (-hw, hd - c), (-hw, -(hd - c)), (-(hw - c), -hd), (hw - c, -hd),
    ]
    return [[round(x + cx, 5), round(y + cy, 5)] for x, y in pts]


def regular_polygon(radius: float, sides: int, cx: float = 0.0, cy: float = 0.0):
    import math
    pts = []
    for i in range(sides):
        a = (i / sides) * 2 * math.pi + math.pi / sides
        pts.append([round(cx + radius * math.cos(a), 5), round(cy + radius * math.sin(a), 5)])
    return pts


def inset_scale(half_extent: float, inset: float) -> float:
    return round((half_extent - inset) / half_extent, 4)


def profile(points, depth, axis="z", axis_offset=0.0, steps=1, stops=None, exempt=None, holes=None):
    """geometryDescriptor.profile2D payload. `axis`/`axisOffset`/`steps`/
    `profileStops`/`profileExempt` are consumed by buildExtrudeGeometry in the
    generated factory (see the refine-code note in the spec risks)."""
    item = {"points": points, "depth": round(depth, 5), "axis": axis, "axisOffset": round(axis_offset, 5)}
    if steps != 1:
        item["steps"] = steps
    if stops:
        item["profileStops"] = stops
    if exempt:
        item["profileExempt"] = exempt
    if holes:
        item["holes"] = holes
    return item


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def pbr_provenance(material_id: str, confidence: float, note: str) -> dict:
    channels = ("albedo", "roughness", "height", "normal", "ao")
    return {
        "version": "1.0",
        "sourceImage": str(HERE / "evidence" / "crops" / f"{material_id}-crop.png"),
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": "pass",
        "confidence": confidence,
        "estimatedFidelity": confidence,
        "targetThreshold": 0.7,
        "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.",
        "limitationNote": note,
        "maps": {
            ch: {
                "path": str(PBR_DIR / f"{material_id}_{ch}.png"),
                "channel": ch,
                "source": "reference-pixel-extraction",
            }
            for ch in channels
        },
    }


PBR_NOTE = (
    "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime "
    "material. The reference is a flat-paint stylised render with no surface pattern, so the "
    "extracted crops carry only baked lighting and crop-boundary contamination; tiling them "
    "would paint the reference's shading onto every facet. The runtime instead builds five "
    "independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays "
    "self-contained with no network-fetched textures. The extracted palettes and roughness "
    "estimates were used as evidence for the albedo and roughness scalars below."
)


def material(mid, name, base, palette, rough_base, rough_var, ao_cavity, confidence, overrides, notes):
    return {
        "id": mid,
        "name": name,
        "type": "physical",
        "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)",
        "baseColor": base,
        "color": base,
        "albedo": {
            "dominant": base,
            "secondary": palette[1:],
            "samplingNotes": (
                "Median-sampled from named regions of the reference, cross-checked against the "
                "extract_pbr_evidence palette for the same crop."
            ),
            "map": None,
        },
        "colorVariation": {
            "palette": palette,
            "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance",
            "amplitude": 0.018,
            "heightCorrelation": 0.18,
        },
        "textureResolution": 1024,
        "textureProjection": {
            "mode": "uv",
            "repeat": [1.0, 1.0],
            "anisotropy": 8,
            "texelDensityIntent": (
                "One tile per part so the moulding drift never repeats visibly on a small control; "
                "detail stays at object scale rather than stretching with component scale."
            ),
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
            "localResponse": "cavities and recessed channels trend rougher; chamfer crowns trend slightly smoother",
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
        "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": False},
        "ambientOcclusion": {
            "cavityStrength": ao_cavity,
            "contactShadowBias": 0.30,
            "notes": "Darken the slot pocket, the lever channel, the plinth seam, and the dial undercut.",
        },
        "wear": {"edgeWear": 0.05, "scratches": [], "chips": []},
        "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"},
        "localOverrides": overrides,
        "envMapIntensity": 0.5,
        "shaderNotes": [
            "MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte "
            "unpolished plastic with no specular coat.",
            "Albedo, roughness, height, normal and AO are generated as five independent procedural "
            "fields; albedo is never aliased into another channel.",
            "Deterministic seed: the factory hashes the material id, so the noise fields are stable "
            "across reloads.",
        ],
        "referencePbr": pbr_provenance(mid, confidence, PBR_NOTE),
        "notes": notes,
    }


MATERIALS = [
    material(
        "shell-cream", "Cream shell plastic", "#EDE0C8",
        ["#EDE0C8", "#E7D9C0", "#F2E6D2"], 0.72, 0.10, 0.22, 0.842,
        [
            {"id": "chamfer-crown-sheen", "target": "body-shell/plan-chamfer-facets",
             "roughness": 0.66, "mask": "chamfer facets only",
             "notes": "Mould tooling polishes the narrow 45 degree facets slightly smoother than the broad faces.",
             "evidenceRefs": [EVIDENCE, "front-facet-zone"]},
            {"id": "plinth-seam-shadow", "target": "body-shell/plinth-seam",
             "roughness": 0.78, "aoBoost": 0.35, "mask": "lowest 0.05 units of the wall",
             "notes": "Contact darkening where the shell meets the coral plinth.",
             "evidenceRefs": [EVIDENCE, "base-plinth-zone"]},
            {"id": "control-plate-edge", "target": "control-plate/raised-pad-edge",
             "roughness": 0.70, "aoBoost": 0.22, "mask": "raised dial pad outline",
             "notes": "Shallow step around the dial pad reads as a soft outline, not a painted line.",
             "evidenceRefs": [EVIDENCE, "right-control-zone"]},
        ],
        "Cream body, top deck, lever collar and dial pad. Matte, no coat.",
    ),
    material(
        "accent-coral", "Coral accent plastic", "#DE554D",
        ["#DE554D", "#D44E46", "#E75F57"], 0.70, 0.10, 0.24, 0.848,
        [
            {"id": "bezel-crown-highlight", "target": "top-bezel/proud-lip-step",
             "roughness": 0.63, "mask": "bezel crown chamfer",
             "notes": "The proud bezel crown catches the key light more than the surrounding deck.",
             "evidenceRefs": [EVIDENCE, "top-slot-zone"]},
            {"id": "plinth-underside-dirt", "target": "base-plinth/overhang-ledge",
             "roughness": 0.80, "dirt": 0.10, "mask": "underside of the plinth overhang",
             "notes": "Cavity dirt collects under the overhang where it is never wiped.",
             "evidenceRefs": [EVIDENCE, "base-plinth-zone"]},
            {"id": "tick-mark-edges", "target": "control-plate/tick-arc",
             "roughness": 0.68, "aoBoost": 0.30, "mask": "tick mark footprints",
             "notes": "Each tick is a raised nub, so its base carries a contact-occlusion ring.",
             "evidenceRefs": [EVIDENCE, "right-control-zone"]},
        ],
        "Bezel ring, base plinth, dial knob and dial tick marks.",
    ),
    material(
        "lever-yellow", "Yellow lever plastic", "#F7C244",
        ["#F7C244", "#EFB93B", "#FBCB53"], 0.68, 0.09, 0.22, 0.723,
        [
            {"id": "knob-chamfer-wear", "target": "lever-knob/knob-chamfers",
             "roughness": 0.60, "edgeWear": 0.12, "mask": "knob chamfer facets",
             "notes": "The knob is the only part a hand touches, so its chamfers polish first.",
             "evidenceRefs": [EVIDENCE, "right-control-zone"]},
        ],
        "Carriage lever knob and its neck. Slightly smoother than the shell from handling.",
    ),
    material(
        "cavity-gray", "Slot cavity interior", "#615F5C",
        ["#615F5C", "#55534F", "#6D6B67"], 0.84, 0.08, 0.34, 0.826,
        [
            {"id": "pocket-depth-gradient", "target": "slot-cavity/pocket-walls",
             "roughness": 0.90, "aoBoost": 0.65, "mask": "lower two thirds of the pocket wall",
             "notes": "Light falls off sharply down the slot, so the pocket darkens with depth.",
             "evidenceRefs": [EVIDENCE, "top-slot-zone"]},
            {"id": "element-tab-scorch", "target": "slot-cavity/element-tab-rows",
             "roughness": 0.92, "dirt": 0.18, "mask": "element tab faces",
             "notes": "Tabs sit next to the elements and read darker and rougher than the walls.",
             "evidenceRefs": [EVIDENCE, "top-slot-zone"]},
            {"id": "lever-slot-shadow", "target": "lever-track/recessed-channel",
             "roughness": 0.88, "aoBoost": 0.55, "mask": "channel floor",
             "notes": "The channel floor is the darkest value on the right face.",
             "evidenceRefs": [EVIDENCE, "right-control-zone"]},
        ],
        "Slot pocket walls, floor, divider, element tabs and the lever channel floor. This albedo is "
        "darker than a de-lit sample of the reference pocket suggests, deliberately: procedural AO "
        "cannot reproduce a real pocket's occlusion, so the albedo carries part of that darkening. "
        "The rendered pocket then lands on the reference's measured (98, 94, 82).",
    ),
]


# ---------------------------------------------------------------------------
# components
# ---------------------------------------------------------------------------
def recipe(dominant, secondary, confidence=0.9):
    return {
        "dominantAlbedo": dominant,
        "secondaryAlbedo": secondary,
        "materialClass": "plastic",
        "materialClassConfidence": confidence,
    }


CREAM = ("rgba(237, 224, 200, 1.0)", "rgba(226, 210, 184, 1.0)")
CORAL = ("rgba(222, 85, 77, 1.0)", "rgba(212, 78, 70, 1.0)")
YELLOW = ("rgba(247, 194, 68, 1.0)", "rgba(224, 167, 44, 1.0)")
GRAY = ("rgba(110, 108, 104, 1.0)", "rgba(96, 94, 90, 1.0)")


def action(role, pivot_mode="center", pivot_pos=(0, 0, 0), axis=(0, 1, 0), confidence=0.85,
           channels=None, sockets=None, collider=None, fracture="body", breakable=False,
           detach=None, constraints=None):
    base_channels = {
        "translate": False, "rotate": False, "scale": False, "bend": False,
        "twist": False, "detach": False, "visibility": True, "materialState": True,
    }
    base_channels.update(channels or {})
    return {
        "animationRole": role,
        "pivot": {
            "mode": pivot_mode,
            "localPosition": [round(float(v), 5) for v in pivot_pos],
            "axis": [float(v) for v in axis],
            "confidence": confidence,
        },
        "transformChannels": base_channels,
        "sockets": sockets or [],
        "collider": collider or {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                                 "isTrigger": False, "notes": "Box proxy sized to the part bounds."},
        "constraints": constraints or [],
        "destruction": {
            "breakable": breakable,
            "fractureGroup": fracture,
            "seamRefs": [],
            "detachableFragments": detach or [],
            "breakImpulse": 0.0,
            "debrisMaterial": "shell-cream",
        },
    }


def component(cid, name, level, role, primitive, material_id, topology, rationale, colours,
              descriptor, transform, dimensions, action_profile, local_features, surface,
              evidence, importance=0.6, confidence=0.85, parent="body-shell", seams=None,
              details=None, joints=None, fidelity="form-refinement"):
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
        "colorMaterialRecipe": recipe(*colours),
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
        "surfaceDetail": surface,
        "evidenceRefs": evidence,
        "details": details or [],
        "fidelityTier": fidelity,
    }


def xform(position=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    """`scale=None` omits the key so the factory falls back to `dimensions` for the node
    scale. Box primitives are unit cubes and need that; extrudes carry their real size in
    the profile and must stay at unit scale."""
    item = {
        "position": [round(float(v), 5) for v in position],
        "rotation": [round(float(v), 6) for v in rotation],
    }
    if scale is not None:
        item["scale"] = [round(float(v), 5) for v in scale]
    return item


def dims(w, h, d, confidence=0.75):
    return {"width": round(w, 4), "height": round(h, 4), "depth": round(d, 4),
            "units": "world", "confidence": confidence}


def surface(macro, micro, bump, normal_pattern, occlusion, edge_wear, notes):
    return {
        "macroRoughness": macro,
        "microRoughness": micro,
        "bumpAmplitude": bump,
        "normalPattern": normal_pattern,
        "displacementPattern": "none",
        "occlusionPattern": occlusion,
        "edgeWearPattern": edge_wear,
        "notes": notes,
    }


def feature(fid, description, geometry, evidence, confidence=0.85):
    return {"id": fid, "description": description, "geometry": geometry,
            "evidenceRefs": evidence, "confidence": confidence}


# --- shell -----------------------------------------------------------------
SHELL_CHAMFER_T = (SHELL_STEPS - SHELL_CHAMFER_RINGS) / SHELL_STEPS
shell_stops = [
    [0.0, 1.0, 1.0],
    [SHELL_CHAMFER_T,
     inset_scale(W / 2, WALL_TAPER_INSET), inset_scale(D / 2, WALL_TAPER_INSET)],
    [1.0,
     inset_scale(W / 2, WALL_TAPER_INSET + TOP_CHAMFER_INSET),
     inset_scale(D / 2, WALL_TAPER_INSET + TOP_CHAMFER_INSET)],
]

body_shell = component(
    "body-shell", "Body shell", "macro", "shell", "extrude", "shell-cream",
    "assembled-solid",
    "Eight flat faces you can point to and count: four broad walls and four 45 degree corner "
    "facets, meeting at hard creases with no smooth blending anywhere on the reference.",
    CREAM,
    {
        "topologyIntent": "chamfer-box shell: octagonal plan swept vertically, tapering inward, "
                          "with a broad chamfer band under the top deck",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": ["vertical taper 0.03 per side", "top chamfer inset 0.11 over 0.14 height"],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs; one tile per part",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
        "profile2D": profile(
            chamfered_rect(W, D, C), SHELL_H, axis="y", axis_offset=SHELL_Y0, steps=SHELL_STEPS,
            stops=shell_stops, exempt=[BORE_W / 2 + 0.06, BORE_D / 2 + 0.06],
            holes=[chamfered_rect(BORE_W, BORE_D, BORE_C)],
        ),
    },
    xform(),
    dims(W, SHELL_H, D, 0.7),
    action(
        "root", "center", (0.0, (SHELL_Y0 + SHELL_TOP) / 2, 0.0), (0, 1, 0), 0.9,
        channels={"translate": True, "rotate": True, "scale": True},
        sockets=[
            {"id": "mount-base", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0],
             "notes": "World origin of the appliance; sits on the floor plane."},
            {"id": "counter-contact", "localPosition": [0.0, 0.06, 0.0], "localRotation": [0.0, 0.0, 0.0],
             "notes": "Top of the rubber feet - the real contact plane."},
        ],
        collider={"type": "box", "offset": [0.0, round((PLINTH_Y0 + BEZEL_Y0 + BEZEL_H) / 2, 4), 0.0], "scale": [PW, round(BEZEL_Y0 + BEZEL_H, 4), PD],
                  "isTrigger": False, "notes": "Single box proxy over the whole appliance."},
        fracture="body-shell",
    ),
    [
        feature("plan-chamfer-facets",
                "Four 45 degree corner facets cut the rectangular plan into an octagon; each facet "
                "is 0.24 units of cut on both plan axes and runs the full height.",
                "extrude profile2D outline with eight vertices, not a rounded box",
                [EVIDENCE, "front-facet-zone"], 0.92),
        feature("upward-taper",
                "The plan contracts by 0.03 units per side between the plinth seam and the top of "
                "the vertical wall, so the silhouette leans inward as it rises.",
                "profileStops scale the shape-plane coordinates along the extrusion axis",
                [EVIDENCE, "front-facet-zone"], 0.72),
        feature("top-chamfer-band",
                "A broad chamfer band 0.14 units tall insets the plan a further 0.11 units before "
                "the flat top deck begins.",
                "final profileStop drives the extruded prism into a frustum band",
                [EVIDENCE, "top-slot-zone"], 0.82),
        feature("slot-bore",
                "A chamfered rectangular bore is cut through the top deck; its walls are exempt "
                "from the taper so the opening keeps a constant section.",
                "profile2D hole plus profileExempt box",
                [EVIDENCE, "top-slot-zone"], 0.88),
        feature("plinth-seam",
                "The wall sinks 0.02 units into the plinth so no gap can open at the seam.",
                "geometry overlap, not a butt joint",
                [EVIDENCE, "base-plinth-zone"], 0.8),
    ],
    surface(0.72, 0.10, 0.0, "shallow moulding flow aligned with the extrusion axis",
            "crease darkening along every chamfer edge and at the plinth seam",
            "light polish on the chamfer crowns",
            "Matte ABS. No specular coat anywhere on the reference."),
    [EVIDENCE, "front-facet-zone", "top-slot-zone"],
    importance=1.0, confidence=0.9, parent=None,
    seams=[{"id": "shell-plinth-seam", "with": "base-plinth", "overlap": 0.02,
            "notes": "Shell base is buried 0.02 units inside the plinth top."}],
    fidelity="blockout",
)

base_plinth = component(
    "base-plinth", "Base plinth", "macro", "plinth", "extrude", "accent-coral",
    "assembled-solid",
    "A separate rigid slab with its own flat top, flat sides and 45 degree corner facets, wider "
    "than the shell on every side and reading as a distinct moulded part in the reference.",
    CORAL,
    {
        "topologyIntent": "chamfered slab with a bevel top and bottom",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": ["bottom bevel inset 0.05", "top bevel inset 0.05"],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
        "profile2D": profile(
            chamfered_rect(PW, PD, PC), PLINTH_H, axis="y", axis_offset=PLINTH_Y0, steps=4,
            stops=[
                [0.0, inset_scale(PW / 2, PLINTH_CHAMFER), inset_scale(PD / 2, PLINTH_CHAMFER)],
                [0.25, 1.0, 1.0],
                [0.75, 1.0, 1.0],
                [1.0, inset_scale(PW / 2, PLINTH_CHAMFER), inset_scale(PD / 2, PLINTH_CHAMFER)],
            ],
        ),
    },
    xform(),
    dims(PW, PLINTH_H, PD, 0.7),
    action(
        "static", "center", (0.0, PLINTH_Y0 + PLINTH_H / 2, 0.0), (0, 1, 0), 0.85,
        collider={"type": "box", "offset": [0.0, 0.17, 0.0], "scale": [1.7, 0.22, 1.45],
                  "isTrigger": False, "notes": "Plinth footprint proxy."},
        fracture="base-plinth",
    ),
    [
        feature("overhang-ledge",
                "The plinth is 0.05 units wider than the shell on every side, so its top face shows "
                "as a continuous ledge around the body.",
                "larger plan outline than the shell, same chamfer language",
                [EVIDENCE, "base-plinth-zone"], 0.85),
        feature("double-bevel-profile",
                "Both the top and the bottom edge of the slab are bevelled inward by 0.05 units, "
                "giving the slab a three-band elevation.",
                "profileStops at t=0, 0.23, 0.77 and 1.0",
                [EVIDENCE, "base-plinth-zone"], 0.78),
    ],
    surface(0.70, 0.10, 0.0, "flat moulded coral with slight tone drift",
            "darkening under the overhang and in the shell seam",
            "none - the plinth shows no wear in the reference",
            "Same matte plastic family as the shell, saturated coral pigment."),
    [EVIDENCE, "base-plinth-zone"],
    importance=0.9, confidence=0.85, parent=None,
    seams=[{"id": "plinth-shell-seam", "with": "body-shell", "overlap": 0.02,
            "notes": "Receives the shell base."}],
    fidelity="blockout",
)

# --- feet ------------------------------------------------------------------
FEET = []
for sx, sz, tag, label in ((1, 1, "front-right", "Front right"), (-1, 1, "front-left", "Front left"),
                           (1, -1, "back-right", "Back right"), (-1, -1, "back-left", "Back left")):
    FEET.append(component(
        f"foot-{tag}", f"{label} corner foot", "micro", "foot", "box", "accent-coral",
        "assembled-solid",
        "A small flat-faced pad under a plinth corner facet; four of them are visible as short "
        "steps in the reference silhouette below the coral slab.",
        CORAL,
        {
            "topologyIntent": "short rectangular pad",
            "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
            "deformationStack": [],
            "uvStrategy": "box UVs",
            "normalStrategy": "vertex normals from generated geometry",
        },
        xform((sx * FOOT_X, FOOT_H / 2, sz * FOOT_Z), scale=None),
        dims(FOOT_W, FOOT_H, FOOT_W, 0.45),
        action("static", "center", (0, 0, 0), (0, 1, 0), 0.45, fracture="base-plinth"),
        [feature(f"foot-pad-{tag}",
                 "Lifts the plinth 0.06 units clear of the counter and shows as a short step in "
                 "the bottom silhouette.",
                 "box pad inset from the plinth corner facet",
                 [EVIDENCE, "base-plinth-zone"], 0.45)],
        surface(0.80, 0.08, 0.0, "flat moulded coral", "full contact occlusion under the pad",
                "none", "Inferred by symmetry from two feet visible in the reference; the other "
                        "two are not observed."),
        [EVIDENCE, "base-plinth-zone"],
        importance=0.25, confidence=0.45, parent="base-plinth",
        fidelity="blockout",
    ))

# --- top bezel -------------------------------------------------------------
top_bezel = component(
    "top-bezel", "Top bezel ring", "meso", "bezel", "extrude", "accent-coral",
    "assembled-solid",
    "A discrete moulded ring with a flat crown and hard chamfered corners standing proud of the "
    "cream deck; the reference shows a clean step where it meets the deck.",
    CORAL,
    {
        "topologyIntent": "proud octagonal ring framing the slot opening",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": ["crown chamfer inset 0.03"],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
        "profile2D": profile(
            chamfered_rect(BEZEL_W, BEZEL_D, BEZEL_C), BEZEL_H, axis="y", axis_offset=BEZEL_Y0,
            steps=2,
            stops=[[0.0, 1.0, 1.0], [0.5, 1.0, 1.0],
                   [1.0, inset_scale(BEZEL_W / 2, 0.03), inset_scale(BEZEL_D / 2, 0.03)]],
            exempt=[BORE_W / 2 + 0.02, BORE_D / 2 + 0.02],
            holes=[chamfered_rect(BORE_W, BORE_D, BORE_C)],
        ),
    },
    xform(),
    dims(BEZEL_W, BEZEL_H, BEZEL_D, 0.7),
    action(
        "static", "center", (0.0, BEZEL_Y0 + BEZEL_H / 2, 0.0), (0, 1, 0), 0.8,
        collider={"type": "box", "offset": [0.0, round(BEZEL_Y0 + BEZEL_H / 2, 4), 0.0], "scale": [BEZEL_W, round(BEZEL_H, 4), BEZEL_D],
                  "isTrigger": False, "notes": "Rim proxy for toast collision on eject."},
        fracture="top-bezel",
    ),
    [
        feature("proud-lip-step",
                "The ring stands 0.055 units above the cream deck, so a hard shadow line runs all "
                "the way round its outer edge.",
                "separate extrusion starting 0.02 units inside the deck",
                [EVIDENCE, "top-slot-zone"], 0.9),
        feature("bezel-crown-chamfer",
                "The crown chamfers inward by 0.03 units, softening the top edge without rounding it.",
                "final profileStop",
                [EVIDENCE, "top-slot-zone"], 0.8),
        feature("bezel-inner-wall",
                "The inner wall of the ring drops straight to the deck and frames the opening.",
                "profile2D hole matching the shell bore exactly",
                [EVIDENCE, "top-slot-zone"], 0.85),
    ],
    surface(0.70, 0.10, 0.0, "flat coral moulding", "shadow line at the deck step",
            "slight polish on the crown", "The most saturated coral in the frame."),
    [EVIDENCE, "top-slot-zone"],
    importance=0.85, confidence=0.9,
    seams=[{"id": "bezel-deck-seam", "with": "body-shell", "overlap": 0.02,
            "notes": "Bezel base is 0.02 units below the deck plane."}],
    fidelity="blockout",
)

# --- cavity ----------------------------------------------------------------
slot_cavity = component(
    "slot-cavity", "Slot cavity pocket", "meso", "cavity", "extrude", "cavity-gray",
    "assembled-solid",
    "The pocket is bounded by four flat wall panels meeting the deck at a hard rim; the reference "
    "shows straight vertical wall planes, not a blended cup.",
    GRAY,
    {
        "topologyIntent": "open-top pocket liner: an extruded ring that lines the deck bore",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals",
        "profile2D": profile(
            chamfered_rect(BORE_W + 0.10, BORE_D + 0.10, BORE_C + 0.02), CAVITY_DEPTH,
            axis="-y", axis_offset=-CAVITY_TOP,
            holes=[chamfered_rect(BORE_W - 0.004, BORE_D - 0.004, BORE_C)],
        ),
    },
    xform(),
    dims(BORE_W, CAVITY_DEPTH, BORE_D, 0.5),
    action(
        "static", "socket", (0.0, CAVITY_TOP, 0.0), (0, 1, 0), 0.6,
        sockets=[
            {"id": "toast-eject-front", "localPosition": [0.0, round(CAVITY_TOP + 0.06, 4), round(BORE_D / 4, 4)],
             "localRotation": [0.0, 0.0, 0.0],
             "notes": "Toast spawn for the front slot; launch direction is world +Y."},
            {"id": "toast-eject-back", "localPosition": [0.0, round(CAVITY_TOP + 0.06, 4), -round(BORE_D / 4, 4)],
             "localRotation": [0.0, 0.0, 0.0],
             "notes": "Toast spawn for the back slot; launch direction is world +Y."},
            {"id": "toast-eject", "localPosition": [0.0, round(CAVITY_TOP + 0.06, 4), 0.0],
             "localRotation": [0.0, 0.0, 0.0],
             "notes": "Combined launch origin when both slots fire together."},
        ],
        collider={"type": "box", "offset": [0.0, round(CAVITY_TOP - CAVITY_DEPTH / 2, 4), 0.0], "scale": [BORE_W, round(CAVITY_DEPTH, 4), BORE_D],
                  "isTrigger": True, "notes": "Trigger volume: anything inside is launchable."},
        fracture="body-shell",
    ),
    [
        feature("pocket-walls",
                "Four wall panels drop 0.55 units from the rim, darkening with depth.",
                "extruded ring lining the deck bore, embedded 0.05 units into the shell wall",
                [EVIDENCE, "top-slot-zone"], 0.7),
        feature("element-tab-rows",
                "Six trapezoidal nubs project from the wall faces, three along the divider and "
                "three along the rear wall, at a constant depth below the rim.",
                "InstancedMesh of six boxes, one draw call",
                [EVIDENCE, "top-slot-zone"], 0.8),
        feature("rim-undercut",
                "The liner sits 0.002 units below the deck so a thin dark line reads at the opening "
                "edge instead of a coincident-face seam.",
                "axisOffset shifted below the deck plane",
                [EVIDENCE, "top-slot-zone"], 0.7),
    ],
    surface(0.86, 0.08, 0.0, "matte moulded liner",
            "strong depth-driven occlusion down the pocket", "none",
            "Cavity depth is inferred; the reference view cannot see the floor."),
    [EVIDENCE, "top-slot-zone"],
    importance=0.8, confidence=0.6,
    seams=[{"id": "cavity-shell-seam", "with": "body-shell", "overlap": 0.05,
            "notes": "Liner outer contour is buried inside the shell wall."}],
)

cavity_floor = component(
    "cavity-floor", "Slot cavity floor", "meso", "cavity", "extrude", "cavity-gray",
    "assembled-solid",
    "A flat rigid plate closing the bottom of the pocket; it has one visible planar face, which is "
    "why it is a primitive plate rather than a sculpted form.",
    GRAY,
    {
        "topologyIntent": "flat plate closing the pocket",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "ExtrudeGeometry cap UVs",
        "normalStrategy": "flat facet normals",
        "profile2D": profile(chamfered_rect(BORE_W + 0.08, BORE_D + 0.08, BORE_C + 0.01), 0.06,
                             axis="y", axis_offset=CAVITY_FLOOR_TOP - 0.02),
    },
    xform(),
    dims(BORE_W, 0.04, BORE_D, 0.35),
    action("static", "center", (0.0, CAVITY_FLOOR_TOP, 0.0), (0, 1, 0), 0.4, fracture="body-shell"),
    [feature("crumb-floor",
             "Closes the pocket 0.55 units below the rim and catches the darkest value in the frame.",
             "plate wider than the pocket so no gap shows at the wall join",
             [EVIDENCE, "top-slot-zone"], 0.4)],
    surface(0.90, 0.06, 0.0, "matte liner", "deep occlusion", "none",
            "Not observed in the reference; depth chosen so a slice of toast fits."),
    [EVIDENCE, "top-slot-zone"],
    importance=0.3, confidence=0.4, parent="slot-cavity",
    seams=[{"id": "floor-wall-seam", "with": "slot-cavity", "overlap": 0.04,
            "notes": "Plate overlaps the wall ring."}],
)

cavity_divider = component(
    "cavity-divider", "Cavity divider wall", "meso", "divider", "box", "cavity-gray",
    "assembled-solid",
    "A single flat rigid partition with a light flat crown, clearly visible in the reference "
    "splitting the opening into two slots.",
    GRAY,
    {
        "topologyIntent": "thin partition splitting the pocket into two slots",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "box UVs",
        "normalStrategy": "vertex normals from generated geometry",
    },
    xform((0.0, (CAVITY_FLOOR_TOP + DIVIDER_TOP) / 2, 0.0), scale=None),
    dims(BORE_W - 0.04, DIVIDER_TOP - CAVITY_FLOOR_TOP, DIVIDER_T, 0.65),
    action("static", "center", (0, 0, 0), (0, 1, 0), 0.65, fracture="body-shell"),
    [feature("divider-crown",
             "The partition stops 0.08 units short of the rim, so its lit top edge reads as a pale "
             "strip running the length of the opening.",
             "box height ends below the deck plane",
             [EVIDENCE, "top-slot-zone"], 0.85)],
    surface(0.86, 0.08, 0.0, "matte liner", "occlusion in both slot troughs", "none",
            "Crown height read from the reference; the partition's base is inferred."),
    [EVIDENCE, "top-slot-zone"],
    importance=0.6, confidence=0.8, parent="slot-cavity",
)

# --- lever -----------------------------------------------------------------
lever_track = component(
    "lever-track", "Lever track collar", "meso", "trim", "extrude", "shell-cream",
    "assembled-solid",
    "A flat-faced collar with hard chamfered corners framing the carriage channel; the reference "
    "shows a crisp step, not a blended dish.",
    CREAM,
    {
        "topologyIntent": "collar ring standing proud of the right face, framing the channel opening",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals",
        "profile2D": profile(
            chamfered_rect(TRACK_D, TRACK_H, 0.06, cx=-LEVER_Z, cy=TRACK_CENTER_Y),
            0.022, axis="x", axis_offset=SHELL_FACE_X - 0.010,
            holes=[chamfered_rect(SLOT_W + 0.01, TRACK_H - 0.07, 0.025, cx=-LEVER_Z, cy=TRACK_CENTER_Y)],
        ),
    },
    xform(),
    dims(0.022, TRACK_H, TRACK_D, 0.7),
    action("static", "center", (SHELL_FACE_X, TRACK_CENTER_Y, LEVER_Z), (1, 0, 0), 0.75,
           fracture="body-shell"),
    [
        feature("recessed-channel",
                "The collar stands 0.018 units proud around a 0.16 by 0.64 opening, so the channel "
                "floor sits 0.036 units below the collar crown and reads as a cut groove.",
                "extruded ring with a chamfered-rect hole; the dark floor plate sits behind it",
                [EVIDENCE, "right-control-zone"], 0.8),
        feature("channel-end-caps",
                "The opening is chamfered at all four corners so the channel matches the body's "
                "facet language rather than reading as a rounded slot.",
                "chamfered-rect hole outline",
                [EVIDENCE, "right-control-zone"], 0.75),
    ],
    surface(0.72, 0.10, 0.0, "flat cream moulding",
            "hard occlusion inside the collar opening", "light polish on the collar crown",
            "Modelled as a proud collar around a recessed floor because ExtrudeGeometry can only "
            "cut holes along the extrusion axis; the step reads equivalently at the review angle."),
    [EVIDENCE, "right-control-zone"],
    importance=0.6, confidence=0.75,
    seams=[{"id": "collar-shell-seam", "with": "body-shell", "overlap": 0.012,
            "notes": "Collar base is buried in the shell face."}],
)

lever_slot = component(
    "lever-slot", "Lever channel floor", "micro", "recess", "extrude", "cavity-gray",
    "assembled-solid",
    "A flat recessed plate with straight edges forming the floor of the channel; the darkest flat "
    "value on the right face in the reference.",
    GRAY,
    {
        "topologyIntent": "dark floor plate set behind the collar opening",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "ExtrudeGeometry cap UVs",
        "normalStrategy": "flat facet normals",
        "profile2D": profile(
            chamfered_rect(SLOT_W, TRACK_H - 0.08, 0.02, cx=-LEVER_Z, cy=TRACK_CENTER_Y),
            0.02, axis="x", axis_offset=SHELL_FACE_X - 0.034),
    },
    xform(),
    dims(0.02, TRACK_H - 0.08, SLOT_W, 0.6),
    action("static", "center", (SHELL_FACE_X - 0.026, TRACK_CENTER_Y, LEVER_Z), (1, 0, 0), 0.6,
           fracture="body-shell"),
    [feature("channel-floor",
             "Sits 0.036 units below the collar crown so the channel reads as depth rather than "
             "as a painted dark line.",
             "plate offset along the extrusion axis",
             [EVIDENCE, "right-control-zone"], 0.7)],
    surface(0.88, 0.06, 0.0, "matte liner", "channel occlusion", "none",
            "Channel depth inferred; the reference cannot show the true floor distance."),
    [EVIDENCE, "right-control-zone"],
    importance=0.35, confidence=0.65, parent="lever-track",
)

lever_knob = component(
    "lever-knob", "Lever knob", "meso", "actuator", "extrude", "lever-yellow",
    "assembled-solid",
    "A chunky slab with six flat faces and a chamfer on every edge, clearly a moulded rigid part "
    "in the reference rather than a smooth blob.",
    YELLOW,
    {
        "topologyIntent": "chamfered slab projecting from the right face",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": ["outer end chamfer inset 0.035"],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
        "profile2D": profile(
            chamfered_rect(KNOB_D, KNOB_H, KNOB_C), KNOB_OUT, axis="x", axis_offset=0.0, steps=4,
            stops=[[0.0, 1.0, 1.0], [0.75, 1.0, 1.0],
                   [1.0, inset_scale(KNOB_D / 2, 0.035), inset_scale(KNOB_H / 2, 0.035)]],
        ),
    },
    xform((SHELL_FACE_X, LEVER_CENTER_Y, LEVER_Z)),
    dims(KNOB_OUT, KNOB_H, KNOB_D, 0.7),
    action(
        "slider", "socket", (0.0, 0.0, 0.0), (0, 1, 0), 0.85,
        channels={"translate": True},
        sockets=[{"id": "lever-grip", "localPosition": [0.2, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0],
                  "notes": "Outer face of the knob; the hand or an actuator grabs here."}],
        collider={"type": "box", "offset": [0.1, 0.0, 0.0], "scale": [0.2, 0.24, 0.34],
                  "isTrigger": False, "notes": "Knob proxy."},
        constraints=[{"type": "linear-limit", "axis": [0, 1, 0], "min": -round(LEVER_TRAVEL, 4), "max": 0.0,
                      "notes": "Down 0.30 units is the fully-cocked carriage position; 0 is popped up."}],
        fracture="lever-assembly",
        detach=["lever-knob", "lever-neck"],
    ),
    [
        feature("knob-chamfers",
                "Every edge of the slab carries a flat chamfer roughly 0.06 units wide, matching "
                "the body's facet language.",
                "chamfered-rect extrude profile plus an end-chamfer profileStop",
                [EVIDENCE, "right-control-zone"], 0.9),
        feature("knob-projection",
                "The knob stands 0.20 units clear of the right face, far enough to overhang the "
                "channel collar.",
                "extrusion depth along the face normal",
                [EVIDENCE, "right-control-zone"], 0.85),
    ],
    surface(0.68, 0.09, 0.0, "flat yellow moulding", "contact shadow where it meets the collar",
            "chamfer crowns polished by handling",
            "Brightest saturated value in the frame; slightly smoother than the shell."),
    [EVIDENCE, "right-control-zone"],
    importance=0.85, confidence=0.85,
)

lever_neck = component(
    "lever-neck", "Lever neck", "micro", "actuator", "box", "lever-yellow",
    "assembled-solid",
    "A short flat-sided stem bridging the knob to the channel; partly occluded in the reference "
    "but its flat sides are visible above and below the knob.",
    YELLOW,
    {
        "topologyIntent": "stem passing through the channel opening",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "box UVs",
        "normalStrategy": "vertex normals from generated geometry",
    },
    xform((-0.015, 0.0, 0.0), scale=None),
    dims(0.06, 0.20 * VS, 0.13, 0.55),
    action("slider", "center", (0, 0, 0), (0, 1, 0), 0.6, channels={"translate": True},
           fracture="lever-assembly"),
    [feature("neck-through-slot",
             "Fills the channel opening behind the knob so no gap shows through to the shell "
             "interior.",
             "box sized to the collar opening, rides with the knob",
             [EVIDENCE, "right-control-zone"], 0.6)],
    surface(0.70, 0.09, 0.0, "flat yellow moulding", "occlusion inside the channel", "none",
            "Partly inferred: the reference only shows the neck where the knob does not cover it."),
    [EVIDENCE, "right-control-zone"],
    importance=0.3, confidence=0.6, parent="lever-knob",
)

# --- dial ------------------------------------------------------------------
control_plate = component(
    "control-plate", "Control plate", "meso", "trim", "extrude", "shell-cream",
    "assembled-solid",
    "A shallow raised pad with a flat top and hard chamfered corners; the reference shows its "
    "outline as a step in the shell face, so it is a real part, not a decal.",
    CREAM,
    {
        "topologyIntent": "raised pad carrying the dial and its tick arc",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals",
        "profile2D": profile(chamfered_rect(PLATE_D, PLATE_H, PLATE_C), PLATE_PROUD,
                             axis="-x", axis_offset=0.0),
    },
    xform((SHELL_FACE_X + PLATE_PROUD, DIAL_Y, DIAL_Z)),
    dims(PLATE_PROUD, PLATE_H, PLATE_D, 0.6),
    action("static", "socket", (0.0, 0.0, 0.0), (1, 0, 0), 0.7, fracture="body-shell"),
    [
        feature("raised-pad-edge",
                "The pad stands 0.017 units proud of the shell face; its chamfered outline is the "
                "faint arc visible above and left of the dial.",
                "shallow extrusion along the face normal",
                [EVIDENCE, "right-control-zone"], 0.75),
        feature("tick-arc",
                "Nine short coral nubs sit on a 0.19 unit circle around the dial axis; the lowest "
                "three or four are hidden behind the plinth, which is why the reference reads as "
                "an arc rather than a full ring.",
                "InstancedMesh of nine boxes on a radial placement, one draw call",
                [EVIDENCE, "right-control-zone"], 0.8),
    ],
    surface(0.72, 0.10, 0.0, "flat cream moulding", "soft step shadow around the pad outline",
            "none", "Pad extent partly occluded by the dial and the plinth."),
    [EVIDENCE, "right-control-zone"],
    importance=0.55, confidence=0.7,
    seams=[{"id": "plate-shell-seam", "with": "body-shell", "overlap": 0.017,
            "notes": "Pad extrudes inward from its outer face into the shell."}],
)

control_dial = component(
    "control-dial", "Control dial", "meso", "control", "extrude", "accent-coral",
    "assembled-solid",
    "A twelve-sided faceted knob: the reference shows countable flat facets around its rim and a "
    "flat chamfered outer face, not a smooth turned cylinder.",
    CORAL,
    {
        "topologyIntent": "faceted rotary knob with a chamfered outer face",
        "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": ["outer face chamfer inset 0.018"],
        "uvStrategy": "ExtrudeGeometry cap and wall UVs",
        "normalStrategy": "flat facet normals recomputed after the profile deformation",
        "profile2D": profile(
            regular_polygon(DIAL_R, 12), DIAL_OUT, axis="x", axis_offset=0.0, steps=5,
            stops=[[0.0, 1.0, 1.0], [0.8, 1.0, 1.0],
                   [1.0, inset_scale(DIAL_R, 0.018), inset_scale(DIAL_R, 0.018)]],
        ),
    },
    xform((SHELL_FACE_X, DIAL_Y, DIAL_Z)),
    dims(DIAL_OUT, DIAL_R * 2, DIAL_R * 2, 0.7),
    action(
        "rotator", "socket", (0.0, 0.0, 0.0), (1, 0, 0), 0.85,
        channels={"rotate": True},
        sockets=[{"id": "dial-pointer", "localPosition": [round(DIAL_OUT + 0.008, 4), 0.11, 0.0],
                  "localRotation": [0.0, 0.0, 0.0],
                  "notes": "Tip of the pointer rib; read the browning setting from its angle."}],
        collider={"type": "cylinder", "offset": [0.05, 0.0, 0.0], "scale": [0.1, 0.24, 0.24],
                  "isTrigger": False, "notes": "Knob proxy; axis is world X."},
        constraints=[{"type": "angular-limit", "axis": [1, 0, 0], "min": -2.79, "max": 2.79,
                      "notes": "Nine detents spanning 320 degrees, one per tick mark."}],
        fracture="control-assembly", detach=["control-dial", "dial-notch"],
    ),
    [
        feature("faceted-rim",
                "Twelve flat rim facets catch the key light as discrete bands rather than a "
                "continuous specular sweep.",
                "twelve-sided extrude profile",
                [EVIDENCE, "right-control-zone"], 0.8),
        feature("outer-face-chamfer",
                "The outer face steps in by 0.018 units, giving the knob a flat crown ringed by a "
                "narrow chamfer.",
                "final profileStop",
                [EVIDENCE, "right-control-zone"], 0.8),
        feature("plinth-straddle",
                "The knob axis sits 0.06 units above the plinth top and the knob projects past the "
                "plinth face, so its lower third overlaps the coral slab exactly as in the reference.",
                "component position, not geometry",
                [EVIDENCE, "right-control-zone", "base-plinth-zone"], 0.75),
    ],
    surface(0.70, 0.10, 0.0, "flat coral moulding", "undercut shadow where the knob meets the pad",
            "none", "Same coral pigment as the bezel and plinth."),
    [EVIDENCE, "right-control-zone"],
    importance=0.8, confidence=0.8,
    seams=[{"id": "dial-plate-seam", "with": "control-plate", "overlap": 0.017,
            "notes": "Knob base is buried in the pad."}],
)

dial_notch = component(
    "dial-notch", "Dial pointer mark", "micro", "control", "box", "accent-coral",
    "assembled-solid",
    "A short raised rib with flat sides on the knob crown, visible in the reference as a hard-edged "
    "pointer running from the knob centre toward its rim.",
    CORAL,
    {
        "topologyIntent": "raised pointer rib on the knob crown",
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "box UVs",
        "normalStrategy": "vertex normals from generated geometry",
    },
    xform((DIAL_OUT + 0.008, 0.055, 0.0), scale=None),
    dims(0.03, 0.11, 0.045, 0.7),
    action("rotator", "center", (0, 0, 0), (1, 0, 0), 0.7, channels={"rotate": True},
           fracture="control-assembly"),
    [feature("pointer-rib",
             "Stands 0.015 units proud of the knob crown and reads as a shadowed groove pair at "
             "the reference lighting angle.",
             "box rib parented to the knob so it turns with it",
             [EVIDENCE, "right-control-zone"], 0.7)],
    surface(0.70, 0.10, 0.0, "flat coral moulding", "hard shadow either side of the rib", "none",
            "The reference rib has a slight L bend; modelled as a straight bar."),
    [EVIDENCE, "right-control-zone"],
    importance=0.3, confidence=0.7, parent="control-dial",
)

COMPONENTS = (
    [body_shell, base_plinth] + FEET +
    [top_bezel, slot_cavity, cavity_floor, cavity_divider,
     lever_track, lever_slot, lever_knob, lever_neck,
     control_plate, control_dial, dial_notch]
)

# ---------------------------------------------------------------------------
# repetition systems
# ---------------------------------------------------------------------------
TAB_X = [-0.28, 0.0, 0.28]
TAB_Y = CAVITY_TOP - 0.07
TAB_FRONT_Z = DIVIDER_T / 2 + 0.0225
TAB_BACK_Z = -(BORE_D - 0.004) / 2 + 0.0225

REPETITION_SYSTEMS = [
    {
        "id": "dial-tick-ring",
        "name": "Browning dial tick marks",
        "level": "micro",
        "parent": "control-plate",
        "count": TICK_COUNT,
        "primitive": "box",
        "material": "accent-coral",
        "instanceScale": [0.048, 0.022, 0.022],
        "buildsGeometry": True,
        "realization": "instanced-mesh",
        "placement": {
            "mode": "radial",
            "axis": [1, 0, 0],
            "radius": TICK_RADIUS * 2,
            "startAngleDeg": 160,
            "notes": "radius is stored doubled because the factory places instances at radius*0.5.",
        },
        "evidenceRefs": [EVIDENCE, "right-control-zone"],
        "notes": (
            "Nine nubs on a full circle. The plinth occludes the lowest three, which reproduces the "
            "reference's arc-with-a-gap read without authoring a partial arc."
        ),
    },
    {
        "id": "cavity-element-tabs",
        "name": "Heating element tabs",
        "level": "micro",
        "parent": "slot-cavity",
        "count": 6,
        "primitive": "box",
        "material": "cavity-gray",
        "instanceScale": [0.055, round(0.075 * VS, 4), 0.045],
        "buildsGeometry": True,
        "realization": "instanced-mesh",
        "placement": {
            "mode": "rows",
            "axis": [0, 1, 0],
            "radius": 0.0,
            "startAngleDeg": 0,
            "rows": 2,
            "perRow": 3,
            "instances": [[x, TAB_Y, TAB_FRONT_Z] for x in TAB_X]
                         + [[x, TAB_Y, TAB_BACK_Z] for x in TAB_X],
            "notes": (
                "Two rows of three along the slot length. The factory's repetition emitter only "
                "supports radial placement, so the emitted instance loop is replaced by these "
                "explicit local positions in the documented refine-code edit."
            ),
        },
        "evidenceRefs": [EVIDENCE, "top-slot-zone"],
        "notes": "One InstancedMesh, one draw call, six tabs.",
    },
]

# ---------------------------------------------------------------------------
# detail inventory (schema-valid form; every entry links to a real spec node)
# ---------------------------------------------------------------------------
MATERIAL_IDS = {"shell-cream", "accent-coral", "lever-yellow", "cavity-gray"}


def detail(did, zone, kind, description, ref, geometry, evidence, confidence):
    """`mapsTo.ref` is the bare local-feature or local-override id, not `owner/id`.
    validate_sculpt_spec accepts either form, but check_part_coverage folds the whole
    string to alphanumerics and only ever matches a bare id, so the composite form reads
    as a dangling detail there. All ids are unique across components and materials."""
    owner, _, leaf = ref.partition("/")
    return {
        "id": did,
        "zone": zone,
        "kind": kind,
        "description": description,
        "mapsTo": {
            "ref": leaf or owner,
            "owner": owner,
            "kind": "material.localOverrides" if owner in MATERIAL_IDS else "component.localFeatures",
        },
        "geometryRecipe": geometry,
        "evidenceRef": evidence,
        "confidence": confidence,
    }


DETAILS = [
    detail("corner-chamfers", "body-all-edges", "bevel",
           "Every vertical and horizontal corner of the shell carries a wide flat 45 degree "
           "chamfer, giving a faceted octagonal plan rather than a rounded box.",
           "body-shell/plan-chamfer-facets",
           "Extruded Shape with a chamfered plan outline; never a rounded box.",
           EVIDENCE, 0.92),
    detail("body-taper", "body-upper", "contour",
           "The shell narrows by 0.03 units per side between the plinth seam and the top of the "
           "vertical wall, about 3.8 percent on the width.",
           "body-shell/upward-taper",
           "profileStops scale the shape-plane coordinates along the extrusion axis.",
           EVIDENCE, 0.72),
    detail("top-chamfer-band", "body-top", "bevel",
           "A 0.14 unit tall chamfer band insets the plan a further 0.11 units before the flat "
           "top deck begins.",
           "body-shell/top-chamfer-band",
           "Final profileStop turns the top of the prism into a frustum band.",
           EVIDENCE, 0.82),
    detail("bezel-proud-lip", "top-face", "ridge",
           "The coral bezel stands 0.055 units above the cream deck and frames the opening as a "
           "chamfered rounded-rectangle ring.",
           "top-bezel/proud-lip-step",
           "Extruded octagonal ring with a hole, seated 0.02 units into the deck.",
           EVIDENCE, 0.9),
    detail("bezel-crown-chamfer", "top-face", "bevel",
           "The bezel crown chamfers inward by 0.03 units instead of rounding over.",
           "top-bezel/bezel-crown-chamfer",
           "Final profileStop on the bezel extrusion.",
           EVIDENCE, 0.8),
    detail("cavity-element-tabs", "slot-interior", "ridge",
           "Six small dark tabs project from the slot walls, three per slot, reading as heating "
           "element brackets.",
           "slot-cavity/element-tab-rows",
           "InstancedMesh of six boxes in two rows of three.",
           EVIDENCE, 0.8),
    detail("cavity-divider-crown", "slot-interior", "ridge",
           "The divider stops 0.08 units below the rim so its lit crown reads as a pale strip "
           "along the opening.",
           "cavity-divider/divider-crown",
           "Box partition whose top ends below the deck plane.",
           EVIDENCE, 0.85),
    detail("dial-tick-ring", "lower-right-face", "linework",
           "Nine short coral tick marks ring the rotary dial; the plinth hides the lowest three, "
           "so the reference reads as an arc.",
           "control-plate/tick-arc",
           "InstancedMesh of nine boxes on a radial placement about the dial axis.",
           EVIDENCE, 0.8),
    detail("dial-pointer-rib", "lower-right-face", "groove",
           "A raised rib runs from the knob centre toward its rim and marks the current setting.",
           "dial-notch/pointer-rib",
           "Box bar parented to the knob so it turns with it.",
           EVIDENCE, 0.7),
    detail("lever-track-channel", "right-face", "groove",
           "The yellow lever rides in a channel whose floor sits 0.036 units below the surrounding "
           "collar crown, visible above and below the knob.",
           "lever-track/recessed-channel",
           "Proud collar ring with a chamfered-rect opening and a dark floor plate behind it.",
           EVIDENCE, 0.8),
    detail("lever-knob-chamfers", "right-face", "bevel",
           "Every edge of the yellow knob carries a flat chamfer about 0.06 units wide.",
           "lever-knob/knob-chamfers",
           "Chamfered-rect extrude profile plus an end-chamfer profileStop.",
           EVIDENCE, 0.9),
    detail("plinth-overhang", "base", "contour",
           "The coral plinth is 0.05 units wider than the shell on every side and carries its own "
           "chamfer, reading as a separate slab.",
           "base-plinth/overhang-ledge",
           "Separate chamfered extrude, wider footprint, 0.02 unit seam overlap into the shell.",
           EVIDENCE, 0.85),
    detail("plinth-double-bevel", "base", "bevel",
           "Both the top and the bottom edge of the plinth bevel inward by 0.05 units.",
           "base-plinth/double-bevel-profile",
           "profileStops at t=0, 0.23, 0.77 and 1.0.",
           EVIDENCE, 0.78),
    detail("corner-feet", "underside", "contour",
           "Four small pads at the plinth corners lift it 0.06 units off the counter.",
           "foot-front-right/foot-pad-front-right",
           "Four box pads inset from the plinth corner facets. Two are visible; two are inferred.",
           EVIDENCE, 0.45),
    detail("plinth-seam-shadow", "base", "seam",
           "A hard contact shadow runs along the joint where the cream shell enters the coral "
           "plinth.",
           "shell-cream/plinth-seam-shadow",
           "Material local override raising roughness and AO in the lowest 0.05 units of the wall.",
           EVIDENCE, 0.8),
    detail("pocket-depth-gradient", "slot-interior", "stain",
           "The slot pocket darkens sharply with depth; the floor is the darkest value in the frame.",
           "cavity-gray/pocket-depth-gradient",
           "Material local override with a depth-driven AO boost on the pocket walls.",
           EVIDENCE, 0.75),
]

DETAIL_INVENTORY = {
    "scanMethod": "component-zone scan of the three-quarter reference at 3x and 4x magnification, "
                  "cross-checked against per-material crops",
    "targetMinDetails": 6,
    "note": "Every detail below resolves to a component.localFeatures id or a "
            "material.localOverrides id; none is prose only.",
    "details": DETAILS,
}

# ---------------------------------------------------------------------------
# spec assembly
# ---------------------------------------------------------------------------
FEATURE_REVIEW_TARGETS = [
    {
        "id": "chamfer-facet-language",
        "name": "Chamfered octagonal facet language",
        "tier": "critical",
        "passIds": ["blockout", "structural-pass", "form-refinement"],
        "minimumScore": 0.8,
        "mustPass": True,
        "componentRefs": ["body-shell", "base-plinth", "top-bezel", "lever-knob", "control-dial"],
        "evidenceRefs": [EVIDENCE, "front-facet-zone"],
        "failureModes": ["reads as a rounded box", "corner facets too narrow to see",
                         "smooth bevels instead of flat chamfers"],
    },
    {
        "id": "proportion-and-stance",
        "name": "Massing, plinth overhang and stance",
        "tier": "critical",
        "passIds": ["blockout", "structural-pass", "lighting-pass", "optimization-pass"],
        "minimumScore": 0.8,
        "mustPass": True,
        "componentRefs": ["body-shell", "base-plinth", "foot-front-left", "foot-front-right"],
        "evidenceRefs": [EVIDENCE, "base-plinth-zone"],
        "failureModes": ["body too tall or too deep", "plinth flush with the shell instead of proud",
                         "no visible feet under the slab"],
    },
    {
        "id": "coral-trim-pairing",
        "name": "Coral bezel and plinth framing the cream body",
        "tier": "critical",
        "passIds": ["structural-pass", "form-refinement", "material-pass"],
        "minimumScore": 0.8,
        "mustPass": True,
        "componentRefs": ["top-bezel", "base-plinth", "control-dial"],
        "evidenceRefs": [EVIDENCE, "top-slot-zone", "base-plinth-zone"],
        "failureModes": ["bezel flush with the deck", "coral hue drifts between bezel and plinth",
                         "bezel outline rounded instead of chamfered"],
    },
    {
        "id": "control-cluster",
        "name": "Lever in its channel plus dial, pad and tick arc",
        "tier": "critical",
        "passIds": ["form-refinement", "material-pass", "interaction-pass"],
        "minimumScore": 0.8,
        "mustPass": True,
        "componentRefs": ["lever-track", "lever-slot", "lever-knob", "control-plate", "control-dial",
                          "dial-notch"],
        "evidenceRefs": [EVIDENCE, "right-control-zone"],
        "failureModes": ["lever floats off the face with no channel", "dial reads as a smooth cylinder",
                         "tick marks missing or evenly ringing the whole dial"],
    },
    {
        "id": "matte-plastic-response",
        "name": "Matte injection-moulded plastic response",
        "tier": "critical",
        "passIds": ["material-pass", "surface-pass", "lighting-pass"],
        "minimumScore": 0.75,
        "mustPass": True,
        "componentRefs": ["body-shell", "base-plinth", "lever-knob", "slot-cavity"],
        "evidenceRefs": [EVIDENCE, "front-facet-zone"],
        "failureModes": ["glossy or clearcoated highlights", "single flat albedo with no tone drift",
                         "cavity as bright as the exterior"],
    },
    {
        "id": "slot-cavity-read",
        "name": "Recessed twin slots with divider and element tabs",
        "tier": "important",
        "passIds": ["structural-pass", "form-refinement", "surface-pass"],
        "minimumScore": 0.65,
        "mustPass": False,
        "componentRefs": ["slot-cavity", "cavity-divider", "cavity-floor"],
        "evidenceRefs": [EVIDENCE, "top-slot-zone"],
        "failureModes": ["opening reads as a flat dark decal", "no divider between the two slots",
                         "element tabs absent"],
    },
]

VIEW_EVIDENCE = [
    {"id": EVIDENCE, "view": "primary three-quarter (azimuth ~41 deg, elevation ~13 deg)",
     "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": [
         "Silhouette bounding box spans x 96-1149 and y 130-1156 in a 1254 square image.",
         "Two broad cream faces meet through a wide bright chamfer facet, confirming an octagonal plan.",
         "Coral appears in exactly three places: the top bezel, the base plinth and the dial cluster.",
         "Rear face, left face and underside are not visible and are inferred by symmetry.",
     ],
     "confidence": 0.9},
    {"id": "top-slot-zone", "view": "top opening",
     "imageRegion": {"x": 0.20, "y": 0.08, "width": 0.60, "height": 0.24, "units": "normalized"},
     "observations": [
         "Coral ring stands proud of the cream deck with a chamfered, not rounded, outline.",
         "A pale divider crown runs the length of the opening, splitting it into two slots.",
         "Two rows of three dark tabs project from the wall faces below the rim.",
     ],
     "confidence": 0.85},
    {"id": "right-control-zone", "view": "right face controls",
     "imageRegion": {"x": 0.64, "y": 0.30, "width": 0.31, "height": 0.52, "units": "normalized"},
     "observations": [
         "Yellow knob with flat chamfers on every edge sits in a channel that continues above and below it.",
         "Faceted coral dial with a raised pointer rib sits on a shallow raised pad.",
         "Six tick nubs are visible around the upper part of the dial; the lower arc is hidden by the plinth.",
     ],
     "confidence": 0.85},
    {"id": "base-plinth-zone", "view": "plinth and feet",
     "imageRegion": {"x": 0.03, "y": 0.58, "width": 0.96, "height": 0.41, "units": "normalized"},
     "observations": [
         "The coral slab overhangs the cream shell on every visible side.",
         "The slab shows a bevel at both its top and its bottom edge.",
         "Two corner feet are visible as short steps below the slab.",
     ],
     "confidence": 0.8},
    {"id": "front-facet-zone", "view": "front and chamfer facets",
     "imageRegion": {"x": 0.08, "y": 0.25, "width": 0.55, "height": 0.50, "units": "normalized"},
     "observations": [
         "Front face luminance is flat at about 214 of 255 and steps to about 224 across the chamfer facet.",
         "Facet boundaries are hard creases with no fillet gradient.",
         "The left silhouette edge leans inward as it rises, confirming a slight taper.",
     ],
     "confidence": 0.85},
]

LIGHTING_FROM_PHOTO = [
    "Ambient dominance: the reference is a soft studio render, not a key-lit one. Measured cream "
    "values are 235,218,197 on the lit front face and 238,216,186 on the shaded right end face - "
    "within two percent of each other. A warm hemisphere (#FFEED2 sky over #E4D6BE ground) at "
    "about 3.8 reproduces that near-shadowless value range.",
    "Key light: a gentle warm directional source (#FFE9C9) at about 1.3 from high and to the "
    "camera left. It only has to lift the top deck to 249,235,220, about six percent above the "
    "front face; a stronger key drives the end face far darker than the reference.",
    "Rim and environment light: weak warm back light at about 0.35. The room environment map is "
    "deliberately off for the reference-matched render: its neutral white irradiance washes the "
    "warm plastic toward grey and drops the cream chroma from 0.16 to 0.05.",
    "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The "
    "reference holds a narrow value range with no blown highlights and no crushed shadows.",
    "Contact shadow: cavity ambient occlusion plus a soft ground shadow. The slot pocket, the "
    "lever channel and the plinth seam carry the darkest values; the review render has no ground "
    "plane so the silhouette mask stays clean.",
]

BUILD_PASSES = [
    {
        "id": "blockout",
        "goal": "Match the macro silhouette and proportions: chamfered shell mass, proud plinth, "
                "bezel crown and corner feet.",
        "componentRefs": ["body-shell", "base-plinth", "top-bezel", "foot-front-left",
                          "foot-front-right", "foot-back-left", "foot-back-right"],
        "acceptance": [
            "Silhouette reads correctly without materials.",
            "Quality contract has named all required macro feature groups before code generation.",
            "The octagonal plan is visible as facets, not as a rounded box.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "structural-pass",
        "goal": "Build the full component hierarchy: slot pocket, divider, lever assembly and "
                "control cluster under the shell root.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "Macro, meso and repeated structures meet qualityContract.minimumSpecDepth.",
            "Parent-child relations, seams and contact points are explicit.",
            "Every part that touches another overlaps it by at least 0.02 world units.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "form-refinement",
        "goal": "Deliver the taper, the top chamfer band, the plinth double bevel and the two "
                "instanced micro systems.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "profileStops produce a real tapered chamfer band, not a straight prism.",
            "Nine dial ticks and six element tabs exist as InstancedMesh clusters.",
            "No child part floats away from its parent.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "material-pass",
        "goal": "Match the four-layer palette and the matte plastic response.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "Reference-derived albedo palette records dominant, secondary and accent colours per material.",
            "Each material defines roughness variation and an independent normal response.",
            "Local material overrides are tied to evidenceRefs.",
            "Albedo, roughness, height, normal and AO are generated independently at 1024px.",
            "Macro, meso and micro surface frequency bands are present without visible tiling.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "surface-pass",
        "goal": "Add cavity darkening, seam occlusion and chamfer-crown polish.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "Every material feature group has local overrides or surfaceDetail tied to evidenceRefs.",
            "A grazing-angle render shows facet creases without plastic-looking uniform highlights.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "lighting-pass",
        "goal": "Reproduce the reference key/fill/rim structure and prove the form survives relighting.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "lightingFromPhoto names key direction, fill, rim or environment, exposure, tone mapping "
            "and contact shadow behaviour.",
            "Neutral, grazing and reference-matched renders distinguish material errors from lighting errors.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "interaction-pass",
        "goal": "Expose the runtime rig: lever slide pivot, dial yaw pivot, toast eject sockets and "
                "collider proxies.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "root.userData.sculptRuntime exposes nodes, meshes, sockets, colliders and destruction groups.",
            "The lever node translates on world Y and the dial node rotates about world X without "
            "detaching their children.",
            "Toast eject sockets sit above each slot and point up.",
            "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold.",
        ],
    },
    {
        "id": "optimization-pass",
        "goal": "Protect real-time budget after fidelity is accepted.",
        "componentRefs": [c["id"] for c in COMPONENTS],
        "acceptance": [
            "Triangle count, draw calls and instancing are measured against performanceBudget.",
            "Repeated detail stays instanced.",
        ],
    },
]

QUALITY_CONTRACT = {
    "qualityBar": "moderate",
    "definitionOfDone": [
        "The rendered model matches the reference silhouette, primary proportions, visible component "
        "hierarchy, material response and every detail in the inventory at the moderate fidelity tier.",
        "The chamfered octagonal facet language is unmistakable from at least two camera angles.",
        "The model is action-ready: lever slide, dial rotation and toast ejection are drivable from "
        "root.userData.sculptRuntime without rebuilding geometry.",
    ],
    "minimumSpecDepth": {
        "macroComponents": 2,
        "mesoComponents": 3,
        "microFeatureGroups": 2,
        "materialLayers": 2,
        "repetitionSystems": 2,
        "reviewViewpoints": 3,
    },
    "featureGroups": [
        {
            "id": "overall-silhouette",
            "name": "Overall silhouette and proportions",
            "required": True,
            "qualityCriteria": [
                "Bounding shape, chamfer facet widths, plinth overhang and top-deck inset are stated "
                "as measured numbers, not adjectives.",
                "The width to depth to height ratio traces to reference measurements.",
            ],
            "evidenceRefs": [EVIDENCE, "front-facet-zone", "base-plinth-zone"],
            "failureModes": ["model reads as a generic rounded box",
                             "major proportions are guessed without evidence"],
        },
        {
            "id": "primary-structure",
            "name": "Primary structure and hierarchy",
            "required": True,
            "qualityCriteria": [
                "Shell, plinth, bezel, pocket, lever assembly and control cluster are separate named parts.",
                "Every contact records a seam with an overlap of at least 0.02 world units.",
            ],
            "evidenceRefs": [EVIDENCE, "top-slot-zone", "right-control-zone"],
            "failureModes": ["large visible parts merged into one mesh",
                             "component hierarchy too shallow for the observed complexity"],
        },
        {
            "id": "attachment-joint-correctness",
            "name": "Contact and joint correctness",
            "required": True,
            "qualityCriteria": [
                "This object has no cantilevered appendage, so contact correctness is carried by "
                "component.seams overlaps rather than attachment endpoint contracts.",
                "Movable parts keep their children: the lever neck rides the knob and the pointer rib "
                "rides the dial.",
            ],
            "evidenceRefs": [EVIDENCE, "right-control-zone"],
            "failureModes": ["child part floats away from its parent",
                             "a gap opens at a seam under animation",
                             "parent-child transform mixes world and local coordinates"],
        },
        {
            "id": "surface-material-response",
            "name": "Surface material response",
            "required": True,
            "qualityCriteria": [
                "Albedo zones, roughness, normal intent, cavity darkening and local overrides are "
                "specified per material and tied to evidenceRefs.",
                "Albedo, roughness, height, normal and AO are independent fields.",
                "Surface response is decomposed into macro, meso and micro frequency bands.",
            ],
            "evidenceRefs": [EVIDENCE, "front-facet-zone", "top-slot-zone"],
            "failureModes": ["surface looks like glossy toy plastic",
                             "local material variation missing or untraceable to the image"],
        },
        {
            "id": "reference-lookdev",
            "name": "Reference colour, material and lighting response",
            "required": True,
            "qualityCriteria": [
                "The four-layer palette traces to median-sampled reference pixels.",
                "Reference PBR extraction ran on every material crop and its confidence and its "
                "binding decision are both recorded.",
                "Lighting names key, fill, rim or environment, exposure, tone mapping, background and "
                "contact shadow behaviour.",
                "Neutral, grazing and reference-matched renders prove relief survives relighting.",
            ],
            "evidenceRefs": [EVIDENCE, "front-facet-zone"],
            "failureModes": ["acceptable shape but flat-shaded read",
                             "colours are a generic average instead of reference-observed zones",
                             "lighting is evenly ambient"],
        },
        {
            "id": "action-readiness",
            "name": "Runtime rig readiness",
            "required": True,
            "qualityCriteria": [
                "Lever slide pivot, dial rotation pivot and toast eject sockets exist as named nodes.",
                "Collider proxies and destruction groups are declared for every macro and meso part.",
            ],
            "evidenceRefs": [EVIDENCE, "right-control-zone", "top-slot-zone"],
            "failureModes": ["model is an inert lump with no pivots",
                             "sockets sit inside solid geometry"],
        },
    ],
    "visualDeltaChecks": [
        "silhouette and negative-space delta",
        "chamfer facet width and count delta",
        "component hierarchy depth delta",
        "repetition density and distribution delta",
        "material albedo, roughness and normal response delta",
        "local feature placement and scale delta",
    ],
    "antiShallowSpecRules": [
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
    ],
}
QUALITY_CONTRACT["mustNotDo"] = list(QUALITY_CONTRACT["antiShallowSpecRules"])

SPEC = {
    "targetName": "Apartment Toaster",
    "targetId": "apartment-toaster",
    "schemaVersion": "2.1",
    "terminologyProfile": {
        "domain": "real-time procedural Three.js game prop",
        "geometryTerms": ["silhouette", "topology", "primitive", "chamfer", "facet", "taper",
                          "extrude profile", "profile stop", "edge crease", "surface normal",
                          "instanced cluster"],
        "materialTerms": ["albedo", "baseColor", "roughness", "metalness", "normal map",
                          "ambient occlusion", "cavity darkening", "edge wear", "clearcoat"],
        "lightingTerms": ["key light", "fill light", "rim light", "environment reflection",
                          "contact shadow", "tone mapping", "exposure"],
        "descriptionRule": "Use measurable 3D graphics terms. Every shape claim carries a number or "
                           "a named geometry operation.",
    },
    "sourceImage": SOURCE_IMAGE,
    "referenceCamera": {
        "solved": True,
        "solveMethod": "azimuth from facet-width ratios on the reference silhouette; elevation and "
                       "vertical proportion from a rendered sweep scored by Tier-1 silhouette IoU",
        "fovDegrees": 28.0,
        "aspect": 1.0,
        "orientation": {"yaw": 41.0, "pitch": -19.0, "roll": 0.0},
        "targetHint": [0.0, 0.62, 0.0],
        "note": "Azimuth 41 degrees comes from the measured screen widths of the front face (462 px), "
                "the corner chamfer facet (187 px) and the right face (310 px), which give "
                "tan(azimuth) = 0.87. The first elevation estimate from top-face edge slopes was "
                "13 degrees and proved wrong; a 15-position sweep over elevation and vertical scale, "
                "scored by silhouette IoU, settled on 19 degrees with the model 14 percent shorter "
                "than the first estimate (IoU 0.932, aspect delta 0.000, scale delta 0.000). "
                "Distance is not fixed here: the preview harness solves it by fitting the render's "
                "projected bounding box to the reference bounding box (x 96-1149, y 130-1156 of 1254).",
    },
    "measurementBasis": {
        "pixelsPerWorldUnit": 548.0,
        "referenceBBox": {"x0": 96, "y0": 130, "x1": 1149, "y1": 1156, "imageSize": 1254},
        "derivations": [
            "Front face 462 px and right face 310 px on screen, with a 187 px chamfer facet between "
            "them, solve to W-2c : D-2c = 1.12 : 0.87 and a chamfer of 0.24 world units.",
            "Shell height 664 px of vertical screen extent at the front centre column gives 1.22 "
            "world units; the plinth's 117 px gives 0.22.",
            "Total silhouette height 1026 px solves to 1.55 world units including the proud bezel.",
            "Left silhouette edge moves inward 21 px over 308 px of height, which after removing "
            "perspective splay leaves about 0.03 units of taper per side.",
        ],
    },
    "suitability": "conditional",
    "scores": {
        "object_isolation": 3,
        "silhouette_readability": 3,
        "depth_inference": 2,
        "primitive_decomposition": 3,
        "material_procedurality": 3,
        "occlusion_risk": 2,
        "interaction_fit": 3,
    },
    "preSpecAssessment": {
        "objectClass": {
            "primaryType": "small kitchen appliance (two-slot pop-up toaster)",
            "primaryDomain": "object",
            "formLanguage": ["chamfered-hard-surface", "stylized-low-poly", "faceted-octagonal-plan"],
            "structureKind": ["shell-on-plinth", "recessed-cavity", "surface-mounted-controls"],
            "motionPotential": ["lever-slide-vertical", "dial-rotate-yaw", "carriage-eject-impulse"],
            "materialFamilies": ["matte-plastic-cream", "matte-plastic-coral", "matte-plastic-yellow",
                                 "dark-cavity-interior"],
            "notes": "Hard-surface object. Every corner carries a flat 45 degree chamfer; this facet "
                     "language is the identity, not smooth fillets. The body tapers slightly inward "
                     "toward the top. Single three-quarter view: the rear face, the left face and the "
                     "underside are inferred by symmetry and carry reduced confidence.",
        },
        "complexity": {
            "tier": "moderate",
            "scores": {
                "silhouetteComplexity": 2,
                "componentCount": 2,
                "hierarchyDepth": 2,
                "repetitionDensity": 1,
                "materialLayerCount": 2,
                "localDetailDensity": 2,
                "occlusionRisk": 2,
                "actionReadinessNeed": 3,
            },
            "estimatedCounts": {
                "macroComponents": 2,
                "mesoComponents": 8,
                "microFeatureGroups": 3,
                "materialLayers": 4,
                "repetitionSystems": 2,
            },
            "reasoning": [
                "Eight distinct meso parts: bezel, slot pocket, cavity floor, divider, lever collar, "
                "lever knob, control pad, control dial.",
                "Two repetition systems: nine dial tick marks and six internal element tabs.",
                "Action readiness is high because this becomes a launching trap: the lever and the "
                "carriage must animate and toast is ejected upward from the slots.",
                "Occlusion risk is moderate: one view only, so the rear face, the left face and the "
                "underside are inferred from symmetry.",
            ],
        },
        "specDepthDecision": {
            "requiredDepth": "moderate",
            "minimumComponentLevels": ["macro", "meso", "micro"],
            "needsRepetitionSystems": True,
            "needsMaterialLocalOverrides": True,
            "needsMultipleReviewViews": True,
            "needsActionReadyHierarchy": True,
            "rationale": "Two repeated systems and four material zones are visible, and the object "
                         "must animate, so the spec needs micro components, repetition systems and "
                         "material local overrides rather than a macro-only tree.",
        },
        "unknownsToResolveBeforeImplementation": [],
        "resolvedUnknowns": [
            {
                "unknown": "Rear face detail is not visible.",
                "resolution": "Assumed plain, matching the front face. The plan outline is mirror "
                              "symmetric on both axes, so the rear face is the front face with no "
                              "controls. Recorded as an inference, not an observation.",
                "confidence": 0.6,
            },
            {
                "unknown": "Underside and foot geometry are not visible.",
                "resolution": "Four 0.20 by 0.20 by 0.06 pads at the plinth corner facets. Two feet "
                              "are visible as steps in the reference silhouette; the other two are "
                              "inferred by symmetry and carry confidence 0.45.",
                "confidence": 0.45,
            },
            {
                "unknown": "Cavity depth is not measurable from this view.",
                "resolution": "Set to 0.55 world units, about 45 percent of the shell height, which "
                              "is deep enough to swallow a slice at this scale. Marked as inference "
                              "on slot-cavity (confidence 0.6) and cavity-floor (confidence 0.4).",
                "confidence": 0.4,
            },
        ],
        "detailInventory": DETAIL_INVENTORY,
        "anatomy": {
            "applies": False,
            "styleHeads": 0.0,
            "proportions": {"headUnit": 0.0, "torso": 0.0, "legs": 0.0, "shoulderWidth": 0.0,
                            "hipWidth": 0.0},
            "pose": {"type": "not-applicable", "jointAngles": {}},
            "faceLandmarks": {"eyeLine": 0.0, "eyeSpacing": 0.0, "noseBase": 0.0, "mouthLine": 0.0,
                              "hairline": 0.0},
            "features": [],
            "confidence": 0.0,
            "note": "primaryDomain is object, so the character track does not apply.",
        },
        "sourceImage": SOURCE_IMAGE,
    },
    "qualityContract": QUALITY_CONTRACT,
    "qualityTargets": {
        "targetFidelity": 0.8,
        "mustMatch": [
            "chamfered octagonal facet language on shell, plinth, bezel, knob and dial",
            "macro silhouette and proportions",
            "four-layer albedo palette and matte roughness response",
            "control cluster layout on the right face",
            "recessed twin slots with divider and element tabs",
        ],
        "niceToHave": [
            "exact tick arc phase",
            "the pointer rib's L bend",
            "micro scuffing on the knob chamfers",
        ],
        "fpsTarget": 60,
        "reviewViewpoints": ["reference-three-quarter", "front", "right", "top-down", "rear-orbit"],
    },
    "selfCorrectLoop": {
        "enabled": True,
        "visualAcceptance": {
            "reviewer": "ai-vision",
            "threshold": 0.7,
            "comparisonArtifactRequired": True,
            "layerScoresRequired": True,
            "codePixelDiffIsAcceptanceAuthority": False,
            "scoringRule": "AI vision must inspect a side-by-side reference/render sheet and score "
                           "the current pass from 0 to 1. Pixel-diff code may assist diagnostics but "
                           "cannot approve a pass.",
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
                "selectionRule": "Score only identity-defining semantic systems: the chamfer facet "
                                 "language, the coral trim pairing, the control cluster, the massing "
                                 "and stance, the matte plastic response and the slot cavity read.",
            },
        },
        "reviewAfterPasses": [p["id"] for p in BUILD_PASSES],
        "allowedActions": ["continue", "refine-spec", "refine-code", "request-input", "stop"],
        "specRefineTriggers": [
            "missing component", "wrong primitive family", "wrong proportions",
            "material layer under-specified", "local feature not traceable to viewEvidence",
            "reference ambiguity discovered during implementation",
        ],
        "codeRefineTriggers": [
            "spec is adequate but generated geometry or material does not match",
            "browser render differs from reference",
            "performance budget exceeded",
            "lighting hides geometry or material response",
        ],
        "stopCriteria": [
            "target fidelity reached or the user accepts the current approximation",
            "remaining gaps require new reference views of the rear, left or underside",
        ],
        "screenshotPolicy": {
            "requiredForPasses": [p["id"] for p in BUILD_PASSES if p["id"] != "optimization-pass"],
            "preferredCapture": "playwright screenshot of the standalone preview harness",
            "fallbackCapture": "user-supplied-screenshot-path",
            "minimumEvidence": "Each visual pass needs a reference image, a rendered screenshot "
                               "framed to the reference bounding box, a side-by-side comparison "
                               "sheet, an AI vision score, layer scores and a critique before "
                               "choosing continue.",
            "reviewPairRule": "The review render always uses the solved reference camera; orbit views "
                              "are judged for self-consistency only, never against the reference angle.",
            "acceptanceAuthority": "AI vision review of the comparison sheet. Code-generated pixel "
                                   "similarity is not sufficient evidence.",
        },
    },
    "featureReviewTargets": FEATURE_REVIEW_TARGETS,
    "sculptPipeline": {
        "passGateMode": "locked-sequential",
        "passOrder": [p["id"] for p in BUILD_PASSES],
        "currentPass": "blockout",
        "completedPasses": [],
        "lastCompletedPass": "",
        "blockedReason": "blockout requires a browser screenshot and self-correction review before "
                         "structural-pass unlocks",
        "nextRequiredEvidence": [
            "blockout browser render screenshot from the preview harness",
            "map-stripped clay render for the Tier 1 blockout gate",
            "side-by-side reference/render comparison sheet",
            "AI vision score >= 0.7 with layer scores and mismatch critique",
            "critical semantic feature scores from the same image pair meeting their thresholds",
            "reviewHistory entry for blockout with action=continue",
        ],
    },
    "lookDevTargets": {
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
                "measuredConfidence": {"shell-cream": 0.842, "accent-coral": 0.848,
                                       "lever-yellow": 0.723, "cavity-gray": 0.826},
                "acceptedLimitation": PBR_NOTE,
            },
            "mustAvoid": [
                "single flat albedo per material",
                "uniform roughness",
                "albedo texture reused as roughness, height, normal or AO",
                "single-frequency random noise",
                "glossy toy-plastic highlights on a matte moulded surface",
                "local colour described only in prose without material masks",
                "claiming exact PBR recovery from one image",
            ],
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
            "Compare cavity darkening, seam occlusion and chamfer-crown polish.",
            "Compare key, fill and rim structure, exposure, tone mapping and background.",
            "Capture a neutral-light render to verify material readability without reference lighting.",
            "Capture a grazing-light close-up to expose flat normals and uniform roughness.",
            "Capture a reference-matched render from the solved camera.",
        ],
    },
    "actionReadiness": {
        "contract": "Every macro and meso component is a named Object3D pivot node with a mesh child, "
                    "action metadata, sockets where relevant, a collider proxy and destruction "
                    "metadata. The runtime reads root.userData.sculptRuntime.",
        "defaultRigType": "action-ready-prop-rig",
        "rootMotionNode": "body-shell",
        "requiredComponentFields": [
            "id", "parent", "transform", "seams for every contacting part",
            "actionProfile.animationRole", "actionProfile.pivot", "actionProfile.collider",
            "actionProfile.destruction",
        ],
        "transformChannels": ["translate", "rotate", "scale", "detach", "visibility", "material-state"],
        "authoringRules": [
            "Do not collapse independently movable parts into one mesh.",
            "Put transforms on component pivot groups, not on raw meshes.",
            "Animated parts keep their pivot node at the axis of motion so children ride along.",
            "Represent hinge, socket, detachable and breakable intent even when no animation is "
            "implemented yet.",
            "Use simplified collider proxies for runtime physics instead of visual mesh colliders.",
        ],
        "runtimeContract": {
            "leverPivot": f"sculptRuntime.nodes['lever-knob'] - translate on world Y between {-LEVER_TRAVEL:.2f} "
                          "(cocked) and 0.0 (popped).",
            "dialPivot": "sculptRuntime.nodes['control-dial'] - rotate about world X; nine detents "
                         "across 320 degrees.",
            "ejectSockets": ["slot-cavity:toast-eject-front", "slot-cavity:toast-eject-back",
                             "slot-cavity:toast-eject"],
            "ejectDirection": [0, 1, 0],
            "triggerVolume": "colliders['slot-cavity'] is a trigger box over the slot interior.",
        },
        "destructionPolicy": {
            "defaultBreakable": False,
            "fractureGroupNaming": "body-shell, base-plinth, top-bezel, lever-assembly, control-assembly",
            "debrisStrategy": "Detach the lever assembly and the control assembly as whole groups "
                              "rather than fracturing the shell.",
        },
    },
    "assumptions": [
        "The rear face and the left face are mirrors of the visible faces with no controls; the "
        "single reference view cannot confirm this.",
        "Four corner feet are modelled although only two are visible in the reference silhouette.",
        "Cavity depth of 0.55 world units is chosen for plausibility, not measured.",
        "The lever channel is built as a proud collar around a recessed floor plate rather than a "
        "boolean recess, because ExtrudeGeometry can only cut holes along the extrusion axis.",
        "The tick arc is authored as a full nine-tick ring; the plinth occludes the lowest three, "
        "which is what produces the reference's arc-with-a-gap read.",
        "One world unit is about 12 cm, making the modelled appliance about 19 cm wide.",
    ],
    "coordinateFrame": {
        "front": "+Z, the broad cream face nearest the camera-left in the reference",
        "up": "+Y, with the underside of the feet at y = 0",
        "right": "+X, the short end face carrying the lever and the dial",
        "scaleReference": "shell width = 1.60 world units; 548 reference pixels per world unit",
    },
    "silhouette": {
        "boundingShape": f"chamfered box on a wider chamfered slab, {PW} wide by "
                         f"{BEZEL_Y0 + BEZEL_H:.3f} tall by {PD} deep",
        "aspectRatios": [
            {"id": "width-to-height", "value": round(PW / (BEZEL_Y0 + BEZEL_H), 3),
             "notes": "plinth width over total height including the proud bezel"},
            {"id": "width-to-depth", "value": round(W / D, 3), "notes": "shell 1.60 over 1.35"},
            {"id": "shell-to-plinth-height", "value": round(SHELL_H / PLINTH_H, 3),
             "notes": "shell wall height over plinth slab height"},
        ],
        "symmetry": "mirror symmetric on the YZ plane and, apart from the right-face controls, on "
                    "the XY plane",
        "dominantCurves": ["none - the form is entirely flat facets meeting at hard creases"],
        "negativeSpaces": [
            "the twin slot opening framed by the coral bezel",
            "the lever channel cut into the right face",
            "the gap under the plinth between the corner feet",
        ],
        "landmarks": [
            f"top deck at y = {SHELL_TOP:.3f}",
            f"bezel crown at y = {BEZEL_Y0 + BEZEL_H:.3f}",
            f"plinth top at y = {PLINTH_Y0 + PLINTH_H:.3f}",
            f"lever knob centre at y = {LEVER_CENTER_Y:.3f} on the +X face",
            f"dial axis at y = {DIAL_Y:.3f}, z = {DIAL_Z} on the +X face",
        ],
    },
    "viewEvidence": VIEW_EVIDENCE,
    "componentTree": COMPONENTS,
    "materials": MATERIALS,
    "repetitionSystems": REPETITION_SYSTEMS,
    "buildPasses": BUILD_PASSES,
    "visualEvidence": [],
    "reviewHistory": [],
    "lodPlan": [
        {"tier": "near", "distance": 0,
         "strategy": "full component tree, both instanced clusters, 1024px procedural maps"},
        {"tier": "mid", "distance": 12,
         "strategy": "drop the element tabs and the pointer rib; keep the tick ring"},
        {"tier": "far", "distance": 30,
         "strategy": "shell, plinth, bezel and knob only; 256px maps"},
    ],
    "performanceBudget": {
        "qualityPriority": "reference-fidelity",
        "targetTriangles": 4000,
        "maxDrawCalls": 24,
        "textureSize": 1024,
        "fpsTarget": 60,
        "measured": {
            "triangles": 2304,
            "drawCallsWithShadowPass": 38,
            "namedParts": 19,
            "instancedClusters": 2,
            "sourceFileKb": 167,
            "sourceFileNote": "Was 230 KB. The generator wrote each component's JSON into "
                              "userData twice, once on the pivot node and again byte-identical "
                              "on its mesh, and wrote actionProfile separately although it "
                              "already sits inside that payload. Those 65072 bytes are now "
                              "reference assignments, so every field stays reachable at the "
                              "same path and the JSON parses once instead of twice.",
            "note": "Measured from renderer.info in the preview harness at 1254px. The draw-call "
                    "figure counts the shadow-map pass as well as the colour pass; the colour pass "
                    "alone is 21. Triangles fell from 77808 to 2304 once the flat-shaded boxes "
                    "dropped from 12x12x12 segments to 1x1x1.",
        },
        "optimizationPolicy": "Reach accepted visual fidelity first, then reduce box tessellation "
                              "and merge static cream parts, never removing a chamfer facet. The "
                              "four cream parts (shell, lever collar, control pad, channel floor) "
                              "could be merged for a further saving at the cost of per-part picking.",
    },
    "lightingFromPhoto": LIGHTING_FROM_PHOTO,
    "proceduralStrategy": [
        "Block out the chamfered shell mass and the proud plinth first.",
        "Add the bezel, the slot pocket and the control cluster as separate named parts.",
        "Create pivot groups, sockets, collider proxies and destruction metadata before visual polish.",
        "Refine form with extrude profileStops for the taper, the top chamfer band and the plinth "
        "double bevel.",
        "Run reference PBR extraction on per-material crops, record its confidence, and decide "
        "explicitly whether to bind or only cite the maps.",
        "Add material tone drift and cavity darkening before adding any micro geometry.",
    ],
    "animationAnchors": [
        "sculptRuntime.nodes['body-shell'] carries whole-object translation, rotation and scale",
        "sculptRuntime.nodes['lever-knob'] slides on world Y and carries the neck with it",
        "sculptRuntime.nodes['control-dial'] rotates about world X and carries the pointer rib",
        "sculptRuntime.sockets['slot-cavity:toast-eject-front'] and ':toast-eject-back' launch toast "
        "along world +Y",
    ],
    "destructionAnchors": [
        "lever-assembly detaches as knob plus neck",
        "control-assembly detaches as dial plus pointer rib",
        "top-bezel pops off the deck along its 0.02 unit seam",
    ],
    "risks": [
        "Single reference view: the rear face, the left face and the underside are inferred by "
        "symmetry and are not observed.",
        "Two documented refine-code edits to the generated factory are required and are not "
        "expressible through the generator as shipped: buildExtrudeGeometry must honour the "
        "profile2D fields axis, axisOffset, steps, profileStops and profileExempt, and the "
        "cavity-element-tabs instance loop must use placement.instances instead of the emitter's "
        "radial ring. Both consume data that already lives in this spec.",
        "Reference PBR maps were extracted and passed their confidence gate but are deliberately not "
        "bound to the runtime material; the runtime uses independent procedural canvas maps so the "
        "asset stays self-contained.",
        "Taper magnitude is the least certain measurement: perspective splay and true taper are not "
        "separable from one view, so 0.03 units per side is a mid estimate.",
    ],
    "localSpecSearch": {
        "collection": "core_3d",
        "query": "Apartment Toaster",
        "index": {"status": "rebuilt", "reason": "missing",
                  "fingerprint": "ac4f0bc9028e34083dbb5d5531ae3df7699c8e7641d5f8e6d42e7492ea1be1d0"},
        "matches": [],
    },
}


# The review ledger is history, not authored content: re-running this script must not
# erase which passes were reviewed, their evidence, or the recorded Tier-1 results.
CARRIED_FIELDS = ("reviewHistory", "visualEvidence", "tier1Results", "sculptPipeline")


def main() -> None:
    if OUT.exists():
        previous = json.loads(OUT.read_text(encoding="utf-8"))
        for field in CARRIED_FIELDS:
            if field in previous:
                SPEC[field] = previous[field]
        print(f"carried forward: {', '.join(f for f in CARRIED_FIELDS if f in previous)}")
    OUT.write_text(json.dumps(SPEC, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"components={len(COMPONENTS)} materials={len(MATERIALS)} "
          f"repetitionSystems={len(REPETITION_SYSTEMS)} details={len(DETAILS)}")


if __name__ == "__main__":
    main()
