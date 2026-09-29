import RouteEffects from "@/components/motion/RouteEffects";

/**
 * Remounts on every navigation: a short route entrance (blur + fade +
 * 8px rise, 400ms; off under reduced motion, see `.route-enter`) and a jump to
 * the top.
 */
export default function LocaleTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="route-enter">
      <RouteEffects />
      {children}
    </div>
  );
}
