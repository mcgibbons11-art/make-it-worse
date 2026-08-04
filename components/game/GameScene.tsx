"use client";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { RapierRigidBody } from "@react-three/rapier";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  GhostTrace,
  HazardContact,
  TrapPlacementInput,
} from "@/lib/game/types";
import {
  placementSurfaces,
  surfaceSupportYAt,
  validatePlacement,
} from "@/lib/game/placement";
import { GRID_SIZE } from "@/lib/game/constants";
import { isInterfaceTarget, resetCameraYaw } from "@/lib/game/input";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import {
  CLASSIC_TRACK,
  buildTrack,
  trackFacingYaw,
  withSafeSpawn,
  type BuiltTrack,
} from "@/lib/game/track";
import { snapToGrid } from "@/lib/game/placement";
import { PlayerVisual } from "./PlayerVisual";
import { Lighting } from "./Lighting";
import { LevelGeometry } from "./LevelGeometry";
import { ExitDoor } from "./ExitDoor";
import { PlayerController } from "./PlayerController";
import { CameraRig } from "./CameraRig";
import { TrapRenderer, type TrapMechanicEvent } from "./TrapRenderer";
import { GhostRunner } from "./GhostRunner";
import { LiveGhostRunner, type LiveGhostFeed } from "./LiveGhostRunner";
import { TrapReveal, type TrapRevealSpec } from "./TrapReveal";
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
  trackOverride?: BuiltTrack;
  liveGhost?: LiveGhostFeed | null;
  bestGhostTrace?: GhostTrace | null;
  trapReveal?: TrapRevealSpec | null;
  onTrapRevealDone?(): void;
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
  trackOverride,
  liveGhost,
  bestGhostTrace,
  trapReveal,
  onTrapRevealDone,
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
    () => withSafeSpawn(trackOverride ?? buildTrack(challenge.track ?? CLASSIC_TRACK)),
    [challenge.track, trackOverride],
  );
  const spawnYaw = useMemo(() => trackFacingYaw(track), [track]);
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
    const x = (surface.minX + surface.maxX) / 2 + snapToGrid(placement.offsetX);
    const z = (surface.minZ + surface.maxZ) / 2 + snapToGrid(placement.offsetZ);
    return [
      x,
      surfaceSupportYAt(
        surface,
        x,
        z,
        TRAP_CATALOG[placement.type].placementRadius * 0.5,
      ),
      z,
    ] as const;
  }, [placement, validation, surfaces]);
  const [placementDragging, setPlacementDragging] = useState(false);
  // A fresh attempt starts on the default chase view. Without this, dying with
  // the camera swung round starts the next run looking sideways, and the first
  // input of the attempt goes somewhere the player did not ask for.
  useEffect(() => {
    resetCameraYaw(spawnYaw);
  }, [attemptSerial, spawnYaw]);
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
      {/* Outside the attemptSerial branch: a duel spectator has never started
          an attempt here (attemptSerial 0, so no CameraRig either), which is
          exactly what lets this component own the camera while it follows the
          opponent's streamed run. */}
      {liveGhost && <LiveGhostRunner {...liveGhost} />}
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
            shakeUntilRef.current = performance.now() + 300;
            // One global feel pass turns every authored hit up without
            // rewriting fifty-five individual traps. Still capped so the
            // interaction is a recoverable setback rather than an automatic
            // death. Raised from 1.18 after live play read the roster as not
            // threatening: a hit should cost real time and real control, and
            // the caps below are what keep "punishing" short of "lethal".
            const disruption = 1.45;
            stunUntilRef.current =
              performance.now() +
              Math.min(900, Math.max(380, hazard.impulseMagnitude * 24 * disruption));
            // Only the narrow ledges could ever kill: on the wide platforms a
            // hit was half a second of mushy steering and nothing else, so
            // most placements cost the runner nothing. Knocking them back
            // along -Z makes every trap cost time, which is what makes a
            // placement worth choosing. Capped so a hit is a setback rather
            // than a run ender, and only while actually playing.
            if (phase === "playing") {
              const push = Math.min(
                7.5,
                (2.4 + hazard.impulseMagnitude * 0.25) * disruption,
              );
              // Deferred one microtask, NOT applied inline: collision-driven
              // hazards arrive from inside @react-three/rapier's event drain,
              // which invokes onCollisionEnter within world.contactPair - the
              // world is borrowed for that whole call. applyImpulse there
              // re-enters wasm and panics ("recursive use of an object"), and
              // the old try/catch swallowed the panic while leaving the world
              // permanently borrow-poisoned, so every later physics call died.
              // A microtask runs after the drain unwinds, in the same tick.
              queueMicrotask(() => {
                const body = player.current;
                if (!body) return;
                try {
                  // isValid first: a wasm call on a freed body panics and
                  // borrow-poisons the world; the catch cannot undo that.
                  if (!body.isValid()) return;
                  body.applyImpulse({ x: 0, y: 1.9, z: -push }, true);
                } catch {
                  // The body can be remounting between attempts.
                }
              });
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
            visualVisible={phase !== "placing_trap" && phase !== "publishing"}
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
            editorTarget={phase === "placing_trap" || phase === "publishing" ? previewPosition : null}
            editorDragActive={placementDragging}
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
          {/* Your own fastest run outranks the sender's replay as the rabbit:
              racing yourself is the loop that brings a player back to a room. */}
          {phase === "playing" && ghostEnabled && (bestGhostTrace || challenge.ghostTrace) && (
            <GhostRunner
              trace={bestGhostTrace || challenge.ghostTrace!}
              avatarSeed={challenge.createdByAvatarSeed}
              name={bestGhostTrace ? "Your best" : challenge.createdByName}
              startedAt={startedAt}
            />
          )}
        </>
      ) : (
        <>
          <group position={track.spawn} rotation={[0, spawnYaw, 0]}>
            <PlayerVisual avatarSeed={challenge.createdByAvatarSeed} avatar={avatar} />
          </group>
          {trapReveal && onTrapRevealDone && (
            <TrapReveal spec={trapReveal} exit={track.exit} onDone={onTrapRevealDone} />
          )}
        </>
      )}
      {phase === "placing_trap" && placement && (
        <>
          <PlacementZones
            selectedZoneId={placement.zoneId}
            track={track}
            refusal={validation && !validation.valid ? validation.message : null}
            held={previewPosition}
            heldRadius={TRAP_CATALOG[placement.type].placementRadius}
            onSelect={onSelectZone}
            onMove={onMovePlacement}
            onDragActiveChange={setPlacementDragging}
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
