import { describe, expect, it } from "vitest";
import { DemoRepository } from "@/lib/repository/DemoRepository";
import { MemoryDatabase } from "@/lib/repository/demo-db";
import { encodeGhostTrace } from "@/lib/game/replay-codec";
import { challengeTrack, firstLegalPlacement } from "@/lib/game/trap-choice";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
describe("demo repository viral loop", () => {
  it("persists authored-room geometry across repository reloads and child rounds", async () => {
    const database = new MemoryDatabase();
    const runtime = runtimeMap(generateRandomRoom(54321), 77, 54321, "Room Author");
    const firstSession = new DemoRepository(database);
    const challenge = await firstSession.importChallenge(runtime.challenge, runtime.track);

    const secondSession = new DemoRepository(database);
    await expect(secondSession.getChallengeRuntimeTrack(challenge.slug)).resolves.toEqual(runtime.track);
    const started = await secondSession.startAttempt({
      challengeSlug: challenge.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: crypto.randomUUID(),
    });
    const finished = await secondSession.finishAttempt({
      attemptId: started.attemptId,
      outcome: "completed",
      durationMs: 9000,
      maxProgress: 1,
      deathTrapInstanceId: null,
      ghostTrace: encodeGhostTrace([{ x: 0, y: 1.25, z: 2, yaw: 0, flags: 1 }]),
      idempotencyKey: crypto.randomUUID(),
    });
    const placement = firstLegalPlacement(runtime.track, finished.offeredTraps![0], challenge.traps);
    expect(placement).not.toBeNull();
    const child = await secondSession.publishChild({
      parentSlug: challenge.slug,
      attemptId: started.attemptId,
      placement: placement!,
      idempotencyKey: crypto.randomUUID(),
    });

    const recipientSession = new DemoRepository(database);
    await expect(recipientSession.getChallengeRuntimeTrack(child.challenge.slug)).resolves.toEqual(runtime.track);
  });

  it("completes and extends a generated clean-room track", async () => {
    const repository = new DemoRepository(new MemoryDatabase());
    const runtime = runtimeMap(generateRandomRoom(98765), 44, 98765);
    const challenge = await repository.importChallenge(runtime.challenge, runtime.track);
    const started = await repository.startAttempt({
      challengeSlug: challenge.slug,
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: crypto.randomUUID(),
    });
    const finished = await repository.finishAttempt({
      attemptId: started.attemptId,
      outcome: "completed",
      durationMs: 12000,
      maxProgress: 1,
      deathTrapInstanceId: null,
      ghostTrace: encodeGhostTrace([{ x: 0, y: 1.25, z: 2, yaw: 0, flags: 1 }]),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(finished.offeredTraps).toHaveLength(3);
    const type = finished.offeredTraps![0];
    const placement = firstLegalPlacement(runtime.track, type, challenge.traps);
    expect(placement).not.toBeNull();
    const child = await repository.publishChild({
      parentSlug: challenge.slug,
      attemptId: started.attemptId,
      placement: placement!,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(child.challenge.depth).toBe(challenge.depth + 1);
  });
  it("persists every concurrent write, not only the one that saved last", async () => {
    // Each repository call reads the whole state, mutates its own copy, and
    // writes it back, so four of them running at once are four read-modify-write
    // cycles over one key. Only the serialising queue stops the slowest one from
    // saving a snapshot taken before the other three existed. Return values
    // cannot show that: every call returns the object it just built whether or
    // not the save survived, which is why the assertions that matter below run
    // through a second repository reading the same database back.
    const database = new MemoryDatabase();
    const repository = new DemoRepository(database);
    const attemptKey = crypto.randomUUID();
    const [guest, root, demo, attempt] = await Promise.all([
      repository.ensureGuest(),
      repository.createRootChain(),
      repository.getChallenge("demo-disaster"),
      repository.startAttempt({
        challengeSlug: "demo-disaster",
        clientSessionId: crypto.randomUUID(),
        deviceClass: "desktop",
        buildVersion: "test",
        idempotencyKey: attemptKey,
      }),
    ]);
    expect(guest.displayName.length).toBeGreaterThan(1);
    expect(demo.slug).toBe("demo-disaster");
    expect(attempt.attemptId).toBeTruthy();

    const reread = new DemoRepository(database);
    expect((await reread.ensureGuest()).id).toBe(guest.id);
    await expect(reread.getChallenge(root.slug)).resolves.toMatchObject({
      slug: root.slug,
      depth: 0,
    });
    // The attempt counter is the write most easily lost: the demo challenge is
    // seeded by one call and incremented by another, so a clobbered save leaves
    // the seeded 184 behind with no error anywhere.
    const seeded = await reread.getChallenge("demo-disaster");
    expect(seeded.stats.attempts).toBe(demo.stats.attempts + 1);
    // Replaying the idempotency key has to find the stored attempt rather than
    // open a second one.
    const replay = await reread.startAttempt({
      challengeSlug: "demo-disaster",
      clientSessionId: crypto.randomUUID(),
      deviceClass: "desktop",
      buildVersion: "test",
      idempotencyKey: attemptKey,
    });
    expect(replay.attemptId).toBe(attempt.attemptId);
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
    // Resolved against this chain's own track rather than the classic zone
    // table: a fresh chain is composed from the segment catalogue now, so the
    // classic zone ids are not necessarily on it. Using the production search
    // also means this test breaks if the offer and the placement rules ever
    // disagree again, which is the failure it should be sensitive to.
    const placement = firstLegalPlacement(challengeTrack(root), type, root.traps);
    expect(placement, `no legal placement for the offered ${type}`).not.toBeNull();
    const input = {
      parentSlug: root.slug,
      attemptId: start.attemptId,
      placement: placement!,
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
    // The placement here is scaffolding: the subject is the completion gate, so
    // it has to be a LEGAL placement or the call is rejected for the wrong
    // reason and the test passes without exercising the gate at all. A fresh
    // chain no longer sits on the classic course, so the zone is resolved
    // against whatever track this chain actually got.
    const legal = firstLegalPlacement(challengeTrack(root), "floor_fan", []);
    expect(legal, "no legal floor_fan placement on a fresh course").not.toBeNull();
    await expect(
      repository.publishChild({
        parentSlug: root.slug,
        attemptId: start.attemptId,
        placement: legal!,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow("COMPLETION_REQUIRED");
  });
});
