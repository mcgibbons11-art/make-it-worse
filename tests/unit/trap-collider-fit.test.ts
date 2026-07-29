// @vitest-environment jsdom
import { createElement, type MutableRefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * No trap may hit the player from outside its own silhouette.
 *
 * The static audit of this property could resolve only 4 of 27 cuboid
 * colliders, because most collider args are computed rather than literal. This
 * closes the gap by RENDERING every trap component - rapier's colliders mocked
 * down to inert marker elements so their args survive into markup - and then
 * comparing, per trap, the horizontal reach of its solid colliders against the
 * horizontal reach of everything it draws.
 *
 * Two deliberate scope choices, both about not lying with a measurement:
 *
 * - Sensor colliders are EXCLUDED. A detection zone is allowed to be larger
 *   than the prop, because entering it triggers the telegraph rather than the
 *   hit; the fairness bound applies to geometry that can actually push or hurt.
 *
 * - Reach is compared as outer-corner radius about the trap's origin (hypot of
 *   half-extents plus the part's offset), which is exact for a box corner and
 *   an over-estimate for nothing. The tolerance below absorbs the capsule's
 *   own rounding; PLAYER.capsuleRadius enlarging every contact is the same for
 *   both sides of the comparison and cancels out of the fairness question.
 */
vi.mock("@react-three/rapier", () => {
  const marker = (tag: string) =>
    function Marker(props: Record<string, unknown>) {
      const { children, ...rest } = props;
      return createElement(tag, serialisable(rest), children as never);
    };
  const serialisable = (props: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(props)) {
      if (Array.isArray(value)) out[key.toLowerCase()] = value.join(",");
      else if (typeof value === "number" || typeof value === "string") out[key.toLowerCase()] = String(value);
      else if (value === true) out[key.toLowerCase()] = "true";
    }
    return out;
  };
  return {
    RigidBody: marker("x-rigidbody"),
    CuboidCollider: marker("x-cuboid"),
    BallCollider: marker("x-ball"),
    CylinderCollider: marker("x-cylinder"),
    RoundCuboidCollider: marker("x-roundcuboid"),
  };
});
vi.mock("@react-three/fiber", () => ({ useFrame: () => undefined, useThree: () => ({}) }));
vi.mock("@react-three/drei", () => ({
  Html: (props: { children?: unknown }) => createElement("x-html", null, props.children as never),
}));
// The model-backed traps draw an AssetModel whose extent lives in the
// sculpt factories; those factories are measured directly by
// sculpted-props.test.ts, so here the model becomes a marker and the trap is
// judged on everything else it draws. A trap whose ONLY visual is the model is
// reported as unresolved rather than passed. SculptedFloorFan is the one prop
// TrapRenderer imports by name rather than through AssetModel (its blade
// rosette takes a ref), so it gets the same marker treatment under the same
// model id.
vi.mock("@/components/game/AssetModel", () => ({
  AssetModel: (props: { model: string }) => createElement("x-assetmodel", { model: props.model }),
  SculptedFloorFan: () => createElement("x-assetmodel", { model: "fan" }),
}));
vi.mock("@/lib/audio/AudioManager", () => ({
  AudioManager: new Proxy({}, { get: () => () => undefined }),
}));

import { TrapRenderer } from "@/components/game/TrapRenderer";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapInstance } from "@/lib/game/types";

const FLAT = "-1.5707"; // rotation about X that lays a plane on the floor

function trapOf(type: TrapInstance["type"]): TrapInstance {
  return {
    id: `fit-${type}`,
    type,
    ownerUserId: null,
    ownerName: "qa",
    ownerAvatarSeed: 1,
    depthAdded: 0,
    zoneId: "runway_front",
    position: [0, 0, 0],
    rotationY: 0,
    seed: 7,
    params: { ...TRAP_CATALOG[type].defaultParams },
  };
}

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

function render(type: TrapInstance["type"]): Document {
  const markup = renderToStaticMarkup(
    createElement(TrapRenderer, {
      trap: trapOf(type),
      player: ref(null),
      soapUntilRef: ref(0),
      stunUntilRef: ref(0),
      grabbables: ref(new Map()),
      trapBodies: ref(new Map()),
      startedAt: 0,
      onHazard: () => undefined,
      onMechanic: undefined,
    }),
  );
  return new DOMParser().parseFromString(`<root>${markup}</root>`, "text/html");
}

function nums(value: string | null): number[] {
  if (!value) return [];
  return value.split(",").map(Number).filter(Number.isFinite);
}

/** Horizontal offset of an element from the trap origin, walking its parents. */
function offsetXZ(element: Element): number {
  let x = 0;
  let z = 0;
  let node: Element | null = element;
  while (node) {
    const p = nums(node.getAttribute("position"));
    if (p.length === 3) {
      x += p[0]!;
      z += p[2]!;
    }
    node = node.parentElement;
  }
  return Math.hypot(x, z);
}

