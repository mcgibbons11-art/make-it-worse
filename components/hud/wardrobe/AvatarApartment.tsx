"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
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
import { AudioManager } from "@/lib/audio/AudioManager";
import {
  DEFAULT_APARTMENT_DECOR,
  loadApartmentDecor,
  saveApartmentDecor,
  type ApartmentDecorItem,
  type ApartmentDecorType,
} from "@/lib/game/apartment-decor";
import { resetCameraYaw, resetInput, setKey } from "@/lib/game/input";
import type { BuiltTrack } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ApartmentVariant } from "@/components/game/environment/apartmentFurnishing";

const ROOM_SIZE = 4.31;
const ROOM_HALF = ROOM_SIZE / 2;
const APARTMENT_WIDTH = ROOM_SIZE * 6;
const APARTMENT_DEPTH = ROOM_SIZE * 4;
const WALL_HEIGHT = 2.8;
const POSITION_STEP = 0.1;

type ApartmentMode = "explore" | "decorate";

interface RoomSpec {
  variant: ApartmentVariant;
  label: string;
  x: number;
  z: number;
  turn: number;
}

const NORTH_ROOMS: readonly ApartmentVariant[] = [
  "living", "kitchen", "bedroom", "study", "living", "kitchen",
];
const SOUTH_ROOMS: readonly ApartmentVariant[] = [
  "study", "bedroom", "kitchen", "living", "study", "bedroom",
];

const ROOM_LABELS: Readonly<Record<ApartmentVariant, string>> = {
  living: "Living room",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  study: "Studio",
};

const ROOMS: readonly RoomSpec[] = [
  ...NORTH_ROOMS.map((variant, index) => ({
    variant,
    label: `North ${ROOM_LABELS[variant]}`,
    x: (index - 2.5) * ROOM_SIZE,
    z: -APARTMENT_DEPTH / 2 + ROOM_HALF,
    turn: 0,
  })),
  ...SOUTH_ROOMS.map((variant, index) => ({
    variant,
    label: `South ${ROOM_LABELS[variant]}`,
    x: (index - 2.5) * ROOM_SIZE,
    z: APARTMENT_DEPTH / 2 - ROOM_HALF,
    turn: Math.PI,
  })),
];

const APARTMENT_TRACK: BuiltTrack = {
  pieces: [{
    id: "apartment-floor",
    center: [0, -0.1, 0],
    size: [APARTMENT_WIDTH, 0.2, APARTMENT_DEPTH],
    color: "#f3e3ce",
  }],
  zones: [],
  spawn: [0, 0.94, 0],
  exit: [0, 0, 1000],
  length: APARTMENT_DEPTH,
};

const sourceModels = new Map<ApartmentVariant, THREE.Group>();
const decorPrototypes = new Map<ApartmentDecorType, THREE.Group>();

function apartmentSource(variant: ApartmentVariant): THREE.Group {
  const cached = sourceModels.get(variant);
  if (cached) return cached;
  const source = createMAKEITWORSEApartmentRoomModel({
    textureSize: 64,
    qualityPriority: "balanced",
    variant,
    castShadow: true,
    receiveShadow: true,
  });
  source.updateMatrixWorld(true);
  sourceModels.set(variant, source);
  return source;
}

/** Clone only render children; the generated root's runtime index intentionally contains object cycles. */
function cloneApartmentSource(variant: ApartmentVariant): THREE.Group {
  const clone = new THREE.Group();
  const source = apartmentSource(variant);
  for (const child of source.children) clone.add(child.clone(true));
  return clone;
}

interface DecorDefinition {
  label: string;
  emoji: string;
  variant: ApartmentVariant;
  nodeIds: readonly string[];
  prefixes?: readonly string[];
  size: readonly [number, number, number];
  solid: boolean;
}

