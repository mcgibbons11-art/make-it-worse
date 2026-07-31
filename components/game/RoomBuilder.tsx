"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import GameCanvas from "./GameCanvas";
import { TrapPreviewProp } from "./placement/TrapPreview";
import { TrapIcon } from "@/components/icons/TrapIcon";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { createSeededRandom, hashString } from "@/lib/game/seed";
import { AudioManager } from "@/lib/audio/AudioManager";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ChallengeDTO, DecodedGhostSample, HazardContact, TrapInstance, TrapType } from "@/lib/game/types";
import type { BuiltTrack } from "@/lib/game/track";

export type BuilderPieceKind = "platform" | "wide-platform" | "beam" | "step" | "ramp" | "spawn" | "finish";
export type BuilderAsset = BuilderPieceKind | `trap:${TrapType}`;
export interface RoomItem {
  uid: number;
  asset: BuilderAsset;
  x: number;
  y: number;
  z: number;
  rotation: number;
  rotationX?: number;
  rotationZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  color: string;
}

interface PublishedMap {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  schemaVersion: 2;
  items: RoomItem[];
}

const STORE_KEY = "miw.room-builder.v2";
const PUBLISHED_KEY = "miw.published-maps.v1";
const SNAP = 0.25;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;
const itemScale = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0.1, Math.abs(value!)) : 1;
const itemRotation = (value: number | undefined) =>
  Number.isFinite(value) ? value! : 0;
const transformDefaults = {
  rotationX: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
} as const;
const isTrapAsset = (asset: BuilderAsset): asset is `trap:${TrapType}` => asset.startsWith("trap:");
const trapTypeOf = (asset: `trap:${TrapType}`) => asset.slice(5) as TrapType;

const PIECES: readonly { asset: BuilderPieceKind; emoji: string; label: string; color: string }[] = [
  { asset: "platform", emoji: "🟨", label: "Game platform", color: PALETTE.yellow },
  { asset: "wide-platform", emoji: "🟦", label: "Wide platform", color: PALETTE.blue },
  { asset: "beam", emoji: "➖", label: "Narrow beam", color: PALETTE.purple },
  { asset: "step", emoji: "🟧", label: "Raised step", color: PALETTE.orange },
  { asset: "ramp", emoji: "📐", label: "Game ramp", color: PALETTE.green },
  { asset: "spawn", emoji: "🏁", label: "Spawn point", color: PALETTE.yellow },
  { asset: "finish", emoji: "🚪", label: "Game end gate", color: PALETTE.green },
];
const BUILDABLE_PIECES = PIECES.filter((entry) => entry.asset !== "spawn" && entry.asset !== "finish");
const isRequiredEndpoint = (asset: BuilderAsset) => asset === "spawn" || asset === "finish";

export function roomBuilderShortcutAction(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey">,
  blocked: boolean,
): "delete" | "copy" | "paste" | "undo" | "redo" | null {
  if (blocked || event.repeat) return null;
  if (event.key === "Delete") return "delete";
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === "KeyC"
  ) return "copy";
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === "KeyV"
  ) return "paste";
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.code === "KeyZ"
  ) return event.shiftKey ? "redo" : "undo";
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === "KeyY"
  ) return "redo";
  return null;
}

function isBuilderTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

const pieceInfo = (asset: BuilderPieceKind) => PIECES.find((entry) => entry.asset === asset)!;
const defaultColor = (asset: BuilderAsset) => isTrapAsset(asset) ? PALETTE.orange : pieceInfo(asset).color;
const assetLabel = (asset: BuilderAsset) => isTrapAsset(asset) ? TRAP_CATALOG[trapTypeOf(asset)].displayName : pieceInfo(asset).label;

function loadItems(): RoomItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is RoomItem => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<RoomItem>;
      return typeof item.uid === "number" && typeof item.asset === "string" &&
        (PIECES.some((entry) => entry.asset === item.asset) ||
          (item.asset.startsWith("trap:") && (TRAP_TYPES as readonly string[]).includes(item.asset.slice(5))));
    }).map((item) => ({
      ...transformDefaults,
      ...item,
      y: Number.isFinite(item.y) ? item.y : 0,
      rotationX: itemRotation(item.rotationX),
      rotationZ: itemRotation(item.rotationZ),
      scaleX: itemScale(item.scaleX),
      scaleY: itemScale(item.scaleY),
      scaleZ: itemScale(item.scaleZ),
      color: item.color || defaultColor(item.asset),
    }));
  } catch {
    return [];
  }
}

function loadPublished(): PublishedMap[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(PUBLISHED_KEY) ?? "[]") as PublishedMap[];
    return Array.isArray(value) ? value.filter((map) => map?.schemaVersion === 2 && Array.isArray(map.items)) : [];
  } catch {
    return [];
  }
}

function roomIdentity(items: readonly RoomItem[]): number {
  return hashString(JSON.stringify(items.map((item) => [
    item.asset,
    item.x,
    item.y,
    item.z,
    item.rotation,
    item.color,
    item.rotationX ?? 0,
    item.rotationZ ?? 0,
    item.scaleX ?? 1,
    item.scaleY ?? 1,
    item.scaleZ ?? 1,
  ])));
}

/** A clean level now uses the same primitives and traps exposed to builders. */
export function generateRandomRoom(seed: number): RoomItem[] {
  const random = createSeededRandom(seed);
  const courseColors = [PALETTE.yellow, PALETTE.blue, PALETTE.purple, PALETTE.orange, PALETTE.green, PALETTE.cream] as const;
  const randomCourseColor = () => courseColors[Math.floor(random() * courseColors.length)]!;
  let uid = 1;
  const add = (asset: BuilderAsset, x: number, y: number, z: number, rotation = 0, color = defaultColor(asset)) => ({
    uid: uid++, asset, x: snap(x), y: snap(y), z: snap(z), rotation, color, ...transformDefaults,
  });
  const items: RoomItem[] = [add("spawn", 0, 0, 2), add("platform", 0, 0, 2, 0, randomCourseColor())];
  let z = -1;
  let y = 0;
  for (let index = 0; index < 7; index += 1) {
    z -= 3 + random() * 2;
    y = Math.max(0, y + (random() > 0.58 ? (random() > 0.5 ? 0.5 : -0.5) : 0));
    const asset: BuilderPieceKind = random() > 0.82 ? "beam" : random() > 0.64 ? "wide-platform" : "platform";
    items.push(add(asset, (random() - 0.5) * 5, y, z, random() > 0.75 ? Math.PI / 2 : 0, randomCourseColor()));
    if (random() > 0.38) {
      const type = TRAP_TYPES[Math.floor(random() * TRAP_TYPES.length)]!;
      items.push(add(`trap:${type}`, items.at(-1)!.x, y + 0.08, z));
    }
  }
  items.push(add("finish", items.at(-1)!.x, y, z - 1));
  return items;
}

