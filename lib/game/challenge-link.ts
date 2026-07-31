// Self-contained challenge links.
//
// A challenge only exists in its creator's IndexedDB, so a bare /c/<slug> link
// resolves to nothing on the recipient's device. Encoding the whole challenge
// into the link removes the shared-storage requirement entirely: the level
// travels inside the URL.
//
// The payload stores placement inputs rather than world positions, which keeps
// it short and lets decode rebuild positions through validatePlacement. Any
// link describing a level the game itself would have refused to build is
// rejected, so a hand-crafted URL cannot smuggle in an unplayable level.

import { z } from "zod";
import { sanitizeDisplayName } from "@/lib/auth/profanity";
import {
  AVATAR_TUPLE_BOUNDS,
  avatarFromTuple,
  avatarToTuple,
  colorRejection,
  isReadableAvatar,
} from "./avatar";
import { zoneCenter } from "./level-definition";
import { placementSurfaces, validatePlacement } from "./placement";
import { seededId } from "./seed";
import {
  CLASSIC_TRACK,
  MAX_TRACK_SEGMENTS,
  buildTrack,
  isPlayableTrack,
} from "./track";
import { TRAP_CATALOG, TRAP_TYPES } from "./trap-catalog";
import type { AvatarConfig } from "./avatar";
import type { BuiltTrack } from "./track";
import type { ChallengeDTO, PlacementZone, TrapInstance } from "./types";

export const CHALLENGE_LINK_PARAM = "d";
// Portals' multiplayer relay is 8 KB per message, but cross-session custom
// maps travel by copy/paste and are not URLs. Keeping the old relay ceiling
// here imposed a map-design limit on the builder for no reason. A generous
// byte guard still protects the recipient parser from hostile pasted input;
// same-session delivery independently falls back when it cannot relay a code.
export const CHALLENGE_CODE_MAX_LENGTH = 1_000_000;
const MAX_NAMES = 64;
// Offsets are stored in grid steps so they survive as small integers.
const GRID_STEPS_PER_UNIT = 4;
const MAX_GRID_STEPS = 200;
// A normal post-clear trap stays close to its placement surface. Authored-room
// traps are deliberately free-placeable across the builder's 2,000-unit work
// plane, so using that ordinary 50-unit bound made the sender create a code the
// recipient decoder rejected. The runtime track itself remains bounded below.
const MAX_AUTHORED_GRID_STEPS = 800_000;

