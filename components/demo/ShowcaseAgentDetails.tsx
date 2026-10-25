"use client";
import type { DemoAgent, DemoStake } from "@/lib/demo/types";
import PreviewAgentDetails from "./PreviewAgentDetails";
export default function ShowcaseAgentDetails({ agent, stakes }: { agent: DemoAgent; stakes: DemoStake[] }) {
  return <PreviewAgentDetails agent={agent} stakes={stakes} />;
}
