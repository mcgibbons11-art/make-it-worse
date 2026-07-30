// Composable tracks.
//
// The original course was a single hardcoded array of platforms with a matching
// hardcoded array of placement zones. That made every challenge the same level
// and left no way to author a course worth sharing.
//
// A track is now an ordered list of prefab segments. Each segment carries its
// own geometry AND its own placement zones in segment-local coordinates, so
// laying them end to end produces a playable course whose zones are already
// correct. Trap validation, ground detection, and the editor all keep working
// because they consume the built track rather than a module constant.
//
// The original course is preserved verbatim as the "classic" segment, so an
// existing challenge rebuilds byte-identically.

import { ATTEMPT_LIMIT_MS, PLAYER } from "./constants";
import { createSeededRandom } from "./seed";
import { EXTRA_SEGMENTS } from "./segments-extra";
import { MORE_SEGMENTS } from "./segments-more";
import { SHAPE_SEGMENTS } from "./segments-shapes";
import { LEVEL_PIECES, PLACEMENT_ZONES } from "./level-definition";
import { TRAP_TYPES } from "./trap-catalog";
import type { LevelPiece } from "./level-definition";
import type { PlacementZone, TrapType, Vec3Tuple } from "./types";

/**
 * Where a segment leaves the runner, sideways and upward, relative to where it
 * took them in. See `Lane` below for what buildTrack does with it.
 */
export type SegmentExit = readonly [x: number, y: number];

export interface TrackSegment {
  id: string;
  label: string;
  description: string;
  /** Extent along Z. Segments are laid end to end with no gap between them. */
  length: number;
  /** 0 flat and forgiving, 3 punishing. Shown in the editor. */
  difficulty: 0 | 1 | 2 | 3;
  /** Piece centres are relative to the segment start, where local z = 0. */
  pieces: readonly LevelPiece[];
  /** Zone minZ/maxZ are relative to the segment start. */
  zones: readonly PlacementZone[];
  /**
   * The centre of this segment's far face, relative to its near face. Absent
   * means the segment hands the runner back on the line and at the height it
   * received them, which is what every segment written before the lane existed
   * does, so their courses rebuild unchanged.
   *
   * A segment that declares one must actually end there: the far face has to be
   * centred on `exitOffset[0]` with its walking surface at `exitOffset[1]`, or
   * the seam with the next segment opens a hole nobody authored.
   * tests/unit/level-shape.test.ts measures that against the geometry.
   */
  exitOffset?: SegmentExit;
}

/**
 * The running displacement of the course from the centre line and the datum.
 *
 * Segments are still laid end to end along Z - the chase camera is pinned to
 * that axis and cannot be turned - but they no longer all sit on x = 0 at
 * y = 0. buildTrack carries a lane across the seams: segment k is drawn at the
 * accumulated exit of everything before it, so a course can bend left, bend
 * right, climb a storey and come back down while every join stays flush.
 *
 * The lane is exactly the previous segment's own exit displacement, so a seam
 * is always face-to-face at the same relative offset whatever the lane happens
 * to be. Every jump measurement is therefore lane-invariant, which is why
 * worstTraverse needed no special case for any of this.
 */
export type Lane = readonly [x: number, y: number];

const ORIGIN: Lane = [0, 0];

export function segmentExit(segment: TrackSegment): SegmentExit {
  return segment.exitOffset ?? ORIGIN;
}

export interface BuiltTrack {
  pieces: readonly LevelPiece[];
  zones: readonly PlacementZone[];
  spawn: Vec3Tuple;
  exit: Vec3Tuple;
  length: number;
}

/**
 * Resolve an authored spawn onto the nearest safe point on real geometry.
 *
 * Builder endpoints remain freely placeable, but a stale save or shared code
 * can put the marker a few pixels beyond a deck. Passing that coordinate
 * straight to Rapier means the attempt is over before the player receives
 * input. We preserve the authored point whenever it is supported, clamp small
 * misses into a player-sized interior, and only fall back to another piece
 * when there is no support under it at all.
 */