const DECOR: Readonly<Record<ApartmentDecorType, DecorDefinition>> = {
  sofa: {
    label: "Sofa", emoji: "🛋️", variant: "living", nodeIds: [], prefixes: ["sofa-"],
    size: [2.8, 1.25, 1.3], solid: true,
  },
  "side-table": {
    label: "Side table", emoji: "🪑", variant: "living", nodeIds: ["table-shell", "table-back-panel"], prefixes: ["table-leg-"],
    size: [0.75, 1, 1.1], solid: true,
  },
  rug: {
    label: "Rug", emoji: "🟧", variant: "living", nodeIds: ["rug-border", "rug-field"],
    size: [2.7, 0.05, 1.85], solid: false,
  },
  plant: {
    label: "Plant", emoji: "🪴", variant: "living", nodeIds: ["sill-pot", "sill-plant"],
    size: [0.45, 0.65, 0.45], solid: true,
  },
  kitchen: {
    label: "Kitchen set", emoji: "🍳", variant: "kitchen", nodeIds: [], prefixes: ["kitchen-"],
    size: [3, 2.35, 0.85], solid: true,
  },
  bed: {
    label: "Bed", emoji: "🛏️", variant: "bedroom", nodeIds: ["bedroom-throw"], prefixes: ["bed-"],
    size: [2, 1.25, 1.85], solid: true,
  },
  wardrobe: {
    label: "Wardrobe", emoji: "🚪", variant: "bedroom", nodeIds: ["bedroom-wardrobe"], prefixes: ["wardrobe-"],
    size: [0.8, 2.3, 0.8], solid: true,
  },
  desk: {
    label: "Desk & chair", emoji: "🖥️", variant: "study", nodeIds: [], prefixes: ["desk-", "chair-", "study-"],
    size: [1.8, 1.3, 1.6], solid: true,
  },
  bookcase: {
    label: "Bookcase", emoji: "📚", variant: "study", nodeIds: [], prefixes: ["bookcase-", "book-"],
    size: [1.6, 2, 0.6], solid: true,
  },
};

function decorPrototype(type: ApartmentDecorType): THREE.Group {
  const cached = decorPrototypes.get(type);
  if (cached) return cached;
  const definition = DECOR[type];
  const source = apartmentSource(definition.variant);
  const runtime = source.userData.sculptRuntime as { nodes?: Record<string, THREE.Object3D> } | undefined;
  const nodes = runtime?.nodes ?? {};
  const selected = new Set(
    Object.entries(nodes)
      .filter(([id]) => definition.nodeIds.includes(id) || definition.prefixes?.some((prefix) => id.startsWith(prefix)))
      .map(([, node]) => node),
  );
  const roots = [...selected].filter((node) => {
    let parent = node.parent;
    while (parent && parent !== source) {
      if (selected.has(parent)) return false;
      parent = parent.parent;
    }
    return true;
  });
  const prototype = new THREE.Group();
  for (const node of roots) prototype.add(node.clone(true));
  prototype.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(prototype);
  if (!bounds.isEmpty()) {
    const center = bounds.getCenter(new THREE.Vector3());
    for (const child of prototype.children) {
      child.position.x -= center.x;
      child.position.y -= bounds.min.y;
      child.position.z -= center.z;
    }
  }
  prototype.updateMatrixWorld(true);
  decorPrototypes.set(type, prototype);
  return prototype;
}

function makeDecorVisual(type: ApartmentDecorType, color: string): THREE.Group {
  const visual = decorPrototype(type).clone(true);
  const tint = new THREE.Color(color);
  visual.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const materials = sourceMaterials.map((source) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) material.color.lerp(tint, 0.68);
      return material;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0]!;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return visual;
}

function roomAt(x: number, z: number): string {
  if (Math.abs(z) < ROOM_SIZE) return "Central gallery";
  const row = z < 0 ? 0 : 1;
  const column = Math.max(0, Math.min(5, Math.floor((x + APARTMENT_WIDTH / 2) / ROOM_SIZE)));
  return ROOMS[row * 6 + column]?.label ?? "Central gallery";
}

function clampX(value: number): number {
  return Math.max(-APARTMENT_WIDTH / 2 + 0.65, Math.min(APARTMENT_WIDTH / 2 - 0.65, value));
}

function clampZ(value: number): number {
  return Math.max(-APARTMENT_DEPTH / 2 + 0.65, Math.min(APARTMENT_DEPTH / 2 - 0.65, value));
}

function snap(value: number): number {
  return Math.round(value / POSITION_STEP) * POSITION_STEP;
}

