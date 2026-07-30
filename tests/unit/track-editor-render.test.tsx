// @vitest-environment jsdom
//
// The wiring, not the arithmetic: tests/unit/track-editor.test.ts covers the
// pure functions, and this file covers the promises the component makes on top
// of them. The load-bearing one is the first: whatever the editor hands to
// onPlay has to be a course isPlayableTrack accepts, because the next thing
// that happens to it is being encoded into a link somebody else opens.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { isPlayableTrack } from "@/lib/game/track";
import { TrackEditor } from "@/portals/src/TrackEditor";

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

async function press(node: Element | null, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    node?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  });
}

async function click(node: Element | null | undefined): Promise<void> {
  await act(async () => {
    (node as HTMLElement | null | undefined)?.click();
  });
}

function cardLabels(): readonly string[] {
  return [...host.querySelectorAll(".track-editor-pick strong")].map(
    (node) => node.textContent ?? "",
  );
}

function byLabel(selector: string, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>(selector)].find((node) =>
    (node.getAttribute("aria-label") ?? "").startsWith(label),
  );
}

function playButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Play this track",
  );
  if (!button) throw new Error("the play button is missing");
  return button;
}

beforeEach(() => {
  window.localStorage.clear();
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

describe("what the editor hands over", () => {
  it("only ever sends a course isPlayableTrack accepts", async () => {
    let sent: readonly string[] | null = null;
    await mount(
      <TrackEditor
        onPlay={(segmentIds) => {
          sent = segmentIds;
        }}
        onCancel={() => {}}
      />,
    );
    expect(playButton().disabled).toBe(false);
    await click(playButton());
    expect(sent).not.toBeNull();
    expect(isPlayableTrack(sent ?? [])).toBe(true);
    expect((sent ?? []).at(0)).toBe("start");
    expect((sent ?? []).at(-1)).toBe("finish");
  });

  it("refuses to send an empty middle, and says why", async () => {
    await mount(<TrackEditor onPlay={() => {}} onCancel={() => {}} />);
    const clear = [...host.querySelectorAll<HTMLButtonElement>(".track-editor-tool")].find(
      (node) => node.textContent === "Clear",
    );
    await click(clear);
    expect(cardLabels()).toEqual([]);
    expect(playButton().disabled).toBe(true);
    const banner = host.querySelector(".track-editor-validity");
    expect(banner?.className).toContain("is-bad");
    expect(banner?.textContent).toContain("nothing in the middle");
  });

  it("draws a profile with real geometry rather than silent NaNs", async () => {
    await mount(<TrackEditor onPlay={() => {}} onCancel={() => {}} />);
    const svg = host.querySelector(".track-editor-profile");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toMatch(/hardest jump \d+\.\d\d/);
    const shapes = [...(svg?.querySelectorAll("rect, line, text") ?? [])];
    expect(shapes.length).toBeGreaterThan(10);
    // An SVG attribute of NaN draws nothing and reports nothing, so the picture
    // would quietly go blank rather than fail.
    for (const shape of shapes)
      for (const attribute of shape.getAttributeNames())
        expect(`${attribute}=${shape.getAttribute(attribute)}`).not.toContain(
          "NaN",
        );
    // One ribbon cell per segment, pinned ends included.
    expect(svg?.querySelectorAll(".track-editor-profile-slot").length).toBe(
      host.querySelectorAll("li.track-editor-card").length,
    );
  });

  it("shows draggable real pieces and no fake preset picker", async () => {
    await mount(<TrackEditor onPlay={() => {}} onCancel={() => {}} />);
    expect(host.querySelector(".track-editor-starters")).toBeNull();
    expect(host.querySelectorAll(".track-editor-miniature").length).toBeGreaterThan(4);
    expect(host.querySelectorAll(".track-editor-add[draggable='true']").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".track-editor-dropzone").length).toBeGreaterThan(0);
  });
});

describe("iterating on a course", () => {
  it("drops the next piece after the card the player chose", async () => {
    await mount(<TrackEditor initial={["runway", "bridge"]} onPlay={() => {}} onCancel={() => {}} />);
    expect(cardLabels()).toEqual(["Hallway Runway", "Narrow Bridge"]);
    await click(byLabel(".track-editor-pick", "Hallway Runway"));
    await click(byLabel(".track-editor-add", "Add Ramp"));
    expect(cardLabels()).toEqual(["Hallway Runway", "Ramp", "Narrow Bridge"]);
    // The new card takes the cursor, so the next piece lands after it rather
    // than jumping back to the end.
    await click(byLabel(".track-editor-add", "Add Convergence"));
    expect(cardLabels()).toEqual([
      "Hallway Runway",
      "Ramp",
      "Convergence",
      "Narrow Bridge",
    ]);
  });

  it("duplicates a card in place and reorders by one", async () => {
    await mount(<TrackEditor initial={["runway", "bridge"]} onPlay={() => {}} onCancel={() => {}} />);
    await click(byLabel(".track-editor-controls button", "Duplicate Hallway Runway"));
    expect(cardLabels()).toEqual([
      "Hallway Runway",
      "Hallway Runway",
      "Narrow Bridge",
    ]);
    await click(byLabel(".track-editor-controls button", "Move Narrow Bridge up"));
    expect(cardLabels()).toEqual([
      "Hallway Runway",
      "Narrow Bridge",
      "Hallway Runway",
    ]);
  });

  it("moves focus to a neighbour when a card is removed", async () => {
    await mount(<TrackEditor initial={["runway", "bridge"]} onPlay={() => {}} onCancel={() => {}} />);
    await click(byLabel(".track-editor-controls button", "Remove Hallway Runway"));
    expect(cardLabels()).toEqual(["Narrow Bridge"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Remove Narrow Bridge (position 2 of 3)",
    );
  });
});

describe("undo", () => {
  it("walks an edit back and forward from the keyboard", async () => {
    await mount(<TrackEditor initial={["runway"]} onPlay={() => {}} onCancel={() => {}} />);
    await click(byLabel(".track-editor-add", "Add Narrow Bridge"));
    expect(cardLabels()).toEqual(["Hallway Runway", "Narrow Bridge"]);
    const panel = host.querySelector(".track-editor");
    await press(panel, { key: "z", ctrlKey: true });
    expect(cardLabels()).toEqual(["Hallway Runway"]);
    await press(panel, { key: "z", ctrlKey: true, shiftKey: true });
    expect(cardLabels()).toEqual(["Hallway Runway", "Narrow Bridge"]);
  });

  it("names the step on the button and takes back a clear", async () => {
    await mount(<TrackEditor initial={["runway"]} onPlay={() => {}} onCancel={() => {}} />);
    const clear = [...host.querySelectorAll<HTMLButtonElement>(".track-editor-tool")].find(
      (node) => node.textContent === "Clear",
    );
    await click(clear);
    const undoButton = host.querySelector<HTMLButtonElement>(".track-editor-tool");
    expect(undoButton?.textContent).toBe("Undo clearing the course");
    await click(undoButton);
    expect(cardLabels()).toEqual(["Hallway Runway"]);
  });

  it("keeps undo focusable with nothing to undo, and speaks the refusal", async () => {
    await mount(<TrackEditor initial={["runway"]} onPlay={() => {}} onCancel={() => {}} />);
    const undoButton = host.querySelector<HTMLButtonElement>(".track-editor-tool");
    expect(undoButton?.getAttribute("aria-disabled")).toBe("true");
    expect(undoButton?.disabled).toBe(false);
    await click(undoButton);
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      "Nothing left to undo.",
    );
  });
});

describe("the draft", () => {
  it("comes back the next time the editor opens", async () => {
    await mount(<TrackEditor initial={["runway"]} onPlay={() => {}} onCancel={() => {}} />);
    await click(byLabel(".track-editor-add", "Add Narrow Bridge"));
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    await mount(<TrackEditor onPlay={() => {}} onCancel={() => {}} />);
    expect(cardLabels()).toEqual(["Hallway Runway", "Narrow Bridge"]);
  });

  it("gives way to a course the caller passes in", async () => {
    window.localStorage.setItem(
      "miw.track-editor.draft.v1",
      JSON.stringify(["bridge"]),
    );
    await mount(<TrackEditor initial={["runway"]} onPlay={() => {}} onCancel={() => {}} />);
    expect(cardLabels()).toEqual(["Hallway Runway"]);
  });
});
