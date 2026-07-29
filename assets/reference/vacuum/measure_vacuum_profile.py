#!/usr/bin/env python3
"""Stage-1b measurement for the canister vacuum: per-part blobs and the body profile.

measure_vacuum.py separates the six albedos and solves the camera. It does NOT separate the
parts that share an albedo - the wheel from its nub, the belt from the hose from the collar,
the handle from the cuff - and it takes the canister's height from a derivation this script
shows to be wrong. Both gaps are closed here. measure_vacuum.py's own output is left exactly
as it was so the recorded evidence stays reproducible; this writes a second file.

THE CORRECTION THIS SCRIPT EXISTS FOR
-------------------------------------
assessment-seed.json records the canister's height as

    H = (566 - 646 * sin(28.1)) / cos(28.1) = 297 px,  H/D = 0.459

reading the silhouette's 566 px image height as one canister height plus one full-diameter
cap ellipse. That is only true if the top and bottom cap radii both equal the body's MAXIMUM
radius, i.e. if the canister is a cylinder. It is not: the reference shows a domed top and an
underside that rolls in, and both are measured below at 0.745 and 0.647 of the maximum
radius. The correct relation is

    image height = H * cos(P) + (R_top + R_bottom) * sin(P)

which with the measured rim radii gives H = 399 px and H/D = 0.617, against 0.459 recorded.
Two further routes agree and are computed here: fitting the bottom rim's arc returns a base
plane that predicts the silhouette's lowest pixel to within 1 px and puts H/D at 0.664, and
the top button's position on the top face is consistent with the corrected height while the
recorded height would require the button to sit 209 px behind the axis, hard against the
rim, where the reference plainly does not show it.

The camera pitch is NOT in question and is not re-derived. Only the step from the pitch to
the height is.

METHOD, AND WHAT IT ASSUMES
---------------------------
Horizontal image extents are unforeshortened, so a radius read across the image is a true
radius. A horizontal circle of radius r at height h on the body images its visible front arc
as y(x) = [y_base - h*cos(P)] + sqrt(r^2 - dx^2) * sin(P), so fitting an arc returns the
radius and the height together. This is an ORTHOGRAPHIC model and the reference is a
perspective render, which is the main error source here and the reason the rim fits carry
rms of 12 to 19 px rather than 2 or 3. The bracket that survives that error is H/D between
0.617 and 0.664; 0.63 is what the spec is authored from.

Run:    python measure_vacuum_profile.py
Writes: evidence/profile-measurement.json (next to this file)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_opening, label

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / "vacuum-reference.png"
OUT = HERE / "evidence" / "profile-measurement.json"

# From measure_vacuum.py / assessment-seed.json. The scale anchor is a TRUE diameter: the
# canister is a vertical-axis revolve and the camera has no roll, so its image width is not
# foreshortened. Every ratio in this file is against it.
CANISTER_DIAMETER_PX = 646.0
CANISTER_AXIS_X = 657.0          # (334 + 980) / 2, the lilac bbox's centre
PITCH_DEGREES = 28.1
SILHOUETTE_IMAGE_HEIGHT = 566.0  # lilac bbox y 227..793

# The antialiased boundary between two albedos bridges blobs that are physically separate,
# so the census opens by this much before labelling. Below 5 the wheel stays fused to the
# canister's belt; above 7 the nub is eroded away entirely.
OPENING = 5
MIN_BLOB_AREA = 800

SIN_P = math.sin(math.radians(PITCH_DEGREES))
COS_P = math.cos(math.radians(PITCH_DEGREES))


def albedo_masks(rgb: np.ndarray) -> tuple[dict[str, np.ndarray], np.ndarray]:
    """The six channel-dominance rules from measure_vacuum.py, unchanged."""
    corners = np.concatenate([rgb[:40, :40].reshape(-1, 3), rgb[:40, -40:].reshape(-1, 3),
                              rgb[-40:, :40].reshape(-1, 3), rgb[-40:, -40:].reshape(-1, 3)])
    background_rgb = np.median(corners, axis=0)
    obj = ~np.all(np.abs(rgb - background_rgb) < 14, axis=-1)
    inked = obj & (np.sqrt(((rgb - background_rgb) ** 2).sum(axis=-1)) > 3)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    masks = {
        "navy": inked & (blue > red + 25) & (blue > green + 12) & (blue < 170),
        "coral": inked & (red > green + 50) & (red > blue + 40),
        "mint": inked & (green > red + 10) & (green > blue + 5),
        "yellow": inked & (red > blue + 70) & (green > blue + 30) & (red > 195),
        "lilac": inked & (blue > red + 6) & (red > green + 6),
        "cream": inked & (red > blue + 10) & (red <= blue + 70) & (green > blue + 3) & (red > 200),
    }
    claimed = np.zeros_like(inked)
    for name in ("navy", "coral", "yellow", "mint", "lilac", "cream"):
        masks[name] = masks[name] & ~claimed
        claimed |= masks[name]
    return masks, inked


def blob_census(masks: dict[str, np.ndarray]) -> dict:
    census = {}
    for name, mask in masks.items():
        labelled, count = label(binary_opening(mask, np.ones((OPENING, OPENING))))
        blobs = []
        for index in range(1, count + 1):
            blob = labelled == index
            area = int(blob.sum())
            if area < MIN_BLOB_AREA:
                continue
            ys, xs = np.nonzero(blob)
            width, height = int(xs.max() - xs.min()), int(ys.max() - ys.min())
            blobs.append({
                "areaPx": area,
                "bboxPx": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "widthPx": width, "heightPx": height,
                "widthPerCanisterD": round(width / CANISTER_DIAMETER_PX, 4),
                "heightPerCanisterD": round(height / CANISTER_DIAMETER_PX, 4),
                "centroidPx": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)],
            })
        census[name] = sorted(blobs, key=lambda b: -b["areaPx"])
    return census


def fit_horizontal_circle(points: np.ndarray, upper_arc: bool,
                          radius_range: tuple[float, float]) -> dict:
    """Radius and image constant of a horizontal circle from its visible arc.

    y(x) = C +/- sqrt(r^2 - dx^2) * sin(pitch), positive for the near arc. C absorbs
    y_base - h*cos(pitch), so two arcs at different heights give their height difference
    with no need to know where the base plane is.
    """
    sign = -1.0 if upper_arc else 1.0
    best = None
    for radius in np.arange(radius_range[0], radius_range[1], 0.5):
        dx = points[:, 0] - CANISTER_AXIS_X
        inside = radius ** 2 - dx ** 2
        if np.any(inside <= 0):
            continue
        predicted = sign * np.sqrt(inside) * SIN_P
        constant = float(np.mean(points[:, 1] - predicted))
        rms = float(np.sqrt(np.mean((points[:, 1] - (constant + predicted)) ** 2)))
        if best is None or rms < best["rmsPx"]:
            best = {"radiusPx": round(float(radius), 1), "constantC": round(constant, 1),
                    "rmsPx": round(rms, 2), "samples": int(len(points))}
    return best


def main() -> int:
    rgb = np.asarray(Image.open(REFERENCE).convert("RGB")).astype(int)
    masks, inked = albedo_masks(rgb)
    # The wheel and its nub share the coral albedo and overlap the body's right silhouette,
    # so they are excluded before any body scan; the hose is navy and belongs to the body's
    # own silhouette above the equator, where the scans run.
    body = (masks["lilac"] | masks["navy"]) & ~masks["coral"]

    # Bottom rim: the canister's lowest body pixel per column, over the columns where
    # neither the hose (left) nor the wheel (right) reaches the underside.
    bottom = np.array([[float(x), float(np.nonzero(body[600:820, x])[0].max() + 600)]
                       for x in range(470, 900)
                       if len(np.nonzero(body[600:820, x])[0]) >= 3])
    bottom_fit = fit_horizontal_circle(bottom, upper_arc=False, radius_range=(180.0, 360.0))

    # Top rim: the highest body-or-handle pixel per column across the top face. The handle's
    # two feet cross this window and are the reason the fit's rms is 12 px rather than 3.
    top_source = masks["lilac"] | masks["mint"] | masks["navy"]
    top = np.array([[float(x), float(np.nonzero(top_source[200:420, x])[0].min() + 200)]
                    for x in range(430, 900)
                    if len(np.nonzero(top_source[200:420, x])[0]) >= 3])
    top_fit = fit_horizontal_circle(top, upper_arc=True, radius_range=(150.0, 340.0))

    y_base = bottom_fit["constantC"]
    r_top, r_bottom = top_fit["radiusPx"], bottom_fit["radiusPx"]

    # Route 1: the silhouette height equation, with the rim radii measured rather than
    # assumed equal to the maximum radius.
    h_from_silhouette = (SILHOUETTE_IMAGE_HEIGHT - (r_top + r_bottom) * SIN_P) / COS_P
    # Route 2: the two fitted arcs, which give the base plane and the top face directly.
    h_from_arcs = (y_base - top_fit["constantC"]) / COS_P
    # The maximum radius sits at the silhouette's widest row, read straight off the image.
    widest_row, widest_half = 0, 0.0
    for y in range(400, 620):
        xs = np.nonzero(body[y])[0]
        xs = xs[(xs >= 330) & (xs <= 990)]
        if len(xs) < 10:
            continue
        half = (xs.max() - xs.min()) / 2.0
        if half > widest_half:
            widest_half, widest_row = half, y

    # Route 3: the top button is a circle on the top face. Its image position fixes the top
    # face's height once its plan depth is chosen, so it does not pin the height on its own -
    # but it does REJECT a height, by demanding a depth the reference contradicts.
    button_centre_y, button_offset_x = 332.0, 586.0 - CANISTER_AXIS_X
    def button_depth_for(height_px: float) -> float:
        return (y_base - height_px * COS_P - button_centre_y) / -SIN_P

    # The profile ITSELF, not just its three landmarks. For a revolve the silhouette's
    # extreme point at an image row gives the radius directly, and that meridian's depth is
    # zero, so the row converts to a height by cos(pitch) alone. Both flanks are scanned
    # because each is blocked over a different range: the hose crosses the left below the
    # equator and the wheel the right, so neither side alone covers the body, and their
    # disagreement about WHERE the widest band sits is the perspective error made visible.
    body_rows = {"left": [], "right": []}
    for y in range(360, 500, 10):
        for side in ("left", "right"):
            xs = np.nonzero(body[y])[0]
            xs = xs[(xs >= 300) & (xs <= 1010)]
            xs = xs[xs <= CANISTER_AXIS_X] if side == "left" else xs[xs >= CANISTER_AXIS_X]
            if len(xs) < 5:
                continue
            if side == "right":
                edge = xs[0]
                for a, b in zip(xs[:-1], xs[1:]):
                    if b - a > 6:
                        break
                    edge = b
            else:
                edge = xs[-1]
                for a, b in zip(xs[::-1][:-1], xs[::-1][1:]):
                    if a - b > 6:
                        break
                    edge = b
            radius = abs(edge - CANISTER_AXIS_X)
            body_rows[side].append({
                "imageRow": y,
                "radiusPx": int(radius),
                "radiusPerMaxRadius": round(radius / widest_half, 4),
                "heightPerCanisterHeight": round((y_base - y) / COS_P / h_from_arcs, 4),
            })

    report = {
        "sourceImage": str(REFERENCE),
        "bodyProfileRows": {
            "left": body_rows["left"], "right": body_rows["right"],
            "note": "The two flanks put the widest band at different heights - the left near "
                    "0.55 of the canister's height and the right near 0.67 - which cannot "
                    "happen for a revolve under an orthographic camera and is the same "
                    "perspective error the belt shows. The spec averages them and records the "
                    "spread; what both agree on is that the body holds NEAR its maximum radius "
                    "across a broad band rather than peaking at a point, which is the finding "
                    "that matters, because a profile that narrows straight off its maximum "
                    "renders as a sphere rather than as a drum.",
        },
        "scaleAnchor": {"canisterDiameterPx": CANISTER_DIAMETER_PX,
                        "why": "a vertical-axis revolve's image width is its true diameter"},
        "pitchDegrees": PITCH_DEGREES,
        "blobCensus": blob_census(masks),
        "rimFits": {"bottom": bottom_fit, "top": top_fit,
                    "note": "orthographic arc model against a perspective render; the rms is "
                            "the perspective error, not noise"},
        "maximumRadius": {"radiusPx": round(widest_half, 1), "atImageRow": widest_row,
                          "perCanisterD": round(widest_half * 2 / CANISTER_DIAMETER_PX, 4)},
        "canisterHeight": {
            "RETRACTED": {
                "value": 297.0, "heightOverDiameter": 0.459,
                "source": "assessment-seed.json measurementBasis.solvedCamera.crossCheck",
                "whyWrong": "solves 566 = H*cos(P) + 646*sin(P), which takes BOTH cap radii "
                            "to equal the maximum radius. The measured top rim is "
                            f"{round(r_top / widest_half, 3)} of the maximum radius and the "
                            f"bottom rim {round(r_bottom / widest_half, 3)}, so the cap term "
                            "is far smaller and the height correspondingly larger.",
            },
            "fromSilhouetteEquation": {
                "heightPx": round(h_from_silhouette, 1),
                "heightOverDiameter": round(h_from_silhouette / CANISTER_DIAMETER_PX, 4),
                "derivation": "H = (566 - (R_top + R_bottom) * sin(P)) / cos(P)",
            },
            "fromFittedArcs": {
                "heightPx": round(h_from_arcs, 1),
                "heightOverDiameter": round(h_from_arcs / CANISTER_DIAMETER_PX, 4),
                "derivation": "the base plane and the top face both come out of the arc fits, "
                              "so their separation needs no cap assumption at all",
            },
            "bottomFitCrossCheck": {
                "predictedLowestPixel": round(y_base + r_bottom * SIN_P, 1),
                "measuredLowestPixel": 793,
                "note": "the bottom fit reproduces the silhouette's lowest pixel to ~1 px, "
                        "which is what makes it the more trustworthy of the two fits",
            },
            "buttonConsistency": {
                "buttonCentrePx": [586.0, button_centre_y],
                "plandepthRequiredByCorrectedHeight": round(button_depth_for(h_from_arcs), 1),
                "plandepthRequiredByRetractedHeight": round(button_depth_for(297.0), 1),
                "topFaceRadiusPx": r_top,
                "verdict": "the corrected height puts the button just forward of the axis, "
                           "which is where the reference shows it; the retracted height "
                           "demands it sit hard against the rear rim, which it does not.",
            },
            "ADOPTED": {
                "heightOverDiameter": 0.63,
                "why": "midpoint of the two surviving routes, 0.617 and 0.664. The spread is "
                       "the orthographic-model error against a perspective render and is "
                       "recorded rather than argued away.",
                "confidence": 0.7,
            },
        },
        "profileLandmarks": {
            "widestAtHeightFraction": round((y_base - widest_row) / COS_P / h_from_arcs, 3),
            "bottomContactRadiusPerMaxRadius": round(r_bottom / widest_half, 4),
            "topFaceRadiusPerMaxRadius": round(r_top / widest_half, 4),
        },
        "orthographicCaveat": "Every arc fit here assumes an orthographic camera. The "
                              "reference is a perspective render, which is why the belt's "
                              "arc could not be fitted at all: its left and right extreme "
                              "meridians, which an orthographic camera puts on the same image "
                              "row, sit ~77 px apart. Radii read as horizontal extents are "
                              "unaffected; heights derived through sin(P) carry this error.",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "blobCensus"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
