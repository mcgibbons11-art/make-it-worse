import { describe, it, expect } from "vitest";
import { buildTrack, isPlayableTrack } from "@/lib/game/track";
import { validatePlacement, placementFromWorld } from "@/lib/game/placement";
import { encodeChallengeLink, decodeChallengeLink } from "@/lib/game/challenge-link";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { seededId } from "@/lib/game/seed";

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
});