import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

/**
 * Surfaces: separated by glass and shadow, not borders.
 *
 * - Card   `rounded-2xl` glass card + shadow-card (landing `.pool-card`, `.inspector`)
 * - Panel  `rounded-xl` solid panel with a hairline and faint grain (landing `.panel`)
 * - Sheet  `rounded-4xl` deep glass for one focused job, forms and gates (app `.simple-card`)
 * - FeedCard  glossy bubble that lifts on hover (app `.live-bubble`)
 */

type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

export const Card = forwardRef<HTMLDivElement, DivProps & { hoverable?: boolean; pad?: boolean }>(
  function Card({ hoverable = false, pad = true, className = "", ...props }, ref) {
    return (
      <div
        ref={ref}
        className={`card ${hoverable ? "card-hover" : ""} ${pad ? "p-6" : ""} ${className}`}
        {...props}
      />
    );
  },
);

export const Panel = forwardRef<HTMLDivElement, DivProps>(function Panel({ className = "", ...props }, ref) {
  return (
    <div
      ref={ref}
      className={`grain overflow-hidden rounded-xl border border-line bg-[rgba(24,20,19,.92)] p-[clamp(22px,3vw,32px)] ${className}`}
      {...props}
    />
  );
});

export const Sheet = forwardRef<HTMLDivElement, DivProps & { center?: boolean }>(function Sheet(
  { center = false, className = "", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`glass-deep w-full min-w-0 rounded-4xl px-6 py-10 shadow-sheet sm:px-11 sm:pb-11 sm:pt-[52px] ${
        center ? "text-center" : ""
      } ${className}`}
      {...props}
    />
  );
});

export const FeedCard = forwardRef<HTMLDivElement, DivProps & { index?: number }>(function FeedCard(
  { index, className = "", style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`card-in relative rounded-2xl bg-[linear-gradient(145deg,rgb(33_23_27/.94),rgb(11_9_12/.94))] shadow-bubble transition-[transform,box-shadow] duration-300 ease-overshoot hover:-translate-y-[5px] hover:-rotate-[.8deg] hover:shadow-bubble-hover motion-reduce:hover:transform-none ${className}`}
      style={index === undefined ? style : ({ ...style, "--i": index } as React.CSSProperties)}
      {...props}
    />
  );
});

export default Card;
