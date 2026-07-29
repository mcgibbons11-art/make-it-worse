#!/usr/bin/env python3
"""Post-process a generated block factory.

`forge/stage3_build/generate_threejs_factory.py` writes the factory from the sculpt
spec, but its boilerplate does not compile under this project's tsconfig, and it has
no concept of the one thing a block needs that a prop does not: being drawn hundreds
of times in one call. This script applies both deterministically after every
generation, so the spec stays the single source of truth and the pipeline re-runs end
to end.

1. TYPES - the generator's shared helpers index arrays directly, which fails under
   `noUncheckedIndexedAccess`, and it types the material block as
   `Record<string, any>`, which the project's eslint rejects. Non-null assertions go
   in at exactly the indexing sites and the material block gets a real type. No logic
   changes. The anchor set is the one proved out on the toaster factory
   (assets/reference/toaster/apply_refinements.py); it is copied rather than imported
   so a change to that model's refinements cannot silently alter the blocks.
2. BUDGET - flat-shaded boxes drop from 12x12x12 segments to 1x1x1. On a block that is
   1728 triangles per box against a ceiling of 12 to 300, so this is not a tidy-up: an
   unrefined block busts its budget on its first box.
3. SIZE - the generator writes each component's JSON into userData twice, once on the
   pivot node and again byte-identical on its mesh. Those become references.
4. INSTANCING - a `create<Name>Field` export is appended. It merges the template's
   meshes per material and returns one THREE.InstancedMesh per material covering every
   placement, so a 285u course costs a constant number of draw calls instead of one per
   material per block.

Every mandatory replacement fails loudly if its anchor text is missing: a silent
partial refine would ship a factory that neither compiles nor instances.

Run:  python refine_block_factory.py <path-to-createBlockXModel.ts>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "// --- img2threejs refine-code edits applied by assets/reference/block-kit/refine_block_factory.py"

TYPE_FIXES: list[tuple[str, str, bool]] = [
    ("    shape.moveTo(points[0][0], points[0][1]);",
     "    shape.moveTo(points[0]![0]!, points[0]![1]!);", True),
    ("      shape.lineTo(points[i][0], points[i][1]);",
     "      shape.lineTo(points[i]![0]!, points[i]![1]!);", True),
    ("    path.moveTo(loop[0][0], loop[0][1]);",
     "    path.moveTo(loop[0]![0]!, loop[0]![1]!);", True),
    ("path.lineTo(loop[i][0], loop[i][1]);",
     "path.lineTo(loop[i]![0]!, loop[i]![1]!);", True),
    ("    const band = bands[index];",
     "    const band = bands[index]!;", True),
    ("  if (colors.length === 1) return colors[0];",
     "  if (colors.length === 1) return colors[0]!;", True),
    ("  const a = colors[index];\n  const b = colors[index + 1];",
     "  const a = colors[index]!;\n  const b = colors[index + 1]!;", True),
    ("  const a = parseRgba(stops[index].color);\n  const b = parseRgba(stops[index + 1].color);",
     "  const a = parseRgba(stops[index]!.color);\n  const b = parseRgba(stops[index + 1]!.color);", True),
    ("      const center = heightField[index];",
     "      const center = heightField[index]!;", True),
    ("      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;",
     "      const dx = (heightField[y * size + right]! - heightField[y * size + left]!) * normalStrength * 6;", True),
    ("      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;",
     "      const dy = (heightField[down + x]! - heightField[up + x]!) * normalStrength * 6;", True),
    ("        heightField[y * size + left] + heightField[y * size + right]\n        + heightField[up + x] + heightField[down + x]",
     "        heightField[y * size + left]! + heightField[y * size + right]!\n        + heightField[up + x]! + heightField[down + x]!", True),
    ("      const roughnessByte = roughnessField[index] * 255;",
     "      const roughnessByte = roughnessField[index]! * 255;", True),
    # Emitted once per repetition system, so absent from a blockout-pass factory.
    ("    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);",
     "    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);", False),
]

BOX_OLD = "new THREE.BoxGeometry(1, 1, 1, 12, 12, 12)"
BOX_NEW = "new THREE.BoxGeometry(1, 1, 1)"

LINT_OLD = "type SculptMaterialSpec = Record<string, any>;"
LINT_NEW = """type SculptTextureProjection = {
  [key: string]: unknown;
  anisotropy?: number;
};

