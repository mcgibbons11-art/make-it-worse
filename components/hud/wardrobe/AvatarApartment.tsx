"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
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
import { AssetModel, type ModelName } from "@/components/game/AssetModel";
import { createMAKEITWORSEApartmentRoomModel } from "@/components/game/models/createApartmentModel";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import { AudioManager } from "@/lib/audio/AudioManager";
import {
  DEFAULT_APARTMENT_DECOR,
  DEFAULT_APARTMENT_STYLE,
  APARTMENT_DECOR_TYPES,
  apartmentAnchorKind,
  loadApartmentDecor,
  loadApartmentStyle,
  saveApartmentDecor,
  saveApartmentStyle,
  type ApartmentDecorItem,
  type ApartmentDecorType,
  type ApartmentStyle,
} from "@/lib/game/apartment-decor";
import { resetCameraYaw, resetInput, setKey } from "@/lib/game/input";
import { trackFacingYaw, type BuiltTrack } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ApartmentVariant } from "@/components/game/environment/apartmentFurnishing";

const APARTMENT_WIDTH = 25.8;
const APARTMENT_DEPTH = 17.2;
const WALL_HEIGHT = 2.65;
const WALL_THICKNESS = 0.18;
const MAX_APARTMENT_ITEMS = 80;

type ApartmentMode = "explore" | "decorate";

interface WallSpec {
  id: string;
  axis: "x" | "z";
  x: number;
  z: number;
  length: number;
}

const WALLS: readonly WallSpec[] = [
  { id: "outer-north", axis: "x", x: 0, z: -8.6, length: 25.8 },
  { id: "outer-south", axis: "x", x: 0, z: 8.6, length: 25.8 },
  { id: "outer-west", axis: "z", x: -12.9, z: 0, length: 17.2 },
  { id: "outer-east", axis: "z", x: 12.9, z: 0, length: 17.2 },
  { id: "west-hall-n2", axis: "z", x: -1.5, z: -2.25, length: 4.5 },
  { id: "west-hall-s", axis: "z", x: -1.5, z: 1.5, length: 3 },
  { id: "east-hall-n1", axis: "z", x: 1.5, z: -7.05, length: 3.1 },
  { id: "east-hall-n2", axis: "z", x: 1.5, z: -2.75, length: 3.5 },
  { id: "east-hall-mid", axis: "z", x: 1.5, z: 1.5, length: 3 },
  { id: "west-room-split", axis: "x", x: -7.2, z: 0, length: 11.4 },
  { id: "east-bedroom-split", axis: "x", x: 7.2, z: -2, length: 11.4 },
  { id: "east-study-split", axis: "x", x: 7.2, z: 3, length: 11.4 },
  { id: "foyer-west-a", axis: "z", x: -4, z: 3.7, length: 1.4 },
  { id: "foyer-west-b", axis: "z", x: -4, z: 7.1, length: 3 },
  { id: "foyer-east-a", axis: "z", x: 4, z: 3.7, length: 1.4 },
  { id: "foyer-east-b", axis: "z", x: 4, z: 7.1, length: 3 },
  { id: "foyer-shoulder-west", axis: "x", x: -2.75, z: 3, length: 2.5 },
  { id: "foyer-shoulder-east", axis: "x", x: 2.75, z: 3, length: 2.5 },
  { id: "bath-utility-a", axis: "z", x: 8.2, z: 4.05, length: 2.1 },
  { id: "bath-utility-b", axis: "z", x: 8.2, z: 7.4, length: 2.4 },
];

interface DoorSpec {
  id: string;
  axis: "x" | "z";
  x: number;
  z: number;
  hinge: -1 | 1;
}

