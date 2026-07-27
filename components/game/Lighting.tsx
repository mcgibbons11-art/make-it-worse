"use client";

import { PALETTE } from "@/lib/game/constants";

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

export function Lighting() {
  const motes = Array.from({ length: 28 }, (_, index) => ({
    x: ((index * 37) % 19) - 9,
    y: 1.5 + ((index * 17) % 32) / 8,
    z: ((index * 53) % 47) - 2,
    size: 0.025 + (index % 3) * 0.012,
  }));
  return (
    <>
      <color attach="background" args={["#72bff2"]} />
      <mesh scale={95} renderOrder={-10}>
        <sphereGeometry args={[1, 32, 18]} />
        <shaderMaterial
          side={1}
          depthWrite={false}
          vertexShader={`varying vec3 vWorld; void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=normalize(world.xyz-cameraPosition);gl_Position=projectionMatrix*viewMatrix*world;}`}
          fragmentShader={`varying vec3 vWorld; void main(){float horizon=smoothstep(-0.25,0.75,vWorld.y);vec3 low=vec3(0.78,0.92,1.0);vec3 high=vec3(0.20,0.60,0.96);gl_FragColor=vec4(mix(low,high,horizon),1.0);}`}
        />
      </mesh>
      <fogExp2 attach="fog" args={[PALETTE.skyBottom, 0.0045]} />
      <hemisphereLight intensity={0.95} color="#eaf8ff" groundColor="#7466b2" />
      <directionalLight castShadow position={[-8, 18, -6]} intensity={2.1} color="#fff0c5" shadow-mapSize={[2048, 2048]} shadow-bias={-0.00018} shadow-normalBias={0.03} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={18} shadow-camera-bottom={-10} />
      <directionalLight position={[10, 8, 28]} intensity={0.6} color="#99c9ff" />
      <mesh position={[-20, 17, 52]}>
        <sphereGeometry args={[3.6, 24, 16]} />
        <meshBasicMaterial color="#fff1a8" />
      </mesh>
      <pointLight position={[-8, 8, 18]} color="#ffb8ad" intensity={5} distance={32} decay={2} />
      <pointLight position={[8, 7, 35]} color="#a9c8ff" intensity={5} distance={30} decay={2} />
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
  );
}
