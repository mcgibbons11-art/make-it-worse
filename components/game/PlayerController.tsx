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
  getCameraYaw,
  getInput,
  isInterfaceTarget,
  markJumpApplied,
  resetHeldInput,
  resetInput,
  setKey,
} from "@/lib/game/input";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PlayerVisual, type PlayerMotionState, type PlayerPose } from "./PlayerVisual";
import type { DecodedGhostSample } from "@/lib/game/types";
import { LEVEL_PIECES, type LevelPiece } from "@/lib/game/level-definition";
import type { BuiltTrack } from "@/lib/game/track";
import { trackFacingYaw } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";
/**
 * Ground covered between footsteps, and the speed below which the runner is
 * shuffling rather than walking. Driving the cue off distance rather than a
 * timer ties the cadence to how fast the runner is actually moving, so a
 * sprint patters and a nudge against a wall makes no sound at all. At the
 * 7.2 m/s top speed this is a little under four steps a second, against a
 * capsule that stands 1.86 units tall.
 */
const FOOTSTEP_STRIDE = 1.9;
const FOOTSTEP_MIN_SPEED = 0.6;
/**
 * How far inside a platform footprint the runner's centre must be before the
 * controller treats the platform as ground.
 *
 * The old positive margin extended invisible support past the visible edge;
 * the capsule could then rub its rounded side against the vertical face while
 * the controller cancelled gravity, producing the reported ledge stutter.
 * Coyote time already preserves late jumps, so support can end inside the deck
 * and let the body cleanly fall.
 */
// A centre only four centimetres inside a slab could still be reported as
// supported while almost the entire capsule was hanging outside it. Rapier's
// rounded lower hemisphere then supplied an upward contact against the corner,
// while the controller cancelled the downward velocity: the familiar sticky
// half-step on a ledge. Require the same deliberate landing inset used by the
// step probe. A marginal catch now keeps falling, while a real landing still
// has most of a foot of usable deck around it.
const GROUND_MARGIN = -0.12;

/**
 * First-frame drop when a runner walks off real support.
 *
 * Gravity would reach this speed in roughly two fixed physics frames. Applying
 * it immediately prevents the capsule's round bottom from spending those two
 * frames riding the outside corner. Coyote time remains intact because a
 * buffered jump is resolved before this release and replaces the drop.
 */
const LEDGE_RELEASE_SPEED = 1.2;
/**
 * How far in front of the runner the step assist looks, and how far forward it
 * places them when it fires.
 *
 * These two are one number because the assist lands the runner exactly on the
 * point it probed, and it is solved rather than tuned. A capsule stopped
 * against a ledge has its centre capsuleRadius short of the face, and the probe
 * has to reach STEP_LANDING_INSET past that face for the landing to be over
 * solid deck, so the reach is the sum of the two. Firing distance falls out of
 * the same arithmetic: the assist triggers the moment the capsule's leading
 * surface touches the ledge and not a frame before it, so a runner crossing
 * open floor never floats.
 */
const STEP_LANDING_INSET = 0.12;
const STEP_PROBE = PLAYER.capsuleRadius + STEP_LANDING_INSET;

/**
 * The top of the highest piece covering (`x`, `z`), or null out over the void.
 *
 * Highest rather than nearest on purpose, and it is the same rule the placement
 * validator uses: a piece with air underneath makes the ground beneath it
 * unstandable, so nothing in the catalogue may become an overpass. The step
 * assist leans on that - a low ledge tucked under a high deck reports the deck,
 * whose rise is out of the assist's reach, so the assist declines rather than
 * lifting the runner into the underside of something.
 *
 * A negative `margin` demands the point sit that far inside the footprint,
 * which is how the assist refuses a landing balanced on a deck's edge.
 */
