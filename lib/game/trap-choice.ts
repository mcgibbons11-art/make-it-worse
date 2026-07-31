import { GRID_SIZE } from "./constants";
import {
  placementSurfaces,
  validatePlacement,
  type PlacementSurface,
} from "./placement";
import { createSeededRandom, hashString } from "./seed";
import { CLASSIC_TRACK, buildTrack } from "./track";
import type { BuiltTrack } from "./track";
import { TRAP_CATALOG, TRAP_TYPES, type TrapCategory } from "./trap-catalog";
import type {
  ChallengeDTO,
  TrapInstance,
  TrapPlacementInput,
  TrapType,
} from "./types";

/**
 * Quarter turn 0 points a trap's forward axis at +Z, which is straight at the
 * exit. The fan cone, the spring pad kick, the mousetrap kick, the toaster
 * muzzle and the fridge charge all run along that axis, so every trap the game
 * suggested was shoving the runner toward the finish while charging the player
 * full risk for it. A half turn aims them back up the course at whoever is
 * arriving. Rotation is still the player's to change before they confirm.
 */
export const DEFAULT_ROTATION_QUARTER_TURNS = 2;

/** The course a challenge is actually played on. */
export function challengeTrack(
  challenge: Pick<ChallengeDTO, "track"> | null,
): BuiltTrack {
  return buildTrack(challenge?.track ?? CLASSIC_TRACK);
}

const LATTICE_CACHE = new Map<string, readonly (readonly [number, number])[]>();

/** Grid positions inside a block surface, centre first, then outward. */
function offsetLattice(surface: PlacementSurface): readonly (readonly [number, number])[] {
  const width = surface.maxX - surface.minX;
  const depth = surface.maxZ - surface.minZ;
  const cacheKey = `${width.toFixed(4)}:${depth.toFixed(4)}`;
  const cached = LATTICE_CACHE.get(cacheKey);
  if (cached) return cached;
  const steps = (half: number): number[] => {
    const out = [0];
    for (let step = 1; step * GRID_SIZE <= half; step += 1)
      out.push(step * GRID_SIZE, -step * GRID_SIZE);
    return out;
  };
  const lattice: [number, number][] = [];
  for (const offsetX of steps(width / 2))
    for (const offsetZ of steps(depth / 2))
      lattice.push([offsetX, offsetZ]);
  const ordered = lattice.sort(
    (a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]),
  );
  LATTICE_CACHE.set(cacheKey, ordered);
  return ordered;
}

/**
 * Where this trap would go if the player picked it, or null if the course has
 * no room for it at all.
 *
 * The offer list and the placement it leads to have to come from the same
 * search or they drift: the old availability check counted zone occupancy and
 * nothing else, while selection only ever tried a zone's exact centre, so the
 * game kept offering traps it could not place and the choice panel became a
 * dead end. Everything that needs to know "does this fit" calls this.
 *
 * Untouched blocks come first so a chain spreads down the course before it
 * starts filling the open space on an earlier one. The visible block surfaces
 * are deliberately the only search space: authored placement pads remain
 * readable for old links, but choosing a new trap must not silently put it on
 * a retired pad that the player cannot see or grab.
 */
export function firstLegalPlacement(
  track: BuiltTrack,
  type: TrapType,
  existing: readonly TrapInstance[],
): TrapPlacementInput | null {
  const usable = placementSurfaces(track);
  for (const emptyOnly of [true, false]) {
    const candidates = usable.flatMap((surface) => {
      const occupants = existing.filter(
        (trap) =>
          trap.position[0] >= surface.minX &&
          trap.position[0] <= surface.maxX &&
          trap.position[2] >= surface.minZ &&
          trap.position[2] <= surface.maxZ,
      ).length;
      return emptyOnly === (occupants === 0)
        ? [{ surface, offsets: offsetLattice(surface) }]
        : [];
    });
    const widestLattice = Math.max(0, ...candidates.map(({ offsets }) => offsets.length));
    // Try every untouched block's centre before walking toward any edge. This
    // prevents the spawn block from winning with a technically legal corner
    // placement while an open, centered runway sits immediately after it.
    for (let offsetIndex = 0; offsetIndex < widestLattice; offsetIndex += 1) {
      for (const { surface, offsets } of candidates) {
        const offset = offsets[offsetIndex];
        if (!offset) continue;
        const [offsetX, offsetZ] = offset;
        const candidate: TrapPlacementInput = {
          type,
          zoneId: surface.id,
          offsetX,
          offsetZ,
          rotationQuarterTurns: DEFAULT_ROTATION_QUARTER_TURNS,
        };
        if (validatePlacement(candidate, existing, track).valid) return candidate;
      }
    }
  }
  return null;
}

