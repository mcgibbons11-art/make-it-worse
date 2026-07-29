#!/usr/bin/env python3
"""Post-process the generated hammer factory.

generate_threejs_factory.py writes createHammerModel.ts from the sculpt spec, but
three things in its shared boilerplate need fixing after every generation. None of
them is a design change, so they are applied here rather than hand-edited, and the
spec stays the single source of truth.

1. TYPE_FIXES: the boilerplate indexes arrays directly and types the material block
   as `Record<string, any>`. Neither compiles under this project's tsconfig
   (noUncheckedIndexedAccess) or passes its eslint no-explicit-any rule. Same set
   the character factory needs, for the same reason.

2. ATTACHMENT_FIX: as shipped, makeAttachmentEndpoint turns EVERY component that
   carries a joint record into a tapered cylinder spanning localStart to localEnd,
   and replaces its authored transform with the endpoint. That is right for a
   tube-network member and wrong for every part of this prop, whose form lives in a
   measured lathe, sweep or extrude profile: it would discard the poll's stepped
   drum, both claw sweeps, the collar band and the pivot ring. The spec records
   `attachment.geometryFromEndpoint: false` on those parts and this edit makes the
   helper honour it. Recorded as a required refine-code edit in the spec's risks.

3. BUDGET_GEOMETRY, applied only from the optimization pass onward, because cutting
   tessellation is a budget decision the earlier passes should not silently make.

Run:  python apply_refinements.py [--optimize] [path-to-createHammerModel.ts]
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
DEFAULT_TARGET = PROJECT / "components" / "game" / "models" / "createHammerModel.ts"
MARKER = "// --- img2threejs refine-code edits applied by assets/reference/hammer/apply_refinements.py"

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
    ("    shape.moveTo(points[0][0], points[0][1]);",
     "    shape.moveTo(points[0]![0], points[0]![1]);", False),
    ("      shape.lineTo(points[i][0], points[i][1]);",
     "      shape.lineTo(points[i]![0], points[i]![1]);", False),
    ("    path.moveTo(loop[0][0], loop[0][1]);",
     "    path.moveTo(loop[0]![0], loop[0]![1]);", False),
    ("    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);",
     "    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i]![0], loop[i]![1]);", False),
    ("    shape.moveTo(cs[0][0], cs[0][1]);",
     "    shape.moveTo(cs[0]![0], cs[0]![1]);", False),
    ("    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);",
     "    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i]![0], cs[i]![1]);", False),
]

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

ATTACHMENT_OLD = """function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;"""
ATTACHMENT_NEW = """function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  // The joint record documents that the part touches its parent. It does not
  // describe the part's form: these parts carry measured lathe, sweep and tube
  // profiles, and deriving a tapered cylinder from the endpoints would throw all
  // of that away. Only a part whose form genuinely IS a straight member should
  // take its geometry from here.
  if (record.geometryFromEndpoint === false) return null;"""

# optimization-pass budget. The generator's defaults are hero-render tessellation:
# a 64x40 sphere is 5120 triangles and a 48x16 cylinder is 1536, which is far more
# than a prop this size needs at play distance. The claw crescent sets the floor on
# the sweep steps, so those are left alone.
BUDGET_GEOMETRY = [
    ("new THREE.SphereGeometry(0.5, 64, 40)", "new THREE.SphereGeometry(0.5, 20, 14)"),
    ("new THREE.BoxGeometry(1, 1, 1, 12, 12, 12)", "new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)"),
    ("new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16)", "new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 3)"),
    ("new THREE.CapsuleGeometry(0.35, 0.7, 16, 32)", "new THREE.CapsuleGeometry(0.35, 0.7, 6, 20)"),
    ("new THREE.TorusGeometry(0.45, 0.08, 24, 96)", "new THREE.TorusGeometry(0.45, 0.08, 8, 24)"),
]


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

    if ATTACHMENT_OLD not in source:
        raise SystemExit("makeAttachmentEndpoint anchor missing, generator output changed")
    source = source.replace(ATTACHMENT_OLD, ATTACHMENT_NEW)

    if optimize:
        for anchor, replacement in BUDGET_GEOMETRY:
            source = source.replace(anchor, replacement)

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
