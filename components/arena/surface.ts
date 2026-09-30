/**
 * Near-opaque surfaces for the arena pages, the same fills the glass
 * primitives (`.card`, `.glass`, `.glass-deep`) now use. No backdrop blur
 * anywhere on large surfaces: it is recomputed on every scrolled frame.
 */
export const SURFACE = "relative overflow-hidden rounded-2xl bg-[rgb(27_19_20/.93)] shadow-card";
export const SURFACE_DEEP = "bg-[rgb(16_10_11/.95)] shadow-sheet";
export const PILL = "bg-[rgb(24_15_17/.9)] shadow-chip";
