"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RapierRigidBody } from "@react-three/rapier";
import GameCanvas from "./GameCanvas";
import type { TrapMechanicEvent } from "./TrapRenderer";
import { validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { ChallengeDTO, TrapInstance, TrapPlacementInput, TrapType } from "@/lib/game/types";

const placements: TrapPlacementInput[] = [
  { type: "swinging_hammer", zoneId: "runway_front", offsetX: -1, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "rolling_fridge", zoneId: "runway_mid", offsetX: 1, offsetZ: 0, rotationQuarterTurns: 2 },
  { type: "floor_fan", zoneId: "runway_back", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "soap_slick", zoneId: "stones_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 1 },
  { type: "spring_pad", zoneId: "stones_mid", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "angry_vacuum", zoneId: "bridge_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
  { type: "rotating_toilet", zoneId: "convergence", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 1 },
  { type: "giant_beach_ball", zoneId: "runway_front", offsetX: 1, offsetZ: 0, rotationQuarterTurns: 0 },
];

function sandboxChallenge(onlyTrap: TrapType | null): ChallengeDTO {
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
        <span>WASD · Space · hold E to grab, release to shove · all eight obstacles use release colliders and brand-safe art</span>
        <button className="button secondary" onClick={reset}>Reset run</button>
      </aside>
      <output className="sr-only" aria-label="Sandbox interaction telemetry">
        {JSON.stringify(interaction)}
      </output>
    </main>
  );
}
