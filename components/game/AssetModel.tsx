"use client";

import { useGLTF } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  CatmullRomCurve3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";

const assetBase = process.env.NEXT_PUBLIC_ASSET_BASE ?? "/";

export const MODEL_URLS = {
  hammer: `${assetBase}assets/models/cartoon_hammer.glb`,
  refrigerator: `${assetBase}assets/models/refrigerator.glb`,
  fan: `${assetBase}assets/models/standing_fan.glb`,
  soap: `${assetBase}assets/models/duck_soap_dish.glb`,
  spring: `${assetBase}assets/models/jump_pad.glb`,
  toilet: `${assetBase}assets/models/toilet.glb`,
  ball: `${assetBase}assets/models/beach_ball.glb`,
} as const;

export type ModelName = keyof typeof MODEL_URLS | "vacuum";

const CANDY_COLORS: Record<Exclude<ModelName, "vacuum">, readonly string[]> = {
  hammer: ["#ff5964", "#ffd84d", "#24324a"],
  refrigerator: ["#bfe8ff", "#fff3cf", "#ff7b6b", "#78aee8"],
  fan: ["#6bbcff", "#ffd84d", "#fff3cf", "#24324a"],
  soap: ["#73dff2", "#ffd84d", "#fff3cf", "#24324a"],
  spring: ["#54d69a", "#ffd84d", "#ff7b6b", "#24324a"],
  toilet: ["#b9a7ff", "#fff3cf", "#ff7b6b", "#24324a"],
  ball: ["#ff5964", "#ffd84d", "#6bbcff", "#54d69a"],
};

interface Props extends Omit<ThreeElements["group"], "children"> {
  model: ModelName;
}

function stableIndex(name: string, index: number, length: number): number {
  let hash = index + 7;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % length;
}

function LoadedAsset({ model }: { model: Exclude<ModelName, "vacuum"> }) {
  const { scene } = useGLTF(MODEL_URLS[model]);
  const clone = useMemo(() => {
    const next = scene.clone(true);
    let meshIndex = 0;
    next.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const palette = CANDY_COLORS[model];
      const color = palette[stableIndex(object.name, meshIndex, palette.length)]!;
      object.material = new MeshStandardMaterial({
        color,
        roughness: 0.78,
        metalness: 0.02,
      });
      object.castShadow = true;
      object.receiveShadow = true;
      meshIndex += 1;
    });
    return next;
  }, [model, scene]);
  return <primitive object={clone} />;
}

function OriginalAngryVacuum() {
  const hose = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(-0.5, 0.42, 0),
        new Vector3(-0.9, 0.75, 0.1),
        new Vector3(-1.1, 0.32, 0.45),
        new Vector3(-1.38, 0.16, 0.62),
      ]),
    [],
  );
  return (
    <group position={[0, 0.02, 0]}>
      <mesh castShadow position={[0, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.48, 0.72, 8, 16]} />
        <meshStandardMaterial color="#b9a7ff" roughness={0.76} />
      </mesh>
      <mesh castShadow position={[0.55, 0.46, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.35, 0.43, 0.24, 20]} />
        <meshStandardMaterial color="#24324a" roughness={0.84} />
      </mesh>
      <mesh castShadow position={[0.69, 0.55, -0.15]} rotation={[0, 0.2, -0.35]}>
        <boxGeometry args={[0.08, 0.17, 0.08]} />
        <meshStandardMaterial color="#ffd84d" />
      </mesh>
      <mesh castShadow position={[0.69, 0.55, 0.15]} rotation={[0, -0.2, -0.35]}>
        <boxGeometry args={[0.08, 0.17, 0.08]} />
        <meshStandardMaterial color="#ffd84d" />
      </mesh>
      <mesh castShadow position={[-0.08, 0.92, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.3, 0.07, 10, 20, Math.PI]} />
        <meshStandardMaterial color="#24324a" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[-0.32, 0.15, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.12, 14]} />
        <meshStandardMaterial color="#ff5964" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[-0.32, 0.15, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.12, 14]} />
        <meshStandardMaterial color="#ff5964" roughness={0.8} />
      </mesh>
      <mesh castShadow>
        <tubeGeometry args={[hose, 18, 0.075, 8, false]} />
        <meshStandardMaterial color="#24324a" roughness={0.88} />
      </mesh>
      <mesh castShadow position={[-1.42, 0.14, 0.7]} rotation={[0, -0.35, 0]}>
        <boxGeometry args={[0.52, 0.13, 0.34]} />
        <meshStandardMaterial color="#ff5964" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function AssetReadinessGate({ onReady }: { onReady(): void }) {
  useGLTF(Object.values(MODEL_URLS));
  useEffect(() => onReady(), [onReady]);
  return null;
}

export function AssetModel({ model, ...props }: Props) {
  return (
    <group {...props}>
      {model === "vacuum" ? <OriginalAngryVacuum /> : <LoadedAsset model={model} />}
    </group>
  );
}
