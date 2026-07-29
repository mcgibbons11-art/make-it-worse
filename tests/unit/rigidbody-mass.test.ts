import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYER } from "@/lib/game/constants";

/**
 * @react-three/rapier strips `mass` from RigidBody props — it is the first
 * entry in the library's own excluded list, and mutableRigidBodyOptions has no
 * mass entry either. A body given mass on the RigidBody silently falls back to
 * its own volume at the default density, and nothing anywhere reports it.
 *
 * The player was the worst case: 0.729kg of capsule against the 1kg every
 * impulse in the game was tuned for, making all of them 37% stronger than
 * authored. Mass has to sit on the collider, where setMass is actually called.
 */
const FILES = [
  "components/game/PlayerController.tsx",
  "components/game/TrapRenderer.tsx",
  "components/game/traps/LauncherTraps.tsx",
  "components/game/traps/ForceTraps.tsx",
];

/** Strip JSX children so only each element's own attributes remain. */
function elementsNamed(source: string, name: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`<${name}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    const end = source.indexOf(">", match.index);
    if (end > 0) found.push(source.slice(match.index, end));
  }
  return found;
}

describe("rigid body mass", () => {
  it("never puts mass on a RigidBody, where the library discards it", () => {
    for (const file of FILES) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      for (const element of elementsNamed(source, "RigidBody"))
        expect(
          element,
          `${file}: mass on a RigidBody is silently ignored; move it to the collider`,
        ).not.toMatch(/\bmass=/);
    }
  });

  it("confirms the library still strips the prop", () => {
    // If a future version starts honouring it, this fails and the rule above
    // can be revisited rather than cargo-culted.
    const dist = readFileSync(
      new URL(
        "../../node_modules/@react-three/rapier/dist/react-three-rapier.esm.js",
        import.meta.url,
      ),
      "utf8",
    );
    const excluded = /_excluded\$2 = \[([^\]]*)\]/.exec(dist);
    expect(excluded?.[1]).toContain('"mass"');
    // And that colliders do honour it, which is why the fix works.
    expect(dist).toContain("setMass(options.mass)");
  });

  it("keeps the player's authored mass reachable", () => {
    const source = readFileSync(
      new URL("../../components/game/PlayerController.tsx", import.meta.url),
      "utf8",
    );
    const collider = elementsNamed(source, "CapsuleCollider")[0];
    expect(collider).toBeDefined();
    expect(collider).toMatch(/mass=\{PLAYER\.mass\}/);
  });

  it("holds the mass every trap impulse was authored against", () => {
    // Rapier turns an impulse into a velocity change of J / m, and the traps
    // hand the player raw numbers: the fan 19 x step, the bunting takes a share
    // of the runner's own momentum, the fridge charges at a speed picked to
    // read against a 7.2 runner. Every one of those was tuned on a 1kg body, so
    // this is a calibration constant rather than a free parameter, and nothing
    // else in the project reads PLAYER.mass to notice it moving.
    //
    // The spring pad used to be the headline example here and no longer is: it
    // sets its take-off velocity outright, from PLAYER.jumpVelocity, so it is
    // the one launcher that is immune to both this constant and a gravity
    // retune. It was rewritten that way because a raw impulse had already left
    // it lifting less than an ordinary jump.
    expect(PLAYER.mass).toBe(1);
  });

  it("keeps the runner's density plausible for the capsule it is drawn as", () => {
    // What Rapier falls back to when the mass is dropped is the collider's own
    // volume at density 1, which is the 0.729 in the note above. Authoring a
    // mass far from that volume means the impulses were tuned against a body
    // that no longer resembles the shape on screen: at mass 5 a cartoon runner
    // is seven times as dense as water, denser than iron.
    const radius = PLAYER.capsuleRadius;
    const volume =
      Math.PI * radius ** 2 * (2 * PLAYER.capsuleHalfHeight) +
      (4 / 3) * Math.PI * radius ** 3;
    expect(volume).toBeCloseTo(0.729, 3);
    const density = PLAYER.mass / volume;
    expect(density).toBeGreaterThan(0.5);
    expect(density).toBeLessThan(2);
  });
});
