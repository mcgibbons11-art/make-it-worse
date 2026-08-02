import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap, type RoomItem } from "@/components/game/RoomBuilder";
import {
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { firstLegalPlacement } from "@/lib/game/trap-choice";
import { TRAP_TYPES } from "@/lib/game/trap-catalog";
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { MemoryDatabase } from "@/lib/repository/demo-db";

async function finishAndPublish(repository: DemoRepository, slug: string) {
  const challenge = await repository.getChallenge(slug);
  const track = await repository.getChallengeRuntimeTrack(slug);
  if (!track) throw new Error("runtime track missing");
  const attempt = await repository.startAttempt({
    challengeSlug: slug,
    clientSessionId: crypto.randomUUID(),
    deviceClass: "desktop",
    buildVersion: "test",
    idempotencyKey: crypto.randomUUID(),
  });
  const finish = await repository.finishAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    durationMs: 10_000,
    maxProgress: 1,
    deathTrapInstanceId: null,
    ghostTrace: encodeGhostTrace([{ x: track.exit[0], y: track.exit[1], z: track.exit[2], yaw: 0, flags: 1 }]),
    idempotencyKey: crypto.randomUUID(),
  });
  const type = finish.offeredTraps?.find((candidate) => firstLegalPlacement(track, candidate, challenge.traps));
  if (!type) throw new Error("no offered trap fits");
  const placement = firstLegalPlacement(track, type, challenge.traps)!;
  return repository.publishChild({
    parentSlug: slug,
    attemptId: attempt.attemptId,
    placement,
    idempotencyKey: crypto.randomUUID(),
  });
}

