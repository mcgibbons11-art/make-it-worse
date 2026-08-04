"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AVATAR_COLORS,
  applyWardrobeSelection,
  DEFAULT_AVATAR,
  WARDROBE_SLOTS,
  avatarColor,
  avatarFromCode,
  avatarToCode,
  colorRejection,
  deckContrast,
  isCustomColor,
  isReadableAvatar,
  isSlotFilled,
  normalizeAvatar,
  normalizeCustomColor,
  randomAvatar,
} from "@/lib/game/avatar";
import type {
  AvatarColorValue,
  AvatarConfig,
  AvatarSwatch,
  ColorSlot,
  CustomAvatarColor,
  WardrobeSlotId,
} from "@/lib/game/avatar";
import { WARDROBE_ITEM_COUNT } from "@/lib/game/wardrobe";
import { RunnerStage } from "./RunnerStage";

const ratioLabel = (ratio: number) => `${ratio.toFixed(1)}:1`;

/** A failed preview must never take the usable wardrobe down with it. */
class RunnerPreviewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[runner-preview] graphics failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="avatar-preview-fallback" role="status">
          <span aria-hidden="true">🏃</span>
          <b>The runner preview needs another try.</b>
          <button
            type="button"
            onClick={() => this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))}
          >
            🔄 Retry preview
          </button>
        </div>
      );
    }
    return <div key={this.state.attempt} className="avatar-preview-boundary">{this.props.children}</div>;
  }
}

// --- Custom colour mixing ---------------------------------------------------

function hexToHsl(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): CustomAvatarColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  const channel = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}` as CustomAvatarColor;
}

/**
 * The mixing desk behind the "Mix…" swatch: hue, saturation, and lightness
 * sliders plus an exact hex field, all pushing straight into the live runner
 * preview. Sliders rather than a picker canvas so the control matches the
 * game's chunky panel style and stays fully keyboard-operable.
 */
function CustomColorMixer({
  name,
  value,
  onChange,
}: {
  name: string;
  value: CustomAvatarColor;
  onChange: (next: CustomAvatarColor) => void;
}) {
  const [h, s, l] = hexToHsl(value);
  // The field holds whatever the player is typing, however incomplete, and
  // re-anchors to the real value whenever a slider changes it. Adjusted
  // during render rather than in an effect, which is the React-sanctioned
  // shape for state derived from a prop change.
  const [hexDraft, setHexDraft] = useState<string>(value);
  const [anchor, setAnchor] = useState<CustomAvatarColor>(value);
  if (anchor !== value) {
    setAnchor(value);
    setHexDraft(value);
  }
  const hueHex = hslToHex(h, 100, 50);
  return (
    <div className="avatar-mixer">
      <span className="avatar-mixer-preview" style={{ background: value }} aria-hidden="true" />
      <label className="avatar-mixer-row">
        Hue
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(h)}
          aria-label="Hue"
          className="avatar-mixer-slider avatar-mixer-hue"
          onChange={(event) => onChange(hslToHex(Number(event.target.value), s, l))}
        />
      </label>
      <label className="avatar-mixer-row">
        Saturation
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s)}
          aria-label="Saturation"
          className="avatar-mixer-slider"
          style={{ background: `linear-gradient(to right, #808080, ${hueHex})` }}
          onChange={(event) => onChange(hslToHex(h, Number(event.target.value), l))}
        />
      </label>
      <label className="avatar-mixer-row">
        Lightness
        <input
          type="range"
          min={4}
          max={96}
          value={Math.round(l)}
          aria-label="Lightness"
          className="avatar-mixer-slider"
          style={{ background: `linear-gradient(to right, #14161f, ${hueHex}, #fdfaf2)` }}
          onChange={(event) => onChange(hslToHex(h, s, Number(event.target.value)))}
        />
      </label>
      <label className="avatar-mixer-row avatar-mixer-hex">
        Hex
        <input
          type="text"
          name={`${name}-hex`}
          value={hexDraft}
          maxLength={7}
          spellCheck={false}
          aria-label="Exact hex color"
          onChange={(event) => {
            setHexDraft(event.target.value);
            const parsed = normalizeCustomColor(event.target.value);
            if (parsed) onChange(parsed);
          }}
        />
      </label>
    </div>
  );
}

