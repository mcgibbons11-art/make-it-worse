"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { dressRunner } from "./PlayerVisual";
import GameCanvas from "./GameCanvas";
import { TrapPreviewProp } from "./placement/TrapPreview";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { createSeededRandom } from "@/lib/game/seed";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ChallengeDTO, TrapInstance, TrapType } from "@/lib/game/types";
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
  let uid = 1;
  const add = (asset: BuilderAsset, x: number, y: number, z: number, rotation = 0, color = defaultColor(asset)) => ({
    uid: uid++, asset, x: snap(x), y: snap(y), z: snap(z), rotation, color,
  });
  const items: RoomItem[] = [add("spawn", 0, 0, 2), add("platform", 0, 0, 2)];
  let z = -1;
  let y = 0;
  for (let index = 0; index < 7; index += 1) {
    z -= 3 + random() * 2;
    y = Math.max(0, y + (random() > 0.58 ? (random() > 0.5 ? 0.5 : -0.5) : 0));
    const asset: BuilderPieceKind = random() > 0.82 ? "beam" : random() > 0.64 ? "wide-platform" : "platform";
    items.push(add(asset, (random() - 0.5) * 5, y, z, random() > 0.75 ? Math.PI / 2 : 0));
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

const GRAVITY = 9.81 * PLAYER.gravityScale;
const JUMP_RISE = (PLAYER.jumpVelocity ** 2) / (2 * GRAVITY) * 0.9;
const JUMP_DISTANCE = PLAYER.moveSpeed * (2 * PLAYER.jumpVelocity / GRAVITY) * 0.9;

/** Returns the platform uids not connected to the builder's spawn by a feasible jump. */
export function unreachablePlatformIds(items: readonly RoomItem[]): Set<number> {
  const surfaces = items.flatMap((item) => {
    const spec = platformSpec(item.asset);
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

function TintedTrap({ type, color }: { type: TrapType; color: string }) {
  const root = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    root.current?.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const source = Array.isArray(node.material) ? node.material : [node.material];
      const cloned = source.map((entry) => {
        const next = entry.clone();
        if ("color" in next && next.color instanceof THREE.Color) next.color.set(color);
        return next;
      });
      node.material = Array.isArray(node.material) ? cloned : cloned[0]!;
    });
  }, [color, type]);
  return <group ref={root}><TrapPreviewProp type={type} /></group>;
}

function BuilderItemView({ item, mode, selected, warning, onSelect, onMove }: {
  item: RoomItem; mode: "build" | "test"; selected: boolean; warning: boolean;
  onSelect(uid: number): void; onMove(uid: number, x: number, z: number): void;
}) {
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.y), [item.y]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const down = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "build" || event.button !== 0) return;
    event.stopPropagation();
    onSelect(item.uid);
    (event.nativeEvent.target as Element).setPointerCapture(event.pointerId);
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (mode !== "build" || !(event.nativeEvent.target as Element).hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    if (event.ray.intersectPlane(dragPlane, point)) onMove(item.uid, snap(point.x), snap(point.z));
  };
  return (
    <group position={[item.x, item.y, item.z]} rotation={[0, item.rotation, 0]} onPointerDown={down} onPointerMove={move}>
      {platformSpec(item.asset) && <GamePlatform item={item} warning={warning} selected={selected} />}
      {item.asset === "spawn" && mode === "build" && <SpawnMarker />}
      {item.asset === "finish" && <FinishGate color={item.color} />}
      {isTrapAsset(item.asset) && <TintedTrap type={trapTypeOf(item.asset)} color={item.color} />}
      {selected && !platformSpec(item.asset) && <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.72, 0.82, 32]} /><meshBasicMaterial color={PALETTE.green} /></mesh>}
    </group>
  );
}

