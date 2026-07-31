// The shell's dialogs: the modal wrapper every overlay in this edition now
// uses, and the three panels a player could not reach before (settings, the
// controls reference, and the confirmation in front of anything that discards
// a run).

import { useEffect, useRef, type ReactNode } from "react";
import { AudioManager } from "@/lib/audio/AudioManager";
import { useSettingsStore } from "@/stores/settings-store";
import { CONTROLS } from "./shell-state";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Tab stops inside a dialog, in document order.
 *
 * Deliberately no visibility filter: everything these panels render is on
 * screen, and the usual `offsetParent` test reports every element hidden under
 * jsdom, which would make the trap untestable and silently empty.
 */
export function focusableWithin(root: HTMLElement): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * Holds Tab inside the dialog and gives focus back when it closes.
 *
 * The listener is on the document in the capture phase rather than on the
 * panel, so a Tab pressed while focus sits outside the panel - which is where
 * it lands whenever a dialog replaces another one - still comes back inside
 * instead of walking the page behind the modal.
 */
export function useFocusTrap(): React.RefObject<HTMLElement | null> {
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const previous = document.activeElement;
    (focusableWithin(node)[0] ?? node).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const stops = focusableWithin(node);
      if (stops.length === 0) {
        node.focus();
        return;
      }
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? stops.indexOf(active) : -1;
      if (index === -1) {
        (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
        return;
      }
      stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return panel;
}

/**
 * Every full-screen panel in this edition.
 *
 * Before this, the overlays were bare divs: no dialog role, no `aria-modal`,
 * and Tab walked straight out of the pause panel into the page behind it.
 */
export function Overlay({
  labelledBy,
  className,
  panelClassName,
  decoration,
  children,
}: {
  readonly labelledBy: string;
  readonly className?: string | undefined;
  readonly panelClassName?: string | undefined;
  readonly decoration?: ReactNode;
  readonly children?: ReactNode;
}) {
  const panel = useFocusTrap();
  return (
    <div className={className ? `portals-overlay ${className}` : "portals-overlay"}>
      {decoration}
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={panelClassName ? `panel ${panelClassName}` : "panel"}
      >
        {children}
      </section>
    </div>
  );
}

/**
 * Portals embeds games in a restricted frame where native prompt dialogs may
 * be suppressed. Map codes therefore use an ordinary in-game form: it is
 * focus trapped, pasteable, keyboard submit works, and errors stay beside the
 * code instead of disappearing under the title screen.
 */
export function MapCodePanel({
  value,
  notice,
  onChange,
  onSubmit,
  onBack,
}: {
  readonly value: string;
  readonly notice: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onBack: () => void;
}) {
  return (
    // Portals' processed game iframe intentionally omits `allow-forms`.
    // Even a React form whose submit handler calls preventDefault is blocked
    // by Chromium there before the loader can run. This is an in-game action,
    // not navigation, so use a plain container and an ordinary click instead.
    <div>
      <div className="eyebrow">PLAY A SHARED ROOM</div>
      <h2 id="portals-map-code-title">Use map code</h2>
      <p className="portals-lede">
        Paste the complete code your friend copied. It contains the exact room,
        traps, and runner they shared.
      </p>
      <label className="portals-code-field" htmlFor="portals-map-code-input">
        Map code
        <textarea
          id="portals-map-code-input"
          value={value}
          rows={7}
          maxLength={12_000}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="Paste the complete MAKE IT WORSE code here"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <p className="portals-notice" role="status" aria-live="polite">
        {notice}
      </p>
      <div className="portals-buttons">
        <button
          className="button primary"
          type="button"
          disabled={!value.trim()}
          onClick={onSubmit}
        >
          Load this map
        </button>
        <button className="button secondary" type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function Toggle({
  id,
  label,
  on,
  onLabel,
  offLabel,
  onToggle,
  hint,
}: {
  readonly id: string;
  readonly label: string;
  readonly on: boolean;
  readonly onLabel: string;
  readonly offLabel: string;
  readonly onToggle: () => void;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="setting-row">
      <span id={id}>
        {label}
        {hint && <small className="portals-setting-hint">{hint}</small>}
      </span>
      <button
        type="button"
        className="portals-toggle"
        aria-pressed={on}
        aria-labelledby={id}
        onClick={onToggle}
      >
        {on ? onLabel : offLabel}
      </button>
    </div>
  );
}

/**
 * The settings a Portals player could not reach at all before this.
 *
 * Every control here changes something in this bundle: volume and mute feed
 * AudioManager, the ghost feeds GameCanvas, camera shake and reduced motion are
 * read by CameraRig, and reduced motion and effects quality set the particle
 * budget in EffectsLayer. Nothing is listed that does nothing.
 */
export function SettingsMenu({ onBack }: { readonly onBack: () => void }) {
  const settings = useSettingsStore();
  const percent = Math.round(settings.volume * 100);
  return (
    <>
      <div className="eyebrow">COMFORT AND CHAOS</div>
      <h2 id="portals-settings-title">Settings</h2>
      <p className="portals-lede">
        Kept in this browser. Everything here takes effect straight away.
      </p>
      <div className="setting-row">
        <label htmlFor="portals-volume">Volume</label>
        <span className="portals-volume">
          <input
            id="portals-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={settings.muted}
            onChange={(event) => {
              settings.setVolume(Number(event.target.value) / 100);
              // The menu is silent, so without a sample at the new level the
              // slider is a number rather than a volume control.
              AudioManager.click();
            }}
          />
          <b>{settings.muted ? "muted" : `${percent}%`}</b>
        </span>
      </div>
      <Toggle
        id="portals-set-sound"
        label="Sound"
        on={!settings.muted}
        onLabel="On"
        offLabel="Muted"
        onToggle={settings.toggleMuted}
      />
      <Toggle
        id="portals-set-ghost"
        label="Ghost runner"
        hint="The previous player's replay, running beside you."
        on={settings.ghostEnabled}
        onLabel="On"
        offLabel="Off"
        onToggle={settings.toggleGhost}
      />
      <Toggle
        id="portals-set-shake"
        label="Camera shake"
        on={settings.cameraShake}
        onLabel="On"
        offLabel="Off"
        onToggle={settings.toggleShake}
      />
      <Toggle
        id="portals-set-motion"
        label="Reduced motion"
        hint="Stops the camera shake, the confetti and the spinning failure rays."
        on={settings.reducedMotion}
        onLabel="On"
        offLabel="Off"
        onToggle={settings.toggleReducedMotion}
      />
      <div className="setting-row">
        <label htmlFor="portals-quality">Effects</label>
        <select
          id="portals-quality"
          value={settings.quality}
          onChange={(event) =>
            settings.setQuality(event.target.value as "auto" | "low" | "high")
          }
        >
          <option value="auto">Auto</option>
          <option value="low">Low</option>
          <option value="high">High</option>
        </select>
      </div>
      <button className="button primary huge" onClick={onBack}>
        Done
      </button>
    </>
  );
}

/** What the keys do, which the shell only ever stated as "WASD · Space · E · R". */
const TOUCH_CONTROLS = [
  ["Left pad", "Drag to move."],
  ["JUMP", "Tap to jump."],
  ["GRAB", "Hold to carry a loose prop, release to throw it forward."],
  ["Scene", "Drag outside the controls to turn the camera."],
] as const;

export function ControlsPanel({
  onBack,
  touchControls = false,
}: {
  readonly onBack: () => void;
  readonly touchControls?: boolean;
}) {
  return (
    <>
      <div className="eyebrow">
        {touchControls ? "TOUCH CONTROLS" : "DESKTOP KEYBOARD"}
      </div>
      <h2 id="portals-controls-title">How to play</h2>
      <p className="portals-lede">
        Reach the door before the clock runs out. Survive and you get to add one
        awful thing for the next player.
      </p>
      <dl className="portals-controls">
        {touchControls
          ? TOUCH_CONTROLS.map(([control, action]) => (
              <div className="portals-control" key={control}>
                <dt>
                  <kbd>{control}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))
          : CONTROLS.map((row) => (
              <div className="portals-control" key={row.action}>
                <dt>
                  {row.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{row.action}</dd>
              </div>
            ))}
      </dl>
      <button className="button primary huge" onClick={onBack}>
        Done
      </button>
    </>
  );
}

/**
 * The gate in front of anything that throws a run away.
 *
 * The safe action is first in the DOM, so it is what the focus trap lands on
 * and what Enter takes on arrival.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <div className="eyebrow">ARE YOU SURE</div>
      <h2 id="portals-confirm-title">{title}</h2>
      <p className="portals-lede">{body}</p>
      <div className="portals-buttons">
        <button className="button primary huge" onClick={onCancel}>
          Keep playing
        </button>
        <button className="button danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}
