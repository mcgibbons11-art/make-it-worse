"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RapierRigidBody } from "@react-three/rapier";
import GameCanvas from "./GameCanvas";
import type { TrapMechanicEvent } from "./TrapRenderer";
import { validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { ChallengeDTO, TrapInstance, TrapPlacementInput, TrapType } from "@/lib/game/types";

// One placement per entry in TRAP_TYPES. The sandbox exists to reach a trap
// without playing to it, so a roster entry with no placement here is a trap QA
// cannot open at all: `?trap=<type>` would serve an empty course.
// The whole 54-entry roster, one placement each, solved against
// validatePlacement rather than written by hand.
//
// At 38 the eight authored zones were genuinely full and the note here said the
// next wave would not fit. Free placement is what made room: every LevelPiece is
// a placement surface now, so `start`, `runway`, `bridge`, `finish` and the
// islands are addressable as zoneIds alongside the authored zones, and the
// sixteen added below sit almost entirely on that new floor. The binding
// constraint is no longer zone occupancy - that cap is gone - but the overlap
// rule, 0.75 x the sum of the two placement radii.
//
// The sixteen were solved largest-radius-first, because a wide trap has the
// fewest legal homes and placing the small ones first strands it, and each was
// given the legal point with the most clearance rather than the first that
// passed, so the sandbox reads as a gallery rather than a heap.
const placements: TrapPlacementInput[] = [
  { type: "ceiling_fan", zoneId: "runway_front", offsetX: -1.5, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "swinging_hammer", zoneId: "finish", offsetX: 2.75, offsetZ: 1.5, rotationQuarterTurns: 0 },
  { type: "rotating_toilet", zoneId: "convergence", offsetX: -1.5, offsetZ: -0.25, rotationQuarterTurns: 0 },
  { type: "angry_vacuum", zoneId: "stone-c", offsetX: 0.5, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "swing_door", zoneId: "finish", offsetX: -2.75, offsetZ: -0.75, rotationQuarterTurns: 0 },
  { type: "rolling_fridge", zoneId: "bridge", offsetX: -0.5, offsetZ: 2, rotationQuarterTurns: 0 },
  { type: "pile_on", zoneId: "stones_front", offsetX: -0.5, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "ice_dispenser", zoneId: "start", offsetX: 3.25, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "fridge_magnet", zoneId: "right-island", offsetX: 0.5, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "robot_mop", zoneId: "start", offsetX: -3.5, offsetZ: -1.5, rotationQuarterTurns: 0 },
  { type: "paint_bucket", zoneId: "runway", offsetX: 2.5, offsetZ: 1, rotationQuarterTurns: 0 },
  { type: "spin_cycle", zoneId: "finish", offsetX: 1.25, offsetZ: -2.5, rotationQuarterTurns: 0 },
  { type: "drawer_slam", zoneId: "bridge", offsetX: -0.75, offsetZ: -2, rotationQuarterTurns: 0 },
  { type: "shoe_rack", zoneId: "left-island", offsetX: -0.5, offsetZ: -0.75, rotationQuarterTurns: 0 },
  { type: "clothes_airer", zoneId: "stone-b", offsetX: -0.75, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "sprinkler", zoneId: "runway", offsetX: -2.5, offsetZ: 1.75, rotationQuarterTurns: 0 },
  { type: "rug_pull", zoneId: "finish", offsetX: -3, offsetZ: 2.5, rotationQuarterTurns: 0 },
  { type: "bathroom_scales", zoneId: "runway", offsetX: 1.75, offsetZ: -2, rotationQuarterTurns: 0 },
  { type: "ball_machine", zoneId: "convergence", offsetX: 1.5, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "floor_fan", zoneId: "center-island", offsetX: 0, offsetZ: -1, rotationQuarterTurns: 0 },
  { type: "mousetrap", zoneId: "start", offsetX: -3.5, offsetZ: 1.25, rotationQuarterTurns: 0 },
  { type: "laundry_basket", zoneId: "ramp", offsetX: -0.75, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "chute_drop", zoneId: "runway", offsetX: 0.25, offsetZ: 2.25, rotationQuarterTurns: 0 },
  { type: "cart_blocker", zoneId: "finish", offsetX: -0.25, offsetZ: -0.25, rotationQuarterTurns: 0 },
  { type: "mattress_rebound", zoneId: "bridge", offsetX: 0.75, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "bin_pedal", zoneId: "runway_mid", offsetX: 0.25, offsetZ: -0.25, rotationQuarterTurns: 0 },
  { type: "cuckoo_clock", zoneId: "finish", offsetX: 3, offsetZ: -1, rotationQuarterTurns: 0 },
  { type: "kettle_boil", zoneId: "center-island", offsetX: 0, offsetZ: 1.25, rotationQuarterTurns: 0 },
  { type: "toaster_launcher", zoneId: "finish", offsetX: -1.25, offsetZ: -2.25, rotationQuarterTurns: 0 },
  { type: "cord_trip", zoneId: "left-island", offsetX: -0.5, offsetZ: 1.25, rotationQuarterTurns: 0 },
  { type: "conveyor_strip", zoneId: "island_right", offsetX: -0.5, offsetZ: 1.5, rotationQuarterTurns: 0 },
  { type: "steam_vents", zoneId: "runway", offsetX: -1.5, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "paparazzi", zoneId: "finish_mid", offsetX: 1.5, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "fish_bowl", zoneId: "ramp", offsetX: 1, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "stove_ring", zoneId: "finish", offsetX: -3, offsetZ: -2.5, rotationQuarterTurns: 0 },
  { type: "soap_slick", zoneId: "finish", offsetX: -2, offsetZ: 1, rotationQuarterTurns: 0 },
  { type: "giant_beach_ball", zoneId: "right-island", offsetX: -0.5, offsetZ: -1.5, rotationQuarterTurns: 0 },
  { type: "domino_line", zoneId: "stone-b", offsetX: 0.75, offsetZ: -0.5, rotationQuarterTurns: 0 },
  { type: "cat_flap", zoneId: "left-island", offsetX: 0.75, offsetZ: 0.25, rotationQuarterTurns: 0 },
  { type: "slow_fuse", zoneId: "start", offsetX: 2.25, offsetZ: 1.25, rotationQuarterTurns: 0 },
  { type: "spring_pad", zoneId: "bridge", offsetX: 0.75, offsetZ: -2.5, rotationQuarterTurns: 0 },
  { type: "tilt_plate", zoneId: "convergence", offsetX: 0, offsetZ: -0.5, rotationQuarterTurns: 0 },
  { type: "flood_puddle", zoneId: "start", offsetX: -2, offsetZ: 1.5, rotationQuarterTurns: 0 },
  { type: "junk_drift", zoneId: "start", offsetX: 3, offsetZ: -1.5, rotationQuarterTurns: 0 },
  { type: "sticky_gum", zoneId: "runway", offsetX: 0, offsetZ: -2.25, rotationQuarterTurns: 0 },
  { type: "bunting_line", zoneId: "runway", offsetX: 2, offsetZ: -0.5, rotationQuarterTurns: 0 },
  { type: "plate_shards", zoneId: "bridge", offsetX: -0.75, offsetZ: -0.25, rotationQuarterTurns: 0 },
  { type: "hot_potato", zoneId: "left-island", offsetX: 0.75, offsetZ: -1.75, rotationQuarterTurns: 0 },
  { type: "pipe_burst", zoneId: "finish", offsetX: 2.75, offsetZ: -2.5, rotationQuarterTurns: 0 },
  { type: "updraft_vent", zoneId: "start", offsetX: -2.75, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "banana_peel", zoneId: "stone-c", offsetX: -1, offsetZ: -0.5, rotationQuarterTurns: 0 },
  { type: "motion_sensor", zoneId: "stone-a", offsetX: 1, offsetZ: -0.5, rotationQuarterTurns: 0 },
  { type: "dust_bunny", zoneId: "bridge", offsetX: 1, offsetZ: 2.5, rotationQuarterTurns: 0 },
  { type: "ankle_weight", zoneId: "runway", offsetX: 1.75, offsetZ: 2.25, rotationQuarterTurns: 0 },
];

/**
 * HOW TO RE-SOLVE THIS LIST, because it will need re-solving again.
 *
 * The list above is a packing solution, not a layout anyone chose, and it is
 * only valid against one particular course geometry. It has already been
 * invalidated twice: once when the roster grew from 38 to 54, and once when the
 * course itself was reshaped - the bridge went from 3 x 10.2 to 2.6 x 5.9 and
 * the islands narrowed, which silently moved seventeen placements off their
 * floor. Both times the symptom was the same, `outside_zone` from
 * sandboxChallenge at page load.
 *
 * The method that works, and the order matters:
 *   1. Solve largest placementRadius first. A wide trap has the fewest legal
 *      homes, so placing the small ones first strands it. swinging_hammer at
 *      1.3 is the hard case, because it also has to satisfy the geometric
 *      unsafe_sweep rule, and on the current course only `start` and `finish`
 *      are wide enough to hold it at all.
 *   2. Search the LevelPiece surfaces as well as the authored zones. Free
 *      placement made every piece a legal zoneId, and the pieces are where the
 *      room is: four of them are hyphenated (`stone-a`, `left-island`,
 *      `center-island`, `right-island`), which the parser in
 *      tests/unit/trap-roster.test.ts has to keep accepting.
 *   3. Take the legal point with the most clearance rather than the first that
 *      passes, or everything piles into whichever surface is searched first.
 *   4. Re-solve the WHOLE list, not just the broken entries. Keeping the
 *      still-legal ones pinned leaves them holding the prime floor and the
 *      re-solve then fails on the traps that were displaced.
 *
 * Do not shrink placementRadius to force a fit. Radius is what the overlap rule
 * and the placement preview both read, so shrinking it to win a packing
 * argument makes every trap on the course crowd its neighbours.
 */
function sandboxChallenge(onlyTrap: TrapType | null): ChallengeDTO {
  const unplaced = TRAP_TYPES.filter((type) => !placements.some((entry) => entry.type === type));
  if (unplaced.length > 0)
    throw new Error(`Sandbox has no placement for ${unplaced.join(", ")}`);
  const traps: TrapInstance[] = [];
  placements.filter((placement) => !onlyTrap || placement.type === onlyTrap).forEach((placement, index) => {
    const result = validatePlacement(placement, traps);
    if (!result.valid) throw new Error(`Sandbox placement ${index} is invalid: ${result.reason}`);
    traps.push({
      id: `sandbox-${index}`,
      type: placement.type,
      ownerUserId: null,
      ownerName: "QA Gremlin",
      ownerAvatarSeed: 900 + index,
      depthAdded: index + 1,
      zoneId: placement.zoneId,
      position: result.canonicalPosition,
      rotationY: result.rotationY,
      seed: 7000 + index,
      params: TRAP_CATALOG[placement.type].defaultParams,
    });
  });
  return {
    id: "sandbox",
    slug: "sandbox-all-traps",
    chainId: "sandbox",
    chainSlug: "sandbox",
    parentSlug: null,
    depth: traps.length,
    baseSeed: 777,
    levelVersion: 1,
    createdByName: "QA Gremlin",
    createdByAvatarSeed: 777,
    addedTrap: traps.at(-1) ?? null,
    traps,
    ghostTrace: null,
    stats: { attempts: 0, completions: 0, survivalRate: null, bestTimeMs: null, recentAttempts: 0, shareCount: 0 },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
  };
}

interface SandboxPhysicsState {
  player: { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } | null;
  traps: Partial<Record<TrapType, { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }>>;
  mechanics: Array<TrapMechanicEvent & { at: number }>;
  lastHazardType: TrapType | null;
}
declare global {
  interface Window {
    __MIW_SANDBOX__?: {
      getState(): SandboxPhysicsState;
      teleportPlayer(type: TrapType, offsetX?: number, offsetZ?: number, height?: number): void;
      teleportPlayerToTrapBody(type: TrapType, offsetX?: number, offsetZ?: number): void;
      setPlayerVelocity(x: number, y: number, z: number): void;
      setTrapVelocity(type: TrapType, x: number, y: number, z: number): void;
      placeTrapInFrontOfPlayer(type: TrapType, distance?: number): void;
    };
  }
}

export default function SandboxClient({ requested }: { requested: string | undefined }) {
  const onlyTrap = requested && requested in TRAP_CATALOG ? requested as TrapType : null;
  const challenge = useMemo(() => sandboxChallenge(onlyTrap), [onlyTrap]);
  const [attemptSerial, setAttemptSerial] = useState(1);
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [interaction, setInteraction] = useState({ holdingObject: false, releasedObjectSpeed: 0 });
  const playerBody = useRef<RapierRigidBody>(null);
  const trapBodies = useRef(new Map<string, RapierRigidBody>());
  const mechanics = useRef<Array<TrapMechanicEvent & { at: number }>>([]);
  const lastHazardType = useRef<TrapType | null>(null);
  const reset = () => {
    mechanics.current = [];
    lastHazardType.current = null;
    setAttemptSerial((value) => value + 1);
    setStartedAt(performance.now());
  };
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E_TEST_MODE !== "1") return;
    const physics = (body: RapierRigidBody | null | undefined) => {
      if (!body) return null;
      try {
        const position = body.translation();
        const velocity = body.linvel();
        return {
          position: { x: position.x, y: position.y, z: position.z },
          velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
        };
      } catch {
        return null;
      }
    };
    window.__MIW_SANDBOX__ = {
      getState: () => ({
        player: physics(playerBody.current),
        traps: Object.fromEntries(
          challenge.traps.flatMap((trap) => {
            const state = physics(trapBodies.current.get(trap.id));
            return state ? [[trap.type, state]] : [];
          }),
        ),
        mechanics: [...mechanics.current],
        lastHazardType: lastHazardType.current,
      }),
      teleportPlayer: (type, offsetX = 0, offsetZ = 0, height = 0.93) => {
        const trap = challenge.traps.find((entry) => entry.type === type);
        const player = playerBody.current;
        if (!trap || !player) return;
        player.setTranslation(
          { x: trap.position[0] + offsetX, y: trap.position[1] + height, z: trap.position[2] + offsetZ },
          true,
        );
        player.setLinvel({ x: 0, y: 0, z: 0 }, true);
      },
      teleportPlayerToTrapBody: (type, offsetX = 0, offsetZ = 0) => {
        const trap = challenge.traps.find((entry) => entry.type === type);
        const player = playerBody.current;
        const target = trap ? trapBodies.current.get(trap.id) : null;
        if (!player || !target) return;
        const position = target.translation();
        player.setTranslation({ x: position.x + offsetX, y: 0.93, z: position.z + offsetZ }, true);
        player.setLinvel({ x: 0, y: 0, z: 0 }, true);
      },
      setPlayerVelocity: (x, y, z) => playerBody.current?.setLinvel({ x, y, z }, true),
      setTrapVelocity: (type, x, y, z) => {
        const trap = challenge.traps.find((entry) => entry.type === type);
        if (trap) trapBodies.current.get(trap.id)?.setLinvel({ x, y, z }, true);
      },
      placeTrapInFrontOfPlayer: (type, distance = 1) => {
        const trap = challenge.traps.find((entry) => entry.type === type);
        const player = playerBody.current;
        const target = trap ? trapBodies.current.get(trap.id) : null;
        if (!player || !target) return;
        const position = player.translation();
        target.setTranslation({ x: position.x, y: position.y, z: position.z + distance }, true);
        target.setLinvel({ x: 0, y: 0, z: 0 }, true);
      },
    };
    return () => {
      delete window.__MIW_SANDBOX__;
    };
  }, [challenge]);
  return (
    <main className="game-shell">
      <GameCanvas
        challenge={challenge}
        phase="playing"
        attemptSerial={attemptSerial}
        startedAt={startedAt}
        placement={null}
        ghostEnabled={false}
        recordSample={() => {}}
        onProgress={() => {}}
        onInteraction={setInteraction}
        qaPlayerRef={playerBody}
        qaTrapBodiesRef={trapBodies}
        onMechanic={(event) => mechanics.current.push({ ...event, at: performance.now() })}
        onFinish={reset}
        onFail={reset}
        onHazard={(hazard) => {
          lastHazardType.current = hazard.trapType;
        }}
        onSelectZone={() => {}}
        onMovePlacement={() => {}}
        onAssetsReady={() => {}}
      />
      <aside className="sandbox-banner panel">
        <strong>ALL-TRAP QA SANDBOX</strong>
        <span>
          WASD · Space · hold E to grab, release to shove · {challenge.traps.length} of{" "}
          {TRAP_TYPES.length} obstacles loaded; some props are still stand-ins
        </span>
        <button className="button secondary" onClick={reset}>Reset run</button>
      </aside>
      <output className="sr-only" aria-label="Sandbox interaction telemetry">
        {JSON.stringify(interaction)}
      </output>
    </main>
  );
}
