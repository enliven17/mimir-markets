/** Pixel glyphs on a 12px grid, drawn crisp at any size. */
export function PixelArrow({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
      <path d="M6 1h2v2H6zM8 3h2v2H8zM0 5h12v2H0zM8 7h2v2H8zM6 9h2v2H6z" />
    </svg>
  );
}

export function PixelPlus({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
      <path d="M5 1h2v4h4v2H7v4H5V7H1V5h4z" />
    </svg>
  );
}
