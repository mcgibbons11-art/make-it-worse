#!/usr/bin/env python3
"""Deck legibility for wardrobe colours.

Reproduces `lib/game/avatar.ts`'s legibility model exactly - the same sRGB
transfer functions, the same DECK_WASH, the same WCAG 2.1 ratio - so a garment
palette can be checked before it reaches the wardrobe agent's own test. The
model is verified against the one deck value avatar.ts states in prose: the
bridge piece #8b72ff washes to #dcd2f1.

Reads its inputs from the source files rather than restating them, so a new
segment colour cannot silently escape the check.

usage: python deck_contrast.py [#rrggbb ...]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
SEGMENT_SOURCES = [
    PROJECT / "lib/game/level-definition.ts",
    PROJECT / "lib/game/segments-extra.ts",
    PROJECT / "lib/game/segments-more.ts",
    PROJECT / "lib/game/track.ts",
]
CONSTANTS = PROJECT / "lib/game/constants.ts"
LEVEL_GEOMETRY = PROJECT / "components/game/LevelGeometry.tsx"

# The floor a runner is read against is never a garment's own colour, so the bar
# is the same 3:1 non-text contrast minimum the avatar module already applies.
MIN_RATIO = 3.0


def _deck_wash() -> float:
    text = LEVEL_GEOMETRY.read_text(encoding="utf-8")
    match = re.search(r"DECK_WASH\s*=\s*([\d.]+)", text)
    if not match:
        raise SystemExit("DECK_WASH not found in LevelGeometry.tsx")
    return float(match.group(1))


def _cream() -> str:
    text = CONSTANTS.read_text(encoding="utf-8")
    match = re.search(r'cream:\s*"(#[0-9a-fA-F]{6})"', text)
    if not match:
        raise SystemExit("PALETTE.cream not found in constants.ts")
    return match.group(1)


def _piece_colors() -> list[str]:
    seen: list[str] = []
    for source in SEGMENT_SOURCES:
        if not source.exists():
            continue
        for hex_color in re.findall(r'color:\s*"(#[0-9a-fA-F]{6})"', source.read_text(encoding="utf-8")):
            if hex_color.lower() not in seen:
                seen.append(hex_color.lower())
    return seen


def to_linear(channel: float) -> float:
    return channel * 0.0773993808 if channel < 0.04045 else (channel * 0.9478672986 + 0.0521327014) ** 2.4


def to_srgb(channel: float) -> float:
    return channel * 12.92 if channel < 0.0031308 else 1.055 * channel ** 0.41666 - 0.055


def channels(hex_color: str) -> tuple[int, int, int]:
    value = int(hex_color.lstrip("#"), 16)
    return (value >> 16) & 255, (value >> 8) & 255, value & 255


def to_hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in rgb)


def wash_toward_cream(hex_color: str, wash: float, cream_hex: str) -> str:
    piece = [to_linear(v / 255) for v in channels(hex_color)]
    cream = [to_linear(v / 255) for v in channels(cream_hex)]
    return to_hex([to_srgb(p + (c - p) * wash) * 255 for p, c in zip(piece, cream)])


def luminance(hex_color: str) -> float:
    r, g, b = (
        v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        for v in (c / 255 for c in channels(hex_color))
    )
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: str, b: str) -> float:
    first, second = luminance(a), luminance(b)
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)


def deck_colors() -> list[str]:
    wash, cream = _deck_wash(), _cream()
    out: list[str] = []
    for piece in _piece_colors():
        deck = wash_toward_cream(piece, wash, cream)
        if deck not in out:
            out.append(deck)
    return out


def deck_contrast(hex_color: str) -> dict:
    decks = deck_colors()
    ratios = [(contrast_ratio(hex_color, deck), deck) for deck in decks]
    low = min(ratios)
    high = max(ratios)
    return {"color": hex_color, "min": round(low[0], 3), "worstDeck": low[1],
            "max": round(high[0], 3), "bestDeck": high[1], "passes": low[0] >= MIN_RATIO}


def _self_check() -> None:
    """avatar.ts states the bridge deck resolves to #dcd2f1; if this model does
    not reproduce that, every ratio it reports describes a floor the game does
    not draw."""
    got = wash_toward_cream("#8b72ff", _deck_wash(), _cream())
    if got != "#dcd2f1":
        raise SystemExit(f"deck model disagrees with avatar.ts: #8b72ff washed to {got}, expected #dcd2f1")


if __name__ == "__main__":
    _self_check()
    print("decks:", ", ".join(deck_colors()))
    for argument in sys.argv[1:]:
        report = deck_contrast(argument if argument.startswith("#") else f"#{argument}")
        flag = "PASS" if report["passes"] else "FAIL"
        print(f"  {report['color']}  min={report['min']:5.2f} vs {report['worstDeck']}"
              f"   max={report['max']:5.2f} vs {report['bestDeck']}   {flag}")
