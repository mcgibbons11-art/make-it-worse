"use client";
import { create } from "zustand";import { persist } from "zustand/middleware";
export type QualityMode="auto"|"low"|"high";
interface SettingsState{muted:boolean;volume:number;ghostEnabled:boolean;cameraShake:boolean;reducedMotion:boolean;quality:QualityMode;toggleMuted():void;setVolume(value:number):void;toggleGhost():void;toggleShake():void;toggleReducedMotion():void;setQuality(value:QualityMode):void;}
export const useSettingsStore=create<SettingsState>()(persist((set)=>({muted:false,volume:.65,ghostEnabled:true,cameraShake:true,reducedMotion:false,quality:"auto",toggleMuted:()=>set((s)=>({muted:!s.muted})),setVolume:(volume)=>set({volume}),toggleGhost:()=>set((s)=>({ghostEnabled:!s.ghostEnabled})),toggleShake:()=>set((s)=>({cameraShake:!s.cameraShake})),toggleReducedMotion:()=>set((s)=>({reducedMotion:!s.reducedMotion})),setQuality:(quality)=>set({quality})}),{name:"miw-settings-v1"}));
