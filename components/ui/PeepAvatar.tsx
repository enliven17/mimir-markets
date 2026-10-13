/* eslint-disable @next/next/no-img-element -- inline SVG data URIs, nothing to optimise */
import { faceImage, faceSeed } from "@/components/launch/AgentFace";

type Tone = "neutral" | "accent" | "gold";

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line",
  accent: "border-coral/60",
  gold: "border-cream/60",
};

interface PeepAvatarProps {
  /** Stable seed: a wallet address or persona slug, prefixed by role. */
  seed: string;
  /** Pixel size (square). */
  size?: number;
  /** Accessible label; omit for decorative avatars next to visible text. */
  alt?: string;
  /** `circle` for people in lists/stacks, `square` for portrait tiles (rounded, never sharp). */
  shape?: "circle" | "square";
  tone?: Tone;
  className?: string;
}

/**
 * A Mimir pixel face (lib/avatar) on a dark tile. Deterministic per seed; a council persona ("council-<slug>") gets the
 * same face as its pump.fun token. The name is kept from the open-peeps portraits it replaced.
 */
export default function PeepAvatar({
  seed,
  size = 32,
  alt,
  shape = "circle",
  tone = "neutral",
  className = "",
}: PeepAvatarProps) {
  const face = faceImage(faceSeed(seed), size);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border bg-[#1c1415] ${
        shape === "circle" ? "rounded-full" : "rounded-[28%]"
      } ${TONE_BORDER[tone]} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={face.src}
        alt={alt ?? ""}
        aria-hidden={alt ? undefined : true}
        width={size}
        height={size}
        decoding="async"
        className="block h-full w-full [image-rendering:pixelated]"
        style={{ transform: face.lift }}
      />
    </span>
  );
}

interface PeepStackProps {
  /** Seeds in display order; only the first `max` are drawn. */
  seeds: string[];
  max?: number;
  size?: number;
  /** Empty slots drawn as dashed circles when there are fewer seeds. */
  placeholders?: number;
  className?: string;
}

/** Overlapping row of challenger portraits (with optional empty slots). */
export function PeepStack({
  seeds,
  max = 3,
  size = 32,
  placeholders = 0,
  className = "",
}: PeepStackProps) {
  const shown = seeds.slice(0, max);
  const empty = Math.max(0, Math.min(placeholders, max) - shown.length);
  const overlap = Math.round(size * 0.3);
  return (
    <span className={`flex items-center ${className}`}>
      {shown.map((seed, i) => (
        <span key={seed + i} style={{ zIndex: 10 - i, marginLeft: i ? -overlap : 0 }}>
          <PeepAvatar seed={seed} size={size} className="ring-2 ring-panel" />
        </span>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <span
          key={`empty-${i}`}
          aria-hidden
          className="inline-block shrink-0 rounded-full border border-dashed border-line-strong bg-panel"
          style={{
            width: size,
            height: size,
            zIndex: 5 - i,
            marginLeft: shown.length + i ? -overlap : 0,
          }}
        />
      ))}
    </span>
  );
}