type PlatformSpec = { width: number; depth: number; thickness: number; rotationX?: number };
function platformSpec(asset: BuilderAsset): PlatformSpec | null {
  switch (asset) {
    case "platform": return { width: 4, depth: 3, thickness: 0.65 };
    case "wide-platform": return { width: 7, depth: 4, thickness: 0.8 };
    case "beam": return { width: 1.25, depth: 5, thickness: 0.55 };
    case "step": return { width: 3, depth: 2.5, thickness: 1.25 };
    case "ramp": return { width: 3.2, depth: 4.5, thickness: 0.55, rotationX: -0.16 };
    default: return null;
  }
}

function orientedPlatformSpec(item: RoomItem): PlatformSpec | null {
  const spec = platformSpec(item.asset);
  if (!spec) return null;
  const scaledWidth = spec.width * itemScale(item.scaleX);
  const scaledDepth = spec.depth * itemScale(item.scaleZ);
  const cosine = Math.abs(Math.cos(item.rotation));
  const sine = Math.abs(Math.sin(item.rotation));
  return {
    ...spec,
    width: scaledWidth * cosine + scaledDepth * sine,
    depth: scaledWidth * sine + scaledDepth * cosine,
    thickness: spec.thickness * itemScale(item.scaleY),
    rotationX: (spec.rotationX ?? 0) + itemRotation(item.rotationX),
  };
}

function ensureRequiredEndpoints(source: readonly RoomItem[]): RoomItem[] {
  const items = source.filter((item, index) =>
    !isRequiredEndpoint(item.asset) || source.findIndex((candidate) => candidate.asset === item.asset) === index,
  ).map((item) => ({ ...item }));
  let nextUid = Math.max(0, ...items.map((item) => item.uid)) + 1;
  let platforms = items.filter((item) => platformSpec(item.asset));
  if (platforms.length === 0) {
    const startBlock: RoomItem = { uid: nextUid++, asset: "platform", x: 0, y: 0, z: 2, rotation: 0, color: defaultColor("platform"), ...transformDefaults };
    const finishBlock: RoomItem = { uid: nextUid++, asset: "platform", x: 0, y: 0, z: -6, rotation: 0, color: defaultColor("platform"), ...transformDefaults };
    items.push(startBlock, finishBlock);
    platforms = [startBlock, finishBlock];
  }
  if (!items.some((item) => item.asset === "spawn")) {
    const support = platforms[0]!;
    items.push({ uid: nextUid++, asset: "spawn", x: support.x, y: support.y, z: support.z, rotation: 0, color: defaultColor("spawn"), ...transformDefaults });
  }
  if (!items.some((item) => item.asset === "finish")) {
    const support = platforms.at(-1)!;
    items.push({ uid: nextUid++, asset: "finish", x: support.x, y: support.y, z: support.z, rotation: 0, color: defaultColor("finish"), ...transformDefaults });
  }
  return items;
}

const GRAVITY = 9.81 * PLAYER.gravityScale;
const JUMP_RISE = (PLAYER.jumpVelocity ** 2) / (2 * GRAVITY) * 0.72;
const JUMP_DISTANCE = PLAYER.moveSpeed * (2 * PLAYER.jumpVelocity / GRAVITY) * 0.9;

/** Returns the platform uids not connected to the builder's spawn by a feasible jump. */
export function unreachablePlatformIds(items: readonly RoomItem[]): Set<number> {
  const surfaces = items.flatMap((item) => {
    const spec = orientedPlatformSpec(item);
    return spec ? [{ item, spec }] : [];
  });
  const spawn = items.find((item) => item.asset === "spawn");
  if (!spawn || surfaces.length === 0) return new Set(surfaces.map(({ item }) => item.uid));
  const start = surfaces.reduce((best, candidate) => {
    const distance = Math.hypot(candidate.item.x - spawn.x, candidate.item.z - spawn.z);
    return distance < best.distance ? { uid: candidate.item.uid, distance } : best;
  }, { uid: surfaces[0]!.item.uid, distance: Number.POSITIVE_INFINITY }).uid;
  const reached = new Set<number>([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const from of surfaces.filter(({ item }) => reached.has(item.uid))) {
      for (const to of surfaces.filter(({ item }) => !reached.has(item.uid))) {
        const rise = to.item.y - from.item.y;
        if (rise > JUMP_RISE) continue;
        const dx = Math.max(0, Math.abs(to.item.x - from.item.x) - (from.spec.width + to.spec.width) / 2);
        const dz = Math.max(0, Math.abs(to.item.z - from.item.z) - (from.spec.depth + to.spec.depth) / 2);
        const gap = Math.hypot(dx, dz);
        const allowed = rise < -1 ? JUMP_DISTANCE * 1.4 : JUMP_DISTANCE;
        if (gap <= allowed) { reached.add(to.item.uid); changed = true; }
      }
    }
  }
  return new Set(surfaces.filter(({ item }) => !reached.has(item.uid)).map(({ item }) => item.uid));
}

function GamePlatform({ item, warning, selected }: { item: RoomItem; warning: boolean; selected: boolean }) {
  const spec = platformSpec(item.asset)!;
  const bodyColor = warning ? PALETTE.danger : item.color;
  const wash = new THREE.Color(bodyColor).lerp(new THREE.Color(PALETTE.cream), 0.62).getStyle();
  const outlineGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(spec.width + 0.08, 0.08, spec.depth + 0.08);
    const edges = new THREE.EdgesGeometry(box, 15);
    box.dispose();
    return edges;
  }, [spec.depth, spec.width]);
  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry]);
  return (
    <group
      rotation={[
        (spec.rotationX ?? 0) + itemRotation(item.rotationX),
        0,
        itemRotation(item.rotationZ),
      ]}
      scale={[itemScale(item.scaleX), itemScale(item.scaleY), itemScale(item.scaleZ)]}
    >
      <RoundedBox position={[0, -spec.thickness / 2, 0]} args={[spec.width, spec.thickness, spec.depth]} radius={0.14} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color={bodyColor} roughness={0.7} metalness={0.03} />
      </RoundedBox>
      <RoundedBox position={[0, -spec.thickness - 0.08, 0]} args={[spec.width * 0.92, 0.16, spec.depth * 0.92]} radius={0.08} smoothness={2} castShadow>
        <meshStandardMaterial color={PALETTE.ink} roughness={0.78} />
      </RoundedBox>
      <mesh position={[0, 0.02, 0]} receiveShadow><boxGeometry args={[spec.width * 0.995, 0.07, spec.depth * 0.995]} /><meshStandardMaterial color={PALETTE.ink} roughness={0.85} /></mesh>
      <mesh position={[0, 0.055, 0]} receiveShadow><boxGeometry args={[spec.width - 0.26, 0.05, spec.depth - 0.26]} /><meshStandardMaterial color={wash} roughness={0.9} /></mesh>
      {(warning || selected) && (
        <lineSegments position={[0, 0.1, 0]} geometry={outlineGeometry} scale={1.01}>
          <lineBasicMaterial color={warning ? PALETTE.danger : PALETTE.green} />
        </lineSegments>
      )}
    </group>
  );
}

