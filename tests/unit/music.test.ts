import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSING_MS,
  MusicEngine,
  degreeHz,
  musicSceneForPhase,
  type MusicScene,
} from "@/lib/audio/music";
import { edgeLevels, prepareLoop, seamRatio } from "@/lib/audio/loop";

/**
 * Nobody involved in this project has heard any of it, so nothing below is an
 * opinion about how the music sounds. What these tests do is measure the graph
 * the engine builds and the buffers it loops: the spacing of the onsets against
 * the tempo the scene claims, the pitch of every oscillator against the one
 * scale the whole score is drawn from, the energy of each layer against the
 * others once rendered, and the gain the ducker actually applies.
 *
 * Web Audio does not exist under Node, so the context below records what it was
 * asked to build, including the edges between nodes, which is what makes it
 * possible to find the envelope belonging to a given oscillator and render it.
 */

type NodeKind = "gain" | "filter" | "oscillator" | "source" | "delay" | "sink";

interface Automation {
  kind: "set" | "linear" | "exponential" | "target";
  value: number;
  at: number;
}

interface FakeParam {
  value: number;
  events: Automation[];
  setValueAtTime(value: number, at: number): FakeParam;
  linearRampToValueAtTime(value: number, at: number): FakeParam;
  exponentialRampToValueAtTime(value: number, at: number): FakeParam;
  setTargetAtTime(value: number, at: number, constant: number): FakeParam;
  cancelScheduledValues(at: number): FakeParam;
}

interface FakeNode {
  kind: NodeKind;
  outputs: FakeNode[];
  gain?: FakeParam;
  frequency?: FakeParam;
  delayTime?: FakeParam;
  playbackRate?: FakeParam;
  Q?: FakeParam;
  threshold?: FakeParam;
  knee?: FakeParam;
  ratio?: FakeParam;
  attack?: FakeParam;
  release?: FakeParam;
  type?: string;
  buffer?: unknown;
  connect(target: FakeNode): FakeNode;
}

/** One voice, recovered from the graph: what played, when, and how loudly. */
interface Voice {
  wave: string;
  hz: number;
  start: number;
  stop: number;
  envelope: Automation[];
}

const RENDER_RATE = 8000;

function param(initial = 0): FakeParam {
  const self: FakeParam = {
    value: initial,
    events: [],
    setValueAtTime(value, at) {
      self.value = value;
      self.events.push({ kind: "set", value, at });
      return self;
    },
    linearRampToValueAtTime(value, at) {
      self.value = value;
      self.events.push({ kind: "linear", value, at });
      return self;
    },
    exponentialRampToValueAtTime(value, at) {
      self.value = value;
      self.events.push({ kind: "exponential", value, at });
      return self;
    },
    setTargetAtTime(value, at) {
      self.value = value;
      self.events.push({ kind: "target", value, at });
      return self;
    },
    cancelScheduledValues(at) {
      self.events.push({ kind: "set", value: self.value, at });
      return self;
    },
  };
  return self;
}

function node(kind: NodeKind, extra: Partial<FakeNode> = {}): FakeNode {
  const self: FakeNode = {
    kind,
    outputs: [],
    connect(target) {
      self.outputs.push(target);
      return target;
    },
    ...extra,
  };
  return self;
}

class Recorder {
  readonly voices: Voice[] = [];
  readonly gains: FakeNode[] = [];
  readonly sink = node("sink");
  /** The engine takes a real AudioNode; this fake stands in for the master bus. */
  get destinationNode(): AudioNode {
    return this.sink as unknown as AudioNode;
  }
  clock = 0;