function SceneController({ mode, items, avatar, avatarSeed, setNotice }: {
  mode: "build" | "test"; items: readonly RoomItem[]; avatar: AvatarConfig | null; avatarSeed: number; setNotice(value: string): void;
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const target = useRef(new THREE.Vector3(0, 1, 0));
  const yaw = useRef(0);
  const pitch = useRef(0.58);
  const distance = useRef(15);
  const orbit = useRef<{ x: number; y: number } | null>(null);
  const runner = useMemo(() => dressRunner(avatar, avatarSeed), [avatar, avatarSeed]);
  const velocityY = useRef(0);
  const grounded = useRef(true);
  const stride = useRef(0);
  const completed = useRef(false);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { keys.current.add(event.key.toLowerCase()); };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.key.toLowerCase()); };
    const pointerDown = (event: PointerEvent) => { if (mode === "build" && event.button === 0) orbit.current = { x: event.clientX, y: event.clientY }; };
    const pointerMove = (event: PointerEvent) => { if (!orbit.current) return; yaw.current -= (event.clientX - orbit.current.x) * 0.006; pitch.current = THREE.MathUtils.clamp(pitch.current + (event.clientY - orbit.current.y) * 0.004, -1.3, 1.3); orbit.current = { x: event.clientX, y: event.clientY }; };
    const pointerUp = () => { orbit.current = null; };
    const wheel = (event: WheelEvent) => { if (mode === "build") distance.current = THREE.MathUtils.clamp(distance.current + event.deltaY * 0.012, 3, 80); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    gl.domElement.addEventListener("pointerdown", pointerDown); window.addEventListener("pointermove", pointerMove); window.addEventListener("pointerup", pointerUp);
    gl.domElement.addEventListener("wheel", wheel, { passive: true });
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); gl.domElement.removeEventListener("pointerdown", pointerDown); window.removeEventListener("pointermove", pointerMove); window.removeEventListener("pointerup", pointerUp); gl.domElement.removeEventListener("wheel", wheel); };
  }, [gl, mode]);

  useEffect(() => {
    const spawn = items.find((item) => item.asset === "spawn");
    runner.position.set(spawn?.x ?? 0, (spawn?.y ?? 0) + 0.94, spawn?.z ?? 0);
    velocityY.current = 0;
    completed.current = false;
  }, [items, mode, runner]);

  useFrame((_, deltaRaw) => {
    const delta = Math.min(0.05, deltaRaw);
    const pressed = keys.current;
    if (mode === "build") {
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
      runner.visible = false;
      return;
    }

    runner.visible = true;
    const x = Number(pressed.has("d") || pressed.has("arrowright")) - Number(pressed.has("a") || pressed.has("arrowleft"));
    const z = Number(pressed.has("s") || pressed.has("arrowdown")) - Number(pressed.has("w") || pressed.has("arrowup"));
    const length = Math.hypot(x, z);
    if (length) {
      runner.position.x += (x / length) * PLAYER.moveSpeed * delta;
      runner.position.z += (z / length) * PLAYER.moveSpeed * delta;
      runner.rotation.y = Math.atan2(x, z);
      stride.current += delta * 11;
    }
    if (pressed.has(" ") && grounded.current) { velocityY.current = PLAYER.jumpVelocity; grounded.current = false; }
    velocityY.current -= GRAVITY * delta;
    const previousY = runner.position.y;
    runner.position.y += velocityY.current * delta;
    let landing: number | null = null;
    for (const item of items) {
      const spec = platformSpec(item.asset); if (!spec) continue;
      const localX = Math.abs(runner.position.x - item.x); const localZ = Math.abs(runner.position.z - item.z);
      if (localX <= spec.width / 2 && localZ <= spec.depth / 2 && velocityY.current <= 0 && previousY >= item.y + 0.82 && runner.position.y <= item.y + 0.98) landing = Math.max(landing ?? -Infinity, item.y + 0.94);
    }
    if (landing !== null) { runner.position.y = landing; velocityY.current = 0; grounded.current = true; } else if (Math.abs(velocityY.current) > 0.1) grounded.current = false;
    const spawn = items.find((item) => item.asset === "spawn");
    if (runner.position.y < -12) { runner.position.set(spawn?.x ?? 0, (spawn?.y ?? 0) + 0.94, spawn?.z ?? 0); velocityY.current = 0; setNotice("You fell. Reset to the builder spawn point."); }
    for (const item of items) {
      const distanceTo = Math.hypot(runner.position.x - item.x, runner.position.z - item.z);
      if (isTrapAsset(item.asset) && distanceTo < TRAP_CATALOG[trapTypeOf(item.asset)].placementRadius + 0.35) { runner.position.set(spawn?.x ?? 0, (spawn?.y ?? 0) + 0.94, spawn?.z ?? 0); setNotice(`${TRAP_CATALOG[trapTypeOf(item.asset)].displayName} got you.`); }
      if (item.asset === "finish" && distanceTo < 1.15 && Math.abs(runner.position.y - item.y) < 2 && !completed.current) { completed.current = true; setNotice("Map cleared! Return to Build mode to keep editing."); }
    }
    runner.position.y += length ? Math.abs(Math.sin(stride.current)) * 0.025 : 0;
    target.current.set(runner.position.x, runner.position.y + 0.25, runner.position.z);
    camera.position.lerp(new THREE.Vector3(runner.position.x, runner.position.y + 6.4, runner.position.z + 9.2), 1 - Math.exp(-delta * 5));
    camera.lookAt(target.current);
  });
  return <primitive object={runner} />;
}

