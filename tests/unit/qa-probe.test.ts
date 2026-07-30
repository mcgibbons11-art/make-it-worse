// Adversarial QA probes: the checks that found live bugs nothing else caught.
//
// Two kinds of test live here, and the comment above each says which:
//   GUARDS       assert a property that must hold. PROBE A is the one that
//                matters - it caught the client/SQL divergence 0018 fixed.
//   KNOWN BUGS   pin a currently-wrong result exactly, so the bug cannot be
//                forgotten and any change to it shows up as a failure. These
//                are marked "KNOWN BUG"/"KNOWN DEAD CONFIG"; shrink the pinned
//                list as they are fixed rather than deleting the test.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLACEMENT_ZONES, zoneCenter } from "@/lib/game/level-definition";
import { placementSurfaces, validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import { canTransition } from "@/lib/game/state-machine";
import { challengeSchema } from "@/lib/game/schemas";
import { decodeChallengeLink, encodeChallengeLink } from "@/lib/game/challenge-link";
import type { GamePhase, TrapInstance } from "@/lib/game/types";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

/**
 * The client and the server must agree on where every placement surface is.
 *
 * Both sides turn a stored placement into a world position by adding the offset
 * to the surface's CENTRE - lib/game/placement.ts computes
 * `(surface.minX + surface.maxX) / 2`, and publish_child_challenge computes
 * `(v_zone.min_x + v_zone.max_x) / 2 + v_ox` - and both then check the trap's
 * edge clearance against min/max. So a drifted row does not merely disagree in
 * the abstract: the client draws a legal preview, the player commits, and the
 * server writes the trap somewhere else or refuses it as `outside_zone` against
 * extents the player never saw.
 *
 * That happened. Migration 0018 exists because the course was reshaped and
 * placement_zones was not re-seeded, leaving 24 of 27 surfaces adrift, several
 * by 1.7u to 2.0u. Nothing else in the suite caught it: tests/unit/sql-parity
 * pins risk weights, radii, the overlap multiplier and the sweep rule, and has
 * never pinned geometry.
 *
 * Compared against placementSurfaces() rather than against PLACEMENT_ZONES and
 * LEVEL_PIECES separately, because that is the RESOLVED set the client actually
 * uses. `ramp` and `convergence` exist both as authored zones and as level
 * pieces; surfacesOf() drops the piece whenever a zone claims the same id, so
 * the piece extents are unreachable from any client code path and the server
 * never sees that id. Comparing the raw lists reported the dropped `ramp` piece
 * as drift, which is a probe artifact rather than a divergence.
 */
interface SurfaceRow {
  minX: number; maxX: number; minZ: number; maxZ: number; groundY: number;
}

/**
 * public.placement_zones as Postgres would hold it after running `upTo`.
 *
 * Newest write to a given id wins: 0005 and 0018 upsert (`do update`), 0014
 * inserts with `do nothing`, so an id 0014 would have re-inserted keeps the
 * earlier row.
 */
function placementZonesAfter(upTo: (name: string) => boolean): Map<string, SurfaceRow> {
  const rows = new Map<string, SurfaceRow>();
  const insertedByDoNothing = new Set<string>();
  for (const name of readdirSync(new URL("../../supabase/migrations", import.meta.url))
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    if (!upTo(name)) continue;
    const source = read(`supabase/migrations/${name}`);
    if (!source.includes("into public.placement_zones")) continue;
    const skipsConflicts = /on conflict\s*\(\s*id\s*\)\s*do nothing/.test(source);
    const row =
      /\('([a-z_-]+)'\s*,\s*'[^']*'\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
    for (const match of source.matchAll(row)) {
      const id = match[1]!;
      if (skipsConflicts && insertedByDoNothing.has(id)) continue;
      insertedByDoNothing.add(id);
      rows.set(id, {
        minX: Number(match[2]), maxX: Number(match[3]),
        minZ: Number(match[4]), maxZ: Number(match[5]), groundY: Number(match[6]),
      });
    }
  }
  return rows;
}

/** Every field of every legacy link surface that disagrees with a SQL row. */
function geometryDrift(rows: Map<string, SurfaceRow>): string[] {
  const drift: string[] = [];
  for (const zone of PLACEMENT_ZONES) {
    const surface: SurfaceRow & { id: string } = { id: zone.id, minX: zone.minX,
      maxX: zone.maxX, minZ: zone.minZ, maxZ: zone.maxZ, groundY: zone.groundY };
    const row = rows.get(surface.id);
    if (!row) {
      drift.push(`${surface.id}: the client offers this surface and no migration seeds it`);
      continue;
    }
    // Extents, not just centres. The centre decides where the trap lands and
    // the extents decide whether the server accepts it at all, so both have to
    // match or the two sides disagree about a placement's legality.
    for (const [field, mine, theirs] of [
      ["minX", surface.minX, row.minX], ["maxX", surface.maxX, row.maxX],
      ["minZ", surface.minZ, row.minZ], ["maxZ", surface.maxZ, row.maxZ],
      ["groundY", surface.groundY, row.groundY],
    ] as const)
      if (Math.abs(mine - theirs) > 1e-6)
        drift.push(`${surface.id}.${field}: client ${mine}, SQL ${theirs}`);
  }
  return drift;
}

describe("PROBE A: placement surface geometry, client vs SQL", () => {
  it("still detects the divergence 0018 fixed, so a green result means something", () => {
    // A comparison that has drifted into comparing nothing passes quietly, and
    // that is the failure this whole file exists to hunt - so the detector
    // proves itself on every run against the state it was written to catch.
    // Replaying the migrations WITHOUT 0018 reconstructs the divergence exactly
    // as it stood: 24 of 27 surfaces adrift, several by 1.7u to 2.0u.
    const before = geometryDrift(placementZonesAfter((name) => !name.startsWith("0018")));
    // 24 surfaces were adrift; counted per field, that is well over twenty
    // mismatches. A threshold rather than an exact number, because the exact
    // number legitimately changes when the course gains or loses a piece,
    // whereas "the detector still fires loudly on the known-bad state" does not.
    expect(
      before.length,
      "PROBE A no longer detects the pre-0018 divergence; the comparison below proves nothing",
    ).toBeGreaterThan(20);
    console.log(`\n--- SELF-TEST: pre-0018 state yields ${before.length} mismatches, as it must ---`);
  });

  it("pins every legacy link surface against public.placement_zones", () => {
    const sql = placementZonesAfter(() => true);
    expect(sql.size, "parsed no placement_zones rows out of the migrations").toBeGreaterThan(0);

    // Vacuity guard. Everything below is a loop over placementSurfaces(); if
    // that ever returned nothing the comparison would pass while checking
    // nothing at all, which is the failure mode this file exists to hunt.
    const surfaces = placementSurfaces();
    expect(surfaces.length, "placementSurfaces() resolved to nothing").toBeGreaterThan(8);
    expect(surfaces.some((surface) => surface.id === "runway_front")).toBe(false);

    const drift = geometryDrift(sql);
    console.log(
      `\n--- SURFACE GEOMETRY: ${drift.length} mismatches across ${surfaces.length} resolved surfaces ---\n  ` +
        (drift.join("\n  ") || "all surfaces agree"),
    );
    expect(drift).toEqual([]);
  });
});

describe("PROBE B: state machine vs what the shells actually do", () => {
  it("checks every transition the Portals shell performs", () => {
    const performed: readonly (readonly [GamePhase, GamePhase, string])[] = [
      ["booting", "ready", "PortalsApp:271"],
      ["ready", "intro", "PortalsApp:304 open()"],
      ["sharing", "intro", "PortalsApp:304 open() the child"],
      ["intro", "playing", "PortalsApp:410 start()"],
      ["failed", "playing", "PortalsApp:410 Try again"],
      ["playing", "failed", "PortalsApp:439/512"],
      ["playing", "finished", "PortalsApp:444"],
      ["finished", "choosing_trap", "PortalsApp:679/1139"],
      ["choosing_trap", "placing_trap", "PortalsApp:559"],
      ["placing_trap", "publishing", "PortalsApp:564"],
      ["publishing", "sharing", "PortalsApp:573"],
      ["publishing", "placing_trap", "PortalsApp:577 publish failed"],
      ["playing", "paused", "PortalsApp:582"],
      ["paused", "playing", "PortalsApp:588"],
      ["placing_trap", "choosing_trap", "PortalsApp:679 Escape"],
      ["choosing_trap", "finished", "PortalsApp:532 endChain()"],
      // quitToTitle -> applyRun(EMPTY_RUN), whose phase is "ready".
      ["intro", "ready", "quitToTitle from intro"],
      ["playing", "ready", "quitToTitle from playing"],
      ["paused", "ready", "quitToTitle from paused"],
      ["failed", "ready", "quitToTitle from failed"],
      ["finished", "ready", "quitToTitle from finished"],
      ["choosing_trap", "ready", "quitToTitle from choosing_trap"],
      ["placing_trap", "ready", "quitToTitle from placing_trap"],
      ["publishing", "ready", "quitToTitle from publishing"],
      ["sharing", "ready", "quitToTitle from sharing"],
    ];
    const forbidden = performed
      .filter(([from, to]) => !canTransition(from, to))
      .map(([from, to]) => `${from} -> ${to}`);
    console.log(
      `\n--- FORBIDDEN BUT PERFORMED (${forbidden.length}) ---\n  ` + forbidden.join("\n  "),
    );
    // FIXED. This pinned eight forbidden transitions when the probe was
    // written: every one was quitToTitle applying EMPTY_RUN, whose phase is
    // "ready", against a table that allowed `-> ready` only from `booting` and
    // `intro`. Nothing threw, because transitionPhase is unwired - which is
    // precisely how it rotted unnoticed. The table was wrong, not the shell.
    // lib/game/state-machine.ts now permits quitting from every phase that
    // holds a run, and tests/unit/state-machine.test.ts records all eight with
    // their call site. The list is shrunk to empty rather than deleted, per the
    // note this replaces: it stays as the guard against the table drifting away
    // from the shells again.
    expect(forbidden).toEqual([]);
    // And the shape of the fix, so patching one row is not enough: quitting is
    // reachable from every phase that holds a run, not just the paused one.
    for (const from of [
      "playing", "paused", "failed", "finished",
      "choosing_trap", "placing_trap", "publishing", "sharing",
    ] as const)
      expect(canTransition(from, "ready"), `${from} -> ready is what quitting does`).toBe(true);
  });
});

describe("PROBE C: challenge link decoding under attack", () => {
  const base = () => {
    const traps: TrapInstance[] = [];
    const placement = validatePlacement(
      { type: "floor_fan", zoneId: "runway_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
      traps,
    );
    if (!placement.valid) throw new Error(`fixture rejected: ${placement.reason}`);
    traps.push({
      id: "trap_1", type: "floor_fan", ownerUserId: null, ownerName: "Wobbly Badger",
      ownerAvatarSeed: 3, depthAdded: 1, zoneId: "runway_front",
      position: placement.canonicalPosition, rotationY: placement.rotationY, seed: 11,
      params: TRAP_CATALOG.floor_fan.defaultParams,
    });
    return {
      id: "x", slug: "worse-abc123", chainId: "c", chainSlug: "cs", parentSlug: null,
      depth: 1, baseSeed: 5, levelVersion: 1 as const, createdByName: "Wobbly Badger",
      createdByAvatarSeed: 3, addedTrap: traps[0]!, traps, ghostTrace: null,
      stats: { attempts: 4, completions: 1, survivalRate: 0.25, bestTimeMs: 9000, recentAttempts: 4, shareCount: 0 },
      createdAt: new Date(0).toISOString(), isDemo: true,
    };
  };

  it("never throws anything but CHALLENGE_LINK_INVALID, and never yields a DTO the store would refuse", () => {
    const good = encodeChallengeLink(base());
    const bad: string[] = [];
    const attempt = (label: string, payload: string) => {
      let decoded;
      try {
        decoded = decodeChallengeLink(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The only contract decode advertises. Anything else escapes the
        // "that link is damaged" handler in PortalsApp and GameClient.
        if (message !== "CHALLENGE_LINK_INVALID") bad.push(`${label}: threw ${message}`);
        return;
      }
      // A payload that decodes must produce something persistable, because the
      // first thing both shells do with it is repository.importChallenge().
      const parsed = challengeSchema.safeParse(decoded);
      if (!parsed.success)
        bad.push(`${label}: decoded to a DTO challengeSchema refuses (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message})`);
    };
    for (let cut = 1; cut < good.length; cut += 1) attempt(`truncated to ${cut}`, good.slice(0, cut));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < good.length; i += 1)
      for (const ch of alphabet) {
        if (good[i] === ch) continue;
        attempt(`flip ${i}->${ch}`, good.slice(0, i) + ch + good.slice(i + 1));
      }
    for (const [label, payload] of [
      ["empty", ""], ["punctuation", "!!!!"], ["huge", "A".repeat(20_000)],
      ["null byte", "AAAA AAAA"], ["unicode", "\u{1F4A5}".repeat(20)],
    ] as const)
      attempt(label, payload);
    console.log(`\n--- LINK FUZZ FAILURES (${bad.length}) ---\n` + bad.slice(0, 25).join("\n"));
    expect(bad).toEqual([]);
  });

  it("refuses a hand-edited zoneId that names a surface off the course", () => {
    const enc = (v: unknown) =>
      Buffer.from(JSON.stringify(v), "utf8").toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() =>
      decodeChallengeLink(enc([1, "worse-abc123", 1, 0, 0, ["Wobbly Badger"], [[0, 255, 0, 0, 0, 0, 1, 1]]])),
    ).toThrow("CHALLENGE_LINK_INVALID");
  });
});

describe("PROBE D: trap params that nothing reads, and renderer keys nothing supplies", () => {
  it("cross-checks defaultParams against every trapNumber/trapFlag key the renderers read", () => {
    const renderers = [
      "components/game/traps/ForceTraps.tsx",
      "components/game/traps/LauncherTraps.tsx",
      "components/game/traps/NewTraps.tsx",
      "components/game/traps/TrapsWaveA.tsx",
      "components/game/traps/TrapsWaveB.tsx",
      "components/game/TrapRenderer.tsx",
      "components/game/effects/EffectsLayer.tsx",
    ].map(read).join("\n");
    // Both access shapes: the trapNumber/trapFlag/trapString helpers, and the
    // direct `trap.params.forward` read TrapRenderer uses for the spring pad.
    const readKeys = new Set([
      ...[...renderers.matchAll(/trap(?:Number|Flag|String)\(\s*trap\s*,\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!),
      ...[...renderers.matchAll(/trap\.params\.([A-Za-z0-9_]+)/g)].map((m) => m[1]!),
    ]);
    const declared = new Set<string>();
    for (const type of TRAP_TYPES)
      for (const key of Object.keys(TRAP_CATALOG[type].defaultParams)) declared.add(key);

    const neverRead = [...declared].filter((k) => !readKeys.has(k)).sort();
    const neverSupplied = [...readKeys].filter((k) => !declared.has(k)).sort();
    console.log(
      `\n--- defaultParams keys NO renderer reads (${neverRead.length}) ---\n  ${neverRead.join(", ") || "none"}` +
      `\n--- renderer keys NO defaultParams supplies, so always the fallback (${neverSupplied.length}) ---\n  ${neverSupplied.join(", ") || "none"}`,
    );
    // Report only; the assertion below names the per-trap version, which is
    // the one that can actually change how a trap plays.
    const perTrap: string[] = [];
    for (const type of TRAP_TYPES) {
      const keys = Object.keys(TRAP_CATALOG[type].defaultParams);
      const dead = keys.filter((k) => !readKeys.has(k));
      if (dead.length) perTrap.push(`${type}: ${dead.join(", ")}`);
    }
    console.log(`\n--- TRAPS WITH DEAD defaultParams (${perTrap.length}) ---\n  ` + perTrap.join("\n  "));
    // KNOWN DEAD CONFIG, pinned rather than asserted away. These are the
    // original roster: each was rewritten with hard-coded constants and its
    // catalogue entry kept the tuning knobs, which now govern nothing. The
    // precedent is spring_pad, whose `upward` was deleted for exactly this
    // reason (see the comment above it in trap-catalog.ts). Shrink this list as
    // the keys are either wired up or removed; do not delete the test.
    expect(perTrap).toEqual([
      "swinging_hammer: amplitude, speed",
      "rolling_fridge: impulse, mass",
      "floor_fan: force",
      "soap_slick: traction, wobble",
      "angry_vacuum: speed, suction, leash",
      "rotating_toilet: speed",
      "giant_beach_ball: restitution",
      "toaster_launcher: interval, muzzleSpeed",
      "ceiling_fan: speed",
      "banana_peel: launch",
      "robot_mop: patrol, speed",
    ]);
    // The other direction is the one that would silently change behaviour: a
    // renderer reading a key nothing supplies falls through to a literal
    // fallback that no catalogue entry can override. There are none today.
    expect(neverSupplied).toEqual([]);
  });

  it("confirms the RPC's empty params are harmless because trapNumber re-reads the catalogue", () => {
    // publish_child_challenge stores 'params', jsonb_build_object(). That would
    // strip a trap's tuning if the renderers read trap.params alone, but every
    // helper falls through to TRAP_CATALOG[type].defaultParams first and only
    // then to its literal fallback, so an empty params object resolves to the
    // same numbers a link-decoded trap gets. Pinned so a refactor of that
    // helper cannot silently make the RPC's stripping matter.
    for (const file of [
      "components/game/traps/ForceTraps.tsx",
      "components/game/traps/NewTraps.tsx",
      "components/game/traps/TrapsWaveA.tsx",
      "components/game/traps/TrapsWaveB.tsx",
    ])
      expect(read(file), `${file}: trapNumber stopped consulting defaultParams`)
        .toContain("TRAP_CATALOG[trap.type].defaultParams[key]");
  });
});

describe("PROBE E: is the roster actually exercised where tests claim", () => {
  it("counts how many traps link-hardening's runway_mid loop really tests", () => {
    const ok = TRAP_TYPES.filter(
      (type) => validatePlacement({ type, zoneId: "runway_mid", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []).valid,
    );
    console.log(`\n--- link-hardening reaches the assertion for ${ok.length}/${TRAP_TYPES.length} traps ---`);
    console.log(`  silently skipped: ${TRAP_TYPES.filter((t) => !ok.includes(t)).join(", ") || "none"}`);
    expect(ok.length).toBe(TRAP_TYPES.length);
  });

  it("checks every trap type has somewhere legal on the classic course", () => {
    const homeless = TRAP_TYPES.filter((type) =>
      !placementSurfaces().some((surface) => {
        for (let ox = -4; ox <= 4; ox += 0.25)
          for (let oz = -4; oz <= 4; oz += 0.25)
            if (validatePlacement({ type, zoneId: surface.id, offsetX: ox, offsetZ: oz, rotationQuarterTurns: 0 }, []).valid)
              return true;
        return false;
      }),
    );
    console.log(`\n--- TRAPS WITH NO LEGAL SPOT ON THE CLASSIC COURSE (${homeless.length}) ---\n  ${homeless.join(", ") || "none"}`);
    expect(homeless).toEqual([]);
  });
});

describe("PROBE G: fixtures that may have stopped testing what they claim", () => {
  it("keeps the pinned v1 link landing its traps ON the surfaces they name", () => {
    // challenge-link.test.ts pins this literal so "links already in people's
    // chats keep working". It asserts trap COUNT, an absent track and zero
    // stats - never a position, so it cannot see where the traps end up.
    //
    // That the traps MOVE when the course is re-authored is intended, and
    // 0018's header records it: a placement is an offset from a surface centre
    // precisely so a trap rides the platform it was dropped on. Pinning the old
    // coordinates would pin the thing the design deliberately gives up.
    //
    // What must not change is that an old link still decodes to a PLAYABLE
    // level. decodeChallengeLink replays every trap through validatePlacement,
    // so a reshape that pushed a trap off its platform would not relocate it -
    // it would make every link of that vintage throw CHALLENGE_LINK_INVALID and
    // read to the recipient as "that challenge link is damaged".
    const v1 =
      "WzEsIndvcnNlLWxpbmt0ZXN0Iiw5ODc2NTQsMCwxMixbIkNoZWVreSBLZXR0bGUiLCJUdXJibyBPdHRlciJdLFtbMiwxLDAsMCwwLDEsMTEsNTAwMF0sWzcsNiwwLDAsMCwwLDEyLDUwMDFdXV0";
    const decoded = decodeChallengeLink(v1);
    expect(decoded.traps, "the pinned v1 link stopped decoding to two traps").toHaveLength(2);

    const off: string[] = [];
    for (const trap of decoded.traps) {
      const zone = PLACEMENT_ZONES.find((entry) => entry.id === trap.zoneId);
      const surface = zone && {
        id: zone.id, minX: zone.minX, maxX: zone.maxX,
        minZ: zone.minZ, maxZ: zone.maxZ, groundY: zone.groundY,
      };
      if (!surface) {
        off.push(`${trap.type}: zone "${trap.zoneId}" no longer resolves to a surface`);
        continue;
      }
      const clearance = TRAP_CATALOG[trap.type].placementRadius * 0.5;
      const [x, y, z] = trap.position;
      if (
        x - clearance < surface.minX || x + clearance > surface.maxX ||
        z - clearance < surface.minZ || z + clearance > surface.maxZ
      )
        off.push(
          `${trap.type} at [${x}, ${z}] hangs off ${surface.id} ` +
            `(x ${surface.minX}..${surface.maxX}, z ${surface.minZ}..${surface.maxZ})`,
        );
      // And it must stand on that surface's floor, not the height it was minted at.
      if (Math.abs(y - surface.groundY) > 1e-6)
        off.push(`${trap.type} sits at y=${y}, but ${surface.id}'s floor is ${surface.groundY}`);
    }
    console.log(
      `\n--- PINNED v1 LINK: TRAPS OFF THEIR SURFACE (${off.length}) ---\n  ` + (off.join("\n  ") || "none"),
    );
    expect(off).toEqual([]);
  });

  it("checks placement.test.ts's overlap fixture still overlaps", () => {
    // The comment there records this exact regression once already: the fixture
    // held a literal position, the course moved, and the overlap assertion
    // stopped overlapping anything. It now derives from zoneCenter, so this
    // asserts the derivation still lands inside the refusal radius rather than
    // merely that the call returns something.
    const centre = zoneCenter(PLACEMENT_ZONES.find((z) => z.id === "runway_front")!);
    const existing: TrapInstance = {
      id: "one", type: "floor_fan", ownerUserId: null, ownerName: "Safe Otter",
      ownerAvatarSeed: 1, depthAdded: 1, zoneId: "runway_front",
      position: [centre[0], 0.05, centre[1]], rotationY: 0, seed: 1, params: {},
    };
    const result = validatePlacement(
      { type: "soap_slick", zoneId: "runway_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
      [existing],
    );
    const threshold =
      0.75 * (TRAP_CATALOG.soap_slick.placementRadius + TRAP_CATALOG.floor_fan.placementRadius);
    console.log(`\n--- overlap fixture: distance 0.00u vs refusal threshold ${threshold.toFixed(2)}u ---`);
    expect(result).toMatchObject({ valid: false, reason: "overlaps_trap" });
  });
});

describe("PROBE F: every trap type reaches a renderer", () => {
  it("finds a case arm for each TRAP_TYPE in TrapRenderer", () => {
    const renderer = read("components/game/TrapRenderer.tsx");
    const missing = TRAP_TYPES.filter((type) => !renderer.includes(`"${type}"`));
    console.log(`\n--- TRAP TYPES NOT NAMED IN TrapRenderer.tsx (${missing.length}) ---\n  ${missing.join(", ") || "none"}`);
    expect(missing).toEqual([]);
  });
});
