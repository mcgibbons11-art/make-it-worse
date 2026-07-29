// Review harness for the corridor environment. Mounts the real LevelGeometry and
// Lighting under the same renderer settings GameCanvas uses, at the chase pose
// CameraRig actually produces, so a before/after pair is the same picture of the
// same thing. Nothing in the game imports this; it lives outside the repo.
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense, useMemo, useRef } from "react";
import { ACESFilmicToneMapping } from "three";
import { LevelGeometry } from "@/components/game/LevelGeometry";
import { Lighting } from "@/components/game/Lighting";
import { TONE_EXPOSURE } from "@/components/game/render/tone";
import { createMAKEITWORSEApartmentRoomModel } from "@/components/game/models/createApartmentModel";
import { ApartmentRooms } from "@/components/game/environment/ApartmentRooms";
import type { ApartmentVariant } from "@/components/game/environment/apartmentFurnishing";

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: { calls: number; triangles: number; programs: number; frameMs: number; frames: number };
  }
}

// CameraRig: position (px, max(4.3, py + 4.2), pz - 7.4), target (px, py + 0.9,
// pz + 4.1), fov 52. A grounded runner sits at y = 0.1, so these are the three
// poses a player really occupies at three points down the classic course.
const RUNNER_Y = 0.1;
const VIEWS: Record<string, { x: number; z: number }> = {
  runway: { x: 0, z: 6.75 },
  bridge: { x: 0, z: 22.25 },
  ramp: { x: 0, z: 33.6 },
};

const params = new URLSearchParams(location.search);
const view = VIEWS[params.get("view") ?? "runway"] ?? VIEWS.runway!;
// ?room=<set> swaps the corridor for one room on its own, seen from where the
// corridor sees it: a chase camera never gets closer than this, so a detail that
// does not read here does not read at all.
const room = params.get("room") as ApartmentVariant | null;
const mirrored = params.get("mirror") === "1";
// ?rooms=<courseLength> renders the room strip alone through the real batching
// path, which is the only way to see the handedness split: handedness lives in
// ApartmentRooms, not in the factory, and only switches on above the threshold.
const roomStrip = Number(params.get("rooms") ?? 0);
const chaseAt = Number(params.get("chase") ?? 0);
// The shipped Canvas runs dpr up to 1.5. Draw-call overhead is flat in dpr and
// fill cost is not, so this is what separates a draw-call-bound scene from a
// fill-bound one.
const pixelRatio = Number(params.get("dpr") ?? 1);
const WARMUP_FRAMES = 60;
const MEASURE_FRAMES = 180;

// ?mirror=1 flips the room in X, which is the repetition lever that looks free
// and is not. The sculpt is a corner open on +X and +Z; mirroring in X puts the
// solid wall on the corridor side, so the room turns its back on the player.
function Room({ variant, mirrored }: { variant: ApartmentVariant; mirrored: boolean }) {
  const model = useMemo(
    () => createMAKEITWORSEApartmentRoomModel({ textureSize: 256, qualityPriority: "balanced", variant }),
    [variant],
  );
  return <primitive object={model} scale={mirrored ? [-1, 1, 1] : [1, 1, 1]} />;
}

function Probe() {
  const { gl, camera } = useThree();
  const frame = useRef(0);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (roomStrip > 0) {
      if (chaseAt > 0) {
        // The pose that decides it: a bird's eye flatters a room strip, and the
        // question is what the CHASE camera sees of a handedness whose wall is
        // on the near side.
        camera.position.set(0, 4.3, chaseAt - 7.4);
        camera.lookAt(0, 1, chaseAt + 4.1);
      } else {
        camera.position.set(11.5, 15.5, roomStrip * 0.42);
        camera.lookAt(0, 0, roomStrip * 0.52);
      }
    } else if (room) {
      // The sculpt is open on +X and +Z, so this is the only quadrant that sees
      // both inner walls at once. It is the reference's own diagonal.
      camera.position.set(5.4, 4.4, 5.4);
      camera.lookAt(0, 1.15, 0);
    } else {
      camera.position.set(view.x, Math.max(4.3, RUNNER_Y + 4.2), view.z - 7.4);
      camera.lookAt(view.x, RUNNER_Y + 0.9, view.z + 4.1);
    }
    frame.current += 1;
    if (frame.current > WARMUP_FRAMES && frame.current <= WARMUP_FRAMES + MEASURE_FRAMES) {
      elapsed.current += delta;
    }
    if (frame.current === WARMUP_FRAMES + MEASURE_FRAMES) {
      window.__stats = {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? 0,
        frameMs: (elapsed.current * 1000) / MEASURE_FRAMES,
        frames: MEASURE_FRAMES,
      };
      window.__ready = true;
    }
  });
  return null;
}

createRoot(document.getElementById("root")!).render(
  <Canvas
    shadows="percentage"
    dpr={pixelRatio}
    camera={{ fov: 52, near: 0.1, far: 180, position: [0, 4.3, 0] }}
    gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
    onCreated={({ gl }) => {
      gl.toneMapping = ACESFilmicToneMapping;
      gl.toneMappingExposure = TONE_EXPOSURE;
    }}
  >
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} paused>
        <Lighting />
        {roomStrip > 0 ? (
          <ApartmentRooms courseLength={roomStrip} />
        ) : room ? (
          <Room variant={room} mirrored={mirrored} />
        ) : (
          <LevelGeometry />
        )}
      </Physics>
    </Suspense>
    <Probe />
  </Canvas>,
);
