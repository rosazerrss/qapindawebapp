import type { Metadata } from 'next';

/**
 * QAPINDA — This part of the app is not for search engines.
 *
 * `robots.txt` already asks crawlers not to visit. That is a request about
 * CRAWLING, and it does not stop a page being indexed: a URL that gets linked
 * from somewhere else can appear in results with no description under it,
 * because the crawler was told not to look. The meta tag this layout emits is
 * the other half — it says "do not INDEX", and it is the one that actually
 * keeps a till screen or a sign-in wall out of somebody's search results.
 *
 * `follow` stays on: links out of these pages lead back to the public site,
 * and there is no reason to make a crawler forget them.
 *
 * A layout rather than a per-page export, because there is one of these and
 * there are dozens of pages under it — and the page that gets forgotten is
 * always the one added last.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function PrivateAreaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
