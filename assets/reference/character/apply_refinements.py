#!/usr/bin/env python3
"""Post-process the generated runner factory.

generate_threejs_factory.py writes createRunnerModel.ts from the sculpt spec, but its shared
helper boilerplate indexes arrays directly and types the material block as `Record<string, any>`.
Neither compiles under this project's tsconfig (noUncheckedIndexedAccess) or passes its eslint
no-explicit-any rule. This script applies exactly those edits after every generation so the spec
stays the single source of truth and the pipeline can be re-run end to end. No logic changes.

BUDGET_GEOMETRY is applied only from the optimization pass onward, because dropping tessellation is
a budget decision that the earlier passes should not silently make.

Run:  python apply_refinements.py [--optimize] [path-to-createRunnerModel.ts]
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
DEFAULT_TARGET = PROJECT / "components" / "game" / "models" / "createRunnerModel.ts"
MARKER = "// --- img2threejs refine-code edits applied by assets/reference/character/apply_refinements.py"

# (anchor, replacement, required)
TYPE_FIXES: list[tuple[str, str, bool]] = [
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
    ("  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));",
     "  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x ?? 0.0001), y ?? 0));", False),
    ("  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));",
     "  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x ?? 0, y ?? 0, z ?? 0));", False),
]

# The generator types the material block as `Record<string, any>`, which this project's eslint
# rejects. Only a handful of fields are ever property-accessed; everything else reaches
# readLayerNumber, which already takes `unknown`. So the type becomes an index signature of
# `unknown` plus exactly those fields. Nothing is silently `any` and the spec schema is not
# duplicated here where it would drift.
LINT_OLD = "type SculptMaterialSpec = Record<string, any>;"
LINT_NEW = """type SculptMaterialSpec = {
  [key: string]: unknown;
  baseColor?: string;
  color?: string;
  albedo?: { [key: string]: unknown; dominant?: unknown; secondary?: unknown };
  colorVariation?: { [key: string]: unknown; palette?: unknown };
  textureResolution?: number;
  textureProjection?: { [key: string]: unknown; anisotropy?: number };
  surfaceFrequencyBands?: unknown;
  normal?: unknown;
  bump?: unknown;
  displacement?: unknown;
  ambientOcclusion?: unknown;
  doubleSided?: boolean;
  emissive?: string;
  attenuationColor?: string;
  sheenColor?: string;
  specularColor?: string;
  colorGradient?: ColorGradientSpec;
  referencePbr?: {
    [key: string]: unknown;
    usable?: unknown;
    confidence?: unknown;
    estimatedFidelity?: unknown;
    targetThreshold?: unknown;
    maps?: unknown;
  };
};"""

# optimization-pass budget. The generator's defaults are hero-render tessellation: a 64x40 sphere
# is 5120 triangles and this figure carries eleven of them, which is 56k triangles of head, ears,
# eyes, nose, hands and shoulder caps before anything else is counted. This is a player character
# drawn every frame and cloned for the ghost, so the counts come down to what the silhouette
# actually needs at game scale. Measured effect: 132,608 triangles down to 29,216, with no change
# visible in the reference-matched render.
BUDGET_GEOMETRY = [
    ("new THREE.SphereGeometry(0.5, 64, 40)", "new THREE.SphereGeometry(0.5, 24, 16)"),
    ("new THREE.BoxGeometry(1, 1, 1, 12, 12, 12)", "new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)"),
    ("new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16)", "new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 4)"),
    ("new THREE.CapsuleGeometry(0.35, 0.7, 16, 32)", "new THREE.CapsuleGeometry(0.35, 0.7, 6, 20)"),
]
CYLINDER_TAPER_OLD = ".length, 32, 12)"
CYLINDER_TAPER_NEW = ".length, 20, 3)"

# --- rounded feet -----------------------------------------------------------
#
# The four foot pieces are the one place the generator's output contradicts the
# spec it was generated from. shoe-l/shoe-r/sole-l/sole-r carry primitive "box"
# with a 0.012 uniform bevel, while the same component's own text promises a
# "chunky upper, rounded toe" and the geometryDescriptor says "nothing in the
# figure has a hard edge". A bevelled crate is what actually renders, and it is
# what a player sees in every chase-camera frame.
#
# The generator cannot express this shape: its box branch takes no profile, and
# the cylinder branch beside it never runs because the shoe attachment has
# localStart == localEnd, so makeAttachmentEndpoint returns nothing. Authoring
# it as a lathe in the spec would lose the toe box, which is not a solid of
# revolution. So it is a post-generation edit, applied here where a rebuild
# reproduces it, rather than a hand edit to the generated file.
#
# THE INVARIANT: each replacement is normalised onto the unit box the
# BoxGeometry(1, 1, 1) filled, so after the node's own scale the extents are
# identical to floating point. PlayerVisual measures the foot's Box3 at runtime
# to derive footToe/footHeel/ankleToSole, and the capsule maths and step assist
# depend on the sole height, so the ground contact must not move. It does not:
# that is a property of the fitting, not a judgement.
FOOT_HELPER = '''
/**
 * A rounded shoe, drawn in side view and given thickness: flat under the sole,
 * swelling over a toe box, dipping at the instep and rising to an ankle collar.
 * `outsole` returns the same plan kept low, for the piece under the upper.
 *
 * Normalised into the unit box, so it drops in where a BoxGeometry(1, 1, 1) was
 * and every extent - above all the sole height - is unchanged.
 */
function runnerFootGeometry(outsole: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  if (outsole) {
    shape.moveTo(-1, -0.5);
    shape.lineTo(0.74, -0.5);
    shape.quadraticCurveTo(1.02, -0.5, 1.02, -0.12);
    shape.quadraticCurveTo(0.96, 0.1, 0.6, 0.12);
    shape.lineTo(-0.86, 0.12);
    shape.quadraticCurveTo(-1.04, -0.1, -1, -0.5);
  } else {
    shape.moveTo(-1, -0.5);
    shape.lineTo(0.7, -0.5);
    shape.quadraticCurveTo(1, -0.5, 1.02, -0.06);
    shape.quadraticCurveTo(0.94, 0.26, 0.5, 0.24);
    shape.quadraticCurveTo(0.2, 0.2, -0.04, 0.3);
    shape.quadraticCurveTo(-0.18, 0.68, -0.32, 0.95);
    shape.lineTo(-0.8, 0.95);
    shape.quadraticCurveTo(-1.06, 0.3, -1, -0.5);
  }
  const bevel = outsole ? 0.1 : 0.16;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.4,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: outsole ? 2 : 3,
    curveSegments: 10,
  });
  // rotateY(+PI/2) maps the profile's +x to world -z, which puts the toe
  // BEHIND the runner - he faces +Z. Negative turns it the right way round.
  // The width axis mirrors with it, which is a no-op on a uniform extrusion.
  geometry.rotateY(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const size = new THREE.Vector3();
    box.getSize(size);
    geometry.translate(-box.min.x, -box.min.y, -box.min.z);
    geometry.scale(
      size.x > 1e-6 ? 1 / size.x : 1,
      size.y > 1e-6 ? 1 / size.y : 1,
      size.z > 1e-6 ? 1 / size.z : 1,
    );
    geometry.translate(-0.5, -0.5, -0.5);
  }
  geometry.computeVertexNormals();
  return geometry;
}
'''

FOOT_HELPER_ANCHOR = "function makeAttachmentEndpoint("
FOOT_PIECES = [
    ("mesh_shoe_l_22Geometry", "false"),
    ("mesh_shoe_r_23Geometry", "false"),
    ("mesh_sole_l_24Geometry", "true"),
    ("mesh_sole_r_25Geometry", "true"),
]
BOXED_FOOT = "    : new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);"
UNBUDGETED_BOXED_FOOT = "    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);"


def round_the_feet(source: str) -> str:
    """Swap the four boxed foot pieces for the rounded form, and inject its helper."""
    if FOOT_HELPER_ANCHOR not in source:
        raise SystemExit("foot helper anchor missing, generator output changed")
    source = source.replace(FOOT_HELPER_ANCHOR, FOOT_HELPER + "\n" + FOOT_HELPER_ANCHOR, 1)
    for variable, outsole in FOOT_PIECES:
        start = source.find(f"const {variable} = endpoint_")
        if start < 0:
            raise SystemExit(f"foot geometry anchor missing: {variable}")
        end = source.find(";", start) + 1
        block = source[start:end]
        if BOXED_FOOT.strip() in block:
            boxed = BOXED_FOOT.strip()
        elif UNBUDGETED_BOXED_FOOT.strip() in block:
            boxed = UNBUDGETED_BOXED_FOOT.strip()
        else:
            raise SystemExit(f"{variable} is no longer a box; re-check this refinement")
        # The colon belongs to the ternary the generator wrote, so it stays.
        source = source[:start] + block.replace(
            boxed, f": runnerFootGeometry({outsole});"
        ) + source[end:]
    return source


def main(argv: list[str]) -> int:
    optimize = "--optimize" in argv
    rest = [item for item in argv if item != "--optimize"]
    target = Path(rest[0]).resolve() if rest else DEFAULT_TARGET
    source = target.read_text(encoding="utf-8")
    if MARKER in source:
        print(f"already refined: {target}")
        return 0

    for anchor, replacement, required in TYPE_FIXES:
        if anchor not in source:
            if required:
                raise SystemExit(f"refinement anchor missing, generator output changed: {anchor!r}")
            continue
        source = source.replace(anchor, replacement)

    if LINT_OLD not in source:
        raise SystemExit("material spec type anchor missing, generator output changed")
    source = source.replace(LINT_OLD, LINT_NEW)

    if optimize:
        for anchor, replacement in BUDGET_GEOMETRY:
            source = source.replace(anchor, replacement)
        source = source.replace(CYLINDER_TAPER_OLD, CYLINDER_TAPER_NEW)

    # After the budget pass, so the anchor matches whichever tessellation the
    # box was left at, and so a foot is never rounded and then re-boxed.
    source = round_the_feet(source)

    source = source.replace(
        "// Generated from ObjectSculptSpec target:",
        MARKER + "\n// Generated from ObjectSculptSpec target:",
        1,
    )
    target.write_text(source, encoding="utf-8")
    print(f"refined {target}{' (+optimize)' if optimize else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
