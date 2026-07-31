// @vitest-environment jsdom
// The picker is exercised through a real render because "this option changes
// what you see" is not a claim the data model can make on its own. zustand
// hands server renders its initial state, so static markup cannot see a store
// the test has set up.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Color } from "three";
import { AvatarCustomizer } from "@/components/hud/AvatarCustomizer";
import { useGameStore } from "@/stores/game-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  AVATAR_COLORS,
  PACK_COLORS,
  AVATAR_FACES,
  AVATAR_HEADWEAR,
  DECK_COLORS,
  DEFAULT_AVATAR,
  MIN_CONTRAST,
  WARDROBE_SLOTS,
  avatarColor,
  avatarFromTuple,
  avatarToTuple,
  colorRejection,
  contrastRatio,
  deckContrast,
  isReadableAvatar,
  resolveAvatar,
  usableColors,
} from "@/lib/game/avatar";
import {
  decodeChallengeAvatar,
  decodeChallengeLink,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { PALETTE } from "@/lib/game/constants";
import { TRACK_SEGMENTS } from "@/lib/game/track";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ChallengeDTO } from "@/lib/game/types";

function challenge(): ChallengeDTO {
  return {
    id: "x",
    slug: "worse-abc123",
    chainId: "c",
    chainSlug: "cs",
    parentSlug: null,
    depth: 0,
    baseSeed: 1,
    levelVersion: 1,
    createdByName: "Wobbly Badger",
    createdByAvatarSeed: 1,
    addedTrap: null,
    traps: [],
    ghostTrace: null,
    stats: {
      attempts: 12,
      completions: 3,
      survivalRate: 0.25,
      bestTimeMs: 9100,
      recentAttempts: 12,
      shareCount: 0,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
  };
}

// Every render this file makes is unmounted before the next test starts.
//
// Without it the five picker tests below passed when that block was run alone
// and all five failed when the whole file ran: the launcher rendered and was
// clicked, and the panel never opened, so they reported an empty catalogue
// rather than a mounting problem. The picker's own helper already cleaned up at
// the START of each of its tests, which is too late to stop a root left behind
// by whatever ran before it. I did not isolate the precise interaction; what is
// established is that both the panel and the customizer mount and open
// correctly on their own, and that this hook makes the file pass as a whole.
afterEach(cleanup);

describe("contrast helper", () => {
  it("reproduces the reference WCAG ratios", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#8b72ff", "#8b72ff")).toBeCloseTo(1, 6);
    // Symmetric, whichever way round the pair is given.
    expect(contrastRatio(PALETTE.ink, PALETTE.cream)).toBeCloseTo(
      contrastRatio(PALETTE.cream, PALETTE.ink),
      12,
    );
    // The palette comment claims danger clears 6.5:1 on the cream deck.
    expect(contrastRatio(PALETTE.danger, PALETTE.cream)).toBeGreaterThan(6.4);
  });

  it("measures the decks the renderer actually paints", () => {
    // LevelGeometry washes each platform colour toward cream in three's linear
    // working space. Reproducing that by hand keeps the legibility model free
    // of the renderer, so the reference implementation is checked here instead.
    const source = readFileSync(
      resolve(process.cwd(), "components/game/LevelGeometry.tsx"),
      "utf8",
    );
    const wash = Number(/DECK_WASH\s*=\s*([\d.]+)/.exec(source)?.[1]);
    expect(wash).toBe(0.62);
    const expected = new Set(
      TRACK_SEGMENTS.flatMap((segment) =>
        segment.pieces.map(
          (piece) =>
            `#${new Color(piece.color).lerp(new Color(PALETTE.cream), wash).getHexString()}`,
        ),
      ),
    );
    expect(new Set(DECK_COLORS)).toEqual(expected);
    expect(DECK_COLORS.length).toBeGreaterThan(5);
  });

  it("reports the worst deck, not an average", () => {
    const reading = deckContrast(PALETTE.ink);
    expect(reading.min).toBeLessThan(reading.max);
    expect(reading.min).toBeCloseTo(
      Math.min(...DECK_COLORS.map((deck) => contrastRatio(PALETTE.ink, deck))),
      12,
    );
    expect(contrastRatio(PALETTE.ink, reading.worstDeck)).toBeCloseTo(
      reading.min,
      12,
    );
  });
});

