import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/game/constants";
import { DECK_COLORS, MIN_CONTRAST, contrastRatio } from "@/lib/game/avatar";

/**
 * A trap is allowed to hurt you. It is not allowed to hurt you invisibly.
 *
 * Every trap that can land a hit draws its reach on the floor first, and that
 * marking is the whole of the warning - there is no audio cue before contact
 * and no windup a player can read from the prop alone. So the marking has to be
 * legible against the deck it is drawn on, and "legible" here is the same bar
 * the wardrobe already holds worn colours to: MIN_CONTRAST against every
 * surface in DECK_COLORS, which is derived from the segment catalogue rather
 * than hand-listed so a new segment cannot introduce a deck nothing was checked
 * against.
 *
 * PALETTE.danger exists precisely because this bar is hard to clear. It is
 * reserved for hazard reach and used for nothing else, which is what lets the
 * colour itself carry the meaning. These tests are what stop a trap being
 * authored in a prop colour that happens to look fine on the one deck the
 * author had on screen.
 */
function worstDeck(color: string): { ratio: number; deck: string } {
  let ratio = Infinity;
  let deck = DECK_COLORS[0]!;
  for (const candidate of DECK_COLORS) {
    const measured = contrastRatio(color, candidate);
    if (measured < ratio) {
      ratio = measured;
      deck = candidate;
    }
  }
  return { ratio, deck };
}

describe("hazard telegraphs are legible on every deck they can be drawn on", () => {
  it("clears the contrast floor with the colour reserved for hazard reach", () => {
    const { ratio, deck } = worstDeck(PALETTE.danger);
    expect(
      ratio,
      `PALETTE.danger only manages ${ratio.toFixed(2)}:1 on deck ${deck}`,
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("measures the prop colours that traps have used for reach markings", () => {
    // Not an assertion about the palette, which is allowed to contain colours
    // that are unfit for a floor marking - it is a record of WHY danger exists.
    // A future author reaching for one of these on a floor decal can see here
    // what it actually measures rather than trusting how it looks on one deck.
    const measured = Object.fromEntries(
      (["yellow", "red", "blue", "green", "orange", "purple"] as const).map(
        (name) => [name, Number(worstDeck(PALETTE[name]).ratio.toFixed(2))],
      ),
    );
    for (const [name, ratio] of Object.entries(measured))
      expect(ratio, `${name} unexpectedly clears the floor`).toBeLessThan(
        MIN_CONTRAST,
      );
  });
});
