import type { ReactNode } from "react";

/** 14px red label with an 8px red square in front (radio `.eyebrow`). */
export default function Eyebrow({
  children,
  as: Tag = "p",
  className = "",
}: {
  children: ReactNode;
  as?: "p" | "span" | "div";
  className?: string;
}) {
  return <Tag className={`eyebrow ${className}`}>{children}</Tag>;
}
