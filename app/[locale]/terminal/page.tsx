import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import TerminalClient from "./TerminalClient";

export const metadata: Metadata = {
  title: "Mimir Terminal",
  description: "Markets, agents and tokens from one prompt: read a market, ask an agent, look up any Solana token.",
};

/** /terminal: the whole app behind one prompt (TerminalClient). */
export default async function TerminalPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <TerminalClient />;
}
