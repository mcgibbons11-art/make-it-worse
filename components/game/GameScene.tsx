"use client";
import { useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import type { RapierRigidBody } from "@react-three/rapier";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  HazardContact,
  TrapPlacementInput,
} from "@/lib/game/types";
import { validatePlacement } from "@/lib/game/placement";
import { ZONE_MAP, zoneCenter } from "@/lib/game/level-definition";
import { snapToGrid } from "@/lib/game/placement";
import { PlayerVisual } from "./PlayerVisual";
import { Lighting } from "./Lighting";
import { LevelGeometry } from "./LevelGeometry";
import { ExitDoor } from "./ExitDoor";
import { PlayerController } from "./PlayerController";
import { CameraRig } from "./CameraRig";
import { TrapRenderer, type TrapMechanicEvent } from "./TrapRenderer";
import { GhostRunner } from "./GhostRunner";
import { PlacementZones } from "./placement/PlacementZones";
import { TrapPreview } from "./placement/TrapPreview";
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
}
export function GameScene({
  challenge,
  phase,
  attemptSerial,
  startedAt,
  placement,
  ghostEnabled,
  recordSample,
  onProgress,
  onInteraction,
  qaPlayerRef,
  qaTrapBodiesRef,
  onMechanic,
  onFinish,
  onFail,
  onHazard,
  onSelectZone,
  onMovePlacement,
}: Props) {
  const internalPlayer = useRef<RapierRigidBody>(null);
  const player = qaPlayerRef ?? internalPlayer;
  const soapUntilRef = useRef(0);
  const stunUntilRef = useRef(0);
  const shakeUntilRef = useRef(0);
  const grabbables = useRef(new Map<string, RapierRigidBody>());
  const internalTrapBodies = useRef(new Map<string, RapierRigidBody>());
  const trapBodies = qaTrapBodiesRef ?? internalTrapBodies;
  const validation = useMemo(
    () => (placement ? validatePlacement(placement, challenge.traps) : null),
    [placement, challenge.traps],
  );
  const previewPosition = useMemo(() => {
    if (!placement) return null;
    if (validation?.valid) return validation.canonicalPosition;
    const zone = ZONE_MAP.get(placement.zoneId);
    if (!zone) return null;
    const [x, z] = zoneCenter(zone);
    return [
      x + snapToGrid(placement.offsetX),
      zone.groundY,
      z + snapToGrid(placement.offsetZ),
    ] as const;
  }, [placement, validation]);
  return (
    <>
      <Lighting />
      <LevelGeometry />
      <ExitDoor showLabel={phase === "playing"} />
      {challenge.traps.map((trap) => (
        <TrapRenderer
          key={`${attemptSerial}-${trap.id}`}
          trap={trap}
          player={player}
          soapUntilRef={soapUntilRef}
          stunUntilRef={stunUntilRef}
          grabbables={grabbables}
          trapBodies={trapBodies}
          startedAt={startedAt}
          onMechanic={onMechanic}
          onHazard={(hazard) => {
            shakeUntilRef.current = performance.now() + 220;
            stunUntilRef.current =
              performance.now() +
              Math.min(500, Math.max(250, hazard.impulseMagnitude * 22));
            onHazard(hazard);
          }}
        />
      ))}
      {attemptSerial > 0 ? (
        <>
          <PlayerController
            ref={player}
            active={phase === "playing"}
            attemptSerial={attemptSerial}
            visualVisible={phase !== "placing_trap"}
            pose={phase === "finished" ? "victory" : phase === "failed" ? "failure" : phase === "playing" ? "playing" : "idle"}
            avatarSeed={challenge.createdByAvatarSeed}
            startedAt={startedAt}
            soapUntilRef={soapUntilRef}
            stunUntilRef={stunUntilRef}
            grabbables={grabbables}
            recordSample={recordSample}
            onProgress={onProgress}
            onInteraction={onInteraction}
            onFinish={onFinish}
            onFail={onFail}
          />
          <CameraRig
            player={player}
            editorTarget={phase === "placing_trap" ? previewPosition : null}
            shakeUntilRef={shakeUntilRef}
          />
          {phase === "playing" && ghostEnabled && challenge.ghostTrace && (
            <GhostRunner
              trace={challenge.ghostTrace}
              avatarSeed={challenge.createdByAvatarSeed}
              name={challenge.createdByName}
              startedAt={startedAt}
            />
          )}
        </>
      ) : (
        <group position={[0, 1.25, 1.2]}>
          <PlayerVisual avatarSeed={challenge.createdByAvatarSeed} />
        </group>
      )}
      {phase === "placing_trap" && placement && (
        <>
          <PlacementZones
            selectedZoneId={placement.zoneId}
            traps={challenge.traps}
            onSelect={onSelectZone}
            onMove={onMovePlacement}
          />
          {previewPosition && (
            <TrapPreview
              placement={placement}
              position={previewPosition}
              valid={validation?.valid ?? false}
            />
          )}
        </>
      )}
    </>
  );
}
