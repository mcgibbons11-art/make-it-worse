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
  colorRejection,
  deckContrast,
  isReadableAvatar,
  isSlotFilled,
  normalizeAvatar,
  randomAvatar,
} from "@/lib/game/avatar";
import type {
  AvatarColorId,
  AvatarConfig,
  AvatarSwatch,
  ColorSlot,
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

/**
 * One row of colour swatches.
 *
 * Three groups of controls need this - the body, the pack, and whichever
 * garment slot is open - and each of them has to say the same thing when a
 * colour is refused, in the same words, with the number that refused it.
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
  chosen: AvatarColorId;
  /** What a refusal is measured against, in words, for the screen reader. */
  against: string;
  body: AvatarColorId;
  slot: ColorSlot;
  onPick: (id: AvatarColorId) => void;
  focusFirst?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
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
    </div>
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
  const firstControl = useRef<HTMLInputElement>(null);

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


  const chooseBody = useCallback((body: AvatarColorId) => {
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
  const bodyReading = deckContrast(AVATAR_COLORS.find((e) => e.id === draft.body)!.hex);
  const colorKey = slot.colorKey;
  const bodyColor = AVATAR_COLORS.find((entry) => entry.id === draft.body)!.hex;
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
            <button className="text-button" onClick={onClose}>✖ Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}
