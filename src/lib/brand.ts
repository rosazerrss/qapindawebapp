/**
 * The look of a restaurant that has not uploaded a photograph yet.
 *
 * Most of them have not, so this is not an edge case — it is the shopfront, and
 * the same restaurant has to look like itself on a card and at the top of its
 * own page. Both call in here rather than each inventing a gradient.
 */

import { FOOD_CATEGORIES, restaurantCategories } from '@/shared/categories';

/**
 * A washed-back gradient in the restaurant's own colour.
 *
 * The alpha suffix only means anything on a six-digit hex, and `brandColor` is
 * whatever was stored when the restaurant signed up — an eight-digit value or a
 * stray word would make the whole declaration invalid and leave the surface
 * transparent, which is how a card collapses. Anything unexpected therefore
 * falls back to the ink tint every other empty surface in the app uses.
 */
export function brandTint(brandColor: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(brandColor)) return 'var(--color-ink-100)';
  return `linear-gradient(135deg, ${brandColor}1f 0%, ${brandColor}3d 100%)`;
}

/** The picture of what this restaurant cooks, or nothing if we cannot tell. */
export function categoryEmblem(restaurant: {
  categories?: string[] | null;
  cuisines?: string[] | null;
}): string | null {
  const [primary] = restaurantCategories(restaurant);
  return FOOD_CATEGORIES.find((entry) => entry.id === primary)?.emoji ?? null;
}
