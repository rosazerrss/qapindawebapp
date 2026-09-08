'use client';

/**
 * One restaurant, as it appears in any grid.
 *
 * The photo carries the appetite, so it gets the top of the card and the
 * numbers a person compares — fee, minimum, ETA — sit together in one row below
 * a rule, where the eye can scan them across several cards at once.
 */

import Link from 'next/link';
import { Clock, MapPin, Star, Truck, Wallet } from 'lucide-react';

import { useT } from '@/i18n';
import { Money, cn } from '@/components/ui';
import { FavouriteButton } from './FavouriteButton';
import { isOpenNow, restaurantHref } from '@/services/catalog';
import { RestaurantBadge, badgeFor } from '@/shared/badges';
import { brandTint, categoryEmblem } from '@/lib/brand';
import { ServiceState } from '@/shared/enums';
import { formatDistance } from '@/shared/nearby';
import type { Restaurant } from '@/shared/models';
import { Img } from '@/components/ui/Img';
import { cuisineLabel } from '@/shared/cuisines';

export function RestaurantCard({
  restaurant,
  distance,
  regionLabel,
}: {
  restaurant: Restaurant;
  /**
   * Metres from the customer's own address, or null when we do not know.
   *
   * Passed in rather than computed here, and null rather than zero: the card
   * has no idea where the customer is, and "we have not been told" must not be
   * drawn as "next door". A guest, or somebody whose address has no pin, simply
   * sees no distance — which is the honest thing to show and also exactly what
   * this card looked like before.
   */
  distance?: number | null;
  /**
   * The city this restaurant is in — drawn only when the list spans more than
   * one.
   *
   * Absent in the ordinary case, and that is deliberate: a grid of Baku
   * restaurants with "Bakı" written on every card has spent a line of every
   * card to say something the customer chose at the top of the screen. It earns
   * its place only when the answer varies, which on this platform means the
   * "bütün şəhərlərə bax" fallback — where NOT saying it is the actual problem,
   * because a customer cannot tell that the shop they are about to open is in
   * another city.
   */
  regionLabel?: string | null;
}) {
  const t = useT();
  const open = isOpenNow(restaurant);
  const paused = restaurant.serviceState === ServiceState.PAUSED;

  // Most restaurants have no photograph yet, so the fallback tile is not a rare
  // case — it is the shopfront. It shows what the shop cooks rather than a flat
  // slab of brand colour: a grid of identical red rectangles tells a customer
  // nothing, and the category picture tells them where they are.
  const badge = badgeFor(restaurant);
  const emblem = categoryEmblem(restaurant);
  const wash = brandTint(restaurant.brandColor);

  // Closed and paused are different facts to the customer: one waits for the
  // clock, the other for the kitchen. Both are spelled out in words — the
  // dimmed photograph alone would be invisible to anyone who cannot see it.
  const unavailable = paused ? t('home.paused') : t('home.closed');

  return (
    <Link
      href={restaurantHref(restaurant)}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border border-card-edge bg-white',
        'shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-card',
      )}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-ink-100">
        {restaurant.coverUrl ? (
          // A plain img: the covers come from Storage with unpredictable sizes,
          // and next/image would need every bucket host allow-listed.
           
          <Img
            src={restaurant.coverUrl}
            alt=""
            loading="lazy"
            className={cn(
              'h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]',
              !open && 'scale-100 opacity-55 grayscale group-hover:scale-100',
            )}
          />
        ) : (
          // No photograph yet: a quiet wash of the restaurant's own colour
          // carrying its category, rather than a broken-image grey box. The
          // colour is held well back — this tile sits next to real photographs
          // of food and must not shout over them.
          <div
            className={cn(
              'flex h-full w-full items-center justify-center gap-2',
              !open && 'opacity-55 grayscale',
            )}
            style={{ background: wash }}
            aria-hidden
          >
            {emblem && <span className="text-4xl leading-none opacity-80">{emblem}</span>}
            <span className="text-2xl font-semibold tracking-wide text-ink-700/70">
              {restaurant.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <FavouriteButton
          kind="RESTAURANT"
          targetId={restaurant.id}
          className="absolute right-2.5 top-2.5 z-10"
        />

        {/* At most one mark, top left, out of the favourite button's way.
            `badgeFor` picks it — a card carrying three badges has none,
            because the eye stops reading them. Derived from the restaurant's
            own fields, so it can never be stale. */}
        {badge && (
          <span
            className={cn(
              'absolute left-2.5 top-2.5 z-10 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm',
              /*
                Four marks, three weights.

                "Reklam" is deliberately the QUIETEST of them — grey on white,
                the same weight as "Populyar". It is an advertisement, and an
                advertisement dressed as the platform's own strongest
                recommendation is the thing the label exists to prevent.
                "Endirim" is the loud one, because it is the only mark that
                tells the customer something about their own money.
              */
              badge === RestaurantBadge.DISCOUNT
                ? 'bg-brand-600 text-white'
                : badge === RestaurantBadge.FEATURED
                  ? 'bg-ink-900/90 text-white'
                  : badge === RestaurantBadge.NEW
                    ? 'bg-white/95 text-brand-700'
                    : 'bg-white/95 text-ink-500',
            )}
          >
            {t(`badge.${badge}`)}
          </span>
        )}

        {!open ? (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-ink-900/85 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {unavailable}
          </span>
        ) : restaurant.deliveryFee === 0 ? (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-success shadow-sm">
            {t('home.freeDelivery')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold leading-snug text-ink-900">
            {restaurant.name}
          </h3>

          {restaurant.ratingCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-lg bg-ink-50 px-2 py-1 text-sm font-medium text-ink-800">
              <Star size={13} className="fill-amber-400 text-amber-400" aria-hidden />
              {restaurant.ratingAverage.toFixed(1)}
              <span className="text-xs font-normal text-ink-400">
                ({restaurant.ratingCount})
              </span>
            </span>
          ) : (
            <span className="shrink-0 rounded-lg bg-ink-50 px-2 py-1 text-xs font-medium text-ink-500">
              {t('home.newLabel')}
            </span>
          )}
        </div>

        {/* The city, when the list is showing more than one. */}
        {regionLabel && (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-ink-600">
            <MapPin size={13} className="text-ink-400" aria-hidden />
            {regionLabel}
          </p>
        )}

        {/* Translated through `cuisineLabel`, which returns the platform's own
            word for an id from the list and the raw string for the free text an
            older restaurant still has stored. */}
        {restaurant.cuisines.length > 0 && (
          <p className="mt-1 truncate text-sm text-ink-400">
            {restaurant.cuisines.map((entry) => cuisineLabel(entry, t)).join(' · ')}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-card-edge pt-3 text-sm text-ink-600">
          <span className="flex items-center gap-1.5">
            <Clock size={14} className="text-ink-400" aria-hidden />
            {restaurant.estimatedMinutesMin}–{restaurant.estimatedMinutesMax} {t('common.minutes')}
          </span>

          {/*
            HOW FAR, WHEN WE HONESTLY KNOW.

            Beside the time rather than under the name, because the two answer
            one question together: "how long until I am eating". A straight-line
            distance on its own would be a number without a use — paired with the
            kitchen's own estimate it is the difference between a shop two
            streets away and one on the far side of the city with the same
            promised half hour.

            Straight-line, and it is worth being clear that it is not a driving
            distance. It is not presented as one — no route, no arrow, no "10
            dəq uzaqda" — and for choosing between restaurants in the same city
            it ranks them correctly, which is all it is asked to do.
          */}
          {typeof distance === 'number' && (
            <span className="flex items-center gap-1.5">
              <MapPin size={14} className="text-ink-400" aria-hidden />
              {formatDistance(distance)}
            </span>
          )}

          <span className="flex items-center gap-1.5">
            <Truck size={14} className="text-ink-400" aria-hidden />
            {restaurant.deliveryFee === 0 ? (
              <span className="font-medium text-success">{t('home.freeDelivery')}</span>
            ) : (
              <Money amount={restaurant.deliveryFee} />
            )}
          </span>

          {restaurant.minOrderAmount > 0 && (
            <span className="flex items-center gap-1.5">
              <Wallet size={14} className="text-ink-400" aria-hidden />
              {t('home.minOrder')} <Money amount={restaurant.minOrderAmount} />
            </span>
          )}
        </div>

        {restaurant.freeDeliveryThreshold !== null && restaurant.deliveryFee > 0 && (
          <p className="mt-2 text-sm text-success">
            {t('home.freeOver', {
              amount: (restaurant.freeDeliveryThreshold / 100).toFixed(2),
            })}
          </p>
        )}
      </div>
    </Link>
  );
}

/**
 * The shape of a card, before its data arrives.
 *
 * A skeleton rather than a spinner because the grid then does not jump: the
 * page is already the right height when the real cards replace these.
 */
export function RestaurantCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-card-edge bg-white shadow-sm">
      <div className="aspect-[16/10] w-full animate-pulse bg-ink-100" />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="h-4 w-1/2 animate-pulse rounded bg-ink-100" />
          <span className="h-6 w-12 animate-pulse rounded-lg bg-ink-100" />
        </div>
        <span className="block h-3 w-2/3 animate-pulse rounded bg-ink-100" />
        <div className="flex gap-3 border-t border-card-edge pt-3">
          <span className="h-3 w-16 animate-pulse rounded bg-ink-100" />
          <span className="h-3 w-16 animate-pulse rounded bg-ink-100" />
          <span className="h-3 w-16 animate-pulse rounded bg-ink-100" />
        </div>
      </div>
    </div>
  );
}

/** A full grid of skeletons, so every screen loads the list the same way. */
export function RestaurantGridSkeleton({ count = 6, label }: { count?: number; label: string }) {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <RestaurantCardSkeleton key={index} />
      ))}
    </div>
  );
}