  context(state = "running"): AudioContext {
    // Arrows rather than a captured `this`, so the fake reads the live clock
    // and the live voice list without aliasing the recorder.
    const readClock = () => this.clock;
    const capture = (source: FakeNode, at: number) => this.capture(source, at);
    const make = {
      get currentTime() {
        return readClock();
      },
      get state() {
        return state;
      },
      sampleRate: 48000,
      destination: this.sink,
      resume: () => Promise.resolve(),
      createGain: () => {
        const gain = node("gain", { gain: param(1) });
        this.gains.push(gain);
        return gain;
      },
      createBiquadFilter: (): FakeNode =>
        node("filter", { frequency: param(350), Q: param(1), type: "lowpass" }),
      createDelay: () => node("delay", { delayTime: param(0) }),
      createDynamicsCompressor: () =>
        node("filter", {
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        }),
      createBuffer: (channels: number, frames: number, rate: number) => ({
        numberOfChannels: channels,
        length: frames,
        duration: frames / rate,
        sampleRate: rate,
        getChannelData: () => new Float32Array(frames),
      }),
      createOscillator() {
        const oscillator: FakeNode = node("oscillator", {
          frequency: param(440),
          type: "sine",
        });
        let voice: Voice | null = null;
        return Object.assign(oscillator, {
          start(at: number) {
            voice = capture(oscillator, at);
          },
          stop(at: number) {
            if (voice) voice.stop = at;
          },
        });
      },
      createBufferSource() {
        const source: FakeNode = node("source", { playbackRate: param(1) });
        let voice: Voice | null = null;
        return Object.assign(source, {
          start(at = 0) {
            voice = capture(source, at);
          },
          stop(at = 0) {
            if (voice) voice.stop = at;
          },
        });
      },
    };
    return make as unknown as AudioContext;
  }

  /**
   * Walk downstream to the note's own envelope, which is the first gain it
   * reaches. `stop` is filled in afterwards, because a source is always started
   * before it is told when to end.
   */
  private capture(source: FakeNode, at: number): Voice {
    const queue = [...source.outputs];
    let envelope: FakeNode | undefined;
    while (queue.length && !envelope) {
      const next = queue.shift();
      if (!next) break;
      if (next.kind === "gain") envelope = next;
      else queue.push(...next.outputs);
    }
    const voice: Voice = {
      wave: source.kind === "source" ? "noise" : (source.type ?? "sine"),
      hz: source.frequency?.value ?? 0,
      start: at,
      stop: at,
      envelope: envelope?.gain?.events ?? [],
    };
    this.voices.push(voice);
    return voice;
  }
}

/** Move the audio clock and the timer queue together, a scheduler tick at a time. */
function run(recorder: Recorder, ms: number): void {
  for (let left = ms; left > 0; left -= 25) {
    const slice = Math.min(25, left);
    recorder.clock += slice / 1000;
    vi.advanceTimersByTime(slice);
  }
}

/** The layer a voice belongs to, from its waveform alone. */
function layerOf(voice: Voice): "pad" | "bass" | "bell" | "pulse" {
  if (voice.wave === "triangle") return "pad";
  if (voice.wave === "sawtooth") return "bass";
  if (voice.wave === "noise") return "pulse";
  return "bell";
}

function onsets(voices: Voice[], layer: string): number[] {
  return [...new Set(voices.filter((v) => layerOf(v) === layer).map((v) => v.start))]
    .sort((a, b) => a - b);
}

/** Distance in semitones from A, which is the root the whole score is built on. */
function semitonesFromRoot(hz: number): number {
  return 12 * Math.log2(hz / 110);
}

function envelopeAt(events: Automation[], time: number): number {
  let value = 0;
  let previousTime = -Infinity;
  for (const event of events) {
    if (event.at <= time) {
      value = event.value;
      previousTime = event.at;
      continue;
    }
    if (event.kind === "linear" || event.kind === "exponential") {
      const span = event.at - previousTime;
      if (span <= 0) return event.value;
      const share = (time - previousTime) / span;
      return event.kind === "linear"
        ? value + (event.value - value) * share
        : value * (event.value / Math.max(1e-9, value)) ** share;
    }
    break;
  }
  return value;
}

/** Deterministic white noise, so a rendered pulse layer measures the same twice. */
function noiseAt(index: number): number {
  const scrambled = Math.sin(index * 12.9898) * 43758.5453;
  return (scrambled - Math.floor(scrambled)) * 2 - 1;
}

