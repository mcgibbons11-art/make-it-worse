"use client";

import { useEffect, useState } from "react";
import { HelpDialog } from "@/components/hud/Onboarding";
import { TrapIcon } from "@/components/icons/TrapIcon";
import {
  chooseHint,
  noteHintShown,
  silenceHint,
  trapProfile,
  updateCoachMemory,
  useCoachMemory,
  type TrapProfile,
} from "@/lib/game/coaching";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { GamePhase, TrapType } from "@/lib/game/types";

/**
 * The teaching layer's second half: what the game says once it has watched the
 * player, and what the player can ask it.
 *
 * The asked-for parts carry no timer and no unread badge, because a player who
 * wants to know what a trap does is already looking for the button. The offered
 * part is the opposite: every hint needs the player to have demonstrated the gap
 * three or four runs running, appears at most twice, and never returns once
 * dismissed. lib/game/coaching.ts holds those conditions; this file only draws
 * whatever survives them, which on most runs is nothing.
 */

/** The danger sentence, which has to read as English at both ends of the roster. */
function dangerLine(profile: TrapProfile): string {
  const others = profile.rosterSize - 1;
  if (profile.outHits === 0)
    return `The gentlest thing in the roster. All ${others} of the others hit harder.`;
  if (profile.outHits === others) return "The heaviest hit in the game.";
  return `Hits harder than ${profile.outHits} of the other ${others} traps.`;
}

/**
 * What a trap is, before you have to meet it.
 *
 * Every figure is derived from the catalogue at render time rather than written
 * out per trap, so the roster can double without a line of new copy. The danger
 * ranking uses the same measured weight that decides the "you made it N% worse"
 * number, and the floor figure is the clearance placement validation actually
 * enforces, so both are checkable rather than flavour.
 */
export function TrapInspector({
  type,
  onClose,
}: {
  type: TrapType;
  onClose(): void;
}) {
  const memory = useCoachMemory();
  const profile = trapProfile(type);
  const placed = memory.placed[type] ?? 0;
  const ended = memory.deaths[type] ?? 0;
  return (
    <HelpDialog
      kicker="WHAT IT ACTUALLY DOES"
      title={profile.displayName}
      className="coach-dialog"
      onClose={onClose}
    >
      <div className="coach-hero">
        <TrapIcon type={type} />
        <p>{profile.shortDescription}</p>
      </div>
      <dl className="coach-facts">
        <div className="coach-fact">
          <dt>How it reaches you</dt>
          <dd>{profile.method}</dd>
        </div>
        <div className="coach-fact">
          <dt>How hard it hits</dt>
          <dd>
            {dangerLine(profile)}
            <span
              className="coach-bar"
              aria-hidden="true"
              style={{ "--coach-fill": profile.dangerFill } as React.CSSProperties}
            >
              <i />
            </span>
          </dd>
        </div>
        <div className="coach-fact">
          <dt>Room it takes</dt>
          <dd>
            Placing one keeps {profile.floorMetres.toFixed(1)} m of floor clear
            around it, roughly {Math.round(profile.runnerWidths)} runners wide.
          </dd>
        </div>
        {(placed > 0 || ended > 0) && (
          <div className="coach-fact">
            <dt>You and this trap</dt>
            <dd>
              {placed > 0
                ? `Added ${placed} ${placed === 1 ? "time" : "times"}. `
                : "Never added one. "}
              {ended > 0
                ? `It has ended ${ended} of your runs.`
                : "It has never ended a run of yours."}
            </dd>
          </div>
        )}
      </dl>
    </HelpDialog>
  );
}

/**
 * A way to read a trap before spending the pick on it, for the reward panel.
 *
 * Sits under the three offers rather than inside them: the cards are the choice
 * and stay one tap each, and the roster is about to more than double, so the
 * first time a player meets a name has to stop being the moment they commit to
 * it.
 */
