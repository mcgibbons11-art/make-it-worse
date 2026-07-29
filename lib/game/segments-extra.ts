// Additional track segments.
//
// The shipped set is flat: almost every piece sits at y = 0 and the largest
// forced jump is a single hop across "gap". These eight add the shapes it was
// missing - a real climb, a plank you can fall off sideways, a branch the trap
// placer cannot cover with one trap, a pit, a lateral weave, a room below the
// datum, an open field with more than one route, and a corridor that keeps
// moving out from under you.
//
// Every segment obeys the same three rules the built-in ones do. Its pieces
// span exactly [0, length] along Z so buildTrack can butt it against its
// neighbours. Its hardest forced traverse stays inside the damped jump budget
// measured by worstTraverse. Its zone ids carry a prefix the risk model,
// placement validator and trap renderer already understand, because buildTrack
// appends a slot suffix and only a prefix survives that.

import { TRAP_TYPES } from "./trap-catalog";
import type { LevelPiece } from "./level-definition";
import type { TrackSegment } from "./track";
import type { PlacementZone, TrapType } from "./types";

/**
 * Fits a footprint about a metre across and neither chases the runner nor
 * sweeps an arc wider than the walkway. Everything here has a placement radius
 * of 1.05 or less, which is what a zone half a metre wide can actually hold.
 */
const NARROW_TRAPS: readonly TrapType[] = [
  "floor_fan",
  "soap_slick",
  "spring_pad",
  "giant_beach_ball",
  "toaster_launcher",
  "banana_peel",
  "robot_mop",
  "mousetrap",
  "sprinkler",
  "laundry_basket",
  "fridge_magnet",
];

/** Small enough to sit on a single 1.6u board without overhanging it. */
// The mousetrap is excluded on purpose. Its trigger is a 0.9u radius circle,
// so on a 1.6u board it covers all but a 0.15u strip against a 0.76u capsule —
// and these boards are mandatory, with no alternative traverse inside the jump
// budget. That is unavoidable rather than hard, which is the same reason
// placement.ts already bans sweeping traps from the classic stones.
const TILE_TRAPS: readonly TrapType[] = [
  "floor_fan",
  "soap_slick",
  "spring_pad",
  "giant_beach_ball",
  "banana_peel",
  "toaster_launcher",
  "laundry_basket",
];

/** A charging fridge or a chasing vacuum on a 1.8u lane leaves nowhere to go. */
const NO_CHASERS: readonly TrapType[] = TRAP_TYPES.filter(
  (type) => type !== "rolling_fridge" && type !== "angry_vacuum",
);

/** Both of these sweep wider than a 2.2u lane, so neither can be dodged. */
const NO_WIDE_SWEEPS: readonly TrapType[] = TRAP_TYPES.filter(
  (type) => type !== "rotating_toilet" && type !== "ceiling_fan",
);

/**
 * The ceiling fan's blade radius does not shrink on a bridge zone the way the
 * rotating toilet's orbit does, so it is the one thing a 3.2u tile cannot host.
 */
const NO_CEILING_FAN: readonly TrapType[] = TRAP_TYPES.filter(
  (type) => type !== "ceiling_fan",
);

/** Almost everything that fits down here is a leg-up rather than a hazard. */
const PIT_PAD_TRAPS: readonly TrapType[] = [
  "spring_pad",
  "soap_slick",
  "floor_fan",
  "banana_peel",
  "giant_beach_ball",
  "sprinkler",
];

// allowedTypes is required rather than defaulted: a new zone that silently
// accepts all sixteen traps is how a narrow platform ends up hosting a hammer.
function zone(
  id: string,
  label: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  groundY: number,
  maxOccupants: number,
  allowedTypes: readonly TrapType[],
): PlacementZone {
  return { id, label, minX, maxX, minZ, maxZ, groundY, maxOccupants, allowedTypes };
}

const piece = (
  id: string,
  center: LevelPiece["center"],
  size: LevelPiece["size"],
  color: string,
): LevelPiece => ({ id, center, size, color });