/**
 * Sum one layer's voices into PCM so the layers can be compared by energy.
 * Every waveform is rendered as a sine, which overstates the sawtooth and
 * triangle layers by about 1.2 in RMS, so the totals below are an upper bound.
 */
function render(voices: Voice[], layer: string, seconds: number): Float32Array {
  const frames = Math.round(seconds * RENDER_RATE);
  const output = new Float32Array(frames);
  for (const voice of voices) {
    if (layerOf(voice) !== layer) continue;
    const from = Math.max(0, Math.round(voice.start * RENDER_RATE));
    const to = Math.min(frames, Math.round(voice.stop * RENDER_RATE));
    for (let index = from; index < to; index += 1) {
      const time = index / RENDER_RATE;
      const shape =
        voice.wave === "noise" ? noiseAt(index) : Math.sin(2 * Math.PI * voice.hz * time);
      output[index] = (output[index] ?? 0) + shape * envelopeAt(voice.envelope, time);
    }
  }
  return output;
}

function rms(values: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1)
    sum += (values[index] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, values.length));
}

function playScene(scene: MusicScene, ms: number, state = "running") {
  const recorder = new Recorder();
  const context = recorder.context(state);
  const noise = context.createBuffer(1, 4800, 48000);
  const engine = new MusicEngine(context, recorder.destinationNode, () => noise);
  engine.setVolume(1);
  engine.setScene(scene);
  run(recorder, ms);
  return { recorder, engine, voices: recorder.voices };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the score's tempo", () => {
  // A bar is sixteen sixteenths, so the gap between chord changes is 240/bpm.
  const tempos: Record<string, number> = {
    menu: 66,
    run: 132,
    closing: 152,
    death: 60,
    reward: 104,
  };

  for (const [scene, bpm] of Object.entries(tempos)) {
    it(`holds ${bpm} bpm through ${scene}`, () => {
      const { voices } = playScene(scene as MusicScene, 30_000);
      const bars = onsets(voices, "pad");
      expect(bars.length).toBeGreaterThan(2);
      const gaps = bars.slice(1).map((at, index) => at - (bars[index] ?? 0));
      for (const gap of gaps) expect(gap).toBeCloseTo(240 / bpm, 4);
    });
  }

  it("places every voice on a sixteenth of the run's grid", () => {
    const { voices } = playScene("run", 20_000);
    const step = 60 / 132 / 4;
    const first = Math.min(...voices.map((voice) => voice.start));
    for (const voice of voices) {
      const position = (voice.start - first) / step;
      expect(Math.abs(position - Math.round(position))).toBeLessThan(1e-6);
    }
  });

  it("runs at exactly twice the menu tempo", () => {
    const menu = onsets(playScene("menu", 30_000).voices, "pad");
    const running = onsets(playScene("run", 30_000).voices, "pad");
    const menuBar = (menu[1] ?? 0) - (menu[0] ?? 0);
    const runBar = (running[1] ?? 0) - (running[0] ?? 0);
    expect(menuBar / runBar).toBeCloseTo(2, 6);
  });
});

