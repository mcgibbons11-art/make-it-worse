"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, DirectionalLight, Group, LinearSRGBColorSpace, Mesh, Object3D, Vector3 } from "three";
import {
  createSkyBirdModel,
  createSkyPlaneModel,
} from "./models/createSkyAmbienceModel";
import {
  FOG_DENSITY,
  FOG_RADIANCE,
  SKY_RADIANCE,
  glslVec3,
} from "./render/tone";

// The sun was pinned at the world origin. Working the shadow camera's basis
// from its position gives a horizontal axis of (-0.6, 0, 0.8), so a centreline
// point lands at u = 0.8z and the +/-12 frustum ran out at z = 15 - on a course
// that reaches z = 41 as standard and up to 285 on a long custom track. Outside
// the frustum three.js reports "fully lit" rather than fading, so the contact
// shadow under the runner did not soften, it stopped dead, taking the only
// real height cue in a chase-cam platformer with it. Anchoring the light and
// its target to the camera keeps that frustum wrapped around the player for the
// whole course.
//
// The elevation then dropped from 61 to 50 degrees and the map was re-fitted to
// the corridor rather than to a 9u-wide guess. Solving the shadow basis for the
// volume the chase camera can actually show - |x| <= 6.2 (the walls sit at
// 5.79), y in [-1.5, 6.5], z from 7.5 behind the runner to 18 ahead - gives
// u in [-11.85, 16.40] and v in [-9.04, 14.33], so the frustum below covers it
// with about a third of a unit of margin on every side. That is 29.0 x 24.1
// units on a 2048 map: 70.6 texels per unit, the same density the previous
// frustum had, while reaching 18u ahead of the runner instead of 12.7u and
// throwing shadows about 40% longer.
const SUN_OFFSET = [-10, 14, -6] as const;
// The camera trails the runner by 7.4u and looks 4.1u past them, so focusing a
// little ahead of the player centres the map on what is actually on screen.
const SUN_FOCUS_AHEAD = 10;
// The dome was fixed at the world origin with a radius of 95, so on a 285u
// custom track the camera walked out of it and the sky stopped being drawn.
// Riding with the camera also makes the gradient a function of the true view
// ray rather than of a direction skewed by the camera's offset from the origin.
const SKY_RADIUS = 95;