export function getAvailableTrapTypes(
  track: BuiltTrack,
  existing: readonly TrapInstance[],
): TrapType[] {
  return TRAP_TYPES.filter(
    (type) => firstLegalPlacement(track, type, existing) !== null,
  );
}

/**
 * How many traps a player is offered between rounds.
 *
 * Three is not a design choice that lives here. It is pinned by the wire and
 * the database: AttemptStartResult and AttemptFinishResult in types.ts declare
 * a three-tuple, stores/game-store.ts stores one, DemoRepository holds one, and
 * migration 0002 puts `check(cardinality(offered_traps) = 3)` on the column
 * that both finish_attempt RPCs write. Widening the hand means changing all
 * five together; the selection below is written so only this constant and those
 * five declarations move when that happens.
 */
export const OFFER_SIZE = 3;

/**
 * An unbiased draw from a seeded stream.
 *
 * This used to be `sort(() => rng() - 0.5)`, which is not a shuffle: the
 * comparator ignores its arguments, so the result depends on the sorting
 * algorithm rather than on the random numbers, and V8 changes algorithm at 22
 * elements. Measured over 40,000 attempts on the live roster, the trap sitting
 * first in TRAP_TYPES reached the offer 2.4 times as often as a uniform draw
 * would put it there and the rarest reached it 0.67 times as often, a spread of
 * 3.6 to 1 across the roster. That got worse as the roster grew - the same
 * measurement at 22 traps gave 2.8 to 1 - which is the opposite of what adding
 * traps is supposed to do for the player. Fisher-Yates holds every trap inside
 * 4.2% of uniform at both sizes.
 */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

/**
 * The traps a player may choose from after an attempt.
 *
 * Three cards out of a roster of fifty is a narrower window than three out of
 * twenty-two was, so what those three are matters more than it used to. Two
 * things decide it, in this order.
 *
 * Anything already standing on the course goes to the back. The roster is
 * wide, so there is no reason to spend a pick re-offering what the player has
 * already watched somebody place;
 * putting unused traps first turns a chain into a tour of the roster instead of
 * a tour of whatever the first few rolls happened to like. It is an ordering
 * rather than a ban, because a course whose zones only accept a handful of
 * types has to keep offering those.
 *
 * Then one sweeper, one movement and one prop, so the three cards differ in
 * what they do to a runner rather than only in name. Where a category has
 * nothing placeable left the slot is filled from whatever remains.
 *
 * Every candidate comes from getAvailableTrapTypes, which asks
 * firstLegalPlacement for a real position on this challenge's own track, so an
 * offer is never a card the player cannot put down.
 */
export function chooseTraps(
  attemptId: string,
  challengeId: string,
  baseSeed: number,
  existing: readonly TrapInstance[],
  track: BuiltTrack,
): readonly [TrapType, TrapType, TrapType] | null {
  const available = getAvailableTrapTypes(track, existing);
  if (available.length < OFFER_SIZE) return null;
  const rng = createSeededRandom(
    hashString(`${attemptId}:${challengeId}:${baseSeed}`),
  );
  const placed = new Set(existing.map((trap) => trap.type));
  const order = shuffled(available, rng);
  const ranked = [
    ...order.filter((type) => !placed.has(type)),
    ...order.filter((type) => placed.has(type)),
  ];
  const selected: TrapType[] = [];
  for (const category of [
    "sweeper",
    "movement",
    "prop",
  ] as const satisfies readonly TrapCategory[]) {
    if (selected.length === OFFER_SIZE) break;
    const pick = ranked.find(
      (type) =>
        TRAP_CATALOG[type].category === category && !selected.includes(type),
    );
    if (pick) selected.push(pick);
  }
  for (const type of ranked) {
    if (selected.length === OFFER_SIZE) break;
    if (!selected.includes(type)) selected.push(type);
  }
  return [selected[0]!, selected[1]!, selected[2]!];
}
