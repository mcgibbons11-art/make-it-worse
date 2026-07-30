"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { dressRunner } from "./PlayerVisual";
import { TONE_EXPOSURE } from "./render/tone";
import { createSeededRandom } from "@/lib/game/seed";
import { EDITABLE_SEGMENTS } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";

export type RoomItemKind = "block" | "wall" | "ramp" | "sofa" | "table" | "plant" | "fan" | "hammer" | "finish";
export interface RoomItem { uid: number; kind: RoomItemKind; x: number; z: number; rotation: number }
type Command =
  | { type: "add"; kind: RoomItemKind; clientX?: number; clientY?: number }
  | { type: "rotate" }
  | { type: "duplicate" }
  | { type: "delete" }
  | { type: "clear" };

const STORE_KEY = "miw.room-builder.v1";
const ROOM_LIMIT = 8.4;
const CATALOG: readonly { kind: RoomItemKind; emoji: string; label: string }[] = [
  { kind: "block", emoji: "🟦", label: "Floor block" },
  { kind: "wall", emoji: "🧱", label: "Wall" },
  { kind: "ramp", emoji: "📐", label: "Ramp" },
  { kind: "sofa", emoji: "🛋️", label: "Sofa" },
  { kind: "table", emoji: "🪑", label: "Table" },
  { kind: "plant", emoji: "🪴", label: "Plant" },
  { kind: "fan", emoji: "🌀", label: "Floor fan" },
  { kind: "hammer", emoji: "🔨", label: "Hammer" },
  { kind: "finish", emoji: "🚪", label: "Finish door" },
];

const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
const box = (w: number, h: number, d: number, color: string, y = h / 2) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

function buildItem(item: RoomItem): THREE.Group {
  const root = new THREE.Group();
  root.userData.builderItem = item;
  root.position.set(item.x, 0, item.z);
  root.rotation.y = item.rotation;
  switch (item.kind) {
    case "block":
      root.add(box(2.2, 0.45, 2.2, "#5aa8ff"));
      break;
    case "wall":
      root.add(box(3.2, 2.2, 0.28, "#f1dfc4"));
      break;
    case "ramp": {
      const ramp = box(2.2, 0.35, 2.6, "#ffd84d", 0.45);
      ramp.rotation.x = -0.2;
      root.add(ramp);
      break;
    }
    case "sofa":
      root.add(box(2.4, 0.55, 0.9, "#8f7be8", 0.45));
      root.add(box(2.4, 1.1, 0.3, "#725ccc", 0.8));
      root.add(box(0.3, 0.8, 1, "#725ccc", 0.55));
      const arm = box(0.3, 0.8, 1, "#725ccc", 0.55); arm.position.x = 1.05; root.add(arm);
      root.children[2]!.position.x = -1.05;
      break;
    case "table": {
      root.add(box(1.8, 0.18, 1.2, "#e8ad68", 1));
      for (const x of [-0.72, 0.72]) for (const z of [-0.42, 0.42]) {
        const leg = box(0.12, 0.95, 0.12, "#394254", 0.48); leg.position.x = x; leg.position.z = z; root.add(leg);
      }
      break;
    }
    case "plant": {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.55, 16), material("#d97655")); pot.position.y = 0.28; root.add(pot);
      for (const [x, z, s] of [[0, 0, 0.55], [-0.3, 0.08, 0.38], [0.28, -0.08, 0.4]] as const) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), material("#49a86e")); leaf.scale.y = 1.5; leaf.position.set(x, 0.85 + s, z); root.add(leaf);
      }
      break;
    }
    case "fan": {
      root.add(box(0.75, 0.18, 0.75, "#4f79bd", 0.1));
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.08, 10, 24), material("#273449")); cage.rotation.x = Math.PI / 2; cage.position.y = 0.72; root.add(cage);
      for (let index = 0; index < 3; index++) { const blade = box(0.16, 0.06, 0.7, "#9bc9ef", 0); blade.position.y = 0.72; blade.rotation.y = index * Math.PI / 3; root.add(blade); }
      break;
    }
    case "hammer": {
      const post = box(0.2, 2.3, 0.2, "#ffd84d", 1.15); root.add(post);
      const head = box(2.4, 0.55, 0.65, "#ef5565", 2.25); head.position.x = 0.9; root.add(head);
      break;
    }
    case "finish": {
      root.add(box(1.9, 2.7, 0.32, "#394254", 1.35));
      root.add(box(1.45, 2.25, 0.38, "#58d69c", 1.17));
      const sign = box(1.2, 0.35, 0.12, "#fff8e8", 2.35); sign.position.z = 0.26; root.add(sign);
      break;
    }
  }
  root.traverse((node) => { node.userData.builderRoot = root; });
  return root;
}

