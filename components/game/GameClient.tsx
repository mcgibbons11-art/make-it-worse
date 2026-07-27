"use client";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRepository } from "@/lib/repository/createRepository";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { buildShareCopy } from "@/lib/game/share-copy";
import { getInput } from "@/lib/game/input";
import { generateShareCard } from "@/lib/game/share-card";
import { RollingClipRecorder } from "@/lib/clip/RollingClipRecorder";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { placementFromWorld, validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type {
  DecodedGhostSample,
  HazardContact,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { useGameStore } from "@/stores/game-store";
import { useSettingsStore } from "@/stores/settings-store";
import { AudioManager } from "@/lib/audio/AudioManager";
import {
  ChallengeIntro,
  ErrorCard,
  FailureCard,
  FinishCard,
  GameHud,
  PauseCard,
  PlacementPanel,
  SharePanel,
  TrapChoicePanel,
} from "@/components/hud/GameOverlays";
import { MobileControls } from "@/components/hud/MobileControls";
import { SettingsPanel } from "@/components/hud/SettingsPanel";
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
export default function GameClient({ slug }: { slug: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const repository = useMemo(() => createRepository(), []);
  const game = useGameStore();
  const settings = useSettingsStore();
  const [assetsReady, setAssetsReady] = useState(false);
  const set = game.set;
  const samples = useRef<DecodedGhostSample[]>([]);
  const [recorder] = useState(() => new RollingClipRecorder());
  const [clipBlob, setClipBlob] = useState<Blob | null>(null);
  const hazard = useRef<HazardContact | null>(null);
  const interaction = useRef({ holdingObject: false, releasedObjectSpeed: 0 });
  const finalizing = useRef(false);
  const progress = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const shareKey = useRef(crypto.randomUUID());
  useEffect(() => {
    AudioManager.setMuted(settings.muted);
    AudioManager.setVolume(settings.volume);
  }, [settings.muted, settings.volume]);
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
    void Promise.all([repository.ensureGuest(), repository.getChallenge(slug)])
      .then(async ([profile, challenge]) => {
        if (cancelled) return;
        set({ profile, challenge, phase: "intro", error: null });
        const token = search.get("s");
        if (token)
          await repository.recordShareOpen({
            shareToken: token,
            challengeSlug: slug,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          set({
            phase: "fatal_error",
            error:
              error instanceof Error && error.message === "CHALLENGE_NOT_FOUND"
                ? "That challenge does not exist in this browser. Local demo links stay on the device that created them."
                : "The challenge could not be loaded. Your saved run is untouched.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [repository, search, set, slug]);
  useEffect(() => {
    if (game.phase !== "playing" || game.startedAt === null) return;
    const timer = window.setInterval(
      () => set({ elapsedMs: performance.now() - game.startedAt! }),
      50,
    );
    return () => window.clearInterval(timer);
  }, [game.phase, game.startedAt, set]);
  const startAttempt = useCallback(async () => {
    if (!game.challenge) return;
    finalizing.current = false;
    setClipBlob(null);
    samples.current = [];
    hazard.current = null;
    progress.current = 0;
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
    AudioManager.click();
  }, [game.attemptSerial, game.challenge, repository, search, set]);
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
      AudioManager.finish();
      navigator.vibrate?.([45, 40, 70]);
    } catch (error) {
      finalizing.current = false;
      set({
        error:
          error instanceof Error
            ? error.message
            : "Could not save the successful run.",
      });
    }
  }, [
    game.attemptId,
    game.challenge,
    game.elapsedMs,
    game.startedAt,
    recorder,
    repository,
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
      const message = recent
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
      AudioManager.impact();
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
      repository,
      set,
    ],
  );
  const selectTrap = useCallback(
    (type: TrapType) => {
      if (!game.challenge) return;
      const zone = PLACEMENT_ZONES.find(
        (candidate) =>
          candidate.allowedTypes.includes(type) &&
          validatePlacement(
            {
              type,
              zoneId: candidate.id,
              offsetX: 0,
              offsetZ: 0,
              rotationQuarterTurns: 0,
            },
            game.challenge!.traps,
          ).valid,
      );
      if (!zone) {
        set({ error: "No safe placement remains for that trap." });
        return;
      }
      set({
        selectedTrap: type,
        placement: {
          type,
          zoneId: zone.id,
          offsetX: 0,
          offsetZ: 0,
          rotationQuarterTurns: 0,
        },
        phase: "placing_trap",
      });
    },
    [game.challenge, set],
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
      const absolute = new URL(
        result.attributedShareUrl,
        window.location.origin,
      ).toString();
      setShareUrl(absolute);
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
  }, [game.attemptId, game.challenge, game.placement, repository, set]);
  const createAttributedShare = useCallback(
    async (channel: "web_share" | "copy_link") => {
      if (!game.publishResult) return shareUrl;
      const result = await repository.createShare({
        challengeSlug: game.publishResult.challenge.slug,
        channel,
        idempotencyKey: shareKey.current,
      });
      const absolute = new URL(result.url, window.location.origin).toString();
      setShareUrl(absolute);
      return absolute;
    },
    [game.publishResult, repository, shareUrl],
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
    const text = `I reached the final form of MAKE IT WORSE: ${window.location.href}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "MAKE IT WORSE — FINAL FORM", text, url: window.location.href });
        return;
      } catch {
        /* share sheet cancelled or unavailable */
      }
    }
    await navigator.clipboard.writeText(text);
    setToast("Final-form challenge copied.");
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === "KeyR" && game.phase === "playing")
        void failAttempt("reset");
      if (event.code === "Escape") {
        if (game.phase === "playing")
          set({
            phase: "paused",
            elapsedMs: game.startedAt
              ? performance.now() - game.startedAt
              : game.elapsedMs,
          });
        else if (game.phase === "paused")
          set({
            phase: "playing",
            startedAt: performance.now() - game.elapsedMs,
          });
      }
      if (event.code === "Enter" && game.phase === "failed")
        void startAttempt();
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
        shareUrl ||
          new URL(
            `/c/${game.publishResult.challenge.slug}`,
            location.origin,
          ).toString(),
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
            ),
          });
        }}
        onAssetsReady={() => setAssetsReady(true)}
      />
      {game.phase === "intro" && (
        <ChallengeIntro
          challenge={game.challenge}
          assetsReady={assetsReady}
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
            onPause={() => set({ phase: "paused" })}
            onSettings={() => setSettingsOpen(true)}
          />
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
          onRetry={() => void startAttempt()}
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
          {...(clipBlob ? { onShareClip: () => void shareClip() } : {})}
        />
      )}{" "}
      {game.phase === "choosing_trap" && game.offeredTraps && (
        <TrapChoicePanel choices={game.offeredTraps} onSelect={selectTrap} />
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
      <div className="toast-region" aria-live="polite">
        {toast || game.error}
      </div>
    </main>
  );
}
