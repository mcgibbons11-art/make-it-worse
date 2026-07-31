"use client";
import { useEffect } from "react";
import { formatTime } from "@/components/hud/GameOverlays";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import {
  lockedTraps,
  personalBest,
  topDeathCauses,
  totalRuns,
  type DeathCause,
  type RunSummary,
} from "@/lib/game/progression";
import { useProgressionStore } from "@/stores/progression-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Reading the ledger has to wait for the browser. The store starts on the
 * defaults so the server and the first client render agree, and this pulls the
 * saved copy in afterwards; every component below renders nothing until that
 * has happened, which is one frame of blank rather than a flash of "no runs
 * yet" in front of a player with two hundred.
 */
function useLedger() {
  const hydrate = useProgressionStore((state) => state.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return useProgressionStore();
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function causeLabel(cause: DeathCause): string {
  if (cause === "void") return "The void";
  if (cause === "timeout") return "The clock";
  return TRAP_CATALOG[cause].displayName;
}

/**
 * The one line worth leading with. Order is the order a player cares about: a
 * record beats a near miss, and a near miss beats a note about how far a lost
 * run got. Every branch returns null when nothing true can be said, because a
 * result screen that always finds something to celebrate teaches a player to
 * stop reading it.
 */
function headlineFor(
  summary: RunSummary,
): { kicker: string; value: string; celebrate: boolean } | null {
  if (summary.record)
    return {
      kicker: summary.record.previousMs === null ? "FIRST CLEAR" : "NEW PERSONAL BEST",
      value: formatTime(summary.record.timeMs),
      celebrate: true,
    };
  if (summary.nearRecordMs !== null)
    return {
      kicker: "YOUR RECORD HELD",
      value: `+${formatSeconds(summary.nearRecordMs)}`,
      celebrate: false,
    };
  if (summary.closeCallProgress !== null)
    return {
      kicker: "CLOSE CALL",
      value: `${Math.round(summary.closeCallProgress * 100)}%`,
      celebrate: false,
    };
  return null;
}

function notesFor(summary: RunSummary): readonly string[] {
  const notes: string[] = [];
  const improvement = summary.record?.improvementMs;
  if (improvement !== null && improvement !== undefined)
    notes.push(`${formatSeconds(improvement)} off your own record.`);
  if (summary.record && summary.record.previousMs === null)
    notes.push("That is the time to beat now.");
  if (summary.streak >= 2) notes.push(`${summary.streak} clears in a row.`);
  // Stated once, flatly, and only for a streak long enough to have been worth
  // something. No second chances to sell and no reason to hurry back.
  if (summary.streakLost !== null)
    notes.push(`That ended a run of ${summary.streakLost}.`);
  for (const type of summary.unlocked)
    notes.push(`Unlocked: ${TRAP_CATALOG[type].displayName}.`);
  return notes;
}

/**
 * The beat after a run, for the finish and failure screens.
 *
 * The wrapper is always mounted so its live region is present before the text
 * arrives, and collapses to nothing through `.prog-ribbon:empty` on a run with
 * nothing true to report, which is most of them.
 */
export function ProgressionRibbon() {
  const { lastSummary } = useLedger();
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);
  const headline = lastSummary ? headlineFor(lastSummary) : null;
  const notes = lastSummary ? notesFor(lastSummary) : [];
  return (
    <div className="prog-ribbon" role="status">
      {headline && (
        <p className="prog-lead">
          <span className="prog-kicker">{headline.kicker}</span>
          <strong>{headline.value}</strong>
          {headline.celebrate && !reducedMotion && (
            <i className="prog-flourish" aria-hidden="true" />
          )}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} className="prog-note">
          {note}
        </p>
      ))}
    </div>
  );
}

/**
 * The time to beat, in the running HUD beside the clock. A target the player
 * set themselves is the whole of the time-attack hook, and it is useless on the
 * results screen alone: it has to be visible while there is still a run to
 * spend on it.
 */
