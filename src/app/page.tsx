'use client';

/**
 * The shopfront.
 *
 * The top of the page carries the three things a customer decides before
 * anything else: *where* they are, *what* they feel like, and *who* is open.
 * It sits on the plain canvas rather than on a coloured slab — the brand red is
 * loud enough in the partner bar and on the buttons that it does not need to
 * shout here too, and a calm top lets the photographs of the food carry the
 * appetite.
 *
 * Below the category rail the page is not one long grid. A grid of forty cards
 * asks the customer to compare forty things; sections ask them to answer a
 * question they already have — "what did I order last time", "who is open",
 * "what is new here". The whole list is still at the bottom, with the sort and
 * the switches, for the person who wants to look at everything.
 *
 * The moment anything is narrowed — a category, a typed word, a filter — the
 * sections collapse into that one list, because a customer who has asked for
 * kebab is no longer browsing.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Sparkles, Truck, X } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import {
  RestaurantCard,
  RestaurantCardSkeleton,
  RestaurantGridSkeleton,
} from '@/components/customer/RestaurantCard';
import { CategoryRail, CategoryRailSkeleton } from '@/components/customer/CategoryRail';
import { RegionButton } from '@/components/customer/RegionPicker';
import { LocationPrompt } from '@/components/customer/LocationPrompt';
import { MaintenanceNotice } from '@/components/customer/MaintenanceNotice';
import { ActiveOrderBar } from '@/components/customer/ActiveOrderBar';
import {
  EMPTY_FILTERS,
  RestaurantFilters,
  applyFilters,
  filtersActive,
  type FilterState,
} from '@/components/customer/RestaurantFilters';
import { Alert, Button, EmptyState } from '@/components/ui';
import { InlineLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useRegion } from '@/contexts/RegionContext';
import { useCustomerPoint } from '@/hooks/useCustomerPoint';
import { restaurantDistanceMetres } from '@/shared/nearby';
import type { GeoPoint } from '@/shared/geo';
import { regionName } from '@/shared/regions';
import { watchPublicSettings } from '@/services/settings';
import { useT } from '@/i18n';
import { isOpenNow, watchMyOrders, watchRestaurants } from '@/services/catalog';
import { searchMenu } from '@/firebase/callables';
import { isFirebaseConfigured } from '@/firebase/client';
import { isFoodCategoryId, restaurantCategories, type FoodCategoryId } from '@/shared/categories';
import type { PublicSettings, Order, Restaurant } from '@/shared/models';

/**
 * How long the grid waits for the live subscription before giving up.
 *
 * `watchRestaurants` reports an empty list on error, so a failed query always
 * ends the loading state. What it cannot report is silence: a device that is
 * offline, or a listener still negotiating, never reaches either callback, and
 * the screen would sit on skeletons under "Yüklənir…" for ever. Eight seconds
 * is well past a normal cold start on a mobile connection, so anything slower
 * is better answered with a retry than with more waiting. A subscription that
 * does eventually answer still wins — its callback simply overwrites whatever
 * the timeout put on screen.
 */
const LOAD_TIMEOUT_MS = 8000;

/** The query parameter the chosen category is shared and restored through. */
const CATEGORY_PARAM = 'kateqoriya';

/**
 * Below this many restaurants the sections are dropped for the plain list.
 *
 * Three rails of four cards over a grid of five is a page pretending to have
 * more in it than it has, and every card appears three times. A small city gets
 * the honest answer: here is everything we have.
 */
const MIN_FOR_SECTIONS = 6;

/** A rail needs enough cards to be worth scrolling; below this it is a list. */
const MIN_PER_SECTION = 3;

/** How many cards one rail carries before "see all" is the better answer. */
const SECTION_SIZE = 10;

export default function HomePage() {
  const t = useT();

  return (
    <AppShell bare>
      {/* `useSearchParams` suspends on the first render of a static page, so the
          shopfront declares what that moment looks like rather than letting the
          route fall back to a blank screen. */}
      <Suspense fallback={<ShopfrontFallback label={t('common.loading')} />}>
        <Shopfront />
      </Suspense>

      {/* Floats above the page and the bottom bar; renders nothing when there
          is no order on the way, which is most of the time. */}
      <ActiveOrderBar />
    </AppShell>
  );
}

