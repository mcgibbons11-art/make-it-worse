import { describe, it, expect } from "vitest";
import { buildTrack, isPlayableTrack } from "@/lib/game/track";
import { validatePlacement, placementFromWorld } from "@/lib/game/placement";
import {
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import { seededId } from "@/lib/game/seed";
import type { BuiltTrack } from "@/lib/game/track";
import { firstLegalPlacement } from "@/lib/game/trap-choice";

const SEGS = ["start","runway","stones","bridge","islands","convergence","ramp","finish"];

describe("custom track loop", () => {
  it("selects, validates, drags and shares on a composed course", () => {
    const track = buildTrack(SEGS);
    expect(isPlayableTrack(SEGS)).toBe(true);
    // 1. selection resolves against the track
    const zone = track.zones.find((z) => z.allowedTypes.includes("floor_fan"))!;
    expect(zone.id).not.toBe("runway_front");
    // 2. the panel validates the SAME zone with the track
    const v = validatePlacement({type:"floor_fan",zoneId:zone.id,offsetX:0,offsetZ:0,rotationQuarterTurns:0}, [], track);
    expect(v.valid, "panel rejected the zone selection chose").toBe(true);
    // 3. dragging returns real offsets, not NaN
    const dragged = placementFromWorld("floor_fan", zone.id, 0.5, (zone.minZ+zone.maxZ)/2, 0, track);
    expect(Number.isFinite(dragged.offsetX)).toBe(true);
    expect(Number.isFinite(dragged.offsetZ)).toBe(true);
    // 4. the published child encodes and decodes
    if (!v.valid) throw new Error("unreachable");
    const trap = { id: seededId("trap", 7), type: "floor_fan" as const, ownerUserId: null,
      ownerName: "Turbo Otter", ownerAvatarSeed: 1, depthAdded: 1, zoneId: zone.id,
      position: v.canonicalPosition, rotationY: v.rotationY, seed: 7,
      params: TRAP_CATALOG.floor_fan.defaultParams };
    const child = { id:"x", slug:"worse-custom1", chainId:"c", chainSlug:"cs", parentSlug:null,
      depth:1, baseSeed:1, levelVersion:1 as const, createdByName:"Turbo Otter", createdByAvatarSeed:1,
      addedTrap:trap, traps:[trap], ghostTrace:null,
      stats:{attempts:12,completions:3,survivalRate:0.25,bestTimeMs:7200,recentAttempts:12,shareCount:1},
      createdAt:new Date(0).toISOString(), isDemo:true, track:SEGS };
    const round = decodeChallengeLink(encodeChallengeLink(child));
    expect(round.track).toEqual(SEGS);
    expect(round.traps[0]!.zoneId).toBe(zone.id);
    expect(round.stats.attempts).toBe(12);
  });

  it("carries an authored room and its trap into another player's session", () => {
    const runtime: BuiltTrack = {
      pieces: [
        { id: "builder-piece-1", center: [4, 0, 6], size: [7, 0.4, 8], color: "#3e74d3" },
        { id: "builder-piece-2", center: [4, 1.2, -3], size: [5, 0.4, 6], color: "#a96639" },
      ],
      zones: [
        { id: "builder-zone-1", label: "Blue block", minX: 1, maxX: 7, minZ: 2.5, maxZ: 9.5, groundY: 0.25, maxOccupants: 4, allowedTypes: TRAP_TYPES },
        { id: "builder-zone-2", label: "High block", minX: 2, maxX: 6, minZ: -5.5, maxZ: -0.5, groundY: 1.45, maxOccupants: 4, allowedTypes: TRAP_TYPES },
      ],
      spawn: [4, 1.25, 8],
      exit: [4, 2.7, -3],
      length: 11,
    };
    const placed = validatePlacement(
      { type: "floor_fan", zoneId: "builder-zone-1", offsetX: 0, offsetZ: -2, rotationQuarterTurns: 0 },
      [],
      runtime,
    );
    if (!placed.valid) throw new Error("authored-room fixture was rejected");
    const trap = {
      id: seededId("trap", 12), type: "floor_fan" as const, ownerUserId: null,
      ownerName: "Turbo Otter", ownerAvatarSeed: 1, depthAdded: 1,
      zoneId: "builder-zone-1", position: placed.canonicalPosition,
      rotationY: placed.rotationY, seed: 12,
      params: TRAP_CATALOG.floor_fan.defaultParams,
    };
    const challenge = {
      id: "authored", slug: "worse-room12", chainId: "room", chainSlug: "room",
      parentSlug: null, depth: 1, baseSeed: 12, levelVersion: 1 as const,
      createdByName: "Turbo Otter", createdByAvatarSeed: 1,
      addedTrap: trap, traps: [trap], ghostTrace: null,
      stats: { attempts: 2, completions: 1, survivalRate: 0.5, bestTimeMs: 9000, recentAttempts: 2, shareCount: 0 },
      createdAt: new Date(0).toISOString(), isDemo: true,
    };

    const payload = encodeChallengeLink(challenge, null, runtime);
    const receivedChallenge = decodeChallengeLink(payload);
    const receivedTrack = decodeChallengeRuntimeTrack(payload);

    expect(receivedTrack).not.toBeNull();
    expect(receivedTrack!.pieces.map((piece) => piece.center)).toEqual(runtime.pieces.map((piece) => piece.center));
    expect(receivedTrack!.spawn).toEqual(runtime.spawn);
    expect(receivedTrack!.exit).toEqual(runtime.exit);
    expect(receivedChallenge.track).toBeUndefined();
    expect(receivedChallenge.traps[0]!.zoneId).toBe("shared-zone-0");
    expect(firstLegalPlacement(
      receivedTrack!,
      "soap_slick",
      receivedChallenge.traps,
    )).not.toBeNull();
  });
});
