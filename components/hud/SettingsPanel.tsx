"use client";

import type { FormEvent } from "react";
import { useSettingsStore } from "@/stores/settings-store";

interface SettingsPanelProps {
  open: boolean;
  profileName?: string;
  onUpdateProfile?(displayName: string): Promise<void> | void;
  onClose(): void;
}

export function SettingsPanel({
  open,
  profileName,
  onUpdateProfile,
  onClose,
}: SettingsPanelProps) {
  const settings = useSettingsStore();
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = String(
      new FormData(event.currentTarget).get("displayName") ?? "",
    );
    if (onUpdateProfile && displayName.trim())
      await onUpdateProfile(displayName);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <form
        className="panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={(event) => void submit(event)}
      >
        <div className="panel-kicker">COMFORT & CHAOS</div>
        <h2 id="settings-title">Settings</h2>
        {profileName && (
          <label className="setting-row identity-row">
            <span>Display name</span>
            <input
              key={profileName}
              name="displayName"
              defaultValue={profileName}
              minLength={2}
              maxLength={24}
              autoComplete="nickname"
              aria-label="Display name"
            />
          </label>
        )}
        <label className="setting-row">
          <span>Sound</span>
          <button type="button" className="toggle" aria-pressed={!settings.muted} onClick={settings.toggleMuted}>
            {settings.muted ? "Muted" : "On"}
          </button>
        </label>
        <label className="setting-row">
          <span>Ghost runner</span>
          <button type="button" className="toggle" aria-pressed={settings.ghostEnabled} onClick={settings.toggleGhost}>
            {settings.ghostEnabled ? "On" : "Off"}
          </button>
        </label>
        <label className="setting-row">
          <span>Camera shake</span>
          <button type="button" className="toggle" aria-pressed={settings.cameraShake} onClick={settings.toggleShake}>
            {settings.cameraShake ? "On" : "Off"}
          </button>
        </label>
        <label className="setting-row">
          <span>Reduced motion</span>
          <button type="button" className="toggle" aria-pressed={settings.reducedMotion} onClick={settings.toggleReducedMotion}>
            {settings.reducedMotion ? "On" : "Off"}
          </button>
        </label>
        <label className="setting-row">
          <span>Quality</span>
          <select value={settings.quality} onChange={(event) => settings.setQuality(event.target.value as "auto" | "low" | "high")}>
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          Save settings
        </button>
      </form>
    </div>
  );
}