type SculptReferencePbr = {
  [key: string]: unknown;
  usable?: unknown;
  confidence?: unknown;
  estimatedFidelity?: unknown;
  targetThreshold?: unknown;
  maps?: unknown;
};

// The nested shapes keep their own index signature so a spec literal carrying extra keys
// is not rejected as an excess property.
type SculptMaterialSpec = {
  [key: string]: unknown;
  baseColor?: string;
  color?: string;
  albedo?: { [key: string]: unknown; dominant?: unknown; secondary?: unknown };
  colorVariation?: { [key: string]: unknown; palette?: unknown };
  colorGradient?: ColorGradientSpec;
  textureProjection?: SculptTextureProjection;
  textureResolution?: number;
  referencePbr?: SculptReferencePbr;
  doubleSided?: boolean;
};"""

PROJECTION_OLD = (
    "  const projection = spec.textureProjection && typeof spec.textureProjection === 'object'"
    " ? spec.textureProjection : {};"
)
PROJECTION_NEW = (
    "  const projection: SculptTextureProjection = spec.textureProjection"
    " && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};"
)

MESH_COMPONENT_RE = re.compile(
    r"^  mesh_(?P<slug>\w+)\.userData\.sculptComponent = .*;$", re.MULTILINE)
NODE_ACTION_RE = re.compile(
    r"^  node_(?P<slug>\w+)\.userData\.actionProfile = .*;$", re.MULTILINE)

FACTORY_RE = re.compile(r"export function (create\w+Model)\(")

FIELD_TEMPLATE = '''

// --- block instancing -------------------------------------------------------
//
// A block is the most repeated geometry in the game: a low wall runs both sides of a
// 285u course at one copy per 0.6u module, which is 950 placements. Cloned, that costs
// one draw call per material per placement, and the same again in the shadow pass -
// several thousand calls a frame for one kind of wall. Merged and instanced, it costs
// one call per material no matter how long the course is.
//
// The merge happens once, on a single template. Everything that varies between
// placements has to ride in the instance matrix or the instance colour, because an
// InstancedMesh has exactly one material: a per-placement material would put the draw
// calls straight back.

export type {NAME}Placement = {{
  position: [number, number, number];
  /** Radians about +Y. Blocks are authored along +Z, so a wall on the -X side is PI. */
  rotationY?: number;
  /** Tints this placement without splitting the draw call. Omit to keep the block's own colour. */
  color?: THREE.ColorRepresentation;
}};

/**
 * One InstancedMesh per material covering every placement.
 *
 * The template is built once and its meshes merged per material, so the per-placement
 * cost is a matrix write rather than a scene graph. Instance colour is only allocated
 * when at least one placement asks for it, since the attribute costs memory on every
 * instance whether it varies or not.
 */
export function {FACTORY}Field(
  placements: readonly {NAME}Placement[],
  options: ProceduralModelOptions = {{}},
): THREE.Group {{
  const field = new THREE.Group();
  field.name = '{ID}-field';
  if (placements.length === 0) return field;

  const template = {FACTORY}(options);
  // The sculpt runtime holds circular Object3D references. Nothing downstream of the
  // merge reads them, and leaving them attached makes the template unclonable.
  template.updateMatrixWorld(true);

  // Group by material identity rather than by name: two components sharing a material
  // must end up in one instanced mesh or the draw-call saving is diluted.
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  template.traverse((child: THREE.Object3D) => {{
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    // A merge needs matching attribute sets. UVs and normals are always present on
    // these; anything else the generator adds would silently drop, so drop it here
    // deliberately instead.
    for (const name of Object.keys(geometry.attributes)) {{
      if (name !== 'position' && name !== 'normal' && name !== 'uv') {{
        geometry.deleteAttribute(name);
      }}
    }}
    const bucket = byMaterial.get(material);
    if (bucket) bucket.push(geometry);
    else byMaterial.set(material, [geometry]);
  }});

  const wantsColor = placements.some((placement) => placement.color !== undefined);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  for (const [material, geometries] of byMaterial) {{
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    const instanced = new THREE.InstancedMesh(merged, material, placements.length);
    instanced.name = `{ID}-field-${{material.name || material.uuid}}`;
    instanced.castShadow = options.castShadow ?? true;
    instanced.receiveShadow = options.receiveShadow ?? true;
    for (let i = 0; i < placements.length; i += 1) {{
      const placement = placements[i]!;
      position.set(placement.position[0], placement.position[1], placement.position[2]);
      quaternion.setFromAxisAngle(up, placement.rotationY ?? 0);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(i, matrix);
      if (wantsColor) instanced.setColorAt(i, tint.set(placement.color ?? 0xffffff));
    }}
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    field.add(instanced);
  }}

  field.userData.blockField = {{
    block: '{ID}',
    placements: placements.length,
    drawCalls: byMaterial.size,
    note: 'Draw calls are the material count, constant in the number of placements.',
  }};
  return field;
}}
'''

MERGE_IMPORT = ("import { mergeGeometries } from "
                "'three/examples/jsm/utils/BufferGeometryUtils.js';")


def replace_once(text: str, old: str, new: str, label: str, required: bool) -> tuple[str, bool]:
    if old not in text:
        if required:
            raise SystemExit(f"anchor missing, the generator's emitted shape changed: {label}")
        return text, False
    return text.replace(old, new, 1), True


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: refine_block_factory.py <path-to-createBlockXModel.ts>")
    target = Path(sys.argv[1]).resolve()
    text = target.read_text(encoding="utf-8")
    if MARKER in text:
        print(f"{target.name}: already refined, nothing to do")
        return

    for old, new, required in TYPE_FIXES:
        text, _ = replace_once(text, old, new, old.strip()[:60], required)
    text, _ = replace_once(text, LINT_OLD, LINT_NEW, "SculptMaterialSpec type", True)

    projections = text.count(PROJECTION_OLD)
    if projections == 0:
        raise SystemExit("textureProjection fallback anchor missing")
    text = text.replace(PROJECTION_OLD, PROJECTION_NEW)

    boxes = text.count(BOX_OLD)
    text = text.replace(BOX_OLD, BOX_NEW)

    before = len(text)
    text, meshes = MESH_COMPONENT_RE.subn(
        lambda m: f"  mesh_{m.group('slug')}.userData.sculptComponent = "
                  f"node_{m.group('slug')}.userData.sculptComponent;", text)
    text, actions = NODE_ACTION_RE.subn(
        lambda m: f"  node_{m.group('slug')}.userData.actionProfile = "
                  f"node_{m.group('slug')}.userData.sculptComponent.actionProfile;", text)
    saved = before - len(text)

    match = FACTORY_RE.search(text)
    if not match:
        raise SystemExit("could not find the exported factory function")
    factory = match.group(1)
    name = factory[len("create"):-len("Model")]
    block_id = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()

    if MERGE_IMPORT not in text:
        text = text.replace("import * as THREE from 'three';",
                            f"import * as THREE from 'three';\n{MERGE_IMPORT}", 1)
    text += FIELD_TEMPLATE.format(NAME=name, FACTORY=factory, ID=block_id)

    header = (
        f"{MARKER}\n"
        "// 1. non-null assertions at the generator's array-indexing sites, and a real type\n"
        "//    for the material block, so the factory compiles under this project's tsconfig.\n"
        f"// 2. flat-shaded boxes drop from 12x12x12 segments to 1x1x1 ({boxes} of them,\n"
        "//    1728 triangles each, against a per-block ceiling measured in tens).\n"
        f"// 3. duplicated userData payloads become references ({saved} bytes, same API).\n"
        f"// 4. {factory}Field() merges per material and returns one InstancedMesh each, so a\n"
        "//    285u course costs a constant number of draw calls.\n"
        "// Re-apply with: python assets/reference/block-kit/refine_block_factory.py <file>\n"
    )
    target.write_text(header + text, encoding="utf-8")
    print(f"{target.name}: refined  boxes={boxes} meshUserData={meshes} "
          f"actionUserData={actions} saved={saved}B  field={factory}Field")


if __name__ == "__main__":
    main()
