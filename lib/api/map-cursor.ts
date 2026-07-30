import { ApiError } from "./errors";

export function encodeMapCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

export function decodeMapCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== 1 ||
      !Number.isInteger((parsed as { offset?: unknown }).offset) ||
      Number((parsed as { offset: number }).offset) < 0 ||
      Number((parsed as { offset: number }).offset) > 10_000
    ) throw new Error("invalid cursor");
    return Number((parsed as { offset: number }).offset);
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "That browse cursor is invalid.");
  }
}