export function safeSpawnForTrack(track: BuiltTrack): Vec3Tuple {
  if (track.pieces.length === 0) return track.spawn;
  const [wantedX, wantedY, wantedZ] = track.spawn;
  const inset = PLAYER.capsuleRadius + 0.12;
  const standingOffset = Math.max(
    1.25,
    PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius + 0.12,
  );
  let best:
    | {
        point: Vec3Tuple;
        horizontalDistance: number;
        verticalDistance: number;
        top: number;
      }
    | null = null;
  for (const piece of track.pieces) {
    const halfX = piece.size[0] / 2;
    const halfZ = piece.size[2] / 2;
    const safeHalfX = Math.max(0, halfX - inset);
    const safeHalfZ = Math.max(0, halfZ - inset);
    const x = Math.min(
      piece.center[0] + safeHalfX,
      Math.max(piece.center[0] - safeHalfX, wantedX),
    );
    const z = Math.min(
      piece.center[2] + safeHalfZ,
      Math.max(piece.center[2] - safeHalfZ, wantedZ),
    );
    const top = piece.center[1] + piece.size[1] / 2;
    const point = [x, top + standingOffset, z] as const;
    const candidate = {
      point,
      horizontalDistance: Math.hypot(wantedX - x, wantedZ - z),
      verticalDistance: Math.abs(wantedY - point[1]),
      top,
    };
    if (
      !best ||
      candidate.horizontalDistance < best.horizontalDistance - 1e-6 ||
      (Math.abs(candidate.horizontalDistance - best.horizontalDistance) <= 1e-6 &&
        (candidate.verticalDistance < best.verticalDistance - 1e-6 ||
          (Math.abs(candidate.verticalDistance - best.verticalDistance) <= 1e-6 &&
            candidate.top > best.top)))
    ) {
      best = candidate;
    }
  }
  return best?.point ?? track.spawn;
}

/** The same track with its runtime spawn made safe; returns the input if unchanged. */
export function withSafeSpawn(track: BuiltTrack): BuiltTrack {
  const spawn = safeSpawnForTrack(track);
  if (spawn.every((value, index) => value === track.spawn[index])) return track;
  return { ...track, spawn };
}

/** Yaw whose forward (+Z) axis points from this room's spawn to its end gate. */
export function trackFacingYaw(
  track: Pick<BuiltTrack, "spawn" | "exit">,
): number {
  const dx = track.exit[0] - track.spawn[0];
  const dz = track.exit[2] - track.spawn[2];
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.001)
    return 0;
  return Math.atan2(dx, dz);
}

const SMALL_TRAPS: readonly TrapType[] = [
  "floor_fan",
  "soap_slick",
  "spring_pad",
  "giant_beach_ball",
];
const NO_FRIDGE: readonly TrapType[] = TRAP_TYPES.filter(
  (type) => type !== "rolling_fridge",
);

function zone(
  id: string,
  label: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  groundY: number,
  maxOccupants: number,
  allowedTypes: readonly TrapType[] = TRAP_TYPES,
): PlacementZone {
  return { id, label, minX, maxX, minZ, maxZ, groundY, maxOccupants, allowedTypes };
}

const CLASSIC_LENGTH = 41.1;

