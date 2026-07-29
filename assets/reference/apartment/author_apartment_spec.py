#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the apartment room reference.

Every component carries a topology classification, a colour recipe, an action
profile and evidence links, so the spec is generated here rather than hand-edited
as JSON. It starts from the pipeline's own seed (spec-seed.json, written by
forge/stage2_spec/new_sculpt_spec.py from assessment.json) so the local spec
search bundle and schema bookkeeping survive, then overlays the authored content.

Model frame (three.js convention, +X right, +Y up, +Z toward the reviewer):
  room interior x and z in [-2.00, 2.00], walking surface at y = 0.
  wall A ("left", carries the window) is the slab at x = -2.08.
  wall B ("back", carries the sofa) is the slab at z = -2.08.
  The reference camera sits on the +X +Z diagonal, which is what puts wall A on
  the left of frame and wall B on the right, matching the reference.

Scale: 193 px per model unit, from the left wall's 538 px screen run divided by
cos(45 deg). Every dimension below is measured; the derivation lives in
`measurementBasis` and in assessment.json's `preSpecAssessment.measurements`.

Run:  python author_apartment_spec.py
Writes: apartment-sculpt-spec.json (next to this file)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SOURCE_IMAGE = str(PROJECT / "assets" / "reference" / "apartment-reference.png")
SEED = HERE / "spec-seed.json"
ASSESSMENT = HERE / "assessment.json"
OUT = HERE / "apartment-sculpt-spec.json"
EVIDENCE = HERE / "evidence"
ZONES = EVIDENCE / "zones"
PBR_DIR = EVIDENCE / "pbr"

# ---------------------------------------------------------------------------
# Measured geometry, model units. 1 unit = 193 px in the reference.
# ---------------------------------------------------------------------------
ROOM = 4.00           # inside length of each wall
WALL_H = 3.10         # floor to wall crest
WALL_T = 0.16         # wall thickness (least certain dimension, confidence 0.6)
WALL_FILLET = 0.22    # round-over on the crest and both vertical ends
INNER = ROOM / 2      # inside faces at x = -2.00 and z = -2.00

SKIRT_H = 0.247       # 7.96 percent of wall height
SKIRT_PROUD = 0.09    # how far the rail stands off the plaster
SKIRT_FILLET = 0.045

# The tray overhangs the walls by a measured 0.15 units on the two open sides: the
# left wall's visible run is 538 px against the tray's near edge at 562 px, both at
# 45 degrees, which is 3.94 against 4.12 in world units. The tray is therefore only
# slightly larger than the room, not the 4.60 first authored, and on the two wall
# sides the wall's outer face stays a hair outside the rim, which is what the
# reference's silhouette shows: at mid height the leftmost pixel is cream wall, and
# only lower down does the navy rim become the outer edge.
SLAB = 4.30           # floor tray outside dimension
SLAB_T = 0.30
TRIM_BAND = 0.16      # navy rim width
TRIM_TOP = 0.09       # rim stands this far above the walking surface
TRIM_BOTTOM = -0.33
# The board plate is inset 0.02 inside the rim's outer face. Making the two
# coplanar left a tan sliver alternating with the navy along the whole near edge.
SLAB_PLATE = SLAB - 0.04

PLANK_FIELD = SLAB - 2 * TRIM_BAND    # plank surface inside the rim
PLANK_COUNT = 6
PLANK_W = PLANK_FIELD / PLANK_COUNT
SEAM_W = 0.035
SEAM_D = 0.022

WIN_W, WIN_H = 1.77, 1.46          # frame outside, along z and y
WIN_BAND = 0.20                    # frame band width
WIN_PROUD = 0.12                   # relief off the plaster
WIN_Y, WIN_Z = 1.78, 0.15          # centre on wall A
WIN_OPEN_W = WIN_W - 2 * WIN_BAND  # 1.37
WIN_OPEN_H = WIN_H - 2 * WIN_BAND  # 1.06
MUNTIN_T = 0.11

SOFA_X, SOFA_Z = 0.45, -1.33
SOFA_L, SOFA_D = 2.70, 1.25
SOFA_BACK_TOP = 1.55
SOFA_ARM_TOP = 1.05
SOFA_LEG_H = 0.20
SOFA_PLINTH_TOP = 0.62
SOFA_SEAT_TOP = 0.90
SOFA_ARM_W = 0.38
SOFA_BACK_T = 0.34
SOFA_RECLINE = -0.09   # radians, back cushions lean away from the seat

TABLE_X, TABLE_Z = -1.65, 0.15
TABLE_W, TABLE_D = 1.05, 0.62      # w along z, d along x
TABLE_BODY_H = 0.65
TABLE_LEG_H = 0.20
TABLE_BAND = 0.16                  # frame around the cubby

RUG_X, RUG_Z = 0.15, 0.55
RUG_L, RUG_W = 2.70, 1.83
RUG_BORDER = 0.16
RUG_RADIUS = 0.30

# ---------------------------------------------------------------------------
# Measured palette. Every value is a run-length scan median from the reference,
# cross-checked against the extract_pbr_evidence palette for the same region.
# ---------------------------------------------------------------------------
WALL_CREAM = "#f3e3ce"
WALL_SHADE = "#d8c8b1"
WALL_CREST = "#fcefdd"
NAVY = "#394254"
NAVY_SHADE = "#2c3343"
TAN = "#e7b174"
TAN_MID = "#dca468"
TAN_DARK = "#d39c62"
SEAM_SHADOW = "#583817"
SAGE = "#97b79a"
SAGE_LIT = "#9fc1a4"
SAGE_SHADE = "#77987a"
CORAL = "#f57a68"
GOLD = "#fac764"
CREAM_FURN = "#f3e5d2"
CREAM_LEG = "#edd8bf"
GLASS = "#98cfe5"

PBR_CONFIDENCE = {
    "wall-cream": 0.860,
    "trim-navy": 0.793,
    "floor-tan": 0.779,
    "sage-green": 0.703,
    "rug-coral": 0.709,
    "rug-gold": 0.775,
    "furniture-cream": 0.796,
    "glass-blue": 0.704,
}
# The runtime albedo map is built by mixing colorVariation.palette across a noise
# field, so the palette's MEAN is what the surface renders as. A palette running
# from the lit face down to the deepest cavity therefore renders about 5 percent
# under the authored albedo and paints the reference's own shading into the
# material, which is the thing this pipeline is supposed to avoid. So the runtime
# palette is a narrow band centred on the measured albedo, and the shaded and
# cavity readings stay where they describe rather than paint: in albedo.secondary
# and in the material's localOverrides.
def tone_family(hex_colour: str, spread: float = 0.05):
    """[one step up, the measured albedo, one step down], mean equal to the albedo."""
    value = hex_colour.lstrip("#")
    channels = [int(value[i:i + 2], 16) for i in (0, 2, 4)]
    def shift(factor):
        return "#" + "".join(f"{max(0, min(255, round(c * factor))):02x}" for c in channels)
    return [shift(1 + spread), hex_colour, shift(1 - spread)]


TONE_PALETTE = {
    "wall-cream": tone_family(WALL_CREAM),
    "trim-navy": tone_family(NAVY, 0.09),
    "floor-tan": tone_family(TAN, 0.06),
    "sage-green": tone_family(SAGE_LIT),
    "rug-coral": tone_family(CORAL, 0.04),
    "rug-gold": tone_family(GOLD, 0.04),
    "furniture-cream": tone_family(CREAM_FURN),
    "glass-blue": tone_family(GLASS, 0.03),
}

# Raw extract_pbr_evidence output, kept as provenance only. Three of these carry a
# few pixels from a neighbouring surface (#7D8D71 in the wall crop, #CC975D in the
# navy crop, #F17863 in the gold crop), which is exactly why they are not the
# runtime palette.
PBR_PALETTE = {
    "wall-cream": ["#D8C9B2", "#E7D8C1", "#7D8D71", "#ADB298", "#212830"],
    "trim-navy": ["#384153", "#3B4559", "#CC975D", "#474E5E", "#201F28"],
    "floor-tan": ["#DEA76A", "#CC965B", "#EDB97E", "#3E424E", "#F8C65F"],
    "sage-green": ["#9CBFA3", "#99BCA0", "#9EC1A5", "#94B498", "#879C80"],
    "rug-coral": ["#F27865", "#F47A67", "#F57B68", "#EE7561", "#F0B757"],
    "rug-gold": ["#FBC863", "#F17863", "#C98B36", "#E8B04F", "#FED66F"],
    "furniture-cream": ["#D1BFA7", "#EFDDC7", "#E2D2BC", "#D8C8B1", "#957F62"],
    "glass-blue": ["#98CFE5", "#98CADF", "#90B297", "#92C2D6", "#98D1E7"],
}

PBR_NOTE = (
    "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT "
    "bound to the runtime material. Every surface in this reference is flat paint with no "
    "pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; "
    "tiling them would paint the reference's own key light onto every wall of every repeated "
    "module. The runtime uses solid albedo plus procedural roughness/normal variation, which is "
    "the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit "
    "reference are evidence for the albedo and roughness scalars, nothing more. Two crops had "
    "to be recut before they passed: the first sage crop straddled the arm's round-over "
    "(confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank "
    "pixels, which showed up as a contaminated dominant palette entry rather than as a low score."
)


# The nine zones build_detail_inventory.py cut, as normalized (x, y, w, h) regions
# of the reference. evidenceRefs elsewhere in this spec are these ids; the path and
# the region live on the viewEvidence entry.
ZONE_REGIONS = {
    "wall-left": (0.121, 0.055, 0.383, 0.645),
    "wall-back": (0.494, 0.055, 0.393, 0.645),
    "window": (0.195, 0.170, 0.190, 0.290),
    "skirting": (0.121, 0.500, 0.766, 0.210),
    "side-table": (0.195, 0.495, 0.190, 0.200),
    "sofa": (0.435, 0.340, 0.390, 0.400),
    "floor-planks": (0.200, 0.560, 0.670, 0.400),
    "rug": (0.300, 0.590, 0.410, 0.280),
    "base-trim": (0.115, 0.630, 0.780, 0.345),
}


def zone(name: str) -> str:
    return name


def zone_path(name: str) -> str:
    return str(ZONES / f"{name}.png")


# ---------------------------------------------------------------------------
# Repeated-part placements, local to each cluster's parent node.
#
# Every cluster is authored as one named component plus an InstancedMesh holding
# the rest. The named component takes instance zero rather than sitting at the
# group centre: a seam template parked at the floor's centre would z-fight the
# middle seam, and a leg template parked at the sofa's centre would put a fifth
# leg under the middle cushion. The part-coverage gate still sees every specified
# component as a real named mesh.
# ---------------------------------------------------------------------------
def leg_instances(half_x: float, half_z: float, y: float):
    return [[round(sx * half_x, 5), round(y, 5), round(sz * half_z, 5)]
            for sx in (-1, 1) for sz in (-1, 1)]


def plank_seam_instances():
    return [[round(-PLANK_FIELD / 2 + PLANK_W * (index + 1), 5), 0.0, 0.0]
            for index in range(PLANK_COUNT - 1)]


def plank_butt_instances():
    """Two cuts per board, staggered by a fixed seeded sequence so the pattern is
    stable between sessions and no two adjacent boards break on the same line."""
    stagger = [0.00, 0.62, 1.24, 0.31, 0.93, 1.55]
    out = []
    for board in range(PLANK_COUNT):
        x = -PLANK_FIELD / 2 + PLANK_W * (board + 0.5)
        for step in (0, 1):
            z = -PLANK_FIELD / 2 + 1.35 + stagger[board] + step * 1.72
            if -PLANK_FIELD / 2 + 0.2 < z < PLANK_FIELD / 2 - 0.2:
                out.append([round(x, 5), 0.0, round(z, 5)])
    return out


SOFA_LEGS = leg_instances(SOFA_L / 2 - 0.27, SOFA_D / 2 - 0.18,
                          -(SOFA_PLINTH_TOP + SOFA_LEG_H) / 2 + SOFA_LEG_H / 2)
TABLE_LEGS = leg_instances(TABLE_D / 2 - 0.11, TABLE_W / 2 - 0.15,
                           -TABLE_BODY_H / 2 - TABLE_LEG_H / 2)
PLANK_SEAMS = plank_seam_instances()
PLANK_BUTTS = plank_butt_instances()
# The floor grooves are cut into the tray's top surface, which sits at half the
# slab thickness above the slab's own centre.
GROOVE_Y = SLAB_T / 2 - SEAM_D / 2 + 0.002
for _placement in PLANK_SEAMS + PLANK_BUTTS:
    _placement[1] = round(GROOVE_Y, 5)


