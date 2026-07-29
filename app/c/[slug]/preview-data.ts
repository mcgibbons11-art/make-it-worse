import { publicSupabase, rpc } from "@/lib/api/auth";
import {
  buildChallengePreview,
  FALLBACK_PREVIEW,
  type ChallengePreview,
} from "@/lib/game/challenge-preview";
import { challengeSchema } from "@/lib/game/schemas";

/**
 * Read a challenge for its link preview, or give up quietly.
 *
 * Every failure here is expected rather than exceptional, so none of them may
 * throw: a demo challenge lives only in its creator's browser and the server
 * genuinely cannot see it, publicSupabase() raises when the backend is not
 * configured at all, and a stranger can paste any slug they like. In all three
 * cases the right answer is the generic card, not a broken preview or a 500 on
 * a page that would otherwise have rendered.
 */
export async function loadPreview(slug: string): Promise<ChallengePreview> {
  if (!/^[a-z0-9-]{6,24}$/.test(slug)) return FALLBACK_PREVIEW;
  try {
    const data = await rpc<unknown>(publicSupabase(), "get_public_challenge", {
      p_slug: slug,
    });
    if (!data) return FALLBACK_PREVIEW;
    return buildChallengePreview(challengeSchema.parse(data));
  } catch {
    return FALLBACK_PREVIEW;
  }
}