function BuilderScene({ items, mode, avatar, avatarSeed, selectedUid, onSelect, onMove, setNotice }: {
  items: readonly RoomItem[]; mode: "build" | "test"; avatar: AvatarConfig | null; avatarSeed: number; selectedUid: number | null;
  onSelect(uid: number | null): void; onMove(uid: number, x: number, z: number): void; setNotice(value: string): void;
}) {
  const unreachable = useMemo(() => unreachablePlatformIds(items), [items]);
  return <>
    <color attach="background" args={["#bfeaff"]} />
    <hemisphereLight args={["#effbff", "#7466b2", 1.1]} />
    <directionalLight position={[-7, 12, 8]} intensity={2.7} castShadow />
    {mode === "build" && <gridHelper args={[2000, 800, PALETTE.muted, "#c9e1e6"]} position={[0, -0.04, 0]} />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} onPointerDown={() => onSelect(null)}><planeGeometry args={[2000, 2000]} /><meshStandardMaterial color="#e8f6f4" transparent opacity={mode === "build" ? 0.26 : 0.05} /></mesh>
    {items.map((item) => <BuilderItemView key={item.uid} item={item} mode={mode} selected={item.uid === selectedUid} warning={mode === "build" && unreachable.has(item.uid)} onSelect={(uid) => onSelect(uid)} onMove={onMove} />)}
    <SceneController mode={mode} items={items} avatar={avatar} avatarSeed={avatarSeed} setNotice={setNotice} />
  </>;
}

function runtimeMap(items: readonly RoomItem[], avatarSeed: number): { track: BuiltTrack; challenge: ChallengeDTO } {
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
  const spawn = [spawnMarker?.x ?? 0, (spawnMarker?.y ?? 0) + 1.25, spawnMarker?.z ?? 0] as const;
  const exit = [finishMarker?.x ?? 0, (finishMarker?.y ?? 0) + 1.5, finishMarker?.z ?? -10] as const;
  const traps: TrapInstance[] = items.flatMap((item) => {
    if (!isTrapAsset(item.asset)) return [];
    const type = trapTypeOf(item.asset);
    return [{
      id: `builder-trap-${item.uid}`, type, ownerUserId: null, ownerName: "Map builder", ownerAvatarSeed: avatarSeed,
      depthAdded: 1, zoneId: `builder-piece-${item.uid}`, position: [item.x, item.y + 0.05, item.z] as const,
      rotationY: item.rotation, seed: item.uid * 7919, params: { ...TRAP_CATALOG[type].defaultParams, builderColor: item.color },
    }];
  });
  const track: BuiltTrack = { pieces, zones: [], spawn, exit, length: Math.max(1, Math.hypot(exit[0] - spawn[0], exit[2] - spawn[2])) };
  return { track, challenge: {
    id: "builder-test", slug: "builder-test", chainId: "builder-test", chainSlug: "builder-test", parentSlug: null,
    depth: traps.length, baseSeed: 1, levelVersion: 1, createdByName: "Map builder", createdByAvatarSeed: avatarSeed,
    addedTrap: traps.at(-1) ?? null, traps, ghostTrace: null,
    stats: { attempts: 0, completions: 0, survivalRate: null, bestTimeMs: null, recentAttempts: 0, shareCount: 0 },
    createdAt: new Date(0).toISOString(), isDemo: true,
  } };
}

