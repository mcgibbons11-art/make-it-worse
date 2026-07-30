import type { GamePhase } from "@/lib/game/types";

const MENU_TRACK_URL = `${process.env.NEXT_PUBLIC_ASSET_BASE ?? "/"}audio/menu-music.mp3`;
/** The recording is full-band, while the generated score's layers peak near 0.02. */
const MENU_TRACK_TRIM = 0.07;

/**
 * The score, generated rather than recorded.
 *
 * Two reasons for synthesising it. The first is bundle size: the Portals chunk
 * is already 3.4 MB and the twenty-nine recorded cues add 791 KB, and five
 * distinct pieces of recorded music long enough not to feel like a ringtone
 * would be several megabytes more. This file adds none. The second is that the
 * five states are not five moods to crossfade between, they are the same music
 * under different pressure, and a generated score can change tempo, harmony and
 * density on the next sixteenth rather than fading one recording into another.
 *
 * What that trades away is timbre. A triangle wave through a lowpass is a pad
 * the way a stick figure is a portrait, and no amount of arrangement makes an
 * oscillator sound like a room full of players. That is the honest cost.
 *
 * Everything in the piece is drawn from one seven-note collection, A natural
 * minor, so the five states share a key and the transitions between them are
 * changes of weight rather than changes of world. The reward state is the same
 * collection heard from C, its relative major, which is why the payoff can
 * sound like an arrival without modulating anywhere the ear has to follow.
 */

/** A2. Every pitch in the score is this times a power of two times a scale step. */
const ROOT_HZ = 110;
/** Semitone offsets of the natural minor scale, indexed by scale degree. */
const SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
const STEPS_PER_BAR = 16;
/** The last stretch of a run gets its own state. */
export const CLOSING_MS = 10_000;

export type MusicScene = "silent" | "menu" | "run" | "closing" | "death" | "reward";
type MusicLayer = "pad" | "bass" | "pulse" | "bell";

interface Scene {
  bpm: number;
  /** Scale degree of the triad in each bar of the loop. */
  bars: readonly number[];
  /** Absolute output peak of each layer, chord and all. Zero silences it. */
  peaks: Record<MusicLayer, number>;
  /** Where the pad's lowpass sits, in Hz. */
  colour: number;
  /** Sixteenth-note positions within a bar that each layer plays on. */
  bassSteps: readonly number[];
  pulseSteps: readonly number[];
  bellSteps: readonly number[];
}

/**
 * Bar degrees read as triads of the minor scale: 0 is i (A minor), 1 is ii
 * diminished (B), 2 is III (C), 4 is v (E minor), 5 is VI (F), 6 is VII (G).
 *
 * - menu waits. Two chords, no pulse, a bell every other bar, and a tempo slow
 *   enough that nothing feels started yet.
 * - run is exactly twice the menu tempo, so the cut into a run lands on a beat
 *   the player has already been hearing. i-VI-III-VII is the loop under the
 *   whole attempt.
 * - closing keeps the key and takes away the resolution: i alternating with the
 *   diminished chord, every sixteenth carrying a bass note, the pad opened up
 *   to 2.4 kHz so it reads as bright rather than warm.
 * - death is the slowest tempo in the score and the only loop that falls, VI to
 *   v to i, over three bars rather than four so the cadence completes while the
 *   failure card is still on screen.
 * - reward is the same seven notes heard from C: III-VI-VII-III is I-IV-V-I in
 *   the relative major, at the one tempo in the piece that is neither the run's
 *   nor the menu's, with a bell on every sixteenth.
 */
const SCENES: Record<Exclude<MusicScene, "silent">, Scene> = {
  menu: {
    bpm: 66,
    bars: [0, 0, 5, 5],
    peaks: { pad: 0.02, bass: 0.014, pulse: 0, bell: 0.016 },
    colour: 900,
    bassSteps: [0],
    pulseSteps: [],
    bellSteps: [6, 11],
  },
  run: {
    bpm: 132,
    bars: [0, 5, 2, 6],
    peaks: { pad: 0.015, bass: 0.022, pulse: 0.013, bell: 0 },
    colour: 1500,
    bassSteps: [0, 3, 6, 8, 11, 14],
    pulseSteps: [2, 6, 10, 14],
    bellSteps: [],
  },
  closing: {
    bpm: 152,
    bars: [0, 1],
    peaks: { pad: 0.013, bass: 0.024, pulse: 0.016, bell: 0.011 },
    colour: 2400,
    bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    pulseSteps: [4, 12],
    bellSteps: [0],
  },
  death: {
    bpm: 60,
    bars: [5, 4, 0],
    peaks: { pad: 0.026, bass: 0.015, pulse: 0, bell: 0.009 },
    colour: 520,
    bassSteps: [0],
    pulseSteps: [],
    bellSteps: [10],
  },
  reward: {
    bpm: 104,
    bars: [2, 5, 6, 2],
    peaks: { pad: 0.018, bass: 0.018, pulse: 0.011, bell: 0.02 },
    colour: 2600,
    bassSteps: [0, 6, 8, 14],
    pulseSteps: [4, 12],
    bellSteps: [0, 2, 4, 6, 8, 10, 12, 14],
  },
};

