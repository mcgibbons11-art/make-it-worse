#!/usr/bin/env python3
"""Garment-specific authoring on top of spec_lib.

A garment differs from a prop in three ways that the shared library has no
concept of, and all three come from the same fact: the model has to fit a body
that moves.

1. MOUNTING. A prop stands on the floor in its own frame. A garment is authored
   in the RUNNER FACTORY's frame and then parented to one of the runner's named
   pivots. A hoodie needs three of them - the body rides the torso, each sleeve
   rides its own arm - so `mount()` records which socket a component subtree
   belongs to and what its offset from that socket is.
2. CLEARANCE. Every dimension traces to a measured body dimension plus a stated
   clearance, not to a reference pixel alone, because a sleeve that matches the
   photo but is narrower than the arm is simply wrong.
3. SILHOUETTE COST. The runner is 0.817u wide and that width comes from its
   HANDS. Anything inboard of x = +/-0.4085 is free; anything past it spends a
   shared 0.0711u-per-side budget. `silhouette_cost()` states the cost a shape
   will have before it is built, so the build can be checked against a number
   that was predicted rather than one that was discovered.

Every constant here is read from runner-measurement.json rather than restated,
so a change in the runner factory shows up as a failing number and not as a
garment that quietly stops fitting.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
MEASUREMENT = json.loads((HERE / "runner-measurement.json").read_text(encoding="utf-8"))

# --- the runner, as measured ------------------------------------------------
BODY_HALF_WIDTH = MEASUREMENT["factoryFrame"]["visibleBox"]["size"][0] / 2.0   # 0.4085
FIT_SCALE = MEASUREMENT["playSpace"]["fitScale"]                                # 0.97998
DECK_WIDTH_CAP = MEASUREMENT["playSpace"]["widthBudget"]                        # 0.94
BUDGET_PER_SIDE = MEASUREMENT["playSpace"]["headroomFactoryU"] / 2.0            # 0.0711
LANDING_SQUASH = MEASUREMENT["playSpace"]["landingSquashWidthMultiplier"]       # 1.1323

SOCKETS = {socket["name"]: socket for socket in MEASUREMENT["sockets"] if socket.get("found")}
PARTS = MEASUREMENT["partBoxes"]


def socket_world(name: str) -> tuple[float, float, float]:
    if name not in SOCKETS:
        raise SystemExit(f"{name} is not a mount socket on the measured runner")
    return tuple(SOCKETS[name]["worldPosition"])  # type: ignore[return-value]


def part(name: str) -> dict:
    if name not in PARTS or PARTS[name] is None:
        raise SystemExit(f"{name} is not a measured body part")
    return PARTS[name]


def socket_scale(name: str) -> list[float]:
    """A mount socket's world scale, which is NOT 1 on most of them.

    The factory puts a unit-primitive component's `dimensions` on its pivot
    node's scale, so six of the thirteen mount sockets are scaled: Torso__pivot
    is (1, 1, 0.8), each Hand__pivot is (0.145, 0.15, 0.105), each
    Sneaker__pivot is (0.198, 0.205, 0.3) and each Shoulder cap__pivot is
    0.165 uniform. A garment parented straight onto one of those inherits the
    scale and comes out squashed, or in the sneaker's case roughly a fifth of
    its authored size and stretched along z. Only Head mass, both Arm, both Leg
    and Neck are unit scale."""
    return SOCKETS[name]["worldScale"] if name in SOCKETS else [1.0, 1.0, 1.0]


def compensation_scale(socket: str) -> list[float]:
    """The local scale a mount group needs so its contents land at true size."""
    return [round(1.0 / v, 6) for v in socket_scale(socket)]


def local_offset(socket: str, world_point) -> list[float]:
    """Offset from a socket to a point, expressed in the socket's local frame.

    A child's world position is `socketOrigin + socketScale * localPosition`, so
    the world offset has to be divided by the socket's scale. Skipping that is
    the same bug as skipping the compensation scale, and it moves a garment by
    up to a fifth of the body."""
    origin = socket_world(socket)
    scale = socket_scale(socket)
    return [round((world_point[i] - origin[i]) / scale[i], 5) for i in range(3)]


def assert_identity_sockets() -> None:
    """Rotation only. Scale is deliberately not asserted to be 1 - it is not, and
    `compensation_scale` is how that is handled."""
    for name, record in SOCKETS.items():
        if any(abs(v) > 1e-6 for v in record["worldRotation"]):
            raise SystemExit(f"{name} is no longer at identity rest rotation; every local offset "
                             "published by this module assumes it is")


UNIT_SCALE_SOCKETS = sorted(
    name for name in SOCKETS if all(abs(v - 1.0) < 1e-6 for v in SOCKETS[name]["worldScale"]))
SCALED_SOCKETS = {name: SOCKETS[name]["worldScale"] for name in sorted(SOCKETS)
                  if any(abs(v - 1.0) >= 1e-6 for v in SOCKETS[name]["worldScale"])}


# --- silhouette accounting --------------------------------------------------
def silhouette_cost(reach_x: float) -> float:
    """What a shape reaching `reach_x` from the centre line costs, per side."""
    return round(max(0.0, reach_x - BODY_HALF_WIDTH), 5)


def tube_reach_x(axis_a, axis_b, radius: float) -> float:
    """Widest |x| of an open tube of `radius` about the segment a->b.

    Not `min(x) - radius`: that is the answer for a capsule, whose spherical cap
    reaches the full radius in every direction. An open tube reaches only
    radius * sqrt(1 - dx^2), which is why a sleeve can carry a wall the arm's own
    capsule cap hides entirely."""
    direction = [axis_b[i] - axis_a[i] for i in range(3)]
    length = math.sqrt(sum(v * v for v in direction))
    if length <= 0:
        raise SystemExit("degenerate tube axis")
    dx = direction[0] / length
    lateral = radius * math.sqrt(max(0.0, 1.0 - dx * dx))
    return round(max(abs(axis_a[0]), abs(axis_b[0])) + lateral, 5)


def capsule_reach_x(axis_a, axis_b, radius: float) -> float:
    return round(max(abs(axis_a[0]), abs(axis_b[0])) + radius, 5)


def lathe_reach_x(radius: float, centre_x: float = 0.0) -> float:
    return round(abs(centre_x) + radius, 5)


# --- mount declarations -----------------------------------------------------
def mount(socket: str, world_origin, note: str) -> dict:
    """One mount group: which runner pivot the subtree is parented to, where its
    origin sits in that pivot's local frame, and the local scale that cancels the
    pivot's own scale."""
    scale = socket_scale(socket)
    compensation = compensation_scale(socket)
    return {
        "socket": socket,
        "localOffset": local_offset(socket, world_origin),
        "localScale": compensation,
        "socketWorldScale": [round(v, 6) for v in scale],
        "worldOrigin": [round(float(v), 5) for v in world_origin],
        "rest": "identity rotation",
        "scaleNote": ("socket is unit scale; localScale is 1 and may be omitted"
                      if compensation == [1.0, 1.0, 1.0]
                      else f"socket carries world scale {scale}, so the mount group MUST take "
                           f"localScale {compensation} or the garment inherits the squash"),
        "note": note,
    }