function SpawnMarker() {
  return <group><mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.7, 32]} /><meshBasicMaterial color={PALETTE.yellow} transparent opacity={0.72} /></mesh><mesh position={[0, 0.7, 0]}><coneGeometry args={[0.28, 0.7, 4]} /><meshStandardMaterial color={PALETTE.yellow} /></mesh></group>;
}

function FinishGate({ color }: { color: string }) {
  return <group><mesh position={[-0.95, 1.4, 0]}><boxGeometry args={[0.24, 2.8, 0.35]} /><meshStandardMaterial color={PALETTE.ink} /></mesh><mesh position={[0.95, 1.4, 0]}><boxGeometry args={[0.24, 2.8, 0.35]} /><meshStandardMaterial color={PALETTE.ink} /></mesh><mesh position={[0, 2.68, 0]}><boxGeometry args={[2.15, 0.28, 0.35]} /><meshStandardMaterial color={color} /></mesh><mesh position={[0, 1.35, 0]}><planeGeometry args={[1.65, 2.2]} /><meshBasicMaterial color={color} transparent opacity={0.24} side={THREE.DoubleSide} /></mesh></group>;
}

function numericValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function TransformInspector({ item, onChange }: {
  item: RoomItem;
  onChange(change: Partial<RoomItem>): void;
}) {
  const block = Boolean(platformSpec(item.asset));
  const numberInput = (
    label: string,
    value: number,
    step: number,
    apply: (next: number) => Partial<RoomItem>,
    min?: number,
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        {...(min === undefined ? {} : { min })}
        onChange={(event) => onChange(apply(numericValue(event.target.value, value)))}
      />
    </label>
  );
  return (
    <aside className="room-builder-transform" aria-label={`Transform ${assetLabel(item.asset)}`}>
      <div><strong>↔ Position</strong>{numberInput("X", item.x, 0.25, (x) => ({ x: snap(x) }))}{numberInput("Y", item.y, 0.25, (y) => ({ y: snap(y) }))}{numberInput("Z", item.z, 0.25, (z) => ({ z: snap(z) }))}</div>
      <div><strong>↻ Rotation</strong>{block && numberInput("X°", THREE.MathUtils.radToDeg(itemRotation(item.rotationX)), 5, (value) => ({ rotationX: THREE.MathUtils.degToRad(value) }))}{numberInput("Y°", THREE.MathUtils.radToDeg(item.rotation), 5, (value) => ({ rotation: THREE.MathUtils.degToRad(value) }))}{block && numberInput("Z°", THREE.MathUtils.radToDeg(itemRotation(item.rotationZ)), 5, (value) => ({ rotationZ: THREE.MathUtils.degToRad(value) }))}</div>
      {block && <div><strong>⤢ Scale</strong>{numberInput("X", itemScale(item.scaleX), 0.1, (scaleX) => ({ scaleX: itemScale(scaleX) }), 0.1)}{numberInput("Y", itemScale(item.scaleY), 0.1, (scaleY) => ({ scaleY: itemScale(scaleY) }), 0.1)}{numberInput("Z", itemScale(item.scaleZ), 0.1, (scaleZ) => ({ scaleZ: itemScale(scaleZ) }), 0.1)}</div>}
    </aside>
  );
}

function BuilderItemView({ item, mode, selected, warning, onSelect, onBeginMove, onMove }: {
  item: RoomItem; mode: "build" | "test"; selected: boolean; warning: boolean;
  onSelect(uid: number, additive: boolean): void;
  onBeginMove(uid: number): void;
  onMove(uid: number, x: number, z: number): void;
}) {
  type PointerCaptureTarget = EventTarget & {
    setPointerCapture(pointerId: number): void;
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
  };
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.y), [item.y]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const activePointer = useRef<number | null>(null);
  const capturedTarget = useRef<PointerCaptureTarget | null>(null);
  const dragRadius = isTrapAsset(item.asset)
    ? Math.max(0.7, TRAP_CATALOG[trapTypeOf(item.asset)].placementRadius)
    : item.asset === "finish" ? 1.15 : 0.78;
  const down = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "build" || event.button !== 0) return;
    event.stopPropagation();
    AudioManager.click();
    onSelect(item.uid, event.nativeEvent.shiftKey);
    onBeginMove(item.uid);
    activePointer.current = event.pointerId;
    // R3F keeps its own captured-object map. Capturing only nativeEvent.target
    // captures the HTML canvas but does not keep this Three object in the
    // intersection list once the pointer leaves its visible mesh. A wide block
    // therefore stopped after the first move while the trap's tall invisible
    // handle happened to keep receiving events. Capture the actual R3F target
    // so every asset follows the same drag path.
    const target = event.target as PointerCaptureTarget | null;
    target?.setPointerCapture(event.pointerId);
    capturedTarget.current = target;
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    // Pointer capture belongs to the canvas, not to this mesh. Checking the
    // canvas made every object crossed during a drag believe it was active,
    // so stacked pieces toggled selection and moved together. Only the item
    // that received the original down owns this pointer id.
    if (mode !== "build" || activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    if (event.ray.intersectPlane(dragPlane, point)) onMove(item.uid, snap(point.x), snap(point.z));
  };
  const end = (event: ThreeEvent<PointerEvent>) => {
    if (activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    activePointer.current = null;
    const target = capturedTarget.current;
    capturedTarget.current = null;
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };
  return (
    <group position={[item.x, item.y, item.z]} rotation={[0, item.rotation, 0]} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {!platformSpec(item.asset) && mode === "build" && selected && (
        <mesh name="builder-drag-handle" position={[0, 0.8, 0]}>
          <cylinderGeometry args={[dragRadius, dragRadius, 1.7, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {platformSpec(item.asset) && <GamePlatform item={item} warning={warning} selected={selected} />}
      {item.asset === "spawn" && mode === "build" && <SpawnMarker />}
      {item.asset === "finish" && <FinishGate color={item.color} />}
      {isTrapAsset(item.asset) && <TrapPreviewProp type={trapTypeOf(item.asset)} />}
      {selected && !platformSpec(item.asset) && <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.72, 0.82, 32]} /><meshBasicMaterial color={PALETTE.green} /></mesh>}
    </group>
  );
}

function SceneController({ initialTarget, initialDistance }: {
  initialTarget: readonly [number, number, number];
  initialDistance: number;
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const target = useRef(new THREE.Vector3(...initialTarget));
  const yaw = useRef(0);
  const pitch = useRef(0.82);
  const distance = useRef(initialDistance);
  const orbit = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { keys.current.add(event.key.toLowerCase()); };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.key.toLowerCase()); };
    const pointerDown = (event: PointerEvent) => { if (event.button === 2) orbit.current = { x: event.clientX, y: event.clientY }; };
    const pointerMove = (event: PointerEvent) => { if (!orbit.current) return; yaw.current -= (event.clientX - orbit.current.x) * 0.006; pitch.current = THREE.MathUtils.clamp(pitch.current + (event.clientY - orbit.current.y) * 0.004, -1.3, 1.3); orbit.current = { x: event.clientX, y: event.clientY }; };
    const pointerUp = () => { orbit.current = null; };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    const wheel = (event: WheelEvent) => { distance.current = THREE.MathUtils.clamp(distance.current + event.deltaY * 0.012, 3, 80); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    gl.domElement.addEventListener("pointerdown", pointerDown); gl.domElement.addEventListener("contextmenu", contextMenu); window.addEventListener("pointermove", pointerMove); window.addEventListener("pointerup", pointerUp);
    gl.domElement.addEventListener("wheel", wheel, { passive: true });
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); gl.domElement.removeEventListener("pointerdown", pointerDown); gl.domElement.removeEventListener("contextmenu", contextMenu); window.removeEventListener("pointermove", pointerMove); window.removeEventListener("pointerup", pointerUp); gl.domElement.removeEventListener("wheel", wheel); };
  }, [gl]);

  useFrame((_, deltaRaw) => {
    const delta = Math.min(0.05, deltaRaw);
    const pressed = keys.current;
    const x = Number(pressed.has("d") || pressed.has("arrowright")) - Number(pressed.has("a") || pressed.has("arrowleft"));
    const z = Number(pressed.has("s") || pressed.has("arrowdown")) - Number(pressed.has("w") || pressed.has("arrowup"));
    const y = Number(pressed.has("e") || pressed.has(" ")) - Number(pressed.has("q") || pressed.has("shift"));
    const speed = delta * Math.max(5, distance.current * 0.65);
    target.current.x += (x * Math.cos(yaw.current) + z * Math.sin(yaw.current)) * speed;
    target.current.z += (z * Math.cos(yaw.current) - x * Math.sin(yaw.current)) * speed;
    target.current.y += y * speed;
    const horizontal = Math.cos(pitch.current) * distance.current;
    camera.position.set(target.current.x + Math.sin(yaw.current) * horizontal, target.current.y + Math.sin(pitch.current) * distance.current, target.current.z + Math.cos(yaw.current) * horizontal);
    // The action dock permanently occupies the lower ~130px of the editor.
    // Aim below the navigation target so the actual map is composed in the
    // unobstructed canvas above that dock instead of hiding its near platform
    // behind controls on first open.
    camera.lookAt(target.current.x, target.current.y - 1.5, target.current.z);
  });
  return null;
}

