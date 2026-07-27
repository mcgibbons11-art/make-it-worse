import { MAX_TRAPS } from "./constants";
import { PLACEMENT_ZONES } from "./level-definition";
import { createSeededRandom, hashString } from "./seed";
import { TRAP_CATALOG, TRAP_TYPES, type TrapCategory } from "./trap-catalog";
import type { TrapInstance, TrapType } from "./types";

export function getAvailableTrapTypes(existing:readonly TrapInstance[]):TrapType[]{ return TRAP_TYPES.filter((type)=>PLACEMENT_ZONES.some((zone)=>zone.allowedTypes.includes(type)&&existing.filter((trap)=>trap.zoneId===zone.id).length<zone.maxOccupants)); }
export function chooseTraps(attemptId:string,challengeId:string,baseSeed:number,existing:readonly TrapInstance[]):readonly [TrapType,TrapType,TrapType]|null{
  if(existing.length>=MAX_TRAPS)return null; const available=getAvailableTrapTypes(existing); if(available.length<3)return null; const rng=createSeededRandom(hashString(`${attemptId}:${challengeId}:${baseSeed}`)); const newest=existing.at(-1)?.type;
  const shuffled=[...available].sort(()=>rng()-.5); const selected:TrapType[]=[]; for(const category of ["sweeper","movement","prop"] as const satisfies readonly TrapCategory[]){ const pick=shuffled.find((type)=>TRAP_CATALOG[type].category===category&&!selected.includes(type)&&(type!==newest||shuffled.length<=3)); if(pick)selected.push(pick); }
  for(const type of shuffled){if(selected.length===3)break;if(!selected.includes(type))selected.push(type);} return [selected[0]!,selected[1]!,selected[2]!];
}
