import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { trackSchema } from "@/lib/game/schemas";
import { MAX_TRACK_SEGMENTS } from "@/lib/game/track";

/**
 * A composed course has to SURVIVE THE WIRE, on both repositories.
 *
 * The defect this pins: SupabaseRepository.createRootChain() took no argument
 * while the interface declared one, so a picked map or an editor course
 * type-checked, tested green, and was silently dropped the moment the app ran
 * against Supabase instead of the demo repository. Nothing failed; the button
 * just rolled the dice. The fix spans three layers - repository body, API
 * route, SQL function - and any one of them regressing re-opens the hole
 * silently, which is why this reads all three sources rather than trusting the
 * interface to mean anything.
 */
const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

describe("a composed track survives the wire", () => {
  it("is sent by the supabase repository when one was composed", () => {
    const source = read("lib/repository/SupabaseRepository.ts");
    expect(source, "createRootChain no longer accepts a track").toContain(
      "createRootChain(track?:readonly string[])",
    );
    expect(source, "createRootChain no longer sends the track").toContain("JSON.stringify({track})");
  });

  it("is forwarded by the chains route into the RPC", () => {
    const source = read("app/api/chains/route.ts");
    expect(source).toContain("trackSchema.parse");
    expect(source, "the RPC call dropped p_track").toContain("p_track:track");
  });

  it("is stored, validated, emitted, and inherited by the schema", () => {
    const migration = read("supabase/migrations/0019_track_on_supabase.sql");
    // Stored:
    expect(migration).toContain("add column if not exists track jsonb");
    // Validated on the way in, with the same 12-segment ceiling the client has:
    expect(migration).toContain("p_track jsonb default null");
    expect(migration).toContain("'invalid_track'");
    expect(migration).toContain("between 1 and 12");
    expect(MAX_TRACK_SEGMENTS).toBe(12);
    // Emitted ONLY when present - challengeSchema is strict with track
    // optional, so a track:null in the DTO would fail every client parse:
    expect(migration).toContain(
      "case when c.track is null then '{}'::jsonb else jsonb_build_object('track', c.track) end",
    );
    // Inherited by children, whatever path inserts them:
    expect(migration).toContain("create trigger challenges_inherit_parent_track");
    expect(migration).toContain("before insert on public.challenges");
    // And the argument-less overload a stale client could still reach is gone:
    expect(migration).toContain("drop function if exists public.create_root_chain(uuid);");
  });

  it("shares one shape between the payload and the route", () => {
    // trackSchema is the single wire definition. If someone re-inlines the
    // array shape in challengeSchema, the route and the payload can drift.
    expect(trackSchema.safeParse(["start", "runway", "finish"]).success).toBe(true);
    expect(trackSchema.safeParse([]).success).toBe(false);
    expect(trackSchema.safeParse(Array.from({ length: 13 }, () => "runway")).success).toBe(false);
    expect(trackSchema.safeParse(["x"]).success).toBe(false); // below min length 2
    const schemaSource = read("lib/game/schemas.ts");
    expect(schemaSource).toContain("track: trackSchema.optional()");
  });
});
