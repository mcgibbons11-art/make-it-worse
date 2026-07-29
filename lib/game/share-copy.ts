import { TRAP_CATALOG } from "./trap-catalog";
import type { ChallengeDTO } from "./types";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * The message that lands in someone's chat.
 *
 * It used to be one line with no name, no time and no stake: "I added a
 * swinging hammer to this level." Everything worth saying was already sitting
 * in the published challenge and none of it was used. A recipient needs a
 * reason to tap, and the strongest one available is a specific person's time.
 */
export function buildShareCopy(
  challenge: ChallengeDTO,
  url: string,
  clearTimeMs?: number,
): string {
  const trap = challenge.addedTrap;
  const who = challenge.createdByName;
  const boast = clearTimeMs
    ? `${who} cleared this in ${seconds(clearTimeMs)}, then added ${
        trap ? TRAP_CATALOG[trap.type].articleName : "nothing at all"
      }.`
    : trap
      ? `${who} added ${TRAP_CATALOG[trap.type].articleName}.`
      : `${who} left this one clean. For now.`;

  const survival =
    challenge.stats.survivalRate === null || challenge.stats.attempts === 0
      ? null
      : `${Math.round(challenge.stats.survivalRate * 100)}% survive`;
  const facts = [
    challenge.depth > 0 ? `Disaster ${challenge.depth}` : null,
    survival,
  ].filter(Boolean);

  return `${boast}${facts.length ? ` ${facts.join(" · ")}.` : ""} Your turn: ${url}`;
}

/**
 * What the number over a level counts, said before anyone has been taught a
 * word for it.
 *
 * A reviewer meeting this game for the first time read "CHAIN DEPTH 0" on one
 * screen and "DISASTER 3" on the next, and had been given neither term. Both
 * count the same thing - people who have already added a trap - so the number
 * now arrives with its own definition, in the same words on both screens.
 * Sentence case, because .panel-kicker and .eyebrow uppercase it in CSS and a
 * screen reader should not have to spell it out.
 */
export function chainDepthLine(depth: number): string {
  if (depth <= 0) return "Nobody has ruined this one yet";
  return depth === 1
    ? "1 person has already made this worse"
    : `${depth} people have already made this worse`;
}

/**
 * The depth pill on the running HUD, and what it announces.
 *
 * "DISASTER 0" is a number counting nothing, which is what a clean level got.
 * The label carries the definition so the pill is readable without the intro
 * card that introduced it.
 */
export function depthPill(depth: number): {
  readonly text: string;
  readonly label: string;
} {
  return depth <= 0
    ? { text: "CLEAN LEVEL", label: "A clean level. Nobody has added a trap yet." }
    : {
        text: `DISASTER ${depth}`,
        label: `Disaster ${depth}. ${chainDepthLine(depth)}.`,
      };
}

/**
 * The social proof on the intro card, kept in two halves so the panel can put
 * its own separator between them.
 *
 * A challenge nobody has run used to render "0 attempts · No survival data
 * yet", which is two ways of saying nothing and reads as a broken stat rather
 * than as a new level.
 */
export function challengeStatLine(stats: ChallengeDTO["stats"]): {
  readonly attempts: string | null;
  readonly survival: string;
} {
  if (stats.attempts === 0)
    return { attempts: null, survival: "Nobody has run this one yet" };
  const attempts = `${stats.attempts} ${stats.attempts === 1 ? "attempt" : "attempts"}`;
  return stats.survivalRate === null
    ? { attempts, survival: "nobody out yet" }
    : {
        attempts,
        survival: `${Math.round(stats.survivalRate * 100)}% survive`,
      };
}

/**
 * The reward screen's headline.
 *
 * It used to be "You made it 4% worse." - a small number handed to someone as
 * the payoff for the whole loop, and the only thing on the screen written large
 * enough to read. The number is honest and stays on the card, but the headline
 * belongs to the thing the player actually just did, which is put a level into
 * somebody else's hands. Kept here as a constant rather than inline so both
 * editions say it identically and neither has to escape the apostrophe.
 */
export const CONSEQUENCE_HEADLINE = "Now it is somebody else’s problem.";
