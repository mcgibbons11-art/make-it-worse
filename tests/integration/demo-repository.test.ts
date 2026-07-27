import { describe, expect, it } from "vitest";
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { MemoryDatabase } from "@/lib/repository/demo-db";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { validatePlacement } from "@/lib/game/placement";
describe("demo repository viral loop", () => {
  it("serializes guest creation and demo challenge seeding", async () => {
    const repository = new DemoRepository(new MemoryDatabase());
    const [guest, challenge] = await Promise.all([
      repository.ensureGuest(),
      repository.getChallenge("demo-disaster"),
    ]);
    expect(guest.displayName.length).toBeGreaterThan(1);
    expect(challenge.slug).toBe("demo-disaster");
    const attempt = await repository.startAttempt({
      challengeSlug: challenge.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(attempt.attemptId).toBeTruthy();
  });

  it("creates an immutable idempotent child and share", async () => {
    const repository = new DemoRepository(new MemoryDatabase());
    const guest = await repository.ensureGuest();
    expect(guest.displayName.length).toBeGreaterThan(1);
    const root = await repository.createRootChain();
    const start = await repository.startAttempt({
      challengeSlug: root.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: crypto.randomUUID(),
    });
    const finished = await repository.finishAttempt({
      attemptId: start.attemptId,
      outcome: "completed",
      durationMs: 27000,
      maxProgress: 1,
      deathTrapInstanceId: null,
      ghostTrace: encodeGhostTrace([
        { x: 0, y: 1.25, z: 1.2, yaw: 0, flags: 1 },
      ]),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(finished.offeredTraps).toHaveLength(3);
    const type = finished.offeredTraps![0];
    const zone = PLACEMENT_ZONES.find(
      (candidate) =>
        candidate.allowedTypes.includes(type) &&
        validatePlacement(
          {
            type,
            zoneId: candidate.id,
            offsetX: 0,
            offsetZ: 0,
            rotationQuarterTurns: 0,
          },
          root.traps,
        ).valid,
    )!;
    const input = {
      parentSlug: root.slug,
      attemptId: start.attemptId,
      placement: {
        type,
        zoneId: zone.id,
        offsetX: 0,
        offsetZ: 0,
        rotationQuarterTurns: 0 as const,
      },
      idempotencyKey: crypto.randomUUID(),
    };
    const child = await repository.publishChild(input);
    const retry = await repository.publishChild({
      ...input,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(retry.challenge.slug).toBe(child.challenge.slug);
    expect(child.challenge.depth).toBe(1);
    expect(child.challenge.traps).toHaveLength(1);
    expect(root.traps).toHaveLength(0);
    expect(child.challenge.ghostTrace).not.toBeNull();
    const shareKey = crypto.randomUUID();
    const share = await repository.createShare({
      challengeSlug: child.challenge.slug,
      channel: "copy_link",
      idempotencyKey: shareKey,
    });
    const shareRetry = await repository.createShare({
      challengeSlug: child.challenge.slug,
      channel: "copy_link",
      idempotencyKey: shareKey,
    });
    expect(shareRetry.shareToken).toBe(share.shareToken);
    await repository.recordShareOpen({
      challengeSlug: child.challenge.slug,
      shareToken: share.shareToken,
    });
  });
  it("does not let a failed attempt publish", async () => {
    const repository = new DemoRepository(new MemoryDatabase());
    const root = await repository.createRootChain();
    const start = await repository.startAttempt({
      challengeSlug: root.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: crypto.randomUUID(),
    });
    await repository.finishAttempt({
      attemptId: start.attemptId,
      outcome: "fell",
      durationMs: 5000,
      maxProgress: 0.2,
      deathTrapInstanceId: null,
      ghostTrace: null,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      repository.publishChild({
        parentSlug: root.slug,
        attemptId: start.attemptId,
        placement: {
          type: "floor_fan",
          zoneId: "runway_front",
          offsetX: 0,
          offsetZ: 0,
          rotationQuarterTurns: 0,
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow("COMPLETION_REQUIRED");
  });
});