const BASE_SEGMENTS: readonly TrackSegment[] = [
  {
    id: "classic",
    label: "The Original Apartment",
    description: "The whole first course, exactly as it shipped.",
    length: CLASSIC_LENGTH,
    difficulty: 1,
    pieces: LEVEL_PIECES,
    zones: PLACEMENT_ZONES,
  },
  {
    id: "start",
    label: "Landing Pad",
    description: "A wide safe pad to begin on.",
    length: 5,
    difficulty: 0,
    pieces: [{ id: "pad", center: [0, -0.5, 2.5], size: [8, 1, 5], color: "#ffd84d" }],
    zones: [],
  },
  {
    id: "runway",
    label: "Hallway Runway",
    description: "A wide straight. Room for two problems.",
    length: 8.5,
    difficulty: 0,
    pieces: [{ id: "run", center: [0, -0.5, 4.25], size: [6, 1, 8.5], color: "#fff8e8" }],
    // Zone ids must keep the semantic prefix the risk model and trap sizing
    // read (difficulty.zoneMultiplier, placement's sweep ban, the toilet's
    // orbit radius). buildTrack appends a slot suffix, so a prefix survives
    // but an exact-match id would not.
    zones: [
      zone("runway_a", "Runway front", -2.3, 2.3, 1, 2.5, 0.05, 2),
      zone("runway_b", "Runway back", -2.3, 2.3, 5.8, 7.3, 0.05, 2),
    ],
  },
  {
    id: "stones",
    label: "Stepping Stones",
    description: "Three offset pads with real gaps between them.",
    length: 8.5,
    difficulty: 2,
    pieces: [
      { id: "s1", center: [-1.6, -0.35, 1.4], size: [2.4, 0.7, 1.8], color: "#ff9b4a" },
      { id: "s2", center: [0, 0, 4.5], size: [2.2, 0.7, 1.8], color: "#ff9b4a" },
      { id: "s3", center: [1.5, -0.2, 7.6], size: [2.4, 0.7, 1.8], color: "#ff9b4a" },
    ],
    zones: [
      zone("stones_a", "First stone", -2.4, -0.4, 0.7, 2.1, 0.1, 1, SMALL_TRAPS),
      zone("stones_c", "Last stone", 0.5, 2.5, 6.9, 8.3, 0.15, 1, SMALL_TRAPS),
    ],
  },
  {
    id: "bridge",
    label: "Narrow Bridge",
    description: "Long, thin, and completely exposed.",
    length: 10.2,
    difficulty: 2,
    pieces: [{ id: "br", center: [0, -0.45, 5.1], size: [3, 0.9, 10.2], color: "#8b72ff" }],
    zones: [
      zone("bridge_a", "Bridge front", -1.05, 1.05, 1.5, 3.1, 0.05, 1),
      zone("bridge_b", "Bridge middle", -1.05, 1.05, 4.3, 5.9, 0.05, 1, NO_FRIDGE),
      zone("bridge_c", "Bridge back", -1.05, 1.05, 7.1, 8.7, 0.05, 1),
    ],
  },
  {
    id: "islands",
    label: "Split Islands",
    description: "Pick a side. There is no middle.",
    length: 4.8,
    difficulty: 2,
    // The original three slabs overlapped into one continuous 6.2u floor, so
    // the "split" was cosmetic and the seams z-fought at equal height. Two
    // disjoint lanes across a 2u void make the routing choice real.
    pieces: [
      { id: "il", center: [-2.05, -0.4, 2.4], size: [2.1, 0.8, 4.8], color: "#4b8dff" },
      { id: "ir", center: [2.05, -0.4, 2.4], size: [2.1, 0.8, 4.8], color: "#4b8dff" },
    ],
    zones: [
      zone("island_l", "Left island", -2.9, -1.2, 0.4, 4.4, 0.05, 2),
      zone("island_r", "Right island", 1.2, 2.9, 0.4, 4.4, 0.05, 2),
    ],
  },
  {
    id: "gap",
    label: "The Gap",
    description: "Nothing but air and a landing pad.",
    length: 6.6,
    difficulty: 3,
    pieces: [
      { id: "lip", center: [0, -0.5, 0.6], size: [4, 1, 1.2], color: "#57dfa1" },
      { id: "land", center: [0, -0.5, 5.8], size: [4.6, 1, 1.6], color: "#57dfa1" },
    ],
    zones: [zone("gap_land", "Landing", -1.8, 1.8, 5.2, 6.2, 0.05, 1, SMALL_TRAPS)],
  },
  {
    id: "zigzag",
    label: "Zigzag Ledges",
    description: "Alternating ledges that punish running straight.",
    length: 11,
    difficulty: 3,
    pieces: [
      { id: "z1", center: [-1.9, -0.45, 1.3], size: [3.2, 0.9, 2.6], color: "#ff5c65" },
      { id: "z2", center: [1.9, -0.45, 4.4], size: [3.2, 0.9, 2.6], color: "#ff9b4a" },
      { id: "z3", center: [-1.9, -0.45, 7.5], size: [3.2, 0.9, 2.6], color: "#ff5c65" },
      { id: "z4", center: [1.4, -0.45, 9.9], size: [3.6, 0.9, 2.2], color: "#ff9b4a" },
    ],
    zones: [
      zone("zigzag_a", "First ledge", -2.9, -0.9, 0.6, 2, 0.05, 1, SMALL_TRAPS),
      zone("zigzag_c", "Third ledge", -2.9, -0.9, 6.8, 8.2, 0.05, 1, SMALL_TRAPS),
    ],
  },
  {
    id: "pillars",
    label: "Pillar Tops",
    description: "Four small pads. Miss one and the void wins.",
    length: 10.65,
    difficulty: 3,
    pieces: [
      { id: "p1", center: [-1.2, -0.3, 1.2], size: [1.7, 1.4, 1.7], color: "#b9a7ff" },
      { id: "p2", center: [1.2, -0.1, 4], size: [1.7, 1.8, 1.7], color: "#b9a7ff" },
      { id: "p3", center: [-1.1, -0.3, 6.8], size: [1.7, 1.4, 1.7], color: "#b9a7ff" },
      { id: "p4", center: [0.9, -0.45, 9.6], size: [2.1, 0.9, 2.1], color: "#8b72ff" },
    ],
    zones: [zone("pillars_last", "Last pillar", 0.1, 1.7, 9, 10.2, 0.05, 1, SMALL_TRAPS)],
  },
  {
    id: "convergence",
    label: "Convergence",
    description: "Everything funnels back together.",
    length: 2.6,
    difficulty: 1,
    pieces: [{ id: "cv", center: [0, -0.35, 1.3], size: [5.6, 0.7, 2.6], color: "#57dfa1" }],
    zones: [zone("convergence_a", "Convergence", -2.2, 2.2, 0.3, 2.2, 0.05, 2)],
  },
  {
    id: "ramp",
    label: "Ramp",
    description: "A tilted run-up. Momentum is not your friend.",
    length: 3.6,
    difficulty: 1,
    pieces: [
      { id: "rp", center: [0, 0, 1.8], size: [4, 0.6, 3.6], rotationX: -0.1, color: "#ffd84d" },
    ],
    zones: [
      zone("ramp_a", "Ramp", -1.55, 1.55, 0.6, 2.4, 0.45, 1, [
        "swinging_hammer",
        "floor_fan",
        "soap_slick",
        "spring_pad",
        "rotating_toilet",
        "giant_beach_ball",
      ]),
    ],
  },
  {
    id: "finish",
    label: "Finish Room",
    description: "The exit. Leave it barely survivable.",
    length: 6,
    difficulty: 0,
    pieces: [{ id: "fin", center: [0, 0, 3], size: [7, 0.8, 6], color: "#fff8e8" }],
    zones: [
      zone("finish_a", "Finish approach", -2.6, 2.6, 0.3, 1.9, 0.45, 2),
      zone("finish_b", "Finish middle", -2.4, 2.4, 2.2, 3.6, 0.45, 1),
    ],
  },
];

