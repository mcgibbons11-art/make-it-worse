"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import type { RapierRigidBody } from "@react-three/rapier";
import type { Vec3Tuple } from "@/lib/game/types";
import { useSettingsStore } from "@/stores/settings-store";

export function CameraRig({
  player,
  editorTarget,
  shakeUntilRef,
}: {
  player: React.RefObject<RapierRigidBody | null>;
  editorTarget: Vec3Tuple | null;
  shakeUntilRef: React.MutableRefObject<number>;
}) {
  const look = useRef(new Vector3(0, 1, 4));
  const desired = useRef(new Vector3());
  const target = useRef(new Vector3());
  const settings = useSettingsStore();

  useFrame(({ camera }, delta) => {
    if (editorTarget) {
      target.current.set(editorTarget[0], editorTarget[1], editorTarget[2]);
      desired.current.set(editorTarget[0] + 5.8, editorTarget[1] + 7.2, editorTarget[2] - 6.4);
      camera.position.lerp(desired.current, 1 - Math.exp(-6 * delta));
      look.current.lerp(target.current, 1 - Math.exp(-7 * delta));
      camera.lookAt(look.current);
      return;
    }

    const body = player.current;
    if (!body) return;
    try {
      const position = body.translation();
      const velocity = body.linvel();
      desired.current.set(
        position.x - Math.max(-1.3, Math.min(1.3, velocity.x * 0.12)),
        Math.max(4.3, position.y + 4.2),
        position.z - 7.4,
      );
      camera.position.lerp(desired.current, 1 - Math.exp(-8 * delta));
      target.current.set(position.x + velocity.x * 0.08, position.y + 0.9, position.z + 4.1);
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