const DOORS: readonly DoorSpec[] = [
  { id: "living-door", axis: "z", x: -1.5, z: -5, hinge: -1 },
  { id: "bedroom-door", axis: "z", x: 1.5, z: -5, hinge: 1 },
  { id: "study-door", axis: "z", x: 1.5, z: -0.5, hinge: 1 },
  { id: "kitchen-door", axis: "z", x: -4, z: 5.1, hinge: -1 },
  { id: "bath-door", axis: "z", x: 4, z: 5.1, hinge: 1 },
  { id: "utility-door", axis: "z", x: 8.2, z: 5.7, hinge: 1 },
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
  exit: [0, 0, -1000],
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

interface DecorDefinition {
  label: string;
  emoji: string;
  variant?: ApartmentVariant;
  model?: ModelName;
  nodeIds: readonly string[];
  prefixes?: readonly string[];
  size: readonly [number, number, number];
  solid: boolean;
  elevation?: number;
  scale?: readonly [number, number, number];
  tintable?: boolean;
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
  "dining-table": {
    label: "Dining table", emoji: "🍽️", variant: "living", nodeIds: ["table-shell", "table-back-panel"], prefixes: ["table-leg-"],
    size: [1.8, 0.85, 1.25], scale: [2.25, 0.95, 1.12], solid: true,
  },
  "dining-chair": {
    label: "Dining chair", emoji: "🪑", variant: "study", nodeIds: [], prefixes: ["desk-chair-", "chair-leg-"],
    size: [0.8, 1.05, 0.8], solid: true,
  },
  rug: {
    label: "Rug", emoji: "🟧", variant: "living", nodeIds: ["rug-border", "rug-field"],
    size: [2.7, 0.05, 1.85], solid: false,
  },
  plant: {
    label: "Plant", emoji: "🪴", variant: "living", nodeIds: ["sill-pot", "sill-plant"],
    size: [1.05, 1.35, 1.05], scale: [3, 3, 3], solid: true,
  },
  "kitchen-counter": {
    label: "Kitchen counter", emoji: "🍳", variant: "kitchen",
    nodeIds: ["kitchen-base-run", "kitchen-worktop", "kitchen-sink-rim", "kitchen-sink-pan", "kitchen-door-gap-cluster"],
    prefixes: ["kitchen-pot", "kitchen-kettle", "kitchen-board", "kitchen-mug-"],
    size: [2.4, 1.15, 0.8], solid: true,
  },
  "wall-cabinet": {
    label: "Wall cabinet", emoji: "🗄️", variant: "kitchen",
    nodeIds: ["kitchen-wall-unit", "kitchen-under-light"],
    size: [2.2, 0.75, 0.5], elevation: 1.45, solid: true,
  },
  "bathroom-vanity": {
    label: "Sink vanity", emoji: "🚰", variant: "kitchen",
    nodeIds: ["kitchen-base-run", "kitchen-worktop", "kitchen-sink-rim", "kitchen-sink-pan", "kitchen-door-gap-cluster"],
    size: [1.55, 1.05, 0.8], scale: [0.68, 1, 0.8], solid: true,
  },
  refrigerator: {
    label: "Refrigerator", emoji: "🧊", model: "refrigerator", nodeIds: [],
    size: [1.4, 1.9, 1], solid: true, tintable: false,
  },
  toaster: {
    label: "Toaster", emoji: "🍞", model: "toaster", nodeIds: [],
    size: [0.65, 0.5, 0.5], elevation: 0.94, solid: true, tintable: false,
  },
  bed: {
    label: "Bed", emoji: "🛏️", variant: "bedroom", nodeIds: ["bedroom-throw"], prefixes: ["bed-"],
    size: [2, 1.25, 1.85], solid: true,
  },
  "bedside-table": {
    label: "Bedside table", emoji: "🗄️", variant: "bedroom", nodeIds: ["bedside-table", "bedroom-book"],
    size: [0.7, 0.65, 0.7], solid: true,
  },
  "bedside-lamp": {
    label: "Bedside lamp", emoji: "💡", variant: "bedroom", nodeIds: [], prefixes: ["bedside-lamp-"],
    size: [0.45, 0.55, 0.45], elevation: 0.58, solid: false,
  },
  wardrobe: {
    label: "Wardrobe", emoji: "🚪", variant: "bedroom", nodeIds: ["bedroom-wardrobe"], prefixes: ["wardrobe-"],
    size: [1, 2.35, 1], scale: [1.25, 1.08, 1.25], solid: true,
  },
  "writing-desk": {
    label: "Writing desk", emoji: "🖥️", variant: "study", nodeIds: [], prefixes: ["desk-top", "desk-leg-", "study-"],
    size: [1.9, 1.25, 1.35], scale: [1.25, 1.12, 1.25], solid: true,
  },
  "desk-chair": {
    label: "Desk chair", emoji: "🪑", variant: "study", nodeIds: [], prefixes: ["desk-chair-", "chair-leg-"],
    size: [1, 1.2, 1], scale: [1.2, 1.15, 1.2], solid: true,
  },
  bookcase: {
    label: "Bookcase", emoji: "📚", variant: "study", nodeIds: [], prefixes: ["bookcase-", "book-"],
    size: [1.6, 2, 0.6], solid: true,
  },
  "wall-art": {
    label: "Wall art", emoji: "🖼️", variant: "living", nodeIds: ["art-frame", "art-field"],
    size: [1.4, 0.9, 0.12], elevation: 1.35, solid: false,
  },
  curtains: {
    label: "Curtains", emoji: "🪟", variant: "living", nodeIds: ["curtain-left", "curtain-right"],
    size: [2.6, 2.15, 0.24], elevation: 0.42, solid: false,
  },
  radiator: {
    label: "Radiator", emoji: "♨️", variant: "living", nodeIds: ["radiator-body", "radiator-fin-cluster"],
    size: [1.6, 0.72, 0.3], elevation: 0.12, solid: false,
  },
  "wall-shelf": {
    label: "Wall shelf", emoji: "🪵", variant: "living", nodeIds: ["wall-shelf"], prefixes: ["shelf-book-", "shelf-mug"],
    size: [1.6, 0.6, 0.35], elevation: 1.35, solid: false,
  },
  toilet: {
    label: "Toilet", emoji: "🚽", model: "toilet", nodeIds: [],
    size: [1, 1, 1], solid: true, tintable: false,
  },
  vacuum: {
    label: "Vacuum", emoji: "🧹", model: "vacuum", nodeIds: [],
    size: [1, 0.75, 1], solid: true, tintable: false,
  },
  "floor-fan": {
    label: "Floor fan", emoji: "💨", model: "fan", nodeIds: [],
    size: [1, 1.35, 0.85], solid: true, tintable: false,
  },
  "robot-mop": {
    label: "Robot mop", emoji: "🧼", model: "mop", nodeIds: [],
    size: [0.8, 0.25, 0.8], solid: true, tintable: false,
  },
};

const DECOR_GROUPS = [
  { id: "all", label: "✨ All", types: APARTMENT_DECOR_TYPES },
  { id: "living", label: "🛋️ Living", types: ["sofa", "side-table", "dining-table", "dining-chair", "rug", "plant"] },
  { id: "kitchen", label: "🍳 Kitchen", types: ["kitchen-counter", "wall-cabinet", "refrigerator", "toaster", "bathroom-vanity"] },
  { id: "bedroom", label: "🛏️ Bedroom", types: ["bed", "bedside-table", "bedside-lamp", "wardrobe"] },
  { id: "study", label: "📚 Study", types: ["writing-desk", "desk-chair", "bookcase"] },
  { id: "wall", label: "🖼️ Wall", types: ["wall-art", "curtains", "radiator", "wall-shelf"] },
  { id: "utility", label: "🧹 Utility", types: ["toilet", "vacuum", "floor-fan", "robot-mop"] },
] as const satisfies readonly { id: string; label: string; types: readonly ApartmentDecorType[] }[];

function decorPrototype(type: ApartmentDecorType): THREE.Group {
  const cached = decorPrototypes.get(type);
  if (cached) return cached;
  const definition = DECOR[type];
  if (!definition.variant) return new THREE.Group();
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
  if (definition.scale) prototype.scale.set(...definition.scale);
  prototype.updateMatrixWorld(true);
  decorPrototypes.set(type, prototype);
  return prototype;
}

function makeDecorVisual(type: ApartmentDecorType, color: string): THREE.Group {
  const visual = decorPrototype(type).clone(true);
  const tint = new THREE.Color(color);
  visual.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (type === "curtains") child.scale.z *= 1.45;
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
  if (z >= 3 && Math.abs(x) < 4) return "Foyer";
  if (Math.abs(x) <= 1.5) return "Hallway";
  if (x < -1.5) return z < 0 ? "Living & dining room" : "Kitchen";
  if (z < -2) return "Bedroom";
  if (z < 3) return "Study";
  return x < 8.2 ? "Bathroom" : "Utility room";
}

function clampX(value: number): number {
  return Math.max(-APARTMENT_WIDTH / 2 + 0.65, Math.min(APARTMENT_WIDTH / 2 - 0.65, value));
}

function clampZ(value: number): number {
  return Math.max(-APARTMENT_DEPTH / 2 + 0.65, Math.min(APARTMENT_DEPTH / 2 - 0.65, value));
}

function normalizeFreeApartmentDecor(items: readonly ApartmentDecorItem[]): ApartmentDecorItem[] {
  return items.map((item) => {
    const free = { ...item };
    // Older saves attached lamps/toasters to a parent and snapped wall decor
    // during every load. Free placement deliberately has no parent relationship.
    delete free.parentUid;
    return free;
  });
}

function DecorItemView({
  item,
  mode,
  selected,
  onSelect,
  onMoveStart,
  onMove,
}: {
  item: ApartmentDecorItem;
  mode: ApartmentMode;
  selected: boolean;
  onSelect(uid: string): void;
  onMoveStart(uid: string): void;
  onMove(uid: string, x: number, z: number): void;
}) {
  type PointerCaptureTarget = EventTarget & {
    setPointerCapture(pointerId: number): void;
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
  };
  const definition = DECOR[item.type];
  const visual = useMemo(
    () => definition.model ? null : makeDecorVisual(item.type, item.color),
    [definition.model, item.color, item.type],
  );
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const grabOffset = useRef<readonly [number, number]>([0, 0]);
  const activePointer = useRef<number | null>(null);
  const capturedTarget = useRef<PointerCaptureTarget | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => () => {
    visual?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [visual]);

  const elevation = definition.elevation ?? 0;
  const visualNode = definition.model
    ? <AssetModel model={definition.model} />
    : <primitive object={visual!} />;

  const down = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "decorate" || event.button !== 0) return;
    event.stopPropagation();
    AudioManager.click();
    onSelect(item.uid);
    onMoveStart(item.uid);
    // Keep the exact point that was grabbed under the cursor. Without this,
    // the first pointer-move teleported the object's centre to the mouse and
    // felt like another form of snapping even after grid snapping was removed.
    if (event.ray.intersectPlane(plane, point)) {
      grabOffset.current = [item.x - point.x, item.z - point.z];
    } else {
      grabOffset.current = [0, 0];
    }
    activePointer.current = event.pointerId;
    const target = event.target as PointerCaptureTarget | null;
    target?.setPointerCapture(event.pointerId);
    capturedTarget.current = target;
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "decorate" || activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    if (event.ray.intersectPlane(plane, point)) {
      onMove(
        item.uid,
        clampX(point.x + grabOffset.current[0]),
        clampZ(point.z + grabOffset.current[1]),
      );
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
            position={[0, elevation + definition.size[1] / 2, 0]}
          />
        )}
        <group position={[0, elevation, 0]}>{visualNode}</group>
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
      onPointerEnter={() => mode === "decorate" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <group position={[0, elevation, 0]}>{visualNode}</group>
      <mesh position={[0, elevation + definition.size[1] / 2, 0]}>
        <boxGeometry args={definition.size} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(selected || hovered) && (
        <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius, radius + 0.08, 40]} />
          <meshBasicMaterial color={hovered && !selected ? "#79aee8" : "#57dfa1"} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

