#!/usr/bin/env python3
"""Post-process a generated prop factory.

`forge/stage3_build/generate_threejs_factory.py` writes the factory from the sculpt
spec, but three things it cannot express are load-bearing for these props, and its
boilerplate does not compile under this project's tsconfig or pass its eslint config.
This script applies those edits deterministically after every generation, so the spec
stays the single source of truth and the pipeline can be re-run end to end.

1. GEOMETRY (lathe) - buildLatheGeometry is extended to honour `phiStart` and
   `phiLength`, which the specs already carry. Without them every partial surface of
   revolution is a full revolution, so a six-panel beach ball is six coincident spheres
   and a bowl rim cannot be cut.
2. GEOMETRY (extrude) - buildExtrudeGeometry is extended to honour `steps`,
   `profileStops`, `profileExempt`, `axis` and `axisOffset`. Without them every extrusion
   is a straight prism lying in the XY plane at the origin, so nothing tapers, bevels or
   lands where the spec puts it. This is the same edit the toaster needed; it is repeated
   here rather than imported because each factory is standalone generated output.
3. TYPES - the generator's shared helpers index arrays directly, which fails under this
   project's `noUncheckedIndexedAccess`, and it types the material block as
   `Record<string, any>`, which the project's eslint rejects. Non-null assertions are
   added at exactly the indexing sites, and the material block gets a real type built
   from the fields the factory actually reads. No logic changes.
4. BUDGET - flat-shaded boxes drop from 12x12x12 segments to 1x1x1, spheres from
   64x40 to 32x24. These props are instanced across a level; a 64x40 sphere is 4992
   triangles for a shape whose silhouette is indistinguishable at 32x24.
5b. GEOMETRY (attached tubes) - makeAttachmentEndpoint is taught to stand down when the
   attachment says the spec owns the geometry. The validator and the generator disagree
   about attachments: validate_sculpt_spec's ATTACHMENT_PRIMITIVES includes `tube`, so a
   tube with a parent FAILS --strict-quality without an attachment, and the generator then
   reads that attachment and replaces the component's geometry with a CylinderGeometry
   between localStart and localEnd, discarding the component's transform as well. The
   spring's three-turn helix is generated into the file and then never used: the runtime
   takes the cylinder branch and the coil ships as a smooth cone. Every pixel gate still
   passes, because a cone fills nearly the same silhouette from the reference angle. An
   attachment carrying `geometryFromSpec: true` now returns no endpoint, so the contract
   still documents the joint and still satisfies the gate, but the authored primitive is
   what gets built.
6. SIZE - the generator writes each component's JSON into userData twice, once on the
   pivot node and again byte-identical on its mesh, and writes actionProfile separately
   although it already sits inside that payload. Those become reference assignments, so
   every field stays reachable at the same path and the JSON parses once instead of twice.
7. INSTRUMENT - repetition systems are registered into `meshes`. The generator emits an
   InstancedMesh for each system and does `parent.add(cluster)` without ever putting it in
   the runtime's mesh map, and the preview harness builds its per-part world Box3 dump by
   iterating exactly that map. So every instanced cluster in every prop - spokes, teeth,
   fasteners - is INVISIBLE TO THE PRIMARY MEASURING INSTRUMENT, which is the one class of
   part whose placement is computed rather than authored and therefore the one most worth
   measuring. The fan's 14 guard spokes were parented to a node at the world origin and
   would have built as a ring around the fan's foot dipping to y -0.4093, below the deck;
   the part dump could not have shown it, and only replicating the instancer's emitted code
   by hand caught it. Registering the cluster costs one assignment and makes the dump able
   to see what it exists to check. Same reasoning as 5b: the generator is shared skill code,
   so the correction lives here where it is reproducible through the pipeline.

Every mandatory replacement fails loudly if its anchor text is missing.

Run:  python refine_props.py <path-to-createXModel.ts> [...]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py"

OLD_LATHE = """function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}"""

NEW_LATHE = """// A full revolution is not the reference shape: a beach ball panel covers 59 degrees of
// longitude and a bowl rim is cut away at the back. phiStart/phiLength are already in the
// spec's latheProfile; LatheGeometry takes them directly.
function buildLatheGeometry(
  profile: { points: [number, number][]; segments?: number; phiStart?: number; phiLength?: number },
): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(
    points,
    profile.segments ?? 24,
    profile.phiStart ?? 0,
    profile.phiLength ?? Math.PI * 2,
  );
}"""

OLD_EXTRUDE = """function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}"""

NEW_EXTRUDE = """type ExtrudeAxis = 'x' | '-x' | 'y' | '-y' | 'z';

