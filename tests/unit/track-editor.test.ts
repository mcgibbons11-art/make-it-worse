// Track editor logic.
//
// portals/src had no test coverage at all, and the editor is the one surface
// where a player builds something and sends it to somebody else. The rule that
// matters most is that the editor's verdict is isPlayableTrack's verdict: a
// preview that drifts certifies a course the recipient could never open, and
// this repository has already been bitten by a rule duplicated in three places
// that disagreed. Everything below either checks that agreement or checks that
// a refusal explains itself well enough to act on.

import { describe, expect, it } from "vitest";
import {
  EDITABLE_SEGMENTS,
  laneAfter,
  JUMP_DISTANCE,
  JUMP_MARGIN,
  LANE_X_LIMIT,
  MAX_TRACK_SEGMENTS,
  NAMED_TRACKS,
  SEGMENT_MAP,
  buildTrack,
  isPlayableTrack,
} from "@/lib/game/track";
import {
  MAP_PRESETS,
  MAX_MIDDLE_SEGMENTS,
  MAX_SAVED_COURSES,
  PRESETS,
  assemble,
  commit,
  deleteCourse,
  middleOf,
  readStore,
  planSpan,
  saveCourse,
  widestDrift,
  writeStore,
  difficultyTiers,
  insertPlaced,
  movePlaced,
  readDraft,
  redo,
  removePlaced,
  reviewTrack,
  scanSeams,
  startTimeline,
  suggestRepair,
  undo,
  writeDraft,
} from "@/portals/src/TrackEditor";
import type { Placed } from "@/portals/src/TrackEditor";
import type { TrackSegment } from "@/lib/game/track";

const JUMP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;

/** A flat slab spanning exactly [0, length], so its seams are always flush. */
function slab(id: string, length: number): TrackSegment {
  return {
    id,
    label: `Slab ${id}`,
    description: "A synthetic flat slab.",
    length,
    difficulty: 0,
    pieces: [
      {
        id: `${id}_top`,
        center: [0, -0.5, length / 2],
        size: [4, 1, length],
        color: "#fff8e8",
      },
    ],
    zones: [],
  };
}

/**
 * A segment whose only platform starts `void` units in, so the join into it is
 * a measured jump rather than a step. Everything else about it is flush.
 */
function voidSegment(id: string, gap: number): TrackSegment {
  return {
    id,
    label: `Void ${id}`,
    description: "A synthetic void and a landing pad.",
    length: gap + 2,
    difficulty: 3,
    pieces: [
      {
        id: `${id}_land`,
        center: [0, -0.5, gap + 1],
        size: [4, 1, 2],
        color: "#57dfa1",
      },
    ],
    zones: [],
  };
}

/** A segment whose platform sits `rise` units above the datum, flush in Z. */
function shelfSegment(id: string, rise: number): TrackSegment {
  return {
    id,
    label: `Shelf ${id}`,
    description: "A synthetic shelf.",
    length: 5,
    difficulty: 3,
    pieces: [
      {
        id: `${id}_top`,
        center: [0, rise - 0.5, 2.5],
        size: [4, 1, 5],
        color: "#8b72ff",
      },
    ],
    zones: [],
  };
}

/** Make synthetic segments composable for one assertion, then take them away. */
function withSegments(segments: readonly TrackSegment[], run: () => void): void {
  for (const segment of segments) {
    if (SEGMENT_MAP.has(segment.id))
      throw new Error(`${segment.id} collides with a real segment`);
    SEGMENT_MAP.set(segment.id, segment);
  }
  try {
    run();
  } finally {
    for (const segment of segments) SEGMENT_MAP.delete(segment.id);
  }
}

function entries(...ids: readonly string[]): readonly Placed[] {
  return ids.map((id, uid) => ({ uid, id }));
}

function idsOf(placed: readonly Placed[]): readonly string[] {
  return placed.map((entry) => entry.id);
}

const CATALOGUE_IDS = EDITABLE_SEGMENTS.map((segment) => segment.id);

/**
 * A deterministic sample of compositions, so a failure is reproducible.
 *
 * Every shipped segment composes with every other one, so a sample drawn from
 * the catalogue alone never produces a refusal and would prove nothing about
 * the refusal path. The hostile pool exists for that.
 */
