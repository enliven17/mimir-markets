/**
 * Blueprint building blocks — framed section headings and ruled sections.
 *
 * Every blueprint section draws its own borders (there are no separate fixed
 * rails): a heading band has full-bleed rules above and below plus
 * column-width side borders, so the vertical column lines stay continuous
 * from section to section. See docs/DESIGN.md.
 */
import type { ReactNode } from "react";

type HeadingTag = "h1" | "h2" | "h3";

interface BlueprintHeadingProps {
  children: ReactNode;
  /** Semantic level. Page titles use h1, homepage/page sections h2. */
  as?: HeadingTag;
  /** Small mono label above the title (e.g. "Oracle analytics"). */
  eyebrow?: ReactNode;
  /** One-line lead under the title. */
  subtitle?: ReactNode;
  id?: string;
  className?: string;
}

// Centered section title framed by full-bleed rules above AND below it
// (blueprint header band) plus column-width side borders.
export function BlueprintHeading({
  children,
  as: Tag = "h2",
  eyebrow,
  subtitle,
  id,
  className = "",
}: BlueprintHeadingProps) {
  return (
    <div
      data-bp-rails
      className={`relative border-x border-pv-border/25 px-4 py-5 text-center sm:py-6 ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-px w-screen -translate-x-1/2 bg-pv-border/25"
      />
      {eyebrow ? (
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">
          {eyebrow}
        </p>
      ) : null}
      <Tag
        id={id}
        className="break-words font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl"
      >
        {children}
      </Tag>
      {subtitle ? (
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-pv-muted">
          {subtitle}
        </p>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-screen -translate-x-1/2 bg-pv-border/25"
      />
    </div>
  );
}

/** Alias kept for later phases: `SectionHeading` reads better in page code. */
export const SectionHeading = BlueprintHeading;

interface BlueprintSectionProps extends Omit<BlueprintHeadingProps, "children"> {
  title: ReactNode;
  children: ReactNode;
  /** Classes for the railed body under the heading (padding, grid, …). */
  bodyClassName?: string;
}

/**
 * Heading band + railed body. Use `bodyClassName="bp-grid sm:grid-cols-3"`
 * with `.bp-cell` children for ruled tiles, or padding for prose blocks.
 */
export function BlueprintSection({
  title,
  children,
  bodyClassName = "px-4 py-6 sm:px-6",
  ...heading
}: BlueprintSectionProps) {
  return (
    <section className="relative">
      <BlueprintHeading {...heading}>{title}</BlueprintHeading>
      <div data-bp-rails className={`border-x border-pv-border/25 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

/** Single ruled stat cell for `.bp-grid` rows (value + mono label). */
export function BlueprintStat({
  value,
  label,
  tone = "accent",
  className = "",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "accent" | "gold" | "text" | "danger";
  className?: string;
}) {
  const toneClass =
    tone === "gold"
      ? "text-pv-gold"
      : tone === "text"
        ? "text-pv-text"
        : tone === "danger"
          ? "text-pv-danger"
          : "text-pv-emerald";
  return (
    <div className={`bp-cell p-5 text-center sm:p-6 ${className}`}>
      <div className={`font-display text-3xl font-bold tracking-tight sm:text-4xl ${toneClass}`}>
        {value}
      </div>
      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-muted">
        {label}
      </div>
    </div>
  );
}
