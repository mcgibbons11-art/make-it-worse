import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { totalRisk } from "@/lib/game/difficulty";
import { PLAYER } from "@/lib/game/constants";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { TrapInstance } from "@/lib/game/types";

/**
 * Static comparison only, in two flavors — nothing here executes SQL or
 * runs against Postgres. Most tests parse the numeric literals and lookup
 * tables out of the TS and SQL source files as text and assert they still
 * match. One (the zone-multiplier test) instead imports and calls the real
 * lib/game/difficulty.ts totalRisk() to compute the value lib/game itself
 * would produce, then compares that live TS result against the SQL's
 * hardcoded snapshot — still no database involved, but a genuine "does the
 * running client-side formula agree with what's baked into the migration"
 * check rather than a regex over source text (see the comment above
 * zone_risk_multiplier in 0008 for why that piece is a snapshot at all).
 * Either way, this proves nothing about runtime SQL behavior and cannot
 * replace exercising publish_child_challenge against a real database.
 */

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const difficultyTs = read("lib/game/difficulty.ts");
const placementTs = read("lib/game/placement.ts");
const trapCatalogTs = read("lib/game/trap-catalog.ts");
const levelDefinitionTs = read("lib/game/level-definition.ts");
const scoringSql = read("supabase/migrations/0008_scoring_and_placement_parity.sql");
/** Every migration, in the order Postgres would run them. */
const migrations = readdirSync(new URL("../../supabase/migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`));

// The roster grows by fix-forward migration, so every later file that seeds
// trap_catalog has to be read too, newest last: the parsers below let a later
// statement win, exactly as Postgres would.
//
// Discovered rather than listed. A hand-maintained list means the next person
// to add a wave of traps has to remember to edit this file as well, and if they
// forget, the test does not fail loudly - it silently compares the roster
// against a stale subset of migrations. That is the failure this test exists to
// catch, so it must not depend on being told where to look.
const catalogSeedSql = migrations.filter((source) =>
  source.includes("public.trap_catalog"),
);
// zone_risk_multiplier is refreshed the same way, and for the same reason: it
// is a snapshot of a whole-roster renormalisation, so it goes stale whenever a
// segment is added anywhere. Reading only 0008 would have pinned a definition
// Postgres has already replaced, so this list is newest-last too.
// Discovered rather than listed. A hand-maintained list silently pins whichever
// refresh was newest when someone last edited this file, so the test keeps
// passing against a definition Postgres has already replaced - the exact
// failure it exists to catch. Sorting by filename reproduces the order the
// migrations actually run in, and the parser below lets the last one win.
// The placement rules are refreshed by fix-forward migration too, so reading
// only 0008 would pin a definition Postgres has already replaced. Same
// discovery, same newest-last ordering as the zone multipliers below.
const placementSql = readdirSync(new URL("../../supabase/migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .filter((source) => source.includes("function public.publish_child_challenge"))
  .at(-1)!;

/**
 * The same file with `--` comment lines removed.
 *
 * A migration that REPLACES a rule normally explains the rule it replaced, so
 * asserting a retired predicate is absent hits the prose describing it and
 * fails against a file that is actually correct. Absence claims below run
 * against executable SQL only; presence claims can use either.
 */
const placementCode = placementSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const zoneSqlSources = readdirSync(new URL("../../supabase/migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .filter((source) => source.includes("function public.zone_risk_multiplier"));

function parseTsArrayLiteral(source: string, constName: string): string[] {
  const match = new RegExp(`\\b${constName}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`could not find TS array literal ${constName}`);
  return [...match[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

function parseSqlNumberSetTuples(...sources: string[]): Map<string, { radius: number; weight: number }> {
  const out = new Map<string, { radius: number; weight: number }>();
  const tuple = /\('([a-z_]+)'\s*,\s*'[^']*'\s*,\s*'[a-z]+'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*\d+\)/g;
  for (const source of sources)
    for (const m of source.matchAll(tuple))
      out.set(m[1]!, { radius: Number(m[2]), weight: Number(m[3]) });
  return out;
}

describe("SQL/TS static parity (textual pinning, not a behavioral test)", () => {
  it("pins the sigmoid constants shared by survivalOdds and trap_survival_odds", () => {
    const tsMatch = /survivalOdds[\s\S]*?exp\(-\(([\d.]+)-([\d.]+)\*totalRisk/.exec(difficultyTs);
    expect(tsMatch, "lib/game/difficulty.ts: could not find the survivalOdds sigmoid").not.toBeNull();
    const sqlMatch = /exp\(-\(([\d.]+)\s*-\s*([\d.]+)\s*\*\s*public\.total_trap_risk/.exec(scoringSql);
    expect(sqlMatch, "0008: could not find the trap_survival_odds sigmoid").not.toBeNull();
    expect(sqlMatch![1]).toBe(tsMatch![1]);
    expect(sqlMatch![2]).toBe(tsMatch![2]);
  });

  it("pins the classic course's 15 zone multipliers, computed live from totalRisk(), against zone_risk_multiplier's snapshot", () => {
    // zoneMultiplier() itself is not exported, and as of this migration is no
    // longer a pure function of a zone id string (see the 0008 comment) — it
    // is derived from TRACK_SEGMENTS, which is large and not worth hand
    // re-deriving here. totalRisk() of a single probe trap isolates it:
    // totalRisk([trap]) = TRAP_CATALOG[trap.type].riskWeight * zoneMultiplier(zoneId)
    // with no synergy term possible for an array of length 1.
    const probeType = "banana_peel" as const;
    const probeWeight = TRAP_CATALOG[probeType].riskWeight;
    const liveMultiplier = (zoneId: string): number => {
      const trap: TrapInstance = {
        id: "probe", type: probeType, ownerUserId: null, ownerName: "probe", ownerAvatarSeed: 1,
        depthAdded: 1, zoneId, position: [0, 0, 0], rotationY: 0, seed: 1, params: {},
      };
      return totalRisk([trap]) / probeWeight;
    };

    const sqlBranches = new Map<string, number>();
    for (const source of zoneSqlSources)
      for (const m of source.matchAll(/when '([a-z_]+)' then ([\d.]+)/g))
        sqlBranches.set(m[1]!, Number(m[2]));
    expect(sqlBranches.size, "zone_risk_multiplier has no per-zone snapshot branches").toBe(15);

    for (const [zoneId, sqlValue] of sqlBranches)
      expect(sqlValue, `zone_risk_multiplier('${zoneId}') vs live zoneMultiplier`).toBeCloseTo(liveMultiplier(zoneId), 6);
  });

  it("pins every SYNERGIES pair and bonus against trap_synergy_bonus", () => {
    const tsPairs = [...difficultyTs.matchAll(/\{\s*pair:\s*\[\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*\]\s*,\s*bonus:\s*([\d.]+)\s*\}/g)]
      .map((m) => [m[1]!, m[2]!, m[3]!] as const);
    expect(tsPairs.length, "lib/game/difficulty.ts: found no SYNERGIES entries").toBeGreaterThan(0);

    const sqlPairs = [...scoringSql.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*([\d.]+)\)/g)]
      .map((m) => [m[1]!, m[2]!, m[3]!] as const);
    expect(sqlPairs.length, "0008: found no trap_synergy_bonus VALUES entries").toBeGreaterThan(0);

    // trap_synergy_bonus checks both orderings, so the pair's direction does
    // not have to match; only the unordered pair and its bonus do.
    const normalize = (rows: readonly (readonly [string, string, string])[]) =>
      rows
        .map(([a, b, bonus]) => [[a, b].sort().join("+"), Number(bonus)] as const)
        .sort(([a], [b]) => a.localeCompare(b));

    expect(normalize(sqlPairs)).toEqual(normalize(tsPairs));
  });

  it("pins the single overlap multiplier against publish_child_challenge", () => {
    // Was a 0.95-on-bridge / 0.75-elsewhere split keyed on the zone id prefix.
    // 0014 unified it: once every level piece is a placement surface, a name
    // prefix cannot pick out a class of geometry.
    const tsMatch = /<\s*\.?([\d.]+)\s*\*\s*\(radius\s*\+\s*other\)/.exec(placementTs);
    expect(tsMatch, "lib/game/placement.ts: could not find the overlap multiplier").not.toBeNull();
    const multiplier = `.${tsMatch![1]!.replace(/^0?\./, "")}`;
    expect(placementSql).toContain(`${multiplier} * (v_catalog.placement_radius + tc.placement_radius)`);
    expect(placementCode).not.toContain("v_zone_id like 'bridge%'");
  });

  it("pins the geometric unsafe_sweep rule and its dodge margin", () => {
    // Both sides used to test a NAME - the client `zone.id.startsWith("stones")`
    // and the server `v_zone_id like 'stones%'` - which refused a sweep on
    // anything called a stone and allowed it on any narrow platform called
    // something else. Both now measure the floor left beside the arc.
    const tsTypes = /SWEEPING_TYPES[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(placementTs);
    expect(tsTypes, "lib/game/placement.ts: could not find SWEEPING_TYPES").not.toBeNull();
    const types = [...tsTypes![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) expect(placementSql).toContain(`'${type}'`);

    const tsMargin = /DODGE_MARGIN\s*=\s*PLAYER\.capsuleRadius\s*\*\s*2/.exec(placementTs);
    expect(tsMargin, "lib/game/placement.ts: could not find DODGE_MARGIN").not.toBeNull();
    const margin = PLAYER.capsuleRadius * 2;
    // The SQL carries the resolved number because Postgres cannot import a TS
    // constant; this is the assertion that keeps the two equal.
    expect(placementSql).toContain(margin.toFixed(2));
    expect(placementCode).not.toContain("v_zone_id like 'stones%'");
  });

  it("pins every trap's risk_weight and placement_radius between TRAP_CATALOG and public.trap_catalog", () => {
    const trapTypes = parseTsArrayLiteral(trapCatalogTs, "TRAP_TYPES");
    expect(trapTypes.length).toBeGreaterThan(0);

    const tsByType = new Map<string, { radius: number; weight: number }>();
    for (const line of trapCatalogTs.split("\n")) {
      const m = /^\s*(\w+):\s*\{\s*type:\s*"\1"[^]*?placementRadius:\s*([\d.]+)[^]*?riskWeight:\s*([\d.]+)/.exec(line);
      if (m) tsByType.set(m[1]!, { radius: Number(m[2]), weight: Number(m[3]) });
    }
    expect(tsByType.size, "lib/game/trap-catalog.ts: TRAP_CATALOG parsed to 0 entries").toBe(trapTypes.length);

    const sqlByType = parseSqlNumberSetTuples(...catalogSeedSql);
    expect(sqlByType.size, "public.trap_catalog inserts across all migrations").toBe(trapTypes.length);

    for (const type of trapTypes) {
      const ts = tsByType.get(type);
      const sql = sqlByType.get(type);
      expect(ts, `TRAP_CATALOG missing ${type}`).toBeDefined();
      expect(sql, `public.trap_catalog (0005/0009) missing a row for ${type}`).toBeDefined();
      expect(sql!.radius, `${type} placementRadius`).toBeCloseTo(ts!.radius);
      expect(sql!.weight, `${type} riskWeight`).toBeCloseTo(ts!.weight);
    }
  });

  // The zone -> named-list mapping below (e.g. "stones zones use `small`")
  // is read off the current lib/game/level-definition.ts by hand, not
  // parsed. If a future change moves a zone to a different named list, this
  // test needs updating alongside it; what it does verify automatically is
  // that the *contents* of TRAP_TYPES/small/rampTypes stay in sync with
  // what migration 0009 seeded, which is the drift this exists to catch.
  // RETIRED by 0014, deliberately, rather than deleted.
  //
  // allowed_types was the storage behind the `type_not_allowed` rule: each zone
  // carried a list of the trap types it would accept. Free placement removed
  // that rule from both sides - any trap may now stand on any floor, and a trap
  // is refused only when it does not physically fit - so the column governs
  // nothing. Keeping the test green would have meant maintaining a 54-entry
  // array per zone, in SQL, to satisfy a check on data no code reads.
  //
  // It is skipped rather than removed because the column still EXISTS, 0002
  // declares it not-null, and the seeding in 0014 fills it with the full roster.
  // If placement ever regains a per-surface allowlist this is the shape its
  // parity check should take.
  it.skip("pins placement_zones.allowed_types against level-definition.ts's zone lists", () => {
    const trapTypes = parseTsArrayLiteral(trapCatalogTs, "TRAP_TYPES");
    const small = parseTsArrayLiteral(levelDefinitionTs, "small");
    const rampTypes = parseTsArrayLiteral(levelDefinitionTs, "rampTypes");
    expect(levelDefinitionTs).toContain('TRAP_TYPES.filter((t)=>t!=="rolling_fridge")');
    const bridgeMid = trapTypes.filter((t) => t !== "rolling_fridge");

    const expected = new Map<string, string[]>([
      ...[
        "runway_front", "runway_mid", "runway_back",
        "bridge_front", "bridge_back",
        "island_left", "island_right", "convergence",
        "finish_front", "finish_mid",
      ].map((id): [string, string[]] => [id, trapTypes]),
      ...["stones_front", "stones_mid", "stones_back"].map((id): [string, string[]] => [id, small]),
      ["bridge_mid", bridgeMid],
      ["ramp", rampTypes],
    ]);

    const sqlZones = new Map<string, string[]>();
    const updateBlock = /update public\.placement_zones set allowed_types = array\[([^\]]*)\]::text\[\]\s*where id\s+(in\s*\(([^)]*)\)|=\s*'([a-z_]+)')\s*;/g;
    // Newest last, so a later migration's arrays win exactly as Postgres would.
    for (const source of catalogSeedSql)
      for (const m of source.matchAll(updateBlock)) {
        const types = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((t) => t[1]!);
        const ids = m[3] ? [...m[3].matchAll(/'([a-z_]+)'/g)].map((t) => t[1]!) : [m[4]!];
        for (const id of ids) sqlZones.set(id, types);
      }
    expect(sqlZones.size, "0009 + 0010 + 0012: parsed 0 placement_zones update statements").toBe(expected.size);

    for (const [zoneId, expectedTypes] of expected) {
      const actual = sqlZones.get(zoneId);
      expect(actual, `0009 has no allowed_types update for zone ${zoneId}`).toBeDefined();
      expect(new Set(actual), `allowed_types for zone ${zoneId}`).toEqual(new Set(expectedTypes));
    }
  });
});
