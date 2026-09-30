import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Card";

/** Error and not-found layout: one centred sheet, a status line, one line of copy, the actions. */
export default function ErrorPanel({
  status,
  title,
  body,
  actions,
}: {
  status: ReactNode;
  title: ReactNode;
  body: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="grid min-h-[60vh] place-items-center py-10">
      <Sheet center className="max-w-[560px]">
        <p className="m-0 inline-flex items-center gap-2 text-status uppercase text-muted">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]" />
          {status}
        </p>
        <h1 className="m-0 mt-4 font-display text-app-hero text-cream">{title}</h1>
        <p className="mx-auto mb-0 mt-4 max-w-[36ch] text-copy text-muted">{body}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{actions}</div>
      </Sheet>
    </section>
  );
}
