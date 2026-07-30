"use client";
import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import type { RapierRigidBody } from "@react-three/rapier";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  HazardContact,
  TrapPlacementInput,
} from "@/lib/game/types";
import { placementSurfaces, validatePlacement } from "@/lib/game/placement";
import { GRID_SIZE } from "@/lib/game/constants";
import { isInterfaceTarget, resetCameraYaw } from "@/lib/game/input";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { CLASSIC_TRACK, buildTrack } from "@/lib/game/track";
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
import { EffectsLayer, type EffectsHandle } from "./effects/EffectsLayer";
import { useSettingsStore } from "@/stores/settings-store";
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
  // The runner you drive is yours, so it wears what you chose. The ghost below
  // deliberately keeps `createdByAvatarSeed`: that figure is the sender, and
  // dressing it in the viewer's outfit would make the two runners identical at
  // exactly the moment the point is telling them apart. Null until the player
  // picks, which is what makes resolveAvatar fall back to the seeded look.
  const avatar = useSettingsStore((state) => state.avatar);
  const soapUntilRef = useRef(0);
  const stunUntilRef = useRef(0);
  const shakeUntilRef = useRef(0);
  const grabbables = useRef(new Map<string, RapierRigidBody>());
  const internalTrapBodies = useRef(new Map<string, RapierRigidBody>());
  const trapBodies = qaTrapBodiesRef ?? internalTrapBodies;
  const effects = useRef<EffectsHandle>(null);
  const track = useMemo(
    () => buildTrack(challenge.track ?? CLASSIC_TRACK),
    [challenge.track],
  );
  const validation = useMemo(
    () =>
      placement ? validatePlacement(placement, challenge.traps, track) : null,
    [placement, challenge.traps, track],
  );
  // Where to draw the trap while it is being dragged, including while the spot
  // under the cursor is refused - a refused preview still has to be VISIBLE, or
  // the player cannot see what they are being told about.
  //
  // This resolved the dragged id against `track.zones` alone. Free placement
  // made every level PIECE a placement surface too, so most ids a drag can now
  // produce are not zones at all, and on those this returned null. That is not
  // a cosmetic miss: null unmounts TrapPreview AND hands CameraRig
  // `editorTarget={null}`, so the camera leaves the course, taking with it the
  // ground the player would have dragged back onto. The drag could not recover.
  // Sweeping a trap around momentarily refuses constantly, so this fired all the
  // time - it is the jank the whole placement rewrite was meant to remove,
  // reintroduced one layer up.
  //
  // placementSurfaces() is the same resolved set validatePlacement uses, so the
  // preview and the verdict can no longer disagree about where a surface is.
  const surfaces = useMemo(() => placementSurfaces(track), [track]);
  const previewPosition = useMemo(() => {
    if (!placement) return null;
    if (validation?.valid) return validation.canonicalPosition;
    const surface = surfaces.find((entry) => entry.id === placement.zoneId);
    if (!surface) return null;
    return [
      (surface.minX + surface.maxX) / 2 + snapToGrid(placement.offsetX),
      surface.groundY,
      (surface.minZ + surface.maxZ) / 2 + snapToGrid(placement.offsetZ),
    ] as const;
  }, [placement, validation, surfaces]);
  // A fresh attempt starts on the default chase view. Without this, dying with
  // the camera swung round starts the next run looking sideways, and the first
  // input of the attempt goes somewhere the player did not ask for.
  useEffect(() => {
    resetCameraYaw();
  }, [attemptSerial]);
  // Nudging a held trap with the keys, because a mouse is bad at 0.25u.
  //
  // The intent is carried UNCLAMPED between presses. placementFromWorld pins a
  // point to the surface it lands on, so nudging straight from the preview
  // would re-read the pinned point every press and the trap could never walk
  // off a platform: the first press past the lip clamps back to the lip, and so
  // does the tenth. Accumulating the intended point instead lets a run of
  // presses carry the trap over a gap, snapping onto the far deck once the
  // intent is nearer to it - the same rule the mouse gets, just delivered a
  // quarter unit at a time. Any press of the pointer drops the intent, so a
  // drag always starts from where the trap actually is.
  const nudgeIntent = useRef<readonly [number, number] | null>(null);
  useEffect(() => {
    if (phase !== "placing_trap" || !placement || !previewPosition) return;
    const dropIntent = () => {
      nudgeIntent.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInterfaceTarget(event.target)) return;
      let dx = 0;
      let dz = 0;
      // Screen-right is world -X and forward is +Z, the same mapping
      // PlayerController drives, so the keys mean on the map what they mean
      // during the run.
      switch (event.key) {
        case "w": case "W": case "ArrowUp": dz = GRID_SIZE; break;
        case "s": case "S": case "ArrowDown": dz = -GRID_SIZE; break;
        case "a": case "A": case "ArrowLeft": dx = GRID_SIZE; break;
        case "d": case "D": case "ArrowRight": dx = -GRID_SIZE; break;
        default: return;
      }
      event.preventDefault();
      const base = nudgeIntent.current ?? [previewPosition[0], previewPosition[2]];
      const next = [base[0] + dx, base[1] + dz] as const;
      nudgeIntent.current = next;
      onMovePlacement(placement.zoneId, next[0], next[1]);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", dropIntent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", dropIntent);
    };
  }, [phase, placement, previewPosition, onMovePlacement]);
  return (
    <>
      <Lighting />
      <LevelGeometry pieces={track.pieces} />
      <ExitDoor showLabel={phase === "playing"} position={track.exit} />
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
            // Decorative only, and first so the burst lands on the frame the
            // hit registers rather than after the knockback has moved the
            // runner. It carries the same impulse the stun and knockback use,
            // so what the player sees and what they feel come from one number.
            effects.current?.impact(hazard.impulseMagnitude);
            shakeUntilRef.current = performance.now() + 220;
            stunUntilRef.current =
              performance.now() +
              Math.min(500, Math.max(250, hazard.impulseMagnitude * 22));
            // Only the narrow ledges could ever kill: on the wide platforms a
            // hit was half a second of mushy steering and nothing else, so
            // most placements cost the runner nothing. Knocking them back
            // along -Z makes every trap cost time, which is what makes a
            // placement worth choosing. Capped so a hit is a setback rather
            // than a run ender, and only while actually playing.
            const body = player.current;
            if (body && phase === "playing") {
              const push = Math.min(5.5, 1.8 + hazard.impulseMagnitude * 0.22);
              try {
                body.applyImpulse({ x: 0, y: 1.1, z: -push }, true);
              } catch {
                // The body can be remounting between attempts.
              }
            }
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
            track={track}
            visualVisible={phase !== "placing_trap"}
            pose={phase === "finished" ? "victory" : phase === "failed" ? "failure" : phase === "playing" ? "playing" : "idle"}
            avatarSeed={challenge.createdByAvatarSeed}
            avatar={avatar}
            startedAt={startedAt}
            soapUntilRef={soapUntilRef}
            stunUntilRef={stunUntilRef}
            grabbables={grabbables}
            recordSample={recordSample}
            onProgress={onProgress}
            onInteraction={onInteraction}
            onFinish={() => {
              effects.current?.celebrate();
              onFinish();
            }}
            onFail={onFail}
          />
          <CameraRig
            player={player}
            editorTarget={phase === "placing_trap" ? previewPosition : null}
            lookEnabled={phase === "playing"}
            shakeUntilRef={shakeUntilRef}
          />
          {/* After the rig so the billboarded shockwaves use this frame's
              camera orientation rather than the previous frame's. */}
          <EffectsLayer
            ref={effects}
            player={player}
            traps={challenge.traps}
            trapBodies={trapBodies}
            startedAt={startedAt}
            attemptSerial={attemptSerial}
            active={phase === "playing"}
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
          <PlayerVisual avatarSeed={challenge.createdByAvatarSeed} avatar={avatar} />
        </group>
      )}
      {phase === "placing_trap" && placement && (
        <>
          <PlacementZones
            selectedZoneId={placement.zoneId}
            traps={challenge.traps}
            track={track}
            refusal={validation && !validation.valid ? validation.message : null}
            held={previewPosition}
            heldRadius={TRAP_CATALOG[placement.type].placementRadius}
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
