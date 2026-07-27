import { beforeEach, describe, expect, it } from "vitest";
import { consumeJumpPress, getInput, resetInput, setKey } from "@/lib/game/input";

describe("input edge queue", () => {
  beforeEach(() => resetInput());

  it("preserves a jump press even when it is released before the next read", () => {
    const before = getInput().jumpPressSequence;
    setKey("jump", true);
    setKey("jump", false);
    const after = getInput();
    expect(after.jump).toBe(false);
    expect(after.jumpPressSequence).toBe(before + 1);
    expect(consumeJumpPress()).toBe(true);
    expect(consumeJumpPress()).toBe(false);
  });

  it("does not repeat the jump edge while the control remains held", () => {
    const before = getInput().jumpPressSequence;
    setKey("jump", true);
    setKey("jump", true);
    expect(getInput().jumpPressSequence).toBe(before + 1);
  });
});
