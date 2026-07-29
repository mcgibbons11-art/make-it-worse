// Track editor.
//
// A course is an ordered list of prefab segments. The player controls the
// middle of that list; `start` and `finish` are pinned because isPlayableTrack
// refuses anything else, and a course the encoder would reject is a course the
// recipient of the link could never open.
//
// Three rules hold this file together.
//
// 1. The verdict is never re-implemented. `isPlayableTrack` decides whether a
//    course may be sent, whether a preset may be offered, and whether a palette
//    piece is marked as a bad fit. Everything else here only explains it.
// 2. Nothing enumerates segments by hand. The palette, the difficulty tiers and
//    the presets are all derived from TRACK_SEGMENTS, so a segment added to the
//    catalogue appears in the editor without anyone editing this file.
// 3. An edit is never lost. Every change goes through one commit path that
//    records an undo step, describes itself for the live region, and saves the
//    course so reopening the editor picks up where the player left off.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ATTEMPT_LIMIT_MS, PLAYER } from "@/lib/game/constants";
import {
  DEFAULT_CUSTOM_TRACK,
  EDITABLE_SEGMENTS,
  LANE_X_LIMIT,
  NAMED_TRACKS,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  MAX_TRACK_SEGMENTS,
  SEGMENT_MAP,
  buildTrack,
  isPlayableTrack,
  worstTraverse,
} from "@/lib/game/track";
import type { JSX, KeyboardEvent } from "react";
import type { BuiltTrack, TrackSegment } from "@/lib/game/track";
import "./track-editor.css";

/** The runner's real budget: the same numbers isPlayableTrack enforces. */
const JUMP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;
const RISE_BUDGET = JUMP_HEIGHT * JUMP_MARGIN;
/** Start and finish are pinned, so the player owns everything in between. */
export const MAX_MIDDLE_SEGMENTS = MAX_TRACK_SEGMENTS - 2;
const ATTEMPT_LIMIT_S = ATTEMPT_LIMIT_MS / 1000;
const DIFFICULTY_WORDS = ["Gentle", "Steady", "Tricky", "Brutal"] as const;
/** One tint per difficulty tier, used only alongside the tier's name. */
const DIFFICULTY_TINTS = ["#57dfa1", "#ffd84d", "#ff9b4a", "#ff5c65"] as const;
const HISTORY_LIMIT = 40;
/** The old single-course key. Read for migration, never written again. */
const DRAFT_KEY = "miw.track-editor.draft.v1";
/** The collection that replaced it: where you left off, plus courses you kept. */
const STORE_KEY = "miw.track-editor.saves.v1";
/** Enough to keep a handful of ideas without turning the panel into a list. */
export const MAX_SAVED_COURSES = 8;
export const MAX_SAVE_NAME = 24;
/** Floating point noise, not a tolerance on the rule. */
const EPSILON = 1e-9;

function requireSegment(id: string): TrackSegment {
  const segment = SEGMENT_MAP.get(id);
  if (!segment) throw new Error(`Track segment "${id}" is missing`);
  return segment;
}

const START = requireSegment("start");
const FINISH = requireSegment("finish");

function labelOf(id: string | undefined): string {
  const segment = id === undefined ? undefined : SEGMENT_MAP.get(id);
  return segment ? segment.label : "that segment";
}

function courseWord(points: number): string {
  if (points <= 2) return "Gentle";
  if (points <= 5) return "Steady";
  if (points <= 9) return "Tricky";
  if (points <= 14) return "Brutal";
  return "Unfair";
}

function difficultyPoints(track: readonly string[]): number {
  return track.reduce(
    (sum, id) => sum + (SEGMENT_MAP.get(id)?.difficulty ?? 0),
    0,
  );
}

// ---------------------------------------------------------------------------
// Reading a course. Pure, exported, and covered by tests/unit/track-editor.
// ---------------------------------------------------------------------------

/** What the run looks like by the time the runner has reached one segment. */
export interface Seam {
  /** Index into the full track, so 0 is the pinned landing pad. */
  index: number;
  /** Hardest jump anywhere in the course up to and including this segment. */
  hardestGap: number;
  /** Highest step up anywhere in the course up to and including this one. */
  hardestRise: number;
  /** This segment is where that hardest jump got harder. */
  raisedGap: boolean;
  /** This segment is where that highest step got higher. */
  raisedRise: boolean;
  /** This is the first segment the runner cannot reach. */
  blocks: boolean;
}

export interface TrackReview {
  /** isPlayableTrack's answer, never a second opinion. */
  playable: boolean;
  /** One line for the live region and the banner. */
  message: string;
  /** A repair computed by trying it, or null when no single removal helps. */
  repair: string | null;
  /** Track index of the first unreachable segment, when there is one. */
  blockedAt: number | null;
  seams: readonly Seam[];
  hardest: { gap: number; rise: number };
}

/**
 * Walk the prefixes of a course and record how hard it has become at each step.
 *
 * worstTraverse reports the hardest crossing in a whole track but not where it
 * is. A prefix scores exactly what the full track scores for the pieces it
 * contains, because worstTraverse only ever measures a piece against pieces
 * that start behind it, and a segment's pieces never reach back past the
 * segment in front of it. So the running maximum over prefixes is the same
 * number the full track produces, and the step where it jumps is the segment
 * that introduced the problem.
 */
export function scanSeams(track: readonly string[]): readonly Seam[] {
  const seams: Seam[] = [];
  let gap = 0;
  let rise = 0;
  let blocked = false;
  for (let end = 1; end < track.length; end += 1) {
    const step = worstTraverse(buildTrack(track.slice(0, end + 1)));
    const over = step.gap >= JUMP_BUDGET || step.rise >= RISE_BUDGET;
    seams.push({
      index: end,
      hardestGap: step.gap,
      hardestRise: step.rise,
      raisedGap: step.gap > gap + EPSILON,
      raisedRise: step.rise > rise + EPSILON,
      blocks: over && !blocked,
    });
    gap = step.gap;
    rise = step.rise;
    blocked = blocked || over;
  }
  return seams;
}

/**
 * The smallest edit that would make a refused course playable, found by making
 * the edit and asking isPlayableTrack rather than by reasoning about why it
 * failed. A suggestion that does not work is worse than no suggestion.
 */
export function suggestRepair(
  track: readonly string[],
): { index: number; message: string } | null {
  for (let index = 1; index < track.length - 1; index += 1) {
    const trimmed = [...track.slice(0, index), ...track.slice(index + 1)];
    if (isPlayableTrack(trimmed))
      return {
        index,
        message: `Removing ${labelOf(track[index])} at position ${index + 1} would make it playable.`,
      };
  }
  return null;
}

