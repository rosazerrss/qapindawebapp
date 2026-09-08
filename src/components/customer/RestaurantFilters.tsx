'use client';

/**
 * Narrowing a long list of restaurants.
 *
 * Three controls, in the order a hungry person actually decides:
 *
 *  1. **Cuisine** — the first thing anyone picks. A horizontal rail, because a
 *     dropdown hides the options and the options *are* the appetite.
 *  2. **Sort** — recommended, best rated, fastest, cheapest delivery, lowest
 *     minimum. Only one can be active; sorting is not a set.
 *  3. **Switches** — open now, free delivery. These *are* a set.
 *
 * The filtering itself lives in `applyFilters` below rather than in the screen,
 * so the home page and the search page cannot drift apart in what "open" means.
 */

import { SlidersHorizontal, X } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import { isOpenNow } from '@/services/catalog';
import { looselyMatches } from '@/shared/search';
import type { Restaurant } from '@/shared/models';
import type { GeoPoint } from '@/shared/geo';
import { compareByProximity, restaurantDistanceMetres } from '@/shared/nearby';
import { cuisineLabel } from '@/shared/cuisines';

export type SortKey = 'recommended' | 'rating' | 'fastest' | 'delivery' | 'minOrder';

export const SORT_KEYS: SortKey[] = ['recommended', 'rating', 'fastest', 'delivery', 'minOrder'];

export interface FilterState {
  cuisine: string | null;
  sort: SortKey;
  openOnly: boolean;
  freeDelivery: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  cuisine: null,
  sort: 'recommended',
  openOnly: false,
  freeDelivery: false,
};

export function filtersActive(filters: FilterState): boolean {
  return (
    filters.cuisine !== null ||
    filters.sort !== 'recommended' ||
    filters.openOnly ||
    filters.freeDelivery
  );
}

/**
 * Filter, then sort. Closed restaurants always sink, whatever the sort —
 * a shop that cannot take the order is never the best answer to "which one".
 */
export function applyFilters(
  restaurants: Restaurant[],
  filters: FilterState,
  term: string,
  /**
   * Where the customer is, when they have told us.
   *
   * Optional, and every screen that does not pass it behaves exactly as it did
   * before — which is the point: a guest, or somebody whose saved address has
   * no pin, must not get a different list because a new argument appeared.
   */
  from: GeoPoint | null = null,
): Restaurant[] {
  const needle = term.trim();

  const kept = restaurants.filter((restaurant) => {
    if (filters.cuisine && !restaurant.cuisines.includes(filters.cuisine)) return false;
    if (filters.openOnly && !isOpenNow(restaurant)) return false;

    /*
     * "PULSUZ ÇATDIRILMA" HAS TO MEAN FREE.
     *
     * This used to keep a restaurant that charges 3 ₼ but delivers free above
     * 30 ₼ — so the filter answered "free delivery" with a list of restaurants
     * that charge for delivery. Worse, the "Pulsuz çatdırılma" section on the
     * same screen used the strict rule, so one phrase meant two different
     * things a few hundred pixels apart.
     *
     * Free is free: no fee at all. A threshold offer is a discount, and a
     * customer who wanted one would have to know their basket size first —
     * which a filter on a list of restaurants cannot.
     */
    if (filters.freeDelivery && restaurant.deliveryFee > 0) return false;

    if (!needle) return true;

    // Folded on both sides, so "doner" finds "Dönərçi". Comparing raw
    // lowercase strings is why typing without Azerbaijani letters — which is
    // how most people type on a phone — found nothing.
    return (
      looselyMatches(restaurant.name, needle) ||
      restaurant.cuisines.some((entry) => looselyMatches(entry, needle))
    );
  });

  const rank = (restaurant: Restaurant) => {
    switch (filters.sort) {
      case 'rating':
        // An unrated restaurant is not a bad restaurant, but it cannot claim a
        // place among the rated ones either.
        return restaurant.ratingCount > 0 ? -restaurant.ratingAverage : 100;
      case 'fastest':
        return restaurant.estimatedMinutesMin;
      case 'delivery':
        return restaurant.deliveryFee;
      case 'minOrder':
        return restaurant.minOrderAmount;
      default:
        return -(restaurant.ratingCount > 0 ? restaurant.ratingAverage : 0);
    }
  };

  /*
   * NEAR FIRST, ONCE WE KNOW WHERE "NEAR" IS.
   *
   * Distance becomes the order whenever the customer has a pinned address and
   * has not asked for a different sort. It is not merely a nicer default: every
   * restaurant on this platform delivers with its own couriers inside its own
   * radius, so a shop across the city is frequently not a worse option but a
   * SUBSTITUTE FOR AN OPTION — it cannot take the order at all. Ranking those
   * above a nearer shop spends the customer's attention on nothing.
   *
   * The explicit sorts still win. Somebody who taps "Reytinq" is asking a
   * different question and gets it answered.
   */
  const measured = new Map<string, number | null>();
  if (from) {
    for (const restaurant of kept) {
      measured.set(restaurant.id, restaurantDistanceMetres(restaurant, from));
    }
  }

  const useDistance = from !== null && filters.sort === 'recommended';

  return [...kept].sort((a, b) => {
    if (useDistance) {
      return compareByProximity(
        {
          distance: measured.get(a.id) ?? null,
          open: isOpenNow(a),
          rating: a.ratingAverage,
          ratingCount: a.ratingCount,
        },
        {
          distance: measured.get(b.id) ?? null,
          open: isOpenNow(b),
          rating: b.ratingAverage,
          ratingCount: b.ratingCount,
        },
      );
    }

    const openGap = Number(isOpenNow(b)) - Number(isOpenNow(a));
    if (openGap !== 0) return openGap;
    return rank(a) - rank(b);
  });
}

