export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };
}
export function seededId(prefix: string, seed: number): string { return `${prefix}_${(seed >>> 0).toString(36).padStart(7, "0")}`; }
/**
 * The Daily Disaster's seed, keyed to the player's LOCAL calendar date - the
 * Wordle model. Keyed to UTC it rolled over at 8pm US Eastern, so an evening
 * session and the next morning shared one course and "daily" read as broken.
 * Local dating rolls at each player's own midnight, and everyone whose
 * calendar shows the same date still lands on the same course and board.
 */
export function dailyRoomSeed(now: Date = new Date()): number {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return hashString(`miw-daily-${now.getFullYear()}-${month}-${day}`);
}
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
