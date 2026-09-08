import type { MetadataRoute } from 'next';

import { publicRestaurants } from '@/server/firestore';

/**
 * QAPINDA — The map a search engine follows.
 *
 * WHY IT MATTERS MORE HERE THAN ON MOST SITES
 * -------------------------------------------
 * A crawler finds pages by following links. This app renders its restaurant
 * list in the browser, so the HTML of the home page contains no link to any
 * restaurant at all — which meant that until the server-rendered pages landed
 * beside this file, there was no path from `/` to `/restaurant/kabab-evi` that a
 * crawler could walk. The sitemap is the second half of that fix: it names
 * every page directly, so discovery does not depend on a link being followed.
 *
 * WHAT IS IN IT
 * -------------
 * The public pages, and every ACTIVE restaurant. Nothing that needs an account
 * — those are refused in `robots.ts` and listing them here would be asking a
 * crawler to index a sign-in wall.
 *
 * The restaurant entries use the slug, which is the shareable form of the URL.
 * A restaurant with no slug is skipped rather than listed by its raw id: an id
 * in a search result is a URL nobody would click, and it would compete with the
 * slug version for the same page.
 *
 * IF FIRESTORE CANNOT BE REACHED the list is empty and the static pages are
 * still served. A sitemap missing its restaurants is a smaller problem than a
 * sitemap that 500s, which some crawlers remember for a long time.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qapinda.az';

  const staticPages: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/search`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/partner`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/legal/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/legal/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/legal/cookies`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const restaurants = await publicRestaurants();

  return [
    ...staticPages,
    ...restaurants
      .filter((restaurant) => Boolean(restaurant.slug))
      .map((restaurant) => ({
        url: `${siteUrl}/restaurant/${restaurant.slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
  ];
}