function DecorItemView({
  item,
  mode,
  selected,
  onSelect,
  onMove,
}: {
  item: ApartmentDecorItem;
  mode: ApartmentMode;
  selected: boolean;
  onSelect(uid: string): void;
  onMove(uid: string, x: number, z: number): void;
}) {
  type PointerCaptureTarget = EventTarget & {
    setPointerCapture(pointerId: number): void;
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
  };
  const definition = DECOR[item.type];
  const visual = useMemo(() => makeDecorVisual(item.type, item.color), [item.color, item.type]);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const activePointer = useRef<number | null>(null);
  const capturedTarget = useRef<PointerCaptureTarget | null>(null);

  useEffect(() => () => {
    visual.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [visual]);

  const down = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "decorate" || event.button !== 0) return;
    event.stopPropagation();
    AudioManager.click();
    onSelect(item.uid);
    activePointer.current = event.pointerId;
    const target = event.target as PointerCaptureTarget | null;
    target?.setPointerCapture(event.pointerId);
    capturedTarget.current = target;
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "decorate" || activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    if (event.ray.intersectPlane(plane, point)) {
      onMove(item.uid, clampX(snap(point.x)), clampZ(snap(point.z)));
    }
  };
  const end = (event: ThreeEvent<PointerEvent>) => {
    if (activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    activePointer.current = null;
    const target = capturedTarget.current;
    capturedTarget.current = null;
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };

  if (mode === "explore") {
    return (
      <RigidBody type="fixed" colliders={false} position={[item.x, 0, item.z]} rotation={[0, item.rotation, 0]}>
        {definition.solid && (
          <CuboidCollider
            args={[definition.size[0] / 2, definition.size[1] / 2, definition.size[2] / 2]}
            position={[0, definition.size[1] / 2, 0]}
          />
        )}
        <primitive object={visual} />
      </RigidBody>
    );
  }

  const radius = Math.max(0.55, Math.hypot(definition.size[0], definition.size[2]) * 0.3);
  return (
    <group
      position={[item.x, 0, item.z]}
      rotation={[0, item.rotation, 0]}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <primitive object={visual} />
      <mesh position={[0, definition.size[1] / 2, 0]}>
        <boxGeometry args={definition.size} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius, radius + 0.08, 40]} />
          <meshBasicMaterial color="#57dfa1" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