type ExtrudeProfile = {
  points: [number, number][];
  depth: number;
  holes?: [number, number][][];
  ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[];
  steps?: number;
  profileStops?: [number, number, number][];
  profileExempt?: [number, number];
  axis?: ExtrudeAxis;
  axisOffset?: number;
  smoothShading?: boolean;
};

// A straight prism is not the reference shape: a fridge shell rounds over at the top and a
// plinth bevels at both edges. profileStops are [t, scaleX, scaleY] samples along the
// extrusion; each vertex is scaled in the shape plane by the interpolated pair.
// profileExempt names shape-plane half-extents the profile must leave alone, which is what
// keeps a bore at a constant section while the wall around it tapers.
function applyExtrudeProfile(
  geometry: THREE.BufferGeometry,
  depth: number,
  stops: [number, number, number][],
  exempt?: [number, number],
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    if (exempt && Math.abs(x) < exempt[0] && Math.abs(y) < exempt[1]) continue;
    const t = depth === 0 ? 0 : clamp01(position.getZ(i) / depth);
    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    for (let s = 0; s < sorted.length - 1; s += 1) {
      if (t >= sorted[s]![0] && t <= sorted[s + 1]![0]) {
        lo = sorted[s]!;
        hi = sorted[s + 1]!;
        break;
      }
    }
    const span = hi[0] - lo[0];
    const k = span <= 1e-6 ? 0 : (t - lo[0]) / span;
    position.setX(i, x * THREE.MathUtils.lerp(lo[1], hi[1], k));
    position.setY(i, y * THREE.MathUtils.lerp(lo[2], hi[2], k));
  }
  position.needsUpdate = true;
}

