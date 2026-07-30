// @vitest-environment jsdom
//
// The Portals shell - everything wrapped around the run. portals/src had no
// test coverage at all before this file, and the two things worth pinning down
// are the ones that were actually broken: what quitting to the menu leaves
// behind, and whether a dialog holds the keyboard.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GamePhase } from "@/lib/game/types";
import {
  CONTROLS,
  EMPTY_RUN,
  discardsRun,
  escapeAction,
  runStatus,
  type ShellView,
} from "@/portals/src/menu/shell-state";
import {
  ControlsPanel,
  Overlay,
  focusableWithin,
} from "@/portals/src/menu/ShellPanels";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALL_PHASES: readonly GamePhase[] = [
  "booting", "intro", "ready", "playing", "failed", "finished",
  "choosing_trap", "placing_trap", "publishing", "sharing", "paused",
  "fatal_error",
];

describe("what has to be confirmed before it is thrown away", () => {
  it("loads the managed Portals SDK before the game module", () => {
    const html = readFileSync(resolve(process.cwd(), "portals/index.html"), "utf8");
    const sdk = html.indexOf('<script vite-ignore src="./_portals/sdk.js"></script>');
    const game = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
    expect(sdk).toBeGreaterThan(-1);
    expect(game).toBeGreaterThan(sdk);
  });

  it("guards a live attempt", () => {
    expect(discardsRun("playing")).toBe(true);
    expect(discardsRun("paused")).toBe(true);
  });

  it("guards a finished run that still holds an unplaced trap", () => {
    // The reward is the point of the game, and between finishing and
    // publishing it exists only in this tab. Leaving loses it.
    for (const phase of ["finished", "choosing_trap", "placing_trap", "publishing"] as const)
      expect(discardsRun(phase), phase).toBe(true);
  });

  it("does not nag when there is nothing left to lose", () => {
    // `sharing` has already published the child challenge and `failed` has
    // already recorded the attempt, so neither is holding anything.
    for (const phase of ["booting", "ready", "intro", "failed", "sharing", "fatal_error"] as const)
      expect(discardsRun(phase), phase).toBe(false);
  });

  it("has an answer for every phase", () => {
    for (const phase of ALL_PHASES)
      expect(typeof discardsRun(phase), phase).toBe("boolean");
  });
});

describe("what quitting to the menu clears", () => {
  it("drops the challenge, so the title screen is what renders", () => {
    // The first version of "Quit to menu" moved the phase to `ready` and left
    // the challenge mounted. The title screen only renders when there is no
    // challenge and no panel is keyed on `ready`, so that combination drew a
    // live canvas with nothing on it and no way back.
    expect(EMPTY_RUN.challenge).toBeNull();
    expect(EMPTY_RUN.phase).toBe("ready");
  });

  it("drops every panel that would otherwise reappear over the menu", () => {
    expect(EMPTY_RUN.offered).toBeNull();
    expect(EMPTY_RUN.placement).toBeNull();
    expect(EMPTY_RUN.result).toBeNull();
    expect(EMPTY_RUN.notice).toBe("");
  });

  it("drops the attempt and its leaderboard submission", () => {
    // Left standing, the previous run's sign-in prompt flashes under the next
    // run's finish panel before its own submission resolves.
    expect(EMPTY_RUN.attemptId).toBeNull();
    expect(EMPTY_RUN.submitStatus).toBeNull();
    expect(EMPTY_RUN.elapsed).toBe(0);
  });

  it("leaves nothing truthy behind", () => {
    // A blunt backstop: a field added to RunSlice and given a live default
    // rather than an empty one fails here even if nobody updates this file.
    for (const [key, value] of Object.entries(EMPTY_RUN)) {
      if (key === "phase") continue;
      expect(Boolean(value), `${key} should be cleared`).toBe(false);
    }
  });
});

describe("what Escape does", () => {
  const base = { view: null as ShellView | null, editorOpen: false, phase: "playing" as GamePhase, hasOffer: false };

  it("closes the topmost shell surface before anything else", () => {
    for (const view of ["menu", "settings", "controls", "confirm"] as const)
      expect(escapeAction({ ...base, view })).toBe("close-view");
  });

  it("closes the track editor once no dialog is over it", () => {
    expect(escapeAction({ ...base, phase: "ready", editorOpen: true })).toBe("close-editor");
    // A dialog opened from inside the editor still wins.
    expect(escapeAction({ ...base, phase: "ready", editorOpen: true, view: "settings" })).toBe("close-view");
  });

  it("pauses a run and resumes a paused one", () => {
    expect(escapeAction({ ...base, phase: "playing" })).toBe("pause");
    expect(escapeAction({ ...base, phase: "paused" })).toBe("resume");
  });

  it("leaves the intro, where nothing has been started yet", () => {
    expect(escapeAction({ ...base, phase: "intro" })).toBe("leave-intro");
  });

  it("steps back out of placement only while the offer still stands", () => {
    expect(escapeAction({ ...base, phase: "placing_trap", hasOffer: true })).toBe("cancel-placement");
    // Without the offer there is no choice panel to go back to.
    expect(escapeAction({ ...base, phase: "placing_trap", hasOffer: false })).toBe("none");
  });

  it("never throws away a decision the player has not made yet", () => {
    // A reflex Escape on a result screen must not cost a completed run.
    for (const phase of ["failed", "finished", "choosing_trap", "publishing", "sharing"] as const)
      expect(escapeAction({ ...base, phase }), phase).toBe("none");
  });
});

