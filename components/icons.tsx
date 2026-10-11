/**
 * Mimir's own icon set, drawn on a 16px grid with square caps to match the
 * pixel type (and ExternalMark). Same props as the lucide icons it replaced:
 * `size` (default 24), `strokeWidth`, `className`, any SVG attribute.
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function icon(name: string, body: ReactNode) {
  function Icon({ size = 24, strokeWidth = 1.5, ...rest }: IconProps) {
    return (
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

const dot = (x: number) => <rect x={x} y="7" width="2" height="2" fill="currentColor" stroke="none" />;

export const Check = icon("Check", <path d="M3 8.5l3 3 7-7" />);
export const Copy = icon("Copy", <path d="M5.5 5.5h8v8h-8zM10.5 2.5h-8v8" />);
export const Plus = icon("Plus", <path d="M8 2.5v11M2.5 8h11" />);
export const X = icon("X", <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />);
export const Scale = icon("Scale", <path d="M8 2.5v11M4.5 13.5h7M2.5 4.5h11M3.5 4.5l-1.5 4h3zM12.5 4.5l-1.5 4h3z" />);
export const TriangleAlert = icon("TriangleAlert", <path d="M8 2l6.5 12h-13zM8 6.5v3.5M8 12v.5" />);
export const Users = icon("Users", <path d="M3 2.5h4v4H3zM1.5 13.5V9.5h7v4M10.5 3.5h3v3h-3zM11 9.5h3.5v4" />);
export const CircleUserRound = icon("CircleUserRound", <path d="M2 2h12v12H2zM6 4.5h4v4H6zM4.5 14v-2.5h7V14" />);
export const Ellipsis = icon("Ellipsis", <>{dot(2)}{dot(7)}{dot(12)}</>);
export const LayoutGrid = icon("LayoutGrid", <path d="M2.5 2.5h4.5V7H2.5zM9 2.5h4.5V7H9zM2.5 9H7v4.5H2.5zM9 9h4.5v4.5H9z" />);
export const RotateCw = icon("RotateCw", <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M12.5 2v3.5H9" />);
export const RotateCcw = icon("RotateCcw", <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M3.5 2v3.5H7" />);
export const RefreshCw = icon("RefreshCw", <path d="M2.5 7.5a5.5 5.5 0 0 1 9.9-2.5M13.5 8.5a5.5 5.5 0 0 1-9.9 2.5M12.5 2v3h-3M3.5 14v-3h3" />);
export const Loader2 = icon("Loader2", <path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" />);
export const Search = icon("Search", <path d="M2.5 2.5h8v8h-8zM10.5 10.5l3 3" />);
export const SlidersHorizontal = icon("SlidersHorizontal", <path d="M2 4.5h12M2 11.5h12M5.5 3v3M10.5 10v3" />);
export const TrendingUp = icon("TrendingUp", <path d="M1.5 12l4.5-4.5 3 3 5.5-5.5M10 5h4.5v4.5" />);
export const ShieldCheck = icon("ShieldCheck", <path d="M8 1.5l5.5 2V8c0 3.5-2.5 5.5-5.5 6.5C5 13.5 2.5 11.5 2.5 8V3.5zM5.5 8l2 2 3.5-3.5" />);
export const ArrowUpRight = icon("ArrowUpRight", <path d="M4.5 11.5l7-7M5.5 4.5h6v6" />);
export const ArrowRight = icon("ArrowRight", <path d="M2.5 8h11M9 3.5l4.5 4.5L9 12.5" />);
export const ExternalLink = icon("ExternalLink", <path d="M7 3.5H2.5v10h10V9M9.5 2.5h4v4M13.5 2.5l-6 6" />);
export const Wand2 = icon("Wand2", <path d="M2.5 13.5l7.5-7.5M8.5 4.5l3 3M12.5 1.5v3M11 3h3M4 2.5v2M3 3.5h2" />);
export const Zap = icon("Zap", <path d="M9 1.5L3 9h5l-1 5.5L13 7H8z" />);
export const Bell = icon("Bell", <path d="M3.5 11.5V7a4.5 4.5 0 0 1 9 0v4.5l1 1.5h-11zM6.5 14.5h3" />);
export const ChevronDown = icon("ChevronDown", <path d="M4 6l4 4 4-4" />);
export const Wallet = icon("Wallet", <path d="M2 4h12v9.5H2zM2 4l9-2v2M10 7.5h4v3h-4z" />);
export const LogOut = icon("LogOut", <path d="M6 2.5H2.5v11H6M6.5 8H14M11 5l3 3-3 3" />);
