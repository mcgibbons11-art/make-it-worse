"use client";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRepository } from "@/lib/repository/createRepository";
import {
  CHALLENGE_LINK_PARAM,
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { buildShareCopy } from "@/lib/game/share-copy";
import { getInput, isInterfaceTarget, resetInput } from "@/lib/game/input";
import { generateShareCard } from "@/lib/game/share-card";
import { RollingClipRecorder } from "@/lib/clip/RollingClipRecorder";
import { challengeTrack, firstLegalPlacement } from "@/lib/game/trap-choice";
import { placementFromWorld } from "@/lib/game/placement";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  HazardContact,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { useGameStore } from "@/stores/game-store";
import { useSettingsStore } from "@/stores/settings-store";
import { AudioManager } from "@/lib/audio/AudioManager";
import { musicSceneForPhase } from "@/lib/audio/music";
import { ATTEMPT_LIMIT_MS } from "@/lib/game/constants";
import type { BuiltTrack } from "@/lib/game/track";
import {
  COUNTDOWN_FROM,
  COUNTDOWN_URGENT_FROM,
  ChallengeIntro,
  ErrorCard,
  FailureCard,
  FinishCard,
  GameHud,
  PauseCard,
  PlacementPanel,
  SharePanel,
  TrapChoicePanel,
  formatTime,
} from "@/components/hud/GameOverlays";
import { AvatarCustomizer } from "@/components/hud/AvatarCustomizer";
import { MobileControls } from "@/components/hud/MobileControls";
import { SettingsPanel } from "@/components/hud/SettingsPanel";
import { PersonalBestPill, ProgressionRibbon } from "@/components/hud/ProgressionHud";
import { useProgressionStore } from "@/stores/progression-store";
const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="canvas-loading">
      <span />
      Assembling the worst apartment…
    </div>
  ),
});
interface SerializableTestState {
  phase: string;
  slug: string | null;
  depth: number;
  offeredTraps: readonly TrapType[] | null;
  selectedTrap: TrapType | null;
  placement: TrapPlacementInput | null;
  trapCount: number;
  progress: number;
  inputZ: number;
  jumpPressSequence: number;
  jumpConsumedSequence: number;
  jumpAppliedSequence: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  grounded: boolean;
  holdingObject: boolean;
  releasedObjectSpeed: number;
  lastHazardType: TrapType | null;
}
declare global {
  interface Window {
    __MIW_TEST__?: {
      getState(): SerializableTestState;
      completeAttempt(): Promise<void>;
      failAttempt(cause?: string): Promise<void>;
      selectTrap(type: TrapType): void;
      placeTrap(zoneId: string, offsetX?: number, offsetZ?: number): void;
      confirmPlacement(): Promise<void>;
      resetDemoData(): Promise<void>;
    };
  }
}
/** What a screen reader should say when the game reaches each phase. */
function phaseAnnouncement(game: {
  phase: string;
  failureMessage: string;
  elapsedMs: number;
  offeredTraps: readonly TrapType[] | null;
}): string {
  switch (game.phase) {
    case "playing":
      return "Run started.";
    case "failed":
      return `Run over. ${game.failureMessage} Press Enter to try again.`;
    case "finished":
      return `You survived in ${formatTime(game.elapsedMs)}. ${
        game.offeredTraps
          ? "Choose a trap to add."
          : "This chain has reached its final form."
      }`;
    case "choosing_trap":
      return game.offeredTraps
        ? `Choose one of three traps: ${game.offeredTraps
            .map((type) => TRAP_CATALOG[type].displayName)
            .join(", ")}.`
        : "";
    case "placing_trap":
      return "Placing the trap. Use the rotate buttons, then confirm.";
    case "publishing":
      return "Publishing your version.";
    case "sharing":
      return "Published. Your challenge link is ready to share.";
    case "paused":
      return "Paused.";
    default:
      return "";
  }
}

