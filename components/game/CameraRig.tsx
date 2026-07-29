"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { RapierRigidBody } from "@react-three/rapier";
import type { Vec3Tuple } from "@/lib/game/types";
import { getCameraYaw, setCameraYaw } from "@/lib/game/input";
import { useSettingsStore } from "@/stores/settings-store";

/** The whole course, so placing a trap can be done looking at all of it. */
export interface EditorFraming {
  centerX: number;
  centerZ: number;
  groundY: number;
  spanX: number;
  spanZ: number;
}

/** How far the aerial camera leans off vertical. 0 is straight down. */
const AERIAL_TILT = 0.42;
/** Slack around the course so its edges are not flush with the screen edge. */
const AERIAL_MARGIN = 1.22;
/** Never drop below this, or a tiny custom track puts the camera in the floor. */
const AERIAL_MIN_HEIGHT = 12;

/** Radians of yaw per pixel dragged. A full turn is roughly a screen width. */
const LOOK_SENSITIVITY = 0.006;
/**
 * How far round the runner the view may be swung, each way.
 *
 * Deliberately not a full circle. The course runs along +Z and every trap
 * telegraph is drawn flat on the deck, so a camera swung behind the runner
 * looks back down the course at markings the player has already passed, and
 * the exit leaves the screen. A bit over a quarter turn each way is enough to
 * see round a corner or check what is beside you without ever losing the thing
 * you are running at.
 */
const LOOK_LIMIT = Math.PI * 0.55;

export function CameraRig({
  player,
  editorTarget,
  editorFraming = null,
  lookEnabled = false,
  shakeUntilRef,
}: {
  player: React.RefObject<RapierRigidBody | null>;
  editorTarget: Vec3Tuple | null;
  editorFraming?: EditorFraming | null;
  /** Whether a left-drag turns the view. Off while a trap is being placed. */
  lookEnabled?: boolean;
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
      if (event.button !== 0) return;
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
      setCameraYaw(Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, next)));
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
  }, [lookEnabled, gl]);

  useFrame(({ camera }, delta) => {
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

      if (editorFraming) {
        // Placing a trap is a map-reading job, not a driving one, so the camera
        // leaves the runner's shoulder and goes up until the whole course is on
        // screen. Solved against the live projection rather than a guessed
        // altitude: fit the depth through the vertical field of view and the
        // width through the horizontal one, then take whichever needs more air.
        const fovY = ((camera as { fov?: number }).fov ?? 52) * (Math.PI / 180);
        const aspect = (camera as { aspect?: number }).aspect ?? 16 / 9;
        const halfY = Math.tan(fovY / 2);
        const forDepth = editorFraming.spanZ / 2 / halfY;
        const forWidth = editorFraming.spanX / 2 / (halfY * aspect);
        const height = Math.max(AERIAL_MIN_HEIGHT, Math.max(forDepth, forWidth) * AERIAL_MARGIN);
        target.current.set(editorFraming.centerX, editorFraming.groundY, editorFraming.centerZ);
        desired.current.set(
          editorFraming.centerX,
          editorFraming.groundY + height,
          // Leaning back along -Z keeps the runner's own forward direction
          // pointing up the screen, so a drag reads the same way the run does.
          editorFraming.centerZ - height * AERIAL_TILT,
        );
        smoothed.current.lerp(desired.current, 1 - Math.exp(-5 * delta));
        camera.position.copy(smoothed.current);
        look.current.lerp(target.current, 1 - Math.exp(-6 * delta));
        camera.lookAt(look.current);
        return;
      }

      target.current.set(editorTarget[0], editorTarget[1], editorTarget[2]);
      desired.current.set(editorTarget[0] + 5.8, editorTarget[1] + 7.2, editorTarget[2] - 6.4);
      smoothed.current.lerp(desired.current, 1 - Math.exp(-6 * delta));
      camera.position.copy(smoothed.current);
      look.current.lerp(target.current, 1 - Math.exp(-7 * delta));
      camera.lookAt(look.current);
      return;
    }

    const body = player.current;
    if (!body) return;
    try {
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
        position.x - 7.4 * sinYaw + lead * cosYaw,
        Math.max(4.3, position.y + 4.2),
        position.z - 7.4 * cosYaw - lead * sinYaw,
      );
      smoothed.current.lerp(desired.current, 1 - Math.exp(-8 * delta));
      camera.position.copy(smoothed.current);
      target.current.set(
        position.x + velocity.x * 0.08 + 4.1 * sinYaw,
        position.y + 0.9,
        position.z + 4.1 * cosYaw,
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