function sampleTracks(
  count: number,
  pool: readonly string[] = CATALOGUE_IDS,
): readonly string[][] {
  let seed = 20260727;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const tracks: string[][] = [];
  for (let index = 0; index < count; index += 1) {
    const middle = 1 + Math.floor(random() * MAX_MIDDLE_SEGMENTS);
    const picked: string[] = [];
    for (let slot = 0; slot < middle; slot += 1) {
      const id = pool[Math.floor(random() * pool.length)];
      if (id !== undefined) picked.push(id);
    }
    tracks.push(["start", ...picked, "finish"]);
  }
  return tracks;
}

const HOSTILE: readonly TrackSegment[] = [
  voidSegment("test_void_far", 5),
  voidSegment("test_void_near", 3),
  shelfSegment("test_shelf_high", 2.1),
  shelfSegment("test_shelf_low", 0.6),
  slab("test_slab_long", 40),
];

// reviewTrack today returns isPlayableTrack's answer verbatim, so the two
// agreement tests below cannot fail as the code stands. That is the point of
// them: they are the tripwire for the day somebody replaces that call with a
// second opinion, which is how the zone search ended up duplicated three ways.
// The tests that can fail today are the ones about what a refusal says.
describe("the editor's verdict is the shipped rule", () => {
  it("agrees with isPlayableTrack on every composition it can reach", () => {
    const tracks = [
      ["start", "finish"],
      ["start", "runway", "finish"],
      ...PRESETS.map((preset) => ["start", ...preset.ids, "finish"]),
      ...EDITABLE_SEGMENTS.map((segment) => ["start", segment.id, "finish"]),
      ...sampleTracks(200),
    ];
    for (const track of tracks)
      expect({ track, playable: reviewTrack(track).playable }).toEqual({
        track,
        playable: isPlayableTrack(track),
      });
  });

  it("agrees on tracks the catalogue cannot produce", () => {
    withSegments([voidSegment("test_void", 5), slab("test_slab", 40)], () => {
      const tracks = [
        [],
        ["start"],
        ["classic"],
        ["classic", "runway", "finish"],
        ["runway", "finish"],
        ["start", "runway"],
        ["start", "nonsense", "finish"],
        ["start", "test_void", "finish"],
        ["start", ...Array<string>(11).fill("runway"), "finish"],
        ["start", ...Array<string>(7).fill("test_slab"), "finish"],
      ];
      for (const track of tracks)
        expect({ track, playable: reviewTrack(track).playable }).toEqual({
          track,
          playable: isPlayableTrack(track),
        });
    });
  });

  it("agrees on compositions built to break, and explains every refusal", () => {
    withSegments(HOSTILE, () => {
      const pool = [...CATALOGUE_IDS, ...HOSTILE.map((segment) => segment.id)];
      const tracks = [["start", "finish"], ...sampleTracks(300, pool)];
      const refused = tracks.filter((track) => !isPlayableTrack(track));
      // Guards the sample itself: a pool that stopped producing refusals would
      // turn every assertion below into a no-op.
      expect(refused.length).toBeGreaterThan(30);
      for (const track of tracks)
        expect({ track, playable: reviewTrack(track).playable }).toEqual({
          track,
          playable: isPlayableTrack(track),
        });
      for (const track of refused) {
        const review = reviewTrack(track);
        expect(review.message.length).toBeGreaterThan(40);
        expect(review.message).not.toMatch(/could not be identified/i);
        // Either a join was named, or the reason names a rule rather than
        // shrugging at the player.
        expect(
          review.blockedAt !== null ||
            /nothing in the middle|is the limit|size of it/.test(review.message),
        ).toBe(true);
      }
    });
  });
});

