import { createSeededRandom } from "@/lib/game/seed";
const adjectives=["Wobbly","Brave","Turbo","Cheeky","Dizzy","Bouncy","Mighty","Sneaky"] as const;const nouns=["Badger","Kettle","Otter","Sofa","Pigeon","Teapot","Ferret","Muffin"] as const;
export function generatedName(seed:number):string{const random=createSeededRandom(seed);return `${adjectives[Math.floor(random()*adjectives.length)]} ${nouns[Math.floor(random()*nouns.length)]}`;}
