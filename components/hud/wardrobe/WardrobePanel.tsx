"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  AVATAR_COLORS,
  DEFAULT_AVATAR,
  WARDROBE_SLOTS,
  colorRejection,
  deckContrast,
  isReadableAvatar,
  isSlotFilled,
  normalizeAvatar,
  usableColors,
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
            Retry preview
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
            <span className="avatar-swatch" style={{ background: entry.hex }}>
              {rejection && <em aria-hidden="true">{ratioLabel(rejection.ratio)}</em>}
            </span>
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
 * Nine slots would make eleven stacked groups of controls and a panel you scroll
 * to the bottom of to find out what is in it, so the slots are a strip of chips
 * and one slot's contents show at a time. Each chip carries what is currently in
 * its slot, which is also how the whole outfit stays readable at a glance while
 * you work on one part of it.
 */
export function WardrobePanel({
  avatar,
  avatarSeed = 1,
  onSave,
  onClose,
}: {
  avatar: AvatarConfig | null;
  avatarSeed?: number;
  onSave: (config: AvatarConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AvatarConfig>(() =>
    avatar ? normalizeAvatar(avatar) : DEFAULT_AVATAR,
  );
  const [openSlot, setOpenSlot] = useState<WardrobeSlotId>("headwear");
  const [previewReady, setPreviewReady] = useState(false);
  const firstControl = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Portals may have just unmounted the gameplay canvas. Give its WebGL
    // context a beat to return to the browser before asking for the preview's
    // context; embedded Chromium is much stricter about simultaneous contexts.
    const previewTimer = window.setTimeout(() => setPreviewReady(true), 180);
    firstControl.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(previewTimer);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);


  const chooseBody = useCallback((body: AvatarColorId) => {
    setDraft((current) => ({ ...current, body }));
  }, []);

  const slot = WARDROBE_SLOTS.find((entry) => entry.id === openSlot)!;
  const bodyReading = deckContrast(AVATAR_COLORS.find((e) => e.id === draft.body)!.hex);
  const colorKey = slot.colorKey;

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
        {/* Stood on the exact deck colour that hides runners best, so the
            measured ratio below it is something you can also just look at. */}
        <div className="avatar-stage" style={{ background: bodyReading.worstDeck }}>
          <RunnerPreviewBoundary>
            {previewReady ? (
              <RunnerStage avatar={draft} avatarSeed={avatarSeed} />
            ) : (
              <div className="avatar-preview-loading" role="status">Loading runner preview…</div>
            )}
          </RunnerPreviewBoundary>
          <small className="avatar-turn-hint">Drag the runner to turn them</small>
          <p className="avatar-reading">
            {ratioLabel(bodyReading.min)} against the palest floor
          </p>
        </div>
        {/* A grid item defaults to min-height:auto, which is tall enough for
            all nine slots' worth of controls and drags the row - and with it
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
            Whoever you send this to plays as your runner. Nine slots and{" "}
            {WARDROBE_ITEM_COUNT} garments, all of them on the figure beside you
            as you pick them.
          </p>

          <fieldset className="avatar-group">
            <legend>Body</legend>
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
            <p className="avatar-note">
              The floor is a pale wash of each platform&apos;s colour. Anything
              under {ratioLabel(3)} against it disappears while you are running.
            </p>
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
                    onChange={() =>
                      // The value came out of this slot's own option list, so
                      // the cast restores what indexing by a slot id had to
                      // widen away. Same argument avatarFromCode makes.
                      setDraft((current) => ({
                        ...current,
                        [slot.id]: option.id,
                      }) as AvatarConfig)
                    }
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="avatar-note">{slot.note}</p>
            {colorKey && isSlotFilled(draft, slot.id) && (
              // Only the colours this slot can legibly take, unlike the body
              // above, which shows its refusals with the ratio that caused
              // them. The rule is worth showing once; showing it again in all
              // seven garment slots would just be seven dead swatches.
              <ColorRow
                name={`avatar-${slot.id}-color`}
                offered={usableColors(colorKey, draft.body)}
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
              This one is mine
            </button>
            <button className="text-button" onClick={onClose}>
              {avatar ? "Cancel" : "Keep the stock runner"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
