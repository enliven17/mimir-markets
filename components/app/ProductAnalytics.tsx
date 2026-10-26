"use client";
import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";
import { trackProductEvent } from "@/lib/product-analytics";
export default function ProductAnalytics() {
  const path = usePathname();
  useEffect(() => { trackProductEvent("mimir_visit", { page: path === "/" ? "home" : path.startsWith("/demo") ? "preview" : path.startsWith("/launch") ? "agents" : path.startsWith("/arena") ? "markets" : "other" }); }, [path]);
  return null;
}