describe("a refusal names the join responsible", () => {
  it("names both segments, the jump asked for and the shortfall", () => {
    withSegments([voidSegment("test_void", 5)], () => {
      const track = ["start", "test_void", "finish"];
      const review = reviewTrack(track);
      expect(review.playable).toBe(false);
      expect(review.blockedAt).toBe(1);
      expect(review.message).toContain("Landing Pad");
      expect(review.message).toContain("Void test_void");
      expect(review.message).toContain("5.00u jump");
      expect(review.message).toContain(JUMP_BUDGET.toFixed(2));
      // Derived, not transcribed: the shortfall is the fixture's 5.00u gap less
      // whatever the runner can currently clear, so retuning the jump moves this
      // expectation with it instead of turning the test red for being stale.
      expect(review.message).toContain(
        `${(5 - JUMP_BUDGET).toFixed(2)}u out of reach`,
      );
    });
  });

  it("distinguishes a step too high from a jump too far", () => {
    withSegments([shelfSegment("test_shelf", 2.1)], () => {
      const review = reviewTrack(["start", "test_shelf", "finish"]);
      expect(review.playable).toBe(false);
      expect(review.blockedAt).toBe(1);
      expect(review.message).toContain("step up");
      expect(review.message).not.toContain("jump.");
      expect(review.seams[0]?.hardestRise).toBeCloseTo(2.1, 5);
      expect(review.seams[0]?.hardestGap).toBe(0);
    });
  });

  it("marks only the first unreachable segment, not everything behind it", () => {
    withSegments([voidSegment("test_void", 5)], () => {
      const seams = scanSeams([
        "start",
        "test_void",
        "test_void",
        "runway",
        "finish",
      ]);
      expect(seams.filter((seam) => seam.blocks).map((seam) => seam.index)).toEqual([1]);
    });
  });

  it("points at the size of the course when every join is fine", () => {
    withSegments([slab("test_slab", 40)], () => {
      const track = ["start", ...Array<string>(7).fill("test_slab"), "finish"];
      expect(buildTrack(track).length).toBeCloseTo(291, 5);
      const review = reviewTrack(track);
      expect(review.playable).toBe(false);
      expect(review.blockedAt).toBeNull();
      expect(review.message).toContain("291.0u");
      expect(review.message).toContain("60s");
      expect(review.repair).toContain("Removing");
    });
  });

  it("counts the segments over the limit", () => {
    const track = ["start", ...Array<string>(11).fill("runway"), "finish"];
    const review = reviewTrack(track);
    expect(review.playable).toBe(false);
    expect(review.message).toContain("13 segments");
    expect(review.message).toContain(`${MAX_TRACK_SEGMENTS} is the limit`);
  });

  it("explains an empty middle rather than blaming a join", () => {
    const review = reviewTrack(["start", "finish"]);
    expect(review.playable).toBe(false);
    expect(review.blockedAt).toBeNull();
    expect(review.message).toContain("nothing in the middle");
    expect(review.repair).toBeNull();
  });

  it("reports the headroom left on a course that works", () => {
    const track = ["start", "runway", "finish"];
    const review = reviewTrack(track);
    expect(review.playable).toBe(true);
    expect(review.repair).toBeNull();
    expect(review.blockedAt).toBeNull();
    expect(review.message).toContain("spare");
  });
});

describe("the suggested repair is one that works", () => {
  it("returns a removal that isPlayableTrack accepts", () => {
    withSegments([voidSegment("test_void", 5)], () => {
      const track = ["start", "runway", "test_void", "bridge", "finish"];
      const repair = suggestRepair(track);
      expect(repair).not.toBeNull();
      const applied = [
        ...track.slice(0, repair?.index ?? 0),
        ...track.slice((repair?.index ?? 0) + 1),
      ];
      expect(isPlayableTrack(applied)).toBe(true);
      expect(repair?.message).toContain("Void test_void");
    });
  });

  it("stays silent when no single removal helps", () => {
    expect(suggestRepair(["start", "finish"])).toBeNull();
  });
});

describe("the running measurements match the whole-track ones", () => {
  it("ends on the same numbers isPlayableTrack measures against", () => {
    for (const track of sampleTracks(60)) {
      const review = reviewTrack(track);
      const last = review.seams.at(-1);
      expect(last?.hardestGap).toBe(review.hardest.gap);
      if (review.playable) expect(review.hardest.gap).toBeLessThan(JUMP_BUDGET);
    }
  });

  it("flags the segment that made the course harder", () => {
    withSegments([voidSegment("test_void", 3.6)], () => {
      const seams = scanSeams(["start", "runway", "test_void", "finish"]);
      expect(seams[0]?.raisedGap).toBe(false);
      expect(seams[1]?.raisedGap).toBe(true);
      expect(seams[1]?.hardestGap).toBeCloseTo(3.6, 5);
      expect(seams[2]?.raisedGap).toBe(false);
    });
  });
});

