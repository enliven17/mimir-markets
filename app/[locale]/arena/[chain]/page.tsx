import { redirect } from "@/i18n/navigation";

export const metadata = { robots: { index: false, follow: true } };

/*
 * /arena/<x> with nothing after it: old numeric market pages (/arena/12) are gone and a bare chain (/arena/base) has no
 * page of its own. Markets live at /arena/<chain>/<kind>/<id>. Both land on the Arena.
 */
export default async function Moved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/arena", locale });
}