/**
 * Turn a yes/no verdict into something a player can act on.
 *
 * The verdict itself comes from isPlayableTrack and nothing else. The reasons
 * below only name the rule that the measurements say was broken, in the order
 * isPlayableTrack applies them, and the last branch says what was ruled out
 * rather than asserting a cause it did not measure.
 */
export function reviewTrack(track: readonly string[]): TrackReview {
  const playable = isPlayableTrack(track);
  const seams = scanSeams(track);
  const last = seams.at(-1);
  const hardest = { gap: last?.hardestGap ?? 0, rise: last?.hardestRise ?? 0 };
  const blocker = seams.find((seam) => seam.blocks);
  const blockedAt = blocker ? blocker.index : null;
  if (playable)
    return {
      playable: true,
      message: `Every join is crossable. The hardest asks for a ${hardest.gap.toFixed(2)}u jump against a ${JUMP_BUDGET.toFixed(2)}u budget, leaving ${(JUMP_BUDGET - hardest.gap).toFixed(2)}u spare.`,
      repair: null,
      blockedAt: null,
      seams,
      hardest,
    };
  const repair = suggestRepair(track)?.message ?? null;
  if (track.length > MAX_TRACK_SEGMENTS)
    return {
      playable: false,
      message: `This course runs to ${track.length} segments and ${MAX_TRACK_SEGMENTS} is the limit. Take ${track.length - MAX_TRACK_SEGMENTS} out.`,
      repair,
      blockedAt,
      seams,
      hardest,
    };
  if (track.length < 3)
    return {
      playable: false,
      message:
        "There is nothing in the middle, so the runner would step off the landing pad straight into the finish door. Add at least one segment.",
      repair: null,
      blockedAt,
      seams,
      hardest,
    };
  if (blocker) {
    const from = labelOf(track[blocker.index - 1]);
    const to = labelOf(track[blocker.index]);
    if (blocker.hardestGap >= JUMP_BUDGET)
      return {
        playable: false,
        message: `${from} into ${to} asks for a ${blocker.hardestGap.toFixed(2)}u jump. The runner clears ${JUMP_BUDGET.toFixed(2)}u, so it is ${(blocker.hardestGap - JUMP_BUDGET).toFixed(2)}u out of reach. Drop ${to}, or put something longer in front of it.`,
        repair,
        blockedAt,
        seams,
        hardest,
      };
    return {
      playable: false,
      message: `${from} into ${to} asks for a ${blocker.hardestRise.toFixed(2)}u step up. The runner rises ${RISE_BUDGET.toFixed(2)}u at the top of a jump, so it is ${(blocker.hardestRise - RISE_BUDGET).toFixed(2)}u too high. Drop ${to}, or put something taller in front of it.`,
      repair,
      blockedAt,
      seams,
      hardest,
    };
  }
  const length = buildTrack(track).length;
  return {
    playable: false,
    message: `Every join is inside the jump budget and the segment count is fine, so what is left is the size of it. ${length.toFixed(1)}u takes ${(length / PLAYER.moveSpeed).toFixed(1)}s at a flat sprint, and the attempt only lasts ${ATTEMPT_LIMIT_S}s. Take a segment out.`,
    repair,
    blockedAt,
    seams,
    hardest,
  };
}

// ---------------------------------------------------------------------------
// Editing a course. A segment can appear twice, so entries carry a counter
// rather than being keyed by segment id.
// ---------------------------------------------------------------------------

export interface Placed {
  readonly uid: number;
  readonly id: string;
}

export function insertPlaced(
  placed: readonly Placed[],
  index: number,
  entry: Placed,
): readonly Placed[] {
  const at = Math.max(0, Math.min(index, placed.length));
  return [...placed.slice(0, at), entry, ...placed.slice(at)];
}

export function removePlaced(
  placed: readonly Placed[],
  index: number,
): readonly Placed[] {
  if (index < 0 || index >= placed.length) return placed;
  return placed.filter((_, position) => position !== index);
}

/**
 * Reorder by one place. A move that would push a segment past the pinned start
 * or finish returns the list it was given, which is how the caller tells a
 * refusal from a change without the boundary buttons having to go dead.
 */
export function movePlaced(
  placed: readonly Placed[],
  index: number,
  delta: -1 | 1,
): readonly Placed[] {
  const target = index + delta;
  if (index < 0 || index >= placed.length) return placed;
  if (target < 0 || target >= placed.length) return placed;
  const next = placed.slice();
  const [moved] = next.splice(index, 1);
  if (!moved) return placed;
  next.splice(target, 0, moved);
  return next;
}

// ---------------------------------------------------------------------------
// Undo. Losing a course you spent five minutes on is the one failure an editor
// cannot recover from, so every edit lands here and nothing else mutates state.
// ---------------------------------------------------------------------------

export interface Snapshot {
  /** What the player did to reach this state, phrased for "Undo <label>". */
  readonly label: string;
  readonly placed: readonly Placed[];
}

export interface Timeline {
  readonly past: readonly Snapshot[];
  readonly present: Snapshot;
  /** Most recently undone step first. */
  readonly future: readonly Snapshot[];
}

export function startTimeline(
  placed: readonly Placed[],
  label: string,
): Timeline {
  return { past: [], present: { label, placed }, future: [] };
}

export function commit(
  timeline: Timeline,
  placed: readonly Placed[],
  label: string,
): Timeline {
  return {
    past: [...timeline.past, timeline.present].slice(-HISTORY_LIMIT),
    present: { label, placed },
    future: [],
  };
}

/** Returns the timeline it was given when there is nothing to undo. */
export function undo(timeline: Timeline): Timeline {
  const previous = timeline.past.at(-1);
  if (!previous) return timeline;
  return {
    past: timeline.past.slice(0, -1),
    present: previous,
    future: [timeline.present, ...timeline.future],
  };
}

/** Returns the timeline it was given when there is nothing to redo. */
export function redo(timeline: Timeline): Timeline {
  const next = timeline.future[0];
  if (!next) return timeline;
  return {
    past: [...timeline.past, timeline.present].slice(-HISTORY_LIMIT),
    present: next,
    future: timeline.future.slice(1),
  };
}

// ---------------------------------------------------------------------------
// Starting points. Derived from the catalogue and assembled through
// isPlayableTrack, so a new segment joins the presets on its own and a preset
// can never offer a course the game would refuse.
// ---------------------------------------------------------------------------

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  ids: readonly string[];
}

