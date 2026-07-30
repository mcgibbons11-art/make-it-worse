import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import {
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { firstLegalPlacement } from "@/lib/game/trap-choice";
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

  it("refuses authored rooms that exceed the bounded challenge-code channel", () => {
    const items = generateRandomRoom(6666).filter((item) => !item.asset.startsWith("trap:"));
    const base = runtimeMap(items, 55, 6666, "Map Author");
    const pieces = Array.from({ length: 96 }, (_, index) => ({
      ...base.track.pieces[index % base.track.pieces.length]!,
      id: `huge-${index}`,
      center: [index * 2 + 0.123456789, index % 4 + 0.234567891, -index * 2 - 0.345678912] as const,
      size: [4.123456789, 0.654321987, 3.234567891] as const,
      color: `#${index.toString(16).padStart(6, "0")}`,
    }));
    const zones = Array.from({ length: 96 }, (_, index) => ({
      id: `huge-zone-${index}`,
      label: `Huge surface ${index}`,
      minX: index + 0.123456789,
      maxX: index + 3.987654321,
      minZ: -index - 3.876543219,
      maxZ: -index - 0.234567891,
      groundY: index % 7 + 0.345678912,
      maxOccupants: 32,
      allowedTypes: base.track.zones[0]!.allowedTypes,
    }));
    const huge = { ...base.track, pieces, zones };
    expect(() => encodeChallengeLink(base.challenge, null, huge)).toThrow(/too large/i);
  });
});
