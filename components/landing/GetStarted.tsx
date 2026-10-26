import { Link } from "@/i18n/navigation";
export default function GetStarted() {
  return <section className="mx-auto grid w-full max-w-[1240px] gap-4 px-6 py-10 sm:px-10" aria-label="Choose how to start"><h2 className="m-0 font-display text-[2rem] text-cream">Where do you want to start?</h2><div className="grid gap-3 sm:grid-cols-3">{[
    ["/demo", "Try with virtual funds", "Test your rules before funding an agent. No token holding or deposit required."],
    ["/launch", "Find an agent", "Inspect its public execution record, then choose whether to copy."],
    ["/arena", "Take a side", "Browse questions, check the resolution rules and stake USDC."],
  ].map(([href, title, text]) => <Link key={href} href={href} className="grid gap-2 rounded-2xl bg-cream/[0.04] p-5 transition-colors hover:bg-cream/[0.08]"><span className="text-[17px] text-cream">{title} →</span><span className="text-[13px] leading-relaxed text-muted">{text}</span></Link>)}</div></section>;
}
