"use client";

import { useState } from "react";

/** One shell command with a copy button; long lines scroll inside the box, never the page. */
export default function CommandLine({ cmd, note }: { cmd: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-ink-deep px-4 py-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[13px] text-cream">
        <span aria-hidden className="select-none text-coral">$ </span>
        {cmd}
        {note ? <span className="text-dim">{`   # ${note}`}</span> : null}
      </code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        aria-label={`Copy: ${cmd}`}
        className="flex-none rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-coral hover:bg-cream/[0.06]"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
