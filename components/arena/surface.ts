/**
 * Unblurred surfaces for the arena pages. The glass primitives (`.card`,
 * `.glass`, `.glass-deep`) run a backdrop blur that has to be recomputed on
 * every scrolled frame; lists, tab panels and big sheets use these near-opaque
 * fills instead, which look the same over the dark wall and cost nothing.
 */
export const SURFACE = "relative overflow-hidden rounded-2xl bg-[rgb(27_19_20/.93)] shadow-card";
export const SURFACE_DEEP = "bg-[rgb(16_10_11/.95)] shadow-sheet";
export const PILL = "bg-[rgb(24_15_17/.9)] shadow-chip";
