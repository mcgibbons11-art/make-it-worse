"use client";

import { useCallback, useState } from "react";
import { resolveAvatar } from "@/lib/game/avatar";
import { WardrobePanel } from "@/components/hud/wardrobe/WardrobePanel";
import { useGameStore } from "@/stores/game-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * The runner picker, wired to this app's stores.
 *
 * Self-contained on purpose: it opens itself the first time a player reaches an
 * intro without having been asked, and leaves a pill on screen so it is
 * re-openable rather than buried behind the settings gear. That keeps the whole
 * integration a single element in GameClient.
 *
 * The wardrobe itself is WardrobePanel, which knows nothing about either store.
 * The Portals edition keeps its runner somewhere else entirely and mounts that
 * component directly.
 */
export function AvatarCustomizer({
  alwaysVisible = false,
  launcherClassName = "avatar-launcher",
  launcherLabel,
}: {
  alwaysVisible?: boolean;
  launcherClassName?: string;
  launcherLabel?: string;
} = {}) {
  const phase = useGameStore((state) => state.phase);
  // Only reached when no avatar is set, where it is what the runner already
  // looks like, so the launcher chip shows the figure the player would keep.
  const seed = useGameStore(
    (state) => state.challenge?.createdByAvatarSeed ?? 1,
  );
  const avatar = useSettingsStore((state) => state.avatar);
  const setAvatar = useSettingsStore((state) => state.setAvatar);
  const dismissAvatarPrompt = useSettingsStore(
    (state) => state.dismissAvatarPrompt,
  );
  const [manualOpen, setManualOpen] = useState(false);
  // The panel opens when ASKED, never by itself. It used to auto-open over the
  // first intro (`phase === "intro" && !avatarPrompted`), which put a
  // modal-backdrop between a first-time player and the start button at the
  // exact moment they arrived to play - a full production e2e run measured
  // every gameplay flow dying on that backdrop before its first click. The
  // Portals edition, which is the one people actually play, has only ever
  // offered the launcher button, so this also makes the two shells behave the
  // same. Closing still marks `avatarPrompted` in the store for anything that
  // wants to know the player has met the panel; nothing here reads it now.
  const open = manualOpen;
  const close = useCallback(() => {
    dismissAvatarPrompt();
    setManualOpen(false);
  }, [dismissAvatarPrompt]);

  if (!open)
    return phase === "intro" || alwaysVisible ? (
      <button className={launcherClassName} onClick={() => setManualOpen(true)}>
        <span
          className="avatar-launcher-chip"
          style={{ background: resolveAvatar(avatar, seed).bodyColor }}
        />
        {launcherLabel ?? (avatar ? "Edit your runner" : "Make your runner")}
      </button>
    ) : null;

  return (
    <WardrobePanel
      avatar={avatar ?? null}
      avatarSeed={seed}
      onSave={(config) => {
        setAvatar(config);
        setManualOpen(false);
      }}
      onClose={close}
    />
  );
}