function ApartmentWorld({
  decor,
  mode,
  selectedUid,
  onSelect,
  onMove,
}: {
  decor: readonly ApartmentDecorItem[];
  mode: ApartmentMode;
  selectedUid: string | null;
  onSelect(uid: string | null): void;
  onMove(uid: string, x: number, z: number): void;
}) {
  const apartment = useMemo(() => {
    const root = new THREE.Group();
    for (const spec of ROOMS) {
      const room = cloneApartmentSource(spec.variant);
      room.position.set(spec.x, 0, spec.z);
      room.rotation.y = spec.turn;
      root.add(room);
    }
    return root;
  }, []);

  return (
    <>
      <color attach="background" args={["#bfeaff"]} />
      <mesh position={[0, -0.12, 0]} receiveShadow onPointerDown={() => mode === "decorate" && onSelect(null)}>
        <boxGeometry args={[APARTMENT_WIDTH, 0.24, APARTMENT_DEPTH]} />
        <meshStandardMaterial color="#f3e3ce" roughness={0.94} />
      </mesh>
      <primitive object={apartment} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APARTMENT_WIDTH / 2, 0.1, APARTMENT_DEPTH / 2]} position={[0, -0.1, 0]} friction={0.9} />
        <CuboidCollider args={[0.12, WALL_HEIGHT / 2, APARTMENT_DEPTH / 2]} position={[-APARTMENT_WIDTH / 2, WALL_HEIGHT / 2, 0]} />
        <CuboidCollider args={[0.12, WALL_HEIGHT / 2, APARTMENT_DEPTH / 2]} position={[APARTMENT_WIDTH / 2, WALL_HEIGHT / 2, 0]} />
        <CuboidCollider args={[APARTMENT_WIDTH / 2, WALL_HEIGHT / 2, 0.12]} position={[0, WALL_HEIGHT / 2, -APARTMENT_DEPTH / 2]} />
        <CuboidCollider args={[APARTMENT_WIDTH / 2, WALL_HEIGHT / 2, 0.12]} position={[0, WALL_HEIGHT / 2, APARTMENT_DEPTH / 2]} />
      </RigidBody>
      {decor.map((item) => (
        <DecorItemView
          key={item.uid}
          item={item}
          mode={mode}
          selected={selectedUid === item.uid}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </>
  );
}

function ApartmentRunner({
  avatar,
  avatarSeed,
  attemptSerial,
  mode,
  decor,
  selectedUid,
  onSelect,
  onMoveDecor,
  onMoveRunner,
  onFall,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  attemptSerial: number;
  mode: ApartmentMode;
  decor: readonly ApartmentDecorItem[];
  selectedUid: string | null;
  onSelect(uid: string | null): void;
  onMoveDecor(uid: string, x: number, z: number): void;
  onMoveRunner(x: number, z: number): void;
  onFall(): void;
}) {
  const player = useRef<RapierRigidBody>(null);
  const soapUntilRef = useRef(0);
  const stunUntilRef = useRef(0);
  const shakeUntilRef = useRef(0);
  const grabbables = useRef(new Map<string, RapierRigidBody>());
  const [startedAt] = useState(() => performance.now());

  return (
    <>
      <Lighting />
      <ApartmentWorld decor={decor} mode={mode} selectedUid={selectedUid} onSelect={onSelect} onMove={onMoveDecor} />
      <PlayerController
        ref={player}
        active={mode === "explore"}
        freeRoam
        attemptSerial={attemptSerial}
        track={APARTMENT_TRACK}
        visualVisible
        pose="playing"
        avatarSeed={avatarSeed}
        avatar={avatar}
        startedAt={startedAt}
        soapUntilRef={soapUntilRef}
        stunUntilRef={stunUntilRef}
        grabbables={grabbables}
        recordSample={(sample) => onMoveRunner(sample.x, sample.z)}
        onProgress={() => undefined}
        onInteraction={undefined}
        onFinish={() => undefined}
        onFail={onFall}
      />
      <CameraRig
        player={player}
        editorTarget={null}
        lookEnabled
        lookButton={mode === "decorate" ? 2 : 0}
        shakeUntilRef={shakeUntilRef}
      />
    </>
  );
}

/** A walkable, persistent home using the exact controller and chase camera used in a run. */
export function AvatarApartment({
  avatar,
  avatarSeed,
  onClose,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  onClose(): void;
}) {
  const [room, setRoom] = useState("Central gallery");
  const [mode, setMode] = useState<ApartmentMode>("explore");
  const [attemptSerial, setAttemptSerial] = useState(1);
  const [runnerPosition, setRunnerPosition] = useState({ x: 0, z: 0 });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [decor, setDecor] = useState<ApartmentDecorItem[]>(() => (
    typeof window === "undefined" ? DEFAULT_APARTMENT_DECOR.map((item) => ({ ...item })) : loadApartmentDecor(window.localStorage)
  ));
  const idSerial = useRef(0);

  useEffect(() => {
    resetCameraYaw();
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onClose]);

  useEffect(() => {
    if (mode === "decorate") resetInput();
  }, [mode]);

  useEffect(() => {
    saveApartmentDecor(window.localStorage, decor);
  }, [decor]);

  const onMoveRunner = useCallback((x: number, z: number) => {
    const next = roomAt(x, z);
    setRoom((current) => current === next ? current : next);
    setRunnerPosition((current) => (
      Math.abs(current.x - x) < 0.2 && Math.abs(current.z - z) < 0.2 ? current : { x, z }
    ));
  }, []);

  const updateItem = useCallback((uid: string, update: Partial<ApartmentDecorItem>) => {
    setDecor((current) => current.map((item) => item.uid === uid ? { ...item, ...update } : item));
  }, []);

  const addItem = (type: ApartmentDecorType) => {
    let uid: string;
    do {
      idSerial.current += 1;
      uid = `user-${type}-${idSerial.current}`;
    } while (decor.some((item) => item.uid === uid));
    const offset = ((decor.length + idSerial.current) % 5 - 2) * 0.45;
    const item: ApartmentDecorItem = {
      uid,
      type,
      x: clampX(snap(runnerPosition.x + 2.4)),
      z: clampZ(snap(runnerPosition.z + offset)),
      rotation: 0,
      color: "#68b78a",
    };
    setDecor((current) => [...current, item]);
    setSelectedUid(item.uid);
  };

  const selected = decor.find((item) => item.uid === selectedUid) ?? null;
  const press = (key: "forward" | "backward" | "left" | "right", active: boolean) => setKey(key, active);

  return (
    <main className={`avatar-apartment ${mode === "decorate" ? "is-decorating" : ""}`}>
      <Canvas
        aria-label="Your six-times-larger customizable apartment"
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={{ fov: 52, near: 0.1, far: 220, position: [0, 4, -5] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onContextMenu={(event) => event.preventDefault()}
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
              mode={mode}
              decor={decor}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
              onMoveDecor={(uid, x, z) => updateItem(uid, { x, z })}
              onMoveRunner={onMoveRunner}
              onFall={() => setAttemptSerial((serial) => serial + 1)}
            />
          </Physics>
        </Suspense>
      </Canvas>

      <header>
        <div>
          <span className="eyebrow">🏠 YOUR APARTMENT</span>
          <strong>{mode === "explore" ? room : "Decorate mode"}</strong>
        </div>
        <nav aria-label="Apartment actions">
          <button className="button secondary apartment-guide-button" onClick={() => setGuideOpen(true)} aria-label="Apartment controls">?</button>
          <button className={`button ${mode === "explore" ? "primary" : "secondary"}`} onClick={() => setMode("explore")}>🏃 Explore</button>
          <button className={`button ${mode === "decorate" ? "primary" : "secondary"}`} onClick={() => setMode("decorate")}>🛋️ Decorate</button>
          <button className="button secondary" onClick={onClose}>↩️ Back to menu</button>
        </nav>
      </header>

      {mode === "decorate" && (
        <aside className="avatar-apartment-decor" aria-label="Apartment furniture">
          <div>
            <span className="eyebrow">ADD FURNITURE</span>
            <small>Added beside your runner</small>
          </div>
          <div className="avatar-apartment-decor-grid">
            {(Object.entries(DECOR) as [ApartmentDecorType, DecorDefinition][]).map(([type, definition]) => (
              <button key={type} onClick={() => addItem(type)}>
                <span>{definition.emoji}</span>{definition.label}
              </button>
            ))}
          </div>
          <section className="avatar-apartment-selection">
            {selected ? (
              <>
                <strong>{DECOR[selected.type].emoji} {DECOR[selected.type].label}</strong>
                <label>Color <input type="color" value={selected.color} onChange={(event) => updateItem(selected.uid, { color: event.target.value })} /></label>
                <div>
                  <button onClick={() => updateItem(selected.uid, { rotation: selected.rotation - Math.PI / 4 })}>↶ Turn</button>
                  <button onClick={() => updateItem(selected.uid, { rotation: selected.rotation + Math.PI / 4 })}>↷ Turn</button>
                  <button className="danger" onClick={() => {
                    setDecor((current) => current.filter((item) => item.uid !== selected.uid));
                    setSelectedUid(null);
                  }}>🗑️ Remove</button>
                </div>
              </>
            ) : <small>Left-drag a piece to move it. Right-drag to turn the camera.</small>}
          </section>
          <button className="avatar-apartment-reset" onClick={() => {
            setDecor(DEFAULT_APARTMENT_DECOR.map((item) => ({ ...item })));
            setSelectedUid(null);
          }}>↺ Restore starter layout</button>
        </aside>
      )}

      {mode === "explore" && (
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
      )}

      {guideOpen && (
        <div className="avatar-apartment-guide" role="dialog" aria-modal="true" aria-label="Apartment controls">
          <section>
            <span className="eyebrow">APARTMENT CONTROLS</span>
            <h2>Make the place yours</h2>
            <p><b>Explore:</b> Run with the finished game controls. Hold left click and drag for a full 360° camera turn.</p>
            <p><b>Decorate:</b> Add furniture beside the runner, then left-drag it anywhere on the floor. Right-drag turns the camera while moving pieces.</p>
            <p><b>Organize:</b> Select a piece to recolor, rotate, or remove it. Your layout saves automatically on this device.</p>
            <button className="button primary" onClick={() => setGuideOpen(false)}>Got it</button>
          </section>
        </div>
      )}
    </main>
  );
}
