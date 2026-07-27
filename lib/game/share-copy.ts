import { TRAP_CATALOG } from "./trap-catalog";import type { ChallengeDTO } from "./types";
export function buildShareCopy(challenge:ChallengeDTO,url:string):string{const trap=challenge.addedTrap;if(!trap)return`Beat this clean level and make it worse: ${url}`;return`I added ${TRAP_CATALOG[trap.type].articleName} to this level. Beat it and make it worse: ${url}`;}
