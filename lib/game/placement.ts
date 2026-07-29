import { EXIT_POSITION, GRID_SIZE, PLAYER, PLAYER_SPAWN } from "./constants";
import { LEVEL_PIECES, ZONE_MAP, zoneCenter } from "./level-definition";
import { TRAP_CATALOG } from "./trap-catalog";
import type { BuiltTrack } from "./track";
import type { LevelPiece } from "./level-definition";
import type { PlacementZone, TrapInstance, TrapPlacementInput, PlacementValidation, TrapType } from "./types";

export const snapToGrid = (value:number):number => Math.round(value / GRID_SIZE) * GRID_SIZE;

/**
 * Anywhere a trap may stand.
 *
 * Placement used to be limited to eight hand-drawn boxes, and all other ground
 * in the game was simply forbidden. Three of the eight rejection reasons existed
 * only to police that abstraction rather than to protect anything: `outside_zone`
 * refused most of the course, `type_not_allowed` kept per-zone allowlists, and
 * `zone_full` capped occupancy. Dragging a prop therefore snapped to a handful
 * of legal discs and refused everywhere else, which is what read as jank.
 *
 * A surface is now every platform the runner can stand on, derived from the
 * pieces the level is actually built from, so "drop it where you like" means
 * what it says. Authored zones are still resolved FIRST and unchanged - every
 * challenge link already in circulation names one, and those links replay their
 * placement inputs through this function on decode, so a zone id that stopped
 * resolving would break saved levels.
 */
export interface PlacementSurface {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  groundY: number;
}

const surfaceOfZone = (zone: PlacementZone): PlacementSurface => ({
  id: zone.id, minX: zone.minX, maxX: zone.maxX, minZ: zone.minZ, maxZ: zone.maxZ, groundY: zone.groundY,
});

/**
 * The top face of a platform.
 *
 * `rotationX` is ignored here. The only tilted piece in the game is the ramp at
 * -0.1 rad over 3.6u of depth, so treating its top as flat misplaces a trap by
 * at most 0.18u vertically - under the 0.25u placement grid, and the trap is
 * dropped onto the deck rather than suspended, so it reads as seated either way.
 * A steeper piece would need the real plane.
 */
const surfaceOfPiece = (piece: LevelPiece): PlacementSurface => ({
  id: piece.id,
  minX: piece.center[0] - piece.size[0] / 2,
  maxX: piece.center[0] + piece.size[0] / 2,
  minZ: piece.center[2] - piece.size[2] / 2,
  maxZ: piece.center[2] + piece.size[2] / 2,
  groundY: piece.center[1] + piece.size[1] / 2,
});

function surfacesOf(track?: BuiltTrack): readonly PlacementSurface[] {
  const zones = track ? track.zones : [...ZONE_MAP.values()];
  const pieces = track ? track.pieces : LEVEL_PIECES;
  const seen = new Set(zones.map((zone) => zone.id));
  return [
    ...zones.map(surfaceOfZone),
    ...pieces.filter((piece) => !seen.has(piece.id)).map(surfaceOfPiece),
  ];
}

/** Resolve a placement id, authored zones first so existing links keep working. */
function findSurface(id: string, track?: BuiltTrack): PlacementSurface | null {
  const zone = track ? track.zones.find((entry) => entry.id === id) : ZONE_MAP.get(id);
  if (zone) return surfaceOfZone(zone);
  const piece = (track ? track.pieces : LEVEL_PIECES).find((entry) => entry.id === id);
  return piece ? surfaceOfPiece(piece) : null;
}

/** Every surface a trap may stand on, for the editor to draw. */
export function placementSurfaces(track?: BuiltTrack): readonly PlacementSurface[] {
  return surfacesOf(track);
}

/** The surface under a world point, preferring the highest when they overlap. */
export function surfaceAt(worldX: number, worldZ: number, track?: BuiltTrack): PlacementSurface | null {
  let best: PlacementSurface | null = null;
  for (const surface of surfacesOf(track)) {
    if (worldX < surface.minX || worldX > surface.maxX) continue;
    if (worldZ < surface.minZ || worldZ > surface.maxZ) continue;
    if (!best || surface.groundY > best.groundY) best = surface;
  }
  return best;
}

