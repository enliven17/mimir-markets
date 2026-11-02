import { createNavigation } from "next-intl/navigation";
import { createElement, type ComponentProps } from "react";
import { routing } from "./routing";

const navigation = createNavigation(routing);
export const { redirect, usePathname, useRouter } = navigation;

// Pages carry a fresh CSP nonce and render on request. Avoid rendering every
// visible navigation target before the visitor actually opens it.
export function Link({ prefetch = false, ...props }: ComponentProps<typeof navigation.Link>) {
  return createElement(navigation.Link, { ...props, prefetch });
}
