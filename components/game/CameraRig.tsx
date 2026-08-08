"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { useRapier, type RapierRigidBody } from "@react-three/rapier";
import type { Vec3Tuple } from "@/lib/game/types";
import { getCameraYaw, setCameraYaw } from "@/lib/game/input";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Close three-quarter view used while carrying a trap.
 *
 * Keeping this relative to `editorTarget` is the important part: the camera
 * travels with a mouse drag or keyboard nudge instead of leaving the trap to
 * shrink into a course-wide overhead map.
 */
export const PLACEMENT_CAMERA_OFFSET = [4.2, 5.8, -4.8] as const;

/** Radians of yaw per pixel dragged. A full turn is roughly a screen width. */
const LOOK_SENSITIVITY = 0.006;
const CAMERA_WALL_PADDING = 0.28;
const CAMERA_MIN_DISTANCE = 1.15;

export function CameraRig({
  player,
  editorTarget,
  editorDragActive = false,
  lookEnabled = false,
  lookButton = 0,
  chaseDistance = 7.4,
  chaseHeight = 4.3,
  chaseLookAhead = 4.1,
  chaseTargetHeight = 0.9,
  shakeUntilRef,
  yieldCamera = false,
}: {
  player: React.RefObject<RapierRigidBody | null>;
  editorTarget: Vec3Tuple | null;
  /** Hold the exact placement view while a left-button trap drag is active. */
  editorDragActive?: boolean;
  /** Whether a left-drag turns the view. Off while a trap is being placed. */
  lookEnabled?: boolean;
  /** Pointer button used to turn: left normally, right while an editor owns left-drag. */
  lookButton?: 0 | 2;
  /** Stop driving the camera at all, so something else can own it. */
  yieldCamera?: boolean;
  /** Optional framing overrides for larger free-roam spaces. */
  chaseDistance?: number;
  chaseHeight?: number;
  chaseLookAhead?: number;
  chaseTargetHeight?: number;
  shakeUntilRef: React.MutableRefObject<number>;
}) {
  const look = useRef(new Vector3(0, 1, 4));
  const desired = useRef(new Vector3());
  const target = useRef(new Vector3());
  // Shake has to stay out of the smoothed position. Writing the jitter into
  // camera.position fed it back through the next frame's lerp, which turns the
  // rig into an AR(1) filter: with the 8/60 smoothing constant the noise
  // settles at 1/(1 - 0.875^2) = 4.3x the input variance, so a nominal +/-0.08u
  // shake actually stood at +/-0.17u. Smoothing the clean target here and
  // adding the offset only to the final camera position keeps the amplitude
  // the one that was asked for.
  const smoothed = useRef(new Vector3());
  const seeded = useRef(false);
  const settings = useSettingsStore();
  const gl = useThree((state) => state.gl);
  const { world, rapier } = useRapier();
  const rayOrigin = useRef(new Vector3());
  const rayDirection = useRef(new Vector3());
  const collisionAdjusted = useRef(new Vector3());

  // Hold the left button and sweep to look around. The yaw lands in the input
  // singleton rather than local state because turning the view is only half the
  // feature: PlayerController reads the same number to rotate WASD, so
  // "forward" keeps meaning "away from the camera" after the view has swung.
  // Turning the camera without turning the controls mirrors the steering,
  // which is worse than no camera control at all.
  useEffect(() => {
    if (!lookEnabled) return;
    const element = gl.domElement;
    let dragging = false;
    let lastX = 0;
    const down = (event: PointerEvent) => {
      if (event.button !== lookButton) return;
      dragging = true;
      lastX = event.clientX;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      // Dragging right looks right. Yaw grows toward +X, which is screen-left,
      // so a rightward drag has to shrink it.
      const next = getCameraYaw() - dx * LOOK_SENSITIVITY;
      // Wrap instead of clamp: held dragging can orbit through any number of
      // complete turns without hitting an invisible stop at either side.
      setCameraYaw(Math.atan2(Math.sin(next), Math.cos(next)));
    };
    const up = () => {
      dragging = false;
    };
    // Down on the canvas only, so HUD buttons keep their clicks; move and up on
    // the window, so a drag that leaves the canvas neither sticks nor snaps.
    element.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [lookButton, lookEnabled, gl]);

  useFrame(({ camera }, delta) => {
    // Hand the camera over entirely. A duel spectator still has this rig
    // mounted from their own earlier attempt, and both it and the live ghost
    // writing camera.position every frame means whichever ran last wins -
    // which left a dead player staring at their own body.
    if (yieldCamera) {
      seeded.current = false;
      return;
    }
    if (!seeded.current) {
      smoothed.current.copy(camera.position);
      seeded.current = true;
    }
    if (editorTarget) {
      // A non-finite target used to be fatal rather than ugly. `lerp` against a
      // NaN vector makes the smoothed vector NaN, and NaN never lerps back, so
      // a single bad frame threw the camera off the map permanently. The frame
      // is skipped instead: the camera simply holds still, which is recoverable.
      if (!editorTarget.every(Number.isFinite)) return;

      // Following the preview while the pointer was still held changed the
      // world point underneath the same screen pixel. Once the camera caught
      // an edge, moving the mouse back to screen centre still meant "that
      // edge", so the trap felt magnetized there. Freeze the actual view for
      // the duration of the drag; on release the ordinary close follow catches
      // up immediately to the new placement.
      if (editorDragActive) return;

      target.current.set(editorTarget[0], editorTarget[1], editorTarget[2]);
      desired.current.set(
        editorTarget[0] + PLACEMENT_CAMERA_OFFSET[0],
        editorTarget[1] + PLACEMENT_CAMERA_OFFSET[1],
        editorTarget[2] + PLACEMENT_CAMERA_OFFSET[2],
      );
      smoothed.current.lerp(desired.current, 1 - Math.exp(-8 * delta));
      camera.position.copy(smoothed.current);
      look.current.lerp(target.current, 1 - Math.exp(-10 * delta));
      camera.lookAt(look.current);
      return;
    }

    const body = player.current;
    if (!body) return;
    try {
      // isValid first: translation() on a freed body panics inside wasm and
      // leaks a borrow that poisons the world - the catch below cannot undo
      // that, it only hides it.
      if (!body.isValid()) return;
      const position = body.translation();
      const velocity = body.linvel();
      // The rig's frame, swung about the runner by the held-drag yaw. At yaw 0
      // forward is +Z and camera-right is world -X (the mirror the controls
      // already correct for), and these reduce to the original constants.
      const yaw = getCameraYaw();
      const sinYaw = Math.sin(yaw);
      const cosYaw = Math.cos(yaw);
      // The lateral lead follows the camera's right axis rather than world X,
      // so the look-ahead keeps working sideways after the view has turned.
      const lateral = -velocity.x * cosYaw + velocity.z * sinYaw;
      const lead = Math.max(-1.3, Math.min(1.3, lateral * 0.12));
      desired.current.set(
        position.x - chaseDistance * sinYaw + lead * cosYaw,
        Math.max(chaseHeight, position.y + chaseHeight - 0.1),
        position.z - chaseDistance * cosYaw - lead * sinYaw,
      );
      // Keep the camera on the runner's side of walls and tall platforms. The
      // query uses fixed solids only: moving traps must not punch the camera in
      // and the player capsule must never collide with its own view ray.
      rayOrigin.current.set(position.x, position.y + chaseTargetHeight, position.z);
      rayDirection.current.copy(desired.current).sub(rayOrigin.current);
      const desiredDistance = rayDirection.current.length();
      let obstructionDistance = desiredDistance;
      if (desiredDistance > CAMERA_MIN_DISTANCE) {
        rayDirection.current.multiplyScalar(1 / desiredDistance);
        const ray = new rapier.Ray(
          rayOrigin.current,
          rayDirection.current,
        );
        const flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS
          | rapier.QueryFilterFlags.EXCLUDE_DYNAMIC
          | rapier.QueryFilterFlags.EXCLUDE_KINEMATIC;
        const hit = world.castRay(ray, desiredDistance, true, flags);
        if (hit) obstructionDistance = Math.max(
          CAMERA_MIN_DISTANCE,
          hit.timeOfImpact - CAMERA_WALL_PADDING,
        );
      }
      if (obstructionDistance < desiredDistance) {
        collisionAdjusted.current.copy(rayOrigin.current).addScaledVector(
          rayDirection.current,
          obstructionDistance,
        );
        // Obstructions close immediately so no frame renders from inside a
        // wall. Returning to the full chase distance stays softly damped.
        if (smoothed.current.distanceTo(rayOrigin.current) > obstructionDistance)
          smoothed.current.copy(collisionAdjusted.current);
        else
          smoothed.current.lerp(collisionAdjusted.current, 1 - Math.exp(-14 * delta));
      } else {
        smoothed.current.lerp(desired.current, 1 - Math.exp(-8 * delta));
      }
      camera.position.copy(smoothed.current);
      target.current.set(
        position.x + velocity.x * 0.08 + chaseLookAhead * sinYaw,
        position.y + chaseTargetHeight,
        position.z + chaseLookAhead * cosYaw,
      );
      look.current.lerp(target.current, 1 - Math.exp(-10 * delta));
      if (settings.cameraShake && !settings.reducedMotion && performance.now() < shakeUntilRef.current) {
        const strength = (shakeUntilRef.current - performance.now()) / 220;
        camera.position.x += (Math.random() - 0.5) * 0.16 * strength;
        camera.position.y += (Math.random() - 0.5) * 0.11 * strength;
      }
      camera.lookAt(look.current);
    } catch {
      // The body can disappear during a route teardown; the next render drops
      // this rig, so there is no state to repair here.
      return;
    }
  });

  return null;
}
