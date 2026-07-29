import { TRAP_CATALOG } from "./trap-catalog";
import type { ChallengeDTO } from "./types";

/**
 * What a shared link should say about itself.
 *
 * The link preview is the only thing a recipient sees before deciding whether
 * to tap, and it was identical for every challenge in the game: one static card
 * reading "Someone made this level worse". That wastes the one fact that makes
 * this loop interesting - that a specific person added a specific trap to a
 * level a specific number of people have already failed.
 *
 * Kept as a pure function of the challenge so both the OG image and the page
 * metadata render the same words, and so it can be tested without a network.
 */
export interface ChallengePreview {
  /** Who did what, as a sentence. */
  headline: string;
  /** The chain's length, phrased for a stranger rather than a developer. */
  depthLine: string;
  /** Observed difficulty, or null when nobody has tried it yet. */
  statLine: string | null;
  /** Short label for the trap badge; empty on a clean level. */
  badge: string;
}

const PLURAL = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function buildChallengePreview(challenge: ChallengeDTO): ChallengePreview {
  const added = challenge.addedTrap;
  const trap = added ? TRAP_CATALOG[added.type] : null;

  const headline = trap
    ? `${challenge.createdByName} added ${trap.articleName}.`
    : `${challenge.createdByName} left it clean. For now.`;

  const depthLine =
    challenge.depth === 0
      ? "Nobody has touched this one yet"
      : `${PLURAL(challenge.depth, "trap", "traps")} deep`;

  // Observed outcomes beat a model estimate here: "3 of 47 survived" is a
  // stronger reason to tap than a predicted percentage, and it is a fact rather
  // than a claim. Only shown once enough people have tried that the ratio means
  // something - one attempt and one failure is not "0% survive".
  const { attempts, completions, survivalRate } = challenge.stats;
  let statLine: string | null = null;
  if (attempts >= 5) {
    statLine = `${completions} of ${attempts} made it out`;
  } else if (survivalRate !== null && attempts > 0) {
    statLine = `${Math.round(survivalRate * 100)}% survival so far`;
  }

  return {
    headline,
    depthLine,
    statLine,
    badge: trap ? trap.displayName.toUpperCase() : "",
  };
}

/** The card shown when the challenge cannot be read - demo links, or no backend. */
export const FALLBACK_PREVIEW: ChallengePreview = {
  headline: "Someone made this level worse.",
  depthLine: "Beat it. Ruin it. Send it.",
  statLine: null,
  badge: "",
};