function WallRun({
  wall,
  style,
  player,
}: {
  wall: WallSpec;
  style: ApartmentStyle;
  player: React.RefObject<RapierRigidBody | null>;
}) {
  const wallMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const baseMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const capMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const size = wall.axis === "x"
    ? [wall.length, WALL_HEIGHT, WALL_THICKNESS] as const
    : [WALL_THICKNESS, WALL_HEIGHT, wall.length] as const;
  const baseRail = wall.axis === "x"
    ? [wall.length, 0.1, WALL_THICKNESS + 0.035] as const
    : [WALL_THICKNESS + 0.035, 0.1, wall.length] as const;
  const topRail = wall.axis === "x"
    ? [wall.length, 0.045, WALL_THICKNESS + 0.018] as const
    : [WALL_THICKNESS + 0.018, 0.045, wall.length] as const;
  const capColor = useMemo(
    () => new THREE.Color(style.wallColor).lerp(new THREE.Color(style.trimColor), 0.12),
    [style.trimColor, style.wallColor],
  );
  const baseColor = useMemo(
    () => new THREE.Color(style.wallColor).lerp(new THREE.Color(style.trimColor), 0.72),
    [style.trimColor, style.wallColor],
  );

  useFrame(({ camera }, delta) => {
    const body = player.current;
    if (!body) return;
    const position = body.translation();
    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;
    const toPlayerX = position.x - cameraX;
    const toPlayerZ = position.z - cameraZ;
    const distance = Math.hypot(toPlayerX, toPlayerZ);
    if (distance < 0.01) return;
    const directionX = toPlayerX / distance;
    const directionZ = toPlayerZ / distance;
    const toWallX = wall.x - cameraX;
    const toWallZ = wall.z - cameraZ;
    const projection = toWallX * directionX + toWallZ * directionZ;
    const perpendicular = Math.abs(toWallX * directionZ - toWallZ * directionX);
    const obstructs = projection > -0.2
      && projection < distance + 1.2
      && perpendicular < wall.length / 2 + 3.2;
    const targetOpacity = obstructs ? 0.07 : 1;
    const blend = 1 - Math.exp(-12 * delta);
    for (const material of [wallMaterial.current, baseMaterial.current, capMaterial.current]) {
      if (!material) continue;
      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, blend);
      material.transparent = material.opacity < 0.995;
      material.depthWrite = material.opacity >= 0.995;
    }
  });

  return (
    <group position={[wall.x, 0, wall.z]}>
      <mesh position={[0, WALL_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial ref={wallMaterial} color={style.wallColor} roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.075, 0]} castShadow>
        <boxGeometry args={baseRail} />
        <meshStandardMaterial ref={baseMaterial} color={baseColor} roughness={0.7} />
      </mesh>
      <mesh position={[0, WALL_HEIGHT - 0.025, 0]} castShadow>
        <boxGeometry args={topRail} />
        <meshStandardMaterial ref={capMaterial} color={capColor} roughness={0.8} />
      </mesh>
    </group>
  );
}

