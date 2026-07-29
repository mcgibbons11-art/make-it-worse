#!/usr/bin/env python3
"""Solve the mop's height from the silhouette, with the cap radii bounded.

The height cannot be read off the silhouette's pixel span. The topmost silhouette
point is the FAR rim edge and the bottom-most is the NEAR fringe edge, so the 621px
span carries a depth term from both caps:

    span = H*cos(e)*s + (R_top + R_bottom)*sin(e)*s

so H needs R_top and R_bottom. Both are fitted from the outline near each cap.

Two constraints keep the fit honest, and the first version of this script had
neither, which is why it returned cap radii of 1.12x and 1.51x the object's own max
half-width and an impossible H/D of 0.015:

  * no horizontal circle on this solid can be wider than the silhouette's widest row,
    so each cap radius is bounded above by maxHalfWidth;
  * the top rim is inset from the widest bulge, so its edge stops generating the
    silhouette part-way down. The fit therefore scores only rows near the apex and
    ignores rows where the wall has taken over the outline.

The fit is weakly conditioned near an apex, so the result is reported as a range
rather than a single number, and the spec treats it as a starting proportion that the
build loop's vertical-scale sweep refines against silhouette IoU.

Run: python fit_ellipses.py   (after measure_reference.py)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from measure_reference import (
    FRINGE_TOLERANCE,
    IMAGE,
    background_colour,
    is_object,
    read_png_rgb,
)

HERE = Path(__file__).resolve().parent
MEASUREMENTS = HERE / "evidence" / "measurements.json"
OUT = HERE / "evidence" / "ellipse-fit.json"

# Rows from the apex that take part in a cap fit. Beyond this the side wall, not the
# cap edge, generates the outline.
CAP_ROWS = 40
# A candidate whose RMS is within this multiple of the best is treated as an equally
# admissible fit, and the spread across those candidates becomes the reported band.
ADMISSIBLE = 1.35


def cap_candidates(
    outline: dict[int, float], apex_y: int, sin_e: float, lower: float, upper: float, downward: bool
) -> list[tuple[float, float]]:
    """Score every cap radius in [lower, upper]. Returns (radius, rms) pairs."""
    rows = (
        [apex_y + d for d in range(CAP_ROWS)]
        if downward
        else [apex_y - d for d in range(CAP_ROWS)]
    )
    rows = [y for y in rows if y in outline]
    scored: list[tuple[float, float]] = []
    radius = lower
    while radius <= upper:
        centre = apex_y + radius * sin_e if downward else apex_y - radius * sin_e
        total = 0.0
        count = 0
        for y in rows:
            dy = (y - centre) / (radius * sin_e)
            if abs(dy) > 1.0:
                continue
            predicted = radius * math.sqrt(max(0.0, 1.0 - dy * dy))
            # The cap ellipse can never lie outside the silhouette; if it does, this
            # candidate is wrong rather than merely imprecise.
            if predicted > outline[y] + 3.0:
                total += (predicted - outline[y]) ** 2 * 4.0
            else:
                total += (predicted - outline[y]) ** 2
            count += 1
        if count >= 10:
            scored.append((radius, math.sqrt(total / count)))
        radius += 0.5
    return scored


def main() -> None:
    measurements = json.loads(MEASUREMENTS.read_text(encoding="utf-8"))
    silhouette = measurements["silhouette"]
    elevation = math.radians(measurements["cameraElevationDegFromDeckEllipse"])
    sin_e, cos_e = math.sin(elevation), math.cos(elevation)

    width, height, rows = read_png_rgb(IMAGE)
    background = background_colour(rows, width, height)
    min_x, max_x = silhouette["minX"], silhouette["maxX"]
    min_y, max_y = silhouette["minY"], silhouette["maxY"]

    outline: dict[int, float] = {}
    for y in range(min_y, max_y + 1):
        row = rows[y]
        xs = [x for x in range(min_x, max_x + 1) if is_object(row[x], background, FRINGE_TOLERANCE)]
        if xs:
            outline[y] = (xs[-1] - xs[0]) / 2.0

    max_half_width = max(outline.values())
    deck_radius = measurements["regions"]["deck-green"]["widthPx"] / 2.0

    # The top rim edge lies between the green deck's edge and the widest bulge; the
    # fringe's bottom ring lies between two thirds of the bulge and the bulge itself.
    top = cap_candidates(outline, min_y, sin_e, deck_radius, max_half_width, downward=True)
    bottom = cap_candidates(outline, max_y, sin_e, max_half_width * 0.66, max_half_width, downward=False)

    def band(scored: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        best_radius, best_rms = min(scored, key=lambda item: item[1])
        admissible = [r for r, rms in scored if rms <= best_rms * ADMISSIBLE]
        return best_radius, best_rms, min(admissible), max(admissible)

    top_r, top_rms, top_lo, top_hi = band(top)
    bottom_r, bottom_rms, bottom_lo, bottom_hi = band(bottom)

    span = max_y - min_y
    diameter = max_half_width * 2

    def solve_height(r_top: float, r_bottom: float) -> float:
        return (span - (r_top + r_bottom) * sin_e) / cos_e

    height_px = solve_height(top_r, bottom_r)
    # Larger cap radii eat more of the span, so they give the SHORTER object.
    height_lo = solve_height(top_hi, bottom_hi)
    height_hi = solve_height(top_lo, bottom_lo)

    result = {
        "elevationDeg": round(math.degrees(elevation), 2),
        "silhouetteSpanPx": span,
        "maxHalfWidthPx": max_half_width,
        "deckRadiusPx": deck_radius,
        "topCap": {"radiusPx": round(top_r, 2), "rmsPx": round(top_rms, 3),
                   "admissibleRangePx": [round(top_lo, 2), round(top_hi, 2)],
                   "overMaxRadius": round(top_r / max_half_width, 4)},
        "bottomCap": {"radiusPx": round(bottom_r, 2), "rmsPx": round(bottom_rms, 3),
                      "admissibleRangePx": [round(bottom_lo, 2), round(bottom_hi, 2)],
                      "overMaxRadius": round(bottom_r / max_half_width, 4)},
        "objectHeightPx": round(height_px, 2),
        "objectHeightRangePx": [round(height_lo, 2), round(height_hi, 2)],
        "objectDiameterPx": diameter,
        "heightOverDiameter": round(height_px / diameter, 4),
        "heightOverDiameterRange": [round(height_lo / diameter, 4), round(height_hi / diameter, 4)],
        "deckOverMaxRadius": round(deck_radius / max_half_width, 4),
        "note": (
            "Cap radii bounded by the silhouette's own max half-width. H/D is a starting "
            "proportion with a real uncertainty band, not a precise measurement; the build "
            "loop refines it by sweeping vertical scale against silhouette IoU."
        ),
    }
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
