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
let jumpPressSequence = 0;
let pendingJumpPresses = 0;
let jumpConsumedSequence = 0;
let jumpAppliedSequence = 0;

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
