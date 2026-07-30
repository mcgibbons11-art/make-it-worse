import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import { encodeChallengeLink } from "@/lib/game/challenge-link";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  optionalUserSupabase: vi.fn(() => ({ kind: "optional" })),
  publicSupabase: vi.fn(() => ({ kind: "public" })),
  userScopedSupabase: vi.fn(() => ({ kind: "user" })),
  rpc: mocks.rpc,
}));

import { GET, POST } from "@/app/api/maps/route";
import { POST as rollbackMap } from "@/app/api/maps/[mapId]/rollback/route";
import { POST as reportMap } from "@/app/api/maps/[mapId]/reports/route";

const mapId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-07-30T12:00:00.000Z";

function code() {
  const items = generateRandomRoom(765).filter((item) => !item.asset.startsWith("trap:"));
  const runtime = runtimeMap(items, 765, 765, "Wobbly Builder");
  return { runtime, code: encodeChallengeLink(runtime.challenge, null, runtime.track) };
}

function detail() {
  const authored = code();
  const currentVersion = {
    id: versionId,
    number: 1,
    schemaVersion: 1 as const,
    challengeSlug: authored.runtime.challenge.slug,
    payloadHash: "a".repeat(64),
    pieceCount: authored.runtime.track.pieces.length,
    trapCount: 0,
    playable: true,
    createdAt: timestamp,
  };
  return {
    id: mapId,
    title: "Kitchen Catastrophe",
    description: "Exact immutable chaos.",
    visibility: "public" as const,
    moderationStatus: "active" as const,
    ownerName: "Wobbly Builder",
    ownerAvatarSeed: 765,
    currentVersion,
    metrics: { impressions: 0, starts: 0, clears: 0, likes: 0, shares: 0, reports: 0 },
    trendingScore: 0,
    isOwner: true,
    canModerate: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
    code: authored.code,
    versions: [currentVersion],
  };
}

beforeEach(() => mocks.rpc.mockReset());

describe("custom map API", () => {
  it("validates a publish through the recipient decoder before calling SQL", async () => {
    const stored = detail();
    mocks.rpc.mockResolvedValue(stored);
    const response = await POST(new Request("http://localhost/api/maps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${"x".repeat(24)}`,
        "Idempotency-Key": "33333333-3333-4333-8333-333333333333",
      },
      body: JSON.stringify({
        title: stored.title,
        description: stored.description,
        visibility: stored.visibility,
        code: stored.code,
      }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(expect.anything(), "publish_custom_map", expect.objectContaining({
      p_challenge_slug: stored.currentVersion.challengeSlug,
      p_piece_count: stored.currentVersion.pieceCount,
      p_trap_count: 0,
    }));
  });

  it("returns a recoverable 400 and never reaches storage for corrupt input", async () => {
    const response = await POST(new Request("http://localhost/api/maps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${"x".repeat(24)}`,
        "Idempotency-Key": "33333333-3333-4333-8333-333333333333",
      },
      body: JSON.stringify({ title: "Broken map", description: "", visibility: "public", code: "damaged" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST", retryable: false } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("converts database offsets to opaque pagination cursors", async () => {
    const stored = detail();
    const summary: Record<string, unknown> = { ...stored };
    delete summary.code;
    delete summary.versions;
    mocks.rpc.mockResolvedValue({ items: [summary], nextOffset: 12 });
    const response = await GET(new Request("http://localhost/api/maps?sort=new&limit=12&q=kitchen"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toEqual(expect.any(String));
    expect(body.nextCursor).not.toBe("12");
    expect(mocks.rpc).toHaveBeenCalledWith(expect.anything(), "browse_custom_maps", expect.objectContaining({
      p_query: "kitchen", p_sort: "new", p_limit: 12, p_offset: 0,
    }));
  });

  it("routes exact-version rollback and reporting through authenticated RPCs", async () => {
    const stored = detail();
    mocks.rpc.mockResolvedValueOnce(stored).mockResolvedValueOnce(true);
    const context = { params: Promise.resolve({ mapId }) };
    const rollbackResponse = await rollbackMap(new Request(`http://localhost/api/maps/${mapId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${"x".repeat(24)}` },
      body: JSON.stringify({ versionId }),
    }), context);
    expect(rollbackResponse.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, expect.anything(), "rollback_custom_map", {
      p_map_id: mapId, p_version_id: versionId,
    });

    const reportResponse = await reportMap(new Request(`http://localhost/api/maps/${mapId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${"x".repeat(24)}` },
      body: JSON.stringify({ versionId, reason: "broken", note: "Finish is unreachable" }),
    }), context);
    expect(reportResponse.status).toBe(200);
    expect(await reportResponse.json()).toEqual({ recorded: true });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, expect.anything(), "report_custom_map", expect.objectContaining({
      p_map_id: mapId, p_version_id: versionId, p_reason: "broken",
    }));
  });
});