describe("editing a course", () => {
  it("inserts after the chosen card and clamps out of range", () => {
    const placed = entries("runway", "bridge");
    expect(idsOf(insertPlaced(placed, 1, { uid: 9, id: "ramp" }))).toEqual([
      "runway",
      "ramp",
      "bridge",
    ]);
    expect(idsOf(insertPlaced(placed, 99, { uid: 9, id: "ramp" }))).toEqual([
      "runway",
      "bridge",
      "ramp",
    ]);
    expect(idsOf(insertPlaced(placed, -3, { uid: 9, id: "ramp" }))).toEqual([
      "ramp",
      "runway",
      "bridge",
    ]);
  });

  it("removes one card and leaves duplicates of it alone", () => {
    const placed = entries("runway", "runway", "bridge");
    const next = removePlaced(placed, 0);
    expect(idsOf(next)).toEqual(["runway", "bridge"]);
    expect(next[0]?.uid).toBe(1);
    expect(removePlaced(placed, 7)).toBe(placed);
  });

  it("reorders by one place and refuses to push past the pinned ends", () => {
    const placed = entries("runway", "bridge", "ramp");
    expect(idsOf(movePlaced(placed, 2, -1))).toEqual([
      "runway",
      "ramp",
      "bridge",
    ]);
    expect(idsOf(movePlaced(placed, 0, 1))).toEqual([
      "bridge",
      "runway",
      "ramp",
    ]);
    // Identity is the refusal: it is what lets the caller speak the reason
    // instead of leaving a dead button for a keyboard user to land on.
    expect(movePlaced(placed, 0, -1)).toBe(placed);
    expect(movePlaced(placed, 2, 1)).toBe(placed);
  });
});

describe("undo", () => {
  it("walks back and forward through the edits", () => {
    const first = startTimeline(entries("runway"), "open the editor");
    const second = commit(first, entries("runway", "bridge"), "adding a bridge");
    const third = commit(second, entries("runway", "bridge", "ramp"), "adding a ramp");
    expect(idsOf(undo(third).present.placed)).toEqual(["runway", "bridge"]);
    expect(idsOf(undo(undo(third)).present.placed)).toEqual(["runway"]);
    expect(idsOf(redo(undo(third)).present.placed)).toEqual([
      "runway",
      "bridge",
      "ramp",
    ]);
  });

  it("names the step so the button can say what it undoes", () => {
    const timeline = commit(
      startTimeline([], "open the editor"),
      entries("bridge"),
      "adding Narrow Bridge",
    );
    expect(timeline.present.label).toBe("adding Narrow Bridge");
    expect(undo(timeline).present.label).toBe("open the editor");
    expect(undo(timeline).future[0]?.label).toBe("adding Narrow Bridge");
  });

  it("returns the same timeline when there is nothing to do", () => {
    const timeline = startTimeline(entries("runway"), "open the editor");
    expect(undo(timeline)).toBe(timeline);
    expect(redo(timeline)).toBe(timeline);
  });

  it("drops the redo trail once a new edit lands", () => {
    const timeline = commit(
      startTimeline([], "open the editor"),
      entries("bridge"),
      "adding a bridge",
    );
    const rewound = undo(timeline);
    const diverged = commit(rewound, entries("ramp"), "adding a ramp");
    expect(diverged.future).toEqual([]);
    expect(redo(diverged)).toBe(diverged);
  });

  it("keeps history bounded", () => {
    let timeline = startTimeline([], "open the editor");
    for (let step = 0; step < 120; step += 1)
      timeline = commit(timeline, entries("runway"), `edit ${step}`);
    expect(timeline.past.length).toBeLessThanOrEqual(40);
    expect(timeline.present.label).toBe("edit 119");
  });
});

