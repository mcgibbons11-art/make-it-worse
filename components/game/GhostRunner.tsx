"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { decodeGhostTrace, interpolateGhost } from "@/lib/game/replay-codec";
import type { GhostTrace } from "@/lib/game/types";
import { PlayerVisual } from "./PlayerVisual";

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
  useFrame(() => {
    const exactIndex = Math.max(0, ((performance.now() - startedAt) / 1000) * trace.hz);
    const index = Math.min(samples.length - 1, Math.floor(exactIndex));
    const nextIndex = Math.min(samples.length - 1, index + 1);
    const a = samples[index];
    const b = samples[nextIndex];
    if (!a || !b || !group.current) return;
    const sample = interpolateGhost(a, b, exactIndex - Math.floor(exactIndex));
    group.current.position.set(sample.x, sample.y, sample.z);
    group.current.rotation.y = sample.yaw;
    const finished = exactIndex >= samples.length - 1;
    group.current.visible = !finished;
    if (label.current) label.current.style.display = finished ? "none" : "";
  });
  return (
    <group ref={group}>
      <PlayerVisual avatarSeed={avatarSeed} ghost />
      <Html position={[0, 1.7, 0]} center distanceFactor={12}>
        <span ref={label} className="ghost-label">{name}&apos;s prior run</span>
      </Html>
    </group>
  );
}