export function TrapDetailsRow({ traps }: { traps: readonly TrapType[] }) {
  const [inspecting, setInspecting] = useState<TrapType | null>(null);
  if (traps.length === 0) return null;
  return (
    <div className="coach-inspect">
      <span className="coach-inspect-label">Never seen one?</span>
      {traps.map((type) => (
        <button
          key={type}
          className="coach-inspect-button"
          aria-label={`What ${TRAP_CATALOG[type].displayName} does`}
          onClick={() => setInspecting(type)}
        >
          {TRAP_CATALOG[type].displayName}
        </button>
      ))}
      {inspecting && (
        <TrapInspector type={inspecting} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
}

/**
 * Why the run ended, named.
 *
 * Both editions already know which trap touched the runner last and whose it
 * was; only the sentence reached the player, and a sentence naming a thing you
 * have never seen a description of is not an explanation. Deliberately
 * unpositioned so it composes into whichever failure panel a host already has.
 *
 * `contact` is the same recent contact the host used to write its own failure
 * message, so the two can never disagree about what happened.
 */
export function DeathNote({
  contact,
}: {
  contact: { trapType: TrapType; ownerName: string } | null;
}) {
  const memory = useCoachMemory();
  const [inspecting, setInspecting] = useState(false);
  if (!contact) return null;
  const profile = trapProfile(contact.trapType);
  const ended = memory.deaths[contact.trapType] ?? 0;
  return (
    <div className="coach-death">
      <TrapIcon type={contact.trapType} />
      <div className="coach-death-body">
        <span className="coach-death-kicker">WHAT GOT YOU</span>
        <strong>
          {contact.ownerName}&rsquo;s {profile.displayName}
        </strong>
        <p>{profile.method}</p>
        {ended >= 2 && (
          <p className="coach-death-tally">
            It has ended {ended} of your runs.
          </p>
        )}
        <button className="coach-death-more" onClick={() => setInspecting(true)}>
          What it does
        </button>
      </div>
      {inspecting && (
        <TrapInspector
          type={contact.trapType}
          onClose={() => setInspecting(false)}
        />
      )}
    </div>
  );
}

/**
 * How far the run got.
 *
 * Both editions have carried this number since the start - the controller
 * reports progress every frame and the repository stores it - and neither ever
 * showed it to the player, so a run that ended at 12% and a run that ended at
 * 88% produced the same card. It is the only thing on a failure screen a player
 * can watch improve, which is what makes a fourth attempt worth making.
 *
 * Unpositioned, like DeathNote, so it composes into whichever failure panel a
 * host already has.
 */
export function RunProgressNote({ percent }: { percent: number }) {
  const reached = Math.max(
    0,
    Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)),
  );
  return (
    <div className="coach-reach">
      <span className="coach-reach-kicker">HOW FAR YOU GOT</span>
      {/* Real text, so the bar beside it can stay hidden from assistive tech
          rather than announcing the same figure a second time. */}
      <b>{reached}%</b>
      <span
        className="coach-reach-bar"
        aria-hidden="true"
        style={{ "--coach-reach": reached / 100 } as React.CSSProperties}
      >
        <i />
      </span>
    </div>
  );
}

/**
 * The one thing worth saying, when there is one.
 *
 * Shown only between runs, where reading costs nothing and there is nothing to
 * interrupt. Two details do the anti-nag work. A showing is counted when the
 * card goes away rather than when it arrives, so reaching the two-showing cap
 * can never take the card off a reader mid-sentence, and the card waits for a
 * click rather than a timer. And dismissing writes the run number the card
 * appeared on, which is what stops one dismissal from uncovering the next hint
 * on the same screen.
 */
export function CoachHint({ phase }: { phase: GamePhase }) {
  const memory = useCoachMemory();
  const [inspecting, setInspecting] = useState<TrapType | null>(null);
  const eligible = phase === "failed" || phase === "intro";
  const hint = eligible ? chooseHint(memory) : null;
  const id = hint?.id ?? null;

  useEffect(() => {
    if (!id) return;
    return () =>
      updateCoachMemory((current) =>
        // Dismissing already counted it; counting again would be honest but
        // pointless, and the store treats an unchanged memory as a no-op.
        current.silenced.includes(id) ? current : noteHintShown(current, id),
      );
  }, [id]);

  if (!hint) return null;
  const dismiss = () =>
    updateCoachMemory((current) =>
      silenceHint(noteHintShown(current, hint.id), hint.id),
    );
  return (
    <>
      <aside className="coach-card" role="status">
        <div className="coach-kicker">WORTH KNOWING</div>
        <strong className="coach-title">{hint.title}</strong>
        <p className="coach-body">{hint.body}</p>
        <div className="coach-actions">
          <button className="coach-chip" onClick={dismiss}>
            Got it
          </button>
          {hint.trap && (
            <button
              className="coach-skip"
              onClick={() => setInspecting(hint.trap)}
            >
              What it does
            </button>
          )}
        </div>
      </aside>
      {/* Kept out of the card: the card is positioned, so a modal nested inside
          it would size itself against the card rather than the game shell. */}
      {inspecting && inspecting === hint.trap && (
        <TrapInspector type={inspecting} onClose={() => setInspecting(null)} />
      )}
    </>
  );
}