/**
 * One row of colour swatches.
 *
 * Three groups of controls need this - the body, the pack, and whichever
 * garment slot is open - and each of them has to say the same thing when a
 * colour is refused, in the same words, with the number that refused it. The
 * last swatch is the mixing desk: any colour at all, PowerPoint style, with
 * the roster staying one tap away.
 */
function ColorRow({
  name,
  offered,
  chosen,
  against,
  body,
  slot,
  onPick,
  focusFirst,
}: {
  name: string;
  offered: readonly AvatarSwatch[];
  chosen: AvatarColorValue;
  /** What a refusal is measured against, in words, for the screen reader. */
  against: string;
  body: AvatarColorValue;
  slot: ColorSlot;
  onPick: (id: AvatarColorValue) => void;
  focusFirst?: React.RefObject<HTMLInputElement | null>;
}) {
  const custom = isCustomColor(chosen) ? chosen : null;
  return (
    <>
      <div className="avatar-swatches">
        {offered.map((entry, index) => {
          const rejection = colorRejection(slot, entry.id, body);
          return (
            <label
              key={entry.id}
              className={rejection ? "avatar-option refused" : "avatar-option"}
            >
              <input
                {...(index === 0 && focusFirst ? { ref: focusFirst } : {})}
                type="radio"
                name={name}
                checked={chosen === entry.id}
                disabled={Boolean(rejection)}
                aria-label={
                  rejection
                    ? `${entry.label}, unavailable, ${ratioLabel(rejection.ratio)} against ${against}`
                    : entry.label
                }
                onChange={() => onPick(entry.id)}
              />
              <span className="avatar-swatch" style={{ background: entry.hex }} />
              <small>{entry.label}</small>
            </label>
          );
        })}
        <label className="avatar-option">
          <input
            type="radio"
            name={name}
            checked={custom !== null}
            aria-label="Mix your own color"
            onChange={() =>
              onPick(
                custom ??
                  normalizeCustomColor(avatarColor(chosen)) ??
                  ("#7963df" as CustomAvatarColor),
              )
            }
          />
          <span
            className="avatar-swatch avatar-swatch-custom"
            style={custom ? { background: custom } : undefined}
          />
          <small>Mix…</small>
        </label>
      </div>
      {custom && <CustomColorMixer name={name} value={custom} onChange={onPick} />}
    </>
  );
}

/**
 * The wardrobe, with every slot and every garment in it.
 *
 * Store-free on purpose: the Next app and the Portals edition keep the chosen
 * runner in different places, and a panel that reached into one of them could
 * only ever work in that one. Everything it needs arrives as a prop.
 *
 * Ten slots would make twelve stacked groups of controls and a panel you scroll
 * to the bottom of to find out what is in it, so the slots are a strip of chips
 * and one slot's contents show at a time. Each chip carries what is currently in
 * its slot, which is also how the whole outfit stays readable at a glance while
 * you work on one part of it.
 */
