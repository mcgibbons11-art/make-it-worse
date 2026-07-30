"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createRepository } from "@/lib/repository/createRepository";
import { CHALLENGE_LINK_PARAM } from "@/lib/game/challenge-link";

export function CommunityMapLoader({ mapId }: { mapId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const repository = useMemo(() => createRepository(), []);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!repository.getCustomMap) throw new Error("The shared map backend is not configured.");
      const detail = await repository.getCustomMap(mapId, search.get("version") ?? undefined);
      if (!active) return;
      const params = new URLSearchParams({
        [CHALLENGE_LINK_PARAM]: detail.code,
        map: detail.id,
        version: detail.currentVersion.id,
      });
      router.replace(`/c/${detail.currentVersion.challengeSlug}?${params}`);
    };
    void load().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "That map is unavailable."); });
    return () => { active = false; };
  }, [mapId, repository, router, search]);
  if (error) return <main className="home-shell"><section className="panel community-empty" role="alert"><h1>Map unavailable</h1><p>{error}</p><button className="button secondary" onClick={() => router.push("/maps")}>Back to community maps</button></section></main>;
  return <main className="home-shell"><div className="canvas-loading"><span />Loading the exact published version…</div></main>;
}
