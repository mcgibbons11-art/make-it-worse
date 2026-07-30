"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, DirectionalLight, LinearSRGBColorSpace, Mesh, Object3D } from "three";
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

function Cloud({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[-1, 0, 0.9].map((x, index) => (
        <mesh key={x} position={[x, index === 1 ? 0.28 : 0, 0]}>
          <sphereGeometry args={[index === 1 ? 0.85 : 0.62, 12, 9]} />
          <meshStandardMaterial color="white" roughness={1} />
        </mesh>
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
      <mesh position={[-20, 17, 52]}>
        <sphereGeometry args={[3.6, 24, 16]} />
        <meshBasicMaterial color="#fff1a8" />
      </mesh>
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
          <Cloud position={[-13, 8, 10]} scale={1.5} />
          <Cloud position={[12, 10, 25]} scale={1.1} />
          <Cloud position={[-16, 7, 38]} scale={0.9} />
        </>
      )}
    </>
  );
}
