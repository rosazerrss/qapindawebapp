/**
 * QAPINDA — The marks on a restaurant's card.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * DERIVED WHERE POSSIBLE, STORED ONLY WHERE IT MUST BE
 * ----------------------------------------------------
 * Three of the four badges asked for are facts the restaurant document already
 * contains, and computing them costs nothing: "new" is a date, "popular" is a
 * count and a rating. Storing those would mean a job to keep them fresh, a
 * window in which they are wrong, and a way for them to be wrong forever if the
 * job ever stops — for information that is already sitting in the same document
 * being rendered.
 *
 * Only "featured" is genuinely a decision rather than a fact, so only "featured"
 * is stored.
 *
 * WHY THERE IS NO "PREMIUM"
 * -------------------------
 * It was on the list and it is deliberately not here. A premium badge tells a
 * customer the restaurant is paying for something, and Qapında sells no such
 * plan — so the badge would either mean nothing, or mean "the admin liked
 * them", which is what `featured` already says without the implication of
 * money. When there is a paid tier, the badge follows the tier; inventing the
 * label first is how a platform ends up with a mark nobody can explain.
 *
 * AT MOST ONE BADGE
 * -----------------
 * A card carrying three marks has none: the eye stops reading them. `badgeFor`
 * returns the single most useful one, in a fixed order of precedence, so the
 * shopfront never has to decide.
 */

import type { Restaurant } from './models';

export const RestaurantBadge = {
  /**
   * PAID PLACEMENT. Beats everything, and says so.
   *
   * The label a customer reads is "Reklam", never "Seçilmiş", and that
   * separation is the whole point of it being a second value rather than a flag
   * on the first. A platform that sells a slot and presents it as its own
   * recommendation is telling its customers something untrue about the one
   * thing they use the shopfront's ordering to judge.
   */
  SPONSORED: 'SPONSORED',
  /** An admin put them there, for nothing. A recommendation, and honestly one. */
  FEATURED: 'FEATURED',
  /**
   * Something on the menu is cheaper than it was.
   *
   * Above NEW deliberately. "New" is a reason to look; a discount is money, and
   * money is what a person choosing between two shops actually weighs. A shop
   * that is both shows the offer.
   */
  DISCOUNT: 'DISCOUNT',
  /** Opened recently — a real reason to look. */
  NEW: 'NEW',
  /** Ordered from a lot, and rated well while it happened. */
  POPULAR: 'POPULAR',
} as const;
export type RestaurantBadge = (typeof RestaurantBadge)[keyof typeof RestaurantBadge];

/**
 * How long a restaurant counts as new.
 *
 * Fourteen days. Long enough that a shop opening on a quiet week is still new
 * when the weekend comes, short enough that "new" keeps meaning something —
 * a badge every restaurant carries for two months is decoration.
 */
export const NEW_RESTAURANT_DAYS = 14;

/**
 * What "popular" takes.
 *
 * Both halves matter. Orders alone would mark a busy restaurant people keep
 * being disappointed by; a rating alone would mark a shop with four orders and
 * five stars from the owner's friends. Twenty-five orders is enough that the
 * average means something, and 4.3 is above what an indifferent meal collects.
 */
export const POPULAR_MIN_ORDERS = 25;
export const POPULAR_MIN_RATING = 4.3;

export function badgeFor(
  restaurant: Pick<
    Restaurant,
    'createdAt' | 'completedOrderCount' | 'ratingAverage' | 'ratingCount'
  > & {
    featured?: boolean;
    featuredKind?: string | null;
    featuredUntil?: { toMillis?: () => number } | null;
    hasDiscount?: boolean;
  },
  nowMs: number = Date.now(),
): RestaurantBadge | null {
  /*
   * A promotion that has run out is not a promotion.
   *
   * `featuredUntil` is what makes a sold slot end by itself. Checked here, in
   * the one function every screen asks, so a scheduled sweep that has not run
   * yet — or has stopped running — cannot leave somebody advertising for free.
   * The sweep exists as well; this is the half that cannot be forgotten.
   */
  const untilMs = restaurant.featuredUntil?.toMillis?.() ?? null;
  const promotionLive = restaurant.featured === true && (untilMs === null || untilMs > nowMs);

  if (promotionLive) {
    return restaurant.featuredKind === 'SPONSORED'
      ? RestaurantBadge.SPONSORED
      : RestaurantBadge.FEATURED;
  }

  if (restaurant.hasDiscount === true) return RestaurantBadge.DISCOUNT;

  const createdMs = restaurant.createdAt?.toMillis?.() ?? null;
  if (createdMs !== null && nowMs - createdMs < NEW_RESTAURANT_DAYS * 24 * 60 * 60_000) {
    return RestaurantBadge.NEW;
  }

  if (
    (restaurant.completedOrderCount ?? 0) >= POPULAR_MIN_ORDERS &&
    (restaurant.ratingAverage ?? 0) >= POPULAR_MIN_RATING &&
    // A rating average with no ratings behind it is a default, not an opinion.
    (restaurant.ratingCount ?? 0) > 0
  ) {
    return RestaurantBadge.POPULAR;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Menu quality
// ---------------------------------------------------------------------------

/**
 * WHAT MAKES A MENU BAD, IN THINGS A RESTAURANT CAN FIX TODAY.
 *
 * Not a score out of ten. A number tells an owner they are at 62% and nothing
 * about what to do; a list of "eleven dishes have no photograph" is a job. Each
 * check below is something the restaurant can act on in an afternoon, and
 * nothing here guesses at taste.
 *
 * Computed from the products the panel has already loaded — no callable, no
 * scheduled job, no stored score to go stale. The menu screen holds the whole
 * menu in memory because it renders it; this is arithmetic on top.
 */
export interface MenuQuality {
  total: number;
  /** A dish with no photograph. The single biggest cause of it not selling. */
  missingImage: number;
  /** No description at all — the customer is guessing what is in it. */
  missingDescription: number;
  /** Priced at zero, which is almost always a half-finished dish. */
  freeItems: number;
  /** Marked sold out and left that way. */
  outOfStock: number;
  /** Hidden from customers entirely. */
  hidden: number;
  /** 0…100. Shown as a bar, never as the headline. */
  score: number;
}

interface QualityProduct {
  imageUrl?: string | null;
  description?: string | null;
  price?: number;
  availability?: string;
}

export function menuQuality(products: readonly QualityProduct[]): MenuQuality {
  const total = products.length;

  const missingImage = products.filter((product) => !product.imageUrl).length;
  const missingDescription = products.filter(
    (product) => !product.description || product.description.trim().length < 10,
  ).length;
  const freeItems = products.filter((product) => (product.price ?? 0) <= 0).length;
  const outOfStock = products.filter(
    (product) => product.availability === 'OUT_OF_STOCK_TODAY',
  ).length;
  const hidden = products.filter((product) => product.availability === 'HIDDEN').length;

  /*
   * The score, and what it is weighted by.
   *
   * A photograph counts double a description, because a dish without a picture
   * is the one customers scroll past. A price of zero counts as a whole missing
   * dish, because it is one. Sold out and hidden are NOT counted against the
   * menu at all: running out of something is running a kitchen, not neglecting
   * a menu, and a hidden dish is a deliberate act.
   */
  if (total === 0) {
    return { total, missingImage, missingDescription, freeItems, outOfStock, hidden, score: 0 };
  }

  const faults = missingImage * 2 + missingDescription + freeItems * 2;
  const worst = total * 5;
  const score = Math.max(0, Math.round(100 - (faults / worst) * 100));

  return { total, missingImage, missingDescription, freeItems, outOfStock, hidden, score };
}
