#!/usr/bin/env python3
"""Cut the named inspection crops out of the robot-mop reference.

Two consumers: agent vision (the crops are magnified so small features such as the
bumper-segment gaps and the fringe tufts are actually resolvable) and the skill's
analyze_texture.py / extract_pbr_evidence.py, which want a crop sitting entirely
inside one material region.

Run: python crop_regions.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

from measure_reference import read_png_rgb

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
IMAGE = PROJECT / "assets" / "reference" / "mop-reference.png"
OUT_DIR = HERE / "evidence" / "crops"

# name -> (x0, y0, x1, y1, magnification)
# Boxes are read off evidence/measurements.json: the deck ellipse spans x 147-933 /
# y 435-821, the navy band y 641-966, the fringe y 960-1042.
CROPS: dict[str, tuple[int, int, int, int, int]] = {
    "bumper-front": (300, 860, 800, 1010, 2),
    "bumper-left-gap": (120, 700, 420, 960, 2),
    "bumper-right-gap": (700, 700, 1000, 960, 2),
    "fringe-bottom": (250, 940, 850, 1060, 2),
    "button-red": (440, 455, 640, 580, 3),
    "deck-rim-seam": (150, 400, 700, 520, 2),
    "latch-tab": (400, 950, 700, 1050, 3),
    # Flat single-material patches for the PBR/finish extractors.
    "shell-cream": (430, 840, 610, 900, 3),
    "deck-green": (330, 640, 560, 780, 2),
    "bumper-navy": (430, 915, 640, 960, 3),
    "fringe-grey": (300, 990, 420, 1035, 4),
}


def write_png_rgb(path: Path, pixels: list[list[tuple[int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    width, height, rows = read_png_rgb(IMAGE)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, (x0, y0, x1, y1, magnification) in CROPS.items():
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
        out: list[list[tuple[int, int, int]]] = []
        for y in range(y0, y1):
            source = rows[y][x0:x1]
            line = [pixel for pixel in source for _ in range(magnification)]
            for _ in range(magnification):
                out.append(line)
        write_png_rgb(OUT_DIR / f"{name}-crop.png", out)
        print(f"{name}: {x1 - x0}x{y1 - y0} -> {len(out[0])}x{len(out)}")


if __name__ == "__main__":
    main()
