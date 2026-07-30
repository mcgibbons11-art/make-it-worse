import { z } from "zod";
import {
  decodeChallengeAvatar,
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
} from "./challenge-link";
import type { AvatarConfig } from "./avatar";
import type { ChallengeDTO } from "./types";
import type { BuiltTrack } from "./track";

export const CUSTOM_MAP_SCHEMA_VERSION = 1;
export const CUSTOM_MAP_CODE_MAX_LENGTH = 8_000;
export const CUSTOM_MAP_PAGE_SIZE = 12;

export const customMapVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export const customMapModerationSchema = z.enum(["active", "quarantined", "rejected"]);
export const customMapSortSchema = z.enum(["trending", "new"]);
export const customMapEventTypeSchema = z.enum([
  "impression",
  "start",
  "clear",
  "like",
  "share",
]);
export const customMapReportReasonSchema = z.enum([
  "unsafe",
  "hate",
  "harassment",
  "sexual",
  "personal_information",
  "spam",
  "broken",
  "other",
]);

export type CustomMapVisibility = z.infer<typeof customMapVisibilitySchema>;
export type CustomMapModeration = z.infer<typeof customMapModerationSchema>;
export type CustomMapSort = z.infer<typeof customMapSortSchema>;
export type CustomMapEventType = z.infer<typeof customMapEventTypeSchema>;
export type CustomMapReportReason = z.infer<typeof customMapReportReasonSchema>;

const mapIdSchema = z.uuid();
const versionIdSchema = z.uuid();
const dateSchema = z.iso.datetime();
const challengeSlugSchema = z.string().regex(/^[a-z0-9-]{6,24}$/);
const unsafeCommunityText = /https?:\/\/|www\.|fuck|shit|cunt|nigg|fagg/i;
const safeCommunityText = (value: string) =>
  !/[\u0000-\u001f\u007f]/.test(value) && !unsafeCommunityText.test(value);
const titleSchema = z.string().trim().min(2).max(80).refine(safeCommunityText, "Title contains blocked text");
const descriptionSchema = z.string().trim().max(280).refine(safeCommunityText, "Description contains blocked text");

export const customMapVersionSchema = z.object({
  id: versionIdSchema,
  number: z.number().int().positive(),
  schemaVersion: z.literal(CUSTOM_MAP_SCHEMA_VERSION),
  challengeSlug: challengeSlugSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  pieceCount: z.number().int().min(1).max(96),
  trapCount: z.number().int().min(0).max(20),
  playable: z.boolean(),
  createdAt: dateSchema,
}).strict();

export const customMapMetricsSchema = z.object({
  impressions: z.number().int().nonnegative(),
  starts: z.number().int().nonnegative(),
  clears: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
}).strict();

export const customMapSummarySchema = z.object({
  id: mapIdSchema,
  title: titleSchema,
  description: descriptionSchema,
  visibility: customMapVisibilitySchema,
  moderationStatus: customMapModerationSchema,
  ownerName: z.string().min(2).max(24),
  ownerAvatarSeed: z.number().int().min(0).max(2_147_483_647),
  currentVersion: customMapVersionSchema,
  metrics: customMapMetricsSchema,
  trendingScore: z.number().finite(),
  isOwner: z.boolean(),
  canModerate: z.boolean(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  publishedAt: dateSchema,
}).strict();

export const customMapDetailSchema = customMapSummarySchema.extend({
  code: z.string().min(1).max(CUSTOM_MAP_CODE_MAX_LENGTH),
  versions: z.array(customMapVersionSchema).min(1).max(100),
}).strict();

export const customMapBrowseResponseSchema = z.object({
  items: z.array(customMapSummarySchema).max(24),
  nextCursor: z.string().max(200).nullable(),
}).strict();

export const customMapBrowseQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  sort: customMapSortSchema.default("trending"),
  limit: z.coerce.number().int().min(1).max(24).default(CUSTOM_MAP_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
  mine: z.union([z.literal("0"), z.literal("1")]).default("0"),
}).strict();