export function assemble(
  candidates: readonly TrackSegment[],
): readonly string[] {
  const chosen: string[] = [];
  for (const segment of candidates) {
    if (chosen.length >= MAX_MIDDLE_SEGMENTS) break;
    if (isPlayableTrack(["start", ...chosen, segment.id, "finish"]))
      chosen.push(segment.id);
  }
  return chosen;
}

/** The catalogue split into difficulty tiers, easiest tier first. */
export function difficultyTiers(
  segments: readonly TrackSegment[],
): readonly { difficulty: number; word: string; segments: TrackSegment[] }[] {
  const tiers = new Map<number, TrackSegment[]>();
  for (const segment of segments) {
    const tier = tiers.get(segment.difficulty);
    if (tier) tier.push(segment);
    else tiers.set(segment.difficulty, [segment]);
  }
  return [...tiers.entries()]
    .sort(([a], [b]) => a - b)
    .map(([difficulty, group]) => ({
      difficulty,
      word: DIFFICULTY_WORDS[difficulty] ?? "Unrated",
      segments: group,
    }));
}

function buildPresets(): readonly Preset[] {
  const easiestFirst = [...EDITABLE_SEGMENTS].sort(
    (a, b) => a.difficulty - b.difficulty,
  );
  const house = DEFAULT_CUSTOM_TRACK.map((id) =>
    EDITABLE_SEGMENTS.find((segment) => segment.id === id),
  ).filter((segment): segment is TrackSegment => segment !== undefined);
  const twoPerTier = difficultyTiers(EDITABLE_SEGMENTS).flatMap((tier) =>
    tier.segments.slice(0, 2),
  );
  return [
    {
      id: "house",
      name: "House course",
      blurb: "The one the game builds when nobody has touched the editor.",
      ids: assemble(house),
    },
    {
      id: "gentle",
      name: "Gentle opener",
      blurb: "The kindest pieces in the catalogue, easiest first.",
      ids: assemble(easiestFirst.slice(0, 5)),
    },
    {
      id: "tour",
      name: "Grand tour",
      blurb: "Two from every difficulty tier, ramping up as it goes.",
      ids: assemble(twoPerTier),
    },
    {
      id: "gauntlet",
      name: "Gauntlet",
      blurb: "The nastiest pieces there are, back to back.",
      ids: assemble([...easiestFirst].reverse().slice(0, 5).reverse()),
    },
  ];
}

export const PRESETS: readonly Preset[] = buildPresets();

/**
 * The curated maps, as starting points rather than as a separate menu.
 *
 * NAMED_TRACKS is the hand-sequenced list the front screen offers for play, and
 * until now that was all a player could do with them. Offered here they become
 * six courses somebody can pull apart, which teaches the catalogue better than
 * the palette does: the pieces arrive already arranged into something that
 * works. Every entry is pinned playable by tests/unit/named-tracks.test.ts, so
 * nothing here can seed the editor with a course the game would refuse.
 */
export const MAP_PRESETS: readonly Preset[] = NAMED_TRACKS.map((map) => ({
  id: `map-${map.id}`,
  name: map.name,
  blurb: map.tagline,
  ids: middleOf(map.segmentIds),
}));

/** The palette, grouped once. Nothing here names a segment. */
const PALETTE_TIERS = difficultyTiers(EDITABLE_SEGMENTS);

// ---------------------------------------------------------------------------
// The draft. Reopening the editor should not mean starting over.
// ---------------------------------------------------------------------------

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isEditable(id: string): boolean {
  return EDITABLE_SEGMENTS.some((segment) => segment.id === id);
}

/**
 * The middle of a course, whatever convention it arrived in.
 *
 * Two conventions meet here and they do not match. NAMED_TRACKS.segmentIds are
 * WHOLE courses and carry the pinned start and finish; Preset.ids are MIDDLES
 * and do not. Feeding a whole course into a slot that expects a middle produces
 * a course with two landing pads, which renders perfectly, reads as a real
 * course, and only comes apart at the seam - so every path into the editor goes
 * through this one function rather than trusting its caller.
 *
 * EDITABLE_SEGMENTS already excludes start, finish and classic, so the filter
 * is the normalisation: a middle passes through unchanged and a whole course
 * loses exactly its pinned ends.
 */
export function middleOf(ids: readonly string[]): readonly string[] {
  return ids.filter(isEditable).slice(0, MAX_MIDDLE_SEGMENTS);
}

/** One course somebody chose to keep. Keyed by name: saving over a name
 *  replaces it, which is what every save list a player has ever used does. */
export interface SavedCourse {
  name: string;
  /** Middle only, the same convention middleOf enforces everywhere else. */
  ids: readonly string[];
  savedAt: number;
}

/** Everything the editor remembers between visits. */
export interface EditorStore {
  /** Where the player left off, restored on open. */
  draft: readonly string[];
  saves: readonly SavedCourse[];
}

export const EMPTY_STORE: EditorStore = { draft: [], saves: [] };

function cleanIds(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? middleOf(value.filter((id): id is string => typeof id === "string"))
    : [];
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_SAVE_NAME) : "";
}

function readKey(storage: DraftStorage, key: string): unknown {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    // Storage throws outright when the browser has blocked it. An editor that
    // will not open is worse than an editor that forgot a draft.
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A hand-edited or half-written value is not worth a crash on open.
    return null;
  }
}

/**
 * Everything the editor remembers, whichever version wrote it.
 *
 * Total, the way coaching's loadMemory is total: every failure path returns a
 * usable store rather than throwing, because an editor that will not open is a
 * worse outcome than an editor that forgot something.
 *
 * The migration is the load-bearing part. Before this existed there was one
 * course under DRAFT_KEY, and somebody has one under it right now. It is
 * carried into BOTH the draft, so the editor still opens where they left off
 * and nothing about reopening changes, AND into a save, so that the first time
 * they load something else the course they had is still there to go back to.
 * "My course vanished when the update landed" is the one outcome a save feature
 * cannot survive having.
 */
export function readStore(storage: DraftStorage | null): EditorStore {
  if (!storage) return EMPTY_STORE;
  const parsed = readKey(storage, STORE_KEY);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as { draft?: unknown; saves?: unknown };
    const saves = Array.isArray(record.saves)
      ? record.saves
          .flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const save = entry as { name?: unknown; ids?: unknown; savedAt?: unknown };
            const name = cleanName(save.name);
            const ids = cleanIds(save.ids);
            if (!name || ids.length === 0) return [];
            return [{
              name,
              ids,
              savedAt: typeof save.savedAt === "number" ? save.savedAt : 0,
            }];
          })
          .slice(0, MAX_SAVED_COURSES)
      : [];
    return { draft: cleanIds(record.draft), saves };
  }
  // Nothing under the new key. Anything under the old one is somebody's course.
  const legacy = cleanIds(readKey(storage, DRAFT_KEY));
  if (legacy.length === 0) return EMPTY_STORE;
  return {
    draft: legacy,
    saves: [{ name: "Your last course", ids: legacy, savedAt: 0 }],
  };
}

