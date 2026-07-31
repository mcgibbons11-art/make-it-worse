import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import { CHALLENGE_LINK_PARAM, encodeChallengeLink } from "@/lib/game/challenge-link";
import { extractSharedMapPayload } from "@/portals/src/map-code-input";
import { encodePublishedMapCode } from "@/portals/src/published-map-catalog";

function codes() {
  const runtime = runtimeMap(generateRandomRoom(718), 718, 718, "Map Builder");
  return {
    raw: encodeChallengeLink(runtime.challenge, null, runtime.track),
    published: encodePublishedMapCode({
      ...runtime,
      avatar: null,
      title: "Wrapped room",
      publishedAt: "2026-07-30T00:00:00.000Z",
    }),
  };
}

describe("Portals pasted map-code extraction", () => {
  it("accepts raw challenge and published codes", () => {
    const { raw, published } = codes();
    expect(extractSharedMapPayload(raw)).toBe(raw);
    expect(extractSharedMapPayload(published)).toBe(published);
  });

  it("extracts legacy links from plain URLs and chat copy", () => {
    const { raw } = codes();
    const url = new URL("https://make-it-worse.test/c/clean-room");
    url.searchParams.set(CHALLENGE_LINK_PARAM, raw);
    expect(extractSharedMapPayload(url.toString())).toBe(raw);
    expect(extractSharedMapPayload(`Try mine: ${url.toString()}!`)).toBe(raw);
  });

  it("isolates codes from prose and recovers copied line wrapping", () => {
    const { raw, published } = codes();
    expect(extractSharedMapPayload(`Here is the map code:\n${published}\nHave fun`)).toBe(published);
    const split = `${raw.slice(0, 80)}\n${raw.slice(80, 160)}\n${raw.slice(160)}`;
    expect(extractSharedMapPayload(split)).toBe(raw);
  });
});
