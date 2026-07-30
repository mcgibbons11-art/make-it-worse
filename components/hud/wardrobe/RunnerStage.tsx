"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { dressRunner } from "@/components/game/PlayerVisual";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import type { AvatarConfig } from "@/lib/game/avatar";

function PreviewRunner({
  avatar,
  avatarSeed,
  pivot,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  pivot: MutableRefObject<THREE.Group | null>;
}) {
  const runner = useMemo(() => dressRunner(avatar, avatarSeed), [avatar, avatarSeed]);
  const camera = useThree((state) => state.camera as THREE.PerspectiveCamera);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    const bounds = new THREE.Box3().setFromObject(runner);
    if (bounds.isEmpty()) return;
    const dimensions = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.2, camera.aspect));
    const distance = Math.max(
      dimensions.y / (2 * Math.tan(verticalFov / 2)),
      dimensions.x / (2 * Math.tan(horizontalFov / 2)),
    ) * 1.06 + dimensions.z / 2;
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [camera, runner, size.height, size.width]);

  return (
    <group ref={pivot} rotation={[0, 0.5, 0]}>
      <primitive object={runner} />
    </group>
  );
}

/** The real dressed runner, rendered through the same Canvas path as the game. */
export function RunnerStage({
  avatar,
  avatarSeed,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
}) {
  const pivot = useRef<THREE.Group | null>(null);
  const dragging = useRef(false);
  const lastPointerX = useRef(0);

  return (
    <div
      className="avatar-figure-shell"
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragging.current = true;
        lastPointerX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current || !pivot.current) return;
        pivot.current.rotation.y += (event.clientX - lastPointerX.current) * 0.012;
        lastPointerX.current = event.clientX;
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <Canvas
        className="avatar-figure"
        dpr={[1, 1.5]}
        camera={{ fov: 32, near: 0.1, far: 20, position: [0, 1, 5] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = TONE_EXPOSURE;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <hemisphereLight args={["#eaf8ff", "#7466b2", 0.95]} />
        <directionalLight color="#fff0c5" intensity={2.4} position={[-2.6, 3.4, 2.2]} />
        <directionalLight color="#99c9ff" intensity={0.6} position={[2.4, 1.6, 3.2]} />
        <PreviewRunner avatar={avatar} avatarSeed={avatarSeed} pivot={pivot} />
      </Canvas>
    </div>
  );
}