describe("the score's key", () => {
  /** A natural minor: the seven notes the whole piece is allowed to use. */
  const COLLECTION = new Set([0, 2, 3, 5, 7, 8, 10]);
  const scenes: MusicScene[] = ["menu", "run", "closing", "death", "reward"];

  for (const scene of scenes) {
    it(`keeps ${scene} inside A natural minor`, () => {
      const { voices } = playScene(scene, 30_000);
      const pitched = voices.filter((voice) => voice.hz > 0);
      expect(pitched.length).toBeGreaterThan(8);
      for (const voice of pitched) {
        const semitones = semitonesFromRoot(voice.hz);
        // The pad runs two oscillators five cents apart, so the nearest
        // semitone has to be within a tenth of one.
        expect(Math.abs(semitones - Math.round(semitones))).toBeLessThan(0.1);
        expect(COLLECTION.has(((Math.round(semitones) % 12) + 12) % 12)).toBe(true);
      }
    });
  }

  it("resolves the reward onto C, the relative major of the run's A minor", () => {
    const runBass = onsets(playScene("run", 4_000).voices, "bass");
    const rewardVoices = playScene("reward", 4_000).voices;
    const firstRunChord = playScene("run", 4_000).voices.find(
      (voice) => layerOf(voice) === "pad",
    );
    const firstRewardChord = rewardVoices.find((voice) => layerOf(voice) === "pad");
    expect(runBass.length).toBeGreaterThan(0);
    // Both are triads of the same seven notes: the run opens on A, the reward
    // on C a minor third above it.
    const runRoot = Math.round(semitonesFromRoot(firstRunChord?.hz ?? 110)) % 12;
    const rewardRoot = Math.round(semitonesFromRoot(firstRewardChord?.hz ?? 110)) % 12;
    expect(((rewardRoot - runRoot + 12) % 12)).toBe(3);
  });

  it("spaces the pad as a triad rather than a cluster", () => {
    const { voices } = playScene("menu", 4_000);
    const chord = voices
      .filter((voice) => layerOf(voice) === "pad")
      .filter((voice) => voice.start === (onsets(voices, "pad")[0] ?? 0))
      .map((voice) => Math.round(semitonesFromRoot(voice.hz)))
      .sort((a, b) => a - b);
    // Six oscillators, three pitches, a minor triad: root, +3, +7.
    expect(chord).toHaveLength(6);
    const distinct = [...new Set(chord)];
    expect(distinct).toHaveLength(3);
    expect((distinct[1] ?? 0) - (distinct[0] ?? 0)).toBe(3);
    expect((distinct[2] ?? 0) - (distinct[0] ?? 0)).toBe(7);
  });
});

describe("the five states differ", () => {
  const seconds = 24;
  /**
   * Events per second, where a chord is one event rather than the six
   * oscillators it is made of, because that is what a listener counts.
   */
  const density = (scene: MusicScene) => {
    const { voices } = playScene(scene, seconds * 1000);
    return new Set(voices.map((voice) => voice.start)).size / seconds;
  };

  it("puts the most events in the closing seconds and the fewest in death", () => {
    const rates = {
      menu: density("menu"),
      run: density("run"),
      closing: density("closing"),
      death: density("death"),
      reward: density("reward"),
    };
    expect(rates.closing).toBeGreaterThan(rates.run);
    expect(rates.run).toBeGreaterThan(rates.menu);
    expect(rates.death).toBeLessThan(rates.menu);
  });

  it("gives the run a pulse the menu does not have", () => {
    expect(onsets(playScene("menu", 8_000).voices, "pulse")).toHaveLength(0);
    expect(
      onsets(playScene("run", 8_000).voices, "pulse").length,
    ).toBeGreaterThan(8);
  });

  it("falls through the death loop instead of circling", () => {
    const { voices } = playScene("death", 14_000);
    const chords = onsets(voices, "pad")
      .slice(0, 3)
      .map((at) => {
        const tone = voices.find(
          (voice) => voice.start === at && layerOf(voice) === "pad",
        );
        return Math.round(semitonesFromRoot(tone?.hz ?? 110));
      });
    expect(chords).toHaveLength(3);
    expect(chords[1]).toBeLessThan(chords[0] ?? 0);
    expect(chords[2]).toBeLessThan(chords[1] ?? 0);
  });

  it("switches states on the next tick rather than at the end of the loop", () => {
    const recorder = new Recorder();
    const context = recorder.context();
    const noise = context.createBuffer(1, 4800, 48000);
    const engine = new MusicEngine(context, recorder.destinationNode, () => noise);
    engine.setScene("run");
    run(recorder, 4_000);
    const beforeSwitch = recorder.clock;
    engine.setScene("reward");
    run(recorder, 600);
    const after = recorder.voices.filter((voice) => voice.start > beforeSwitch + 0.2);
    // The run has no bells at all, so a bell inside the next half second is
    // proof the reward state took hold without waiting for a bar of the old one.
    expect(after.some((voice) => layerOf(voice) === "bell")).toBe(true);
  });
});

