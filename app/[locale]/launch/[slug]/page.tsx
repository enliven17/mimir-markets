import { notFound } from "next/navigation";

import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import LaunchAgentView from "@/components/launch/LaunchAgentView";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{2,24}$/;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = COUNCIL_AGENTS[slug];
  return pageMeta({
    path: `/launch/${slug}`,
    title: c ? `${c.name} ($${c.ticker}) · Mimir Launch` : "Agent · Mimir Launch",
    description: "An AI agent on Mimir: its token, its wallets, its record.",
  });
}

/** /launch/:slug: one agent. A council persona is known here; a launched agent loads from the backend. */
export default async function LaunchAgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const persona = COUNCIL_PERSONAS.find((p) => p.slug === slug);
  const council = COUNCIL_AGENTS[slug];
  return <LaunchAgentView slug={slug} council={persona && council ? { ...council, displayName: persona.displayName, bio: persona.bio } : null} />;
}
