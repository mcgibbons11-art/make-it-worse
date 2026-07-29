import { displayNameSchema } from "@/lib/game/schemas";
const blocked=/\b(fuck|shit|bitch|cunt|nigg|fagg|kike|spic)\w*/i;
// displayNameSchema blocks https:// and www., which leaves a bare domain like
// "free-robux.example.com" usable as an advert. A name is attributed publicly
// and travels inside shared links, so treat domain-shaped text as a link.
const bareDomain=/\.[a-z]{2,}\b/i;
export function sanitizeDisplayName(input:string):string{const normalized=input.normalize("NFKC").replace(/\s+/g," ").trim();const safe=displayNameSchema.parse(normalized);if(blocked.test(safe))throw new Error("Choose a family-friendly display name.");if(bareDomain.test(safe))throw new Error("Display names cannot contain a web address.");return safe;}
