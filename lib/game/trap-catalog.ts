import type { TrapType } from "./types";

// riskWeight is derived from measured hazard output, not hand-tuned per trap.
// It is the only input to the score the player is ever shown, so it has to
// track what a trap actually does to a runner rather than what its name
// suggests. tests/unit/risk-calibration.test.ts re-runs the rule below and
// fails if any weight here drifts from it.
//
// WHAT A CONTACT COSTS. Every trap reports an impulse magnitude through
// onHazard. GameScene turns that, and only that, into the two things a runner
// feels:
//     stun      = clamp(impulse * 22, 250, 500) ms, during which
//                 PlayerController cuts acceleration to 25%
//     knockback = min(5.5, 1.8 + impulse * 0.22), applied along -Z
// So a trap's hazard output is fully described by the impulse it reports and
// how often it may report again while the runner is still in reach.
//
// THE RULE. Over one exposure window E a trap lands
//     contacts  = 1 + E / repeatGate        (a one-shot lands exactly 1)
// and its hazard is the mean of two shares, each capped by a real limit taken
// from the game's own constants rather than by taste:
//     stunShare = min(1, contacts * stun / E)
//                 share of the window spent with steering cut. Cannot pass 1
//                 because a runner cannot be more than fully stunned.
//     pushShare = min(1, contacts * knockback / (E/1000) / 7.5)
//                 backward velocity imposed per second, against the 7.5 m/s^2
//                 a stunned runner can accelerate back at (PLAYER.acceleration
//                 * 0.25). Past a ratio of 1 the runner is being driven
//                 backwards whatever they do, so further push buys nothing.
//     hazard    = (stunShare + pushShare) / 2
// riskWeight = round(hazard * 1.7631, 0.05). The single scale constant is
// chosen so the roster mean stays at its previous 1.066, which leaves the
// survivalOdds fit in difficulty.ts calibrated.
//
// E = 1000 ms is the one judgement call. The widest hazard fields in the game
// are the vacuum's 4.5u chase radius and the fan's 4.2u cone, which a 7.2 m/s
// runner crosses in about 600 ms; 1000 ms allows for a hit runner keeping only
// a quarter of their steering. Raising E favours repeaters and lowering it
// favours one-shots, so this constant sets the spread of the whole table.
//
// MEASURED INPUTS. Impulse passed to contact(), and the gate that lets a trap
// report again while the runner stays in reach. Re-derive from these.
//   trap              impulse  gate ms  where
//   floor_fan            19      450    TrapRenderer Fan
//   angry_vacuum         13      500    TrapRenderer Vacuum
//   soap_slick            4      450    TrapRenderer Soap
//   spring_pad           12      500    TrapRenderer Spring
//   robot_mop             7      500    LauncherTraps MOP_CONTACT_COOLDOWN_MS
//   sprinkler         12.47      700    ForceTraps SPRINKLER_REPORT_MS
//   banana_peel           6     1400    LauncherTraps BANANA_COOLDOWN_MS
//   toaster_launcher      8     2400    LauncherTraps, fires on `interval`
//   fridge_magnet        16        -    ForceTraps, one grab per approach
//   swinging_hammer      15        -    TrapRenderer Hammer
//   rolling_fridge       14        -    TrapRenderer Fridge, one charge
//   rotating_toilet      13        -    TrapRenderer Toilet
//   ceiling_fan          12        -    LauncherTraps CEILING_FAN_IMPULSE
//   mousetrap            11        -    ForceTraps, disarms permanently
//   giant_beach_ball      7        -    TrapRenderer Ball
//   laundry_basket        0        -    ForceTraps, never calls contact()
//   paint_bucket         15     2800    NewTraps NEW_TRAP_HAZARD.paint_bucket
//   spin_cycle           12     2600    NewTraps NEW_TRAP_HAZARD.spin_cycle
//   sticky_gum            4     1200    NewTraps NEW_TRAP_HAZARD.sticky_gum
//   cord_trip            12     1500    NewTraps NEW_TRAP_HAZARD.cord_trip
//   drawer_slam           9     3400    NewTraps NEW_TRAP_HAZARD.drawer_slam
//   rug_pull              8     2000    NewTraps NEW_TRAP_HAZARD.rug_pull
//   conveyor_strip        6      800    TrapsWaveA WAVE_A_HAZARD.conveyor_strip
//   tilt_plate           10     2000    TrapsWaveA WAVE_A_HAZARD.tilt_plate
//   motion_sensor         9     1800    TrapsWaveA WAVE_A_HAZARD.motion_sensor
//   domino_line          13     4000    TrapsWaveA WAVE_A_HAZARD.domino_line
//   bunting_line         12     1800    TrapsWaveA WAVE_A_HAZARD.bunting_line
//   steam_vents           9     1100    TrapsWaveA WAVE_A_HAZARD.steam_vents
//   pipe_burst           13     2600    TrapsWaveA WAVE_A_HAZARD.pipe_burst
//   ankle_weight          9        -    TrapsWaveA, clamps on once per attempt
//   chute_drop           11     3400    TrapsWaveA WAVE_A_HAZARD.chute_drop
//   cart_blocker          9     1500    TrapsWaveA WAVE_A_HAZARD.cart_blocker
//   dust_bunny            6     1200    TrapsWaveA WAVE_A_HAZARD.dust_bunny
//   flood_puddle          5     1100    TrapsWaveA WAVE_A_HAZARD.flood_puddle
//   updraft_vent          4     1200    TrapsWaveA WAVE_A_HAZARD.updraft_vent
//   mattress_rebound     11     1500    TrapsWaveA WAVE_A_HAZARD.mattress_rebound
//   plate_shards         10     1500    TrapsWaveA WAVE_A_HAZARD.plate_shards
//   cat_flap             11     2000    TrapsWaveA WAVE_A_HAZARD.cat_flap
//   paparazzi             8     2400    traps-wave-b WAVE_B_HAZARD.paparazzi
//   bathroom_scales      13     2800    traps-wave-b WAVE_B_HAZARD.bathroom_scales
//   slow_fuse            11     2600    traps-wave-b WAVE_B_HAZARD.slow_fuse
//   pile_on              13     2600    traps-wave-b WAVE_B_HAZARD.pile_on
//   bin_pedal            11     2600    traps-wave-b WAVE_B_HAZARD.bin_pedal
//   swing_door           14     2000    traps-wave-b WAVE_B_HAZARD.swing_door
//   ball_machine         10     1700    traps-wave-b WAVE_B_HAZARD.ball_machine
//   cuckoo_clock         15     3300    traps-wave-b WAVE_B_HAZARD.cuckoo_clock
//   fish_bowl             6     1400    traps-wave-b WAVE_B_HAZARD.fish_bowl
//   shoe_rack            13     3000    traps-wave-b WAVE_B_HAZARD.shoe_rack
//   hot_potato           15     3200    traps-wave-b WAVE_B_HAZARD.hot_potato
//   stove_ring           10     1800    traps-wave-b WAVE_B_HAZARD.stove_ring
//   clothes_airer         8     1600    traps-wave-b WAVE_B_HAZARD.clothes_airer
//   ice_dispenser        19        -    traps-wave-b, one magazine per attempt
//   kettle_boil           9     1500    traps-wave-b WAVE_B_HAZARD.kettle_boil
//   junk_drift            5     1200    traps-wave-b WAVE_B_HAZARD.junk_drift
//   charles_murder_baby  13     1000    CharlesTrap constants
// The sixteen in TrapsWaveB.tsx keep both numbers in WAVE_B_HAZARD, in
// lib/game/traps-wave-b.ts rather than in the component file, because that
// module has to be readable from the migration parity test as well as from the
// components. tests/unit/traps-wave-b.test.ts re-runs the rule against it.
//
// Two of those rows are worth reading twice. The shoe rack's opening shove is
// deliberately NOT a reported contact: it moves the runner sideways and does no
// stun, so counting it would price the trap as a two-contact repeater rather
// than the one-hit combination it is. And the junk drift grows its FOOTPRINT
// with the clutter around it rather than its impulse, which the known
// limitation at the foot of this comment says the rule cannot see at all; it is
// bounded in the component for exactly that reason.
//
// The sixteen in TrapsWaveA.tsx follow NewTraps.tsx exactly: both numbers live
// in WAVE_A_HAZARD and the components read their cycle lengths and cooldowns out
// of it, so the rows above cannot drift from what the traps do. Adding them
// moves the roster mean from 1.064 to 1.067, which leaves the survivalOdds fit
// in difficulty.ts calibrated at the scale constant below.
//
// The six in NewTraps.tsx read both numbers out of NEW_TRAP_HAZARD rather than
// carrying their own literals: the cycle a trap fires on is the gate it can
// report on, so the table above cannot drift from the components. Adding them
// moves the roster mean from 1.069 to 1.064, which leaves the survivalOdds fit
// in difficulty.ts calibrated at the scale constant chosen below.
//
// The gum is the clearest case of the known limitation below. What it does to a
// runner is brake them every frame they stand in it, and the rule sees only the
// stun and the knockback of an occasional contact, so 1 is the price of the
// punctuation rather than of the mechanic.
// Two of these are not the trap's nominal parameter. The sprinkler's `push` is
// 14 but it returns early inside SPRINKLER_MIN_RADIUS, so 12.47 is the most it
// can ever report. The magnet reports its full `pull` of 16 on entering the
// field, where the force it is actually applying is near zero, so its stun and
// knockback are larger than what the runner felt.
//
// KNOWN LIMITATION. E is the same for every trap, so a small footprint (soap,
// 1.8u across) is credited the same dwell as a wide field (the fan's 4.2u
// cone). Hazard footprint is not modelled, which flatters the small repeaters.
//
// SECOND KNOWN LIMITATION, made obvious by ankle_weight. The rule prices a
// trap by what it does inside one 1000ms window, so a cost that outlives the
// window is invisible to it. The weights clamp on once, report once, and then
// tax every step for the remainder of the attempt; the rule sees the single
// contact and prices it 0.65, near the bottom of the table. Chewed gum has the
// same shape at a smaller scale. Both are underpriced on purpose rather than by
// oversight: inventing a bonus for them by hand is exactly the hand-tuning the
// rule exists to stop, and the fix is to model dwell, not to fudge two rows.

