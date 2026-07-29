#!/usr/bin/env python3
"""Sample named points of a reference so a material's albedo comes from pixels.

k-means over one of these renders clusters the SHADING of a single albedo into
three or four bands, which is useful for the colorVariation palette and useless
for naming a part's base colour. A small accent - a drawstring, a crown button,
a hat band - never wins a cluster at all. So the base colour of each named
region is read here from a disc of pixels the caller places on that region.

Reported per point: the median, the 90th-percentile-luma pixel and the
10th-percentile-luma pixel of the disc. The median is the albedo estimate for a
matte surface at a moderate angle to the key; the two percentiles bound the
shading range and become the material's colorVariation palette. This is
inference from one lit image, not a de-lighting solve, and it is recorded that
way in the spec.

usage: python sample_points.py <image> name=x,y[,r] [name=x,y[,r] ...]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SKILL = Path("C:/Users/Mcgib/.claude/skills/img2threejs")
sys.path.insert(0, str(SKILL / "forge" / "stage1_intake"))

from extract_pbr_evidence import load_image  # noqa: E402

DEFAULT_RADIUS = 6


def luma(rgb) -> float:
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    width, height, pixels, _warnings = load_image(Path(sys.argv[1]))

    out = {}
    for token in sys.argv[2:]:
        name, _, spec = token.partition("=")
        parts = [int(v) for v in spec.split(",")]
        cx, cy = parts[0], parts[1]
        radius = parts[2] if len(parts) > 2 else DEFAULT_RADIUS
        disc = []
        for y in range(max(0, cy - radius), min(height, cy + radius + 1)):
            for x in range(max(0, cx - radius), min(width, cx + radius + 1)):
                if (x - cx) ** 2 + (y - cy) ** 2 > radius * radius:
                    continue
                disc.append(pixels[y * width + x][:3])
        if not disc:
            raise SystemExit(f"{name}: disc at {cx},{cy} r{radius} is off the image")
        disc.sort(key=luma)
        pick = lambda frac: disc[min(len(disc) - 1, int(frac * len(disc)))]  # noqa: E731
        to_hex = lambda c: "#%02X%02X%02X" % (c[0], c[1], c[2])  # noqa: E731
        out[name] = {
            "at": [cx, cy, radius],
            "samples": len(disc),
            "median": to_hex(pick(0.5)),
            "lit": to_hex(pick(0.9)),
            "shadow": to_hex(pick(0.1)),
        }
        print(f"{name:22s} median={out[name]['median']}  lit={out[name]['lit']}  "
              f"shadow={out[name]['shadow']}  n={len(disc)}")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
