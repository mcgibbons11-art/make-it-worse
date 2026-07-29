#!/usr/bin/env python3
"""Post-process the generated robot-mop Three.js factory.

`forge/stage3_build/generate_threejs_factory.py` writes the factory from the sculpt
spec, but its boilerplate does not compile under this project's tsconfig, and one of its
hardcoded geometry choices is fatal for this particular model. This script applies those
edits deterministically after every generation, so the spec stays the single source of
truth and the pipeline can be re-run end to end.

1. TYPES - the generator's shared helpers index arrays directly, which fails under the
   project's `noUncheckedIndexedAccess` (16 x TS18048, 11 x TS2532, 1 x TS2322).
   Non-null assertions are added at exactly the indexing sites. No logic changes.
2. BUDGET - geometry_for() emits `SphereGeometry(0.5, 64, 40)` for every sphere, which is
   5120 triangles. This model instances 144 fringe tufts and 8 bumper end caps from that
   primitive, so unrefined it would render roughly 780k triangles for a prop the size of a
   dinner plate. The tuft base drops to an 8x5 sphere (64 triangles). Tuft COUNT is
   deliberately not reduced: count sets the scalloped silhouette pitch, which is the
   identity-defining property, and the base mesh does not.

Every mandatory replacement fails loudly if its anchor text is missing, so a generator
change cannot silently skip a fix.

Run:  python apply_refinements.py [path-to-createMopModel.ts]
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
DEFAULT_TARGET = PROJECT / "components" / "game" / "models" / "createMopModel.ts"

MARKER = "// --- img2threejs refine-code edits applied by assets/reference/mop/apply_refinements.py"

# (old, new, required)
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
    # Lathe and curve-sweep builders index their own point arrays.
    ("  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));",
     "  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x!), y!));", False),
    ("    shape.moveTo(cs[0][0], cs[0][1]);",
     "    shape.moveTo(cs[0]![0]!, cs[0]![1]!);", False),
    ("    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);",
     "    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i]![0]!, cs[i]![1]!);", False),
    # Emitted once per repetition system; absent until the pass that builds them.
    ("    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);",
     "    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);", False),
]

# A fringe tuft is a 0.019-unit blob and a bumper end cap is barely larger. Neither needs
# a 64x40 sphere, and 144 of the former at that resolution is 737k triangles on its own.
SPHERE_OLD = "new THREE.SphereGeometry(0.5, 64, 40)"
SPHERE_NEW = "new THREE.SphereGeometry(0.5, 8, 5)"


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TARGET
    source = target.read_text(encoding="utf-8")
    if MARKER in source:
        print("already refined; regenerate the factory first")
        return

    applied: list[str] = []
    missing: list[str] = []
    for old, new, required in TYPE_FIXES:
        if old in source:
            source = source.replace(old, new)
            applied.append(old.strip().split("\n")[0][:60])
        elif required:
            missing.append(old.strip().split("\n")[0][:60])

    if missing:
        raise SystemExit(
            "apply_refinements: required anchor text not found, the generator output has "
            "changed and these fixes would silently do nothing:\n  " + "\n  ".join(missing)
        )

    spheres = source.count(SPHERE_OLD)
    source = source.replace(SPHERE_OLD, SPHERE_NEW)

    source = source.replace(
        "import * as THREE from 'three';",
        f"import * as THREE from 'three';\n\n{MARKER}\n"
        f"// 1. Non-null assertions at the generator's array-indexing sites, for this\n"
        f"//    project's noUncheckedIndexedAccess. No logic changes.\n"
        f"// 2. Sphere primitives drop from 64x40 to 8x5: the fringe instances 144 of them\n"
        f"//    and the unrefined mesh would cost about 780k triangles.\n",
        1,
    )
    target.write_text(source, encoding="utf-8")
    print(f"applied {len(applied)} type fixes; sphere geometry replaced at {spheres} site(s)")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
