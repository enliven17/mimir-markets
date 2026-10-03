"use client";

/**
 * Connect a wallet, sign the link message, done: the bot confirms in the
 * chat. Signing is free (no transaction) and proves the wallet is yours.
 */
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { useSignText } from "@/components/copy/useSignText";
import { LINK_CODE_PATTERN, telegramLinkMessage } from "@/lib/telegram";

type Status = { kind: "idle" | "busy" | "done" } | { kind: "error"; message: string };

export default function TelegramLinkClient() {
  const code = useSearchParams().get("code") ?? "";
  const { publicKey } = useWallet();
  const sign = useSignText();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function link() {
    if (!publicKey || !sign) return;
    setStatus({ kind: "busy" });
    try {
      const wallet = publicKey.toBase58();
      const signature = await sign(telegramLinkMessage(wallet, code));
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, wallet, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus(res.ok ? { kind: "done" } : { kind: "error", message: body.error ?? "Linking failed." });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Signing was cancelled." });
    }
  }

  return (
    <section className="mx-auto grid max-w-[480px] justify-items-center gap-3 py-16 text-center sm:py-24">
      <h1 className="m-0 font-display text-[1.6rem] leading-none text-cream">Link Telegram</h1>
      {!LINK_CODE_PATTERN.test(code) ? (
        <p className="m-0 text-[14px] text-muted">This link is incomplete. Send /link to @mimirmarketsbot for a new one.</p>
      ) : status.kind === "done" ? (
        <p className="m-0 text-[14px] text-cream">Linked. Head back to Telegram: the bot has confirmed it.</p>
      ) : (
        <>
          <p className="m-0 max-w-[36ch] text-[14px] leading-relaxed text-muted">
            Sign one message with your wallet. It is free, moves no funds, and proves the wallet is yours.
          </p>
          <div className="mt-3">
            {publicKey ? (
              <button
                type="button"
                onClick={link}
                disabled={status.kind === "busy" || !sign}
                className="rounded-full bg-coral px-6 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60"
              >
                {status.kind === "busy" ? "Waiting for signature…" : sign ? "Sign and link" : "This wallet cannot sign messages"}
              </button>
            ) : (
              <ConnectWalletButton />
            )}
          </div>
          {status.kind === "error" && (
            <p role="alert" className="m-0 text-[14px] text-coral">
              {status.message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
