import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJsonBody } from "@/lib/api/errors";
import { optionalUserSupabase, rpc, userScopedSupabase } from "@/lib/api/auth";
import {
  customMapDetailSchema,
  customMapMetadataRequestSchema,
} from "@/lib/game/community-maps";

const idSchema = z.uuid();

export async function GET(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const version = new URL(request.url).searchParams.get("version");
    const data = await rpc(
      optionalUserSupabase(request),
      "get_custom_map",
      { p_map_id: idSchema.parse(mapId), p_version_id: version ? idSchema.parse(version) : null },
    );
    if (!data) return NextResponse.json({ error: { code: "NOT_FOUND", message: "That map is unavailable.", retryable: false } }, { status: 404 });
    return NextResponse.json(customMapDetailSchema.parse(data), {
      headers: { "Cache-Control": request.headers.has("authorization") ? "no-store" : "public, max-age=30" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const body = customMapMetadataRequestSchema.parse(await parseJsonBody(request, 2_000));
    const data = await rpc(userScopedSupabase(request), "update_custom_map", {
      p_map_id: idSchema.parse(mapId),
      p_title: body.title ?? null,
      p_description: body.description ?? null,
      p_visibility: body.visibility ?? null,
    });
    return NextResponse.json(customMapDetailSchema.parse(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
