"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createRepository } from "@/lib/repository/createRepository";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { ChallengeDTO } from "@/lib/game/types";
import { TrapIcon } from "@/components/icons/TrapIcon";
import { SettingsPanel } from "@/components/hud/SettingsPanel";
import { AvatarCustomizer } from "@/components/hud/AvatarCustomizer";
export default function HomePageClient() {
  const router = useRouter();
  const repository = useMemo(() => createRepository(), []);
  const [trending, setTrending] = useState<ChallengeDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void repository
      .listTrending(6)
      .then(setTrending)
      .catch(() => setError("Trending disasters are taking a nap."));
  }, [repository]);
  /**
   * Start a chain, on a named course or on a fresh roll of the dice.
   *
   * One function for both because the only difference is whether a course is
   * named: createRootChain composes a random one from the catalogue when it is
   * handed nothing. The track rides on the challenge from there, and
   * publishChild spreads the parent, so a picked map propagates down the whole
   * share chain without anything here arranging it.
   */
  const startChain = async (track?: readonly string[]) => {
    setLoading(true);
    setError("");
    try {
      const challenge = await repository.createRootChain(track);
      router.push(`/c/${challenge.slug}`);
    } catch {
      setError(
        track
          ? "Could not open that map. Try once more."
          : "Could not start a fresh chain. Try once more.",
      );
      setLoading(false);
    }
  };
  return (
    <main className="home-shell">
      <div className="home-sky">
        <div className="cloud cloud-one" />
        <div className="cloud cloud-two" />
      </div>
      <nav className="home-nav">
        <div className="mini-logo">MIW</div>
        <button className="nav-button" onClick={() => setSettings(true)}>
          Settings
        </button>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">A FRIENDSHIP-STRESS TEST</div>
          <h1>
            <span>MAKE IT</span>
            <strong>WORSE</strong>
          </h1>
          <p>Beat the level. Add one awful thing. Send it to a friend.</p>
          <div className="hero-actions">
            <button
              className="button danger mega"
              onClick={() => void startChain()}
              disabled={loading}
            >
              {loading ? "Creating clean-ish level…" : "Start a fresh chain"}
            </button>
            <AvatarCustomizer
              alwaysVisible
              launcherClassName="button secondary"
              launcherLabel="Build your runner"
            />
            {trending[0] && (
              <Link
                className="button secondary"
                href={`/c/${trending[0].slug}`}
              >
                Play a trending disaster
              </Link>
            )}
          </div>
          <small>No download. No account. Just consequences.</small>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="hero-diorama" aria-hidden="true">
          <div className="floating-platform">
            <div className="door">EXIT</div>
            <div className="toy-runner">
              <i />
              <b />
            </div>
            <div className="toy-hammer">
              <span />
            </div>
            <div className="toy-ball" />
          </div>
          <div className="shadow-island" />
        </div>
      </section>
      <section className="how-strip" aria-labelledby="how-title">
        <h2 id="how-title">How to be a terrible friend</h2>
        <ol>
          <li>
            <b>01</b>
            <strong>Beat it</strong>
            <span>Survive the apartment.</span>
          </li>
          <li>
            <b>02</b>
            <strong>Ruin it</strong>
            <span>Add one awful trap.</span>
          </li>
          <li>
            <b>03</b>
            <strong>Send it</strong>
            <span>Your friend inherits it.</span>
          </li>
        </ol>
      </section>
      <section className="trending-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">CURRENTLY CAUSING PROBLEMS</div>
            <h2>Trending disasters</h2>
          </div>
        </div>
        <div className="trending-grid">
          {trending.map((challenge) => (
            <Link
              key={challenge.slug}
              href={`/c/${challenge.slug}`}
              className="trending-card"
            >
              <div className="card-art">
                {challenge.addedTrap && (
                  <TrapIcon type={challenge.addedTrap.type} />
                )}
                <span className="depth-badge">DEPTH {challenge.depth}</span>
              </div>
              <strong>
                {challenge.addedTrap
                  ? `${challenge.createdByName} added ${TRAP_CATALOG[challenge.addedTrap.type].articleName}`
                  : "A clean level. Suspicious."}
              </strong>
              <p>
                {challenge.stats.attempts} attempts ·{" "}
                {challenge.stats.survivalRate === null
                  ? "Unproven"
                  : `${Math.round(challenge.stats.survivalRate * 100)}% survive`}
              </p>
              <span className="card-cta">Accept challenge →</span>
            </Link>
          ))}
        </div>
      </section>
      <footer>
        <div className="mini-logo">MAKE IT WORSE</div>
        <p>Original procedural chaos. No ads. No account wall.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
      <SettingsPanel open={settings} onClose={() => setSettings(false)} />
    </main>
  );
}