/**
 * The surface closest to a world point, for a cursor that is over none of them.
 *
 * A course is platforms with gaps between them, so a drag from one deck to the
 * next spends most of its travel over nothing at all. Treating that as "no
 * surface" is what made dragging feel broken: the trap had nowhere to be for
 * the whole crossing. Falling back to the nearest deck means the trap rides the
 * edge the cursor is closest to and steps across when the cursor does, which is
 * what picking something up and carrying it is supposed to feel like.
 *
 * Distance is measured to the surface RECTANGLE, not to its centre. Centre
 * distance picks small far platforms over the large near one the cursor is
 * hanging just off the lip of.
 */
export function nearestSurface(worldX: number, worldZ: number, track?: BuiltTrack): PlacementSurface | null {
  let best: PlacementSurface | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const surface of surfacesOf(track)) {
    const x = Math.min(surface.maxX, Math.max(surface.minX, worldX));
    const z = Math.min(surface.maxZ, Math.max(surface.minZ, worldZ));
    const distance = Math.hypot(worldX - x, worldZ - z);
    // Ties go to the higher deck, matching surfaceAt where they overlap.
    if (distance < bestDistance || (distance === bestDistance && best && surface.groundY > best.groundY)) {
      bestDistance = distance;
      best = surface;
    }
  }
  return best;
}

/**
 * Traps whose hazard is a rotating or swinging arm rather than a footprint.
 *
 * These are the only ones where standing room matters, because the hazard
 * covers everything within its radius rather than only what it touches. Kept
 * here rather than in the catalogue because it describes a placement concern,
 * and the catalogue is owned by the trap roster.
 */
const SWEEPING_TYPES: ReadonlySet<TrapType> = new Set([
  "rotating_toilet",
  "swinging_hammer",
  "ceiling_fan",
  // Its leaf rotates 1.25 rad through a band `span` wide (1.9u by default) and
  // the strike test accepts any |lateral| < span/2, so unlike a fan there is no
  // gap to slip through inside the lane. On the 2.1u bridge that leaves 0.1u
  // against a runner 0.76u wide - the same unwinnable case swinging_hammer hit.
  "swing_door",
]);

/**
 * Clear floor a runner needs beside a sweeping hazard: their own width.
 *
 * Taken from the convention lib/game/difficulty.ts already uses, where a zone's
 * dodge room is its width less `PLAYER.capsuleRadius * 2`. An earlier draft of
 * this added 0.15u of slack on top, which is a number with nothing behind it,
 * and it showed: the convergence pad left exactly 0.90u and was refused against
 * a 0.91u bar - a knife-edge decision resting entirely on the invented part.
 */
const DODGE_MARGIN = PLAYER.capsuleRadius * 2;

/**
 * `track` scopes validation to a composed course. Omitting it validates against
 * the original fixed level, which is what every existing challenge uses.
 */