describe("levels", () => {
  it("keeps the whole score below the quietest hazard peak", () => {
    // The softest trap in HAZARD_PEAK is the sticky gum at 0.03.
    for (const scene of ["menu", "run", "closing", "death", "reward"] as const) {
      const { voices } = playScene(scene, 12_000);
      const window = 8;
      const total = rms(
        Float32Array.from(
          ["pad", "bass", "bell", "pulse"]
            .map((layer) => render(voices, layer, window))
            .reduce((sum, layer) => {
              for (let index = 0; index < sum.length; index += 1)
                sum[index] = (sum[index] ?? 0) + (layer[index] ?? 0);
              return sum;
            }),
        ),
      );
      expect(total).toBeLessThan(0.03);
      expect(total).toBeGreaterThan(0.001);
    }
  });

  it("balances the run so no layer is buried under another", () => {
    const { voices } = playScene("run", 12_000);
    const levels = ["pad", "bass", "pulse"].map((layer) => ({
      layer,
      level: rms(render(voices, layer, 8)),
    }));
    const loudest = Math.max(...levels.map((entry) => entry.level));
    for (const entry of levels) {
      expect(entry.level).toBeGreaterThan(0);
      // Nothing more than 20 dB under the loudest layer, which is the point
      // below which a layer stops contributing anything a player would miss.
      expect(20 * Math.log10(entry.level / loudest)).toBeGreaterThan(-20);
    }
  });
});

describe("ducking", () => {
  /** The gain the whole score passes through on its way to the master bus. */
  function duckerOf(recorder: Recorder): FakeNode {
    const level = recorder.gains.find((gain) =>
      gain.outputs.includes(recorder.sink),
    );
    const ducker = recorder.gains.find((gain) =>
      level ? gain.outputs.includes(level) : false,
    );
    if (!ducker) throw new Error("no ducker in the graph");
    return ducker;
  }

  it("pulls the music down and lets it back up", () => {
    const { recorder, engine } = playScene("run", 2_000);
    const ducker = duckerOf(recorder);
    const before = ducker.gain?.events.length ?? 0;
    engine.duck(1);
    const events = (ducker.gain?.events ?? []).slice(before);
    const floor = Math.min(...events.map((event) => event.value));
    const last = events.at(-1);
    expect(floor).toBeLessThan(0.5);
    expect(last?.value).toBe(1);
    // Down fast, back over roughly half a second: any slower and the score is
    // absent, any faster and it climbs back over the tail of the hit.
    expect((last?.at ?? 0) - recorder.clock).toBeGreaterThan(0.3);
    expect((last?.at ?? 0) - recorder.clock).toBeLessThan(0.8);
  });

  it("ducks a light hit less than a heavy one", () => {
    const light = playScene("run", 2_000);
    light.engine.duck(0.2);
    const heavy = playScene("run", 2_000);
    heavy.engine.duck(1);
    const lowest = (session: ReturnType<typeof playScene>) =>
      Math.min(...(duckerOf(session.recorder).gain?.events ?? []).map((e) => e.value));
    expect(lowest(light)).toBeGreaterThan(lowest(heavy));
  });
});

describe("the gesture requirement", () => {
  it("schedules nothing while the context is suspended", () => {
    const { voices } = playScene("run", 10_000, "suspended");
    expect(voices).toHaveLength(0);
  });

  it("starts on the first bar once the context is running", () => {
    const recorder = new Recorder();
    let state = "suspended";
    const context = { ...recorder.context() } as AudioContext;
    Object.defineProperty(context, "state", { get: () => state });
    const noise = context.createBuffer(1, 4800, 48000);
    const engine = new MusicEngine(context, recorder.destinationNode, () => noise);
    engine.setScene("menu");
    run(recorder, 5_000);
    expect(recorder.voices).toHaveLength(0);
    state = "running";
    run(recorder, 1_000);
    expect(recorder.voices.length).toBeGreaterThan(0);
    // Whatever it slept through, it opens on a chord rather than mid-bar.
    expect(layerOf(recorder.voices[0] as Voice)).toBe("pad");
  });
});

