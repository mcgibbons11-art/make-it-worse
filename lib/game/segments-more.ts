// A third batch of track segments.
//
// The twenty that exist ask for two things: land on the pad, and do not fall
// off the plank. What they never ask for is a decision. Every route is either
// forced or symmetric, every climb is a standing step with no air under it, and
// nothing in the catalogue descends. These nine are authored around what the
// player is being asked to DO rather than what the floor looks like:
//
//   parlour      room to think, so a trap has to be good rather than lucky
//   washboard    a run that costs seconds instead of lives
//   funnel       pressure that arrives gradually
//   mezzanine    a route choice where the two options fail differently
//   cascade      the only descent, taken as jumps rather than steps
//   stagger      a cadence to find, alternating side and height
//   rooftops     height and distance in the same jump
//   divingboard  one commitment, off a take-off too narrow to change your mind
//   stopover     a rest that is also the obvious place to stand a hammer
//
// They obey the same three rules the shipped set does. Pieces span exactly
// [0, length] along Z so buildTrack can butt a segment against its neighbours.
// The hardest forced traverse stays inside the damped jump budget measured by
// worstTraverse, at the seam with every other segment as well as internally.
// Zone ids carry a prefix the placement validator and trap renderer already
// understand, because buildTrack appends a slot suffix and only a prefix
// survives that.
//
// Two further rules are followed here that are not written down anywhere else.
// Every entry and exit face is flush, centred and level with the datum, which
// is what keeps a seam a step rather than a jump whichever segment follows.
// And nothing is authored narrower than the 1.2u beam, because the runner's
// silhouette is 0.91u across and a deck they cannot see their own feet on is
// not difficulty.

import { TRAP_TYPES } from "./trap-catalog";
import type { LevelPiece } from "./level-definition";
import type { TrackSegment } from "./track";
import type { PlacementZone, TrapType } from "./types";

