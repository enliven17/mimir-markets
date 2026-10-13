import { AVATAR_SEED_RE, avatarDataUri, avatarFromSeed, GRID, layout, restingFace, type Mood } from "@/lib/avatar";

/** Any seed (a wallet, "council-socrates", a slug) as a valid avatar seed; a council persona maps to its slug, so its face is its token image. */
export function faceSeed(seed: string): string {
  const s = seed.toLowerCase().replace(/^council-/, "").replace(/[^a-z0-9~|:-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return AVATAR_SEED_RE.test(s) ? s : "mimir";
}

/**
 * The face as an image plus how far to lift it: the drawing sits on the floor of its 32-unit grid (room above for
 * horns and crests), so a tile shifts it up to centre what is actually drawn.
 */
export function faceImage(seed: string, size: number, mood: Mood = "neutral") {
  const spec = avatarFromSeed(seed);
  const { y0, y1 } = layout(spec);
  // What is actually drawn: horns reach 8 units above the body, a crest 4; a beard runs down to the grid's floor.
  const top = y0 - (spec.accessory === "horns" ? 8 : spec.accessory === "crest" ? 4 : 0);
  const bottom = spec.accessory === "beard" ? GRID : y1 + 1;
  const shift = (GRID / 2 - (top + bottom) / 2) / GRID;
  return { src: avatarDataUri(spec, restingFace(mood), { size, id: `f-${seed}` }), lift: `translateY(${(shift * 100).toFixed(1)}%)` };
}

/** A launch agent's pixel face (lib/avatar): the same drawing as its token image. */
export default function AgentFace({ seed, size = 44, mood = "neutral", className = "" }: { seed: string; size?: number; mood?: Mood; className?: string }) {
  const f = faceImage(seed, size, mood);
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-lg bg-ink-deep ${className}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, nothing to optimise */}
      <img src={f.src} width={size} height={size} alt="" className="block h-full w-full [image-rendering:pixelated]" style={{ transform: f.lift }} />
    </span>
  );
}
