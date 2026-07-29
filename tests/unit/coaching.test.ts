import { readFileSync } from "node:fs";
// @ts-expect-error jsdom is a dev dependency of the test runner and ships no
// types here. The two pieces this file uses are typed as TestDom below rather
// than by adding @types/jsdom for one test.
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CoachHint,
  DeathNote,
  RunProgressNote,
  TrapDetailsRow,
  TrapInspector,
} from "@/components/hud/Coach";
import { ControlsReference, FirstRunTour } from "@/components/hud/Onboarding";
import { contrastRatio } from "@/lib/game/avatar";
import {
  COACH_STORAGE_KEY,
  HINT_MAX_SHOWS,
  MAX_RECENT_ENDINGS,
  REPEAT_DEATHS,
  SAME_SPOT_BAND,
  applyRunEnd,
  applyTrapPlaced,
  chooseHint,
  defaultMemory,
  getCoachMemory,
  getServerCoachMemory,
  hydrateCoachMemory,
  loadMemory,
  markJumped,
  markToured,
  noteHintShown,
  recordRunEnd,
  recordTrapPlaced,
  resetCoachMemory,
  saveMemory,
  silenceHint,
  storageAvailable,
  subscribeCoachMemory,
  trapProfile,
  updateCoachMemory,
  type CoachMemory,
  type HintId,
  type RunEnding,
} from "@/lib/game/coaching";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapType } from "@/lib/game/types";

/**
 * Node has no localStorage, so the default state of every test here is the pair
 * that breaks in production and never in development: server rendering, and a
 * browser that refuses storage outright. The tour and the hints have to survive
 * both, because the alternative is a game that will not render for anyone
 * running it in a private window.
 */
function memoryStorage(options: { failWrites?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (options.failWrites) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
  };
}

function install(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value,
  });
}

function uninstall(): void {
  Reflect.deleteProperty(globalThis, "localStorage");
}

/** A memory that has finished the tour, which is the only state hints fire in. */
function taught(patch: Partial<CoachMemory> = {}): CoachMemory {
  return { ...defaultMemory(), toured: true, moved: true, jumped: true, ...patch };
}

function death(progress: number, cause: TrapType | null): RunEnding {
  return { outcome: "fell", progress, cause };
}

function endMany(memory: CoachMemory, endings: readonly RunEnding[]): CoachMemory {
  return endings.reduce(applyRunEnd, memory);
}

beforeEach(() => {
  uninstall();
  resetCoachMemory();
});

afterEach(() => {
  uninstall();
  resetCoachMemory();
});