function BuilderScene({ items, mode, selectedUids, onSelect, onBeginMove, onMove }: {
  items: readonly RoomItem[]; mode: "build" | "test"; selectedUids: readonly number[];
  onSelect(uid: number | null, additive?: boolean): void;
  onBeginMove(uid: number): void;
  onMove(uid: number, x: number, z: number): void;
}) {
  const unreachable = useMemo(() => unreachablePlatformIds(items), [items]);
  const [initialView] = useState(() => {
    const platforms = items.filter((item) => Boolean(platformSpec(item.asset)));
    const framed = platforms.length > 0 ? platforms : items;
    if (framed.length === 0)
      return { target: [0, 1, 0] as const, distance: 19 };
    const minX = Math.min(...framed.map((item) => item.x));
    const maxX = Math.max(...framed.map((item) => item.x));
    const minZ = Math.min(...framed.map((item) => item.z));
    const maxZ = Math.max(...framed.map((item) => item.z));
    const averageY = framed.reduce((sum, item) => sum + item.y, 0) / framed.length;
    const extent = Math.max(maxX - minX, maxZ - minZ);
    return {
      target: [(minX + maxX) / 2, averageY + 0.9, (minZ + maxZ) / 2] as const,
      distance: THREE.MathUtils.clamp(extent * 1.1, 19, 32),
    };
  });
  return <>
    <color attach="background" args={["#bfeaff"]} />
    <hemisphereLight args={["#effbff", "#7466b2", 1.1]} />
    <directionalLight position={[-7, 12, 8]} intensity={2.7} castShadow />
    {mode === "build" && <gridHelper args={[2000, 800, PALETTE.muted, "#c9e1e6"]} position={[0, -0.04, 0]} />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} onPointerDown={() => onSelect(null)}><planeGeometry args={[2000, 2000]} /><meshStandardMaterial color="#e8f6f4" transparent opacity={mode === "build" ? 0.26 : 0.05} /></mesh>
    {items.map((item) => <BuilderItemView key={item.uid} item={item} mode={mode} selected={selectedUids.includes(item.uid)} warning={mode === "build" && unreachable.has(item.uid)} onSelect={onSelect} onBeginMove={onBeginMove} onMove={onMove} />)}
    <SceneController initialTarget={initialView.target} initialDistance={initialView.distance} />
  </>;
}

export interface RoomBuilderRuntime { track: BuiltTrack; challenge: ChallengeDTO }
export interface BuilderPublishDetails {
  title: string;
  description: string;
  visibility: "public" | "unlisted" | "private";
}

export type RoomBuilderShareMode = "links-and-codes" | "codes-only";

export function roomBuilderShareFormats(
  mode: RoomBuilderShareMode,
): readonly ("link" | "code")[] {
  return mode === "codes-only" ? ["code"] : ["link", "code"];
}