/**
 * The catalogue a composer picks from. Later additions live in their own module
 * so this file stays readable; the import there is type-only, so there is no
 * runtime cycle.
 */
export const TRACK_SEGMENTS: readonly TrackSegment[] = [
  ...BASE_SEGMENTS,
  ...EXTRA_SEGMENTS,
  ...MORE_SEGMENTS,
  ...SHAPE_SEGMENTS,
];

export const SEGMENT_MAP = new Map(
  TRACK_SEGMENTS.map((segment) => [segment.id, segment]),
);

/** Segments a player may place in the middle of a course. */
export const EDITABLE_SEGMENTS: readonly TrackSegment[] = TRACK_SEGMENTS.filter(
  (segment) => !["classic", "start", "finish"].includes(segment.id),
);

export const CLASSIC_TRACK: readonly string[] = ["classic"];
export const DEFAULT_CUSTOM_TRACK: readonly string[] = [
  "start",
  "runway",
  "stones",
  "bridge",
  "islands",
  "convergence",
  "ramp",
  "finish",
];

export const MAX_TRACK_SEGMENTS = 12;

/** A curated course a player can pick by name instead of rolling the dice. */
export interface NamedTrack {
  id: string;
  name: string;
  tagline: string;
  segmentIds: readonly string[];
}

/**
 * The map list. Hand-sequenced from the same segment catalogue the random
 * composer draws on, so a named map is exactly as legal as a composed one:
 * every entry must pass isPlayableTrack - the real gate, enforced by test, not
 * by the author's arithmetic - and placement, publishing and links treat it
 * like any other track. Sequenced for character rather than coverage:
 * difficulty inside a map ramps upward, and no two maps share a sequence.
 *
 * Repeating a segment is legal and deliberate where it is the map's identity -
 * buildTrack suffixes piece and zone ids by slot, so repeats cannot collide.
 */
