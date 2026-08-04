import type { TrapType } from "@/lib/game/types";
import { TRAP_TYPES } from "@/lib/game/trap-catalog";
import { prepareLoop } from "@/lib/audio/loop";
import { MusicEngine, type MusicScene } from "@/lib/audio/music";

type Wave = OscillatorType;

interface ToneOptions {
  /** Glide to this frequency across the note. */
  to?: number;
  wave?: Wave;
  gain?: number;
  delayMs?: number;
}

interface NoiseOptions {
  filter?: BiquadFilterType;
  frequency?: number;
  q?: number;
  gain?: number;
  delayMs?: number;
}

/** Percussive voices in flight. Sustained loops are tracked separately. */
const MAX_VOICES = 16;
const NOISE_SECONDS = 1;

/**
 * Recorded audio lives in `public/audio`. The Next app serves `public/` at the
 * site root and leaves the variable undefined; the Vite edition copies the same
 * folder to the bundle root and pins the base to "./". This is the expression
 * the licence link in components/hud/SettingsPanel.tsx already uses, so both
 * editions resolve a sample the same way they resolve every other asset.
 */
const SAMPLE_BASE = `${process.env.NEXT_PUBLIC_ASSET_BASE ?? "/"}audio/`;

/**
 * The peak the set was supposed to be normalised to, -1.5 dBFS, and what a file
 * is assumed to reach until it has been decoded and measured.
 *
 * Most of the twenty-nine are within a decibel of it. Two are nowhere near:
 * measured with ffmpeg, `footstep.mp3` peaks at -11.7 dBFS and
 * `ceiling_fan.mp3` at -11.4, so both played about ten decibels under what the
 * gain argument asked for. `peakOf` measures each file once instead, which
 * makes a gain argument mean the same absolute output peak for a recording that
 * it already means for a synthesised note whatever the file's own level is.
 */
const SAMPLE_PEAK = 0.8414;
/** Below this a decoded file is silence, and dividing by it is meaningless. */
const MEASURED_PEAK_FLOOR = 1e-3;

/**
 * Loops play under a continuous level, and the synthesised beds they replace
 * lost most of their energy in a band-pass before reaching that level. A
 * full-band recording therefore reads several times louder at the same node
 * gain. The trim is an estimate from the filter bandwidths, not a level matched
 * by ear, and it errs quiet because a bed that sits too loud is fatiguing.
 *
 * Applied against the file's own measured peak for the same reason the one-shot
 * path is: `ceiling_fan.mp3` is ten decibels quieter than the other four beds,
 * and without this the ceiling fan would sit that far under the floor fan for
 * no reason a player could hear a cause for.
 */
const BED_TRIM = 0.5;

/** The loudest sample in a decoded file, across every channel. */
function measurePeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1)
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
  }
  return peak;
}

const CUE_KEYS = [
  "click",
  "jump",
  "land",
  "footstep",
  "grab",
  "release",
  "countdown",
  "placement_ok",
  "placement_bad",
  "fail",
  "finish",
  "publish",
] as const;
type CueKey = (typeof CUE_KEYS)[number];

/**
 * The loopable beds. Five of them are trap types, so `satisfies` fails the build
 * if one is ever renamed out from under this list.
 */
const BED_KEYS = [
  "angry_vacuum",
  "floor_fan",
  "ceiling_fan",
  "sprinkler",
  "rotating_toilet",
  "ambient",
] as const satisfies readonly (TrapType | "ambient")[];
type BedKey = (typeof BED_KEYS)[number];

type SampleKey = TrapType | CueKey | "ambient";

type BedBuild = "wind" | "hum" | "spray";

/** Texture requested when the sustain id names nothing recognisable. */
const BED_FOR_BUILD: Record<BedBuild, BedKey> = {
  wind: "floor_fan",
  hum: "angry_vacuum",
  spray: "sprinkler",
};

/** The sustain id the room tone runs under. Contains "ambient", so it resolves
 * to `ambient.mp3` through the same lookup every trap bed uses. */
const AMBIENCE_ID = "ambient";
/** Ceiling on a sustain's gain, and the room tone's share of it. */
const SUSTAIN_CEILING = 0.05;
const AMBIENCE_LEVEL = 0.026;
/**
 * A bed under this much nearness is inaudible, and one that has been inaudible
 * for this long is gone. Without the delay a player standing on the edge of a
 * fan's cone would build and tear down an oscillator every frame.
 */
const BED_FLOOR = 0.02;
const BED_RELEASE_MS = 700;
/** Music sits under the effects, and the player can move it further under. */
const DEFAULT_MUSIC_VOLUME = 0.7;

/**
 * Absolute output peak per trap at full severity, carried over from the peak
 * gain each trap's synthesised hit was tuned to. Every recording is played back
 * against its own measured peak, so without this table the mousetrap and the
 * laundry basket would land at the same loudness and severity would stop
 * reading.
 *
 * This is not the impulse table in lib/game/trap-catalog.ts, and it should not
 * be derived from it. How hard a trap hits already reaches this file through
 * `impulse`, which `hazard` turns into a weight spanning SEVERITY_FLOOR to 1 of
 * the peak below. What this table carries is the other half: how loud the object
 * is. The mousetrap reports an impulse of 11 and is the loudest entry here
 * because a spring snapping is a loud thing; the floor fan reports 19 and sits
 * near the bottom because moving air is not. A trap that repeats also has to
 * sit lower than a one-shot of the same violence, or it machine-guns the mix.
 *
 * Six entries are never read. The five in SUSTAINED_TRAPS take their level
 * from SUSTAIN_CEILING instead, and `laundry_basket` reports no hazard at all.
 * All six stay: the record covers every trap type, so removing a key breaks the
 * exhaustiveness guard, and each is the level that trap would return to if it
 * ever became an ordinary one-shot.
 */
