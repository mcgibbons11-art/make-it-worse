import { describe, expect, it } from "vitest";
import { arbitrateOutcome, canTransition, transitionPhase } from "@/lib/game/state-machine";
import type { GamePhase } from "@/lib/game/types";

// The previous version of this file asserted three hand-picked table lookups,
// so it passed against a table that forbade six real user flows. These tests
// cross-check the table against the transitions the two editions actually
// perform, with the call site recorded for every one.

const ALL_PHASES: readonly GamePhase[] = [
  "booting", "intro", "ready", "playing", "failed", "finished",
  "choosing_trap", "placing_trap", "publishing", "sharing", "paused", "fatal_error",
];

/** Transitions that really happen, each with the call site that performs it. */
const REAL: readonly (readonly [GamePhase, GamePhase, string])[] = [
  ["booting", "intro", "GameClient.tsx:200 challenge load"],
  ["booting", "ready", "PortalsApp.tsx:213 ensureGuest resolves"],
  ["ready", "intro", "PortalsApp.tsx:239 open() from the title screen"],
  ["intro", "playing", "GameClient.tsx:258 / PortalsApp.tsx:315 startAttempt"],
  ["playing", "failed", "GameClient.tsx:319 / PortalsApp.tsx:344"],
  ["playing", "finished", "GameClient.tsx:306 / PortalsApp.tsx:349"],
  ["playing", "paused", "GameClient.tsx:177 blur, :765 pause button"],
  ["paused", "playing", "GameClient.tsx:775 / PortalsApp.tsx:686 resume"],
  ["failed", "playing", "game-store.ts:5 resetRun"],
  ["finished", "choosing_trap", "GameClient.tsx:796 continue"],
  ["choosing_trap", "placing_trap", "GameClient.tsx:403 / PortalsApp.tsx:426 selectTrap"],
  ["choosing_trap", "finished", "GameClient.tsx:808 end the chain when nothing is placeable"],
  ["placing_trap", "choosing_trap", "GameClient.tsx:831 back"],
  ["placing_trap", "publishing", "GameClient.tsx:435 / PortalsApp.tsx:431"],
  ["publishing", "sharing", "GameClient.tsx:446 / PortalsApp.tsx:440"],
  ["publishing", "placing_trap", "GameClient.tsx:450 / PortalsApp.tsx:443 publish failed"],
  ["sharing", "intro", "PortalsApp.tsx:779 open(result.challenge), 'Play your version'"],
  // quitToTitle -> applyRun(EMPTY_RUN), and shell-state.ts:150 sets EMPTY_RUN's
  // phase to "ready". The Portals home is its own title screen, `ready`, where
  // the Next edition's home is `intro`; both are real idle states and this shell
  // can be quit from every run phase. The table listed only `intro`, so all
  // eight of these were forbidden - invisible because nothing calls
  // transitionPhase yet, which is how it rotted unnoticed.
  ["playing", "ready", "PortalsApp.tsx:640 quitToTitle, from the pause menu"],
  ["paused", "ready", "PortalsApp.tsx:640 quitToTitle, 'Main menu'"],
  ["failed", "ready", "PortalsApp.tsx:640 quitToTitle, 'Main menu' on the failure card"],
  ["finished", "ready", "PortalsApp.tsx:640 quitToTitle, from the finish panel"],
  ["choosing_trap", "ready", "PortalsApp.tsx:640 quitToTitle, abandoning the reward"],
  ["placing_trap", "ready", "PortalsApp.tsx:640 quitToTitle, abandoning placement"],
  ["publishing", "ready", "PortalsApp.tsx:640 quitToTitle, abandoning mid-publish"],
  ["sharing", "ready", "PortalsApp.tsx:640 quitToTitle, 'Back to title'"],
];

/**
 * Edges the table permits that nothing performs. Permissive edges are harmless
 * where a missing one throws, so these are recorded rather than removed - but
 * they are recorded, so the table cannot quietly fill up with fiction.
 */
const KNOWN_UNUSED: readonly (readonly [GamePhase, GamePhase, string])[] = [
  ["intro", "ready", "only Portals reaches ready, and it arrives from booting"],
  ["finished", "sharing", "shareFinal (GameClient.tsx:546) copies a link and never sets phase"],
  ["ready", "playing", "the start UI is gated on phase === 'intro' (PortalsApp.tsx:592), so the title screen goes ready -> intro -> playing, never straight to playing"],
];

describe("phase transition table", () => {
  it.each(REAL)("permits %s -> %s (%s)", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("permits a challenge load from any phase, because the store is never reset", () => {
    // stores/game-store.ts holds phase at module scope and no mount resets it,
    // so GameClient's load effect fires from whatever the last challenge left.
    for (const from of ALL_PHASES) {
      if (from === "intro") continue;
      expect(canTransition(from, "intro"), `${from} -> intro`).toBe(true);
    }
  });

  it("permits the fatal-error escape from every non-terminal phase", () => {
    for (const from of ALL_PHASES) {
      if (from === "fatal_error") continue;
      expect(canTransition(from, "fatal_error"), `${from} -> fatal_error`).toBe(true);
    }
  });

  it("admits no edge that no call site performs", () => {
    const accounted = new Set(
      [...REAL, ...KNOWN_UNUSED].map(([from, to]) => `${from}->${to}`),
    );
    const unexplained: string[] = [];
    for (const from of ALL_PHASES) {
      for (const to of ALL_PHASES) {
        if (!canTransition(from, to)) continue;
        if (to === "intro" || to === "fatal_error") continue; // covered above
        if (!accounted.has(`${from}->${to}`)) unexplained.push(`${from}->${to}`);
      }
    }
    expect(unexplained).toEqual([]);
  });

  it("still rejects a transition that skips the run", () => {
    expect(() => transitionPhase("intro", "publishing")).toThrow();
    expect(() => transitionPhase("fatal_error", "playing")).toThrow();
  });
});

describe("outcome arbitration", () => {
  it("gives completion priority over every other signal", () => {
    expect(arbitrateOutcome({ exitEntered: true, fell: true, timedOut: true, manualReset: true })).toBe("completed");
    expect(arbitrateOutcome({ exitEntered: false, fell: true, timedOut: true, manualReset: true })).toBe("fell");
    expect(arbitrateOutcome({ exitEntered: false, fell: false, timedOut: true, manualReset: true })).toBe("timeout");
    expect(arbitrateOutcome({ exitEntered: false, fell: false, timedOut: false, manualReset: true })).toBe("reset");
    expect(arbitrateOutcome({ exitEntered: false, fell: false, timedOut: false, manualReset: false })).toBeNull();
  });
});
