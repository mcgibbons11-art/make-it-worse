"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { dressRunner } from "@/components/game/PlayerVisual";
import { createMAKEITWORSEApartmentRoomModel } from "@/components/game/models/createApartmentModel";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ApartmentVariant } from "@/components/game/environment/apartmentFurnishing";

const ROOM_HALF = 2.155;
const APARTMENT_LIMIT = ROOM_HALF * 2 - 0.25;

const ROOMS: readonly {
  variant: ApartmentVariant;
  label: string;
  x: number;
  z: number;
  turn: number;
}[] = [
  { variant: "living", label: "Living room", x: -ROOM_HALF, z: -ROOM_HALF, turn: 0 },
  { variant: "kitchen", label: "Kitchen", x: ROOM_HALF, z: -ROOM_HALF, turn: -Math.PI / 2 },
  { variant: "bedroom", label: "Bedroom", x: -ROOM_HALF, z: ROOM_HALF, turn: Math.PI / 2 },
  { variant: "study", label: "Study", x: ROOM_HALF, z: ROOM_HALF, turn: Math.PI },
];

function roomAt(x: number, z: number): string {
  if (x < 0) return z < 0 ? "Living room" : "Bedroom";
  return z < 0 ? "Kitchen" : "Study";
}

/** A separate, walkable home assembled from all four apartment room sets. */
export function AvatarApartment({
  avatar,
  avatarSeed,
  onClose,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  onClose(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef(new Set<string>());
  const [room, setRoom] = useState("Living room");

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      held.current.add(event.key.toLowerCase());
    };
    const up = (event: KeyboardEvent) => held.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onClose]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = TONE_EXPOSURE;
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#bfeaff");
    scene.add(new THREE.HemisphereLight("#effbff", "#7466b2", 1.15));
    const sun = new THREE.DirectionalLight("#fff0c5", 2.8);
    sun.position.set(-5, 8, 6);
    sun.castShadow = true;
    scene.add(sun);

    const apartment = new THREE.Group();
    for (const spec of ROOMS) {
      const built = createMAKEITWORSEApartmentRoomModel({
        textureSize: 64,
        qualityPriority: "balanced",
        variant: spec.variant,
        castShadow: true,
        receiveShadow: true,
      });
      built.position.set(spec.x, 0, spec.z);
      built.rotation.y = spec.turn;
      apartment.add(built);
    }
    scene.add(apartment);

    const runner = dressRunner(avatar, avatarSeed);
    runner.position.set(-1.2, 0.94, -1.2);
    runner.rotation.y = Math.PI;
    scene.add(runner);
    const leftArm = runner.getObjectByName("Arm left__pivot");
    const rightArm = runner.getObjectByName("Arm right__pivot");
    const leftLeg = runner.getObjectByName("Leg left__pivot");
    const rightLeg = runner.getObjectByName("Leg right__pivot");

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40);
    camera.position.set(0, 7.2, 8.4);
    camera.lookAt(runner.position.x, 0.3, runner.position.z);
    const target = new THREE.Vector3();
    const wantedCamera = new THREE.Vector3();
    let orbitYaw = 0;
    let orbiting = false;
    let orbitPointerX = 0;
    const orbitDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      orbiting = true;
      orbitPointerX = event.clientX;
    };
    const orbitMove = (event: PointerEvent) => {
      if (!orbiting) return;
      orbitYaw -= (event.clientX - orbitPointerX) * 0.006;
      orbitPointerX = event.clientX;
    };
    const orbitUp = () => {
      orbiting = false;
    };
    element.addEventListener("pointerdown", orbitDown);
    window.addEventListener("pointermove", orbitMove);
    window.addEventListener("pointerup", orbitUp);

    const fit = () => {
      const width = element.clientWidth || window.innerWidth;
      const height = element.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(element);

    let frame = 0;
    let last = performance.now();
    let stride = 0;
    let currentRoom = roomAt(runner.position.x, runner.position.z);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keys = held.current;
      const x = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
      const z = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
      const length = Math.hypot(x, z);
      if (length > 0) {
        const speed = 2.7 * delta;
        runner.position.x = THREE.MathUtils.clamp(runner.position.x + (x / length) * speed, -APARTMENT_LIMIT, APARTMENT_LIMIT);
        runner.position.z = THREE.MathUtils.clamp(runner.position.z + (z / length) * speed, -APARTMENT_LIMIT, APARTMENT_LIMIT);
        runner.rotation.y = Math.atan2(x, z);
        stride += delta * 11;
        runner.position.y = 0.94 + Math.abs(Math.sin(stride)) * 0.045;
        if (leftArm) leftArm.rotation.x = Math.sin(stride) * 0.55;
        if (rightArm) rightArm.rotation.x = -Math.sin(stride) * 0.55;
        if (leftLeg) leftLeg.rotation.x = -Math.sin(stride) * 0.5;
        if (rightLeg) rightLeg.rotation.x = Math.sin(stride) * 0.5;
      }
      const nextRoom = roomAt(runner.position.x, runner.position.z);
      if (nextRoom !== currentRoom) {
        currentRoom = nextRoom;
        setRoom(nextRoom);
      }
      target.set(runner.position.x, 0.45, runner.position.z);
      wantedCamera.set(
        runner.position.x + Math.sin(orbitYaw) * 7.3,
        6.4,
        runner.position.z + Math.cos(orbitYaw) * 7.3,
      );
      camera.position.lerp(wantedCamera, 1 - Math.exp(-delta * 4));
      camera.lookAt(target);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      element.removeEventListener("pointerdown", orbitDown);
      window.removeEventListener("pointermove", orbitMove);
      window.removeEventListener("pointerup", orbitUp);
      renderer.dispose();
    };
  }, [avatar, avatarSeed]);

  const press = (key: string, active: boolean) => {
    if (active) held.current.add(key);
    else held.current.delete(key);
  };

  return (
    <main className="avatar-apartment">
      <canvas ref={canvas} aria-label="Your four-room apartment" />
      <header>
        <div>
          <span className="eyebrow">YOUR APARTMENT</span>
          <strong>{room}</strong>
        </div>
        <button className="button secondary" onClick={onClose}>Back to menu</button>
      </header>
      <div className="avatar-apartment-pad" aria-label="Apartment movement controls">
        {[["↑", "w"], ["←", "a"], ["↓", "s"], ["→", "d"]].map(([label, key]) => (
          <button
            key={key}
            onPointerDown={() => press(key!, true)}
            onPointerUp={() => press(key!, false)}
            onPointerCancel={() => press(key!, false)}
            aria-label={`Move ${key}`}
          >{label}</button>
        ))}
      </div>
    </main>
  );
}
