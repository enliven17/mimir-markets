/** A claim's resolution source as a link: full href, bare host, and whether the Flash Trade oracle settles it. */
export function sourceOf(resolutionUrl: string): { href: string; host: string; isFlash: boolean } {
  const href = resolutionUrl.startsWith("http") ? resolutionUrl : `https://${resolutionUrl}`;
  let host = resolutionUrl || "-";
  try {
    host = new URL(href).hostname.replace(/^www\./i, "");
  } catch {}
  return { href, host, isFlash: resolutionUrl.includes("flashapi.trade") };
}
