import { notFound } from "next/navigation";

export const metadata = { robots: { index: false, follow: false } };

/** Any unmatched path under a locale renders the localized not-found page inside the app shell. */
export default function CatchAll() {
  notFound();
}