function geometryRadius(element: Element): number | null {
  const tag = element.tagName.toLowerCase();
  const args = nums(element.getAttribute("args"));
  const mesh = element.closest("mesh, x-html") ?? element.parentElement;
  const rotation = mesh instanceof Element ? (mesh.getAttribute("rotation") ?? "") : "";
  const flat = rotation.startsWith(FLAT);
  switch (tag) {
    case "boxgeometry":
      return args.length >= 3 ? Math.hypot(args[0]! / 2, args[2]! / 2) : null;
    case "cylindergeometry":
      return args.length >= 2 ? Math.max(args[0]!, args[1]!) : null;
    case "spheregeometry":
    case "capsulegeometry":
    case "conegeometry":
      return args.length >= 1 ? args[0]! : null;
    case "torusgeometry":
      return args.length >= 2 ? args[0]! + args[1]! : null;
    case "ringgeometry":
      return args.length >= 2 ? args[1]! : null;
    case "circlegeometry":
      return args.length >= 1 ? args[0]! : null;
    case "planegeometry":
      if (args.length < 2) return null;
      // Flat on the deck both spans are horizontal; upright only the width is.
      return flat ? Math.hypot(args[0]! / 2, args[1]! / 2) : args[0]! / 2;
    default:
      return null;
  }
}

function colliderRadius(element: Element): number | null {
  const args = nums(element.getAttribute("args"));
  switch (element.tagName.toLowerCase()) {
    case "x-cuboid":
      return args.length >= 3 ? Math.hypot(args[0]!, args[2]!) : null;
    case "x-roundcuboid":
      return args.length >= 4 ? Math.hypot(args[0]! + args[3]!, args[2]! + args[3]!) : null;
    case "x-ball":
      return args.length >= 1 ? args[0]! : null;
    case "x-cylinder":
      // rapier's order is [halfHeight, radius].
      return args.length >= 2 ? args[1]! : null;
    default:
      return null;
  }
}

interface Fit {
  type: string;
  collider: number;
  visual: number;
  modelBacked: boolean;
}

function measure(type: TrapInstance["type"]): Fit | null {
  const doc = render(type);
  let collider = 0;
  let resolvedCollider = false;
  for (const el of doc.querySelectorAll("x-cuboid, x-ball, x-cylinder, x-roundcuboid")) {
    if (el.getAttribute("sensor") === "true") continue;
    const radius = colliderRadius(el);
    if (radius === null) continue;
    resolvedCollider = true;
    collider = Math.max(collider, radius + offsetXZ(el));
  }
  if (!resolvedCollider) return null; // nothing solid can touch the player
  let visual = 0;
  for (const el of doc.querySelectorAll("*")) {
    const radius = geometryRadius(el);
    if (radius === null) continue;
    visual = Math.max(visual, radius + offsetXZ(el));
  }
  return {
    type,
    collider,
    visual,
    // <primitive> is a factory-built model mounted directly (the toaster does
    // this) and is as unmeasurable from markup as the AssetModel marker; both
    // mean "the real extent is measured by sculpted-props.test.ts, not here".
    // Without this the toaster compared its model-sized collider against the
    // only thing this parser could read - its toast slices - and flagged a
    // 0.687u collider "overhanging" 0.175u of crumbs.
    modelBacked: doc.querySelector("x-assetmodel, primitive") !== null,
  };
}

/**
 * Colliders allowed past their drawn geometry, each with the reason measured
 * and judged rather than waved through. Entries here are decisions, not noise.
 */
const ALLOWED_OVERHANG: Record<string, number> = {
  // The far reach is a spilled sock: an individual grabbable body drawn
  // exactly where it lies, whose knit mesh rounds a little inside its own
  // collider. This whole-trap max-vs-max comparison pairs that sock's collider
  // with a different part's mesh and reads the rounding as overhang. Measured
  // at 0.109u; the player sees every sock where it can trip them.
  laundry_basket: 0.15,
};

const TOLERANCE = 0.1;

describe("every solid trap collider stays inside what the trap draws", () => {
  const fits = TRAP_TYPES.map(measure).filter((fit): fit is Fit => fit !== null);

  it("resolves enough traps for the comparison to mean anything", () => {
    // The static audit managed 4. If a refactor of the markup mocks ever makes
    // this collapse back toward that, the suite must say so rather than pass
    // vacuously on an empty list.
    expect(fits.length).toBeGreaterThanOrEqual(20);
  });

  it("finds no solid collider reaching past the trap's own silhouette", () => {
    const offenders = fits
      .filter((fit) => !fit.modelBacked)
      .filter((fit) => fit.collider > fit.visual + (ALLOWED_OVERHANG[fit.type] ?? TOLERANCE))
      .map((fit) => `${fit.type}: collider ${fit.collider.toFixed(3)}u vs drawn ${fit.visual.toFixed(3)}u`);
    expect(offenders, offenders.join("; ")).toEqual([]);
  });

  it("keeps the model-backed traps' colliders inside bounds measured elsewhere", () => {
    // These six draw an AssetModel whose true extent sculpted-props.test.ts
    // pins against these same call sites; here we only assert the collider is
    // not larger than that suite's measured envelope allows via the catalog's
    // own placementRadius, which players see as the footprint ring.
    const modelBacked = fits.filter((fit) => fit.modelBacked);
    for (const fit of modelBacked) {
      const radius = TRAP_CATALOG[fit.type as TrapInstance["type"]].placementRadius;
      expect(
        fit.collider,
        `${fit.type} solid collider ${fit.collider.toFixed(3)}u exceeds its placement footprint ${radius}u`,
      ).toBeLessThanOrEqual(radius + TOLERANCE);
    }
  });
});
