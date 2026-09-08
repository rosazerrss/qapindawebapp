import type { MetadataRoute } from 'next';

import { ADMIN_ROOT, OPERATOR_ROOT } from '@/shared/permissions';

/**
 * QAPINDA — What a crawler may look at.
 *
 * WHY THIS FILE HAS TO EXIST
 * --------------------------
 * Without it there is no `robots.txt` at all. Google then crawls whatever it
 * finds, which is not a disaster on its own — but it also has no pointer to the
 * sitemap, so the restaurant pages are discovered only by following links from
 * the home page, and the home page renders its list in the browser. The
 * practical result was a platform that was, in search terms, invisible.
 *
 * WHAT IS BLOCKED, AND WHY EACH ONE
 * ---------------------------------
 * Everything a person must be signed in to use. None of these pages leak
 * anything — the security rules and the callables decide that, not this file —
 * but they are useless in a search result and worse than useless in a search
 * INDEX: a customer searching for a restaurant does not want the till screen,
 * and an indexed panel is a door a scanner now knows about.
 *
 * The admin and operator roots are imported rather than typed out. The admin
 * path is deliberately obscure, and writing it into a public file by hand is
 * how it would end up out of step with the real one — or, worse, correct and
 * then forgotten when the real one changes.
 *
 * `/m/` is the image proxy: it serves bytes, not pages, and a crawler walking
 * it would cost bandwidth for nothing.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qapinda.az';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/account',
          '/cart',
          '/checkout',
          '/orders',
          '/courier',
          '/panel',
          '/login',
          '/admin-login',
          '/m/',
          `${OPERATOR_ROOT}`,
          `${ADMIN_ROOT}`,
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
