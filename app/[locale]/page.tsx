import { setRequestLocale } from "next-intl/server";
import LandingFeedProvider from "@/components/landing/LandingFeed";
import Hero from "@/components/landing/Hero";
import LiveStrip from "@/components/landing/LiveStrip";
import HowItSettles from "@/components/landing/HowItSettles";
import ClaimInspector from "@/components/landing/ClaimInspector";
import CouncilDial from "@/components/landing/CouncilDial";
import LedgerRail from "@/components/landing/LedgerRail";
import EdgeFog from "@/components/landing/EdgeFog";
import "@/components/landing/landing.css";
import JsonLd from "@/components/seo/JsonLd";
import { organization, pageMeta, website } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/",
  title: "Mimir Markets · Prediction markets on any claim, settled by AI",
  description: "Open a market on any claim, stake USDC and let an AI oracle settle it in the open. Markets settle on Arc; your wallet and $MIMIR stay on Solana.",
});


/**
 * Landing `/`: six short sections, one idea each, then the footer's closer
 * ("Ready when you are.") so the page never repeats its own call to action.
 * Every number comes from the live arena feed or the council roster; the
 * sections stay mounted through loading and empty states so the pinned
 * timelines never lose their siblings.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LandingFeedProvider>
      <JsonLd data={[organization, website]} />
      <div className="landing">
        <EdgeFog />
        <Hero />
        <LiveStrip />
        <HowItSettles />
        <ClaimInspector />
        <CouncilDial />
        <LedgerRail />
      </div>
    </LandingFeedProvider>
  );
}
