import type { GamePhase } from "./types";

// The legal phase graph for both editions.
//
// NOT YET WIRED. Nothing in the running game calls canTransition or
// transitionPhase; GameClient and PortalsApp assign phase directly. The table
// below now describes what the two editions actually do, which it previously
// did not: six real user flows were forbidden by it, so wiring transitionPhase
// in as it stood would have thrown on the Portals title screen, on starting a
// run, and on opening a second challenge. Correcting the table is a
// prerequisite for wiring it, not a substitute.
//
// `intro` is reachable from every phase, including fatal_error, and that is
// deliberate rather than lax. The phase lives in a module-scope zustand store
// (stores/game-store.ts) that is never reset on mount, so loading a challenge
// resets the machine from whatever the previous challenge left behind:
// pause -> "Quit to home" -> open another challenge is an ordinary
// paused -> intro. Opening a challenge is a reset, not a step.
// QUITTING GOES TO `ready`, NOT `intro`, AND BOTH ARE REAL IDLE STATES.
// The two shells idle differently: the Next edition's home is `intro`, the
// challenge card; the Portals edition's home is `ready`, its own title screen,
// which is where quitToTitle lands from every run phase. This table listed only
// `intro`, so all eight of those quits were transitions it forbade - invisible
// because nothing calls transitionPhase yet, which is exactly how it rotted.
// Found by tests/unit/qa-probe.test.ts PROBE B, which walks what the shells
// actually do rather than what this file says they may.
const transitions: Record<GamePhase, readonly GamePhase[]> = {
  // Portals boots straight to its title screen; the Next edition boots to intro.
  booting: ["intro", "ready", "fatal_error"],
  // startAttempt goes straight to playing (GameClient.tsx:258). Portals reaches
  // ready first, the Next edition does not.
  intro: ["ready", "playing", "fatal_error"],
  // The Portals title screen opens a challenge (PortalsApp.tsx:239, via open()).
  ready: ["intro", "playing", "fatal_error"],
  playing: ["intro", "ready", "failed", "finished", "paused", "fatal_error"],
  failed: ["intro", "ready", "playing", "fatal_error"],
  finished: ["intro", "ready", "choosing_trap", "sharing", "fatal_error"],
  // "Finish the chain here" ends a chain that has no placeable trap left
  // (GameClient.tsx:808).
  choosing_trap: ["intro", "ready", "placing_trap", "finished", "fatal_error"],
  placing_trap: ["intro", "ready", "choosing_trap", "publishing", "fatal_error"],
  publishing: ["intro", "ready", "sharing", "placing_trap", "fatal_error"],
  // "Play your version" reopens the child challenge (PortalsApp.tsx:779).
  sharing: ["intro", "ready", "fatal_error"],
  paused: ["intro", "ready", "playing", "fatal_error"],
  fatal_error: ["intro"],
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return transitions[from].includes(to);
}

export function transitionPhase(from: GamePhase, to: GamePhase): GamePhase {
  if (!canTransition(from, to))
    throw new Error(`Invalid game transition: ${from} -> ${to}`);
  return to;
}

export function arbitrateOutcome(input: {
  exitEntered: boolean;
  fell: boolean;
  timedOut: boolean;
  manualReset: boolean;
}): "completed" | "fell" | "timeout" | "reset" | null {
  if (input.exitEntered) return "completed";
  if (input.fell) return "fell";
  if (input.timedOut) return "timeout";
  if (input.manualReset) return "reset";
  return null;
}