export function PersonalBestPill({ challengeSlug }: { challengeSlug: string }) {
  const { stats, hydrated } = useLedger();
  if (!hydrated) return null;
  const best = personalBest(stats, challengeSlug);
  return (
    <div
      className="hud-pill prog-pill"
      aria-label={
        best
          ? `Your best time on this challenge, ${formatTime(best.timeMs)}`
          : "No personal best on this challenge yet"
      }
    >
      {best ? `BEST ${formatTime(best.timeMs)}` : "NO BEST YET"}
    </div>
  );
}

/**
 * The ledger itself, for the intro screen.
 *
 * `challengeSlug` adds the record for the challenge in front of the player,
 * which is the one number that turns "play again" into "play this again".
 */
export function ProgressionSummary({
  challengeSlug,
}: {
  challengeSlug?: string | undefined;
}) {
  const { stats, hydrated, persistent } = useLedger();
  if (!hydrated) return null;
  const runs = totalRuns(stats);
  if (runs === 0 && stats.trapsPlaced === 0)
    return (
      <section className="panel prog-panel">
        <div className="panel-kicker">YOUR RECORD</div>
        <p className="prog-empty">
          Nothing recorded yet. Your first run opens the ledger, and it stays in this
          browser.
        </p>
      </section>
    );
  const best = challengeSlug ? personalBest(stats, challengeSlug) : null;
  const causes = topDeathCauses(stats, 3);
  const locked = lockedTraps(stats);
  return (
    <section className="panel prog-panel">
      <div className="panel-kicker">YOUR RECORD</div>
      <dl className="prog-grid">
        <div className="prog-stat">
          <dt>Runs</dt>
          <dd>{runs}</dd>
        </div>
        <div className="prog-stat">
          <dt>Survived</dt>
          <dd>{stats.clears}</dd>
        </div>
        <div className="prog-stat">
          <dt>Streak</dt>
          <dd>{stats.currentStreak}</dd>
        </div>
        <div className="prog-stat">
          <dt>Best streak</dt>
          <dd>{stats.bestStreak}</dd>
        </div>
        <div className="prog-stat">
          <dt>Deepest</dt>
          <dd>Disaster {stats.deepestClearedDepth}</dd>
        </div>
        <div className="prog-stat">
          <dt>Traps added</dt>
          <dd>{stats.trapsPlaced}</dd>
        </div>
      </dl>
      {best && (
        <p className="prog-note">
          Your best here: <strong>{formatTime(best.timeMs)}</strong> over {best.clears}{" "}
          {best.clears === 1 ? "clear" : "clears"}.
        </p>
      )}
      {causes.length > 0 && (
        <div className="prog-causes">
          <strong>What gets you</strong>
          {causes.map((entry) => (
            <span key={entry.cause}>
              {causeLabel(entry.cause)} <b>{entry.count}</b>
            </span>
          ))}
        </div>
      )}
      {locked.length === 0 ? (
        <p className="prog-note">Every trap in the game is unlocked.</p>
      ) : (
        <details className="prog-unlocks">
          <summary>
            {TRAP_TYPES.length - locked.length} of {TRAP_TYPES.length} traps unlocked
          </summary>
          <ul>
            {locked.map((entry) => (
              <li key={entry.type} className="prog-unlock">
                <strong>{TRAP_CATALOG[entry.type].displayName}</strong>
                <span className="prog-unlock-need">{entry.requirement}</span>
                <b>
                  {entry.current} / {entry.target}
                </b>
                <span className="prog-unlock-bar" aria-hidden="true">
                  <i
                    style={
                      {
                        "--prog-fill": `${Math.min(100, Math.round((entry.current / entry.target) * 100))}%`,
                      } as React.CSSProperties
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!persistent && (
        <p className="prog-note prog-warn">
          This browser will not keep the ledger, so these numbers last for the session
          only.
        </p>
      )}
    </section>
  );
}
