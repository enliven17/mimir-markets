import { avatarDataUri, avatarFromSeed, restingFace, type Mood } from "@/lib/avatar";

/** A launch agent's pixel face (lib/avatar): the same drawing as its token image. */
export default function AgentFace({ seed, size = 44, mood = "neutral", className = "" }: { seed: string; size?: number; mood?: Mood; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, nothing to optimise
    <img src={avatarDataUri(avatarFromSeed(seed), restingFace(mood), { size, id: `f-${seed}` })} width={size} height={size} alt="" className={`shrink-0 rounded-lg bg-ink-deep [image-rendering:pixelated] ${className}`} />
  );
}
