// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  MobileControls,
  supportsTouchControls,
} from "@/components/hud/MobileControls";

describe("touch controls", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("uses touch capability instead of viewport width", () => {
    expect(supportsTouchControls({ ontouchstart: null })).toBe(true);
    expect(supportsTouchControls({ innerWidth: 390 })).toBe(false);
  });

  it("mounts the complete pad in a touch-capable browser", async () => {
    Object.defineProperty(window, "ontouchstart", {
      configurable: true,
      value: null,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(MobileControls)));

    expect(host.querySelector('[aria-label="Touch game controls"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Move"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Jump"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Grab"]')).not.toBeNull();
  });
});
