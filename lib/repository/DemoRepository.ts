import { generatedName } from "@/lib/auth/names";
import { sanitizeDisplayName } from "@/lib/auth/profanity";
import { estimatedWorsePercent, smoothedSurvival } from "@/lib/game/difficulty";
import { validatePlacement } from "@/lib/game/placement";
import { challengeSchema, ghostTraceSchema } from "@/lib/game/schemas";
import { hashString, seededId } from "@/lib/game/seed";
import { chooseTraps } from "@/lib/game/trap-choice";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type {
  ChallengeDTO,
  CreateShareInput,
  CreateShareResult,
  FinishAttemptInput,
  GuestProfile,
  PublishChildInput,
  PublishChildResult,
  RecordShareOpenInput,
  StartAttemptInput,
  AttemptFinishResult,
  AttemptStartResult,
  TrapType,
} from "@/lib/game/types";
import type { GameRepository } from "./Repository";
import {
  BrowserDatabase,
  MemoryDatabase,
  type KeyValueDatabase,
} from "./demo-db";

interface DemoAttempt {
  id: string;
  challengeSlug: string;
  userId: string;
  outcome: "started" | "completed" | "fell" | "timeout" | "reset" | "quit";
  startedAt: number;
  durationMs: number | null;
  ghostTrace: FinishAttemptInput["ghostTrace"];
  offeredTraps: readonly [TrapType, TrapType, TrapType] | null;
  childSlug: string | null;
  finishKey: string | null;
}
interface DemoShare {
  token: string;
  challengeSlug: string;
  userId: string;
  channel: CreateShareInput["channel"];
  key: string;
  openedBy: string[];
}
interface DemoState {
  version: 1;
  guest: GuestProfile | null;
  challenges: Record<string, ChallengeDTO>;
  attempts: Record<string, DemoAttempt>;
  shares: Record<string, DemoShare>;
  rootKeys: Record<string, string>;
  attemptKeys: Record<string, string>;
}
const STATE_KEY = "state";
const empty = (): DemoState => ({
  version: 1,
  guest: null,
  challenges: {},
  attempts: {},
  shares: {},
  rootKeys: {},
  attemptKeys: {},
});
function uuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `00000000-0000-4000-8000-${Math.abs(
      hashString(`${Date.now()}:${performance.now()}`),
    )
      .toString(16)
      .padStart(12, "0")
      .slice(0, 12)}`
  );
}
function slug(prefix: string, seed: number): string {
  return `${prefix}-${Math.abs(seed).toString(36).padStart(8, "0").slice(0, 10)}`;
}
const baseStats = () => ({
  attempts: 0,
  completions: 0,
  survivalRate: null,
  bestTimeMs: null,
  recentAttempts: 0,
  shareCount: 0,
});

