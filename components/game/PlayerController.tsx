"use client";
import {
  CapsuleCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import {
  ATTEMPT_LIMIT_MS,
  EXIT_POSITION,
  KILL_PLANE_Y,
  PLAYER,
  PLAYER_SPAWN,
} from "@/lib/game/constants";
import {
  consumeJumpPress,
  getInput,
  markJumpApplied,
  resetHeldInput,
  resetInput,
  setKey,
} from "@/lib/game/input";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PlayerVisual, type PlayerMotionState, type PlayerPose } from "./PlayerVisual";
import type { DecodedGhostSample } from "@/lib/game/types";
import { LEVEL_PIECES } from "@/lib/game/level-definition";
export interface PlayerControllerProps {
  active: boolean;
  attemptSerial: number;
  visualVisible: boolean;
  pose: PlayerPose;
  avatarSeed: number;
  startedAt: number;
  soapUntilRef: React.MutableRefObject<number>;
  stunUntilRef: React.MutableRefObject<number>;
  grabbables: React.MutableRefObject<Map<string, RapierRigidBody>>;
  recordSample(sample: DecodedGhostSample): void;
  onProgress(value: number): void;
  onInteraction: ((state: { holdingObject: boolean; releasedObjectSpeed: number }) => void) | undefined;
  onFinish(): void;
  onFail(outcome: "fell" | "timeout" | "reset"): void;
}
export const PlayerController = forwardRef<
  RapierRigidBody,
  PlayerControllerProps
