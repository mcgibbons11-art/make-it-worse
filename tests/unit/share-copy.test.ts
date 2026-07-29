// The words the game says about a challenge: the message that lands in a
// friend's chat, and the lines the two editions put on the intro card, the HUD
// pill and the reward screen.
//
// All of it is pure, and all of it was previously written inline in two
// components that had drifted apart. An independent reviewer played a build and
// reported that the first four screens introduced "chain", "depth" and
// "disaster" without defining any of them, and that the payoff screen's
// headline was a single-digit percentage. Those are copy decisions, so they are
// pinned here rather than left to whichever component renders them.

import { describe, expect, it } from "vitest";
import {
  CONSEQUENCE_HEADLINE,
  buildShareCopy,
  chainDepthLine,
  challengeStatLine,
  depthPill,
} from "@/lib/game/share-copy";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { ChallengeDTO } from "@/lib/game/types";

const STATS = (patch: Partial<ChallengeDTO["stats"]> = {}): ChallengeDTO["stats"] => ({
  attempts: 0,
  completions: 0,
  survivalRate: null,
  bestTimeMs: null,
  recentAttempts: 0,
  shareCount: 0,
  ...patch,
});

const CHALLENGE = (patch: Partial<ChallengeDTO> = {}): ChallengeDTO => ({
  id: "c1",
  slug: "demo-disaster",
  chainId: "chain",
  chainSlug: "chain",
  parentSlug: null,
  depth: 3,
  baseSeed: 42,
  levelVersion: 1,
  createdByName: "Cheeky Kettle",
  createdByAvatarSeed: 102,
  addedTrap: {
    id: "t1",
    type: "rotating_toilet",
    ownerUserId: null,
    ownerName: "Cheeky Kettle",
    ownerAvatarSeed: 102,
    depthAdded: 3,
    zoneId: "runway_mid",
    position: [0, 0, 6.8],
    rotationY: 0,
    seed: 1,
    params: TRAP_CATALOG.rotating_toilet.defaultParams,
  },
  traps: [],
  ghostTrace: null,
  stats: STATS({ attempts: 184, completions: 22, survivalRate: 22 / 184 }),
  createdAt: new Date(0).toISOString(),
  isDemo: true,
  ...patch,
});

describe("the message that lands in a chat", () => {
  it("names the person, the trap and the link", () => {
    const copy = buildShareCopy(CHALLENGE(), "https://miw.test/c/x");
    expect(copy).toContain("Cheeky Kettle added");
    expect(copy).toContain(TRAP_CATALOG.rotating_toilet.articleName);
    expect(copy).toContain("https://miw.test/c/x");
  });

  it("spends the clear time when there is one, because it is the strongest fact", () => {
    const copy = buildShareCopy(CHALLENGE(), "https://miw.test/c/x", 7120);
    expect(copy).toContain("cleared this in 7.12s");
  });

  it("says so plainly when nothing has been added yet", () => {
    const copy = buildShareCopy(
      CHALLENGE({ addedTrap: null, depth: 0, stats: STATS() }),
      "https://miw.test/c/x",
    );
    expect(copy).toContain("left this one clean");
    // No attempts means no honest survival rate to quote.
    expect(copy).not.toContain("%");
  });
});

describe("the number over a level, defined where it is first shown", () => {
  it("has words for a level nobody has touched", () => {
    expect(chainDepthLine(0)).toBe("Nobody has ruined this one yet");
    expect(chainDepthLine(-1)).toBe("Nobody has ruined this one yet");
  });

  it("counts people rather than naming an internal term", () => {
    expect(chainDepthLine(1)).toBe("1 person has already made this worse");
    expect(chainDepthLine(4)).toBe("4 people have already made this worse");
    for (const depth of [0, 1, 2, 9])
      expect(chainDepthLine(depth).toLowerCase()).not.toContain("chain depth");
  });

  it("keeps the HUD pill meaningful on a clean level", () => {
    // "DISASTER 0" is a number counting nothing.
    expect(depthPill(0).text).toBe("CLEAN LEVEL");
    expect(depthPill(3).text).toBe("DISASTER 3");
  });

  it("carries the definition in the pill's announced label", () => {
    // The pill is two words on screen, so the spoken version is where the
    // number gets to say what it counts. It used to read "Chain depth 3".
    expect(depthPill(3).label).toContain("3 people have already made this worse");
    expect(depthPill(0).label.toLowerCase()).toContain("nobody has added a trap");
    for (const depth of [0, 1, 3])
      expect(depthPill(depth).label.toLowerCase()).not.toContain("chain depth");
  });
});

describe("the social proof on the intro card", () => {
  it("keeps the two facts a stranger can act on", () => {
    const line = challengeStatLine(
      STATS({ attempts: 184, completions: 22, survivalRate: 22 / 184 }),
    );
    expect(line.attempts).toBe("184 attempts");
    expect(line.survival).toBe("12% survive");
  });

  it("does not report a rate for a level nobody has run", () => {
    // This used to render "0 attempts · No survival data yet", which is two
    // ways of saying nothing and reads as a broken stat rather than a new level.
    const line = challengeStatLine(STATS());
    expect(line.attempts).toBeNull();
    expect(line.survival).toBe("Nobody has run this one yet");
  });

  it("counts one attempt in the singular", () => {
    expect(challengeStatLine(STATS({ attempts: 1 })).attempts).toBe("1 attempt");
  });

  it("holds back the rate rather than inventing one", () => {
    const line = challengeStatLine(STATS({ attempts: 6, survivalRate: null }));
    expect(line.attempts).toBe("6 attempts");
    expect(line.survival).not.toContain("%");
  });
});

describe("the reward screen's headline", () => {
  it("is about what the player did, not about the size of the number", () => {
    // The headline was "You made it 4% worse." - the loop's payoff, delivered
    // as a single digit. The score is honest and stays on the card; it is no
    // longer the biggest thing on it.
    expect(CONSEQUENCE_HEADLINE).not.toContain("%");
    expect(CONSEQUENCE_HEADLINE.length).toBeGreaterThan(20);
  });
});
