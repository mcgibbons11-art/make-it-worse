#!/usr/bin/env python3
"""Claim and admit one wear-*.png reference.

Two gates, in order, and the second one is the one that matters here:

1. The skill's own admission and probe checks (empty / tiny / fragmented /
   undecodable / duplicate).
2. A HUMAN-VISION check that the image contains only the garment its filename
   names. The generating agent's ChatGPT composer draft was shared across tabs,
   so some references are silent splices of two prompts. An image showing a
   hoodie AND a floor lamp is unique, non-empty and non-fragmented: it passes
   every automated gate there is. Only opening it catches that, so this script
   deliberately stops and refuses to record a verdict on its own.

usage: python admit.py <stem>          # e.g. python admit.py wear-hoodie
       python admit.py <stem> --verdict pass|mashup|reject --note "..."
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFERENCE_DIR = HERE.parent
SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")
AGENT = "FLEET-C"


def claim(stem: str) -> Path:
    """Create the claim directory, or refuse if someone else got there first."""
    target = REFERENCE_DIR / stem
    marker = target / "CLAIMED-BY.txt"
    if marker.exists():
        owner = marker.read_text(encoding="utf-8").strip()
        if owner != AGENT:
            raise SystemExit(f"{stem} already claimed by {owner}")
        return target
    target.mkdir(parents=True, exist_ok=True)
    marker.write_text(AGENT + "\n", encoding="utf-8")
    print(f"claimed {stem} for {AGENT}")
    return target


def run(script: str, *arguments: str) -> tuple[int, str]:
    result = subprocess.run(
        [sys.executable, str(SKILL / script), *arguments],
        capture_output=True, text=True, cwd=str(SKILL),
    )
    return result.returncode, (result.stdout + result.stderr).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stem")
    parser.add_argument("--verdict", choices=["pass", "mashup", "reject"])
    parser.add_argument("--note", default="")
    args = parser.parse_args()

    image = REFERENCE_DIR / f"{args.stem}.png"
    if not image.exists():
        raise SystemExit(f"no such reference: {image}")

    target = claim(args.stem)
    digest = hashlib.md5(image.read_bytes()).hexdigest()

    admission_code, admission_text = run(
        "forge/stage1_intake/check_reference_admission.py", str(image))
    probe_code, probe_text = run("forge/stage1_intake/probe_image.py", str(image))

    record = {
        "stem": args.stem,
        "image": str(image),
        "md5": digest,
        "bytes": image.stat().st_size,
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "automatedAdmission": {"exitCode": admission_code, "output": admission_text},
        "probe": {"exitCode": probe_code, "output": probe_text},
        "contentVerdict": args.verdict,
        "contentNote": args.note,
        "contentCheckRule": "The reference must show ONLY the garment its filename names. "
                            "md5 uniqueness and check_reference_admission.py both pass on a "
                            "two-prompt mashup, so this verdict comes from opening the image.",
    }
    out = target / "admission.json"
    out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    print(f"md5 {digest}  {record['bytes']} bytes")
    print(f"admission exit={admission_code}")
    print(admission_text[:600])
    print(f"probe exit={probe_code}")
    print(probe_text[:600])
    if args.verdict is None:
        print()
        print(f"OPEN {image} AND CONFIRM IT SHOWS ONLY: {args.stem.removeprefix('wear-')}")
        print(f"then re-run with --verdict pass|mashup|reject --note '...'")
    else:
        print(f"content verdict recorded: {args.verdict} {args.note}")


if __name__ == "__main__":
    main()