export const NAMED_TRACKS: readonly NamedTrack[] = [
  {
    id: "first-day",
    name: "First Day",
    tagline: "Every disaster starts somewhere gentle.",
    segmentIds: ["start", "runway", "convergence", "stones", "ramp", "finish"],
  },
  {
    id: "the-commute",
    name: "The Commute",
    tagline: "A reasonable morning, right up until the gap.",
    segmentIds: ["start", "runway", "stones", "bridge", "islands", "gap", "ramp", "finish"],
  },
  {
    id: "stepping-stones",
    name: "Stepping Stones",
    tagline: "The floor is mostly a suggestion.",
    segmentIds: ["start", "stones", "islands", "stones", "convergence", "finish"],
  },
  {
    id: "rush-hour",
    name: "Rush Hour",
    tagline: "No straight lines, no mercy.",
    segmentIds: ["start", "zigzag", "gap", "pillars", "zigzag", "finish"],
  },
  {
    id: "the-crossing",
    name: "The Crossing",
    tagline: "Two narrow bridges and the hole between them.",
    segmentIds: ["start", "bridge", "gap", "bridge", "ramp", "finish"],
  },
  {
    id: "grand-tour",
    name: "Grand Tour",
    tagline: "Every room in the catalogue, one bad idea at a time.",
    segmentIds: [
      "start", "runway", "stones", "bridge", "islands", "gap",
      "zigzag", "pillars", "convergence", "ramp", "finish",
    ],
  },
];

/**
 * How far off the centre line a course may wander.
 *
 * The decorative shell in LevelGeometry stands at x = +/-5.51 and the widest
 * floor authored anywhere is 7.2u across, so 2.2u of lane keeps a course's
 * geometry inside the room it is drawn in. Height is bounded below at the datum
 * because the shell's walls stop at y = -0.8, and above by their tops at 4.3.
 */
export const LANE_X_LIMIT = 2.2;
export const LANE_Y_LIMIT = 1.8;
/** Floating point addition of authored tenths, not a tolerance on design. */
const LANE_EPSILON = 1e-6;

export function laneIsHome(lane: Lane): boolean {
  return Math.abs(lane[0]) < LANE_EPSILON && Math.abs(lane[1]) < LANE_EPSILON;
}

function laneInEnvelope(lane: Lane): boolean {
  return (
    Math.abs(lane[0]) <= LANE_X_LIMIT + LANE_EPSILON &&
    lane[1] >= -LANE_EPSILON &&
    lane[1] <= LANE_Y_LIMIT + LANE_EPSILON
  );
}

/**
 * The lane each segment is drawn at, in order, plus the lane the course ends
 * on. The editor needs this to tell a player that a course finishes off to one
 * side rather than merely reporting that it was refused.
 */
export function laneWalk(segmentIds: readonly string[]): {
  at: readonly Lane[];
  final: Lane;
} {
  const at: Lane[] = [];
  let lane: Lane = ORIGIN;
  for (const segmentId of segmentIds) {
    const segment = SEGMENT_MAP.get(segmentId);
    if (!segment) continue;
    at.push(lane);
    const exit = segmentExit(segment);
    lane = [lane[0] + exit[0], lane[1] + exit[1]];
  }
  return { at, final: lane };
}

/** Where a course leaves the runner relative to the finish door's centre line. */
export function laneAfter(segmentIds: readonly string[]): Lane {
  return laneWalk(segmentIds).final;
}

/**
 * Lay segments end to end along Z, each drawn at the lane the ones before it
 * left off on. Piece and zone ids are suffixed with the slot index so a segment
 * used twice produces two distinct sets.
 */
