import { ghostTraceSchema } from "./schemas";
import type { DecodedGhostSample, GhostTrace } from "./types";
const P=100; const Y=1000;
export function encodeGhostTrace(samples:readonly DecodedGhostSample[]):GhostTrace{if(samples.length>900)throw new Error("Ghost trace exceeds 900 frames");const frames=samples.map((s)=>[Math.round(s.x*P),Math.round(s.y*P),Math.round(s.z*P),Math.round(s.yaw*Y),s.flags]);return ghostTraceSchema.parse({version:1,hz:15,durationMs:Math.round(samples.length/15*1000),frames});}
export function decodeGhostTrace(input:unknown):DecodedGhostSample[]{const trace=ghostTraceSchema.parse(input);return trace.frames.map((f)=>({x:f[0]!/P,y:f[1]!/P,z:f[2]!/P,yaw:f[3]!/Y,flags:f[4]!}));}
export function interpolateGhost(a:DecodedGhostSample,b:DecodedGhostSample,t:number):DecodedGhostSample{const q=Math.min(1,Math.max(0,t));return{x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q,z:a.z+(b.z-a.z)*q,yaw:a.yaw+(b.yaw-a.yaw)*q,flags:q<.5?a.flags:b.flags};}
