#!/usr/bin/env python3
"""Bound each named part of a reference photo by its albedo.

measure_regions.py finds WHICH colours are present by k-means; this takes the
colours it found, names them, and reports the geometry a spec actually needs:
per-part bounding box, and the part's row and column extents at chosen
fractions of its own box. That is what turns "the coil sits inside the base
recess" into a pair of numbers a component transform can be written from.

Nearest-anchor classification rather than k-means, because a part's lit and
shaded faces are two clusters of one part and have to be pooled. Pass every
shade of a part as a repeated --part with the same name.

Run: python measure_parts.py <image> --part name:#RRGGBB [--part ...]
                             [--rows 0.1,0.5] [--cols 0.5]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")
sys.path.insert(0, str(SKILL / "forge" / "stage1_intake"))

from extract_pbr_evidence import build_foreground_mask, load_image  # noqa: E402


def parse_anchor(text: str) -> tuple[str, tuple[int, int, int]]:
    name, _, hex_colour = text.partition(":")
    value = hex_colour.strip().lstrip("#")
    return name, (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--part", action="append", required=True,
                        help="name:#RRGGBB, repeatable; repeat a name to pool its shades")
    parser.add_argument("--rows", default="0.0,0.25,0.5,0.75,1.0")
    parser.add_argument("--cols", default="0.5")
    # A part's raw bbox is set by whichever stray pixel of an antialiased edge or a
    # contact shadow landed nearest its anchor, and one stray pixel moved the spring
    # base's measured top 250px and its implied thickness from 0.19D to 0.44D. A row
    # has to carry a real run of the part to count as part of it.
    parser.add_argument("--min-run", type=int, default=8,
                        help="pixels a row/column must own before it bounds the part")
    args = parser.parse_args()

    anchors = [parse_anchor(item) for item in args.part]
    width, height, pixels, _warnings = load_image(Path(args.image))
    mask, _diag, _warn = build_foreground_mask(width, height, pixels)

    # One membership list per distinct part name, in first-seen order.
    names: list[str] = []
    for name, _ in anchors:
        if name not in names:
            names.append(name)
    owned: dict[str, list[tuple[int, int]]] = {name: [] for name in names}

    for y in range(height):
        for x in range(width):
            if not mask[y * width + x]:
                continue
            r, g, b = pixels[y * width + x][:3]
            best_name, best_distance = names[0], 1e18
            for name, (ar, ag, ab) in anchors:
                distance = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2
                if distance < best_distance:
                    best_name, best_distance = name, distance
            owned[best_name].append((x, y))

    total = sum(len(points) for points in owned.values())
    silhouette_x = [x for points in owned.values() for x, _ in points]
    silhouette_y = [y for points in owned.values() for _, y in points]
    box = {"x0": min(silhouette_x), "x1": max(silhouette_x),
           "y0": min(silhouette_y), "y1": max(silhouette_y)}
    box["width"] = box["x1"] - box["x0"] + 1
    box["height"] = box["y1"] - box["y0"] + 1

    report: dict[str, object] = {"image": args.image, "imageSize": [width, height],
                                 "silhouetteBox": box, "parts": {}}
    parts: dict[str, object] = {}
    for name in names:
        points = owned[name]
        if not points:
            parts[name] = {"pixelShare": 0.0}
            continue
        by_row: dict[int, list[int]] = {}
        by_col: dict[int, list[int]] = {}
        for x, y in points:
            by_row.setdefault(y, []).append(x)
            by_col.setdefault(x, []).append(y)
        solid_rows = sorted(y for y, run in by_row.items() if len(run) >= args.min_run)
        solid_cols = sorted(x for x, run in by_col.items() if len(run) >= args.min_run)
        if not solid_rows or not solid_cols:
            parts[name] = {"pixelShare": round(len(points) / total, 4),
                           "note": f"no row carries {args.min_run} pixels of this part"}
            continue
        y0, y1 = solid_rows[0], solid_rows[-1]
        x0, x1 = solid_cols[0], solid_cols[-1]
        rows = {}
        for fraction in [float(f) for f in args.rows.split(",")]:
            y = y0 + int(fraction * (y1 - y0))
            run = [x for x, py in points if py == y]
            if run:
                rows[f"{fraction:g}"] = {"y": y, "x0": min(run), "x1": max(run),
                                         "width": max(run) - min(run) + 1}
        cols = {}
        for fraction in [float(f) for f in args.cols.split(",")]:
            x = x0 + int(fraction * (x1 - x0))
            run = [y for px, y in points if px == x]
            if run:
                cols[f"{fraction:g}"] = {"x": x, "y0": min(run), "y1": max(run),
                                         "height": max(run) - min(run) + 1}
        parts[name] = {
            "pixelShare": round(len(points) / total, 4),
            "bbox": {"x0": x0, "x1": x1, "y0": y0, "y1": y1,
                     "width": x1 - x0 + 1, "height": y1 - y0 + 1},
            "fractionOfSilhouette": {
                "x0": round((x0 - box["x0"]) / box["width"], 4),
                "x1": round((x1 - box["x0"]) / box["width"], 4),
                "y0": round((y0 - box["y0"]) / box["height"], 4),
                "y1": round((y1 - box["y0"]) / box["height"], 4),
            },
            "rows": rows,
            "cols": cols,
        }
    report["parts"] = parts
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
