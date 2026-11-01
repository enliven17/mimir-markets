import { redirect } from "@/i18n/navigation";

export const metadata = { robots: { index: false, follow: true } };

/* Old numeric market pages are gone: markets live on Arc (/arena/arc/[kind]/[id]). Old links land on the Arena. */
export default async function Moved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/arena", locale });
}
