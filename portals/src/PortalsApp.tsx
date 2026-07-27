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
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { placementFromWorld, validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type {
  ChallengeDTO,
  DecodedGhostSample,
  GamePhase,
  HazardContact,
  PublishChildResult,
  TrapPlacementInput,
  TrapType,
} from "@/lib/game/types";
import { useSettingsStore } from "@/stores/settings-store";
import { AudioManager } from "@/lib/audio/AudioManager";
const GameCanvas = lazy(() => import("@/components/game/GameCanvas"));
const format = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0")}.${Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0")}`;
export function PortalsApp() {
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
  const [notice, setNotice] = useState("");
  const samples = useRef<DecodedGhostSample[]>([]);
  const lastHazard = useRef<HazardContact | null>(null);
  const finishing = useRef(false);
  const progress = useRef(0);
  const copyChallengeMessage = useCallback(async () => {
    const text = "I survived MAKE IT WORSE on Portals. Your turn!";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setNotice("Challenge message copied.");
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      setNotice(copied ? "Challenge message copied." : "Select and copy: " + text);
    }
  }, []);
  useEffect(() => {
    AudioManager.setMuted(settings.muted);
    AudioManager.setVolume(settings.volume);
  }, [settings.muted, settings.volume]);
  useEffect(() => {
    void repository.ensureGuest().then(() => setPhase("ready"));
  }, [repository]);
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(
      () => setElapsed(performance.now() - startedAt),
      50,
    );
    return () => clearInterval(timer);
  }, [phase, startedAt]);
  const open = useCallback((next: ChallengeDTO) => {
    setAssetsReady(false);
    setChallenge(next);
    setPhase("intro");
    setResult(null);
    setPlacement(null);
    setOffered(null);
  }, []);
  const fresh = async () => open(await repository.createRootChain());
  const trending = async () => {
    const items = await repository.listTrending(1);
    open(items[0]!);
  };
  const start = useCallback(async () => {
    if (!challenge) return;
    const started = await repository.startAttempt({
      challengeSlug: challenge.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: matchMedia("(max-width:700px)").matches
        ? "mobile"
        : "desktop",
      buildVersion: "portals-1",
      idempotencyKey: crypto.randomUUID(),
    });
    setAttemptId(started.attemptId);
    setAttemptSerial((value) => value + 1);
    setStartedAt(performance.now());
    setElapsed(0);
    samples.current = [];
    lastHazard.current = null;
    finishing.current = false;
    progress.current = 0;
    setPhase("playing");
    AudioManager.click();
  }, [challenge, repository]);
  const complete = useCallback(async () => {
    if (finishing.current || !attemptId) return;
    finishing.current = true;
    const duration = Math.max(100, performance.now() - startedAt);
    const trace = encodeGhostTrace(
      samples.current.length
        ? samples.current
        : [{ x: 0, y: 1.25, z: 1.2, yaw: 0, flags: 1 }],
    );
    const finished = await repository.finishAttempt({
      attemptId,
      outcome: "completed",
      durationMs: Math.round(duration),
      maxProgress: 1,
      deathTrapInstanceId: null,
      ghostTrace: trace,
      idempotencyKey: crypto.randomUUID(),
    });
    setElapsed(duration);
    setOffered(finished.offeredTraps);
    setPhase("finished");
    AudioManager.finish();
    navigator.vibrate?.([45, 40, 70]);
  }, [attemptId, repository, startedAt]);
  const fail = useCallback(
    async (outcome: "fell" | "timeout" | "reset" = "fell") => {
      if (finishing.current || !attemptId) return;
      finishing.current = true;
      const duration = performance.now() - startedAt;
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
      AudioManager.impact();
      void repository.finishAttempt({
        attemptId,
        outcome,
        durationMs: Math.round(duration),
        maxProgress: progress.current,
        deathTrapInstanceId: recent?.trapInstanceId ?? null,
        ghostTrace: null,
        idempotencyKey: crypto.randomUUID(),
      });
      setTimeout(() => setPhase("failed"), 450);
    },
    [attemptId, repository, startedAt],
  );
  const choose = (type: TrapType) => {
    if (!challenge) return;
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
          challenge.traps,
        ).valid,
    );
    if (!zone) return;
    setPlacement({
      type,
      zoneId: zone.id,
      offsetX: 0,
      offsetZ: 0,
      rotationQuarterTurns: 0,
    });
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
      AudioManager.publish();
    } catch {
      setPhase("placing_trap");
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyR" && phase === "playing") void fail("reset");
      if (event.code === "KeyM") settings.toggleMuted();
      if (event.code === "Escape") {
        if (phase === "playing") {
          setElapsed(performance.now() - startedAt);
          setPhase("paused");
        } else if (phase === "paused") {
          setStartedAt(performance.now() - elapsed);
          setPhase("playing");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [elapsed, fail, phase, settings, startedAt]);
  if (!challenge)
    return (
      <main className="portals-home">
        <section className="panel portals-card">
          <div className="eyebrow">PORTALS EDITION</div>
          <h1 className="portals-title">
            <span>MAKE IT</span>
            <strong>WORSE</strong>
          </h1>
          <p>Beat the level. Add one awful thing. Play the consequence.</p>
          <div className="portals-actions">
            <button className="button danger mega" onClick={() => void fresh()}>
              Start a fresh chain
            </button>
            <button
              className="button secondary"
              onClick={() => void trending()}
            >
              Play the demo disaster
            </button>
          </div>
          <span className="portals-note">
            Desktop browser edition · WASD / arrows · Space · E · R
          </span>
          <a
            className="text-button portals-credits"
            href="./assets/models/LICENSES.md"
            target="_blank"
            rel="noreferrer"
          >
            Licensed art credits
          </a>
        </section>
      </main>
    );
  const validation = placement
    ? validatePlacement(placement, challenge.traps)
    : null;
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
              ),
            );
          }}
          onAssetsReady={() => setAssetsReady(true)}
        />
      </Suspense>
      {phase === "intro" && (
        <div className="portals-overlay">
          <section className="panel">
            <div className="eyebrow">CHAIN DEPTH {challenge.depth}</div>
            <h1>
              {challenge.addedTrap
                ? `${challenge.addedTrap.ownerName} added ${TRAP_CATALOG[challenge.addedTrap.type].articleName}.`
                : "A clean level. For now."}
            </h1>
            <p>
              {challenge.stats.attempts} attempts ·{" "}
              {challenge.stats.survivalRate === null
                ? "No survival data"
                : `${Math.round(challenge.stats.survivalRate * 100)}% survive`}
            </p>
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
          </section>
        </div>
      )}
      {phase === "playing" && (
        <>
          <header className="game-hud">
            <div className="hud-pill timer">{format(elapsed)}</div>
            <div className="hud-pill depth">DISASTER {challenge.depth}</div>
            <div className="hud-actions">
              <button aria-label="Reset attempt (R)" onClick={() => void fail("reset")}>↻</button>
              <button aria-label="Pause game (Escape)" onClick={() => { setElapsed(performance.now() - startedAt); setPhase("paused"); }}>Ⅱ</button>
              <button aria-label={settings.muted ? "Unmute audio (M)" : "Mute audio (M)"} onClick={() => settings.toggleMuted()}>♫</button>
            </div>
          </header>
        </>
      )}
      <a
        className="text-button portals-credits in-game"
        href="./assets/models/LICENSES.md"
        target="_blank"
        rel="noreferrer"
      >
        Art credits
      </a>
      {phase === "failed" && (
        <div className="portals-overlay failure-backdrop">
          <section className="panel portals-failure">
            <div className="impact-stamp">{failureStamp}</div>
            <h2>{failure}</h2>
            <button className="button danger huge" onClick={() => void start()}>
              Try again
            </button>
          </section>
        </div>
      )}
      {phase === "finished" && (
        <div className="portals-overlay">
          <div className="confetti-burst" aria-hidden="true">
            {Array.from({ length: 64 }, (_, index) => <i key={index} style={{ "--piece": index } as React.CSSProperties} />)}
          </div>
          <section className="panel">
            <div className="eyebrow">IMPOSSIBLY</div>
            <h2>YOU SURVIVED</h2>
            <div className="finish-time">{format(elapsed)}</div>
            <button
              className="button primary huge"
              onClick={() => offered ? setPhase("choosing_trap") : void copyChallengeMessage()}
            >
              {offered ? "Make it worse" : "Share the final form"}
            </button>
            {!offered && <button className="button secondary" onClick={() => void fresh()}>Start a new disaster</button>}
          </section>
        </div>
      )}
      {phase === "paused" && (
        <div className="portals-overlay">
          <section className="panel">
            <div className="eyebrow">PAUSED</div>
            <h2>The chaos will wait.</h2>
            <button className="button primary huge" onClick={() => { setStartedAt(performance.now() - elapsed); setPhase("playing"); }}>Resume</button>
          </section>
        </div>
      )}
      {phase === "choosing_trap" && offered && (
        <div className="portals-overlay">
          <section className="panel">
            <div className="eyebrow">YOUR REWARD</div>
            <h2>Pick one awful thing.</h2>
            <div className="portals-choice">
              {offered.map((type) => (
                <button key={type} onClick={() => choose(type)}>
                  <TrapIcon type={type} />
                  <span>
                    <strong>{TRAP_CATALOG[type].displayName}</strong>
                    <br />
                    <small>{TRAP_CATALOG[type].shortDescription}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {(phase === "placing_trap" || phase === "publishing") && placement && (
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
        </aside>
      )}
      {phase === "sharing" && result && (
        <div className="portals-overlay">
          <div className="confetti-burst" aria-hidden="true">
            {Array.from({ length: 48 }, (_, index) => <i key={index} style={{ "--piece": index } as React.CSSProperties} />)}
          </div>
          <section className="panel">
            <div className="eyebrow">THE CONSEQUENCE</div>
            <h2>You made it {result.estimatedWorsePercent}% worse.</h2>
            <p>
              Your{" "}
              {TRAP_CATALOG[
                result.challenge.addedTrap!.type
              ].displayName.toLowerCase()}{" "}
              is now part of this local chain.
            </p>
            <p className="portals-share-warning">
              Portals runs this build in a secure static sandbox, so player-made
              chains persist in this browser. The full web deployment supports
              cross-device challenge links.
            </p>
            <div className="portals-buttons">
              <button
                className="button danger huge"
                onClick={() => open(result.challenge)}
              >
                Play your version
              </button>
              <button
                className="button secondary"
                onClick={() => void copyChallengeMessage()}
              >
                Copy challenge message
              </button>
              <button
                className="text-button"
                onClick={() => setChallenge(null)}
              >
                Back to title
              </button>
            </div>
            <p aria-live="polite">{notice}</p>
          </section>
        </div>
      )}
    </main>
  );
}
