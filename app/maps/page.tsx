import Link from "next/link";
import { CommunityMapsBrowser } from "@/components/community/CommunityMapsBrowser";

export const metadata = { title: "Community maps · MAKE IT WORSE" };

export default function CommunityMapsPage() {
  return <main className="home-shell community-shell"><nav className="home-nav"><Link className="mini-logo" href="/">MIW</Link><Link className="button secondary" href="/">← Home</Link></nav><CommunityMapsBrowser /></main>;
}
