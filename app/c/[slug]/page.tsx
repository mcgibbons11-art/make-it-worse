import type { Metadata } from "next";
import GameClient from "@/components/game/GameClient";
import { loadPreview } from "./preview-data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Most chat clients render this text beside the image, and it was the same
  // sentence for every challenge ever shared. loadPreview falls back to exactly
  // that generic wording when the challenge cannot be read, so a demo link -
  // which the server genuinely cannot see - reads as it always did.
  const preview = await loadPreview(slug);
  const description = [preview.headline, preview.statLine, "Beat it. Ruin it. Send it."]
    .filter(Boolean)
    .join(" ");
  return {
    title: "Can you survive this disaster?",
    description,
    alternates: { canonical: `/c/${slug}` },
    openGraph: {
      title: preview.headline,
      description,
      images: [`/c/${slug}/opengraph-image`],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <GameClient key={slug} slug={slug} />;
}
