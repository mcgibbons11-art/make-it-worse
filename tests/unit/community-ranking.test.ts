import { describe, expect, it } from "vitest";
import { customMapTrendingScore } from "@/lib/game/community-maps";

const published = "2026-07-30T12:00:00.000Z";
const now = Date.parse(published);

describe("community Trending score", () => {
  it("weights starts, clears, likes, shares, and reports as specified", () => {
    const score = customMapTrendingScore({
      impressions: 5, starts: 10, clears: 4, likes: 2, shares: 3, reports: 1,
    }, published, now);
    expect(score).toBeCloseTo(10 + 3 * 4 + 5 * 2 + 4 * 3 - 8 + 4 * (5 / 14));
  });

  it("gates tiny samples and decays after one week", () => {
    const metrics = { impressions: 4, starts: 4, clears: 2, likes: 1, shares: 1, reports: 0 };
    const small = customMapTrendingScore(metrics, published, now);
    const established = customMapTrendingScore({ ...metrics, impressions: 5 }, published, now);
    expect(small).toBeCloseTo(established * 0.25);
    const weekLater = customMapTrendingScore({ ...metrics, impressions: 5 }, published, now + 604_800_000);
    expect(weekLater).toBeCloseTo(established * Math.exp(-1));
  });

  it("lets reports pull abusive maps down quickly", () => {
    const safe = customMapTrendingScore({ impressions: 20, starts: 10, clears: 5, likes: 5, shares: 2, reports: 0 }, published, now);
    const reported = customMapTrendingScore({ impressions: 20, starts: 10, clears: 5, likes: 5, shares: 2, reports: 5 }, published, now);
    expect(reported).toBeLessThan(safe - 39);
  });
});