# ---------------------------------------------------------------------------
# profile helpers
# ---------------------------------------------------------------------------
def rounded_rect(width: float, height: float, radius: float, segments: int = 5):
    """Closed CCW point loop for a rounded rectangle centred on the origin."""
    radius = max(0.0, min(radius, min(width, height) / 2 - 1e-4))
    hw, hh = width / 2, height / 2
    if radius <= 1e-4:
        return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    corners = [
        (hw - radius, hh - radius, 0.0),
        (-(hw - radius), hh - radius, math.pi / 2),
        (-(hw - radius), -(hh - radius), math.pi),
        (hw - radius, -(hh - radius), 3 * math.pi / 2),
    ]
    points: list[list[float]] = []
    for cx, cy, start in corners:
        for step in range(segments + 1):
            angle = start + (math.pi / 2) * step / segments
            points.append([round(cx + math.cos(angle) * radius, 5),
                           round(cy + math.sin(angle) * radius, 5)])
    return points


def filleted_box(width: float, height: float, depth: float, fillet: float,
                 corner: float | None = None, axis: str = "z", hole=None):
    """profile2D payload for a box whose twelve edges are all filleted.

    `width`, `height` and `depth` are always WORLD X, Y and Z, whatever the
    extrusion axis, so a call site reads the same as the component's `dimensions`
    block. ExtrudeGeometry only ever works in its own XY plane and pushes along
    +Z, so the profile plane is derived from the axis here rather than at the call
    site: getting that mapping backwards is what made the first floor slab 4.60
    units tall and 0.30 deep instead of the reverse.

    ExtrudeGeometry also grows the shape outward by `bevelSize` and lengthens the
    extrusion by `bevelThickness` at each end, so the authored profile is inset by
    the fillet radius and the run is shortened by twice it. That makes the finished
    solid exactly width x height x depth, which is what every dimension in this
    spec was measured as.
    """
    fillet = max(0.0, min(fillet, min(width, height, depth) / 2 - 1e-3))
    # (profile X, profile Y, extrusion run) for each axis the refinement supports.
    plane_x, plane_y, run = {
        "z": (width, height, depth),
        "x": (depth, height, width),
        "y": (width, depth, height),
    }[axis]
    corner = plane_x / 2 if corner is None else corner
    profile = {
        "points": rounded_rect(plane_x - 2 * fillet, plane_y - 2 * fillet,
                               max(0.0, corner - fillet)),
        "depth": round(run - 2 * fillet, 5),
        "axis": axis,
        "center": True,
        "bevel": {"size": round(fillet, 5), "thickness": round(fillet, 5), "segments": 3},
    }
    if hole:
        profile["holes"] = [hole]
    return profile


def ring_profile(outer_w: float, outer_h: float, band: float, depth: float,
                 fillet: float, outer_radius: float, axis: str = "z"):
    """A rounded-rectangle ring: window frame, table cubby surround, floor rim.

    Unlike filleted_box, `outer_w` and `outer_h` are the ring's own plane, because
    a ring is naturally read in the plane it opens onto. The plane maps to world
    axes the same way: z extrudes X-Y, x extrudes Z-Y, y extrudes X-Z.
    """
    inner_w, inner_h = outer_w - 2 * band, outer_h - 2 * band
    return {
        "points": rounded_rect(outer_w - 2 * fillet, outer_h - 2 * fillet,
                               max(0.0, outer_radius - fillet)),
        "holes": [rounded_rect(inner_w + 2 * fillet, inner_h + 2 * fillet,
                               max(0.0, outer_radius - band - fillet))],
        "depth": round(depth - 2 * fillet, 5),
        "axis": axis,
        "center": True,
        "bevel": {"size": round(fillet, 5), "thickness": round(fillet, 5), "segments": 3},
    }


# ---------------------------------------------------------------------------
# material helpers
# ---------------------------------------------------------------------------
def pbr_provenance(material_id: str) -> dict:
    channels = ("albedo", "roughness", "height", "normal", "ao")
    return {
        "version": "1.0",
        "sourceImage": str(EVIDENCE / "crops" / f"{material_id}-crop.png"),
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry",
        "usable": False,
        "verdict": "pass",
        "confidence": PBR_CONFIDENCE[material_id],
        "estimatedFidelity": PBR_CONFIDENCE[material_id],
        "targetThreshold": 0.7,
        "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; "
                     "maps are reference-derived estimates.",
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


def material(mid, name, base, palette, rough_base, rough_var, ao_cavity, shader,
             overrides, notes, metalness=0.0, clearcoat=0.0, bump=0.006,
             normal_pattern="fine-plaster-tooth", texture=256):
    palette = TONE_PALETTE[mid]
    return {
        "id": mid,
        "name": name,
        "type": "physical",
        "shaderModel": shader,
        "baseColor": base,
        "color": base,
        "albedo": {
            "dominant": base,
            "secondary": palette[1:],
            "samplingNotes": (
                "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/"
                "850/900/980 and columns x=250/700/900/1150, then cross-checked against the "
                "extract_pbr_evidence palette for the same crop. Where a surface appears both lit "
                "and shaded the lit face is the authored albedo and the shaded value is carried as "
                "a secondary so the review can check that the render reproduces the falloff "
                "instead of painting it in."
            ),
            "map": None,
        },
        "colorVariation": {
            "palette": palette,
            "pattern": "flat-fill-with-per-instance-tone",
            "amplitude": 0.035,
            "heightCorrelation": 0.0,
        },
        "textureResolution": texture,
        "textureProjection": {
            "mode": "triplanar",
            "repeat": [1.0, 1.0],
            "anisotropy": 4,
            "texelDensityIntent": "one texel per 3 mm of model surface at review distance",
        },
        # Frequency is cycles per model unit, amplitude is the fraction of the
        # roughness range the band moves. The macro band is deliberately the
        # weakest: form in this reference comes from geometry fillets, and a loud
        # macro material band would compete with them.
        "surfaceFrequencyBands": [
            {"id": f"{mid}-macro", "frequency": 1.6, "amplitude": round(rough_var * 0.9, 4),
             "role": "broad tone drift so a four-unit wall face is not uniformly lit"},
            {"id": f"{mid}-meso", "frequency": 9.0, "amplitude": round(rough_var * 0.55, 4),
             "role": "panel-scale roughness variation, the band the review actually reads"},
            {"id": f"{mid}-micro", "frequency": 48.0, "amplitude": round(rough_var * 0.3, 4),
             "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"},
        ],
        "roughness": {
            "base": rough_base,
            "variation": rough_var,
            "map": "procedural-noise",
            "localResponse": "cavity and contact zones darken and roughen; crests stay smoother",
        },
        "metalness": {"base": metalness, "variation": 0.0},
        "clearcoat": {"base": clearcoat},
        "normal": {"pattern": normal_pattern, "strength": 0.35, "scale": 2.4, "space": "tangent"},
        "bump": {"pattern": normal_pattern, "amplitude": bump, "scale": 2.4},
        "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0,
                         "silhouetteAffects": False},
        "ambientOcclusion": {"cavityStrength": ao_cavity, "contactShadowBias": 0.012,
                             "notes": "Cavity term drives the corner crease, the cubby interior "
                                      "and the gap under every peg leg."},
        "wear": {"edgeWear": 0.0, "scratches": [], "chips": []},
        "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"},
        "localOverrides": overrides,
        "referencePbr": pbr_provenance(mid),
        "notes": notes,
    }


def override(oid, description, mask, response, evidence):
    return {"id": oid, "description": description, "mask": mask,
            "response": response, "evidenceRefs": evidence}


MATERIALS = [
    material(
        "wall-cream", "Wall plaster, matte cream", WALL_CREAM, TONE_PALETTE["wall-cream"],
        0.94, 0.05, 0.55, "MeshStandardMaterial (matte interior plaster)",
        [
            override("crest-highlight",
                     "The round-over along the wall crest reads #fcefdd against the #f3e3ce flat "
                     "face, a 4 percent lift that comes from curvature meeting the key, so it is "
                     "left to the geometry and the material only drops roughness slightly on the "
                     "roll.",
                     "curvature > 0.6 on the top and end fillets",
                     "roughness 0.94 -> 0.88", [zone("wall-back")]),
            override("corner-crease",
                     "The inside corner is the darkest cream in the reference (#c6bca3, 19 percent "
                     "below the lit face). It is contact occlusion between two planes, not a "
                     "painted line.",
                     "within 0.12 units of the wall A / wall B intersection",
                     "ambient occlusion 0.55 -> 0.85", [zone("wall-back"), zone("skirting")]),
            override("skirting-contact-shadow",
                     "A narrow band of the plaster just above the skirting sits about 8 percent "
                     "darker than the wall mid-height, from the rail's own occlusion.",
                     "0 to 0.10 units above the skirting crest",
                     "ambient occlusion 0.55 -> 0.72", [zone("skirting")]),
        ],
        "Two wall slabs, one material. The reference shows the same paint at #f3e3ce on the "
        "key-facing left wall and #d8c8b1 on the back wall, an 11 percent difference that is "
        "lighting, not albedo. Authoring both at the lit value and letting the rig produce the "
        "falloff is a falsifiable claim, and the material-pass review checks it."),
    material(
        "trim-navy", "Skirting and floor rim, matte navy", NAVY, TONE_PALETTE["trim-navy"],
        0.9, 0.06, 0.6, "MeshStandardMaterial (matte painted trim)",
        [
            override("rim-crest-roll",
                     "The rim's top round-over lifts to #3d475a where it faces the key and drops "
                     "to #2c3343 on the shadow side, the widest relative value swing of any "
                     "material in the reference.",
                     "curvature > 0.5 on the rim crest",
                     "roughness 0.90 -> 0.84", [zone("base-trim")]),
            override("inside-corner-black",
                     "Where the two skirting rails meet, the crease reads #11141a, far below "
                     "either rail's own value; that is occlusion between two dark surfaces and "
                     "must not be baked into the albedo.",
                     "within 0.08 units of the skirting corner",
                     "ambient occlusion 0.60 -> 0.95", [zone("skirting")]),
        ],
        "The single darkest element in the room and the one that gives every edge its read. "
        "In the game this material is what keeps a silhouette legible against the sky."),
    material(
        "floor-tan", "Board floor, matte warm tan", TAN, TONE_PALETTE["floor-tan"],
        0.88, 0.09, 0.5, "MeshStandardMaterial (matte finished board)",
        [
            override("per-board-tone",
                     "Adjacent boards differ by roughly one stop with no hue shift: #e7b174, "
                     "#dca468 and #d39c62 all measured on lit board faces in the same scan row.",
                     "per plank instance",
                     "albedo multiplied by a seeded 0.92 to 1.0 per-instance factor",
                     [zone("floor-planks")]),
            override("seam-shadow",
                     "Recessed seams read #583817 where shadowed, five stops under the board "
                     "face. The groove is geometry; the material only deepens the cavity term.",
                     "inside the seam grooves",
                     "ambient occlusion 0.50 -> 0.92", [zone("floor-planks")]),
        ],
        "Boards, not a tiled texture. The seams and butt joints are instanced geometry so they "
        "survive relighting and read correctly at a grazing angle."),
    material(
        "sage-green", "Upholstery and window joinery, matte sage", SAGE,
        TONE_PALETTE["sage-green"], 0.92, 0.07, 0.62,
        "MeshStandardMaterial (matte upholstery / painted joinery)",
        [
            override("cushion-crease",
                     "Every cushion gap darkens to about #77987a, 20 percent under the lit "
                     "#9fc1a4 face, and the gap is real air, so the darkening is contact "
                     "occlusion between two solids.",
                     "within 0.05 units of a cushion seam",
                     "ambient occlusion 0.62 -> 0.88", [zone("sofa")]),
            override("window-reveal-shade",
                     "The window's inner reveal sits at #67927c against the #97ba9d frame face, "
                     "which is the setback catching no key at all.",
                     "the reveal box behind the frame band",
                     "ambient occlusion 0.62 -> 0.90", [zone("window")]),
        ],
        "The sofa upholstery and the window frame measure the same green within 2 of 255 "
        "(#97b79a and #95b69a), so the reference uses one paint on both and this spec does too. "
        "Splitting them would invent a distinction the image does not contain."),
    material(
        "rug-coral", "Rug field, matte coral textile", CORAL, TONE_PALETTE["rug-coral"],
        0.96, 0.04, 0.45, "MeshStandardMaterial (matte flat-weave textile)",
        [
            override("border-contact",
                     "The field sits a hair below the gold border, so a thin occlusion line runs "
                     "the whole inner edge of the border.",
                     "within 0.04 units of the border's inner edge",
                     "ambient occlusion 0.45 -> 0.75", [zone("rug")]),
        ],
        "The flattest material in the reference: the coral field shows under 4 percent value "
        "variation across its whole area, so any roughness pattern here must stay subtle."),
    material(
        "rug-gold", "Rug border, matte gold textile", GOLD, TONE_PALETTE["rug-gold"],
        0.95, 0.05, 0.45, "MeshStandardMaterial (matte flat-weave textile)",
        [
            override("border-crest",
                     "The border's outer round-over catches the key and lifts to #ffda6e at the "
                     "crest, which is the only place the rug shows a highlight at all.",
                     "curvature > 0.5 on the border's outer edge",
                     "roughness 0.95 -> 0.90", [zone("rug")]),
        ],
        "A band 0.16 units wide around the coral field. Its width is what makes the rug read as "
        "two concentric rounded rectangles rather than as a coral plate with a painted edge."),
    material(
        "furniture-cream", "Case goods and peg legs, matte warm cream", CREAM_FURN,
        TONE_PALETTE["furniture-cream"], 0.9, 0.06, 0.58,
        "MeshStandardMaterial (matte moulded case goods)",
        [
            override("cubby-interior",
                     "The table cavity reads #c9b69c against the #f3e5d2 face, 18 percent down "
                     "with no hue shift, so the interior is the same cream seen only by "
                     "occlusion.",
                     "inside the cubby recess",
                     "ambient occlusion 0.58 -> 0.90", [zone("side-table")]),
            override("leg-tone",
                     "Peg legs measure #edd8bf, marginally warmer and darker than the table body, "
                     "and the same value appears on the sofa legs, which is what ties the two "
                     "pieces of furniture together.",
                     "peg leg instances",
                     "albedo #f3e5d2 -> #edd8bf", [zone("side-table"), zone("sofa")]),
        ],
        "One cream for the side table and for every peg leg in the room, including the sofa's. "
        "The legs never take the item's own colour, and that is what makes the furniture read as "
        "lifted off the floor rather than growing out of it."),
    material(
        "glass-blue", "Window glazing, flat pale blue", GLASS, TONE_PALETTE["glass-blue"],
        0.34, 0.03, 0.3, "MeshStandardMaterial (opaque stylised glazing)",
        [
            override("pane-uniformity",
                     "All four panes measure #98cfe5 within 3 of 255 and show no reflected room "
                     "content and no gradient. The glazing is a flat sky fill.",
                     "the whole glazing plate",
                     "no environment map, no transmission", [zone("window")]),
        ],
        "Deliberately not a transmissive material. Transmission or an environment map would put "
        "reflections on a surface the reference renders as flat colour, which would read as a "
        "different object.", clearcoat=0.12, bump=0.0, normal_pattern="none", texture=128),
]


