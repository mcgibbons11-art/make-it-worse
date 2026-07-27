import { displayNameSchema } from "@/lib/game/schemas";
const blocked=/\b(fuck|shit|bitch|cunt|nigg|fagg|kike|spic)\w*/i;
export function sanitizeDisplayName(input:string):string{const normalized=input.normalize("NFKC").replace(/\s+/g," ").trim();const safe=displayNameSchema.parse(normalized);if(blocked.test(safe))throw new Error("Choose a family-friendly display name.");return safe;}