export const EXTRA_SEGMENTS: readonly TrackSegment[] = [
  {
    id: "risers",
    label: "Rising Steps",
    description: "Four steps up. Every one of them is a jump, not a stroll.",
    length: 11,
    difficulty: 2,
    // Each tread tops out 0.8u above the last: comfortably inside the 1.15u
    // damped jump, and impossible to walk up, since nothing in the controller
    // steps the player over a ledge. The stack is flush at y = -1 underneath so
    // it reads as a staircase rather than six floating slabs.
    pieces: [
      piece("foot", [0, -0.5, 0.9], [4.4, 1, 1.8], "#fff8e8"),
      piece("tread1", [0, -0.1, 2.6], [4, 1.8, 1.6], "#b9a7ff"),
      piece("tread2", [0, 0.3, 4.2], [4, 2.6, 1.6], "#8b72ff"),
      piece("tread3", [0, 0.7, 5.8], [4, 3.4, 1.6], "#b9a7ff"),
      piece("deck", [0, 1.1, 7.8], [4.4, 4.2, 2.4], "#8b72ff"),
      piece("ledge", [0, -0.1, 10], [4.4, 1.8, 2], "#fff8e8"),
    ],
    zones: [
      zone("steps_foot", "Bottom step", -1.9, 1.9, 0.2, 1.6, 0.05, 1, TRAP_TYPES),
      zone("steps_mid", "Second tread", -1.7, 1.7, 3.6, 4.8, 1.65, 1, NARROW_TRAPS),
      zone("steps_deck", "Top deck", -1.9, 1.9, 6.9, 8.8, 3.25, 2, TRAP_TYPES),
    ],
  },
  {
    id: "beam",
    label: "The Beam",
    description: "One plank wide, nine long, and nobody fitted a handrail.",
    length: 11.4,
    difficulty: 3,
    // 1.2u of plank against a 0.76u capsule leaves 0.44u of error for nine
    // metres. There is no jump here at all; the whole segment is the walk.
    pieces: [
      piece("apron_in", [0, -0.45, 0.6], [2.4, 0.9, 1.2], "#4b8dff"),
      piece("plank", [0, -0.25, 5.7], [1.2, 0.5, 9], "#ffd84d"),
      piece("apron_out", [0, -0.45, 10.8], [2.4, 0.9, 1.2], "#4b8dff"),
    ],
    zones: [
      zone("bridge_plank_a", "Plank front", -0.55, 0.55, 2.2, 3.8, 0.05, 1, NARROW_TRAPS),
      zone("bridge_plank_b", "Plank middle", -0.55, 0.55, 5.1, 6.7, 0.05, 1, NARROW_TRAPS),
      zone("bridge_plank_c", "Plank back", -0.55, 0.55, 8, 9.6, 0.05, 1, NARROW_TRAPS),
    ],
  },
  {
    id: "fork",
    label: "True Fork",
    description: "Two lanes over one void. Nobody can watch both of them.",
    length: 10.2,
    difficulty: 2,
    // The 3u void between the lanes is crossable, but only as a committed
    // sideways jump off a 1.8u lane, so a runner who guesses wrong pays for it.
    pieces: [
      piece("lip", [0, -0.5, 0.7], [5.8, 1, 1.4], "#57dfa1"),
      piece("lane_left", [-2.4, -0.4, 5], [1.8, 0.8, 7.2], "#4b8dff"),
      piece("lane_right", [2.4, -0.4, 5], [1.8, 0.8, 7.2], "#4b8dff"),
      piece("merge", [0, -0.5, 9.4], [5.8, 1, 1.6], "#57dfa1"),
    ],
    // "island" prices these at 1.0 for the same reason the split islands get
    // it: a trap on one lane only threatens the half of the field that chose
    // that lane, so it is worth less than the same trap on a forced route.
    zones: [
      zone("island_fork_left", "Left lane", -3.15, -1.65, 2.4, 7.6, 0.05, 1, NO_CHASERS),
      zone("island_fork_right", "Right lane", 1.65, 3.15, 2.4, 7.6, 0.05, 1, NO_CHASERS),
    ],
  },
  {
    id: "springpit",
    label: "The Spring Pit",
    description: "One pad in the pit. Climbing out of it wants a trampoline.",
    length: 11.7,
    difficulty: 3,
    // Dropping onto the pad is free. Leaving it is a 2.9u gap taken with a 0.9u
    // rise off a 2.2u run-up, which is the hardest traverse in the set. The
    // budget scores distance and height separately, but the real arc is only
    // 3.41u long by the time it is 0.9u up, so the margin here is 0.5u rather
    // than the 4.1u the headline figure suggests. A spring pad dropped in the
    // pit zone turns that from a commitment into a formality.
    pieces: [
      piece("lip", [0, -0.5, 1], [4.8, 1, 2], "#ff9b4a"),
      piece("pad", [0, -1.4, 5.7], [2.4, 1, 2.2], "#57dfa1"),
      piece("landing", [0, -0.5, 10.7], [4.8, 1, 2], "#ff9b4a"),
    ],
    zones: [
      zone("pit_lip", "Take-off lip", -2.1, 2.1, 0.3, 1.9, 0.05, 1, TRAP_TYPES),
      zone("pit_pad", "Sunken pad", -0.95, 0.95, 5, 6.4, -0.85, 1, PIT_PAD_TRAPS),
      zone("pit_landing", "Far landing", -2.1, 2.1, 10.1, 11.6, 0.05, 1, TRAP_TYPES),
    ],
  },
  {
    id: "chicane",
    label: "The Chicane",
    description: "The route changes sides three times and never waits for you.",
    length: 14.3,
    difficulty: 2,
    // Each lane overlaps the next in Z but sits 2.4u across from it, so the
    // only way on is a sideways jump. The lanes are spaced so that skipping one
    // - apron to B, A to C, B to exit - is over budget in every case, which is
    // what stops the whole weave from being run down one side.
    pieces: [
      piece("apron", [0, -0.5, 0.6], [5.2, 1, 1.2], "#fff8e8"),
      piece("lane_a", [-2.3, -0.45, 2.7], [2.2, 0.9, 3], "#ff5c65"),
      piece("lane_b", [2.3, -0.45, 7.1], [2.2, 0.9, 3], "#ff9b4a"),
      piece("lane_c", [-2.3, -0.45, 10.3], [2.2, 0.9, 3], "#ff5c65"),
      piece("exit", [0, -0.5, 13.6], [5.2, 1, 1.4], "#fff8e8"),
    ],
    zones: [
      zone("chicane_a", "First lane", -3.15, -1.45, 1.6, 3.8, 0.05, 1, NO_WIDE_SWEEPS),
      zone("chicane_b", "Second lane", 1.45, 3.15, 6, 8.2, 0.05, 1, NO_WIDE_SWEEPS),
      zone("chicane_c", "Third lane", -3.15, -1.45, 9.2, 11.4, 0.05, 1, NO_WIDE_SWEEPS),
    ],
  },
  {
    id: "sunken",
    label: "The Sunken Lounge",
    description: "Drop into the conversation pit. It takes two steps to leave.",
    length: 12,
    difficulty: 1,
    // The only segment whose floor sits below the datum. Falling in is free,
    // getting out is two 0.9u risers, and the 6u by 5.8u floor between them is
    // the most generous piece of ground on any track - which is exactly what
    // makes it worth filling with furniture.
    pieces: [
      piece("rim", [0, -0.5, 0.9], [5.6, 1, 1.8], "#fff8e8"),
      piece("floor", [0, -2.3, 5.7], [6, 1, 5.8], "#4b8dff"),
      piece("step", [0, -1.4, 9.5], [5.2, 1, 1.8], "#8b72ff"),
      piece("exit", [0, -0.5, 11.2], [5.6, 1, 1.6], "#fff8e8"),
    ],
    // The lounge floor earns the runway multiplier honestly: it is wide, flat
    // and open, so a trap standing on it is the easiest kind to walk around.
    // The step out of the pit is a choke and gets the default price instead.
    zones: [
      zone("runway_sunk_left", "Lounge left", -2.7, -0.3, 3.3, 8, -1.75, 1, TRAP_TYPES),
      zone("runway_sunk_right", "Lounge right", 0.3, 2.7, 3.3, 8, -1.75, 1, TRAP_TYPES),
      zone("sunk_steps", "Way out", -2.2, 2.2, 8.9, 10.1, -0.85, 1, NARROW_TRAPS),
    ],
  },
  {
    id: "floorboards",
    label: "Loose Floorboards",
    description: "Half the boards are gone. The other half are negotiable.",
    length: 12,
    difficulty: 2,
    // A field rather than a line. Two rows are down to a single board, and they
    // are on opposite sides, which forces a 3.16u diagonal across the middle -
    // the longest jump in these eight. The full rows at either end keep the
    // seams with the neighbouring segments honest.
    pieces: [
      piece("board_1l", [-2.3, -0.25, 0.8], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_1c", [0, -0.25, 0.8], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_1r", [2.3, -0.25, 0.8], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_2l", [-2.3, -0.55, 3.4], [1.6, 0.5, 1.6], "#ff9b4a"),
      piece("board_3r", [2.3, -0.55, 6], [1.6, 0.5, 1.6], "#ff9b4a"),
      piece("board_4l", [-2.3, -0.25, 8.6], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_4r", [2.3, -0.55, 8.6], [1.6, 0.5, 1.6], "#ff9b4a"),
      piece("board_5l", [-2.3, -0.25, 11.2], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_5c", [0, -0.25, 11.2], [1.6, 0.5, 1.6], "#ffd84d"),
      piece("board_5r", [2.3, -0.25, 11.2], [1.6, 0.5, 1.6], "#ffd84d"),
    ],
    // "stones" is the right class for isolated pads: it also bans the toilet
    // and the hammer through the placement validator, and neither of those
    // leaves a route across a 1.6u board.
    zones: [
      zone("stones_board_first", "Entry board", -0.7, 0.7, 0.15, 1.45, 0.05, 1, TILE_TRAPS),
      zone("stones_board_pinch", "The only board", -3, -1.6, 2.75, 4.05, -0.25, 1, TILE_TRAPS),
      zone("stones_board_last", "Late board", 1.6, 3, 7.95, 9.25, -0.25, 1, TILE_TRAPS),
    ],
  },
  {
    id: "sidestep",
    label: "Sidestep",
    description: "The floor drifts right the whole way. Argue with it and fall.",
    length: 12.6,
    difficulty: 2,
    // Four tiles, each shifted 1.6u across, butted end to end. The floor never
    // breaks, so there is nothing to jump; what narrows is the overlap between
    // consecutive tiles, leaving a 1.6u doorway and a 0.84u window for a 0.76u
    // capsule to steer through four times.
    pieces: [
      piece("apron", [0, -0.5, 0.7], [5.2, 1, 1.4], "#fff8e8"),
      piece("drift_a", [-2.4, -0.45, 2.6], [3.2, 0.9, 2.4], "#57dfa1"),
      piece("drift_b", [-0.8, -0.45, 5], [3.2, 0.9, 2.4], "#4b8dff"),
      piece("drift_c", [0.8, -0.45, 7.4], [3.2, 0.9, 2.4], "#57dfa1"),
      piece("drift_d", [2.4, -0.45, 9.8], [3.2, 0.9, 2.4], "#4b8dff"),
      piece("exit", [0, -0.5, 11.8], [5.2, 1, 1.6], "#fff8e8"),
    ],
    // "bridge" both prices this at 1.35, which a corridor with a drop on both
    // sides deserves, and shrinks the rotating toilet's orbit to 1.05 so it
    // covers two thirds of a tile instead of all of it.
    zones: [
      zone("bridge_drift_a", "First tile", -3.6, -1.2, 1.7, 3.5, 0.05, 1, NO_CEILING_FAN),
      zone("bridge_drift_b", "Second tile", -2, 0.4, 4.1, 5.9, 0.05, 1, NO_CEILING_FAN),
      zone("bridge_drift_d", "Last tile", 1.2, 3.6, 8.9, 10.7, 0.05, 1, NO_CEILING_FAN),
    ],
  },
];
