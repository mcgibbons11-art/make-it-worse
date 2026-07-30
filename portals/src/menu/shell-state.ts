// The Portals shell's decisions, kept out of the component so they can be
// tested without a WebGL canvas. PortalsApp owns the state; this file owns the
// rules about what that state means.

import type {
  ChallengeDTO,
  GamePhase,
  PublishChildResult,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import type { SubmitResult } from "../leaderboard";

/**
 * A shell surface that takes the screen from the run.
 *
 * These replace whatever panel the phase would otherwise show rather than
 * stacking on top of it, so exactly one dialog is ever mounted and exactly one
 * focus trap is ever armed.
 */
export type ShellView =
  | "menu"
  | "settings"
  | "controls"
  | "trending"
  | "map-code"
  | "confirm";

/**
 * Whether leaving the run right now throws away something the player has.
 *
 * Two things are worth a confirmation. A live attempt is the obvious one. The
 * less obvious one is a finished run holding an unplaced reward: the whole
 * point of the game is the trap you get to add, and between `finished` and
 * `publishing` that trap exists only in this tab's memory.
 */
export function discardsRun(phase: GamePhase): boolean {
  switch (phase) {
    case "playing":
    case "paused":
      return true;
    case "finished":
    case "choosing_trap":
    case "placing_trap":
    case "publishing":
      return true;
    // `sharing` has already published, `failed` has already been recorded, and
    // the rest are not a run at all.
    default:
      return false;
  }
}

/** How the menu describes a run it is covering, and the way back into it. */
export interface RunStatus {
  readonly label: string;
  readonly resumeLabel: string;
  /** True while the clock is stopped mid-attempt, which is the only state with a time worth showing. */
  readonly showsClock: boolean;
}

export function runStatus(phase: GamePhase): RunStatus | null {
  switch (phase) {
    case "intro":
      return { label: "Level loaded, not started", resumeLabel: "Back to the level", showsClock: false };
    case "playing":
    case "paused":
      return { label: "Run in progress", resumeLabel: "Resume run", showsClock: true };
    case "failed":
      return { label: "Run ended", resumeLabel: "Back to the run", showsClock: false };
    case "finished":
    case "choosing_trap":
      return { label: "Reward waiting", resumeLabel: "Back to your reward", showsClock: true };
    case "placing_trap":
    case "publishing":
      return { label: "Trap not placed yet", resumeLabel: "Back to placing", showsClock: true };
    case "sharing":
      return { label: "Chain published", resumeLabel: "Back to the result", showsClock: false };
    default:
      return null;
  }
}

/**
 * What Escape means, given everything the shell knows.
 *
 * One rule: Escape steps back out of whatever is on top, and never out of a
 * decision that would cost the player something. That is why the result
 * screens return "none" - an Escape hit by reflex must not throw away a
 * completed run - while every screen you can leave losslessly has a step back.
 */
export type EscapeAction =
  | "none"
  | "close-view"
  | "close-editor"
  | "pause"
  | "resume"
  | "leave-intro"
  | "cancel-placement";

export function escapeAction(state: {
  readonly view: ShellView | null;
  readonly editorOpen: boolean;
  readonly phase: GamePhase;
  readonly hasOffer: boolean;
}): EscapeAction {
  if (state.view) return "close-view";
  if (state.editorOpen) return "close-editor";
  switch (state.phase) {
    case "playing":
      return "pause";
    case "paused":
      return "resume";
    // Nothing has been started yet, so backing out to the menu costs nothing.
    case "intro":
      return "leave-intro";
    // Only reversible while the offer still stands; without it there is no
    // choice panel to go back to.
    case "placing_trap":
      return state.hasOffer ? "cancel-placement" : "none";
    default:
      return "none";
  }
}

/**
 * Every piece of run-scoped state the shell holds.
 *
 * It exists so quitting is one assignment rather than nine, which is what the
 * first "Quit to menu" got wrong: it moved the phase to `ready` and left the
 * challenge mounted, and since the title screen only renders when there is no
 * challenge, the player landed on a live canvas with no panel and no way out.
 */
export interface RunSlice {
  readonly challenge: ChallengeDTO | null;
  readonly attemptId: string | null;
  readonly offered: readonly [TrapType, TrapType, TrapType] | null;
  readonly placement: TrapPlacementInput | null;
  readonly result: PublishChildResult | null;
  readonly submitStatus: SubmitResult | null;
  readonly notice: string;
  readonly elapsed: number;
  readonly phase: GamePhase;
}

/** The state the title screen expects: no challenge, and no panel left over. */
export const EMPTY_RUN: RunSlice = {
  challenge: null,
  attemptId: null,
  offered: null,
  placement: null,
  result: null,
  submitStatus: null,
  notice: "",
  elapsed: 0,
  phase: "ready",
};

/** The keyboard, as the game actually binds it. */
export const CONTROLS: readonly {
  readonly keys: readonly string[];
  readonly action: string;
}[] = [
  { keys: ["W", "A", "S", "D"], action: "Move. The arrow keys do the same." },
  { keys: ["Space"], action: "Jump." },
  { keys: ["E"], action: "Hold to carry a loose prop, release to throw it forward." },
  { keys: ["R"], action: "Give up the attempt and take the restart." },
  { keys: ["M"], action: "Mute and unmute." },
  { keys: ["Esc"], action: "Pause, and step back out of any menu." },
];