function loadItems(): RoomItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "[]") as RoomItem[];
    return Array.isArray(value) ? value.filter((item) => CATALOG.some((entry) => entry.kind === item.kind)) : [];
  } catch { return []; }
}

/**
 * Turn the old prefab-track catalogue into room-generation rules. Segment
 * difficulty determines hazards and its authored piece geometry determines
 * whether the room gets blocks, walls or ramps. A seed always rebuilds the
 * same room, but the clean-level button supplies a new seed each time.
 */
export function generateRandomRoom(seed: number): RoomItem[] {
  const random = createSeededRandom(seed);
  const candidates = [...EDITABLE_SEGMENTS].sort(() => random() - 0.5);
  const chosen = candidates.slice(0, 3);
  const items: RoomItem[] = [];
  let uid = 1;
  const add = (kind: RoomItemKind, x: number, z: number, rotation = 0) =>
    items.push({ uid: uid++, kind, x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4, rotation });
  for (let lane = 0; lane < chosen.length; lane++) {
    const segment = chosen[lane]!;
    const zBase = 3.25 - lane * 3.25;
    const piece = segment.pieces[Math.floor(random() * segment.pieces.length)];
    const shape = piece && piece.size[1] > 1 ? "ramp" : piece && piece.size[0] < 3.5 ? "wall" : "block";
    add(shape, (random() - 0.5) * 9, zBase, random() > 0.5 ? Math.PI / 2 : 0);
    if (segment.difficulty >= 1) add(random() > 0.5 ? "fan" : "hammer", (random() - 0.5) * 10, zBase - 1.2);
    if (segment.difficulty >= 2) add(random() > 0.5 ? "wall" : "ramp", (random() - 0.5) * 11, zBase - 0.4, random() > 0.5 ? Math.PI / 2 : 0);
  }
  add(random() > 0.5 ? "sofa" : "table", random() > 0.5 ? -6.5 : 6.5, -5.5, random() > 0.5 ? Math.PI / 2 : 0);
  add("plant", random() > 0.5 ? -7.2 : 7.2, 5.8);
  add("finish", (random() - 0.5) * 9, -7.6);
  return items;
}

interface RoomBuilderProps {
  avatar: AvatarConfig | null;
  avatarSeed: number;
  onClose(): void;
  randomSeed?: number;
  initialMode?: "build" | "test";
}