describe("storage is optional", () => {
  it("reads defaults and reports itself unusable when there is no storage at all", () => {
    expect(storageAvailable()).toBe(false);
    expect(loadMemory()).toEqual(defaultMemory());
    expect(saveMemory(defaultMemory())).toBe(false);
  });

  it("reports itself unusable when writes throw, which is Safari's private mode", () => {
    install(memoryStorage({ failWrites: true }));
    // Reading works there, so nothing short of the probe write tells the truth.
    expect(storageAvailable()).toBe(false);
    expect(saveMemory(taught())).toBe(false);
    expect(loadMemory()).toEqual(defaultMemory());
  });

  it("keeps the session working when storage refuses every write", () => {
    install(memoryStorage({ failWrites: true }));
    hydrateCoachMemory();
    recordRunEnd({ outcome: "fell", progress: 0.4, cause: "floor_fan" });
    recordTrapPlaced("soap_slick");
    // The live copy is the source of truth for the session, so a tour that was
    // finished stays finished and a dismissed hint stays dismissed even though
    // nothing reached the disk.
    expect(getCoachMemory().runs).toBe(1);
    expect(getCoachMemory().deaths.floor_fan).toBe(1);
    expect(getCoachMemory().placed.soap_slick).toBe(1);
  });

  it("round-trips through storage that works", () => {
    install(memoryStorage());
    const memory = applyRunEnd(taught(), death(0.5, "swinging_hammer"));
    expect(saveMemory(memory)).toBe(true);
    expect(loadMemory()).toEqual(memory);
  });

  it("survives stored values that are not a memory", () => {
    const store = memoryStorage();
    install(store);
    for (const raw of ["", "null", "[]", "{", '{"version":2}', '"toured"']) {
      store.setItem(COACH_STORAGE_KEY, raw);
      expect(loadMemory()).toEqual(defaultMemory());
    }
  });

  it("drops fields it does not recognise rather than the whole memory", () => {
    const store = memoryStorage();
    install(store);
    store.setItem(
      COACH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        toured: true,
        jumped: "yes",
        runs: -4,
        placed: { soap_slick: 2, not_a_trap: 9 },
        deaths: { floor_fan: 3 },
        silenced: ["repeat-trap", "made-up-hint"],
        shows: { "same-spot": 1, nonsense: 4 },
        recent: [
          { outcome: "fell", progress: 4, cause: "floor_fan" },
          { outcome: "exploded", progress: 0.2, cause: null },
          { outcome: "reset", progress: 0.3, cause: "not_a_trap" },
        ],
      }),
    );
    const memory = loadMemory();
    expect(memory.toured).toBe(true);
    expect(memory.jumped).toBe(false);
    expect(memory.runs).toBe(0);
    expect(memory.placed).toEqual({ soap_slick: 2 });
    expect(memory.deaths).toEqual({ floor_fan: 3 });
    expect(memory.silenced).toEqual(["repeat-trap"]);
    expect(memory.shows).toEqual({ "same-spot": 1 });
    expect(memory.recent).toEqual([
      { outcome: "fell", progress: 1, cause: "floor_fan" },
      { outcome: "reset", progress: 0.3, cause: null },
    ]);
  });

  it("hands useSyncExternalStore the same server snapshot every time", () => {
    expect(getServerCoachMemory()).toBe(getServerCoachMemory());
    expect(getCoachMemory()).toBe(getServerCoachMemory());
  });

  it("notifies subscribers when the memory changes", () => {
    let calls = 0;
    const stop = subscribeCoachMemory(() => {
      calls += 1;
    });
    recordRunEnd({ outcome: "completed", progress: 1, cause: null });
    expect(calls).toBe(1);
    stop();
    recordRunEnd({ outcome: "completed", progress: 1, cause: null });
    expect(calls).toBe(1);
  });
});

describe("what a run teaches the memory", () => {
  it("blames nobody for a reset or a clear", () => {
    const reset = applyRunEnd(taught(), {
      outcome: "reset",
      progress: 0.3,
      cause: "floor_fan",
    });
    expect(reset.deaths).toEqual({});
    expect(reset.usedReset).toBe(true);
    expect(reset.recent[0]?.cause).toBeNull();

    const clear = applyRunEnd(taught(), {
      outcome: "completed",
      progress: 1,
      cause: "floor_fan",
    });
    expect(clear.deaths).toEqual({});
    expect(clear.usedReset).toBe(false);
  });

  it("tallies the trap that ended the run", () => {
    const memory = endMany(taught(), [
      death(0.2, "floor_fan"),
      death(0.3, "floor_fan"),
      death(0.4, "soap_slick"),
    ]);
    expect(memory.deaths).toEqual({ floor_fan: 2, soap_slick: 1 });
    expect(memory.runs).toBe(3);
  });

  it("clamps a progress the timer could not have produced", () => {
    const memory = endMany(taught(), [
      death(Number.NaN, null),
      death(-2, null),
      death(9, null),
    ]);
    expect(memory.recent.map((entry) => entry.progress)).toEqual([0, 0, 1]);
  });

  it("keeps only the last few endings", () => {
    const memory = endMany(
      taught(),
      Array.from({ length: MAX_RECENT_ENDINGS + 4 }, (_, index) =>
        death(index / 100, null),
      ),
    );
    expect(memory.recent).toHaveLength(MAX_RECENT_ENDINGS);
    expect(memory.recent.at(-1)?.progress).toBeCloseTo(
      (MAX_RECENT_ENDINGS + 3) / 100,
    );
  });

  it("counts the traps the player has added", () => {
    const memory = applyTrapPlaced(applyTrapPlaced(taught(), "mousetrap"), "mousetrap");
    expect(memory.placed.mousetrap).toBe(2);
  });
});

