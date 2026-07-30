import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJsonBody } from "@/lib/api/errors";
import { rpc, userScopedSupabase } from "@/lib/api/auth";
import { customMapDetailSchema, customMapRollbackRequestSchema } from "@/lib/game/community-maps";

export async function POST(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const body = customMapRollbackRequestSchema.parse(await parseJsonBody(request, 1_000));
    const data = await rpc(userScopedSupabase(request), "rollback_custom_map", {
      p_map_id: z.uuid().parse(mapId), p_version_id: body.versionId,
    });
    return NextResponse.json(customMapDetailSchema.parse(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
