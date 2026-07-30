import { describe, expect, it } from "vitest";
import { PLACEMENT_CAMERA_OFFSET } from "@/components/game/CameraRig";

describe("trap placement camera", () => {
  it("uses a close three-quarter view instead of a course-wide aerial view", () => {
    const [x, y, z] = PLACEMENT_CAMERA_OFFSET;
    const distance = Math.hypot(x, y, z);

    expect(y).toBeGreaterThan(4);
    expect(Math.abs(z)).toBeGreaterThan(3);
    expect(distance).toBeLessThan(9);
  });
});