const HAZARD_PEAK: Record<TrapType, number> = {
  mousetrap: 0.12,
  swinging_hammer: 0.09,
  paint_bucket: 0.085,
  drawer_slam: 0.075,
  spin_cycle: 0.06,
  cord_trip: 0.055,
  rug_pull: 0.05,
  sticky_gum: 0.03,
  rolling_fridge: 0.07,
  ceiling_fan: 0.07,
  spring_pad: 0.06,
  rotating_toilet: 0.05,
  giant_beach_ball: 0.05,
  banana_peel: 0.05,
  fridge_magnet: 0.05,
  robot_mop: 0.045,
  floor_fan: 0.045,
  angry_vacuum: 0.045,
  toaster_launcher: 0.04,
  sprinkler: 0.04,
  soap_slick: 0.035,
  laundry_basket: 0.03,
  // Breaking crockery is the brightest, sharpest event in the game after the
  // mousetrap, and louder than the drawer's cutlery at 0.075.
  plate_shards: 0.095,
  // A steel plate tipping and slamming: the drawer's weight class.
  tilt_plate: 0.075,
  // Rattling metal, then the burst. Between the drawer and the spin cycle.
  pipe_burst: 0.07,
  // A trolley banging into things, lighter than the fridge's 0.07 charge.
  cart_blocker: 0.06,
  // A sprung mass under fabric. Soft for its impulse, so the spring pad's level.
  mattress_rebound: 0.06,
  // A hollow metal chute, which is mostly resonant body.
  chute_drop: 0.06,
  // Pressurised steam. Sharper and higher than the sprinkler's spray at 0.04.
  steam_vents: 0.055,
  // Many small wooden ticks, quiet one at a time. The cord trip's neighbourhood.
  domino_line: 0.05,
  // String and fabric, which the rug pull already puts at 0.05.
  bunting_line: 0.045,
  // A light plastic flap on a small object.
  cat_flap: 0.045,
  // An electronic tone, which cuts through at less gain than anything physical.
  motion_sensor: 0.04,
  // One dull clank and then nothing: the tax it levies afterwards is silent.
  ankle_weight: 0.04,
  // Repeats on an 800 ms gate, the fastest of the sixteen, so it sits low.
  conveyor_strip: 0.04,
  // Water spreading across a floor, which is the soap slick's event.
  flood_puddle: 0.035,
  // Moving air with no motor behind it.
  updraft_vent: 0.035,
  // Fluff. The quietest thing in the game, and it should stay that way.
  dust_bunny: 0.025,
  // A cupboard of crockery arriving at once. Under the single breaking plate
  // at 0.095 per impact, but there are a great many of them.
  pile_on: 0.085,
  // A door-sized slab of wood arriving, which is the drawer with more of it.
  swing_door: 0.08,
  // Something under pressure giving way. Sharper than the pipe burst's 0.07.
  hot_potato: 0.065,
  // A shutter and a flash. Mechanical rather than electronic, so above the
  // motion sensor's 0.04.
  paparazzi: 0.06,
  // A timber frame going over with a rack of shoes behind it.
  shoe_rack: 0.06,
  // Two wooden chimes and a strike, so it sits with the cord trip at 0.055.
  cuckoo_clock: 0.055,
  // Gas catching: a lot of air moving and nothing striking.
  stove_ring: 0.055,
  // A plastic pad taking a landing, which is the spin cycle's weight class.
  bathroom_scales: 0.05,
  // Thin metal snapping shut on a spring.
  bin_pedal: 0.05,
  // Compressed air and a ball leaving it, a little above the toaster's 0.04.
  ball_machine: 0.05,
  // Glass ringing over water.
  fish_bowl: 0.05,
  // A whole magazine of small hard things summing into one arrival.
  ice_dispenser: 0.055,
  // A whistle and then the water behind it, under the steam vents at 0.055.
  kettle_boil: 0.05,
  // A timer ticking to a bell. Small, and mostly one clear tone.
  slow_fuse: 0.045,
  // Light aluminium and wet fabric, which is the rug pull's material.
  clothes_airer: 0.045,
  // Soft rubbish shifting. Barely above the dust bunny.
  junk_drift: 0.035,
  // A toy blade/rattle and an angry crawl impact.
  charles_murder_baby: 0.06,
};

/**
 * Traps that will never carry a recording, and why.
 *
 * `public/audio/laundry_basket.mp3` exists, but LaundryBasketTrap never calls
 * `contact()` — it is a passive obstacle, a tipped basket and five grabbable
 * socks, with no hazard event to voice — so `hazard()` can never fire for it
 * and the file was being fetched and decoded once per session to be heard
 * never. Confirmed with the trap's author. If the basket is ever given a
 * hazard, take it out of here and the recording plays again.
 */
const NEVER_RECORDED = new Set<TrapType>(["laundry_basket"]);

/**
 * Every trap whose recording the game will play, DERIVED rather than listed.
 *
 * This was a hand-written list of fifteen, and its docstring explained that
 * listing them saved the loader a request and a 404 on the traps no recording
 * was ever made for. That was true when it was written and the roster was
 * sixteen. Wave B took the roster to fifty-four and this list did not move, so
 * `sample()` returned "missing" on its very first line for thirty-eight traps —
 * and because the URL is built after that gate, a correctly named mp3 dropped
 * into public/audio for any of them would never have been fetched, never
 * decoded and never played. The file would have been dead weight with nothing
 * anywhere reporting it.
 *
 * So the saving is given up on purpose. A trap with no file now spends exactly
 * one 404 the first time a player triggers it, `load()` records the failure and
 * never retries it that session, and it synthesises from then on exactly as
 * before. That cost falls to zero as recordings land, and it buys the property
 * the list could not have: this can never again be the reason a shipped file
 * goes unheard.
 *
 * A key here is a permission, not a promise. `sample()` still answers "missing"
 * until a buffer has actually decoded, so the synthesised fallback below is
 * reached on exactly the same paths it always was.
 */
const RECORDED_TRAPS: readonly TrapType[] = TRAP_TYPES.filter(
  (type) => !NEVER_RECORDED.has(type),
);

/**
 * Every reachable trap recording is now present, so warming is derived too.
 * The old hand-maintained fifteen-item list would make a newly imported sound
 * synthesise on its first hit even though the file shipped. `NEVER_RECORDED`
 * remains the honest exception for laundry_basket, whose trap reports no audio
 * contact at all.
 */
const WARMED_TRAPS: readonly TrapType[] = RECORDED_TRAPS;

const RECORDED = new Set<SampleKey>([...CUE_KEYS, ...RECORDED_TRAPS, "ambient"]);

/**
 * The five traps whose recording is a running machine rather than a hit, and
 * the texture their bed synthesises while the file is in flight.
 *
 * All five are in `RECORDED_TRAPS` as well as `BED_KEYS`, and `hazard` used to
 * play them through `sample`, which reserves a voice for the buffer's whole
 * length: five to six seconds each, measured. The floor fan re-fires contact
 * every 450 ms, so standing in one started a fresh six-second copy thirteen
 * times over before the first had finished, spending all sixteen voices. Past
 * that point `claim` fails for everything, including the synthesis a failed
 * sample falls back to, and the player's own jumps and landings go silent for
 * as long as they stand there.
 *
 * A hazard call from any of the five means the same thing — the player is
 * inside the mechanic right now — so the bed follows it, and the recording
 * loops for as long as the calls keep coming instead of stacking copies.
 *
 * `strike` marks the two whose contact is a single collision rather than a
 * per-frame push. A blade or a bowl arriving needs a transient and a bed has
 * none, so those two keep their synthesised voice on top of it.
 */
const SUSTAINED_TRAPS: Partial<
  Record<TrapType, { build: BedBuild; strike: boolean }>
> = {
  floor_fan: { build: "wind", strike: false },
  ceiling_fan: { build: "wind", strike: true },
  angry_vacuum: { build: "hum", strike: false },
  sprinkler: { build: "spray", strike: false },
  rotating_toilet: { build: "hum", strike: true },
  sticky_gum: { build: "spray", strike: false },
  conveyor_strip: { build: "hum", strike: false },
  dust_bunny: { build: "hum", strike: false },
  flood_puddle: { build: "spray", strike: false },
  updraft_vent: { build: "wind", strike: false },
  slow_fuse: { build: "wind", strike: false },
  stove_ring: { build: "hum", strike: false },
  kettle_boil: { build: "spray", strike: false },
  junk_drift: { build: "hum", strike: false },
};

/**
 * A sustained trap silent for this long has been left behind. It has to clear
 * the slowest of the five report cadences — the sprinkler's 700 ms — with room
 * for a dropped frame, or a bed would stutter while the player stood still.
 */
const SUSTAINED_HOLD_MS = 1_100;
/** How often the beds are checked against that deadline. */
const SUSTAINED_SWEEP_MS = 250;

/**
 * The share of a trap's peak the lightest hit is worth, on both paths.
 *
 * They disagreed: the recorded path ran 0.45 to 1 of `HAZARD_PEAK` and the
 * synthesised path 0.6 to 1, so the same impulse landed a third louder on the
 * twenty-two synthesised traps than on the sixteen recorded ones, and severity
 * meant a different thing depending on which file happened to exist. One floor
 * makes the two agree at every impulse. Duration still stretches on the
 * synthesised path only, because a recording cannot be stretched without
 * moving its pitch, which is the channel it carries severity on instead.
 */
