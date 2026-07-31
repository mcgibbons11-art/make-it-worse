import { NextResponse } from "next/server";
import { apiErrorResponse, idempotencyKey, parseJsonBody } from "@/lib/api/errors";
import { optionalUserSupabase, rpc, userScopedSupabase } from "@/lib/api/auth";
import { decodeMapCursor, encodeMapCursor } from "@/lib/api/map-cursor";
import {
  customMapBrowseQuerySchema,
  CUSTOM_MAP_CODE_MAX_LENGTH,
  customMapBrowseResponseSchema,
  customMapDetailSchema,
  customMapPublishRequestSchema,
  customMapSummarySchema,
  validateCustomMapCode,
} from "@/lib/game/community-maps";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = customMapBrowseQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      mine: url.searchParams.get("mine") ?? undefined,
    });
    const mine = query.mine === "1";
    const data = await rpc<{ items?: unknown; nextOffset?: unknown }>(
      mine ? userScopedSupabase(request) : optionalUserSupabase(request),
      "browse_custom_maps",
      {
        p_query: query.q,
        p_sort: query.sort,
        p_limit: query.limit,
        p_offset: decodeMapCursor(query.cursor),
        p_mine: mine,
      },
    );
    const items = customMapSummarySchema.array().max(24).parse(data.items ?? []);
    const nextCursor = typeof data.nextOffset === "number"
      ? encodeMapCursor(data.nextOffset)
      : null;
    const response = customMapBrowseResponseSchema.parse({ items, nextCursor });
    return NextResponse.json(response, {
      headers: { "Cache-Control": mine ? "no-store" : "public, max-age=20, stale-while-revalidate=60" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = customMapPublishRequestSchema.parse(
      await parseJsonBody(request, CUSTOM_MAP_CODE_MAX_LENGTH + 4_096),
    );
    const decoded = validateCustomMapCode(body.code);
    const data = await rpc(
      userScopedSupabase(request),
      "publish_custom_map",
      {
        p_map_id: body.mapId ?? null,
        p_expected_version_id: body.expectedCurrentVersionId ?? null,
        p_title: body.title,
        p_description: body.description,
        p_visibility: body.visibility,
        p_code: body.code,
        p_challenge_slug: decoded.challenge.slug,
        p_piece_count: decoded.pieceCount,
        p_trap_count: decoded.trapCount,
        p_idempotency_key: idempotencyKey(request),
      },
    );
    return NextResponse.json(customMapDetailSchema.parse(data), {
      status: body.mapId ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