describe("avatar palette", () => {
  it("offers every authored body colour without a gameplay palette gate", () => {
    for (const entry of AVATAR_COLORS)
      expect(colorRejection("body", entry.id, entry.id), entry.id).toBeNull();
    expect(usableColors("body", DEFAULT_AVATAR.body)).toEqual(AVATAR_COLORS);
  });

  it("shows why the swatches are not just PALETTE", () => {
    // The wardrobe is repeatedly offered the tidy-looking change of repainting
    // each swatch to the palette hue its name suggests. It cannot take it: a
    // garment is measured against the floor wash, which is a harder bar than
    // the one the level's own colours are chosen for, and every saturated
    // palette hue is under it. Pinned as a measurement so the paragraph above
    // AVATAR_COLORS cannot quietly stop being true.
    for (const hue of ["blue", "purple", "red", "orange", "green"] as const)
      expect(
        deckContrast(PALETTE[hue]).min,
        `PALETTE.${hue} would now pass the garment gate`,
      ).toBeLessThan(MIN_CONTRAST);
    // And the swatch the default top wears does pass, which is the half that
    // repainting it would break.
    const cobalt = AVATAR_COLORS.find((entry) => entry.id === "cobalt")!;
    expect(DEFAULT_AVATAR.colors.top).toBe("cobalt");
    expect(deckContrast(cobalt.hex).min).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(colorRejection("top", "cobalt", DEFAULT_AVATAR.body)).toBeNull();
  });

  it("keeps pale colours available even when they resemble the floor", () => {
    for (const id of ["cream", "butter"] as const) {
      expect(deckContrast(avatarColor(id)).min).toBeLessThan(1.1);
      expect(colorRejection("body", id, id)).toBeNull();
    }
  });

  it("allows every pack colour on every body colour", () => {
    for (const entry of AVATAR_COLORS)
      expect(colorRejection("pack", entry.id, entry.id)).toBeNull();
    expect(PACK_COLORS).toEqual(AVATAR_COLORS);
  });

  it("leaves every pack colour reachable through some body", () => {
    // An option nobody can ever select is a stub with a label on it. The list
    // under test is what the customizer actually renders, so this fails if a
    // dead swatch is ever offered again - checking AVATAR_COLORS instead would
    // only restate PACK_COLORS' own filter back at itself.
    const bodies = AVATAR_COLORS.filter(
      (entry) => !colorRejection("body", entry.id, entry.id),
    );
    expect(PACK_COLORS.length).toBeGreaterThan(0);
    for (const pack of PACK_COLORS)
      expect(
        bodies.some((body) => !colorRejection("pack", pack.id, body.id)),
        `${pack.id} pack is unreachable`,
      ).toBe(true);
  });

  it("agrees with the whole-config check", () => {
    expect(isReadableAvatar(DEFAULT_AVATAR)).toBe(true);
    expect(
      isReadableAvatar({ ...DEFAULT_AVATAR, body: "cream" }),
    ).toBe(true);
    expect(
      isReadableAvatar({ ...DEFAULT_AVATAR, pack: DEFAULT_AVATAR.body }),
    ).toBe(true);
  });
});

describe("resolveAvatar", () => {
  it("reproduces the seed-derived look when nothing is chosen", () => {
    const legacy = [
      PALETTE.purple,
      PALETTE.blue,
      PALETTE.orange,
      PALETTE.green,
    ];
    for (const seed of [-9, -1, 0, 1, 2, 3, 4, 7, 12, 4242]) {
      const look = resolveAvatar(null, seed);
      expect(look.bodyColor).toBe(legacy[Math.abs(seed) % 4]);
      expect(look.packColor).toBe(PALETTE.red);
      expect(look.headwear).toBe("hair");
      expect(look.face).toBe("plain");
    }
    expect(resolveAvatar(undefined, 3)).toEqual(resolveAvatar(null, 3));
  });

  it("ignores the seed once an avatar exists", () => {
    const config: AvatarConfig = {
      ...DEFAULT_AVATAR,
      body: "rust",
      pack: "ink",
      headwear: "bucket",
      face: "shades",
    };
    expect(resolveAvatar(config, 1)).toEqual(resolveAvatar(config, 999));
    // Matched rather than deep-equalled: the four slots below are what this
    // test is about, and pinning the whole look would fail every time the
    // wardrobe gains a slot without anything actually breaking.
    expect(resolveAvatar(config, 1)).toMatchObject({
      bodyColor: avatarColor("rust"),
      packColor: avatarColor("ink"),
      headwear: "bucket",
      face: "shades",
    });
  });

  it("shows why the stock runner needed replacing", () => {
    // Every legacy colour fails the bar the palette above holds itself to, and
    // green is effectively invisible.
    const stock = [
      PALETTE.purple,
      PALETTE.blue,
      PALETTE.orange,
      PALETTE.green,
    ];
    for (const hex of stock)
      expect(deckContrast(hex).min).toBeLessThan(MIN_CONTRAST);
    expect(deckContrast(PALETTE.green).min).toBeLessThan(1.2);
  });
});