export function runtimeMap(
  items: readonly RoomItem[],
  avatarSeed: number,
  identity = 1,
  creatorName = "Map builder",
): RoomBuilderRuntime {
  const spawnMarker = items.find((item) => item.asset === "spawn");
  const finishMarker = items.find((item) => item.asset === "finish");
  const pieces = items.flatMap((item) => {
    const spec = platformSpec(item.asset);
    const scaleX = itemScale(item.scaleX);
    const scaleY = itemScale(item.scaleY);
    const scaleZ = itemScale(item.scaleZ);
    return spec ? [{
      id: `builder-piece-${item.uid}`,
      center: [item.x, item.y - (spec.thickness * scaleY) / 2, item.z] as const,
      size: [spec.width * scaleX, spec.thickness * scaleY, spec.depth * scaleZ] as const,
      color: item.color,
      ...((spec.rotationX ?? 0) + itemRotation(item.rotationX) ? {
        rotationX: (spec.rotationX ?? 0) + itemRotation(item.rotationX),
      } : {}),
      ...(item.rotation ? { rotationY: item.rotation } : {}),
      ...(itemRotation(item.rotationZ) ? { rotationZ: itemRotation(item.rotationZ) } : {}),
    }] : [];
  });
  const platforms = items.flatMap((item) => {
    const spec = orientedPlatformSpec(item);
    if (!spec) return [];
    const width = spec.width;
    const depth = spec.depth;
    const inset = Math.min(0.28, width / 5, depth / 5);
    return [{ item, width, depth, inset }];
  });
  const zones = platforms.map(({ item, width, depth, inset }) => ({
    id: `builder-zone-${item.uid}`,
    label: `${assetLabel(item.asset)} ${item.uid}`,
    minX: item.x - width / 2 + inset,
    maxX: item.x + width / 2 - inset,
    minZ: item.z - depth / 2 + inset,
    maxZ: item.z + depth / 2 - inset,
    groundY: item.y + 0.05,
    maxOccupants: 4,
    allowedTypes: TRAP_TYPES,
  }));
  const spawn = [spawnMarker?.x ?? 0, (spawnMarker?.y ?? 0) + 1.25, spawnMarker?.z ?? 0] as const;
  const exit = [finishMarker?.x ?? 0, (finishMarker?.y ?? 0) + 1.5, finishMarker?.z ?? -10] as const;
  const traps: TrapInstance[] = items.filter(
    (item): item is RoomItem & { asset: `trap:${TrapType}` } => isTrapAsset(item.asset),
  ).map((item, trapIndex) => {
    const type = trapTypeOf(item.asset);
    const support = platforms.reduce<{ uid: number; distance: number } | null>((best, candidate) => {
      const distance = Math.hypot(item.x - candidate.item.x, item.z - candidate.item.z);
      return !best || distance < best.distance ? { uid: candidate.item.uid, distance } : best;
    }, null);
    return {
      id: `builder-trap-${item.uid}`, type, ownerUserId: null, ownerName: "Map builder", ownerAvatarSeed: avatarSeed,
      depthAdded: trapIndex + 1, zoneId: `builder-zone-${support?.uid ?? platforms[0]?.item.uid ?? 0}`, position: [item.x, item.y + 0.05, item.z] as const,
      rotationY: item.rotation, seed: item.uid * 7919, params: { ...TRAP_CATALOG[type].defaultParams },
    };
  });
  const track: BuiltTrack = { pieces, zones, spawn, exit, length: Math.max(1, Math.hypot(exit[0] - spawn[0], exit[2] - spawn[2])) };
  const runtimeSlug = `clean-${Math.abs(identity).toString(36).padStart(6, "0").slice(0, 12)}`;
  return { track, challenge: {
    id: runtimeSlug, slug: runtimeSlug, chainId: runtimeSlug, chainSlug: runtimeSlug, parentSlug: null,
    depth: traps.length, baseSeed: identity, levelVersion: 1, createdByName: creatorName, createdByAvatarSeed: avatarSeed,
    addedTrap: traps.at(-1) ?? null, traps, ghostTrace: null,
    stats: { attempts: 0, completions: 0, survivalRate: null, bestTimeMs: null, recentAttempts: 0, shareCount: 0 },
    createdAt: new Date(0).toISOString(), isDemo: true,
  } };
}

interface RoomBuilderProps {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  creatorName?: string;
  onClose(): void;
  randomSeed?: number;
  initialMode?: "build" | "test";
  cleanPlay?: boolean;
  onCleanReady?(runtime: RoomBuilderRuntime): Promise<void> | void;
  onCleanFinish?(): void;
  onCleanFail?(outcome: "fell" | "timeout" | "reset"): void;
  onCleanSample?(sample: DecodedGhostSample): void;
  onCleanProgress?(value: number): void;
  onCleanHazard?(contact: HazardContact): void;
  onPublish?(runtime: RoomBuilderRuntime, details: BuilderPublishDetails): Promise<string | void> | string | void;
  onShare?(runtime: RoomBuilderRuntime, format: "link" | "code", details?: BuilderPublishDetails): Promise<string | void> | string | void;
  onDeletePublished?(runtime: RoomBuilderRuntime): Promise<void> | void;
  shareMode?: RoomBuilderShareMode;
}

