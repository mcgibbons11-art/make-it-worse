import { EXIT_POSITION, GRID_SIZE, PLAYER_SPAWN } from "./constants";
import { ZONE_MAP, zoneCenter } from "./level-definition";
import { TRAP_CATALOG } from "./trap-catalog";
import type { TrapInstance, TrapPlacementInput, PlacementValidation } from "./types";

export const snapToGrid = (value:number):number => Math.round(value / GRID_SIZE) * GRID_SIZE;
export function validatePlacement(input: TrapPlacementInput, existing: readonly TrapInstance[]): PlacementValidation {
  if (![input.offsetX,input.offsetZ,input.rotationQuarterTurns].every(Number.isFinite)) return {valid:false,reason:"invalid_number",message:"That position is not a real place."};
  const zone=ZONE_MAP.get(input.zoneId); if(!zone) return {valid:false,reason:"outside_zone",message:"Choose a highlighted placement zone."};
  if(!zone.allowedTypes.includes(input.type)) return {valid:false,reason:"type_not_allowed",message:"That trap is too large or unsafe here."};
  const occupants=existing.filter((trap)=>trap.zoneId===zone.id); if(occupants.length>=zone.maxOccupants) return {valid:false,reason:"zone_full",message:"This spot is already disastrous enough."};
  const [cx,cz]=zoneCenter(zone); const ox=snapToGrid(input.offsetX); const oz=snapToGrid(input.offsetZ); const x=cx+ox; const z=cz+oz; const radius=TRAP_CATALOG[input.type].placementRadius;
  const edgeClearance=radius*.5;
  if(x-edgeClearance<zone.minX||x+edgeClearance>zone.maxX||z-edgeClearance<zone.minZ||z+edgeClearance>zone.maxZ) return {valid:false,reason:"outside_zone",message:"Keep the trap base inside the zone."};
  for(const trap of existing){ const other=TRAP_CATALOG[trap.type].placementRadius; const multiplier=zone.id.startsWith("bridge")?.95:.75; if(Math.hypot(x-trap.position[0],z-trap.position[2])<multiplier*(radius+other)) return {valid:false,reason:"overlaps_trap",message:"Give the other disaster some room."}; }
  if(Math.hypot(x-PLAYER_SPAWN[0],z-PLAYER_SPAWN[2])<2.2+radius) return {valid:false,reason:"blocks_spawn",message:"The runner needs somewhere to start."};
  if(Math.hypot(x-EXIT_POSITION[0],z-EXIT_POSITION[2])<1.5+radius) return {valid:false,reason:"blocks_exit",message:"Leave the exit barely survivable."};
  if((input.type==="rotating_toilet"||input.type==="swinging_hammer")&&zone.id.startsWith("stones")) return {valid:false,reason:"unsafe_sweep",message:"The sweep would leave no path."};
  return {valid:true,canonicalPosition:[x,zone.groundY,z],rotationY:input.rotationQuarterTurns*Math.PI/2};
}
export function placementFromWorld(type: TrapPlacementInput["type"], zoneId:string, worldX:number, worldZ:number, rotationQuarterTurns:0|1|2|3):TrapPlacementInput { const zone=ZONE_MAP.get(zoneId); if(!zone) return {type,zoneId,offsetX:Number.NaN,offsetZ:Number.NaN,rotationQuarterTurns}; const [cx,cz]=zoneCenter(zone); return {type,zoneId,offsetX:snapToGrid(worldX-cx),offsetZ:snapToGrid(worldZ-cz),rotationQuarterTurns}; }
