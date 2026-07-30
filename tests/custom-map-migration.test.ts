import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/0021_custom_map_publishing.sql", import.meta.url),
  "utf8",
);

describe("custom map database trust boundary", () => {
  it("stores immutable versions under stable owned maps", () => {
    expect(migration).toContain("create table if not exists public.custom_maps");
    expect(migration).toContain("create table if not exists public.custom_map_versions");
    expect(migration).toContain("unique(map_id, version_number)");
    expect(migration).toContain("custom_map_versions_immutable");
    expect(migration).toContain("version_conflict");
  });

  it("keeps all tables behind RPCs and enforces visibility", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke insert, update, delete, select on public.custom_maps");
    expect(migration).toContain("v_map.visibility in('public','unlisted') and v_map.moderation_status='active'");
    expect(migration).toContain("m.visibility='public' and m.moderation_status='active'");
  });

  it("uses unique actors, freshness decay, smoothing, reports, and author diversity", () => {
    expect(migration).toContain("unique(version_id, actor_id, event_type)");
    expect(migration).toContain("exp(-extract(epoch from(now()-published_at))/604800.0)");
    expect(migration).toContain("(clears+1)/(starts+4)");
    expect(migration).toContain("row_number() over(partition by owner_id");
    expect(migration).toContain("moderation_status='quarantined'");
  });

  it("validates version-5 payloads and server-computes their hash", () => {
    expect(migration).toContain("v_payload->>0<>'5'");
    expect(migration).toContain("jsonb_array_length(v_payload->7->0) not between 1 and 96");
    expect(migration).toContain("encode(digest(p_code,'sha256'),'hex')");
  });

  it("keeps old immutable versions playable, measurable, and reportable", () => {
    expect(migration).toContain("exists(select 1 from public.custom_map_versions where id=p_version_id and map_id=p_map_id and playable)");
    expect(migration).not.toContain("current_version_id=p_version_id and visibility in('public','unlisted')");
  });

  it("makes publish retries idempotent before any version write", () => {
    const replayLookup = migration.indexOf("operation='custom-map-publish' and idempotency_key=p_idempotency_key");
    const versionInsert = migration.indexOf("insert into public.custom_map_versions(map_id,version_number");
    expect(replayLookup).toBeGreaterThan(0);
    expect(replayLookup).toBeLessThan(versionInsert);
    expect(migration).toContain("return v_existing.response_json");
  });
});