describe("how the menu describes the run behind it", () => {
  it("says something for every phase a mounted challenge can be in", () => {
    for (const phase of ALL_PHASES) {
      if (phase === "booting" || phase === "ready" || phase === "fatal_error") {
        expect(runStatus(phase), phase).toBeNull();
        continue;
      }
      const status = runStatus(phase);
      expect(status, phase).not.toBeNull();
      expect(status?.label.length, phase).toBeGreaterThan(0);
      expect(status?.resumeLabel.length, phase).toBeGreaterThan(0);
    }
  });

  it("offers the clock only where a clock has been running", () => {
    expect(runStatus("intro")?.showsClock).toBe(false);
    expect(runStatus("paused")?.showsClock).toBe(true);
    expect(runStatus("finished")?.showsClock).toBe(true);
  });
});

describe("the controls reference", () => {
  it("shows the actual touch gestures instead of keyboard bindings on mobile", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(ControlsPanel, { onBack: () => undefined, touchControls: true }),
      );
    });
    expect(host.textContent).toContain("TOUCH CONTROLS");
    expect(host.textContent).toContain("Left pad");
    expect(host.textContent).toContain("turn the camera");
    expect(host.textContent).not.toContain("DESKTOP KEYBOARD");
    await act(async () => root.unmount());
  });

  it("names a key and an action for every row", () => {
    expect(CONTROLS.length).toBeGreaterThan(0);
    for (const row of CONTROLS) {
      expect(row.keys.length).toBeGreaterThan(0);
      expect(row.action.endsWith(".")).toBe(true);
    }
  });

  it("covers every binding the shell and the controller register", () => {
    // PlayerController.tsx maps WASD/arrows, Space and E; PortalsApp handles R,
    // M and Escape. A reference that omits one is worse than none.
    const listed = CONTROLS.flatMap((row) => row.keys).join(" ");
    for (const key of ["W", "A", "S", "D", "Space", "E", "R", "M", "Esc"])
      expect(listed, key).toContain(key);
  });
});

describe("the dialog wrapper", () => {
  let host: HTMLDivElement;
  let root: Root;

  const dialog = (...labels: readonly string[]) =>
    createElement(
      Overlay,
      { labelledBy: "trap-title" },
      [
        createElement("h2", { id: "trap-title", key: "title" }, "Paused"),
        ...labels.map((label) =>
          createElement("button", { key: label }, label),
        ),
      ],
    );

  const press = async (init: KeyboardEventInit) => {
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
    });
  };

  const focusedLabel = () =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement.textContent
      : null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("announces itself as a modal dialog with a name", async () => {
    await act(async () => {
      root.render(dialog("Resume"));
    });
    const panel = host.querySelector("[role='dialog']");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(panel?.getAttribute("aria-labelledby")).toBe("trap-title");
    expect(document.getElementById("trap-title")?.textContent).toBe("Paused");
  });

  it("moves focus into the dialog when it opens", async () => {
    await act(async () => {
      root.render(dialog("Resume", "Settings"));
    });
    expect(focusedLabel()).toBe("Resume");
  });

  it("holds Tab inside the dialog and wraps at both ends", async () => {
    await act(async () => {
      root.render(dialog("Resume", "Settings", "Main menu"));
    });
    await press({ key: "Tab" });
    expect(focusedLabel()).toBe("Settings");
    await press({ key: "Tab" });
    expect(focusedLabel()).toBe("Main menu");
    // The last stop wraps forward to the first rather than walking out into
    // the page behind the modal, which is what the bare overlays did.
    await press({ key: "Tab" });
    expect(focusedLabel()).toBe("Resume");
    await press({ key: "Tab", shiftKey: true });
    expect(focusedLabel()).toBe("Main menu");
  });

  it("pulls focus back in when it is outside the dialog", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Behind the modal";
    document.body.append(outside);
    await act(async () => {
      root.render(dialog("Resume", "Settings"));
    });
    outside.focus();
    await press({ key: "Tab" });
    expect(focusedLabel()).toBe("Resume");
    outside.remove();
  });

  it("gives focus back to whatever opened it", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Pause";
    document.body.append(opener);
    opener.focus();
    await act(async () => {
      root.render(dialog("Resume"));
    });
    expect(focusedLabel()).toBe("Resume");
    await act(async () => {
      root.render(null);
    });
    expect(focusedLabel()).toBe("Pause");
    opener.remove();
  });

  it("counts only the stops a keyboard can actually reach", async () => {
    await act(async () => {
      root.render(
        createElement(
          Overlay,
          { labelledBy: "trap-title" },
          [
            createElement("h2", { id: "trap-title", key: "title" }, "Reward"),
            createElement("button", { disabled: true, key: "blocked" }, "No room"),
            createElement("button", { key: "finish" }, "Finish the chain"),
          ],
        ),
      );
    });
    const panel = host.querySelector<HTMLElement>("[role='dialog']")!;
    expect(focusableWithin(panel).map((node) => node.textContent)).toEqual([
      "Finish the chain",
    ]);
    // A panel whose only live control is the second one still opens on it.
    expect(focusedLabel()).toBe("Finish the chain");
  });
});