/** Two voices a few cents apart, which is what stops a pad sounding like a beep. */
const PAD_DETUNE = [0.997, 1.003] as const;
/** Root, third and fifth: the scale degrees a triad is built from. */
const PAD_TRIAD = [0, 2, 4] as const;
/** Scheduler cadence and how far past it notes are placed. */
const TICK_MS = 25;
const LOOKAHEAD_SECONDS = 0.35;
/** Past this the scheduler has been asleep, so it restarts on the next bar. */
const RESYNC_SECONDS = 0.5;
/** A scene change dips the bus rather than cutting a sustained chord dead. */
const SWITCH_DIP_SECONDS = 0.12;
const SWITCH_RISE_SECONDS = 0.35;
/** How far a full-severity hazard pushes the music down, and for how long. */
const DUCK_DEPTH = 0.55;
const DUCK_ATTACK_SECONDS = 0.03;
const DUCK_RELEASE_SECONDS = 0.45;
/** Floor for the exponential ramps, which cannot reach zero. */
const SILENT = 0.0001;

/** Scale degrees are diatonic, so a degree of 7 is the octave, not the fifth. */
export function degreeHz(degree: number): number {
  const octave = Math.floor(degree / SCALE.length);
  const step = SCALE[degree - octave * SCALE.length] ?? 0;
  return ROOT_HZ * 2 ** (octave + step / 12);
}

/**
 * What the score should be doing, given where the game is. Lives here rather
 * than in the components so both editions map their phases the same way and the
 * mapping can be tested without a browser.
 */
export function musicSceneForPhase(
  phase: GamePhase,
  msRemaining = Number.POSITIVE_INFINITY,
): MusicScene {
  switch (phase) {
    case "playing":
      return msRemaining <= CLOSING_MS ? "closing" : "run";
    case "failed":
      return "death";
    case "finished":
    case "choosing_trap":
    case "placing_trap":
    case "publishing":
    case "sharing":
      return "reward";
    case "fatal_error":
      return "silent";
    default:
      return "menu";
  }
}

/**
 * Each layer is identifiable from the graph alone: the pad is the triangle
 * pair, the bass the sawtooth, the bell the sine, the pulse the noise source.
 * Nothing here reports what it played, so the tests measure the nodes rather
 * than a log the engine keeps about itself.
 */
