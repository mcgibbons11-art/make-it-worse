export interface InputSnapshot {
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;
  jump: boolean;
  grab: boolean;
}

const state: InputSnapshot = {
  left: false,
  right: false,
  forward: false,
  backward: false,
  jump: false,
  grab: false,
};
let mobileX = 0;
let mobileY = 0;
/**
 * Where the camera is pointing, in radians about world Y, 0 being the default
 * chase view looking up the course.
 *
 * It lives here rather than in the camera because BOTH halves of third-person
 * control need it. CameraRig writes it while the pointer drags, and
 * PlayerController reads it to rotate the movement input, so "forward" keeps
 * meaning "away from the camera" once the camera has swung round. Without that
 * second half, turning the view silently mirrors the controls, which is worse
 * than not being able to turn at all.
 *
 * A module singleton, like the input state above, so neither side has to own
 * the other or thread a ref through the scene graph.
 */
let cameraYaw = 0;
let jumpPressSequence = 0;
let pendingJumpPresses = 0;
let jumpConsumedSequence = 0;
let jumpAppliedSequence = 0;

/**
 * True when a key event belongs to the interface rather than the runner.
 *
 * The movement listener calls preventDefault on Space, WASD, E and the arrows.
 * Registered on window and never target-guarded, that swallowed Space on every
 * focused button (Space is one of the two standard activation keys), ate WASD
 * and E out of the display-name field, and blocked arrow keys on the quality
 * select. Game keys must only reach the game.
 */
export function isInterfaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "OPTION"].includes(
    target.tagName,
  );
}

export function setCameraYaw(radians: number): void {
  cameraYaw = radians;
}

export function getCameraYaw(): number {
  return cameraYaw;
}

/** Back to the room's spawn-facing chase view on a fresh attempt. */
export function resetCameraYaw(radians = 0): void {
  cameraYaw = Number.isFinite(radians)
    ? Math.atan2(Math.sin(radians), Math.cos(radians))
    : 0;
}

export function queueJumpPress(): void {
  jumpPressSequence += 1;
  pendingJumpPresses += 1;
}

export function consumeJumpPress(): boolean {
  if (pendingJumpPresses <= 0) return false;
  pendingJumpPresses -= 1;
  jumpConsumedSequence += 1;
  return true;
}

export function markJumpApplied(): void {
  jumpAppliedSequence += 1;
}

export function setKey(key: keyof InputSnapshot, value: boolean): void {
  // Queue the rising edge independently of the held state. A quick touch can
  // begin and end between render frames; the sequence still reaches the player
  // controller on its next update and participates in the normal jump buffer.
  if (key === "jump" && value && !state.jump) queueJumpPress();
  state[key] = value;
}

export function setMobileMove(x: number, y: number): void {
  mobileX = x;
  mobileY = y;
}

export function resetInput(): void {
  for (const key of Object.keys(state) as (keyof InputSnapshot)[]) state[key] = false;
  mobileX = 0;
  mobileY = 0;
  pendingJumpPresses = 0;
}

export function resetHeldInput(): void {
  for (const key of Object.keys(state) as (keyof InputSnapshot)[]) state[key] = false;
  mobileX = 0;
  mobileY = 0;
}

export function getInput(): InputSnapshot & {
  x: number;
  z: number;
  jumpPressSequence: number;
  jumpConsumedSequence: number;
  jumpAppliedSequence: number;
} {
  const x = Math.max(-1, Math.min(1, (state.right ? 1 : 0) - (state.left ? 1 : 0) + mobileX));
  const z = Math.max(-1, Math.min(1, (state.forward ? 1 : 0) - (state.backward ? 1 : 0) + mobileY));
  const length = Math.hypot(x, z);
  return {
    ...state,
    x: length > 1 ? x / length : x,
    z: length > 1 ? z / length : z,
    jumpPressSequence,
    jumpConsumedSequence,
    jumpAppliedSequence,
  };
}
