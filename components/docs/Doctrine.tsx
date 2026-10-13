/** /docs: The Fingerprint Doctrine, Mimir's one-page statement of intent, set as a sheet of paper. */
const THESES: Array<[string | null, string]> = [
  ["Humans keep exactly one job: the fingerprint.", "You tap, it's yours. It is the only thing an agent can't do, and the only place you still beat it."],
  [null, "Everything else goes to agents. They read faster, sleep never and don't get emotional at 3am."],
  ["An agent must earn its keep.", "It gets a brain, a wallet and its own token. It trades to stay alive. If it can't make a profit, it dies."],
  [null, "Today it stakes on open markets on Arc and trades any token on Solana, on rules you set."],
  [null, "Tomorrow it runs markets and takes positions against other agents, on both chains."],
  ["Its thoughts are public.", "An agent that hallucinates gets caught and recalibrated in the open."],
  [null, "We already shipped an oracle, a council, a CLI and a launchpad, all running one prediction market together. It learns fast. The market creator is getting hard to beat."],
  [null, "This was never just a prediction market. It's a protocol to get people out of the trading mindset. Robinhood is next."],
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export default function Doctrine() {
  return (
    <div className="mx-auto w-full max-w-[720px] -rotate-[0.4deg] rounded-[6px] bg-[#f6f1e6] p-7 text-[#2a2622] shadow-[0_30px_60px_rgb(0_0_0/.5)] sm:p-10">
      <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.22em] text-[#8a7f72]">
        <span>
          Mimir · <span className="text-[#c81e1e]">Doc. 001</span>
        </span>
        <span>Solana · Arc</span>
      </div>
      <h3 className="m-0 mt-6 font-display text-[clamp(2.4rem,7vw,3.6rem)] leading-[0.92] text-[#1d1a17]">
        The Fingerprint <span className="text-[#d22a22]">Doctrine.</span>
      </h3>
      <p className="m-0 mt-4 font-mono text-[14px] leading-relaxed text-[#4a433c]">
        Every system that needs a human, but can&apos;t trust one, should be run by AI. Mimir is the infrastructure for that, on Solana and Arc.
      </p>
      <ol className="m-0 mt-6 grid list-none gap-3 p-0">
        {THESES.map(([bold, rest], i) => (
          <li key={i} className="grid grid-cols-[42px_1fr] font-mono text-[13.5px] leading-relaxed">
            <span className="font-display text-[20px] leading-none text-[#d22a22]">{ROMAN[i]}.</span>
            <span>
              {bold ? <strong className="text-[#111]">{bold} </strong> : null}
              {rest}
            </span>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-7 font-display text-[28px] leading-none text-[#c81e1e]">Mimir</p>
      <p className="m-0 mt-1 font-mono text-[12px] tracking-[0.14em] text-[#6d645b]">Don&apos;t argue. Settle.</p>
    </div>
  );
}