export function buildTrack(segmentIds: readonly string[]): BuiltTrack {
  const pieces: LevelPiece[] = [];
  const zones: PlacementZone[] = [];
  let cursor = 0;
  let lane: Lane = ORIGIN;
  segmentIds.forEach((segmentId, slot) => {
    const segment = SEGMENT_MAP.get(segmentId);
    if (!segment) return;
    const unique = segmentId === "classic" ? (id: string) => id : (id: string) => `${id}_${slot}`;
    for (const piece of segment.pieces)
      pieces.push({
        ...piece,
        id: unique(piece.id),
        center: [
          piece.center[0] + lane[0],
          piece.center[1] + lane[1],
          piece.center[2] + cursor,
        ],
      });
    for (const entry of segment.zones)
      zones.push({
        ...entry,
        id: unique(entry.id),
        minX: entry.minX + lane[0],
        maxX: entry.maxX + lane[0],
        minZ: entry.minZ + cursor,
        maxZ: entry.maxZ + cursor,
        groundY: entry.groundY + lane[1],
      });
    cursor += segment.length;
    const exit = segmentExit(segment);
    lane = [lane[0] + exit[0], lane[1] + exit[1]];
  });
  return {
    pieces,
    zones,
    spawn: [0, 1.25, 1.2],
    // The exit sensor sits just inside the final platform's far edge. The lane
    // is on it because a course that ends off-centre puts the door off-centre,
    // and isPlayableTrack refuses those outright: PlayerController's finish
    // test is hardcoded to |x| < 1.15 and 0.1 <= y < 3.2, so a door anywhere
    // else is a door the runner can stand in front of and never open.
    exit: [lane[0], lane[1] + 1.5, cursor - 0.85],
    length: cursor,
  };
}

// Jump budget, solved for the damping Rapier actually applies. The textbook
// undamped form overstates this by 8%, which is enough to certify a course
// nobody can finish. Runtime validation and the tests share these numbers so
// they cannot drift apart.
const GRAVITY = 9.81 * PLAYER.gravityScale;
const RISE_RATIO = (PLAYER.linearDamping * PLAYER.jumpVelocity) / GRAVITY;
const RISE_TIME = Math.log(1 + RISE_RATIO) / PLAYER.linearDamping;
export const JUMP_HEIGHT =
  PLAYER.jumpVelocity / PLAYER.linearDamping -
  (GRAVITY / PLAYER.linearDamping ** 2) * Math.log(1 + RISE_RATIO);
export const JUMP_DISTANCE = PLAYER.moveSpeed * RISE_TIME * 2;
/** A course sitting exactly on the limit is a course nobody clears. */
export const JUMP_MARGIN = 0.9;

/** Height above take-off `seconds` into a jump, under the same damping. */
function jumpHeightAt(seconds: number): number {
  return (
    (PLAYER.jumpVelocity / PLAYER.linearDamping +
      GRAVITY / PLAYER.linearDamping ** 2) *
      (1 - Math.exp(-PLAYER.linearDamping * seconds)) -
    (GRAVITY / PLAYER.linearDamping) * seconds
  );
}

/**
 * How far forward the runner can still be when they come back down `rise`
 * above where they left, or -1 if that height is out of reach entirely.
 *
 * JUMP_DISTANCE and JUMP_HEIGHT are the two axes measured independently, which
 * flatters any hop that asks for both at once: a jump 0.9u up is nothing like a
 * jump along the floor, because the arc has already spent most of its air
 * getting there. Horizontal speed is held at moveSpeed because the controller
 * re-applies up to acceleration * airControl every frame, which beats
 * linearDamping at this speed.
 */
export function reachAtRise(rise: number): number {
  if (rise <= 0) return JUMP_DISTANCE;
  if (rise >= JUMP_HEIGHT) return -1;
  let low = RISE_TIME;
  let high = RISE_TIME * 4;
  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (jumpHeightAt(mid) > rise) low = mid;
    else high = mid;
  }
  return PLAYER.moveSpeed * low;
}

/**
 * The hardest jump the course forces, measured as real edge-to-edge clearance
 * between platform footprints. A player needs only one route, so each platform
 * is scored by its easiest reachable predecessor.
 *
 * `gap` and `rise` are the worst of each taken separately, and `slack` is the
 * hop with the least room once they are taken together: reach at that hop's own
 * rise, less its own carry, less the safety margin. A course can satisfy both
 * headline figures and still contain a jump nobody can make, so `slack` is the
 * measurement isPlayableTrack actually turns away a course on.
 */