describe("the game stays quiet unless it has a reason", () => {
  it("says nothing at all while the tour is unfinished", () => {
    const learning = endMany(
      { ...defaultMemory(), toured: false },
      [death(0.4, "floor_fan"), death(0.4, "floor_fan"), death(0.4, "floor_fan")],
    );
    expect(chooseHint(learning)).toBeNull();
  });

  it("says nothing to a player who is doing fine", () => {
    const fine = endMany(taught(), [
      { outcome: "completed", progress: 1, cause: null },
      { outcome: "completed", progress: 1, cause: null },
      { outcome: "reset", progress: 0.2, cause: null },
      death(0.9, "floor_fan"),
    ]);
    expect(chooseHint(fine)).toBeNull();
  });

  it("names the jump only after three runs without one, and never again after one", () => {
    const two = endMany(taught({ jumped: false }), [
      death(0.2, null),
      death(0.3, null),
    ]);
    expect(chooseHint(two)).toBeNull();

    const three = applyRunEnd(two, death(0.25, null));
    expect(chooseHint(three)?.id).toBe("never-jumped");
    expect(chooseHint(markJumped(three))?.id).not.toBe("never-jumped");
  });

  it("names a trap only once it has taken three runs running", () => {
    const twice = endMany(taught(), [
      death(0.2, "angry_vacuum"),
      death(0.5, "angry_vacuum"),
    ]);
    expect(chooseHint(twice)?.id).not.toBe("repeat-trap");

    const thrice = applyRunEnd(twice, death(0.8, "angry_vacuum"));
    const hint = chooseHint(thrice);
    expect(hint?.id).toBe("repeat-trap");
    expect(hint?.trap).toBe("angry_vacuum");
    expect(hint?.title).toContain(TRAP_CATALOG.angry_vacuum.displayName);

    // A run ended by something else breaks the streak, which is the point:
    // three different traps is not a pattern worth a card.
    const mixed = endMany(taught(), [
      death(0.2, "angry_vacuum"),
      death(0.5, "soap_slick"),
      death(0.8, "angry_vacuum"),
    ]);
    expect(chooseHint(mixed)?.id).not.toBe("repeat-trap");
  });

  it("counts only deaths towards a pattern, never resets", () => {
    const withResets = endMany(taught(), [
      death(0.4, "banana_peel"),
      { outcome: "reset", progress: 0.1, cause: null },
      death(0.4, "banana_peel"),
      { outcome: "reset", progress: 0.1, cause: null },
      death(0.4, "banana_peel"),
    ]);
    expect(chooseHint(withResets)?.id).toBe("repeat-trap");
  });

  it("names the spot when three runs end inside the band, and not outside it", () => {
    const tight = endMany(taught(), [
      death(0.4, "soap_slick"),
      death(0.4 + SAME_SPOT_BAND * 0.75, "floor_fan"),
      death(0.42, "mousetrap"),
    ]);
    const hint = chooseHint(tight);
    expect(hint?.id).toBe("same-spot");
    expect(hint?.title).toContain("%");

    const spread = endMany(taught(), [
      death(0.1, "soap_slick"),
      death(0.5, "floor_fan"),
      death(0.9, "mousetrap"),
    ]);
    expect(chooseHint(spread)).toBeNull();
  });

  it("offers the reset only to a player who has never used it", () => {
    const never = endMany(taught(), [
      death(0.1, "soap_slick"),
      death(0.9, "floor_fan"),
      { outcome: "completed", progress: 1, cause: null },
      { outcome: "completed", progress: 1, cause: null },
    ]);
    expect(chooseHint(never)?.id).toBe("never-reset");

    const used = applyRunEnd(never, { outcome: "reset", progress: 0.2, cause: null });
    expect(chooseHint(used)).toBeNull();
  });

  it("keeps quiet once a hint has been dismissed", () => {
    const thrice = endMany(taught(), [
      death(0.2, "angry_vacuum"),
      death(0.5, "angry_vacuum"),
      death(0.8, "angry_vacuum"),
    ]);
    const first = chooseHint(thrice);
    expect(first).not.toBeNull();
    const quiet = silenceHint(thrice, first!.id);
    expect(chooseHint(quiet)?.id).not.toBe(first!.id);
  });

  it("silences itself after two showings even if nobody dismisses it", () => {
    let memory = endMany(taught({ jumped: false }), [
      death(0.2, null),
      death(0.3, null),
      death(0.4, null),
    ]);
    for (let show = 0; show < HINT_MAX_SHOWS; show += 1) {
      const hint = chooseHint(memory);
      expect(hint?.id).toBe("never-jumped");
      // A showing is counted when the card goes away, and the next chance to
      // say anything is after another run.
      memory = applyRunEnd(noteHintShown(memory, hint!.id), death(0.3, null));
    }
    expect(chooseHint(memory)?.id).not.toBe("never-jumped");
    expect(memory.jumped).toBe(false);
  });

  it("says at most one thing between two runs", () => {
    // A player can trip two rules at once. Dismissing the first must not
    // uncover the second on the same screen, which is what the run stamp is for.
    const both = endMany(taught(), [
      death(0.4, "cord_trip"),
      death(0.4, "cord_trip"),
      death(0.4, "cord_trip"),
      { outcome: "completed", progress: 1, cause: null },
    ]);
    const first = chooseHint(both);
    expect(first?.id).toBe("repeat-trap");
    const after = silenceHint(noteHintShown(both, first!.id), first!.id);
    expect(chooseHint(after)).toBeNull();
    // The next run reopens the door, and the rule that was waiting gets its turn.
    expect(chooseHint(applyRunEnd(after, death(0.2, "soap_slick")))?.id).toBe(
      "never-reset",
    );
  });

  it("can be silenced completely, whichever rules a player trips", () => {
    // The anti-nag guarantee, stated as an invariant rather than per rule: a
    // player who dismisses everything the game offers is never offered anything
    // again, whatever they go on to do.
    const ids: readonly HintId[] = [
      "never-jumped",
      "repeat-trap",
      "same-spot",
      "never-reset",
    ];
    let memory = ids.reduce(silenceHint, taught({ jumped: false }));
    memory = endMany(memory, [
      death(0.4, "floor_fan"),
      death(0.4, "floor_fan"),
      death(0.41, "floor_fan"),
      death(0.4, "floor_fan"),
    ]);
    expect(chooseHint(memory)).toBeNull();
  });

  it("hands back a body and a title on every rule it can fire", () => {
    const fired = new Set<HintId>();
    const cases: readonly CoachMemory[] = [
      endMany(taught({ jumped: false }), [
        death(0.2, null),
        death(0.3, null),
        death(0.4, null),
      ]),
      endMany(taught(), [
        death(0.2, "angry_vacuum"),
        death(0.5, "angry_vacuum"),
        death(0.8, "angry_vacuum"),
      ]),
      endMany(taught(), [
        death(0.4, "soap_slick"),
        death(0.43, "floor_fan"),
        death(0.42, "mousetrap"),
      ]),
      endMany(taught(), [
        death(0.1, "soap_slick"),
        death(0.9, "floor_fan"),
        { outcome: "completed", progress: 1, cause: null },
        { outcome: "completed", progress: 1, cause: null },
      ]),
    ];
    for (const memory of cases) {
      const hint = chooseHint(memory);
      expect(hint).not.toBeNull();
      expect(hint!.title.length).toBeGreaterThan(8);
      expect(hint!.body.length).toBeGreaterThan(20);
      fired.add(hint!.id);
    }
    expect(fired.size).toBe(4);
  });

  it("needs exactly three deaths for a pattern, which is what the constant says", () => {
    expect(REPEAT_DEATHS).toBe(3);
    const two = endMany(taught(), [death(0.4, "rug_pull"), death(0.4, "rug_pull")]);
    expect(chooseHint(two)).toBeNull();
  });
});