function Doorway({ door, style }: { door: DoorSpec; style: ApartmentStyle }) {
  const width = 1.2;
  const height = 2.28;
  const turn = door.axis === "x" ? Math.PI / 2 : 0;
  const frameColor = useMemo(
    () => new THREE.Color(style.wallColor).lerp(new THREE.Color(style.trimColor), 0.38),
    [style.trimColor, style.wallColor],
  );
  return (
    <group position={[door.x, 0, door.z]} rotation={[0, turn, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, height / 2, side * width / 2]} castShadow>
          <boxGeometry args={[0.28, height, 0.13]} />
          <meshStandardMaterial color={frameColor} roughness={0.68} />
        </mesh>
      ))}
      <mesh position={[0, height, 0]} castShadow>
        <boxGeometry args={[0.28, 0.16, width + 0.13]} />
        <meshStandardMaterial color={frameColor} roughness={0.68} />
      </mesh>
    </group>
  );
}

function WindowUnit({
  axis,
  x,
  z,
  style,
}: {
  axis: "x" | "z";
  x: number;
  z: number;
  style: ApartmentStyle;
}) {
  const turn = axis === "x" ? 0 : Math.PI / 2;
  const frameColor = useMemo(
    () => new THREE.Color(style.wallColor).lerp(new THREE.Color(style.trimColor), 0.55),
    [style.trimColor, style.wallColor],
  );
  return (
    <group position={[x, 1.75, z]} rotation={[0, turn, 0]}>
      <mesh>
        <boxGeometry args={[2.2, 1.35, 0.08]} />
        <meshStandardMaterial color="#9ddfff" roughness={0.18} metalness={0.04} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`v-${side}`} position={[side * 1.13, 0, 0.055]}>
          <boxGeometry args={[0.13, 1.55, 0.12]} />
          <meshStandardMaterial color={frameColor} roughness={0.68} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`h-${side}`} position={[0, side * 0.74, 0.055]}>
          <boxGeometry args={[2.38, 0.13, 0.12]} />
          <meshStandardMaterial color={frameColor} roughness={0.68} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.09, 1.35, 0.1]} />
        <meshStandardMaterial color={frameColor} roughness={0.68} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[2.2, 0.09, 0.1]} />
        <meshStandardMaterial color={frameColor} roughness={0.68} />
      </mesh>
    </group>
  );
}