const SKY_VERTEX = `varying vec3 vWorld;
void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = normalize(world.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

// The dome is the one surface that used to write display values straight to the
// framebuffer: a bare shaderMaterial carries no tone-mapping or output-encoding
// include unless it asks for one, so it bypassed the ACES curve every lit
// surface goes through. The two includes below put it back on the same path.
// They also cost nothing in the HDR pipeline, where the renderer's own output
// pass does the tone mapping and the includes compile away to a no-op.
const SKY_FRAGMENT = `varying vec3 vWorld;
void main(){
  vec3 col = mix(${glslVec3(SKY_RADIANCE.deep)}, ${glslVec3(SKY_RADIANCE.horizon)}, smoothstep(-0.85, -0.02, vWorld.y));
  col = mix(col, ${glslVec3(SKY_RADIANCE.zenith)}, smoothstep(0.0, 0.8, vWorld.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUD_PUFFS = [
  [-1.45, -0.06, 0, 0.68],
  [-0.76, 0.12, 0.08, 0.9],
  [0, 0.3, 0, 1.08],
  [0.78, 0.1, -0.04, 0.86],
  [1.43, -0.08, 0.05, 0.62],
] as const;

function Cloud({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {/* A broad soft base keeps the cloud reading as one puffy silhouette
          instead of a row of unrelated balls. It is decorative and never
          participates in raycasts or physics. */}
      <mesh position={[0, -0.19, 0]} scale={[1.9, 0.45, 0.72]} raycast={() => undefined} renderOrder={-5} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 9]} />
        <meshBasicMaterial color="#f5fbff" fog={false} depthTest={false} depthWrite={false} />
      </mesh>
      {CLOUD_PUFFS.map(([x, y, z, puffScale], index) => (
        <mesh
          key={`${x}-${index}`}
          position={[x, y, z]}
          scale={[puffScale, puffScale * 0.92, puffScale * 0.78]}
          raycast={() => undefined}
          renderOrder={-5}
          frustumCulled={false}
        >
          <sphereGeometry args={[0.82, 14, 10]} />
          <meshBasicMaterial color={index % 2 ? "#ffffff" : "#f3f9ff"} fog={false} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function disposeGenerated(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * Camera-relative environmental dressing. These objects stay outside the
 * playable course and own no colliders, event handlers, or gameplay state.
 * Following the camera's broad position means an unlimited custom map cannot
 * simply run past its sky after a few hundred metres.
 */
function SkyAmbience() {
  const root = useRef<Group>(null);
  const clouds = useRef<Group>(null);
  const planeRef = useRef<Group>(null);
  const birdRefs = useRef<Array<Group | null>>([]);
  const cameraForward = useRef(new Vector3(0, 0, 1));
  const planeModel = useMemo(() => createSkyPlaneModel(), []);
  const birdModels = useMemo(
    () => Array.from({ length: 5 }, () => createSkyBirdModel()),
    [],
  );

  useEffect(
    () => {
      // These tiny distant silhouettes are atmosphere, not course geometry.
      // Exempting them from distance fog prevents them dissolving into the
      // near-identical sky colour before they ever enter the frame.
      for (const model of [planeModel, ...birdModels]) {
        model.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          child.renderOrder = -5;
          child.frustumCulled = false;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            material.fog = false;
            material.depthTest = false;
            material.depthWrite = false;
          }
        });
      }
      return () => {
        disposeGenerated(planeModel);
        for (const bird of birdModels) disposeGenerated(bird);
      };
    },
    [birdModels, planeModel],
  );

  useFrame(({ camera, clock }) => {
    const group = root.current;
    if (!group) return;
    const elapsed = clock.getElapsedTime();
    camera.getWorldDirection(cameraForward.current);
    cameraForward.current.y = 0;
    if (cameraForward.current.lengthSq() < 0.001) cameraForward.current.set(0, 0, 1);
    else cameraForward.current.normalize();
    group.position.set(
      camera.position.x + cameraForward.current.x * 25,
      0,
      camera.position.z + cameraForward.current.z * 25,
    );
    group.rotation.y = Math.atan2(cameraForward.current.x, cameraForward.current.z);
    if (clouds.current) {
      clouds.current.position.x = Math.sin(elapsed * 0.035) * 2.4;
      clouds.current.position.y = Math.sin(elapsed * 0.07) * 0.22;
    }

    // The plane spends most of a 46-second cycle off screen, then crosses once
    // in roughly twelve seconds. It never flies over the deck itself.
    const planePhase = (elapsed % 46) / 46;
    const plane = planeRef.current;
    if (plane) plane.visible = planePhase < 0.27;
    if (plane?.visible) {
      const crossing = planePhase / 0.27;
      plane.position.set(-27 + crossing * 54, 7 + Math.sin(crossing * Math.PI) * 0.7, 3);
      plane.rotation.set(0.03, 0, 0.02 * Math.sin(elapsed * 0.8));
      const propeller = plane.getObjectByName("propeller__pivot");
      if (propeller) propeller.rotation.x = elapsed * 28;
    }

    // A small flock crosses on a different rhythm. Each bird gets a phase and
    // height offset so it reads as life in the distance rather than UI noise.
    const flockPhase = (elapsed % 31) / 31;
    for (let index = 0; index < birdRefs.current.length; index += 1) {
      const bird = birdRefs.current[index];
      if (!bird) continue;
      bird.visible = flockPhase > 0.34 && flockPhase < 0.78;
      if (!bird.visible) continue;
      const crossing = (flockPhase - 0.34) / 0.44;
      bird.position.set(
        29 - crossing * 58 + index * 1.5,
        7.6 + (index % 3) * 0.46 + Math.sin(elapsed * 1.4 + index) * 0.18,
        -3 - index * 0.72,
      );
      bird.rotation.y = Math.PI;
      const flap = Math.sin(elapsed * 7.2 + index * 0.75) * 0.62;
      const left = bird.getObjectByName("wing-left__pivot");
      const right = bird.getObjectByName("wing-right__pivot");
      if (left) left.rotation.x = flap;
      if (right) right.rotation.x = -flap;
    }
  });

  return (
    <group ref={root}>
      {/* The sun reads as a flat paper disc without a halo. Two translucent
          shells behind the core fake a soft glow for the cost of two draw
          calls; with depthTest off, paint order is renderOrder, so the halos
          (-7, -6) land under the core (-5). */}
      <group position={[-9, 7.1, 3]}>
        <mesh raycast={() => undefined} renderOrder={-7} frustumCulled={false}>
          <sphereGeometry args={[3.9, 24, 16]} />
          <meshBasicMaterial color="#ffe9c4" transparent opacity={0.14} fog={false} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh raycast={() => undefined} renderOrder={-6} frustumCulled={false}>
          <sphereGeometry args={[2.7, 24, 16]} />
          <meshBasicMaterial color="#fff1a8" transparent opacity={0.3} fog={false} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh raycast={() => undefined} renderOrder={-5} frustumCulled={false}>
          <sphereGeometry args={[1.95, 24, 16]} />
          <meshBasicMaterial color="#fff1a8" fog={false} depthTest={false} depthWrite={false} />
        </mesh>
      </group>
      <group ref={clouds}>
        <Cloud position={[-13.5, 5.4, -4]} scale={1.7} />
        <Cloud position={[10.5, 6.2, 1]} scale={1.35} />
        <Cloud position={[-3.5, 8.4, 6]} scale={0.82} />
        <Cloud position={[17, 5, 8]} scale={1.1} />
        <Cloud position={[2.5, 9, -6]} scale={0.7} />
      </group>
      <primitive ref={planeRef} object={planeModel} />
      {birdModels.map((bird, index) => (
        <primitive
          key={index}
          ref={(value: Group | null) => { birdRefs.current[index] = value; }}
          object={bird}
        />
      ))}
    </group>
  );
}

export function Lighting({ interior = false }: { interior?: boolean }) {
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<Mesh>(null);
  const sunTarget = useMemo(() => new Object3D(), []);
  const fogColor = useMemo(
    () => new Color().setRGB(FOG_RADIANCE[0], FOG_RADIANCE[1], FOG_RADIANCE[2], LinearSRGBColorSpace),
    [],
  );
  useEffect(() => {
    if (sun.current) sun.current.target = sunTarget;
  }, [sunTarget]);
  useFrame(({ camera }) => {
    const light = sun.current;
    if (!light) return;
    const focusZ = camera.position.z + SUN_FOCUS_AHEAD;
    light.position.set(SUN_OFFSET[0], SUN_OFFSET[1], focusZ + SUN_OFFSET[2]);
    sunTarget.position.set(0, 0, focusZ);
    sky.current?.position.copy(camera.position);
  });
  const motes = Array.from({ length: 28 }, (_, index) => ({
    x: ((index * 37) % 19) - 9,
    y: 1.5 + ((index * 17) % 32) / 8,
    z: ((index * 53) % 47) - 2,
    size: 0.025 + (index % 3) * 0.012,
  }));
  return (
    <>
      <color attach="background" args={["#72bff2"]} />
      <mesh ref={sky} scale={SKY_RADIUS} renderOrder={-10}>
        <sphereGeometry args={[1, 32, 18]} />
        <shaderMaterial side={1} depthWrite={false} vertexShader={SKY_VERTEX} fragmentShader={SKY_FRAGMENT} />
      </mesh>
      <fogExp2 attach="fog" args={[fogColor, FOG_DENSITY]} />
      <hemisphereLight intensity={interior ? 1.12 : 0.95} color={interior ? "#fff4df" : "#eaf8ff"} groundColor={interior ? "#b89b7a" : "#7466b2"} />
      {/* Intensity tracks the elevation: a horizontal deck receives
          intensity * sin(elevation), so dropping the sun from 61 to 50 degrees
          costs it a factor of 0.766/0.875. 2.1 / 0.875 * 0.766 undoes exactly
          that, keeping deck luminance and the lit-to-shadow ratio where they
          were while the shadows themselves get longer. */}
      <directionalLight ref={sun} castShadow position={[...SUN_OFFSET]} intensity={interior ? 1.65 : 2.4} color="#fff0c5" shadow-mapSize={[2048, 2048]} shadow-bias={-0.00018} shadow-normalBias={0.03} shadow-camera-left={-12.2} shadow-camera-right={16.8} shadow-camera-top={14.7} shadow-camera-bottom={-9.4} />
      <primitive object={sunTarget} />
      <directionalLight position={[10, 8, 28]} intensity={0.6} color="#99c9ff" />
      <pointLight position={[-8, 8, 18]} color="#ffb8ad" intensity={5} distance={32} decay={2} />
      <pointLight position={[8, 7, 35]} color="#a9c8ff" intensity={5} distance={30} decay={2} />
      {!interior && (
        <>
          <group>
            {motes.map((mote, index) => (
              <mesh key={index} position={[mote.x, mote.y, mote.z]}>
                <sphereGeometry args={[mote.size, 6, 5]} />
                <meshBasicMaterial color={index % 2 ? "#fff8d5" : "#dff6ff"} transparent opacity={0.78} />
              </mesh>
            ))}
          </group>
          <SkyAmbience />
        </>
      )}
    </>
  );
}