/**
 * Small, static or telegraphed. This is the set a mandatory piece of ground can
 * host without the trap simply owning it: nothing that chases, nothing that
 * sweeps an arc wider than the deck, and no mousetrap, whose trigger is a 0.9u
 * radius circle (ForceTraps MOUSETRAP_TRIGGER_RADIUS) and so leaves a 0.76u
 * capsule no line through a deck two metres across. It is used here on every
 * landing a runner arrives at through the air as well, because a runner in
 * flight keeps 35% of their steering and cannot meaningfully choose where on
 * the pad they touch down. The classic stepping stones and the loose
 * floorboards are restricted on exactly this reasoning.
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

// allowedTypes is required rather than defaulted, for the reason the previous
// batch gives: a new zone that silently accepts all sixteen traps is how a
// narrow platform ends up hosting a hammer.
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

export const MORE_SEGMENTS: readonly TrackSegment[] = [
  {
    id: "parlour",
    label: "The Parlour",
    description: "A room with actual floor in it. Use it while it lasts.",
    length: 11,
    difficulty: 0,
    // The catalogue offers exactly one easy middle segment, so a composer who
    // wants a breath between two hard ones has to spend it on a hallway. This
    // is the other option: 6.4u by 7.4u of open floor, the largest single
    // surface in the game, sunk 0.35u so it reads as a room rather than more
    // corridor. Difficulty 0 is not a lack of ambition. A trap standing here
    // has three metres of clear ground on either side of it, which means it has
    // to be genuinely well placed to catch anybody.
    pieces: [
      piece("rim", [0, -0.5, 0.9], [6.4, 1, 1.8], "#fff8e8"),
      piece("floor", [0, -0.85, 5.5], [6.4, 1, 7.4], "#4b8dff"),
      piece("sill", [0, -0.5, 10.1], [6.4, 1, 1.8], "#fff8e8"),
    ],
    zones: [
      zone("runway_parlour_rim", "Doorway", -2.8, 2.8, 0.3, 1.5, 0.05, 1, TRAP_TYPES),
      zone("runway_parlour_left", "Parlour left", -3, -0.4, 2.4, 5.2, -0.3, 1, TRAP_TYPES),
      zone("runway_parlour_right", "Parlour right", 0.4, 3, 2.4, 5.2, -0.3, 1, TRAP_TYPES),
      zone("runway_parlour_back", "Parlour back", -3, 3, 5.8, 8.8, -0.3, 2, TRAP_TYPES),
    ],
  },
  {
    id: "washboard",
    label: "The Washboard",
    description: "Three ridges. None of them will kill you, all of them cost you.",
    length: 12.4,
    difficulty: 1,
    // The one segment where a mistake is not fatal. The floor never breaks, so
    // there is nothing to fall into; what it does is step up 0.5u three times,
    // and nothing in the controller lifts the runner over a ledge, so each
    // ridge is a standing jump. Miss the timing and you bounce off the face of
    // it and start again, which against a 60 second limit is a real price. It
    // is also the only ground in the game where a pusher lands while the runner
    // is already committed to a hop and has 35% of their steering.
    pieces: [
      piece("sill_in", [0, -0.5, 0.8], [5.2, 1, 1.6], "#fff8e8"),
      piece("ridge_a", [0, 0, 2.5], [5.2, 1, 1.8], "#ffd84d"),
      piece("trough_a", [0, -0.5, 4.3], [5.2, 1, 1.8], "#fff8e8"),
      piece("ridge_b", [0, 0, 6.1], [5.2, 1, 1.8], "#ffd84d"),
      piece("trough_b", [0, -0.5, 7.9], [5.2, 1, 1.8], "#fff8e8"),
      piece("ridge_c", [0, 0, 9.7], [5.2, 1, 1.8], "#ffd84d"),
      piece("sill_out", [0, -0.5, 11.5], [5.2, 1, 1.8], "#fff8e8"),
    ],
    zones: [
      zone("ridge_crest_a", "First crest", -2.2, 2.2, 1.75, 3.25, 0.55, 1, TRAP_TYPES),
      zone("ridge_trough_a", "The dip", -2.2, 2.2, 3.55, 5.05, 0.05, 1, TRAP_TYPES),
      zone("ridge_crest_c", "Last crest", -2.2, 2.2, 8.95, 10.45, 0.55, 1, TRAP_TYPES),
    ],
  },
  {
    id: "funnel",
    label: "The Funnel",
    description: "It starts generous. It does not stay that way.",
    length: 12,
    difficulty: 2,
    // Nothing here breaks and nothing here is a jump. What runs out is room:
    // 6.4u at the mouth, 4.4u through the taper, 1.8u at the neck, with a drop
    // on both sides of the last one. The three zones sit at three different
    // widths on purpose, because the risk model prices a zone partly on the
    // dodge room left after the runner's capsule, so the same trap is worth
    // measurably more at the neck than at the mouth without anyone hand-tuning
    // it. The neck itself is the segment: 2.6u of walking with no margin, taken
    // at whatever speed the mouth let you build up.
    pieces: [
      piece("mouth", [0, -0.5, 1.6], [6.4, 1, 3.2], "#fff8e8"),
      piece("taper", [0, -0.5, 4.6], [4.4, 1, 2.8], "#ffd84d"),
      piece("neck", [0, -0.45, 7.3], [1.8, 0.9, 2.6], "#ff9b4a"),
      piece("relief", [0, -0.5, 9.6], [4.4, 1, 2], "#ffd84d"),
      piece("mouth_out", [0, -0.5, 11.3], [6.4, 1, 1.4], "#fff8e8"),
    ],
    zones: [
      zone("funnel_mouth", "The mouth", -2.8, 2.8, 0.4, 2.9, 0.05, 2, TRAP_TYPES),
      zone("funnel_taper", "The taper", -1.9, 1.9, 3.4, 5.8, 0.05, 1, TRAP_TYPES),
      // "bridge" is the right class for a walkway with a drop on both sides: it
      // widens the spacing the validator demands between two traps, so nothing
      // can be stacked on the one piece of ground with no way round it.
      zone("bridge_funnel_neck", "The neck", -0.8, 0.8, 6.2, 8.4, 0.05, 1, TIGHT_DECK_TRAPS),
    ],
  },
  {
    id: "mezzanine",
    label: "The Mezzanine",
    description: "Wide floor on the left, a shelf up and over to the right. Choose.",
    length: 12.6,
    difficulty: 2,
    // The split islands and the true fork both offer two identical lanes, which
    // is a coin toss rather than a decision. Here the two routes fail in
    // different ways and the player picks which failure they would rather risk.
    // The low road is 2.4u of continuous floor and carries every trap zone in
    // the segment, including the ones that sweep. The catwalk is 1.8u wide,
    // 0.9u up, reached by a standing jump off the apron, and carries one
    // heavily restricted zone. Late in a chain the low road is a gauntlet and
    // the catwalk is a tightrope, and neither is obviously correct.
    pieces: [
      piece("apron_in", [0, -0.5, 1], [6.4, 1, 2], "#fff8e8"),
      piece("low_road", [-2, -0.5, 6.3], [2.4, 1, 8.6], "#4b8dff"),
      piece("catwalk", [1.7, 0.45, 6.3], [1.8, 0.9, 8.6], "#8b72ff"),
      piece("apron_out", [0, -0.5, 11.6], [6.4, 1, 2], "#fff8e8"),
    ],
    zones: [
      zone("runway_mezz_low_a", "Low road front", -3.1, -0.9, 2.5, 5.3, 0.05, 1, TRAP_TYPES),
      zone("runway_mezz_low_b", "Low road back", -3.1, -0.9, 6.5, 9.9, 0.05, 1, TRAP_TYPES),
      zone("bridge_mezz_high", "The catwalk", 0.95, 2.45, 4.6, 7.4, 0.95, 1, TIGHT_DECK_TRAPS),
    ],
  },
  {
    id: "cascade",
    label: "The Cascade",
    description: "Down two ledges and out the other side. Nothing waits for you.",
    length: 13.6,
    difficulty: 2,
    // Every height change in the catalogue so far is upward, and every one of
    // them is a standing step. This is the other direction, and the drops are
    // taken as jumps: 2.0u out and 0.45u down, then 2.15u across and 0.45u down
    // again onto a pad on the far side. Falling adds reach rather than taking
    // it away, so both hops are comfortable in the air and awkward on the
    // ground, because the pad arrives sooner than the eye expects and there is
    // 2.8u of it to stop on. The way out is the only hard move in the segment:
    // a standing 0.9u climb onto the far wall with no run-up available.
    pieces: [
      piece("lip", [0, -0.5, 1], [5.2, 1, 2], "#fff8e8"),
      piece("drop_a", [-1.8, -0.95, 5.3], [2.8, 1, 2.6], "#ff9b4a"),
      piece("drop_b", [1.8, -1.4, 9.9], [2.8, 1, 2.6], "#ff9b4a"),
      piece("climb", [0, -0.5, 12.4], [5.2, 1, 2.4], "#fff8e8"),
    ],
    zones: [
      // "stones" is the class for an isolated pad, and it also bans the toilet
      // and the hammer through the placement validator, neither of which leaves
      // a line across a pad this size.
      zone("stones_cascade_a", "First ledge", -3, -0.6, 4.4, 6.2, -0.4, 1, TIGHT_DECK_TRAPS),
      zone("stones_cascade_b", "Second ledge", 0.6, 3, 9, 10.8, -0.85, 1, TIGHT_DECK_TRAPS),
      zone("cascade_climb", "Above the wall", -2.2, 2.2, 11.6, 13.3, 0.05, 1, TRAP_TYPES),
    ],
  },
  {
    id: "stagger",
    label: "The Stagger",
    description: "Four hops on one beat. Find it early or fight it the whole way.",
    length: 12.8,
    difficulty: 2,
    // The existing pad runs are irregular on purpose, so the runner reads each
    // one separately. This is the opposite: the same 1.2u void every time, the
    // same 1.8u shift in the centre line, and the height alternating 0.45u up
    // and back down, which is a cadence rather than four separate problems.
    // Reading it once is worth more here than reacting four times. The first
    // and last pads are centred and 3.2u across so the seams stay a step rather
    // than a guess; the three between them are 2.2u and offset, and the two
    // middle hops clear 1.4u of open air sideways as well as 1.2u forward.
    pieces: [
      piece("pad_in", [0, -0.5, 0.8], [3.2, 1, 1.6], "#57dfa1"),
      piece("pad_b", [-1.8, -0.05, 3.6], [2.2, 1, 1.6], "#ffd84d"),
      piece("pad_c", [1.8, -0.5, 6.4], [2.2, 1, 1.6], "#57dfa1"),
      piece("pad_d", [-1.8, -0.05, 9.2], [2.2, 1, 1.6], "#ffd84d"),
      piece("pad_out", [0, -0.5, 12], [3.2, 1, 1.6], "#57dfa1"),
    ],
    zones: [
      zone("stones_stagger_a", "Second pad", -2.8, -0.8, 2.9, 4.3, 0.5, 1, TIGHT_DECK_TRAPS),
      zone("stones_stagger_b", "Third pad", 0.8, 2.8, 5.7, 7.1, 0.05, 1, TIGHT_DECK_TRAPS),
      zone("stones_stagger_c", "Fourth pad", -2.8, -0.8, 8.5, 9.9, 0.5, 1, TIGHT_DECK_TRAPS),
    ],
  },
  {
    id: "rooftops",
    label: "The Rooftops",
    description: "Two jumps that go up as well as out, then a long way down.",
    length: 14.2,
    difficulty: 3,
    // Height and distance never arrive together anywhere else. The rising steps
    // climb with no air under them, the spring pit climbs once, and every real
    // gap in the game is level. Here both hops are 2.8u out and 0.85u up, which
    // is the least practised move in the game and the one the published budget
    // flatters most: distance and height are scored separately, but the arc
    // couples them, and 0.85u into the climb the runner has 3.51u of reach
    // left, not 4.59u. That is 0.71u of margin rather than 1.79u. The drop off
    // the far roof is 1.7u and free, which is the only mercy in the segment.
    pieces: [
      piece("eave", [0, -0.5, 1], [5.2, 1, 2], "#fff8e8"),
      piece("roof_a", [-0.9, 0.4, 6], [3.6, 0.9, 2.4], "#ff5c65"),
      piece("roof_b", [0.9, 1.25, 11.2], [3.6, 0.9, 2.4], "#ff5c65"),
      piece("gutter", [0, -0.5, 13.3], [5.2, 1, 1.8], "#fff8e8"),
    ],
    zones: [
      zone("rooftop_eave", "The eave", -2.2, 2.2, 0.3, 1.7, 0.05, 1, TRAP_TYPES),
      zone("stones_roof_a", "First roof", -2.5, 0.7, 5.1, 6.9, 0.9, 1, TIGHT_DECK_TRAPS),
      zone("stones_roof_b", "Second roof", -0.7, 2.5, 10.3, 12.1, 1.75, 1, TIGHT_DECK_TRAPS),
    ],
  },
  {
    id: "divingboard",
    label: "The Diving Board",
    description: "The board narrows the whole way out. The far side does not move.",
    length: 12.5,
    difficulty: 3,
    // A commitment, and the shape is the whole argument. The Gap asks for a
    // comparable 3.8u carry, but it asks off a 4u lip where the runner can
    // shuffle sideways, square up and go. Here the floor tapers 5.2u to 3.2u to
    // 1.8u over six metres, so the last stride before take-off is taken on a
    // plank and the line has to be right long before the edge. Speed cannot be
    // shed and then rebuilt, because losing it means not clearing the void.
    //
    // There is deliberately no zone on the tip. A soap slick on the take-off of
    // a jump this size is not difficulty, it is an unsurvivable segment, and
    // jumping early to avoid it lengthens the carry past what the budget
    // allows. The board and the landing are contestable; the edge is not.
    pieces: [
      piece("apron", [0, -0.5, 0.9], [5.2, 1, 1.8], "#fff8e8"),
      piece("board", [0, -0.45, 3.3], [3.2, 0.9, 3], "#ffd84d"),
      piece("tip", [0, -0.45, 5.6], [1.8, 0.9, 1.6], "#ff9b4a"),
      piece("landing", [0, -0.5, 11.4], [5.6, 1, 2.2], "#57dfa1"),
    ],
    zones: [
      zone("board_apron", "The run-up", -2.2, 2.2, 0.2, 1.6, 0.05, 1, TRAP_TYPES),
      zone("board_run", "The board", -1.4, 1.4, 2.1, 4.5, 0.05, 1, TIGHT_DECK_TRAPS),
      zone("board_landing", "Far side", -2.4, 2.4, 10.6, 12.2, 0.05, 1, TRAP_TYPES),
    ],
  },
  {
    id: "stopover",
    label: "The Stopover",
    description: "One island, two voids, and everything anybody ever placed here.",
    length: 13.8,
    difficulty: 3,
    // Two 3.4u carries with a single 4.6u by 3.4u island between them. The
    // jumps are the frame; the island is the segment. It is the only ground in
    // fourteen metres a runner can stand on, which makes it the one place a
    // trap is guaranteed to be met, and it is wide enough to host the things
    // that sweep - a hammer covers about half its width, not all of it, so the
    // answer is to time the crossing rather than to route around it. The zone
    // takes two occupants because a second trap here is the strongest single
    // move on the whole course and should cost two picks to make.
    //
    // The take-off lip carries no zone, for the reason the diving board's tip
    // carries none: a runner who loses their footing on the edge of a 3.4u
    // carry has not been beaten, they have been removed.
    pieces: [
      piece("lip", [0, -0.5, 0.8], [5.2, 1, 1.6], "#fff8e8"),
      piece("island", [0, -0.45, 6.7], [4.6, 0.9, 3.4], "#57dfa1"),
      piece("landing", [0, -0.5, 12.8], [5.2, 1, 2], "#fff8e8"),
    ],
    zones: [
      zone("stopover_island", "The island", -2.1, 2.1, 5.3, 8.1, 0.05, 2, TRAP_TYPES),
      zone("stopover_landing", "Far landing", -2.2, 2.2, 12.1, 13.5, 0.05, 1, TIGHT_DECK_TRAPS),
    ],
  },
];
