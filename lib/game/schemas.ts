import { z } from "zod";
import { MAX_TRAPS } from "./constants";
import { MAX_TRACK_SEGMENTS } from "./track";
import { TRAP_TYPES } from "./trap-catalog";
import type { TrapType } from "./types";

const finite = z.number().refine(Number.isFinite, "Must be finite");
// Derived from the catalogue rather than restated. When the roster grew from 8
// to 16 this literal was missed, so every reward offering one of the new traps
// decoded and rendered fine and then failed at the storage boundary: the child
// was written without validation, after which getChallenge and listTrending
// threw permanently. A player bricked their own save by playing normally.
export const trapTypeSchema = z.enum(TRAP_TYPES as unknown as [TrapType, ...TrapType[]]);
// Every bound below that mirrors a gameplay limit is imported for the same
// reason. A restated literal fails in exactly the way described above: nothing
// validates on the way in, so raising MAX_TRAPS or MAX_TRACK_SEGMENTS would let
// a level publish and then throw forever on read.
export const vec3Schema = z.tuple([finite, finite, finite]);
export const ghostTraceSchema = z.object({ version: z.literal(1), hz: z.literal(15), durationMs: z.number().int().min(0).max(60_000), frames: z.array(z.array(z.number().int().min(-1_000_000).max(1_000_000)).length(5)).max(900) }).strict().superRefine((trace, context) => { if (Math.abs(trace.frames.length / 15 * 1000 - trace.durationMs) > 1100) context.addIssue({ code: "custom", message: "Trace duration does not match frame count" }); });
export const trapPlacementSchema = z.object({ type: trapTypeSchema, zoneId: z.string().min(2).max(40), offsetX: finite, offsetZ: finite, rotationQuarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }).strict();
export const trapInstanceSchema = z.object({ id: z.string().min(3), type: trapTypeSchema, ownerUserId: z.string().nullable(), ownerName: z.string().min(2).max(24), ownerAvatarSeed: z.number().int(), depthAdded: z.number().int().min(1).max(MAX_TRAPS), zoneId: z.string(), position: vec3Schema, rotationY: finite, seed: z.number().int(), params: z.record(z.string(), z.union([z.number().refine(Number.isFinite), z.boolean(), z.string()])) }).strict();
export const challengeStatsSchema = z.object({ attempts: z.number().int().nonnegative(), completions: z.number().int().nonnegative(), survivalRate: z.number().min(0).max(1).nullable(), bestTimeMs: z.number().int().nonnegative().nullable(), recentAttempts: z.number().int().nonnegative(), shareCount: z.number().int().nonnegative() }).strict();
/** A composed course as it crosses the wire: segment ids, bounded both ways. One definition, used by the challenge payload and by the create-chain route, so the two cannot drift. */
export const trackSchema = z.array(z.string().min(2).max(24)).min(1).max(MAX_TRACK_SEGMENTS);
export const challengeSchema = z.object({ id: z.string(), slug: z.string().regex(/^[a-z0-9-]{6,24}$/), chainId: z.string(), chainSlug: z.string(), parentSlug: z.string().nullable(), depth: z.number().int().min(0).max(MAX_TRAPS), baseSeed: z.number().int(), levelVersion: z.literal(1), createdByName: z.string().min(2).max(24), createdByAvatarSeed: z.number().int(), addedTrap: trapInstanceSchema.nullable(), traps: z.array(trapInstanceSchema).max(MAX_TRAPS), ghostTrace: ghostTraceSchema.nullable(), stats: challengeStatsSchema, createdAt: z.iso.datetime(), isDemo: z.boolean(), track: trackSchema.optional() }).strict().superRefine((challenge, context) => { if (challenge.traps.length !== challenge.depth) context.addIssue({ code: "custom", message: "Trap snapshot must equal depth" }); });
export const displayNameSchema = z.string().trim().min(2).max(24).refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "Control characters are not allowed").refine((name) => !/https?:\/\/|www\./i.test(name), "Links are not allowed").refine((name) => /[\p{L}\p{N}]/u.test(name), "Use at least one letter or number");
export const finishAttemptSchema = z.object({ attemptId: z.string(), outcome: z.enum(["completed", "fell", "timeout", "reset", "quit"]), durationMs: z.number().int().min(0).max(90_000), maxProgress: finite.min(0).max(1.1), deathTrapInstanceId: z.string().nullable(), ghostTrace: ghostTraceSchema.nullable(), idempotencyKey: z.uuid() }).strict();