describe("phase to scene", () => {
  it("maps each phase to the state it belongs to", () => {
    expect(musicSceneForPhase("intro")).toBe("menu");
    expect(musicSceneForPhase("ready")).toBe("menu");
    expect(musicSceneForPhase("paused")).toBe("menu");
    expect(musicSceneForPhase("playing", 30_000)).toBe("run");
    expect(musicSceneForPhase("failed")).toBe("death");
    expect(musicSceneForPhase("finished")).toBe("reward");
    expect(musicSceneForPhase("choosing_trap")).toBe("reward");
    expect(musicSceneForPhase("sharing")).toBe("reward");
    expect(musicSceneForPhase("fatal_error")).toBe("silent");
  });

  it("turns over to the closing state for the last ten seconds", () => {
    expect(musicSceneForPhase("playing", CLOSING_MS + 1)).toBe("run");
    expect(musicSceneForPhase("playing", CLOSING_MS)).toBe("closing");
    expect(musicSceneForPhase("playing", 0)).toBe("closing");
  });

  it("treats a run with no clock reading as a run", () => {
    expect(musicSceneForPhase("playing")).toBe("run");
  });
});

describe("scale degrees", () => {
  it("counts diatonically, so seven degrees is an octave", () => {
    expect(degreeHz(0)).toBeCloseTo(110, 6);
    expect(degreeHz(7)).toBeCloseTo(220, 6);
    expect(degreeHz(-7)).toBeCloseTo(55, 6);
    // A minor third and a fifth above A, which is what makes a minor triad.
    expect(degreeHz(2) / degreeHz(0)).toBeCloseTo(2 ** (3 / 12), 6);
    expect(degreeHz(4) / degreeHz(0)).toBeCloseTo(2 ** (7 / 12), 6);
  });
});

