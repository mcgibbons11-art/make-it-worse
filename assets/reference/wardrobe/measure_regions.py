#!/usr/bin/env python3
"""Bound each colour region of a reference photo.

The props in this set are flat-shaded studio renders whose parts are separated
by hue, so clustering the foreground by colour gives per-part pixel extents
directly. That is what turns "the base looks about a third of the height" into a
measured number a spec can cite.

k is the number of albedo zones the image analysis identified. Output per
cluster: mean sRGB, pixel share, bounding box, and the box as a fraction of the
whole silhouette box, which is the form the spec's measurementBasis uses.

Run: python measure_regions.py <image> --k 4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")
sys.path.insert(0, str(SKILL / "forge" / "stage1_intake"))

from extract_pbr_evidence import build_foreground_mask, load_image  # noqa: E402


def kmeans(samples: list[tuple[float, float, float]], k: int, seed: int = 7,
           iterations: int = 24) -> list[tuple[float, float, float]]:
    """Plain Lloyd's algorithm on sRGB. Deterministic: centres start at evenly
    spaced samples of the sorted-by-luma population, so a re-run reproduces the
    same clusters."""
    ordered = sorted(samples, key=lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    centres = [ordered[min(len(ordered) - 1, (i * len(ordered)) // k + len(ordered) // (2 * k))]
               for i in range(k)]
    for _ in range(iterations):
        sums = [[0.0, 0.0, 0.0, 0] for _ in range(k)]
        for r, g, b in samples:
            best, best_d = 0, 1e18
            for i, (cr, cg, cb) in enumerate(centres):
                d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
                if d < best_d:
                    best, best_d = i, d
            sums[best][0] += r
            sums[best][1] += g
            sums[best][2] += b
            sums[best][3] += 1
        moved = 0.0
        for i, (sr, sg, sb, n) in enumerate(sums):
            if n == 0:
                continue
            nxt = (sr / n, sg / n, sb / n)
            moved += abs(nxt[0] - centres[i][0]) + abs(nxt[1] - centres[i][1]) + abs(nxt[2] - centres[i][2])
            centres[i] = nxt
        if moved < 0.5:
            break
    return centres


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--k", type=int, default=4)
    parser.add_argument("--stride", type=int, default=2, help="pixel stride when fitting centres")
    args = parser.parse_args()

    width, height, pixels, _warnings = load_image(Path(args.image))
    mask, _diag, _warn = build_foreground_mask(width, height, pixels)

    foreground = [(x, y) for y in range(height) for x in range(width) if mask[y * width + x]]
    xs = [p[0] for p in foreground]
    ys = [p[1] for p in foreground]
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
    box_w, box_h = bx1 - bx0 + 1, by1 - by0 + 1

    def rgb(x: int, y: int) -> tuple[float, float, float]:
        r, g, b = pixels[y * width + x][:3]
        return (float(r), float(g), float(b))

    centres = kmeans([rgb(x, y) for (x, y) in foreground[:: args.stride]], args.k)

    clusters: list[dict[str, object]] = []
    members: list[list[tuple[int, int]]] = [[] for _ in centres]
    for x, y in foreground:
        r, g, b = rgb(x, y)
        best, best_d = 0, 1e18
        for i, (cr, cg, cb) in enumerate(centres):
            d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
            if d < best_d:
                best, best_d = i, d
        members[best].append((x, y))

    for centre, group in zip(centres, members):
        if not group:
            continue
        gx = [p[0] for p in group]
        gy = [p[1] for p in group]
        x0, x1, y0, y1 = min(gx), max(gx), min(gy), max(gy)
        clusters.append({
            "hex": "#%02X%02X%02X" % tuple(int(round(c)) for c in centre),
            "rgb": [round(c, 1) for c in centre],
            "pixelShare": round(len(group) / len(foreground), 4),
            "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
            "fractionOfSilhouette": {
                "x0": round((x0 - bx0) / box_w, 4),
                "x1": round((x1 - bx0 + 1) / box_w, 4),
                "y0": round((y0 - by0) / box_h, 4),
                "y1": round((y1 - by0 + 1) / box_h, 4),
            },
        })
    clusters.sort(key=lambda c: -float(c["pixelShare"]))  # type: ignore[arg-type]

    print(json.dumps({
        "image": args.image,
        "silhouetteBox": {"x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                          "width": box_w, "height": box_h},
        "clusters": clusters,
    }, indent=2))


if __name__ == "__main__":
    main()
