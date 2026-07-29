#!/usr/bin/env python3
"""Measure the floor fan's radial repetition systems off the reference image.

assessment-seed.json lists blade count, blade plan shape, guard spoke count and
gauge under `notMeasured` because a row scan cannot separate outlines that
overlap. This measures them three ways a row scan cannot.

The guard is tilted about the VERTICAL axis, so image Y is the unforeshortened
direction and every radius here is read off a vertical scan through the guard
centre. Image X is compressed and is only used for counting, never for size.

Parts are separated by THICKNESS, not by position: the hub cap, the rim tube and
the spokes have well separated local half-widths, so a distance transform splits
them without any hand-placed boxes. Spokes are then the thin components that
touch the hub; the rear cage is the thin components that do not.

Do not use the hub's own x/y ratio as the guard's foreshortening. The hub is a
domed cap, so it projects rounder than the flat circle it sits on: it measures
0.886 where the rim measures about 0.78.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, binary_dilation, distance_transform_edt, label

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / "floorfan-reference.png"
OUT = HERE / "evidence" / "radial-measurement.json"

BACKGROUND_RGB = (212, 212, 212)
BACKGROUND_TOLERANCE = 12
MINT_LEAD = 15
NAVY_BLUE_OVER_RED = 25
NAVY_BLUE_OVER_GREEN = 15

# Local half-width that separates the rim tube and hub cap from the spokes.
THICK_PART_HALF_WIDTH = 26
MIN_COMPONENT_AREA = 400
# Elliptical radius, in hub-cap semi-axis units, below which a thin mint arc is
# reaching the hub and is therefore a front spoke rather than a rear-cage arc.
SPOKE_TOUCHES_HUB_RHO = 2.0
# Bridges the spokes that chop each cream petal into slices.
PETAL_BRIDGE_RADIUS = 22


def disc(radius: int) -> np.ndarray:
    y, x = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    return x * x + y * y <= radius * radius


def runs(line: np.ndarray) -> list[tuple[int, int, int]]:
    """Contiguous True spans of a 1-D mask as (start, end, length)."""
    out: list[tuple[int, int, int]] = []
    start = None
    for i, v in enumerate(line):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1, i - start))
            start = None
    if start is not None:
        out.append((start, len(line) - 1, len(line) - start))
    return out


def main() -> int:
    rgb = np.asarray(Image.open(REFERENCE).convert("RGB")).astype(int)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    background = np.all(np.abs(rgb - np.array(BACKGROUND_RGB)) < BACKGROUND_TOLERANCE, axis=-1)
    mint = (green > red + MINT_LEAD) & (green > blue + MINT_LEAD)
    navy = (blue > red + NAVY_BLUE_OVER_RED) & (blue > green + NAVY_BLUE_OVER_GREEN)
    cream = (~background) & ~mint & ~navy

    thickness = distance_transform_edt(mint)
    hub_y, hub_x = np.unravel_index(int(np.argmax(thickness)), thickness.shape)
    hub_x, hub_y = float(hub_x), float(hub_y)

    # Hub cap ellipse by eroding: {distance >= t} of an ellipse is that ellipse
    # inset by t, so adding t back recovers the semi-axes. Averaged over several
    # t because a single threshold is one pixel row of evidence.
    hub_axes = []
    for t in (60, 80, 95):
        ys, xs = np.nonzero(thickness >= t)
        hub_axes.append(((xs.max() - xs.min()) / 2 + t, (ys.max() - ys.min()) / 2 + t))
    hub_rx = float(np.mean([a for a, _ in hub_axes]))
    hub_ry = float(np.mean([b for _, b in hub_axes]))

    # Guard rim off a vertical scan through the hub: image Y is unforeshortened.
    column = mint[:, int(round(hub_x))]
    column_runs = runs(column)
    guard_top = column_runs[0][0]
    guard_bottom = column_runs[-1][1]
    # The last run is the rim tube crossed perpendicular at the bottom of the ring.
    rim_tube_px = column_runs[-1][2]
    guard_outer_diameter = guard_bottom - guard_top

    # Spokes: thin mint that touches the hub. Rear cage: thin mint that does not.
    core = thickness >= THICK_PART_HALF_WIDTH
    thin = mint & ~binary_dilation(core, disc(THICK_PART_HALF_WIDTH + 2))
    labelled, count = label(thin)

    spokes, rear_cage = [], []
    for component in range(1, count + 1):
        ys, xs = np.nonzero(labelled == component)
        if len(ys) < MIN_COMPONENT_AREA:
            continue
        # Elliptical radius in hub-cap units: 1.0 is the cap's own edge. A front
        # spoke runs to the cap, so its inner end sits just past it; a rear-cage
        # arc never comes near. Measured values are ~1.3 against ~3.7.
        rho = np.sqrt(((xs - hub_x) / hub_rx) ** 2 + ((ys - hub_y) / hub_ry) ** 2)
        entry = {
            "centroidPx": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)],
            "areaPx": int(len(ys)),
            "gaugePx": round(float(thickness[ys, xs].max() * 2), 1),
            "innerRho": round(float(rho.min()), 2),
            "outerRho": round(float(rho.max()), 2),
        }
        (spokes if rho.min() < SPOKE_TOUCHES_HUB_RHO else rear_cage).append(entry)

    # Petals: bridge the spokes that slice each cream blade, then count the
    # separate cream lobes left inside the guard.
    guard_box = np.zeros_like(cream)
    guard_box[guard_top:guard_bottom, :] = True
    petals_mask = binary_closing(cream & guard_box, disc(PETAL_BRIDGE_RADIUS))
    petal_labels, petal_count = label(petals_mask)
    petals = []
    for component in range(1, petal_count + 1):
        ys, xs = np.nonzero(petal_labels == component)
        if len(ys) < 2000:
            continue
        petals.append({
            "centroidPx": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)],
            "areaPx": int(len(ys)),
            "extentYPx": [int(ys.min()), int(ys.max())],
        })

    report = {
        "method": "distance-transform part separation; radii read off the unforeshortened vertical axis",
        "hubCap": {
            "centerPx": [round(hub_x, 1), round(hub_y, 1)],
            "semiAxisXPx": round(hub_rx, 1),
            "semiAxisYPx": round(hub_ry, 1),
            "domedNotFlat": True,
            "note": "x/y = %.4f, but the rim measures ~0.78. The cap is domed, so its ratio is NOT the guard's foreshortening." % (hub_rx / hub_ry),
        },
        "guardRim": {
            "verticalScanX": int(round(hub_x)),
            "outerTopPx": int(guard_top),
            "outerBottomPx": int(guard_bottom),
            "outerDiameterPx": int(guard_outer_diameter),
            "tubeDiameterPx": int(rim_tube_px),
            "centerlineDiameterPx": int(guard_outer_diameter - rim_tube_px),
            "verticalRunsPx": [list(r) for r in column_runs],
        },
        "spokes": {
            "count": len(spokes),
            "gaugeMeanPx": round(float(np.mean([s["gaugePx"] for s in spokes])), 1) if spokes else 0,
            "gaugeMedianPx": round(float(np.median([s["gaugePx"] for s in spokes])), 1) if spokes else 0,
            "components": sorted(spokes, key=lambda s: s["centroidPx"][0]),
        },
        "rearCage": {
            "count": len(rear_cage),
            "components": sorted(rear_cage, key=lambda s: s["centroidPx"][0]),
        },
        "petals": {
            "count": len(petals),
            "components": sorted(petals, key=lambda s: s["centroidPx"][0]),
        },
        "ratiosOfGuardOuterDiameter": {
            "hubCapDiameter": round(2 * hub_ry / guard_outer_diameter, 4),
            "rimTubeDiameter": round(rim_tube_px / guard_outer_diameter, 4),
            "spokeGauge": round(
                float(np.median([s["gaugePx"] for s in spokes])) / guard_outer_diameter, 4
            ) if spokes else 0,
        },
    }

    print(json.dumps(report, indent=2))
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
