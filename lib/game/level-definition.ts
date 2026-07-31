import type { PlacementZone, TrapType, Vec3Tuple } from "./types";
import { TRAP_TYPES } from "./trap-catalog";

export interface LevelPiece {
  id: string;
  center: Vec3Tuple;
  size: Vec3Tuple;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  color: string;
}
// The twelve pieces used to overlap continuously in Z from 0 to 41, so the
// widest gap anywhere on the course was 0.30u and the whole level could be run
// with W held down. The only thing that ever interrupted it was a 0.35u step
// from the runway up onto stone-b, and because the two overlapped in Z there was
// no gap in front of that step to read as one: the runner is a dynamic Rapier
// capsule with no character controller, so there is no autostep, and holding W
// from spawn simply stopped dead against an invisible wall four seconds in.
//
// The course now has five gaps a runner has to jump and no riser they can walk
// into. The order and the ids are unchanged so an existing challenge still
// rebuilds, and the total still ends at 41.10 because EXIT_POSITION sits at
// z 40.25 inside the finish room. Every centre and every edge lands on the
// level's 0.05u quantum.
//
// The stones now open dead ahead and then alternate, rather than opening on the
// left: the first jump a new player meets is a 1.20u hop straight forward off a
// wide runway onto a 2.60u pad, which is a fifth of what they can clear.
export const LEVEL_PIECES: readonly LevelPiece[] = [
  { id: "start", center: [0,-0.5,2], size: [8,1,4], color: "#ffd84d" }, { id: "runway", center: [0,-0.5,6.75], size: [6,1,5.5], color: "#fff8e8" },
  { id: "stone-a", center: [0,-0.35,11.5], size: [2.6,.7,1.8], color: "#ff9b4a" }, { id: "stone-b", center: [-1.75,-0.35,14.4], size: [2.6,.7,1.8], color: "#ff9b4a" },
  { id: "stone-c", center: [1.65,-0.35,17.3], size: [2.6,.7,1.8], color: "#ff9b4a" }, { id: "bridge", center: [0,-0.45,22.25], size: [2.6,.9,5.9], color: "#8b72ff" },
  // The three slabs used to overlap into one continuous 6.2u floor, so "pick a
  // side" was a paint job. The two lanes are now separated by a 2.10u void and
  // the middle is a sunken plank: a shorter line for anyone willing to drop 0.40
  // onto it and then clear a rising 0.60 gap back out.
  { id: "left-island", center: [-2.2,-0.4,28.4], size: [2.3,.8,4.2], color: "#4b8dff" }, { id: "center-island", center: [0,-0.75,28.1], size: [1.1,.7,3.6], color: "#6b9cff" }, { id: "right-island", center: [2.2,-0.4,28.4], size: [2.3,.8,4.2], color: "#4b8dff" },
  { id: "convergence", center: [0,-0.35,31.55], size: [5.6,.7,2.1], color: "#57dfa1" }, { id: "ramp", center: [0,-0.15,33.85], size: [4,.6,2.5], rotationX: -.1, color: "#ffd84d" },
  { id: "finish", center: [0,0,38.1], size: [7,.8,6], color: "#fff8e8" },
];
// These lists predate the roster growing from 8 to 16, so four of the classic
// course's fifteen zones accepted none of the newer traps. Every existing
// challenge runs this course, so the omission quietly narrowed the reward on
// the levels most people actually play.
//
// The stepping stones stay restrictive on purpose: they are small pads with
// mandatory landings, so anything that sweeps, chases, or covers the pad is
// still excluded. What is added here is small, static, or telegraphed.
const small: readonly TrapType[] = ["floor_fan", "soap_slick", "spring_pad", "giant_beach_ball", "banana_peel", "toaster_launcher", "laundry_basket", "ankle_weight", "updraft_vent"];
// The ramp takes anything that is not a large appliance: the slope is 1.8u deep
// and a cabinet or a washer standing on it would wall the climb off entirely.
const rampTypes: readonly TrapType[] = ["swinging_hammer", "floor_fan", "soap_slick", "spring_pad", "rotating_toilet", "giant_beach_ball", "banana_peel", "toaster_launcher", "ceiling_fan", "sprinkler", "robot_mop", "paint_bucket", "sticky_gum", "cord_trip", "rug_pull", "conveyor_strip", "tilt_plate", "motion_sensor", "domino_line", "bunting_line", "steam_vents", "pipe_burst", "ankle_weight", "dust_bunny", "flood_puddle", "updraft_vent", "plate_shards", "cat_flap"];
const zone = (id:string,label:string,minX:number,maxX:number,minZ:number,maxZ:number,groundY:number,maxOccupants:number,allowedTypes:readonly TrapType[]=TRAP_TYPES):PlacementZone => ({id,label,minX,maxX,minZ,maxZ,groundY,maxOccupants,allowedTypes});
// maxOccupants raised on the eleven wide zones. The roster went 22 -> 38 and the
// classic course had exactly 22 legal slots, so every trap added past that had
// nowhere legal to stand at all: the QA sandbox could no longer build one of
// each, and more importantly a reward could offer a trap that every zone on the
// course the player was actually on refused.
//
// This is a capacity change, not a spacing change. validatePlacement still
// enforces 0.75 x (r1 + r2) between neighbours and the zone's own edge
// clearance, so a higher cap cannot stack traps on top of each other - it only
// stops the count refusing a placement the geometry would have allowed. The
// stepping stones and the three bridge planks are deliberately left at 1: they
// are mandatory landings barely wider than the runner.
//
// 4 is the ceiling, not a preference: public.placement_zones constrains
// max_occupants to between 1 and 4 (0002_tables.sql), and the client must not
// accept a placement the RPC would then reject.
// Each zone sits on the piece it is named for, so these move with the geometry
// above. The ids, the allowlists and the occupancy caps are unchanged, which is
// what lets a stored placement replay: a trap records a zone id and an offset
// from that zone's centre, never a world position.
export const PLACEMENT_ZONES: readonly PlacementZone[] = [
  zone("runway_front","Runway front",-2.3,2.3,4.3,5.8,.05,4), zone("runway_mid","Runway middle",-2.3,2.3,6.1,7.5,.05,4), zone("runway_back","Runway back",-2.3,2.3,7.8,9,.05,4),
  // The stones take their whole pad. Inset by a tenth they were 1.6u deep, and
  // the QA sandbox drops a banana 0.5u off centre with 0.3u of edge clearance,
  // which lands on 0.8u of exactly 0.8u of room and fails on the last bit of a
  // float. The old stones_front was worse than knife-edge: it ran from -2.4 to
  // 0 over a pad that stopped at -0.4, so 0.4u of it hung over the void.
  zone("stones_front","First stones",-1.3,1.3,10.6,12.4,.05,1,small), zone("stones_mid","Middle stone",-3.05,-.45,13.5,15.3,.05,1,small), zone("stones_back","Last stone",.35,2.95,16.4,18.2,.05,1,small),
  zone("bridge_front","Bridge front",-1.05,1.05,19.5,21.1,.05,1), zone("bridge_mid","Bridge middle",-1.05,1.05,21.4,23,.05,1,TRAP_TYPES.filter((t)=>t!=="rolling_fridge")), zone("bridge_back","Bridge back",-1.05,1.05,23.1,25,.05,1),
  zone("island_left","Left island",-3.15,-1.25,26.5,30.5,.05,4), zone("island_right","Right island",1.25,3.15,26.5,30.5,.05,4), zone("convergence","Convergence",-2.2,2.2,30.6,32.5,.05,4),
  zone("ramp","Ramp",-1.55,1.55,32.7,34.5,.45,3,rampTypes), zone("finish_front","Finish approach",-2.6,2.6,35.4,37,.45,4), zone("finish_mid","Finish middle",-2.4,2.4,37.3,38.7,.45,4),
];
export const ZONE_MAP = new Map(PLACEMENT_ZONES.map((entry)=>[entry.id,entry]));
export function zoneCenter(zone: PlacementZone): readonly [number,number] { return [(zone.minX+zone.maxX)/2,(zone.minZ+zone.maxZ)/2]; }
