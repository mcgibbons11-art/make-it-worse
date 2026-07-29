import { NextResponse } from "next/server";import { apiErrorResponse,idempotencyKey } from "@/lib/api/errors";import { publicSupabase,rpc,userScopedSupabase } from "@/lib/api/auth";import { challengeSchema,trackSchema } from "@/lib/game/schemas";
export async function GET(request:Request){try{const limit=Math.min(6,Math.max(1,Number(new URL(request.url).searchParams.get("limit")??6)));const data=await rpc<unknown[]>(publicSupabase(),"get_trending_challenges",{p_limit:limit});return NextResponse.json(data.map((item)=>challengeSchema.parse(item)),{headers:{"Cache-Control":"public, max-age=30"}});}catch(error){return apiErrorResponse(error);}}
export async function POST(request:Request){try{
  // The body is optional: no body means the classic course, exactly as an
  // absent `track` on the DTO does. Read as text first because request.json()
  // throws on an empty body, and an empty body is the COMMON case here.
  const raw=await request.text();
  let track:readonly string[]|null=null;
  if(raw.trim().length>0){const parsed:unknown=JSON.parse(raw);track=trackSchema.parse((parsed as {track?:unknown}).track);}
  const data=await rpc<unknown>(userScopedSupabase(request),"create_root_chain",{p_idempotency_key:idempotencyKey(request),p_track:track});
  return NextResponse.json(challengeSchema.parse(data),{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return apiErrorResponse(error);}}