describe("starting points", () => {
  it("offers only courses the game would accept", () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const preset of PRESETS) {
      expect(preset.ids.length).toBeGreaterThan(0);
      expect(preset.ids.length).toBeLessThanOrEqual(MAX_MIDDLE_SEGMENTS);
      expect(isPlayableTrack(["start", ...preset.ids, "finish"])).toBe(true);
    }
  });

  it("builds them from the catalogue rather than from a hand-written list", () => {
    const catalogue = new Set(EDITABLE_SEGMENTS.map((segment) => segment.id));
    for (const preset of PRESETS)
      for (const id of preset.ids) expect(catalogue.has(id)).toBe(true);
  });

  it("refuses a candidate that would break the course", () => {
    withSegments([voidSegment("test_void", 5)], () => {
      const runway = EDITABLE_SEGMENTS.find((segment) => segment.id === "runway");
      expect(runway).toBeDefined();
      const built = assemble([
        voidSegment("test_void", 5),
        ...(runway ? [runway] : []),
      ]);
      expect(built).toEqual(["runway"]);
      expect(isPlayableTrack(["start", ...built, "finish"])).toBe(true);
    });
  });

  it("never assembles more than the course can hold", () => {
    const runway = EDITABLE_SEGMENTS.find((segment) => segment.id === "runway");
    expect(runway).toBeDefined();
    if (!runway) return;
    const built = assemble(Array<TrackSegment>(30).fill(runway));
    expect(built.length).toBe(MAX_MIDDLE_SEGMENTS);
    expect(isPlayableTrack(["start", ...built, "finish"])).toBe(true);
  });
});

