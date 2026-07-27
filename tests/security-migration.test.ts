import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/0006_security_hardening.sql", import.meta.url),
  "utf8",
);
const challengeRoute = readFileSync(
  new URL("../app/api/challenges/[slug]/route.ts", import.meta.url),
  "utf8",
);
const privacyMigration = readFileSync(
  new URL("../supabase/migrations/0007_public_payload_privacy.sql", import.meta.url),
  "utf8",
);

describe("production database security surface", () => {
  it("removes raw profile writes and challenge reads", () => {
    expect(migration).toContain(
      "revoke update on public.profiles from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke select on public.challenges from anon, authenticated",
    );
  });

  it("keeps SECURITY DEFINER helpers off the Data API", () => {
    for (const signature of [
      "public.challenge_dto(uuid)",
      "public.refresh_challenge_payload(uuid)",
      "public.is_valid_ghost_trace(jsonb, integer)",
      "public.has_legal_center_placement(text, jsonb)",
    ]) {
      expect(migration).toContain(
        `revoke all on function ${signature} from public, anon, authenticated`,
      );
    }
  });

  it("exposes only the gated public challenge RPC", () => {
    expect(migration).toContain(
      "grant execute on function public.get_public_challenge(text) to anon, authenticated",
    );
    expect(challengeRoute).toContain('"get_public_challenge"');
    expect(challengeRoute).not.toContain('.from("challenges")');
  });

  it("uses URL-safe share entropy and the stored slug on replay", () => {
    expect(migration).toContain("encode(gen_random_bytes(12), 'hex')");
    expect(migration).toContain("'/c/' || v_stored_slug");
  });

  it("validates completion evidence before offering traps", () => {
    expect(migration).toContain(
      "v_elapsed_ms < 4500 or p_duration_ms < 4500",
    );
    expect(migration).toContain("p_max_progress < .99");
    expect(migration).toContain(
      "public.is_valid_ghost_trace(p_ghost_trace, p_duration_ms)",
    );
    expect(migration).toContain(
      "public.has_legal_center_placement(tc.type, v_challenge.traps)",
    );
  });

  it("removes stable anonymous UUIDs from public trap payloads", () => {
    expect(privacyMigration).toContain(
      "jsonb_set(c.added_trap, '{ownerUserId}', 'null'::jsonb, true)",
    );
    expect(privacyMigration).toContain(
      "jsonb_set(trap.value, '{ownerUserId}', 'null'::jsonb, true)",
    );
    expect(privacyMigration).toContain(
      "revoke all on function public.challenge_dto(uuid) from public, anon, authenticated",
    );
  });
});
