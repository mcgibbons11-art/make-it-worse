import SandboxClient from "@/components/game/SandboxClient";
import { notFound } from "next/navigation";

export const metadata = { title: "All-trap QA sandbox" };

export default async function SandboxPage({
  searchParams,
}: {
  searchParams: Promise<{ trap?: string }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_E2E_TEST_MODE !== "1"
  )
    notFound();
  const { trap } = await searchParams;
  return <SandboxClient requested={trap} />;
}
