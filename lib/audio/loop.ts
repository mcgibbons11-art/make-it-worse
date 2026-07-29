/**
 * Turning a recorded file into a bed that can loop.
 *
 * The six looping beds in `public/audio` were cut as one-shots, not as loops.
 * Decoded and measured, every one of them steps at the wrap: `ambient.mp3`
 * opens at 0.219 RMS and ends at 0.019, `sprinkler.mp3` at 0.124 and 0.001,
 * `angry_vacuum.mp3` the other way round at 0.003 and 0.032. Handing any of
 * those to `AudioBufferSourceNode.loop` produces a swell and a drop once per
 * period for as long as the bed is running, and `ambient.mp3` additionally
 * carries a 0.0071 DC offset and a sample-to-sample step at the wrap 3.4 times
 * larger than the loudest step anywhere inside it, which is a click.
 *
 * `prepareLoop` rebuilds the channel data so a plain `loop = true` is seamless:
 * it removes the DC offset, trims the quiet run-in and run-out, and folds the
 * material that would have followed the loop point back over the start as an
 * equal-power crossfade. The output is shorter than the input by the length of
 * that crossfade, and the sample that follows its last frame is, by
 * construction, the one that followed it in the recording.
 *
 * Nothing here touches Web Audio, so it can be measured directly.
 */

/** Below this there is not enough material to spend a crossfade on. */
const MIN_LOOP_SECONDS = 1;
/** Peak below this is silence, and silence has no seam to repair. */
const SILENCE_PEAK = 1e-4;
/** Crossfade length, as a share of the trimmed body. */
const CROSSFADE_SHARE = 0.18;
const MAX_CROSSFADE_SECONDS = 1.5;
const MIN_CROSSFADE_FRAMES = 128;
/** Analysis window for the run-in and run-out search. */
const EDGE_WINDOW_SECONDS = 0.02;
/** A window this far below the file's own level counts as run-in or run-out. */
const EDGE_SHARE = 0.25;
/** Trimming past this much of the file is a swell, not a run-in. */
const MIN_RETAINED_SHARE = 0.5;

export interface PreparedLoop {
  channels: Float32Array[];
  frames: number;
}

function rootMeanSquare(values: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    const value = values[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * The DC offset of each channel. Subtracting it costs nothing, buys back the
 * headroom the offset was spending, and shrinks the step at the wrap whenever
 * the two ends of the file sit on opposite sides of zero.
 */
function meanOf(values: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index] ?? 0;
  return sum / Math.max(1, values.length);
}

/**
 * Where the recording actually starts and stops carrying signal. Measured on
 * the channel sum so a stereo file is not trimmed differently per side.
 */
function activeSpan(
  channels: readonly Float32Array[],
  frames: number,
  sampleRate: number,
): { start: number; end: number } {
  const mono = new Float32Array(frames);
  for (const channel of channels)
    for (let index = 0; index < frames; index += 1)
      mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
  const level = rootMeanSquare(mono, 0, frames) * EDGE_SHARE;
  const window = Math.max(1, Math.round(EDGE_WINDOW_SECONDS * sampleRate));
  let start = 0;
  while (start + window <= frames && rootMeanSquare(mono, start, start + window) < level)
    start += window;
  let end = frames;
  while (end - window > start && rootMeanSquare(mono, end - window, end) < level)
    end -= window;
  if (end - start < frames * MIN_RETAINED_SHARE) return { start: 0, end: frames };
  return { start, end };
}

/**
 * Returns null when the buffer is silent, or too short for a crossfade to leave
 * a usable body behind. Both cases loop no worse than they already did, so the
 * caller keeps the decoded buffer as it stands.
 */
export function prepareLoop(
  channels: readonly Float32Array[],
  sampleRate: number,
): PreparedLoop | null {
  const frames = channels[0]?.length ?? 0;
  if (!channels.length || frames < MIN_LOOP_SECONDS * sampleRate) return null;
  let peak = 0;
  for (const channel of channels)
    for (let index = 0; index < frames; index += 1)
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  if (peak < SILENCE_PEAK) return null;

  const { start, end } = activeSpan(channels, frames, sampleRate);
  const body = end - start;
  const crossfade = Math.max(
    MIN_CROSSFADE_FRAMES,
    Math.min(
      Math.round(MAX_CROSSFADE_SECONDS * sampleRate),
      Math.round(body * CROSSFADE_SHARE),
    ),
  );
  const length = body - crossfade;
  if (length < MIN_CROSSFADE_FRAMES) return null;

  const prepared = channels.map((channel) => {
    const offset = meanOf(channel);
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1)
      output[index] = (channel[start + index] ?? 0) - offset;
    // Equal power rather than linear: these beds are noise-like, so their two
    // halves add in power and a linear pair would dip 3 dB in the middle.
    for (let index = 0; index < crossfade; index += 1) {
      const position = ((index + 0.5) / crossfade) * (Math.PI / 2);
      const tail = (channel[start + length + index] ?? 0) - offset;
      output[index] = (output[index] ?? 0) * Math.sin(position) + tail * Math.cos(position);
    }
    return output;
  });
  return { channels: prepared, frames: length };
}

/**
 * How badly a buffer clicks at its own wrap, as a multiple of the largest step
 * it takes anywhere inside itself. Above 1 the loop point is the sharpest edge
 * in the recording, which is what an ear picks out as a tick. Used by the tests
 * and by the offline measurement of the shipped beds.
 */
export function seamRatio(values: Float32Array): number {
  const frames = values.length;
  if (frames < 3) return 0;
  const steps: number[] = [];
  for (let index = 1; index < frames; index += 1)
    steps.push(Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0)));
  steps.sort((a, b) => a - b);
  const worst = steps[Math.min(steps.length - 1, Math.floor(steps.length * 0.999))] ?? 0;
  const seam = Math.abs((values[0] ?? 0) - (values[frames - 1] ?? 0));
  return worst < 1e-9 ? 0 : seam / worst;
}

/** RMS of the first and last `seconds` of a buffer, for level-match checks. */
export function edgeLevels(
  values: Float32Array,
  sampleRate: number,
  seconds = EDGE_WINDOW_SECONDS,
): { head: number; tail: number } {
  const window = Math.max(1, Math.min(values.length, Math.round(seconds * sampleRate)));
  return {
    head: rootMeanSquare(values, 0, window),
    tail: rootMeanSquare(values, values.length - window, values.length),
  };
}