export function validatePlacement(input: TrapPlacementInput, existing: readonly TrapInstance[], track?: BuiltTrack): PlacementValidation {
  if (![input.offsetX,input.offsetZ,input.rotationQuarterTurns].every(Number.isFinite)) return {valid:false,reason:"invalid_number",message:"That position is not a real place."};
  const spawn=track?.spawn??PLAYER_SPAWN; const exit=track?.exit??EXIT_POSITION;
  const surface=findSurface(input.zoneId,track);
  if(!surface) return {valid:false,reason:"outside_zone",message:"Drop the trap on solid floor."};
  // Offsets stay relative to the surface centre, which is what zoneCenter
  // returned for a zone and is the same arithmetic for a piece. Keeping the
  // stored value an OFFSET rather than a world position is what lets a link
  // replay onto a course whose geometry has since shifted.
  const cx=(surface.minX+surface.maxX)/2; const cz=(surface.minZ+surface.maxZ)/2;
  const ox=snapToGrid(input.offsetX); const oz=snapToGrid(input.offsetZ);
  const x=cx+ox; const z=cz+oz; const radius=TRAP_CATALOG[input.type].placementRadius;
  const edgeClearance=radius*.5;
  if(x-edgeClearance<surface.minX||x+edgeClearance>surface.maxX||z-edgeClearance<surface.minZ||z+edgeClearance>surface.maxZ) return {valid:false,reason:"outside_zone",message:"Keep the trap base on the floor."};
  for(const trap of existing){ const other=TRAP_CATALOG[trap.type].placementRadius; if(Math.hypot(x-trap.position[0],z-trap.position[2])<.75*(radius+other)) return {valid:false,reason:"overlaps_trap",message:"Give the other disaster some room."}; }
  if(Math.hypot(x-spawn[0],z-spawn[2])<2.2+radius) return {valid:false,reason:"blocks_spawn",message:"The runner needs somewhere to start."};
  if(Math.hypot(x-exit[0],z-exit[2])<1.5+radius) return {valid:false,reason:"blocks_exit",message:"Leave the exit barely survivable."};
  // Was a name test - `zone.id.startsWith("stones")` - which refused a sweep on
  // anything called a stone and allowed it on any narrow platform called
  // something else. The question it was always asking is geometric: this arm
  // covers `radius` around itself, so is there a body's width of floor left to
  // either side of it? Measured on the wider side, because a runner only needs
  // one way past.
  if(SWEEPING_TYPES.has(input.type)){
    const room=Math.max(x-surface.minX,surface.maxX-x)-radius;
    if(room<DODGE_MARGIN) return {valid:false,reason:"unsafe_sweep",message:"Not enough room to dodge this here."};
  }
  return {valid:true,canonicalPosition:[x,surface.groundY,z],rotationY:input.rotationQuarterTurns*Math.PI/2};
}

/**
 * Turn a point the player dragged to into a placement input.
 *
 * `zoneId` is now a hint rather than a requirement: if the point has left the
 * surface it started on, the surface under the cursor wins. That is what makes
 * a drag continuous across the whole course instead of stopping at the edge of
 * wherever it began.
 */
export function placementFromWorld(type: TrapPlacementInput["type"], zoneId:string, worldX:number, worldZ:number, rotationQuarterTurns:0|1|2|3, track?:BuiltTrack):TrapPlacementInput {
  // Nearest before findSurface: once a drag has crossed off its starting deck,
  // the deck the cursor is closest to is a better answer than the one the drag
  // began on, and it is what lets a trap walk from platform to platform.
  const surface=surfaceAt(worldX,worldZ,track)??nearestSurface(worldX,worldZ,track)??findSurface(zoneId,track);
  // Unreachable in a drag, because PlacementZones only ever passes an id it
  // took from this same surface list, so findSurface resolves it. Kept finite
  // rather than NaN anyway: a caller that does reach it gets an offset
  // validatePlacement can refuse in the ordinary way instead of a value that
  // poisons every sum it touches downstream.
  if(!surface) return {type,zoneId,offsetX:0,offsetZ:0,rotationQuarterTurns};
  const cx=(surface.minX+surface.maxX)/2; const cz=(surface.minZ+surface.maxZ)/2;
  // The clamp is the fix for "the camera jumps to the end of the map".
  //
  // With the cursor off every deck, surfaceAt gave nothing and the offset was
  // measured from the STARTING deck's centre with no bound on it, so a drag
  // that ran ten units past the lip produced an offset ten units long. That is
  // refused, but a refused placement still has to be drawn, and GameScene hands
  // the drawn position to CameraRig as editorTarget - so the camera dutifully
  // flew out to a point off the end of the course and sat there. Measured: a
  // drag to 12u past a deck whose edge is at 4.0 landed the trap at 14.25.
  //
  // Clamping into the resolved surface means the drag always resolves to a
  // point ON the map, so the preview stays put and the camera has nowhere silly
  // to go. Overlap and dodge-room can still refuse a spot on their own merits,
  // which are refusals the player can see and act on.
  const x=Math.min(surface.maxX,Math.max(surface.minX,worldX));
  const z=Math.min(surface.maxZ,Math.max(surface.minZ,worldZ));
  return {type,zoneId:surface.id,offsetX:snapToGrid(x-cx),offsetZ:snapToGrid(z-cz),rotationQuarterTurns};
}

/** Kept for callers that still centre on an authored zone. */
export { zoneCenter };