interface RoomBuilderProps { avatar: AvatarConfig | null; avatarSeed: number; onClose(): void; randomSeed?: number; initialMode?: "build" | "test" }

export function RoomBuilder({ avatar, avatarSeed, onClose, randomSeed, initialMode = "build" }: RoomBuilderProps) {
  const generated = useMemo(() => randomSeed === undefined ? null : generateRandomRoom(randomSeed), [randomSeed]);
  const [items, setItems] = useState<RoomItem[]>(() => generated ?? loadItems());
  const [mode, setMode] = useState<"build" | "test">(initialMode);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [published, setPublished] = useState<PublishedMap[]>(loadPublished);
  const [notice, setNotice] = useState(generated ? "Fresh generated map. Reach the end gate." : "Free camera mode. Place game pieces anywhere, including vertically.");
  const [testSerial, setTestSerial] = useState(1);
  const [testStartedAt, setTestStartedAt] = useState(() => performance.now());
  const runtime = useMemo(() => runtimeMap(items, avatarSeed), [items, avatarSeed]);
  const selected = items.find((item) => item.uid === selectedUid) ?? null;
  const nextUid = () => Math.max(0, ...items.map((item) => item.uid)) + 1;
  const save = (next: RoomItem[]) => { setItems(next); if (!generated) window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); };
  const add = (asset: BuilderAsset) => {
    const item: RoomItem = { uid: nextUid(), asset, x: 0, y: 0, z: 0, rotation: 0, color: defaultColor(asset) };
    save([...items, item]); setSelectedUid(item.uid); setNotice(`${assetLabel(asset)} added at the camera origin. Drag it or use Lift/Lower.`);
  };
  const changeSelected = (change: Partial<RoomItem>) => { if (!selected) return; save(items.map((item) => item.uid === selected.uid ? { ...item, ...change } : item)); };
  const remove = () => { if (!selected) return; save(items.filter((item) => item.uid !== selected.uid)); setSelectedUid(null); };
  const duplicate = () => { if (!selected) return; const copy = { ...selected, uid: nextUid(), x: selected.x + 0.75, z: selected.z + 0.75 }; save([...items, copy]); setSelectedUid(copy.uid); };
  const publish = () => {
    if (!items.some((item) => item.asset === "spawn") || !items.some((item) => item.asset === "finish")) { setNotice("Add a spawn point and game end gate before publishing."); return; }
    const name = window.prompt("Name this map", `Chaos Map ${published.length + 1}`)?.trim(); if (!name) return;
    const map: PublishedMap = { id: crypto.randomUUID(), name, author: "Local builder", createdAt: new Date().toISOString(), schemaVersion: 2, items: items.map((item) => ({ ...item })) };
    const next = [map, ...published]; setPublished(next); window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next)); setNotice(`Published “${name}” to this build's map browser.`);
  };
  const trapMatches = TRAP_TYPES.filter((type) => TRAP_CATALOG[type].displayName.toLowerCase().includes(query.toLowerCase()));
  return <main className="room-builder">
    {mode === "build" ? <Canvas shadows camera={{ fov: 48, near: 0.05, far: 5000 }} onPointerMissed={() => setSelectedUid(null)}>
      <BuilderScene items={items} mode="build" avatar={avatar} avatarSeed={avatarSeed} selectedUid={selectedUid} onSelect={setSelectedUid} onMove={(uid, x, z) => save(items.map((item) => item.uid === uid ? { ...item, x, z } : item))} setNotice={setNotice} />
    </Canvas> : <GameCanvas
      challenge={runtime.challenge}
      trackOverride={runtime.track}
      phase="playing"
      attemptSerial={testSerial}
      startedAt={testStartedAt}
      placement={null}
      ghostEnabled={false}
      recordSample={() => undefined}
      onProgress={() => undefined}
      onFinish={() => setNotice("Map cleared exactly as a finished run would be.")}
      onFail={(outcome) => { setNotice(outcome === "fell" ? "You fell. Restarting at the builder spawn point." : "Test restarted."); setTestSerial((value) => value + 1); setTestStartedAt(performance.now()); }}
      onHazard={(contact) => setNotice(`${TRAP_CATALOG[contact.trapType].displayName} hit the runner.`)}
      onSelectZone={() => undefined}
      onMovePlacement={() => undefined}
      onAssetsReady={() => undefined}
    />}
    <header><div><span className="eyebrow">BUILD YOUR GAME</span><strong>{mode === "build" ? "Unlimited camera builder" : "Testing your map"}</strong><small>{mode === "build" ? "WASD pan · Q/E vertical · hold left drag orbit · wheel zoom" : "WASD run · Space jump"}</small></div><button className="button secondary" onClick={onClose}>← Menu</button></header>
    {mode === "build" && <aside className="room-builder-tray"><strong>Actual game assets</strong><div>{PIECES.map((entry) => <button key={entry.asset} onClick={() => add(entry.asset)}><span>{entry.emoji}</span>{entry.label}</button>)}</div><label className="room-builder-search">All {TRAP_TYPES.length} traps<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search traps" /></label><div>{trapMatches.map((type) => <button key={type} onClick={() => add(`trap:${type}`)}><span>💥</span>{TRAP_CATALOG[type].displayName}</button>)}</div></aside>}
    <section className="room-builder-tools"><b>{selected ? assetLabel(selected.asset) : `${items.length} assets`}</b>{selected && <label className="room-builder-color">Color <input type="color" value={selected.color} onChange={(event) => changeSelected({ color: event.target.value })} /></label>}<button disabled={!selected} onClick={() => changeSelected({ rotation: (selected?.rotation ?? 0) + Math.PI / 2 })}>↻ Rotate</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) + 0.25) })}>↑ Lift</button><button disabled={!selected || mode !== "build"} onClick={() => changeSelected({ y: snap((selected?.y ?? 0) - 0.25) })}>↓ Lower</button><button disabled={!selected || mode !== "build"} onClick={duplicate}>⧉ Copy</button><button disabled={!selected || mode !== "build"} onClick={remove}>🗑 Remove</button><button onClick={() => setBrowseOpen(true)}>🌐 Browse maps</button><button onClick={publish}>📤 Publish</button><button className="primary" onClick={() => { const next = mode === "build" ? "test" : "build"; setMode(next); setSelectedUid(null); if (next === "test") { setTestSerial((value) => value + 1); setTestStartedAt(performance.now()); } setNotice(next === "test" ? "Real game Test mode: spawn marker hidden. Reach the end gate." : "Builder camera restored. Red platforms are outside jump reach."); }}>{mode === "build" ? "▶ Test map" : "🧱 Keep building"}</button></section>
    <p className="room-builder-notice" role="status">{notice}</p>
    {browseOpen && <div className="room-builder-browser"><section><div className="eyebrow">COMMUNITY MAPS</div><h2>Browse maps</h2>{published.length === 0 ? <p>No maps have been published in this build yet.</p> : published.map((map) => <article key={map.id}><div><strong>{map.name}</strong><small>{map.items.length} assets · {new Date(map.createdAt).toLocaleDateString()}</small></div><button onClick={() => { save(map.items.map((item) => ({ ...item }))); setMode("test"); setBrowseOpen(false); setNotice(`Testing “${map.name}”.`); }}>Play</button></article>)}<button className="button secondary" onClick={() => setBrowseOpen(false)}>Close</button></section></div>}
  </main>;
}