export function worstTraverse(track: BuiltTrack): {
  gap: number;
  rise: number;
  slack: number;
} {
  const prints = track.pieces
    .map((piece) => ({
      minX: piece.center[0] - piece.size[0] / 2,
      maxX: piece.center[0] + piece.size[0] / 2,
      minZ: piece.center[2] - piece.size[2] / 2,
      maxZ: piece.center[2] + piece.size[2] / 2,
      top: piece.center[1] + piece.size[1] / 2,
    }))
    .sort((a, b) => a.minZ - b.minZ);
  let gap = 0;
  let rise = 0;
  let slack = Infinity;
  for (let index = 1; index < prints.length; index += 1) {
    const to = prints[index]!;
    let easiest = Infinity;
    let easiestRise = 0;
    for (let from = 0; from < index; from += 1) {
      const source = prints[from]!;
      const distance = Math.hypot(
        Math.max(0, source.minX - to.maxX, to.minX - source.maxX),
        Math.max(0, source.minZ - to.maxZ, to.minZ - source.maxZ),
      );
      if (distance < easiest) {
        easiest = distance;
        easiestRise = to.top - source.top;
      }
    }
    if (easiest > gap) gap = easiest;
    if (easiestRise > rise) rise = easiestRise;
    const reach = reachAtRise(easiestRise);
    const hopSlack = reach < 0 ? -Infinity : reach * JUMP_MARGIN - easiest;
    if (hopSlack < slack) slack = hopSlack;
  }
  return { gap, rise, slack: slack === Infinity ? JUMP_DISTANCE * JUMP_MARGIN : slack };
}

/**
 * A track must start on solid ground, end at a reachable exit, and physically
 * connect. The connectivity check matters most for shared links: a composition
 * that cannot be finished should be refused before a player sinks time into it.
 */
export function isPlayableTrack(segmentIds: readonly string[]): boolean {
  if (segmentIds.length === 0 || segmentIds.length > MAX_TRACK_SEGMENTS)
    return false;
  if (!segmentIds.every((id) => SEGMENT_MAP.has(id))) return false;
  // The whole original course is one segment. Checking it only at index 0 let a
  // hand-written link repeat it ten times for a 422-unit course with a 58.5s
  // straight-line floor against a 60s limit, and buildTrack does not suffix its
  // ids, so the duplicate zones also misdirected trap placement by 40 units.
  if (segmentIds.includes("classic")) return segmentIds.length === 1;
  if (segmentIds[0] !== "start" || segmentIds.at(-1) !== "finish") return false;
  // A start pad bolted to a finish room is a course where the runner steps off
  // the pad into the door. It connects perfectly and is not worth sending.
  if (segmentIds.length < 3) return false;
  // Every bend has to be answered and every climb has to come back down. The
  // finish door is the reason: PlayerController opens it on |x| < 1.15 and
  // 0.1 <= y < 3.2 in world coordinates, not on the door's own position, so a
  // course that ends two metres to the left is one the runner cannot leave.
  // The envelope keeps the middle of a course inside the room it is drawn in.
  const lane = laneWalk(segmentIds);
  if (!lane.at.every(laneInEnvelope)) return false;
  if (!laneIsHome(lane.at.at(-1) ?? ORIGIN)) return false;
  const track = buildTrack(segmentIds);
  // A course nobody can finish inside the attempt limit is unplayable however
  // well it connects. Two thirds of the budget leaves room for traps and death.
  if (track.length > (ATTEMPT_LIMIT_MS / 1000) * PLAYER.moveSpeed * 0.66)
    return false;
  const { gap, rise, slack } = worstTraverse(track);
  return (
    gap < JUMP_DISTANCE * JUMP_MARGIN &&
    rise < JUMP_HEIGHT * JUMP_MARGIN &&
    slack > 0
  );
}

/**
 * Build a fresh course from the catalogue.
 *
 * Every new chain used to open on CLASSIC_TRACK - one legacy segment, the same
 * 41u run every time - because createRootChain's parameter was optional and
 * nothing passed it. The other twenty-eight segments existed but a player only
 * ever met them by opening the editor, so the default experience of the game
 * was its oldest and flattest level, repeated.
 *
 * Composition is seeded off the challenge, so a given chain always rebuilds the
 * same course and a shared link stays honest, while two players starting fresh
 * get different ones. Difficulty is ramped rather than shuffled: the opening
 * segments are drawn from the gentle end so a first-timer is not thrown at a
 * 3.9u carry before they have jumped once.
 *
 * Every candidate is checked with isPlayableTrack - the real one, not a copy -
 * and a segment that would break the course is skipped rather than shipped.
 */