export function RoomBuilder({ avatar, avatarSeed, onClose, randomSeed, initialMode = "build" }: RoomBuilderProps) {
  const generatedItems = useMemo(() => randomSeed === undefined ? null : generateRandomRoom(randomSeed), [randomSeed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef(new Set<string>());
  const commands = useRef<Command[]>([]);
  const modeRef = useRef<"build" | "test">(initialMode);
  const [mode, setMode] = useState<"build" | "test">(initialMode);
  const [selected, setSelected] = useState<string | null>(null);
  const [count, setCount] = useState(() => generatedItems?.length ?? loadItems().length);
  const [notice, setNotice] = useState(generatedItems ? "Reach the green door. This room was generated fresh for this run." : "Drag an item from the tray onto the floor.");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); held.current.add(event.key.toLowerCase()); };
    const up = (event: KeyboardEvent) => held.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [onClose]);

  useEffect(() => {
    const element = canvas.current; if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = TONE_EXPOSURE; renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#bfeaff");
    scene.add(new THREE.HemisphereLight("#effbff", "#7466b2", 1.1));
    const sun = new THREE.DirectionalLight("#fff0c5", 2.7); sun.position.set(-7, 10, 8); sun.castShadow = true; scene.add(sun);
    const room = new THREE.Group(); scene.add(room);
    room.add(box(18, 0.3, 18, "#f4d7a8", -0.15));
    const back = box(18, 3, 0.35, "#f5e9d5", 1.5); back.position.z = -8.8; room.add(back);
    const left = box(0.35, 3, 18, "#f5e9d5", 1.5); left.position.x = -8.8; room.add(left);
    const right = box(0.35, 3, 18, "#f5e9d5", 1.5); right.position.x = 8.8; room.add(right);
    const runner = dressRunner(avatar, avatarSeed); const spawn = new THREE.Vector3(0, 0.94, 6.7); runner.position.copy(spawn); scene.add(runner);
    let items = generatedItems ? generatedItems.map((item) => ({ ...item })) : loadItems(); let nextUid = Math.max(0, ...items.map((item) => item.uid)) + 1;
    const roots = new Map<number, THREE.Group>();
    const mount = (item: RoomItem) => { const root = buildItem(item); roots.set(item.uid, root); scene.add(root); };
    items.forEach(mount);
    const save = () => { if (!generatedItems) window.localStorage.setItem(STORE_KEY, JSON.stringify(items)); setCount(items.length); };
    let selectedRoot: THREE.Group | null = null; let draggingRoot: THREE.Group | null = null; let orbiting = false; let lastX = 0; let yaw = 0;
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50); camera.position.set(0, 7, 14);
    const ray = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const point = new THREE.Vector3();
    const floorPoint = (clientX: number, clientY: number) => { const rect = element.getBoundingClientRect(); pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, camera); return ray.ray.intersectPlane(floor, point) ? point : null; };
    const choose = (root: THREE.Group | null) => { selectedRoot = root; setSelected(root ? CATALOG.find((entry) => entry.kind === (root.userData.builderItem as RoomItem).kind)?.label ?? "Item" : null); };
    const add = (kind: RoomItemKind, at?: THREE.Vector3 | null) => { const item: RoomItem = { uid: nextUid++, kind, x: THREE.MathUtils.clamp(Math.round((at?.x ?? 0) * 4) / 4, -ROOM_LIMIT, ROOM_LIMIT), z: THREE.MathUtils.clamp(Math.round((at?.z ?? 0) * 4) / 4, -ROOM_LIMIT, ROOM_LIMIT), rotation: 0 }; items = [...items, item]; mount(item); choose(roots.get(item.uid)!); save(); setNotice(`${CATALOG.find((entry) => entry.kind === kind)!.label} added. Drag it anywhere on the floor.`); };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; const rect = element.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects([...roots.values()], true)[0]; const root = hit?.object.userData.builderRoot as THREE.Group | undefined; if (root && modeRef.current === "build") { draggingRoot = root; choose(root); } else { orbiting = true; lastX = event.clientX; } };
    const move = (event: PointerEvent) => { if (draggingRoot) { const at = floorPoint(event.clientX, event.clientY); if (!at) return; draggingRoot.position.x = THREE.MathUtils.clamp(Math.round(at.x * 4) / 4, -ROOM_LIMIT, ROOM_LIMIT); draggingRoot.position.z = THREE.MathUtils.clamp(Math.round(at.z * 4) / 4, -ROOM_LIMIT, ROOM_LIMIT); const item = draggingRoot.userData.builderItem as RoomItem; item.x = draggingRoot.position.x; item.z = draggingRoot.position.z; } else if (orbiting) { yaw -= (event.clientX - lastX) * 0.006; lastX = event.clientX; } };
    const up = () => { if (draggingRoot) save(); draggingRoot = null; orbiting = false; };
    element.addEventListener("pointerdown", down); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    const fit = () => { const width = element.clientWidth || innerWidth; const height = element.clientHeight || innerHeight; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }; fit(); const watcher = new ResizeObserver(fit); watcher.observe(element);
    let frame = 0; let last = performance.now(); let stride = 0;
    const draw = (now: number) => { frame = requestAnimationFrame(draw); const delta = Math.min(0.05, (now - last) / 1000); last = now;
      for (const command of commands.current.splice(0)) {
        if (command.type === "add") add(command.kind, command.clientX === undefined ? null : floorPoint(command.clientX, command.clientY!));
        else if (command.type === "rotate" && selectedRoot) { selectedRoot.rotation.y += Math.PI / 2; (selectedRoot.userData.builderItem as RoomItem).rotation = selectedRoot.rotation.y; save(); }
        else if (command.type === "delete" && selectedRoot) { const uid = (selectedRoot.userData.builderItem as RoomItem).uid; scene.remove(selectedRoot); roots.delete(uid); items = items.filter((item) => item.uid !== uid); choose(null); save(); }
        else if (command.type === "duplicate" && selectedRoot) { const source = selectedRoot.userData.builderItem as RoomItem; add(source.kind, new THREE.Vector3(source.x + 0.75, 0, source.z + 0.75)); }
        else if (command.type === "clear") { for (const root of roots.values()) scene.remove(root); roots.clear(); items = []; choose(null); save(); setNotice("The room is empty again."); }
      }
      const keys = held.current; const dx = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft")); const dz = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup")); const length = Math.hypot(dx, dz);
      if (length) { const speed = delta * 3; const worldX = (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / length; const worldZ = (dz * Math.cos(yaw) - dx * Math.sin(yaw)) / length; const nx = THREE.MathUtils.clamp(runner.position.x + worldX * speed, -ROOM_LIMIT, ROOM_LIMIT); const nz = THREE.MathUtils.clamp(runner.position.z + worldZ * speed, -ROOM_LIMIT, ROOM_LIMIT); let blocked = false; if (modeRef.current === "test") for (const item of items) if (!["fan", "hammer", "finish", "plant"].includes(item.kind) && Math.hypot(nx - item.x, nz - item.z) < (item.kind === "wall" ? 1.45 : 1.05)) blocked = true; if (!blocked) { runner.position.x = nx; runner.position.z = nz; } runner.rotation.y = Math.atan2(worldX, worldZ); stride += delta * 11; runner.position.y = 0.94 + Math.abs(Math.sin(stride)) * 0.04; }
      if (modeRef.current === "test") for (const item of items) { const distance = Math.hypot(runner.position.x - item.x, runner.position.z - item.z); if ((item.kind === "fan" || item.kind === "hammer") && distance < 0.9) { runner.position.copy(spawn); setNotice(`The ${item.kind} got you. Room reset.`); } if (item.kind === "finish" && distance < 0.85) setNotice("Room cleared! Move the door or add more problems whenever you like."); }
      const target = new THREE.Vector3(runner.position.x, 0.55, runner.position.z); const wanted = new THREE.Vector3(runner.position.x + Math.sin(yaw) * 11, 8, runner.position.z + Math.cos(yaw) * 11); camera.position.lerp(wanted, 1 - Math.exp(-delta * 4)); camera.lookAt(target); renderer.render(scene, camera);
    }; frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); watcher.disconnect(); element.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); renderer.dispose(); };
  }, [avatar, avatarSeed, generatedItems]);

  const send = (command: Command) => commands.current.push(command);
  return <main className="room-builder">
    <canvas ref={canvas} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const kind = event.dataTransfer.getData("application/x-miw-item") as RoomItemKind; if (CATALOG.some((entry) => entry.kind === kind)) send({ type: "add", kind, clientX: event.clientX, clientY: event.clientY }); }} />
    <header><div><span className="eyebrow">{generatedItems ? "FRESH ROOM" : "BUILD YOUR GAME"}</span><strong>{mode === "build" ? "Build inside the room" : generatedItems ? "Beat this room" : "Testing your room"}</strong><small>WASD to move · hold left click on empty floor and drag to orbit</small></div><button className="button secondary" onClick={onClose}>← Menu</button></header>
    <aside className="room-builder-tray"><strong>Drag into the room</strong><div>{CATALOG.map((entry) => <button key={entry.kind} draggable onDragStart={(event) => event.dataTransfer.setData("application/x-miw-item", entry.kind)} onClick={() => send({ type: "add", kind: entry.kind })}><span>{entry.emoji}</span>{entry.label}</button>)}</div></aside>
    <section className="room-builder-tools"><b>{selected ?? `${count} items placed`}</b><button disabled={!selected} onClick={() => send({ type: "rotate" })}>↻ Rotate</button><button disabled={!selected} onClick={() => send({ type: "duplicate" })}>⧉ Copy</button><button disabled={!selected} onClick={() => send({ type: "delete" })}>🗑 Remove</button><button onClick={() => send({ type: "clear" })}>🧹 Clear</button><button className="primary" onClick={() => { const next = mode === "build" ? "test" : "build"; setMode(next); setNotice(next === "test" ? "Test mode: reach the door and avoid hazards." : "Build mode: drag anything to rearrange it."); }}>{mode === "build" ? "▶ Test room" : "🧱 Keep building"}</button></section>
    <p className="room-builder-notice" role="status">{notice}</p>
  </main>;
}
