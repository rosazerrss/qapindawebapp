'use client';

/**
 * Search across restaurants and dishes.
 *
 * Two searches at once, because they answer different questions. Filtering the
 * already-loaded list answers "which restaurant is called this" on every
 * keystroke, with no network in the way. The dishes live in nobody's browser —
 * only a callable may read across every menu — so a debounced `searchMenu` runs
 * alongside it and adds the restaurants that sell what was typed. The two
 * results are merged, never swapped: a slow or failed menu lookup must not take
 * the fast answer off the screen.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Clock, Search, X } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { RestaurantCard, RestaurantGridSkeleton } from '@/components/customer/RestaurantCard';
import { CategoryRail } from '@/components/customer/CategoryRail';
import { Alert, Button, EmptyState, cn } from '@/components/ui';
import { InlineLoading } from '@/components/ui/loading';
import { watchPublicSettings } from '@/services/settings';
import { useRegion } from '@/contexts/RegionContext';
import { useCustomerPoint } from '@/hooks/useCustomerPoint';
import { compareByProximity, restaurantDistanceMetres } from '@/shared/nearby';
import { regionName } from '@/shared/regions';
import { useT } from '@/i18n';
import { isOpenNow, watchRestaurants } from '@/services/catalog';
import { recordSearchHit, searchMenu } from '@/firebase/callables';
import { restaurantCategories, type FoodCategoryId } from '@/shared/categories';
import { looselyMatches } from '@/shared/search';
import {
  forgetAllSearches,
  forgetSearch,
  recentSearchesServerSnapshot,
  recentSearchesSnapshot,
  rememberSearch,
  subscribeToRecentSearches,
} from '@/lib/recentSearches';
import { popularSearches } from '@/services/popularSearches';
import { RestaurantBadge, badgeFor } from '@/shared/badges';
import type { PublicSettings, Restaurant } from '@/shared/models';

/**
 * How long the list waits for the live subscription before giving up.
 *
 * `watchRestaurants` reports an empty list on error, so a failed query always
 * ends the loading state. Silence is what it cannot report: a device that is
 * offline, or a listener still negotiating, reaches neither callback, and the
 * screen would sit on skeletons under "Yüklənir…" for ever. Eight seconds is
 * well past a normal cold start on a mobile connection, so anything slower is
 * better answered with a retry than with more waiting. A subscription that does
 * answer later still wins — its callback overwrites what the timeout put up.
 */
const LOAD_TIMEOUT_MS = 8000;