describe("the palette reads the catalogue", () => {
  it("files every editable segment into exactly one difficulty tier", () => {
    const tiers = difficultyTiers(EDITABLE_SEGMENTS);
    const listed = tiers.flatMap((tier) => tier.segments.map((s) => s.id));
    expect(listed.slice().sort()).toEqual(
      EDITABLE_SEGMENTS.map((segment) => segment.id)
        .slice()
        .sort(),
    );
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("orders the tiers from gentlest to worst", () => {
    const tiers = difficultyTiers(EDITABLE_SEGMENTS);
    expect(tiers.map((tier) => tier.difficulty)).toEqual(
      tiers.map((tier) => tier.difficulty).slice().sort((a, b) => a - b),
    );
    for (const tier of tiers)
      for (const segment of tier.segments)
        expect(segment.difficulty).toBe(tier.difficulty);
  });

  it("picks up a segment the moment the catalogue has one", () => {
    // difficultyTiers reads whatever it is handed, which is how a segment added
    // to TRACK_SEGMENTS reaches the palette without this file changing.
    const invented = slab("test_new", 6);
    const tiers = difficultyTiers([...EDITABLE_SEGMENTS, invented]);
    expect(tiers.flatMap((tier) => tier.segments)).toContain(invented);
  });
});

describe("the saved draft", () => {
  function fakeStorage(seed?: string) {
    const cells = new Map<string, string>();
    if (seed !== undefined) cells.set("miw.track-editor.draft.v1", seed);
    return {
      cells,
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => void cells.set(key, value),
    };
  }

  it("survives a round trip", () => {
    const storage = fakeStorage();
    writeDraft(storage, ["runway", "bridge"]);
    expect(readDraft(storage)).toEqual(["runway", "bridge"]);
  });

  it("refuses anything the editor could not place", () => {
    expect(readDraft(fakeStorage("not json"))).toBeNull();
    expect(readDraft(fakeStorage('{"runway":1}'))).toBeNull();
    expect(readDraft(fakeStorage("[]"))).toBeNull();
    expect(readDraft(fakeStorage('["start","finish"]'))).toBeNull();
    expect(readDraft(fakeStorage('["runway",7,"nope"]'))).toEqual(["runway"]);
    expect(
      readDraft(fakeStorage(JSON.stringify(Array<string>(40).fill("runway"))))
        ?.length,
    ).toBe(MAX_MIDDLE_SEGMENTS);
  });

  it("opens the editor anyway when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readDraft(blocked)).toBeNull();
    expect(() => writeDraft(blocked, ["runway"])).not.toThrow();
    expect(readDraft(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The convention seam.
//
// Two list shapes meet in this editor and they are not the same shape.
// NAMED_TRACKS.segmentIds are WHOLE courses, pinned start and finish included.
// Preset.ids are MIDDLES, with both ends stripped. Nothing in either type says
// which it is, so passing one where the other is expected type-checks, renders,
// and produces a course carrying two landing pads that only comes apart at the
// seam between them. These pin the convention so that swap fails here instead.
// ---------------------------------------------------------------------------
describe("whole courses and middles are not interchangeable", () => {
  it("strips the pinned ends off a whole course and leaves a middle alone", () => {
    for (const map of NAMED_TRACKS) {
      const middle = middleOf(map.segmentIds);
      expect(middle, `${map.id} kept a pinned end`).not.toContain("start");
      expect(middle, `${map.id} kept a pinned end`).not.toContain("finish");
      // Idempotent, which is the property that makes it safe on either shape.
      expect(middleOf(middle)).toEqual(middle);
    }
    // A middle passes through untouched.
    const middle = PRESETS[0]!.ids;
    expect(middleOf(middle)).toEqual(middle);
  });

  it("rebuilds each named map exactly from the middle the editor loads", () => {
    // The real claim behind offering maps as starting points: loading one and
    // touching nothing gives you back that map, not an approximation of it.
    for (const map of NAMED_TRACKS) {
      const rebuilt = ["start", ...middleOf(map.segmentIds), "finish"];
      expect(rebuilt, `${map.id} does not survive a round trip`).toEqual([
        ...map.segmentIds,
      ]);
    }
  });

  it("offers every named map as a starting point the game would accept", () => {
    expect(MAP_PRESETS.length).toBe(NAMED_TRACKS.length);
    for (const preset of MAP_PRESETS) {
      expect(preset.ids.length).toBeLessThanOrEqual(MAX_MIDDLE_SEGMENTS);
      // The editor's own gate, not a second opinion about it.
      expect(
        isPlayableTrack(["start", ...preset.ids, "finish"]),
        `${preset.id} would seed the editor with a course the game refuses`,
      ).toBe(true);
    }
    // Ids cannot collide with the derived presets, which share the list slot.
    const ids = [...PRESETS, ...MAP_PRESETS].map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Saved courses.
//
// The migration is the part that matters. Before this existed there was one
// course under miw.track-editor.draft.v1, and somebody has one under it right
// now. "My course disappeared when the update landed" is the one outcome a save
// feature cannot survive having, so it is pinned rather than trusted.
// ---------------------------------------------------------------------------
describe("saved courses", () => {
  const fakeStorage = (cells: Map<string, string>) => ({
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => void cells.set(key, value),
  });

  it("carries an old single draft into both the draft and a save", () => {
    const cells = new Map([
      ["miw.track-editor.draft.v1", JSON.stringify(["runway", "bridge"])],
    ]);
    const store = readStore(fakeStorage(cells));
    // Reopening the editor still lands where the player left off.
    expect(store.draft).toEqual(["runway", "bridge"]);
    // And the course is recoverable after they load something else over it.
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]!.name).toBe("Your last course");
    expect(store.saves[0]!.ids).toEqual(["runway", "bridge"]);
  });

  it("stops migrating once the new key exists, so a delete is not undone", () => {
    // The old key is deliberately never cleared - clearing somebody's data is
    // not this feature's business - so migrating again after they deleted the
    // carried-over save would resurrect it every time they opened the editor.
    const cells = new Map([
      ["miw.track-editor.draft.v1", JSON.stringify(["runway", "bridge"])],
      ["miw.track-editor.saves.v1", JSON.stringify({ draft: ["stones"], saves: [] })],
    ]);
    const store = readStore(fakeStorage(cells));
    expect(store.draft).toEqual(["stones"]);
    expect(store.saves).toEqual([]);
  });

  it("survives every shape a stored value can arrive in", () => {
    const of = (raw: string) =>
      readStore(fakeStorage(new Map([["miw.track-editor.saves.v1", raw]])));
    expect(of("not json").saves).toEqual([]);
    expect(of("[]").saves).toEqual([]);
    expect(of('{"saves":"nope"}').saves).toEqual([]);
    // Entries missing a name or a course are dropped rather than rendered blank.
    expect(of('{"saves":[{"name":"","ids":["runway"]},{"name":"a","ids":[]}]}').saves).toEqual([]);
    // Pinned ends inside a stored course are stripped by the same middleOf.
    expect(
      of('{"saves":[{"name":"a","ids":["start","runway","finish"]}]}').saves[0]!.ids,
    ).toEqual(["runway"]);
    expect(readStore(null)).toEqual({ draft: [], saves: [] });
  });

  it("replaces a course saved under a name it already has", () => {
    let store = saveCourse({ draft: [], saves: [] }, "Mine", ["runway"], 1);
    store = saveCourse(store, "Mine", ["bridge", "stones"], 2);
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]!.ids).toEqual(["bridge", "stones"]);
    expect(store.saves[0]!.savedAt).toBe(2);
  });

  it("refuses a nameless or empty save and drops the oldest at the cap", () => {
    const start = { draft: [], saves: [] };
    expect(saveCourse(start, "   ", ["runway"], 1)).toBe(start);
    expect(saveCourse(start, "Mine", [], 1)).toBe(start);
    // Whole courses are accepted and normalised, never stored with their ends.
    expect(saveCourse(start, "Mine", ["start", "runway", "finish"], 1).saves[0]!.ids)
      .toEqual(["runway"]);

    let store = start as ReturnType<typeof saveCourse>;
    for (let index = 0; index < MAX_SAVED_COURSES + 3; index += 1)
      store = saveCourse(store, `Course ${index}`, ["runway"], index);
    expect(store.saves).toHaveLength(MAX_SAVED_COURSES);
    // Newest first, so the cap drops the oldest rather than the latest save.
    expect(store.saves[0]!.name).toBe(`Course ${MAX_SAVED_COURSES + 2}`);
  });

  it("deletes by name and leaves the rest alone", () => {
    let store = saveCourse({ draft: [], saves: [] }, "Keep", ["runway"], 1);
    store = saveCourse(store, "Drop", ["bridge"], 2);
    const after = deleteCourse(store, "Drop");
    expect(after.saves.map((save) => save.name)).toEqual(["Keep"]);
    expect(deleteCourse(after, "Missing").saves).toHaveLength(1);
  });

  it("reports a refused write rather than pretending it stuck", () => {
    // Safari in private mode throws on setItem. The editor keeps the save for
    // the session and says so; what it must never do is claim it persisted.
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(writeStore(blocked, { draft: [], saves: [] })).toBe(false);
    expect(writeStore(null, { draft: [], saves: [] })).toBe(false);
    expect(readStore(blocked)).toEqual({ draft: [], saves: [] });
    const cells = new Map<string, string>();
    expect(writeStore(fakeStorage(cells), { draft: ["runway"], saves: [] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The plan-view band.
//
// The profile plots height against distance and collapses X, so a course that
// swings wide draws exactly like one running dead straight. These pin the
// measurement behind the band that shows the difference.
//
// The first version of this read laneWalk and was WRONG: only four of the
// thirty-five segments carry a non-zero exit, so the lane between segments is
// zero on every named map and the band was a flat line. The pieces know where
// they actually are, because a segment wanders within itself and comes home at
// its seam.
// ---------------------------------------------------------------------------
describe("how wide the course runs", () => {
  it("measures the pieces, not the lane between segments", () => {
    const wandering = buildTrack(["start", "zigzag", "gap", "pillars", "zigzag", "finish"]);
    const straight = buildTrack(["start", "runway", "finish"]);
    expect(widestDrift(straight)).toBe(0);
    expect(widestDrift(wandering)).toBeGreaterThan(1);
    // laneWalk would have reported both as zero, which is the bug this replaced.
    expect(laneAfter(["start", "zigzag", "gap", "pillars", "zigzag", "finish"])[0]).toBe(0);
  });

  it("measures where platforms are, not how wide they are", () => {
    // Deliberately centres, not footprints. The pinned start pad is 8 units
    // across and centred on the line, so a footprint measure reads 4.0 on EVERY
    // course including a dead straight one, and stops telling anybody anything.
    const straight = buildTrack(["start", "runway", "finish"]);
    expect(widestDrift(straight)).toBe(0);
    expect(planSpan(straight)).toBeGreaterThanOrEqual(4);
  });

  it("keeps every named map's platforms inside the lane envelope", () => {
    for (const map of NAMED_TRACKS)
      expect(
        widestDrift(buildTrack(map.segmentIds)),
        `${map.id} places a platform outside the lane envelope`,
      ).toBeLessThanOrEqual(LANE_X_LIMIT);
  });

  it("survives an empty course rather than drawing half a band", () => {
    expect(widestDrift({ pieces: [], zones: [], length: 0 } as never)).toBe(0);
    // The band still has guides to draw, so its span floors at the envelope.
    expect(planSpan({ pieces: [], zones: [], length: 0 } as never)).toBe(LANE_X_LIMIT);
  });
});
