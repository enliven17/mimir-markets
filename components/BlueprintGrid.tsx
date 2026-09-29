/**
 * @deprecated Legacy blueprint building blocks, restyled for the radio system
 * (docs/REDESIGN.md P1) so existing pages keep their exports. New code uses
 * `Eyebrow`, `Strip` / `StripCell` and plain headings with the `app-h1`
 * type token. Removed in P6.
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

// Left-aligned heading: optional red eyebrow, Terminal Grotesque title at the
// app-h1 size (page) or section size (h2/h3), one muted line under it. No rules.
export function BlueprintHeading({
  children,
  as: Tag = "h2",
  eyebrow,
  subtitle,
  id,
  className = "",
}: BlueprintHeadingProps) {
  const size = Tag === "h1" ? "text-app-h1" : Tag === "h2" ? "text-section" : "text-title";
  return (
    <div data-bp-rails className={`relative px-0 pb-6 pt-8 text-left sm:pt-10 ${className}`}>
      {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
      <Tag id={id} className={`break-words font-display font-normal text-cream ${size}`}>
        {children}
      </Tag>
      {subtitle ? (
        <p className="mt-3 max-w-[60ch] truncate text-copy text-muted sm:text-[15px]">{subtitle}</p>
      ) : null}
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
      <div data-bp-rails className={bodyClassName}>
        {children}
      </div>
    </section>
  );
}

/** Stat cell in the radio Strip style: micro dim label over a mono value. */
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
  const toneClass = tone === "danger" ? "text-danger" : tone === "accent" ? "text-coral" : "text-cream";
  return (
    <div className={`bp-cell flex flex-col gap-1 px-[18px] py-4 text-left ${className}`}>
      <div className="order-2 font-mono text-[22px] tabular-nums leading-tight sm:text-[26px]">
        <span className={toneClass}>{value}</span>
      </div>
      <div className="order-1 text-[11px] uppercase tracking-[0.06em] text-muted">{label}</div>
    </div>
  );
}
