/**
 * QAPINDA — A restaurant's page, rendered on the server first.
 *
 * WHY THIS FILE APPEARED
 * ----------------------
 * This page used to be a single client component. That meant the HTML a
 * crawler received contained no restaurant name, no dish and no price — the
 * whole menu was fetched by JavaScript after the page loaded. For a food
 * platform that is not a small SEO problem: the pages that ought to rank for
 * "kabab çatdırılma" were, to a search engine, empty.
 *
 * So the page is now split. This half runs on the server: it reads the
 * restaurant and its menu, fills in the title, description and social card, and
 * emits the structured data Google uses for a restaurant result. The half in
 * `RestaurantView` is still a client component and still owns everything
 * interactive; it simply starts from what the server already found instead of
 * from nothing.
 *
 * IT ALSO CUTS THE LARGEST FIRESTORE BILL IN THE APP.
 * Every visitor used to re-read the restaurant document and its whole menu from
 * their own browser. Now one server render serves everybody for five minutes.
 * At a hundred visitors an hour that is the difference between six hundred
 * reads and twelve.
 *
 * IF THE SERVER CANNOT READ FIRESTORE — no metadata server on a laptop, or a
 * transient failure — every value here is null, the metadata falls back to the
 * generic title, and the client half fetches as it always did. Nothing breaks;
 * the page is simply no better than it was.
 */

import type { Metadata } from 'next';

import { PUBLIC_REVALIDATE_SECONDS, publicMenu, publicRestaurant } from '@/server/firestore';
import type { MenuSection } from '@/services/catalog';

import { RestaurantView } from './RestaurantView';

export const revalidate = 300;

/** The URL a handle should canonically be reached at. */
function canonicalPath(handle: string, slug?: string | null): string {
  return `/restaurant/${slug || handle}`;
}

export async function generateMetadata({
  params,
}: PageProps<'/restaurant/[handle]'>): Promise<Metadata> {
  const { handle } = await params;
  const restaurant = await publicRestaurant(decodeURIComponent(handle));

  if (!restaurant) {
    // Unknown, or unreadable from here. `noindex` rather than a guessed title:
    // a page that might not exist should not be competing in search results.
    return { robots: { index: false, follow: true } };
  }

  const description =
    restaurant.tagline?.trim() ||
    `${restaurant.name} — onlayn sifariş və çatdırılma. Menyu, qiymətlər və iş saatları Qapındada.`;

  const image = restaurant.coverUrl || restaurant.logoUrl || undefined;

  return {
    title: restaurant.name,
    description,
    alternates: { canonical: canonicalPath(handle, restaurant.slug) },
    openGraph: {
      type: 'website',
      title: `${restaurant.name} · Qapında`,
      description,
      url: canonicalPath(handle, restaurant.slug),
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `${restaurant.name} · Qapında`,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function RestaurantPage({ params }: PageProps<'/restaurant/[handle]'>) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);

  const restaurant = await publicRestaurant(decoded);

  /*
   * The menu, shaped exactly as the client component's own loader shapes it.
   *
   * Building the sections here rather than passing raw rows keeps one meaning
   * of "a menu section" in the app: if `watchMenu` ever changes what it emits,
   * this has to change with it, and the types will say so.
   */
  const sections: MenuSection[] | null = restaurant
    ? await publicMenu(restaurant.id).then(({ categories, products }) =>
        categories
          .map((category) => ({
            category,
            products: products
              .filter((product) => product.categoryId === category.id)
              .sort((a, b) => a.sortOrder - b.sortOrder),
          }))
          .filter((section) => section.products.length > 0),
      )
    : null;

  return (
    <>
      {/*
        Structured data, which is what actually produces a rich result.

        `Restaurant` with a `hasMenu` is the schema Google reads for exactly
        this kind of page. It is emitted only when the server really did find
        the restaurant — structured data describing a page whose content did
        not load is worse than none, and is the kind of mismatch that gets a
        site's rich results switched off.
      */}
      {restaurant && (
        <script
          type="application/ld+json"
          // The payload is built here from our own data, never from user input
          // that could contain markup — the fields are a name, a description
          // and prices.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Restaurant',
              name: restaurant.name,
              description: restaurant.tagline || undefined,
              image: restaurant.coverUrl || restaurant.logoUrl || undefined,
              servesCuisine: restaurant.cuisines?.length ? restaurant.cuisines : undefined,
              priceRange: '₼',
              address: {
                '@type': 'PostalAddress',
                addressCountry: 'AZ',
                addressLocality: restaurant.regionId || undefined,
                streetAddress: restaurant.addressLine || undefined,
              },
              aggregateRating:
                restaurant.ratingCount && restaurant.ratingCount > 0
                  ? {
                      '@type': 'AggregateRating',
                      ratingValue: restaurant.ratingAverage,
                      reviewCount: restaurant.ratingCount,
                    }
                  : undefined,
              hasMenu: sections?.length
                ? {
                    '@type': 'Menu',
                    hasMenuSection: sections.slice(0, 20).map((section) => ({
                      '@type': 'MenuSection',
                      name: section.category.name,
                      hasMenuItem: section.products.slice(0, 40).map((product) => ({
                        '@type': 'MenuItem',
                        name: product.name,
                        description: product.description || undefined,
                        offers: {
                          '@type': 'Offer',
                          // Schema.org wants a decimal, and every price in this
                          // system is an integer number of qəpik.
                          price: (product.price / 100).toFixed(2),
                          priceCurrency: 'AZN',
                        },
                      })),
                    })),
                  }
                : undefined,
            }),
          }}
        />
      )}

      <RestaurantView
        handle={decoded}
        initialRestaurant={restaurant}
        initialSections={sections}
      />
    </>
  );
}

// Referenced so the constant is not merely documentation: the page's own
// `revalidate` above and the fetch-level revalidate in `server/firestore` must
// not drift apart.
void PUBLIC_REVALIDATE_SECONDS;
