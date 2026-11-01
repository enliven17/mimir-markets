/**
 * The networks Mimir runs on, as their official wordmarks (public/networks): Arc, where markets settle, and with
 * `base`, Base too, the other network your wallet can connect on. White marks for the dark theme.
 */
export function NetworkLogos({ className = "h-6", base = false }: { className?: string; base?: boolean }) {
  return (
    <span className={`inline-flex items-center ${/\bgap-/.test(className) ? "" : "gap-4"} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs, no optimisation to gain */}
      <img src="/networks/arc.svg" alt="Arc" className="h-full w-auto" />
      {base ? (
        <>
          <span aria-hidden className="h-[60%] w-px bg-line" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/networks/base.svg" alt="Base" className="h-[85%] w-auto" />
        </>
      ) : null}
    </span>
  );
}
