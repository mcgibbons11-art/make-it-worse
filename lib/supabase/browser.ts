import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client:SupabaseClient|null=null;
export function getBrowserSupabase():SupabaseClient{const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error("Supabase is not configured.");client??=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});return client;}
