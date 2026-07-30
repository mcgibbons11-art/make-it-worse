import assert from "node:assert/strict";

const FIXTURE_MODE = process.argv.includes("--print-fixture");

/** A minimal version-5 authored room accepted by the same decoder as the game. */
export function authoredRoomCode(slug, color = "#ffd84d") {
  const payload = [
    5,
    slug,
    20260730,
    0,
    73,
    ["Release Badger"],
    [],
    [
      [[0, -0.5, 5, 8, 1, 10, color, 0]],
      [[-4, 4, 0, 10, 0, 4, "ffffffffffffffff"]],
      [0, 1.25, 1.2],
      [0, 1.5, 9.15],
      10,
    ],
    [0, 0, null],
    null,
  ];
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. See CUSTOM-GAME-SHARING.md.`);
  return value;
}

function bodyMessage(body) {
  if (body && typeof body === "object" && "error" in body)
    return JSON.stringify(body.error);
  return JSON.stringify(body);
}

async function run() {
  if (FIXTURE_MODE) {
    process.stdout.write(authoredRoomCode("release-fixture"));
    return;
  }

  const baseUrl = required("CUSTOM_MAP_TEST_BASE_URL").replace(/\/$/, "");
  const ownerToken = required("CUSTOM_MAP_TEST_OWNER_TOKEN");
  const playerToken = required("CUSTOM_MAP_TEST_PLAYER_TOKEN");
  const moderatorToken =
    process.env.CUSTOM_MAP_TEST_MODERATOR_TOKEN?.trim() || playerToken;
  assert.notEqual(ownerToken, playerToken, "Owner and player tokens must belong to different users");

  async function request(path, {
    method = "GET",
    token,
    json,
    idempotencyKey,
    status = 200,
  } = {}) {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (json !== undefined) headers.set("Content-Type", "application/json");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); }
      catch { throw new Error(`${method} ${path} returned non-JSON (${response.status})`); }
    }
    assert.equal(
      response.status,
      status,
      `${method} ${path}: expected ${status}, received ${response.status}: ${bodyMessage(body)}`,
    );
    return body;
  }

  const suffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const title = `Release matrix ${suffix}`;
  const slugOne = `release-${suffix}`.slice(0, 24).replace(/-$/, "0");
  const slugTwo = `revision-${suffix}`.slice(0, 24).replace(/-$/, "0");
  const codeOne = authoredRoomCode(slugOne, "#ffd84d");
  const codeTwo = authoredRoomCode(slugTwo, "#57dfa1");

  const health = await request("/api/health");
  assert.equal(health?.ok, true);
  assert.equal(health?.mode, "supabase", "Target is not running in Supabase mode");

  const firstKey = crypto.randomUUID();
  const publishOne = {
    title,
    description: "Automated two-player release verification",
    visibility: "public",
    code: codeOne,
  };
  const first = await request("/api/maps", {
    method: "POST", token: ownerToken, json: publishOne,
    idempotencyKey: firstKey, status: 201,
  });
  const mapId = first.id;
  const versionOne = first.currentVersion.id;
  assert.equal(first.currentVersion.number, 1);
  assert.equal(first.code, codeOne);
  assert.equal(first.isOwner, true);

  const replay = await request("/api/maps", {
    method: "POST", token: ownerToken, json: publishOne,
    idempotencyKey: firstKey, status: 201,
  });
  assert.equal(replay.id, mapId, "Idempotent publish created another map");
  assert.equal(replay.currentVersion.id, versionOne);

  const publicOne = await request(`/api/maps/${mapId}?version=${versionOne}`);
  assert.equal(publicOne.code, codeOne);
  const playerOne = await request(`/api/maps/${mapId}?version=${versionOne}`, {
    token: playerToken,
  });
  assert.equal(playerOne.isOwner, false);

  const browseOne = await request(
    `/api/maps?sort=trending&limit=12&q=${encodeURIComponent(title)}`,
  );
  assert.ok(browseOne.items.some((item) => item.id === mapId), "Public map is absent from Trending search");

  for (const type of ["impression", "start", "clear", "like", "share"])
    assert.equal((await request(`/api/maps/${mapId}/events`, {
      method: "POST", token: playerToken,
      json: { versionId: versionOne, type },
    })).recorded, true, `${type} was not recorded`);
  assert.equal((await request(`/api/maps/${mapId}/events`, {
    method: "POST", token: playerToken,
    json: { versionId: versionOne, type: "like" },
  })).recorded, false, "Duplicate like was counted twice");

  assert.equal((await request(`/api/maps/${mapId}/reports`, {
    method: "POST", token: playerToken,
    json: { versionId: versionOne, reason: "broken", note: "Release-matrix report" },
  })).recorded, true);
  assert.equal((await request(`/api/maps/${mapId}/reports`, {
    method: "POST", token: playerToken,
    json: { versionId: versionOne, reason: "broken", note: "Duplicate" },
  })).recorded, false, "Duplicate report was counted twice");
  const measured = await request(`/api/maps/${mapId}?version=${versionOne}`);
  assert.deepEqual(measured.metrics, {
    impressions: 1,
    starts: 1,
    clears: 1,
    likes: 1,
    shares: 1,
    reports: 1,
  }, "Unique events or report metrics did not persist exactly once");
  assert.ok(Number.isFinite(measured.trendingScore));

  const secondPayload = {
    mapId,
    expectedCurrentVersionId: versionOne,
    title,
    description: "Second immutable release-matrix version",
    visibility: "public",
    code: codeTwo,
  };
  const second = await request("/api/maps", {
    method: "POST", token: ownerToken, json: secondPayload,
    idempotencyKey: crypto.randomUUID(), status: 200,
  });
  const versionTwo = second.currentVersion.id;
  assert.equal(second.currentVersion.number, 2);
  assert.notEqual(versionTwo, versionOne);
  assert.deepEqual(second.versions.map((version) => version.number), [2, 1]);

  const oldVersion = await request(`/api/maps/${mapId}?version=${versionOne}`);
  assert.equal(oldVersion.code, codeOne, "Old exact link no longer returns immutable version one");
  assert.equal(oldVersion.currentVersion.id, versionOne);

  await request("/api/maps", {
    method: "POST", token: ownerToken,
    json: { ...secondPayload, code: authoredRoomCode(`stale-${suffix}`.slice(0, 24)) },
    idempotencyKey: crypto.randomUUID(), status: 409,
  });

  const rolledBack = await request(`/api/maps/${mapId}/rollback`, {
    method: "POST", token: ownerToken, json: { versionId: versionOne },
  });
  assert.equal(rolledBack.currentVersion.id, versionOne);

  const unlisted = await request(`/api/maps/${mapId}`, {
    method: "PATCH", token: ownerToken, json: { visibility: "unlisted" },
  });
  assert.equal(unlisted.visibility, "unlisted");
  const browseUnlisted = await request(
    `/api/maps?sort=new&limit=12&q=${encodeURIComponent(title)}`,
  );
  assert.ok(!browseUnlisted.items.some((item) => item.id === mapId));
  assert.equal((await request(`/api/maps/${mapId}`)).id, mapId, "Unlisted exact lookup failed");

  await request(`/api/maps/${mapId}`, {
    method: "PATCH", token: ownerToken, json: { visibility: "private" },
  });
  await request(`/api/maps/${mapId}`, { status: 404 });
  await request(`/api/maps/${mapId}`, { token: playerToken, status: 404 });
  assert.equal((await request(`/api/maps/${mapId}`, { token: ownerToken })).id, mapId);

  await request(`/api/maps/${mapId}`, {
    method: "PATCH", token: ownerToken, json: { visibility: "public" },
  });
  const quarantined = await request(`/api/maps/${mapId}/moderation`, {
    method: "POST", token: moderatorToken,
    json: { status: "quarantined", note: "Release-matrix quarantine" },
  });
  assert.equal(quarantined.moderationStatus, "quarantined");
  await request(`/api/maps/${mapId}`, { status: 404 });
  assert.equal((await request(`/api/maps/${mapId}`, { token: ownerToken })).id, mapId);

  const restored = await request(`/api/maps/${mapId}/moderation`, {
    method: "POST", token: moderatorToken,
    json: { status: "active", versionId: versionTwo, note: "Release-matrix restore" },
  });
  assert.equal(restored.moderationStatus, "active");
  assert.equal(restored.currentVersion.id, versionTwo);
  assert.equal((await request(`/api/maps/${mapId}`)).currentVersion.id, versionTwo);

  // Leave no synthetic map in the public browser. It remains in the owner's
  // private history so the database audit trail and immutable versions survive.
  const cleaned = await request(`/api/maps/${mapId}`, {
    method: "PATCH", token: ownerToken,
    json: { visibility: "private", title: `${title} complete` },
  });
  assert.equal(cleaned.visibility, "private");
  const mine = await request(
    `/api/maps?mine=1&sort=new&limit=24&q=${encodeURIComponent(title)}`,
    { token: ownerToken },
  );
  assert.ok(mine.items.some((item) => item.id === mapId), "Private map vanished from owner browse");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mapId,
    versionOne,
    versionTwo,
    finalVisibility: "private",
    checks: 31,
  }, null, 2)}\n`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
