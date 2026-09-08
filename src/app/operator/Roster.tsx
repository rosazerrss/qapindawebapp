'use client';

/**
 * Every restaurant on the platform, read-only.
 *
 * An operator needs this for one question and one question only: is this shop
 * open, suspended or still waiting for approval, and what number do I ring? So
 * that is what the list carries. Approving, suspending and commission are the
 * owner's decisions and live in the admin panel — an operator holds none of
 * those permissions, and the server would refuse the call even if a button
 * existed here.
 *
 * The query is unfiltered on purpose and the security rules allow it: a
 * platform account passes `ownsRestaurant` for every restaurant, which is what
 * makes listing the pending ones possible at all.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Phone, Star } from 'lucide-react';

import {
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Tabs,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { restaurantTone, when } from '@/components/panel/status';
import { Card } from '@/components/ui';
import { useT } from '@/i18n';
import { matches, num, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { RestaurantStatus, ServiceState } from '@/shared/enums';
import { regionName } from '@/shared/regions';
import type { Restaurant } from '@/shared/models';
import { formatPhone } from '@/shared/phone';

/** How many restaurants one operator screen holds open at a time. */
const ROSTER_LIMIT = 200;

type Tab = 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED' | 'ALL';

export function Roster() {
  const t = useT();

  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<Restaurant | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    /*
     * BOUNDED, AND THAT BOUND IS THE POINT.
     *
     * This subscription had no limit: every operator with the tab open re-read
     * the entire `restaurants` collection on every write anywhere in it. With
     * sixty restaurants that is invisible; with six hundred and four operators
     * on shift it is the single most expensive line in the front end, and it
     * grows with the platform rather than with the work being done.
     *
     * Two hundred is far more than a desk can usefully scan, and the search box
     * is how anybody actually finds a restaurant. Ordered newest first, so the
     * applications waiting on somebody — which is what this screen is for — are
     * never the ones cut off.
     */
    return onSnapshot(
      query(
        collection(db, COLLECTIONS.restaurants),
        orderBy('createdAt', 'desc'),
        limit(ROSTER_LIMIT),
      ),
      (snapshot) => {
        setRestaurants(snapshot.docs.map((entry) => entry.data() as Restaurant));
        setLoadError(null);
      },
      () => {
        setRestaurants([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [t]);

  const counts = useMemo(() => {
    const list = restaurants ?? [];
    return {
      ACTIVE: list.filter((entry) => entry.status === RestaurantStatus.ACTIVE).length,
      PENDING_APPROVAL: list.filter(
        (entry) => entry.status === RestaurantStatus.PENDING_APPROVAL,
      ).length,
      SUSPENDED: list.filter((entry) => entry.status === RestaurantStatus.SUSPENDED).length,
    } as Partial<Record<Tab, number>>;
  }, [restaurants]);

  const rows = useMemo(() => {
    if (!restaurants) return null;
    const needle = term.trim().toLowerCase();

    return restaurants
      .filter((restaurant) => tab === 'ALL' || restaurant.status === tab)
      .filter((restaurant) =>
        matches(
          needle,
          restaurant.name,
          restaurant.addressLine,
          restaurant.publicPhone,
          restaurant.id,
        ),
      );
  }, [restaurants, tab, term]);

  const columns: Column<Restaurant>[] = [
    {
      key: 'name',
      header: t('admin.restaurant'),
      cell: (restaurant) => (
        <span className="block">
          <span className="block font-medium text-ink-900">{restaurant.name}</span>
          <span className="block text-xs text-ink-400">
            {regionName(restaurant.regionId ?? '') || restaurant.city}
            {restaurant.district ? ` · ${restaurant.district}` : ''}
          </span>
        </span>
      ),
      sortValue: (restaurant) => text(restaurant.name),
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (restaurant) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={restaurantTone(restaurant.status)}>
            {t(`status.${restaurant.status}`)}
          </StatusBadge>
          {/* An active restaurant that has paused itself is the single most
              common answer to "why is nobody taking my order", so it is on the
              row rather than one click away. */}
          {restaurant.status === RestaurantStatus.ACTIVE &&
            restaurant.serviceState !== ServiceState.OPEN && (
              <span className="text-xs text-ink-400">
                {t(
                  restaurant.serviceState === ServiceState.PAUSED
                    ? 'restaurantPanel.paused'
                    : 'restaurantPanel.closed',
                )}
              </span>
            )}
        </span>
      ),
      sortValue: (restaurant) => restaurant.status,
    },
    {
      key: 'phone',
      header: t('auth.phone'),
      cell: (restaurant) => (
        <span className="text-ink-700">{formatPhone(restaurant.publicPhone)}</span>
      ),
    },
    {
      key: 'rating',
      header: t('filters.rating'),
      align: 'right',
      cell: (restaurant) =>
        num(restaurant.ratingCount) > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Star size={13} className="text-warning" />
            {num(restaurant.ratingAverage).toFixed(1)}
            <span className="text-xs text-ink-400">({num(restaurant.ratingCount)})</span>
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
      sortValue: (restaurant) =>
        num(restaurant.ratingCount) > 0 ? num(restaurant.ratingAverage) : -1,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('operator.tabRestaurants')}
        subtitle={t('operator.restaurantsSubtitle')}
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'ACTIVE', label: t('status.ACTIVE') },
          { value: 'PENDING_APPROVAL', label: t('status.PENDING_APPROVAL') },
          { value: 'SUSPENDED', label: t('status.SUSPENDED') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('search.hintRestaurants')} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(restaurant) => restaurant.id}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noRestaurants')}
      />

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ''}
        subtitle={detail?.tagline || undefined}
      >
        {detail && (
          <div className="space-y-4">
            <StatusBadge tone={restaurantTone(detail.status)}>
              {t(`status.${detail.status}`)}
            </StatusBadge>

            <a
              href={`tel:${detail.publicPhone}`}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-600 text-base font-semibold text-white transition hover:bg-brand-700"
            >
              <Phone size={18} aria-hidden />
              {t('operator.callRestaurant')} · {formatPhone(detail.publicPhone)}
            </a>

            <Card className="px-4 py-2">
              <Field label={t('admin.restaurantId')}>
                <span className="font-mono text-xs">{detail.id}</span>
              </Field>
              <Field label={t('account.city')}>
                {regionName(detail.regionId ?? '') || detail.city}
              </Field>
              {detail.district && <Field label={t('account.district')}>{detail.district}</Field>}
              <Field label={t('account.addressLine')}>{text(detail.addressLine) || '—'}</Field>
            </Card>

            <Card className="px-4 py-2">
              <Field label={t('operator.serviceState')}>
                {t(
                  detail.serviceState === ServiceState.OPEN
                    ? 'restaurantPanel.open'
                    : detail.serviceState === ServiceState.PAUSED
                      ? 'restaurantPanel.paused'
                      : 'restaurantPanel.closed',
                )}
              </Field>
              <Field label={t('sales.orderCount')}>{num(detail.completedOrderCount)}</Field>
              <Field label={t('filters.rating')}>
                {num(detail.ratingCount) > 0
                  ? `${num(detail.ratingAverage).toFixed(1)} (${num(detail.ratingCount)})`
                  : '—'}
              </Field>
              <Field label={t('admin.createdAt')}>{when(detail.createdAt)}</Field>
            </Card>

            <p className="text-xs text-ink-400">{t('operator.rosterReadOnly')}</p>
          </div>
        )}
      </Drawer>
    </>
  );
}
