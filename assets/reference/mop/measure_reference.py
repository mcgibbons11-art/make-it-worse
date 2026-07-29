#!/usr/bin/env python3
"""Measure the robot-mop reference so every spec dimension traces to pixels.

Writes evidence/measurements.json. The two things that cannot be eyeballed are the
camera elevation and the vertical band boundaries, and both fall out of the same
scan: a circle of radius R seen at elevation e projects to an ellipse whose minor
axis is major * sin(e), so the top deck's own ellipse gives the elevation, and the
elevation then converts every measured screen height into an object height.

Run: python measure_reference.py
"""

from __future__ import annotations

import json
import math
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
IMAGE = PROJECT / "assets" / "reference" / "mop-reference.png"
OUT = HERE / "evidence" / "measurements.json"

# Background is a flat neutral grey; anything this far off it in any channel is object.
BACKGROUND_TOLERANCE = 10
# The fringe tufts are pale grey and only just separate from the backdrop, so the
# silhouette scan uses a looser threshold than the region scans below.
FRINGE_TOLERANCE = 6


def read_png_rgb(path: Path) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    """Minimal PNG reader: 8-bit truecolour, all five filter types, stdlib only."""
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    pos = 8
    width = height = 0
    bit_depth = colour_type = 0
    idat = bytearray()
    while pos < len(raw):
        (length,) = struct.unpack(">I", raw[pos : pos + 4])
        kind = raw[pos + 4 : pos + 8]
        body = raw[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, colour_type = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if bit_depth != 8 or colour_type not in (2, 6):
        raise ValueError(f"unsupported PNG: bit_depth={bit_depth} colour_type={colour_type}")
    channels = 3 if colour_type == 2 else 4
    data = zlib.decompress(bytes(idat))
    stride = width * channels
    rows: list[list[tuple[int, int, int]]] = []
    previous = bytearray(stride)
    at = 0
    for _ in range(height):
        filter_type = data[at]
        at += 1
        line = bytearray(data[at : at + stride])
        at += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = previous[i]
                upper_left = previous[i - channels] if i >= channels else 0
                p = left + up - upper_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - upper_left)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upper_left)
                line[i] = (line[i] + pred) & 0xFF
        elif filter_type != 0:
            raise ValueError(f"bad PNG filter {filter_type}")
        rows.append([tuple(line[i : i + 3]) for i in range(0, stride, channels)])
        previous = line
    return width, height, rows


def background_colour(rows, width, height) -> tuple[float, float, float]:
    """Median of the four corner patches, which are always backdrop."""
    samples = []
    for y0 in (0, height - 24):
        for x0 in (0, width - 24):
            for y in range(y0, y0 + 24):
                for x in range(x0, x0 + 24):
                    samples.append(rows[y][x])
    return tuple(sum(s[c] for s in samples) / len(samples) for c in range(3))


def is_object(pixel, background, tolerance) -> bool:
    return max(abs(pixel[c] - background[c]) for c in range(3)) > tolerance


def classify(pixel) -> str:
    """Assign a pixel to one of the reference's named regions.

    Thresholds are deliberately wide: the render is soft-lit so each region covers a
    band of values, and the point is to find boundaries, not to grade colour.
    """
    r, g, b = pixel
    mx, mn = max(r, g, b), min(r, g, b)
    if r > 170 and g < 140 and b < 140 and r - g > 45:
        return "button-red"
    if g > r + 8 and g > b + 8 and g > 120:
        return "deck-green"
    if mx < 130 and b >= r:
        return "bumper-navy"
    if r > 205 and g > 195 and b > 170 and mx - mn > 12:
        return "shell-cream"
    if 150 < mx < 215 and mx - mn <= 14:
        return "fringe-grey"
    return "other"


