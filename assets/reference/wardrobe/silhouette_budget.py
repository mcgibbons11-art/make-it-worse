#!/usr/bin/env python3
"""What each body region can grow by before the runner gets wider.

The 0.94u deck cap is often read as "every garment shares 0.1394 world units",
which is wrong in a way that matters: width is an extent, not an accumulation.
The runner's 0.817u width comes from its HANDS at x = +/-0.4085; every other
body region sits well inboard of that, so a garment over the torso can grow by
0.1466u per side and cost the silhouette nothing at all. Only geometry that
crosses x = +/-0.4085 spends the budget.

This reads the measured runner and reports the free growth per region, which is
what a per-slot allowance has to be built on.

usage: python silhouette_budget.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEASUREMENT = HERE / "runner-measurement.json"
DECK_WIDTH_CAP = 0.94

# Which body meshes a wardrobe slot sits on, so the free growth is reported per slot rather
# than per mesh. Names are the runner factory's own mesh names.
SLOT_REGIONS: dict[str, list[str]] = {
    "torso-outer (hoodie, puffer, jacket body)": ["Torso"],
    "torso-strap (backpack straps, satchel)": ["Backpack strap left", "Backpack strap right"],
    "sleeve (hoodie/puffer arms)": ["Arm left", "Arm right"],
    "hand (gloves, mitts)": ["Hand left", "Hand right"],
    "shoulder (cape yoke, epaulettes)": ["Shoulder cap left", "Shoulder cap right"],
    "neck (scarf, collar)": ["Neck"],
    "head-crown (cap, bucket hat, beanie)": ["Head", "Hair cap"],
    "head-side (headphones, earmuffs)": ["Ear left", "Ear right"],
    "face (sunglasses, mask)": ["Eye left", "Eye right", "Nose"],
    "leg (shorts, trousers)": ["Leg left", "Leg right"],
    "foot (boots, trainers)": ["Sneaker left", "Sneaker right", "Sole left", "Sole right"],
}


def main() -> None:
    data = json.loads(MEASUREMENT.read_text(encoding="utf-8"))
    parts = data["partBoxes"]
    visible = data["factoryFrame"]["visibleBox"]
    play = data["playSpace"]

    body_half_width = visible["size"][0] / 2.0
    fit_scale = play["fitScale"]
    squash = play["landingSquashWidthMultiplier"]

    print(f"runner visible width      {visible['size'][0]:.4f} factory u  "
          f"(half {body_half_width:.4f})")
    print(f"fit scale to play space   {fit_scale:.5f}")
    print(f"shipped width at rest     {play['fittedWidth']:.4f} world u")
    print(f"shipped width at squash   {play['fittedWidth'] * squash:.4f} world u  "
          f"(landing transient, x{squash:.4f})")
    print(f"deck cap                  {DECK_WIDTH_CAP:.4f} world u")
    print(f"headroom at rest          {DECK_WIDTH_CAP - play['fittedWidth']:.4f} world u total, "
          f"{(DECK_WIDTH_CAP - play['fittedWidth']) / 2 / fit_scale:.4f} factory u per side")
    print(f"headroom at squash        {DECK_WIDTH_CAP - play['fittedWidth'] * squash:.4f} world u "
          f"total  <- the body alone already spends "
          f"{play['fittedWidth'] * squash / DECK_WIDTH_CAP * 100:.1f}% of the cap")
    print()
    print(f"{'slot':<44} {'half-width':>10} {'free growth':>12} {'world':>8}")
    print("-" * 78)
    for slot, meshes in SLOT_REGIONS.items():
        half = 0.0
        for name in meshes:
            box = parts.get(name)
            if not box:
                raise SystemExit(f"{name} is not a measured part; runner-measurement.json is stale")
            half = max(half, abs(box["min"][0]), abs(box["max"][0]))
        free = body_half_width - half
        print(f"{slot:<44} {half:>10.4f} {free:>12.4f} {free * fit_scale:>8.4f}")
    print()
    print("free growth is per side and costs the silhouette NOTHING; only geometry past")
    print(f"x = +/-{body_half_width:.4f} spends the {(DECK_WIDTH_CAP - play['fittedWidth']) / 2 / fit_scale:.4f} "
          "factory-u per-side budget.")


if __name__ == "__main__":
    main()