const SEVERITY_FLOOR = 0.5;

/** What a hit of the given weight is worth, as a share of the trap's peak. */
function severityOf(weight: number): number {
  return SEVERITY_FLOOR + (1 - SEVERITY_FLOOR) * weight;
}

/** Short cues first, then ambient, then trap recordings. */
const WARM_ORDER: readonly SampleKey[] = [
  ...CUE_KEYS,
  "ambient",
  ...WARMED_TRAPS,
];

/**
 * A sustain is keyed by whatever started it, so an id such as `ceiling_fan:7`
 * picks the matching bed. Anything opaque falls back to the generic bed for the
 * texture the caller asked for.
 */
function bedFor(id: string, build: BedBuild): BedKey {
  return BED_KEYS.find((key) => id.includes(key)) ?? BED_FOR_BUILD[build];
}

/**
 * What happened to a request to play a recording.
 *
 * Only "missing" is a reason to synthesise. "starved" means the voice budget is
 * spent, and every synthesised voice claims from the same budget, so a caller
 * that answers it by synthesising buys nothing but the work of building a graph
 * `claim` is about to refuse.
 */
type SampleOutcome = "played" | "missing" | "starved";

class AudioManagerClass {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sustains = new Map<
    string,
    { gain: GainNode; stop(): void; quietSince: number; level: number }
  >();
  private buffers = new Map<SampleKey, AudioBuffer>();
  /** Each decoded file's own peak, measured once. See SAMPLE_PEAK. */
  private peaks = new Map<SampleKey, number>();
  private loops = new Map<BedKey, AudioBuffer>();
  private loading = new Map<SampleKey, Promise<void>>();
  private failed = new Set<SampleKey>();
  /** The asset-base warning is worth saying once and never twice. */
  private warnedAssetBase = false;
  private warmed = false;
  private active = 0;
  private muted = false;
  private volume = 1;
  /** Throttle for the shared hit sub-thump, so repeat gates cannot drumroll it. */
  private lastThumpAt = 0;
  private music: MusicEngine | null = null;
  private scene: MusicScene = "silent";
  private musicVolume = DEFAULT_MUSIC_VOLUME;
  private musicEnabled = true;
  /** Beds already waiting on a download, so a restart cannot queue a second swap. */
  private bedSwapArmed = new Set<BedKey>();
  /** When each live sustained trap's bed stops being refreshed by its hazard. */
  private sustainedUntil = new Map<TrapType, number>();
  private sustainedSweep: ReturnType<typeof setInterval> | null = null;

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        value ? 0 : this.volume,
        this.context.currentTime,
        0.02,
      );
    // Muting stops the scheduler outright rather than leaving it placing notes
    // into a bus turned down to nothing.
    this.applyMusicScene();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    // Driven through the master bus so a change mid-note actually takes
    // effect; the old code snapshotted volume when each note was scheduled.
    if (this.master && this.context && !this.muted)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.02,
      );
  }

  /**
   * The score's state. Set it from the game's phase; `musicSceneForPhase` in
   * lib/audio/music.ts turns one into the other.
   *
   * Nothing sounds until the context is running, so calling this during boot is
   * safe: the scheduler holds until the first gesture unlocks the context and
   * then starts on a bar line.
   */
  setMusicScene(scene: MusicScene): void {
    this.scene = scene;
    this.applyMusicScene();
  }

  /**
   * The music's level relative to the effects, which is a separate control from
   * the master volume: a player who wants the traps and not the score sets this
   * to zero and keeps everything else.
   */
  setMusicVolume(value: number): void {
    this.musicVolume = Math.max(0, Math.min(1, value));
    this.music?.setVolume(this.musicVolume);
    // Dragging the slider to zero stops the scheduler rather than leaving it
    // placing notes into a bus turned all the way down.
    this.applyMusicScene();
  }

  setMusicEnabled(value: boolean): void {
    this.musicEnabled = value;
    this.applyMusicScene();
  }

  /** Push the music down under something louder. `strength` is 0 to 1. */
  duckMusic(strength: number): void {
    this.music?.duck(strength);
  }

  private applyMusicScene(): void {
    const wanted =
      this.muted || !this.musicEnabled || this.musicVolume <= 0
        ? "silent"
        : this.scene;
    if (wanted === "silent") {
      this.music?.stop();
      return;
    }
    const context = this.ensure();
    if (!context || !this.master) return;
    if (!this.music) {
      this.music = new MusicEngine(context, this.master, () =>
        this.noiseBuffer(context),
      );
      this.music.setVolume(this.musicVolume);
    }
    this.music.setScene(wanted);
  }

  /**
   * Call from a real pointer or key handler. Safari, and iOS especially, wants
   * the context created or resumed inside the gesture task; the game's first
   * sound used to be scheduled after an await, which is a different task.
   */
  unlock(): void {
    const context = this.ensure();
    if (!context) return;
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start();
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Constructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Constructor) return null;
    if (!this.context) {
      this.context = new Constructor();
      const master = this.context.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      // A compressor means many simultaneous voices duck rather than clip, so
      // the palette can sit louder than the old fixed-gain-per-voice mix.
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(this.context.destination);
      this.master = master;
    }
    // "interrupted" is an iOS-only state a phone call leaves behind, and the
    // old `=== "suspended"` check missed it entirely.
    if (this.context.state !== "running") void this.context.resume();
    this.warm();
    return this.context;
  }

  /**
   * Fetch and decode one sample. Nothing here is awaited by the game: until the
   * buffer lands, and permanently if it never does, the synthesised version of
   * the sound is what plays.
   */
  private load(key: SampleKey): void {
    if (this.buffers.has(key) || this.loading.has(key) || this.failed.has(key))
      return;
    const context = this.context;
    if (!context || typeof fetch !== "function") return;
    const url = `${SAMPLE_BASE}${key}.mp3`;
    const task = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(bytes);
        this.buffers.set(key, decoded);
        this.peaks.set(key, measurePeak(decoded));
      } catch (error) {
        this.failed.add(key);
        // Once per session, and only for a cue.
        //
        // This used to fire on the first failure of any key, which was right
        // while every key in RECORDED shipped a file: the only way to fail was
        // a wrong asset base, which costs every sample in the game and leaves
        // nothing but a slightly thinner mix. Now that RECORDED_TRAPS is
        // derived from the whole roster, most traps legitimately have no
        // recording and 404 by design, so that condition would have fired on
        // the first unrecorded trap a player touched and cried wolf on the one
        // message that matters. Every cue ships, so a cue that will not load
        // still means exactly what it always did.
        if (!this.warnedAssetBase && (CUE_KEYS as readonly string[]).includes(key)) {
          this.warnedAssetBase = true;
          console.warn(`[audio] ${url} unavailable, falling back to synthesis`, error);
        }
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, task);
  }

  /**
   * Pull the whole set down in the background once the context exists. One file
   * at a time, because the first sound fires while the level's models are still
   * downloading and twenty-nine parallel requests would compete with them.
   */
  private warm(): void {
    if (this.warmed) return;
    this.warmed = true;
    void (async () => {
      for (const key of WARM_ORDER) {
        this.load(key);
        await this.loading.get(key);
      }
    })();
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noise) {
      const frames = Math.floor(context.sampleRate * NOISE_SECONDS);
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < frames; index += 1)
        channel[index] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /** Reserve a voice, releasing it on a timer rather than on `onended`. */
  private claim(seconds: number): boolean {
    if (this.muted || this.active >= MAX_VOICES) return false;
    this.active += 1;
    // onended never fires on a suspended context, which used to strand the
    // counter at the cap and kill audio for the rest of the session.
    setTimeout(
      () => {
        this.active = Math.max(0, this.active - 1);
      },
      seconds * 1000 + 60,
    );
    return true;
  }

  /**
   * A file's measured peak, or the level the set was meant to be normalised to
   * while it is still in flight. A file that decoded to silence falls back too,
   * because dividing by its peak would be dividing by nothing.
   */
  private peakOf(key: SampleKey): number {
    const measured = this.peaks.get(key) ?? 0;
    return measured < MEASURED_PEAK_FLOOR ? SAMPLE_PEAK : measured;
  }

  /**
   * Play a recorded one-shot through the same master bus and the same voice
   * budget as a synthesised note.
   *
   * "missing" covers the three ways there is nothing to play — the game ships
   * no recording for this key, the file has not arrived, or it never will — and
   * is the only outcome a caller should answer by synthesising.
   */
  private sample(key: SampleKey, peak: number, rate = 1): SampleOutcome {
    if (!RECORDED.has(key)) return "missing";
    const context = this.ensure();
    if (!context || !this.master) return "missing";
    const buffer = this.buffers.get(key);
    if (!buffer) {
      this.load(key);
      return "missing";
    }
    if (!this.claim(buffer.duration / rate)) return "starved";
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const level = context.createGain();
    level.gain.value = peak / this.peakOf(key);
    source.connect(level).connect(this.master);
    source.start();
    return "played";
  }

  tone(frequency: number, duration = 0.12, options: ToneOptions = {}): void {
    const context = this.ensure();
    if (!context || !this.master || !this.claim(duration)) return;
    const at = context.currentTime + (options.delayMs ?? 0) / 1000;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = options.wave ?? "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    if (options.to !== undefined)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.to),
        at + duration,
      );
    const peak = options.gain ?? 0.06;
    // A short ramp instead of a step: the old square waves started at full
    // amplitude from zero, which clicks.
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  noiseBurst(duration = 0.1, options: NoiseOptions = {}): void {
    const context = this.ensure();
    if (!context || !this.master || !this.claim(duration)) return;
    const at = context.currentTime + (options.delayMs ?? 0) / 1000;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = options.filter ?? "bandpass";
    filter.frequency.value = options.frequency ?? 1200;
    filter.Q.value = options.q ?? 1;
    const envelope = context.createGain();
    const peak = options.gain ?? 0.04;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(at);
    source.stop(at + duration);
  }

  /**
   * A looping voice keyed by id. Continuous mechanics (a fan's wind, a magnet's
   * hum) used to re-fire a percussive hit on a cooldown, which machine-gunned
   * the mix and told the player nothing about whether they were still inside.
   */
  /**
   * The looping form of a bed, built once and kept.
   *
   * Returns the decoded buffer unchanged when there is nothing to repair, which
   * is what a buffer too short or too quiet to carry a crossfade gets.
   */
  private loopBuffer(context: AudioContext, bed: BedKey): AudioBuffer | null {
    const decoded = this.buffers.get(bed);
    if (!decoded) return null;
    const existing = this.loops.get(bed);
    if (existing) return existing;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index),
    );
    const prepared = prepareLoop(channels, decoded.sampleRate);
    if (!prepared) {
      this.loops.set(bed, decoded);
      return decoded;
    }
    const buffer = context.createBuffer(
      prepared.channels.length,
      prepared.frames,
      decoded.sampleRate,
    );
    prepared.channels.forEach((data, index) =>
      buffer.getChannelData(index).set(data),
    );
    this.loops.set(bed, buffer);
    return buffer;
  }

  startSustain(id: string, build: BedBuild): void {
    const context = this.ensure();
    if (!context || !this.master || this.muted || this.sustains.has(id)) return;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const bed = bedFor(id, build);
    const recorded = this.loopBuffer(context, bed);
    if (recorded) {
      const source = context.createBufferSource();
      source.buffer = recorded;
      source.loop = true;
      const trim = context.createGain();
      trim.gain.value = (BED_TRIM * SAMPLE_PEAK) / this.peakOf(bed);
      source.connect(trim).connect(gain);
      source.start();
      this.sustains.set(id, {
        gain,
        stop: () => source.stop(),
        quietSince: 0,
        level: 0,
      });
      return;
    }
    // Synthesised until the file lands, and swapped for it when it does. The
    // beds are the last things to warm, so without the swap the first run of a
    // session hears filtered noise under every trap it stands in and keeps
    // hearing it until the player leaves that trap's range and comes back.
    this.load(bed);
    this.armBedSwap(id, bed, build);
    if (build === "hum") {
      const a = context.createOscillator();
      const b = context.createOscillator();
      a.type = "sawtooth";
      b.type = "sawtooth";
      a.frequency.value = 55;
      // Detuned so the beat frequency reads as a magnetic hum.
      b.frequency.value = 58.3;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 200;
      a.connect(low);
      b.connect(low);
      low.connect(gain);
      a.start();
      b.start();
      this.sustains.set(id, {
        gain,
        stop: () => {
          a.stop();
          b.stop();
        },
        quietSince: 0,
        level: 0,
      });
    } else {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = build === "spray" ? 4000 : 900;
      filter.Q.value = build === "spray" ? 0.8 : 0.7;
      source.connect(filter).connect(gain);
      source.start();
      this.sustains.set(id, {
        gain,
        stop: () => source.stop(),
        quietSince: 0,
        level: 0,
      });
    }
  }

  /**
   * Replace a synthesised bed with its recording once the download finishes.
   *
   * Armed per bed rather than per sustain, so a trap that stops and starts
   * again while the file is in flight does not queue a second swap onto the
   * same download. The level is carried across, because a proximity bed is at
   * whatever nearness the player is standing at and a restart from zero would
   * be heard as the trap briefly stopping.
   */
  private armBedSwap(id: string, bed: BedKey, build: BedBuild): void {
    if (this.bedSwapArmed.has(bed)) return;
    this.bedSwapArmed.add(bed);
    void this.loading.get(bed)?.then(() => {
      this.bedSwapArmed.delete(bed);
      const entry = this.sustains.get(id);
      if (!entry || !this.buffers.has(bed)) return;
      const level = entry.level;
      this.stopSustain(id);
      this.startSustain(id, build);
      this.setSustainLevel(id, level);
    });
  }

  setSustainLevel(id: string, level: number): void {
    const entry = this.sustains.get(id);
    if (!entry || !this.context) return;
    entry.level = Math.max(0, Math.min(SUSTAIN_CEILING, level));
    entry.gain.gain.setTargetAtTime(entry.level, this.context.currentTime, 0.08);
  }

  /**
   * The whole of a continuous trap's audio in one per-frame call: start the bed
   * when the player comes into range, follow them with its level, and let it go
   * when they leave. `nearness` is 0 outside the mechanic's reach and 1 at its
   * strongest, which is the same number the trap already computes to scale its
   * force.
   *
   * `id` must contain the trap's type — `${trap.type}:${trap.id}` — because the
   * type is what selects the recording.
   */
  proximityBed(id: string, build: BedBuild, nearness: number): void {
    const level = Math.max(0, Math.min(1, nearness));
    const entry = this.sustains.get(id);
    if (level < BED_FLOOR) {
      if (!entry) return;
      const now = performance.now();
      // Held at zero rather than torn down, so a player hovering on the edge of
      // the cone does not rebuild the voice on every frame.
      if (entry.quietSince === 0) entry.quietSince = now;
      if (now - entry.quietSince > BED_RELEASE_MS) this.stopSustain(id);
      else this.setSustainLevel(id, 0);
      return;
    }
    if (!entry) this.startSustain(id, build);
    else entry.quietSince = 0;
    this.setSustainLevel(id, level * SUSTAIN_CEILING);
  }

  /**
   * Room tone under the run. The bed the game already ships and has never
   * played, looped and levelled to be noticed only when it stops. Safe to call
   * again on a retry: the second call retargets the level and nothing else.
   *
   * `ambient.mp3` is the largest file and the last to warm, so the first run of
   * a session starts on the synthesised stand-in. `startSustain` arms the swap
   * onto the recording, the same way it does for every trap bed.
   */
  startAmbience(level = AMBIENCE_LEVEL): void {
    this.startSustain(AMBIENCE_ID, "wind");
    this.setSustainLevel(AMBIENCE_ID, level);
  }

  stopAmbience(): void {
    this.stopSustain(AMBIENCE_ID);
  }

  stopSustain(id: string): void {
    const entry = this.sustains.get(id);
    if (!entry || !this.context) return;
    this.sustains.delete(id);
    entry.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.06);
    setTimeout(() => {
      try {
        entry.stop();
      } catch {
        // Already stopped; the context may have been torn down.
      }
    }, 300);
  }

  stopAllSustains(): void {
    for (const id of [...this.sustains.keys()]) this.stopSustain(id);
    this.sustainedUntil.clear();
    this.disarmSustainedSweep();
  }

  /**
   * The bed under one of the five continuous traps, raised to how hard the
   * mechanic is currently pushing and held until the trap stops reporting.
   *
   * The trap itself has no "the player left" event to send: the fan, the vacuum
   * and the sprinkler simply stop calling on the frame the player walks out of
   * range, and the two collision traps never had one to begin with. So the bed
   * expires on a deadline the next report pushes back, which is what makes a
   * single call from any of them enough to drive the whole thing.
   */
  private sustainedHazard(type: TrapType, build: BedBuild, weight: number): void {
    this.sustainedUntil.set(type, performance.now() + SUSTAINED_HOLD_MS);
    this.proximityBed(`${type}:bed`, build, weight);
    if (this.sustainedSweep === null)
      this.sustainedSweep = setInterval(
        () => this.releaseSustained(),
        SUSTAINED_SWEEP_MS,
      );
  }

  private releaseSustained(): void {
    const now = performance.now();
    for (const [type, until] of this.sustainedUntil) {
      if (now < until) continue;
      this.sustainedUntil.delete(type);
      this.stopSustain(`${type}:bed`);
    }
    if (this.sustainedUntil.size === 0) this.disarmSustainedSweep();
  }

  private disarmSustainedSweep(): void {
    if (this.sustainedSweep === null) return;
    clearInterval(this.sustainedSweep);
    this.sustainedSweep = null;
  }

  click(): void {
    if (this.sample("click", 0.03) !== "missing") return;
    this.tone(420, 0.05, { wave: "triangle", gain: 0.03 });
  }

  jump(): void {
    if (this.sample("jump", 0.04) !== "missing") return;
    this.tone(420, 0.09, { to: 560, wave: "sine", gain: 0.04 });
  }

  /** Paired with jump so the two read as one gesture. */
  land(speed: number): void {
    const weight = Math.min(1, Math.abs(speed) / 12);
    if (this.sample("land", 0.025 + weight * 0.05, 1.06 - 0.12 * weight) !== "missing")
      return;
    this.tone(110, 0.1, { wave: "sine", gain: 0.02 + weight * 0.04 });
    this.noiseBurst(0.08, {
      filter: "lowpass",
      frequency: 500,
      gain: 0.02 + weight * 0.05,
    });
  }

  footstep(): void {
    // Steps repeat more than any other cue, so the sample gets the widest pitch
    // spread. The synthesised version randomises its filter for the same reason.
    if (this.sample("footstep", 0.012, 0.92 + Math.random() * 0.16) !== "missing")
      return;
    this.noiseBurst(0.05, {
      filter: "bandpass",
      frequency: 900 + Math.random() * 260,
      q: 1.4,
      gain: 0.014,
    });
  }

  /** Throwing a held object used to share the hazard sound. */
  release(): void {
    if (this.sample("release", 0.035) !== "missing") return;
    this.tone(300, 0.12, { to: 520, wave: "triangle", gain: 0.035 });
    this.noiseBurst(0.06, { filter: "highpass", frequency: 1200, gain: 0.02 });
  }

  grab(): void {
    if (this.sample("grab", 0.03) !== "missing") return;
    this.tone(660, 0.04, { wave: "sine", gain: 0.03 });
  }

  spring(): void {
    this.tone(180, 0.26, { to: 640, wave: "triangle", gain: 0.06 });
  }

  /**
   * Losing the run used to play the same thud as a bonk. The recorded version
   * sits above the synthesised gain because the synthesised one is a three-note
   * chord whose voices overlap, and this is a single voice.
   */
  fail(): void {
    if (this.sample("fail", 0.09) !== "missing") return;
    [330, 262, 175].forEach((frequency, index) =>
      this.tone(frequency, 0.3, {
        wave: "triangle",
        gain: 0.06,
        delayMs: index * 130,
      }),
    );
  }

  countdown(urgent: boolean, secondsLeft = urgent ? 3 : 10): void {
    // One recording covers both ticks, played a fifth up when urgent, which is
    // the interval the synthesised pair used at 880 and 1320 Hz. On top of
    // that the tick now climbs through the final ten seconds - every ending
    // used to sound identical from ten down to four, so the clock never felt
    // like it was closing in until the urgent jump.
    const progress = Math.max(0, Math.min(1, (10 - secondsLeft) / 10));
    const climb = 1 + progress * 0.3;
    if (
      this.sample(
        "countdown",
        (urgent ? 0.045 : 0.03) + progress * 0.01,
        (urgent ? 1.5 : 1) * climb,
      ) !== "missing"
    )
      return;
    this.tone((urgent ? 1320 : 880) * climb, urgent ? 0.06 : 0.05, {
      wave: "sine",
      gain: (urgent ? 0.045 : 0.03) + progress * 0.01,
    });
  }

  /**
   * The zip for skimming a hazard without touching it: two quick bright
   * chirps, quiet enough to register as texture rather than as an event.
   */
  graze(): void {
    this.tone(1560, 0.05, { wave: "sine", gain: 0.018 });
    this.tone(2090, 0.07, { wave: "sine", gain: 0.014, delayMs: 35 });
  }

  /**
   * The "so close" sting for a clear inside the near-record window: a rise
   * that lands a semitone under where it was heading. Deliberately synthesis
   * only and delayed past the finish fanfare, so the two read as one phrase:
   * triumph, then the wince.
   */
  nearRecord(): void {
    this.tone(659, 0.14, { wave: "triangle", gain: 0.06, delayMs: 520 });
    this.tone(880, 0.16, { wave: "triangle", gain: 0.065, delayMs: 660 });
    this.tone(831, 0.36, { wave: "triangle", gain: 0.055, delayMs: 840 });
  }

  placement(valid: boolean): void {
    if (
      this.sample(valid ? "placement_ok" : "placement_bad", valid ? 0.03 : 0.035) !==
      "missing"
    )
      return;
    if (valid) this.tone(700, 0.05, { wave: "sine", gain: 0.03 });
    else this.tone(180, 0.09, { wave: "square", gain: 0.035 });
  }

  finish(): void {
    if (this.sample("finish", 0.1) !== "missing") return;
    const offsets = [0, 90, 180, 290];
    [523, 659, 784, 1047].forEach((frequency, index) =>
      this.tone(frequency, 0.24, {
        wave: "triangle",
        gain: 0.07,
        delayMs: offsets[index] ?? 0,
      }),
    );
  }

  publish(): void {
    if (this.sample("publish", 0.09) !== "missing") return;
    [392, 523, 659, 784].forEach((frequency, index) =>
      this.tone(frequency, 0.25, {
        wave: "sine",
        gain: 0.06,
        delayMs: index * 70,
      }),
    );
  }

  /**
   * One voice per trap, scaled by how hard the hit was.
   *
   * Twelve of sixteen traps used to share a single 90 Hz thud, and two of the
   * remaining used the same "spring" cue for a helpful boost and a violent
   * snap. Severity was carried only by the stun and the knockback, so the
   * audio told the player nothing about whether to keep running.
   */
  hazard(type: TrapType, impulse: number): void {
    const weight = Math.min(1, impulse / 14);
    // Every hard DISCRETE hit lands on a shared sub-thump under its own
    // voice: the per-trap sound says what got you, the low end says how
    // hard. Deliberately after the sustained branch below and throttled,
    // because a fan reporting every 450ms must stay a bed, not a drumroll,
    // and the voice budget the sustained tests protect is real.
    const sustained = SUSTAINED_TRAPS[type];
    if (!sustained || sustained.strike) {
      const now = performance.now();
      if (impulse >= 8 && now - this.lastThumpAt > 220) {
        this.lastThumpAt = now;
        this.tone(82, 0.16 + weight * 0.1, { to: 46, wave: "sine", gain: 0.05 + weight * 0.05 });
        this.noiseBurst(0.07 + weight * 0.05, {
          filter: "lowpass",
          frequency: 320,
          gain: 0.03 + weight * 0.035,
        });
      }
    }
    if (sustained) {
      this.sustainedHazard(type, sustained.build, weight);
      // A bed already sits under the mix rather than on top of it, and a fan
      // reporting every 450 ms would hold the score down for as long as the
      // player stood in it, so only the one-shots duck.
      if (!sustained.strike) return;
    } else {
      // The score gets out of the way of the hit instead of competing with it,
      // by as much as the hit was worth.
      this.duckMusic(weight);
      // The severity that used to ride on gain and duration together rides on
      // gain and on pitch instead, because a sample cannot be stretched: a
      // harder hit plays lower and heavier. The small random spread stops a
      // trap that fires repeatedly from sounding like one file on a loop.
      const rate = (1.05 - 0.09 * weight) * (0.96 + Math.random() * 0.08);
      if (this.sample(type, HAZARD_PEAK[type] * severityOf(weight), rate) !== "missing")
        return;
    }
    const g = (base: number) => base * severityOf(weight);
    const d = (base: number) => base * (1 + 0.5 * weight);
    switch (type) {
      case "swinging_hammer":
        this.tone(62, d(0.28), { wave: "sine", gain: g(0.09) });
        this.noiseBurst(d(0.09), { filter: "lowpass", frequency: 700, gain: g(0.06) });
        return;
      case "rolling_fridge":
        this.tone(48, d(0.42), { to: 32, wave: "sawtooth", gain: g(0.07) });
        return;
      case "rotating_toilet":
        this.tone(210, d(0.2), { wave: "square", gain: g(0.05) });
        this.noiseBurst(d(0.5), { filter: "bandpass", frequency: 1400, q: 2, gain: g(0.035) });
        return;
      case "giant_beach_ball":
        this.tone(420, d(0.14), { to: 180, wave: "sine", gain: g(0.05) });
        return;
      case "spring_pad":
        this.spring();
        return;
      case "soap_slick":
        this.tone(300, d(0.3), { to: 900, wave: "sine", gain: g(0.035) });
        return;
      case "banana_peel":
        this.tone(520, d(0.22), { to: 1400, wave: "sine", gain: g(0.05) });
        this.tone(900, d(0.3), { to: 200, wave: "triangle", gain: g(0.04), delayMs: 150 });
        return;
      case "mousetrap":
        // Must be the sharpest thing in the game; the snap animation is 110ms.
        this.noiseBurst(0.04, { filter: "highpass", frequency: 3000, gain: g(0.12) });
        this.tone(1200, 0.08, { to: 200, wave: "square", gain: g(0.06) });
        return;
      case "ceiling_fan":
        this.tone(150, d(0.18), { wave: "sawtooth", gain: g(0.07) });
        this.noiseBurst(d(0.12), { filter: "highpass", frequency: 2000, gain: g(0.05) });
        return;
      case "toaster_launcher":
        this.tone(340, d(0.1), { wave: "triangle", gain: g(0.04) });
        this.noiseBurst(d(0.06), { filter: "bandpass", frequency: 2500, gain: g(0.03) });
        return;
      case "robot_mop":
        this.tone(230, d(0.12), { wave: "square", gain: g(0.045) });
        this.noiseBurst(d(0.08), { filter: "lowpass", frequency: 900, gain: g(0.03) });
        return;
      case "laundry_basket":
        // Unreachable: the basket is a passive obstacle and reports no hazard.
        // Kept for the exhaustiveness binding, and because this is what it
        // would sound like if it were ever given one.
        this.tone(180, d(0.09), { wave: "sine", gain: g(0.03) });
        this.noiseBurst(d(0.07), { filter: "lowpass", frequency: 400, gain: g(0.025) });
        return;
      case "fridge_magnet":
        this.tone(60, d(0.5), { wave: "square", gain: g(0.05) });
        return;
      // These three are continuous mechanics that return above, into a bed. The
      // cases stay because the exhaustiveness binding at the bottom needs them,
      // and because they are what would be heard if one of the three ever stops
      // being a bed.
      case "sprinkler":
        this.noiseBurst(d(0.22), { filter: "bandpass", frequency: 4000, q: 0.8, gain: g(0.04) });
        return;
      case "floor_fan":
      case "angry_vacuum":
        this.tone(120, d(0.18), { wave: "sawtooth", gain: g(0.045) });
        return;
      case "paint_bucket":
        // Falls, hits the deck, then the lid gives: a fast downward glide into
        // a lopsided metal clang and a wet, low splat behind it.
        this.tone(760, d(0.09), { to: 96, wave: "triangle", gain: g(0.06) });
        this.tone(196, d(0.2), { to: 172, wave: "square", gain: g(0.05), delayMs: 70 });
        this.noiseBurst(d(0.3), { filter: "lowpass", frequency: 320, q: 0.7, gain: g(0.055), delayMs: 80 });
        return;
      case "spin_cycle":
        // Two detuned low tones for the unbalanced drum, beating against each
        // other, over a broad mid whoosh for the burst leaving the machine.
        this.tone(74, d(0.34), { to: 132, wave: "square", gain: g(0.05) });
        this.tone(81, d(0.32), { to: 128, wave: "sawtooth", gain: g(0.035) });
        this.noiseBurst(d(0.36), { filter: "bandpass", frequency: 700, q: 0.9, gain: g(0.05) });
        return;
      case "sticky_gum":
        // The one voice in the game that goes up: a rising squelch, because the
        // gum is stretching rather than striking.
        this.tone(130, d(0.26), { to: 430, wave: "sine", gain: g(0.035) });
        this.noiseBurst(d(0.16), { filter: "lowpass", frequency: 240, gain: g(0.022), delayMs: 60 });
        return;
      case "cord_trip":
        // A plucked cord: a long sawtooth glide down with a bright tick where
        // it catches. The mousetrap's snap is shorter and starts in the noise.
        this.tone(660, d(0.24), { to: 128, wave: "sawtooth", gain: g(0.055) });
        this.noiseBurst(0.045, { filter: "bandpass", frequency: 1500, q: 2.4, gain: g(0.035) });
        return;
      case "drawer_slam":
        // Wood stopping hard, and then the cutlery catching up with it.
        this.tone(96, d(0.2), { to: 74, wave: "triangle", gain: g(0.075) });
        this.noiseBurst(d(0.16), { filter: "bandpass", frequency: 2400, q: 3.2, gain: g(0.04), delayMs: 45 });
        return;
      case "rug_pull":
        // Fabric first, floor second: a wide fricative sweep with the thump of
        // a landing under it.
        this.noiseBurst(d(0.32), { filter: "bandpass", frequency: 1600, q: 0.6, gain: g(0.05) });
        this.tone(78, d(0.24), { to: 52, wave: "sine", gain: g(0.055), delayMs: 90 });
        return;
      case "plate_shards":
        // Ceramic, which is all high frequency and no body: a bright burst,
        // then the pieces landing behind it.
        this.noiseBurst(0.05, { filter: "highpass", frequency: 4200, gain: g(0.095) });
        this.noiseBurst(d(0.26), { filter: "highpass", frequency: 2600, gain: g(0.05), delayMs: 40 });
        this.tone(2100, 0.07, { to: 900, wave: "triangle", gain: g(0.04) });
        return;
      case "tilt_plate":
        // Steel leaning over, then stopping against its own frame.
        this.tone(150, d(0.26), { to: 88, wave: "sawtooth", gain: g(0.05) });
        this.tone(104, d(0.18), { wave: "square", gain: g(0.075), delayMs: 180 });
        this.noiseBurst(d(0.12), { filter: "bandpass", frequency: 1800, q: 2.6, gain: g(0.035), delayMs: 185 });
        return;
      case "pipe_burst":
        // The rattle it warns with, and then the water it was holding.
        this.noiseBurst(d(0.14), { filter: "bandpass", frequency: 2200, q: 4, gain: g(0.045) });
        this.tone(128, d(0.2), { to: 96, wave: "square", gain: g(0.04), delayMs: 60 });
        this.noiseBurst(d(0.34), { filter: "bandpass", frequency: 3200, q: 0.7, gain: g(0.055), delayMs: 130 });
        return;
      case "cart_blocker":
        // A caster squealing, and the frame catching up with it.
        this.tone(880, d(0.22), { to: 640, wave: "sawtooth", gain: g(0.028) });
        this.tone(96, d(0.16), { wave: "triangle", gain: g(0.06), delayMs: 90 });
        this.noiseBurst(d(0.1), { filter: "bandpass", frequency: 1500, q: 2.2, gain: g(0.03), delayMs: 95 });
        return;
      case "mattress_rebound":
        // Springs under fabric: the bend the spring pad has, damped by the
        // padding over it, so it goes up and comes back down.
        this.tone(120, d(0.3), { to: 260, wave: "sine", gain: g(0.06) });
        this.noiseBurst(d(0.18), { filter: "lowpass", frequency: 420, gain: g(0.035) });
        return;
      case "chute_drop":
        // Falling inside a metal tube, so the pitch drops and the tube rings.
        this.tone(300, d(0.44), { to: 70, wave: "triangle", gain: g(0.06) });
        this.noiseBurst(d(0.4), { filter: "bandpass", frequency: 700, q: 1.6, gain: g(0.03) });
        return;
      case "steam_vents":
        // Pressure escaping: a hiss that starts hard and thins out.
        this.noiseBurst(d(0.3), { filter: "highpass", frequency: 3400, gain: g(0.055) });
        this.tone(1500, d(0.16), { to: 2600, wave: "sine", gain: g(0.018) });
        return;
      case "domino_line":
        // Five wooden ticks in a row, accelerating the way a falling line does.
        [0, 55, 100, 138, 170].forEach((delayMs, index) =>
          this.noiseBurst(0.035, {
            filter: "bandpass",
            frequency: 1100 + index * 180,
            q: 3.4,
            gain: g(0.05) * (1 - index * 0.12),
            delayMs,
          }),
        );
        return;
      case "bunting_line":
        // A cord under tension letting go, with the flags flapping after it.
        this.tone(420, d(0.2), { to: 150, wave: "triangle", gain: g(0.045) });
        this.noiseBurst(d(0.24), { filter: "bandpass", frequency: 900, q: 0.8, gain: g(0.03), delayMs: 70 });
        return;
      case "cat_flap":
        // Thin plastic hitting its frame twice, the second time weaker.
        this.noiseBurst(0.03, { filter: "bandpass", frequency: 2600, q: 2.8, gain: g(0.045) });
        this.noiseBurst(0.025, { filter: "bandpass", frequency: 2400, q: 2.8, gain: g(0.022), delayMs: 90 });
        return;
      case "motion_sensor":
        // The one voice in the game that is electronic rather than physical:
        // two flat square beeps, which is what makes it read as a machine
        // noticing you rather than an object striking you.
        this.tone(1760, 0.06, { wave: "square", gain: g(0.04) });
        this.tone(1760, 0.06, { wave: "square", gain: g(0.04), delayMs: 110 });
        return;
      case "ankle_weight":
        // Metal closing around something, low and dead, with no ring after it.
        this.tone(86, d(0.14), { to: 62, wave: "square", gain: g(0.04) });
        this.noiseBurst(d(0.08), { filter: "lowpass", frequency: 600, gain: g(0.028), delayMs: 30 });
        return;
      case "conveyor_strip":
        // A motor under a rubber belt. It repeats faster than anything else
        // here, so it is the shortest voice as well as one of the quietest.
        this.tone(74, d(0.14), { wave: "sawtooth", gain: g(0.04) });
        this.noiseBurst(d(0.1), { filter: "lowpass", frequency: 800, gain: g(0.022) });
        return;
      case "flood_puddle":
        // Water arriving and spreading, so the body of it opens up over time.
        this.noiseBurst(d(0.34), { filter: "lowpass", frequency: 900, q: 0.6, gain: g(0.035) });
        this.tone(220, d(0.26), { to: 130, wave: "sine", gain: g(0.025) });
        return;
      case "updraft_vent":
        // Air from below, so the one noise voice that rises rather than falls.
        this.noiseBurst(d(0.36), { filter: "bandpass", frequency: 600, q: 0.5, gain: g(0.035) });
        this.tone(180, d(0.34), { to: 520, wave: "sine", gain: g(0.02) });
        return;
      case "dust_bunny":
        // Almost nothing, on purpose: a soft low thud with the top rolled off.
        this.noiseBurst(d(0.16), { filter: "lowpass", frequency: 300, gain: g(0.025) });
        this.tone(140, d(0.12), { to: 100, wave: "sine", gain: g(0.018) });
        return;
      case "pile_on":
        // The shelves rattling is the only warning, and then everything that
        // was on them arrives at once. plate_shards is one plate breaking;
        // this is a cupboard of them, so it is wider and much longer.
        this.noiseBurst(d(0.18), { filter: "bandpass", frequency: 2800, q: 2.2, gain: g(0.035) });
        this.noiseBurst(d(0.46), { filter: "highpass", frequency: 1600, gain: g(0.085), delayMs: 200 });
        this.tone(64, d(0.3), { to: 46, wave: "sine", gain: g(0.05), delayMs: 210 });
        return;
      case "swing_door":
        // The door leaving, the beat in which the player believes they are
        // through it, and the board catching up with them.
        this.noiseBurst(d(0.26), { filter: "bandpass", frequency: 480, q: 0.4, gain: g(0.03) });
        this.tone(88, d(0.28), { to: 60, wave: "triangle", gain: g(0.08), delayMs: 300 });
        return;
      case "hot_potato":
        // An igniter clicking faster and faster, and then catching. The pop is
        // muffled because whatever is holding it has not opened yet.
        [0, 100, 180, 240].forEach((delayMs, index) =>
          this.noiseBurst(0.02, {
            filter: "bandpass",
            frequency: 2600,
            q: 5,
            gain: g(0.03) * (1 + index * 0.14),
            delayMs,
          }),
        );
        this.tone(150, d(0.2), { to: 70, wave: "sine", gain: g(0.065), delayMs: 300 });
        return;
      case "paparazzi":
        // The flash charging, then letting go all at once. The whine is the
        // warning and the crack is the hit, so which comes first is the trap.
        this.tone(1800, d(0.34), { to: 4200, wave: "sine", gain: g(0.022) });
        this.noiseBurst(0.03, { filter: "highpass", frequency: 5000, gain: g(0.06), delayMs: 320 });
        return;
      case "shoe_rack":
        // The shoe is light and lands first. The rack behind it is timber
        // rather than the steel it looks like, so the clatter is wooden.
        this.noiseBurst(0.06, { filter: "bandpass", frequency: 2100, q: 0.9, gain: g(0.03) });
        this.tone(240, d(0.18), { to: 160, wave: "triangle", gain: g(0.05), delayMs: 170 });
        this.noiseBurst(d(0.2), { filter: "bandpass", frequency: 1250, q: 2.6, gain: g(0.04), delayMs: 180 });
        return;
      case "cuckoo_clock":
        // Two, and then the one that is not like them, which is the whole joke
        // the trap is built on. Triangle for the chimes, because a struck
        // wooden bar has edges a sine does not.
        this.tone(1046, 0.12, { wave: "triangle", gain: g(0.035) });
        this.tone(784, 0.12, { wave: "triangle", gain: g(0.035), delayMs: 260 });
        this.tone(1560, 0.1, { to: 640, wave: "sawtooth", gain: g(0.055), delayMs: 520 });
        return;
      case "stove_ring":
        // Gas for a moment, then all of it. The ignition is the one voice in
        // the game with no attack: it opens out rather than striking.
        this.noiseBurst(d(0.3), { filter: "highpass", frequency: 5200, gain: g(0.02) });
        this.noiseBurst(d(0.44), { filter: "lowpass", frequency: 900, q: 0.5, gain: g(0.055), delayMs: 260 });
        this.tone(70, d(0.36), { to: 130, wave: "sine", gain: g(0.03), delayMs: 260 });
        return;
      case "bathroom_scales":
        // Load going on slowly enough to hear the metal complain about it,
        // then the spring inside giving up.
        this.tone(320, d(0.26), { to: 190, wave: "sawtooth", gain: g(0.028) });
        this.tone(1180, d(0.2), { to: 520, wave: "triangle", gain: g(0.05), delayMs: 200 });
        return;
      case "bin_pedal":
        // Three beats, and the gap is what carries it: the pedal down, the lid
        // held while the player commits, and the lid arriving as they step off.
        this.tone(210, 0.07, { to: 150, wave: "square", gain: g(0.035) });
        this.tone(420, d(0.16), { to: 260, wave: "triangle", gain: g(0.05), delayMs: 260 });
        this.noiseBurst(d(0.1), { filter: "lowpass", frequency: 1300, q: 0.9, gain: g(0.035), delayMs: 265 });
        return;
      case "ball_machine":
        // The feed loading a ball, then the air behind it. Both are short: the
        // machine telegraphs the trap, the shot does not.
        this.tone(120, 0.09, { to: 86, wave: "square", gain: g(0.04) });
        this.noiseBurst(0.045, { filter: "bandpass", frequency: 1700, q: 1.8, gain: g(0.05), delayMs: 150 });
        return;
      case "fish_bowl":
        // Water moving as a mass, then landing. The glass is what the slosh
        // happens inside, so it colours the noise rather than ringing over it.
        this.noiseBurst(d(0.34), { filter: "bandpass", frequency: 520, q: 1.4, gain: g(0.045) });
        this.noiseBurst(d(0.12), { filter: "lowpass", frequency: 1100, q: 0.7, gain: g(0.05), delayMs: 300 });
        this.tone(1860, 0.08, { to: 1500, wave: "sine", gain: g(0.02), delayMs: 300 });
        return;
      case "ice_dispenser":
        // The screw turning is the only warning, and then the load. It fires
        // once per run, so it can afford to be the longest voice here.
        this.tone(58, d(0.44), { to: 96, wave: "sawtooth", gain: g(0.035) });
        this.noiseBurst(d(0.1), { filter: "bandpass", frequency: 900, q: 1.1, gain: g(0.03) });
        this.noiseBurst(d(0.4), { filter: "highpass", frequency: 2600, gain: g(0.055), delayMs: 420 });
        return;
      case "kettle_boil":
        // The boil climbs, the switch throws, and the jet is the part that
        // reaches the player. steam_vents is that jet without the wait.
        this.tone(600, d(0.5), { to: 1300, wave: "sine", gain: g(0.012) });
        this.noiseBurst(0.02, { filter: "bandpass", frequency: 3800, q: 6, gain: g(0.03), delayMs: 480 });
        this.noiseBurst(d(0.26), { filter: "highpass", frequency: 4400, gain: g(0.05), delayMs: 510 });
        return;
      case "slow_fuse":
        // A wind-up timer running out. The ding is flat and short because it is
        // a hammer on a steel cup rather than a bell, and what it is warning
        // about happens somewhere else.
        this.tone(2100, 0.04, { wave: "square", gain: g(0.025) });
        this.tone(1480, 0.14, { wave: "square", gain: g(0.05), delayMs: 120 });
        this.noiseBurst(0.05, { filter: "bandpass", frequency: 3000, q: 2, gain: g(0.03), delayMs: 120 });
        return;
      case "clothes_airer":
        // Thin tube knocking against thin tube, and then the whole frame
        // arriving at its own hinge.
        this.noiseBurst(d(0.22), { filter: "bandpass", frequency: 3100, q: 3, gain: g(0.03) });
        this.tone(520, 0.1, { to: 300, wave: "square", gain: g(0.045), delayMs: 210 });
        return;
      case "junk_drift":
        // Dry and papery rather than soft and low: the drift is packaging, and
        // the lunge under it is the only part of it with any weight.
        this.noiseBurst(d(0.3), { filter: "highpass", frequency: 2200, gain: g(0.028) });
        this.noiseBurst(d(0.18), { filter: "lowpass", frequency: 420, q: 0.5, gain: g(0.03), delayMs: 220 });
        return;
      case "charles_murder_baby":
        this.tone(620, d(0.1), { to: 310, wave: "square", gain: g(0.045) });
        this.noiseBurst(d(0.16), { filter: "bandpass", frequency: 1450, q: 2, gain: g(0.035), delayMs: 70 });
        return;
    }
    // Exhaustive by construction. Sixteen traps were added to TrapType without
    // a case above and fell straight through to silence; this binding stops the
    // build the next time that happens rather than shipping a hazard nobody can
    // hear. The generic hit is only reachable by casting past the type, and a
    // wrong sound in a physics frame beats throwing inside one.
    const unvoiced: never = type;
    void unvoiced;
    this.tone(90, 0.16, { wave: "sawtooth", gain: 0.045 });
  }
}

export const AudioManager = new AudioManagerClass();
