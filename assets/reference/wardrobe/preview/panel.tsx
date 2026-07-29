// Look at the clothes.
//
// createWardrobeAttachments builds geometry that nothing in a unit test ever
// sees: the tests measure boxes and vertex positions, which catches a garment
// that clips and says nothing at all about whether it reads as the thing in its
// reference. This mounts the real WardrobePanel - the real RunnerStage, the
// real templates, the real tints - so a garment can be worn and photographed.
//
// A screenshot pass dresses the runner by clicking the panel's own controls,
// which is the path a player takes and therefore the one worth proving. What
// this adds on window is only what the DOM cannot answer: __turn, because the
// stage is a WebGL loop with no handle on its turntable, and __panelMetrics,
// because where the commit control sits after a selection is a number rather
// than something to eyeball.
//
// Nothing in the game imports this. It is review scaffolding for the
// img2threejs loop, alongside fit_check.ts and measure_runner.ts.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WardrobePanel } from "@/components/hud/wardrobe/WardrobePanel";
import { DEFAULT_AVATAR, WARDROBE_SLOTS } from "@/lib/game/avatar";
import { useSettingsStore } from "@/stores/settings-store";
import type { AvatarConfig } from "@/lib/game/avatar";
import "@/app/globals.css";

declare global {
  interface Window {
    __turn?: (seconds: number) => Promise<void>;
    __panelMetrics?: () => Record<string, unknown>;
    __slots?: { slot: string; empty: string; options: string[] }[];
  }
}

function Harness() {
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  useEffect(() => {
    // The stage turntable runs off reducedMotion. Held still by default so two
    // garments photograph from the same angle, and turned on demand for the
    // items whose whole point is on the runner's back.
    useSettingsStore.setState({ reducedMotion: true });
    window.__turn = (seconds) =>
      new Promise((done) => {
        useSettingsStore.setState({ reducedMotion: false });
        window.setTimeout(() => {
          useSettingsStore.setState({ reducedMotion: true });
          done();
        }, seconds * 1000);
      });
    window.__slots = WARDROBE_SLOTS.map((slot) => ({
      slot: slot.id,
      empty: slot.options[0]!.id,
      options: slot.options.slice(1).map((option) => option.id),
    }));
    window.__panelMetrics = () => {
      const commit = document.querySelector<HTMLElement>(".avatar-panel .button.primary");
      const swatches = document.querySelector<HTMLElement>(
        ".avatar-panel fieldset:last-of-type .avatar-swatches",
      );
      const controls = document.querySelector<HTMLElement>(".avatar-controls");
      const rect = (element: HTMLElement | null) =>
        element ? element.getBoundingClientRect().toJSON() : null;
      return {
        commit: rect(commit),
        swatches: rect(swatches),
        controlsScrollTop: controls?.scrollTop ?? null,
      };
    };
  }, []);
  return (
    <WardrobePanel
      avatar={avatar}
      avatarSeed={1}
      onSave={setAvatar}
      onClose={() => undefined}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
