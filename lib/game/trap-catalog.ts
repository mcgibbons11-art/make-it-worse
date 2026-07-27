import type { TrapType } from "./types";

export type TrapCategory = "sweeper" | "prop" | "movement";
export interface TrapDefinition { type: TrapType; displayName: string; articleName: string; shortDescription: string; category: TrapCategory; placementRadius: number; riskWeight: number; iconKey: string; defaultParams: Record<string, number | boolean | string>; }
export const TRAP_TYPES: readonly TrapType[] = ["swinging_hammer", "rolling_fridge", "floor_fan", "soap_slick", "spring_pad", "angry_vacuum", "rotating_toilet", "giant_beach_ball"];
export const TRAP_CATALOG: Record<TrapType, TrapDefinition> = {
  swinging_hammer: { type: "swinging_hammer", displayName: "Swinging Hammer", articleName: "a swinging hammer", shortDescription: "A foam mallet with impeccable timing.", category: "sweeper", placementRadius: 1.3, riskWeight: 1.2, iconKey: "hammer", defaultParams: { amplitude: 1, speed: 1.4 } },
  rolling_fridge: { type: "rolling_fridge", displayName: "Rolling Refrigerator", articleName: "a rolling refrigerator", shortDescription: "Waits politely, then charges.", category: "prop", placementRadius: 1.1, riskWeight: 1.45, iconKey: "fridge", defaultParams: { impulse: 7, mass: 4 } },
  floor_fan: { type: "floor_fan", displayName: "Floor Fan", articleName: "a floor fan", shortDescription: "Blows runners and props sideways.", category: "movement", placementRadius: 0.9, riskWeight: 0.8, iconKey: "fan", defaultParams: { force: 19, range: 4 } },
  soap_slick: { type: "soap_slick", displayName: "Soap Slick", articleName: "a soap slick", shortDescription: "Keeps momentum. Removes dignity.", category: "movement", placementRadius: 0.8, riskWeight: 0.7, iconKey: "soap", defaultParams: { traction: 0.12, wobble: 0.45 } },
  spring_pad: { type: "spring_pad", displayName: "Spring Pad", articleName: "a spring pad", shortDescription: "Helpful, if your destination is the sky.", category: "movement", placementRadius: 0.75, riskWeight: 0.9, iconKey: "spring", defaultParams: { upward: 8.8, forward: 3.2 } },
  angry_vacuum: { type: "angry_vacuum", displayName: "Angry Vacuum", articleName: "an angry vacuum", shortDescription: "Chases crumbs. You look crumb-shaped.", category: "prop", placementRadius: 1.2, riskWeight: 1.55, iconKey: "vacuum", defaultParams: { speed: 2.7, suction: 13, leash: 2.4 } },
  rotating_toilet: { type: "rotating_toilet", displayName: "Rotating Toilet", articleName: "a rotating toilet", shortDescription: "Luxury plumbing with a combat radius.", category: "sweeper", placementRadius: 1.25, riskWeight: 1.05, iconKey: "toilet", defaultParams: { speed: 1.5, radius: 1.6 } },
  giant_beach_ball: { type: "giant_beach_ball", displayName: "Giant Beach Ball", articleName: "a giant beach ball", shortDescription: "Bouncy, grabby, and completely unhelpful.", category: "prop", placementRadius: 0.8, riskWeight: 0.6, iconKey: "ball", defaultParams: { radius: 0.75, restitution: 0.82 } },
};
export function trapName(type: TrapType): string { return TRAP_CATALOG[type].displayName.toLowerCase(); }
