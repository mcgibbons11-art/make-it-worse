import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJsonBody } from "@/lib/api/errors";
import { rpc, userScopedSupabase } from "@/lib/api/auth";
import { customMapDetailSchema, customMapModerationRequestSchema } from "@/lib/game/community-maps";

export async function POST(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const body = customMapModerationRequestSchema.parse(await parseJsonBody(request, 2_000));
    const data = await rpc(userScopedSupabase(request), "moderate_custom_map", {
      p_map_id: z.uuid().parse(mapId), p_status: body.status,
      p_version_id: body.versionId ?? null, p_note: body.note,
    });
    return NextResponse.json(customMapDetailSchema.parse(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