describe("avatar tuples", () => {
  it("round-trips every combination", () => {
    for (const body of AVATAR_COLORS)
      for (const pack of AVATAR_COLORS)
        for (const headwear of AVATAR_HEADWEAR)
          for (const face of AVATAR_FACES) {
            const config: AvatarConfig = {
              ...DEFAULT_AVATAR,
              body: body.id,
              pack: pack.id,
              headwear: headwear.id,
              face: face.id,
            };
            expect(avatarFromTuple(avatarToTuple(config))).toEqual(config);
          }
  });

  it("emits indices inside the bounds the link schema enforces", () => {
    const tuple = avatarToTuple({
      ...DEFAULT_AVATAR,
      body: AVATAR_COLORS.at(-1)!.id,
      pack: AVATAR_COLORS[0]!.id,
      headwear: AVATAR_HEADWEAR.at(-1)!.id,
      face: AVATAR_FACES.at(-1)!.id,
    });
    expect(tuple).toEqual([
      AVATAR_COLORS.length - 1,
      0,
      AVATAR_HEADWEAR.length - 1,
      AVATAR_FACES.length - 1,
    ]);
  });
});

describe("the picker", () => {
  // What a garment looks like is checked where the garment is built:
  // wardrobe.test.ts measures a real dressed runner and fails if two options in
  // a slot draw alike. It is not checked here any more because the preview is
  // no longer a drawing of its own - it mounts the same model the game does, so
  // there is nothing left for this file to disagree with. What is checked here
  // is the thing only this file can see: whether the catalogue is reachable.
  const open = (avatar: AvatarConfig) => {
    cleanup();
    useSettingsStore.setState({ avatar, avatarPrompted: false });
    useGameStore.setState({ phase: "intro" });
    const container = render(createElement(AvatarCustomizer)).container;
    // Through the launcher, the way a player gets there. The panel used to
    // auto-open over the first intro, and these tests leaned on that; a full
    // production e2e run then measured the auto-open's backdrop sitting
    // between a first-time player and the start button, killing every
    // gameplay flow at its first click, so now the panel opens only when
    // asked and this helper does the asking.
    const launcher = container.querySelector(".avatar-launcher");
    expect(launcher, "the runner launcher is not on the intro").toBeTruthy();
    fireEvent.click(launcher!);
    return container;
  };

  it("puts every slot in the catalogue on screen", () => {
    const container = open(DEFAULT_AVATAR);
    expect(
      container.querySelectorAll('input[name="avatar-slot"]'),
    ).toHaveLength(WARDROBE_SLOTS.length);
  });

  it("offers every option in whichever slot is open", () => {
    // The bug this replaces: the picker rendered four of the nine slots, so
    // fifty-odd garments existed in data and could not be chosen by anyone.
    const container = open(DEFAULT_AVATAR);
    for (const slot of WARDROBE_SLOTS) {
      const chips = [...container.querySelectorAll('input[name="avatar-slot"]')];
      const chip = chips.find((input) =>
        input
          .getAttribute("aria-label")
          ?.startsWith(`${slot.label}, ${slot.options.length - 1} to choose from`),
      );
      expect(chip, `no chip opens the ${slot.id} slot`).toBeTruthy();
      fireEvent.click(chip!);
      expect(
        container.querySelectorAll(`input[name="avatar-${slot.id}"]`),
        `the ${slot.id} slot did not list all ${slot.options.length} of its options`,
      ).toHaveLength(slot.options.length);
    }
  });

  it("offers a colour for every garment slot that takes one", () => {
    const container = open({
      ...DEFAULT_AVATAR,
      top: "tee",
      outerwear: "hoodie",
      legwear: "jeans",
      footwear: "boot",
      backpack: "daypack",
      held: "flag",
      headwear: "cap",
      face: "warpaint",
      eyewear: "round",
    });
    for (const slot of WARDROBE_SLOTS) {
      const chips = [...container.querySelectorAll('input[name="avatar-slot"]')];
      const chip = chips.find((input) =>
        input.getAttribute("aria-label")?.startsWith(`${slot.label},`),
      )!;
      fireEvent.click(chip);
      const swatches = container.querySelectorAll(
        `input[name="avatar-${slot.id}-color"]`,
      );
      if (!slot.colorKey) {
        expect(swatches, `${slot.id} draws in fixed ink but offered a colour`).toHaveLength(0);
        continue;
      }
      // Only the colours that clear the bar, which is why this counts against
      // usableColors rather than against the whole palette.
      expect(swatches, `${slot.id} offered no colour`).toHaveLength(
        usableColors(slot.colorKey, DEFAULT_AVATAR.body).length,
      );
    }
  });

  it("hides a garment's colour until the garment is worn", () => {
    // Colouring a jacket you are not wearing is a control with no effect, and
    // the legibility gate ignores it for the same reason.
    const container = open(DEFAULT_AVATAR);
    const chips = [...container.querySelectorAll('input[name="avatar-slot"]')];
    fireEvent.click(
      chips.find((input) => input.getAttribute("aria-label")?.startsWith("Outer layer,"))!,
    );
    expect(
      container.querySelectorAll('input[name="avatar-outerwear-color"]'),
    ).toHaveLength(0);
  });

  it("shows every color as available", () => {
    const html = open(DEFAULT_AVATAR).innerHTML;
    expect(html).not.toContain("disabled");
    expect(html).toContain("All avatar colors available");
    expect(html).toContain("Every color is available");
  });
});

