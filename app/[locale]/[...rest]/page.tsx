import { notFound } from "next/navigation";

/** Any unmatched path under a locale renders the localized not-found page inside the app shell. */
export default function CatchAll() {
  notFound();
}