function Shopfront() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { regionId, region } = useRegion();
  // Where to measure from. Null for a guest and for anybody with no pinned
  // address — in which case nothing below changes and the list is what it was.
  const customerPoint = useCustomerPoint();
  const { firebaseUser, loading: authLoading } = useAuth();

  const [term, setTerm] = useState('');
  // Which categories this platform shows, and in what order — an admin's
  // answer, live, so hiding one takes effect without a deploy.
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  // Bumped by "try again": a counter is the smallest thing that re-runs the
  // effect without duplicating the subscription logic outside it.
  const [attempt, setAttempt] = useState(0);

  // The chosen category lives in the URL and nowhere else. That is what makes a
  // link to "kebab in Gəncə" a link somebody can send, and what makes the back
  // button undo the tap instead of leaving the page.
  const categoryParam = searchParams.get(CATEGORY_PARAM);
  const category: FoodCategoryId | null = isFoodCategoryId(categoryParam) ? categoryParam : null;

  const selectCategory = useCallback(
    (next: FoodCategoryId | null) => {
      // Pushed, not replaced: the tap is a place the customer can come back to.
      router.push(next ? `/?${CATEGORY_PARAM}=${next}` : '/', { scroll: false });
    },
    [router],
  );

  // What arrived carries the question it answers — this region, this attempt.
  // Switching city therefore shows skeletons again by comparison, rather than
  // by an effect clearing state after the render that already used it.
  // Widening to every city is a deliberate act, taken from the empty state when
  // the chosen city has nothing in it yet — which, early on, is most of them.
  const [allRegions, setAllRegions] = useState(false);
  const scope = allRegions ? 'all' : regionId;
  const loadKey = `${scope}:${attempt}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    list: Restaurant[];
    failed: boolean;
  } | null>(() => (isFirebaseConfigured ? null : { key: 'unconfigured', list: [], failed: false }));

  useEffect(() => watchPublicSettings(setSettings), []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    let answered = false;

    const stop = watchRestaurants(allRegions ? undefined : regionId, (list) => {
      answered = true;
      setLoaded({ key: loadKey, list, failed: false });
    });

    const timer = setTimeout(() => {
      if (answered) return;
      setLoaded({ key: loadKey, list: [], failed: true });
    }, LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [regionId, allRegions, loadKey]);

  const fresh = loaded?.key === loadKey || loaded?.key === 'unconfigured' ? loaded : null;
  const restaurants = fresh?.list ?? null;
  const loadFailed = fresh?.failed ?? false;

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const { matches, searching } = useMenuSearch(term, regionId);
  const reordered = useRecentRestaurantIds(firebaseUser?.uid);

  const cuisines = useMemo(
    () => [...new Set((restaurants ?? []).flatMap((entry) => entry.cuisines ?? []))].slice(0, 14),
    [restaurants],
  );

  // Counted before the category filter is applied, so the rail says how many
  // restaurants each tile would show rather than how many are left after it.
  const counts = useMemo(() => {
    if (!restaurants) return null;

    const tally = new Map<FoodCategoryId, number>();
    for (const restaurant of restaurants) {
      for (const id of restaurantCategories(restaurant)) {
        tally.set(id, (tally.get(id) ?? 0) + 1);
      }
    }
    return tally;
  }, [restaurants]);

  const shown = useMemo(() => {
    if (!restaurants) return null;

    const inCategory = category
      ? restaurants.filter((entry) => restaurantCategories(entry).includes(category))
      : restaurants;

    // The dish matches are put through the category too: somebody looking at
    // "pizza" who typed "toyuq" wants the chicken *at a pizza place*.
    const extra = category
      ? matches.restaurants.filter((entry) => restaurantCategories(entry).includes(category))
      : matches.restaurants;

    return mergeMenuMatches(applyFilters(inCategory, filters, term, customerPoint), extra, filters);
  }, [restaurants, category, term, filters, matches, customerPoint]);

  const openCount = (shown ?? []).filter((entry) => isOpenNow(entry)).length;
  const searched = term.trim().length > 0 || filtersActive(filters);
  const narrowed = searched || category !== null;

  const sections = useHomeSections(shown, reordered);
  const sectioned = !narrowed && sections.length > 0;

  return (
    <>
      {/* --- Where you are, and what you feel like --------------------- */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-5 sm:pt-10">
        {/* Above everything, including the city chip: somebody who cannot
            order tonight should read that before they pick a restaurant, not
            after they have filled a basket. */}
        <MaintenanceNotice className="mb-5" />

        <RegionButton className="border border-ink-200 bg-white text-ink-700 shadow-sm hover:bg-ink-50" />

        <h1 className="mt-5 text-[28px] font-semibold leading-tight tracking-tight text-ink-900 sm:mt-8 sm:text-[2.5rem] sm:leading-[1.1]">
          {t('home.greeting')}
        </h1>
        {/* A guest is told the door is open, not that they are missing out. The
            greeting waits for the answer rather than flickering from one line
            to the other a moment after the page paints. */}
        <p className="mt-2 text-[15px] text-ink-500">
          {authLoading || firebaseUser
            ? t('home.inRegion', { region: region.name })
            : t('home.guestLead', { region: region.name })}
        </p>

        <div className="relative mt-6 max-w-2xl">
          <Search
            size={19}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <input
            id="home-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('common.search')}
            className="w-full rounded-2xl border border-ink-200 bg-white py-4 pl-12 pr-12 text-[15px] text-ink-900 shadow-sm transition placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label={t('home.clearSearch')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <X size={17} />
            </button>
          )}
        </div>

        <MenuSearchNotice active={searching} label={t('home.searchingMenus')} />

        {/* Asked once, before the grid, and only until a city is chosen. */}
        <div className="mt-5">
          <LocationPrompt />
        </div>
      </section>

      {/* --- The categories ------------------------------------------- */}
      <section className="mx-auto mt-6 w-full max-w-5xl px-4">
        <h2 className="sr-only">{t('categories.title')}</h2>
        <CategoryRail
          selected={category}
          counts={counts}
          onSelect={selectCategory}
          loading={restaurants === null && !loadFailed}
          chosen={settings?.homeCategories}
        />
      </section>

      <div className="mx-auto w-full max-w-5xl px-4">
        {/* --- The list -----------------------------------------------
            The sort and the switches travel with the list they change rather
            than sitting under the category rail: three rows of pills stacked on
            top of each other is a control panel, and the customer came for the
            food. When the page is in sections they follow the rails, directly
            above the full grid — the only list they act on that is visible. */}
        <div className="mt-8">
          {shown === null ? (
            <>
              <SectionHeading title={t('common.loading')} />
              <RestaurantGridSkeleton label={t('common.loading')} />
            </>
          ) : loadFailed ? (
            <EmptyState
              title={t('home.loadFailed')}
              hint={t('home.loadFailedHint')}
              action={
                <Button size="sm" onClick={retry}>
                  {t('common.retry')}
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <>
              {searched && (
                <div className="mb-5">
                  <RestaurantFilters cuisines={cuisines} filters={filters} onChange={setFilters} />
                </div>
              )}
              <EmptyState
                title={
                  category && !searched
                    ? t('home.emptyCategory', { category: t(`categories.${category}`) })
                    : narrowed
                      ? t('home.noResults')
                      : allRegions
                        ? t('home.emptyEverywhere')
                        : t('home.emptyInRegion', { region: region.name })
                }
                hint={narrowed ? t('home.noResultsHint') : t('home.emptyHint')}
                action={
                  narrowed ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setTerm('');
                        setFilters(EMPTY_FILTERS);
                        selectCategory(null);
                      }}
                    >
                      {t('filters.clear')}
                    </Button>
                  ) : !allRegions ? (
                    // A new platform has few cities covered. Rather than leaving
                    // somebody staring at an empty grid, offer the whole country —
                    // seeing a restaurant one city over is more useful than seeing
                    // nothing, and the delivery radius still decides who can order.
                    <Button size="sm" variant="secondary" onClick={() => setAllRegions(true)}>
                      {t('home.showAllRegions')}
                    </Button>
                  ) : undefined
                }
              />
            </>
          ) : (
            <>
              {/*
                SAID BEFORE THE GRID, NOT AFTER THE BASKET.

                "Bütün şəhərlərə bax" is a fallback for an empty city, and it
                quietly changes what the list means: these restaurants are
                somewhere else, and most of them cannot deliver here. The city
                on each card answers "which one"; this answers "why am I seeing
                these at all", which a card cannot.

                Only while the fallback is on. In the ordinary case there is
                nothing to explain and nothing is drawn.
              */}
              {allRegions && (
                <div className="mb-5">
                  <Alert tone="info">
                    {t('home.allRegionsNotice', { region: region.name })}
                  </Alert>
                </div>
              )}

              {sectioned ? (
            <div className="space-y-10">
              {sections.map((section) => (
                <Rail
                  key={section.key}
                  title={t(`home.section.${section.key}`)}
                  hint={t(`home.section.${section.key}Hint`)}
                  restaurants={section.list}
                  from={customerPoint}
                  showRegion={allRegions}
                />
              ))}

              <section>
          <div className="mb-5">
            <RestaurantFilters cuisines={cuisines} filters={filters} onChange={setFilters} />
          </div>
                <SectionHeading
                  title={t('home.allRestaurants')}
                  meta={t('home.openCount', { open: openCount, total: shown.length })}
                />
                <Grid restaurants={shown} matches={matches} from={customerPoint} showRegion={allRegions} />
              </section>
            </div>
          ) : (
            <section>
          <div className="mb-5">
            <RestaurantFilters cuisines={cuisines} filters={filters} onChange={setFilters} />
          </div>
              <SectionHeading
                title={
                  category ? t(`categories.${category}`) : t('home.allRestaurants')
                }
                meta={t('home.openCount', { open: openCount, total: shown.length })}
                action={
                  category ? (
                    <button
                      type="button"
                      onClick={() => selectCategory(null)}
                      className="inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-sm text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
                    >
                      <X size={14} aria-hidden />
                      {t('categories.clear')}
                    </button>
                  ) : undefined
                }
              />
              <Grid restaurants={shown} matches={matches} from={customerPoint} showRegion={allRegions} />
            </section>
              )}
            </>
          )}
        </div>

        {/* --- What Qapında promises ----------------------------------
            Last, not first: this is reassurance for someone who has already
            found a restaurant, not an argument to read before the food. */}
        <div className="mt-12 border-t border-card-edge pt-6 pb-10">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {/* Two, not three. The middle one said "qapıda nağd və ya kartla"
                and the owner took it off the home screen: which payment
                methods a customer actually has is a per-restaurant answer,
                given on the checkout screen, and a promise made on the front
                page that a particular restaurant does not keep is worse than
                no promise. */}
            <PromiseItem icon={Truck} title={t('home.promiseDelivery')} />
            <PromiseItem icon={Sparkles} title={t('home.promiseNoFee')} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

type SectionKey = 'reorder' | 'open' | 'popular' | 'fresh' | 'freeDelivery';

interface Section {
  key: SectionKey;
  list: Restaurant[];
}

function millisOf(value: { toMillis?: () => number } | null | undefined): number {
  return typeof value?.toMillis === 'function' ? value.toMillis() : 0;
}

/**
 * Cuts the list into the questions people actually arrive with.
 *
 * Each section is a view of the same restaurants rather than a separate query —
 * one subscription already paid for answers all of them, and a section that
 * needed its own read would be a section that loads at a different moment and
 * makes the page jump.
 */
function useHomeSections(restaurants: Restaurant[] | null, recentIds: string[]): Section[] {
  return useMemo(() => {
    if (!restaurants || restaurants.length < MIN_FOR_SECTIONS) return [];

    const sections: Section[] = [];
    const add = (key: SectionKey, list: Restaurant[], minimum = MIN_PER_SECTION) => {
      if (list.length >= minimum) sections.push({ key, list: list.slice(0, SECTION_SIZE) });
    };

    // Ordered by how recently they were ordered from, not by rating: the point
    // of this row is "the usual", and the usual has its own order.
    const byId = new Map(restaurants.map((entry) => [entry.id, entry]));
    const again = recentIds
      .map((id) => byId.get(id))
      .filter((entry): entry is Restaurant => entry !== undefined);
    // One is already useful here — it is *your* restaurant, not a shortlist.
    add('reorder', again, 1);

    // Only worth its own row when something is *shut*: at two in the afternoon
    // every restaurant is open and the row would be the grid again, twice.
    const open = restaurants.filter((entry) => isOpenNow(entry));
    if (open.length < restaurants.length) add('open', open);

    add(
      'popular',
      [...restaurants]
        .filter((entry) => entry.ratingCount > 0 || entry.completedOrderCount > 0)
        .sort(
          (a, b) =>
            b.ratingAverage - a.ratingAverage ||
            b.completedOrderCount - a.completedOrderCount,
        ),
    );

    // "New" is defined by the absence of a history rather than by the clock:
    // a restaurant nobody has rated or ordered from yet is the one that needs
    // the introduction, and reading the wall clock inside a render is exactly
    // the impurity that makes a list disagree with itself between two paints.
    // It is the complement of `popular` above, so no card sits in both rows.
    add(
      'fresh',
      [...restaurants]
        .filter((entry) => entry.ratingCount === 0 && entry.completedOrderCount === 0)
        .sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt)),
    );

    // "Free delivery" means the fee is nil, not that it can become nil above a
    // threshold — a promise on the home page has to be true at the moment it is
    // read, and the threshold is spelled out on the card.
    add('freeDelivery', restaurants.filter((entry) => entry.deliveryFee === 0));

    return sections;
  }, [restaurants, recentIds]);
}

/**
 * The restaurants this account has ordered from, most recent first.
 *
 * Only ever ids: the orders are read for their `restaurantId` and nothing else,
 * and the cards are the same public documents the rest of the page shows.
 */
function useRecentRestaurantIds(uid: string | undefined): string[] {
  const [orders, setOrders] = useState<{ uid: string; list: Order[] } | null>(null);

  useEffect(() => {
    if (!uid) return;
    return watchMyOrders(uid, (list) => setOrders({ uid, list }));
  }, [uid]);

  const list = uid && orders?.uid === uid ? orders.list : null;

  return useMemo(() => {
    if (!list) return [];
    const seen: string[] = [];
    for (const order of list) {
      if (order.restaurantId && !seen.includes(order.restaurantId)) seen.push(order.restaurantId);
      if (seen.length === SECTION_SIZE) break;
    }
    return seen;
  }, [list]);
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

function SectionHeading({
  title,
  hint,
  meta,
  action,
}: {
  title: string;
  hint?: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-400">{hint}</p>}
      </div>
      {action ?? (meta ? (
        <p className="text-sm text-ink-400" role="status">
          {meta}
        </p>
      ) : null)}
    </div>
  );
}

/**
 * One section, as a rail.
 *
 * The cards keep their full width so the numbers on them stay comparable with
 * the grid below; the row simply runs off the edge of the screen, which is the
 * plainest possible invitation to push it sideways.
 */
function Rail({
  title,
  hint,
  restaurants,
  from,
  showRegion,
}: {
  title: string;
  hint: string;
  restaurants: Restaurant[];
  /**
   * Passed down rather than read here with the hook.
   *
   * `useCustomerPoint` opens a Firestore listener on the account's addresses.
   * Called inside every rail and the grid, one home page would hold four
   * listeners on the same three documents — the same answer, paid for four
   * times, and four chances for them to disagree mid-render.
   */
  from: GeoPoint | null;
  /** Set only while the whole country is on screen — see `showRegions`. */
  showRegion: boolean;
}) {
  return (
    <section>
      <SectionHeading title={title} hint={hint} />
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1">
        {restaurants.map((restaurant) => (
          <div key={restaurant.id} className="w-[270px] shrink-0 snap-start sm:w-[300px]">
            <RestaurantCard
              restaurant={restaurant}
              distance={restaurantDistanceMetres(restaurant, from)}
              regionLabel={showRegion ? regionName(restaurant.regionId) : null}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Grid({
  restaurants,
  matches,
  from,
  showRegion,
}: {
  restaurants: Restaurant[];
  matches: MenuMatches;
  from: GeoPoint | null;
  showRegion: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {restaurants.map((restaurant) => (
        <div key={restaurant.id} className="flex flex-col">
          <RestaurantCard
            restaurant={restaurant}
            distance={restaurantDistanceMetres(restaurant, from)}
            regionLabel={showRegion ? regionName(restaurant.regionId) : null}
          />
          <MatchedDishes dishes={matches.byRestaurantId.get(restaurant.id)} />
        </div>
      ))}
    </div>
  );
}

/**
 * The shape of the shopfront, before the router has resolved the URL.
 *
 * It is the page's own outline rather than a spinner, so the first thing that
 * appears is where things will be, and nothing moves when they arrive.
 */
function ShopfrontFallback({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:pt-10">
      <span className="block h-8 w-32 animate-pulse rounded-full bg-ink-100" aria-hidden />
      <span className="mt-5 block h-9 w-3/4 animate-pulse rounded-lg bg-ink-100" aria-hidden />
      <span className="mt-6 block h-14 w-full max-w-2xl animate-pulse rounded-2xl bg-ink-100" aria-hidden />
      <div className="mt-8">
        <CategoryRailSkeleton label={label} />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <RestaurantCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searching the menus
// ---------------------------------------------------------------------------

/** The dishes that matched, keyed by the restaurant that sells them. */
interface MenuMatches {
  byRestaurantId: Map<string, string[]>;
  restaurants: Restaurant[];
}

const NO_MATCHES: MenuMatches = { byRestaurantId: new Map(), restaurants: [] };

/** The server rejects anything longer; trimming here avoids a pointless call. */
const MAX_TERM_LENGTH = 40;

/**
 * Asks the server which menus contain the typed word.
 *
 * The client-side filter over the loaded list answers "which restaurant is
 * called this" instantly and on every keystroke. It cannot answer "who sells a
 * döner", because the dishes are not in the browser — only a callable may read
 * across every menu. So the two run side by side: the local filter keeps the
 * screen responsive while this one, debounced, adds the restaurants that only a
 * dish name could have found.
 */
function useMenuSearch(term: string, regionId?: string) {
  // The answer carries the question it belongs to. Everything the screen shows
  // is then derived from comparing the two, so clearing stale results never
  // needs a setState reaching back into a render that already happened.
  const [answer, setAnswer] = useState<{ needle: string; matches: MenuMatches } | null>(null);

  const needle = term.trim().slice(0, MAX_TERM_LENGTH);
  // A single letter matches most menus on the platform, so the round trip
  // would cost more than its answer is worth.
  const active = needle.length >= 2;

  const matches = active && answer?.needle === needle ? answer.matches : NO_MATCHES;
  const searching = active && answer?.needle !== needle;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    // Typing outruns the network: without this pause every keystroke would
    // queue a call whose answer is already stale by the time it lands.
    const timer = setTimeout(() => {
      searchMenu({ term: needle, regionId })
        .then((result) => {
          if (cancelled) return;

          // A failed menu search is not worth a message: the name and cuisine
          // matches are already on screen and still useful. Emptying the list
          // because a secondary lookup failed would be the worse answer — but
          // the question must still be marked answered, or the little
          // "searching" mark would spin for ever.
          if (!result.ok || !result.data) {
            setAnswer({ needle, matches: NO_MATCHES });
            return;
          }

          const byRestaurantId = new Map<string, string[]>();
          const restaurants: Restaurant[] = [];

          for (const entry of result.data.restaurants) {
            const restaurant = entry.restaurant as unknown as Restaurant;
            if (!restaurant?.id) continue;
            restaurants.push(restaurant);
            byRestaurantId.set(restaurant.id, entry.matchedProducts ?? []);
          }

          setAnswer({ needle, matches: { byRestaurantId, restaurants } });
        })
        .catch(() => {
          if (!cancelled) setAnswer({ needle, matches: NO_MATCHES });
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needle, active, regionId]);

  return { matches, searching };
}

/**
 * Appends the dish matches to the name matches, without duplicates.
 *
 * The local results keep the front of the list: someone who typed a restaurant
 * name meant that restaurant. The dish matches follow, put through the same
 * filters so "open now" and "free delivery" still mean what they say — but with
 * an empty search term, because their claim to be here is the dish, not the
 * name.
 */
function mergeMenuMatches(
  local: Restaurant[],
  extra: Restaurant[],
  filters: FilterState,
): Restaurant[] {
  if (extra.length === 0) return local;

  const seen = new Set(local.map((entry) => entry.id));
  const kept = applyFilters(extra, filters, '').filter((entry) => !seen.has(entry.id));

  return kept.length === 0 ? local : [...local, ...kept];
}

/** Why this restaurant is in the list when its name says nothing about döner. */
function MatchedDishes({ dishes }: { dishes?: string[] }) {
  const t = useT();
  if (!dishes || dishes.length === 0) return null;

  return (
    <p className="mt-2 px-1 text-sm text-ink-500">
      {t('home.matchedDishes', { dishes: dishes.join(', ') })}
    </p>
  );
}

/**
 * The menu search runs behind results that are already on screen, so it
 * announces itself in a line of its own rather than replacing them.
 */
function MenuSearchNotice({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;

  return <InlineLoading label={label} className="mt-3" />;
}

function PromiseItem({ icon: Icon, title }: { icon: typeof Truck; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon size={17} aria-hidden />
      </span>
      <span className="text-sm leading-snug text-ink-600">{title}</span>
    </div>
  );
}