describe("preparing a bed to loop", () => {
  const RATE = 44100;

  const edgeRatio = (edges: { head: number; tail: number }) =>
    Math.max(edges.head, edges.tail) /
    Math.max(1e-9, Math.min(edges.head, edges.tail));

  /**
   * The first defect the shipped beds have, in the form `ambient.mp3` has it:
   * low tonal content whose cycles do not divide the file's length, so the wrap
   * lands mid-waveform, plus the DC offset that file carries. The step at the
   * seam is then larger than any step inside the recording, which is a click.
   */
  function driftingTone(seconds: number): Float32Array {
    const frames = Math.round(seconds * RATE);
    const output = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      const time = index / RATE;
      output[index] =
        0.3 * Math.sin(2 * Math.PI * 51.3 * time) +
        0.15 * Math.sin(2 * Math.PI * 77.9 * time) +
        0.007;
    }
    return output;
  }

  /**
   * The second defect, in the form `sprinkler.mp3` has it: a recording that
   * starts at full level and fades away at the end, so looping it swells and
   * drops once per period. White noise takes large steps everywhere, so the
   * seam does not show up as a click; the level mismatch is the whole problem.
   */
  function fadingNoise(seconds: number, seed = 1): Float32Array {
    const frames = Math.round(seconds * RATE);
    const output = new Float32Array(frames);
    let state = seed;
    for (let index = 0; index < frames; index += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const position = index / frames;
      const fade = position < 0.7 ? 1 : Math.max(0.01, 1 - (position - 0.7) / 0.3);
      output[index] = ((state / 2147483648) * 2 - 1) * 0.3 * fade;
    }
    return output;
  }

  it("removes the step at the wrap", () => {
    const source = driftingTone(6);
    const prepared = prepareLoop([source], RATE);
    expect(prepared).not.toBeNull();
    const looped = prepared?.channels[0] as Float32Array;
    // Above one, the wrap is the sharpest edge anywhere in the recording, which
    // is what an ear picks out as a tick.
    expect(seamRatio(source)).toBeGreaterThan(1);
    expect(seamRatio(looped)).toBeLessThan(1);
  });

  it("matches the two ends in level", () => {
    const source = fadingNoise(6);
    const looped = prepareLoop([source], RATE)?.channels[0] as Float32Array;
    expect(edgeRatio(edgeLevels(source, RATE))).toBeGreaterThan(4);
    expect(edgeRatio(edgeLevels(looped, RATE))).toBeLessThan(1.6);
  });

  it("removes the DC offset without changing the level of the body", () => {
    const source = driftingTone(6);
    const looped = prepareLoop([source], RATE)?.channels[0] as Float32Array;
    let mean = 0;
    for (let index = 0; index < looped.length; index += 1)
      mean += looped[index] ?? 0;
    mean /= looped.length;
    expect(Math.abs(mean)).toBeLessThan(1e-3);
    expect(rms(looped)).toBeGreaterThan(rms(source) * 0.7);
    expect(rms(looped)).toBeLessThan(rms(source) * 1.4);
  });

  it("leaves a buffer alone when there is nothing there to repair", () => {
    expect(prepareLoop([new Float32Array(RATE * 4)], RATE)).toBeNull();
    expect(prepareLoop([driftingTone(0.4)], RATE)).toBeNull();
    expect(prepareLoop([], RATE)).toBeNull();
  });

  it("keeps both channels the same length", () => {
    const prepared = prepareLoop([fadingNoise(6, 1), fadingNoise(6, 99)], RATE);
    expect(prepared?.channels).toHaveLength(2);
    expect(prepared?.channels[0]?.length).toBe(prepared?.frames);
    expect(prepared?.channels[1]?.length).toBe(prepared?.frames);
  });
});

/**
 * The rest of this file drives the engine directly. These drive it through the
 * manager the game actually calls, which is where the music meets the effects:
 * the voice budget they share, the master bus they both hang off, and the
 * proximity beds that use the same sustain machinery.
 */
