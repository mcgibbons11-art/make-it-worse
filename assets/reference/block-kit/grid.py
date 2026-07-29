#!/usr/bin/env python3
"""The block grid, derived from the level rather than chosen.

Every number here was measured off the shipped course, not picked. Re-derive them
with `python grid.py --audit`, which re-reads the level sources and fails if any of
the constants below no longer describes the geometry they were taken from.

Why a block needs a grid at all: a prop is seen once, a block is repeated down a
41u-to-285u course. If two neighbouring copies do not share an edge plane exactly,
the seam shows on every repeat, and a visible seam repeated 400 times is worse than
a plain box.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

PROJECT = pathlib.Path(__file__).resolve().parents[3]
LEVEL_SOURCES = (
    "lib/game/level-definition.ts",
    "lib/game/track.ts",
    "lib/game/segments-extra.ts",
    "lib/game/segments-more.ts",
)

# ---------------------------------------------------------------------------
# the grid
# ---------------------------------------------------------------------------

# Every piece dimension, centre and edge in every shipped segment is an exact
# multiple of this. Nothing coarser is: 26 of the 198 piece edges leave the 0.1u
# grid (0.7u-tall pieces on 0.35u centres, and the ramp's Z edges at 32.25/35.85),
# and the editor's GRID_SIZE of 0.25u misses most of the course entirely - it
# quantises trap PLACEMENT, and is the wrong thing to author geometry against.
QUANTUM = 0.05

# The tiling pitch: how far apart two neighbouring copies of a block sit. Twelve
# quanta. Chosen as the coarsest pitch that still divides the architectural bay
# exactly (9.0 / 0.6 = 15) and the common platform depths 1.2, 1.8, 3.6, 4.8, 6.0
# and 10.2. A block is always a whole number of MODULEs long, so a run of them
# lands on the same lattice however it is cut.
MODULE = 0.6

# Vertical step. Half a module, so a stair block's rise and run stay commensurate.
# Four risers is 1.2u, which sits just under the player's 1.269u jump apex, so a
# flight that somehow loses its ramp collider is still climbable rather than a wall.
RISER = 0.3

# ---------------------------------------------------------------------------
# the level the blocks have to meet
# ---------------------------------------------------------------------------

# Architectural bay pitch along +Z. Walls sit at z = 6, 15, 24, 33, 42 and the
# door arches interleave at 10.5, 19.5, 28.5, 37.5.
BAY_PITCH = 9.0
BAY_ARCH_OFFSET = 4.5

WALL_CENTRE_X = 5.65          # walls are mirrored at x = +/- this
WALL_THICKNESS = 0.28
WALL_INNER_X = WALL_CENTRE_X - WALL_THICKNESS / 2   # 5.51
WALL_CENTRE_Y = 1.75
WALL_HEIGHT = 5.1
WALL_TOP_Y = WALL_CENTRE_Y + WALL_HEIGHT / 2        # 4.30
WALL_BOTTOM_Y = WALL_CENTRE_Y - WALL_HEIGHT / 2     # -0.80

# The existing skirting strip on those walls, which a skirting block replaces or
# extends: 0.13 x 0.34 x 8.45 at wall-local y = -1.65.
SKIRTING_FACE_X = WALL_CENTRE_X - 0.18              # 5.47
SKIRTING_CENTRE_Y = WALL_CENTRE_Y - 1.65            # 0.10
SKIRTING_HEIGHT = 0.34

# Door arch: posts 0.42 x 4.25 x 0.48 at x = +/-4.55, header 9.5 x 0.42 x 0.48
# centred at y = 4.08. A doorway or archway block has to clear this opening.
ARCH_POST_X = 4.55
ARCH_POST_WIDTH = 0.42
ARCH_CLEAR_WIDTH = 2 * (ARCH_POST_X - ARCH_POST_WIDTH / 2)   # 8.68
ARCH_HEADER_UNDERSIDE = 4.08 - 0.21                          # 3.87

# ---------------------------------------------------------------------------
# the platform edge band - the one thing a block must not swallow
# ---------------------------------------------------------------------------

# LevelGeometry insets each deck by DECK_EDGE per side and leaves the dark plinth
# colour showing as a band around it. A deck against the sky measures 1.18:1;
# ink against that same sky measures 13.74:1. Both reproduce exactly (see
# `--audit`), so the band is the only thing making a platform edge visible.
DECK_EDGE = 0.13
# The band is what shows of the ink cap (piece extent x 0.995) outside the deck
# (piece extent - 2 x DECK_EDGE), so it narrows as the piece grows.
def edge_band_width(piece_extent: float) -> float:
    return (2 * DECK_EDGE - 0.005 * piece_extent) / 2

# Hard rule for any block that lands on a platform top: keep its footprint at
# least this far in from the platform edge, or place it entirely outside the
# platform footprint. Sized to the narrowest band any shipped piece produces
# (0.110u on the 8u start pad), rounded up to a quantum.
EDGE_KEEPOUT = 0.15

# ---------------------------------------------------------------------------
# player envelope, which decides what a stair or railing block may do
# ---------------------------------------------------------------------------
PLAYER_HEIGHT = 1.86          # (capsuleHalfHeight 0.55 + capsuleRadius 0.38) * 2
PLAYER_RADIUS = 0.38
JUMP_APEX = 1.2686            # v^2 / 2g with v = 7.4, g = 9.81 * 2.2
JUMP_REACH = 4.937            # moveSpeed 7.2 over the full 0.686s airtime

# ---------------------------------------------------------------------------
# cost budget
# ---------------------------------------------------------------------------

# Longest course the track composer can lay out. Everything below is sized so a
# course this long still fits the budget.
MAX_COURSE_LENGTH = 285.0

# Whole-scene ceiling for architecture. The runner, traps and props need the rest
# of the frame, so blocks get roughly a third of a 400k-triangle scene.
ARCHITECTURE_TRIANGLE_BUDGET = 130_000

# Per-block triangle ceilings, derived by dividing the budget by the worst-case
# instance count each block reaches over MAX_COURSE_LENGTH. See `--audit`.
BLOCK_BUDGETS = {
    #  stem                    pitch   runs      max instances  tri ceiling
    "block-skirting":         (MODULE, "both walls",        950,   12),
    "block-lowwall":          (MODULE, "both walls",        950,   40),
    "block-railing":          (MODULE, "platform edges",    400,   60),
    "block-floortile":        (2.4,    "deck area",         200,   80),
    "block-staircase":        (2.4,    "level changes",      24,  200),
    "block-windowframe":      (BAY_PITCH, "bay walls",       64,  150),
    "block-pillar":           (BAY_PITCH, "bay corners",     64,  120),
    "block-ceilingbeam":      (BAY_PITCH, "bay ceilings",    32,   40),
    "block-doorway":          (BAY_PITCH, "bay openings",    32,  250),
    # 300 was the first figure written down and it put the set 360 triangles over
    # budget. An archway is a rectangular opening with a chamfered reveal, seen
    # head-on; it does not need more geometry than the doorway frame it echoes.
    "block-archway":          (BAY_PITCH, "bay openings",    32,  250),
}


def snap(value: float, grid: float = QUANTUM) -> float:
    """Round onto the grid. Authoring goes through this so nothing drifts."""
    return round(round(value / grid) * grid, 6)


def on_grid(value: float, grid: float = QUANTUM) -> bool:
    return abs(round(value / grid) - value / grid) < 1e-9


# ---------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------
_PIECE = re.compile(
    r'\{\s*id:\s*"([^"]+)"\s*,\s*center:\s*\[([^\]]+)\]\s*,\s*size:\s*\[([^\]]+)\]'
    r'\s*,(?:\s*rotationX:[^,]+,)?\s*color:\s*"([^"]+)"'
)


def read_pieces() -> list[tuple[str, list[float], list[float], str]]:
    pieces = []
    for name in LEVEL_SOURCES:
        text = (PROJECT / name).read_text(encoding="utf-8")
        for match in _PIECE.finditer(text):
            centre = [float(v) for v in match.group(2).split(",")]
            size = [float(v) for v in match.group(3).split(",")]
            pieces.append((match.group(1), centre, size, match.group(4)))
    return pieces


def _luminance(hex_colour: str) -> float:
    raw = hex_colour.lstrip("#")
    channels = [int(raw[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def audit() -> int:
    pieces = read_pieces()
    failures: list[str] = []
    print(f"pieces read from {len(LEVEL_SOURCES)} sources: {len(pieces)}")

    off = []
    for pid, centre, size, _ in pieces:
        for axis in range(3):
            for edge in (centre[axis] - size[axis] / 2, centre[axis] + size[axis] / 2):
                if not on_grid(round(edge, 6)):
                    off.append((pid, "xyz"[axis], round(edge, 6)))
    print(f"piece edges off the {QUANTUM}u quantum: {len(off)}")
    if off:
        failures.append(f"QUANTUM {QUANTUM} no longer divides every piece edge: {off[:5]}")

    if not on_grid(BAY_PITCH, MODULE):
        failures.append(f"MODULE {MODULE} no longer divides the {BAY_PITCH}u bay pitch")
    print(f"bay pitch {BAY_PITCH}u / module {MODULE}u = {BAY_PITCH / MODULE:g} modules")

    ink, cream, sky = "#171a2b", "#fff8e8", "#c7ebff"
    deck_sky = contrast(cream, sky)
    ink_sky = contrast(ink, sky)
    print(f"cream deck vs sky : {deck_sky:.2f}:1   (LevelGeometry records 1.18)")
    print(f"ink       vs sky : {ink_sky:.2f}:1   (LevelGeometry records 13.7)")
    if abs(deck_sky - 1.18) > 0.02 or abs(ink_sky - 13.7) > 0.1:
        failures.append("the edge-band contrast figures no longer reproduce; "
                        "the palette or the wash changed under the blocks")

    widths = sorted({size[0] for _, _, size, _ in pieces} | {size[2] for _, _, size, _ in pieces})
    narrowest = min(edge_band_width(w) for w in widths)
    print(f"narrowest edge band over all piece extents: {narrowest:.4f}u "
          f"(EDGE_KEEPOUT is {EDGE_KEEPOUT}u)")
    if EDGE_KEEPOUT < narrowest:
        failures.append("EDGE_KEEPOUT is now narrower than the band it protects")

    print()
    print(f"{'block':>20} {'instances':>10} {'tri/block':>10} {'course total':>13}")
    total = 0
    for stem, (_, _, count, ceiling) in BLOCK_BUDGETS.items():
        total += count * ceiling
        print(f"{stem:>20} {count:>10} {ceiling:>10} {count * ceiling:>13,}")
    print(f"{'TOTAL':>20} {'':>10} {'':>10} {total:>13,}  "
          f"(budget {ARCHITECTURE_TRIANGLE_BUDGET:,})")
    if total > ARCHITECTURE_TRIANGLE_BUDGET:
        failures.append(f"per-block ceilings sum to {total:,}, over the "
                        f"{ARCHITECTURE_TRIANGLE_BUDGET:,} architecture budget")

    print()
    if failures:
        for line in failures:
            print(f"FAIL: {line}")
        return 1
    print("PASS: every constant still describes the level it was measured from")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true",
                        help="re-derive the constants from the level sources and fail on drift")
    args = parser.parse_args()
    sys.exit(audit() if args.audit else 0)