export type TrapCategory = "sweeper" | "prop" | "movement";
export interface TrapDefinition { type: TrapType; displayName: string; articleName: string; shortDescription: string; category: TrapCategory; placementRadius: number; riskWeight: number; iconKey: string; defaultParams: Record<string, number | boolean | string>; }
// Order is load-bearing: challenge links encode a trap as its index here, so
// new entries must be appended and existing ones never reordered or removed.
export const TRAP_TYPES: readonly TrapType[] = ["swinging_hammer", "rolling_fridge", "floor_fan", "soap_slick", "spring_pad", "angry_vacuum", "rotating_toilet", "giant_beach_ball", "toaster_launcher", "ceiling_fan", "banana_peel", "robot_mop", "mousetrap", "sprinkler", "laundry_basket", "fridge_magnet", "paint_bucket", "spin_cycle", "sticky_gum", "cord_trip", "drawer_slam", "rug_pull", "conveyor_strip", "tilt_plate", "motion_sensor", "domino_line", "bunting_line", "steam_vents", "pipe_burst", "ankle_weight", "chute_drop", "cart_blocker", "dust_bunny", "flood_puddle", "updraft_vent", "mattress_rebound", "plate_shards", "cat_flap", "paparazzi", "bathroom_scales", "slow_fuse", "pile_on", "bin_pedal", "swing_door", "ball_machine", "cuckoo_clock", "fish_bowl", "shoe_rack", "hot_potato", "stove_ring", "clothes_airer", "ice_dispenser", "kettle_boil", "junk_drift", "charles_murder_baby"];
export const TRAP_CATALOG: Record<TrapType, TrapDefinition> = {
  swinging_hammer: { type: "swinging_hammer", displayName: "Swinging Hammer", articleName: "a swinging hammer", shortDescription: "A foam mallet with impeccable timing.", category: "sweeper", placementRadius: 1.3, riskWeight: 0.9, iconKey: "hammer", defaultParams: { amplitude: 1, speed: 1.4 } },
  rolling_fridge: { type: "rolling_fridge", displayName: "Rolling Refrigerator", articleName: "a rolling refrigerator", shortDescription: "Waits politely, then charges.", category: "prop", placementRadius: 1.1, riskWeight: 0.85, iconKey: "fridge", defaultParams: { impulse: 7, mass: 4 } },
  floor_fan: { type: "floor_fan", displayName: "Floor Fan", articleName: "a floor fan", shortDescription: "Blows runners and props sideways.", category: "movement", placementRadius: 0.9, riskWeight: 1.75, iconKey: "fan", defaultParams: { force: 19, range: 4 } },
  soap_slick: { type: "soap_slick", displayName: "Soap Slick", articleName: "a soap slick", shortDescription: "Keeps momentum. Removes dignity.", category: "movement", placementRadius: 0.8, riskWeight: 1.6, iconKey: "soap", defaultParams: { traction: 0.12, wobble: 0.45 } },
  // `upward` used to sit alongside `forward` here and was read by nothing: the
  // pad hard-coded its own launch and always had. It is gone rather than
  // corrected because the launch is now derived from PLAYER.jumpVelocity in
  // TrapRenderer, so that a gravity retune cannot leave the pad lifting less
  // than a plain jump again, and a placement must not be able to move it.
  spring_pad: { type: "spring_pad", displayName: "Spring Pad", articleName: "a spring pad", shortDescription: "Helpful, if your destination is the sky.", category: "movement", placementRadius: 0.75, riskWeight: 1.6, iconKey: "spring", defaultParams: { forward: 3.2 } },
  angry_vacuum: { type: "angry_vacuum", displayName: "Angry Vacuum", articleName: "an angry vacuum", shortDescription: "Chases crumbs. You look crumb-shaped.", category: "prop", placementRadius: 1.2, riskWeight: 1.65, iconKey: "vacuum", defaultParams: { speed: 2.7, suction: 13, leash: 2.4 } },
  rotating_toilet: { type: "rotating_toilet", displayName: "Rotating Toilet", articleName: "a rotating toilet", shortDescription: "Luxury plumbing with a combat radius.", category: "sweeper", placementRadius: 1.25, riskWeight: 0.8, iconKey: "toilet", defaultParams: { speed: 1.5, radius: 1.6 } },
  giant_beach_ball: { type: "giant_beach_ball", displayName: "Giant Beach Ball", articleName: "a giant beach ball", shortDescription: "Bouncy, grabby, and completely unhelpful.", category: "prop", placementRadius: 0.8, riskWeight: 0.6, iconKey: "ball", defaultParams: { radius: 0.75, restitution: 0.82 } },
  toaster_launcher: { type: "toaster_launcher", displayName: "Toaster Launcher", articleName: "a toaster launcher", shortDescription: "Fires breakfast at head height.", category: "prop", placementRadius: 0.85, riskWeight: 0.9, iconKey: "toaster", defaultParams: { interval: 2.4, muzzleSpeed: 9 } },
  ceiling_fan: { type: "ceiling_fan", displayName: "Ceiling Fan", articleName: "a ceiling fan", shortDescription: "Sweeps the air you were about to jump through.", category: "sweeper", placementRadius: 1.4, riskWeight: 0.75, iconKey: "ceilingfan", defaultParams: { speed: 1.9, radius: 1.5 } },
  banana_peel: { type: "banana_peel", displayName: "Banana Peel", articleName: "a banana peel", shortDescription: "The oldest joke still works.", category: "movement", placementRadius: 0.6, riskWeight: 1, iconKey: "banana", defaultParams: { launch: 5.5 } },
  robot_mop: { type: "robot_mop", displayName: "Robot Mop", articleName: "a robot mop", shortDescription: "Patrols. Polishes. Ruins footing.", category: "prop", placementRadius: 1, riskWeight: 1.55, iconKey: "mop", defaultParams: { patrol: 2.2, speed: 1.6 } },
  mousetrap: { type: "mousetrap", displayName: "Giant Mousetrap", articleName: "a giant mousetrap", shortDescription: "Patient, then extremely sudden.", category: "sweeper", placementRadius: 0.9, riskWeight: 0.7, iconKey: "mousetrap", defaultParams: { snap: 11 } },
  sprinkler: { type: "sprinkler", displayName: "Rogue Sprinkler", articleName: "a rogue sprinkler", shortDescription: "Waters the floor and everyone on it.", category: "movement", placementRadius: 0.95, riskWeight: 1.45, iconKey: "sprinkler", defaultParams: { sweep: 1.3, push: 14 } },
  // The one trap the rule above prices at zero: LaundryBasketTrap does not even
  // take onHazard, so it reports no impulse, and no impulse means no stun and no
  // knockback. What it does leave behind is five dynamic socks, which a fan or a
  // vacuum can push into the runner, so it is scenery a pusher can use rather
  // than a hazard. 0.05 is that and nothing more. Raise it the moment the trap
  // calls contact(): the mechanic is still missing, and "you made it N% worse"
  // is the whole reward, so a trap the player spends a pick on must do something.
  laundry_basket: { type: "laundry_basket", displayName: "Laundry Basket", articleName: "a laundry basket", shortDescription: "Tips over. Spills grabbable chaos.", category: "prop", placementRadius: 0.9, riskWeight: 0.05, iconKey: "basket", defaultParams: { socks: 5 } },
  fridge_magnet: { type: "fridge_magnet", displayName: "Industrial Magnet", articleName: "an industrial magnet", shortDescription: "Physics has opinions about your belt buckle.", category: "movement", placementRadius: 1.05, riskWeight: 0.95, iconKey: "magnet", defaultParams: { pull: 16, range: 3.4 } },
  // The six below live in components/game/traps/NewTraps.tsx. Their params are
  // reach and geometry only: the impulse each reports and the gate it may
  // report again on are module constants there, so a tuned placement cannot
  // move a weight out from under the rule above.
  paint_bucket: { type: "paint_bucket", displayName: "Paint Bucket", articleName: "a paint bucket", shortDescription: "Picks a spot, then commits to it.", category: "sweeper", placementRadius: 1, riskWeight: 1.2, iconKey: "paintbucket", defaultParams: { splash: 1.15, track: 3 } },
  spin_cycle: { type: "spin_cycle", displayName: "Washing Machine", articleName: "a washing machine", shortDescription: "Winds up loudly, then throws the room.", category: "movement", placementRadius: 1, riskWeight: 1.05, iconKey: "washer", defaultParams: { burst: 2.2 } },
  sticky_gum: { type: "sticky_gum", displayName: "Chewed Gum", articleName: "a wad of chewed gum", shortDescription: "Takes your momentum and keeps it.", category: "movement", placementRadius: 0.7, riskWeight: 1, iconKey: "gum", defaultParams: { radius: 0.72, grip: 9 } },
  cord_trip: { type: "cord_trip", displayName: "Extension Cord", articleName: "an extension cord", shortDescription: "Only catches runners in a hurry.", category: "sweeper", placementRadius: 0.85, riskWeight: 1.25, iconKey: "cord", defaultParams: { span: 1.7, tripSpeed: 4.2 } },
  drawer_slam: { type: "drawer_slam", displayName: "Cutlery Drawer", articleName: "a cutlery drawer", shortDescription: "Shuts the lane on a schedule.", category: "prop", placementRadius: 1, riskWeight: 0.85, iconKey: "drawer", defaultParams: { travel: 1.35 } },
  rug_pull: { type: "rug_pull", displayName: "Trick Rug", articleName: "a trick rug", shortDescription: "Waits until both feet are on it.", category: "prop", placementRadius: 0.95, riskWeight: 0.95, iconKey: "rug", defaultParams: { yank: 1.6 } },
  // The sixteen below live in components/game/traps/TrapsWaveA.tsx. As with the
  // six above, their params carry reach and geometry only: the impulse each
  // reports and the gate it may report again on are module constants there, so
  // a tuned placement cannot move a weight out from under the rule.
  //
  // placementRadius is deliberately smaller than the equivalent older traps.
  // The classic course has a fixed set of fifteen zones and a hard overlap rule
  // of 0.75 x (r1 + r2), so radius is what decides how many of the roster can
  // stand on it at once. At the radii the first twenty-two use, a thirty-eight
  // entry roster does not fit anywhere on the classic course at all. Free
// placement has since opened every LevelPiece as a placement surface, so the
// eight authored zones are no longer the whole board, but a small radius is
// still what decides how many of the roster can share a piece of floor.
  conveyor_strip: { type: "conveyor_strip", displayName: "Conveyor Strip", articleName: "a conveyor strip", shortDescription: "Takes you somewhere. Not where you wanted.", category: "movement", placementRadius: 0.85, riskWeight: 1.3, iconKey: "conveyor", defaultParams: { carry: 3.4, length: 2.4, width: 1.5 } },
  tilt_plate: { type: "tilt_plate", displayName: "Tilting Plate", articleName: "a tilting plate", shortDescription: "Dumps you off whichever side you loaded.", category: "movement", placementRadius: 0.75, riskWeight: 1.05, iconKey: "tiltplate", defaultParams: { plate: 0.9, tip: 4.2 } },
  motion_sensor: { type: "motion_sensor", displayName: "Motion Sensor", articleName: "a motion sensor", shortDescription: "Only sees you if you are moving.", category: "prop", placementRadius: 0.6, riskWeight: 1.05, iconKey: "sensor", defaultParams: { reach: 3.2, arc: 0.55, stillSpeed: 1.4 } },
  domino_line: { type: "domino_line", displayName: "Domino Line", articleName: "a line of dominoes", shortDescription: "Harmless until something else shoves it.", category: "prop", placementRadius: 0.8, riskWeight: 1, iconKey: "domino", defaultParams: { span: 1.8 } },
  bunting_line: { type: "bunting_line", displayName: "Party Bunting", articleName: "a string of party bunting", shortDescription: "Strung at exactly jump height.", category: "sweeper", placementRadius: 0.7, riskWeight: 1.15, iconKey: "bunting", defaultParams: { span: 2, clearance: 0.75 } },
  steam_vents: { type: "steam_vents", displayName: "Steam Vents", articleName: "a bank of steam vents", shortDescription: "Three lanes. One of them is lying.", category: "sweeper", placementRadius: 0.85, riskWeight: 1.25, iconKey: "steam", defaultParams: { spread: 0.95, blast: 0.7 } },
  pipe_burst: { type: "pipe_burst", displayName: "Rattling Pipe", articleName: "a rattling pipe", shortDescription: "Makes its noise at the safe end.", category: "prop", placementRadius: 0.65, riskWeight: 1.1, iconKey: "pipe", defaultParams: { run: 2.6, blast: 0.9 } },
  ankle_weight: { type: "ankle_weight", displayName: "Ankle Weights", articleName: "a pair of ankle weights", shortDescription: "You keep these for the rest of the run.", category: "movement", placementRadius: 0.55, riskWeight: 0.65, iconKey: "weights", defaultParams: { reach: 0.55, drag: 1.6 } },
  chute_drop: { type: "chute_drop", displayName: "Laundry Chute", articleName: "a laundry chute", shortDescription: "Puts you back where it thinks you belong.", category: "prop", placementRadius: 0.9, riskWeight: 0.95, iconKey: "chute", defaultParams: { mouth: 0.8, setback: 2.6 } },
  cart_blocker: { type: "cart_blocker", displayName: "Runaway Trolley", articleName: "a runaway trolley", shortDescription: "Copies your sidestep. Every time.", category: "prop", placementRadius: 0.9, riskWeight: 1.1, iconKey: "trolley", defaultParams: { travel: 1.4, track: 2.2 } },
  dust_bunny: { type: "dust_bunny", displayName: "Dust Bunny", articleName: "a dust bunny", shortDescription: "Walks where you walked, a moment late.", category: "prop", placementRadius: 0.6, riskWeight: 1.1, iconKey: "dustbunny", defaultParams: { lag: 1600, chase: 3.6 } },
  flood_puddle: { type: "flood_puddle", displayName: "Overflowing Sink", articleName: "an overflowing sink", shortDescription: "Bigger the longer you dither.", category: "movement", placementRadius: 0.75, riskWeight: 1.05, iconKey: "sink", defaultParams: { start: 0.7, growth: 0.055, widest: 2 } },
  updraft_vent: { type: "updraft_vent", displayName: "Floor Vent", articleName: "a floor vent", shortDescription: "Only lifts you once you have left the ground.", category: "movement", placementRadius: 0.65, riskWeight: 1, iconKey: "updraft", defaultParams: { reach: 0.9, lift: 4.2, ceiling: 2.6 } },
  mattress_rebound: { type: "mattress_rebound", displayName: "Propped Mattress", articleName: "a propped mattress", shortDescription: "Gives your speed back, pointing the other way.", category: "prop", placementRadius: 0.9, riskWeight: 1.2, iconKey: "mattress", defaultParams: { span: 1.8, bounce: 1.15 } },
  plate_shards: { type: "plate_shards", displayName: "Plate Stack", articleName: "a stack of plates", shortDescription: "One nudge, and the floor is ruined for good.", category: "sweeper", placementRadius: 0.7, riskWeight: 1.15, iconKey: "plates", defaultParams: { spread: 2.4 } },
  cat_flap: { type: "cat_flap", displayName: "Cat Flap", articleName: "a cat flap", shortDescription: "Crawl or sprint. Anything between hurts.", category: "sweeper", placementRadius: 0.8, riskWeight: 1.05, iconKey: "catflap", defaultParams: { span: 1.3, slow: 2.2, fast: 6 } },
  // The sixteen below live in components/game/traps/TrapsWaveB.tsx, and follow
  // the same split as the two waves above: reach and geometry are here and
  // tunable per placement, while the impulse each reports and the gate it may
  // report again on are in WAVE_B_HAZARD in lib/game/traps-wave-b.ts, where a
  // placement cannot reach them. WAVE_B_SCHEDULE in the same module holds the
  // phase timings that carry a counter-play rather than a look.
  //
  // Adding them moves the roster mean from 1.06711 to 1.06667, which leaves the
  // survivalOdds fit in difficulty.ts calibrated at the scale constant above.
  paparazzi: { type: "paparazzi", displayName: "Paparazzo", articleName: "a paparazzo", shortDescription: "Takes your picture. Takes your view.", category: "prop", placementRadius: 0.85, riskWeight: 0.9, iconKey: "camera", defaultParams: { reach: 3.2, blind: 6 } },
  bathroom_scales: { type: "bathroom_scales", displayName: "Bathroom Scales", articleName: "a set of bathroom scales", shortDescription: "Ignores your walk. Reads your landing.", category: "sweeper", placementRadius: 0.95, riskWeight: 1.1, iconKey: "scales", defaultParams: { pad: 0.95, impact: 5 } },
  slow_fuse: { type: "slow_fuse", displayName: "Kitchen Timer", articleName: "a kitchen timer", shortDescription: "Charges you here, collects somewhere else.", category: "prop", placementRadius: 0.8, riskWeight: 1, iconKey: "timer", defaultParams: { radius: 0.9, blast: 1.2 } },
  pile_on: { type: "pile_on", displayName: "Toppling Bookcase", articleName: "a toppling bookcase", shortDescription: "Only falls on someone already falling.", category: "prop", placementRadius: 1.1, riskWeight: 1.1, iconKey: "bookcase", defaultParams: { radius: 1.5 } },
  bin_pedal: { type: "bin_pedal", displayName: "Pedal Bin", articleName: "a pedal bin", shortDescription: "Perfectly safe until you step off it.", category: "movement", placementRadius: 0.9, riskWeight: 1, iconKey: "pedalbin", defaultParams: { pedal: 0.8, swipe: 1.4 } },
  swing_door: { type: "swing_door", displayName: "Swing Door", articleName: "a swing door", shortDescription: "Lets you through, then changes its mind.", category: "sweeper", placementRadius: 1.15, riskWeight: 1.25, iconKey: "swingdoor", defaultParams: { span: 1.9 } },
  ball_machine: { type: "ball_machine", displayName: "Ball Machine", articleName: "a ball machine", shortDescription: "Fires at where you are going to be.", category: "movement", placementRadius: 0.95, riskWeight: 1.1, iconKey: "ballmachine", defaultParams: { range: 3.6, spread: 0.85 } },
  cuckoo_clock: { type: "cuckoo_clock", displayName: "Cuckoo Clock", articleName: "a cuckoo clock", shortDescription: "Chimes twice. Bites on the third.", category: "sweeper", placementRadius: 0.9, riskWeight: 1.15, iconKey: "cuckoo", defaultParams: { reach: 1.5 } },
  fish_bowl: { type: "fish_bowl", displayName: "Fish Bowl", articleName: "a fish bowl", shortDescription: "Hates a runner who keeps changing pace.", category: "movement", placementRadius: 0.85, riskWeight: 1, iconKey: "fishbowl", defaultParams: { radius: 1.5, jolt: 18 } },
  shoe_rack: { type: "shoe_rack", displayName: "Shoe Rack", articleName: "a shoe rack", shortDescription: "Kicks you into the spot it lands on.", category: "sweeper", placementRadius: 1, riskWeight: 1.05, iconKey: "shoerack", defaultParams: { reach: 2.2, crush: 1.3, offset: 1.5 } },
  hot_potato: { type: "hot_potato", displayName: "Hot Potato", articleName: "a hot potato", shortDescription: "Harmless until something moves it.", category: "prop", placementRadius: 0.7, riskWeight: 1.15, iconKey: "potato", defaultParams: { blast: 1.1 } },
  stove_ring: { type: "stove_ring", displayName: "Hob Ring", articleName: "a hob ring", shortDescription: "The only safe spot is the middle.", category: "movement", placementRadius: 0.85, riskWeight: 1.05, iconKey: "hobring", defaultParams: { eye: 0.55, flare: 1.7 } },
  clothes_airer: { type: "clothes_airer", displayName: "Clothes Airer", articleName: "a clothes airer", shortDescription: "Ignores runners. Catches dodgers.", category: "sweeper", placementRadius: 1, riskWeight: 1.05, iconKey: "airer", defaultParams: { length: 2.1, sidestep: 2.6 } },
  ice_dispenser: { type: "ice_dispenser", displayName: "Ice Dispenser", articleName: "an ice dispenser", shortDescription: "One magazine, then it is furniture.", category: "prop", placementRadius: 1.1, riskWeight: 1, iconKey: "icedispenser", defaultParams: { range: 4.5, spread: 1.3 } },
  kettle_boil: { type: "kettle_boil", displayName: "Boiling Kettle", articleName: "a boiling kettle", shortDescription: "Comes to the boil on its own schedule.", category: "movement", placementRadius: 0.9, riskWeight: 1.1, iconKey: "kettle", defaultParams: { scald: 1.9 } },
  junk_drift: { type: "junk_drift", displayName: "Junk Drift", articleName: "a drift of junk", shortDescription: "Grows on whatever is standing near it.", category: "prop", placementRadius: 0.75, riskWeight: 1.05, iconKey: "junkdrift", defaultParams: { base: 0.75, feed: 4.5 } },
  charles_murder_baby: { type: "charles_murder_baby", displayName: "Charles the Murder Baby", articleName: "a murder baby named Charles", shortDescription: "He crawls. He judges. He has chosen violence.", category: "prop", placementRadius: 0.7, riskWeight: 1.4, iconKey: "charles", defaultParams: { speed: 2.25, leash: 3.8, impulse: 13 } },
};
export function trapName(type: TrapType): string { return TRAP_CATALOG[type].displayName.toLowerCase(); }
