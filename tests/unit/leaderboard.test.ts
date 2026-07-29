import { describe, expect, it } from "vitest";
import { clearTimeToScore, scoreToClearTime } from "@/portals/src/leaderboard";
import { ATTEMPT_LIMIT_MS } from "@/lib/game/constants";

describe("clearTimeToScore / scoreToClearTime", () => {
  it("converts normal mid-range clear times to a score and back", () => {
    for (const durationMs of [1, 500, 15_000, 30_000, 45_000, ATTEMPT_LIMIT_MS - 1]) {
      const score = clearTimeToScore(durationMs);
      expect(scoreToClearTime(score)).toBe(durationMs);
    }
  });

  it("ranks a faster clear above a slower one", () => {
    expect(clearTimeToScore(1_000)).toBeGreaterThan(clearTimeToScore(2_000));
  });

  it("handles the fastest-possible boundary (0ms)", () => {
    const score = clearTimeToScore(0);
    expect(scoreToClearTime(score)).toBe(0);
  });

  it("handles the slowest-possible boundary (exactly ATTEMPT_LIMIT_MS) without reporting a faster time", () => {
    const score = clearTimeToScore(ATTEMPT_LIMIT_MS);
    // Regression: previously this floored to a score that decoded back to
    // ATTEMPT_LIMIT_MS - 1, making a clear look 1ms faster than it was.
    expect(scoreToClearTime(score)).toBe(ATTEMPT_LIMIT_MS);
  });

  it("clamps a duration past the attempt limit to the same score as the limit itself", () => {
    expect(clearTimeToScore(ATTEMPT_LIMIT_MS + 5_000)).toBe(
      clearTimeToScore(ATTEMPT_LIMIT_MS),
    );
  });

  it("clamps a negative duration to the same score as 0ms", () => {
    expect(clearTimeToScore(-1_000)).toBe(clearTimeToScore(0));
  });

  it("never emits a score below 1, even for hostile duration input", () => {
    for (const durationMs of [-1_000_000, -1, 0, ATTEMPT_LIMIT_MS, ATTEMPT_LIMIT_MS * 100]) {
      expect(clearTimeToScore(durationMs)).toBeGreaterThanOrEqual(1);
    }
  });

  it("never emits a negative clear time for an out-of-range score above the domain", () => {
    // This is the primary bug: an unclamped scoreToClearTime returned a
    // negative clear time for any score above ATTEMPT_LIMIT_MS.
    for (const score of [ATTEMPT_LIMIT_MS + 2, ATTEMPT_LIMIT_MS + 1_000, 10 * ATTEMPT_LIMIT_MS]) {
      const clearTimeMs = scoreToClearTime(score);
      expect(clearTimeMs).toBeGreaterThanOrEqual(0);
      expect(clearTimeMs).toBe(0);
    }
  });

  it("clamps a score at or below 0 (hostile or buggy client) to the slowest clear time", () => {
    for (const score of [0, -1, -1_000_000]) {
      expect(scoreToClearTime(score)).toBe(ATTEMPT_LIMIT_MS);
    }
  });

  it("round-trips every integer clear time in the valid domain exactly", () => {
    for (let durationMs = 0; durationMs <= ATTEMPT_LIMIT_MS; durationMs += 997) {
      const score = clearTimeToScore(durationMs);
      expect(scoreToClearTime(score)).toBe(durationMs);
    }
  });

  it("round-trips out-of-range durations to the nearest in-domain value instead of going negative or past the limit", () => {
    const belowRange = clearTimeToScore(-50_000);
    expect(scoreToClearTime(belowRange)).toBe(0);

    const aboveRange = clearTimeToScore(ATTEMPT_LIMIT_MS + 50_000);
    expect(scoreToClearTime(aboveRange)).toBe(ATTEMPT_LIMIT_MS);
  });
});
