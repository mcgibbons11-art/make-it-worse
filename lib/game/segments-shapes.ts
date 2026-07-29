// Segments that change the shape of a course rather than its contents.
//
// Every segment written before this file hands the runner back exactly where it
// received them: on x = 0, with the walking surface at y = 0. Lay thirty of them
// end to end and the result is thirty interesting tiles in one straight
// corridor, which is what a course has looked like from the outside since the
// game shipped. These six are the first that finish somewhere other than where
// they started, and buildTrack now carries that displacement across the seam
// (see `Lane` in track.ts), so a composed course bends, climbs and comes back
// down over its whole length instead of snapping to the axis every twelve
// metres.
//
// WHAT THE CAMERA ALLOWS. CameraRig is pinned to +Z: it sits 7.4u behind the
// runner and looks 4.1u in front of them, and neither offset rotates. So a
// course can move sideways and up and down as much as it likes, and can never
// turn a corner, double back, or loop. Everything here advances in +Z for that
// reason and no other. A hairpin or a ring around a room needs the rig to yaw
// toward the direction of travel first.
//
// HOW A PLAYER READS IT. The route is legible from the geometry and the palette
// alone, because there is nothing else to read it from - no arrows, no markers,
// no minimap. Three rules are held to throughout:
//
//   The through-route is always the widest surface in frame, and always the one
//   the camera is already pointing at. An optional line is narrower and off to
//   one side, so "the big floor" is never the wrong answer.
//   Cream is neutral ground that always continues. Green is a landing you have
//   to reach. Yellow is the thing you are about to do - a take-off, a step, a
//   crest. Purple is above the datum and blue is below it, which is how a
//   storey reads as a storey rather than as more corridor.
//   Nothing the runner must reach is ever behind them or outside the 4u the rig
//   looks ahead. The bends are staircases of rectangles rather than diagonals
//   because a LevelPiece cannot rotate about Y, and a staircase reads its own
//   direction from above.
//
// WHAT IS STILL MISSING. Two of these are honestly beyond geometry. A course
// that runs a storey up wants the deck edge lit or fenced so the drop reads
// before the runner is over it, and a two-route segment wants each mouth marked
// as a route rather than as a hole. Both live in LevelGeometry and neither is
// buildable from a track segment.
//
// The rules the earlier batches follow are followed here too. Pieces span
// exactly [0, length] along Z. The near face is centred on x = 0 with its
// surface at y = 0, and the far face is centred on `exitOffset`, which is what
// keeps a seam flush at any lane. Nothing is authored narrower than the 1.2u
// beam, because the runner's silhouette is 0.91u across.

import { TRAP_TYPES } from "./trap-catalog";
import type { LevelPiece } from "./level-definition";
import type { TrackSegment } from "./track";
import type { PlacementZone, TrapType } from "./types";

/**
 * Small, static or telegraphed, for the same reasons the previous batch gives:
 * nothing that chases, nothing that sweeps wider than the deck it stands on,
 * and no mousetrap, whose 0.9u trigger radius leaves no line across a pad two
 * metres across. Used on every surface a runner arrives at through the air,
 * because a runner in flight keeps 35% of their steering and cannot choose
 * where on the pad they land.
 */
const TIGHT_DECK_TRAPS: readonly TrapType[] = [
  "floor_fan",
  "soap_slick",
  "spring_pad",
  "giant_beach_ball",
  "banana_peel",
  "toaster_launcher",
  "laundry_basket",
];

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

const CREAM = "#fff8e8";
const BLUE = "#4b8dff";
const PURPLE = "#8b72ff";
const YELLOW = "#ffd84d";
const GREEN = "#57dfa1";
const ORANGE = "#ff9b4a";

