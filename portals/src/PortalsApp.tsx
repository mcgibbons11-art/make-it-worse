import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TrapIcon } from "@/components/icons/TrapIcon";
import { CoachHint, DeathNote, RunProgressNote, TrapDetailsRow } from "@/components/hud/Coach";
import { FirstRunTour } from "@/components/hud/Onboarding";
import {
  MobileControls,
  useTouchControlsAvailable,
} from "@/components/hud/MobileControls";
import { recordRunEnd, recordTrapPlaced } from "@/lib/game/coaching";
import { ATTEMPT_LIMIT_MS } from "@/lib/game/constants";
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { CLASSIC_TRACK, buildTrack } from "@/lib/game/track";
import { placementFromWorld, validatePlacement } from "@/lib/game/placement";
import { challengeTrack, firstLegalPlacement } from "@/lib/game/trap-choice";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import {
  CONSEQUENCE_HEADLINE,
  buildShareCopy,
  chainDepthLine,
  challengeStatLine,
  depthPill,
} from "@/lib/game/share-copy";
import {
  ConfirmDialog,
  ControlsPanel,
  Overlay,
  SettingsMenu,
} from "./menu/ShellPanels";
import {
  EMPTY_RUN,
  discardsRun,
  escapeAction,
  runStatus,
  type RunSlice,
  type ShellView,
} from "./menu/shell-state";
import {
  CHALLENGE_LINK_PARAM,
  decodeChallengeLink,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  GuestProfile,
  HazardContact,
  PublishChildResult,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { isInterfaceTarget } from "@/lib/game/input";
import { useSettingsStore } from "@/stores/settings-store";
import { AudioManager } from "@/lib/audio/AudioManager";
import { musicSceneForPhase } from "@/lib/audio/music";
import { resolveAvatar } from "@/lib/game/avatar";
import {
  connect,
  fetchClearTimes,
  onPlayerChange,
  signIn,
  submitClearTime,
  type BoardResult,
  type PortalsPlayer,
  type SubmitResult,
} from "./leaderboard";
const GameCanvas = lazy(() => import("@/components/game/GameCanvas"));
const WardrobePanel = lazy(() =>
  import("@/components/hud/wardrobe/WardrobePanel").then((module) => ({
    default: module.WardrobePanel,
  })),
);
const AvatarApartment = lazy(() =>
  import("@/components/hud/wardrobe/AvatarApartment").then((module) => ({
    default: module.AvatarApartment,
  })),
);
const RoomBuilder = lazy(() =>
  import("@/components/game/RoomBuilder").then((module) => ({
    default: module.RoomBuilder,
  })),
);
const MENU_ICON_BASE = `${process.env.NEXT_PUBLIC_ASSET_BASE ?? "/"}assets/menu-icons/`;
function MenuIcon({ name }: { name: "apartment" | "build" | "controls" | "leaderboard" | "runner" | "settings" }) {
  return <img className="portals-menu-icon" src={`${MENU_ICON_BASE}${name}.png`} alt="" aria-hidden="true" />;
}
// Seconds left when the timer turns warm and the countdown pill appears. The
// screen-reader warning fires on this same value, so the spoken "Ten seconds
// left" and the first visible digit are the same moment by construction.
const COUNTDOWN_FROM = 10;
/** Seconds left when the tick goes up a fifth. Mirrors the Next edition's HUD. */
const COUNTDOWN_URGENT_FROM = 3;
const format = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0")}.${Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0")}`;
function LeaderboardPanel({
  depth,
  board,
  loading,
  playerId,
  submitStatus,
  onSignIn,
  onRetry,
}: {
  depth: number;
  board: BoardResult | null;
  loading: boolean;
  playerId: string | null;
  submitStatus: SubmitResult | null;
  onSignIn(): void;
  onRetry(): void;
}) {
  return (
    <div className="leaderboard">
      <div className="eyebrow">
        {depth === 0
          ? "FASTEST CLEAN RUNS"
          : `FASTEST CLEARS · DISASTER ${depth}`}
      </div>
      {submitStatus?.status === "sign_in_required" && (
        <button className="button secondary" onClick={onSignIn}>
          Sign in to post your time
        </button>
      )}
      {submitStatus?.status === "error" && (
        <p className="leaderboard-note">
          Your time did not post. {submitStatus.message}
        </p>
      )}
      {loading && <p className="leaderboard-note">Loading times…</p>}
      {!loading && board?.status === "unavailable" && (
        <p className="leaderboard-note">
          Leaderboards need a Portals host. This build is running outside one.
        </p>
      )}
      {!loading && board?.status === "error" && (
        <p className="leaderboard-note">
          {board.message}{" "}
          <button className="text-button" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {!loading && board?.status === "ok" && board.entries.length === 0 && (
        <p className="leaderboard-note">No times yet. Go set one.</p>
      )}
      {!loading && board?.status === "ok" && board.entries.length > 0 && (
        <ol className="leaderboard-rows">
          {board.entries.map((entry) => (
            <li
              key={entry.playerId}
              className={entry.playerId === playerId ? "is-you" : undefined}
            >
              <span className="leaderboard-rank">{entry.rank}</span>
              <span className="leaderboard-name">
                {entry.displayName ?? "Anonymous runner"}
              </span>
              <span className="leaderboard-time">
                {format(entry.clearTimeMs)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="leaderboard-note quiet">
        Times are reported by each player&rsquo;s browser and are meant for
        bragging rights only.
      </p>
    </div>
  );
}
export function PortalsApp() {
  const touchControls = useTouchControlsAvailable();
  const repository = useMemo(() => new DemoRepository(), []);
  const settings = useSettingsStore();
  const [assetsReady, setAssetsReady] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("booting");
  const [challenge, setChallenge] = useState<ChallengeDTO | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptSerial, setAttemptSerial] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [offered, setOffered] = useState<
    readonly [TrapType, TrapType, TrapType] | null
  >(null);
  const [placement, setPlacement] = useState<TrapPlacementInput | null>(null);
  const [result, setResult] = useState<PublishChildResult | null>(null);
  const [failure, setFailure] = useState("The void got you.");
  const [failureStamp, setFailureStamp] = useState("FELL OUT");
  // The contact the failure sentence was written from, kept so the card can also
  // show what that trap does rather than only naming it.
  const [deathCause, setDeathCause] = useState<HazardContact | null>(null);
  // How far along the course the run is, for the HUD. Sampled off the same tick
  // as the clock: a 60 second cap only reads as fair next to how far it got you.
  const [runProgress, setRunProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [player, setPlayer] = useState<PortalsPlayer | null>(null);
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [boardDepth, setBoardDepth] = useState(0);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitResult | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [randomRoomSeed, setRandomRoomSeed] = useState<number | null>(null);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [apartmentOpen, setApartmentOpen] = useState(false);
  // The name the game hands you rides on every trap you add and into every
  // message you send, and the first time a reviewer saw theirs was inside the
  // message they were about to send a friend. Held here so a screen can say it
  // before that happens.
  const [guest, setGuest] = useState<GuestProfile | null>(null);
  // Shell surfaces stack: only the top one renders, so only one dialog is ever
  // mounted and only one focus trap is ever armed. Closing is a pop, which is
  // what lets Settings return to the pause panel when pause opened it and to
  // the main menu when the menu did.
  const [views, setViews] = useState<readonly ShellView[]>([]);
  const [pending, setPending] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    act(): void;
  } | null>(null);
  const samples = useRef<DecodedGhostSample[]>([]);
  const lastHazard = useRef<HazardContact | null>(null);
  const finishing = useRef(false);
  const starting = useRef(false);
  const progress = useRef(0);
  // fail() shows its panel on a delay so the death reads before the card lands.
  // Restarting out of the pause menu starts a new attempt inside that window,
  // so the handle has to be cancellable or the new run drops to "failed".
  const failTimer = useRef<number | null>(null);
  const view = views[views.length - 1] ?? null;
  const openView = useCallback(
    (next: ShellView) => setViews((stack) => [...stack, next]),
    [],
  );
  const closeView = useCallback(
    () => setViews((stack) => stack.slice(0, -1)),
    [],
  );
  /**
   * Put text on the clipboard, or leave it selected where a player can.
   *
   * Extracted because there are now two things worth sending - a challenge you
   * worsened, and a course you built - and a second copy of the fallback would
   * be a second thing to get wrong. execCommand is deprecated and is the only
   * path that works when the clipboard API is refused, which is every browser
   * that has not granted permission.
   */
  const copyText = useCallback(async (text: string, done: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      setNotice(copied ? done : "Select and copy: " + text);
    }
  }, []);
  const copyChallengeMessage = useCallback(async () => {
    // Without the encoded level this was a bare sentence with no link at all,
    // so there was nothing for the recipient to open. This edition has no
    // /c/<slug> route, so the payload rides the page's own URL.
    const target = result?.challenge ?? challenge;
    let text = "I survived MAKE IT WORSE on Portals. Your turn!";
    if (target) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set(CHALLENGE_LINK_PARAM, encodeChallengeLink(target));
        text = buildShareCopy(target, url.toString());
      } catch {
        // encodeChallengeLink now refuses to emit an undecodable link. Sitting
        // outside this try, that throw made the button silently do nothing.
        setNotice(
          "This course could not be turned into a link. Try adding the trap again.",
        );
        return;
      }
    }
    await copyText(text, "Challenge message copied.");
  }, [challenge, copyText, result]);
  useEffect(() => {
    AudioManager.setMuted(settings.muted);
    AudioManager.setVolume(settings.volume);
  }, [settings.muted, settings.volume]);
  useEffect(() => {
    // Same gesture unlock as the Next edition; see the note there.
    const unlock = () => AudioManager.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  useEffect(() => {
    void repository.ensureGuest().then((profile) => {
      setGuest(profile);
      setPhase("ready");
    });
  }, [repository]);
  useEffect(() => {
    void connect().then((result) => {
      if (result.status === "ok") setPlayer(result.player);
    });
    return onPlayerChange(setPlayer);
  }, []);
  const loadBoard = useCallback(async (depth: number) => {
    setBoardDepth(depth);
    setBoardLoading(true);
    setBoard(await fetchClearTimes(depth));
    setBoardLoading(false);
  }, []);
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(() => {
      setElapsed(performance.now() - startedAt);
      // Whole percent only, so the bar redraws when it has something new to say
      // rather than twenty times a second.
      setRunProgress((current) => {
        const next = Math.round(
          Math.min(1, Math.max(0, progress.current)) * 100,
        );
        return next === current ? current : next;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [phase, startedAt]);
  const open = useCallback((next: ChallengeDTO) => {
    // Models are decoded once per session, not per challenge. Clearing this on
    // every open re-closed a gate that only ever opens on first mount.
    setChallenge(next);
    setPhase("intro");
    setResult(null);
    setPlacement(null);
    setOffered(null);
    // A notice belongs to the run that raised it. Left standing it reappears
    // under the next challenge's panels as if it had just happened.
    setNotice("");
    setViews([]);
  }, []);
  /**
   * Drop the whole run in one assignment.
   *
   * Every field of RunSlice is applied here, so adding one to the type without
   * clearing it does not compile. The first "Quit to menu" moved the phase to
   * `ready` and left the challenge mounted; because the title screen only
   * renders when there is no challenge, that landed the player on a live canvas
   * with no panel on it and no way back.
   */
  const applyRun = useCallback((next: RunSlice) => {
    setChallenge(next.challenge);
    setAttemptId(next.attemptId);
    setOffered(next.offered);
    setPlacement(next.placement);
    setResult(next.result);
    setSubmitStatus(next.submitStatus);
    setNotice(next.notice);
    setElapsed(next.elapsed);
    setPhase(next.phase);
  }, []);
  // A shared link carries the level in its own URL, so an incoming player goes
  // straight into their friend's challenge instead of the title screen.
  useEffect(() => {
    const payload = new URL(window.location.href).searchParams.get(
      CHALLENGE_LINK_PARAM,
    );
    if (!payload) return;
    let cancelled = false;
    // Decoding and adopting run off the synchronous effect body so no state is
    // set during the effect itself.
    void Promise.resolve()
      .then(() => decodeChallengeLink(payload))
      .then((shared) => repository.importChallenge?.(shared) ?? shared)
      .then((stored) => {
        if (!cancelled) open(stored);
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            "That challenge link is damaged. Ask your friend to resend it.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [open, repository]);
  const fresh = () => {
    applyRun(EMPTY_RUN);
    setViews([]);
    setBoardOpen(false);
    setRandomRoomSeed(Date.now() ^ Math.floor(Math.random() * 0x7fffffff));
    setEditorOpen(true);
  };
  const trending = async () => {
    const items = await repository.listTrending(1);
    open(items[0]!);
  };
  const start = useCallback(async () => {
    // Same in-flight guard as the Next edition: a double-clicked "Try again"
    // otherwise books two attempts against the challenge's stats.
    if (!challenge || starting.current) return;
    starting.current = true;
    // Before the await, not after: a slow startAttempt would otherwise let the
    // previous attempt's failure timer land on top of the new run.
    if (failTimer.current !== null) {
      clearTimeout(failTimer.current);
      failTimer.current = null;
    }
    let started;
    try {
      started = await repository.startAttempt({
        challengeSlug: challenge.slug,
        clientSessionId: crypto.randomUUID(),
        deviceClass: matchMedia("(max-width:700px)").matches
          ? "mobile"
          : "desktop",
        buildVersion: "portals-1",
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      starting.current = false;
      setNotice("Could not start the run. Try again.");
      return;
    }
    starting.current = false;
    setAttemptId(started.attemptId);
    setAttemptSerial((value) => value + 1);
    setStartedAt(performance.now());
    setElapsed(0);
    // The finish panel renders before the new submission resolves, so clear the
    // previous run's status rather than flashing its sign-in prompt.
    setSubmitStatus(null);
    samples.current = [];
    lastHazard.current = null;
    finishing.current = false;
    progress.current = 0;
    setPhase("playing");
    AudioManager.click();
  }, [challenge, repository]);
  const complete = useCallback(async () => {
    if (finishing.current || !attemptId || !challenge) return;
    finishing.current = true;
    const duration = Math.max(100, performance.now() - startedAt);
    const trace = encodeGhostTrace(
      samples.current.length
        ? samples.current
        : [{ x: 0, y: 1.25, z: 1.2, yaw: 0, flags: 1 }],
    );
    let finished;
    try {
      finished = await repository.finishAttempt({
        attemptId,
        outcome: "completed",
        durationMs: Math.round(duration),
        maxProgress: 1,
        deathTrapInstanceId: null,
        ghostTrace: trace,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      // Without this the rejection left finishing.current true, so even R was
      // swallowed and the only escape was a reload.
      finishing.current = false;
      setFailure("You made it, but the run could not be saved.");
      setFailureStamp("NOT SAVED");
      setPhase("failed");
      return;
    }
    setElapsed(duration);
    setOffered(finished.offeredTraps);
    setPhase("finished");
    recordRunEnd({ outcome: "completed", progress: 1, cause: null });
    AudioManager.finish();
    navigator.vibrate?.([45, 40, 70]);
    setSubmitStatus(await submitClearTime(challenge.depth, duration));
    await loadBoard(challenge.depth);
  }, [attemptId, challenge, loadBoard, repository, startedAt]);
  // The SDK requires sign-in to come from a direct player action. Posting the
  // just-finished time here saves the player from replaying the run.
  const handleSignIn = useCallback(async () => {
    const result = await signIn();
    if (result.status === "error") {
      setNotice(result.message);
      return;
    }
    if (result.status !== "ok") return;
    setPlayer(result.player);
    if (!challenge || phase !== "finished") return;
    setSubmitStatus(await submitClearTime(challenge.depth, elapsed));
    await loadBoard(challenge.depth);
  }, [challenge, elapsed, loadBoard, phase]);
  const fail = useCallback(
    // `knownDuration` is for the paused case: startedAt is not rebased until
    // the run resumes, so mid-pause it is stale by however long the menu was
    // open and would book that time against the attempt.
    async (outcome: "fell" | "timeout" | "reset" = "fell", knownDuration?: number) => {
      if (finishing.current || !attemptId) return;
      finishing.current = true;
      const duration = knownDuration ?? performance.now() - startedAt;
      const recent =
        lastHazard.current &&
        performance.now() - lastHazard.current.contactedAtMs < 3500
          ? lastHazard.current
          : null;
      setFailure(
        recent
          ? `${recent.ownerName}’s ${TRAP_CATALOG[recent.trapType].displayName.toLowerCase()} got you.`
          : "The void got you.",
      );
      if (outcome === "reset") {
        setFailure("You reset the attempt.");
        setFailureStamp("RESET");
      } else if (outcome === "timeout") {
        setFailure("The clock ate your run.");
        setFailureStamp("TOO SLOW");
      } else {
        setFailureStamp(recent ? "BONKED" : "FELL OUT");
      }
      // The card names the trap; this lets it also say what the trap does, and
      // it is the same contact the sentence above was written from, so the two
      // can never disagree about what happened.
      setDeathCause(outcome === "reset" ? null : recent);
      recordRunEnd({
        outcome,
        progress: progress.current,
        cause: recent?.trapType ?? null,
      });
      // Losing the run used to play the same thud as a bonk.
      AudioManager.fail();
      void repository.finishAttempt({
        attemptId,
        outcome,
        durationMs: Math.round(duration),
        maxProgress: progress.current,
        deathTrapInstanceId: recent?.trapInstanceId ?? null,
        ghostTrace: null,
        idempotencyKey: crypto.randomUUID(),
      });
      failTimer.current = window.setTimeout(() => setPhase("failed"), 450);
    },
    [attemptId, repository, startedAt],
  );
  // Which of the three offers this course can actually hold. At mint time all
  // three are placeable by construction, because the offer is drawn against the
  // same track and traps. It stops being true across a deploy: a completed
  // attempt persisted in the browser hands back its stored offeredTraps on
  // replay, so an offer minted before a track or zone change can outlive the
  // data it was checked against. Without this the panel shows three live
  // buttons that each say "try one of the others" when there is no other.
  const placeableOffers = useMemo(() => {
    if (!challenge || !offered) return [];
    const track = challengeTrack(challenge);
    return offered.filter((type) =>
      firstLegalPlacement(track, type, challenge.traps),
    );
  }, [challenge, offered]);
  const endChain = () => {
    setOffered(null);
    setPhase("finished");
  };
  const choose = (type: TrapType) => {
    if (!challenge) return;
    // Same search the offer was filtered with, on this challenge's own track.
    // Hand-rolling a centre-only scan here meant this client could not reach
    // the positions the offer had already been checked against.
    const placement = firstLegalPlacement(
      challengeTrack(challenge),
      type,
      challenge.traps,
    );
    if (!placement) {
      // A bare return left the button inert with no explanation. The card is
      // disabled when this is knowable up front, so reaching here means the
      // offer went stale mid-panel; point at whatever is actually left rather
      // than at "the others", which may not exist.
      const others = placeableOffers.filter((other) => other !== type).length;
      setNotice(
        `No room left for ${TRAP_CATALOG[type].displayName.toLowerCase()} on this course. ` +
          (others > 0
            ? "Try one of the others."
            : "Finish the chain here instead."),
      );
      return;
    }
    setPlacement(placement);
    setPhase("placing_trap");
    AudioManager.click();
  };
  const publish = async () => {
    if (!challenge || !attemptId || !placement) return;
    setPhase("publishing");
    try {
      const published = await repository.publishChild({
        parentSlug: challenge.slug,
        attemptId,
        placement,
        idempotencyKey: crypto.randomUUID(),
      });
      setResult(published);
      setPhase("sharing");
      recordTrapPlaced(placement.type);
      AudioManager.publish();
    } catch {
      setPhase("placing_trap");
    }
  };
  const pause = useCallback(() => {
    setElapsed(performance.now() - startedAt);
    setPhase("paused");
  }, [startedAt]);
  const resume = useCallback(() => {
    setViews([]);
    if (phase === "paused") {
      setStartedAt(performance.now() - elapsed);
      setPhase("playing");
    }
  }, [elapsed, phase]);
  const restart = useCallback(async () => {
    setViews([]);
    await fail("reset", elapsed);
    await start();
  }, [elapsed, fail, start]);
  // Whole seconds remaining against the same cap PlayerController enforces, so
  // the pill cannot disagree with the rule that actually ends the run. Clamped
  // at zero because `elapsed` keeps climbing for the frame or two between the
  // cap being passed and the timeout landing.
  const secondsLeft = Math.max(0, Math.ceil((ATTEMPT_LIMIT_MS - elapsed) / 1000));
  const closing = secondsLeft <= COUNTDOWN_FROM;
  // The audible half of the countdown, off the same `secondsLeft` the pill
  // reads, so the clock the player sees and the clock they hear are one clock.
  // Zero is the timeout itself, which has its own sound.
  const ticksLeft = phase === "playing" ? secondsLeft : null;
  useEffect(() => {
    if (ticksLeft === null || ticksLeft > COUNTDOWN_FROM || ticksLeft === 0) return;
    AudioManager.countdown(ticksLeft <= COUNTDOWN_URGENT_FROM);
  }, [ticksLeft]);
  // The score. Computed in render so the effect fires on the handful of scene
  // changes rather than on all twelve hundred clock ticks in a run.
  const musicScene = musicSceneForPhase(
    phase,
    ticksLeft === null ? undefined : ticksLeft * 1000,
  );
  useEffect(() => {
    AudioManager.setMusicScene(musicScene);
  }, [musicScene]);
  // The room tone the game ships and has never played, held for the whole run.
  useEffect(() => {
    if (phase !== "playing") return;
    AudioManager.startAmbience();
    return () => AudioManager.stopAmbience();
  }, [phase]);
  const quitToTitle = useCallback(() => {
    applyRun(EMPTY_RUN);
    setViews([]);
    // The board is loaded at the run's depth, so leaving it open would put
    // "FASTEST CLEARS · DISASTER 3" on a title screen with no run behind it.
    setBoardOpen(false);
  }, [applyRun]);
  /**
   * Run an action, or ask first when it would throw the run away.
   *
   * The gate is on the phase rather than on the button, so a screen that starts
   * holding something worth keeping is covered the moment it does.
   */
  const guard = useCallback(
    (
      act: () => void,
      copy: { title: string; body: string; confirmLabel: string },
    ) => {
      if (!challenge || !discardsRun(phase)) {
        act();
        return;
      }
      setPending({ ...copy, act });
      openView("confirm");
    },
    [challenge, openView, phase],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape is read before the interface guard below. That guard treats a
      // focused button as "the player is in the interface", which is exactly
      // where a trapped modal keeps them, so gating Escape on it made Escape
      // dead in every panel it is supposed to close.
      if (event.key === "Escape") {
        switch (
          escapeAction({ view, editorOpen, phase, hasOffer: offered !== null })
        ) {
          case "close-view":
            closeView();
            break;
          case "close-editor":
            setEditorOpen(false);
            break;
          case "pause":
            pause();
            break;
          case "resume":
            resume();
            break;
          case "leave-intro":
            quitToTitle();
            break;
          case "cancel-placement":
            setPlacement(null);
            setPhase("choosing_trap");
            break;
        }
        return;
      }
      // Same guard as the Next edition: game shortcuts must not fire while the
      // player is typing or has a control focused.
      if (isInterfaceTarget(event.target)) return;
      if (event.code === "KeyR" && phase === "playing") void fail("reset");
      if (event.code === "KeyM") settings.toggleMuted();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    closeView,
    editorOpen,
    fail,
    offered,
    pause,
    phase,
    quitToTitle,
    resume,
    settings,
    view,
  ]);
  // Focus is restored when a dialog closes, which for the pause panel means the
  // HUD button that opened it. isInterfaceTarget counts a focused button as the
  // interface, so leaving focus there swallowed WASD and Space for the rest of
  // the run.
  useEffect(() => {
    if (phase !== "playing") return;
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }, [phase]);
  // How the menu describes the run it is covering. Null on a cold start, which
  // is the only difference between the title screen and the in-run menu: the
  // same body renders in both, so neither can drift from the other.
  const status = challenge ? runStatus(phase) : null;
  const menuBody = (
    <>
      <h1 className="portals-title" id="portals-menu-title">
        <span>MAKE IT</span>
        <strong>WORSE</strong>
      </h1>
      <p className="portals-lede">
        Beat the level. Add one awful thing. Play the consequence.
      </p>
      {status && challenge && (
        <div className="portals-resume">
          <p className="portals-resume-state">
            <span className="portals-resume-dot" aria-hidden="true" />
            {status.label} · Disaster {challenge.depth}
            {status.showsClock && <b> · {format(elapsed)}</b>}
          </p>
          <button className="button primary huge" onClick={resume}>
            ▶️ {status.resumeLabel}
          </button>
        </div>
      )}
      <div className="portals-actions">
        <button
          className="button danger mega"
          onClick={() =>
            guard(fresh, {
              title: "Leave this run?",
              body: "A clean level replaces the one you are on. This run does not come back.",
              confirmLabel: "Play a clean level",
            })
          }
        >
          ▶️ Play a clean level
        </button>
        {/* One way in. Four controls at near-equal weight gave a first-time
            player no "start here", and three of the four named a concept the
            screen had not yet defined. */}
        <p className="portals-actions-note">
          No traps yet. Beat it and you get to add the first one.
        </p>
        <button
          className="button secondary"
          onClick={() =>
            guard(() => void trending(), {
              title: "Leave this run?",
              body: "That level replaces the one you are on. This run does not come back.",
              confirmLabel: "Play the ruined one",
            })
          }
        >
          💥 Play one somebody already ruined
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setViews([]);
            setWardrobeOpen(true);
          }}
        >
          <MenuIcon name="runner" /> Build your runner
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setViews([]);
            setApartmentOpen(true);
          }}
        >
          <MenuIcon name="apartment" /> Visit your apartment
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setBoardOpen((open) => !open);
            // One `board` is shared with the finish panel. Opening this at
            // depth 0 mid-chain replaced that panel's table with a different
            // depth's times while its heading still claimed this one's.
            if (!boardOpen) void loadBoard(challenge?.depth ?? 0);
          }}
        >
          <MenuIcon name="leaderboard" /> {boardOpen ? "Hide leaderboard" : "Global leaderboard"}
        </button>
        <button
          className="button secondary"
          onClick={() =>
            // The editor is a full-height panel, so it opens on the title
            // screen rather than inside the menu overlay's scroll box.
            guard(
              () => {
                quitToTitle();
                setRandomRoomSeed(null);
                setEditorOpen(true);
              },
              {
                title: "Leave this run?",
                body: "Building a track ends the run you are on. This run does not come back.",
                confirmLabel: "Open the editor",
              },
            )
          }
        >
          <MenuIcon name="build" /> Build your game
        </button>
        <button className="button secondary" onClick={() => openView("settings")}>
          <MenuIcon name="settings" /> Settings
        </button>
        <button className="button secondary" onClick={() => openView("controls")}>
          <MenuIcon name="controls" /> How to play
        </button>
        {status && (
          <button
            className="button secondary"
            onClick={() =>
              guard(quitToTitle, {
                title: "Abandon this run?",
                body: "The level, the clock and anything you were about to add go with it.",
                confirmLabel: "Abandon the run",
              })
            }
          >
            🚪 Abandon this run
          </button>
        )}
      </div>
      {boardOpen && (
        <LeaderboardPanel
          depth={boardDepth}
          board={board}
          loading={boardLoading}
          playerId={player?.playerId ?? null}
          submitStatus={null}
          onSignIn={() => void handleSignIn()}
          onRetry={() => void loadBoard(boardDepth)}
        />
      )}
      {/* The only place a damaged challenge link ever said so was a panel that
          is not mounted on the title screen, so the message was set and never
          shown. */}
      <p className="portals-notice" role="status" aria-live="polite">
        {notice}
      </p>
      <span className="portals-note">
        {touchControls
          ? "Touch controls enabled · tap the menu button to pause"
          : "Keyboard + mouse · Esc opens this menu"}
      </span>
    </>
  );
  const shellDialogs = (
    <>
      {view === "settings" && (
        <Overlay
          labelledBy="portals-settings-title"
          panelClassName="portals-settings"
        >
          <SettingsMenu onBack={closeView} />
        </Overlay>
      )}
      {view === "controls" && (
        <Overlay
          labelledBy="portals-controls-title"
          panelClassName="portals-settings"
        >
          <ControlsPanel onBack={closeView} touchControls={touchControls} />
        </Overlay>
      )}
      {view === "confirm" && pending && (
        <Overlay
          labelledBy="portals-confirm-title"
          panelClassName="portals-confirm"
        >
          <ConfirmDialog
            title={pending.title}
            body={pending.body}
            confirmLabel={pending.confirmLabel}
            onCancel={closeView}
            onConfirm={() => {
              const act = pending.act;
              setPending(null);
              setViews([]);
              act();
            }}
          />
        </Overlay>
      )}
      {wardrobeOpen && (
        <Suspense
          fallback={
            <div className="canvas-loading">
              <span />
              Opening the wardrobe…
            </div>
          }
        >
          <WardrobePanel
            avatar={settings.avatar ?? null}
            avatarSeed={challenge?.createdByAvatarSeed ?? guest?.avatarSeed ?? 1}
            onSave={(config) => {
              settings.setAvatar(config);
              setWardrobeOpen(false);
            }}
            onClose={() => setWardrobeOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
  // Without the track this resolved a composed course's zone id against the
  // classic apartment, missed, and disabled "Add this trap" forever — while
  // GameScene, validating WITH the track, drew a valid green preview. The
  // player saw a placeable trap they could never commit.
  //
  // Computed ABOVE the early return, and null-safe on `challenge`, because the
  // placement cue below is a hook and a hook cannot sit after a return.
  const validation =
    challenge && placement
      ? validatePlacement(
          placement,
          challenge.traps,
          buildTrack(challenge.track ?? CLASSIC_TRACK),
        )
      : null;
  // A player dragging the trap is watching the trap, not the panel, so only the
  // CHANGE in verdict sounds. Every frame of a drag would be a stutter.
  const placementValid = validation?.valid ?? null;
  const soundedPlacement = useRef<boolean | null>(null);
  useEffect(() => {
    if (placementValid === null || soundedPlacement.current === placementValid) {
      soundedPlacement.current = placementValid;
      return;
    }
    soundedPlacement.current = placementValid;
    AudioManager.placement(placementValid);
  }, [placementValid]);
  if (editorOpen)
    return (
      <Suspense fallback={<div className="canvas-loading"><span />Opening the room builder…</div>}>
        <RoomBuilder
          key={randomRoomSeed ?? "custom"}
          avatar={settings.avatar ?? null}
          avatarSeed={challenge?.createdByAvatarSeed ?? guest?.avatarSeed ?? 1}
          {...(randomRoomSeed === null ? {} : { randomSeed: randomRoomSeed })}
          initialMode={randomRoomSeed === null ? "build" : "test"}
          onClose={() => {
            setEditorOpen(false);
            setRandomRoomSeed(null);
          }}
        />
      </Suspense>
    );
  if (apartmentOpen)
    return (
      <Suspense fallback={<div className="canvas-loading"><span />Building your apartment…</div>}>
        <AvatarApartment
          avatar={settings.avatar ?? null}
          avatarSeed={challenge?.createdByAvatarSeed ?? guest?.avatarSeed ?? 1}
          onClose={() => setApartmentOpen(false)}
        />
      </Suspense>
    );
  if (!challenge)
    return (
      <main className="portals-home">
        <section className="panel portals-card">{menuBody}</section>
        {shellDialogs}
      </main>
    );
  // A shell dialog replaces the run's own panel rather than stacking over it,
  // so only one modal is ever mounted and only one focus trap is ever armed.
  // The wardrobe counts as a shell surface: it REPLACES the run's own panel
  // rather than stacking over it, which is the rule the rest of this shell
  // follows so only one modal is ever mounted and only one focus trap armed.
  // Mounted alongside the intro card it rendered behind it, which is a dialog
  // nobody can reach.
  const runPanel = view === null && !wardrobeOpen ? phase : null;
  return (
    <main className="game-shell">
      <Suspense
        fallback={
          <div className="canvas-loading">
            <span />
            Assembling the worst apartment…
          </div>
        }
      >
        <GameCanvas
          challenge={challenge}
          phase={phase}
          attemptSerial={attemptSerial}
          startedAt={startedAt}
          placement={placement}
          ghostEnabled={settings.ghostEnabled}
          recordSample={(sample) => {
            if (samples.current.length < 900) samples.current.push(sample);
          }}
          onProgress={(value) => {
            progress.current = value;
          }}
          onFinish={() => void complete()}
          onFail={(outcome) => void fail(outcome)}
          onHazard={(contact) => {
            lastHazard.current = contact;
          }}
          onSelectZone={(zoneId) => {
            if (placement)
              setPlacement({ ...placement, zoneId, offsetX: 0, offsetZ: 0 });
          }}
          onMovePlacement={(zoneId, worldX, worldZ) => {
            if (!placement) return;
            setPlacement(
              placementFromWorld(
                placement.type,
                zoneId,
                worldX,
                worldZ,
                placement.rotationQuarterTurns,
                buildTrack(challenge.track ?? CLASSIC_TRACK),
              ),
            );
          }}
          onAssetsReady={() => setAssetsReady(true)}
        />
      </Suspense>
      {runPanel === "intro" && (
        <Overlay labelledBy="portals-intro-title">
          {/* Was "CHAIN DEPTH 3", the internal term, on the first screen a
              player reads. This says what the number counts, in the same words
              the HUD pill uses a moment later. */}
          <div className="eyebrow">{chainDepthLine(challenge.depth)}</div>
          <h1 id="portals-intro-title">
            {challenge.addedTrap
              ? `${challenge.addedTrap.ownerName} added ${TRAP_CATALOG[challenge.addedTrap.type].articleName}.`
              : "A clean level. For now."}
          </h1>
          <p className="stat-line">
            {challengeStatLine(challenge.stats).attempts
              ? `${challengeStatLine(challenge.stats).attempts} · `
              : ""}
            {challengeStatLine(challenge.stats).survival}
          </p>
          {guest && (
            <p className="portals-identity">
              You are <strong>{guest.displayName}</strong>. That name goes out on
              every trap you add.
            </p>
          )}
          <button
            className="button danger huge"
            onClick={() => void start()}
            disabled={!assetsReady}
          >
            {!assetsReady
              ? "Loading the apartment…"
              : challenge.addedTrap
              ? "Beat their version"
              : "Beat it. Add the first problem."}
          </button>
          <div className="portals-buttons">
            {/* The wardrobe was built, tested and mounted in the Next edition
                only, so a Portals player - which is the edition people actually
                play - had 69 garments across nine slots and no way to reach any
                of them. WardrobePanel deliberately knows nothing about either
                app's stores, so it mounts here on this edition's own state. */}
            <button className="button secondary" onClick={() => setWardrobeOpen(true)}>
              <span
                className="avatar-launcher-chip"
                style={{ background: resolveAvatar(settings.avatar, challenge.createdByAvatarSeed).bodyColor }}
              />
              {settings.avatar ? "Edit your runner" : "Make your runner"}
            </button>
            <button className="button secondary" onClick={quitToTitle}>
              Back to the main menu
            </button>
          </div>
        </Overlay>
      )}
      {runPanel === "playing" && (
        // The attempt is hard-capped at ATTEMPT_LIMIT_MS by PlayerController and
        // this HUD counted up in silence, so the first anyone learned of a clock
        // was TOO SLOW. The last ten seconds are a real countdown, and the bar
        // says how far that clock got you, which is what makes the cap read as a
        // rule rather than as a trick.
        <header className="game-hud">
          <div
            className={`hud-pill timer${closing ? " is-warm" : ""}`}
            aria-label={`Elapsed time ${format(elapsed)}`}
          >
            {format(elapsed)}
          </div>
          {/* Keyed on the whole second so each tick replays the pop once. Silent
              to assistive tech; the single spoken warning below carries it. */}
          {closing && (
            <div key={secondsLeft} className="hud-pill countdown" aria-hidden="true">
              {secondsLeft}
            </div>
          )}
          {/* "DISASTER 0" on a level nobody has touched is a number counting
              nothing, and "Chain depth 3" was the internal term read aloud. */}
          <div className="hud-pill depth" aria-label={depthPill(challenge.depth).label}>
            {depthPill(challenge.depth).text}
          </div>
          <div
            className="onboard-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={runProgress}
            aria-label="How far along the course this run is"
          >
            <i style={{ "--onboard-run": `${runProgress}%` } as React.CSSProperties} />
          </div>
          <span className="sr-only" role="status">
            {secondsLeft === COUNTDOWN_FROM ? "Ten seconds left" : ""}
          </span>
          <div className="hud-actions">
            <button
              aria-label="Open how to play"
              title="How to play"
              onClick={() => {
                pause();
                openView("controls");
              }}
            >?</button>
            <button aria-label="Reset attempt (R)" onClick={() => void fail("reset")}>↻</button>
            <button aria-label="Pause game (Escape)" onClick={pause}>Ⅱ</button>
            <button aria-label={settings.muted ? "Unmute audio (M)" : "Mute audio (M)"} onClick={() => settings.toggleMuted()}>♫</button>
          </div>
        </header>
      )}
      {runPanel === "playing" && <MobileControls />}
      {/* Both were written, tested and imported, and then mounted by nothing -
          the unit tests render them directly, so the suite stayed green while
          no player could reach them. The tour teaches move/jump/reach-the-door
          on a first run; CoachHint holds its tongue until the player has shown
          they need it. Suppressed behind a modal, where a menu already has the
          player's attention and a second card on top is just noise. */}
      <FirstRunTour
        phase={phase}
        suppressed={view !== null}
        touchControls={touchControls}
      />
      {view === null && <CoachHint phase={phase} />}
      {runPanel === "failed" && (
        <Overlay
          className="failure-backdrop"
          panelClassName="portals-failure"
          labelledBy="portals-failed-title"
        >
          <div className="impact-stamp">{failureStamp}</div>
          <h2 id="portals-failed-title">{failure}</h2>
          {/* "FELL OUT" alone does not say what to do differently. DeathNote
              names the trap that ended it, who added it, and how many runs it
              has taken, and offers the inspector for how it behaves. */}
          {/* The controller has reported progress every frame since the start
              and no failure screen ever showed it, so a run that died at 12%
              and one that died at 88% produced the same card. */}
          <RunProgressNote percent={runProgress} />
          <DeathNote contact={deathCause} />
          <button className="button danger huge" onClick={() => void start()}>
            Try again
          </button>
          <div className="portals-buttons">
            <button className="button secondary" onClick={() => openView("menu")}>
              Main menu
            </button>
          </div>
        </Overlay>
      )}
      {runPanel === "finished" && (
        <Overlay
          labelledBy="portals-finished-title"
          decoration={
            <div className="confetti-burst" aria-hidden="true">
              {Array.from({ length: 64 }, (_, index) => <i key={index} style={{ "--piece": index } as React.CSSProperties} />)}
            </div>
          }
        >
          <div className="eyebrow">IMPOSSIBLY</div>
          <h2 id="portals-finished-title">YOU SURVIVED</h2>
          <div className="finish-time">{format(elapsed)}</div>
          <LeaderboardPanel
            depth={challenge.depth}
            board={board}
            loading={boardLoading}
            playerId={player?.playerId ?? null}
            submitStatus={submitStatus}
            onSignIn={() => void handleSignIn()}
            onRetry={() => void loadBoard(challenge.depth)}
          />
          <button
            className="button primary huge"
            onClick={() => offered ? setPhase("choosing_trap") : void copyChallengeMessage()}
          >
            {offered ? "Make it worse" : "Share the final form"}
          </button>
          <div className="portals-buttons">
            {!offered && (
              <button className="button secondary" onClick={() => void fresh()}>
                Start a new disaster
              </button>
            )}
            <button className="button secondary" onClick={() => openView("menu")}>
              Main menu
            </button>
          </div>
        </Overlay>
      )}
      {runPanel === "paused" && (
        <Overlay labelledBy="portals-pause-title">
          <div className="eyebrow">PAUSED</div>
          <h2 id="portals-pause-title">The chaos will wait.</h2>
          <p className="portals-lede">
            Disaster {challenge.depth} · {format(elapsed)} on the clock
          </p>
          {/* Pause used to be a dead end: Resume was the only control, so the
              menu was unreachable once a run started, and there was no way to
              reach the settings or read the controls from here at all. */}
          <div className="portals-buttons">
            <button className="button primary huge" onClick={resume}>
              Resume
            </button>
            <button className="button secondary" onClick={() => openView("settings")}>
              Settings
            </button>
            <button className="button secondary" onClick={() => openView("controls")}>
              How to play
            </button>
            <button className="button secondary" onClick={() => void restart()}>
              Restart this attempt
            </button>
            <button className="button secondary" onClick={() => openView("menu")}>
              Main menu
            </button>
          </div>
        </Overlay>
      )}
      {runPanel === "choosing_trap" && offered && (
        <Overlay labelledBy="portals-choice-title">
          <div className="eyebrow">YOUR REWARD</div>
          <h2 id="portals-choice-title">Pick one awful thing.</h2>
          <div className="portals-choice">
            {offered.map((type) => {
              const usable = placeableOffers.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => choose(type)}
                  disabled={!usable}
                  {...(usable ? {} : { "aria-describedby": `no-room-${type}` })}
                >
                  <TrapIcon type={type} />
                  <span>
                    <strong>{TRAP_CATALOG[type].displayName}</strong>
                    <br />
                    {usable ? (
                      <small>{TRAP_CATALOG[type].shortDescription}</small>
                    ) : (
                      <small id={`no-room-${type}`}>No room left for this one.</small>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {/* The one real decision in the game was a flavour pick: three names
              and a joke each, with no way to learn what a soap slick actually
              does to a runner before committing to it. The inspector was built
              for this screen and left unmounted. */}
          <TrapDetailsRow traps={offered} />
          {placeableOffers.length === 0 && (
            // Every offer is unplaceable, so there is nothing to pick and no
            // other way out of this panel. The Next edition has the same
            // escape at GameOverlays.tsx; without it a Portals player loses a
            // completed run with only the back button.
            <button className="button primary" onClick={endChain}>
              Finish the chain here
            </button>
          )}
          {/* choose() sets this when an offer goes stale between the panel
              rendering and the click, and nothing on this screen showed it. */}
          <p className="portals-notice" role="status" aria-live="polite">
            {notice}
          </p>
        </Overlay>
      )}
      {(runPanel === "placing_trap" || runPanel === "publishing") && placement && (
        <aside className="panel portals-panel-bottom">
          <div className="eyebrow">PUT IT SOMEWHERE TERRIBLE</div>
          <h2>{TRAP_CATALOG[placement.type].displayName}</h2>
          <p
            className={
              validation?.valid ? "validation valid" : "validation invalid"
            }
          >
            {validation?.valid ? "✓ Valid placement" : validation?.message}
          </p>
          <div className="placement-actions">
            <button
              className="button secondary"
              onClick={() =>
                setPlacement({
                  ...placement,
                  rotationQuarterTurns: ((placement.rotationQuarterTurns + 3) %
                    4) as 0 | 1 | 2 | 3,
                })
              }
            >
              ↶ Rotate
            </button>
            <button
              className="button secondary"
              onClick={() =>
                setPlacement({
                  ...placement,
                  rotationQuarterTurns: ((placement.rotationQuarterTurns + 1) %
                    4) as 0 | 1 | 2 | 3,
                })
              }
            >
              Rotate ↷
            </button>
          </div>
          <button
            className="button primary"
            disabled={!validation?.valid || phase === "publishing"}
            onClick={() => void publish()}
          >
            {phase === "publishing" ? "Making it worse…" : "Add this trap"}
          </button>
          {/* The offer is still standing, so changing your mind costs nothing.
              Escape does the same thing. */}
          <button
            className="text-button"
            disabled={phase === "publishing" || !offered}
            onClick={() => {
              setPlacement(null);
              setPhase("choosing_trap");
            }}
          >
            Pick a different trap
          </button>
        </aside>
      )}
      {runPanel === "sharing" && result && (
        <Overlay
          labelledBy="portals-sharing-title"
          decoration={
            <div className="confetti-burst" aria-hidden="true">
              {Array.from({ length: 48 }, (_, index) => <i key={index} style={{ "--piece": index } as React.CSSProperties} />)}
            </div>
          }
        >
          <div className="eyebrow">THE CONSEQUENCE</div>
          {/* The headline used to be the percentage, which on a shallow chain
              is a single digit. The score is a RELATIVE drop in survival odds,
              small early by construction - 4% at depth 0, 13% at depth 2 - so
              leading with it hands a first-time player a deflating number for
              the thing the whole game exists to produce. */}
          <h2 id="portals-sharing-title">{CONSEQUENCE_HEADLINE}</h2>
          <p>
            Your{" "}
            {TRAP_CATALOG[
              result.challenge.addedTrap!.type
            ].displayName.toLowerCase()}{" "}
            is disaster {result.challenge.depth} in this chain.
          </p>
          <p className="worse-caption">
            It cuts the next runner&rsquo;s chances by{" "}
            <span className="worse-number">{result.estimatedWorsePercent}%</span>.
          </p>
          <p className="portals-share-warning">
            Portals runs this build in a secure static sandbox, so player-made
            chains persist in this browser. The full web deployment supports
            cross-device challenge links.
          </p>
          <div className="portals-buttons">
            {/* Sending it on IS the win, so it is the loud one. It was the
                secondary under a red "Play your version". */}
            <button
              className="button danger huge"
              onClick={() => void copyChallengeMessage()}
            >
              Copy challenge message
            </button>
            <button
              className="button secondary"
              onClick={() => open(result.challenge)}
            >
              Play your version
            </button>
            <button className="text-button" onClick={quitToTitle}>
              Back to title
            </button>
          </div>
          <p className="portals-notice" role="status" aria-live="polite">
            {notice}
          </p>
        </Overlay>
      )}
      {view === "menu" && (
        <Overlay labelledBy="portals-menu-title" panelClassName="portals-menu">
          {menuBody}
        </Overlay>
      )}
      {shellDialogs}
    </main>
  );
}
