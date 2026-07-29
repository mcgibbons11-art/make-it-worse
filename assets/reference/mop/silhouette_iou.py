#!/usr/bin/env python3
"""Silhouette IoU between the reference and a render, for the vertical-scale sweep.

diagnose_render.py is the pipeline's Tier-1 authority and its result is what gets
recorded, but it takes minutes per call in pure Python, which is too slow to sweep a
parameter over seven values. This computes just the one number the sweep needs.

Both images are reduced to an object mask against their own flat backdrop, each mask is
normalised onto its own bounding box, and the two are compared on a common grid. That
normalisation is deliberate: the harness already fits the camera so the projected
bounding boxes agree, so what is left to measure is SHAPE, not framing or scale.

Run: python silhouette_iou.py <render.png> [more.png ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

from measure_reference import IMAGE, background_colour, is_object, read_png_rgb

GRID = 220
TOLERANCE = 6


def mask_on_grid(path: Path) -> list[list[bool]]:
    width, height, rows = read_png_rgb(path)
    background = background_colour(rows, width, height)

    min_x, max_x, min_y, max_y = width, -1, height, -1
    spans: dict[int, list[int]] = {}
    for y in range(height):
        row = rows[y]
        xs = [x for x in range(width) if is_object(row[x], background, TOLERANCE)]
        if not xs:
            continue
        spans[y] = xs
        min_y, max_y = min(min_y, y), max(max_y, y)
        min_x, max_x = min(min_x, xs[0]), max(max_x, xs[-1])
    if max_x < 0:
        raise SystemExit(f"{path}: no object pixels found against the backdrop")

    box_w = max_x - min_x + 1
    box_h = max_y - min_y + 1
    grid = [[False] * GRID for _ in range(GRID)]
    for y, xs in spans.items():
        gy = int((y - min_y) / box_h * GRID)
        if not (0 <= gy < GRID):
            continue
        target = grid[gy]
        for x in xs:
            gx = int((x - min_x) / box_w * GRID)
            if 0 <= gx < GRID:
                target[gx] = True
    return grid


def iou(a: list[list[bool]], b: list[list[bool]]) -> tuple[float, float, float]:
    intersection = union = only_a = 0
    for row_a, row_b in zip(a, b):
        for pixel_a, pixel_b in zip(row_a, row_b):
            if pixel_a or pixel_b:
                union += 1
                if pixel_a and pixel_b:
                    intersection += 1
                elif pixel_a:
                    only_a += 1
    return (
        intersection / union if union else 0.0,
        only_a / union if union else 0.0,
        (union - intersection - only_a) / union if union else 0.0,
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: python silhouette_iou.py <render.png> [more.png ...]")
    reference = mask_on_grid(IMAGE)
    for argument in sys.argv[1:]:
        path = Path(argument)
        score, reference_only, render_only = iou(reference, mask_on_grid(path))
        print(f"{path.name:56s} IoU={score:.4f}  refOnly={reference_only:.4f}  renderOnly={render_only:.4f}")


if __name__ == "__main__":
    main()