describe("what the game can honestly say about a trap", () => {
  it("describes every trap in the roster", () => {
    for (const type of TRAP_TYPES) {
      const profile = trapProfile(type);
      expect(profile.displayName).toBe(TRAP_CATALOG[type].displayName);
      expect(profile.method.length).toBeGreaterThan(20);
      expect(profile.rosterSize).toBe(TRAP_TYPES.length);
      expect(profile.outHits).toBeGreaterThanOrEqual(0);
      expect(profile.outHits).toBeLessThanOrEqual(TRAP_TYPES.length - 1);
      expect(profile.dangerFill).toBeGreaterThan(0);
      expect(profile.dangerFill).toBeLessThanOrEqual(1);
      expect(profile.floorMetres).toBeCloseTo(TRAP_CATALOG[type].placementRadius * 2);
      expect(profile.runnerWidths).toBeGreaterThan(1);
    }
  });

  it("ranks on the same measured weight the reward screen scores with", () => {
    const heaviest = TRAP_TYPES.reduce((best, type) =>
      TRAP_CATALOG[type].riskWeight > TRAP_CATALOG[best].riskWeight ? type : best,
    );
    const lightest = TRAP_TYPES.reduce((worst, type) =>
      TRAP_CATALOG[type].riskWeight < TRAP_CATALOG[worst].riskWeight ? type : worst,
    );
    expect(trapProfile(heaviest).outHits).toBe(TRAP_TYPES.length - 1);
    expect(trapProfile(heaviest).dangerFill).toBe(1);
    expect(trapProfile(lightest).outHits).toBe(0);
  });
});