def main() -> None:
    width, height, rows = read_png_rgb(IMAGE)
    background = background_colour(rows, width, height)

    # ---- silhouette ----
    min_x, max_x, min_y, max_y = width, -1, height, -1
    row_spans: dict[int, tuple[int, int]] = {}
    for y in range(height):
        row = rows[y]
        xs = [x for x in range(width) if is_object(row[x], background, FRINGE_TOLERANCE)]
        if not xs:
            continue
        row_spans[y] = (xs[0], xs[-1])
        min_y, max_y = min(min_y, y), max(max_y, y)
        min_x, max_x = min(min_x, xs[0]), max(max_x, xs[-1])

    # ---- region extents ----
    regions: dict[str, dict] = {}
    for y in range(min_y, max_y + 1):
        row = rows[y]
        for x in range(min_x, max_x + 1):
            pixel = row[x]
            if not is_object(pixel, background, BACKGROUND_TOLERANCE):
                continue
            name = classify(pixel)
            if name == "other":
                continue
            entry = regions.setdefault(
                name,
                {"minX": width, "maxX": -1, "minY": height, "maxY": -1, "count": 0,
                 "sumR": 0, "sumG": 0, "sumB": 0},
            )
            entry["minX"] = min(entry["minX"], x)
            entry["maxX"] = max(entry["maxX"], x)
            entry["minY"] = min(entry["minY"], y)
            entry["maxY"] = max(entry["maxY"], y)
            entry["count"] += 1
            entry["sumR"] += pixel[0]
            entry["sumG"] += pixel[1]
            entry["sumB"] += pixel[2]

    for entry in regions.values():
        n = max(1, entry["count"])
        entry["meanColor"] = "#%02x%02x%02x" % (
            round(entry["sumR"] / n), round(entry["sumG"] / n), round(entry["sumB"] / n)
        )
        entry["widthPx"] = entry["maxX"] - entry["minX"] + 1
        entry["heightPx"] = entry["maxY"] - entry["minY"] + 1
        for key in ("sumR", "sumG", "sumB"):
            del entry[key]

    # ---- camera elevation from the top deck's ellipse ----
    # The deck is a circle in object space. Orthographically its projected minor axis
    # over its major axis is sin(elevation). Perspective at this focal length shifts
    # the result by well under a degree, which is inside the review tolerance.
    deck = regions.get("deck-green")
    elevation_deg = None
    if deck:
        ratio = deck["heightPx"] / deck["widthPx"]
        elevation_deg = round(math.degrees(math.asin(min(1.0, ratio))), 2)

    # ---- vertical band boundaries along the object's centre column ----
    centre_x = (min_x + max_x) // 2
    column: list[dict] = []
    current = None
    for y in range(min_y, max_y + 1):
        pixel = rows[y][centre_x]
        name = classify(pixel) if is_object(pixel, background, BACKGROUND_TOLERANCE) else "background"
        if current is None or current["region"] != name:
            current = {"region": name, "startY": y, "endY": y}
            column.append(current)
        else:
            current["endY"] = y
    column = [band for band in column if band["endY"] - band["startY"] >= 3]

    # ---- widest-row scan: the shell's true plan diameter in screen pixels ----
    widest_y = max(row_spans, key=lambda y: row_spans[y][1] - row_spans[y][0])
    widest = row_spans[widest_y]

    result = {
        "image": str(IMAGE),
        "imageSize": [width, height],
        "backgroundColor": "#%02x%02x%02x" % tuple(round(c) for c in background),
        "silhouette": {
            "minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y,
            "widthPx": max_x - min_x + 1, "heightPx": max_y - min_y + 1,
            "aspectRatio": round((max_x - min_x + 1) / (max_y - min_y + 1), 4),
        },
        "silhouetteNdc": {
            "minX": round(2 * (min_x / width) - 1, 4),
            "maxX": round(2 * ((max_x + 1) / width) - 1, 4),
            "minY": round(1 - 2 * ((max_y + 1) / height), 4),
            "maxY": round(1 - 2 * (min_y / height), 4),
        },
        "widestRow": {"y": widest_y, "minX": widest[0], "maxX": widest[1],
                      "widthPx": widest[1] - widest[0] + 1},
        "regions": regions,
        "cameraElevationDegFromDeckEllipse": elevation_deg,
        "centreColumnBands": column,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
