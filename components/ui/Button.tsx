import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Pill buttons (`.btn-primary` / `.btn-ghost`). Press = scale(.97) in CSS.
 *
 * - primary   coral gradient + grain, ink label (white only at 21px+)
 * - ghost     glass pill
 * - light     cream fill, ink label
 * - secondary panel-raised with a hairline, border turns coral on hover
 * - danger    danger fill, dark label
 * Legacy names: `emerald` = primary, `cyan` / `fuch` = secondary.
 */
export type ButtonVariant =
  | "primary"
  | "ghost"
  | "light"
  | "secondary"
  | "danger"
  | "emerald"
  | "cyan"
  | "fuch";

export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  emerald: "btn-primary",
  ghost: "btn-ghost",
  light: "btn-light",
  secondary: "btn-cyan",
  cyan: "btn-cyan",
  fuch: "btn-fuch",
  danger: "btn-danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  // Dense app UI: 46px, .82rem.
  sm: "!min-h-[46px] !py-2.5 !px-5 !text-[15px]",
  md: "min-h-[3.25rem]",
  // Landing hero: 23px, 17px/31px padding.
  lg: "!py-[17px] !px-[31px] !text-[23px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    loading = false,
    fullWidth = true,
    className = "",
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = Boolean(disabled || loading);
  return (
    <button
      ref={ref}
      type={type}
      className={`${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? "" : "!w-auto"} ${
        loading ? "disabled:!cursor-wait disabled:!opacity-100" : ""
      } ${className}`}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
});

export default Button;

/** Same look for links: `<a className={buttonClass("ghost")}>`. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", fullWidth = false) {
  return `${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? "" : "!w-auto"}`;
}