describe("the teaching layer's colours", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("The teaching layer."));
  const INK = "#171a2b";
  const CREAM = "#fff8e8";
  const WHITE = "#ffffff";
  const SECONDARY = "#c8cada";
  const ACCENT = "#b3123c";
  const YELLOW = "#ffd84d";
  const GREEN = "#57dfa1";
  const MUTED = "#5c6274";

  /** An alpha layer resolved against what is behind it, for the bar's track. */
  const over = (fg: string, bg: string, alpha: number): string => {
    const channels = (hex: string) =>
      [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const front = channels(fg);
    const back = channels(bg);
    return `#${[0, 1, 2]
      .map((index) =>
        Math.round(front[index]! * alpha + back[index]! * (1 - alpha))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };

  it("clears 4.5:1 on every piece of body text it draws", () => {
    const body: readonly [string, string, string][] = [
      ["cream body on the ink card", CREAM, INK],
      ["secondary text on the ink card", SECONDARY, INK],
      ["ink body on a cream panel", INK, CREAM],
      ["muted notes on a cream panel", MUTED, CREAM],
      ["the dialog kicker on a cream panel", ACCENT, CREAM],
      ["ink on a key cap", INK, WHITE],
      ["ink on the details buttons", INK, WHITE],
    ];
    for (const [what, front, back] of body)
      expect(contrastRatio(front, back), what).toBeGreaterThanOrEqual(4.5);
  });

  it("clears 3:1 on the large text and on the graphics that mean something", () => {
    const large: readonly [string, string, string][] = [
      ["the card kicker", YELLOW, INK],
      ["a ticked step", GREEN, INK],
      ["the danger bar against the panel", ACCENT, CREAM],
      ["the danger bar against its own track", ACCENT, over(INK, CREAM, 0.14)],
      // The reach bar on the failure card reuses the danger bar's pairing
      // exactly, so it is measured here rather than assumed to inherit.
      ["the reach bar against its own track", ACCENT, over(INK, CREAM, 0.14)],
      ["the bar's outline", INK, CREAM],
    ];
    for (const [what, front, back] of large)
      expect(contrastRatio(front, back), what).toBeGreaterThanOrEqual(3);
  });

  it("uses the colours those numbers were measured on", () => {
    // The ratios above are worth nothing if the stylesheet moved on without
    // them, so the literals are checked against the block itself.
    for (const colour of [SECONDARY, ACCENT])
      expect(block).toContain(colour);
    expect(block).toContain("var(--yellow)");
    expect(block).toContain("var(--green)");
    expect(block).toContain("var(--muted)");
    // --red-text is 4.52:1 on cream, a hair over the bar with nothing spare.
    // The accent above was chosen instead and this keeps it that way.
    expect(block).not.toContain("var(--red-text)");
  });

  it("gates its one animation on both reduced-motion signals", () => {
    expect(block).toContain('reduced-motion="true"');
    expect(block).toMatch(/animation:none/);
    // Every animated rule has to rest on the element's own resting state, so
    // the OS media query, which lands on the last keyframe, and the in-app flag,
    // which deletes the animation, produce the same static frame.
    expect(block).toContain("transform:translate(-50%,0)}");
  });

  it("never lets a floating card swallow a tap meant for the game", () => {
    expect(block).toContain("pointer-events:none");
    expect(block).toContain(
      ".onboard-card button,.coach-card button{pointer-events:auto}",
    );
  });
});

/**
 * Rendered on the server, with no localStorage anywhere, because that is the
 * arrangement a bare module-scope storage reference breaks and a browser never
 * reproduces. Nothing here mounts an effect, so what these assert is the frame a
 * Next server sends and the first frame the client has to agree with.
 */
describe("what the teaching layer renders before any browser is involved", () => {
  it("teaches the loop on the intro of a first run", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunTour, { phase: "intro" }),
    );
    expect(html).toContain("HOW THIS WORKS");
    expect(html).toContain("Beat this level.");
    expect(html).toContain("Add one awful thing to it.");
    expect(html).toContain("Skip all tips");
  });

  it("names the keys on the intro, where the attempt clock is not running yet", () => {
    // The checklist that phase "playing" renders is the only other place the
    // keys are named, and it renders while the 60s attempt clock counts down;
    // a measured first attempt spent 24 of its 60 seconds being read. So the
    // keys have to be reachable BEFORE the run, and this is what stops them
    // drifting back onto the clock.
    const html = renderToStaticMarkup(
      createElement(FirstRunTour, { phase: "intro" }),
    );
    for (const key of ["W", "A", "S", "D", "Space"])
      expect(html, `intro does not name ${key}`).toContain(
        `<kbd class="onboard-key">${key}</kbd>`,
      );
  });

  it("ticks the controls off against the run rather than describing them", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunTour, { phase: "playing" }),
    );
    expect(html).toContain("Move with W A S D or the arrow keys");
    expect(html).toContain("Jump with Space");
    expect(html).toContain("Reach the green door at the far end");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).toContain("To do.");
  });

  it("stays out of the way once the host says something else owns the screen", () => {
    expect(
      renderToStaticMarkup(
        createElement(FirstRunTour, { phase: "intro", suppressed: true }),
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(createElement(FirstRunTour, { phase: "sharing" })),
    ).toBe("");
  });

  it("offers the controls everywhere except a live run", () => {
    const idle = renderToStaticMarkup(
      createElement(ControlsReference, { phase: "failed" }),
    );
    expect(idle).toContain("onboard-launcher");
    expect(
      renderToStaticMarkup(createElement(ControlsReference, { phase: "playing" })),
    ).toBe("");
  });

  it("says nothing to a player who has not earned a hint", () => {
    expect(
      renderToStaticMarkup(createElement(CoachHint, { phase: "failed" })),
    ).toBe("");
  });

  it("names what got you, and whose it was", () => {
    const html = renderToStaticMarkup(
      createElement(DeathNote, {
        contact: { trapType: "floor_fan", ownerName: "Priya" },
      }),
    );
    expect(html).toContain("WHAT GOT YOU");
    expect(html).toContain("Priya");
    expect(html).toContain(TRAP_CATALOG.floor_fan.displayName);
    expect(html).toContain("What it does");
    expect(
      renderToStaticMarkup(createElement(DeathNote, { contact: null })),
    ).toBe("");
  });

  it("says how far the run got, which no failure screen used to", () => {
    const html = renderToStaticMarkup(
      createElement(RunProgressNote, { percent: 43.4 }),
    );
    expect(html).toContain("HOW FAR YOU GOT");
    expect(html).toContain("43%");
    // The figure is real text and the bar repeats it, so the bar stays out of
    // the accessibility tree rather than announcing the number twice.
    expect(html).toContain('aria-hidden="true"');
    // Rounded before it is divided, so the bar can never disagree with the
    // figure printed beside it.
    expect(html).toContain("--coach-reach:0.43");
  });

  it("never draws a bar the course could not have produced", () => {
    for (const [percent, shown] of [
      [-20, "0%"],
      [0, "0%"],
      [140, "100%"],
      [Number.NaN, "0%"],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(RunProgressNote, { percent }),
      );
      expect(html, `${percent}`).toContain(`>${shown}<`);
    }
  });

  it("gives every offered trap a way to be read before it is picked", () => {
    const traps: readonly TrapType[] = ["floor_fan", "soap_slick", "mousetrap"];
    const html = renderToStaticMarkup(createElement(TrapDetailsRow, { traps }));
    for (const type of traps) {
      // The visible text is the name, so the accessible name has to contain it.
      expect(html).toContain(`What ${TRAP_CATALOG[type].displayName} does`);
      expect(html).toContain(`>${TRAP_CATALOG[type].displayName}<`);
    }
    expect(renderToStaticMarkup(createElement(TrapDetailsRow, { traps: [] }))).toBe(
      "",
    );
  });

  it("puts a trap's reach in facts rather than in a death", () => {
    const html = renderToStaticMarkup(
      createElement(TrapInspector, { type: "angry_vacuum", onClose: () => {} }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("How it reaches you");
    expect(html).toContain("How hard it hits");
    expect(html).toContain("Room it takes");
    expect(html).toContain(
      `${trapProfile("angry_vacuum").floorMetres.toFixed(1)} m`,
    );
  });

  it("documents the reset as the blameless thing the game already treats it as", () => {
    const html = renderToStaticMarkup(
      createElement(ControlsReference, { phase: "intro" }),
    );
    // The launcher is all that renders until it is opened, which is the point:
    // the reference is reachable, not imposed.
    expect(html).toContain("Controls");
    expect(html).not.toContain("RESET");
  });
});

/**
 * The dialogs, driven.
 *
 * A DOM is built here rather than asked for through the environment docblock on
 * purpose: every test above has to run with no DOM at all, because that is the
 * arrangement in which a module-scope `localStorage` or `document` reference
 * takes the Next server render down, and a file that starts in jsdom can never
 * catch it.
 */
describe("the dialogs behave like dialogs", () => {
  /** Only what this file touches, so jsdom needs no type package. */
  interface TestDom {
    readonly window: Window & typeof globalThis & { close(): void };
  }
  let dom: TestDom;
  let host: HTMLDivElement;
  let root: Root;

  const DOM_GLOBALS = [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ] as const;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });
    for (const key of DOM_GLOBALS)
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: (dom.window as unknown as Record<string, unknown>)[key],
      });
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    for (const key of DOM_GLOBALS) Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  });

  const mount = async (node: React.ReactElement): Promise<void> => {
    await act(async () => {
      root.render(node);
    });
  };

  const click = async (node: Element | null | undefined): Promise<void> => {
    await act(async () => {
      (node as HTMLElement | null | undefined)?.click();
    });
  };

  const press = async (init: KeyboardEventInit): Promise<void> => {
    await act(async () => {
      (dom.window.document.activeElement ?? dom.window.document.body).dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
    });
  };

  const buttons = (): readonly HTMLElement[] =>
    Array.from(host.querySelectorAll<HTMLElement>("button"));

  const named = (label: string): HTMLElement | undefined =>
    buttons().find((button) => button.textContent?.includes(label));

  it("opens from the launcher, traps Tab, and hands focus back on close", async () => {
    await mount(createElement(ControlsReference, { phase: "intro" }));
    const launcher = named("Controls");
    expect(launcher).toBeDefined();

    // Focused first, because the case that matters is a keyboard user pressing
    // Enter on the pill: they are the ones stranded if focus does not come back.
    launcher?.focus();
    await click(launcher);
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    // Labelled by its own heading rather than by a string nobody can see.
    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(dialog?.querySelector(`#${labelledBy}`)?.textContent).toBe("Controls");

    // Focus is inside on open, and Tab off the last control comes back to the
    // first rather than escaping to the browser chrome behind the modal.
    const inside = Array.from(dialog!.querySelectorAll<HTMLElement>("button"));
    expect(dom.window.document.activeElement).toBe(inside[0]);
    inside.at(-1)?.focus();
    await press({ key: "Tab" });
    expect(dom.window.document.activeElement).toBe(inside[0]);
    await press({ key: "Tab", shiftKey: true });
    expect(dom.window.document.activeElement).toBe(inside.at(-1));

    await press({ key: "Escape" });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(named("Controls"));
  });

  it("documents the keys a player has no other way of learning", async () => {
    await mount(
      createElement(ControlsReference, { phase: "intro", rotateKeys: true }),
    );
    await click(named("Controls"));
    const text = host.textContent ?? "";
    expect(text).toContain("Grab, then shove");
    expect(text).toContain("Hold E to grab");
    expect(text).toContain("Restart the attempt");
    expect(text).toContain("stamps it RESET rather than blaming you");
    expect(text).toContain("Turn the trap you are placing");
    const caps = Array.from(host.querySelectorAll("kbd")).map(
      (key) => key.textContent,
    );
    expect(caps).toEqual(
      expect.arrayContaining(["W", "Space", "E", "R", "Esc", "M", "Q"]),
    );
  });

  it("claims only the controls the host actually has", async () => {
    await mount(createElement(ControlsReference, { phase: "intro" }));
    await click(named("Controls"));
    const text = host.textContent ?? "";
    expect(text).not.toContain("Turn the trap you are placing");
    expect(text).not.toContain("JUMP and GRAB on the right");
  });

  it("opens a trap's details from the death that taught you the name", async () => {
    await mount(
      createElement(DeathNote, {
        contact: { trapType: "floor_fan", ownerName: "Priya" },
      }),
    );
    await click(named("What it does"));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(TRAP_CATALOG.floor_fan.displayName);
    expect(dialog?.textContent).toContain("How hard it hits");
    await click(named("Close"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ends the tour for good when a player skips it", async () => {
    hydrateCoachMemory();
    await mount(createElement(FirstRunTour, { phase: "intro" }));
    expect(host.textContent).toContain("HOW THIS WORKS");
    await click(named("Skip all tips"));
    expect(host.textContent).toBe("");
    expect(getCoachMemory().toured).toBe(true);
    // And it stays gone on the next phase, and the one after that.
    await mount(createElement(FirstRunTour, { phase: "playing" }));
    expect(host.textContent).toBe("");
  });

  it("shows a hint at most twice and never after it is dismissed", async () => {
    hydrateCoachMemory();
    updateCoachMemory(() =>
      endMany(taught({ jumped: false }), [
        { outcome: "reset", progress: 0.1, cause: null },
        death(0.2, null),
        death(0.35, null),
        death(0.5, null),
      ]),
    );
    await mount(createElement(CoachHint, { phase: "failed" }));
    expect(host.textContent).toContain("Space jumps.");

    await click(named("Got it"));
    expect(host.textContent).toBe("");
    expect(getCoachMemory().silenced).toContain("never-jumped");

    // A further run does not bring it back, which is the whole promise.
    updateCoachMemory((memory) => applyRunEnd(memory, death(0.7, null)));
    await mount(createElement(CoachHint, { phase: "failed" }));
    expect(host.textContent).toBe("");
  });

  it("counts a showing when the card leaves rather than while it is being read", async () => {
    hydrateCoachMemory();
    updateCoachMemory(() =>
      endMany(taught({ jumped: false }), [
        death(0.2, null),
        death(0.35, null),
        death(0.5, null),
      ]),
    );
    await mount(createElement(CoachHint, { phase: "failed" }));
    expect(host.textContent).toContain("Space jumps.");
    // Still on screen, still uncounted: reaching the cap must never delete the
    // card out from under whoever is reading it.
    expect(getCoachMemory().shows["never-jumped"]).toBeUndefined();

    await mount(createElement(CoachHint, { phase: "playing" }));
    expect(host.textContent).toBe("");
    expect(getCoachMemory().shows["never-jumped"]).toBe(1);
  });
});

describe("the memory the tour keeps", () => {
  it("finishes for good once it is skipped", () => {
    const skipped = markToured(defaultMemory());
    expect(skipped.toured).toBe(true);
    expect(markToured(skipped)).toBe(skipped);
    expect(chooseHint(skipped)).toBeNull();
  });

  it("survives a reload", () => {
    install(memoryStorage());
    hydrateCoachMemory();
    recordRunEnd({ outcome: "fell", progress: 0.6, cause: "sticky_gum" });
    resetCoachMemory();
    expect(getCoachMemory().runs).toBe(0);
    hydrateCoachMemory();
    expect(getCoachMemory().runs).toBe(1);
    expect(getCoachMemory().deaths.sticky_gum).toBe(1);
  });
});