export class MusicEngine {
  private scene: MusicScene = "silent";
  private pending: MusicScene | null = null;
  private bus: GainNode;
  private transition: GainNode;
  private ducker: GainNode;
  private level: GainNode;
  private delay: DelayNode;
  private send: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stepIndex = 0;
  private nextStepTime = 0;
  private volume = 1;
  private menuBuffer: AudioBuffer | null = null;
  private menuSource: AudioBufferSourceNode | null = null;
  private menuLoading: Promise<void> | null = null;
  private menuGain: GainNode;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    private readonly noise: () => AudioBuffer,
  ) {
    // Music never draws on AudioManager's voice budget. Sixteen voices is a
    // ceiling tuned for percussive one-shots, and a pad holding six oscillators
    // across a bar would spend it before the first hazard ever fired.
    this.bus = context.createGain();
    this.transition = context.createGain();
    this.ducker = context.createGain();
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.bus.connect(this.transition).connect(this.ducker).connect(this.level);
    this.level.connect(destination);
    this.menuGain = context.createGain();
    this.menuGain.gain.value = MENU_TRACK_TRIM;
    this.menuGain.connect(this.bus);
    // A dotted-eighth feedback delay under the bells. It is the only thing in
    // the graph doing the job a room would do.
    this.delay = context.createDelay(1);
    this.send = context.createGain();
    this.send.gain.value = 0.32;
    const regeneration = context.createGain();
    regeneration.gain.value = 0.28;
    const damping = context.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 2200;
    this.send.connect(this.delay);
    this.delay.connect(damping).connect(regeneration).connect(this.delay);
    this.delay.connect(this.transition);
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene && this.pending === null) return;
    this.pending = scene;
    if (scene !== "silent" && this.timer === null)
      this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** The player's music level, relative to the effects already on the bus. */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.level.gain.setTargetAtTime(
      this.scene === "silent" ? 0 : this.volume,
      this.context.currentTime,
      0.05,
    );
  }

  /**
   * Push the music down under a hazard. Taking the smaller of the current gain
   * and the new floor means a second hit inside the release of the first ducks
   * further rather than releasing early.
   */
  duck(strength: number): void {
    if (this.scene === "silent") return;
    const now = this.context.currentTime;
    const floor = 1 - DUCK_DEPTH * Math.max(0, Math.min(1, strength));
    const gain = this.ducker.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.min(gain.value, floor), now);
    gain.linearRampToValueAtTime(floor, now + DUCK_ATTACK_SECONDS);
    gain.linearRampToValueAtTime(
      1,
      now + DUCK_ATTACK_SECONDS + DUCK_RELEASE_SECONDS,
    );
  }

  /** Stops scheduling. Notes already placed play out; the bus fades under them. */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.scene = "silent";
    this.pending = null;
    this.stopMenuTrack();
    this.level.gain.setTargetAtTime(0, this.context.currentTime, 0.06);
  }

  private tick(): void {
    // Nothing is scheduled against a context that is not running: its clock is
    // frozen, so every note would land at the same instant and arrive as one
    // chord the moment the player finally touches the screen.
    if (this.context.state !== "running") return;
    const now = this.context.currentTime;
    if (this.pending !== null && this.pending !== this.scene) this.switch(now);
    if (this.scene === "silent") return;
    // The supplied recording replaces the old generated menu arrangement.
    // Other states keep the reactive score and its pressure changes.
    if (this.scene === "menu" && this.menuSource) return;
    const scene = SCENES[this.scene];
    const stepSeconds = 60 / scene.bpm / 4;
    this.delay.delayTime.value = Math.min(1, stepSeconds * 3);
    // Asleep in a background tab, or resumed after an interruption: start again
    // at the top of a bar instead of firing every step it slept through.
    if (this.nextStepTime < now - RESYNC_SECONDS) {
      this.nextStepTime = now + TICK_MS / 1000;
      this.stepIndex = Math.ceil(this.stepIndex / STEPS_PER_BAR) * STEPS_PER_BAR;
    }
    if (this.nextStepTime < now) this.nextStepTime = now;
    while (this.nextStepTime < now + LOOKAHEAD_SECONDS) {
      this.step(this.stepIndex, this.nextStepTime, scene, stepSeconds);
      this.stepIndex += 1;
      this.nextStepTime += stepSeconds;
    }
  }

  private switch(now: number): void {
    const next = this.pending ?? "silent";
    this.pending = null;
    if (this.scene === "menu" && next !== "menu") this.stopMenuTrack();
    this.scene = next;
    if (next === "silent") {
      this.stop();
      return;
    }
    // The cut lands on a bar line of the new tempo, and the bus dips through it
    // so the chord left hanging from the old scene is not simply chopped.
    this.stepIndex = 0;
    this.nextStepTime = now + SWITCH_DIP_SECONDS;
    const dip = this.transition.gain;
    dip.cancelScheduledValues(now);
    dip.setValueAtTime(dip.value, now);
    dip.linearRampToValueAtTime(0, now + SWITCH_DIP_SECONDS);
    dip.linearRampToValueAtTime(1, now + SWITCH_DIP_SECONDS + SWITCH_RISE_SECONDS);
    this.level.gain.setTargetAtTime(this.volume, now, 0.05);
    if (next === "menu") void this.startMenuTrack();
  }

  private async startMenuTrack(): Promise<void> {
    // The deterministic audio-graph tests run without a browser or a served
    // public directory; there the generated menu remains the offline fallback.
    if (typeof window === "undefined") return;
    if (this.menuSource) return;
    if (!this.menuBuffer) {
      if (!this.menuLoading) {
        this.menuLoading = (async () => {
          try {
            const response = await fetch(MENU_TRACK_URL);
            if (!response.ok) throw new Error(`menu music returned ${response.status}`);
            this.menuBuffer = await this.context.decodeAudioData(await response.arrayBuffer());
          } catch (error) {
            console.warn("[audio] supplied menu music unavailable", error);
          } finally {
            this.menuLoading = null;
          }
        })();
      }
      await this.menuLoading;
    }
    if (this.scene !== "menu" || !this.menuBuffer || this.menuSource) return;
    const source = this.context.createBufferSource();
    source.buffer = this.menuBuffer;
    source.loop = true;
    source.connect(this.menuGain);
    source.start();
    this.menuSource = source;
  }

  private stopMenuTrack(): void {
    const source = this.menuSource;
    this.menuSource = null;
    if (!source) return;
    try {
      source.stop();
    } catch {
      // Already ended while the audio context was being interrupted.
    }
    source.disconnect();
  }

  private step(
    index: number,
    at: number,
    scene: Scene,
    stepSeconds: number,
  ): void {
    const bar = Math.floor(index / STEPS_PER_BAR) % scene.bars.length;
    const position = index % STEPS_PER_BAR;
    const root = scene.bars[bar] ?? 0;
    if (position === 0)
      this.pad(at, root, stepSeconds * STEPS_PER_BAR, scene);
    if (scene.bassSteps.includes(position))
      this.bass(at, root - 7, stepSeconds * 0.9, scene.peaks.bass);
    if (scene.pulseSteps.includes(position)) this.pulse(at, scene.peaks.pulse);
    if (scene.bellSteps.includes(position)) {
      // Walk the triad rather than repeating the root, so a bell on every
      // sixteenth reads as an arpeggio.
      const tone = [0, 2, 4][Math.floor(index / 2) % 3] ?? 0;
      this.bell(at, root + 14 + tone, scene.peaks.bell);
    }
  }

  private pad(at: number, root: number, seconds: number, scene: Scene): void {
    // Six oscillators sum into one envelope, so the envelope carries a sixth of
    // the layer's peak and `peaks.pad` means what it does for every other layer.
    const peak = scene.peaks.pad / (PAD_TRIAD.length * PAD_DETUNE.length);
    if (peak <= 0) return;
    const attack = Math.min(0.5, seconds * 0.35);
    const release = seconds * 0.35;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(SILENT, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + attack);
    envelope.gain.setValueAtTime(peak, at + seconds);
    envelope.gain.exponentialRampToValueAtTime(SILENT, at + seconds + release);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = scene.colour;
    filter.Q.value = 0.7;
    envelope.connect(filter).connect(this.bus);
    for (const interval of PAD_TRIAD) {
      const hz = degreeHz(root + 7 + interval);
      for (const ratio of PAD_DETUNE) {
        const oscillator = this.context.createOscillator();
        oscillator.type = "triangle";
        oscillator.frequency.value = hz * ratio;
        oscillator.connect(envelope);
        oscillator.start(at);
        oscillator.stop(at + seconds + release + 0.05);
      }
    }
  }

  private bass(at: number, degree: number, seconds: number, peak: number): void {
    if (peak <= 0) return;
    const oscillator = this.context.createOscillator();
    oscillator.type = "sawtooth";
    const hz = degreeHz(degree);
    oscillator.frequency.value = hz;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, at);
    filter.frequency.exponentialRampToValueAtTime(240, at + seconds);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(SILENT, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(SILENT, at + seconds);
    oscillator.connect(filter).connect(envelope).connect(this.bus);
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.02);
  }

  private pulse(at: number, peak: number): void {
    if (peak <= 0) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise();
    const filter = this.context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6000;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(SILENT, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(SILENT, at + 0.045);
    source.connect(filter).connect(envelope).connect(this.bus);
    source.start(at);
    source.stop(at + 0.06);
  }

  private bell(at: number, degree: number, peak: number): void {
    if (peak <= 0) return;
    const oscillator = this.context.createOscillator();
    // Sine, where the pad is triangle: the two share a register at the top of
    // the reward state and would otherwise smear into one another.
    oscillator.type = "sine";
    oscillator.frequency.value = degreeHz(degree);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(SILENT, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(SILENT, at + 0.9);
    oscillator.connect(envelope);
    envelope.connect(this.bus);
    envelope.connect(this.send);
    oscillator.start(at);
    oscillator.stop(at + 0.95);
  }
}
