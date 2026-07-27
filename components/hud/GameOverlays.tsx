"use client";
import Link from "next/link";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { validatePlacement } from "@/lib/game/placement";
import type {
  ChallengeDTO,
  PublishChildResult,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { TrapIcon } from "@/components/icons/TrapIcon";
export function ChallengeIntro({
  challenge,
  onStart,
  onSettings,
  assetsReady = true,
}: {
  challenge: ChallengeDTO;
  onStart(): void;
  onSettings(): void;
  assetsReady?: boolean;
}) {
  const newest = challenge.addedTrap;
  const survival =
    challenge.stats.survivalRate === null
      ? "No survival data yet"
      : `${Math.round(challenge.stats.survivalRate * 100)}% survive`;
  return (
    <div className="modal-backdrop intro-backdrop">
      <section className="panel intro-panel">
        <div className="brand-lockup">
          <span>MAKE IT</span>
          <strong>WORSE</strong>
        </div>
        <div className="panel-kicker">CHAIN DEPTH {challenge.depth}</div>
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
          {challenge.stats.attempts} attempts <span /> {survival}
          {challenge.isDemo && challenge.stats.attempts > 0 ? (
            <small> demo data</small>
          ) : null}
        </p>
        <button
          className="button primary huge"
          onClick={onStart}
          disabled={!assetsReady}
        >
          {!assetsReady
            ? "Loading the apartment…"
            : newest
              ? "Beat their version"
              : "Beat it. Add the first problem."}
        </button>
        <div className="intro-footer">
          <span>WASD / arrows · Space jump · hold E grab / release shove · R reset</span>
          <button className="text-button" onClick={onSettings}>
            Settings
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
  return (
    <header className="game-hud">
      <div className="hud-pill timer">{formatTime(elapsedMs)}</div>
      <div className="hud-pill depth">DISASTER {depth}</div>
      <div className="hud-actions">
        <button aria-label="Reset attempt" onClick={onReset}>
          ↻
        </button>
        <button aria-label="Pause" onClick={onPause}>
          Ⅱ
        </button>
        <button aria-label="Settings" onClick={onSettings}>
          ⚙
        </button>
      </div>
    </header>
  );
}
export function FailureCard({
  message,
  attempts,
  onRetry,
  onShareClip,
}: {
  message: string;
  attempts: number;
  onRetry(): void;
  onShareClip?: () => void;
}) {
  const stamp = /void|fell/i.test(message)
    ? "FELL OUT"
    : /time/i.test(message)
      ? "TOO SLOW"
      : /reset/i.test(message)
        ? "RESET"
        : "BONKED";
  return (
    <div className="modal-backdrop">
      <section className="panel result-panel failure">
        <div className="impact-stamp">{stamp}</div>
        <h2>{message}</h2>
        <p>Attempt {attempts}. The apartment remains smug.</p>
        <button className="button danger huge" onClick={onRetry}>
          Try again
        </button>
        {onShareClip && (
          <button className="button secondary" onClick={onShareClip}>
            Share the last 10 seconds
          </button>
        )}
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
}: {
  elapsedMs: number;
  onContinue(): void;
  onShareClip?: () => void;
  onShareFinal?: () => void;
  terminal?: boolean;
}) {
  return (
    <div className="modal-backdrop confetti">
      <div className="confetti-burst" aria-hidden="true">
        {Array.from({ length: 64 }, (_, index) => (
          <i key={index} style={{ "--piece": index } as React.CSSProperties} />
        ))}
      </div>
      <section className="panel result-panel finish">
        <div className="panel-kicker">IMPOSSIBLY</div>
        <h2>YOU SURVIVED</h2>
        <div className="finish-time">{formatTime(elapsedMs)}</div>
        <p>
          {terminal
            ? "You finished the maximum-depth disaster. This chain is legend now."
            : "Now collect your deeply irresponsible reward."}
        </p>
        <button className="button primary huge" onClick={onContinue}>
          {terminal ? "Start a new disaster" : "Make it worse"}
        </button>
        {terminal && onShareFinal && (
          <button className="button secondary" onClick={onShareFinal}>
            Share the final form
          </button>
        )}
        {onShareClip && (
          <button className="button secondary" onClick={onShareClip}>
            Share the winning clip
          </button>
        )}
      </section>
    </div>
  );
}
export function TrapChoicePanel({
  choices,
  onSelect,
}: {
  choices: readonly [TrapType, TrapType, TrapType];
  onSelect(type: TrapType): void;
}) {
  return (
    <div className="modal-backdrop choice-backdrop">
      <section className="panel choice-panel">
        <div className="panel-kicker">YOUR REWARD</div>
        <h2>Make it worse. Pick one.</h2>
        <div className="trap-grid">
          {choices.map((type) => {
            const item = TRAP_CATALOG[type];
            return (
              <button
                key={type}
                className="trap-card"
                onClick={() => onSelect(type)}
              >
                <TrapIcon type={type} />
                <span className="category">{item.category}</span>
                <strong>{item.displayName}</strong>
                <p>{item.shortDescription}</p>
                <span className="choose">Choose this menace →</span>
              </button>
            );
          })}
        </div>
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
  const result = validatePlacement(placement, challenge.traps);
  return (
    <aside className="panel placement-panel">
      <div className="panel-kicker">PUT IT SOMEWHERE TERRIBLE</div>
      <h2>{TRAP_CATALOG[placement.type].displayName}</h2>
      <p className={result.valid ? "validation valid" : "validation invalid"}>
        {result.valid ? "✓ Valid placement" : `! ${result.message}`}
      </p>
      <div className="placement-actions">
        <button
          className="button secondary"
          onClick={() => onRotate(-1)}
          aria-label="Rotate left"
        >
          ↶ Rotate
        </button>
        <button
          className="button secondary"
          onClick={() => onRotate(1)}
          aria-label="Rotate right"
        >
          Rotate ↷
        </button>
      </div>
      <button
        className="button primary"
        disabled={!result.valid || publishing}
        onClick={onConfirm}
      >
        {publishing ? "Making it worse…" : "Add this trap"}
      </button>
      <button className="text-button" onClick={onBack}>
        Pick a different trap
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
            <h2>You made it {result.estimatedWorsePercent}% worse.</h2>
            <p>
              Your {TRAP_CATALOG[trap.type].displayName.toLowerCase()} is now
              part of the chain.
            </p>
          </div>
        </div>
        <textarea readOnly value={copy} aria-label="Share message" />
        <div className="share-actions">
          <button className="button danger huge" onClick={onSend}>
            Send to a friend
          </button>
          <button className="button secondary" onClick={onCopy}>
            Copy challenge link
          </button>
          <button className="button secondary" onClick={onPlay}>
            Play your version
          </button>
          <Link className="text-button" href="/">
            Back to home
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
        <input
          className="sr-only"
          readOnly
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
        <button className="button primary" onClick={onResume}>
          Resume
        </button>
        <button className="button secondary" onClick={onHome}>
          Quit to home
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
        <button className="button primary" onClick={onRetry}>
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
