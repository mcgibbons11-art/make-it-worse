import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRunnerForTest } from "@/components/game/PlayerVisual";
import { PLAYER } from "@/lib/game/constants";
import { buildTrack } from "@/lib/game/track";

/**
 * The runner has to fit the ground it is drawn on.
 *
 * The narrowest walkable plank in the catalogue leaves only so much visible
 * deck once the platform edge band is drawn, and a runner wider than that hides
 * their own feet on the hardest segment in the game - the exact moment footing
 * matters most. The reference this model was built from scales to a 1.17u arm
 * span, so the spec deliberately tucks the arms; nothing enforced that until
 * now, and a future pipeline pass could widen them back without a single test
 * objecting.
 */
const MAX_SILHOUETTE = 0.94;

function measure() {
  // The same fitted model the game renders, not the factory's raw output: the
  // pipeline authors in its own frame and PlayerVisual normalises it, so
  // measuring the raw group would test something the player never sees.
  const model = buildRunnerForTest();
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { size, box };
}

describe("runner silhouette fits the ground it runs on", () => {
  it("stays inside the visible deck of the narrowest plank", () => {
    const { size } = measure();
    expect(size.x, `resting silhouette ${size.x.toFixed(3)}u exceeds the ${MAX_SILHOUETTE}u of visible deck on the narrowest plank`).toBeLessThanOrEqual(MAX_SILHOUETTE);
  });

  it("is the height the collider was built around", () => {
    const { size } = measure();
    const colliderHeight = (PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius) * 2;
    // A visual much taller than its collider floats; much shorter and the
    // runner sinks into the deck. Half a capsule radius either way is the most
    // that reads as correct.
    expect(size.y).toBeGreaterThan(colliderHeight - PLAYER.capsuleRadius);
    expect(size.y).toBeLessThan(colliderHeight + PLAYER.capsuleRadius);
  });

  it("puts its soles on the capsule's base, not on the body origin", () => {
    const { box } = measure();
    // A Rapier capsule is positioned by its CENTRE, so the ground it touches is
    // halfHeight + radius BELOW the rigid body's origin. The visual lives in
    // that same frame, so its feet belong at that negative offset. Standing
    // them at zero left the runner hovering 0.93u - most of a jump height -
    // above the floor, which also made every jump look far shorter than it was.
    const capsuleBase = -(PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius);
    expect(box.min.y).toBeCloseTo(capsuleBase, 1);
  });

  it("still clears the narrowest plank the segment catalogue can produce", () => {
    // Measured rather than hardcoded, so a future segment narrower than `beam`
    // fails here instead of shipping a plank the runner cannot see past.
    const widths = buildTrack(["start", "beam", "finish"]).pieces.map((piece) => piece.size[0]);
    const narrowest = Math.min(...widths);
    expect(narrowest).toBeGreaterThan(MAX_SILHOUETTE);
  });
});
