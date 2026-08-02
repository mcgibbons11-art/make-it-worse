"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { decodeGhostTrace, interpolateGhost } from "@/lib/game/replay-codec";
import type { GhostTrace } from "@/lib/game/types";
import { PlayerVisual, type PlayerMotionState } from "./PlayerVisual";

export function GhostRunner({
  trace,
  avatarSeed,
  name,
  startedAt,
}: {
  trace: GhostTrace;
  avatarSeed: number;
  name: string;
  startedAt: number;
}) {
  const group = useRef<Group>(null);
  const samples = useMemo(() => decodeGhostTrace(trace), [trace]);
  const label = useRef<HTMLSpanElement>(null);
  // decodeGhostTrace only carries position, yaw and two flag bits (grounded,
  // jump-held) per 15Hz sample - no recorded velocity. Speed and vertical
  // velocity below are derived honestly from the change in the interpolated
  // world position between rendered frames, not read from the trace. yaw is
  // deliberately left at 0: this group's rotation.y already snaps straight to
  // sample.yaw a few lines down, and PlayerVisual's own internal group eases
  // its rotation.y toward motion.yaw, so feeding it sample.yaw too would spin
  // the model twice. "stunned" has no equivalent in the trace at all (traps
  // never hit the ghost), so it stays false rather than guessing.
  const motion = useRef<PlayerMotionState>({ speed: 0, verticalVelocity: 0, grounded: true, yaw: 0, stunned: false });
  const prevPosition = useRef<{ x: number; y: number; z: number } | null>(null);
  useFrame((_, delta) => {
    const exactIndex = Math.max(0, ((performance.now() - startedAt) / 1000) * trace.hz);
    const index = Math.min(samples.length - 1, Math.floor(exactIndex));
    const nextIndex = Math.min(samples.length - 1, index + 1);
    const a = samples[index];
    const b = samples[nextIndex];
    if (!a || !b || !group.current) return;
    const sample = interpolateGhost(a, b, exactIndex - Math.floor(exactIndex));
    const dt = Math.min(Math.max(delta, 1 / 240), 0.25);
    const prev = prevPosition.current;
    if (prev) {
      motion.current = {
        speed: Math.hypot(sample.x - prev.x, sample.z - prev.z) / dt,
        verticalVelocity: (sample.y - prev.y) / dt,
        grounded: (sample.flags & 1) === 1,
        yaw: 0,
        stunned: false,
      };
    }
    prevPosition.current = { x: sample.x, y: sample.y, z: sample.z };
    group.current.position.set(sample.x, sample.y, sample.z);
    group.current.rotation.y = sample.yaw;
    const finished = exactIndex >= samples.length - 1;
    group.current.visible = !finished;
    if (label.current) label.current.style.display = finished ? "none" : "";
  });
  return (
    <group ref={group}>
      <PlayerVisual avatarSeed={avatarSeed} ghost motion={motion} />
      {/* Bounded so the tag can never stack above result cards and dialogs;
          drei's default z-index is ~16 million. */}
      <Html position={[0, 1.7, 0]} center distanceFactor={12} zIndexRange={[5, 0]}>
        <span ref={label} className="ghost-label">{name}&apos;s ghost</span>
      </Html>
    </group>
  );
}