export default function SearchPage() {
  const t = useT();
  /*
   * THE CITY, WHICH THIS SCREEN USED TO IGNORE.
   *
   * The home page has always filtered on the chosen region; the search screen
   * loaded the whole catalogue and said so in a comment — "this screen searches
   * the whole catalogue". That was a decision made when there was one city, and
   * it stopped being right the moment there were two: a customer in Gəncə
   * typing "dönər" was shown Baku restaurants that cannot deliver to them, in a
   * list they had no way to read as "not for you".
   *
   * The picker at the top of the app is the customer's own answer to where they
   * are. Search now obeys it, exactly as the shopfront does.
   */
  const { regionId, region } = useRegion();
  /**
   * "Bütün şəhərlərə bax", on this screen too.
   *
   * Scoping search to the chosen city was the right fix — a customer in Gəncə
   * should not be offered Baku — but on its own it created a dead end the home
   * page does not have: a city with no restaurants answered every search with
   * nothing and offered no way forward. The shopfront has always had this
   * escape hatch; search now has the same one, and shows the city on every card
   * while it is open so nobody has to guess where a result is.
   */
  const [allRegions, setAllRegions] = useState(false);
  /**
   * Where to measure from — the customer's own pinned address, or null.
   *
   * Null is the ordinary case on a first visit and nothing below depends on it:
   * with no point every distance is null, the near-first step drops out of the
   * comparator on its own, and the order is what it has always been.
   */
  const customerPoint = useCustomerPoint();
  const [term, setTerm] = useState('');
  // Which categories this platform shows, and in what order — an admin's
  // answer, live, so hiding one takes effect without a deploy.
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  // The same closed list the home page files restaurants under, rather than the
  // free-text cuisines this row used to show: two screens that mean different
  // things by "Dönər" is how a customer stops trusting either of them. The
  // typed word still matches the cuisine text, so nothing became unfindable.
  const [category, setCategory] = useState<FoodCategoryId | null>(null);
  const [attempt, setAttempt] = useState(0);

  /*
   * WHAT THIS SCREEN SHOWS BEFORE ANYBODY HAS SEARCHED.
   *
   * It used to open on the whole catalogue: every restaurant on the platform,
   * in a grid, under an empty search box. That is the home page with a text
   * field bolted on — the person who tapped "Axtar" did so precisely because
   * the list of everything was not helping them.
   *
   * So the idle screen is now made of the four things that actually shorten a
   * search: what they looked for last, what the platform sells, what other
   * people find, and the shops that paid to be seen. The catalogue appears the
   * moment a word or a category narrows it, and not before.
   */
  /*
   * The history, read through React's own API for an external store.
   *
   * Not `useState` plus an effect: `localStorage` is not React state, and an
   * effect that reads it on mount and calls `setState` is a cascading render —
   * the exact pattern the project's lint rule refuses, and refuses correctly.
   * `useSyncExternalStore` also does the server half properly, returning an
   * empty history during SSR so hydration matches.
   */
  const recent = useSyncExternalStore(
    subscribeToRecentSearches,
    recentSearchesSnapshot,
    recentSearchesServerSnapshot,
  );
  const [popular, setPopular] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void popularSearches().then((list) => {
      if (live) setPopular(list);
    });
    return () => {
      live = false;
    };
  }, []);

  // The result carries the attempt it belongs to, so "try again" returns to
  // skeletons by derivation instead of an effect resetting state after render.
  const [loaded, setLoaded] = useState<{
    attempt: number;
    list: Restaurant[];
    failed: boolean;
  } | null>(null);

  useEffect(() => watchPublicSettings(setSettings), []);

  useEffect(() => {
    let answered = false;

    const stop = watchRestaurants(allRegions ? undefined : regionId, (list) => {
      answered = true;
      setLoaded({ attempt, list, failed: false });
    });

    const timer = setTimeout(() => {
      if (answered) return;
      setLoaded({ attempt, list: [], failed: true });
    }, LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [attempt, regionId, allRegions]);

  const fresh = loaded?.attempt === attempt ? loaded : null;
  const restaurants = fresh?.list ?? null;
  const loadFailed = fresh?.failed ?? false;

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // The dish search is scoped to the same city; without this the two halves
  // of one result list would disagree about where the customer is.
  const { matches, searching } = useMenuSearch(term, allRegions ? undefined : regionId);

  /*
   * Has the person narrowed anything yet?
   *
   * A typed word OR a chosen category. Either one makes the catalogue useful;
   * neither means the grid would be the whole platform, which is the home page.
   */
  const narrowed = term.trim().length > 0 || category !== null;

  /**
   * Runs a term as if it had been typed.
   *
   * Used by the recent list and the popular chips. It remembers the term at the
   * same moment, because tapping a suggestion is a search — a history that only
   * records typing would push a term off the list the more it is reused.
   */
  const runSearch = useCallback((next: string) => {
    setCategory(null);
    setTerm(next);
    rememberSearch(next);
    // The box is above the results; on a phone the results are what matters now.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /**
   * The customer opened a result. THIS is what a successful search looks like.
   *
   * Both halves happen here rather than on the keystroke: the local history so
   * the term is offered back, and the platform counter so it can become a chip
   * for everybody. A term typed and abandoned records nothing, which is the
   * whole point — see `functions/src/menu/popular.ts`.
   */
  const openedResult = useCallback(() => {
    const typed = term.trim();
    if (typed.length < 2) return;

    rememberSearch(typed);
    // Nothing waits for this and nothing reports it. The customer is on their
    // way into a restaurant.
    void recordSearchHit(typed);
  }, [term]);

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

  /**
   * The restaurants that paid to be on this screen.
   *
   * Read through `badgeFor`, the same function the card itself asks, so the row
   * and the card can never disagree about whether a promotion is live — and so
   * an expired one drops out of the row on render, without waiting for the
   * sweep that clears the flag.
   *
   * Six at most: a row long enough to scroll through twice stops being a
   * shortcut and becomes the page.
   */
  const sponsored = useMemo(
    () =>
      (restaurants ?? [])
        .filter((restaurant) => badgeFor(restaurant) === RestaurantBadge.SPONSORED)
        .slice(0, 6),
    [restaurants],
  );

  const results = useMemo(() => {
    if (!restaurants) return null;
    const needle = term.trim();

    const matchesCategory = (restaurant: Restaurant) =>
      !category || restaurantCategories(restaurant).includes(category);

    const local = restaurants.filter((restaurant) => {
      if (!matchesCategory(restaurant)) return false;
      if (!needle) return true;
      // Folded on both sides and word by word, so "doner kebab" matches a name
      // containing both and "doner" matches "Dönərçi".
      return (
        looselyMatches(restaurant.name, needle) ||
        looselyMatches(restaurant.tagline, needle) ||
        (restaurant.cuisines ?? []).some((entry) => looselyMatches(entry, needle))
      );
    });

    // The name matches keep the front of the list — someone who typed a
    // restaurant name meant that restaurant. The dish matches follow, still
    // subject to the category tile but not to the typed word, since their claim
    // to be here is the dish rather than the name.
    const seen = new Set(local.map((entry) => entry.id));
    const fromMenus = matches.restaurants.filter(
      (restaurant) => !seen.has(restaurant.id) && matchesCategory(restaurant),
    );

    /*
     * Open first, then nearest, then rating — the same rule the shopfront uses,
     * from the one comparator both screens import.
     *
     * With no pinned address `restaurantDistanceMetres` answers null for every
     * restaurant, the distance step drops out on its own, and the order is what
     * it has always been: open first, best rated next. Nothing about a guest's
     * search changes.
     */
    const rank = (restaurant: Restaurant) => ({
      distance: restaurantDistanceMetres(restaurant, customerPoint),
      open: isOpenNow(restaurant),
      rating: restaurant.ratingAverage,
      ratingCount: restaurant.ratingCount,
    });

    return [...local, ...fromMenus].sort((a, b) => compareByProximity(rank(a), rank(b)));
  }, [restaurants, term, category, matches, customerPoint]);

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t('nav.search')}</h1>
        <p className="mt-1 text-sm text-ink-400">{t('search.customerHint')}</p>
      </header>

      <div className="relative">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400"
        />
        <input
          id="catalogue-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('home.searchPlaceholder')}
          aria-label={t('common.search')}
          autoFocus
          className="w-full rounded-2xl border border-ink-200 bg-white py-3.5 pl-11 pr-11 text-[15px] text-ink-900 shadow-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
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

      <div className="mt-5">
        <h2 className="text-[15px] font-semibold text-ink-900">{t('search.cuisines')}</h2>
        <div className="mt-2">
          <CategoryRail
            selected={category}
            counts={counts}
            onSelect={setCategory}
            loading={restaurants === null && !loadFailed}
            chosen={settings?.homeCategories}
          />
        </div>
      </div>

      {/* ---- The idle screen ------------------------------------------- */}
      {!narrowed && (
        <>
          {recent.length > 0 && (
            <section className="mt-7">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-ink-900">{t('search.recent')}</h2>
                <button
                  type="button"
                  onClick={() => forgetAllSearches()}
                  className="rounded px-1 text-sm text-ink-400 underline transition hover:text-ink-700"
                >
                  {t('search.clearRecent')}
                </button>
              </div>

              <ul className="mt-1 divide-y divide-row-edge">
                {recent.map((entry) => (
                  <li key={entry} className="flex items-center">
                    {/*
                      The row runs the search; the × removes it. Two controls,
                      not one row with a mode — a single tap target that both
                      searches and deletes depending on where the thumb lands is
                      how somebody loses a term they meant to reuse.
                    */}
                    <button
                      type="button"
                      onClick={() => runSearch(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                    >
                      <Clock size={16} aria-hidden className="shrink-0 text-ink-300" />
                      <span className="truncate text-[15px] text-ink-800">{entry}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => forgetSearch(entry)}
                      aria-label={t('search.forgetOne', { term: entry })}
                      className="shrink-0 rounded-lg p-2 text-ink-300 transition hover:bg-ink-50 hover:text-ink-700"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
            The paid slots, in their own row, under their own heading.

            Labelled "Reklam" above the row AND on every card, because a row of
            restaurants under a platform's own heading reads as the platform's
            recommendation unless it says otherwise. Absent entirely when
            nobody has bought one — an empty "Reklam" heading would be an
            advertisement for advertising.
          */}
          {sponsored.length > 0 && (
            <section className="mt-7">
              <h2 className="text-[15px] font-semibold text-ink-900">
                {t('search.sponsoredTitle')}
              </h2>
              <p className="mt-0.5 text-xs text-ink-400">{t('badge.SPONSORED')}</p>

              <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
                {sponsored.map((restaurant) => (
                  <div key={restaurant.id} className="w-44 shrink-0 snap-start sm:w-52">
                    <RestaurantCard
                      restaurant={restaurant}
                      distance={restaurantDistanceMetres(restaurant, customerPoint)}
                      regionLabel={allRegions ? regionName(restaurant.regionId) : null}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-7 pb-6">
            <h2 className="text-[15px] font-semibold text-ink-900">{t('search.popular')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(popular ?? []).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => runSearch(entry)}
                  className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-800 transition hover:border-brand-300 hover:text-brand-700"
                >
                  {entry}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ---- The results ------------------------------------------------ */}
      {narrowed && results !== null && results.length > 0 && (
        <p className="mt-6 text-sm text-ink-400" role="status">
          {t('search.resultCount', { count: results.length })}
        </p>
      )}

      {/* Why these results are from somewhere else — said above them. */}
      {allRegions && narrowed && (
        <div className="mt-4">
          <Alert tone="info">{t('home.allRegionsNotice', { region: region.name })}</Alert>
        </div>
      )}

      <div className={cn('mt-3 pb-6', !narrowed && 'hidden')}>
        {results === null ? (
          <RestaurantGridSkeleton label={t('common.loading')} count={3} />
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
        ) : results.length === 0 ? (
          <EmptyState
            title={t('home.noResults')}
            hint={t('home.noResultsHint')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {/* The same offer the shopfront makes when a city is empty. */}
                {!allRegions && (
                  <Button size="sm" variant="secondary" onClick={() => setAllRegions(true)}>
                    {t('home.showAllRegions')}
                  </Button>
                )}
                {(term || category) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setTerm('');
                      setCategory(null);
                    }}
                  >
                    {t('filters.clear')}
                  </Button>
                )}
                <Link href="/">
                  <Button size="sm">{t('home.allRestaurants')}</Button>
                </Link>
              </div>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((restaurant) => (
              <div
                key={restaurant.id}
                className="flex flex-col"
                // A click anywhere in the card is the customer leaving for a
                // restaurant they found by searching — which is the one signal
                // worth counting. Capture, so it fires before the navigation.
                onClickCapture={openedResult}
              >
                <RestaurantCard
                  restaurant={restaurant}
                  distance={restaurantDistanceMetres(restaurant, customerPoint)}
                  regionLabel={allRegions ? regionName(restaurant.regionId) : null}
                />
                <MatchedDishes dishes={matches.byRestaurantId.get(restaurant.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Searching the menus
//
// Deliberately duplicated from the home page rather than shared: a route file
// may not export anything but the page, and the two screens are the only
// callers. If a third appears, this moves into a hook of its own.
// ---------------------------------------------------------------------------

/** The dishes that matched, keyed by the restaurant that sells them. */
interface MenuMatches {
  byRestaurantId: Map<string, string[]>;
  restaurants: Restaurant[];
}

const NO_MATCHES: MenuMatches = { byRestaurantId: new Map(), restaurants: [] };

/** The server rejects anything longer; trimming here avoids a pointless call. */
const MAX_TERM_LENGTH = 40;

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
