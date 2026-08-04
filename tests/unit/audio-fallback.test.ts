import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AudioManager layers recorded samples over its procedural synthesis, and
 * the synthesis has to survive a missing, unreachable, or undecodable file.
 * Web Audio does not exist under Node, so these tests drive the manager through
 * a fake context that records which nodes it was asked to build: an oscillator
 * or a source fed by the generated noise buffer means synthesis ran, a source
 * fed by a decoded buffer means the sample ran.
 */

interface FakeParam {
  value: number;
  setValueAtTime(value: number, at: number): void;
  exponentialRampToValueAtTime(value: number, at: number): void;
  setTargetAtTime(value: number, at: number, constant: number): void;
}

interface FakeBuffer {
  origin: "created" | "decoded";
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

interface FakeSource {
  buffer: FakeBuffer | null;
  loop: boolean;
  playbackRate: FakeParam;
  /** Milliseconds on the test's own clock when the manager built this source. */
  createdAt: number;
  start(): void;
  stop(): void;
  connect<T>(target: T): T;
}

interface Recorder {
  oscillators: number;
  sources: FakeSource[];
  urls: string[];
  /** Every gain node built, in the order the manager built them. */
  gains: FakeParam[];
  /** Advanced by the tests in step with the fake timers. */
  now: number;
}

const DECODED_SECONDS = 0.5;

const param = (): FakeParam => ({
  value: 0,
  setValueAtTime() {},
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
});

const buffer = (
  origin: FakeBuffer["origin"],
  seconds: number,
  sampleRate = 44100,
  peak = 0,
): FakeBuffer => ({
  origin,
  duration: seconds,
  sampleRate,
  numberOfChannels: 1,
  getChannelData: () => {
    const data = new Float32Array(Math.max(1, Math.round(seconds * sampleRate)));
    // One sample at the peak is enough: the manager takes the maximum.
    data[0] = peak;
    return data;
  },
});

const passthrough = <T,>(target: T): T => target;

/** A source file, read as text, for the call-site assertions at the bottom. */
const source = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

function fakeContextClass(recorder: Recorder, decode: () => Promise<FakeBuffer>) {
  return class {
    currentTime = 0;
    sampleRate = 44100;
    state = "running";
    destination = { connect: passthrough };

    resume(): Promise<void> {
      return Promise.resolve();
    }

    createGain() {
      const gain = param();
      recorder.gains.push(gain);
      return { gain, connect: passthrough };
    }

    createDynamicsCompressor() {
      return {
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
        connect: passthrough,
      };
    }

    createBiquadFilter() {
      return { type: "bandpass", frequency: param(), Q: param(), connect: passthrough };
    }

    createOscillator() {
      recorder.oscillators += 1;
      return {
        type: "sine",
        frequency: param(),
        start() {},
        stop() {},
        connect: passthrough,
      };
    }

    createBufferSource(): FakeSource {
      const source: FakeSource = {
        buffer: null,
        loop: false,
        playbackRate: param(),
        createdAt: recorder.now,
        start() {},
        stop() {},
        connect: passthrough,
      };
      recorder.sources.push(source);
      return source;
    }

    createBuffer(channels: number, frames: number, rate: number): FakeBuffer {
      return { ...buffer("created", frames / rate, rate), numberOfChannels: channels };
    }

    decodeAudioData(): Promise<FakeBuffer> {
      return decode();
    }
  };
}

/**
 * One macrotask turn drains the whole microtask queue, and every await in the
 * loader chain is a promise rather than a timer, so this settles the background
 * warm-up completely.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(
  respond: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>,
  decode: () => Promise<FakeBuffer> = () =>
    Promise.resolve(buffer("decoded", DECODED_SECONDS)),
) {
  const recorder: Recorder = {
    oscillators: 0,
    sources: [],
    urls: [],
    gains: [],
    now: 0,
  };
  const fetchMock = vi.fn((url: string) => {
    recorder.urls.push(url);
    return respond(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: fakeContextClass(recorder, decode),
  };
  vi.resetModules();
  const { AudioManager } = await import("@/lib/audio/AudioManager");
  return { manager: AudioManager, recorder, fetchMock };
}

const ok = () =>
  Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)) });
const offline = () => Promise.reject(new Error("offline"));
const missing = () =>
  Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("AudioManager sample loading", () => {
  it("requests samples from the shared asset base", async () => {
    const { manager, fetchMock } = await setup(offline);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.click();
    expect(fetchMock).toHaveBeenCalledWith("/audio/click.mp3");
    await settle();
  });

  it("synthesises the hazard while the sample is still in flight", async () => {
    // A fetch that never settles is the state the game is in for the first
    // moments of every session. Two oscillators, not one: a hard discrete hit
    // now carries the shared sub-thump under the trap's own voice.
    const { manager, recorder } = await setup(() => new Promise(() => {}));
    manager.hazard("mousetrap", 14);
    expect(recorder.oscillators).toBe(2);
    expect(recorder.sources.some((source) => source.buffer?.origin === "created")).toBe(
      true,
    );
  });

  it("keeps synthesising after the fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, recorder } = await setup(offline);
    manager.hazard("swinging_hammer", 14);
    await settle();
    const oscillators = recorder.oscillators;
    manager.hazard("swinging_hammer", 14);
    // One voice for the hammer, plus at most one more if the shared
    // sub-thump's real-time throttle has reopened between the two calls -
    // this test cannot pin the wall clock, so it pins the honest range.
    expect(recorder.oscillators - oscillators).toBeGreaterThanOrEqual(1);
    expect(recorder.oscillators - oscillators).toBeLessThanOrEqual(2);
    expect(recorder.sources.every((source) => source.buffer?.origin !== "decoded")).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps synthesising when the file is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, recorder } = await setup(missing);
    manager.click();
    await settle();
    const oscillators = recorder.oscillators;
    manager.click();
    expect(recorder.oscillators).toBe(oscillators + 1);
  });

  it("asks for a recording on a trap the roster grew into", async () => {
    // The gate in sample() was a hand-written list of fifteen trap ids, written
    // when the roster was sixteen. Wave B took it to fifty-four and the list did
    // not move, so for thirty-eight traps sample() answered "missing" on its
    // first line and the URL - built after that gate - was never even
    // constructed. A correctly named mp3 dropped into public/audio for any of
    // them could not have played, and nothing anywhere would have said so.
    //
    // Before the list was derived from TRAP_TYPES this assertion failed with
    // zero fetches, which is the whole of the defect.
    const { manager, fetchMock } = await setup(missing);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.hazard("paint_bucket", 14);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/audio/paint_bucket.mp3");
  });

  it("still synthesises that trap while it has no recording", async () => {
    // Reaching for the file must not cost the fallback. Most of the roster has
    // no recording yet and has to keep its synthesised voice.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, recorder } = await setup(missing);
    manager.hazard("paint_bucket", 14);
    await settle();
    const oscillators = recorder.oscillators;
    manager.hazard("paint_bucket", 14);
    expect(recorder.oscillators).toBeGreaterThan(oscillators);
    expect(recorder.sources.every((source) => source.buffer?.origin !== "decoded")).toBe(
      true,
    );
  });

  it("never asks for a recording it could never play", async () => {
    // LaundryBasketTrap never calls contact(), so hazard() cannot fire for it
    // and its file would be fetched and decoded once a session to be heard
    // never. Deriving the list from TRAP_TYPES would have quietly undone that,
    // so the exclusion is explicit and this is what holds it.
    const { manager, fetchMock } = await setup(ok);
    manager.hazard("laundry_basket", 14);
    await settle();
    expect(fetchMock).not.toHaveBeenCalledWith("/audio/laundry_basket.mp3");
  });

  it("keeps synthesising when decoding fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, recorder } = await setup(ok, () =>
      Promise.reject(new Error("not an mp3")),
    );
    manager.click();
    await settle();
    const oscillators = recorder.oscillators;
    manager.click();
    expect(recorder.oscillators).toBe(oscillators + 1);
  });

  it("plays the decoded sample instead of the synthesis once it lands", async () => {
    const { manager, recorder } = await setup(ok);
    manager.click();
    expect(recorder.oscillators).toBe(1);
    await settle();
    const oscillators = recorder.oscillators;
    const played = recorder.sources.length;
    manager.click();
    expect(recorder.oscillators).toBe(oscillators);
    expect(recorder.sources).toHaveLength(played + 1);
    expect(recorder.sources.at(-1)?.buffer?.origin).toBe("decoded");
  });

  it("plays a harder hit lower than a light one", async () => {
    const { manager, recorder } = await setup(ok);
    manager.click();
    await settle();
    manager.hazard("rolling_fridge", 1);
    manager.hazard("rolling_fridge", 20);
    // Selected by origin rather than by position: the heavy hit also fires
    // the sub-thump's noise burst, so the last raw source is not the sample.
    const samples = recorder.sources.filter(
      (source) => source.buffer?.origin === "decoded",
    );
    const light = samples.at(-2)?.playbackRate.value ?? 0;
    const heavy = samples.at(-1)?.playbackRate.value ?? 0;
    expect(light).toBeGreaterThan(heavy);
  });
});

/**
 * The set was meant to be peak-normalised to -1.5 dBFS and mostly is, but
 * `footstep.mp3` peaks at -11.7 dBFS and `ceiling_fan.mp3` at -11.4, so both
 * played about ten decibels under the level their gain argument asked for. The
 * manager measures each file rather than assuming.
 */
describe("AudioManager sample levels", () => {
  /** The gain the recording is played through, which sample() builds last. */
  const levelOf = (recorder: Recorder) => recorder.gains.at(-1)?.value ?? 0;

  it("plays a quiet file louder so its gain argument still means what it says", async () => {
    const half = 0.4207;
    const { manager, recorder } = await setup(ok, () =>
      Promise.resolve(buffer("decoded", DECODED_SECONDS, 44100, half)),
    );
    manager.click();
    await settle();
    manager.click();
    // click() asks for an absolute output peak of 0.03. Against a file that
    // reaches 0.4207 rather than the assumed 0.8414, that is twice the gain.
    expect(levelOf(recorder)).toBeCloseTo(0.03 / half, 5);
  });

  it("falls back to the assumed peak for a file that decoded to silence", async () => {
    const { manager, recorder } = await setup(ok);
    manager.click();
    await settle();
    manager.click();
    // Dividing by a peak of nothing would be dividing by nothing.
    expect(levelOf(recorder)).toBeCloseTo(0.03 / 0.8414, 5);
  });
});

describe("AudioManager sustained beds", () => {
  it("synthesises the bed until its sample exists, then loops the sample", async () => {
    const { manager, recorder } = await setup(ok);
    manager.startSustain("ceiling_fan:7", "wind");
    const synthesised = recorder.sources.at(-1);
    expect(synthesised?.buffer?.origin).toBe("created");
    expect(synthesised?.loop).toBe(true);
    manager.stopSustain("ceiling_fan:7");
    await settle();
    manager.startSustain("ceiling_fan:7", "wind");
    const recorded = recorder.sources.at(-1);
    expect(recorded?.buffer?.origin).toBe("decoded");
    expect(recorded?.loop).toBe(true);
  });

  it("picks the bed named in the sustain id", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, recorder } = await setup((url) =>
      url.endsWith("ceiling_fan.mp3") ? ok() : offline(),
    );
    manager.click();
    await settle();
    manager.startSustain("ceiling_fan:7", "wind");
    expect(recorder.sources.at(-1)?.buffer?.origin).toBe("decoded");
    // Same texture, a bed whose file never arrived: still synthesised.
    manager.startSustain("floor_fan:2", "wind");
    expect(recorder.sources.at(-1)?.buffer?.origin).toBe("created");
  });
});

