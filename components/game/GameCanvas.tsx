"use client";
import { Canvas } from "@react-three/fiber";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import type { MutableRefObject, RefObject } from "react";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  HazardContact,
  TrapPlacementInput,
} from "@/lib/game/types";
import { GameScene } from "./GameScene";
import { Suspense } from "react";
import { AssetReadinessGate } from "./AssetModel";
import { ACESFilmicToneMapping } from "three";
import { TONE_EXPOSURE } from "./render/tone";
import type { TrapMechanicEvent } from "./TrapRenderer";
import type { BuiltTrack } from "@/lib/game/track";
import type { LiveGhostFeed } from "./LiveGhostRunner";
interface Props {
  challenge: ChallengeDTO;
  phase: GamePhase;
  attemptSerial: number;
  startedAt: number;
  placement: TrapPlacementInput | null;
  ghostEnabled: boolean;
  recordSample(sample: DecodedGhostSample): void;
  onProgress(value: number): void;
  onInteraction?(state: { holdingObject: boolean; releasedObjectSpeed: number }): void;
  qaPlayerRef?: RefObject<RapierRigidBody | null>;
  qaTrapBodiesRef?: MutableRefObject<Map<string, RapierRigidBody>>;
  onMechanic?(event: TrapMechanicEvent): void;
  onFinish(): void;
  onFail(outcome: "fell" | "timeout" | "reset"): void;
  onHazard(contact: HazardContact): void;
  onSelectZone(zoneId: string): void;
  onMovePlacement(zoneId: string, worldX: number, worldZ: number): void;
  onAssetsReady(): void;
  /** Direct authored geometry used by the custom-map Test mode. */
  trackOverride?: BuiltTrack;
  /** A duel opponent streamed live over Portals.net, rendered as a ghost. */
  liveGhost?: LiveGhostFeed | null;
}
export default function GameCanvas(props: Props) {
  return (
    <Canvas
      className="game-canvas"
      // The shadow frustum follows the player, so each texel covers more ground,
      // and unfiltered shadows made that enlargement read as stair-stepping
      // along every contact edge. So this wants filtering, and "percentage" is
      // PCFShadowMap.
      //
      // It said "soft" (PCFSoftShadowMap), which three r185 has deprecated. The
      // renderer was ALREADY substituting PCFShadowMap and warning about it once
      // per frame - a playtest measured 191 warnings in 8 seconds, about 24 a
      // second, which makes the console useless for finding anything else. So
      // this is not a downgrade: it asks for what we were already getting, and
      // stops the renderer shouting about the difference.
      shadows="percentage"
      dpr={[1, 1.5]}
      camera={{ fov: 52, near: 0.1, far: 180, position: [0, 4, -5] }}
      // Deliberately an 8-bit output buffer. three r185 will render into a
      // half-float target and tone map in a final full-screen pass if given
      // `outputBufferType: HalfFloatType`, which is the only configuration where
      // `setEffects` works and the only one where an emissive can hold a
      // radiance above 1.0 for a bloom pass to isolate - after ACES the exit
      // sign and the pendant bulbs land *darker* than the lit decks, so bloom
      // cannot be thresholded in an 8-bit pipeline at all. That path also moves
      // every alpha blend from display space into linear radiance, because it
      // forces tone mapping off while the scene renders. The hazard decals are
      // transparent PALETTE.danger over bright cream decks, and blending them
      // linearly turns them from crimson to tan and roughly halves their
      // contrast against the deck (2.83:1 to 1.47:1 at opacity 0.6, 2.08:1 to
      // 1.23:1 at 0.42). Bloom is not worth that trade while the trap materials
      // blend the way they do.
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = TONE_EXPOSURE;
      }}
    >
      {/* The readiness gate sits in its own boundary: sharing one with the
          scene meant any scene-level suspension also unmounted the gate, so
          the start button could never enable. */}
      <Suspense fallback={null}>
        <AssetReadinessGate onReady={props.onAssetsReady} />
      </Suspense>
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
          <GameScene {...props} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