/** Returns false when the write did not stick, so a caller can say so. */
export function writeStore(
  storage: DraftStorage | null,
  store: EditorStore,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // A full or blocked quota must not take the edit down with it. The store
    // held in React state stays the truth for this session, exactly as
    // coaching's live copy does when persistence is refused.
    return false;
  }
}

/** Save over a name, or add a new one. Newest first, oldest dropped at the cap. */
export function saveCourse(
  store: EditorStore,
  name: string,
  ids: readonly string[],
  savedAt: number,
): EditorStore {
  const trimmed = cleanName(name);
  const middle = middleOf(ids);
  if (!trimmed || middle.length === 0) return store;
  const rest = store.saves.filter((save) => save.name !== trimmed);
  return {
    ...store,
    saves: [{ name: trimmed, ids: middle, savedAt }, ...rest].slice(
      0,
      MAX_SAVED_COURSES,
    ),
  };
}

export function deleteCourse(store: EditorStore, name: string): EditorStore {
  return { ...store, saves: store.saves.filter((save) => save.name !== name) };
}

/** Null rather than an empty course, so a cleared draft falls back to a preset. */
export function readDraft(storage: DraftStorage | null): readonly string[] | null {
  const draft = readStore(storage).draft;
  return draft.length > 0 ? draft : null;
}

export function writeDraft(
  storage: DraftStorage | null,
  ids: readonly string[],
): void {
  if (!storage) return;
  writeStore(storage, { ...readStore(storage), draft: middleOf(ids) });
}

function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The shape of the course, drawn from the built track so a new segment draws
// itself with no work here.
// ---------------------------------------------------------------------------

interface Slot {
  slot: number;
  label: string;
  difficulty: number;
  start: number;
  length: number;
}

const PROFILE_WIDTH = 680;
const RIBBON_HEIGHT = 22;
const PLOT_TOP = 32;
const PLOT_HEIGHT = 74;
/** The lane band under the height plot. Same width, same x(z) scale. */
const LANE_TOP = PLOT_TOP + PLOT_HEIGHT + 14;
const LANE_HEIGHT = 56;

/**
 * The furthest any platform sits from the centre line.
 *
 * Measured off the built pieces rather than off laneWalk, and the difference
 * matters. laneWalk reports the lane BETWEEN segments, and only four segments
 * in the catalogue of thirty-five carry a non-zero exit, so it reads zero on
 * every one of the six named maps: a band drawn from it is a flat line on
 * almost every course. The pieces know where they actually are - Rush Hour
 * spans -1.90 to 1.90 while a straight course spans 0.00 to 0.00 - because a
 * segment wanders WITHIN itself and comes home at its seam.
 */
export function widestDrift(built: BuiltTrack): number {
  return built.pieces.reduce(
    (widest, piece) => Math.max(widest, Math.abs(piece.center[0])),
    0,
  );
}

/**
 * How wide the band has to be drawn to hold the course honestly.
 *
 * Never less than the lane envelope, so the guide lines always have somewhere
 * to sit, and never less than the widest platform - the pinned start pad is 8
 * units across against a 2.2 lane limit, so clamping to the envelope would draw
 * it flush with the guides and quietly claim a pad exactly fills the lane.
 */
export function planSpan(built: BuiltTrack): number {
  return built.pieces.reduce(
    (span, piece) => Math.max(span, Math.abs(piece.center[0]) + piece.size[0] / 2),
    LANE_X_LIMIT,
  );
}

