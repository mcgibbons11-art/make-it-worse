// @vitest-environment jsdom
// Can a player who started the run with a MOUSE then move with the keyboard?
//
// Both shells reach gameplay through a click, and that button keeps focus.
// PlayerController reads every movement key through isInterfaceTarget, which
// counts a focused BUTTON as "the interface" and returns before recording the
// key. Focus left on the start button therefore swallows WASD and Space for the
// entire attempt, and the runner never leaves spawn.
//
// It cost two agents an hour tonight, each concluding their own input harness
// was broken, because synthetic KeyboardEvents dispatched at `window` DO work -
// window is not an HTMLElement, so the guard lets them through. Automated
// driving looked fine while hand-playing was impossible. That asymmetry is
// exactly why this needs a test rather than a play-through.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isInterfaceTarget } from "@/lib/game/input";

// resolve() off cwd rather than import.meta.url: this file runs under jsdom,
// where import.meta.url does not resolve relative paths the way it does in the
// node environment the other source-reading tests use.
const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("keyboard survives a mouse-started run", () => {
  it("treats a focused button as the interface, which is the whole hazard", () => {
    // Not a quirk to work around - it is deliberate, and correct: it stops
    // Space from re-triggering a focused button and stops WASD being eaten out
    // of the display-name field. The bug is leaving focus there, not this rule.
    const button = document.createElement("button");
    expect(isInterfaceTarget(button)).toBe(true);
    // A synthetic event dispatched at window reports window as its target, and
    // window is not an HTMLElement. This is why automated input passed while a
    // real keyboard did not.
    expect(isInterfaceTarget(window as unknown as EventTarget)).toBe(false);
    expect(isInterfaceTarget(null)).toBe(false);
  });

  it("drops focus when play starts, in BOTH shells", () => {
    // Asserted against the source rather than a render because the effect is a
    // handful of lines in two large client components, and what matters is that
    // neither edition is missing it. The Portals shell had it; the Next shell
    // did not, and that is the edition a reviewer could not play.
    for (const filePath of [
      "portals/src/PortalsApp.tsx",
      "components/game/GameClient.tsx",
    ]) {
      // Matched as two facts rather than one regex over the whole effect: both
      // shells name `phase` slightly differently (`phase` vs `game.phase`) and
      // both contain other "playing" guards, so a single shape-matching pattern
      // is brittle in a way that would fail on a correct file.
      const source = read(filePath);
      expect(
        source.includes("document.activeElement.blur()"),
        `${filePath} never blurs the control that started the run`,
      ).toBe(true);
      expect(
        /activeElement instanceof HTMLElement/.test(source),
        `${filePath} blurs without checking it has an element to blur`,
      ).toBe(true);
    }
  });

  it("mounts the touch pad in the Portals run, not only the Next shell", () => {
    const source = read("portals/src/PortalsApp.tsx");
    expect(source).toContain('runPanel === "playing" && <MobileControls />');
    expect(source).toContain("touchControls={touchControls}");
  });

  it("never lets a focused result button swallow movement key releases", () => {
    const source = read("components/game/PlayerController.tsx");
    const releaseHandler = source.slice(
      source.indexOf("const up = (event: KeyboardEvent)"),
      source.indexOf('window.addEventListener("keydown", down)'),
    );
    expect(releaseHandler).not.toContain("isInterfaceTarget");
    expect(releaseHandler).toContain("setKey(");
  });

  it("clears the shared movement snapshot at every new attempt in both shells", () => {
    for (const filePath of [
      "portals/src/PortalsApp.tsx",
      "components/game/GameClient.tsx",
    ]) {
      const source = read(filePath);
      expect(source, filePath).toContain("resetInput();");
      expect(source, filePath).toMatch(/attemptSerial[^\]]*phase|phase[^\]]*attemptSerial/);
    }
  });

  it("rebuilds the runner physics body at spawn for every retry", () => {
    const source = read("components/game/PlayerController.tsx");
    expect(source).toContain('key={`runner-attempt-${attemptSerial}`}');
    expect(source).toContain("{ x: spawn[0], y: spawn[1], z: spawn[2] }");
    expect(source).toContain("rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);");
    expect(source).toContain("rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);");
  });
});
