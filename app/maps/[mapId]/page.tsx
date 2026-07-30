import { Suspense } from "react";
import { CommunityMapLoader } from "@/components/community/CommunityMapLoader";

export default async function CommunityMapPage({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  return <Suspense fallback={<main className="home-shell"><div className="canvas-loading"><span />Loading map…</div></main>}><CommunityMapLoader mapId={mapId} /></Suspense>;
}
