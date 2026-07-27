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
import type { TrapMechanicEvent } from "./TrapRenderer";
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
}
export default function GameCanvas(props: Props) {
  return (
    <Canvas
      className="game-canvas"
      shadows="basic"
      dpr={[1, 1.5]}
      camera={{ fov: 52, near: 0.1, far: 180, position: [0, 4, -5] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <Suspense fallback={null}>
        <AssetReadinessGate onReady={props.onAssetsReady} />
        <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
          <GameScene {...props} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
