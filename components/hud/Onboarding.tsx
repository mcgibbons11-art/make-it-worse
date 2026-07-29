"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getInput } from "@/lib/game/input";
import {
  markJumped,
  markMoved,
  markToured,
  updateCoachMemory,
  useCoachMemory,
} from "@/lib/game/coaching";
import type { GamePhase } from "@/lib/game/types";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * The teaching layer's first half: what a player is told before they have done
 * anything, and the reference they can come back to.
 *
 * Two rules shape everything here. Nothing waits for the player, and nothing
 * repeats. The tour is three lines and a checklist that ticks itself off as the
 * player plays the real level, so an experienced player finishes it without
 * noticing and a new one is never asked to read ahead of the thing being
 * explained. Both halves are skippable in one click, and skipping is permanent.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): readonly HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/**
 * A modal that behaves like one: focus moves in on open, Tab cycles inside it,
 * Escape and the backdrop close it, and focus returns to whatever opened it.
 *
 * The Escape listener runs in the capture phase and stops propagation, because
 * both editions keep their own window-level Escape handler for pausing, and an
 * Escape meant for this dialog must not also resume the run behind it.
 */
export function HelpDialog({
  kicker,
  title,
  className,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  className: string;
  onClose(): void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables(panel.current)[0];
    if (first) first.focus();
    else panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      opener.current?.focus();
    };
  }, [onClose]);

  const trap = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop onboard-dialog-backdrop"
      onKeyDown={trap}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className={`panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="onboard-dialog-kicker">{kicker}</div>
        <h2 id={titleId}>{title}</h2>
        {children}
        <button className="button primary" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}

/** Every binding that is true in both editions, in the order a player needs them. */
const CONTROLS: readonly {
  keys: readonly string[];
  label: string;
  note?: string;
}[] = [
  { keys: ["W", "A", "S", "D"], label: "Move", note: "The arrow keys do the same." },
  { keys: ["Space"], label: "Jump" },
  {
    keys: ["E"],
    label: "Grab, then shove",
    note: "Hold E to grab a loose object you are facing. Let go and the runner shoves it forward.",
  },
  {
    keys: ["R"],
    label: "Restart the attempt",
    note: "Instant, and the game stamps it RESET rather than blaming you for a fall. A run that has already gone wrong costs you seconds instead of a minute.",
  },
  { keys: ["Esc"], label: "Pause" },
  { keys: ["M"], label: "Mute" },
];

const ROTATE_ROW = {
  keys: ["Q", "E"],
  label: "Turn the trap you are placing",
  note: "The placement card carries the same two turns as buttons.",
} as const;

/**
 * The controls, reachable at any time rather than only from the title screen.
 *
 * Self-contained on the same principle as the runner picker: it renders its own
 * launcher, so a host adds one element and gets both. The launcher hides itself
 * while the run is live, where nobody is reading and the corner is wanted for
 * the game.
 *
 * The two flags are capability, not taste. Q and E only turn a trap in the Next
 * edition, and the on-screen pad only exists where MobileControls is mounted, so
 * a host that does not have them must not be made to claim them.
 */
export function ControlsReference({
  phase,
  rotateKeys = false,
  touchControls = false,
}: {
  phase: GamePhase;
  rotateKeys?: boolean;
  touchControls?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const busy =
    phase === "booting" ||
    phase === "playing" ||
    phase === "placing_trap" ||
    phase === "publishing";
  const rows = rotateKeys ? [...CONTROLS, ROTATE_ROW] : CONTROLS;
  return (
    <>
      {/* Stays mounted while its own dialog is open. Unmounting it left the
          dialog with nothing to hand focus back to on close, so closing dropped
          a keyboard user onto the document body. */}
      {!busy && (
        <button className="onboard-launcher" onClick={() => setOpen(true)}>
          <span className="onboard-launcher-mark" aria-hidden="true">
            ?
          </span>
          Controls
        </button>
      )}
      {open && (
        <HelpDialog
          kicker="EVERY KEY, ALL THE TIME"
          title="Controls"
          className="onboard-dialog"
          onClose={close}
        >
          <p className="onboard-lede">
            Beat the level, add one trap to it, send it on. That is the whole game.
          </p>
          <dl className="onboard-rows">
            {rows.map((row) => (
              <div key={row.label} className="onboard-row">
                <dt>
                  {row.keys.map((key) => (
                    <kbd key={key} className="onboard-key">
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd>
                  <strong>{row.label}</strong>
                  {row.note ? <span>{row.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          {touchControls && (
            <p className="onboard-note">
              On a touch screen the same three live at the bottom of the run: drag
              the left pad to move, JUMP and GRAB on the right.
            </p>
          )}
        </HelpDialog>
      )}
    </>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span className={done ? "onboard-tick is-done" : "onboard-tick"}>
      <span aria-hidden="true">{done ? "✓" : "○"}</span>
      <span className="sr-only">{done ? "Done. " : "To do. "}</span>
    </span>
  );
}

/**
 * The first run, taught by running it.
 *
 * The intro card is three lines about the loop, because the one thing a player
 * cannot discover by playing is that clearing the level earns them the right to
 * add to it. Everything after that is the player's own hands: the checklist
 * watches the real input singleton and ticks itself off, so the game never asks
 * anyone to read an instruction for a thing they have already done.
 *
 * `suppressed` exists for one real collision: the Next edition opens its runner
 * picker over the same intro, and two first-run cards at once is worse than
 * either alone.
 */
export function FirstRunTour({
  phase,
  suppressed = false,
}: {
  phase: GamePhase;
  suppressed?: boolean;
}) {
  const memory = useCoachMemory();
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);
  const [introDismissed, setIntroDismissed] = useState(false);
  const { moved, jumped, toured } = memory;

  // Poll the input singleton the runner itself reads, so "you have jumped" means
  // a jump the game acted on rather than a key this component happened to see.
  useEffect(() => {
    if (phase !== "playing" || toured || (moved && jumped)) return;
    const jumpBase = getInput().jumpPressSequence;
    const timer = window.setInterval(() => {
      const input = getInput();
      if (input.x !== 0 || input.z !== 0) updateCoachMemory(markMoved);
      if (input.jumpPressSequence > jumpBase) updateCoachMemory(markJumped);
    }, 150);
    return () => window.clearInterval(timer);
  }, [jumped, moved, phase, toured]);

  // Clearing the level is the proof. Whatever is still unticked, a player who
  // has reached the exit does not need a checklist about reaching the exit.
  useEffect(() => {
    if (phase === "finished") updateCoachMemory(markToured);
  }, [phase]);

  const skip = () => updateCoachMemory(markToured);
  if (toured || suppressed) return null;

  const cardClass = reducedMotion ? "onboard-card is-still" : "onboard-card";

  if (phase === "intro" && !introDismissed)
    return (
      // `is-intro` moves the card to the top edge, where there is no HUD to
      // clear, and caps its height so it can never cover the panel behind it by
      // more than its own top padding on the shortest screens.
      <aside className={`${cardClass} is-intro`}>
        <div className="onboard-kicker">HOW THIS WORKS</div>
        <ol className="onboard-loop">
          <li>Beat this level.</li>
          <li>Add one awful thing to it.</li>
          <li>Send it on. They beat yours, then add one more.</li>
        </ol>
        {/* The keys belong here, at the intro, because the checklist below is
            the only other place that names them and it does so while the sixty
            second attempt clock is already running: a first attempt spent 24 of
            its 60 seconds being read rather than played. Nothing about the
            checklist changes - it still ticks itself off from real input - but
            a player who has met the keys once arrives recognising it instead of
            having to stop and study it. */}
        <p className="onboard-note">
          <kbd className="onboard-key">W</kbd>
          <kbd className="onboard-key">A</kbd>
          <kbd className="onboard-key">S</kbd>
          <kbd className="onboard-key">D</kbd> to move,{" "}
          <kbd className="onboard-key">Space</kbd> to jump. Reach the green door.
        </p>
        <div className="onboard-actions">
          <button className="onboard-chip" onClick={() => setIntroDismissed(true)}>
            Got it
          </button>
          <button className="onboard-skip" onClick={skip}>
            Skip all tips
          </button>
        </div>
      </aside>
    );

  if (phase !== "playing") return null;

  return (
    <aside className={cardClass}>
      <div className="onboard-kicker">YOUR FIRST RUN</div>
      <ul className="onboard-steps" aria-live="polite">
        <li className={moved ? "onboard-step is-done" : "onboard-step"}>
          <Tick done={moved} />
          Move with W A S D or the arrow keys
        </li>
        <li className={jumped ? "onboard-step is-done" : "onboard-step"}>
          <Tick done={jumped} />
          Jump with Space
        </li>
        <li className="onboard-step">
          <Tick done={false} />
          Reach the green door at the far end
        </li>
      </ul>
      <button className="onboard-skip" onClick={skip}>
        Skip all tips
      </button>
    </aside>
  );
}
