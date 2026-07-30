import type { ChallengeDTO, CreateShareInput, CreateShareResult, FinishAttemptInput, GuestProfile, PublishChildInput, PublishChildResult, RecordShareOpenInput, StartAttemptInput, AttemptFinishResult, AttemptStartResult } from "@/lib/game/types";
import type { BuiltTrack } from "@/lib/game/track";
export interface GameRepository { mode:"demo"|"supabase"; ensureGuest():Promise<GuestProfile>;updateProfile(displayName:string):Promise<GuestProfile>;listTrending(limit?:number):Promise<ChallengeDTO[]>;getChallenge(slug:string):Promise<ChallengeDTO>;/** `track` starts the chain on a composed course instead of the original level. */
  createRootChain(track?:readonly string[]):Promise<ChallengeDTO>;startAttempt(input:StartAttemptInput):Promise<AttemptStartResult>;finishAttempt(input:FinishAttemptInput):Promise<AttemptFinishResult>;publishChild(input:PublishChildInput):Promise<PublishChildResult>;createShare(input:CreateShareInput):Promise<CreateShareResult>;recordShareOpen(input:RecordShareOpenInput):Promise<void>;resetDemoData?():Promise<void>;
  // Only the local repository needs this. A shared link carries the whole
  // challenge, so the recipient adopts it before playing or extending the chain.
  importChallenge?(challenge:ChallengeDTO, runtimeTrack?:BuiltTrack):Promise<ChallengeDTO>;
  /** Geometry for an authored room, which has no segment recipe on ChallengeDTO. */
  getChallengeRuntimeTrack?(challengeSlug:string):Promise<BuiltTrack|null>; }