/**
 * The voice budget under a continuous trap.
 *
 * `sample` reserves a voice for the buffer's whole length, and five of the
 * recorded traps are five to six seconds of a running machine rather than a
 * hit. Played as one-shots on the cooldown their traps re-fire at they stack
 * until the budget is gone, and once it is gone the synthesis a failed sample
 * falls back to is refused too, so the player's own jumps and landings stop
 * sounding for as long as they stand there.
 *
 * The two scenarios below are the same twenty seconds driven at the same 450 ms
 * cadence against the same six-second recording. `rolling_fridge` is a one-shot
 * trap and so still takes the path all five used to take, which is what makes
 * it a measurement of the old behaviour rather than a model of it.
 */
describe("standing in a continuous trap", () => {
  /** The floor fan's gate in components/game/TrapRenderer.tsx. */
  const COOLDOWN_MS = 450;
  const STAND_MS = 20_000;
  /** Measured length of floor_fan.mp3, angry_vacuum.mp3 and ceiling_fan.mp3. */
  const BED_SECONDS = 6;
  const FAN_IMPULSE = 19;

  const longDecode = () => Promise.resolve(buffer("decoded", BED_SECONDS));

  /** Advance the fake timers and the clock the sources are stamped against. */
  function tick(recorder: Recorder, ms: number): void {
    recorder.now += ms;
    vi.advanceTimersByTime(ms);
  }

  /** Let the loader's promises resolve without moving the clock. */
  async function drain(): Promise<void> {
    for (let turn = 0; turn < 40; turn += 1) {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    }
  }

  const oneShots = (recorder: Recorder) =>
    recorder.sources.filter(
      (source) => source.buffer?.origin === "decoded" && !source.loop,
    );

  const loops = (recorder: Recorder) =>
    recorder.sources.filter((source) => source.loop);

  /** How many recorded one-shots are still playing at a given instant. */
  function overlapping(recorder: Recorder, atMs: number): number {
    return oneShots(recorder).filter((source) => {
      const rate = Math.max(0.01, source.playbackRate.value);
      const endsAt = source.createdAt + ((source.buffer?.duration ?? 0) / rate) * 1000;
      return atMs >= source.createdAt && atMs < endsAt;
    }).length;
  }

  function peakOverlapping(recorder: Recorder, untilMs: number): number {
    let peak = 0;
    for (let at = 0; at <= untilMs; at += 50)
      peak = Math.max(peak, overlapping(recorder, at));
    return peak;
  }

  /**
   * Twenty seconds of one trap firing on its cooldown, and nothing else. The
   * first call is outside the census: it starts the download, and the baseline
   * is taken once that has landed, so what is counted is the standing rather
   * than the warm-up.
   */
  async function stand(type: "rolling_fridge" | "floor_fan") {
    const { manager, recorder } = await setup(ok, longDecode);
    manager.hazard(type, FAN_IMPULSE);
    await drain();
    const baseline = {
      sources: recorder.sources.length,
      oscillators: recorder.oscillators,
    };
    for (let at = 0; at < STAND_MS; at += COOLDOWN_MS) {
      manager.hazard(type, FAN_IMPULSE);
      tick(recorder, COOLDOWN_MS);
    }
    return { manager, recorder, baseline };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("used to hold almost the whole voice budget on one trap", async () => {
    const { manager, recorder } = await stand("rolling_fridge");
    // Six seconds of recording started every 450 ms, played a little slow
    // because a hard hit pitches down, is fourteen copies over one another
    // out of a MAX_VOICES of sixteen - one fewer than before the shared hit
    // sub-thump, whose short bursts transiently claim from the same budget.
    expect(peakOverlapping(recorder, STAND_MS)).toBe(14);
    // One voice left for the whole rest of the game, so a short burst of an
    // ordinary cue runs out of them. What does not fit is silence rather than
    // synthesis, because the fallback claims from the same budget.
    const before = recorder.sources.length;
    const oscillators = recorder.oscillators;
    for (let step = 0; step < 6; step += 1) manager.footstep();
    expect(recorder.sources.length - before).toBeLessThan(6);
    expect(recorder.oscillators).toBe(oscillators);
  });

  it("plays a continuous trap as one held bed instead", async () => {
    const { manager, recorder, baseline } = await stand("floor_fan");
    // Twenty seconds of a fan built nothing at all: no one-shot, and no second
    // bed, because the one from the first report is still running.
    expect(recorder.sources).toHaveLength(baseline.sources);
    expect(recorder.oscillators).toBe(baseline.oscillators);
    expect(oneShots(recorder)).toHaveLength(0);
    expect(peakOverlapping(recorder, STAND_MS)).toBe(0);
    // And the bed is the recording rather than the synthesised stand-in it
    // started as, because the file landed while it was running.
    expect(loops(recorder).at(-1)?.buffer?.origin).toBe("decoded");
    // The rest of the game is still audible after standing there.
    manager.jump();
    expect(recorder.sources.length).toBeGreaterThan(baseline.sources);
  });

  it("releases the bed once the trap stops reporting", async () => {
    const { manager, recorder, baseline } = await stand("floor_fan");
    // The trap has no "the player left" event to send; it simply stops calling.
    tick(recorder, 2_000);
    manager.hazard("floor_fan", FAN_IMPULSE);
    // A new bed means the old one was torn down rather than left running.
    expect(loops(recorder).length).toBeGreaterThan(
      loops({ ...recorder, sources: recorder.sources.slice(0, baseline.sources) })
        .length,
    );
  });

  it("holds one bed per trap type rather than one per report", async () => {
    const { manager, recorder } = await setup(ok, longDecode);
    manager.hazard("floor_fan", FAN_IMPULSE);
    manager.hazard("angry_vacuum", 13);
    manager.hazard("sprinkler", 9);
    await drain();
    const built = loops(recorder).length;
    for (let at = 0; at < 4_000; at += COOLDOWN_MS) {
      manager.hazard("floor_fan", FAN_IMPULSE);
      manager.hazard("angry_vacuum", 13);
      manager.hazard("sprinkler", 9);
      tick(recorder, COOLDOWN_MS);
    }
    expect(loops(recorder)).toHaveLength(built);
  });

  it("keeps a transient on the two traps whose contact is a collision", async () => {
    // The ceiling fan and the rotating toilet strike rather than push, and a bed
    // has no attack, so both keep their synthesised voice over the top of it.
    const { manager, recorder } = await setup(ok, longDecode);
    manager.hazard("ceiling_fan", 12);
    await drain();
    const oscillators = recorder.oscillators;
    manager.hazard("ceiling_fan", 12);
    expect(recorder.oscillators).toBeGreaterThan(oscillators);
    expect(loops(recorder).length).toBeGreaterThan(0);
  });
});

/**
 * No one trap may spend a large share of the voice budget on its own.
 *
 * `claim` allows sixteen percussive voices at once and every synthesised note
 * takes one, so a trap voiced as eight oscillators would put half the budget
 * behind a single contact and everything else in the level would fall silent
 * behind it. That is the same failure the continuous traps used to cause by a
 * different route, and at fifty-four traps it is worth a guard rather than a
 * convention.
 */
describe("the cost of one hazard", () => {
  /** The five in domino_line, which is the widest voice the game shipped. */
  const VOICE_CEILING = 5;

  /**
   * Voices one `case` starts. A call inside a `[...].forEach(` runs once per
   * entry, and every such loop in this file holds exactly one call, so the
   * array's length stands in for the repeat count.
   */
  function voicesPerTrap(): Map<string, number> {
    const text = source("lib/audio/AudioManager.ts");
    const from = text.indexOf("hazard(type: TrapType, impulse: number): void {");
    expect(from, "AudioManager.hazard() not found").toBeGreaterThan(-1);
    const body = text.slice(from, text.indexOf("const unvoiced", from));
    const parts = body.split(/\n      case "(\w+)":/);
    const counts = new Map<string, number>();
    let sharing: string[] = [];
    for (let index = 1; index < parts.length; index += 2) {
      const name = parts[index] as string;
      const code = (parts[index + 1] ?? "").replace(/\/\/[^\n]*/g, "");
      const calls = (code.match(/this\.(tone|noiseBurst|spring)\(/g) ?? []).length;
      if (calls === 0) {
        // A case that falls through to the next one, such as floor_fan.
        sharing.push(name);
        continue;
      }
      const repeats = [...code.matchAll(/\[([\d,\s]+)\]\.forEach\(/g)].reduce(
        (extra, match) => extra + (match[1] as string).split(",").length - 1,
        0,
      );
      for (const shared of [...sharing, name]) counts.set(shared, calls + repeats);
      sharing = [];
    }
    return counts;
  }

  it("keeps every trap inside the widest voice the game already shipped", () => {
    const counts = voicesPerTrap();
    // Fifty-four traps, and every one of them has to be voiced.
    expect(counts.size).toBeGreaterThan(50);
    for (const [type, voices] of counts)
      expect(voices, `${type} starts ${voices} voices at once`).toBeLessThanOrEqual(
        VOICE_CEILING,
      );
  });

  it("leaves room for the player underneath the loudest trap", () => {
    // MAX_VOICES is sixteen. Two traps firing together at the ceiling still
    // has to leave the runner their own jump, landing and footstep.
    const worst = Math.max(...voicesPerTrap().values());
    expect(worst * 2 + 3).toBeLessThanOrEqual(16);
  });
});

/**
 * Ten entry points were implemented and called by nothing outside this
 * directory, which is why the suite stayed green while the ambient bed, the
 * score, footsteps, the countdown and placement feedback were all unreachable
 * from a running game. Text rather than behaviour, because what failed was the
 * absence of a call site, and a call site is a thing a file either has or does
 * not.
 */
describe("the audio surface is reachable from the game", () => {
  const callers: Record<string, readonly string[]> = {
    "components/game/GameClient.tsx": [
      "AudioManager.startAmbience()",
      "AudioManager.stopAmbience()",
      "AudioManager.setMusicScene(",
      "AudioManager.countdown(",
    ],
    "components/game/PlayerController.tsx": ["AudioManager.footstep()"],
    "components/hud/GameOverlays.tsx": [
      "AudioManager.click()",
      "AudioManager.placement(",
    ],
    "lib/audio/AudioManager.ts": ["this.proximityBed("],
  };

  for (const [file, calls] of Object.entries(callers))
    for (const call of calls)
      it(`${file} calls ${call}`, () => {
        expect(source(file)).toContain(call);
      });

  it("routes all five continuous traps to a bed", () => {
    const text = source("lib/audio/AudioManager.ts");
    for (const type of [
      "floor_fan",
      "ceiling_fan",
      "angry_vacuum",
      "sprinkler",
      "rotating_toilet",
    ])
      expect(text, `${type} is not routed to a bed`).toMatch(
        new RegExp(`${type}: \\{ build:`),
      );
  });
});
