#!/usr/bin/env python3
"""Append one sculpt-pass review from a JSON payload.

`append_review.py` takes a dozen flags, several of them semicolon-joined lists and two
of them JSON files. Driving that from a shell across Windows quoting is where reviews get
silently mangled, so the review is written as JSON and this script expands it.

Run: python review_pass.py <prop> <review.json>
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")

REFERENCE = {
    "ball": "ball-reference.png",
    "soap": "soap-reference.png",
    "fridge": "fridge-reference.png",
    "toilet": "toilet-reference.png",
    "spring": "spring-reference.png",
    "fan": "floorfan-reference.png",
    "vacuum": "vacuum-reference.png",
}


def main() -> None:
    prop, payload_path = sys.argv[1], Path(sys.argv[2])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    spec = HERE / f"{prop}-sculpt-spec.json"
    reference = PROJECT / "assets" / "reference" / REFERENCE[prop]
    renders = HERE / "renders" / prop

    layer_file = renders / f"layers-{payload['passId']}.json"
    layer_file.write_text(json.dumps(payload["layerScores"]), encoding="utf-8")
    feature_file = renders / f"features-{payload['passId']}.json"
    feature_file.write_text(json.dumps(payload["featureReviews"]), encoding="utf-8")

    argv = [
        sys.executable, str(SKILL / "forge" / "stage4_review" / "append_review.py"), str(spec),
        "--pass-id", payload["passId"],
        "--fidelity", str(payload["fidelity"]),
        "--action", payload["action"],
        "--summary", payload["summary"],
        "--reference-screenshot", str(reference),
        "--render-screenshot", str(renders / payload["render"]),
        "--comparison-image", str(renders / payload["comparison"]),
        "--ai-vision-score", str(payload["aiVisionScore"]),
        "--visual-threshold", "0.7",
        "--camera-view", payload["cameraView"],
        "--layer-scores-json", str(layer_file),
        "--feature-reviews-json", str(feature_file),
        "--ai-vision-notes", payload["notes"],
        "--matched", "; ".join(payload.get("matched", [])),
        "--mismatches", "; ".join(payload.get("mismatches", [])),
        "--in-place",
    ]
    for key, flag in (("specFixes", "--spec-fixes"), ("codeFixes", "--code-fixes"),
                      ("evidence", "--evidence")):
        if payload.get(key):
            argv += [flag, "; ".join(payload[key])]
    if payload.get("mapStrippedRender"):
        argv += ["--map-stripped-render", str(renders / payload["mapStrippedRender"])]
    # For re-reviewing an ALREADY-COMPLETED pass whose geometry has since changed. Without
    # it append_review refuses, which is the right default: it stops a pass being re-scored
    # casually. But when a ruling reverts geometry after the pass was earned, the ledger's
    # newest entry describes a build that no longer exists, and leaving that standing is the
    # worse failure. Set it deliberately and say why in the review's notes.
    #
    # PIPELINE LIMITATION THIS CANNOT FIX, and the reason the note matters: a refile does not
    # RE-LOCK the pass. orchestrate_passes.completed_passes asks any() across the whole
    # history, so one review with action=continue marks a pass earned permanently, however
    # much the geometry regresses afterwards. The append-only history is defensible on its
    # own terms; the gap is in what "completed" MEANS after a revert. There is no code fix
    # here - the fix is discipline. If you revert geometry under a completed pass, either
    # re-found the completion against the bar the build still clears and record that
    # reasoning, or flag plainly that it no longer holds. Silence lets it survive on
    # bureaucratic momentum.
    if payload.get("forceOutOfOrder"):
        argv += ["--force-out-of-order"]

    result = subprocess.run(argv, cwd=SKILL, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