# ---------------------------------------------------------------------------
# component helpers
# ---------------------------------------------------------------------------
# Controlled vocabulary from grimoire/intake/surface_topology.md. Anything that
# changes a surface without changing the silhouette-defining form is relief: the
# skirting rails, the window frame and its bars, the rug plates and the floor
# grooves all ride a host surface. Everything else here is a discrete rigid part
# with simply-curved faces, which is `assembled-solid`. Nothing in this reference
# is a continuous organic mass, a strand, or a decal.
TOPOLOGY_CLASS = {
    "skirting-a": "surface-relief",
    "skirting-b": "surface-relief",
    "window-frame": "surface-relief",
    "window-muntin-vertical": "surface-relief",
    "window-muntin-horizontal": "surface-relief",
    "rug-border": "surface-relief",
    "rug-field": "surface-relief",
    "plank-seam-cluster": "surface-relief",
    "plank-butt-cluster": "surface-relief",
}


# The spec's own material names are descriptive; colorMaterialRecipe.materialClass
# takes the pipeline's controlled family instead. Plaster and moulded case goods
# both answer to `ceramic` and `plastic` respectively in that vocabulary.
MATERIAL_CLASS = {
    "plaster": "ceramic",
    "painted-trim": "ceramic",
    "painted-joinery": "ceramic",
    "wood": "wood",
    "upholstery": "fabric",
    "textile": "fabric",
    "moulded-case": "plastic",
    "glazing": "glass",
}


def rgba(hex_colour: str) -> str:
    value = hex_colour.lstrip("#")
    r, g, b = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, 1.0)"


def recipe(dominant, secondary, klass, confidence=0.88):
    return {"dominantAlbedo": rgba(dominant), "secondaryAlbedo": rgba(secondary),
            "materialClass": MATERIAL_CLASS[klass], "materialClassConfidence": confidence}


def action(role, pivot_mode="center", pivot_pos=(0, 0, 0), axis=(0, 1, 0), confidence=0.85,
           channels=None, sockets=None, collider=None, fracture="room-shell", breakable=False):
    base_channels = {"translate": False, "rotate": False, "scale": False, "bend": False,
                     "twist": False, "detach": False, "visibility": True, "materialState": True}
    base_channels.update(channels or {})
    return {
        "animationRole": role,
        "pivot": {"mode": pivot_mode, "localPosition": [round(float(v), 5) for v in pivot_pos],
                  "axis": [float(v) for v in axis], "confidence": confidence},
        "transformChannels": base_channels,
        "sockets": sockets or [],
        "collider": collider or {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                                 "isTrigger": False, "notes": "Box proxy sized to the part bounds."},
        "constraints": [],
        "destruction": {"breakable": breakable, "fractureGroup": fracture, "seamRefs": [],
                        "detachableFragments": [], "breakImpulse": 0.0,
                        "debrisMaterial": "wall-cream"},
    }