def fit_contract(mounts: dict[str, dict], covers: list[str], clearances: list[dict],
                 predicted_cost: float, notes: list[str]) -> dict:
    """The block a garment spec carries so the wardrobe agent never has to guess
    where the model goes or what it costs."""
    return {
        "frame": "runner factory frame, the same frame createMAKEITWORSERunnerModel authors in",
        "unitsNote": "Author in factory units. PlayerVisual.fitToPlaySpace scales the whole model "
                     f"by {FIT_SCALE:.5f} and the mount sockets are descendants of that scaled "
                     "node, so a garment parented to a socket inherits the same scale and needs no "
                     "conversion.",
        "mountRule": "PlayerVisual strips userData off the template before cloning, so "
                     "root.userData.sculptRuntime does not survive into the game. Mount by name: "
                     "clone.getObjectByName(socket).add(mountGroup).",
        "mounts": mounts,
        "coversBodyMeshes": covers,
        "clearances": clearances,
        "silhouette": {
            "bodyHalfWidth": BODY_HALF_WIDTH,
            "budgetPerSide": round(BUDGET_PER_SIDE, 5),
            "predictedCostPerSide": round(predicted_cost, 5),
            "measuredCostPerSide": None,
            "measuredBy": "assets/reference/wardrobe/preview/fit_check.ts, filled by the fit run",
            "budgetMeasuredAt": "rest",
            "budgetRationale":
                "Measured at rest, not at the landing squash. PlayerVisual scales the outer group "
                f"by {LANDING_SQUASH:.4f} in x and z on a landing, which multiplies body and "
                "garment identically and so does not change a garment's share of the width. It "
                "also puts the undressed runner at "
                f"{MEASUREMENT['playSpace']['fittedWidth'] * LANDING_SQUASH:.4f}u, already "
                f"{MEASUREMENT['playSpace']['fittedWidth'] * LANDING_SQUASH / DECK_WIDTH_CAP * 100:.1f}% "
                f"of the {DECK_WIDTH_CAP}u cap with no wardrobe at all, so a squash-time cap would "
                "forbid every garment before it forbade a wide one.",
        },
        "notes": notes,
    }


def clearance(where: str, body_surface: float, garment_inner: float, note: str) -> dict:
    return {"where": where,
            "bodySurface": round(body_surface, 5),
            "garmentInner": round(garment_inner, 5),
            "gap": round(garment_inner - body_surface, 5),
            "note": note}