const FLOOR_ZONES = [
  { id: "living", center: [-7.2, -4.3], size: [11.2, 8.4], tint: 0x8a5b38, blend: 0.12, pattern: "wood" },
  { id: "kitchen", center: [-8.45, 4.3], size: [8.7, 8.4], tint: 0xf2d5a0, blend: 0.34, pattern: "tile" },
  { id: "hall", center: [0, 0], size: [2.8, 6], tint: 0xb8854f, blend: 0.1, pattern: "wood" },
  { id: "foyer", center: [0, 5.8], size: [7.8, 5.5], tint: 0xc18e54, blend: 0.1, pattern: "wood" },
  { id: "bedroom", center: [7.2, -5.3], size: [11.2, 6.4], tint: 0xa86c62, blend: 0.11, pattern: "wood" },
  { id: "study", center: [7.2, 0.5], size: [11.2, 4.8], tint: 0x745a43, blend: 0.14, pattern: "wood" },
  { id: "bathroom", center: [6.1, 5.8], size: [4, 5.5], tint: 0xb9e8ee, blend: 0.72, pattern: "tile" },
  { id: "utility", center: [10.5, 5.8], size: [4.4, 5.5], tint: 0x9ba1ad, blend: 0.58, pattern: "tile" },
] as const;

function FloorPattern({ zone }: { zone: (typeof FLOOR_ZONES)[number] }) {
  const seamColor = zone.pattern === "wood" ? "#8e633f" : "#fff8e8";
  const lines = zone.pattern === "wood"
    ? Array.from({ length: Math.floor(zone.size[0] / 0.72) }, (_, index) => ({
        key: `wood-${index}`,
        x: -zone.size[0] / 2 + (index + 1) * 0.72,
        z: 0,
        width: 0.018,
        depth: zone.size[1],
      }))
    : [
        ...Array.from({ length: Math.floor(zone.size[0] / 1.05) }, (_, index) => ({
          key: `tile-x-${index}`,
          x: -zone.size[0] / 2 + (index + 1) * 1.05,
          z: 0,
          width: 0.024,
          depth: zone.size[1],
        })),
        ...Array.from({ length: Math.floor(zone.size[1] / 1.05) }, (_, index) => ({
          key: `tile-z-${index}`,
          x: 0,
          z: -zone.size[1] / 2 + (index + 1) * 1.05,
          width: zone.size[0],
          depth: 0.024,
        })),
      ];
  return (
    <group position={[zone.center[0], 0.024, zone.center[1]]}>
      {lines.map((line) => (
        <mesh key={line.key} position={[line.x, 0, line.z]} raycast={() => null}>
          <boxGeometry args={[line.width, 0.009, line.depth]} />
          <meshBasicMaterial color={seamColor} transparent opacity={zone.pattern === "wood" ? 0.34 : 0.58} />
        </mesh>
      ))}
    </group>
  );
}

