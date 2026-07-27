import type { PlacementZone, TrapType, Vec3Tuple } from "./types";
import { TRAP_TYPES } from "./trap-catalog";

export interface LevelPiece { id: string; center: Vec3Tuple; size: Vec3Tuple; rotationX?: number; color: string; }
export const LEVEL_PIECES: readonly LevelPiece[] = [
  { id: "start", center: [0,-0.5,2.5], size: [8,1,5], color: "#ffd84d" }, { id: "runway", center: [0,-0.5,9.25], size: [6,1,8.5], color: "#fff8e8" },
  { id: "stone-a", center: [-1.6,-0.35,12.2], size: [2.4,.7,1.8], color: "#ff9b4a" }, { id: "stone-b", center: [0,0,14], size: [2.2,.7,1.8], color: "#ff9b4a" },
  { id: "stone-c", center: [1.5,-0.2,15.8], size: [2.4,.7,1.8], color: "#ff9b4a" }, { id: "bridge", center: [0,-0.45,20.6], size: [3,.9,10.2], color: "#8b72ff" },
  { id: "left-island", center: [-1.75,-0.4,27.1], size: [2.7,.8,4.8], color: "#4b8dff" }, { id: "center-island", center: [0,-0.4,27.1], size: [1.2,.8,4.8], color: "#6b9cff" }, { id: "right-island", center: [1.75,-0.4,27.1], size: [2.7,.8,4.8], color: "#4b8dff" },
  { id: "convergence", center: [0,-0.35,31.1], size: [5.6,.7,2.6], color: "#57dfa1" }, { id: "ramp", center: [0,0,34.05], size: [4,.6,3.6], rotationX: -.1, color: "#ffd84d" },
  { id: "finish", center: [0,0,38.1], size: [7,.8,6], color: "#fff8e8" },
];
const small: readonly TrapType[] = ["floor_fan", "soap_slick", "spring_pad", "giant_beach_ball"];
const rampTypes: readonly TrapType[] = ["swinging_hammer", "floor_fan", "soap_slick", "spring_pad", "rotating_toilet", "giant_beach_ball"];
const zone = (id:string,label:string,minX:number,maxX:number,minZ:number,maxZ:number,groundY:number,maxOccupants:number,allowedTypes:readonly TrapType[]=TRAP_TYPES):PlacementZone => ({id,label,minX,maxX,minZ,maxZ,groundY,maxOccupants,allowedTypes});
export const PLACEMENT_ZONES: readonly PlacementZone[] = [
  zone("runway_front","Runway front",-2.3,2.3,6,7.5,.05,2), zone("runway_mid","Runway middle",-2.3,2.3,7.8,9.2,.05,2), zone("runway_back","Runway back",-2.3,2.3,9.5,10.7,.05,2),
  zone("stones_front","First stones",-2.4,0,11.4,13,.1,1,small), zone("stones_mid","Middle stone",-1.2,1.2,13.2,14.8,.45,1,small), zone("stones_back","Last stone",0,2.5,15,16.4,.15,1,small),
  zone("bridge_front","Bridge front",-1.05,1.05,17.5,19.1,.05,1), zone("bridge_mid","Bridge middle",-1.05,1.05,19.5,21.1,.05,1,TRAP_TYPES.filter((t)=>t!=="rolling_fridge")), zone("bridge_back","Bridge back",-1.05,1.05,21.5,23.4,.05,1),
  zone("island_left","Left island",-2.75,-.7,25,29,.05,2), zone("island_right","Right island",.7,2.75,25,29,.05,2), zone("convergence","Convergence",-2.2,2.2,30.1,32,.05,2),
  zone("ramp","Ramp",-1.55,1.55,32.8,34.6,.45,1,rampTypes), zone("finish_front","Finish approach",-2.6,2.6,35.4,37,.45,2), zone("finish_mid","Finish middle",-2.4,2.4,37.3,38.7,.45,1),
];
export const ZONE_MAP = new Map(PLACEMENT_ZONES.map((entry)=>[entry.id,entry]));
export function zoneCenter(zone: PlacementZone): readonly [number,number] { return [(zone.minX+zone.maxX)/2,(zone.minZ+zone.maxZ)/2]; }
