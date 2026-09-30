/**
 * DiceBear open-peeps avatar URLs — single source for every avatar in the app
 * (claim creators, challengers, council personas, agents).
 *
 * The portraits are drawn in the site's own palette (cream to warm tan skin,
 * coral / deep red / muted clothing, a dark accent) on a transparent ground;
 * `PeepAvatar` sets them on the maroon gradient the segmented thumb uses, so
 * they read as part of the dark UI instead of pale stickers on it.
 */
const OPEN_PEEPS_ENDPOINT = "https://api.dicebear.com/9.x/open-peeps/svg";
const PALETTE =
  "skinColor=f3ead6,e3cdb0,c9a888,a8876a&clothingColor=ff5148,8f0e17,ff746c,a89d93&headContrastColor=2c1b18";

/** Pass a hex `background` (no #) for a filled avatar, e.g. an inline SVG embed. */
export function openPeepsAvatar(seed: string, background: string | null = null): string {
  const safeSeed = seed.trim() || "mimir";
  const url = `${OPEN_PEEPS_ENDPOINT}?seed=${encodeURIComponent(safeSeed)}&${PALETTE}`;
  return background ? `${url}&backgroundColor=${background}` : url;
}