describe("authored map cross-player chain", () => {
  function roomWithTraps(count: number, farthestX = 0) {
    const pieces = generateRandomRoom(7171).filter((item) => !item.asset.startsWith("trap:"));
    const support = pieces.find((item) => item.asset === "platform")!;
    const traps: RoomItem[] = Array.from({ length: count }, (_, index) => ({
      uid: 10_000 + index,
      asset: `trap:${TRAP_TYPES[index % TRAP_TYPES.length]!}` as const,
      x: index === count - 1 && farthestX ? farthestX : support.x + (index % 8) * 0.25,
      y: support.y,
      z: support.z + Math.floor(index / 8) * 0.25,
      rotation: (index % 4) * Math.PI / 2,
      color: "#ff9f1c",
    }));
    return runtimeMap([...pieces, ...traps], 71, 7171, "Map Author");
  }

  it("round-trips a trap-heavy authored room beyond the ordinary 20-round limit", () => {
    const authored = roomWithTraps(37);
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    const received = decodeChallengeLink(code);
    expect(received.traps).toHaveLength(37);
    expect(received.traps.map((trap) => trap.type)).toEqual(
      authored.challenge.traps.map((trap) => trap.type),
    );
  });

  it("round-trips a free-placed authored trap more than 50 units from support", () => {
    const authored = roomWithTraps(1, 400);
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    expect(decodeChallengeLink(code).traps[0]?.position[0]).toBe(400);
  });

  it("does not impose an ordinary challenge-count cap on authored traps", () => {
    const authored = roomWithTraps(97);
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    expect(decodeChallengeLink(code).traps).toHaveLength(97);
  });

  it("round-trips hundreds of placed blocks without an item-count cap", () => {
    const blocks: RoomItem[] = Array.from({ length: 300 }, (_, index) => ({
      uid: 20_000 + index,
      asset: "platform",
      x: (index % 30) * 2,
      y: Math.floor(index / 90) * 2,
      z: Math.floor(index / 30) * -2,
      rotation: 0,
      color: "#ff9f1c",
    }));
    const authored = runtimeMap(blocks, 71, 7172, "Map Author");
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    expect(decodeChallengeRuntimeTrack(code)?.pieces).toHaveLength(300);
    expect(decodeChallengeRuntimeTrack(code)?.zones).toHaveLength(300);
  });

  it("imports a 29-trap room and completes its next add-trap child round", async () => {
    const authored = roomWithTraps(29);
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    const received = decodeChallengeLink(code);
    const track = decodeChallengeRuntimeTrack(code)!;
    const repository = new DemoRepository(new MemoryDatabase());
    await repository.importChallenge(received, track);
    await expect(repository.getChallenge(received.slug)).resolves.toMatchObject({
      depth: 29,
      traps: expect.arrayContaining([expect.objectContaining({ depthAdded: 29 })]),
    });
    const child = await finishAndPublish(repository, received.slug);
    expect(child.challenge.depth).toBe(30);
    const childCode = encodeChallengeLink(child.challenge, null, track);
    expect(decodeChallengeLink(childCode).traps).toHaveLength(30);
  });

  it("survives different players, restarts, two child rounds, and immutable old links", async () => {
    const items = generateRandomRoom(4444).filter((item) => !item.asset.startsWith("trap:"));
    const authored = runtimeMap(items, 88, 4444, "Map Author");
    const originalCode = encodeChallengeLink(authored.challenge, null, authored.track);

    const firstPlayerDb = new MemoryDatabase();
    const firstPlayer = new DemoRepository(firstPlayerDb);
    const received = decodeChallengeLink(originalCode);
    const receivedTrack = decodeChallengeRuntimeTrack(originalCode);
    expect(receivedTrack).not.toBeNull();
    await firstPlayer.importChallenge(received, receivedTrack!);
    const firstChild = await finishAndPublish(firstPlayer, received.slug);

    // A browser restart reads both the child and its authored geometry back.
    const restarted = new DemoRepository(firstPlayerDb);
    await expect(restarted.getChallengeRuntimeTrack(firstChild.challenge.slug)).resolves.toEqual(receivedTrack);

    // A different player/database receives the child through a self-contained
    // code and can complete the next full reward/publish round.
    const childCode = encodeChallengeLink(firstChild.challenge, null, receivedTrack);
    const secondPlayer = new DemoRepository(new MemoryDatabase());
    const secondChallenge = decodeChallengeLink(childCode);
    const secondTrack = decodeChallengeRuntimeTrack(childCode)!;
    await secondPlayer.importChallenge(secondChallenge, secondTrack);
    const secondChild = await finishAndPublish(secondPlayer, secondChallenge.slug);
    expect(secondChild.challenge.depth).toBe(2);
    await expect(secondPlayer.getChallengeRuntimeTrack(secondChild.challenge.slug)).resolves.toEqual(receivedTrack);

    // Publishing descendants cannot mutate what the original exact-version
    // link decodes to.
    expect(decodeChallengeLink(originalCode)).toEqual(received);
    expect(decodeChallengeRuntimeTrack(originalCode)).toEqual(receivedTrack);
  });

  it("fails closed on truncated and replay-corrupted payloads", () => {
    const items = generateRandomRoom(5555).filter((item) => !item.asset.startsWith("trap:"));
    const authored = runtimeMap(items, 99, 5555, "Map Author");
    const code = encodeChallengeLink(authored.challenge, null, authored.track);
    expect(() => decodeChallengeLink(code.slice(0, -5))).toThrow("CHALLENGE_LINK_INVALID");
    const replacement = code.at(-1) === "A" ? "B" : "A";
    expect(() => decodeChallengeLink(code.slice(0, -1) + replacement)).toThrow("CHALLENGE_LINK_INVALID");
  });

  // Deflating the deliberately huge fixture dominates this test's runtime.
  it("keeps only a generous pasted-data byte guard, not a map-piece count cap", { timeout: 20_000 }, () => {
    const items = generateRandomRoom(6666).filter((item) => !item.asset.startsWith("trap:"));
    const base = runtimeMap(items, 55, 6666, "Map Author");
    const bigTrack = (count: number) => ({
      ...base.track,
      pieces: Array.from({ length: count }, (_, index) => ({
        ...base.track.pieces[index % base.track.pieces.length]!,
        id: `huge-${index}`,
        center: [index * 2 + 0.123456789, index % 4 + 0.234567891, -index * 2 - 0.345678912] as const,
        size: [4.123456789, 0.654321987, 3.234567891] as const,
        color: `#${index.toString(16).padStart(6, "0")}`,
      })),
      zones: Array.from({ length: count }, (_, index) => ({
        id: `huge-zone-${index}`,
        label: `Huge surface ${index}`,
        minX: index + 0.123456789,
        maxX: index + 3.987654321,
        minZ: -index - 3.876543219,
        maxZ: -index - 0.234567891,
        groundY: index % 7 + 0.345678912,
        maxOccupants: 32,
        allowedTypes: base.track.zones[0]!.allowedTypes,
      })),
    });
    // A 10,000-piece room overflowed the old uncompressed format; compression
    // carries it comfortably, and encode's own self-check decodes it, so this
    // single call proves the round trip.
    expect(() => encodeChallengeLink(base.challenge, null, bigTrack(10_000))).not.toThrow();
    // The byte guard itself survives: a room past any sane authored size is
    // still refused at the sender, however well its bytes compress.
    expect(() => encodeChallengeLink(base.challenge, null, bigTrack(40_000))).toThrow(/too large/i);
  });
});
