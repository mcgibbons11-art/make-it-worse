#!/usr/bin/env python3
"""Stage-1 measurement for the canister vacuum.

Nothing about this prop was measured before this script: assets/reference held
only vacuum-reference.png, with no evidence folder and no assessment.

Parts are separated by channel dominance, the same derivation the floor fan's
bands used. k-means was tried first and rejected twice, and the failures are
worth keeping: clustering raw RGB split the render by how lit each surface was
and returned three shades of one lilac body, each spanning the whole bounding
box; moving to the chroma plane fixed the lilac but still split navy by shading
and merged mint, yellow and cream into one low-saturation blob. The rules below
are verified against evidence/masks.png, where every part must land where that
part visibly is - which is the check that makes them a measurement rather than
six guesses.

The call site is components/game/TrapRenderer.tsx: CuboidCollider
args=[0.5, 0.55, 0.45] with the model at [0, -0.55, 0], so the world envelope is
1.00 x 1.10 x 0.90 with the prop's origin on the deck.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import label

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / "vacuum-reference.png"
OUT = HERE / "evidence" / "part-measurement.json"

BACKGROUND_TOLERANCE = 14


SEED = 17




# The collider the prop must live inside, from the call site above.
ENVELOPE = {"width": 1.0, "height": 1.1, "depth": 0.9}


def distance_from_background(rgb: np.ndarray, background_rgb: np.ndarray) -> np.ndarray:
    """Euclidean colour distance from the plate, used to drop the antialiased
    halo that otherwise reads as a thin false part around every silhouette."""
    return np.sqrt(((rgb - background_rgb) ** 2).sum(axis=-1))


def moment_ellipse(mask: np.ndarray) -> dict:
    """Semi-axes and tilt of a filled blob, from its second moments.

    For a filled ellipse the covariance eigenvalues give the semi-axes as
    2*sqrt(lambda), which is far steadier than a bounding box when the blob is
    rotated in the image.
    """
    ys, xs = np.nonzero(mask)
    coords = np.stack([xs - xs.mean(), ys - ys.mean()])
    eigenvalues, eigenvectors = np.linalg.eigh(np.cov(coords))
    order = np.argsort(eigenvalues)[::-1]
    major, minor = 2.0 * np.sqrt(eigenvalues[order])
    axis = eigenvectors[:, order[0]]
    return {
        "centroidPx": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)],
        "semiMajorPx": round(float(major), 1),
        "semiMinorPx": round(float(minor), 1),
        "axisRatio": round(float(minor / major), 4),
        "majorAxisTiltDeg": round(float(np.degrees(np.arctan2(axis[1], axis[0]))), 1),
        "areaPx": int(mask.sum()),
    }


def solve_camera(masks: dict[str, np.ndarray]) -> dict:
    """Camera pitch from the top button, which is a circle in a horizontal plane.

    This is the measurement that unblocks every world dimension. Vertical image
    spans in this reference mix elevation and depth - the canister and the
    nozzle both stand on the floor yet their undersides sit ~350 px apart in
    image Y - so nothing converts until the pitch is known. A horizontal circle
    projects to an ellipse whose major axis is its true diameter and whose minor
    axis is that diameter times sin(pitch), so the button alone gives the angle.
    """
    labelled, count = label(masks["yellow"])
    blobs = []
    for index in range(1, count + 1):
        blob = labelled == index
        if blob.sum() >= 2000:
            blobs.append(moment_ellipse(blob))
    blobs.sort(key=lambda b: b["centroidPx"][1])
    if not blobs:
        return {"solved": False, "reason": "no yellow blob large enough to fit"}

    button = blobs[0]
    pitch = float(np.degrees(np.arcsin(np.clip(button["axisRatio"], 0.0, 1.0))))
    return {
        "solved": True,
        "method": "ellipse axis ratio of the yellow top button, a circle in a horizontal plane",
        "pitchDegrees": round(pitch, 1),
        "button": button,
        "otherYellowBlobs": blobs[1:],
        "groundPlane": {
            "depthToImageY": round(float(np.sin(np.radians(pitch))), 4),
            "heightToImageY": round(float(np.cos(np.radians(pitch))), 4),
            "widthToImageX": 1.0,
            "howToUse": "A floor displacement away from the camera moves a point DOWN the image "
                        "by depth * sin(pitch); an elevation moves it UP by height * cos(pitch); "
                        "a sideways displacement moves it by its own length in X. Decompose any "
                        "vertical image span into elevation and depth with these before treating "
                        "it as a world dimension.",
        },
        "caveat": "The button reads as a disc but is a moulded cap with a rounded edge, so its "
                  "silhouette is marginally wider than the true circle and the recovered pitch "
                  "is a slight underestimate. Treat it as +/- 3 degrees.",
    }


def solve_camera_from_shadow(shadow: np.ndarray, canister_centroid_x: float) -> dict:
    """Independent pitch solve from the canister's contact shadow.

    The shadow of a vertical-axis revolve on the floor is a circle in the ground
    plane, so its projected ellipse gives the ground plane's foreshortening
    directly: minor / major = sin(pitch). This shares no measurement with the
    button solve - different pixels, different part, different plane - so the
    two agreeing is a real cross-check rather than a restatement.

    Assumes a near-overhead or ambient contact shadow. A strongly raked key
    light would shear the shadow and inflate the recovered pitch, so the two
    solves disagreeing would point here first.
    """
    labelled, count = label(shadow)
    blobs = []
    for index in range(1, count + 1):
        blob = labelled == index
        if blob.sum() >= 3000:
            blobs.append((blob.sum(), moment_ellipse(blob)))
    if not blobs:
        return {"solved": False, "reason": "no shadow blob large enough to fit"}
    blobs.sort(key=lambda item: -item[0])
    # The canister's shadow is the one sitting under the canister.
    canister_shadow = min(
        (ellipse for _, ellipse in blobs),
        key=lambda e: abs(e["centroidPx"][0] - canister_centroid_x),
    )
    pitch = float(np.degrees(np.arcsin(np.clip(canister_shadow["axisRatio"], 0.0, 1.0))))
    return {
        "solved": True,
        "method": "ellipse axis ratio of the canister's contact shadow, a circle in the ground plane",
        "pitchDegrees": round(pitch, 1),
        "shadow": canister_shadow,
        "allShadowBlobs": [ellipse for _, ellipse in blobs],
        "assumption": "near-overhead or ambient contact shadow; a raked key light would shear it",
    }


def main() -> int:
    image = Image.open(REFERENCE).convert("RGB")
    rgb = np.asarray(image).astype(int)
    height, width = rgb.shape[:2]

    # Background is the modal corner colour, not an assumed grey.
    corners = np.concatenate([rgb[:40, :40].reshape(-1, 3), rgb[:40, -40:].reshape(-1, 3),
                              rgb[-40:, :40].reshape(-1, 3), rgb[-40:, -40:].reshape(-1, 3)])
    background_rgb = np.median(corners, axis=0)
    background = np.all(np.abs(rgb - background_rgb) < BACKGROUND_TOLERANCE, axis=-1)
    obj = ~background

    ys, xs = np.nonzero(obj)
    bbox = {"x0": int(xs.min()), "y0": int(ys.min()),
            "x1": int(xs.max()), "y1": int(ys.max()), "imageSize": [width, height]}
    sil_w, sil_h = bbox["x1"] - bbox["x0"], bbox["y1"] - bbox["y0"]

    # Separate by channel dominance, the same way the floor fan's bands were
    # derived. k-means was tried first and rejected twice: in RGB it split the
    # render by how lit a surface was and returned three shades of one lilac
    # body, and in the chroma plane it still split lilac and navy by shading
    # while merging mint, yellow and cream into a single low-saturation blob.
    # These rules are checked by masks.png, where each part must land where that
    # part visibly is.
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    inked = obj & (distance_from_background(rgb, background_rgb) > 3)
    masks = {
        "navy": inked & (blue > red + 25) & (blue > green + 12) & (blue < 170),
        "coral": inked & (red > green + 50) & (red > blue + 40),
        "mint": inked & (green > red + 10) & (green > blue + 5),
        "yellow": inked & (red > blue + 70) & (green > blue + 30) & (red > 195),
        "lilac": inked & (blue > red + 6) & (red > green + 6),
        "cream": inked & (red > blue + 10) & (red <= blue + 70) & (green > blue + 3) & (red > 200),
    }
    # Assign each pixel once, most saturated claim first, so overlaps cannot
    # double-count area.
    claimed = np.zeros_like(inked)
    for name in ("navy", "coral", "yellow", "mint", "lilac", "cream"):
        masks[name] = masks[name] & ~claimed
        claimed |= masks[name]

    parts = []
    for name, mask in masks.items():
        area = int(mask.sum())
        if area < 500:
            continue
        cy, cx = np.nonzero(mask)
        median_rgb = np.median(rgb[mask], axis=0)
        parts.append({
            "part": name,
            "medianHex": "#%02x%02x%02x" % tuple(int(v) for v in median_rgb),
            "medianRgb": [round(float(v), 1) for v in median_rgb],
            "areaPx": area,
            "areaFractionOfObject": round(area / int(inked.sum()), 4),
            "bboxPx": {"x0": int(cx.min()), "y0": int(cy.min()),
                       "x1": int(cx.max()), "y1": int(cy.max())},
            "centroidPx": [round(float(cx.mean()), 1), round(float(cy.mean()), 1)],
            "widthFractionOfSilhouette": round((cx.max() - cx.min()) / sil_w, 4),
            "heightFractionOfSilhouette": round((cy.max() - cy.min()) / sil_h, 4),
        })
    parts.sort(key=lambda p: -p["areaPx"])

    # The contact shadow is not background, so it lands inside `obj` and inflates
    # any bounding box taken from it. It is near-neutral and darker than the
    # plate, and no part rule claims it, so it separates cleanly - and the same
    # mask is what the second camera solve needs.
    saturation = rgb.max(axis=-1) - rgb.min(axis=-1)
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    background_luminance = float(0.2126 * background_rgb[0] + 0.7152 * background_rgb[1]
                                 + 0.0722 * background_rgb[2])
    shadow = obj & ~claimed & (saturation < 20) & (luminance < background_luminance - 4)

    # A silhouette measured off part masks instead of off `obj`, so the shadow
    # cannot masquerade as geometry.
    solid = claimed
    sy, sx = np.nonzero(solid)
    clean_bbox = {"x0": int(sx.min()), "y0": int(sy.min()),
                  "x1": int(sx.max()), "y1": int(sy.max())}

    swatch = {"navy": (40, 70, 130), "coral": (240, 110, 95), "mint": (120, 210, 165),
              "yellow": (250, 215, 110), "lilac": (185, 160, 230), "cream": (245, 238, 205)}
    canvas = np.zeros((height, width, 3), np.uint8)
    for name, mask in masks.items():
        canvas[mask] = swatch[name]
    Image.fromarray(canvas).save(OUT.parent / "masks.png")

    # Row and column occupancy: where the mass sits inside the silhouette.
    rows = []
    for i in range(21):
        y = bbox["y0"] + int(i / 20 * sil_h)
        y = min(y, bbox["y1"])
        run = np.nonzero(obj[y])[0]
        rows.append({"rowFraction": round(i / 20, 3),
                     "widthPx": int(run.max() - run.min()) if len(run) else 0,
                     "fractionOfSilhouetteWidth": round(
                         float(run.max() - run.min()) / sil_w, 4) if len(run) else 0.0})

    report = {
        "sourceImage": str(REFERENCE),
        "backgroundRgb": [round(float(v), 1) for v in background_rgb],
        "referenceBBox": bbox,
        "silhouette": {"width": sil_w, "height": sil_h,
                       "widthToHeight": round(sil_w / sil_h, 4)},
        "envelope": {
            "callSite": "components/game/TrapRenderer.tsx vacuum",
            "collider": "CuboidCollider args=[0.5, 0.55, 0.45], model at [0, -0.55, 0]",
            "worldBox": [ENVELOPE["width"], ENVELOPE["height"], ENVELOPE["depth"]],
            "allowedWidthToHeight": round(ENVELOPE["width"] / ENVELOPE["height"], 4),
        },
        "paletteClusters": parts,
        "camera": solve_camera(masks),
        "cameraFromShadow": solve_camera_from_shadow(
            shadow, next(p["centroidPx"][0] for p in parts if p["part"] == "lilac")),
        "cleanSilhouette": {
            "bboxPx": clean_bbox,
            "width": clean_bbox["x1"] - clean_bbox["x0"],
            "height": clean_bbox["y1"] - clean_bbox["y0"],
            "note": "Measured off the union of the part masks. The obj-based bbox includes the contact shadow.",
        },
        "shadowAreaPx": int(shadow.sum()),
        "rowProfile": rows,
        "method": "channel-dominance albedo separation, verified against evidence/masks.png",
        "knownLimitation": "cream and yellow are both warm and low-saturation, so each bbox "
                           "carries a few stray pixels of the other; the centroids and areas are "
                           "sound but the cream and yellow bounding boxes are not tight.",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
