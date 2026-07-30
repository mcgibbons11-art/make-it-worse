import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJsonBody } from "@/lib/api/errors";
import { rpc, userScopedSupabase } from "@/lib/api/auth";
import { customMapReportRequestSchema } from "@/lib/game/community-maps";

export async function POST(request: Request, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    const body = customMapReportRequestSchema.parse(await parseJsonBody(request, 2_000));
    const recorded = await rpc<boolean>(userScopedSupabase(request), "report_custom_map", {
      p_map_id: z.uuid().parse(mapId), p_version_id: body.versionId,
      p_reason: body.reason, p_note: body.note,
    });
    return NextResponse.json({ recorded }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
