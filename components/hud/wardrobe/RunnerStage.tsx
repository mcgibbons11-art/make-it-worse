"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { dressRunner } from "@/components/game/PlayerVisual";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import type { AvatarConfig } from "@/lib/game/avatar";

/**
 * The runner you are building, drawn by the renderer that will draw them.
 *
 * The picker used to preview with a hand-drawn SVG that knew four hats and four
 * faces. With nine slots and seventy-odd garments that stops being a shortcut
 * and becomes a second, divergent source of truth: every option the drawing did
 * not know about was a swatch that visibly did nothing, which a player cannot
 * tell apart from the option being broken. This mounts the real model instead -
 * the same template, the same tints, the same createWardrobeModels geometry -
 * so a garment that appears here is a garment that exists.
 *
 * Materials are deliberately not disposed between outfits. A cloned sculpt
 * material shares its parent's procedural maps by reference, so disposing one
 * would tear the textures out from under the runner the game is rendering. What
 * is left behind is a handful of MeshStandardMaterial objects per change, which
 * three's program cache collapses onto one shader anyway.
 */
export function RunnerStage({
  avatar,
  avatarSeed,
  spin,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  /** Turntable, off under reduced motion. */
  spin: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pivot = useRef<THREE.Group | null>(null);
  // Read inside the draw loop rather than depended on, so toggling reduced
  // motion does not tear down the scene the runner has been added to.
  const spinning = useRef(spin);
  useEffect(() => {
    spinning.current = spin;
  }, [spin]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let engine: THREE.WebGLRenderer;
    try {
      engine = new THREE.WebGLRenderer({ canvas: element, antialias: true, alpha: true });
    } catch {
      // No WebGL context: the stage stays empty rather than taking the picker
      // down with it. Every control beside it still works, and a browser that
      // cannot make a context cannot run the game the runner is for either.
      return;
    }
    engine.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    engine.toneMapping = THREE.ACESFilmicToneMapping;
    engine.toneMappingExposure = TONE_EXPOSURE;

    const scene = new THREE.Scene();
    // Matched to Lighting.tsx. A preview lit differently is a preview that
    // reports the wrong colour for the thing it is asking you to judge.
    scene.add(new THREE.HemisphereLight("#eaf8ff", "#7466b2", 0.95));
    const key = new THREE.DirectionalLight("#fff0c5", 2.4);
    key.position.set(-2.6, 3.4, 2.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#99c9ff", 0.6);
    fill.position.set(2.4, 1.6, 3.2);
    scene.add(fill);
    const turntable = new THREE.Group();
    // Facing a little off-square at rest, so the runner reads as a figure
    // rather than as a mugshot even with the turntable stopped.
    turntable.rotation.y = 0.5;
    scene.add(turntable);
    pivot.current = turntable;

    // The model stands 1.86u tall about a centred origin, so this frames it
    // with roughly a tenth of a body height of air above and below.
    const lens = new THREE.PerspectiveCamera(32, 0.75, 0.1, 20);
    lens.position.set(0, 0.12, 3.6);
    lens.lookAt(0, -0.06, 0);

    const fit = () => {
      const width = element.clientWidth || 240;
      const height = element.clientHeight || 320;
      engine.setSize(width, height, false);
      lens.aspect = width / height;
      lens.updateProjectionMatrix();
    };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(element);

    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (spinning.current) turntable.rotation.y += delta * 0.5;
      engine.render(scene, lens);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      pivot.current = null;
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    const turntable = pivot.current;
    if (!turntable) return;
    const model = dressRunner(avatar, avatarSeed);
    turntable.add(model);
    return () => {
      turntable.remove(model);
    };
  }, [avatar, avatarSeed]);

  return <canvas ref={canvas} className="avatar-figure" width={300} height={400} />;
}
