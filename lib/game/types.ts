export type TrapType =
  | "swinging_hammer"
  | "rolling_fridge"
  | "floor_fan"
  | "soap_slick"
  | "spring_pad"
  | "angry_vacuum"
  | "rotating_toilet"
  | "giant_beach_ball";

export type GamePhase = "booting" | "intro" | "ready" | "playing" | "failed" | "finished" | "choosing_trap" | "placing_trap" | "publishing" | "sharing" | "paused" | "fatal_error";
export type AttemptOutcome = "started" | "completed" | "fell" | "timeout" | "reset" | "quit";
export type DeviceClass = "desktop" | "tablet" | "mobile" | "unknown";
export type Vec3Tuple = readonly [number, number, number];

export interface TrapPlacementInput { type: TrapType; zoneId: string; offsetX: number; offsetZ: number; rotationQuarterTurns: 0 | 1 | 2 | 3; }
export interface TrapInstance {
  id: string; type: TrapType; ownerUserId: string | null; ownerName: string; ownerAvatarSeed: number;
  depthAdded: number; zoneId: string; position: Vec3Tuple; rotationY: number; seed: number;
  params: Record<string, number | boolean | string>;
}
export interface GhostTrace { version: 1; hz: 15; durationMs: number; frames: number[][]; }
export interface ChallengeStats { attempts: number; completions: number; survivalRate: number | null; bestTimeMs: number | null; recentAttempts: number; shareCount: number; }
export interface ChallengeDTO {
  id: string; slug: string; chainId: string; chainSlug: string; parentSlug: string | null; depth: number;
  baseSeed: number; levelVersion: 1; createdByName: string; createdByAvatarSeed: number;
  addedTrap: TrapInstance | null; traps: TrapInstance[]; ghostTrace: GhostTrace | null;
  stats: ChallengeStats; createdAt: string; isDemo: boolean;
}
export interface GuestProfile { id: string; displayName: string; avatarSeed: number; }
export interface AttemptStartResult { attemptId: string; offeredTraps: readonly [TrapType, TrapType, TrapType] | null; }
export interface AttemptFinishResult { attemptId: string; outcome: Exclude<AttemptOutcome, "started">; offeredTraps: readonly [TrapType, TrapType, TrapType] | null; stats: ChallengeStats; }
export interface PublishChildResult { challenge: ChallengeDTO; attributedShareUrl: string; estimatedWorsePercent: number; }
export interface StartAttemptInput { challengeSlug: string; clientSessionId: string; deviceClass: DeviceClass; buildVersion: string; idempotencyKey: string; shareToken?: string; }
export interface FinishAttemptInput { attemptId: string; outcome: Exclude<AttemptOutcome, "started">; durationMs: number; maxProgress: number; deathTrapInstanceId: string | null; ghostTrace: GhostTrace | null; idempotencyKey: string; }
export interface PublishChildInput { parentSlug: string; attemptId: string; placement: TrapPlacementInput; idempotencyKey: string; }
export type ShareChannel = "web_share" | "copy_link" | "share_image" | "share_clip" | "unknown";
export interface CreateShareInput { challengeSlug: string; channel: ShareChannel; idempotencyKey: string; }
export interface CreateShareResult { shareToken: string; url: string; }
export interface RecordShareOpenInput { shareToken: string; challengeSlug: string; }
export interface PlacementZone { id: string; label: string; minX: number; maxX: number; minZ: number; maxZ: number; groundY: number; maxOccupants: number; allowedTypes: readonly TrapType[]; }
export type PlacementValidation = { valid: true; canonicalPosition: Vec3Tuple; rotationY: number } | { valid: false; reason: "outside_zone" | "type_not_allowed" | "zone_full" | "overlaps_trap" | "blocks_spawn" | "blocks_exit" | "unsafe_sweep" | "invalid_number"; message: string; };
export interface HazardContact { trapInstanceId: string; trapType: TrapType; ownerName: string; contactedAtMs: number; impulseMagnitude: number; }
export interface DecodedGhostSample { x: number; y: number; z: number; yaw: number; flags: number; }