// axis/axisOffset bake orientation and placement into the geometry so every component node
// can stay at the world origin with an identity rotation. That keeps parent frames
// world-aligned, which is what lets a handle be a plain child of the door it rides on.
function buildExtrudeGeometry(profile: ExtrudeProfile): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: profile.steps ?? 1,
  });
  if (profile.profileStops && profile.profileStops.length > 1) {
    applyExtrudeProfile(geometry, profile.depth, profile.profileStops, profile.profileExempt);
  }
  if (profile.axisOffset) geometry.translate(0, 0, profile.axisOffset);
  switch (profile.axis) {
    case 'x': geometry.rotateY(Math.PI / 2); break;
    case '-x': geometry.rotateY(-Math.PI / 2); break;
    case 'y': geometry.rotateX(-Math.PI / 2); break;
    case '-y': geometry.rotateX(Math.PI / 2); break;
    default: break;
  }
  // Non-indexed after the deformation. computeVertexNormals then gives one normal per
  // facet, which is the hard crease a moulded edge shows; smoothShading merges the
  // duplicated vertices first so a rounded shell reads as one continuous surface.
  if (profile.smoothShading) {
    const merged = mergeExtrudeVertices(geometry);
    merged.computeVertexNormals();
    return merged as THREE.ExtrudeGeometry;
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ExtrudeGeometry emits non-indexed triangles, so neighbouring wall quads never share a
// vertex and computeVertexNormals cannot average across them. Welding by rounded position
// restores the shared vertices; without this a 48-sided rounded shell reads as 48 flat
// facets no matter how many sides it has.
function mergeExtrudeVertices(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const map = new Map<string, number>();
  const indices: number[] = [];
  const packed: number[] = [];
  const packedUv: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = packed.length / 3;
      map.set(key, index);
      packed.push(x, y, z);
      if (uv) packedUv.push(uv.getX(i), uv.getY(i));
    }
    indices.push(index);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(packed, 3));
  if (uv) merged.setAttribute('uv', new THREE.Float32BufferAttribute(packedUv, 2));
  merged.setIndex(indices);
  return merged;
}"""

# (anchor, replacement, required)
TYPE_FIXES: list[tuple[str, str, bool]] = [
    # curve-sweep's cross-section indexing. It only appears once a spec's sweeps reach
    # the generated pass, so the mop's navy bumper was the first factory to carry it.
    ("    shape.moveTo(cs[0][0], cs[0][1]);",
     "    shape.moveTo(cs[0]![0]!, cs[0]![1]!);", False),
    ("    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);",
     "    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i]![0]!, cs[i]![1]!);", False),
    ("    shape.moveTo(points[0][0], points[0][1]);",
     "    shape.moveTo(points[0]![0]!, points[0]![1]!);", False),
    ("      shape.lineTo(points[i][0], points[i][1]);",
     "      shape.lineTo(points[i]![0]!, points[i]![1]!);", False),
    ("    path.moveTo(loop[0][0], loop[0][1]);",
     "    path.moveTo(loop[0]![0]!, loop[0]![1]!);", False),
    ("path.lineTo(loop[i][0], loop[i][1]);",
     "path.lineTo(loop[i]![0]!, loop[i]![1]!);", False),
    ("    const band = bands[index];", "    const band = bands[index]!;", True),
    ("  if (colors.length === 1) return colors[0];",
     "  if (colors.length === 1) return colors[0]!;", True),
    ("  const a = colors[index];\n  const b = colors[index + 1];",
     "  const a = colors[index]!;\n  const b = colors[index + 1]!;", True),
    ("  const a = parseRgba(stops[index].color);\n  const b = parseRgba(stops[index + 1].color);",
     "  const a = parseRgba(stops[index]!.color);\n  const b = parseRgba(stops[index + 1]!.color);",
     True),
    ("      const center = heightField[index];", "      const center = heightField[index]!;", True),
    ("      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;",
     "      const dx = (heightField[y * size + right]! - heightField[y * size + left]!) * normalStrength * 6;",
     True),
    ("      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;",
     "      const dy = (heightField[down + x]! - heightField[up + x]!) * normalStrength * 6;", True),
    ("        heightField[y * size + left] + heightField[y * size + right]\n        + heightField[up + x] + heightField[down + x]",
     "        heightField[y * size + left]! + heightField[y * size + right]!\n        + heightField[up + x]! + heightField[down + x]!",
     True),
    ("      const roughnessByte = roughnessField[index] * 255;",
     "      const roughnessByte = roughnessField[index]! * 255;", True),
    # emitted once per repetition system that builds geometry; absent otherwise
    ("    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);",
     "    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);", False),
]

# optimization-pass tessellation. Every box in these props is a flat-shaded rigid pad with
# no displacement, and the spheres are smooth-shaded volumes whose silhouette is already
# past the point of diminishing returns at 32x24.
TESSELLATION = [
    ("new THREE.BoxGeometry(1, 1, 1, 12, 12, 12)", "new THREE.BoxGeometry(1, 1, 1)"),
    ("new THREE.SphereGeometry(0.5, 64, 40)", "new THREE.SphereGeometry(0.5, 32, 24)"),
    ("new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16)", "new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1)"),
    ("new THREE.ConeGeometry(0.5, 1, 48, 16)", "new THREE.ConeGeometry(0.5, 1, 32, 1)"),
]

# The torus could not join the table above because its tube radius varies per component, so
# it sat there as a no-op pair (old == new) that the loop skipped. It is the single most
# expensive primitive the generator emits: 24 x 96 segments is 4608 triangles, and on the
# floor fan that was 67 percent of the whole prop's geometry for one thin rim.
#
# The two counts do different work and are cut differently. TUBULAR segments make the ring
# read as a circle, which is a mustPass criterion on that prop, so they stay high; 48 keeps
# it divisible by four, which puts vertices exactly on both axes and holds the width-to-
# height ratio at 1.00 and the bounding box at radius + tube, so nothing measured moves.
# RADIAL segments only round the tube's cross-section - on a rim 0.0267 thick that is
# invisible past arm's length - so they drop from 24 to 12. 4608 triangles becomes 1152.
TORUS_RE = re.compile(r'new THREE\.TorusGeometry\((?P<head>[^,]+, [^,]+), 24, 96\)')
TORUS_NEW = r'new THREE.TorusGeometry(\g<head>, 12, 48)'

# An attachment is a JOINT contract. The generator also treats it as a GEOMETRY contract
# and swaps the component's primitive for a cylinder between its two endpoints, which
# silently turns an authored helix, curve sweep or lathe into a smooth cone. Components
# whose attachment sets `geometryFromSpec` keep the geometry the spec asked for; the
# attachment still records the socket, contact type, embed depth and tolerance.
OLD_ATTACH = """function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);"""

NEW_ATTACH = """function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  // The joint is described, but the geometry is not derived from it. Without this the
  // component's authored primitive is replaced by a cylinder between the two endpoints
  // and its transform is discarded, which turns a swept helix into a smooth cone that
  // still fills the reference silhouette and so passes every pixel gate.
  if (record.geometryFromSpec === true) return null;
  const start = readVector3(record.localStart, [0, 0, 0]);"""

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

// The nested shapes keep their own index signature so a spec literal carrying extra keys is
// not rejected as an excess property. Only these fields are ever property-accessed;
// everything else reaches readLayerNumber, which already takes `unknown`.
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

# Emitted twice, in createMapTexture and createLoadedMapTexture. Without the annotation the
# `{}` fallback widens the result to `SculptTextureProjection | {}`, which cannot be
# indexed; annotating the binding collapses the union instead of casting.
PROJECTION_OLD = (
    "  const projection = spec.textureProjection && typeof spec.textureProjection === 'object'"
    " ? spec.textureProjection : {};"
)
PROJECTION_NEW = (
    "  const projection: SculptTextureProjection = spec.textureProjection"
    " && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};"
)

MESH_COMPONENT_RE = re.compile(r"^  mesh_(?P<slug>\w+)\.userData\.sculptComponent = .*;$", re.MULTILINE)
NODE_ACTION_RE = re.compile(r"^  node_(?P<slug>\w+)\.userData\.actionProfile = .*;$", re.MULTILINE)


# The generator names the cluster and adds it to its parent, but never registers it in the
# runtime mesh map the harness measures. Anchored on both lines together so a future emitter
# change cannot half-match.
CLUSTER_RE = re.compile(
    r'(?P<indent>[ ]*)cluster\.name = (?P<id>"[^"\n]*");\n'
    r'(?P=indent)parent\.add\(cluster\);'
)


def replace_once(text: str, old: str, new: str, label: str, required: bool) -> tuple[str, bool]:
    count = text.count(old)
    if count == 0:
        if required:
            raise SystemExit(f"refinement anchor not found: {label}")
        return text, False
    if count > 1 and required:
        raise SystemExit(f"refinement anchor is ambiguous ({count} matches): {label}")
    return text.replace(old, new), True


def refine(target: Path) -> None:
    text = target.read_text(encoding="utf-8")
    if MARKER in text:
        print(f"{target.name}: already refined, nothing to do")
        return

    lathe_done = False
    if "function buildLatheGeometry(" in text:
        text, lathe_done = replace_once(text, OLD_LATHE, NEW_LATHE, "buildLatheGeometry", True)
    extrude_done = False
    if "function buildExtrudeGeometry(" in text:
        text, extrude_done = replace_once(text, OLD_EXTRUDE, NEW_EXTRUDE, "buildExtrudeGeometry", True)
    # Only mandatory where a component actually claims its own geometry, so a factory whose
    # spec has no such attachment is not held to an anchor it has no reason to carry.
    attach_needed = '"geometryFromSpec": true' in text
    text, attach_done = replace_once(text, OLD_ATTACH, NEW_ATTACH, "makeAttachmentEndpoint",
                                     attach_needed)
    if attach_needed and not attach_done:
        raise SystemExit("a component sets attachment.geometryFromSpec but the guard was not "
                         "applied; its authored primitive would ship as a cylinder")

    applied = 0
    for old, new, required in TYPE_FIXES:
        text, did = replace_once(text, old, new, old.strip()[:60], required)
        applied += 1 if did else 0

    tessellated = 0
    for old, new in TESSELLATION:
        if old != new and old in text:
            tessellated += text.count(old)
            text = text.replace(old, new)
    text, tori = TORUS_RE.subn(TORUS_NEW, text)
    tessellated += tori

    before = len(text)
    text, meshes = MESH_COMPONENT_RE.subn(
        lambda m: f"  mesh_{m.group('slug')}.userData.sculptComponent = "
                  f"node_{m.group('slug')}.userData.sculptComponent;", text)
    text, actions = NODE_ACTION_RE.subn(
        lambda m: f"  node_{m.group('slug')}.userData.actionProfile = "
                  f"node_{m.group('slug')}.userData.sculptComponent.actionProfile;", text)
    if meshes == 0 or actions == 0:
        raise SystemExit("userData de-duplication matched nothing; the emitter shape changed")
    saved = before - len(text)

    # Not mandatory: a factory whose spec declares no repetition system has no cluster to
    # register, and must not be held to an anchor it has no reason to carry.
    text, clusters = CLUSTER_RE.subn(
        lambda m: f'{m.group("indent")}cluster.name = {m.group("id")};\n'
                  f'{m.group("indent")}parent.add(cluster);\n'
                  f'{m.group("indent")}meshes[{m.group("id")}] = cluster;', text)

    text, _ = replace_once(text, LINT_OLD, LINT_NEW, "SculptMaterialSpec type", True)
    projections = text.count(PROJECTION_OLD)
    if projections != 2:
        raise SystemExit(f"expected 2 textureProjection fallbacks to annotate, found {projections}")
    text = text.replace(PROJECTION_OLD, PROJECTION_NEW)

    header = (
        f"{MARKER}\n"
        f"// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength ({'applied' if lathe_done else 'not present'}).\n"
        f"// 2. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /\n"
        f"//    axis / axisOffset / smoothShading ({'applied' if extrude_done else 'not present'}).\n"
        "// 3. SculptMaterialSpec gets a real type; non-null assertions where the generator\n"
        "//    indexes arrays, both for the project's strict tsconfig and eslint settings.\n"
        f"// 4. attachment.geometryFromSpec keeps the authored primitive instead of the\n"
        f"//    generator's cylinder-between-endpoints ({'applied' if attach_done else 'not needed'}).\n"
        "// 5. primitive tessellation reduced for a prop that is instanced across a level,\n"
        "//    including the torus, whose 24x96 was the most expensive primitive emitted.\n"
        "// 6. duplicated userData payloads become references (same API, smaller file).\n"
        f"// 7. repetition-system InstancedMeshes registered into `meshes` so the harness's\n"
        f"//    per-part world Box3 dump can see them ({clusters} registered).\n"
        "// Re-apply with: python assets/reference/props/refine_props.py <this file>\n"
    )
    target.write_text(header + text, encoding="utf-8")
    print(f"{target.name}: lathe={lathe_done} extrude={extrude_done} attachGuard={attach_done} "
          f"typeFixes={applied} tessellation={tessellated} "
          f"userDataDeduped={meshes}/{actions} clusters={clusters} ({saved} bytes)")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: refine_props.py <factory.ts> [...]")
    for arg in sys.argv[1:]:
        refine(Path(arg).resolve())


if __name__ == "__main__":
    main()