const SAFE_NAME = /^[\p{L}\p{N} '._-]+$/u;

const nameSchema = z
  .string()
  .min(2)
  .max(24)
  .refine(
    (name) => SAFE_NAME.test(name),
    "Only letters, numbers, spaces, and . _ - are allowed",
  );

// [typeIndex, zoneIndex, offsetXSteps, offsetZSteps, quarterTurns, nameIndex,
//  ownerAvatarSeed, seed]
function trapTupleSchema(maxGridSteps: number) {
  return z.tuple([
  z.number().int().min(0).max(TRAP_TYPES.length - 1),
  // A composed track can expose more zones than the fixed course, so the real
  // bound is the decoded track's own zone count, checked below.
  z.number().int().nonnegative(),
  z.number().int().min(-maxGridSteps).max(maxGridSteps),
  z.number().int().min(-maxGridSteps).max(maxGridSteps),
  z.number().int().min(0).max(3),
  z.number().int().min(0).max(MAX_NAMES - 1),
  z.number().int(),
  z.number().int(),
  ]);
}

const ordinaryTrapTupleSchema = trapTupleSchema(MAX_GRID_STEPS);
const authoredTrapTupleSchema = trapTupleSchema(MAX_AUTHORED_GRID_STEPS);

// Version 1 carried only traps on the fixed course. Version 2 appends the
// track, so a custom course travels in the link too. Both still decode.
const basePayloadPrefix = [
  z.string().regex(/^[a-z0-9-]{6,24}$/),
  z.number().int(),
  z.number().int().min(0).max(MAX_NAMES - 1),
  z.number().int(),
  z.array(nameSchema).min(1).max(MAX_NAMES),
] as const;

const ordinaryBasePayload = [
  ...basePayloadPrefix,
  z.array(ordinaryTrapTupleSchema).max(20),
] as const;

const authoredBasePayload = [
  ...basePayloadPrefix,
  z.array(authoredTrapTupleSchema),
] as const;

// [attempts, completions, bestTimeMs] of the challenge being sent. Zeroing
// these meant every recipient read "0 attempts, No survival data yet" — social
// proof replaced with the one line that says nobody has played this.
const statsTuple = z.tuple([
  z.number().int().min(0).max(1_000_000),
  z.number().int().min(0).max(1_000_000),
  z.number().int().min(0).max(90_000).nullable(),
]);

// [bodyColour, packColour, headwear, face] of the creator's runner. Four small
// integers because the recipient plays the sender's runner, and a challenge
// from a stranger whose figure is nobody in particular is a challenge with
// nothing personal riding on it.
const avatarTuple = z.tuple(
  AVATAR_TUPLE_BOUNDS.map((max) => z.number().int().min(0).max(max)) as [
    z.ZodNumber,
    z.ZodNumber,
    z.ZodNumber,
    z.ZodNumber,
  ],
);

const trackSchema = z
  .array(z.string().min(2).max(24))
  .min(1)
  .max(MAX_TRACK_SEGMENTS);

const runtimeNumber = z.number().finite().min(-100_000).max(100_000);
const runtimePieceSchema = z.tuple([
  runtimeNumber, runtimeNumber, runtimeNumber,
  z.number().finite().min(0.02).max(2_048),
  z.number().finite().min(0.02).max(2_048),
  z.number().finite().min(0.02).max(2_048),
  z.string().regex(/^#[0-9a-f]{6}$/i),
  z.number().finite().min(-Math.PI * 2).max(Math.PI * 2),
]);
const runtimeZoneSchema = z.tuple([
  runtimeNumber, runtimeNumber, runtimeNumber, runtimeNumber, runtimeNumber,
  z.number().int().min(1).max(32),
  z.string().regex(/^[0-9a-f]{1,32}$/),
]);
const runtimeTrackSchema = z.tuple([
  z.array(runtimePieceSchema).min(1),
  z.array(runtimeZoneSchema).min(1),
  z.tuple([runtimeNumber, runtimeNumber, runtimeNumber]),
  z.tuple([runtimeNumber, runtimeNumber, runtimeNumber]),
  z.number().finite().min(1).max(200_000),
]);

const payloadSchema = z.union([
  z.tuple([z.literal(1), ...ordinaryBasePayload]),
  z.tuple([z.literal(2), ...ordinaryBasePayload, trackSchema]),
  z.tuple([z.literal(3), ...ordinaryBasePayload, trackSchema, statsTuple]),
  z.tuple([
    z.literal(4),
    ...ordinaryBasePayload,
    trackSchema,
    statsTuple,
    avatarTuple,
  ]),
  z.tuple([
    z.literal(5),
    ...authoredBasePayload,
    runtimeTrackSchema,
    statsTuple,
    avatarTuple.nullable(),
  ]),
]);

type Payload = z.infer<typeof payloadSchema>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(payload: string): string {
  const standard = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(standard + padding);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function allowedMask(types: readonly (typeof TRAP_TYPES)[number][]): string {
  let mask = BigInt(0);
  for (const type of types) {
    const index = TRAP_TYPES.indexOf(type);
    if (index >= 0) mask |= BigInt(1) << BigInt(index);
  }
  return mask.toString(16);
}

function runtimeTuple(track: BuiltTrack): z.infer<typeof runtimeTrackSchema> {
  return [
    track.pieces.map((piece) => [
      piece.center[0], piece.center[1], piece.center[2],
      piece.size[0], piece.size[1], piece.size[2],
      piece.color,
      piece.rotationX ?? 0,
    ]),
    track.zones.map((zone) => [
      zone.minX, zone.maxX, zone.minZ, zone.maxZ, zone.groundY,
      zone.maxOccupants,
      allowedMask(zone.allowedTypes),
    ]),
    [...track.spawn],
    [...track.exit],
    track.length,
  ];
}

function trackFromRuntimeTuple(tuple: z.infer<typeof runtimeTrackSchema>): BuiltTrack {
  const [pieces, zones, spawn, exit, length] = tuple;
  return {
    pieces: pieces.map((piece, index) => ({
      id: `shared-piece-${index}`,
      center: [piece[0], piece[1], piece[2]],
      size: [piece[3], piece[4], piece[5]],
      color: piece[6],
      ...(piece[7] ? { rotationX: piece[7] } : {}),
    })),
    zones: zones.map((zone, index) => {
      const mask = BigInt(`0x${zone[6]}`);
      return {
        id: `shared-zone-${index}`,
        label: `Shared surface ${index + 1}`,
        minX: zone[0], maxX: zone[1], minZ: zone[2], maxZ: zone[3],
        groundY: zone[4], maxOccupants: zone[5],
        allowedTypes: TRAP_TYPES.filter((_, typeIndex) =>
          (mask & (BigInt(1) << BigInt(typeIndex))) !== BigInt(0)),
      };
    }),
    spawn,
    exit,
    length,
  };
}

/**
 * `avatar` is the sender's runner. It is a separate argument rather than a
 * field on ChallengeDTO because the DTO is the stored shape and the avatar is a
 * local preference; passing it here keeps a link that carries one and a link
 * that does not on the same code path.
 */
export function encodeChallengeLink(
  challenge: ChallengeDTO,
  avatar?: AvatarConfig | null,
  runtimeTrack?: BuiltTrack | null,
): string {
  const names: string[] = [];
  const nameIndex = (name: string): number => {
    const existing = names.indexOf(name);
    if (existing >= 0) return existing;
    // The dictionary is capped; reuse the last slot rather than emitting a
    // payload whose indices will not decode.
    if (names.length >= MAX_NAMES) return MAX_NAMES - 1;
    return names.push(name) - 1;
  };
  const creatorIndex = nameIndex(challenge.createdByName);
  const segments = challenge.track ?? CLASSIC_TRACK;
  const track = runtimeTrack ?? buildTrack(segments);
  // Keep authored zones first so every older tuple index keeps its meaning;
  // real platform surfaces are appended for new free-placement links.
  const pieceSurfaces = placementSurfaces(track);
  const traps = challenge.traps.map((trap) => {
    const legacyIndex = track.zones.findIndex((entry) => entry.id === trap.zoneId);
    const pieceIndex = pieceSurfaces.findIndex((entry) => entry.id === trap.zoneId);
    const zoneIndex = legacyIndex >= 0
      ? legacyIndex
      : pieceIndex >= 0
        ? track.zones.length + pieceIndex
        : -1;
    // A trap whose zone is not in this challenge's own track used to encode as
    // index -1, which decode then refused. The sender saw a normal-looking
    // link, the recipient saw "that link is damaged", and the chain died one
    // hop later with no signal to anyone. Fail here, where it can be seen.
    if (zoneIndex < 0)
      throw new Error(
        `CHALLENGE_LINK_UNENCODABLE: trap ${trap.id} sits in zone "${trap.zoneId}", which this track does not contain`,
      );
    const [centerX, centerZ] = legacyIndex >= 0
      ? zoneCenter(track.zones[legacyIndex]!)
      : [
          (pieceSurfaces[pieceIndex]!.minX + pieceSurfaces[pieceIndex]!.maxX) / 2,
          (pieceSurfaces[pieceIndex]!.minZ + pieceSurfaces[pieceIndex]!.maxZ) / 2,
        ];
    return [
      TRAP_TYPES.indexOf(trap.type),
      zoneIndex,
      Math.round((trap.position[0] - centerX) * GRID_STEPS_PER_UNIT),
      Math.round((trap.position[2] - centerZ) * GRID_STEPS_PER_UNIT),
      ((Math.round(trap.rotationY / (Math.PI / 2)) % 4) + 4) % 4,
      nameIndex(trap.ownerName),
      trap.ownerAvatarSeed,
      trap.seed,
    ];
  });
  const body = [
    challenge.slug,
    challenge.baseSeed,
    creatorIndex,
    challenge.createdByAvatarSeed,
    names,
    traps,
  ];
  // Version 3 always carries the track and the parent's real record. The extra
  // cost is three integers; what it buys is an arriving stranger seeing "47
  // attempts, 12% survive" instead of an empty challenge nobody has played.
  const tail = [
    segments,
    [
      challenge.stats.attempts,
      challenge.stats.completions,
      challenge.stats.bestTimeMs,
    ],
  ];
  if (avatar) {
    const unreadable =
      colorRejection("body", avatar.body, avatar.body) ??
      colorRejection("pack", avatar.pack, avatar.body);
    if (unreadable)
      throw new Error(
        `CHALLENGE_LINK_UNENCODABLE: this runner ${unreadable.reason} at ${unreadable.ratio.toFixed(2)}:1`,
      );
  }
  if (runtimeTrack) {
    const encoded = toBase64Url(
      JSON.stringify([
        5,
        ...body,
        runtimeTuple(runtimeTrack),
        tail[1],
        avatar ? avatarToTuple(avatar) : null,
      ]),
    );
    if (encoded.length > CHALLENGE_CODE_MAX_LENGTH)
      throw new Error("CHALLENGE_LINK_UNENCODABLE: this room is too large for a challenge code");
    // Never put a code on the clipboard that the receiving path will reject.
    // This catches schema drift (counts, coordinates, names, or zones) at the
    // builder, where the player can still correct the room.
    try {
      decodeChallengeLink(encoded);
      if (!decodeChallengeRuntimeTrack(encoded)) throw new Error("missing authored room");
    } catch {
      throw new Error("CHALLENGE_LINK_UNENCODABLE: this authored room cannot be represented by a map code");
    }
    return encoded;
  }
  if (!avatar) return toBase64Url(JSON.stringify([3, ...body, ...tail]));
  // Emitting an unreadable runner would hand the recipient a figure they cannot
  // see against the floor, and they would have no idea why. Fail where the
  // sender is, the way an unplaceable trap already does.
  // Version 4 appends the sender's runner. Four integers, and the recipient
  // finally beats a person rather than an anonymous shape.
  return toBase64Url(
    JSON.stringify([4, ...body, ...tail, avatarToTuple(avatar)]),
  );
}

function parsePayload(payload: string): Payload {
  if (!payload || payload.length > CHALLENGE_CODE_MAX_LENGTH)
    throw new Error("CHALLENGE_LINK_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(payload));
  } catch {
    throw new Error("CHALLENGE_LINK_INVALID");
  }
  const result = payloadSchema.safeParse(parsed);
  if (!result.success) throw new Error("CHALLENGE_LINK_INVALID");
  // The indices are in range by now, but "in range" is not "legible". A runner
  // the customiser would have refused is one the recipient cannot see against
  // the deck, and they play as that runner, so the whole level becomes
  // unplayable for them. Refuse it here with everything else hand-editable.
  if (
    (result.data[0] === 4 || result.data[0] === 5) &&
    result.data[9] &&
    !isReadableAvatar(avatarFromTuple(result.data[9]))
  )
    throw new Error("CHALLENGE_LINK_INVALID");
  return result.data;
}

/** The sender's runner, or null for a link made before runners were choosable. */
export function decodeChallengeAvatar(payload: string): AvatarConfig | null {
  const data = parsePayload(payload);
  return (data[0] === 4 || data[0] === 5) && data[9]
    ? avatarFromTuple(data[9])
    : null;
}

/** Authored room geometry carried by version 5 challenge codes. */
export function decodeChallengeRuntimeTrack(payload: string): BuiltTrack | null {
  const data = parsePayload(payload);
  return data[0] === 5 ? trackFromRuntimeTuple(data[7]) : null;
}

export function decodeChallengeLink(payload: string): ChallengeDTO {
  const data = parsePayload(payload);
  const segments = data[0] === 1
    ? CLASSIC_TRACK
    : data[0] === 5
      ? null
      : data[7];
  const carried = data[0] === 3 || data[0] === 4 || data[0] === 5
    ? data[8]
    : null;
  const [, slug, baseSeed, creatorIndex, creatorAvatarSeed, names, tuples] =
    data;
  // SAFE_NAME only gates the character class, so a link could carry a slur or a
  // bare domain that the local name field would refuse. publishChild copies the
  // parent's traps, so an imported name is re-shared under the recipient's own
  // name to their friends. Hold link names to the same bar as typed ones.
  for (const name of names)
    try {
      sanitizeDisplayName(name);
    } catch {
      throw new Error("CHALLENGE_LINK_INVALID");
    }
  const creatorName = names[creatorIndex];
  if (!creatorName) throw new Error("CHALLENGE_LINK_INVALID");
  // A track that cannot be finished is refused outright rather than handed to
  // a player who would then be stuck on it.
  if (segments && !isPlayableTrack(segments))
    throw new Error("CHALLENGE_LINK_INVALID");
  const track: BuiltTrack = data[0] === 5
    ? trackFromRuntimeTuple(data[7])
    : buildTrack(segments!);
  const pieceSurfaces = placementSurfaces(track);

  const traps: TrapInstance[] = [];
  for (const [
    typeIndex,
    zoneIndex,
    offsetXSteps,
    offsetZSteps,
    quarterTurns,
    ownerIndex,
    ownerAvatarSeed,
    seed,
  ] of tuples) {
    const type = TRAP_TYPES[typeIndex]!;
    const zone: PlacementZone | undefined = track.zones[zoneIndex];
    const piece = pieceSurfaces[zoneIndex - track.zones.length];
    const surfaceId = zone?.id ?? piece?.id;
    const ownerName = names[ownerIndex];
    if (!surfaceId || !ownerName) throw new Error("CHALLENGE_LINK_INVALID");
    const offsetX = offsetXSteps / GRID_STEPS_PER_UNIT;
    const offsetZ = offsetZSteps / GRID_STEPS_PER_UNIT;
    // A runtime-room code is the builder's complete authored snapshot. It is
    // allowed to contain deliberate overlaps, spawn-adjacent hazards, and traps
    // whose footprint overhangs a narrow block—the player already has Test mode
    // to decide whether that map is fair. Reapplying the ordinary post-clear
    // "add one trap" restrictions here made those rooms playable before copy
    // and invalid after paste. The tuple schema still bounds every number and
    // the surface index still has to resolve, so reconstruction cannot escape
    // the encoded room.
    const placement = data[0] === 5
      ? {
          valid: true as const,
          canonicalPosition: [
            ((zone?.minX ?? piece!.minX) + (zone?.maxX ?? piece!.maxX)) / 2 + offsetX,
            zone?.groundY ?? piece!.groundY,
            ((zone?.minZ ?? piece!.minZ) + (zone?.maxZ ?? piece!.maxZ)) / 2 + offsetZ,
          ] as const,
          rotationY: quarterTurns * Math.PI / 2,
        }
      : validatePlacement(
          {
            type,
            zoneId: surfaceId,
            offsetX,
            offsetZ,
            rotationQuarterTurns: quarterTurns as 0 | 1 | 2 | 3,
          },
          traps,
          track,
        );
    if (!placement.valid) throw new Error("CHALLENGE_LINK_INVALID");
    traps.push({
      id: seededId("trap", seed),
      type,
      ownerUserId: null,
      ownerName,
      ownerAvatarSeed,
      depthAdded: traps.length + 1,
      zoneId: surfaceId,
      position: placement.canonicalPosition,
      rotationY: placement.rotationY,
      seed,
      params: TRAP_CATALOG[type].defaultParams,
    });
  }

  return {
    id: `link-${slug}`,
    slug,
    chainId: `chain-${slug}`,
    chainSlug: `chain-${slug}`,
    parentSlug: null,
    depth: traps.length,
    baseSeed,
    levelVersion: 1,
    createdByName: creatorName,
    createdByAvatarSeed: creatorAvatarSeed,
    addedTrap: traps.at(-1) ?? null,
    traps,
    ghostTrace: null,
    stats: {
      attempts: carried?.[0] ?? 0,
      completions: carried?.[1] ?? 0,
      // Derived rather than carried, so a hand-edited link cannot claim a
      // survival rate its own attempt and completion counts contradict.
      survivalRate:
        carried && carried[0] > 0
          ? Math.min(1, carried[1] / carried[0])
          : null,
      bestTimeMs: carried?.[2] ?? null,
      recentAttempts: carried?.[0] ?? 0,
      shareCount: 0,
    },
    // Held constant so decoding a link is deterministic. The field is not shown
    // to players; a shared challenge has no meaningful local creation time.
    createdAt: new Date(0).toISOString(),
    isDemo: true,
    // Version 1 predates composed tracks, so it has no segments to carry and
    // leaving track undefined is what marks it as the original course.
    ...(data[0] === 1 || data[0] === 5 ? {} : { track: segments! }),
  };
}

export function challengeLinkUrl(
  challenge: ChallengeDTO,
  base: string | URL,
  avatar?: AvatarConfig | null,
): string {
  const url = new URL(`/c/${challenge.slug}`, base);
  url.searchParams.set(
    CHALLENGE_LINK_PARAM,
    encodeChallengeLink(challenge, avatar),
  );
  return url.toString();
}
