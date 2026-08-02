// The 1v1 surfaces: the matchmaking popup the menu opens, and the in-match
// overlays that drive a duel once two players are seated. All decisions live
// in useDuel and the protocol; these components only render the record and
// forward clicks.

import { useState } from "react";
import type { GamePhase } from "@/lib/game/types";
import { Overlay } from "../menu/ShellPanels";
import { REACTION_EMOJI } from "./duel-protocol";
import type { DuelApi } from "./useDuel";

function inviteLabel(code: string): string {
  return `MIW-${code}`;
}

/**
 * Copy that survives the Portals editor's sandboxed preview iframe, where the
 * async clipboard API is denied outright (no clipboard-write permission is
 * ever granted). The selection-based command rides the click gesture instead
 * of a permission, so it still works there.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const done = document.execCommand("copy");
      scratch.remove();
      return done;
    } catch {
      return false;
    }
  }
}

function courseLabel(title: string | null): string {
  return title ? `🗺 ${title}` : "🎲 Clean Map";
}

/** The host's course picker: their published maps, or a random clean course. */
function CoursePicker({ duel }: { duel: DuelApi }) {
  if (duel.mapChoices.length === 0) return null;
  return (
    <label className="duel-map-pick">
      <span>Course</span>
      <select
        aria-label="Duel course"
        value={duel.courseChoice ?? ""}
        onChange={(event) => duel.chooseCourse(event.target.value || null)}
      >
        <option value="">🎲 Clean map (random each round)</option>
        {duel.mapChoices.map((map) => (
          <option key={map.versionId} value={map.versionId}>
            🗺 {map.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function clockLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Hearts({ count, max }: { count: number; max: number }) {
  return (
    <span className="duel-hearts" aria-label={`${count} of ${max} hearts left`}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} aria-hidden="true">{index < count ? "❤️" : "🖤"}</span>
      ))}
    </span>
  );
}

// Plain buttons and an Enter handler instead of <form> submission on purpose:
// the processed Portals preview runs the game in a sandboxed iframe where
// form submission is blocked outright, so a submit-based control reads as
// simply dead. onClick and onKeyDown are unaffected.
function DuelChat({ duel }: { duel: DuelApi }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    duel.sendChat(draft);
    setDraft("");
  };
  return (
    <div className="duel-chat">
      <div className="duel-chat-log" role="log" aria-label="Duel chat">
        {duel.chat.slice(-6).map((entry) => (
          <p key={entry.id} className={entry.from === "you" ? "is-you" : undefined}>
            <strong>{entry.from === "you" ? "You" : duel.opponentName}:</strong> {entry.text}
          </p>
        ))}
      </div>
      <div className="duel-chat-row">
        <input
          value={draft}
          maxLength={300}
          placeholder="Talk trash…"
          aria-label="Chat message"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
        />
        <button className="button secondary" type="button" onClick={send}>Send</button>
      </div>
      <div className="duel-reactions">
        {REACTION_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React ${emoji}`}
            onClick={() => duel.sendReaction(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function DuelFeed({ duel }: { duel: DuelApi }) {
  if (duel.feed.length === 0) return null;
  return (
    <div className="duel-feed" role="log" aria-label="Duel events">
      {duel.feed.slice(-4).map((entry) => (
        <p key={entry.id}>{entry.text}</p>
      ))}
    </div>
  );
}

/** The popup behind the ⚔️ menu button, for every pre-match stage. */
export function DuelMatchmakingPanel({
  duel,
  onBack,
}: {
  duel: DuelApi;
  onBack(): void;
}) {
  const [codeDraft, setCodeDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const stage = duel.stage;
  return (
    <>
      <div className="eyebrow">HEAD TO HEAD</div>
      <h2 id="portals-duel-title">1v1 duel</h2>
      {stage.kind === "menu" && (
        <>
          <p className="portals-lede">
            Best of three. Take turns beating the course, and every clear adds
            one awful thing for the other player.
          </p>
          <div className="portals-actions">
            {duel.rejoinableCode && (
              <button className="button primary" onClick={duel.rejoin}>
                🔁 Rejoin {inviteLabel(duel.rejoinableCode)}
              </button>
            )}
            <CoursePicker duel={duel} />
            <button className="button danger" onClick={duel.hostPrivate}>
              🔒 Host a private duel
            </button>
            <div className="duel-code-row">
              <input
                value={codeDraft}
                placeholder="MIW-XXXX"
                aria-label="Invite code"
                maxLength={12}
                onChange={(event) => setCodeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") duel.joinWithCode(codeDraft);
                }}
              />
              <button
                className="button secondary"
                type="button"
                onClick={() => duel.joinWithCode(codeDraft)}
              >
                Join
              </button>
            </div>
            <button className="button secondary" onClick={duel.enterLobby}>
              📣 Open lobby
            </button>
          </div>
        </>
      )}
      {(stage.kind === "joining" || stage.kind === "connecting") && (
        <p className="portals-lede">Connecting to Portals…</p>
      )}
      {stage.kind === "waiting" && (
        <>
          <p className="portals-lede">Send this code to your opponent:</p>
          <p className="duel-invite-code">{inviteLabel(stage.code)}</p>
          {duel.match && (
            <p className="duel-course-label">{courseLabel(duel.match.courseTitle)}</p>
          )}
          <button
            className="button primary"
            onClick={() => {
              void copyText(inviteLabel(stage.code)).then((done) =>
                setCopyState(done ? "copied" : "manual"),
              );
            }}
          >
            {copyState === "copied" ? "✓ Copied" : "📋 Copy invite code"}
          </button>
          {copyState === "manual" && (
            <p className="portals-notice" role="status">
              Copying is blocked here. Tap the code above to select it, then
              copy it yourself.
            </p>
          )}
          <p className="portals-notice" role="status">
            Waiting for an opponent to join…
          </p>
          {/* Live session facts, so a stuck hand-off is diagnosable at a
              glance instead of reading as a dead screen. */}
          <p className="duel-session-status" role="status">
            {duel.peerConnected ? "another connection is here" : "nobody else here yet"}
            {" · "}
            {duel.match
              ? `record #${duel.match.seq} · you: ${duel.mySeat ? `seat ${duel.mySeat.toUpperCase()}` : "no seat"} · opponent: ${duel.match.players.b ? "seated" : "open"}`
              : "no match record yet"}
          </p>
        </>
      )}
      {stage.kind === "lobby" && (
        <>
          <p className="portals-lede">
            Post an open challenge, or jump on someone else&rsquo;s.
          </p>
          {duel.claimFrom && (
            <div className="duel-claim-card">
              <p>Someone wants to duel you.</p>
              <div className="portals-buttons">
                <button className="button danger" onClick={duel.acceptClaim}>
                  ⚔️ Accept
                </button>
                <button className="button secondary" onClick={duel.denyClaim}>
                  Not now
                </button>
              </div>
            </div>
          )}
          {duel.pendingClaim && (
            <div className="duel-claim-card" role="status">
              <p>
                ⏳ Request sent to <strong>{duel.pendingClaim.posterName}</strong>.
              </p>
              <p className="duel-claim-countdown">
                They have <strong>{clockLabel(duel.claimSecondsLeft)}</strong> to
                answer before the request expires.
              </p>
              <button className="button secondary" onClick={duel.cancelClaim}>
                Cancel the request
              </button>
            </div>
          )}
          {duel.lobbyNotice && (
            <p className="portals-notice" role="status">{duel.lobbyNotice}</p>
          )}
          {stage.posted ? (
            <div className="duel-claim-card">
              <p>Your challenge is posted. Anyone here can claim it.</p>
              <button className="button secondary" onClick={duel.unpost}>
                Take it down
              </button>
            </div>
          ) : (
            <>
              <CoursePicker duel={duel} />
              <div className="duel-code-row">
                <input
                  value={noteDraft}
                  placeholder="Anyone want to lose? (optional note)"
                  aria-label="Lobby post note"
                  maxLength={120}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") duel.postToLobby(noteDraft);
                  }}
                />
                <button
                  className="button danger"
                  type="button"
                  onClick={() => duel.postToLobby(noteDraft)}
                >
                  Post it
                </button>
              </div>
            </>
          )}
          <div className="duel-posts">
            {duel.posts.length === 0 && (
              <p className="portals-notice">
                Nobody is looking for a duel right now. Post one.
              </p>
            )}
            {duel.posts.map((post) => (
              <button
                key={post.connId}
                className={`duel-post${post.dim ? " is-dim" : ""}`}
                // One request at a time: the pending card above owns the wait.
                disabled={duel.pendingClaim !== null}
                onClick={() => duel.claimPost(post.connId)}
              >
                <strong>{post.name}</strong>
                <span>{post.note || "wants to duel"}</span>
                <span className="duel-post-course">{courseLabel(post.courseTitle)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {stage.kind === "error" && (
        <p className="portals-notice" role="alert">{stage.message}</p>
      )}
      <div className="portals-buttons">
        {stage.kind === "lobby" ? (
          <button className="button secondary" onClick={duel.leaveLobby}>
            ← Back
          </button>
        ) : (
          <button className="button secondary" onClick={onBack}>
            {stage.kind === "menu" ? "Back" : "Cancel"}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Everything a seated duel puts on screen. It suppresses nothing itself -
 * PortalsApp hides its own result overlays while a match is live, and keeps
 * the trap picker and placement flow, which double as the worsening phase.
 */
export function DuelHud({
  duel,
  phase,
  onStartRun,
  onRetry,
  onMakeWorse,
  onHandOverUnchanged,
  onConcede,
  onLeave,
}: {
  duel: DuelApi;
  phase: GamePhase;
  onStartRun(): void;
  onRetry(): void;
  onMakeWorse(): void;
  onHandOverUnchanged(): void;
  onConcede(): void;
  onLeave(): void;
}) {
  const match = duel.match;
  if (!match || !duel.mySeat) return null;
  const mySeat = duel.mySeat;
  const turn = match.turn;
  const myScore = match.score[mySeat];
  const theirScore = match.score[mySeat === "a" ? "b" : "a"];
  const runnerBusy =
    phase === "playing" || phase === "choosing_trap" ||
    phase === "placing_trap" || phase === "publishing";
  const strip = (
    <div className="duel-strip" role="status">
      <span className="duel-strip-score">
        ROUND {match.round} · YOU {myScore}–{theirScore} {duel.opponentName.toUpperCase()}
      </span>
      <span className="duel-strip-course">{courseLabel(match.courseTitle)}</span>
      <Hearts count={turn.heartsLeft} max={match.rules.hearts} />
      {(!duel.peerConnected || duel.abandonSecondsLeft !== null) && !match.result && (
        <span className="duel-strip-warn">
          ⚠ {duel.opponentName} {duel.peerConnected ? "is not responding" : "disconnected"}
          {duel.abandonSecondsLeft !== null
            ? ` · match ends in ${duel.abandonSecondsLeft}s unless they return`
            : ""}
        </span>
      )}
    </div>
  );

  if (match.result) {
    const won = match.result.winner === mySeat;
    return (
      <Overlay labelledBy="duel-over-title">
        <div className="eyebrow">DUEL OVER</div>
        <h2 id="duel-over-title">{won ? "You took the match." : `${duel.opponentName} took the match.`}</h2>
        <p className="portals-lede">
          Final score {myScore}–{theirScore}
          {match.result.reason === "forfeit" ? " · decided on the clock" : ""}
          {match.result.reason === "left" ? " · your opponent left" : ""}
        </p>
        <DuelFeed duel={duel} />
        <DuelChat duel={duel} />
        <div className="portals-buttons">
          <button className="button danger huge" onClick={duel.requestRematch}>
            🔁 Rematch (sides swap)
          </button>
          <button className="button secondary" onClick={onLeave}>
            🏠 Leave the duel
          </button>
        </div>
      </Overlay>
    );
  }

  if (duel.myTurn) {
    if (turn.phase === "handoff" && !runnerBusy) {
      return (
        <>
          {strip}
          <Overlay labelledBy="duel-turn-title">
            <div className="eyebrow">ROUND {match.round} · TURN {turn.number}</div>
            <h2 id="duel-turn-title">Your run.</h2>
            <p className="portals-lede">
              <Hearts count={turn.heartsLeft} max={match.rules.hearts} /> Burn all
              three and the round goes to {duel.opponentName}.
            </p>
            {!duel.course && (
              <p className="portals-notice" role="status">Minting a fresh course…</p>
            )}
            <button
              className="button danger huge"
              onClick={onStartRun}
              disabled={!duel.course}
            >
              🏃 Start the run
            </button>
            <DuelFeed duel={duel} />
            <DuelChat duel={duel} />
            <div className="portals-buttons">
              <button className="button secondary" onClick={onConcede}>
                🏳️ Concede the match
              </button>
            </div>
          </Overlay>
        </>
      );
    }
    if (turn.phase === "running" && phase === "failed") {
      return (
        <>
          {strip}
          <Overlay labelledBy="duel-retry-title" className="failure-backdrop" panelClassName="portals-failure">
            <div className="impact-stamp">DOWN</div>
            <h2 id="duel-retry-title">
              {turn.heartsLeft === 1
                ? "Last heart. No pressure."
                : `${turn.heartsLeft} hearts left.`}
            </h2>
            <p className="portals-lede">
              <Hearts count={turn.heartsLeft} max={match.rules.hearts} />
            </p>
            <button className="button danger huge" onClick={onRetry}>
              🔁 Run it again
            </button>
            <div className="portals-buttons">
              <button className="button secondary" onClick={onConcede}>
                🏳️ Concede the match
              </button>
            </div>
          </Overlay>
        </>
      );
    }
    if (turn.phase === "worsening" && phase === "finished") {
      return (
        <>
          {strip}
          <Overlay labelledBy="duel-worsen-title">
            <div className="eyebrow">CLEARED IT</div>
            <h2 id="duel-worsen-title">Now make it worse.</h2>
            <p className="portals-lede">
              Add one trap. {duel.opponentName} watched your line, so put it
              where it hurts.
            </p>
            <button className="button danger huge" onClick={onMakeWorse}>
              🪤 Pick your trap
            </button>
            <div className="portals-buttons">
              <button className="button secondary" onClick={onHandOverUnchanged}>
                Hand it over unchanged
              </button>
            </div>
          </Overlay>
        </>
      );
    }
    if (turn.phase === "running" && !runnerBusy && phase !== "failed" && phase !== "finished") {
      // The record says a run is live but nothing local is: the attempt was
      // abandoned through a menu or a reload. Offer the way back in rather
      // than leaving the runner to bleed out on the turn clock.
      return (
        <>
          {strip}
          <Overlay labelledBy="duel-resume-title">
            <div className="eyebrow">ROUND {match.round} · TURN {turn.number}</div>
            <h2 id="duel-resume-title">Your run is waiting.</h2>
            <p className="portals-lede">
              <Hearts count={turn.heartsLeft} max={match.rules.hearts} />
            </p>
            <button className="button danger huge" onClick={onRetry}>
              🏃 Run it
            </button>
            <div className="portals-buttons">
              <button className="button secondary" onClick={onConcede}>
                🏳️ Concede the match
              </button>
            </div>
          </Overlay>
        </>
      );
    }
    // The runner is mid-play or mid-placement: the normal HUD owns the
    // screen and the strip rides on top.
    return strip;
  }

  // Opponent's turn.
  const waitingCopy =
    turn.phase === "handoff"
      ? `${duel.opponentName} is getting ready…`
      : turn.phase === "worsening"
        ? `${duel.opponentName} cleared it and is making it worse…`
        : null;
  return (
    <>
      {strip}
      {turn.phase === "running" ? (
        <aside className="panel duel-spectate" aria-label="Spectating">
          <p className="duel-spectate-title">
            👁 {duel.opponentName} is running
            <Hearts count={turn.heartsLeft} max={match.rules.hearts} />
          </p>
          <DuelFeed duel={duel} />
          <DuelChat duel={duel} />
        </aside>
      ) : (
        <Overlay labelledBy="duel-wait-title">
          <div className="eyebrow">ROUND {match.round} · TURN {turn.number}</div>
          <h2 id="duel-wait-title">{waitingCopy}</h2>
          <p className="portals-lede">
            {duel.forfeitClaimable
              ? "Their clock ran out."
              : `They have ${duel.deadlineSeconds}s before the round is yours to claim.`}
          </p>
          {duel.forfeitClaimable && (
            <button className="button danger huge" onClick={duel.claimTimeout}>
              ⏱ Claim the round
            </button>
          )}
          <DuelFeed duel={duel} />
          <DuelChat duel={duel} />
          <div className="portals-buttons">
            <button className="button secondary" onClick={onConcede}>
              🏳️ Concede the match
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}
