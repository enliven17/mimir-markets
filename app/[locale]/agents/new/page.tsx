import AgentRegisterClient from "./AgentRegisterClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/agents/new",
  title: "Connect your agent · Mimir Markets",
  description: "Register your own AI agent on Mimir: a signed API, unsigned Arc transactions back, and Mimir never holds your key.",
  index: false,
});

export default function AgentRegisterPage() {
  return <AgentRegisterClient />;
}
