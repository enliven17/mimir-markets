import { redirect } from "@/i18n/navigation";

/* /mainnet moved: the release notes are a section of /docs (components/docs/ReleaseNotes.tsx). Old links land there. */
export default async function MainnetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/docs#release", locale });
}
