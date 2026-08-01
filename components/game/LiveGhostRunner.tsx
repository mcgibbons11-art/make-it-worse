"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type Group } from "three";
import { getCameraYaw, setCameraYaw } from "@/lib/game/input";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { DecodedGhostSample } from "@/lib/game/types";
import { PlayerVisual, type PlayerMotionState } from "./PlayerVisual";

/** Same feel as CameraRig's look drag; the two must not drift apart. */
const LOOK_SENSITIVITY = 0.006;
const SPECTATE_DISTANCE = 5.2;
const SPECTATE_HEIGHT = 3.1;

export interface LiveGhostFeed {
  /** Latest network sample; the transport overwrites it, this component reads it. */
  sampleRef: { current: DecodedGhostSample | null };
  avatarSeed: number;
  avatar: AvatarConfig | null;
  name: string;
  /** Spectator mode: this component drives the camera to follow the runner. */
  followCamera: boolean;
}

/**
 * An opponent rendered live from streamed position samples, for duel
 * spectating. GhostRunner replays a complete recorded trace against the local
 * clock; this instead chases a mutable ref the duel transport keeps fresh, so
 * network jitter is absorbed by easing toward the newest sample rather than
 * by indexing into a timeline that does not exist yet.
 */
export function LiveGhostRunner({ sampleRef, avatarSeed, avatar, name, followCamera }: LiveGhostFeed) {
  const group = useRef<Group>(null);
  const label = useRef<HTMLSpanElement>(null);
  const gl = useThree((state) => state.gl);
  // The same hold-and-drag look CameraRig gives the runner, writing into the
  // same shared yaw. A spectator has no CameraRig (attemptSerial is 0), so
  // without this the view was welded behind the opponent with no way to look
  // around the course they are about to inherit.
  useEffect(() => {
    if (!followCamera) return;
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
      const next = getCameraYaw() - dx * LOOK_SENSITIVITY;
      setCameraYaw(Math.atan2(Math.sin(next), Math.cos(next)));
    };
    const up = () => {
      dragging = false;
    };
    // Down on the canvas only, so the duel HUD keeps its clicks; move and up
    // on the window, so a drag that leaves the canvas neither sticks nor snaps.
    element.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [followCamera, gl]);
  const motion = useRef<PlayerMotionState>({
    speed: 0,
    verticalVelocity: 0,
    grounded: true,
    yaw: 0,
    stunned: false,
  });
  const settled = useRef(false);
  const cameraGoal = useRef(new Vector3());
  const lookGoal = useRef(new Vector3());
  useFrame(({ camera }, delta) => {
    const sample = sampleRef.current;
    const target = group.current;
    if (!target) return;
    target.visible = sample !== null;
    if (label.current) label.current.style.display = sample === null ? "none" : "";
    if (!sample) return;
    const dt = Math.min(Math.max(delta, 1 / 240), 0.25);
    if (!settled.current) {
      // First sample: snap, so the runner does not glide in from the origin.
      target.position.set(sample.x, sample.y, sample.z);
      settled.current = true;
    }
    const previous = target.position.clone();
    // Samples arrive at roughly 7-8Hz; a fixed exponential ease toward the
    // newest one reads as continuous motion at 60fps without extrapolating
    // into positions the runner never reported.
    const ease = 1 - Math.exp(-dt * 10);
    target.position.x += (sample.x - target.position.x) * ease;
    target.position.y += (sample.y - target.position.y) * ease;
    target.position.z += (sample.z - target.position.z) * ease;
    target.rotation.y = sample.yaw;
    motion.current = {
      speed: Math.hypot(target.position.x - previous.x, target.position.z - previous.z) / dt,
      verticalVelocity: (target.position.y - previous.y) / dt,
      grounded: (sample.flags & 1) === 1,
      // Zero for the same reason GhostRunner's is: the group already carries
      // sample.yaw, and PlayerVisual eases its own child toward motion.yaw.
      yaw: 0,
      stunned: false,
    };
    if (followCamera) {
      // The chase framing CameraRig would give the runner, orbited by the
      // shared look yaw so a held left-drag swings the view a full 360
      // around the opponent - the same gesture the runner has.
      const yaw = getCameraYaw();
      cameraGoal.current.set(
        target.position.x - Math.sin(yaw) * SPECTATE_DISTANCE,
        target.position.y + SPECTATE_HEIGHT,
        target.position.z - Math.cos(yaw) * SPECTATE_DISTANCE,
      );
      camera.position.lerp(cameraGoal.current, 1 - Math.exp(-dt * 4));
      lookGoal.current.lerp(
        new Vector3(target.position.x, target.position.y + 0.9, target.position.z),
        1 - Math.exp(-dt * 8),
      );
      camera.lookAt(lookGoal.current);
    }
  });
  return (
    <group ref={group} visible={false}>
      <PlayerVisual avatarSeed={avatarSeed} avatar={avatar} ghost motion={motion} />
      <Html position={[0, 1.7, 0]} center distanceFactor={12}>
        <span ref={label} className="ghost-label">{name}</span>
      </Html>
    </group>
  );
}