function TrackProfile({
  slots,
  built,
  blockedAt,
  summary,
}: {
  slots: readonly Slot[];
  built: BuiltTrack;
  blockedAt: number | null;
  summary: string;
}): JSX.Element {
  const span = Math.max(built.length, 1);
  const x = (z: number) => (z / span) * PROFILE_WIDTH;
  let low = 0;
  let high = 0;
  for (const piece of built.pieces) {
    low = Math.min(low, piece.center[1] - piece.size[1] / 2);
    high = Math.max(high, piece.center[1] + piece.size[1] / 2);
  }
  const range = Math.max(high - low + 0.8, 1);
  const y = (value: number) =>
    PLOT_TOP + PLOT_HEIGHT * (1 - (value - (low - 0.4)) / range);
  const planWidth = planSpan(built);
  const laneY = (value: number) =>
    LANE_TOP + LANE_HEIGHT / 2 - (value / planWidth) * (LANE_HEIGHT / 2 - 4);
  const stretch = PLOT_HEIGHT / range / (PROFILE_WIDTH / span);
  const stretched = stretch < 10 ? stretch.toFixed(1) : String(Math.round(stretch));
  const blocked = blockedAt === null ? null : slots[blockedAt];
  return (
    <figure className="track-editor-figure">
      <svg
        className="track-editor-profile"
        viewBox={`0 0 ${PROFILE_WIDTH} ${LANE_TOP + LANE_HEIGHT}`}
        role="img"
        aria-label={summary}
        focusable="false"
      >
        <rect
          className="track-editor-profile-bed"
          x="0"
          y={PLOT_TOP}
          width={PROFILE_WIDTH}
          height={PLOT_HEIGHT}
          rx="8"
        />
        <line
          className="track-editor-profile-datum"
          x1="0"
          x2={PROFILE_WIDTH}
          y1={y(0)}
          y2={y(0)}
        />
        {built.pieces.map((piece) => (
          <rect
            key={piece.id}
            className="track-editor-profile-piece"
            x={x(piece.center[2] - piece.size[2] / 2)}
            y={y(piece.center[1] + piece.size[1] / 2)}
            width={Math.max(x(piece.size[2]), 1.5)}
            height={Math.max((piece.size[1] / range) * PLOT_HEIGHT, 3)}
            fill={piece.color}
          />
        ))}
        {slots.map((slot) => {
          const width = Math.max(x(slot.length), 2);
          const pinned = slot.slot === 0 || slot.slot === slots.length - 1;
          return (
            <g key={slot.slot}>
              <rect
                className="track-editor-profile-slot"
                x={x(slot.start)}
                y="0"
                width={width}
                height={RIBBON_HEIGHT}
                rx="5"
                fill={
                  pinned ? "#fff8e8" : DIFFICULTY_TINTS[slot.difficulty] ?? "#fff8e8"
                }
              />
              {width > 15 && (
                <text
                  className="track-editor-profile-number"
                  x={x(slot.start) + width / 2}
                  y={RIBBON_HEIGHT / 2 + 4}
                  textAnchor="middle"
                >
                  {slot.slot + 1}
                </text>
              )}
            </g>
          );
        })}
        {/* Plan view: the same pieces from above, so the axis the profile
            collapses is the one drawn here. A polyline through "the lane" was
            the first attempt and cannot work - left-island and right-island
            occupy the same z at -2.2 and +2.2, so a single line has to pick one
            and silently hide the other, and a branching course is exactly the
            shape most worth seeing. */}
        <g>
          <rect
            className="track-editor-profile-bed"
            x="0"
            y={LANE_TOP}
            width={PROFILE_WIDTH}
            height={LANE_HEIGHT}
            rx="8"
          />
          {/* The envelope isPlayableTrack enforces, so a course crowding it
              looks like it is crowding it. */}
          {[-1, 1].map((side) => (
            <line
              key={side}
              className="track-editor-lane-limit"
              x1="0"
              x2={PROFILE_WIDTH}
              y1={laneY(side * LANE_X_LIMIT)}
              y2={laneY(side * LANE_X_LIMIT)}
            />
          ))}
          <line
            className="track-editor-profile-datum"
            x1="0"
            x2={PROFILE_WIDTH}
            y1={laneY(0)}
            y2={laneY(0)}
          />
          {built.pieces.map((piece) => (
            <rect
              key={piece.id}
              className="track-editor-lane-piece"
              x={x(piece.center[2] - piece.size[2] / 2)}
              y={laneY(piece.center[0] + piece.size[0] / 2)}
              width={Math.max(x(piece.size[2]), 1.5)}
              height={Math.max(
                laneY(piece.center[0] - piece.size[0] / 2) -
                  laneY(piece.center[0] + piece.size[0] / 2),
                2,
              )}
              fill={piece.color}
            />
          ))}
        </g>
        {blocked && (
          <g>
            <line
              className="track-editor-profile-blocked"
              x1={x(blocked.start)}
              x2={x(blocked.start)}
              y1="0"
              y2={PLOT_TOP + PLOT_HEIGHT}
            />
            <rect
              className="track-editor-profile-blocked-cell"
              x={x(blocked.start)}
              y="0"
              width={Math.max(x(blocked.length), 2)}
              height={RIBBON_HEIGHT}
              rx="5"
            />
          </g>
        )}
      </svg>
      <figcaption>
        {`Top strip: side view, landing pad on the left, with heights stretched ${stretched}× to keep steps visible - read the jumps from the numbers rather than from the picture. Bottom strip: the same course from overhead, so you can see how far it swings across the corridor. The dashed lines are as far as a course may wander.`}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------

export function TrackEditor({
  initial,
  onPlay,
  onShare,
  onCancel,
}: {
  initial?: readonly string[];
  onPlay(segmentIds: readonly string[]): void;
  /** Hand the finished course to the caller to turn into a link. */
  onShare?(segmentIds: readonly string[]): void;
  onCancel(): void;
}): JSX.Element {
  const domId = useId();
  const [timeline, setTimeline] = useState<Timeline>(() => {
    const draft = readDraft(browserStorage());
    const source = initial ?? draft ?? DEFAULT_CUSTOM_TRACK;
    return startTimeline(
      middleOf(source).map((id, index) => ({ uid: index, id })),
      draft && !initial ? "restore your last draft" : "open the editor",
    );
  });
  const [status, setStatus] = useState("");
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  // The saved courses, held here rather than read from storage on every render.
  // This copy is the truth for the session, the way coaching's live memory is,
  // so a browser that refuses to persist still gets a save list that works
  // until the tab closes rather than a button that silently does nothing.
  const [saves, setSaves] = useState<readonly SavedCourse[]>(
    () => readStore(browserStorage()).saves,
  );
  const [saveName, setSaveName] = useState("");
  const placed = timeline.present.placed;
  const nextUid = useRef(MAX_MIDDLE_SEGMENTS);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  // The editor opens inline, below the button that opened it, so focus is
  // outside it until the player tabs in. Undo lives on this panel's own key
  // handler rather than on the window, which keeps it out of the game's
  // shortcuts, so focus has to start inside for it to be reachable at all.
  useEffect(() => {
    panel.current?.focus();
  }, []);
  // A reorder rewrites the list, so focus would otherwise stay on whichever
  // control took over that slot in the DOM. Send it to the same control on the
  // card that actually moved.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    buttons.current.get(key)?.focus();
  });
  useEffect(() => {
    writeDraft(
      browserStorage(),
      placed.map((entry) => entry.id),
    );
  }, [placed]);
  const register = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(key, node);
    else buttons.current.delete(key);
  };

  const track = useMemo(
    () => ["start", ...placed.map((entry) => entry.id), "finish"],
    [placed],
  );
  const built = useMemo(() => buildTrack(track), [track]);
  const review = useMemo(() => reviewTrack(track), [track]);
  const slots = useMemo(() => {
    let cursor = 0;
    return track.map((id, slot) => {
      const segment = SEGMENT_MAP.get(id);
      const start = cursor;
      cursor += segment?.length ?? 0;
      return {
        slot,
        label: segment?.label ?? id,
        difficulty: segment?.difficulty ?? 0,
        start,
        length: segment?.length ?? 0,
      };
    });
  }, [track]);

  const selectedIndex = placed.findIndex((entry) => entry.uid === selectedUid);
  const insertAt = selectedIndex < 0 ? placed.length : selectedIndex + 1;
  const full = placed.length >= MAX_MIDDLE_SEGMENTS;
  const validityId = `${domId}-validity`;
  // Marking a piece as a bad fit is only useful while the course is otherwise
  // sound: on a course that is already refused, everything reads as a bad fit.
  const fits = useMemo(() => {
    const verdicts = new Map<string, boolean>();
    if (full || !review.playable) return verdicts;
    const ids = placed.map((entry) => entry.id);
    for (const segment of EDITABLE_SEGMENTS)
      verdicts.set(
        segment.id,
        isPlayableTrack([
          "start",
          ...ids.slice(0, insertAt),
          segment.id,
          ...ids.slice(insertAt),
          "finish",
        ]),
      );
    return verdicts;
  }, [placed, insertAt, full, review.playable]);

  const verdictOf = (next: readonly Placed[]): string => {
    const after = reviewTrack([
      "start",
      ...next.map((entry) => entry.id),
      "finish",
    ]);
    return after.playable ? "Still playable." : after.message;
  };
  const apply = (
    next: readonly Placed[],
    label: string,
    sentence: string,
    focus?: string,
  ) => {
    setTimeline((current) => commit(current, next, label));
    setStatus(`${sentence} ${verdictOf(next)}`);
    if (focus !== undefined) pendingFocus.current = focus;
  };

  const add = (segment: TrackSegment) => {
    if (full) {
      setStatus(
        `The course is full at ${MAX_TRACK_SEGMENTS} segments, counting the pinned start and finish. Remove one to make room.`,
      );
      return;
    }
    const uid = nextUid.current;
    nextUid.current += 1;
    const next = insertPlaced(placed, insertAt, { uid, id: segment.id });
    setSelectedUid(uid);
    apply(
      next,
      `adding ${segment.label}`,
      `Added ${segment.label} at position ${insertAt + 2} of ${next.length + 2}.`,
    );
  };

  const copy = (index: number) => {
    const entry = placed[index];
    if (!entry) return;
    if (full) {
      setStatus(
        `The course is full at ${MAX_TRACK_SEGMENTS} segments. Remove one to make room.`,
      );
      return;
    }
    const uid = nextUid.current;
    nextUid.current += 1;
    const next = insertPlaced(placed, index + 1, { uid, id: entry.id });
    setSelectedUid(uid);
    apply(
      next,
      `duplicating ${labelOf(entry.id)}`,
      `Copied ${labelOf(entry.id)} into position ${index + 3}.`,
      `copy-${uid}`,
    );
  };

  const drop = (index: number) => {
    const entry = placed[index];
    if (!entry) return;
    const next = removePlaced(placed, index);
    const neighbour = next[index] ?? next[index - 1];
    if (entry.uid === selectedUid)
      setSelectedUid(neighbour ? neighbour.uid : null);
    apply(
      next,
      `removing ${labelOf(entry.id)}`,
      `Removed ${labelOf(entry.id)}. ${next.length + 2} segments left.`,
      neighbour
        ? `drop-${neighbour.uid}`
        : `add-${EDITABLE_SEGMENTS[0]?.id ?? ""}`,
    );
  };

  const move = (index: number, delta: -1 | 1, focus: boolean) => {
    const entry = placed[index];
    if (!entry) return;
    const label = labelOf(entry.id);
    const next = movePlaced(placed, index, delta);
    // The boundary buttons stay focusable so a keyboard user never tabs into a
    // dead control, which means the refusal has to be spoken rather than shown.
    if (next === placed) {
      setStatus(
        `${label} is already ${delta < 0 ? "first" : "last"} in the middle of the course. The landing pad and the finish room stay pinned.`,
      );
      return;
    }
    apply(
      next,
      `moving ${label}`,
      `${label} moved to position ${index + delta + 2} of ${next.length + 2}.`,
      focus ? `${delta < 0 ? "up" : "down"}-${entry.uid}` : undefined,
    );
  };

  const clearAll = () => {
    if (placed.length === 0) {
      setStatus("The middle of the course is already empty.");
      return;
    }
    setSelectedUid(null);
    apply([], "clearing the course", "Cleared the middle of the course.");
  };

  /**
   * Keep the course under a name.
   *
   * Saving over a name replaces it, which is what every save list a player has
   * used does, and it means "save again" after an edit is one action rather
   * than a delete and a re-save.
   */
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) {
      setStatus("Give the course a name first.");
      return;
    }
    if (placed.length === 0) {
      setStatus("There is nothing between the pinned ends to save.");
      return;
    }
    const replacing = saves.some((save) => save.name === name);
    const storage = browserStorage();
    const next = saveCourse({ ...readStore(storage), saves }, name, track, Date.now());
    setSaves(next.saves);
    setSaveName("");
    // Loudly is fine, silently broken is not: a browser in private mode keeps
    // the save for this session and says so, rather than pretending it stuck.
    setStatus(
      writeStore(storage, next)
        ? `${replacing ? "Replaced" : "Saved"} ${name}. ${next.saves.length} of ${MAX_SAVED_COURSES} kept.`
        : `${name} is saved for this session only. This browser refused to store it, so it will not be here next time.`,
    );
  };

  const loadSaved = (save: SavedCourse) => {
    const next = save.ids.map((id) => {
      const uid = nextUid.current;
      nextUid.current += 1;
      return { uid, id };
    });
    setSelectedUid(null);
    apply(next, `loading ${save.name}`, `Loaded ${save.name}: ${next.length + 2} segments.`);
  };

  const deleteSaved = (save: SavedCourse) => {
    const storage = browserStorage();
    const next = deleteCourse({ ...readStore(storage), saves }, save.name);
    setSaves(next.saves);
    writeStore(storage, next);
    setStatus(`Deleted ${save.name}.`);
  };

  const loadPreset = (preset: Preset) => {
    const next = preset.ids.map((id) => {
      const uid = nextUid.current;
      nextUid.current += 1;
      return { uid, id };
    });
    setSelectedUid(null);
    apply(
      next,
      `loading ${preset.name}`,
      `Loaded ${preset.name}: ${next.length + 2} segments.`,
    );
  };

  const stepBack = () => {
    const next = undo(timeline);
    if (next === timeline) {
      setStatus("Nothing left to undo.");
      return;
    }
    setSelectedUid(null);
    setTimeline(next);
    setStatus(
      `Undid ${timeline.present.label}. ${verdictOf(next.present.placed)}`,
    );
  };

  const stepForward = () => {
    const next = redo(timeline);
    if (next === timeline) {
      setStatus("Nothing left to redo.");
      return;
    }
    setSelectedUid(null);
    setTimeline(next);
    setStatus(
      `Redid ${next.present.label}. ${verdictOf(next.present.placed)}`,
    );
  };

  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    const held = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (held && key === "z") {
      event.preventDefault();
      if (event.shiftKey) stepForward();
      else stepBack();
      return;
    }
    if (held && key === "y") {
      event.preventDefault();
      stepForward();
      return;
    }
    if (selectedIndex < 0) return;
    if (event.altKey && (key === "arrowup" || key === "arrowdown")) {
      event.preventDefault();
      move(selectedIndex, key === "arrowup" ? -1 : 1, false);
      return;
    }
    if (key === "delete" || key === "backspace") {
      event.preventDefault();
      drop(selectedIndex);
    }
  };

  const points = difficultyPoints(track);
  const sprint = built.length / PLAYER.moveSpeed;
  const drift = widestDrift(built);
  // The figure is one role="img" with one label, so a visual the label does not
  // mention is a picture that says more than its description. The lane band is
  // described here for the same reason it was drawn.
  const summary = `Side view of the course above, and the same course from overhead below: ${track.length} segments over ${built.length.toFixed(1)} units, hardest jump ${review.hardest.gap.toFixed(2)} units, reaching ${drift.toFixed(2)} units off the centre line at its widest.${
    review.blockedAt === null
      ? ""
      : ` The run stops at segment ${review.blockedAt + 1}.`
  }`;

  return (
    <section
      ref={panel}
      className="panel track-editor"
      aria-labelledby={`${domId}-title`}
      tabIndex={-1}
      onKeyDown={handleKey}
    >
      <div className="eyebrow">TRACK EDITOR</div>
      <h2 id={`${domId}-title`}>Build the course.</h2>
      <p className="track-editor-lede">
        Lay segments between the landing pad and the finish room. The runner has
        one fixed jump, so every join is measured against it as you go.
      </p>

      <dl className="track-editor-stats">
        <div>
          <dt>Segments</dt>
          <dd>
            {track.length} of {MAX_TRACK_SEGMENTS}
          </dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{built.length.toFixed(1)}u</dd>
        </div>
        <div>
          <dt>Flat sprint</dt>
          <dd>
            {sprint.toFixed(1)}s of {ATTEMPT_LIMIT_S}s
          </dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>
            {courseWord(points)} · {points} pts
          </dd>
        </div>
        <div>
          <dt>Hardest jump</dt>
          <dd>
            {review.hardest.gap.toFixed(2)}u of {JUMP_BUDGET.toFixed(2)}u
          </dd>
        </div>
      </dl>

      <TrackProfile
        slots={slots}
        built={built}
        blockedAt={review.blockedAt}
        summary={summary}
      />

      <p
        id={validityId}
        className={`track-editor-validity ${review.playable ? "is-ok" : "is-bad"}`}
      >
        <b>{review.playable ? "PLAYABLE" : "CANNOT BE FINISHED"}</b>
        <span>
          {review.message}
          {review.repair ? ` ${review.repair}` : ""}
        </span>
      </p>

      <div className="track-editor-columns">
        <div>
          <h3 className="eyebrow">THE COURSE</h3>
          <div className="track-editor-toolbar">
            <button
              className="track-editor-tool"
              aria-disabled={timeline.past.length === 0}
              onClick={stepBack}
            >
              Undo{timeline.past.length > 0 ? ` ${timeline.present.label}` : ""}
            </button>
            <button
              className="track-editor-tool"
              aria-disabled={timeline.future.length === 0}
              onClick={stepForward}
            >
              Redo{timeline.future[0] ? ` ${timeline.future[0].label}` : ""}
            </button>
            <button
              className="track-editor-tool"
              aria-disabled={placed.length === 0}
              onClick={clearAll}
            >
              Clear
            </button>
          </div>

          <div className="track-editor-saves">
            <h4 className="eyebrow">YOUR COURSES</h4>
            <div className="track-editor-saverow">
              {/* Labelled by attribute rather than by a visually hidden
                  <label>: the panel's live region is the sr-only element at the
                  bottom of this component, and a second one earlier in the DOM
                  is the kind of thing that quietly becomes "the first .sr-only"
                  for somebody's query. */}
              <input
                aria-label="Name this course"
                className="track-editor-savename"
                value={saveName}
                maxLength={MAX_SAVE_NAME}
                placeholder="Name this course"
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  // Enter inside the field saves, and stops there: the panel's
                  // own key handler treats arrows and Alt as editing commands,
                  // and a name being typed is not an edit to the course.
                  event.stopPropagation();
                  if (event.key === "Enter") saveCurrent();
                }}
              />
              <button
                className="track-editor-tool"
                aria-disabled={placed.length === 0 || saveName.trim().length === 0}
                onClick={saveCurrent}
              >
                Save
              </button>
            </div>
            {saves.length === 0 ? (
              <p className="track-editor-note">
                Nothing kept yet. Saving keeps a course here so you can come
                back to it, build something else, and still have both.
              </p>
            ) : (
              <ul className="track-editor-savelist">
                {saves.map((save) => (
                  <li key={save.name}>
                    <button
                      className="track-editor-preset"
                      onClick={() => loadSaved(save)}
                    >
                      <strong>{save.name}</strong>
                      <small>{save.ids.length + 2} segments</small>
                    </button>
                    <button
                      className="track-editor-tool"
                      aria-label={`Delete ${save.name}`}
                      onClick={() => deleteSaved(save)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="track-editor-starters">
            <p className="track-editor-note">
              Start from one of these, then change whatever you like. Every one
              is assembled through the same check the game runs on a shared
              link, so all of them are playable before you touch them.
            </p>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="track-editor-preset"
                onClick={() => loadPreset(preset)}
              >
                <strong>{preset.name}</strong>
                <small>
                  {preset.ids.length + 2} segments · {preset.blurb}
                </small>
              </button>
            ))}
            <h4 className="eyebrow">OR TAKE A MAP APART</h4>
            <p className="track-editor-note">
              The same maps the front screen offers, opened up. Loading one
              replaces the middle of your course; the pinned ends stay put.
            </p>
            {MAP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="track-editor-preset"
                onClick={() => loadPreset(preset)}
              >
                <strong>{preset.name}</strong>
                <small>
                  {preset.ids.length + 2} segments · {preset.blurb}
                </small>
              </button>
            ))}
          </div>

          <ol className="track-editor-course">
            <li className="track-editor-card is-pinned">
              <span className="track-editor-index" aria-hidden="true">
                1
              </span>
              <span className="track-editor-body">
                <strong>{START.label}</strong>
                <small>Pinned start · {START.length}u</small>
              </span>
            </li>
            {placed.map((entry, index) => {
              const segment = SEGMENT_MAP.get(entry.id);
              if (!segment) return null;
              const where = `position ${index + 2} of ${placed.length + 2}`;
              const selected = entry.uid === selectedUid;
              const seam = review.seams[index];
              return (
                <li
                  key={entry.uid}
                  className={`track-editor-card${selected ? " is-selected" : ""}${
                    seam?.blocks ? " is-blocked" : ""
                  }`}
                >
                  <span className="track-editor-index" aria-hidden="true">
                    {index + 2}
                  </span>
                  <button
                    ref={register(`pick-${entry.uid}`)}
                    className="track-editor-pick"
                    aria-pressed={selected}
                    aria-label={`${segment.label}, ${where}. ${
                      selected
                        ? "New segments land after this one."
                        : "Choose it so new segments land after it."
                    }`}
                    onClick={() => {
                      const now = selected ? null : entry.uid;
                      setSelectedUid(now);
                      setStatus(
                        now === null
                          ? `${segment.label} released. New segments land at the end.`
                          : `${segment.label} chosen. New segments land straight after it, and Alt with the arrow keys moves it.`,
                      );
                    }}
                  >
                    <strong>{segment.label}</strong>
                    <small>
                      {DIFFICULTY_WORDS[segment.difficulty]} · {segment.length}u
                    </small>
                  </button>
                  <span className="track-editor-controls">
                    <button
                      ref={register(`up-${entry.uid}`)}
                      aria-label={`Move ${segment.label} up (${where})`}
                      aria-disabled={index === 0}
                      onClick={() => move(index, -1, true)}
                    >
                      ↑
                    </button>
                    <button
                      ref={register(`down-${entry.uid}`)}
                      aria-label={`Move ${segment.label} down (${where})`}
                      aria-disabled={index === placed.length - 1}
                      onClick={() => move(index, 1, true)}
                    >
                      ↓
                    </button>
                    <button
                      ref={register(`copy-${entry.uid}`)}
                      aria-label={`Duplicate ${segment.label} (${where})`}
                      aria-disabled={full}
                      onClick={() => copy(index)}
                    >
                      ×2
                    </button>
                    <button
                      ref={register(`drop-${entry.uid}`)}
                      className="track-editor-drop"
                      aria-label={`Remove ${segment.label} (${where})`}
                      onClick={() => drop(index)}
                    >
                      ✕
                    </button>
                  </span>
                  {seam?.blocks && (
                    <p className="track-editor-seam is-blocked">
                      {seam.hardestGap >= JUMP_BUDGET
                        ? `${seam.hardestGap.toFixed(2)}u jump into this, ${(seam.hardestGap - JUMP_BUDGET).toFixed(2)}u past what the runner clears.`
                        : `${seam.hardestRise.toFixed(2)}u step up into this, ${(seam.hardestRise - RISE_BUDGET).toFixed(2)}u past what the runner rises.`}
                    </p>
                  )}
                  {!seam?.blocks && seam?.raisedGap && (
                    <p className="track-editor-seam">
                      Hardest jump so far: {seam.hardestGap.toFixed(2)}u of{" "}
                      {JUMP_BUDGET.toFixed(2)}u.
                    </p>
                  )}
                  {!seam?.blocks && !seam?.raisedGap && seam?.raisedRise && (
                    <p className="track-editor-seam">
                      Highest step so far: {seam.hardestRise.toFixed(2)}u of{" "}
                      {RISE_BUDGET.toFixed(2)}u.
                    </p>
                  )}
                </li>
              );
            })}
            <li className="track-editor-card is-pinned">
              <span className="track-editor-index" aria-hidden="true">
                {placed.length + 2}
              </span>
              <span className="track-editor-body">
                <strong>{FINISH.label}</strong>
                <small>Pinned finish · {FINISH.length}u</small>
              </span>
            </li>
          </ol>
          {placed.length === 0 && (
            <p className="track-editor-empty">
              Nothing in the middle yet, so the runner walks off the pad and
              straight into the door. Take a starting point above, or add a
              segment from the palette.
            </p>
          )}
          <p className="track-editor-keys">
            Ctrl+Z undoes and Ctrl+Shift+Z redoes, anywhere in the editor. With
            a segment chosen, Alt and the arrow keys move it and Delete removes
            it.
          </p>
        </div>

        <div>
          <h3 className="eyebrow">SEGMENT PALETTE</h3>
          <p className="track-editor-note">
            {full
              ? `Full at ${MAX_TRACK_SEGMENTS} segments, counting the pinned start and finish. Remove one to make room.`
              : `Room for ${MAX_MIDDLE_SEGMENTS - placed.length} more. ${
                  selectedIndex < 0
                    ? "Each one lands just before the finish room."
                    : `Each one lands straight after ${labelOf(placed[selectedIndex]?.id)}.`
                }`}
          </p>
          {PALETTE_TIERS.map((tier) => (
            <div className="track-editor-tier" key={tier.difficulty}>
              <h4 className="eyebrow">
                {tier.word} · {tier.segments.length}
              </h4>
              <div className="track-editor-palette">
                {tier.segments.map((segment) => {
                  const misfit = fits.get(segment.id) === false;
                  return (
                    <button
                      key={segment.id}
                      ref={register(`add-${segment.id}`)}
                      className="track-editor-add"
                      aria-disabled={full}
                      aria-label={`Add ${segment.label} ${
                        selectedIndex < 0
                          ? "to the end of the course"
                          : `after ${labelOf(placed[selectedIndex]?.id)}`
                      }`}
                      aria-describedby={`${domId}-desc-${segment.id}`}
                      onClick={() => add(segment)}
                    >
                      <span className="track-editor-add-head">
                        <strong>{segment.label}</strong>
                        <span className="track-editor-pips" aria-hidden="true">
                          {[0, 1, 2].map((pip) => (
                            <i
                              key={pip}
                              className={
                                pip < segment.difficulty ? "on" : undefined
                              }
                            />
                          ))}
                        </span>
                      </span>
                      <span
                        id={`${domId}-desc-${segment.id}`}
                        className="track-editor-desc"
                      >
                        {segment.description} {DIFFICULTY_WORDS[segment.difficulty]}{" "}
                        · {segment.length}u.
                        {misfit && (
                          <b className="track-editor-misfit">
                            Dropped in here, the course stops being finishable.
                          </b>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="track-editor-actions">
        <button
          className="button danger huge"
          disabled={!review.playable}
          aria-describedby={validityId}
          onClick={() => onPlay(track)}
        >
          Play this track
        </button>
        {onShare && (
          // Sending a course used to mean playing it to the finish, beating it,
          // adding a trap and publishing. That is the chain loop and it stays
          // the chain loop; this is the other thing a builder wants, which is
          // to hand somebody the course itself. Gated on the same verdict as
          // Play, because a link nobody can finish is worse than no link.
          <button
            className="button secondary"
            disabled={!review.playable}
            aria-describedby={validityId}
            onClick={() => onShare(track)}
          >
            Copy a link to it
          </button>
        )}
        <button className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
