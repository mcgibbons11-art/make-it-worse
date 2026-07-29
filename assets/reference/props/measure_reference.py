#!/usr/bin/env python3
"""Measure a reference photo's silhouette so a spec can be authored from numbers.

Two things every prop spec needs, and neither can be eyeballed reliably:

1. The silhouette bounding box in pixels, which becomes the harness camera's
   target NDC box. diagnose_render.py rescales both images to a 224x224 grid
   without preserving aspect, so the render has to be captured at the
   reference's own pixel dimensions AND framed on the same box, or its scale
   delta swamps every shape signal.
2. Row and column extents of the mask, which is how component proportions
   (plinth height, handle length, cage diameter) get read off the image instead
   of guessed.

The foreground mask comes from the forge's own extractor so these numbers agree
with what the Tier-1 gate measures later.

Run: python measure_reference.py <image> [--rows f0,f1,...] [--cols f0,f1,...]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")
sys.path.insert(0, str(SKILL / "forge" / "stage1_intake"))

from extract_pbr_evidence import build_foreground_mask, load_image  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--rows", default="", help="comma-separated y fractions of the bbox to report")
    parser.add_argument("--cols", default="", help="comma-separated x fractions of the bbox to report")
    args = parser.parse_args()

    width, height, pixels, _warnings = load_image(Path(args.image))
    mask, _diag, _warn = build_foreground_mask(width, height, pixels)

    xs = [x for y in range(height) for x in range(width) if mask[y * width + x]]
    ys = [y for y in range(height) for x in range(width) if mask[y * width + x]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    def row_extent(y: int) -> dict[str, int] | None:
        run = [x for x in range(width) if mask[y * width + x]]
        if not run:
            return None
        return {"y": y, "x0": min(run), "x1": max(run), "width": max(run) - min(run) + 1}

    def col_extent(x: int) -> dict[str, int] | None:
        run = [y for y in range(height) if mask[y * width + x]]
        if not run:
            return None
        return {"x": x, "y0": min(run), "y1": max(run), "height": max(run) - min(run) + 1}

    report: dict[str, object] = {
        "image": args.image,
        "imageSize": [width, height],
        "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                 "width": x1 - x0 + 1, "height": y1 - y0 + 1},
        "aspect": round((x1 - x0 + 1) / (y1 - y0 + 1), 4),
        "coverage": round(len(xs) / (width * height), 4),
        # NDC box for the preview harness, which renders at the reference's own
        # pixel dimensions with camera.aspect = width / height.
        "ndc": {
            "minX": round(2 * x0 / width - 1, 4),
            "maxX": round(2 * (x1 + 1) / width - 1, 4),
            "minY": round(1 - 2 * (y1 + 1) / height, 4),
            "maxY": round(1 - 2 * y0 / height, 4),
        },
    }
    if args.rows:
        report["rows"] = [row_extent(y0 + int(float(f) * (y1 - y0))) for f in args.rows.split(",")]
    if args.cols:
        report["cols"] = [col_extent(x0 + int(float(f) * (x1 - x0))) for f in args.cols.split(",")]
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
