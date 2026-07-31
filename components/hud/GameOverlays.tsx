"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { ATTEMPT_LIMIT_MS } from "@/lib/game/constants";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { challengeTrack } from "@/lib/game/trap-choice";
import { validatePlacement } from "@/lib/game/placement";
import type {
  ChallengeDTO,
  PublishChildResult,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { AudioManager } from "@/lib/audio/AudioManager";
import { TrapIcon } from "@/components/icons/TrapIcon";
import { DeathNote, RunProgressNote } from "@/components/hud/Coach";
import {
  CONSEQUENCE_HEADLINE,
  chainDepthLine,
  challengeStatLine,
  depthPill,
} from "@/lib/game/share-copy";
/**
 * Seconds left when the timer turns warm and the countdown pill appears, and
 * the point inside that where the tick goes up a fifth. GameClient reads both
 * so the audible clock and the visible one are the same clock: a reviewer
 * playing a real build died at 00:54 to the sixty-second cap without ever
 * noticing there was a timer.
 */
export const COUNTDOWN_FROM = 10;
export const COUNTDOWN_URGENT_FROM = 3;
/**
 * Every control in this file makes the same sound before it does its work.
 * Wrapping the handler rather than the button keeps the cue on the action, so a
 * control reached by keyboard sounds exactly like one reached by pointer.
 */
function withClick<Arguments extends unknown[]>(
  action: (...args: Arguments) => void,
): (...args: Arguments) => void {
  return (...args) => {
    AudioManager.click();
    action(...args);
  };
}
export function ChallengeIntro({
  challenge,
  onStart,
  onSettings,
  playerName,
  assetsReady = true,
}: {
  challenge: ChallengeDTO;
  onStart(): void;
  onSettings(): void;
  playerName?: string | undefined;
  assetsReady?: boolean;
}) {
  const newest = challenge.addedTrap;
  const stat = challengeStatLine(challenge.stats);
  return (
    <div className="modal-backdrop intro-backdrop">
      <section className="panel intro-panel">
        <div className="brand-lockup">
          <span>MAKE IT</span>
          <strong>WORSE</strong>
        </div>
        {/* Was "CHAIN DEPTH 3", which is the internal word for it and the first
            thing a new player reads. chainDepthLine says what the number
            counts, in the same words the HUD pill uses a moment later. */}
        <div className="panel-kicker">{chainDepthLine(challenge.depth)}</div>
        <h1>
          {newest ? (
            <>
              {newest.ownerName} added {TRAP_CATALOG[newest.type].articleName}.
            </>
          ) : (
            <>
              A clean level. <em>For now.</em>
            </>
          )}
        </h1>
        <p className="stat-line">
          {stat.attempts ? (
            <>
              {stat.attempts} <span />{" "}
            </>
          ) : null}
          {stat.survival}
          {challenge.isDemo && challenge.stats.attempts > 0 ? (
            <small> demo data</small>
          ) : null}
        </p>
        <button
          className={`button primary huge${assetsReady ? " is-ready" : ""}`}
          onClick={withClick(onStart)}
          disabled={!assetsReady}
        >
          {!assetsReady
            ? "⏳ Loading the apartment…"
            : newest
              ? "🏁 Beat their version"
              : "🏁 Beat it. Add the first problem."}
        </button>
        {/* The game picks a name and then never mentions it. A reviewer met
            theirs for the first time inside the message they were about to send
            a friend, which is the one place a surprise name is expensive. */}
        {playerName && (
          <p className="intro-identity">
            Everything you add here is signed <strong>{playerName}</strong>.{" "}
            <button className="text-button" onClick={withClick(onSettings)}>
              Change the name
            </button>
          </p>
        )}
        <div className="intro-footer">
          <span>WASD / arrows · Space jump · hold E grab / release shove · R reset</span>
          <button className="text-button" onClick={withClick(onSettings)}>
            ⚙️ Settings
          </button>
        </div>
      </section>
    </div>
  );
}
export function GameHud({
  elapsedMs,
  depth,
  onReset,
  onPause,
  onSettings,
}: {
  elapsedMs: number;
  depth: number;
  onReset(): void;
  onPause(): void;
  onSettings(): void;
}) {
  // The attempt is hard-capped at ATTEMPT_LIMIT_MS by PlayerController, so the
  // last ten seconds are a real countdown rather than decoration.
  const secondsLeft = Math.max(
    0,
    Math.ceil((ATTEMPT_LIMIT_MS - elapsedMs) / 1000),
  );
  const closing = secondsLeft <= COUNTDOWN_FROM;
  return (
    <header className="game-hud">
      {/* Plays once per attempt: GameClient unmounts the whole HUD between
          runs, so a mount-time animation is the run-start beat. Resuming from
          the pause card remounts the HUD too, hence the clock check: the sting
          belongs to a fresh run, not to picking up a run already underway. */}
      {elapsedMs < 1200 && (
        <div className="run-start-sting" aria-hidden="true">
          <b>GO</b>
        </div>
      )}
      {/* Without a label these announce as a bare "00:12.34" and "DISASTER 3".
          The timer is deliberately not in a live region: it updates 20x a
          second and would talk over everything. */}
      <div
        className={`hud-pill timer${closing ? " is-warm" : ""}`}
        aria-label={`Elapsed time ${formatTime(elapsedMs)}`}
      >
        {formatTime(elapsedMs)}
      </div>
      {/* Keyed on the whole second so each tick remounts the pill and replays
          its one-shot animation. Silent to assistive tech; the single spoken
          warning below carries the same information without narrating a
          number twenty times a second. */}
      {closing && (
        <div key={secondsLeft} className="hud-pill countdown" aria-hidden="true">
          {secondsLeft}
        </div>
      )}
      {/* "DISASTER 0" on a level nobody has touched is a number counting
          nothing, and "Chain depth 3" was the internal term read aloud. */}
      <div className="hud-pill depth" aria-label={depthPill(depth).label}>
        {depthPill(depth).text}
      </div>
      <span className="sr-only" role="status">
        {secondsLeft === COUNTDOWN_FROM ? "Ten seconds left" : ""}
      </span>
      <div className="hud-actions">
        <button aria-label="Reset attempt" onClick={withClick(onReset)}>
          ↻
        </button>
        <button aria-label="Pause" onClick={withClick(onPause)}>
          Ⅱ
        </button>
        <button aria-label="Settings" onClick={withClick(onSettings)}>
          ⚙
        </button>
      </div>
    </header>
  );
}
export function FailureCard({
  message,
  attempts,
  progress,
  contact,
  onRetry,
  onShareClip,
  footer,
}: {
  message: string;
  attempts: number;
  /** How far along the course the run ended, 0 to 1. */
  progress: number;
  contact?: { trapType: TrapType; ownerName: string } | null;
  onRetry(): void;
  onShareClip?: () => void;
  footer?: React.ReactNode;
}) {
  // Order matters: "reset" and "clock" are checked before the fall, because a
  // reset message can still mention where you were when you gave up.
  const stamp = /reset/i.test(message)
    ? "RESET"
    : /clock|time/i.test(message)
      ? "TOO SLOW"
      : /void|fell/i.test(message)
        ? "FELL OUT"
        : /saved/i.test(message)
          ? "NOT SAVED"
          : "BONKED";
  return (
    <div className="modal-backdrop">
      <section className="panel result-panel failure">
        <div className="impact-stamp">{stamp}</div>
        <h2>{message}</h2>
        <p>Attempt {attempts}. The apartment remains smug.</p>
        {/* The two things a dead run can honestly tell you: how far it got, and
            what stopped it. Neither was on this card. */}
        <RunProgressNote percent={progress * 100} />
        {contact ? <DeathNote contact={contact} /> : null}
        <button className="button danger huge" onClick={withClick(onRetry)}>
          🔁 Try again
        </button>
        {onShareClip && (
          <button className="button secondary" onClick={withClick(onShareClip)}>
            🎬 Share the last 10 seconds
          </button>
        )}
        {footer}
        <small>Press Enter or tap to retry</small>
      </section>
    </div>
  );
}
export function FinishCard({
  elapsedMs,
  onContinue,
  onShareClip,
  onShareFinal,
  terminal = false,
  footer,
}: {
  elapsedMs: number;
  onContinue(): void;
  onShareClip?: () => void;
  onShareFinal?: () => void;
  terminal?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop confetti">
      <div className="confetti-burst" aria-hidden="true">
        {Array.from({ length: 64 }, (_, index) => (
          <i key={index} style={{ "--piece": index } as React.CSSProperties} />
        ))}
      </div>
      <section className="panel result-panel finish">
        <span className="finish-shine" aria-hidden="true" />
        <div className="panel-kicker">IMPOSSIBLY</div>
        <h2>YOU SURVIVED</h2>
        <div className="finish-time">{formatTime(elapsedMs)}</div>
        <p>
          {terminal
            ? "There is no room left for another disaster. This chain is legend now."
            : "Now collect your deeply irresponsible reward."}
        </p>
        <button className="button primary huge" onClick={withClick(onContinue)}>
          {terminal ? "🎲 Start a new disaster" : "🪤 Make it worse"}
        </button>
        {terminal && onShareFinal && (
          <button className="button secondary" onClick={withClick(onShareFinal)}>
            📤 Share the final form
          </button>
        )}
        {onShareClip && (
          <button className="button secondary" onClick={withClick(onShareClip)}>
            🎬 Share the winning clip
          </button>
        )}
        {footer}
      </section>
    </div>
  );
}
/**
 * `placeable` is the subset of the three offers the course still has room for.
 * The panel has no other exit, so a card that cannot be placed has to say so
 * rather than spend the player's tap on an error, and an offer sheet where
 * nothing fits has to lead somewhere.
 */
export function TrapChoicePanel({
  choices,
  placeable,
  onSelect,
  onEndChain,
}: {
  choices: readonly [TrapType, TrapType, TrapType];
  placeable: readonly TrapType[];
  onSelect(type: TrapType): void;
  onEndChain(): void;
}) {
  return (
    <div className="modal-backdrop choice-backdrop">
      <section className="panel choice-panel">
        <div className="panel-kicker">YOUR REWARD</div>
        <h2>
          {placeable.length
            ? "Make it worse. Pick one."
            : "Nowhere left to put one."}
        </h2>
        <div className="trap-grid">
          {choices.map((type, index) => {
            const item = TRAP_CATALOG[type];
            const fits = placeable.includes(type);
            return (
              <button
                key={type}
                className={`trap-card${fits ? "" : " is-blocked"}`}
                disabled={!fits}
                style={{ "--card": index } as React.CSSProperties}
                onClick={withClick(() => onSelect(type))}
              >
                <TrapIcon type={type} />
                <span className="category">{item.category}</span>
                <strong>{item.displayName}</strong>
                <p>{item.shortDescription}</p>
                <span className="choose">
                  {fits ? "Choose this menace →" : "No room left for this one"}
                </span>
              </button>
            );
          })}
        </div>
        {placeable.length === 0 && (
          <button
            className="button primary huge"
            style={{ marginTop: 18 }}
            onClick={withClick(onEndChain)}
          >
            🏁 Finish the chain here
          </button>
        )}
      </section>
    </div>
  );
}
export function PlacementPanel({
  challenge,
  placement,
  publishing,
  onRotate,
  onBack,
  onConfirm,
}: {
  challenge: ChallengeDTO;
  placement: TrapPlacementInput;
  publishing: boolean;
  onRotate(delta: -1 | 1): void;
  onBack(): void;
  onConfirm(): void;
}) {
  // Without the challenge's own track this resolves zone ids against the fixed
  // classic list, so every composed-course placement read back as "Choose a
  // highlighted placement zone" and the confirm button never enabled.
  const track = useMemo(() => challengeTrack(challenge), [challenge]);
  const result = validatePlacement(placement, challenge.traps, track);
  // The written verdict changes as the trap is dragged, and a player watching
  // the trap rather than the panel had no way to know they had just crossed out
  // of a legal spot. Only the change sounds: a cue on every frame of a drag
  // would be a stutter, not feedback.
  const sounded = useRef<boolean | null>(null);
  useEffect(() => {
    if (sounded.current === result.valid) return;
    sounded.current = result.valid;
    AudioManager.placement(result.valid);
  }, [result.valid]);
  return (
    <aside className="panel placement-panel">
      <div className="panel-kicker">PUT IT SOMEWHERE TERRIBLE</div>
      <h2>{TRAP_CATALOG[placement.type].displayName}</h2>
      {/* role="status" so a non-sighted player hears validity change as they
          nudge the trap, rather than discovering the confirm button is dead. */}
      <p
        role="status"
        className={result.valid ? "validation valid" : "validation invalid"}
      >
        {result.valid ? "✓ Valid placement" : `! ${result.message}`}
      </p>
      <div className="placement-actions">
        <button
          className="button secondary"
          onClick={withClick(() => onRotate(-1))}
          aria-label="Rotate left"
        >
          ↶ Rotate
        </button>
        <button
          className="button secondary"
          onClick={withClick(() => onRotate(1))}
          aria-label="Rotate right"
        >
          Rotate ↷
        </button>
      </div>
      <button
        className="button primary"
        disabled={!result.valid || publishing}
        onClick={withClick(onConfirm)}
      >
        {publishing ? "⏳ Making it worse…" : "🪤 Add this trap"}
      </button>
      <button className="text-button" onClick={withClick(onBack)}>
        ↩️ Pick a different trap
      </button>
    </aside>
  );
}
export function SharePanel({
  result,
  copy,
  url,
  onSend,
  onCopy,
  onPlay,
}: {
  result: PublishChildResult;
  copy: string;
  url: string;
  onSend(): void;
  onCopy(): void;
  onPlay(): void;
}) {
  const trap = result.challenge.addedTrap!;
  return (
    <div className="modal-backdrop share-backdrop">
      <section className="panel share-panel">
        <div className="share-hero">
          <TrapIcon type={trap.type} />
          <div>
            <div className="panel-kicker">THE CONSEQUENCE</div>
            {/* The headline used to be the percentage, which on a shallow chain
                is a single digit. The score is real and stays, in the sentence
                it belongs to; the headline is the thing the player just did.

                There was a 0-100 meter here and it has been cut rather than
                restyled. The score is a relative drop in survival odds, and
                that drop is small early in a chain by construction: a
                mid-weight trap scores 4% at depth 0 and 13% at depth 2, and
                only passes a third of the bar around depth 5. So the meter
                spent the whole opening of the game drawing a player's
                contribution as an empty trough - the same discouragement the
                old headline gave, in a shape that could not be read. */}
            <h2>{CONSEQUENCE_HEADLINE}</h2>
            <p>
              Your {TRAP_CATALOG[trap.type].displayName.toLowerCase()} is
              disaster {result.challenge.depth} in this chain.
            </p>
            <p className="worse-caption">
              It cuts the next runner&rsquo;s chances by{" "}
              <span className="worse-number">
                {result.estimatedWorsePercent}%
              </span>
              .
            </p>
          </div>
        </div>
        <textarea readOnly value={copy} aria-label="Share message" />
        {/* Sending it on is the win, so it is the only button on this screen
            with the full width and the loud fill. Everything else is a way of
            not sending it yet. */}
        <button className="button danger huge share-send" onClick={withClick(onSend)}>
          📤 Send it to a friend
        </button>
        <div className="share-actions">
          <button className="button secondary" onClick={withClick(onCopy)}>
            📋 Copy challenge link
          </button>
          <button className="button secondary" onClick={withClick(onPlay)}>
            ▶️ Play your version
          </button>
          <Link className="text-button" href="/">
            🏠 Back to home
          </Link>
        </div>
        <div className="chain-timeline">
          <strong>Latest disasters</strong>
          {result.challenge.traps.slice(-5).map((entry) => (
            <span key={entry.id}>
              {entry.ownerName} — {TRAP_CATALOG[entry.type].displayName}
            </span>
          ))}
        </div>
        {/* Kept out of the tab order: .sr-only clips to a 1px box, so tabbing
            into it landed a sighted keyboard user on an invisible field whose
            focus ring was clipped away. */}
        <input
          className="sr-only"
          readOnly
          tabIndex={-1}
          value={url}
          aria-label="Selectable challenge URL"
        />
      </section>
    </div>
  );
}
export function PauseCard({
  onResume,
  onHome,
}: {
  onResume(): void;
  onHome(): void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="panel result-panel">
        <div className="panel-kicker">PAUSED</div>
        <h2>The chaos will wait.</h2>
        <button className="button primary" onClick={withClick(onResume)}>
          ▶️ Resume
        </button>
        <button className="button secondary" onClick={withClick(onHome)}>
          🏠 Quit to home
        </button>
      </section>
    </div>
  );
}
export function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <div className="page-shell">
      <section className="panel result-panel">
        <div className="impact-stamp">UH OH</div>
        <h1>The apartment broke character.</h1>
        <p>{message}</p>
        <button className="button primary" onClick={withClick(onRetry)}>
          Try again
        </button>
        <Link className="text-button" href="/">
          Back to home
        </Link>
      </section>
    </div>
  );
}
export function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const hundredths = Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}.${hundredths}`;
}
