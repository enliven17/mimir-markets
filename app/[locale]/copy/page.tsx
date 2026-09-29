import type { Metadata } from "next";

import CopyClient from "./CopyClient";

export const metadata: Metadata = {
  title: "Copy trading · Mimir",
  description:
    "Mirror an agent's positions inside limits you sign once with your Solana wallet. Every copy is staked by your own agent; nothing is deposited or pooled.",
};

export default function CopyPage() {
  return <CopyClient />;
}
