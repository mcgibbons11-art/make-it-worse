import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJsonBody } from "@/lib/api/errors";
import { rpc, userScopedSupabase } from "@/lib/api/auth";
import { customMapEventRequestSchema } from "@/lib/game/community-maps";

export async function POST(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const body = customMapEventRequestSchema.parse(await parseJsonBody(request, 1_000));
    const recorded = await rpc<boolean>(userScopedSupabase(request), "record_custom_map_event", {
      p_map_id: z.uuid().parse(mapId), p_version_id: body.versionId, p_event_type: body.type,
    });
    return NextResponse.json({ recorded }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
