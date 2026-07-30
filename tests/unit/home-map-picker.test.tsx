// @vitest-environment jsdom
//
// The home's map picker, and one promise in particular: that the course a
// player picks is the course the chain is built on.
//
// That promise is worth a test rather than a look because breaking it is
// silent. `createRootChain(track?)` composes a random course when it is handed
// nothing, so a picker that dropped its argument would still produce a
// playable level, still route to it, and still look right - it would just be
// somebody else's level. Nothing on screen would say so.
//
// The catalogue itself is not re-checked here. named-tracks.test.ts already
// puts every entry through isPlayableTrack, which is the thing that stops a
// course nobody can finish reaching a player.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const push = vi.fn();
const createRootChain = vi.fn(async (track?: readonly string[]) => ({
  slug: track ? `slug-for-${track.length}` : "slug-for-dice",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: unknown; href: string }) =>
    createElement("a", { href }, children as never),
}));
vi.mock("@/lib/repository/createRepository", () => ({
  createRepository: () => ({
    listTrending: async () => [],
    createRootChain,
  }),
}));
// Not part of this promise, and it drags the settings store in behind it.
vi.mock("@/components/hud/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));
vi.mock("@/components/hud/AvatarCustomizer", () => ({
  AvatarCustomizer: () => createElement("button", null, "Build your runner"),
}));

const { default: HomePageClient } = await import(
  "@/components/home/HomePageClient"
);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  push.mockClear();
  createRootChain.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(HomePageClient));
  });
}

async function click(node: Element | null | undefined): Promise<void> {
  await act(async () => {
    (node as HTMLElement | null | undefined)?.click();
  });
}

function byText(selector: string, label: string): HTMLElement | undefined {
  return [...host.querySelectorAll<HTMLElement>(selector)].find(
    (node) => (node.textContent ?? "").trim() === label,
  );
}

function mapCards(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(".home-map")];
}

describe("the simplified home actions", () => {
  it("removes the curated map picker", async () => {
    await mount();
    expect(mapCards()).toHaveLength(0);
    expect(byText("button", "Pick a map")).toBeUndefined();
  });

  it("puts Build your runner on the home screen", async () => {
    await mount();
    expect(byText("button", "Build your runner")).toBeDefined();
  });

  it("still rolls the dice when no course is named", async () => {
    await mount();
    await click(byText("button", "Start a fresh chain"));
    expect(createRootChain).toHaveBeenCalledWith(undefined);
    expect(push).toHaveBeenCalledWith("/c/slug-for-dice");
  });

  it("says so when a fresh chain cannot be opened", async () => {
    createRootChain.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await click(byText("button", "Start a fresh chain"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not start a fresh chain. Try once more.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