export function RoomBuilder({ avatarSeed, creatorName = "Map builder", onClose, randomSeed, initialMode = "build", cleanPlay = false, onCleanReady, onCleanFinish, onCleanFail, onCleanSample, onCleanProgress, onCleanHazard, onPublish, onShare, onDeletePublished, shareMode = "links-and-codes" }: RoomBuilderProps) {
  const generated = useMemo(() => randomSeed === undefined ? null : generateRandomRoom(randomSeed), [randomSeed]);
  const [items, setItems] = useState<RoomItem[]>(() => ensureRequiredEndpoints(generated ?? loadItems()));
  const [mode, setMode] = useState<"build" | "test">(initialMode);
  const [selectedUids, setSelectedUids] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [controlsHintEpoch, setControlsHintEpoch] = useState(initialMode === "build" ? 1 : 0);
  const [dismissedControlsHintEpoch, setDismissedControlsHintEpoch] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishTitle, setPublishTitle] = useState(() => `Chaos Map ${loadPublished().length + 1}`);
  const [publishDescription, setPublishDescription] = useState("");
  const [publishVisibility, setPublishVisibility] = useState<BuilderPublishDetails["visibility"]>("public");
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [publishedDetails, setPublishedDetails] = useState<BuilderPublishDetails | null>(null);
  const [published, setPublished] = useState<PublishedMap[]>(loadPublished);
  const [deleteCandidate, setDeleteCandidate] = useState<PublishedMap | null>(null);
  const [activeSavedMapId, setActiveSavedMapId] = useState<string | null>(null);
  const [notice, setNotice] = useState(generated ? "Fresh generated map. Reach the end gate." : "");
  const [testSerial, setTestSerial] = useState(1);
  const [testStartedAt, setTestStartedAt] = useState(() => performance.now());
  const copiedItems = useRef<RoomItem[]>([]);
  const undoStack = useRef<RoomItem[][]>([]);
  const redoStack = useRef<RoomItem[][]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  // A custom room has no segment recipe to identify it, so its geometry is the
  // identity. This keeps a published room stable across reloads while making a
  // real edit a new version instead of silently overwriting an older share.
  const runtimeIdentity = useMemo(
    () => randomSeed ?? roomIdentity(items),
    [items, randomSeed],
  );
  const runtime = useMemo(
    () => runtimeMap(items, avatarSeed, runtimeIdentity, creatorName),
    [items, avatarSeed, creatorName, runtimeIdentity],
  );
  const preparedSlug = useRef<string | null>(null);
  const [cleanReady, setCleanReady] = useState(!cleanPlay);
  const [cleanError, setCleanError] = useState("");
  const controlsHintVisible = !cleanPlay && mode === "build" && controlsHintEpoch > dismissedControlsHintEpoch;
  useEffect(() => {
    if (!controlsHintVisible) return;
    const timer = window.setTimeout(() => setDismissedControlsHintEpoch(controlsHintEpoch), 7000);
    return () => window.clearTimeout(timer);
  }, [controlsHintEpoch, controlsHintVisible]);
  useEffect(() => {
    if (!cleanPlay || !onCleanReady || preparedSlug.current === runtime.challenge.slug) return;
    preparedSlug.current = runtime.challenge.slug;
    setCleanReady(false);
    setCleanError("");
    void Promise.resolve(onCleanReady(runtime)).then(() => {
      setCleanReady(true);
    }).catch(() => {
      setCleanError("The clean run could not be started. Return to the menu and try again.");
    });
  }, [cleanPlay, onCleanReady, runtime]);
  const selectedUid = selectedUids.at(-1) ?? null;
  const selected = items.find((item) => item.uid === selectedUid) ?? null;
  const setSelectedUid = (uid: number | null) => setSelectedUids(uid === null ? [] : [uid]);
  const selectItem = (uid: number | null, additive = false) => {
    if (uid === null) { setSelectedUids([]); return; }
    if (!additive) { setSelectedUids([uid]); return; }
    setSelectedUids((current) => current.includes(uid)
      ? current.filter((candidate) => candidate !== uid)
      : [...current, uid]);
  };
  const nextUid = () => Math.max(0, ...items.map((item) => item.uid)) + 1;
  const persist = useCallback((next: RoomItem[]) => {
    setItems(next);
    if (!generated) window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  }, [generated]);
  const remember = useCallback(() => {
    undoStack.current.push(items.map((item) => ({ ...item })));
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistory({ undo: undoStack.current.length, redo: 0 });
  }, [items]);
  const save = useCallback((next: RoomItem[], record = true) => {
    if (record) remember();
    persist(next);
  }, [persist, remember]);
  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(items.map((item) => ({ ...item })));
    persist(previous);
    setSelectedUids((current) => current.filter((uid) => previous.some((item) => item.uid === uid)));
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
    setNotice("Undid the last edit.");
  }, [items, persist]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(items.map((item) => ({ ...item })));
    persist(next);
    setSelectedUids((current) => current.filter((uid) => next.some((item) => item.uid === uid)));
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
    setNotice("Redid the edit.");
  }, [items, persist]);
  const add = (asset: BuilderAsset) => {
    const item: RoomItem = {
      uid: nextUid(),
      asset,
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      color: defaultColor(asset),
      ...transformDefaults,
    };
    save([...items, item]);
    setSelectedUid(item.uid);
    setNotice("");
  };
  const changeSelected = (change: Partial<RoomItem>) => { if (!selected) return; save(items.map((item) => item.uid === selected.uid ? { ...item, ...change } : item)); };
  const removableSelection = useMemo(() => selectedUids.filter((uid) => {
    const item = items.find((candidate) => candidate.uid === uid);
    return item && !isRequiredEndpoint(item.asset);
  }), [items, selectedUids]);
  const remove = () => {
    const removable = new Set(removableSelection);
    if (removable.size === 0) return;
    const next = items.filter((item) => !removable.has(item.uid));
    save(next);
    setSelectedUids([]);
    setNotice(`Deleted ${removable.size} selected ${removable.size === 1 ? "asset" : "assets"}.`);
  };
  const duplicate = () => {
    const source = items.filter((item) => selectedUids.includes(item.uid) && !isRequiredEndpoint(item.asset));
    if (source.length === 0) return;
    let uid = nextUid();
    const copies = source.map((item) => ({ ...item, uid: uid++, x: item.x + 0.75, z: item.z + 0.75 }));
    save([...items, ...copies]);
    setSelectedUids(copies.map((item) => item.uid));
    setNotice(`Duplicated ${copies.length} ${copies.length === 1 ? "asset" : "assets"}.`);
  };
  useEffect(() => {
    const onBuilderShortcut = (event: KeyboardEvent) => {
      if (mode !== "build") return;
      const action = roomBuilderShortcutAction(event, isBuilderTextEntry(event.target));
      if (action === "delete") {
        const removable = new Set(removableSelection);
        if (removable.size === 0) return;
        event.preventDefault();
        AudioManager.click();
        const next = items.filter((item) => !removable.has(item.uid));
        save(next);
        setSelectedUids([]);
        setNotice(`Deleted ${removable.size} selected ${removable.size === 1 ? "asset" : "assets"}.`);
        return;
      }
      if (action === "copy") {
        const source = items.filter((item) => selectedUids.includes(item.uid) && !isRequiredEndpoint(item.asset));
        if (source.length === 0) return;
        event.preventDefault();
        AudioManager.click();
        copiedItems.current = source.map((item) => ({ ...item }));
        setNotice(`Copied ${source.length} ${source.length === 1 ? "asset" : "assets"}. Press Ctrl/Cmd+V to paste.`);
        return;
      }
      if (action === "paste") {
        const source = copiedItems.current;
        if (source.length === 0) return;
        event.preventDefault();
        AudioManager.click();
        let uid = Math.max(0, ...items.map((item) => item.uid)) + 1;
        const copies = source.map((item) => ({
          ...item,
          uid: uid++,
          x: item.x + 0.75,
          z: item.z + 0.75,
        }));
        const next = [...items, ...copies];
        save(next);
        copiedItems.current = copies.map((item) => ({ ...item }));
        setSelectedUids(copies.map((item) => item.uid));
        setNotice(`Pasted ${copies.length} ${copies.length === 1 ? "asset" : "assets"}.`);
        return;
      }
      if (action === "undo") { event.preventDefault(); AudioManager.click(); undo(); return; }
      if (action === "redo") { event.preventDefault(); AudioManager.click(); redo(); }
    };
    window.addEventListener("keydown", onBuilderShortcut);
    return () => window.removeEventListener("keydown", onBuilderShortcut);
  }, [items, mode, redo, removableSelection, save, selectedUids, undo]);
  const beginMove = () => remember();
  const moveItem = (uid: number, x: number, z: number) => {
    const moving = items.find((item) => item.uid === uid);
    if (!moving) return;
    const group = selectedUids.includes(uid) ? selectedUids : [uid];
    const dx = x - moving.x;
    const dz = z - moving.z;
    persist(items.map((item) => group.includes(item.uid)
      ? { ...item, x: snap(item.x + dx), z: snap(item.z + dz) }
      : item));
  };
  const publish = async () => {
    if (!items.some((item) => item.asset === "spawn") || !items.some((item) => item.asset === "finish")) { setNotice("Add a spawn point and game end gate before publishing."); return; }
    const title = publishTitle.trim();
    if (title.length < 2 || title.length > 80 || publishDescription.length > 280) return;
    setPublishBusy(true);
    try {
      const details: BuilderPublishDetails = { title, description: publishDescription.trim(), visibility: publishVisibility };
      const map: PublishedMap = { id: crypto.randomUUID(), name: title, author: creatorName, createdAt: new Date().toISOString(), schemaVersion: 2, items: items.map((item) => ({ ...item })) };
      const next = [map, ...published];
      setPublished(next);
      window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
      const sharedNotice = await onPublish?.(runtime, details);
      setPublishedVersionId(runtime.challenge.slug);
      setPublishedDetails(details);
      const copiedNotice = shareMode === "codes-only"
        ? await onShare?.(runtime, "code", details)
        : undefined;
      setNotice(
        [sharedNotice, copiedNotice].filter((message): message is string => Boolean(message)).join(" ") ||
          `Published “${title}” to this device's map browser.`,
      );
      setPublishOpen(false);
      setPublishTitle(`Chaos Map ${next.length + 1}`);
      setPublishDescription("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(message.startsWith("CHALLENGE_LINK_UNENCODABLE") || message.startsWith("PUBLISHED_MAP_CODE_TOO_LARGE")
        ? "This room is too large for one Portals map code. The local draft is untouched; remove a few pieces or traps and publish again."
        : message || "Publishing failed. Your local draft is untouched.");
    } finally {
      setPublishBusy(false);
    }
  };
  const share = async (format: "link" | "code") => {
    if (!onShare) return;
    if (shareMode === "codes-only" && publishedVersionId !== runtime.challenge.slug) {
      setNotice("Publish this exact version before copying its published map code.");
      return;
    }
    const sharedNotice = await onShare(runtime, format, publishedDetails ?? undefined);
    if (sharedNotice) setNotice(sharedNotice);
  };
  const savedMapRuntime = (map: PublishedMap) =>
    runtimeMap(map.items, avatarSeed, roomIdentity(map.items), creatorName);
  const copySavedMapCode = async (map: PublishedMap) => {
    if (!onShare) return;
    const details: BuilderPublishDetails = {
      title: map.name,
      description: "",
      visibility: "public",
    };
    const sharedNotice = await onShare(savedMapRuntime(map), "code", details);
    setNotice(sharedNotice || `Copied “${map.name}”.`);
  };
  const deleteSavedMap = async (map: PublishedMap) => {
    const mapRuntime = savedMapRuntime(map);
    const next = published.filter((candidate) => candidate.id !== map.id);
    setPublished(next);
    window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
    await onDeletePublished?.(mapRuntime);
    if (publishedVersionId === mapRuntime.challenge.slug) {
      setPublishedVersionId(null);
      setPublishedDetails(null);
    }
    if (activeSavedMapId === map.id) setActiveSavedMapId(null);
    setDeleteCandidate(null);
    setNotice(`Deleted the saved copy of “${map.name}”. Your current draft is untouched.`);
  };
  const openSavedMap = (map: PublishedMap, nextMode: "build" | "test", nextStartedAt = 0) => {
    save(ensureRequiredEndpoints(map.items));
    const mapRuntime = savedMapRuntime(map);
    setPublishedVersionId(mapRuntime.challenge.slug);
    setPublishedDetails({ title: map.name, description: "", visibility: "public" });
    setActiveSavedMapId(map.id);
    setSelectedUid(null);
    setBrowseOpen(false);
    setMode(nextMode);
    if (nextMode === "build") setControlsHintEpoch((value) => value + 1);
    if (nextMode === "test") {
      setTestSerial((value) => value + 1);
      setTestStartedAt(nextStartedAt);
      setNotice(`Testing “${map.name}”.`);
    } else {
      setNotice(`Editing “${map.name}”. Publish when you want to save a new version.`);
    }
  };
  const trapMatches = TRAP_TYPES.filter((type) => TRAP_CATALOG[type].displayName.toLowerCase().includes(query.toLowerCase()));
  return <main className="room-builder">
    {mode === "build" ? <Canvas shadows camera={{ fov: 48, near: 0.05, far: 5000 }} onPointerMissed={() => setSelectedUid(null)}>
      <BuilderScene items={items} mode="build" selectedUids={selectedUids} onSelect={selectItem} onBeginMove={beginMove} onMove={moveItem} />
    </Canvas> : <GameCanvas
      challenge={runtime.challenge}
      trackOverride={runtime.track}
      phase={cleanReady ? "playing" : "intro"}
      attemptSerial={testSerial}
      startedAt={testStartedAt}
      placement={null}
      ghostEnabled={false}
      recordSample={(sample) => cleanPlay ? onCleanSample?.(sample) : undefined}
      onProgress={(value) => cleanPlay ? onCleanProgress?.(value) : undefined}
      onFinish={() => cleanPlay ? onCleanFinish?.() : setNotice("Map cleared exactly as a finished run would be.")}
      onFail={(outcome) => { if (cleanPlay) { onCleanFail?.(outcome); return; } setNotice(outcome === "fell" ? "You fell. Restarting at the builder spawn point." : "Test restarted."); setTestSerial((value) => value + 1); setTestStartedAt(performance.now()); }}
      onHazard={(contact) => { if (cleanPlay) onCleanHazard?.(contact); else setNotice(`${TRAP_CATALOG[contact.trapType].displayName} hit the runner.`); }}
      onSelectZone={() => undefined}
      onMovePlacement={() => undefined}
      onAssetsReady={() => undefined}
    />}
    {cleanPlay && !cleanReady && <div className="canvas-loading"><span />{cleanError || "Starting clean run…"}</div>}
    {!cleanPlay && <header><div><span className="eyebrow">BUILD YOUR GAME</span></div><nav><button className="button secondary" aria-label="Open free build guide" onClick={() => setGuideOpen(true)}>?</button><button className="button secondary" onClick={onClose}>← Menu</button></nav></header>}
    {!cleanPlay && mode === "build" && controlsHintVisible && <aside className="room-builder-controls-hint" role="status" aria-label="Builder controls and hotkeys">
      <button type="button" aria-label="Dismiss builder controls" onClick={() => setDismissedControlsHintEpoch(controlsHintEpoch)}>×</button>
      <strong>🧱 BUILD CONTROLS</strong>
      <span><b>WASD</b> move camera · <b>Q/E</b> down/up · <b>Right-drag</b> look · <b>Left-drag</b> move item · <b>Wheel</b> zoom</span>
      <span><b>Shift-click</b> multi-select · <b>Ctrl/Cmd+C/V</b> copy/paste · <b>Ctrl/Cmd+Z</b> undo · <b>Delete</b> remove</span>
    </aside>}
    {!cleanPlay && mode === "build" && <aside className="room-builder-tray"><strong>Assets</strong><div>{BUILDABLE_PIECES.map((entry) => <button key={entry.asset} onClick={() => add(entry.asset)}><span>{entry.emoji}</span>{entry.label}</button>)}</div><label className="room-builder-search">All {TRAP_TYPES.length} traps<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search traps" /></label><small className="room-builder-scroll-cue">↕ Scroll for all {TRAP_TYPES.length} traps</small><div>{trapMatches.map((type) => <button key={type} onClick={() => add(`trap:${type}`)}><TrapIcon type={type} />{TRAP_CATALOG[type].displayName}</button>)}</div></aside>}
    {!cleanPlay && mode === "build" && selected && <TransformInspector item={selected} onChange={changeSelected} />}
    {!cleanPlay && <section className="room-builder-tools"><b>{selectedUids.length > 1 ? `${selectedUids.length} assets selected` : selected ? assetLabel(selected.asset) : `${items.length} assets`}</b>{selected && selectedUids.length === 1 && !isTrapAsset(selected.asset) && <label className="room-builder-color">Color <input type="color" value={selected.color} onChange={(event) => changeSelected({ color: event.target.value })} /></label>}<button disabled={history.undo === 0 || mode !== "build"} onClick={undo}>↶ Undo</button><button disabled={history.redo === 0 || mode !== "build"} onClick={redo}>↷ Redo</button><button disabled={!selected} onClick={() => changeSelected({ rotation: (selected?.rotation ?? 0) + Math.PI / 2 })}>↻ Rotate</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) + 0.25) })}>↑ Lift</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) - 0.25) })}>↓ Lower</button><button disabled={removableSelection.length === 0 || mode !== "build"} onClick={duplicate}>⧉ Copy</button><button disabled={removableSelection.length === 0 || mode !== "build"} onClick={remove}>🗑 Remove</button><button onClick={() => setBrowseOpen(true)}>📁 My maps</button>{onShare && roomBuilderShareFormats(shareMode).map((format) => <button key={format} disabled={shareMode === "codes-only" && publishedVersionId !== runtime.challenge.slug} aria-label={shareMode === "codes-only" && publishedVersionId !== runtime.challenge.slug ? "Copy published map code; publish this version first" : undefined} onClick={() => void share(format)}>{format === "code" ? (shareMode === "codes-only" ? "📋 Copy published map code" : "📋 Copy map code") : "🔗 Copy map link"}</button>)}<button onClick={() => setPublishOpen(true)}>📤 Publish</button><button className="primary" onClick={() => { const next = mode === "build" ? "test" : "build"; setMode(next); setSelectedUid(null); if (next === "test") { setTestSerial((value) => value + 1); setTestStartedAt(performance.now()); } else { setControlsHintEpoch((value) => value + 1); } setNotice(next === "test" ? "Real game Test mode: spawn marker hidden. Reach the end gate." : "Builder camera restored. Red platforms are outside jump reach."); }}>{mode === "build" ? "▶ Test map" : "🧱 Keep building"}</button></section>}
    {!cleanPlay && <p className="room-builder-notice" role="status">{notice}</p>}
    {!cleanPlay && guideOpen && <div className="room-builder-browser"><section><div className="eyebrow">FREE BUILD GUIDE</div><h2>Build directly in the room</h2><div className="room-builder-guide"><p><b>🏁 Required markers:</b> Every map always has one spawn marker and one end gate. Drag or lift them wherever you want; they are visible only while building and cannot be copied or deleted.</p><p><b>🧱 Add assets:</b> Choose a main-game block or any trap from the left tray. Blocks can use custom colors. Traps always keep their authored base colors.</p><p><b>🖱️ Select and move:</b> Left-click an object to select it, then left-drag it through the room. Shift-click adds or removes objects from a group selection; dragging any selected object moves the whole group without selecting objects underneath it.</p><p><b>🎥 Camera:</b> Right-drag to turn the build camera and use the mouse wheel to zoom. WASD pans across the room; Q/E move the camera vertically.</p><p><b>🧭 Transform inspector:</b> Select one item to type its exact X/Y/Z position and Y rotation. Blocks also expose independent X/Y/Z rotation and scale, so every platform can become a custom-sized wall, floor, ramp, or vertical structure.</p><p><b>↕️ Build vertically:</b> Lift and Lower move the primary selected object in 0.25-unit steps. Rotate turns it 90°. You can stack routes and build above or below the starting floor.</p><p><b>📋 Edit history:</b> Ctrl/Cmd+C and V copy/paste one object or a whole selected group. Delete removes the selection. Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes up to 100 edits.</p><p><b>⚠️ Jump check:</b> A block turns red when the conservative reach check says it is too far or too high from the connected route. The warning is intentionally about 20% stricter than the theoretical maximum jump.</p><p><b>▶ Test map:</b> Test mode hides the spawn marker and runs the map with the finished game&apos;s movement, camera, physics, traps, falls, and end gate. Choose Keep building to return without losing the draft.</p><p><b>📁 My maps:</b> Open a map you published on this device. Edit loads it into your draft, Play tests it, Copy Code shares it again without republishing, and Delete removes your local saved copy after confirmation.</p><p><b>📤 Publish and share:</b> Publish saves and validates an exact named version. After that, Copy published map code remains available for the unchanged version without publishing it again. In Portals, another player pastes the code into Use Map Code.</p></div><button className="button secondary" onClick={() => setGuideOpen(false)}>✅ Got it</button></section></div>}
    {!cleanPlay && browseOpen && <div className="room-builder-browser"><section><div className="eyebrow">YOUR CUSTOM MAPS</div><h2>My maps</h2><p>Maps you published on this device. Copy Code shares an unchanged version immediately; deleting a saved copy never erases the draft currently in the editor.</p>{published.length === 0 ? <p>No saved maps yet. Publish your current draft to add it here.</p> : published.map((map) => <article key={map.id}><div><strong>{map.name}</strong><small>{map.items.length} assets · {new Date(map.createdAt).toLocaleDateString()}{activeSavedMapId === map.id ? " · open now" : ""}</small></div><div className="room-builder-map-actions"><button onClick={() => openSavedMap(map, "build")}>✏️ Edit</button><button onClick={() => openSavedMap(map, "test", performance.now())}>▶ Play</button>{onShare && <button onClick={() => void copySavedMapCode(map)}>📋 Copy Code</button>}<button className="danger" onClick={() => setDeleteCandidate(map)}>🗑 Delete</button></div></article>)}<button className="button secondary" onClick={() => setBrowseOpen(false)}>Close</button></section></div>}
    {!cleanPlay && deleteCandidate && <div className="room-builder-browser"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-map-title"><div className="eyebrow">DELETE SAVED MAP</div><h2 id="delete-map-title">Delete “{deleteCandidate.name}”?</h2><p>This removes the saved listing and its remembered published code from this device. If it is open now, the current editable draft stays on screen until you leave or replace it.</p><div className="room-builder-publish-actions"><button className="button secondary" onClick={() => setDeleteCandidate(null)}>Cancel</button><button className="button danger" onClick={() => void deleteSavedMap(deleteCandidate)}>🗑 Delete saved map</button></div></section></div>}
    {!cleanPlay && publishOpen && <div className="room-builder-browser"><section className="room-builder-publish" role="dialog" aria-modal="true" aria-labelledby="builder-publish-title"><div className="eyebrow">PUBLISH MAP</div><h2 id="builder-publish-title">Share this version</h2><label>Title<input value={publishTitle} maxLength={80} onChange={(event) => setPublishTitle(event.target.value)} autoFocus /></label><label>Description<textarea value={publishDescription} maxLength={280} rows={3} onChange={(event) => setPublishDescription(event.target.value)} placeholder="What kind of disaster is this?" /></label>{shareMode === "codes-only" ? <p>Publishing saves this exact version, shares it with the current Portals session, and copies its map code for players in another session.</p> : <label>Who can open it?<select value={publishVisibility} onChange={(event) => setPublishVisibility(event.target.value as BuilderPublishDetails["visibility"])}><option value="public">Public · eligible for Trending</option><option value="unlisted">Unlisted · link only</option><option value="private">Private · only me</option></select></label>}<div className="room-builder-publish-actions"><button className="button secondary" disabled={publishBusy} onClick={() => setPublishOpen(false)}>Cancel</button><button className="button primary" disabled={publishBusy || publishTitle.trim().length < 2} onClick={() => void publish()}>{publishBusy ? "Publishing…" : shareMode === "codes-only" ? "Publish & copy code" : "Publish version"}</button></div></section></div>}
  </main>;
}
