import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import HtmlLang from "@/components/HtmlLang";
import PageFrame from "@/components/PageFrame";
import WalletSheetProvider from "@/components/wallet/WalletSheetProvider";
import AppBanners from "@/components/app/AppBanners";
import MobileTabBar from "@/components/app/MobileTabBar";
import ConsentNotice from "@/components/legal/ConsentNotice";
import RouteProgress from "@/components/app/RouteProgress";
import ArcLaunchModal from "@/components/arc/ArcLaunchModal";
import AccessGate from "@/components/access/AccessGate";
import ConvexClientProvider from "@/components/arc/arena/ConvexClientProvider";
import SkipToContentLink from "@/components/SkipToContentLink";
import { SITE_URL } from "@/lib/site";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  // No canonical here: a layout's canonical is inherited by every page that sets none, which would point them all
  // at the home page. Each page sets its own (lib/seo.ts pageMeta).
  const verification = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("title"), template: "%s · Mimir Markets" },
    description: t("description"),
    applicationName: "Mimir Markets",
    openGraph: { title: t("title"), description: t("description"), type: "website", siteName: "Mimir Markets", locale },
    twitter: { card: "summary_large_image", site: "@mimirmarkets", title: t("title"), description: t("description") },
    ...(verification ? { verification: { google: verification } } : {}),
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <ConvexClientProvider>
      <WalletSheetProvider>
        <HtmlLang locale={locale} />
        <SkipToContentLink />
        <Header />
        {/* min-h-svh: the footer starts below the fold, so data landing on a page
            never shoves it (or anything else in view) around: no layout shift. */}
        <main id="main-content" tabIndex={-1} className="min-h-svh min-w-0 outline-none">
          <PageFrame>
            <AccessGate>{children}</AccessGate>
          </PageFrame>
        </main>
        <Footer />
        <ArcLaunchModal />
        <AppBanners />
        <MobileTabBar />
        <ConsentNotice />
        <RouteProgress />
      </WalletSheetProvider>
      </ConvexClientProvider>
    </NextIntlClientProvider>
  );
}