export default function GameClient({ slug }: { slug: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const primaryRepository = useMemo(() => createRepository(), []);
  const sharedPayload = search.get(CHALLENGE_LINK_PARAM);
  // A self-contained room is deliberately played in the local chain engine.
  // The global repository owns discovery/metrics, while DemoRepository owns
  // the recipient's child rounds and authored geometry exactly as Portals does.
  const repository = useMemo(
    () => sharedPayload ? new DemoRepository() : primaryRepository,
    [primaryRepository, sharedPayload],
  );
  const game = useGameStore();
  const settings = useSettingsStore();
  const recordProgressRun = useProgressionStore((state) => state.recordRunEnd);
  const recordProgressTrap = useProgressionStore((state) => state.recordTrapPlaced);
  const [assetsReady, setAssetsReady] = useState(false);
  const set = game.set;
  const samples = useRef<DecodedGhostSample[]>([]);
  const [recorder] = useState(() => new RollingClipRecorder());
  const [clipBlob, setClipBlob] = useState<Blob | null>(null);
  const hazard = useRef<HazardContact | null>(null);
  const interaction = useRef({ holdingObject: false, releasedObjectSpeed: 0 });
  const finalizing = useRef(false);
  const starting = useRef(false);
  const progress = useRef(0);
  // Banked out of the ref when the run ends, because the failure card renders
  // from state and a ref read there is whatever the next attempt has already
  // reset it to.
  const [reached, setReached] = useState(0);
  const [deathCause, setDeathCause] = useState<HazardContact | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [runtimeTrack, setRuntimeTrack] = useState<BuiltTrack | null>(null);
  const shareKey = useRef(crypto.randomUUID());
  useEffect(() => {
    AudioManager.setMuted(settings.muted);
    AudioManager.setVolume(settings.volume);
  }, [settings.muted, settings.volume]);
  useEffect(() => {
    // Safari, and iOS in particular, wants the AudioContext created or resumed
    // inside the gesture task. The game's first sound is scheduled after an
    // await, which is a different task, so it can be swallowed entirely.
    const unlock = () => AudioManager.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
      set({ phase: "fatal_error", error: "This browser cannot start the 3D game. Try an updated Chrome, Safari, Firefox, or Edge browser." });
    }
  }, [set]);
  useEffect(() => {
    if (game.phase !== "playing") return;
    const timer = window.setTimeout(() => {
      const canvas = document.querySelector("canvas.game-canvas");
      if (canvas instanceof HTMLCanvasElement && settings.quality !== "low") recorder.start(canvas);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [game.attemptSerial, game.phase, recorder, settings.quality]);
  useEffect(() => () => recorder.dispose(), [recorder]);
  // Drop focus when play starts, or the run is unplayable with a mouse.
  //
  // You reach gameplay by CLICKING a button, and that button keeps focus. Every
  // movement key is read through isInterfaceTarget, which counts a focused
  // BUTTON as the interface and returns before the key is recorded - so WASD and
  // Space were swallowed for the whole attempt and the runner never left spawn.
  // Two agents lost an hour to this tonight, each concluding their input harness
  // was at fault; it reproduces with a real keyboard and a real mouse.
  //
  // Synthetic KeyboardEvents dispatched at `window` DO work, because window is
  // not an HTMLElement and the guard lets them through, which is why automated
  // driving looked fine while hand-playing did not.
  //
  // The Portals shell already carries this exact effect, added when the same
  // symptom appeared on resuming from pause. This edition never got it.
  useEffect(() => {
    // Buttons and text fields can own keyup after a run ends. Clear the shared
    // movement snapshot whenever the phase/attempt changes so that held motion
    // from the old run cannot launch the next runner off its spawn platform.
    resetInput();
    if (game.phase !== "playing") return;
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }, [game.attemptSerial, game.phase]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden && useGameStore.getState().phase === "playing") {
        const current = useGameStore.getState();
        set({ phase: "paused", elapsedMs: current.startedAt ? performance.now() - current.startedAt : current.elapsedMs });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [set]);
  useEffect(() => {
    let cancelled = false;
    const payload = sharedPayload;
    const load = async () => {
      const profile = await repository.ensureGuest();
      let challenge: ChallengeDTO;
      let authoredTrack: BuiltTrack | null = null;
      if (payload && repository.importChallenge) {
        const decoded = decodeChallengeLink(payload);
        if (decoded.slug !== slug) throw new Error("CHALLENGE_LINK_INVALID");
        authoredTrack = decodeChallengeRuntimeTrack(payload);
        challenge = await repository.importChallenge(decoded, authoredTrack ?? undefined);
      } else try {
        challenge = await repository.getChallenge(slug);
        authoredTrack = await repository.getChallengeRuntimeTrack?.(challenge.slug) ?? null;
      } catch (error) {
        // A shared link carries the whole level, so a challenge this browser
        // has never stored is the normal case rather than a failure.
        if (!payload || !repository.importChallenge) throw error;
        const decoded = decodeChallengeLink(payload);
        if (decoded.slug !== slug) throw new Error("CHALLENGE_LINK_INVALID");
        authoredTrack = decodeChallengeRuntimeTrack(payload);
        challenge = await repository.importChallenge(decoded, authoredTrack ?? undefined);
      }
      if (cancelled) return;
      setRuntimeTrack(authoredTrack);
      set({ profile, challenge, phase: "intro", error: null });
      const token = search.get("s");
      if (token)
        await repository.recordShareOpen({
          shareToken: token,
          challengeSlug: slug,
        });
      const mapId = search.get("map");
      const versionId = search.get("version");
      if (mapId && versionId)
        void primaryRepository.recordCustomMapEvent?.(mapId, versionId, "impression").catch(() => false);
    };
    void load().catch((error: unknown) => {
      if (cancelled) return;
      const code = error instanceof Error ? error.message : "";
      set({
        phase: "fatal_error",
        error:
          code === "CHALLENGE_LINK_INVALID"
            ? "That challenge link is damaged. Ask your friend to send it again."
            : code === "CHALLENGE_NOT_FOUND"
              ? "That challenge link is missing its level data. Ask your friend to copy the whole link."
              : "The challenge could not be loaded. Your saved run is untouched.",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [primaryRepository, repository, search, set, sharedPayload, slug]);
  useEffect(() => {
    if (game.phase !== "playing" || game.startedAt === null) return;
    const timer = window.setInterval(
      () => set({ elapsedMs: performance.now() - game.startedAt! }),
      50,
    );
    return () => window.clearInterval(timer);
  }, [game.phase, game.startedAt, set]);
  // Whole seconds left against the cap PlayerController enforces, and null
  // whenever the clock is not running, so the tick below cannot fire off a
  // stale reading from a paused or finished run.
  const secondsLeft =
    game.phase === "playing"
      ? Math.max(0, Math.ceil((ATTEMPT_LIMIT_MS - game.elapsedMs) / 1000))
      : null;
  useEffect(() => {
    // Zero is the timeout itself, which has its own sound.
    if (secondsLeft === null || secondsLeft > COUNTDOWN_FROM || secondsLeft === 0)
      return;
    AudioManager.countdown(secondsLeft <= COUNTDOWN_URGENT_FROM);
  }, [secondsLeft]);
  // The score, from the same phase the rest of the interface reads. Computed in
  // render rather than in the effect so the effect fires on the four or five
  // times the scene actually changes, not on all twelve hundred clock ticks.
  const musicScene = musicSceneForPhase(
    game.phase,
    secondsLeft === null ? undefined : secondsLeft * 1000,
  );
  useEffect(() => {
    AudioManager.setMusicScene(musicScene);
  }, [musicScene]);
  useEffect(() => {
    if (game.phase !== "playing") return;
    // The room tone the game has shipped and never played. Held for the whole
    // run and released with it, so the failure card lands in silence.
    AudioManager.startAmbience();
    return () => AudioManager.stopAmbience();
  }, [game.phase]);
  const startAttempt = useCallback(async () => {
    // Phase only leaves "failed" once the repository resolves, so keyboard
    // auto-repeat on the failure card fired a fresh call every keydown. Each
    // minted its own idempotency key, so the guard there protected nothing and
    // one held Enter added ~10 attempts and diluted the survival rate.
    if (!game.challenge || starting.current) return;
    starting.current = true;
    finalizing.current = false;
    setClipBlob(null);
    samples.current = [];
    hazard.current = null;
    progress.current = 0;
    try {
      const result = await repository.startAttempt({
        challengeSlug: game.challenge.slug,
        clientSessionId: crypto.randomUUID(),
        deviceClass: matchMedia("(max-width: 700px)").matches
          ? "mobile"
          : "desktop",
        buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev",
        idempotencyKey: crypto.randomUUID(),
        ...(search.get("s") ? { shareToken: search.get("s")! } : {}),
      });
      set({
        attemptId: result.attemptId,
        phase: "playing",
        attemptSerial: game.attemptSerial + 1,
        startedAt: performance.now(),
        elapsedMs: 0,
        offeredTraps: null,
        failureMessage: "",
        error: null,
      });
      const mapId = search.get("map");
      const versionId = search.get("version");
      if (mapId && versionId)
        void primaryRepository.recordCustomMapEvent?.(mapId, versionId, "start").catch(() => false);
    } catch (error) {
      // Called as void startAttempt() from a click and from Enter, so a
      // rejection here was an unhandled rejection and a dead button.
      set({
        error:
          error instanceof Error && error.message
            ? error.message
            : "Could not start the run. Try again.",
      });
    } finally {
      starting.current = false;
    }
  }, [game.attemptSerial, game.challenge, primaryRepository, repository, search, set]);
  const finishAttempt = useCallback(async () => {
    if (finalizing.current || !game.attemptId || !game.challenge) return;
    finalizing.current = true;
    void recorder.stop().then(setClipBlob);
    const elapsed = Math.max(
      100,
      game.startedAt === null
        ? game.elapsedMs
        : performance.now() - game.startedAt,
    );
    const trace = encodeGhostTrace(
      samples.current.length
        ? samples.current
        : [{ x: 0, y: 1.25, z: 1.2, yaw: 0, flags: 1 }],
    );
    try {
      const result = await repository.finishAttempt({
        attemptId: game.attemptId,
        outcome: "completed",
        durationMs: Math.round(elapsed),
        maxProgress: 1,
        deathTrapInstanceId: null,
        ghostTrace: trace,
        idempotencyKey: crypto.randomUUID(),
      });
      set({
        phase: "finished",
        elapsedMs: elapsed,
        offeredTraps: result.offeredTraps,
      });
      recordProgressRun({
        challengeSlug: game.challenge.slug,
        depth: game.challenge.depth,
        outcome: "completed",
        durationMs: Math.round(elapsed),
        progress: 1,
        hazardTrapType: null,
      });
      AudioManager.finish();
      navigator.vibrate?.([45, 40, 70]);
      const mapId = search.get("map");
      const versionId = search.get("version");
      if (mapId && versionId)
        void primaryRepository.recordCustomMapEvent?.(mapId, versionId, "clear").catch(() => false);
    } catch (error) {
      // Leaving the phase at "playing" froze the runner: the controller had
      // already set finalized, so movement, the exit check, the kill plane and
      // the timeout were all dead while the HUD clock kept counting. Move to a
      // phase the player can act from.
      finalizing.current = false;
      set({
        phase: "failed",
        failureMessage:
          error instanceof Error && error.message
            ? `You made it, but the run could not be saved. ${error.message}`
            : "You made it, but the run could not be saved.",
      });
    }
  }, [
    game.attemptId,
    game.challenge,
    game.elapsedMs,
    game.startedAt,
    recorder,
    primaryRepository,
    recordProgressRun,
    repository,
    search,
    set,
  ]);
  const failAttempt = useCallback(
    async (outcome: "fell" | "timeout" | "reset" = "fell") => {
      if (finalizing.current || !game.attemptId || !game.challenge) return;
      finalizing.current = true;
      void recorder.stop().then(setClipBlob);
      const elapsed = Math.max(
        0,
        game.startedAt === null
          ? game.elapsedMs
          : performance.now() - game.startedAt,
      );
      const recent =
        hazard.current &&
        performance.now() - hazard.current.contactedAtMs < 3500
          ? hazard.current
          : null;
      // The outcome argument used to be discarded, so choosing to reset told
      // you "The void got you." and stamped FELL OUT. Blaming the player for a
      // fall they chose not to have is the opposite of blameless.
      //
      // How far the run got used to be spliced into this sentence. It is a
      // number the player compares across attempts, so it belongs in a figure
      // they can find in the same place every time rather than at the end of a
      // sentence that changes with the cause of death.
      setReached(progress.current);
      setDeathCause(outcome === "reset" ? null : recent);
      const message =
        outcome === "reset"
          ? "You reset the run."
          : outcome === "timeout"
            ? "The clock ate your run."
            : recent
              ? `${recent.ownerName}’s ${TRAP_CATALOG[recent.trapType].displayName.toLowerCase()} got you.`
              : "The void got you.";
      void repository.finishAttempt({
        attemptId: game.attemptId,
        outcome,
        durationMs: Math.round(elapsed),
        maxProgress: progress.current,
        deathTrapInstanceId: recent?.trapInstanceId ?? null,
        ghostTrace: null,
        idempotencyKey: crypto.randomUUID(),
      });
      recordProgressRun({
        challengeSlug: game.challenge.slug,
        depth: game.challenge.depth,
        outcome,
        durationMs: Math.round(elapsed),
        progress: progress.current,
        hazardTrapType: recent?.trapType ?? null,
      });
      // Losing the run used to play the same thud as a bonk.
      AudioManager.fail();
      setTimeout(
        () =>
          set({ phase: "failed", elapsedMs: elapsed, failureMessage: message }),
        450,
      );
    },
    [
      game.attemptId,
      game.challenge,
      game.elapsedMs,
      game.startedAt,
      recorder,
      recordProgressRun,
      repository,
      set,
    ],
  );
  // This challenge's own course. A custom-track challenge whose zones were
  // searched against the fixed classic list picked a zone that did not exist in
  // it, placing the trap at the wrong coordinates and producing a link the
  // recipient could not decode.
  const track = useMemo(
    () => runtimeTrack ?? challengeTrack(game.challenge),
    [game.challenge, runtimeTrack],
  );
  const selectTrap = useCallback(
    (type: TrapType) => {
      if (!game.challenge) return;
      const placement = firstLegalPlacement(track, type, game.challenge.traps);
      if (!placement) {
        set({ error: "No safe placement remains for that trap." });
        return;
      }
      set({ selectedTrap: type, placement, phase: "placing_trap", error: null });
    },
    [game.challenge, set, track],
  );
  // The offer and the placement now come from one search, so a dead offer means
  // the two disagree: on Supabase the offer is chosen server side against the
  // classic zone table, which knows nothing about composed tracks. Showing the
  // card as unusable beats a button whose only effect is an error message.
  const placeableChoices = useMemo(() => {
    const traps = game.challenge?.traps;
    if (!traps || !game.offeredTraps) return [];
    return game.offeredTraps.filter((type) =>
      firstLegalPlacement(track, type, traps),
    );
  }, [game.challenge?.traps, game.offeredTraps, track]);
  // Demo challenges live only in the creator's browser, so the link has to
  // carry the level with it. A Supabase-backed challenge is already reachable
  // by slug and does not need the payload.
  const absoluteShareUrl = useCallback(
    (path: string, challenge: ChallengeDTO) => {
      const url = new URL(path, window.location.origin);
      if (repository.mode === "demo")
        url.searchParams.set(
          CHALLENGE_LINK_PARAM,
          // The runner travels with the level: the recipient plays as the
          // sender's figure, so a link without it arrives as a stranger.
          encodeChallengeLink(challenge, settings.avatar, runtimeTrack),
        );
      return url.toString();
    },
    [repository.mode, runtimeTrack, settings.avatar],
  );
  const confirmPlacement = useCallback(async () => {
    if (!game.challenge || !game.attemptId || !game.placement) return;
    set({ phase: "publishing" });
    try {
      const result = await repository.publishChild({
        parentSlug: game.challenge.slug,
        attemptId: game.attemptId,
        placement: game.placement,
        idempotencyKey: crypto.randomUUID(),
      });
      setShareUrl(
        absoluteShareUrl(result.attributedShareUrl, result.challenge),
      );
      recordProgressTrap(game.placement.type);
      set({ publishResult: result, phase: "sharing" });
      AudioManager.publish();
    } catch (error) {
      set({
        phase: "placing_trap",
        error:
          error instanceof Error
            ? error.message
            : "Publishing failed. Your winning run is safe.",
      });
    }
  }, [
    absoluteShareUrl,
    game.attemptId,
    game.challenge,
    game.placement,
    repository,
    recordProgressTrap,
    set,
  ]);
  const createAttributedShare = useCallback(
    async (channel: "web_share" | "copy_link") => {
      if (!game.publishResult) return shareUrl;
      const result = await repository.createShare({
        challengeSlug: game.publishResult.challenge.slug,
        channel,
        idempotencyKey: shareKey.current,
      });
      const absolute = absoluteShareUrl(
        result.url,
        game.publishResult.challenge,
      );
      setShareUrl(absolute);
      const mapId = search.get("map");
      const versionId = search.get("version");
      if (mapId && versionId)
        void primaryRepository.recordCustomMapEvent?.(mapId, versionId, "share").catch(() => false);
      return absolute;
    },
    [absoluteShareUrl, game.publishResult, primaryRepository, repository, search, shareUrl],
  );
  const send = useCallback(async () => {
    if (!game.publishResult) return;
    const url = await createAttributedShare("web_share");
    const text = buildShareCopy(game.publishResult.challenge, url);
    if (navigator.share) {
      try {
        const card = await generateShareCard(game.publishResult.challenge);
        const files = navigator.canShare?.({ files: [card] }) ? [card] : null;
        await navigator.share({
          title: "MAKE IT WORSE",
          text,
          url,
          ...(files ? { files } : {}),
        });
        setToast("Challenge ready to ruin a friendship.");
        return;
      } catch {
        /* user cancelled or share sheet unavailable */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast("Challenge copy copied.");
    } catch {
      setToast("Select and copy the link below.");
    }
  }, [createAttributedShare, game.publishResult]);
  const shareClip = useCallback(async () => {
    if (!clipBlob) return;
    const clip = new File([clipBlob], "make-it-worse.webm", {
      type: clipBlob.type || "video/webm",
    });
    if (navigator.share && navigator.canShare?.({ files: [clip] })) {
      try {
        await navigator.share({
          title: "MAKE IT WORSE",
          text: "This apartment had one job.",
          url: window.location.href,
          files: [clip],
        });
        setToast("Clip sent into the world.");
        return;
      } catch {
        /* user cancelled or share sheet unavailable */
      }
    }
    const downloadUrl = URL.createObjectURL(clipBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = clip.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setToast("Clip downloaded.");
  }, [clipBlob]);
  const copy = useCallback(async () => {
    if (!game.publishResult) return;
    const url = await createAttributedShare("copy_link");
    try {
      await navigator.clipboard.writeText(url);
      setToast("Challenge link copied.");
    } catch {
      setToast("Clipboard blocked. Select the URL field.");
    }
  }, [createAttributedShare, game.publishResult]);
  const shareFinal = useCallback(async () => {
    const challenge = game.challenge;
    if (!challenge) return;
    // A demo challenge exists only in its creator's browser, so the level has
    // to travel in the link. Every other share path goes through
    // absoluteShareUrl for exactly that reason; this one copied the raw address
    // bar, which in demo mode is a slug the recipient's machine has never heard
    // of. The deepest, most-worth-sharing run in the game produced the one dead
    // link in it.
    const url = absoluteShareUrl(`/c/${challenge.slug}`, challenge);
    const text = `I reached the final form of MAKE IT WORSE: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "MAKE IT WORSE — FINAL FORM", text, url });
        return;
      } catch {
        /* share sheet cancelled or unavailable */
      }
    }
    await navigator.clipboard.writeText(text);
    setToast("Final-form challenge copied.");
  }, [absoluteShareUrl, game.challenge]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Typing a name containing R, M or E used to reset the live attempt,
      // toggle mute, or rotate the trap. Enter on a focused button fired both
      // the button and the shortcut below, starting two attempts at once.
      if (isInterfaceTarget(event.target)) return;
      // Each of these mirrors a HUD button that makes a sound when pressed, so
      // the shortcut has to make it too or the keyboard is the quiet way to
      // play. Muting is deliberately absent: its own cue would be the last
      // thing heard, or the first, depending on which way it was going.
      if (event.code === "KeyR" && game.phase === "playing") {
        AudioManager.click();
        void failAttempt("reset");
      }
      if (event.code === "Escape") {
        if (game.phase === "playing") {
          AudioManager.click();
          set({
            phase: "paused",
            elapsedMs: game.startedAt
              ? performance.now() - game.startedAt
              : game.elapsedMs,
          });
        } else if (game.phase === "paused") {
          AudioManager.click();
          set({
            phase: "playing",
            startedAt: performance.now() - game.elapsedMs,
          });
        }
      }
      if (event.code === "Enter" && game.phase === "failed") {
        AudioManager.click();
        void startAttempt();
      }
      if (event.code === "KeyM") settings.toggleMuted();
      if (
        event.code === "KeyQ" &&
        game.phase === "placing_trap" &&
        game.placement
      )
        set({
          placement: {
            ...game.placement,
            rotationQuarterTurns: ((game.placement.rotationQuarterTurns + 3) %
              4) as 0 | 1 | 2 | 3,
          },
        });
      if (
        event.code === "KeyE" &&
        game.phase === "placing_trap" &&
        game.placement
      )
        set({
          placement: {
            ...game.placement,
            rotationQuarterTurns: ((game.placement.rotationQuarterTurns + 1) %
              4) as 0 | 1 | 2 | 3,
          },
        });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    failAttempt,
    game.elapsedMs,
    game.phase,
    game.placement,
    game.startedAt,
    set,
    settings,
    startAttempt,
  ]);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E_TEST_MODE !== "1") return;
    window.__MIW_TEST__ = {
      getState: () => ({
        phase: game.phase,
        slug: game.challenge?.slug ?? null,
        depth: game.challenge?.depth ?? 0,
        offeredTraps: game.offeredTraps,
        selectedTrap: game.selectedTrap,
        placement: game.placement,
        trapCount: game.challenge?.traps.length ?? 0,
        progress: progress.current,
        inputZ: getInput().z,
        jumpPressSequence: getInput().jumpPressSequence,
        jumpConsumedSequence: getInput().jumpConsumedSequence,
        jumpAppliedSequence: getInput().jumpAppliedSequence,
        playerX: samples.current.at(-1)?.x ?? 0,
        playerY: samples.current.at(-1)?.y ?? 0,
        playerZ: samples.current.at(-1)?.z ?? 0,
        grounded: Boolean((samples.current.at(-1)?.flags ?? 0) & 1),
        holdingObject: interaction.current.holdingObject,
        releasedObjectSpeed: interaction.current.releasedObjectSpeed,
        lastHazardType: hazard.current?.trapType ?? null,
      }),
      completeAttempt: finishAttempt,
      failAttempt: async () => failAttempt("fell"),
      selectTrap,
      placeTrap: (zoneId, offsetX = 0, offsetZ = 0) => {
        if (game.selectedTrap)
          set({
            placement: {
              type: game.selectedTrap,
              zoneId,
              offsetX,
              offsetZ,
              rotationQuarterTurns: 0,
            },
          });
      },
      confirmPlacement,
      resetDemoData: async () => {
        await repository.resetDemoData?.();
        location.assign("/");
      },
    };
    return () => {
      delete window.__MIW_TEST__;
    };
  }, [
    confirmPlacement,
    failAttempt,
    finishAttempt,
    game.challenge,
    game.offeredTraps,
    game.phase,
    game.placement,
    game.selectedTrap,
    repository,
    selectTrap,
    set,
  ]);
  if (game.phase === "fatal_error")
    return (
      <ErrorCard
        message={game.error ?? "Unknown runtime error."}
        onRetry={() => location.reload()}
      />
    );
  if (!game.challenge)
    return (
      <div className="canvas-loading">
        <span />
        Loading this disaster…
      </div>
    );
  const copyText = game.publishResult
    ? buildShareCopy(
        game.publishResult.challenge,
        // The fallback runs before createShare resolves, so it has to carry the
        // level too. A bare /c/<slug> would be a dead link for the recipient.
        shareUrl ||
          absoluteShareUrl(
            `/c/${game.publishResult.challenge.slug}`,
            game.publishResult.challenge,
          ),
      )
    : "";
  return (
    <main className="game-shell">
      <GameCanvas
        challenge={game.challenge}
        phase={game.phase}
        attemptSerial={game.attemptSerial}
        startedAt={game.startedAt ?? 0}
        placement={game.placement}
        ghostEnabled={settings.ghostEnabled}
        recordSample={(sample) => {
          if (samples.current.length < 900) samples.current.push(sample);
        }}
        onProgress={(value) => {
          progress.current = value;
        }}
        onInteraction={(value) => {
          interaction.current = value;
        }}
        onFinish={() => void finishAttempt()}
        onFail={(outcome) => void failAttempt(outcome)}
        onHazard={(value) => {
          hazard.current = value;
        }}
        onSelectZone={(zoneId) => {
          if (game.placement)
            set({
              placement: { ...game.placement, zoneId, offsetX: 0, offsetZ: 0 },
            });
        }}
        onMovePlacement={(zoneId, worldX, worldZ) => {
          if (!game.placement) return;
          set({
            placement: placementFromWorld(
              game.placement.type,
              zoneId,
              worldX,
              worldZ,
              game.placement.rotationQuarterTurns,
              track,
            ),
          });
        }}
        onAssetsReady={() => setAssetsReady(true)}
      />
      {game.phase === "intro" && (
        <ChallengeIntro
          challenge={game.challenge}
          assetsReady={assetsReady}
          playerName={game.profile?.displayName}
          onStart={() => void startAttempt()}
          onSettings={() => setSettingsOpen(true)}
        />
      )}{" "}
      {game.phase === "playing" && (
        <>
          <GameHud
            elapsedMs={game.elapsedMs}
            depth={game.challenge.depth}
            onReset={() => void failAttempt("reset")}
            onPause={() =>
              // Escape and the visibility handler both bank the clock here; the
              // button did not, so every pause taken with the mouse threw away
              // the run time since the last HUD tick, and a pause inside the
              // first tick threw away the whole run.
              set({
                phase: "paused",
                elapsedMs: game.startedAt
                  ? performance.now() - game.startedAt
                  : game.elapsedMs,
              })
            }
            onSettings={() => setSettingsOpen(true)}
          />
          <PersonalBestPill challengeSlug={game.challenge.slug} />
          <MobileControls />
        </>
      )}
      {game.phase === "paused" && (
        <PauseCard
          onResume={() =>
            set({
              phase: "playing",
              startedAt: performance.now() - game.elapsedMs,
            })
          }
          onHome={() => router.push("/")}
        />
      )}{" "}
      {game.phase === "failed" && (
        <FailureCard
          message={game.failureMessage}
          attempts={game.attemptSerial}
          progress={reached}
          contact={deathCause}
          onRetry={() => void startAttempt()}
          footer={<ProgressionRibbon />}
          {...(clipBlob ? { onShareClip: () => void shareClip() } : {})}
        />
      )}{" "}
      {game.phase === "finished" && (
        <FinishCard
          elapsedMs={game.elapsedMs}
          terminal={!game.offeredTraps}
          onShareFinal={() => void shareFinal()}
          onContinue={() => {
            if (game.offeredTraps) set({ phase: "choosing_trap" });
            else router.push("/");
          }}
          footer={<ProgressionRibbon />}
          {...(clipBlob ? { onShareClip: () => void shareClip() } : {})}
        />
      )}{" "}
      {game.phase === "choosing_trap" && game.offeredTraps && (
        <TrapChoicePanel
          choices={game.offeredTraps}
          placeable={placeableChoices}
          onSelect={selectTrap}
          onEndChain={() =>
            set({ phase: "finished", offeredTraps: null, error: null })
          }
        />
      )}{" "}
      {(game.phase === "placing_trap" || game.phase === "publishing") &&
        game.placement && (
          <PlacementPanel
            challenge={game.challenge}
            placement={game.placement}
            publishing={game.phase === "publishing"}
            onRotate={(delta) =>
              set({
                placement: {
                  ...game.placement!,
                  rotationQuarterTurns: ((game.placement!.rotationQuarterTurns +
                    delta +
                    4) %
                    4) as 0 | 1 | 2 | 3,
                },
              })
            }
            onBack={() =>
              set({
                phase: "choosing_trap",
                placement: null,
                selectedTrap: null,
              })
            }
            onConfirm={() => void confirmPlacement()}
          />
        )}{" "}
      {game.phase === "sharing" && game.publishResult && (
        <SharePanel
          result={game.publishResult}
          copy={copyText}
          url={shareUrl}
          onSend={() => void send()}
          onCopy={() => void copy()}
          onPlay={() => router.push(`/c/${game.publishResult!.challenge.slug}`)}
        />
      )}
      <SettingsPanel
        open={settingsOpen}
        {...(game.profile ? { profileName: game.profile.displayName } : {})}
        onUpdateProfile={async (displayName) => {
          const profile = await repository.updateProfile(displayName);
          set({ profile });
          setToast("Identity updated. Future traps carry the new name.");
        }}
        onClose={() => setSettingsOpen(false)}
      />
      <AvatarCustomizer />
      <div className="toast-region" aria-live="polite">
        {toast}
      </div>
      {/* Errors get their own assertive region: sharing one polite region with
          the toast meant a publish failure waited for a gap in speech. */}
      <div className="sr-only" role="alert">
        {game.error}
      </div>
      {/* Every phase change was silent for screen reader users. The spec asked
          for success and failure to be announced; only copy and errors were. */}
      <div className="sr-only" aria-live="assertive">
        {phaseAnnouncement(game)}
      </div>
    </main>
  );
}