# --- geometry helpers a garment needs and a prop does not -------------------
def lathe_profile(stops: list[tuple[float, float]]) -> dict:
    """LatheGeometry profile from (radius, y) stops, guarded against the zero
    radius that collapses a ring into a cone point."""
    return {"points": [[round(max(0.0006, r), 5), round(y, 5)] for r, y in stops],
            "segments": 32}


def undulating_profile(y0: float, y1: float, base_radius, baffles: int, bulge: float,
                       samples_per_baffle: int = 7) -> list[tuple[float, float]]:
    """A quilted wall: the lathe radius swells between seams and pinches at each
    one, so a puffer's baffles are real relief in the silhouette rather than a
    normal map that vanishes at the outline.

    `base_radius` may be a constant or a callable of the 0..1 height fraction."""
    radius_at = base_radius if callable(base_radius) else (lambda _t: base_radius)
    total = baffles * samples_per_baffle
    stops: list[tuple[float, float]] = []
    for i in range(total + 1):
        t = i / total
        y = y0 + (y1 - y0) * t
        # cos over each baffle: -1 at the seams, +1 at the middle of a baffle.
        phase = (t * baffles) % 1.0
        swell = -math.cos(2.0 * math.pi * phase)
        stops.append((radius_at(t) + bulge * swell, y))
    return stops


def ellipse_scale(rx: float, rz: float) -> tuple[float, float, float]:
    """A lathe is circular; the torso is not. Squash the node in z instead of
    authoring an elliptical profile, exactly as the runner's own torso does
    (its transform carries scale [1, 1, 0.8])."""
    return (1.0, 1.0, round(rz / rx, 5))


def arm_axis(side: str, from_shoulder: float = 0.0, to_wrist: float = 0.0) -> tuple[list, list]:
    """The arm capsule's axis segment in world space, optionally trimmed.

    Derived from the measured Arm box rather than from the factory source: the
    box is the arm capsule's bounds, and a capsule's bounds are its axis segment
    grown by the radius, so insetting the box by the radius recovers the axis."""
    name = f"Arm {side}"
    box = part(name)
    radius = (box["size"][2]) / 2.0
    sign = -1.0 if side == "left" else 1.0
    outer_x = box["min"][0] + radius if sign < 0 else box["max"][0] - radius
    inner_x = box["max"][0] - radius if sign < 0 else box["min"][0] + radius
    top = [inner_x, box["max"][1] - radius, 0.0]
    bottom = [outer_x, box["min"][1] + radius, 0.0]
    direction = [bottom[i] - top[i] for i in range(3)]
    length = math.sqrt(sum(v * v for v in direction))
    unit = [v / length for v in direction]
    start = [round(top[i] + unit[i] * from_shoulder, 5) for i in range(3)]
    end = [round(bottom[i] - unit[i] * to_wrist, 5) for i in range(3)]
    return start, end


def arm_radius(side: str) -> float:
    return round(part(f"Arm {side}")["size"][2] / 2.0, 5)


def tube_path(points, radius: float, radial_segments: int = 12) -> dict:
    return {"points": [[round(float(v), 5) for v in p] for p in points],
            "radius": round(radius, 5), "radialSegments": radial_segments, "closed": False}


def curve_sweep(spine, cross_section) -> dict:
    return {"spine": [[round(float(v), 5) for v in p] for p in spine],
            "crossSection": {"points": [[round(float(v), 5) for v in p] for p in cross_section]},
            "closed": False}


def arc_points(radius: float, y: float, start_deg: float, end_deg: float, count: int,
               z_scale: float = 1.0, centre=(0.0, 0.0, 0.0)) -> list[list[float]]:
    """Points on a horizontal arc, for a drawstring, a zip line or a brim spine.
    Angle is measured from +z (the runner faces +z) toward +x."""
    out = []
    for i in range(count):
        a = math.radians(start_deg + (end_deg - start_deg) * i / max(1, count - 1))
        out.append([round(centre[0] + radius * math.sin(a), 5),
                    round(centre[1] + y, 5),
                    round(centre[2] + radius * z_scale * math.cos(a), 5)])
    return out


def wardrobe_readiness(root: str, mounts: dict[str, dict], extra: dict[str, str]) -> dict:
    contract = {
        "rootMotion": f"sculptRuntime.nodes['{root}'] is the garment root; every mount group is a "
                      "child of it in the authored model and is reparented to its runner socket at "
                      "equip time.",
    }
    for mount_id, record in mounts.items():
        contract[mount_id] = (f"reparent to getObjectByName('{record['socket']}') and set position "
                              f"{record['localOffset']}; the socket is at identity rest rotation so "
                              "no rotation correction is needed")
    contract.update(extra)
    return contract
