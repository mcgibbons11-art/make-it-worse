"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { TrapInstance } from "@/lib/game/types";

/** The whole sweep, arrival included; the tail is the hold on the trap. */
const REVEAL_MS = 3000;
/** Share of the sweep spent travelling; the rest is the dramatic hold. */
const TRAVEL_SHARE = 0.55;

export interface TrapRevealSpec {
  trap: TrapInstance;
  ownerName: string;
}

/**
 * The fly-through a friend's worsened map deserves: the camera starts high
 * over the exit, dives down the course to the trap they added, and holds on
 * it under their name tag before the run begins. Mounted only before the
 * first attempt, which is the only window where no CameraRig owns the camera.
 */
export function TrapReveal({
  spec,
  exit,
  onDone,
}: {
  spec: TrapRevealSpec;
  exit: readonly [number, number, number];
  onDone(): void;
}) {
  const camera = useThree((state) => state.camera);
  const startedAt = useRef<number | null>(null);
  const finished = useRef(false);
  const [tx, ty, tz] = spec.trap.position;
  useFrame(() => {
    startedAt.current ??= performance.now();
    const progress = (performance.now() - startedAt.current) / REVEAL_MS;
    if (progress >= 1) {
      if (!finished.current) {
        finished.current = true;
        onDone();
      }
      return;
    }
    const travel = Math.min(1, progress / TRAVEL_SHARE);
    // Cosine ease-in-out: the camera leaves the vantage gently and settles
    // onto the trap instead of striking it.
    const eased = (1 - Math.cos(travel * Math.PI)) / 2;
    const fromX = exit[0];
    const fromY = exit[1] + 8;
    const fromZ = exit[2] + 7;
    const toX = tx + 2.4;
    const toY = ty + 2.7;
    const toZ = tz - 3.6;
    camera.position.set(
      fromX + (toX - fromX) * eased,
      fromY + (toY - fromY) * eased,
      fromZ + (toZ - fromZ) * eased,
    );
    camera.lookAt(tx, ty + 0.6, tz);
  });
  return (
    <group position={[tx, ty, tz]}>
      <Html position={[0, 1.7, 0]} center distanceFactor={12} zIndexRange={[5, 0]}>
        <span className="ghost-label reveal-label">
          {spec.ownerName} added the {TRAP_CATALOG[spec.trap.type].displayName}
        </span>
      </Html>
    </group>
  );
}