export function composeFreshTrack(seed: number, length = 7): readonly string[] {
  const random = createSeededRandom(seed);
  const pool = EDITABLE_SEGMENTS.filter((segment) => segment.id !== "classic");
  if (pool.length === 0) return DEFAULT_CUSTOM_TRACK;
  const slots = Math.max(1, Math.min(length, MAX_TRACK_SEGMENTS - 2));
  const shuffle = (segments: readonly TrackSegment[]): TrackSegment[] =>
    segments
      .map((segment) => ({ segment, roll: random() }))
      .sort((a, b) => a.roll - b.roll)
      .map((entry) => entry.segment);
  const track: string[] = ["start"];
  let lane: Lane = ORIGIN;
  for (let slot = 0; slot < slots; slot += 1) {
    // Ramp a band rather than a ceiling. A ceiling of `difficulty <= ceiling`
    // leaves the gentle end of the catalogue eligible for the whole course, and
    // there are only three segments rated 0 against fifteen rated 2, so those
    // three turned up in nearly every composition: measured over 1000 seeds,
    // grand_hall appeared in 999, runway in 955 and parlour in 949. Two of them
    // opened every course. Holding a floor one step below the ceiling keeps the
    // opening gentle and then leaves the gentle end behind, which is what makes
    // two fresh courses feel like different courses.
    const ceiling =
      slot === 0 ? 0 : Math.min(3, Math.ceil((slot / Math.max(1, slots - 1)) * 3));
    const floor = Math.max(0, ceiling - 1);
    const eligible = pool.filter(
      (segment) => segment.difficulty <= ceiling && segment.difficulty >= floor,
    );
    const ordered = shuffle(eligible.length ? eligible : pool);
    // The same room twice in a row reads as a mistake rather than as a course,
    // and an unfiltered draw produced one in 487 of every 1000 compositions.
    // Demoted rather than banned, so a slot is still filled when the segment
    // just laid down is the only thing that fits after it.
    const previous = track.at(-1);
    const ranked = [
      ...ordered.filter((segment) => segment.id !== previous),
      ...ordered.filter((segment) => segment.id === previous),
    ];
    for (const segment of ranked) {
      const exit = segmentExit(segment);
      const next: Lane = [lane[0] + exit[0], lane[1] + exit[1]];
      if (!laneInEnvelope(next)) continue;
      // Room for this segment, the turns and drops that bring the course back
      // to the centre line, and the finish room, inside the segment cap.
      const homing = homeFrom(next, shuffle(pool));
      if (!homing || track.length + 1 + homing.length + 1 > MAX_TRACK_SEGMENTS)
        continue;
      // Measured on the course as it would actually stand, lane and all. The
      // finish is appended so the last seam is checked too; when the lane is
      // still out it is checked at the end of the homing run instead.
      const candidate = [...track, segment.id, ...homing, "finish"];
      if (!isPlayableTrack(candidate)) continue;
      track.push(segment.id);
      lane = next;
      break;
    }
  }
  const composed = [...track, ...(homeFrom(lane, shuffle(pool)) ?? []), "finish"];
  // A composition that somehow fails the gate is never handed to a player.
  return isPlayableTrack(composed) ? composed : DEFAULT_CUSTOM_TRACK;
}

/**
 * The shortest run of segments that brings a course back to the centre line and
 * the datum, or null if the catalogue cannot do it. One segment per axis is
 * enough for everything authored so far, and the cap keeps a catalogue that
 * grows a segment displacing on both axes at once from looping here.
 */
function homeFrom(lane: Lane, ordered: readonly TrackSegment[]): string[] | null {
  const distance = (value: Lane): number =>
    Math.abs(value[0]) + Math.abs(value[1]);
  const path: string[] = [];
  let current = lane;
  while (!laneIsHome(current) && path.length < 2) {
    const closer = ordered.find((segment) => {
      const exit = segmentExit(segment);
      const next: Lane = [current[0] + exit[0], current[1] + exit[1]];
      return laneInEnvelope(next) && distance(next) < distance(current) - LANE_EPSILON;
    });
    if (!closer) return null;
    const exit = segmentExit(closer);
    path.push(closer.id);
    current = [current[0] + exit[0], current[1] + exit[1]];
  }
  return laneIsHome(current) ? path : null;
}
