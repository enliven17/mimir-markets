"use client";

/**
 * Recovery phrase: set it up (12 words that derive a second owner key for the
 * Arc account), or use one to put a new passkey on the account. The words
 * live only in this component's state: never stored, never sent.
 */
import { useId, useState } from "react";

import type { ArcSession } from "@/lib/arc/account";
import { loadArcAccount } from "@/lib/arc/lazy";

const flagKey = (address: string) => `mimir:arc:recovery:${address.toLowerCase()}`;

export type RecoveryFlag = "on" | "skipped" | null;

export function readRecoveryFlag(address: string): RecoveryFlag {
  try {
    const v = localStorage.getItem(flagKey(address));
    return v === "on" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
}

/** The phrase as a plain text file the user keeps offline. Built in the browser; nothing is uploaded. */
function downloadPhrase(mnemonic: string, account: string): void {
  const words = mnemonic.split(" ").map((w, i) => `${String(i + 1).padStart(2, " ")}. ${w}`).join("\n");
  const text = [
    "MIMIR ARC ACCOUNT RECOVERY PHRASE",
    "",
    `Account: ${account}`,
    `Saved:   ${new Date().toISOString()}`,
    "",
    words,
    "",
    "Anyone with these 12 words can take over this account and the USDC in it.",
    "Keep this file offline (a USB stick, a printed copy) and delete it from your Downloads.",
    "Mimir never asks for these words. To recover: mimirmarkets.xyz/wallet, Recover with your phrase.",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `mimir-recovery-${account.slice(2, 8).toLowerCase()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function writeRecoveryFlag(address: string, flag: Exclude<RecoveryFlag, null>): void {
  localStorage.setItem(flagKey(address), flag);
}

export function RecoverySetup({ session, onDone }: { session: ArcSession; onDone: (flag: "on" | "skipped") => void }) {
  const confirmId = useId();
  const [phrase, setPhrase] = useState<{ mnemonic: string; address: `0x${string}` } | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // The confirmation only unlocks once the words have actually left the page (downloaded or copied).
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPhrase((await loadArcAccount()).generateRecoveryPhrase());
  }

  async function turnOn() {
    if (!phrase) return;
    setBusy(true);
    setError(null);
    try {
      await session.registerRecoveryAddress(phrase.address);
      writeRecoveryFlag(session.address, "on");
      setPhrase(null);
      onDone("on");
    } catch (err) {
      const e = err as { name?: string; message?: string };
      setError(e?.name === "NotAllowedError" ? "The passkey prompt was closed or timed out." : (e?.message ?? "Turning on recovery failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!phrase) {
    return (
      <div className="grid gap-3">
        <h3 className="m-0 text-[15px] font-medium text-cream">Save a recovery phrase</h3>
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Your passkey lives on this device. If you lose the device and the passkey is not synced (iCloud Keychain, Google Password Manager), a
          recovery phrase is the only way back into this Arc account. Mimir cannot recover it for you.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void generate()} className="rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909]">
            Create my phrase
          </button>
          <button
            type="button"
            onClick={() => {
              writeRecoveryFlag(session.address, "skipped");
              onDone("skipped");
            }}
            className="press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream"
          >
            Skip for now
          </button>
        </div>
        <p className="m-0 text-[12px] text-coral">Skipping means: lose this passkey, lose the account and the USDC in it.</p>
      </div>
    );
  }

  const words = phrase.mnemonic.split(" ");
  return (
    <div className="grid gap-3">
      <h3 className="m-0 text-[15px] font-medium text-cream">Write these 12 words down</h3>
      <p className="m-0 text-[13px] text-muted">In this order, somewhere offline. They are shown once. Anyone with them can take over this account.</p>
      <ol className="ph-no-capture m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3" aria-label="Recovery phrase">
        {words.map((w, i) => (
          <li key={i} className="rounded-xl bg-ink-deep px-3 py-2 font-mono text-[14px] text-cream">
            <span className="mr-2 text-dim" aria-hidden>
              {i + 1}.
            </span>
            {w}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            downloadPhrase(phrase.mnemonic, session.address);
            setDownloaded(true);
          }}
          className="rounded-full bg-coral px-4 py-2 text-[13px] font-medium text-[#160909]"
        >
          {downloaded ? "Downloaded ✓ Download again" : "Download the recovery file"}
        </button>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(phrase.mnemonic).then(() => {
              setCopied(true);
              setDownloaded(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
          className="press rounded-full bg-panel-raised px-4 py-2 text-[13px] text-cream"
        >
          {copied ? "Copied" : "Copy the words"}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? "Recovery phrase copied" : ""}
      </span>
      <div className="flex items-start gap-2">
        <input
          id={confirmId}
          type="checkbox"
          checked={saved}
          disabled={!downloaded}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-1 h-4 w-4 accent-coral disabled:opacity-40"
        />
        <label htmlFor={confirmId} className={`text-[13px] ${downloaded ? "text-cream" : "text-dim"}`}>
          I downloaded my recovery phrase and stored it somewhere safe. I understand Mimir cannot recover it for me.
          {downloaded ? null : <span className="block text-[12px] text-dim">Download or copy the words first.</span>}
        </label>
      </div>
      <button
        type="button"
        disabled={!saved || busy}
        onClick={() => void turnOn()}
        className="justify-self-start rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60"
      >
        {busy ? "Confirm with your passkey…" : "Turn on recovery"}
      </button>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RecoverWithPhrase({ busy, onRecover }: { busy: boolean; onRecover: (phrase: string) => void }) {
  const id = useId();
  const [phrase, setPhrase] = useState("");
  const count = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (count === 12) onRecover(phrase);
      }}
    >
      <label htmlFor={id} className="text-[13px] text-muted">
        Your 12-word recovery phrase
      </label>
      <textarea
        id={id}
        rows={3}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        className="ph-no-capture rounded-xl bg-ink-deep px-3 py-2.5 font-mono text-[14px] text-cream outline-none focus-visible:ring-2 focus-visible:ring-coral"
      />
      <p className="m-0 text-[12px] text-muted">This creates a new passkey on this device and adds it to your account. No gas.</p>
      <button
        type="submit"
        disabled={busy || count !== 12}
        className="justify-self-start rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60"
      >
        {busy ? "Recovering…" : "Recover with your phrase"}
      </button>
    </form>
  );
}