export function RestaurantFilters({
  cuisines,
  filters,
  onChange,
}: {
  cuisines: string[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const t = useT();
  const patch = (values: Partial<FilterState>) => onChange({ ...filters, ...values });

  return (
    <div className="space-y-4">
      {cuisines.length > 0 && (
        <div
          className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label={t('restaurant.cuisines')}
        >
          <Chip active={filters.cuisine === null} onClick={() => patch({ cuisine: null })}>
            {t('common.all')}
          </Chip>
          {cuisines.map((entry) => (
            <Chip
              key={entry}
              active={filters.cuisine === entry}
              onClick={() => patch({ cuisine: entry === filters.cuisine ? null : entry })}
            >
              {cuisineLabel(entry, t)}
            </Chip>
          ))}
        </div>
      )}

      {/* Sorting and the switches share a rule so they read as one control
          strip rather than two competing rows of pills. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-card-edge pt-4">
        <span className="inline-flex items-center gap-1.5 pr-1 text-sm font-medium text-ink-500">
          <SlidersHorizontal size={15} aria-hidden />
          {t('filters.sort')}
        </span>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filters.sort')}>
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.sort === key}
              onClick={() => patch({ sort: key })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition',
                filters.sort === key
                  ? 'border-ink-900 bg-ink-900 font-medium text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400',
              )}
            >
              {t(`filters.${key}`)}
            </button>
          ))}
        </div>

        <span aria-hidden className="mx-1 hidden h-5 w-px bg-ink-200 sm:block" />

        <Toggle active={filters.openOnly} onClick={() => patch({ openOnly: !filters.openOnly })}>
          {t('filters.openOnly')}
        </Toggle>

        <Toggle
          active={filters.freeDelivery}
          onClick={() => patch({ freeDelivery: !filters.freeDelivery })}
        >
          {t('filters.freeDelivery')}
        </Toggle>

        {filtersActive(filters) && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
          >
            <X size={14} aria-hidden /> {t('filters.clear')}
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300',
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition',
        active
          ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
          : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300',
      )}
    >
      {children}
    </button>
  );
}