>(function PlayerController(
  {
    active,
    attemptSerial,
    visualVisible,
    pose,
    avatarSeed,
    startedAt,
    soapUntilRef,
    stunUntilRef,
    grabbables,
    recordSample,
    onProgress,
    onInteraction,
    onFinish,
    onFail,
  },
  forwardedRef,
) {
  const body = useRef<RapierRigidBody>(null);
  const lastGrounded = useRef(performance.now());
  const jumpPressedAt = useRef(-Infinity);
  const lastSample = useRef(0);
  const finalized = useRef(false);
  const heldBody = useRef<RapierRigidBody | null>(null);
  const liveAttemptSerial = useRef(0);
  const motion = useRef<PlayerMotionState>({ speed: 0, verticalVelocity: 0, grounded: true, yaw: 0, stunned: false });
  const setBodyRef = useCallback(
    (value: RapierRigidBody | null) => {
      body.current = value;
      if (typeof forwardedRef === "function") forwardedRef(value);
      else if (forwardedRef) forwardedRef.current = value;
    },
    [forwardedRef],
  );
  useEffect(() => {
    const map: Record<string, keyof ReturnType<typeof getInput>> = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "backward",
      ArrowDown: "backward",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
      Space: "jump",
      KeyE: "grab",
    };
    const down = (event: KeyboardEvent) => {
      const key = map[event.code];
      if (key && key !== "x" && key !== "z") {
        event.preventDefault();
        setKey(
          key as "forward" | "backward" | "left" | "right" | "jump" | "grab",
          true,
        );
      }
    };
    const up = (event: KeyboardEvent) => {
      const key = map[event.code];
      if (key && key !== "x" && key !== "z")
        setKey(
          key as "forward" | "backward" | "left" | "right" | "jump" | "grab",
          false,
        );
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", resetInput);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", resetInput);
      // Keep a press that lands during the transition into gameplay queued.
      // Clearing held directions prevents sticky movement without swallowing
      // the player's first jump on a busy frame.
      resetHeldInput();
    };
  }, []);
  useEffect(() => {
    const rigid = body.current;
    if (!rigid) return;
    if (pose === "failure") {
      rigid.setEnabledRotations(true, true, true, true);
      rigid.applyTorqueImpulse({ x: 2.8, y: 1.2, z: -3.4 }, true);
    }
  }, [pose]);
  useFrame((_, frameDelta) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    if (liveAttemptSerial.current !== attemptSerial) {
      rigidBody.setTranslation(
        { x: PLAYER_SPAWN[0], y: PLAYER_SPAWN[1], z: PLAYER_SPAWN[2] },
        true,
      );
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBody.resetForces(true);
      rigidBody.resetTorques(true);
      rigidBody.setEnabledRotations(false, false, false, true);
      liveAttemptSerial.current = attemptSerial;
      finalized.current = false;
      lastGrounded.current = performance.now();
      jumpPressedAt.current = -Infinity;
      lastSample.current = 0;
      resetInput();
      heldBody.current = null;
      return;
    }
    if (!active || finalized.current) return;
    const now = performance.now();
    const position = rigidBody.translation();
    const velocity = rigidBody.linvel();
    const surface = LEVEL_PIECES.filter(
      (piece) =>
        Math.abs(position.x - piece.center[0]) <= piece.size[0] / 2 + 0.08 &&
        Math.abs(position.z - piece.center[2]) <= piece.size[2] / 2 + 0.08,
    ).reduce<number | null>(
      (highest, piece) =>
        Math.max(highest ?? -Infinity, piece.center[1] + piece.size[1] / 2),
      null,
    );
    const grounded =
      surface !== null &&
      position.y >=
        surface + PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius - 0.18 &&
      position.y <=
        surface + PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius + 0.12 &&
      velocity.y <= 0.8;
    if (grounded) lastGrounded.current = now;
    const input = getInput();
    if (consumeJumpPress()) {
      jumpPressedAt.current = now;
    }
    const stunned = now < stunUntilRef.current;
    const slippery = now < soapUntilRef.current;
    const control = grounded ? 1 : PLAYER.airControl;
    const acceleration =
      PLAYER.acceleration *
      control *
      (slippery ? 0.24 : 1) *
      (stunned ? 0.25 : 1);
    const targetX = input.x * PLAYER.moveSpeed;
    const targetZ = input.z * PLAYER.moveSpeed;
    // Acceleration is defined per second, so consume elapsed render time.
    // Rapier catches up its fixed-step accumulator after a late frame; the old
    // 1/30 cap discarded the same elapsed time from player control and made the
    // game run in slow motion on a busy machine. The ceiling only guards the
    // first frame after a suspended tab from causing a giant velocity change.
    const step = Math.min(frameDelta, 0.25);
    const nextX =
      velocity.x +
      Math.max(
        -acceleration * step,
        Math.min(acceleration * step, targetX - velocity.x),
      );
    const nextZ =
      velocity.z +
      Math.max(
        -acceleration * step,
        Math.min(acceleration * step, targetZ - velocity.z),
      );
    motion.current = {
      speed: Math.hypot(velocity.x, velocity.z),
      verticalVelocity: velocity.y,
      grounded,
      yaw: Math.hypot(velocity.x, velocity.z) > 0.15 ? Math.atan2(velocity.x, velocity.z) : motion.current.yaw,
      stunned,
    };
    const cappedY = Math.max(-PLAYER.maxFallSpeed, velocity.y);
    rigidBody.setLinvel({ x: nextX, y: cappedY, z: nextZ }, true);
    const forwardX = Math.sin(motion.current.yaw);
    const forwardZ = Math.cos(motion.current.yaw);
    if (input.grab && !heldBody.current) {
      let nearest: RapierRigidBody | null = null;
      let nearestDistance = 2.4;
      for (const candidate of grabbables.current.values()) {
        try {
          if (!candidate.isValid()) continue;
          const candidatePosition = candidate.translation();
          const distance = Math.hypot(
            candidatePosition.x - position.x,
            candidatePosition.y - position.y,
            candidatePosition.z - position.z,
          );
          const horizontal = Math.max(0.001, Math.hypot(candidatePosition.x - position.x, candidatePosition.z - position.z));
          const facing = ((candidatePosition.x - position.x) * forwardX + (candidatePosition.z - position.z) * forwardZ) / horizontal;
          if (distance < nearestDistance && facing > 0.15) {
            nearest = candidate;
            nearestDistance = distance;
          }
        } catch {
          // The trap may have remounted between attempts; ignore stale handles.
        }
      }
      if (nearest) {
        heldBody.current = nearest;
        onInteraction?.({ holdingObject: true, releasedObjectSpeed: 0 });
        AudioManager.click();
      }
    }
    if (input.grab && heldBody.current) {
      try {
        const held = heldBody.current.translation();
        const heldVelocity = heldBody.current.linvel();
        const target = { x: position.x + forwardX * 1.75, y: position.y + 0.35, z: position.z + forwardZ * 1.75 };
        const distance = Math.hypot(target.x - held.x, target.y - held.y, target.z - held.z);
        if (distance > 5.5) {
          onInteraction?.({
            holdingObject: false,
            releasedObjectSpeed: Math.hypot(
              heldVelocity.x,
              heldVelocity.y,
              heldVelocity.z,
            ),
          });
          heldBody.current = null;
        }
        else {
          const stiffness = 18;
          const damping = 3.8;
          heldBody.current.wakeUp();
          heldBody.current.addForce({
            x: (target.x - held.x) * stiffness - heldVelocity.x * damping,
            y: (target.y - held.y) * stiffness - heldVelocity.y * damping,
            z: (target.z - held.z) * stiffness - heldVelocity.z * damping,
          }, true);
        }
      } catch {
        heldBody.current = null;
      }
    } else if (!input.grab && heldBody.current) {
      const released = heldBody.current;
      try {
        released.applyImpulse({ x: forwardX * 1.8, y: 0.8, z: forwardZ * 1.8 }, true);
        const velocity = released.linvel();
        onInteraction?.({
          holdingObject: false,
          releasedObjectSpeed: Math.hypot(velocity.x, velocity.y, velocity.z),
        });
      } catch {
        // Body was remounted while held.
        onInteraction?.({ holdingObject: false, releasedObjectSpeed: 0 });
      }
      heldBody.current = null;
      AudioManager.impact();
    }
    if (
      now - jumpPressedAt.current <= PLAYER.jumpBufferMs &&
      (grounded || now - lastGrounded.current <= PLAYER.coyoteTimeMs)
    ) {
      rigidBody.setLinvel({ x: nextX, y: PLAYER.jumpVelocity, z: nextZ }, true);
      markJumpApplied();
      setKey("jump", false);
      jumpPressedAt.current = -Infinity;
      AudioManager.jump();
    }
    if (Math.hypot(input.x, input.z) > 0.1) {
      const visual = rigidBody.rotation();
      void visual;
    }
    const progress = Math.min(
      1,
      Math.max(
        0,
        (position.z - PLAYER_SPAWN[2]) / (EXIT_POSITION[2] - PLAYER_SPAWN[2]),
      ),
    );
    onProgress(progress);
    if (now - lastSample.current >= 1000 / 15) {
      recordSample({
        x: position.x,
        y: position.y,
        z: position.z,
        yaw: Math.atan2(velocity.x, velocity.z),
        flags: (grounded ? 1 : 0) | (input.jump ? 2 : 0),
      });
      lastSample.current = now;
    }
    if (
      position.z >= EXIT_POSITION[2] - 0.45 &&
      Math.abs(position.x) < 1.15 &&
      position.y >= 0.1 &&
      position.y < 3.2
    ) {
      finalized.current = true;
      onFinish();
    } else if (position.y < KILL_PLANE_Y) {
      finalized.current = true;
      rigidBody.setEnabledRotations(true, true, true, true);
      rigidBody.applyTorqueImpulse({ x: 2.8, y: 0.8, z: -3.2 }, true);
      onFail("fell");
    } else if (now - startedAt >= ATTEMPT_LIMIT_MS) {
      finalized.current = true;
      onFail("timeout");
    }
  }, -100);
  return (
    <RigidBody
      ref={setBodyRef}
      userData={{ kind: "player" }}
      colliders={false}
      position={PLAYER_SPAWN}
      enabledRotations={[false, false, false]}
      mass={PLAYER.mass}
      gravityScale={PLAYER.gravityScale}
      linearDamping={PLAYER.linearDamping}
      angularDamping={PLAYER.angularDamping}
      canSleep={false}
      ccd
    >
      <CapsuleCollider
        args={[PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius]}
        friction={0.9}
        restitution={0.05}
      />
      <PlayerVisual avatarSeed={avatarSeed} visible={visualVisible} pose={pose} motion={motion} />
    </RigidBody>
  );
});