describe("the manager's own audio", () => {
  const DECODED_SECONDS = 12;

  async function boot(respond: (url: string) => Promise<unknown> = () =>
    Promise.reject(new Error("offline"))) {
    const recorder = new Recorder();
    const context = recorder.context();
    Object.assign(context, {
      decodeAudioData: () =>
        Promise.resolve({
          origin: "decoded",
          numberOfChannels: 1,
          duration: DECODED_SECONDS,
          sampleRate: 48000,
          getChannelData: () => new Float32Array(DECODED_SECONDS * 48000),
        }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => respond(url)),
    );
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: class {
        constructor() {
          return context as unknown as AudioContext;
        }
      },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { AudioManager } = await import("@/lib/audio/AudioManager");
    return { manager: AudioManager, recorder };
  }

  const ok = () =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)) });

  /** Drain the loader's promises without letting the scheduler run. */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("does not spend the effects voice budget on music", async () => {
    const { manager, recorder } = await boot();
    manager.setMusicScene("run");
    run(recorder, 4_000);
    expect(recorder.voices.length).toBeGreaterThan(10);
    const before = recorder.voices.length;
    // Sixteen is MAX_VOICES. With the score already holding a chord and a bass
    // line, all sixteen must still be available to the game.
    for (let index = 0; index < 16; index += 1) manager.click();
    expect(recorder.voices.length - before).toBe(16);
  });

  it("ducks the music when a trap fires", async () => {
    const { manager, recorder } = await boot();
    manager.setMusicScene("run");
    run(recorder, 1_000);
    const before = recorder.gains.map((gain) => gain.gain?.events.length ?? 0);
    manager.hazard("swinging_hammer", 14);
    // One gain on the music's path dips and comes back to unity. Which node it
    // is does not matter; that the score is pushed down and released does.
    const ducked = recorder.gains.filter((gain, index) => {
      const added = (gain.gain?.events ?? []).slice(before[index] ?? 0);
      return (
        added.length > 1 &&
        Math.min(...added.map((event) => event.value)) < 0.5 &&
        added.at(-1)?.value === 1
      );
    });
    expect(ducked).toHaveLength(1);
  });

  it("stops the score when the player mutes and starts it again on unmute", async () => {
    const { manager, recorder } = await boot();
    manager.setMusicScene("run");
    run(recorder, 2_000);
    manager.setMuted(true);
    const muted = recorder.voices.length;
    run(recorder, 3_000);
    expect(recorder.voices).toHaveLength(muted);
    manager.setMuted(false);
    run(recorder, 2_000);
    expect(recorder.voices.length).toBeGreaterThan(muted);
  });

  it("plays nothing at all when the music level is zero", async () => {
    const { manager, recorder } = await boot();
    manager.setMusicVolume(0);
    manager.setMusicScene("run");
    run(recorder, 4_000);
    expect(recorder.voices).toHaveLength(0);
    manager.setMusicVolume(0.7);
    manager.setMusicScene("run");
    run(recorder, 2_000);
    expect(recorder.voices.length).toBeGreaterThan(0);
    // And dragging it back to zero mid-run stops the scheduler rather than
    // leaving it placing notes into a silent bus.
    manager.setMusicVolume(0);
    const silenced = recorder.voices.length;
    run(recorder, 3_000);
    expect(recorder.voices).toHaveLength(silenced);
  });

  it("holds a proximity bed through a gap and releases it after one", async () => {
    const { manager, recorder } = await boot();
    const started = recorder.voices.length;
    manager.proximityBed("floor_fan:a", "wind", 0.8);
    expect(recorder.voices.length).toBe(started + 1);
    // Out of range for a moment: the voice is held rather than rebuilt, so
    // stepping back in does not start a second one. This is the case a player
    // walking the edge of a fan's cone produces on every frame.
    manager.proximityBed("floor_fan:a", "wind", 0);
    vi.advanceTimersByTime(200);
    manager.proximityBed("floor_fan:a", "wind", 0.8);
    expect(recorder.voices.length).toBe(started + 1);
    manager.proximityBed("floor_fan:a", "wind", 0);
    vi.advanceTimersByTime(800);
    manager.proximityBed("floor_fan:a", "wind", 0);
    // Out of range long enough to be released, so coming back builds a new one.
    manager.proximityBed("floor_fan:a", "wind", 0.8);
    expect(recorder.voices.length).toBe(started + 2);
  });

  it("never lets a bed past the sustain ceiling", async () => {
    const { manager, recorder } = await boot();
    manager.proximityBed("sprinkler:b", "spray", 4);
    const bed = recorder.gains.at(-1);
    const target = bed?.gain?.events.at(-1);
    expect(target?.value).toBeLessThanOrEqual(0.05);
    expect(target?.value).toBeGreaterThan(0);
  });

  it("swaps the room tone onto the recording once it arrives", async () => {
    const { manager, recorder } = await boot(ok);
    manager.startAmbience();
    // The file has not landed yet, so the bed is the synthesised stand-in.
    expect(recorder.voices.at(-1)?.wave).toBe("noise");
    const before = recorder.voices.length;
    await settle();
    expect(recorder.voices.length).toBeGreaterThan(before);
    manager.stopAmbience();
  });

  it("arms the room tone swap once, however many retries there are", async () => {
    const { manager, recorder } = await boot(ok);
    // A retry re-runs the effect that starts the ambience, and it must not
    // queue a second swap onto the same download.
    manager.startAmbience();
    manager.startAmbience();
    manager.startAmbience();
    const before = recorder.voices.length;
    await settle();
    // Exactly one replacement bed, not three.
    expect(recorder.voices.length).toBe(before + 1);
  });
});
