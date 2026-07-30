"use client";

import { Canvas } from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CameraRig } from "@/components/game/CameraRig";
import { Lighting } from "@/components/game/Lighting";
import { PlayerController } from "@/components/game/PlayerController";
import { createMAKEITWORSEApartmentRoomModel } from "@/components/game/models/createApartmentModel";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import { resetCameraYaw, setKey } from "@/lib/game/input";
import type { BuiltTrack } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ApartmentVariant } from "@/components/game/environment/apartmentFurnishing";

const ROOM_HALF = 2.155;
const APARTMENT_SIZE = ROOM_HALF * 4;
const WALL_HEIGHT = 2.8;
const FLOOR_TOP = 0;

const ROOMS: readonly {
  variant: ApartmentVariant;
  x: number;
  z: number;
  turn: number;
}[] = [
  { variant: "living", x: -ROOM_HALF, z: -ROOM_HALF, turn: 0 },
  { variant: "kitchen", x: ROOM_HALF, z: -ROOM_HALF, turn: -Math.PI / 2 },
  { variant: "bedroom", x: -ROOM_HALF, z: ROOM_HALF, turn: Math.PI / 2 },
  { variant: "study", x: ROOM_HALF, z: ROOM_HALF, turn: Math.PI },
];

const APARTMENT_TRACK: BuiltTrack = {
  pieces: [{
    id: "apartment-floor",
    center: [0, -0.1, 0],
    size: [APARTMENT_SIZE, 0.2, APARTMENT_SIZE],
    color: "#f3e3ce",
  }],
  zones: [],
  spawn: [-1.2, 0.94, -1.2],
  exit: [0, 0, 1000],
  length: APARTMENT_SIZE,
};

function roomAt(x: number, z: number): string {
  if (x < 0) return z < 0 ? "Living room" : "Bedroom";
  return z < 0 ? "Kitchen" : "Study";
}

function ApartmentWorld() {
  const apartment = useMemo(() => {
    const root = new THREE.Group();
    for (const spec of ROOMS) {
      const room = createMAKEITWORSEApartmentRoomModel({
        textureSize: 64,
        qualityPriority: "balanced",
        variant: spec.variant,
        castShadow: true,
        receiveShadow: true,
      });
      room.position.set(spec.x, 0, spec.z);
      room.rotation.y = spec.turn;
      root.add(room);
    }
    return root;
  }, []);

  useEffect(() => () => {
    apartment.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [apartment]);

  return (
    <>
      <primitive object={apartment} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APARTMENT_SIZE / 2, 0.1, APARTMENT_SIZE / 2]} position={[0, -0.1, 0]} friction={0.9} />
        <CuboidCollider args={[0.12, WALL_HEIGHT / 2, APARTMENT_SIZE / 2]} position={[-APARTMENT_SIZE / 2, WALL_HEIGHT / 2, 0]} />
        <CuboidCollider args={[0.12, WALL_HEIGHT / 2, APARTMENT_SIZE / 2]} position={[APARTMENT_SIZE / 2, WALL_HEIGHT / 2, 0]} />
        <CuboidCollider args={[APARTMENT_SIZE / 2, WALL_HEIGHT / 2, 0.12]} position={[0, WALL_HEIGHT / 2, -APARTMENT_SIZE / 2]} />
        <CuboidCollider args={[APARTMENT_SIZE / 2, WALL_HEIGHT / 2, 0.12]} position={[0, WALL_HEIGHT / 2, APARTMENT_SIZE / 2]} />
      </RigidBody>
    </>
  );
}

function ApartmentRunner({
  avatar,
  avatarSeed,
  attemptSerial,
  onMove,
  onFall,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  attemptSerial: number;
  onMove(x: number, z: number): void;
  onFall(): void;
}) {
  const player = useRef<RapierRigidBody>(null);
  const soapUntilRef = useRef(0);
  const stunUntilRef = useRef(0);
  const shakeUntilRef = useRef(0);
  const grabbables = useRef(new Map<string, RapierRigidBody>());

  return (
    <>
      <Lighting />
      <ApartmentWorld />
      <PlayerController
        ref={player}
        active
        freeRoam
        attemptSerial={attemptSerial}
        track={APARTMENT_TRACK}
        visualVisible
        pose="playing"
        avatarSeed={avatarSeed}
        avatar={avatar}
        startedAt={performance.now()}
        soapUntilRef={soapUntilRef}
        stunUntilRef={stunUntilRef}
        grabbables={grabbables}
        recordSample={(sample) => onMove(sample.x, sample.z)}
        onProgress={() => undefined}
        onInteraction={undefined}
        onFinish={() => undefined}
        onFail={onFall}
      />
      <CameraRig player={player} editorTarget={null} lookEnabled shakeUntilRef={shakeUntilRef} />
    </>
  );
}

/** A walkable home using the exact controller and chase camera used in a run. */
export function AvatarApartment({
  avatar,
  avatarSeed,
  onClose,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  onClose(): void;
}) {
  const [room, setRoom] = useState("Living room");
  const [attemptSerial, setAttemptSerial] = useState(1);

  useEffect(() => {
    resetCameraYaw();
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onClose]);

  const onMove = useCallback((x: number, z: number) => {
    const next = roomAt(x, z);
    setRoom((current) => current === next ? current : next);
  }, []);

  const press = (key: "forward" | "backward" | "left" | "right", active: boolean) => {
    setKey(key, active);
  };

  return (
    <main className="avatar-apartment">
      <Canvas
        aria-label="Your four-room apartment"
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={{ fov: 52, near: 0.1, far: 180, position: [0, 4, -5] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = TONE_EXPOSURE;
        }}
      >
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
            <ApartmentRunner
              avatar={avatar}
              avatarSeed={avatarSeed}
              attemptSerial={attemptSerial}
              onMove={onMove}
              onFall={() => setAttemptSerial((serial) => serial + 1)}
            />
          </Physics>
        </Suspense>
      </Canvas>
      <header>
        <div>
          <span className="eyebrow">YOUR APARTMENT</span>
          <strong>{room}</strong>
        </div>
        <button className="button secondary" onClick={onClose}>Back to menu</button>
      </header>
      <div className="avatar-apartment-pad" aria-label="Apartment movement controls">
        {([
          ["↑", "forward"],
          ["←", "left"],
          ["↓", "backward"],
          ["→", "right"],
        ] as const).map(([label, key]) => (
          <button
            key={key}
            onPointerDown={() => press(key, true)}
            onPointerUp={() => press(key, false)}
            onPointerCancel={() => press(key, false)}
            aria-label={`Move ${key}`}
          >{label}</button>
        ))}
      </div>
    </main>
  );
}