def xform(position=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    item = {"position": [round(float(v), 5) for v in position],
            "rotation": [round(float(v), 6) for v in rotation]}
    if scale is not None:
        item["scale"] = [round(float(v), 5) for v in scale]
    return item


def dims(w, h, d, confidence=0.8):
    return {"width": round(w, 4), "height": round(h, 4), "depth": round(d, 4),
            "units": "world", "confidence": confidence}


def surface(macro, micro, bump, normal_pattern, occlusion, notes):
    return {"macroRoughness": macro, "microRoughness": micro, "bumpAmplitude": bump,
            "normalPattern": normal_pattern, "displacementPattern": "none",
            "occlusionPattern": occlusion, "edgeWearPattern": "none", "notes": notes}


def feature(fid, description, geometry, evidence, confidence=0.85):
    return {"id": fid, "description": description, "geometry": geometry,
            "evidenceRefs": evidence, "confidence": confidence}


def descriptor(topology_intent, edge_type, bevel_radius, deformations, profile=None,
               uv="triplanar-world", normals="smooth-with-30-degree-crease"):
    item = {
        "topologyIntent": topology_intent,
        "edgeTreatment": {"type": edge_type, "bevelRadius": bevel_radius, "segments": 3},
        "deformationStack": deformations,
        "uvStrategy": uv,
        "normalStrategy": normals,
    }
    if profile is not None:
        item["profile2D"] = profile
    return item


def component(cid, name, level, role, primitive, material_id, topology, rationale, colours,
              desc, transform, dimensions, action_profile, local_features, surf, evidence,
              importance=0.6, confidence=0.85, parent=None, attachment=None,
              seams=None, fidelity="form-refinement"):
    return {
        "id": cid, "name": name, "level": level, "role": role,
        "importance": importance, "confidence": confidence,
        "primitive": primitive,
        "topologyClass": TOPOLOGY_CLASS.get(cid, "assembled-solid"),
        "topologyRationale": f"{topology}. {rationale}",
        "colorMaterialRecipe": recipe(*colours),
        "geometryDescriptor": desc,
        "parent": parent, "attachment": attachment,
        "dimensions": dimensions, "transform": transform,
        "actionProfile": action_profile,
        "material": material_id, "materialLayers": [material_id],
        "deformations": [], "joints": [], "seams": seams or [],
        "localFeatures": local_features, "surfaceDetail": surf,
        "evidenceRefs": evidence, "details": [], "fidelityTier": fidelity,
    }


def attach(parent_socket, start, end, contact, embed, gap, notes):
    return {"parentSocket": parent_socket,
            "localStart": [round(float(v), 5) for v in start],
            "localEnd": [round(float(v), 5) for v in end],
            "contactType": contact, "embedDepth": embed, "overlap": embed,
            "gapTolerance": gap, "notes": notes}


PLASTER_SURFACE = surface(0.94, 0.05, 0.006, "fine-plaster-tooth", "crease-and-contact",
                          "Broad matte plane. Any visible highlight has to come from the "
                          "fillets, not from a specular lobe.")
TRIM_SURFACE = surface(0.90, 0.06, 0.005, "painted-trim-tooth", "crease-and-contact",
                       "Painted trim: slightly smoother than the plaster so the crest roll "
                       "reads, never glossy.")
BOARD_SURFACE = surface(0.88, 0.09, 0.008, "board-grain-drift", "seam-cavity",
                        "Grain drift runs along the board direction only; a cross-grained "
                        "pattern would fight the seam geometry.")
UPHOLSTERY_SURFACE = surface(0.92, 0.07, 0.009, "woven-tooth", "seam-cavity",
                             "Woven tooth at a scale that disappears at play distance but "
                             "keeps the cushion from reading as moulded plastic up close.")
TEXTILE_SURFACE = surface(0.96, 0.04, 0.006, "flat-weave", "edge-contact",
                          "Flattest surface in the room; under 4 percent measured value "
                          "variation across the field.")
CASE_SURFACE = surface(0.90, 0.06, 0.006, "moulded-tooth", "cavity",
                       "Moulded case goods: uniform tooth, cavity term does the cubby.")
GLASS_SURFACE = surface(0.34, 0.03, 0.0, "none", "none",
                        "No relief at all. The reference glazing shows a single flat value.")

# ---------------------------------------------------------------------------
# componentTree. Parents are emitted before children because the generator
# resolves `parent` against the nodes built so far.
# ---------------------------------------------------------------------------
COMPONENTS = [
    component(
        "wall-a", "Wall A left with window", "macro", "shell-plane", "extrude", "wall-cream",
        "assembled-solid",
        "Two parallel faces joined by a continuous filleted rim. It is a slab, not a plane: the "
        "reference shows the wall's own thickness as a lit band along the crest, so a "
        "zero-thickness card cannot reproduce it.",
        (WALL_CREAM, WALL_SHADE, "plaster"),
        descriptor("filleted slab, all twelve edges rolled", "fillet", WALL_FILLET,
                   ["none"],
                   filleted_box(WALL_T, WALL_H, ROOM + WALL_T, WALL_FILLET,
                                corner=WALL_FILLET, axis="x")),
        xform(position=(-(INNER + WALL_T / 2), WALL_H / 2, -WALL_T / 2)),
        dims(WALL_T, WALL_H, ROOM + WALL_T, 0.6),
        action("static-shell", collider={"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1],
                                         "isTrigger": False,
                                         "notes": "Full slab; the game gives the wall no collider "
                                                  "because the play corridor never reaches it."},
               sockets=[{"id": "window-mount", "localPosition": [WALL_T / 2, WIN_Y - WALL_H / 2,
                                                                WIN_Z + WALL_T / 2],
                         "localRotation": [0, 0, 0],
                         "notes": "Inside face of wall A, where the window relief mounts."},
                        {"id": "module-join-near", "localPosition": [0, -WALL_H / 2,
                                                                    (ROOM + WALL_T) / 2],
                         "localRotation": [0, 0, 0],
                         "notes": "Flush end used when the module tiles along the course."}]),
        [feature("wall-slab-roundover",
                 "Continuous round-over of radius 0.22 on the crest and both vertical ends, "
                 "measured against a 3.10 unit wall height. The crest highlight (#fcefdd) is a "
                 "curvature read, so a hard edge here loses the reference's whole soft-toy look.",
                 "ExtrudeGeometry bevel with size and thickness both 0.22 and three segments.",
                 [zone("wall-left"), zone("wall-back")], 0.9),
         feature("corner-butt-joint",
                 "Wall A runs the full room depth plus one wall thickness so it butts into wall "
                 "B's inner face, giving one continuous vertical crease instead of a mitre.",
                 "Length ROOM + WALL_T, offset back by half a thickness.",
                 [zone("wall-back")], 0.72)],
        PLASTER_SURFACE, [zone("wall-left"), zone("wall-back")], importance=0.95, confidence=0.85),
    component(
        "wall-b", "Wall B back with sofa", "macro", "shell-plane", "extrude", "wall-cream",
        "assembled-solid",
        "Same slab topology as wall A. Kept as a separate component rather than mirrored in code "
        "because the two carry different furnishings and the game tiles them independently.",
        (WALL_SHADE, WALL_CREAM, "plaster"),
        descriptor("filleted slab, all twelve edges rolled", "fillet", WALL_FILLET,
                   ["none"],
                   filleted_box(ROOM + WALL_T, WALL_H, WALL_T, WALL_FILLET,
                                corner=WALL_FILLET, axis="z")),
        xform(position=(-WALL_T / 2, WALL_H / 2, -(INNER + WALL_T / 2))),
        dims(ROOM + WALL_T, WALL_H, WALL_T, 0.6),
        action("static-shell",
               sockets=[{"id": "sofa-mount", "localPosition": [SOFA_X, -WALL_H / 2,
                                                               WALL_T / 2 + SOFA_D / 2 + 0.05],
                         "localRotation": [0, 0, 0],
                         "notes": "Where the sofa's back plane sits against the wall."}]),
        [feature("corner-fillet-interpenetration",
                 "Wall B runs one wall thickness past the corner so the two slabs overlap in a "
                 "0.16 by 0.16 block. Butting them left a dark notch where the two crest fillets "
                 "met without merging, which the reference does not have.",
                 "Length ROOM + WALL_T, centre offset by half a thickness along X.",
                 [zone("wall-back")], 0.8),
         feature("wall-slab-roundover-b",
                 "The same 0.22 round-over as wall A. Because wall B faces away from the key it "
                 "is where the reference's cream reads darkest (#d8c8b1), and the crest roll is "
                 "the only thing separating it from the background.",
                 "ExtrudeGeometry bevel, size and thickness 0.22.",
                 [zone("wall-back")], 0.9)],
        PLASTER_SURFACE, [zone("wall-back")], importance=0.92, confidence=0.85),
    component(
        "floor-slab", "Floor tray board field", "macro", "shell-plate", "extrude", "floor-tan",
        "assembled-solid",
        "A plate with real thickness, filleted on its bottom edges. The reference shows the slab "
        "edge below the navy rim, so the floor is a tray and not a texture on the ground plane.",
        (TAN, TAN_DARK, "wood"),
        descriptor("filleted plate", "fillet", 0.06, ["none"],
                   filleted_box(SLAB_PLATE, SLAB_T, SLAB_PLATE, 0.06, corner=0.06, axis="y")),
        xform(position=(0, -SLAB_T / 2, 0)),
        dims(SLAB_PLATE, SLAB_T, SLAB_PLATE, 0.75),
        action("static-shell", fracture="floor-tray"),
        [feature("plank-run-direction",
                 "Boards run parallel to wall A. Read from the seam slope alone, which is the "
                 "weakest inference in the model: if it is wrong the boards run across the room "
                 "instead of along it.",
                 "Seam instances aligned to the z axis.",
                 [zone("floor-planks")], 0.66)],
        BOARD_SURFACE, [zone("floor-planks")], importance=0.85, confidence=0.75),
    component(
        "base-trim", "Navy floor rim", "macro", "edge-rail", "extrude", "trim-navy",
        "assembled-solid",
        "A ring, not four rails. The reference shows the rim turning every corner without a "
        "visible joint, which a mitred set of four boxes cannot do at this fillet radius.",
        (NAVY, NAVY_SHADE, "painted-trim"),
        descriptor("filleted rounded-rectangle ring", "fillet", 0.055, ["none"],
                   ring_profile(SLAB, SLAB, TRIM_BAND, TRIM_TOP - TRIM_BOTTOM, 0.055, 0.10,
                                axis="y")),
        xform(position=(0, (TRIM_TOP + TRIM_BOTTOM) / 2, 0)),
        dims(SLAB, TRIM_TOP - TRIM_BOTTOM, SLAB, 0.7),
        action("static-shell", fracture="floor-tray"),
        [feature("floor-tray-rim",
                 "The rim stands 0.09 units above the board surface and drops 0.03 below the slab, "
                 "so the floor reads as a tray. Against the game's sky this is the highest-contrast "
                 "edge in the whole model.",
                 "Rounded-rectangle ring extruded 0.42 along y.",
                 [zone("base-trim"), zone("floor-planks")], 0.85)],
        TRIM_SURFACE, [zone("base-trim")], importance=0.8, confidence=0.8),
    component(
        "sofa-plinth", "Sofa base block", "macro", "body", "extrude", "sage-green",
        "assembled-solid",
        "The mass that carries the cushions and arms. Heavily filleted on every edge, which is "
        "what stops the sofa reading as a stack of boxes.",
        (SAGE, SAGE_SHADE, "upholstery"),
        descriptor("filleted block", "fillet", 0.11, ["none"],
                   filleted_box(SOFA_L, SOFA_PLINTH_TOP - SOFA_LEG_H, SOFA_D, 0.11,
                                corner=0.11, axis="z")),
        xform(position=(SOFA_X, (SOFA_PLINTH_TOP + SOFA_LEG_H) / 2, SOFA_Z)),
        dims(SOFA_L, SOFA_PLINTH_TOP - SOFA_LEG_H, SOFA_D, 0.7),
        action("static-prop", fracture="sofa"),
        [feature("plinth-fillet",
                 "Corner radius 0.11 on a 0.42 unit tall block, so more than half the block's "
                 "height is rolled edge.",
                 "ExtrudeGeometry bevel size 0.11.", [zone("sofa")], 0.8)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.8, confidence=0.72),
    component(
        "table-shell", "Side table body with cubby", "macro", "case-body", "extrude",
        "furniture-cream", "closed-ring",
        "A ring extruded along x, so the cubby is a real recess with an occluded interior rather "
        "than a dark rectangle painted on the front face.",
        (CREAM_FURN, "#c9b69c", "moulded-case"),
        descriptor("filleted rounded-rectangle ring", "fillet", 0.075, ["none"],
                   ring_profile(TABLE_W, TABLE_BODY_H, TABLE_BAND, TABLE_D, 0.075, 0.14,
                                axis="x")),
        xform(position=(TABLE_X, TABLE_LEG_H + TABLE_BODY_H / 2, TABLE_Z)),
        dims(TABLE_D, TABLE_BODY_H, TABLE_W, 0.72),
        action("static-prop", fracture="side-table"),
        [feature("cubby-recess",
                 "A rounded-rectangle opening leaving a 0.16 unit frame on every side. The cavity "
                 "interior is the same cream as the face and is read only by occlusion "
                 "(#c9b69c against #f3e5d2).",
                 "Ring profile with a rounded-rect hole, plus a separate back panel so the recess "
                 "is not a through-hole.",
                 [zone("side-table")], 0.84)],
        CASE_SURFACE, [zone("side-table")], importance=0.72, confidence=0.75),

    # ---- meso -------------------------------------------------------------
    component(
        "skirting-a", "Skirting rail, wall A", "meso", "edge-rail", "extrude", "trim-navy",
        "assembled-solid",
        "A proud rail, not a painted band: the reference shows its own top round-over catching "
        "light separately from the wall behind it.",
        (NAVY, NAVY_SHADE, "painted-trim"),
        descriptor("filleted rail", "fillet", SKIRT_FILLET, ["none"],
                   filleted_box(SKIRT_PROUD, SKIRT_H, ROOM + WALL_T, SKIRT_FILLET,
                                corner=SKIRT_FILLET, axis="z")),
        xform(position=(-(INNER - SKIRT_PROUD / 2), SKIRT_H / 2, -WALL_T / 2)),
        dims(SKIRT_PROUD, SKIRT_H, ROOM + WALL_T, 0.8),
        action("static-shell"),
        [feature("skirting-proud-rail",
                 "0.247 units tall, standing 0.09 off the plaster. Height is 7.96 percent of the "
                 "wall, measured as 44 px of screen height at 193 px per unit divided by cos of "
                 "the 22.4 degree camera pitch.",
                 "Filleted rail parented to the wall and offset along its normal.",
                 [zone("skirting")], 0.88)],
        TRIM_SURFACE, [zone("skirting")], importance=0.78, confidence=0.85, parent="wall-a",
        attachment=attach("wall-a-base", (0, 0, -(ROOM + WALL_T) / 2), (0, 0, (ROOM + WALL_T) / 2),
                          "surface-mounted", 0.02, 0.004,
                          "Rail is pressed into the plaster by 0.02 so no seam line opens at "
                          "the contact.")),
    component(
        "skirting-b", "Skirting rail, wall B", "meso", "edge-rail", "extrude", "trim-navy",
        "assembled-solid",
        "Same rail on wall B. It overlaps wall A's rail in the corner, which is what makes the "
        "skirting read as one continuous line turning the corner.",
        (NAVY, NAVY_SHADE, "painted-trim"),
        descriptor("filleted rail", "fillet", SKIRT_FILLET, ["none"],
                   filleted_box(ROOM, SKIRT_H, SKIRT_PROUD, SKIRT_FILLET,
                                corner=SKIRT_FILLET, axis="x")),
        xform(position=(0, SKIRT_H / 2, -(INNER - SKIRT_PROUD / 2))),
        dims(ROOM, SKIRT_H, SKIRT_PROUD, 0.8),
        action("static-shell"),
        [feature("skirting-corner-run",
                 "The two rails overlap in the corner rather than mitring, so the darkest crease "
                 "in the reference (#11141a) falls exactly where two dark solids meet.",
                 "Rail B spans the full room width and passes behind rail A.",
                 [zone("skirting")], 0.8)],
        TRIM_SURFACE, [zone("skirting")], importance=0.78, confidence=0.85, parent="wall-b",
        attachment=attach("wall-b-base", (-ROOM / 2, 0, 0), (ROOM / 2, 0, 0),
                          "surface-mounted", 0.02, 0.004,
                          "Pressed into the plaster by 0.02, same contract as rail A.")),
    component(
        "window-reveal", "Window reveal box", "meso", "recess", "extrude", "sage-green",
        "assembled-solid",
        "The setback behind the frame band. It is a solid rather than a hole because the "
        "reference shows a shaded sage edge inside the opening, not the room beyond.",
        (SAGE_SHADE, SAGE, "painted-joinery"),
        descriptor("filleted shallow box", "fillet", 0.03, ["none"],
                   filleted_box(0.10, WIN_OPEN_H + 0.06, WIN_OPEN_W + 0.06, 0.03,
                                corner=0.03, axis="x")),
        xform(position=(-(INNER + 0.02), WIN_Y, WIN_Z)),
        dims(0.10, WIN_OPEN_H + 0.06, WIN_OPEN_W + 0.06, 0.7),
        action("static-shell", fracture="window"),
        [feature("glazing-setback",
                 "Glass sits 0.10 units behind the frame's outer face, which is what produces the "
                 "#67927c reveal edge measured against the #97ba9d frame.",
                 "Reveal box shallower than the frame along the wall normal.",
                 [zone("window")], 0.78)],
        UPHOLSTERY_SURFACE, [zone("window")], importance=0.6, confidence=0.75),
    component(
        "window-glass", "Glazing plate", "meso", "glazing", "box", "glass-blue",
        "assembled-solid",
        "One plate behind the muntins rather than four separate panes: the reference shows no "
        "value difference between the four lights, so four solids would add a distinction the "
        "image does not have.",
        (GLASS, "#92c2d6", "glazing"),
        descriptor("flat plate", "none", 0.0, ["none"]),
        xform(position=(-(INNER - 0.005), WIN_Y, WIN_Z), scale=None),
        dims(0.03, WIN_OPEN_H, WIN_OPEN_W, 0.8),
        action("static-shell", fracture="window"),
        [feature("matte-sky-glazing",
                 "Flat #98cfe5 across all four lights with no reflected content, so this is an "
                 "opaque stylised fill and not a transmissive glass.",
                 "Opaque MeshStandardMaterial, no environment map.",
                 [zone("window")], 0.87)],
        GLASS_SURFACE, [zone("window")], importance=0.65, confidence=0.85),
    component(
        "window-frame", "Window frame ring", "meso", "trim-ring", "extrude", "sage-green",
        "assembled-solid",
        "A rounded-rectangle ring standing proud of the plaster. Modelled as a ring so the "
        "opening is real geometry and the frame band has its own filleted edges on both sides.",
        (SAGE_LIT, SAGE_SHADE, "painted-joinery"),
        descriptor("filleted rounded-rectangle ring", "fillet", 0.05, ["none"],
                   ring_profile(WIN_W, WIN_H, WIN_BAND, WIN_PROUD, 0.05, 0.18, axis="x")),
        xform(position=(-(INNER + WALL_T / 2 - WIN_PROUD / 2 - WALL_T / 2), WIN_Y, WIN_Z)),
        dims(WIN_PROUD, WIN_H, WIN_W, 0.82),
        action("static-shell", fracture="window",
               sockets=[{"id": "muntin-cross", "localPosition": [0, 0, 0],
                         "localRotation": [0, 0, 0],
                         "notes": "Opening centre; both muntins cross here."}]),
        [feature("frame-relief",
                 "1.77 by 1.46 units outside, band 0.20, standing 0.12 proud of the wall. Sizes "
                 "come from the frame's own vertical edge (260 px) and its top edge run (241 px), "
                 "measured separately so the two are not contaminated by the projection.",
                 "Rounded-rect ring extruded 0.12 along the wall normal.",
                 [zone("window")], 0.85)],
        UPHOLSTERY_SURFACE, [zone("window")], importance=0.8, confidence=0.82),
    component(
        "sofa-arm-left", "Sofa arm, wall side", "meso", "bolster", "extrude", "sage-green",
        "assembled-solid",
        "A bolster, not a panel: the corner radius approaches half the arm's own width, so the "
        "arm's cross-section is closer to a stadium than to a rectangle.",
        (SAGE_LIT, SAGE_SHADE, "upholstery"),
        descriptor("heavily filleted block", "fillet", 0.17, ["none"],
                   filleted_box(SOFA_ARM_W, SOFA_ARM_TOP - SOFA_LEG_H, SOFA_D, 0.17,
                                corner=0.17, axis="z")),
        xform(position=(SOFA_X - (SOFA_L - SOFA_ARM_W) / 2,
                        (SOFA_ARM_TOP + SOFA_LEG_H) / 2, SOFA_Z)),
        dims(SOFA_ARM_W, SOFA_ARM_TOP - SOFA_LEG_H, SOFA_D, 0.72),
        action("static-prop", fracture="sofa"),
        [feature("arm-bolster-roll",
                 "Fillet 0.17 on a 0.38 unit wide arm, so 89 percent of the width is rolled.",
                 "ExtrudeGeometry bevel size 0.17.", [zone("sofa")], 0.86)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.75, confidence=0.75, parent="sofa-plinth",
        attachment=attach("plinth-left", (0, -(SOFA_ARM_TOP - SOFA_LEG_H) / 2, 0),
                          (0, (SOFA_ARM_TOP - SOFA_LEG_H) / 2, 0), "fused", 0.06, 0.004,
                          "Arm and plinth interpenetrate by 0.06 so no seam opens along the "
                          "contact.")),
    component(
        "sofa-arm-right", "Sofa arm, room side", "meso", "bolster", "extrude", "sage-green",
        "assembled-solid",
        "Mirror of the wall-side arm. Kept as its own component because it is the arm the "
        "reference shows most fully and it carries the review's silhouette read.",
        (SAGE_LIT, SAGE_SHADE, "upholstery"),
        descriptor("heavily filleted block", "fillet", 0.17, ["none"],
                   filleted_box(SOFA_ARM_W, SOFA_ARM_TOP - SOFA_LEG_H, SOFA_D, 0.17,
                                corner=0.17, axis="z")),
        xform(position=(SOFA_X + (SOFA_L - SOFA_ARM_W) / 2,
                        (SOFA_ARM_TOP + SOFA_LEG_H) / 2, SOFA_Z)),
        dims(SOFA_ARM_W, SOFA_ARM_TOP - SOFA_LEG_H, SOFA_D, 0.72),
        action("static-prop", fracture="sofa"),
        [feature("arm-bolster-roll-right",
                 "Same 0.17 fillet. Its outer face is where the reference's brightest sage "
                 "(#9fc1a4) is measured, so it is the material-pass anchor.",
                 "ExtrudeGeometry bevel size 0.17.", [zone("sofa")], 0.86)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.75, confidence=0.75, parent="sofa-plinth",
        attachment=attach("plinth-right", (0, -(SOFA_ARM_TOP - SOFA_LEG_H) / 2, 0),
                          (0, (SOFA_ARM_TOP - SOFA_LEG_H) / 2, 0), "fused", 0.06, 0.004,
                          "Interpenetrates the plinth by 0.06, same contract as the left arm.")),
    component(
        "sofa-seat-cushion-left", "Seat cushion, left", "meso", "cushion", "extrude",
        "sage-green", "closed-volume",
        "A separate solid with air around it. The reference's centre seam shows background-side "
        "shadow, which a moulded seam on one mesh cannot produce.",
        (SAGE, SAGE_SHADE, "upholstery"),
        descriptor("filleted cushion", "fillet", 0.1, ["none"],
                   filleted_box((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02,
                                SOFA_SEAT_TOP - SOFA_PLINTH_TOP + 0.06, SOFA_D - 0.2, 0.1,
                                corner=0.1, axis="z")),
        xform(position=(SOFA_X - (SOFA_L - 2 * SOFA_ARM_W) / 4,
                        (SOFA_SEAT_TOP + SOFA_PLINTH_TOP) / 2, SOFA_Z + 0.06)),
        dims((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02, SOFA_SEAT_TOP - SOFA_PLINTH_TOP + 0.06,
             SOFA_D - 0.2, 0.7),
        action("static-prop", fracture="sofa"),
        [feature("cushion-gap",
                 "0.02 units of air on the centre seam. The gap is what the review scores; a "
                 "painted line there would fail the cushion-seam feature.",
                 "Two solids, each half the free span minus half the gap.",
                 [zone("sofa")], 0.9)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.7, confidence=0.72, parent="sofa-plinth"),
    component(
        "sofa-seat-cushion-right", "Seat cushion, right", "meso", "cushion", "extrude",
        "sage-green", "closed-volume",
        "Mirror of the left seat cushion across the sofa's centre seam.",
        (SAGE, SAGE_SHADE, "upholstery"),
        descriptor("filleted cushion", "fillet", 0.1, ["none"],
                   filleted_box((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02,
                                SOFA_SEAT_TOP - SOFA_PLINTH_TOP + 0.06, SOFA_D - 0.2, 0.1,
                                corner=0.1, axis="z")),
        xform(position=(SOFA_X + (SOFA_L - 2 * SOFA_ARM_W) / 4,
                        (SOFA_SEAT_TOP + SOFA_PLINTH_TOP) / 2, SOFA_Z + 0.06)),
        dims((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02, SOFA_SEAT_TOP - SOFA_PLINTH_TOP + 0.06,
             SOFA_D - 0.2, 0.7),
        action("static-prop", fracture="sofa"),
        [feature("cushion-gap-right",
                 "Same 0.02 gap on the other side of the seam.",
                 "Mirrored solid.", [zone("sofa")], 0.9)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.7, confidence=0.72, parent="sofa-plinth"),
    component(
        "sofa-back-cushion-left", "Back cushion, left", "meso", "cushion", "extrude",
        "sage-green", "closed-volume",
        "Separate solid, reclined about five degrees. Built separately from the right back "
        "cushion because the gap between them shows shadow from the wall side.",
        (SAGE, SAGE_SHADE, "upholstery"),
        descriptor("filleted cushion", "fillet", 0.12, ["none"],
                   filleted_box((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02,
                                SOFA_BACK_TOP - SOFA_PLINTH_TOP + 0.1, SOFA_BACK_T, 0.12,
                                corner=0.12, axis="z")),
        xform(position=(SOFA_X - (SOFA_L - 2 * SOFA_ARM_W) / 4,
                        (SOFA_BACK_TOP + SOFA_PLINTH_TOP) / 2 - 0.05,
                        SOFA_Z - SOFA_D / 2 + SOFA_BACK_T / 2 + 0.02),
               rotation=(SOFA_RECLINE, 0, 0)),
        dims((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02, SOFA_BACK_TOP - SOFA_PLINTH_TOP + 0.1,
             SOFA_BACK_T, 0.68),
        action("static-prop", fracture="sofa"),
        [feature("back-recline",
                 "Rotated -0.09 radians about x so the top of the back stands further from the "
                 "wall than its base, which is what opens the wedge of shadow the reference "
                 "shows between sofa and plaster.",
                 "Rotation applied at the cushion's own node.",
                 [zone("sofa"), zone("wall-back")], 0.7)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.72, confidence=0.7, parent="sofa-plinth"),
    component(
        "sofa-back-cushion-right", "Back cushion, right", "meso", "cushion", "extrude",
        "sage-green", "closed-volume",
        "Mirror of the left back cushion, same recline.",
        (SAGE, SAGE_SHADE, "upholstery"),
        descriptor("filleted cushion", "fillet", 0.12, ["none"],
                   filleted_box((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02,
                                SOFA_BACK_TOP - SOFA_PLINTH_TOP + 0.1, SOFA_BACK_T, 0.12,
                                corner=0.12, axis="z")),
        xform(position=(SOFA_X + (SOFA_L - 2 * SOFA_ARM_W) / 4,
                        (SOFA_BACK_TOP + SOFA_PLINTH_TOP) / 2 - 0.05,
                        SOFA_Z - SOFA_D / 2 + SOFA_BACK_T / 2 + 0.02),
               rotation=(SOFA_RECLINE, 0, 0)),
        dims((SOFA_L - 2 * SOFA_ARM_W) / 2 - 0.02, SOFA_BACK_TOP - SOFA_PLINTH_TOP + 0.1,
             SOFA_BACK_T, 0.68),
        action("static-prop", fracture="sofa"),
        [feature("back-recline-right",
                 "Same -0.09 radian recline. The vertical gap between the two back cushions is "
                 "the sofa's most legible internal edge in the reference.",
                 "Rotation applied at the cushion's own node.",
                 [zone("sofa")], 0.7)],
        UPHOLSTERY_SURFACE, [zone("sofa")], importance=0.72, confidence=0.7, parent="sofa-plinth"),
    component(
        "table-back-panel", "Side table cubby back", "meso", "panel", "extrude",
        "furniture-cream", "developable-slab",
        "Closes the cubby so the recess has an interior. Without it the ring is a through-hole "
        "and the wall shows through, which the reference does not do.",
        (CREAM_FURN, "#c9b69c", "moulded-case"),
        descriptor("filleted panel", "fillet", 0.03, ["none"],
                   filleted_box(0.09, TABLE_BODY_H - 2 * TABLE_BAND + 0.06,
                                TABLE_W - 2 * TABLE_BAND + 0.06, 0.03, corner=0.03, axis="x")),
        xform(position=(TABLE_X - TABLE_D / 2 + 0.045, TABLE_LEG_H + TABLE_BODY_H / 2, TABLE_Z)),
        dims(0.09, TABLE_BODY_H - 2 * TABLE_BAND + 0.06, TABLE_W - 2 * TABLE_BAND + 0.06, 0.65),
        action("static-prop", fracture="side-table"),
        [feature("cubby-back",
                 "Sits at the far end of the ring's extrusion so the cavity is 0.53 units deep, "
                 "which is what makes the interior read entirely by occlusion.",
                 "Panel inset into the ring's rear opening.",
                 [zone("side-table")], 0.7)],
        CASE_SURFACE, [zone("side-table")], importance=0.55, confidence=0.7, parent="table-shell"),
    component(
        "rug-border", "Rug gold border", "meso", "plate", "extrude", "rug-gold",
        "assembled-solid",
        "The outer of the rug's two concentric rounded rectangles. A plate rather than a plane "
        "because the reference shows its edge catching light.",
        (GOLD, "#e8b04f", "textile"),
        descriptor("filleted plate", "fillet", 0.022, ["none"],
                   filleted_box(RUG_L, 0.055, RUG_W, 0.022, corner=RUG_RADIUS, axis="y")),
        xform(position=(RUG_X, 0.0275, RUG_Z)),
        dims(RUG_L, 0.055, RUG_W, 0.78),
        action("static-prop", fracture="rug"),
        [feature("rug-border-inset",
                 "Corner radius 0.30 on a 2.70 by 1.83 plate, so the rug's corners are visibly "
                 "rounder than any furniture corner in the room.",
                 "Rounded-rect profile, radius 0.30.", [zone("rug")], 0.91)],
        TEXTILE_SURFACE, [zone("rug")], importance=0.62, confidence=0.78),
    component(
        "rug-field", "Rug coral field", "meso", "plate", "extrude", "rug-coral",
        "assembled-solid",
        "The inner plate. Its top sits 0.01 below the border crest, which is what gives the "
        "border its inner shadow line.",
        (CORAL, "#ee7561", "textile"),
        descriptor("filleted plate", "fillet", 0.018, ["none"],
                   filleted_box(RUG_L - 2 * RUG_BORDER, 0.05, RUG_W - 2 * RUG_BORDER, 0.018,
                                corner=RUG_RADIUS - RUG_BORDER, axis="y")),
        xform(position=(RUG_X, 0.025, RUG_Z)),
        dims(RUG_L - 2 * RUG_BORDER, 0.05, RUG_W - 2 * RUG_BORDER, 0.78),
        action("static-prop", fracture="rug"),
        [feature("field-recess",
                 "Field crest at 0.050 against the border's 0.055, a 0.005 step that reads as a "
                 "line rather than as a lip.",
                 "Two stacked plates at different heights.", [zone("rug")], 0.85)],
        TEXTILE_SURFACE, [zone("rug")], importance=0.6, confidence=0.78, parent="rug-border"),

    # ---- micro ------------------------------------------------------------
    component(
        "window-muntin-vertical", "Vertical muntin", "micro", "glazing-bar", "extrude",
        "sage-green", "developable-slab",
        "A proud bar over the glazing. Modelled as a solid because it casts onto the glass in "
        "the reference, which a texture line cannot do.",
        (SAGE_LIT, SAGE_SHADE, "painted-joinery"),
        descriptor("filleted bar", "fillet", 0.028, ["none"],
                   filleted_box(0.09, WIN_OPEN_H, MUNTIN_T, 0.028, corner=0.028, axis="x")),
        xform(position=(-(INNER - 0.045), WIN_Y, WIN_Z)),
        dims(0.09, WIN_OPEN_H, MUNTIN_T, 0.85),
        action("static-shell", fracture="window"),
        [feature("muntin-cross-vertical",
                 "Centred on the opening, dividing it into two columns of equal width.",
                 "Bar parented to the frame's muntin-cross socket.",
                 [zone("window")], 0.92)],
        UPHOLSTERY_SURFACE, [zone("window")], importance=0.55, confidence=0.85,
        parent="window-frame",
        attachment=attach("muntin-cross", (0, -WIN_OPEN_H / 2, 0), (0, WIN_OPEN_H / 2, 0),
                          "socketed", 0.03, 0.003,
                          "Ends embed 0.03 into the frame band so no gap opens at either end.")),
    component(
        "window-muntin-horizontal", "Horizontal muntin", "micro", "glazing-bar", "extrude",
        "sage-green", "developable-slab",
        "The crossing bar. Together with the vertical it makes four equal lights, which is the "
        "window's whole identity.",
        (SAGE_LIT, SAGE_SHADE, "painted-joinery"),
        descriptor("filleted bar", "fillet", 0.028, ["none"],
                   filleted_box(0.09, MUNTIN_T, WIN_OPEN_W, 0.028, corner=0.028, axis="x")),
        xform(position=(-(INNER - 0.045), WIN_Y, WIN_Z)),
        dims(0.09, MUNTIN_T, WIN_OPEN_W, 0.85),
        action("static-shell", fracture="window"),
        [feature("muntin-cross-horizontal",
                 "Centred on the opening, dividing it into two rows of equal height.",
                 "Bar parented to the frame's muntin-cross socket.",
                 [zone("window")], 0.92)],
        UPHOLSTERY_SURFACE, [zone("window")], importance=0.55, confidence=0.85,
        parent="window-frame",
        attachment=attach("muntin-cross", (0, 0, -WIN_OPEN_W / 2), (0, 0, WIN_OPEN_W / 2),
                          "socketed", 0.03, 0.003,
                          "Ends embed 0.03 into the frame band, same contract as the vertical.")),
    component(
        "sofa-leg-cluster", "Sofa peg legs", "micro", "leg", "cylinder", "furniture-cream",
        "assembled-solid",
        "A turned peg: a surface of revolution about a vertical axis, so a cylinder is the "
        "correct primitive and a box would be wrong at any fillet radius.",
        (CREAM_LEG, "#d8c8b1", "moulded-case"),
        descriptor("turned peg", "fillet", 0.02, ["none"]),
        xform(position=tuple(SOFA_LEGS[0]), scale=None),
        dims(0.15, SOFA_LEG_H, 0.15, 0.7),
        action("static-prop", fracture="sofa"),
        [feature("peg-leg-set",
                 "Four pegs inset from the sofa corners, 0.15 across and 0.20 tall, in the "
                 "furniture cream rather than the sofa's own green.",
                 "InstancedMesh, four explicit instance positions.",
                 [zone("sofa")], 0.83)],
        CASE_SURFACE, [zone("sofa")], importance=0.5, confidence=0.75, parent="sofa-plinth",
        attachment=attach("plinth-underside", (0, -SOFA_LEG_H / 2, 0), (0, SOFA_LEG_H / 2, 0),
                          "socketed", 0.03, 0.003,
                          "Peg tops embed 0.03 into the plinth so the joint is closed.")),
    component(
        "table-leg-cluster", "Side table peg legs", "micro", "leg", "cylinder",
        "furniture-cream", "revolved-solid",
        "Same turned peg as the sofa's, slightly slimmer. Sharing the primitive and the material "
        "is what the reference shows, not an authoring shortcut.",
        (CREAM_LEG, "#d8c8b1", "moulded-case"),
        descriptor("turned peg", "fillet", 0.018, ["none"]),
        xform(position=tuple(TABLE_LEGS[0]), scale=None),
        dims(0.115, TABLE_LEG_H, 0.115, 0.7),
        action("static-prop", fracture="side-table"),
        [feature("table-peg-set",
                 "Four pegs 0.115 across and 0.20 tall, inset 0.22 in x and 0.40 in z from the "
                 "table's centre.",
                 "InstancedMesh, four explicit instance positions.",
                 [zone("side-table")], 0.8)],
        CASE_SURFACE, [zone("side-table")], importance=0.45, confidence=0.75, parent="table-shell",
        attachment=attach("table-underside", (0, -TABLE_LEG_H / 2, 0), (0, TABLE_LEG_H / 2, 0),
                          "socketed", 0.03, 0.003,
                          "Peg tops embed 0.03 into the case body.")),
    component(
        "plank-seam-cluster", "Board run seams", "micro", "groove", "box", "trim-navy",
        "assembled-solid",
        "Recessed grooves between boards. Geometry rather than a texture line so they survive a "
        "grazing key and read at the floor's own scale.",
        (SEAM_SHADOW, TAN_DARK, "wood"),
        descriptor("recessed groove", "none", 0.0, ["none"]),
        xform(position=tuple(PLANK_SEAMS[0]), scale=None),
        dims(SEAM_W, SEAM_D, PLANK_FIELD, 0.7),
        action("static-shell", fracture="floor-tray"),
        [feature("plank-run-seams",
                 "Five interior seams for six boards of 0.713 units, from a measured 96 px "
                 "horizontal spacing at 45 degrees.",
                 "InstancedMesh, five explicit instance positions along x.",
                 [zone("floor-planks")], 0.8)],
        BOARD_SURFACE, [zone("floor-planks")], importance=0.5, confidence=0.72,
        parent="floor-slab"),
    component(
        "plank-butt-cluster", "Board butt joints", "micro", "groove", "box", "trim-navy",
        "assembled-solid",
        "Short cross cuts that break the boards into lengths. Staggered on a deterministic seed "
        "so no two adjacent boards break on the same line.",
        (SEAM_SHADOW, TAN_DARK, "wood"),
        descriptor("recessed groove", "none", 0.0, ["none"]),
        xform(position=tuple(PLANK_BUTTS[0]), scale=None),
        dims(PLANK_W, SEAM_D, SEAM_W, 0.65),
        action("static-shell", fracture="floor-tray"),
        [feature("plank-butt-joints",
                 "Twelve cuts, two per board, spaced 1.5 to 2.2 units apart and offset per board "
                 "by a seeded stagger.",
                 "InstancedMesh, twelve explicit instance positions.",
                 [zone("floor-planks")], 0.66)],
        BOARD_SURFACE, [zone("floor-planks")], importance=0.45, confidence=0.66,
        parent="floor-slab"),
]


# ---------------------------------------------------------------------------
# repetition systems. `placement.instances` is honoured by the refine-code edit
# in apply_refinements.py; the generator's own emitter only knows radial rings.
# ---------------------------------------------------------------------------
REPETITION = [
    {
        "id": "floor-plank-seams", "name": "Board run seams", "level": "micro",
        "parent": "floor-slab", "count": len(PLANK_SEAMS) - 1, "primitive": "box",
        "material": "trim-navy",
        "instanceScale": [SEAM_W, SEAM_D, PLANK_FIELD],
        "buildsGeometry": True, "realization": "InstancedMesh",
        "placement": {"mode": "explicit", "axis": [1, 0, 0], "radius": 0.0, "startAngleDeg": 0,
                      "instances": PLANK_SEAMS[1:],
                      "notes": "Five interior seams for six 0.713 unit boards, measured at 96 px "
                               "horizontal spacing at 45 degrees."},
        "evidenceRefs": [zone("floor-planks")],
        "notes": "One draw call. Instance colour is not varied here; only the boards themselves "
                 "carry per-instance tone.",
    },
    {
        "id": "floor-butt-joints", "name": "Board butt joints", "level": "micro",
        "parent": "floor-slab", "count": len(PLANK_BUTTS) - 1, "primitive": "box",
        "material": "trim-navy",
        "instanceScale": [PLANK_W, SEAM_D, SEAM_W],
        "buildsGeometry": True, "realization": "InstancedMesh",
        "placement": {"mode": "explicit", "axis": [0, 0, 1], "radius": 0.0, "startAngleDeg": 0,
                      "instances": PLANK_BUTTS[1:],
                      "notes": "Two cuts per board on a fixed stagger sequence so adjacent boards "
                               "never break on the same line."},
        "evidenceRefs": [zone("floor-planks")],
        "notes": "One draw call for every butt joint in the floor.",
    },
    {
        "id": "sofa-legs", "name": "Sofa peg legs", "level": "micro", "parent": "sofa-plinth",
        "count": 3, "primitive": "cylinder", "material": "furniture-cream",
        "instanceScale": [0.15, SOFA_LEG_H, 0.15],
        "buildsGeometry": True, "realization": "InstancedMesh",
        "placement": {"mode": "explicit", "axis": [0, 1, 0], "radius": 0.0, "startAngleDeg": 0,
                      "instances": SOFA_LEGS[1:],
                      "notes": "Three of the four pegs; the fourth is the named sofa-leg-cluster "
                               "component itself. Positions are local to the plinth node."},
        "evidenceRefs": [zone("sofa")],
        "notes": "Cream, never the sofa's own green; that contrast is what lifts the sofa off "
                 "the floor in the reference.",
    },
    {
        "id": "table-legs", "name": "Side table peg legs", "level": "micro",
        "parent": "table-shell", "count": 3, "primitive": "cylinder",
        "material": "furniture-cream",
        "instanceScale": [0.115, TABLE_LEG_H, 0.115],
        "buildsGeometry": True, "realization": "InstancedMesh",
        "placement": {"mode": "explicit", "axis": [0, 1, 0], "radius": 0.0, "startAngleDeg": 0,
                      "instances": TABLE_LEGS[1:],
                      "notes": "Three of the four pegs; the fourth is the named table-leg-cluster "
                               "component. Positions are local to the table shell node."},
        "evidenceRefs": [zone("side-table")],
        "notes": "Same cream as the sofa legs, 0.115 across instead of 0.15.",
    },
    {
        "id": "window-muntin-pair", "name": "Muntin cross", "level": "micro",
        "parent": "window-frame", "count": 2, "primitive": "box", "material": "sage-green",
        "instanceScale": [0.09, MUNTIN_T, WIN_OPEN_W],
        "buildsGeometry": False, "realization": "authored-components",
        "placement": {"mode": "explicit", "axis": [1, 0, 0], "radius": 0.0, "startAngleDeg": 0,
                      "instances": [[0.0, 0.0, 0.0]],
                      "notes": "Recorded as a repeated system because the two bars are the same "
                               "extrusion rotated 90 degrees, but built as two named components "
                               "so each can be picked and exploded separately."},
        "evidenceRefs": [zone("window")],
        "notes": "buildsGeometry is false on purpose: window-muntin-vertical and "
                 "window-muntin-horizontal already build the geometry. Instancing two meshes "
                 "would save one draw call and cost the part-picking contract.",
    },
]

# ---------------------------------------------------------------------------
FEATURE_TARGETS = [
    {
        "id": "corner-shell-relationship", "name": "Corner shell relationship", "tier": "critical",
        "passIds": ["blockout", "structural-pass", "form-refinement"],
        "minimumScore": 0.8, "mustPass": True,
        "componentRefs": ["wall-a", "wall-b", "skirting-a", "skirting-b"],
        "evidenceRefs": [zone("wall-left"), zone("wall-back"), zone("skirting")],
        "failureModes": ["walls render as zero-thickness cards",
                         "the skirting stops at the corner",
                         "the crest round-over is missing so the wall reads as a cut plane"],
    },
    {
        "id": "floor-tray-and-boards", "name": "Floor tray and board field", "tier": "critical",
        "passIds": ["blockout", "structural-pass", "form-refinement", "surface-pass"],
        "minimumScore": 0.8, "mustPass": True,
        "componentRefs": ["floor-slab", "base-trim", "plank-seam-cluster", "plank-butt-cluster"],
        "evidenceRefs": [zone("floor-planks"), zone("base-trim")],
        "failureModes": ["the navy rim does not wrap the whole perimeter",
                         "boards read as a tiled texture rather than as seamed geometry",
                         "butt joints line up across adjacent boards"],
    },
    {
        "id": "window-relief", "name": "Window relief and muntin cross", "tier": "critical",
        "passIds": ["structural-pass", "form-refinement", "material-pass"],
        "minimumScore": 0.8, "mustPass": True,
        "componentRefs": ["window-frame", "window-reveal", "window-glass",
                          "window-muntin-vertical", "window-muntin-horizontal"],
        "evidenceRefs": [zone("window")],
        "failureModes": ["the window reads as a decal flush with the plaster",
                         "the glazing is transmissive and picks up reflections",
                         "the muntins are painted lines instead of proud bars"],
    },
    {
        "id": "sofa-mass-and-seams", "name": "Sofa mass and cushion seams", "tier": "critical",
        "passIds": ["structural-pass", "form-refinement"],
        "minimumScore": 0.8, "mustPass": True,
        "componentRefs": ["sofa-plinth", "sofa-arm-left", "sofa-arm-right",
                          "sofa-seat-cushion-left", "sofa-seat-cushion-right",
                          "sofa-back-cushion-left", "sofa-back-cushion-right"],
        "evidenceRefs": [zone("sofa")],
        "failureModes": ["arms read as flat panels because the fillet is too small",
                         "cushion seams are painted rather than real gaps",
                         "the sofa reads as one fused mass"],
    },
    {
        "id": "furniture-peg-legs", "name": "Cream peg legs on both pieces", "tier": "critical",
        "passIds": ["form-refinement", "material-pass"],
        "minimumScore": 0.8, "mustPass": True,
        "componentRefs": ["sofa-leg-cluster", "table-leg-cluster"],
        "evidenceRefs": [zone("sofa"), zone("side-table")],
        "failureModes": ["legs take the item's own colour instead of the shared cream",
                         "furniture sits flat on the floor with no visible lift",
                         "legs are placed radially instead of at the four corners"],
    },
    {
        "id": "measured-palette", "name": "Eight measured albedos", "tier": "important",
        "passIds": ["material-pass", "surface-pass"],
        "minimumScore": 0.65, "mustPass": False,
        "componentRefs": ["wall-a", "base-trim", "floor-slab", "sofa-plinth", "rug-border",
                          "rug-field"],
        "evidenceRefs": [zone("wall-back"), zone("rug"), zone("floor-planks")],
        "failureModes": ["colours drift toward a generic pastel average",
                         "the sofa and the window frame are given different greens",
                         "shading falloff is painted into albedo instead of coming from the rig"],
    },
    {
        "id": "tiling-contract", "name": "Module tiling along the course axis",
        "tier": "important",
        "passIds": ["interaction-pass", "optimization-pass"],
        "minimumScore": 0.65, "mustPass": False,
        "componentRefs": ["wall-a", "wall-b", "skirting-a", "skirting-b"],
        "evidenceRefs": [zone("wall-back"), zone("skirting")],
        "failureModes": ["consecutive modules leave a visible vertical seam",
                         "draw calls scale with module count"],
    },
    {
        "id": "matte-response", "name": "Matte diffuse response throughout", "tier": "important",
        "passIds": ["material-pass", "surface-pass", "lighting-pass"],
        "minimumScore": 0.65, "mustPass": False,
        "componentRefs": ["wall-a", "sofa-plinth", "rug-field", "window-glass"],
        "evidenceRefs": [zone("wall-left"), zone("rug")],
        "failureModes": ["a specular lobe appears where the reference has none",
                         "the glazing gains an environment reflection"],
    },
]

BUILD_PASSES = [
    {"id": "blockout", "goal": "Place the five macro masses in the model frame and prove the "
                               "corner relationship and the floor tray read from the reference "
                               "camera.",
     "componentRefs": ["wall-a", "wall-b", "floor-slab", "base-trim", "sofa-plinth",
                       "table-shell"],
     "acceptance": ["Two wall slabs of measured thickness meet at an inside corner.",
                    "The floor tray's navy rim wraps the whole perimeter.",
                    "Silhouette bounding aspect is within 8 percent of the reference's.",
                    "No macro mass is a zero-thickness plane."]},
    {"id": "structural-pass", "goal": "Add skirting, window assembly, sofa cushions and arms, "
                                      "table back panel and the rug plates.",
     "componentRefs": ["skirting-a", "skirting-b", "window-frame", "window-reveal",
                       "window-glass", "sofa-arm-left", "sofa-arm-right",
                       "sofa-seat-cushion-left", "sofa-seat-cushion-right",
                       "sofa-back-cushion-left", "sofa-back-cushion-right",
                       "table-back-panel", "rug-border", "rug-field"],
     "acceptance": ["Skirting runs through the corner without a mitre.",
                    "The window frame stands proud of the plaster and the glazing is set back.",
                    "Every cushion seam is a real gap.",
                    "Every named component in the spec exists as a named mesh."]},
    {"id": "form-refinement", "goal": "Fillet every edge to its measured radius and add the "
                                      "muntin cross, both leg sets and the floor grooves.",
     "componentRefs": ["window-muntin-vertical", "window-muntin-horizontal", "sofa-leg-cluster",
                       "table-leg-cluster", "plank-seam-cluster", "plank-butt-cluster"],
     "acceptance": ["No hard 90 degree edge remains anywhere on the model.",
                    "Four peg legs stand under each piece of furniture.",
                    "Five board seams and twelve butt joints are present and staggered.",
                    "Repeated parts are instanced, not cloned."]},
    {"id": "material-pass", "goal": "Bind the eight measured albedos and their local overrides.",
     "componentRefs": ["wall-a", "base-trim", "floor-slab", "sofa-plinth", "rug-border",
                       "rug-field", "table-shell", "window-glass"],
     "acceptance": ["Each material's dominant albedo is within 4 percent of its measurement.",
                    "The sofa and the window frame share one material.",
                    "No material aliases albedo into roughness, normal or AO.",
                    "Metalness is zero everywhere."]},
    {"id": "surface-pass", "goal": "Add the meso and micro roughness bands and the cavity term.",
     "componentRefs": ["wall-a", "floor-slab", "sofa-plinth", "table-shell"],
     "acceptance": ["Every material carries macro, meso and micro frequency bands.",
                    "Cavity darkening appears at the corner crease, cubby and seam grooves.",
                    "Relief survives a grazing key without being painted into albedo."]},
    {"id": "lighting-pass", "goal": "Match the reference rig: a single warm key from upper front "
                                    "left at 22.4 degrees of camera pitch, broad fill, no rim.",
     "componentRefs": ["wall-a", "wall-b", "floor-slab"],
     "acceptance": ["The back wall renders near #d8c8b1 while the left wall renders near "
                    "#f3e3ce from one albedo.",
                    "No blown highlight anywhere on the cream.",
                    "Contact shadows appear under both pieces of furniture and the rug."]},
    {"id": "interaction-pass", "goal": "Expose the tiling contract, the furnishing sockets and "
                                       "the runtime part map the game consumes.",
     "componentRefs": ["wall-a", "wall-b", "sofa-plinth", "table-shell", "rug-border"],
     "acceptance": ["root.userData.sculptRuntime exposes every named part.",
                    "Wall module ends are flush so consecutive modules abut without a seam.",
                    "Furnishing groups can be extracted and placed independently of the shell."]},
    {"id": "optimization-pass", "goal": "Bring triangles and draw calls inside budget without "
                                        "losing a reviewed feature.",
     "componentRefs": ["wall-a", "wall-b", "floor-slab", "base-trim"],
     "acceptance": ["Triangle count is inside the performance budget.",
                    "Draw calls do not scale with the number of tiled modules.",
                    "No feature that passed its review is lost."]},
]


# The pass ledger belongs to the pipeline, not to this script. Re-authoring the
# spec mid-run must not erase which passes were reviewed and unlocked, or the
# locked-sequential gate silently resets to blockout and every later pass refuses
# to generate. These fields are carried forward from the previous output.
LEDGER_FIELDS = ("reviewHistory", "sculptPipeline", "tier1Results", "selfCorrectLoop")


def main() -> None:
    spec = json.loads(SEED.read_text(encoding="utf-8"))
    assessment = json.loads(ASSESSMENT.read_text(encoding="utf-8"))
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}

    spec["sourceImage"] = SOURCE_IMAGE
    spec["preSpecAssessment"] = assessment["preSpecAssessment"]
    spec["qualityContract"] = assessment["qualityContract"]

    spec["referenceCamera"] = {
        "solved": True,
        "solveMethod": "two-point perspective solve. Four silhouette edges were fitted by least "
                       "squares (the two wall crests and the two near floor edges, max residual "
                       "2.2 px), intersected into two vanishing points, and the focal length "
                       "taken as sqrt of the negative dot product of the two vanishing rays "
                       "about the principal point.",
        "fovDegrees": 13.01,
        "aspect": 1448 / 1086,
        "orientation": {"yaw": 45.0, "pitch": -22.44, "roll": 0.0},
        "targetHint": [0.0, 0.95, 0.0],
        "focalPixels": 4762.7,
        "note": "A 13 degree vertical field is a long lens, which is why the reference reads as "
                "isometric even though it is a true perspective render: the wall crests slope at "
                "0.278 while the floor edges slope at 0.482, and an orthographic camera would "
                "give both the same slope. Azimuth is 45 degrees within 1.3 degrees, so the room "
                "corner is square and viewed on its diagonal.",
    }
    spec["measurementBasis"] = {
        "pixelsPerWorldUnit": 193.0,
        "referenceBBox": {"x0": 172, "y0": 61, "x1": 1274, "y1": 1054, "imageSize": [1448, 1086]},
        "derivations": [
            "Left wall screen run 538 px divided by cos 45 deg gives 761 px of world length, "
            "assigned 4.00 model units.",
            "Vertical lengths divide screen height by cos of the 22.44 degree camera pitch "
            "before converting, which is why the wall reads 3.10 units and not 2.86.",
            "Window width and height were measured on separate edges (its 241 px top run and its "
            "260 px vertical edge) so neither contaminates the other; measuring the whole "
            "bounding box instead gave a 1.75 aspect against the correct 1.21.",
            "Furnishing heights are quoted as fractions of the wall: the sofa back is 50 percent "
            "and the side table 27 percent. These are toy proportions and are reproduced in the "
            "model frame, not in the game.",
        ],
    }
    spec["coordinateFrame"] = {
        "front": "+Z, the open side of the room facing the reviewer",
        "up": "+Y",
        "right": "+X",
        "scaleReference": "1 model unit = 193 px in the reference. The room is 4.00 units square "
                          "inside and 3.10 units tall.",
        "origin": "Walking surface at y = 0, room centre at x = z = 0, wall inner faces at "
                  "x = -2.00 and z = -2.00.",
        "tilingAxis": "Wall B tiles along X and wall A tiles along Z. Both module ends are flush "
                      "square cuts, so a run of modules abuts without a seam. The game consumes "
                      "this: its course runs along +Z between walls near x = +/-5.65, of unknown "
                      "length at author time.",
    }
    spec["silhouette"] = {
        "boundingShape": "An L of two wall planes over a square floor tray, read on the diagonal "
                         "so the outline is a hexagon: two sloping wall crests meeting at the "
                         "corner apex, two vertical wall ends, and two floor edges converging on "
                         "a bottom vertex.",
        "aspectRatios": [
            {"id": "overall", "value": round(1102 / 993, 4),
             "notes": "Silhouette bbox 1102 by 993 px, measured by background subtraction at a "
                      "tolerance of 11 of 255."},
            {"id": "wall-height-to-length", "value": round(WALL_H / ROOM, 4),
             "notes": "3.10 tall against 4.00 long."},
            {"id": "sofa-length-to-wall", "value": round(SOFA_L / ROOM, 4),
             "notes": "The sofa spans just over two thirds of wall B."},
            {"id": "window-width-to-height", "value": round(WIN_W / WIN_H, 4),
             "notes": "Wider than tall, measured on independent edges."},
        ],
        "symmetry": "Bilateral about the corner diagonal for the shell only. The furnishings "
                    "break it: sofa on wall B, table and window on wall A, rug offset toward the "
                    "open side.",
        "dominantCurves": ["the continuous round-over along both wall crests",
                           "the rug's 0.30 unit corner radius, the largest in the room",
                           "the sofa arms' near-semicircular cross-section"],
        "negativeSpaces": ["the four window lights",
                           "the side table's cubby",
                           "the gap between the two back cushions",
                           "the air under every peg leg"],
        "landmarks": ["corner apex where the two wall crests meet",
                      "bottom vertex of the floor tray",
                      "the skirting line, unbroken across the corner",
                      "the window's muntin crossing point",
                      "the sofa's centre cushion seam"],
    }
    spec["componentTree"] = COMPONENTS
    spec["materials"] = MATERIALS
    spec["repetitionSystems"] = REPETITION
    spec["buildPasses"] = BUILD_PASSES
    spec["featureReviewTargets"] = FEATURE_TARGETS

    spec["qualityTargets"] = {
        "targetFidelity": 0.8,
        "mustMatch": [
            "corner relationship between two filleted wall slabs with a continuous skirting line",
            "floor tray with a navy rim wrapping the whole perimeter",
            "window as relief on the wall with a four-light muntin cross",
            "sofa as separate filleted solids with real cushion gaps",
            "cream peg legs under both pieces of furniture",
            "the eight measured albedos, matte throughout",
        ],
        "niceToHave": [
            "per-board tone variation on the floor",
            "the wedge of shadow between the reclined sofa back and the wall",
            "the border's inner shadow line on the rug",
        ],
        "fpsTarget": 60,
        "reviewViewpoints": [
            "reference (azimuth 45, elevation 22.4, 13 degree vertical field)",
            "front (azimuth 0, elevation 12) for the wall B elevation",
            "right (azimuth 90, elevation 12) for the wall A elevation and window relief",
            "threequarter (azimuth 20, elevation 34) for the floor tray and rug",
        ],
    }
    spec["lookDevTargets"] = {
        "qualityPriority": "balanced",
        "materialPass": {
            "albedoPaletteRequired": True,
            "roughnessVariationRequired": True,
            "normalOrBumpRequired": True,
            "localOverridesRequired": True,
            "minimumTextureResolution": 128,
            "preferredTextureResolution": 256,
            "independentMapChannels": ["albedo", "roughness", "height", "normal",
                                       "ambient-occlusion"],
            "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"],
            "geometryReliefRequiredWhenSilhouetteAffected": True,
            "referencePbrExtraction": {
                "requiredWhenSourceImagePresent": True,
                "ranAnyway": True,
                "targetThreshold": 0.7,
                "stopOnLowConfidence": True,
                "script": "forge/stage1_intake/extract_pbr_evidence.py",
                "measuredConfidence": PBR_CONFIDENCE,
                "acceptedLimitation": PBR_NOTE,
            },
        },
        "lightingPass": {
            "keyDirection": "upper front left, matching the reference's left wall being 11 "
                            "percent brighter than the back wall on one albedo",
            "fillRatio": 0.55,
            "rim": "none; the reference's silhouette edge reads darker than its interior",
            "background": "#d3d1d1, measured at all four corners of the reference within 2 of 255",
            "toneMapping": "neutral for the reference-matched review, since the reference's "
                           "brightest pixel is 0.93 relative luminance and nothing clips",
            "exposure": 1.0,
        },
    }
    spec["proceduralStrategy"] = [
        "Every solid is a primitive or an ExtrudeGeometry over an authored profile. No mesh "
        "files, no downloaded art, no CSG library.",
        "Fillets come from ExtrudeGeometry's bevel, with the profile inset by the fillet radius "
        "so the finished solid matches the measured dimension exactly.",
        "Rounded-rectangle outlines and ring holes are generated as point loops at author time, "
        "so the runtime never runs a curve tessellator.",
        "Repeated parts are InstancedMesh with explicit instance transforms; nothing repeated is "
        "cloned per instance.",
        "All procedural variation is seeded from a fixed sequence so two sessions produce the "
        "same floor.",
        "The model is built once per session and cloned, because rasterising the procedural maps "
        "per instance would repeat the whole cost for every tiled module.",
        "Materials are solid albedo with procedural roughness and normal variation, which is the "
        "documented treatment for flat paint; no reference crop is projected onto any surface.",
    ]
    spec["lightingFromPhoto"] = [
        "One warm key, upper front left. The same cream measures #f3e3ce on wall A and #d8c8b1 "
        "on wall B, an 11 percent difference across a 90 degree normal change.",
        "Broad soft fill: the deepest occlusion in the room (the skirting corner at #11141a) is "
        "still 6 percent above black, so nothing goes fully dark.",
        "No rim light. The silhouette edge reads darker than the interior everywhere.",
        "Contact shadows are short and soft, and they are the only thing anchoring the furniture "
        "to the floor.",
        "Background is a flat #d3d1d1 studio grey, uniform within 2 of 255 at all four corners.",
        "Exposure 1.0 with neutral tone mapping for the reference-matched review. The reference "
        "carries no filmic or ACES grade: its brightest pixel is 0.93 relative luminance and "
        "nothing clips, so an ACES curve would compress the cream far more than the sage and a "
        "colour comparison under it would measure the tone curve instead of the material.",
    ]
    spec["performanceBudget"] = {
        "qualityPriority": "balanced",
        "targetTriangles": 60000,
        "maxDrawCalls": 32,
        "textureSize": 256,
        "fpsTarget": 60,
        "measured": {"triangles": 0, "drawCallsWithShadowPass": 0, "namedParts": len(COMPONENTS),
                     "instancedClusters": len([r for r in REPETITION if r["buildsGeometry"]]),
                     "sourceFileKb": 0,
                     "sourceFileNote": "filled by the optimization pass from the harness",
                     "note": "The budget is for one built template. The game clones it, so "
                             "geometry and materials are shared and the marginal cost of a tiled "
                             "module is its draw calls, not its triangles."},
        "optimizationPolicy": "Reduce segment counts on flat solids before touching any reviewed "
                              "feature. A filleted edge is a reviewed feature and its bevel "
                              "segments are not free to cut.",
    }
    spec["lodPlan"] = [
        {"tier": "LOD0", "distance": 0, "strategy": "Full model as reviewed."},
        {"tier": "LOD1", "distance": 18,
         "strategy": "Drop the floor butt joints and halve the bevel segments on furnishings."},
        {"tier": "LOD2", "distance": 40,
         "strategy": "Shell only: walls, skirting, floor tray and rim. Furnishings culled."},
        {"tier": "LOD3", "distance": 75, "strategy": "Culled."},
    ]
    spec["actionReadiness"] = {
        "contract": "Nothing in this reference articulates, so action readiness here means a "
                    "runtime part map and a tiling contract rather than a rig.",
        "defaultRigType": "static-hierarchy",
        "rootMotionNode": "root",
        "requiredComponentFields": ["id", "name", "level", "parent", "transform", "dimensions",
                                    "material", "actionProfile", "evidenceRefs"],
        "transformChannels": ["visibility", "materialState"],
        "authoringRules": [
            "Every mesh is named, so explode and part-picking share one definition of a part.",
            "Furnishing groups carry their own fracture group so the game can place them "
            "independently of the shell.",
            "Wall module ends are flush square cuts; no end cap that would repeat mid-run.",
            "The runtime part map is exposed on root.userData.sculptRuntime.",
        ],
        "runtimeContract": {
            "shellParts": ["wall-a", "wall-b", "skirting-a", "skirting-b"],
            "furnishingGroups": ["sofa", "side-table", "rug", "window"],
            "floorParts": ["floor-slab", "base-trim"],
            "tilingNote": "The game tiles the shell parts along its course axis and places the "
                          "furnishing groups at intervals. The floor parts are built and "
                          "reviewed but deliberately not placed in the level, because a tan "
                          "plate at deck height would destroy the platform-against-void contrast "
                          "the level's legibility depends on.",
        },
        "destructionPolicy": {"defaultBreakable": False,
                              "fractureGroupNaming": "one group per furnishing, one for the "
                                                     "shell, one for the floor tray",
                              "debrisStrategy": "none; nothing in this reference breaks"},
    }
    spec["assumptions"] = [
        "Wall thickness is inferred from a 22 px top-face band and is the least certain dimension "
        "in the model, carried at confidence 0.6.",
        "Board direction is read from seam slope alone at confidence 0.66.",
        "The room's fourth wall, its ceiling and the underside of the floor tray are not visible "
        "and are not built.",
        "The back cushions are built as two solids because the gap between them shows shadow; a "
        "single moulded cushion cannot be ruled out from this view.",
        "Albedos are the reference's directly lit face values. Single-image de-lighting scored "
        "0.631, below its own 0.7 bar, so it is recorded as evidence rather than used as the "
        "albedo source.",
    ]
    spec["risks"] = [
        {"id": "extrude-bevel-support",
         "description": "The generator's buildExtrudeGeometry emits a straight prism with "
                        "bevelEnabled false, so every fillet in this spec would be lost. The "
                        "refine-code edit in apply_refinements.py teaches it the profile's "
                        "`axis`, `center` and `bevel` fields. Without that edit the model is a "
                        "set of hard-edged boxes and fails the corner-shell feature outright.",
         "severity": "high", "mitigation": "apply_refinements.py fails loudly if its anchor text "
                                           "is missing."},
        {"id": "explicit-instance-placement",
         "description": "The repetition emitter only places instances on a radial ring. Board "
                        "seams and peg legs are linear and rectangular, so the same refine-code "
                        "edit replaces that loop with the spec's placement.instances.",
         "severity": "high", "mitigation": "Instance lists are authored in the spec, so the edit "
                                           "moves data rather than inventing it."},
        {"id": "per-part-normalisation-breaks-reference-scale",
         "description": "The reference's toy proportions put the sofa back at half the wall "
                        "height. Applied to the game's 5.1 unit walls that is a 2.9 unit sofa "
                        "next to a 1.86 unit player. The game therefore normalises each "
                        "furnishing group to its own target size, which means the relative scale "
                        "the review scores is not the relative scale the player sees.",
         "severity": "medium", "mitigation": "Stated in the report and in the runtime contract "
                                             "rather than hidden in a scale factor."},
        {"id": "floor-not-shipped",
         "description": "The floor tray and board field are built and reviewed but not placed in "
                        "the level. A tan plate at deck height would collapse the measured "
                        "platform-against-void contrast the level's legibility depends on.",
         "severity": "medium", "mitigation": "Recorded in actionReadiness.runtimeContract so a "
                                             "later session does not read the omission as a bug."},
    ]
    spec["visualEvidence"] = [
        {"id": "full-object", "path": SOURCE_IMAGE, "role": "primary reference"},
        {"id": "delit", "path": str(EVIDENCE / "apartment-delit.png"),
         "role": "de-lighting estimate, confidence 0.631, evidence only"},
    ] + [{"id": name, "path": zone_path(name), "role": "component zone"}
         for name in ZONE_REGIONS]
    spec["viewEvidence"] = [
        {"id": "full-object", "path": SOURCE_IMAGE, "role": "primary reference",
         "coverage": "two wall inner faces, the whole floor tray, the fronts of both furnishings",
         "hidden": "wall outer faces, the room's other two walls, the ceiling, the backs of both "
                   "furnishings, the underside of the tray",
         "confidence": 0.85},
        {"id": "delit", "path": str(EVIDENCE / "apartment-delit.png"),
         "role": "de-lighting estimate, confidence 0.631, evidence only",
         "coverage": "same framing as the reference", "confidence": 0.631},
    ] + [
        {"id": name, "path": zone_path(name), "role": "component zone crop",
         "imageRegion": {"x": region[0], "y": region[1], "width": region[2], "height": region[3]},
         "coverage": f"the {name} region of the reference, cut by "
                     f"forge/stage1_intake/build_detail_inventory.py",
         "confidence": 0.85}
        for name, region in ZONE_REGIONS.items()
    ]
    spec["sculptPipeline"] = {
        "passGateMode": "locked-sequential",
        "passOrder": [entry["id"] for entry in BUILD_PASSES],
        "currentPass": "blockout",
        "completedPasses": [],
        "lastCompletedPass": None,
        "blockedReason": "",
        "nextRequiredEvidence": [],
    }
    spec["reviewHistory"] = []
    spec["animationAnchors"] = []
    spec["destructionAnchors"] = []
    spec["scores"] = {
        "object_isolation": 3,
        "silhouette_readability": 3,
        "depth_inference": 2,
        "primitive_decomposition": 3,
        "material_procedurality": 3,
        "occlusion_risk": 2,
        "interaction_fit": 2,
    }
    # `conditional`, not `pass`: two of the room's four walls, the ceiling and the
    # tray underside are never visible. None of them is identity-defining and none
    # is built, but a single view cannot confirm that, so the verdict carries the
    # limitation instead of hiding it.
    spec["suitability"] = "conditional"
    spec["suitabilityReasons"] = [
        "Single subject, uncluttered, on a uniform measured background.",
        "Every material is flat paint, so albedo is directly measurable.",
        "The camera solves to a real focal length from four silhouette edges.",
        "Conditional because the room's other two walls, its ceiling and the underside of the "
        "floor tray are not visible in any view.",
    ]

    for field in LEDGER_FIELDS:
        if field in previous:
            spec[field] = previous[field]

    OUT.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    completed = spec.get("sculptPipeline", {}).get("completedPasses", [])
    print(f"components={len(COMPONENTS)} materials={len(MATERIALS)} "
          f"repetition={len(REPETITION)} reviews={len(spec.get('reviewHistory', []))} "
          f"completed={len(completed)} -> {OUT}")


if __name__ == "__main__":
    main()