export function WardrobePanel({
  avatar,
  avatarSeed = 1,
  previewEnabled = true,
  onSave,
  onClose,
}: {
  avatar: AvatarConfig | null;
  avatarSeed?: number;
  /** Graphics-safe fallback used by embedded hosts that reject preview setup. */
  previewEnabled?: boolean;
  onSave: (config: AvatarConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AvatarConfig>(() =>
    avatar ? normalizeAvatar(avatar) : DEFAULT_AVATAR,
  );
  const [openSlot, setOpenSlot] = useState<WardrobeSlotId>("headwear");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const [outfitCodeDraft, setOutfitCodeDraft] = useState("");
  const [outfitNotice, setOutfitNotice] = useState("");
  const firstControl = useRef<HTMLInputElement>(null);

  const applyOutfitCode = useCallback(() => {
    const parsed = avatarFromCode(outfitCodeDraft.trim());
    if (!parsed) {
      setOutfitNotice("That is not a complete outfit code.");
      return;
    }
    setDraft(parsed);
    setOutfitCodeDraft("");
    setOutfitNotice("Outfit on. Save it if it is a keeper.");
  }, [outfitCodeDraft]);

  const copyOutfitCode = useCallback(async () => {
    const code = avatarToCode(draft);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(code);
      setOutfitNotice("Outfit code copied. Send it to a friend.");
    } catch {
      // The processed Portals iframe denies the async clipboard; the
      // selection command rides the click gesture instead of a permission.
      const scratch = document.createElement("textarea");
      scratch.value = code;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      scratch.remove();
      setOutfitNotice(
        copied ? "Outfit code copied. Send it to a friend." : `Copy this code: ${code}`,
      );
    }
  }, [draft]);

  useEffect(() => {
    // Portals may have just unmounted the gameplay canvas. Give its WebGL
    // context a beat to return to the browser before asking for the preview's
    // context; embedded Chromium is much stricter about simultaneous contexts.
    const previewTimer = previewEnabled
      ? window.setTimeout(() => setPreviewReady(true), 180)
      : null;
    firstControl.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      window.removeEventListener("keydown", key);
    };
  }, [onClose, previewEnabled]);


  const chooseBody = useCallback((body: AvatarColorValue) => {
    setDraft((current) => ({ ...current, body }));
  }, []);

  const chooseItem = useCallback((slotId: WardrobeSlotId, optionId: string) => {
    const result = applyWardrobeSelection(draft, slotId, optionId);
    setDraft(result.config);
    if (result.cleared.length === 0) {
      setSelectionNotice("");
      return;
    }
    const labels = result.cleared.map(
      (cleared) => WARDROBE_SLOTS.find((entry) => entry.id === cleared)!.label.toLowerCase(),
    );
    setSelectionNotice(
      `Removed ${labels.join(" and ")} so the new item stays completely visible.`,
    );
  }, [draft]);

  const slot = WARDROBE_SLOTS.find((entry) => entry.id === openSlot)!;
  const bodyReading = deckContrast(avatarColor(draft.body));
  const colorKey = slot.colorKey;
  const bodyColor = avatarColor(draft.body);
  const wornItems = WARDROBE_SLOTS.flatMap((entry) => {
    const worn = entry.options.find((option) => option.id === draft[entry.id]);
    return worn && worn.id !== "none" ? [`${entry.label}: ${worn.label}`] : [];
  });

  return (
    <div className="modal-backdrop avatar-wardrobe-backdrop">
      <section
        className="panel avatar-panel"
        // The panel's implicit grid row is auto-sized, so it grows to the full
        // height of the controls and overflows the max-height rather than
        // scrolling inside it - which put the bottom of the wardrobe, and the
        // button that saves it, off the bottom of a laptop screen. A single
        // shrinkable row hands the overflow back to the column that has an
        // overflow-y rule waiting for it.
        style={{ gridTemplateRows: "minmax(0, 1fr)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-title"
      >
          {/* Keep the course-like preview ground as useful visual context, but
              never use it to restrict the player's colour choices. */}
        <div className="avatar-stage" style={{ background: bodyReading.worstDeck }}>
          {previewEnabled ? (
            <RunnerPreviewBoundary>
              {previewReady ? (
                <RunnerStage avatar={draft} avatarSeed={avatarSeed} />
              ) : (
                <div className="avatar-preview-loading" role="status">Loading runner preview…</div>
              )}
            </RunnerPreviewBoundary>
          ) : (
            <div
              className="avatar-preview-safe"
              role="img"
              aria-label={`Runner preview. ${wornItems.join(", ") || "No clothing selected"}.`}
            >
              <div
                className="avatar-safe-runner"
                style={{ "--runner-color": bodyColor } as CSSProperties}
                aria-hidden="true"
              >
                <i className="avatar-safe-head" />
                <i className="avatar-safe-body" />
                <i className="avatar-safe-arm left" />
                <i className="avatar-safe-arm right" />
                <i className="avatar-safe-leg left" />
                <i className="avatar-safe-leg right" />
              </div>
              <b>Your runner</b>
              <div className="avatar-safe-outfit" aria-hidden="true">
                {wornItems.length > 0
                  ? wornItems.map((item) => <small key={item}>{item}</small>)
                  : <small>No clothing selected</small>}
              </div>
            </div>
          )}
          {previewEnabled && <small className="avatar-turn-hint">Drag or use arrow keys to turn them</small>}
        </div>
        {/* A grid item defaults to min-height:auto, which is tall enough for
            all ten slots' worth of controls and drags the row - and with it
            the stage beside it - past the panel's own max-height. Letting this
            column shrink is what puts its overflow-y back in charge.

            The column is then split in two, and the commit control moves out
            of the scrolling half. Choosing a garment injects a row of colour
            swatches above it, and while the buttons were the last things in
            one long scroller that row pushed them DOWN - far enough that a
            click already aimed at "This one is mine" landed on a swatch
            instead. It happened to a player mid-session. Pinning the footer to
            a row of its own means nothing above it can move it, whether or not
            the controls happen to overflow on that screen. */}
        <div
          className="avatar-controls"
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "minmax(0, 1fr) auto",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowY: "auto", paddingRight: 4 }}>
          <div className="panel-kicker">THIS ONE IS YOURS</div>
          <h2 id="avatar-title">Build your runner</h2>
          <p className="avatar-lede">
            Whoever you send this to plays as your runner. Ten slots and{" "}
            {WARDROBE_ITEM_COUNT} garments, all of them on the figure beside you
            as you pick them.
          </p>

          <fieldset className="avatar-group">
            <legend>Body / skin</legend>
            <ColorRow
              name="avatar-body"
              offered={AVATAR_COLORS}
              chosen={draft.body}
              against="the floor"
              body={draft.body}
              slot="body"
              onPick={chooseBody}
              focusFirst={firstControl}
            />
          </fieldset>

          <fieldset className="avatar-group">
            <legend>Wardrobe</legend>
            <div className="avatar-chips">
              {WARDROBE_SLOTS.map((entry) => {
                const worn = entry.options.find((option) => option.id === draft[entry.id])!;
                return (
                  <label key={entry.id} className="avatar-option chip">
                    <input
                      type="radio"
                      name="avatar-slot"
                      checked={openSlot === entry.id}
                      aria-label={`${entry.label}, ${entry.options.length - 1} to choose from, currently ${worn.label.toLowerCase()}`}
                      onChange={() => setOpenSlot(entry.id)}
                    />
                    <span>
                      {entry.label}: {worn.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="avatar-group">
            <legend>{slot.label}</legend>
            <div className="avatar-chips">
              {slot.options.map((option) => (
                <label key={option.id} className="avatar-option chip">
                  <input
                    type="radio"
                    name={`avatar-${slot.id}`}
                    checked={draft[slot.id] === option.id}
                    onChange={() => chooseItem(slot.id, option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="avatar-compatibility-note" role="status" aria-live="polite">
              {selectionNotice}
            </p>
            <p className="avatar-note">{slot.note}</p>
            {colorKey && isSlotFilled(draft, slot.id) && (
              <ColorRow
                name={`avatar-${slot.id}-color`}
                offered={AVATAR_COLORS}
                chosen={draft.colors[colorKey]}
                against="the floor"
                body={draft.body}
                slot={colorKey}
                onPick={(color) =>
                  setDraft((current) => ({
                    ...current,
                    colors: { ...current.colors, [colorKey]: color },
                  }))
                }
              />
            )}
          </fieldset>
          </div>
          {/* Opaque rather than the panel's own translucent fill, so the
              controls scroll under the footer instead of through it. */}
          <div
            style={{
              display: "grid",
              paddingTop: 12,
              background: "var(--cream)",
            }}
          >
            <button
              className="button primary huge"
              style={{ width: "100%" }}
              disabled={!isReadableAvatar(draft)}
              onClick={() => onSave(draft)}
            >
              ✅ This one is mine
            </button>
            <button
              type="button"
              className="button secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => setDraft(randomAvatar())}
            >
              🎲 Randomize
            </button>
            {/* Outfits travel the same way maps do: a paste-safe code, because
                the processed Portals iframe blocks both native prompts and the
                async clipboard read. Copy uses the same select-and-execCommand
                fallback the map code path relies on. */}
            <div className="avatar-outfit-code-row">
              <input
                value={outfitCodeDraft}
                placeholder="Paste an outfit code"
                aria-label="Outfit code"
                maxLength={140}
                spellCheck={false}
                onChange={(event) => setOutfitCodeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyOutfitCode();
                }}
              />
              <button type="button" className="button secondary" onClick={applyOutfitCode}>
                📥 Wear it
              </button>
            </div>
            <button
              type="button"
              className="button secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => void copyOutfitCode()}
            >
              📋 Copy outfit code
            </button>
            <p className="portals-notice" role="status" aria-live="polite">
              {outfitNotice}
            </p>
            <button className="text-button" onClick={onClose}>✖ Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}
