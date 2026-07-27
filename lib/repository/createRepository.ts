import type { GameRepository } from "./Repository";
import { DemoRepository } from "./DemoRepository";
import { SupabaseRepository } from "./SupabaseRepository";
let repository:GameRepository|null=null;
export function createRepository():GameRepository{if(repository)return repository;repository=process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?new SupabaseRepository():new DemoRepository();return repository;}
export function resetRepositoryForTests():void{repository=null;}
