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
    // The player turns around the runner root, not around this first view's
    // axis-aligned box. Fit the largest X/Z radius about that pivot so a long
    // balloon, flag, or umbrella remains framed through the full 360 degrees.
    let radialExtent = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const z of [bounds.min.z, bounds.max.z])
        radialExtent = Math.max(radialExtent, Math.hypot(x, z));
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.2, camera.aspect));
    // Each term is already the camera distance needed to fit that extent.
    // Adding radialExtent a second time left nearly half the preview box empty
    // on ordinary outfits. A small common margin keeps hats/soles off the frame
    // while letting the runner use the box the player is dressing them in.
    const distance = Math.max(
      dimensions.y / (2 * Math.tan(verticalFov / 2)),
      radialExtent / Math.tan(horizontalFov / 2),
    ) * 1.1;
    camera.position.set(0, centerY, distance);
    camera.lookAt(0, centerY, 0);
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
  const turn = (direction: -1 | 1) => {
    if (pivot.current) pivot.current.rotation.y += direction * 0.24;
  };

  return (
    <div
      className="avatar-figure-shell"
      role="group"
      tabIndex={0}
      aria-label="Interactive runner preview. Drag horizontally or use the left and right arrow keys to rotate the runner."
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        turn(event.key === "ArrowLeft" ? -1 : 1);
      }}
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
      <div className="avatar-turn-controls" aria-label="Runner rotation controls">
        <button
          type="button"
          aria-label="Turn runner left"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => turn(-1)}
        >
          ↶ Turn
        </button>
        <button
          type="button"
          aria-label="Turn runner right"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => turn(1)}
        >
          Turn ↷
        </button>
      </div>
    </div>
  );
}
