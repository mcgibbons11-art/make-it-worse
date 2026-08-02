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
/** Bounds on the observed inter-sample gap, absorbing network jitter. */
const MIN_SAMPLE_GAP_MS = 50;
const MAX_SAMPLE_GAP_MS = 400;

interface TimedSample {
  sample: DecodedGhostSample;
  at: number;
}

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
  const older = useRef<TimedSample | null>(null);
  const newest = useRef<TimedSample | null>(null);
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
    const now = performance.now();
    if (newest.current?.sample !== sample) {
      older.current = newest.current;
      newest.current = { sample, at: now };
    }
    const head = newest.current!;
    const tail = older.current;
    // Interpolate between the last two REAL samples on their actual timing,
    // the same idea the replay ghost uses. The first version eased toward the
    // newest sample instead, and at ~7.5 samples a second the model glided
    // between reports with almost no leg animation - the runner looked like
    // it was ice-skating around the course, then slid on after stopping.
    // Rendering one interval behind trades ~130ms of latency for motion that
    // only ever visits positions the runner actually reported, and a
    // sample-to-sample speed that drives an honest gait.
    if (!tail) {
      target.position.set(head.sample.x, head.sample.y, head.sample.z);
      target.rotation.y = head.sample.yaw;
      motion.current = {
        speed: 0,
        verticalVelocity: 0,
        grounded: (head.sample.flags & 1) === 1,
        yaw: 0,
        stunned: false,
      };
    } else {
      const gapMs = Math.min(
        MAX_SAMPLE_GAP_MS,
        Math.max(MIN_SAMPLE_GAP_MS, head.at - tail.at),
      );
      const t = Math.min(1, (now - head.at) / gapMs);
      const a = tail.sample;
      const b = head.sample;
      target.position.set(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      );
      // Shortest-arc yaw blend so a turn through the wrap does not spin the
      // model the long way round.
      const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
      target.rotation.y = a.yaw + turn * t;
      const gapSeconds = gapMs / 1000;
      motion.current = {
        // True reported velocity, held steady across the whole interval, so
        // the legs run at the speed the runner actually moved. Zero once the
        // interval is spent and no fresh sample arrived: a stopped runner
        // stands still instead of jogging in place.
        speed: t < 1 ? Math.hypot(b.x - a.x, b.z - a.z) / gapSeconds : 0,
        verticalVelocity: t < 1 ? (b.y - a.y) / gapSeconds : 0,
        grounded: (b.flags & 1) === 1,
        // Zero for the same reason GhostRunner's is: the group already
        // carries the yaw, and PlayerVisual eases its own child toward
        // motion.yaw, so feeding it again would spin the model twice.
        yaw: 0,
        stunned: false,
      };
    }
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