export const SHAPE_SEGMENTS: readonly TrackSegment[] = [
  {
    id: "veer_right",
    label: "The Right Turn",
    description: "The floor steps away to the right. Your momentum does not.",
    length: 10.4,
    difficulty: 1,
    exitOffset: [2.2, 0],
    // The bend, and the reason the lane exists at all. There is no jump and no
    // hole: what this asks for is a change of line at running speed, which is
    // the one demand a corridor cannot make. Three rectangles rather than a
    // diagonal because a LevelPiece has no Y rotation, and the staircase reads
    // its direction from a camera looking down at it. Everything after it on
    // the course is drawn 2.2u to the right, so the turn is permanent.
    pieces: [
      piece("in", [0, -0.5, 1], [5.2, 1, 2], CREAM),
      piece("mid", [1.1, -0.5, 4.5], [5, 1, 5], BLUE),
      piece("out", [2.2, -0.5, 8.7], [5.2, 1, 3.4], CREAM),
    ],
    // The inside of a turn is where a runner carrying speed ends up, and the
    // outside is where a runner who respected it ends up. Pricing them the same
    // is correct: both are open floor, and which one is worse to stand a fan on
    // depends entirely on how the player took the corner.
    zones: [
      zone("runway_veer_r_in", "Into the turn", -2.2, 2.2, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      zone("runway_veer_r_inside", "Inside line", -1.3, 1.3, 2.6, 4.6, 0.05, 1, TRAP_TYPES),
      zone("runway_veer_r_outside", "Outside line", 0.9, 3.5, 4.8, 6.8, 0.05, 1, TRAP_TYPES),
    ],
  },
  {
    id: "veer_left",
    label: "The Left Turn",
    description: "The same corner, taken the other way. Bring it back.",
    length: 10.4,
    difficulty: 1,
    exitOffset: [-2.2, 0],
    // The answer to the right turn, and the reason a course can use either. A
    // composition that bends one way has to bend back before the finish room,
    // because the door is fixed on the centre line - isPlayableTrack refuses
    // anything that does not, so this segment is load-bearing rather than
    // decorative.
    pieces: [
      piece("in", [0, -0.5, 1], [5.2, 1, 2], CREAM),
      piece("mid", [-1.1, -0.5, 4.5], [5, 1, 5], BLUE),
      piece("out", [-2.2, -0.5, 8.7], [5.2, 1, 3.4], CREAM),
    ],
    zones: [
      zone("runway_veer_l_in", "Into the turn", -2.2, 2.2, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      zone("runway_veer_l_inside", "Inside line", -1.3, 1.3, 2.6, 4.6, 0.05, 1, TRAP_TYPES),
      zone("runway_veer_l_outside", "Outside line", -3.5, -0.9, 4.8, 6.8, 0.05, 1, TRAP_TYPES),
    ],
  },
  {
    id: "upper_deck",
    label: "The Upper Deck",
    description: "Two hops up, and the rest of the course is up here with you.",
    length: 12,
    difficulty: 2,
    exitOffset: [0, 1.6],
    // The only segment that leaves the runner on a different floor. The climb
    // is 0.4u then 0.8u, both over 1.2u of open air, so neither is a step and
    // neither is close to the budget; the segment is not the climb but what it
    // costs, because everything after it is drawn 1.6u higher and the way back
    // down is a separate segment somebody has to spend a slot on.
    //
    // The middle step is 3.2u wide against 5.2u either side of it, which is the
    // pinch: it is the only surface here a runner can miss, and it is the one
    // they are looking at while gaining height.
    pieces: [
      piece("foot", [0, -0.5, 1], [5.2, 1, 2], CREAM),
      piece("step", [0, -0.1, 4.4], [3.2, 1, 2.4], YELLOW),
      piece("deck", [0, 0.7, 8.4], [4.8, 1, 3.2], PURPLE),
      piece("sill", [0, 1.1, 11], [5.2, 1, 2], CREAM),
    ],
    zones: [
      zone("runway_upper_foot", "Below the climb", -2.2, 2.2, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      zone("stones_upper_step", "The step", -1.4, 1.4, 3.5, 5.3, 0.45, 1, TIGHT_DECK_TRAPS),
      zone("runway_upper_deck", "The upper deck", -2.2, 2.2, 7.1, 9.7, 1.25, 2, TRAP_TYPES),
    ],
  },
  {
    id: "down_shaft",
    label: "The Drop Shaft",
    description: "Three shelves down, alternating sides. Falling is the easy part.",
    length: 13.2,
    difficulty: 2,
    exitOffset: [0, -1.6],
    // The way back to the datum, and the only descent in the catalogue taken as
    // a sequence rather than as one drop. Height costs nothing on the way down,
    // so the budget is never the constraint here; what is hard is that each
    // shelf is 3.2u wide and sits on the far side from the last one, so the
    // runner is choosing a landing while already falling with 35% of their
    // steering. Overshoot and the next thing under you is the kill plane.
    pieces: [
      piece("lip", [0, -0.5, 1], [5.2, 1, 2], CREAM),
      piece("shelf_a", [-1.6, -0.9, 4.6], [3.2, 1, 2.8], ORANGE),
      piece("shelf_b", [1.6, -1.5, 8.6], [3.2, 1, 2.8], ORANGE),
      piece("floor", [0, -2.1, 11.6], [5.2, 1, 3.2], CREAM),
    ],
    zones: [
      zone("stones_shaft_a", "First shelf", -3, -0.2, 3.5, 5.7, -0.35, 1, TIGHT_DECK_TRAPS),
      zone("stones_shaft_b", "Second shelf", 0.2, 3, 7.5, 9.7, -0.95, 1, TIGHT_DECK_TRAPS),
      zone("runway_shaft_floor", "The bottom", -2.2, 2.2, 10.3, 12.9, -1.55, 2, TRAP_TYPES),
    ],
  },
  {
    id: "grand_hall",
    label: "The Grand Hall",
    description: "A room with a plinth in the middle of it. Left, right, or over.",
    length: 12,
    // Rated with the parlour rather than with the sunken lounge. Both are open
    // floor a runner would have to work at to fall off; the lounge is a 1 only
    // because leaving it is two risers, and there is nothing to climb here.
    difficulty: 0,
    // The widest floor in the game at 6.8u, sunk 0.35u so it reads as a room
    // rather than as more corridor, and the only one with something standing in
    // the middle of it. The plinth is what makes it a room rather than a wide
    // hallway: it is 0.8u up off a floor that surrounds it, so it is optional,
    // and standing on it is the only way to see the whole hall at once.
    //
    // The plinth rests on the floor rather than hanging over it. That matters:
    // PlayerController grounds the runner on the highest piece whose footprint
    // contains them, so anything with air underneath makes the floor beneath it
    // unstandable. Nothing here may become an overpass for that reason.
    pieces: [
      piece("door_in", [0, -0.5, 1], [5.2, 1, 2], CREAM),
      piece("floor", [0, -0.85, 6], [6.8, 1, 8], BLUE),
      piece("plinth", [0, -0.05, 6], [2.8, 1, 3.2], YELLOW),
      piece("door_out", [0, -0.5, 11], [5.2, 1, 2], CREAM),
    ],
    // Three metres of clear floor on either side of anything placed on a flank,
    // which is the parlour's bargain: a trap in here has to be well placed
    // rather than lucky. The plinth is the exception and takes the sweep ban,
    // because a 1.6u orbit covers a 2.8u top completely.
    zones: [
      zone("runway_hall_in", "The doorway", -2.2, 2.2, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      // As wide as the channel actually is. A zone narrower than the ground it
      // stands on tells difficulty.ts there is nowhere to dodge when there are
      // two clear metres, and prices a trap here as though the hall were a
      // corridor.
      zone("runway_hall_left", "Hall left", -3.3, -1.4, 3.4, 8.6, -0.3, 2, TRAP_TYPES),
      zone("runway_hall_right", "Hall right", 1.4, 3.3, 3.4, 8.6, -0.3, 2, TRAP_TYPES),
      zone("stones_hall_plinth", "The plinth", -1.1, 1.1, 4.8, 7.2, 0.5, 1, TIGHT_DECK_TRAPS),
    ],
  },
  {
    id: "two_ways",
    label: "Two Ways Across",
    description: "A walkway on the left, three pads on the right, and no way between them.",
    length: 12.4,
    difficulty: 2,
    // A branch that is a decision rather than a coin toss, and the only one a
    // runner cannot back out of. The mezzanine's catwalk is one hop off its low
    // road, so a player who dislikes their choice simply changes it; here the
    // two routes are 2.6u apart with a void between, which is inside the budget
    // but costs a committed sideways jump off whichever route you are on.
    //
    // The routes fail differently, which is the point. The walkway never breaks
    // and is six metres of continuous ground, so one trap on it has the whole
    // length to work with and nowhere for the runner to be except in front of
    // it. The pads break twice, at 2.4u each, and carry small traps only - but
    // a runner who is knocked while committed to one of those carries does not
    // land short, they land in the void.
    pieces: [
      piece("split", [0, -0.5, 1], [5.6, 1, 2], CREAM),
      piece("walkway", [-2.6, -0.5, 6.2], [2.4, 1, 8.4], BLUE),
      piece("pad_a", [2.2, -0.5, 5.3], [2, 1, 1.8], GREEN),
      piece("pad_b", [2.2, -0.5, 9.5], [2, 1, 1.8], GREEN),
      piece("merge", [0, -0.5, 11.4], [5.6, 1, 2], CREAM),
    ],
    zones: [
      zone("runway_ways_split", "The split", -2.4, 2.4, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      // "bridge" is the right class for a walkway with a drop on both sides: it
      // widens the spacing the validator demands between two traps and shrinks
      // the rotating toilet's orbit to 1.05, so neither can own the only ground
      // on that route.
      zone("bridge_ways_walkway", "The walkway", -3.6, -1.6, 3.2, 9.2, 0.05, 2, TRAP_TYPES),
      zone("stones_ways_pad_a", "First pad", 1.4, 3, 4.6, 6, 0.05, 1, TIGHT_DECK_TRAPS),
      zone("stones_ways_pad_b", "Second pad", 1.4, 3, 8.8, 10.2, 0.05, 1, TIGHT_DECK_TRAPS),
      zone("runway_ways_merge", "Where they meet", -2.4, 2.4, 10.7, 12.1, 0.05, 1, TRAP_TYPES),
    ],
  },
];
