#!/usr/bin/env python3
"""Run one sculpt pass end to end for one prop.

Author spec -> strict-validate -> generate factory -> apply refine-code edits -> compile
the preview harness -> render -> Tier 1 -> comparison sheet. Kept as one script because
skipping the harness compile step silently renders the previous pass's JavaScript, and
skipping Tier 1 leaves the comparison sheet ungated.

Run: python build_pass.py <prop> <pass-id> [--views reference,top,rear] [--skip-author]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")

FACTORY = {
    "ball": "createBeachBallModel.ts",
    "soap": "createSoapDishModel.ts",
    "fridge": "createRefrigeratorModel.ts",
    "toilet": "createToiletModel.ts",
    "spring": "createSpringModel.ts",
    "fan": "createFloorFanModel.ts",
    "vacuum": "createVacuumModel.ts",
}
REFERENCE = {
    "ball": "ball-reference.png",
    "soap": "soap-reference.png",
    "fridge": "fridge-reference.png",
    "toilet": "toilet-reference.png",
    "spring": "spring-reference.png",
    "fan": "floorfan-reference.png",
    "vacuum": "vacuum-reference.png",
}


def run(argv: list[str], cwd: Path, label: str, filter_prefix: tuple[str, ...] = ()) -> str:
    result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
    output = result.stdout + result.stderr
    if result.returncode != 0:
        sys.stdout.write(output)
        raise SystemExit(f"{label} failed with exit code {result.returncode}")
    if filter_prefix:
        for line in output.splitlines():
            if any(token in line for token in filter_prefix):
                print(line)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prop", choices=sorted(FACTORY))
    parser.add_argument("pass_id")
    parser.add_argument("--views", default="reference,reference:clay")
    parser.add_argument("--skip-author", action="store_true")
    args = parser.parse_args()

    prop = args.prop
    spec = HERE / f"{prop}-sculpt-spec.json"
    factory = PROJECT / "components" / "game" / "models" / FACTORY[prop]
    reference = PROJECT / "assets" / "reference" / REFERENCE[prop]
    renders = HERE / "renders" / prop
    renders.mkdir(parents=True, exist_ok=True)

    if not args.skip_author:
        run([sys.executable, str(HERE / f"author_{prop}_spec.py")], HERE, "author",
            ("wrote", "components="))
        run([sys.executable, str(SKILL / "forge/stage2_spec/validate_sculpt_spec.py"), str(spec),
             "--strict-quality"], SKILL, "strict-quality", ("PASS", "FAIL", "error"))

    run([sys.executable, str(SKILL / "forge/stage3_build/generate_threejs_factory.py"), str(spec),
         "--out", str(factory), "--pass-id", args.pass_id, "--force"], SKILL, "generate")
    run([sys.executable, str(HERE / "refine_props.py"), str(factory)], HERE, "refine", (".ts:",))

    preview = HERE / "preview"
    tsc = run(["npx.cmd", "tsc", "-p", "tsconfig.json"], preview, "tsc")
    for line in tsc.splitlines():
        if " error TS" in line:
            print(line)

    views = args.views.split(",")
    run(["node", "shoot.mjs", prop, f"../renders/{prop}", args.pass_id, *views], preview, "shoot",
        ("triangles=", "pageerror"))

    render = renders / f"{args.pass_id}-reference.png"
    clay = renders / f"{args.pass_id}-reference-clay.png"
    diagnose = [sys.executable, str(SKILL / "forge/stage4_review/diagnose_render.py"),
                "--reference", str(reference), "--render", str(render),
                "--spec", str(spec), "--pass-id", args.pass_id, "--in-place"]
    if clay.exists():
        diagnose += ["--map-stripped-render", str(clay)]
    run(diagnose, SKILL, "diagnose",
        ('"passed"', "silhouetteIoU", "aspectRatioDelta", "scaleDelta", "maxDeltaE", "failures"))

    run([sys.executable, str(SKILL / "forge/stage4_review/make_comparison_sheet.py"),
         "--reference", str(reference), "--render", str(render),
         "--out", str(renders / f"{args.pass_id}-cmp.png")], SKILL, "comparison-sheet")
    print(f"comparison sheet: {renders / f'{args.pass_id}-cmp.png'}")


if __name__ == "__main__":
    main()
