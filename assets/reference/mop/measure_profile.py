#!/usr/bin/env python3
"""Turn the reference silhouette into an object-space radius/height profile.

Why this and not the bounding boxes in measure_reference.py: a region's bounding box
mixes every azimuth together, so the navy band's box top is the band where it curves
away at the sides and its box bottom is the band at the front. Neither is a height.

At the object's left and right silhouette extremes the visible generator is the
profile at z=0, and there a screen row maps to one object height with no depth term:
    screen_y = C - y * cos(e) * s
So scanning those two columns gives the true vertical order and spacing of the bands,
and scanning every row's half-width gives radius as a function of height.

Run: python measure_profile.py   (after measure_reference.py)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from measure_reference import (
    BACKGROUND_TOLERANCE,
    FRINGE_TOLERANCE,
    IMAGE,
    background_colour,
    classify,
    is_object,
    read_png_rgb,
)

HERE = Path(__file__).resolve().parent
MEASUREMENTS = HERE / "evidence" / "measurements.json"
OUT = HERE / "evidence" / "profile.json"

# Columns to scan for the vertical band order, as an offset in pixels inward from the
# silhouette's left and right edges. Far enough in to clear the antialiased rim, close
# enough that the visible surface is still near the z=0 generator.
EDGE_INSET = 26


def band_scan(rows, background, x: int, y0: int, y1: int) -> list[dict]:
    bands: list[dict] = []
    current = None
    for y in range(y0, y1 + 1):
        pixel = rows[y][x]
        name = classify(pixel) if is_object(pixel, background, BACKGROUND_TOLERANCE) else "background"
        if current is None or current["region"] != name:
            current = {"region": name, "startY": y, "endY": y}
            bands.append(current)
        else:
            current["endY"] = y
    return [b for b in bands if b["endY"] - b["startY"] >= 2]


def main() -> None:
    measurements = json.loads(MEASUREMENTS.read_text(encoding="utf-8"))
    silhouette = measurements["silhouette"]
    elevation = math.radians(measurements["cameraElevationDegFromDeckEllipse"])
    cos_e, sin_e = math.cos(elevation), math.sin(elevation)

    width, height, rows = read_png_rgb(IMAGE)
    background = background_colour(rows, width, height)

    min_x, max_x = silhouette["minX"], silhouette["maxX"]
    min_y, max_y = silhouette["minY"], silhouette["maxY"]

    # ---- radius as a function of screen row ----
    profile: list[dict] = []
    for y in range(min_y, max_y + 1):
        row = rows[y]
        xs = [x for x in range(min_x, max_x + 1) if is_object(row[x], background, FRINGE_TOLERANCE)]
        if not xs:
            continue
        profile.append({"y": y, "minX": xs[0], "maxX": xs[-1],
                        "halfWidthPx": (xs[-1] - xs[0]) / 2.0,
                        "centreX": (xs[0] + xs[-1]) / 2.0})

    widest = max(profile, key=lambda p: p["halfWidthPx"])

    # Screen y of the object's vertical datum. The deck plane's projected centre is the
    # cleanest datum available because it was solved from a full ellipse rather than a
    # single edge: deck centre screen y = C - y_deck * cos(e) * s.
    deck = measurements["regions"]["deck-green"]
    deck_centre_y = (deck["minY"] + deck["maxY"]) / 2.0
    deck_radius_px = deck["widthPx"] / 2.0

    # ---- vertical band order at the two side generators ----
    left_x = min_x + EDGE_INSET
    right_x = max_x - EDGE_INSET
    left_bands = band_scan(rows, background, left_x, min_y, max_y)
    right_bands = band_scan(rows, background, right_x, min_y, max_y)

    def to_object_height(screen_y: float) -> float:
        """Object height relative to the deck plane, in pixels (positive = above)."""
        return (deck_centre_y - screen_y) / cos_e

    for bands in (left_bands, right_bands):
        for band in bands:
            band["topHeightPx"] = round(to_object_height(band["startY"]), 2)
            band["bottomHeightPx"] = round(to_object_height(band["endY"]), 2)
            band["thicknessPx"] = round(band["topHeightPx"] - band["bottomHeightPx"], 2)

    # ---- overall extents in object space ----
    # Top of silhouette is the far rim edge, which carries a +R*sin(e) depth term, so it
    # is NOT a height; the honest vertical extents come from the side generators.
    side_bands = [b for b in left_bands + right_bands if b["region"] != "background"]
    top_height = max(b["topHeightPx"] for b in side_bands)
    bottom_height = min(b["bottomHeightPx"] for b in side_bands)

    result = {
        "elevationDeg": round(math.degrees(elevation), 2),
        "deckCentreScreenY": deck_centre_y,
        "deckRadiusPx": deck_radius_px,
        "widestRow": widest,
        "maxHalfWidthPx": widest["halfWidthPx"],
        "shellHalfWidthPx": measurements["regions"]["shell-cream"]["widthPx"] / 2.0,
        "objectHeightPx": round(top_height - bottom_height, 2),
        "topHeightAboveDeckPx": round(top_height, 2),
        "bottomHeightBelowDeckPx": round(bottom_height, 2),
        "heightOverDiameter": round((top_height - bottom_height) / (widest["halfWidthPx"] * 2), 4),
        "deckOverShellRadius": round(deck_radius_px / widest["halfWidthPx"], 4),
        "leftGeneratorBands": left_bands,
        "rightGeneratorBands": right_bands,
        "radiusProfileSample": profile[:: max(1, len(profile) // 40)],
    }
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "radiusProfileSample"}, indent=2))


if __name__ == "__main__":
    main()