export class DemoRepository implements GameRepository {
  readonly mode = "demo" as const;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly db: KeyValueDatabase = typeof indexedDB === "undefined"
      ? new MemoryDatabase()
      : new BrowserDatabase(),
  ) {}
  private async state(): Promise<DemoState> {
    return (await this.db.get<DemoState>(STATE_KEY)) ?? empty();
  }
  private async save(state: DemoState): Promise<void> {
    await this.db.set(STATE_KEY, state);
  }
  private transact<T>(work: (state: DemoState) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.state();
      const result = await work(state);
      await this.save(state);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  async ensureGuest(): Promise<GuestProfile> {
    return this.transact((state) => {
      if (!state.guest) {
        const seed = Math.abs(hashString(uuid())) % 2_147_483_647;
        state.guest = {
          id: uuid(),
          displayName: generatedName(seed),
          avatarSeed: seed,
        };
      }
      return state.guest;
    });
  }
  async updateProfile(displayName: string): Promise<GuestProfile> {
    const guest = await this.ensureGuest();
    return this.transact((state) => {
      state.guest = { ...guest, displayName: sanitizeDisplayName(displayName) };
      return state.guest;
    });
  }
  private seededTrending(state: DemoState): void {
    if (state.challenges["demo-disaster"]) return;
    const traps: ChallengeDTO["traps"] = [];
    const types: readonly TrapType[] = [
      "floor_fan",
      "giant_beach_ball",
      "rotating_toilet",
    ];
    const zones = ["runway_mid", "bridge_front", "finish_front"] as const;
    for (let index = 0; index < 3; index += 1) {
      const type = types[index]!;
      const zoneId = zones[index]!;
      const valid = validatePlacement(
        {
          type,
          zoneId,
          offsetX: 0,
          offsetZ: 0,
          rotationQuarterTurns: (index === 0 ? 2 : index % 4) as 0 | 1 | 2 | 3,
        },
        traps,
      );
      if (!valid.valid) continue;
      traps.push({
        id: `demo-trap-${index}`,
        type,
        ownerUserId: null,
        ownerName: ["Wobbly Badger", "Turbo Otter", "Cheeky Kettle"][index]!,
        ownerAvatarSeed: 100 + index,
        depthAdded: index + 1,
        zoneId,
        position: valid.canonicalPosition,
        rotationY: valid.rotationY,
        seed: 1000 + index,
        params: TRAP_CATALOG[type].defaultParams,
      });
    }
    const challenge: ChallengeDTO = {
      id: "demo-trending",
      slug: "demo-disaster",
      chainId: "demo-chain",
      chainSlug: "demo-chain",
      parentSlug: null,
      depth: traps.length,
      baseSeed: 424242,
      levelVersion: 1,
      createdByName: "Cheeky Kettle",
      createdByAvatarSeed: 102,
      addedTrap: traps.at(-1) ?? null,
      traps,
      ghostTrace: null,
      stats: {
        attempts: 184,
        completions: 22,
        survivalRate: 22 / 184,
        bestTimeMs: 27310,
        recentAttempts: 31,
        shareCount: 47,
      },
      createdAt: new Date(0).toISOString(),
      isDemo: true,
    };
    state.challenges[challenge.slug] = challenge;
  }
  async listTrending(limit = 6): Promise<ChallengeDTO[]> {
    return this.transact((state) => {
      this.seededTrending(state);
      return Object.values(state.challenges)
        .sort(
          (a, b) =>
            b.stats.recentAttempts +
            b.stats.shareCount * 3 +
            b.depth -
            (a.stats.recentAttempts + a.stats.shareCount * 3 + a.depth),
        )
        .slice(0, limit)
        .map((entry) => challengeSchema.parse(entry));
    });
  }
  async getChallenge(challengeSlug: string): Promise<ChallengeDTO> {
    return this.transact((state) => {
      this.seededTrending(state);
      const challenge = state.challenges[challengeSlug];
      if (!challenge) throw new Error("CHALLENGE_NOT_FOUND");
      return challengeSchema.parse(challenge);
    });
  }
  async createRootChain(): Promise<ChallengeDTO> {
    const guest = await this.ensureGuest();
    return this.transact((state) => {
      const key = uuid();
      const seed = hashString(key);
      const challengeSlug = slug("fresh", seed);
      const challenge: ChallengeDTO = {
        id: uuid(),
        slug: challengeSlug,
        chainId: uuid(),
        chainSlug: slug("chain", seed),
        parentSlug: null,
        depth: 0,
        baseSeed: seed,
        levelVersion: 1,
        createdByName: guest.displayName,
        createdByAvatarSeed: guest.avatarSeed,
        addedTrap: null,
        traps: [],
        ghostTrace: null,
        stats: baseStats(),
        createdAt: new Date().toISOString(),
        isDemo: true,
      };
      state.challenges[challengeSlug] = challenge;
      state.rootKeys[key] = challengeSlug;
      return challenge;
    });
  }
  async startAttempt(input: StartAttemptInput): Promise<AttemptStartResult> {
    const guest = await this.ensureGuest();
    return this.transact((state) => {
      const challenge = state.challenges[input.challengeSlug];
      if (!challenge) throw new Error("CHALLENGE_NOT_FOUND");
      const existing = state.attemptKeys[input.idempotencyKey];
      if (existing)
        return {
          attemptId: existing,
          offeredTraps: state.attempts[existing]!.offeredTraps,
        };
      const attemptId = uuid();
      state.attempts[attemptId] = {
        id: attemptId,
        challengeSlug: challenge.slug,
        userId: guest.id,
        outcome: "started",
        startedAt: Date.now(),
        durationMs: null,
        ghostTrace: null,
        offeredTraps: null,
        childSlug: null,
        finishKey: null,
      };
      state.attemptKeys[input.idempotencyKey] = attemptId;
      challenge.stats = {
        ...challenge.stats,
        attempts: challenge.stats.attempts + 1,
        recentAttempts: challenge.stats.recentAttempts + 1,
      };
      return { attemptId, offeredTraps: null };
    });
  }
  async finishAttempt(input: FinishAttemptInput): Promise<AttemptFinishResult> {
    return this.transact((state) => {
      const attempt = state.attempts[input.attemptId];
      if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
      const challenge = state.challenges[attempt.challengeSlug]!;
      if (attempt.outcome !== "started")
        return {
          attemptId: attempt.id,
          outcome: attempt.outcome,
          offeredTraps: attempt.offeredTraps,
          stats: challenge.stats,
        };
      if (input.outcome === "completed" && !input.ghostTrace)
        throw new Error("GHOST_REQUIRED");
      if (input.ghostTrace) ghostTraceSchema.parse(input.ghostTrace);
      attempt.outcome = input.outcome;
      attempt.durationMs = input.durationMs;
      attempt.ghostTrace =
        input.outcome === "completed" ? input.ghostTrace : null;
      attempt.finishKey = input.idempotencyKey;
      if (input.outcome === "completed") {
        attempt.offeredTraps = chooseTraps(
          attempt.id,
          challenge.id,
          challenge.baseSeed,
          challenge.traps,
        );
        const completions = challenge.stats.completions + 1;
        challenge.stats = {
          ...challenge.stats,
          completions,
          survivalRate: smoothedSurvival(completions, challenge.stats.attempts),
          bestTimeMs:
            challenge.stats.bestTimeMs === null
              ? input.durationMs
              : Math.min(challenge.stats.bestTimeMs, input.durationMs),
        };
      }
      return {
        attemptId: attempt.id,
        outcome: input.outcome,
        offeredTraps: attempt.offeredTraps,
        stats: challenge.stats,
      };
    });
  }
  async publishChild(input: PublishChildInput): Promise<PublishChildResult> {
    const guest = await this.ensureGuest();
    return this.transact((state) => {
      const parent = state.challenges[input.parentSlug];
      const attempt = state.attempts[input.attemptId];
      if (
        !parent ||
        !attempt ||
        attempt.challengeSlug !== parent.slug ||
        attempt.userId !== guest.id
      )
        throw new Error("INVALID_ATTEMPT");
      if (
        attempt.outcome !== "completed" ||
        !attempt.offeredTraps?.includes(input.placement.type)
      )
        throw new Error("COMPLETION_REQUIRED");
      if (attempt.childSlug) {
        const child = state.challenges[attempt.childSlug]!;
        return {
          challenge: child,
          attributedShareUrl: `/c/${child.slug}`,
          estimatedWorsePercent: estimatedWorsePercent(
            parent.traps,
            child.traps,
          ),
        };
      }
      const valid = validatePlacement(input.placement, parent.traps);
      if (!valid.valid) throw new Error(`INVALID_PLACEMENT:${valid.reason}`);
      const seed = hashString(
        `${attempt.id}:${input.placement.type}:${input.placement.zoneId}`,
      );
      const trap = {
        id: seededId("trap", seed),
        type: input.placement.type,
        ownerUserId: guest.id,
        ownerName: guest.displayName,
        ownerAvatarSeed: guest.avatarSeed,
        depthAdded: parent.depth + 1,
        zoneId: input.placement.zoneId,
        position: valid.canonicalPosition,
        rotationY: valid.rotationY,
        seed,
        params: TRAP_CATALOG[input.placement.type].defaultParams,
      };
      const challengeSlug = slug("worse", hashString(input.idempotencyKey));
      const child: ChallengeDTO = {
        ...parent,
        id: uuid(),
        slug: challengeSlug,
        parentSlug: parent.slug,
        depth: parent.depth + 1,
        createdByName: guest.displayName,
        createdByAvatarSeed: guest.avatarSeed,
        addedTrap: trap,
        traps: [...parent.traps, trap],
        ghostTrace: attempt.ghostTrace,
        stats: baseStats(),
        createdAt: new Date().toISOString(),
      };
      state.challenges[child.slug] = child;
      attempt.childSlug = child.slug;
      return {
        challenge: child,
        attributedShareUrl: `/c/${child.slug}`,
        estimatedWorsePercent: estimatedWorsePercent(parent.traps, child.traps),
      };
    });
  }
  async createShare(input: CreateShareInput): Promise<CreateShareResult> {
    const guest = await this.ensureGuest();
    return this.transact((state) => {
      const existing = Object.values(state.shares).find(
        (share) =>
          share.key === input.idempotencyKey && share.userId === guest.id,
      );
      if (existing)
        return {
          shareToken: existing.token,
          url: `/c/${existing.challengeSlug}?s=${existing.token}`,
        };
      const challenge = state.challenges[input.challengeSlug];
      if (!challenge) throw new Error("CHALLENGE_NOT_FOUND");
      const token = seededId("s", hashString(input.idempotencyKey));
      state.shares[token] = {
        token,
        challengeSlug: challenge.slug,
        userId: guest.id,
        channel: input.channel,
        key: input.idempotencyKey,
        openedBy: [],
      };
      challenge.stats = {
        ...challenge.stats,
        shareCount: challenge.stats.shareCount + 1,
      };
      return { shareToken: token, url: `/c/${challenge.slug}?s=${token}` };
    });
  }
  async recordShareOpen(input: RecordShareOpenInput): Promise<void> {
    const guest = await this.ensureGuest();
    await this.transact((state) => {
      const share = state.shares[input.shareToken];
      if (
        !share ||
        share.challengeSlug !== input.challengeSlug ||
        share.userId === guest.id
      )
        return;
      if (!share.openedBy.includes(guest.id)) share.openedBy.push(guest.id);
    });
  }
  async resetDemoData(): Promise<void> {
    await this.db.clear();
  }
}