function surfaceUnder(
  pieces: readonly LevelPiece[],
  x: number,
  z: number,
  margin: number,
  // Ignore tops above this height. Without the bound, standing on a deck
  // BENEATH a taller overlapping piece (a bridge, a stacked platform, a
  // crate overhang - generated courses are full of them) reported the roof
  // overhead as "the surface", the grounded window failed against it, and
  // the runner was stuck airborne on the ground: air-control steering that
  // read as uncontrollable sliding, and no jump. The default keeps the old
  // behaviour for callers like the step assist that bound the rise
  // themselves.
  maxTop = Infinity,
): number | null {
  let highest: number | null = null;
  for (const piece of pieces) {
    if (Math.abs(x - piece.center[0]) > piece.size[0] / 2 + margin) continue;
    if (Math.abs(z - piece.center[2]) > piece.size[2] / 2 + margin) continue;
    const top = piece.center[1] + piece.size[1] / 2;
    if (top > maxTop) continue;
    if (highest === null || top > highest) highest = top;
  }
  return highest;
}
export interface PlayerControllerProps {
  active: boolean;
  /** Free-roam spaces share movement but do not have a timer or finish gate. */
  freeRoam?: boolean;
  attemptSerial: number;
  /** Composed course. Omitted means the original fixed level. */
  track?: BuiltTrack;
  visualVisible: boolean;
  pose: PlayerPose;
  avatarSeed: number;
  /** The viewer's chosen outfit, or null to fall back to the seeded look. */
  avatar?: AvatarConfig | null;
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
    freeRoam = false,
    attemptSerial,
    track,
    visualVisible,
    pose,
    avatarSeed,
    avatar = null,
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
  const pieces = track?.pieces ?? LEVEL_PIECES;
  const spawn = track?.spawn ?? PLAYER_SPAWN;
  const exit = track?.exit ?? EXIT_POSITION;
  const spawnYaw = trackFacingYaw({ spawn, exit });
  const body = useRef<RapierRigidBody>(null);
  const lastGrounded = useRef(performance.now());
  const jumpPressedAt = useRef(-Infinity);
  // True while a rise the player started is still theirs to shorten. Cleared by
  // anything that is not their jump any more: landing, the apex, or a launcher
  // overwriting the velocity, so a spring pad cannot be cut short by a player
  // who simply was not holding the button.
  const jumpCutArmed = useRef(false);
  const lastSample = useRef(0);
  const stride = useRef(0);
  const finalized = useRef(false);
  const heldBody = useRef<RapierRigidBody | null>(null);
  const liveAttemptSerial = useRef(0);
  const motion = useRef<PlayerMotionState>({ speed: 0, verticalVelocity: 0, grounded: true, yaw: spawnYaw, stunned: false });
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
      // Without this guard the preventDefault below swallowed Space on every
      // focused button and ate WASD/E out of the display-name field.
      if (isInterfaceTarget(event.target)) return;
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
      // A release can only clear movement. It must be accepted even when a
      // result/menu button has taken focus since keydown; ignoring that keyup
      // is how W survived the old run and walked the next runner off spawn.
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
    try {
      if (!rigid.isValid()) return;
      if (pose === "failure") {
        rigid.setEnabledRotations(true, true, true, true);
        rigid.applyTorqueImpulse({ x: 2.8, y: 1.2, z: -3.4 }, true);
      }
    } catch {
      // The body can be remounting between attempts.
    }
  }, [pose]);
  useFrame((_, frameDelta) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    // A truthy ref is not a live body: during a course swap the body can be
    // freed while the wrapper is still reachable for a frame, and any wasm
    // call on it panics and borrow-poisons the whole physics world.
    try {
      if (!rigidBody.isValid()) return;
    } catch {
      return;
    }
    // Pin the capsule upright, every frame, unconditionally.
    //
    // enabledRotations={[false,false,false]} on the RigidBody is supposed to
    // make this unnecessary and does not: measured in a running build, the
    // runner's world up vector reached (0.12, 0.20, -0.97) - tipped 78 degrees
    // onto its side - while PlayerVisual's own rotation was exactly identity,
    // so the tilt came from the body itself. It survived respawn because
    // nothing reset it, which is why a death left the runner lying on the floor
    // for the rest of the session.
    //
    // A character capsule has no business being rotated by the simulation at
    // all, so rather than chase which impulse defeats the axis locks, this
    // asserts the invariant directly. Cheap, and it cannot drift.
    //
    // Except on death, which is the one time a tumble is WANTED: the failure
    // effect above unlocks the axes and applies a torque impulse deliberately.
    // Pinning through that would silently cancel the ragdoll every frame, so
    // the invariant is suspended exactly there. The respawn branch below
    // re-locks the axes and the pin resumes, which is what keeps a death from
    // leaving the runner lying down for the rest of the session.
    if (pose !== "failure")
      rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    if (liveAttemptSerial.current !== attemptSerial) {
      rigidBody.setTranslation(
        { x: spawn[0], y: spawn[1], z: spawn[2] },
        true,
      );
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rigidBody.resetForces(true);
      rigidBody.resetTorques(true);
      rigidBody.setEnabledRotations(false, false, false, true);
      rigidBody.setGravityScale(PLAYER.gravityScale, true);
      liveAttemptSerial.current = attemptSerial;
      finalized.current = false;
      lastGrounded.current = performance.now();
      jumpPressedAt.current = -Infinity;
      jumpCutArmed.current = false;
      lastSample.current = 0;
      stride.current = 0;
      motion.current = {
        speed: 0,
        verticalVelocity: 0,
        grounded: true,
        yaw: spawnYaw,
        stunned: false,
      };
      // Nothing from the previous attempt is valid input for this one. In
      // particular, keyup can land on a newly focused result button and the old
      // held direction would otherwise survive indefinitely.
      resetInput();
      heldBody.current = null;
      return;
    }
    if (!active || finalized.current) return;
    const now = performance.now();
    const position = rigidBody.translation();
    const velocity = rigidBody.linvel();
    // The ceiling is the grounded window's own upper bound (surface tops
    // above it could never satisfy the check below), so this changes no
    // accepted grounded state - it only stops an overhead piece from
    // masking the real support underfoot.
    const surface = surfaceUnder(
      pieces,
      position.x,
      position.z,
      GROUND_MARGIN,
      position.y - (PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius) + 0.18,
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
      (slippery ? 0.18 : 1) *
      (stunned ? 0.2 : 1);
    // The chase camera sits behind the runner and looks along +Z, which makes
    // its right-hand direction world -X. Driving +X on "right" therefore sent
    // the runner to screen-left: every horizontal input was mirrored.
    //
    // The input is then swung by the same yaw the held-drag applies to the
    // camera, so "forward" stays "away from the camera" after the view turns.
    // At yaw 0 this is exactly the two lines it replaces. CameraRig owns the
    // matching rotation of the camera itself; the two must share getCameraYaw
    // or turning the view mirrors the steering.
    const yaw = getCameraYaw();
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const targetX = (-input.x * cosYaw + input.z * sinYaw) * PLAYER.moveSpeed;
    const targetZ = (input.x * sinYaw + input.z * cosYaw) * PLAYER.moveSpeed;
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
    // Vertical motion is resolved here, in one place, so the take-off, the
    // release cut and the fall clamp cannot disagree about what this frame's
    // velocity is. It used to be split across two setLinvel calls with the grab
    // logic between them, which left no single point where a jump could be
    // shortened.
    let nextY = velocity.y;
    if (
      now - jumpPressedAt.current <= PLAYER.jumpBufferMs &&
      (grounded || now - lastGrounded.current <= PLAYER.coyoteTimeMs)
    ) {
      nextY = PLAYER.jumpVelocity;
      jumpCutArmed.current = true;
      jumpPressedAt.current = -Infinity;
      markJumpApplied();
      AudioManager.jump();
    } else if (jumpCutArmed.current) {
      // Variable jump height. Holding the button gives the full arc, letting go
      // while still rising drops the runner back to the floor velocity, and the
      // hop ends early. Without this every jump was the same jump and belonged
      // to the game rather than to the player.
      if (grounded || nextY <= 0 || nextY > PLAYER.jumpVelocity + 0.01)
        jumpCutArmed.current = false;
      else if (!input.jump) {
        nextY = Math.min(nextY, PLAYER.jumpVelocity * PLAYER.jumpCutMultiplier);
        jumpCutArmed.current = false;
      }
    }
    const justLeftGround = motion.current.grounded && !grounded;
    // Landing kept the descent velocity on the body, so the capsule's own
    // restitution answered a hard drop with a small hop the player did not ask
    // for. Sticking the landing is what makes a platform read as solid.
    if (grounded && nextY < 0) nextY = 0;
    else if (justLeftGround && nextY <= 0)
      nextY = Math.min(nextY, -LEDGE_RELEASE_SPEED);
    nextY = Math.max(-PLAYER.maxFallSpeed, nextY);
    // Step assist.
    //
    // A dynamic capsule rides a ledge only while the ledge sits below its bottom
    // hemisphere's centre, so anything over capsuleRadius is a wall rather than
    // a step, and a wall flush against the floor in front of it has no gap to
    // read as a jump. That is the invisible wall the classic course was rebuilt
    // to remove, and every composed course reintroduced it: the finish room's
    // floor stands 0.40u proud of the datum the rest of the catalogue hands off
    // at, so holding W stalled at the last seam of nearly every fresh level.
    //
    // Only ever a step, never a boost. It declines in the air and on the frame a
    // jump is taken, it leaves both components of velocity exactly as they were,
    // and it moves the runner by translation, so it cannot bend the arc track.ts
    // certifies courses against and cannot disturb the upright pin above.
    // Probe in the camera-relative direction the controller is actually
    // driving. Using raw input here worked only at camera yaw zero; after the
    // player orbited the camera, the assist looked sideways and the capsule
    // could snag on the ledge directly in front of it.
    const headingX = targetX;
    const headingZ = targetZ;
    const heading = Math.hypot(headingX, headingZ);
    if (grounded && surface !== null && nextY <= 0 && heading > 0.1) {
      const probeX = position.x + (headingX / heading) * STEP_PROBE;
      const probeZ = position.z + (headingZ / heading) * STEP_PROBE;
      const ahead = surfaceUnder(pieces, probeX, probeZ, -STEP_LANDING_INSET);
      if (ahead !== null && ahead - surface > 0 && ahead - surface <= PLAYER.stepAssistHeight) {
        position.x = probeX;
        position.z = probeZ;
        position.y = ahead + PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
        rigidBody.setTranslation(position, true);
      }
    }
    // Three gravities, not one: the authored rise, a lighter apex that buys a
    // beat to read the landing, and a heavier descent so the runner arrives
    // rather than drifts down.
    //
    // The rise keeps PLAYER.gravityScale exactly, because track.ts solves the
    // certified jump budget from that number and isPlayableTrack refuses shared
    // courses with it. The other two phases only ever add peak height and hang
    // time to the real arc, so the published budget stays a floor on what the
    // runner can do rather than a claim the simulation has to honour.
    let gravity = PLAYER.gravityScale;
    if (!grounded) {
      if (Math.abs(nextY) <= PLAYER.apexVelocityWindow)
        gravity *= PLAYER.apexGravityMultiplier;
      else if (nextY < 0) gravity *= PLAYER.fallGravityMultiplier;
    }
    rigidBody.setGravityScale(gravity, true);
    // Jumping made a sound and landing did not. motion.current still holds the
    // previous frame here, so this is the exact landing frame and the vertical
    // speed that produced it.
    if (!motion.current.grounded && grounded && motion.current.verticalVelocity < -3)
      AudioManager.land(motion.current.verticalVelocity);
    // Steps, off ground covered rather than off a clock. The tally resets in
    // the air so a landing is heard as a landing, not as a landing and a step,
    // and the next step is a full stride further on.
    const groundSpeed = Math.hypot(velocity.x, velocity.z);
    if (grounded && groundSpeed > FOOTSTEP_MIN_SPEED) {
      stride.current += groundSpeed * step;
      if (stride.current >= FOOTSTEP_STRIDE) {
        stride.current = 0;
        AudioManager.footstep();
      }
    } else if (!grounded) stride.current = 0;
    motion.current = {
      speed: Math.hypot(velocity.x, velocity.z),
      verticalVelocity: velocity.y,
      grounded,
      yaw: Math.hypot(velocity.x, velocity.z) > 0.15 ? Math.atan2(velocity.x, velocity.z) : motion.current.yaw,
      stunned,
    };
    rigidBody.setLinvel({ x: nextX, y: nextY, z: nextZ }, true);
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
        AudioManager.grab();
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
      // Throwing a beach ball used to sound exactly like a hammer to the face.
      AudioManager.release();
    }
    if (Math.hypot(input.x, input.z) > 0.1) {
      const visual = rigidBody.rotation();
      void visual;
    }
    const courseX = exit[0] - spawn[0];
    const courseZ = exit[2] - spawn[2];
    const courseLengthSq = courseX * courseX + courseZ * courseZ;
    const progress = Math.min(1, Math.max(0, courseLengthSq > 0
      ? ((position.x - spawn[0]) * courseX + (position.z - spawn[2]) * courseZ) / courseLengthSq
      : 0));
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
    if (!freeRoam &&
      Math.hypot(position.x - exit[0], position.z - exit[2]) < 1.25 &&
      Math.abs(position.y - exit[1]) < 2
    ) {
      finalized.current = true;
      onFinish();
    } else if (position.y < KILL_PLANE_Y) {
      finalized.current = true;
      rigidBody.setEnabledRotations(true, true, true, true);
      rigidBody.applyTorqueImpulse({ x: 2.8, y: 0.8, z: -3.2 }, true);
      onFail("fell");
    } else if (!freeRoam && now - startedAt >= ATTEMPT_LIMIT_MS) {
      finalized.current = true;
      onFail("timeout");
    }
  }, -100);
  return (
    <RigidBody
      // A retry gets a genuinely new physics body at the safe spawn. Reusing
      // the ragdolled body made the reset depend on repairing every bit of
      // Rapier state left by the death frame; any missed state could carry the
      // runner straight off the spawn before the player received input.
      key={`runner-attempt-${attemptSerial}`}
      ref={setBodyRef}
      userData={{ kind: "player" }}
      colliders={false}
      position={[spawn[0], spawn[1], spawn[2]]}
      enabledRotations={[false, false, false]}
      gravityScale={PLAYER.gravityScale}
      linearDamping={PLAYER.linearDamping}
      angularDamping={PLAYER.angularDamping}
      canSleep={false}
      ccd
    >
      {/* mass belongs on the collider, not the body: @react-three/rapier strips
          `mass` from RigidBody props entirely (it is the first entry in the
          library's own excluded list), so the capsule was falling back to its
          volume at default density — 0.729kg against the 1kg every impulse in
          the game was tuned for, making each one 37% stronger than authored. */}
      <CapsuleCollider
        args={[PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius]}
        mass={PLAYER.mass}
        // Zero contact friction prevents the rounded capsule catching on a
        // ledge's vertical face. Horizontal stopping is controller-driven, so
        // this does not make ordinary running drift; soap still reduces that
        // acceleration in the controller above.
        friction={0}
        restitution={0}
      />
      <PlayerVisual avatarSeed={avatarSeed} avatar={avatar} visible={visualVisible} pose={pose} motion={motion} />
    </RigidBody>
  );
});
