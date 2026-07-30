"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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
    }).map((item) => ({ ...item, y: Number.isFinite(item.y) ? item.y : 0, color: item.color || defaultColor(item.asset) }));
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

/** A clean level now uses the same primitives and traps exposed to builders. */
export function generateRandomRoom(seed: number): RoomItem[] {
  const random = createSeededRandom(seed);
  const courseColors = [PALETTE.yellow, PALETTE.blue, PALETTE.purple, PALETTE.orange, PALETTE.green, PALETTE.cream] as const;
  const randomCourseColor = () => courseColors[Math.floor(random() * courseColors.length)]!;
  let uid = 1;
  const add = (asset: BuilderAsset, x: number, y: number, z: number, rotation = 0, color = defaultColor(asset)) => ({
    uid: uid++, asset, x: snap(x), y: snap(y), z: snap(z), rotation, color,
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
  const quarterTurn = Math.abs(Math.sin(item.rotation)) > 0.5;
  return quarterTurn ? { ...spec, width: spec.depth, depth: spec.width } : spec;
}

function ensureRequiredEndpoints(source: readonly RoomItem[]): RoomItem[] {
  const items = source.filter((item, index) =>
    !isRequiredEndpoint(item.asset) || source.findIndex((candidate) => candidate.asset === item.asset) === index,
  ).map((item) => ({ ...item }));
  let nextUid = Math.max(0, ...items.map((item) => item.uid)) + 1;
  let platforms = items.filter((item) => platformSpec(item.asset));
  if (platforms.length === 0) {
    const startBlock: RoomItem = { uid: nextUid++, asset: "platform", x: 0, y: 0, z: 2, rotation: 0, color: defaultColor("platform") };
    const finishBlock: RoomItem = { uid: nextUid++, asset: "platform", x: 0, y: 0, z: -6, rotation: 0, color: defaultColor("platform") };
    items.push(startBlock, finishBlock);
    platforms = [startBlock, finishBlock];
  }
  if (!items.some((item) => item.asset === "spawn")) {
    const support = platforms[0]!;
    items.push({ uid: nextUid++, asset: "spawn", x: support.x, y: support.y, z: support.z, rotation: 0, color: defaultColor("spawn") });
  }
  if (!items.some((item) => item.asset === "finish")) {
    const support = platforms.at(-1)!;
    items.push({ uid: nextUid++, asset: "finish", x: support.x, y: support.y, z: support.z, rotation: 0, color: defaultColor("finish") });
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
  return (
    <group rotation={[spec.rotationX ?? 0, 0, 0]}>
      <RoundedBox position={[0, -spec.thickness / 2, 0]} args={[spec.width, spec.thickness, spec.depth]} radius={0.14} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color={bodyColor} roughness={0.7} metalness={0.03} />
      </RoundedBox>
      <RoundedBox position={[0, -spec.thickness - 0.08, 0]} args={[spec.width * 0.92, 0.16, spec.depth * 0.92]} radius={0.08} smoothness={2} castShadow>
        <meshStandardMaterial color={PALETTE.ink} roughness={0.78} />
      </RoundedBox>
      <mesh position={[0, 0.02, 0]} receiveShadow><boxGeometry args={[spec.width * 0.995, 0.07, spec.depth * 0.995]} /><meshStandardMaterial color={PALETTE.ink} roughness={0.85} /></mesh>
      <mesh position={[0, 0.055, 0]} receiveShadow><boxGeometry args={[spec.width - 0.26, 0.05, spec.depth - 0.26]} /><meshStandardMaterial color={wash} roughness={0.9} /></mesh>
      {(warning || selected) && <mesh position={[0, 0.1, 0]}><boxGeometry args={[spec.width + 0.08, 0.08, spec.depth + 0.08]} /><meshBasicMaterial color={warning ? PALETTE.danger : PALETTE.green} wireframe /></mesh>}
    </group>
  );
}

function SpawnMarker() {
  return <group><mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.7, 32]} /><meshBasicMaterial color={PALETTE.yellow} transparent opacity={0.72} /></mesh><mesh position={[0, 0.7, 0]}><coneGeometry args={[0.28, 0.7, 4]} /><meshStandardMaterial color={PALETTE.yellow} /></mesh></group>;
}

function FinishGate({ color }: { color: string }) {
  return <group><mesh position={[-0.95, 1.4, 0]}><boxGeometry args={[0.24, 2.8, 0.35]} /><meshStandardMaterial color={PALETTE.ink} /></mesh><mesh position={[0.95, 1.4, 0]}><boxGeometry args={[0.24, 2.8, 0.35]} /><meshStandardMaterial color={PALETTE.ink} /></mesh><mesh position={[0, 2.68, 0]}><boxGeometry args={[2.15, 0.28, 0.35]} /><meshStandardMaterial color={color} /></mesh><mesh position={[0, 1.35, 0]}><planeGeometry args={[1.65, 2.2]} /><meshBasicMaterial color={color} transparent opacity={0.24} side={THREE.DoubleSide} /></mesh></group>;
}

function BuilderItemView({ item, mode, selected, warning, onSelect, onMove }: {
  item: RoomItem; mode: "build" | "test"; selected: boolean; warning: boolean;
  onSelect(uid: number): void; onMove(uid: number, x: number, z: number): void;
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
    onSelect(item.uid);
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

function SceneController() {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const target = useRef(new THREE.Vector3(0, 1, 0));
  const yaw = useRef(0);
  const pitch = useRef(0.58);
  const distance = useRef(15);
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
    camera.lookAt(target.current);
  });
  return null;
}

function BuilderScene({ items, mode, selectedUid, onSelect, onMove }: {
  items: readonly RoomItem[]; mode: "build" | "test"; selectedUid: number | null;
  onSelect(uid: number | null): void; onMove(uid: number, x: number, z: number): void;
}) {
  const unreachable = useMemo(() => unreachablePlatformIds(items), [items]);
  return <>
    <color attach="background" args={["#bfeaff"]} />
    <hemisphereLight args={["#effbff", "#7466b2", 1.1]} />
    <directionalLight position={[-7, 12, 8]} intensity={2.7} castShadow />
    {mode === "build" && <gridHelper args={[2000, 800, PALETTE.muted, "#c9e1e6"]} position={[0, -0.04, 0]} />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} onPointerDown={() => onSelect(null)}><planeGeometry args={[2000, 2000]} /><meshStandardMaterial color="#e8f6f4" transparent opacity={mode === "build" ? 0.26 : 0.05} /></mesh>
    {items.map((item) => <BuilderItemView key={item.uid} item={item} mode={mode} selected={item.uid === selectedUid} warning={mode === "build" && unreachable.has(item.uid)} onSelect={(uid) => onSelect(uid)} onMove={onMove} />)}
    <SceneController />
  </>;
}

export interface RoomBuilderRuntime { track: BuiltTrack; challenge: ChallengeDTO }
export interface BuilderPublishDetails {
  title: string;
  description: string;
  visibility: "public" | "unlisted" | "private";
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
    return spec ? [{
      id: `builder-piece-${item.uid}`,
      center: [item.x, item.y - spec.thickness / 2, item.z] as const,
      size: [spec.width, spec.thickness, spec.depth] as const,
      color: item.color,
      ...(spec.rotationX ? { rotationX: spec.rotationX } : {}),
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
  const traps: TrapInstance[] = items.flatMap((item) => {
    if (!isTrapAsset(item.asset)) return [];
    const type = trapTypeOf(item.asset);
    const support = platforms.reduce<{ uid: number; distance: number } | null>((best, candidate) => {
      const distance = Math.hypot(item.x - candidate.item.x, item.z - candidate.item.z);
      return !best || distance < best.distance ? { uid: candidate.item.uid, distance } : best;
    }, null);
    return [{
      id: `builder-trap-${item.uid}`, type, ownerUserId: null, ownerName: "Map builder", ownerAvatarSeed: avatarSeed,
      depthAdded: 1, zoneId: `builder-zone-${support?.uid ?? platforms[0]?.item.uid ?? 0}`, position: [item.x, item.y + 0.05, item.z] as const,
      rotationY: item.rotation, seed: item.uid * 7919, params: { ...TRAP_CATALOG[type].defaultParams },
    }];
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
  onShare?(runtime: RoomBuilderRuntime, format: "link" | "code"): Promise<void> | void;
}

export function RoomBuilder({ avatarSeed, creatorName = "Map builder", onClose, randomSeed, initialMode = "build", cleanPlay = false, onCleanReady, onCleanFinish, onCleanFail, onCleanSample, onCleanProgress, onCleanHazard, onPublish, onShare }: RoomBuilderProps) {
  const generated = useMemo(() => randomSeed === undefined ? null : generateRandomRoom(randomSeed), [randomSeed]);
  const [items, setItems] = useState<RoomItem[]>(() => ensureRequiredEndpoints(generated ?? loadItems()));
  const [mode, setMode] = useState<"build" | "test">(initialMode);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishTitle, setPublishTitle] = useState(() => `Chaos Map ${loadPublished().length + 1}`);
  const [publishDescription, setPublishDescription] = useState("");
  const [publishVisibility, setPublishVisibility] = useState<BuilderPublishDetails["visibility"]>("public");
  const [published, setPublished] = useState<PublishedMap[]>(loadPublished);
  const [notice, setNotice] = useState(generated ? "Fresh generated map. Reach the end gate." : "");
  const [testSerial, setTestSerial] = useState(1);
  const [testStartedAt, setTestStartedAt] = useState(() => performance.now());
  // A custom room has no segment recipe to identify it, so its geometry is the
  // identity. This keeps a published room stable across reloads while making a
  // real edit a new version instead of silently overwriting an older share.
  const runtimeIdentity = useMemo(
    () => randomSeed ?? hashString(JSON.stringify(items.map((item) => [
      item.asset,
      item.x,
      item.y,
      item.z,
      item.rotation,
      item.color,
    ]))),
    [items, randomSeed],
  );
  const runtime = useMemo(
    () => runtimeMap(items, avatarSeed, runtimeIdentity, creatorName),
    [items, avatarSeed, creatorName, runtimeIdentity],
  );
  const preparedSlug = useRef<string | null>(null);
  const [cleanReady, setCleanReady] = useState(!cleanPlay);
  const [cleanError, setCleanError] = useState("");
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
  const selected = items.find((item) => item.uid === selectedUid) ?? null;
  const nextUid = () => Math.max(0, ...items.map((item) => item.uid)) + 1;
  const save = (next: RoomItem[]) => { setItems(next); if (!generated) window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); };
  const add = (asset: BuilderAsset) => {
    const item: RoomItem = { uid: nextUid(), asset, x: 0, y: 0, z: 0, rotation: 0, color: defaultColor(asset) };
    save([...items, item]);
    setSelectedUid(item.uid);
    setNotice("");
  };
  const changeSelected = (change: Partial<RoomItem>) => { if (!selected) return; save(items.map((item) => item.uid === selected.uid ? { ...item, ...change } : item)); };
  const remove = () => {
    if (!selected || isRequiredEndpoint(selected.asset)) return;
    const next = items.filter((item) => item.uid !== selected.uid);
    save(next);
    setSelectedUid(null);
  };
  const duplicate = () => { if (!selected || isRequiredEndpoint(selected.asset)) return; const copy = { ...selected, uid: nextUid(), x: selected.x + 0.75, z: selected.z + 0.75 }; save([...items, copy]); setSelectedUid(copy.uid); };
  const moveItem = (uid: number, x: number, z: number) => {
    const moving = items.find((item) => item.uid === uid);
    if (!moving) return;
    save(items.map((item) => item.uid === uid ? { ...item, x, z } : item));
  };
  const publish = async () => {
    if (!items.some((item) => item.asset === "spawn") || !items.some((item) => item.asset === "finish")) { setNotice("Add a spawn point and game end gate before publishing."); return; }
    const title = publishTitle.trim();
    if (title.length < 2 || title.length > 80 || publishDescription.length > 280) return;
    setPublishBusy(true);
    try {
      const map: PublishedMap = { id: crypto.randomUUID(), name: title, author: creatorName, createdAt: new Date().toISOString(), schemaVersion: 2, items: items.map((item) => ({ ...item })) };
      const next = [map, ...published];
      setPublished(next);
      window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
      const sharedNotice = await onPublish?.(runtime, { title, description: publishDescription.trim(), visibility: publishVisibility });
      setNotice(sharedNotice ?? `Published “${title}” to this device's trending browser.`);
      setPublishOpen(false);
      setPublishTitle(`Chaos Map ${next.length + 1}`);
      setPublishDescription("");
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : "Publishing failed. Your local draft is untouched.");
    } finally {
      setPublishBusy(false);
    }
  };
  const trapMatches = TRAP_TYPES.filter((type) => TRAP_CATALOG[type].displayName.toLowerCase().includes(query.toLowerCase()));
  return <main className="room-builder">
    {mode === "build" ? <Canvas shadows camera={{ fov: 48, near: 0.05, far: 5000 }} onPointerMissed={() => setSelectedUid(null)}>
      <BuilderScene items={items} mode="build" selectedUid={selectedUid} onSelect={setSelectedUid} onMove={moveItem} />
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
    {!cleanPlay && <header><div><span className="eyebrow">BUILD YOUR GAME</span></div><nav><button className="button secondary" aria-label="Open free build guide" title="Free build guide" onClick={() => setGuideOpen(true)}>?</button><button className="button secondary" onClick={onClose}>← Menu</button></nav></header>}
    {!cleanPlay && mode === "build" && <aside className="room-builder-tray"><strong>Assets</strong><div>{BUILDABLE_PIECES.map((entry) => <button key={entry.asset} onClick={() => add(entry.asset)}><span>{entry.emoji}</span>{entry.label}</button>)}</div><label className="room-builder-search">All {TRAP_TYPES.length} traps<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search traps" /></label><div>{trapMatches.map((type) => <button key={type} onClick={() => add(`trap:${type}`)}><TrapIcon type={type} />{TRAP_CATALOG[type].displayName}</button>)}</div></aside>}
    {!cleanPlay && <section className="room-builder-tools"><b>{selected ? assetLabel(selected.asset) : `${items.length} assets`}</b>{selected && !isTrapAsset(selected.asset) && <label className="room-builder-color">Color <input type="color" value={selected.color} onChange={(event) => changeSelected({ color: event.target.value })} /></label>}<button disabled={!selected} onClick={() => changeSelected({ rotation: (selected?.rotation ?? 0) + Math.PI / 2 })}>↻ Rotate</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) + 0.25) })}>↑ Lift</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) - 0.25) })}>↓ Lower</button><button disabled={!selected || mode !== "build" || isRequiredEndpoint(selected.asset)} onClick={duplicate}>⧉ Copy</button><button disabled={!selected || mode !== "build" || isRequiredEndpoint(selected.asset)} onClick={remove}>🗑 Remove</button><button onClick={() => setBrowseOpen(true)}>🌐 Browse maps</button>{onShare && <><button onClick={() => void onShare(runtime, "link")}>🔗 Copy map link</button><button onClick={() => void onShare(runtime, "code")}>📋 Copy map code</button></>}<button onClick={() => setPublishOpen(true)}>📤 Publish</button><button className="primary" onClick={() => { const next = mode === "build" ? "test" : "build"; setMode(next); setSelectedUid(null); if (next === "test") { setTestSerial((value) => value + 1); setTestStartedAt(performance.now()); } setNotice(next === "test" ? "Real game Test mode: spawn marker hidden. Reach the end gate." : "Builder camera restored. Red platforms are outside jump reach."); }}>{mode === "build" ? "▶ Test map" : "🧱 Keep building"}</button></section>}
    {!cleanPlay && <p className="room-builder-notice" role="status">{notice}</p>}
    {!cleanPlay && guideOpen && <div className="room-builder-browser"><section><div className="eyebrow">FREE BUILD GUIDE</div><h2>Build directly in the room</h2><div className="room-builder-guide"><p><b>Place:</b> Pick a game block or trap from the left tray.</p><p><b>Move:</b> Left-drag any placed piece. Spawn and finish can go anywhere and can be moved vertically with Lift/Lower.</p><p><b>Look:</b> Right-drag to turn the camera. Use the mouse wheel to zoom.</p><p><b>Travel:</b> WASD pans the build camera. Q and E move it vertically.</p><p><b>Edit:</b> Select a piece to color, rotate, lift, lower, copy, or remove it. Spawn and finish remain mandatory, so they cannot be copied or removed.</p><p><b>Jump check:</b> A block turns red when the runner cannot reach it from the connected course.</p><p><b>Play it:</b> Choose Test map to run the room with the finished game controls and physics.</p></div><button className="button secondary" onClick={() => setGuideOpen(false)}>Got it</button></section></div>}
    {!cleanPlay && browseOpen && <div className="room-builder-browser"><section><div className="eyebrow">COMMUNITY MAPS</div><h2>Browse maps</h2>{published.length === 0 ? <p>No maps have been published in this build yet.</p> : published.map((map) => <article key={map.id}><div><strong>{map.name}</strong><small>{map.items.length} assets · {new Date(map.createdAt).toLocaleDateString()}</small></div><button onClick={() => { save(ensureRequiredEndpoints(map.items)); setMode("test"); setBrowseOpen(false); setNotice(`Testing “${map.name}”.`); }}>Play</button></article>)}<button className="button secondary" onClick={() => setBrowseOpen(false)}>Close</button></section></div>}
    {!cleanPlay && publishOpen && <div className="room-builder-browser"><section className="room-builder-publish" role="dialog" aria-modal="true" aria-labelledby="builder-publish-title"><div className="eyebrow">PUBLISH MAP</div><h2 id="builder-publish-title">Share this version</h2><label>Title<input value={publishTitle} maxLength={80} onChange={(event) => setPublishTitle(event.target.value)} autoFocus /></label><label>Description<textarea value={publishDescription} maxLength={280} rows={3} onChange={(event) => setPublishDescription(event.target.value)} placeholder="What kind of disaster is this?" /></label><label>Who can open it?<select value={publishVisibility} onChange={(event) => setPublishVisibility(event.target.value as BuilderPublishDetails["visibility"])}><option value="public">Public · eligible for Trending</option><option value="unlisted">Unlisted · link only</option><option value="private">Private · only me</option></select></label><div className="room-builder-publish-actions"><button className="button secondary" disabled={publishBusy} onClick={() => setPublishOpen(false)}>Cancel</button><button className="button primary" disabled={publishBusy || publishTitle.trim().length < 2} onClick={() => void publish()}>{publishBusy ? "Publishing…" : "Publish version"}</button></div></section></div>}
  </main>;
}
