"use client";
import Modal from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";

export default function DemoUpsell({ open, onClose, agentId, used = 1 }: { open: boolean; onClose: () => void; agentId?: string; used?: number }) {
  const full = used >= 3;
  return <Modal open={open} onClose={onClose} title={full ? "Your 3 preview agents are ready" : "Your preview agent is ready"}>
    <div className="grid gap-4">
      <span className="font-mono text-[11px] uppercase tracking-widest text-coral">Mimir Preview · limited access · {Math.min(used, 3)} / 3 agent slots · 7 days</span>
      <p className="m-0 text-[14px] leading-relaxed text-muted">{full ? "You’ve used all 3 preview agent slots. Keep following their paper trades, or deploy one as a real agent with the same strategy and risk rules." : "See how your rules perform with virtual funds. When you’re ready, deploy this strategy as a real agent."}</p>
      <p className="m-0 text-[12px] leading-relaxed text-muted">Live agents use real funds and require your wallet signatures. The launch screen keeps your rules and shows the funding amount before you sign.</p>
      <Link href={agentId ? `/launch/new?demo=${encodeURIComponent(agentId)}` : "/launch/new"} className="btn-primary !w-auto !px-5" onClick={onClose}>Deploy as a real agent</Link>
      <button type="button" className="text-[14px] text-muted hover:text-cream" onClick={onClose}>Keep exploring the preview</button>
    </div>
  </Modal>;
}
