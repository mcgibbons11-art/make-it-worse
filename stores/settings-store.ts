"use client";
import { create } from "zustand";import { persist } from "zustand/middleware";
import type { AvatarConfig } from "@/lib/game/avatar";
export type QualityMode="auto"|"low"|"high";
// `avatar` is null until the player picks one, which is what makes the runner
// look exactly as it always did for anyone who never opens the picker.
// `avatarPrompted` is separate so dismissing the picker is remembered without
// silently signing the player up to a look they did not choose.
interface SettingsState{muted:boolean;volume:number;ghostEnabled:boolean;cameraShake:boolean;reducedMotion:boolean;quality:QualityMode;avatar:AvatarConfig|null;avatarPrompted:boolean;toggleMuted():void;setVolume(value:number):void;toggleGhost():void;toggleShake():void;toggleReducedMotion():void;setQuality(value:QualityMode):void;setAvatar(value:AvatarConfig):void;dismissAvatarPrompt():void;}
// Seed from the operating system rather than hardcoding false. The CSS
// prefers-reduced-motion block already covers keyframe animations, but the
// JS-driven motion (camera shake, haptics) only reads this flag, so an OS-level
// user was still getting both.
const prefersReducedMotion=typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const useSettingsStore=create<SettingsState>()(persist((set)=>({muted:false,volume:.65,ghostEnabled:true,cameraShake:!prefersReducedMotion,reducedMotion:prefersReducedMotion,quality:"auto",avatar:null,avatarPrompted:false,toggleMuted:()=>set((s)=>({muted:!s.muted})),setVolume:(volume)=>set({volume}),toggleGhost:()=>set((s)=>({ghostEnabled:!s.ghostEnabled})),toggleShake:()=>set((s)=>({cameraShake:!s.cameraShake})),toggleReducedMotion:()=>set((s)=>({reducedMotion:!s.reducedMotion})),setQuality:(quality)=>set({quality}),setAvatar:(avatar)=>set({avatar,avatarPrompted:true}),dismissAvatarPrompt:()=>set({avatarPrompted:true})}),{name:"miw-settings-v1"}));

// Mirror the preference onto the document so CSS can gate the celebration and
// failure animations. Doing it here means both editions get it without either
// having to remember to wire an effect.
if(typeof document!=="undefined"){
  const apply=(on:boolean)=>{document.documentElement.dataset["reducedMotion"]=on?"true":"false";};
  apply(useSettingsStore.getState().reducedMotion);
  useSettingsStore.subscribe((state)=>apply(state.reducedMotion));
}