function ApartmentWorld({
  decor,
  style,
  mode,
  selectedUid,
  onSelect,
  onMoveStart,
  onMove,
  player,
}: {
  decor: readonly ApartmentDecorItem[];
  style: ApartmentStyle;
  mode: ApartmentMode;
  selectedUid: string | null;
  onSelect(uid: string | null): void;
  onMoveStart(uid: string): void;
  onMove(uid: string, x: number, z: number): void;
  player: React.RefObject<RapierRigidBody | null>;
}) {
  return (
    <>
      <color attach="background" args={["#bfeaff"]} />
      <mesh position={[0, -0.12, 0]} receiveShadow onPointerDown={() => mode === "decorate" && onSelect(null)}>
        <boxGeometry args={[APARTMENT_WIDTH, 0.24, APARTMENT_DEPTH]} />
        <meshStandardMaterial color={style.floorColor} roughness={0.9} />
      </mesh>
      {FLOOR_ZONES.map((zone) => {
        const color = new THREE.Color(style.floorColor).lerp(new THREE.Color(zone.tint), zone.blend);
        return (
          <group key={zone.id}>
            <mesh position={[zone.center[0], 0.006, zone.center[1]]} receiveShadow>
              <boxGeometry args={[zone.size[0], 0.025, zone.size[1]]} />
              <meshStandardMaterial color={color} roughness={0.86} />
            </mesh>
            <FloorPattern zone={zone} />
          </group>
        );
      })}
      {WALLS.map((wall) => <WallRun key={wall.id} wall={wall} style={style} player={player} />)}
      {DOORS.map((door) => <Doorway key={door.id} door={door} style={style} />)}
      <WindowUnit axis="x" x={-8.6} z={-8.49} style={style} />
      <WindowUnit axis="x" x={0} z={-8.49} style={style} />
      <WindowUnit axis="x" x={7.4} z={-8.49} style={style} />
      <WindowUnit axis="z" x={-12.79} z={4.4} style={style} />
      <WindowUnit axis="z" x={12.79} z={0.4} style={style} />
      <group position={[0, 0, 8.48]}>
        <mesh position={[0, 1.25, 0]} castShadow>
          <boxGeometry args={[1.5, 2.45, 0.11]} />
          <meshStandardMaterial color="#d97835" roughness={0.68} />
        </mesh>
        {[0.68, 1.55].map((y) => (
          <mesh key={y} position={[0, y, -0.065]}>
            <boxGeometry args={[1.12, 0.56, 0.045]} />
            <meshStandardMaterial color="#f0a25f" roughness={0.76} />
          </mesh>
        ))}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.82, 1.25, 0]}>
            <boxGeometry args={[0.14, 2.65, 0.17]} />
            <meshStandardMaterial color={style.wallColor} roughness={0.76} />
          </mesh>
        ))}
        <mesh position={[0, 2.53, 0]}>
          <boxGeometry args={[1.78, 0.14, 0.17]} />
          <meshStandardMaterial color={style.wallColor} roughness={0.76} />
        </mesh>
        <mesh position={[0.5, 1.22, -0.14]}>
          <sphereGeometry args={[0.075, 12, 8]} />
          <meshStandardMaterial color="#ffd84d" metalness={0.3} roughness={0.34} />
        </mesh>
      </group>
      <pointLight position={[-7.5, 2.35, -3.8]} color="#ffd8a8" intensity={0.72} distance={8} decay={2} />
      <pointLight position={[-8.2, 2.35, 4.8]} color="#ffe6b8" intensity={0.68} distance={7} decay={2} />
      <pointLight position={[7.2, 2.35, -5.2]} color="#ffd0b6" intensity={0.68} distance={7} decay={2} />
      <pointLight position={[7.2, 2.35, 0.5]} color="#cfe9ff" intensity={0.58} distance={7} decay={2} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APARTMENT_WIDTH / 2, 0.1, APARTMENT_DEPTH / 2]} position={[0, -0.1, 0]} friction={0.9} />
        {WALLS.map((wall) => (
          <CuboidCollider
            key={wall.id}
            args={wall.axis === "x"
              ? [wall.length / 2, WALL_HEIGHT / 2, WALL_THICKNESS / 2]
              : [WALL_THICKNESS / 2, WALL_HEIGHT / 2, wall.length / 2]}
            position={[wall.x, WALL_HEIGHT / 2, wall.z]}
          />
        ))}
      </RigidBody>
      {decor.map((item) => (
        <DecorItemView
          key={item.uid}
          item={item}
          mode={mode}
          selected={selectedUid === item.uid}
          onSelect={onSelect}
          onMoveStart={onMoveStart}
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
  style,
  selectedUid,
  onSelect,
  onMoveDecorStart,
  onMoveDecor,
  onMoveRunner,
  onFall,
}: {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  attemptSerial: number;
  mode: ApartmentMode;
  decor: readonly ApartmentDecorItem[];
  style: ApartmentStyle;
  selectedUid: string | null;
  onSelect(uid: string | null): void;
  onMoveDecorStart(uid: string): void;
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
      <Lighting interior />
      <ApartmentWorld
        decor={decor}
        style={style}
        mode={mode}
        selectedUid={selectedUid}
        onSelect={onSelect}
        onMoveStart={onMoveDecorStart}
        onMove={onMoveDecor}
        player={player}
      />
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
        chaseDistance={mode === "decorate" ? 10.6 : 8.2}
        chaseHeight={mode === "decorate" ? 9.8 : 7.2}
        chaseLookAhead={mode === "decorate" ? 1.2 : 2.2}
        chaseTargetHeight={mode === "decorate" ? 0 : 0.25}
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
  const [room, setRoom] = useState("Hallway");
  const [mode, setMode] = useState<ApartmentMode>("explore");
  const [attemptSerial, setAttemptSerial] = useState(1);
  const [runnerPosition, setRunnerPosition] = useState({ x: 0, z: 0 });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [catalogGroup, setCatalogGroup] = useState<(typeof DECOR_GROUPS)[number]["id"]>("all");
  const [undoDecor, setUndoDecor] = useState<ApartmentDecorItem[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [decor, setDecor] = useState<ApartmentDecorItem[]>(() => (
    normalizeFreeApartmentDecor(typeof window === "undefined"
      ? DEFAULT_APARTMENT_DECOR.map((item) => ({ ...item }))
      : loadApartmentDecor(window.localStorage))
  ));
  const [style, setStyle] = useState<ApartmentStyle>(() => (
    typeof window === "undefined" ? { ...DEFAULT_APARTMENT_STYLE } : loadApartmentStyle(window.localStorage)
  ));
  const idSerial = useRef(0);
  const guideButtonRef = useRef<HTMLButtonElement>(null);

  const persistNow = useCallback(() => {
    try {
      saveApartmentDecor(window.localStorage, decor);
      saveApartmentStyle(window.localStorage, style);
      setSaveError(null);
      return true;
    } catch {
      setSaveError("Couldn’t save on this device");
      return false;
    }
  }, [decor, style]);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    window.setTimeout(() => guideButtonRef.current?.focus(), 0);
  }, []);

  const closeApartment = useCallback(() => {
    persistNow();
    onClose();
  }, [onClose, persistNow]);

  useEffect(() => {
    resetCameraYaw(trackFacingYaw(APARTMENT_TRACK));
    const down = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (guideOpen) closeGuide();
      else closeApartment();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [closeApartment, closeGuide, guideOpen]);

  useEffect(() => {
    if (mode === "decorate") resetInput();
  }, [mode]);

  useEffect(() => {
    const timer = window.setTimeout(persistNow, 180);
    return () => window.clearTimeout(timer);
  }, [persistNow]);

  useEffect(() => {
    const flush = () => { persistNow(); };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [persistNow]);

  const onMoveRunner = useCallback((x: number, z: number) => {
    const next = roomAt(x, z);
    setRoom((current) => current === next ? current : next);
    setRunnerPosition((current) => (
      Math.abs(current.x - x) < 0.2 && Math.abs(current.z - z) < 0.2 ? current : { x, z }
    ));
  }, []);

  const updateItem = useCallback((uid: string, update: Partial<ApartmentDecorItem>) => {
    setDecor((current) => {
      const original = current.find((item) => item.uid === uid);
      if (!original) return current;
      return current.map((item) => item.uid === uid ? { ...original, ...update } : item);
    });
  }, []);

  const rememberUndo = useCallback(() => {
    setUndoDecor(decor.map((item) => ({ ...item })));
  }, [decor]);

  const moveDecor = useCallback((uid: string, x: number, z: number) => {
    setDecor((current) => current.map((candidate) => {
      if (candidate.uid !== uid) return candidate;
      const moved = { ...candidate, x, z };
      // Nothing in decorate mode owns anything else now. Pieces can overlap,
      // cross one another, and remain exactly where the player drags them.
      delete moved.parentUid;
      return moved;
    }));
  }, []);

  const addItem = (type: ApartmentDecorType) => {
    if (decor.length >= MAX_APARTMENT_ITEMS) return;
    let uid: string;
    do {
      idSerial.current += 1;
      uid = `user-${type}-${idSerial.current}`;
    } while (decor.some((item) => item.uid === uid));
    const anchorKind = apartmentAnchorKind(type);
    const offset = ((decor.length + idSerial.current) % 5 - 2) * 0.5;
    const item: ApartmentDecorItem = {
      uid,
      type,
      x: clampX(runnerPosition.x + 2.6),
      z: clampZ(runnerPosition.z + offset),
      rotation: 0,
      color: "#68b78a",
      anchorKind,
    };
    rememberUndo();
    setDecor((current) => [...current, item]);
    setSelectedUid(item.uid);
  };

  const selected = decor.find((item) => item.uid === selectedUid) ?? null;
  const activeGroup = DECOR_GROUPS.find((group) => group.id === catalogGroup) ?? DECOR_GROUPS[0];
  const press = (key: "forward" | "backward" | "left" | "right", active: boolean) => setKey(key, active);

  const editSelected = (update: Partial<ApartmentDecorItem>) => {
    if (!selected) return;
    rememberUndo();
    updateItem(selected.uid, update);
  };

  const removeSelected = () => {
    if (!selected) return;
    rememberUndo();
    setDecor((current) => current.filter((item) => item.uid !== selected.uid && item.parentUid !== selected.uid));
    setSelectedUid(null);
  };

  const duplicateSelected = () => {
    if (!selected || decor.length >= MAX_APARTMENT_ITEMS) return;
    let uid: string;
    do {
      idSerial.current += 1;
      uid = `user-${selected.type}-${idSerial.current}`;
    } while (decor.some((item) => item.uid === uid));
    const duplicate: ApartmentDecorItem = {
      ...selected,
      uid,
      x: clampX(selected.x + 0.8),
      z: clampZ(selected.z + 0.8),
    };
    delete duplicate.parentUid;
    rememberUndo();
    setDecor((current) => [...current, duplicate]);
    setSelectedUid(uid);
  };

  const restoreStarter = () => {
    if (!window.confirm("Restore the starter apartment? Your current furniture layout will be replaced.")) return;
    rememberUndo();
    setDecor(normalizeFreeApartmentDecor(DEFAULT_APARTMENT_DECOR));
    setStyle({ ...DEFAULT_APARTMENT_STYLE });
    setSelectedUid(null);
  };

  const undoLastEdit = () => {
    if (!undoDecor) return;
    setDecor(undoDecor.map((item) => ({ ...item })));
    setUndoDecor(null);
    setSelectedUid(null);
  };

  return (
    <main className={`avatar-apartment ${mode === "decorate" ? "is-decorating" : ""}`}>
      <Canvas
        aria-label="Your modular permanent apartment"
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
              style={style}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
              onMoveDecorStart={() => {
                rememberUndo();
              }}
              onMoveDecor={moveDecor}
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
          <button ref={guideButtonRef} className="button secondary apartment-guide-button" onClick={() => setGuideOpen(true)} aria-label="Apartment controls">?</button>
          <button className={`button ${mode === "explore" ? "primary" : "secondary"}`} onClick={() => setMode("explore")}>🏃 Explore</button>
          <button className={`button ${mode === "decorate" ? "primary" : "secondary"}`} onClick={() => setMode("decorate")}>🛋️ Decorate</button>
          <button className="button secondary" onClick={closeApartment}>↩️ Back to menu</button>
        </nav>
      </header>

      {mode === "decorate" && (
        <aside className="avatar-apartment-decor" aria-label="Apartment furniture">
          <div className="avatar-apartment-decor-heading">
            <span className="eyebrow">🛋️ DECORATE</span>
            <button onClick={undoLastEdit} disabled={!undoDecor}>↶ Undo</button>
          </div>
          {saveError && <small className="avatar-apartment-save-error">⚠️ {saveError}</small>}
          {selected && (
            <section className="avatar-apartment-selection avatar-apartment-selection-sticky">
              <strong>{DECOR[selected.type].emoji} {DECOR[selected.type].label}</strong>
              <small>Free placement</small>
              {DECOR[selected.type].tintable !== false && (
                <label>Color <input type="color" value={selected.color} onChange={(event) => editSelected({ color: event.target.value })} /></label>
              )}
              <div>
                <button onClick={() => editSelected({ rotation: selected.rotation - Math.PI / 12 })}>↶ 15°</button>
                <button onClick={() => editSelected({ rotation: selected.rotation + Math.PI / 12 })}>↷ 15°</button>
                <button onClick={duplicateSelected} disabled={decor.length >= MAX_APARTMENT_ITEMS}>📄 Duplicate</button>
                <button className="danger" onClick={removeSelected}>🗑️ Remove</button>
              </div>
            </section>
          )}
          <div className="avatar-apartment-catalog-heading">
            <span className="eyebrow">ADD FURNITURE</span>
            <small>{decor.length}/{MAX_APARTMENT_ITEMS}</small>
          </div>
          <div className="avatar-apartment-groups" aria-label="Furniture groups">
            {DECOR_GROUPS.map((group) => (
              <button
                key={group.id}
                className={group.id === activeGroup.id ? "active" : ""}
                onClick={() => setCatalogGroup(group.id)}
              >{group.label}</button>
            ))}
          </div>
          <div className="avatar-apartment-decor-grid">
            {activeGroup.types.map((type) => {
              const definition = DECOR[type];
              return (
              <button key={type} onClick={() => addItem(type)} disabled={decor.length >= MAX_APARTMENT_ITEMS}>
                <span>{definition.emoji}</span>{definition.label}
              </button>
              );
            })}
          </div>
          <details className="avatar-apartment-colors">
            <summary>🎨 Apartment colors</summary>
            <section className="avatar-apartment-selection">
              <label>Walls <input type="color" value={style.wallColor} onChange={(event) => setStyle((current) => ({ ...current, wallColor: event.target.value }))} /></label>
              <label>Trim <input type="color" value={style.trimColor} onChange={(event) => setStyle((current) => ({ ...current, trimColor: event.target.value }))} /></label>
              <label>Floors <input type="color" value={style.floorColor} onChange={(event) => setStyle((current) => ({ ...current, floorColor: event.target.value }))} /></label>
            </section>
          </details>
          <button className="avatar-apartment-reset" onClick={restoreStarter}>↺ Restore starter layout</button>
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
            <p><b>Decorate:</b> Left-drag any item freely. Nothing snaps to a grid, wall, or another piece of furniture. Right-drag turns the camera.</p>
            <p><b>Organize:</b> Pieces can overlap and pass one another. Select any piece to recolor, turn, duplicate, or remove it.</p>
            <p><b>Permanent home:</b> Furniture positions and apartment colors save automatically on this device.</p>
            <button className="button primary" onClick={closeGuide}>Got it</button>
          </section>
        </div>
      )}
    </main>
  );
}