export const customMapPublishRequestSchema = z.object({
  mapId: mapIdSchema.optional(),
  expectedCurrentVersionId: versionIdSchema.nullable().optional(),
  title: titleSchema,
  description: descriptionSchema.default(""),
  visibility: customMapVisibilitySchema,
  code: z.string().min(1).max(CUSTOM_MAP_CODE_MAX_LENGTH),
}).strict().superRefine((input, context) => {
  try {
    const decoded = validateCustomMapCode(input.code);
    if (!decoded.track.pieces.length || decoded.track.pieces.length > 96)
      context.addIssue({ code: "custom", path: ["code"], message: "Map piece count is outside the supported range" });
  } catch {
    context.addIssue({ code: "custom", path: ["code"], message: "Map code is invalid or is not an authored room" });
  }
});

export const customMapMetadataRequestSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  visibility: customMapVisibilitySchema.optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Provide at least one field");

export const customMapRollbackRequestSchema = z.object({
  versionId: versionIdSchema,
}).strict();

export const customMapEventRequestSchema = z.object({
  versionId: versionIdSchema,
  type: customMapEventTypeSchema,
}).strict();

export const customMapReportRequestSchema = z.object({
  versionId: versionIdSchema,
  reason: customMapReportReasonSchema,
  note: z.string().trim().max(500).default(""),
}).strict();

export const customMapModerationRequestSchema = z.object({
  status: customMapModerationSchema,
  versionId: versionIdSchema.optional(),
  note: z.string().trim().max(500).default(""),
}).strict();

export interface ValidatedCustomMapCode {
  challenge: ChallengeDTO;
  track: BuiltTrack;
  avatar: AvatarConfig | null;
  pieceCount: number;
  trapCount: number;
}

/** Mirrors the SQL ranking formula for previews and deterministic tests. */
export function customMapTrendingScore(
  metrics: CustomMapMetrics,
  publishedAt: string,
  nowMs = Date.now(),
): number {
  const impressionsGate = metrics.impressions < 5 ? 0.25 : 1;
  const smoothedClearQuality = (metrics.clears + 1) / (metrics.starts + 4);
  const raw = metrics.starts + 3 * metrics.clears + 5 * metrics.likes +
    4 * metrics.shares - 8 * metrics.reports + 4 * smoothedClearQuality;
  const publishedMs = Date.parse(publishedAt);
  const ageSeconds = Number.isFinite(publishedMs)
    ? Math.max(0, (nowMs - publishedMs) / 1_000)
    : 0;
  return impressionsGate * raw * Math.exp(-ageSeconds / 604_800);
}

/**
 * Decodes through the same hardened path a recipient uses. This proves the
 * stored payload is playable now, not merely shaped like base64 text.
 */
export function validateCustomMapCode(code: string): ValidatedCustomMapCode {
  if (!code || code.length > CUSTOM_MAP_CODE_MAX_LENGTH)
    throw new Error("CUSTOM_MAP_CODE_INVALID");
  const challenge = decodeChallengeLink(code);
  const track = decodeChallengeRuntimeTrack(code);
  if (!track) throw new Error("CUSTOM_MAP_REQUIRES_AUTHORED_ROOM");
  return {
    challenge,
    track,
    avatar: decodeChallengeAvatar(code),
    pieceCount: track.pieces.length,
    trapCount: challenge.traps.length,
  };
}

export type CustomMapVersion = z.infer<typeof customMapVersionSchema>;
export type CustomMapMetrics = z.infer<typeof customMapMetricsSchema>;
export type CustomMapSummary = z.infer<typeof customMapSummarySchema>;
export type CustomMapDetail = z.infer<typeof customMapDetailSchema>;
export type CustomMapBrowseResponse = z.infer<typeof customMapBrowseResponseSchema>;
export type CustomMapPublishInput = z.input<typeof customMapPublishRequestSchema>;
export type CustomMapMetadataInput = z.input<typeof customMapMetadataRequestSchema>;

export interface CustomMapBrowseInput {
  q?: string;
  sort?: CustomMapSort;
  limit?: number;
  cursor?: string;
  mine?: boolean;
}
