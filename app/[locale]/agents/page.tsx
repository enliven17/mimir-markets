import { redirect } from "@/i18n/navigation";

/* /agents moved: agents and the council live together on /launch now. Old links land there. */
export default async function Moved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/launch", locale });
}