describe("avatars in challenge links", () => {
  const mine: AvatarConfig = {
    ...DEFAULT_AVATAR,
    body: "forest",
    pack: "butter",
    headwear: "bobble",
    face: "grin",
  };

  it("carries the sender's runner and rebuilds it", () => {
    const payload = encodeChallengeLink(challenge(), mine);
    expect(decodeChallengeAvatar(payload)).toEqual(mine);
    // Everything version 3 carried still arrives intact.
    const decoded = decodeChallengeLink(payload);
    expect(decoded.slug).toBe("worse-abc123");
    expect(decoded.createdByName).toBe("Wobbly Badger");
    expect(decoded.stats.attempts).toBe(12);
    expect(decoded.stats.bestTimeMs).toBe(9100);
    expect(decoded.stats.survivalRate).toBeCloseTo(0.25, 6);
  });

  it("still emits version 3 when nobody has chosen a runner", () => {
    const version = (payload: string) =>
      JSON.parse(
        Buffer.from(
          payload.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8"),
      )[0];
    expect(version(encodeChallengeLink(challenge()))).toBe(3);
    expect(version(encodeChallengeLink(challenge(), null))).toBe(3);
    expect(version(encodeChallengeLink(challenge(), mine))).toBe(4);
  });

  it("costs a handful of characters", () => {
    const json = (payload: string) =>
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
    const without = encodeChallengeLink(challenge());
    const with_ = encodeChallengeLink(challenge(), mine);
    // Four one-digit integers, a bracket pair, three separators, and the comma
    // that joins them to the payload.
    expect(json(with_).length - json(without).length).toBe(10);
    expect(with_.length - without.length).toBeLessThanOrEqual(14);
  });

  it("keeps decoding links that predate runners", () => {
    // The literal payload pinned by challenge-link.test.ts, decoded through the
    // widened schema. A link sitting in someone's chat history must survive
    // every version bump.
    const v1 =
      "WzEsIndvcnNlLWxpbmt0ZXN0Iiw5ODc2NTQsMCwxMixbIkNoZWVreSBLZXR0bGUiLCJUdXJibyBPdHRlciJdLFtbMiwxLDAsMCwwLDEsMTEsNTAwMF0sWzcsNiwwLDAsMCwwLDEyLDUwMDFdXV0";
    expect(decodeChallengeLink(v1).traps).toHaveLength(2);
    expect(decodeChallengeAvatar(v1)).toBeNull();
    expect(decodeChallengeAvatar(encodeChallengeLink(challenge()))).toBeNull();
  });

  const forge = (tuple: readonly number[]) =>
    Buffer.from(
      JSON.stringify([
        4,
        "worse-abc123",
        1,
        0,
        0,
        ["Wobbly Badger"],
        [],
        ["classic"],
        [0, 0, null],
        tuple,
      ]),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  it("round-trips a pale runner instead of rejecting player expression", () => {
    const pale: AvatarConfig = { ...mine, body: "cream" };
    const code = encodeChallengeLink(challenge(), pale);
    expect(decodeChallengeAvatar(code)?.body).toBe("cream");
    const forged = forge(avatarToTuple(pale));
    expect(decodeChallengeAvatar(forged)?.body).toBe("cream");
  });

  it("refuses an index the palette does not have", () => {
    expect(() => decodeChallengeLink(forge([AVATAR_COLORS.length, 0, 0, 0]))).toThrow(
      "CHALLENGE_LINK_INVALID",
    );
    expect(() =>
      decodeChallengeLink(forge(avatarToTuple(DEFAULT_AVATAR))),
    ).not.toThrow();
  });
});
