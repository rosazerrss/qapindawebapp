'use client';

/**
 * The restaurant roster: approving, suspending, and setting commission.
 *
 * Every action here demands a written reason and lands in the audit log. That
 * is not bureaucracy — it is what lets the platform answer "why was my
 * commission raised in March" six months later.
 *
 * Approval is the one exception: the approval *is* the record, and the rate
 * agreed at that moment is captured with it.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Check, Copy, Percent, Plus, Power, Star, Trash2, X } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  ConfirmDialog,
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
import { useToast } from '@/components/panel/Toast';
import { DeliveryMap, type MapPoint } from '@/components/restaurant/DeliveryMap';
import { RestaurantReport } from '@/components/admin/RestaurantReport';
import { Alert, Button, Card, Input, Loading, Select, Textarea } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import {
  approveRestaurant,
  createRestaurantByAdmin,
  rejectRestaurant,
  setCommissionRate,
  setRestaurantFeatured,
  setRestaurantStatus,
  removeRestaurant,
} from '@/firebase/callables';
import { list, matches, num, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS, paths } from '@/shared/collections';
import { RestaurantStatus, ServiceState } from '@/shared/enums';
import { formatBps, formatMinorUnits } from '@/shared/pricing';
import { DEFAULT_REGION_ID, districtsOf, orderedRegions, regionName } from '@/shared/regions';
import { inferFoodCategories, normaliseFoodCategories } from '@/shared/categories';
import type { Restaurant, RestaurantBusiness } from '@/shared/models';
import { formatPhone } from '@/shared/phone';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { cuisineLabel } from '@/shared/cuisines';

type Action =
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'activate'
  | 'commission'
  /** Puts a restaurant forward on the shopfront, or takes it back down. */
  | 'feature'
  | 'unfeature'
  /**
   * Removes the restaurant from the platform. Not reversible from any screen.
   *
   * Asks for the restaurant's own name to be typed, on top of the written
   * reason every action here takes — see `functions/src/restaurants/remove.ts`
   * for what "removed" actually does and for the two things that refuse it.
   */
  | 'remove';
type Tab = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | 'REMOVED' | 'ALL';

/**
 * The radius the server writes for an admin-created restaurant.
 *
 * It is not asked for here — the owner sets their real delivery area from their
 * own panel — but the map has to draw *some* circle, and drawing anything other
 * than what will actually be stored would be a lie.
 */
const ADMIN_CREATED_RADIUS_M = 5000;

const EMPTY_CREATE_FORM = {
  name: '',
  legalName: '',
  regionId: DEFAULT_REGION_ID,
  district: '',
  addressLine: '',
  ownerPhone: '',
  contactName: '',
  /** Percent as typed, converted to basis points on submit. Empty = platform default. */
  commission: '',
};

/**
 * The document id, shown wherever a restaurant is identified.
 *
 * Names repeat — a chain has one name across ten branches, and two unrelated
 * kebab shops can pick the same one — so the id is what tells an operator which
 * row they are actually acting on. It is also the tail of the public address
 * (`/restaurant/<slug>-<id>`), which makes it the fastest way to jump from a
 * customer's link to the right row here.
 */
function CopyableId({
  id,
  label,
  onCopied,
}: {
  id: string;
  label: string;
  onCopied: () => void;
}) {
  const copy = async () => {
    // Clipboard access is refused outside a secure context; the id stays
    // readable on screen, so a failure needs no message of its own.
    try {
      await navigator.clipboard.writeText(id);
      onCopied();
    } catch {
      /* ignored */
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        // The row itself opens the detail drawer; copying should not.
        event.stopPropagation();
        void copy();
      }}
      title={label}
      className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-ink-400 hover:text-brand-600"
    >
      <span className="truncate">{id}</span>
      <Copy size={11} className="shrink-0" />
    </button>
  );
}

/**
 * How many restaurants the admin list loads at once.
 *
 * See the note at the query: the previous value was "all of them".
 */
const RESTAURANT_PAGE_SIZE = 100;

export default function AdminRestaurantsRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminRestaurantsPage />
    </Suspense>
  );
}

function AdminRestaurantsPage() {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();

  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  /*
   * Each restaurant's commission rate, by restaurant id.
   *
   * The rate lives in `restaurants/{id}/private/business` and not on the public
   * restaurant document, which is why this screen used to say "the commission
   * rate lives in the restaurant's private record" and make somebody open a
   * drawer to see it. The owner asked for it in the open, so it is read here —
   * one document per restaurant, once, for the roster this admin is looking at.
   * `null` means the document could not be read; the column says "—" rather
   * than inventing a rate.
   */
  const [rates, setRates] = useState<Record<string, number | null>>({});
  // Told apart from "no restaurants yet", which on this screen of all screens
  // would be read as the roster having been wiped.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [detail, setDetail] = useState<Restaurant | null>(null);
  const [dialog, setDialog] = useState<{ restaurant: Restaurant; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  /*
    Selling the slot, or giving it.

    Defaults to the free one every time the dialog opens. Selling has to be
    chosen, because a promotion labelled "Reklam" that nobody was charged for is
    only untidy, while a paid one shown as the platform's own recommendation is
    a lie to every customer who reads the card.
  */
  const [sponsored, setSponsored] = useState(false);
  /** How many months the slot runs. Turned into a date by the server. */
  const [months, setMonths] = useState('1');
  /** The monthly fee in manat, as typed. Blank means "agreed, no charge yet". */
  const [fee, setFee] = useState('');
  /** Only the removal uses it; cleared every time a dialog opens. */
  const [confirmName, setConfirmName] = useState('');
  const [rateInput, setRateInput] = useState('12');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [pin, setPin] = useState<MapPoint | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Kept on screen after the call instead of being announced in a toast: the
  // ownerless outcome is a job for the admin, and a toast is gone in four
  // seconds.
  const [created, setCreated] = useState<{ restaurantId: string; ownerLinked: boolean } | null>(
    null,
  );

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    /*
     * BOUNDED, and the bound is the point.
     *
     * This was an unlimited live subscription to the whole collection. At three
     * hundred restaurants it is three hundred reads every time the page is
     * opened; at ten thousand it is ten thousand, and the browser holds all of
     * them in memory and re-renders the table whenever any one of them changes.
     * The screen would stop being usable long before the platform stopped
     * growing.
     *
     * `RESTAURANT_PAGE_SIZE` newest-first covers every day-to-day task — the
     * new applications are at the top — and the search box below filters what
     * is loaded. A directory of ten thousand restaurants is a different screen
     * with a server-side search behind it, and it should be built when it is
     * needed rather than approximated by loading everything.
     */
    return onSnapshot(
      query(
        collection(db, COLLECTIONS.restaurants),
        orderBy('createdAt', 'desc'),
        limit(RESTAURANT_PAGE_SIZE),
      ),
      (snapshot) => {
        // The document's own id is the fallback for `id`, which is a field on
        // the document as well. A restaurant written before that field existed
        // otherwise arrives with `id: undefined`, and everything downstream —
        // the row key, the detail panel, the commission path below — is built
        // out of it.
        setRestaurants(
          snapshot.docs.map((entry) => {
            const data = entry.data() as Restaurant;
            return data.id ? data : { ...data, id: entry.id };
          }),
        );
        setLoadError(null);
      },
      () => {
        setRestaurants([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [t]);

  // The ids as one string, so the fetch below re-runs when the roster actually
  // changes rather than on every snapshot of the same restaurants. Anything
  // without an id is dropped here rather than asked about: a path cannot be
  // built from a missing id, and the commission column simply shows nothing for
  // a row that cannot say which restaurant it is.
  const restaurantIds = (restaurants ?? [])
    .map((restaurant) => restaurant.id)
    .filter((id): id is string => Boolean(id))
    .join(',');

  useEffect(() => {
    const db = firestore();
    if (!db || restaurantIds.length === 0) return;

    // Guards against a fetch that finishes after the roster has moved on.
    let live = true;

    void (async () => {
      const ids = restaurantIds.split(',');
      const entries = await Promise.all(
        ids.map(async (id) => {
          const snapshot = await getDoc(doc(db, paths.restaurantBusiness(id))).catch(() => null);
          const business = snapshot?.data() as RestaurantBusiness | undefined;
          return [id, typeof business?.commissionRateBps === 'number'
            ? business.commissionRateBps
            : null] as const;
        }),
      );

      if (live) setRates(Object.fromEntries(entries));
    })();

    return () => {
      live = false;
    };
  }, [restaurantIds]);

  const counts = useMemo(() => {
    const all = restaurants ?? [];
    return {
      PENDING_APPROVAL: all.filter((r) => r.status === RestaurantStatus.PENDING_APPROVAL).length,
      ACTIVE: all.filter((r) => r.status === RestaurantStatus.ACTIVE).length,
      SUSPENDED: all.filter((r) => r.status === RestaurantStatus.SUSPENDED).length,
      REMOVED: all.filter((r) => r.status === RestaurantStatus.REMOVED).length,
    } as Partial<Record<Tab, number>>;
  }, [restaurants]);

  const rows = useMemo(() => {
    if (!restaurants) return null;
    const needle = term.trim().toLowerCase();

    return restaurants
      .filter((restaurant) => tab === 'ALL' || restaurant.status === tab)
      .filter((restaurant) =>
        // The id is searched as well as the name: now that it is on screen it
        // is also what gets pasted back in — from a support ticket, or out of
        // a public URL. Every field read defensively, because a restaurant
        // created before `addressLine` existed still has to be findable.
        matches(needle, restaurant.name, restaurant.addressLine, restaurant.id),
      );
  }, [restaurants, tab, term]);

  const open = (restaurant: Restaurant, action: Action) => {
    setError(null);
    setReason('');
    setConfirmName('');
    if (action === 'approve' || action === 'commission') setRateInput('12');
    setDialog({ restaurant, action });
  };

  const run = async () => {
    if (!dialog) return;

    setBusy(true);
    setError(null);

    const { restaurant, action } = dialog;
    let result;

    switch (action) {
      case 'approve':
        result = await approveRestaurant({
          restaurantId: restaurant.id,
          commissionRateBps: Math.round(Number(rateInput) * 100),
        });
        break;
      case 'reject':
        result = await rejectRestaurant({ restaurantId: restaurant.id, reason });
        break;
      case 'suspend':
        result = await setRestaurantStatus({
          restaurantId: restaurant.id,
          status: RestaurantStatus.SUSPENDED,
          reason,
        });
        break;
      case 'activate':
        result = await setRestaurantStatus({
          restaurantId: restaurant.id,
          status: RestaurantStatus.ACTIVE,
          reason,
        });
        break;
      case 'remove':
        result = await removeRestaurant({
          restaurantId: restaurant.id,
          reason,
          confirmName: confirmName.trim(),
        });
        break;
      case 'commission':
        result = await setCommissionRate({
          restaurantId: restaurant.id,
          commissionRateBps: Math.round(Number(rateInput) * 100),
          reason,
        });
        break;
      case 'feature':
      case 'unfeature':
        // The written reason is required for the same reason it is on every
        // other action here: this one changes what customers are shown first.
        result = await setRestaurantFeatured({
          restaurantId: restaurant.id,
          featured: dialog.action === 'feature',
          kind: sponsored ? 'SPONSORED' : 'EDITORIAL',
          // Months rather than a date picker: every one of these is sold as "a
          // month" or "three months" over a telephone, and a calendar would
          // only be a way to typo the year.
          untilMs:
            dialog.action === 'feature' && sponsored
              ? Date.now() + Number(months || 1) * 30 * 24 * 60 * 60 * 1000
              : null,
          feeAmount:
            dialog.action === 'feature' && sponsored && fee.trim()
              ? Math.round(Number(fee.replace(',', '.')) * 100)
              : null,
          reason,
        });
        break;
    }

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t(`admin.done_${action}`));
    setDialog(null);
    setReason('');
  };

  const regions = useMemo(() => orderedRegions(), []);
  const createDistricts = districtsOf(form.regionId);

  const patch = (next: Partial<typeof EMPTY_CREATE_FORM>) =>
    setForm((current) => ({ ...current, ...next }));

  const openCreate = () => {
    setForm(EMPTY_CREATE_FORM);
    setPin(null);
    setCreated(null);
    setCreateError(null);
    setCreateOpen(true);
  };

  // The server normalises the number itself (0xx, 994xx and +994xx all land on
  // the same E.164 form), so the client only checks that enough digits were
  // typed to be worth sending.
  const phoneDigits = form.ownerPhone.replace(/\D/g, '').length;
  const createCommissionBps = form.commission.trim()
    ? Math.round(Number(form.commission) * 100)
    : null;
  const createCommissionValid =
    createCommissionBps === null ||
    (Number.isFinite(createCommissionBps) &&
      createCommissionBps >= 0 &&
      createCommissionBps <= 5000);

  const createValid =
    form.name.trim().length >= 2 &&
    form.addressLine.trim().length >= 5 &&
    (createDistricts.length === 0 || createDistricts.includes(form.district)) &&
    phoneDigits >= 9 &&
    createCommissionValid &&
    pin !== null;

  const submitCreate = async () => {
    if (!pin) return;

    setCreateBusy(true);
    setCreateError(null);

    const result = await createRestaurantByAdmin({
      name: form.name.trim(),
      legalName: form.legalName.trim() || undefined,
      regionId: form.regionId,
      district: createDistricts.length > 0 ? form.district : null,
      addressLine: form.addressLine.trim(),
      lat: pin.lat,
      lng: pin.lng,
      ownerPhone: form.ownerPhone.trim(),
      contactName: form.contactName.trim() || undefined,
      commissionRateBps: createCommissionBps ?? undefined,
    });

    setCreateBusy(false);

    if (!result.ok || !result.data) {
      setCreateError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setCreated(result.data);
    toast.show(t('admin.done_create_restaurant'));
  };

  const needsReason = dialog?.action !== 'approve';
  /** Only the removal asks for the name — see the note on the action type. */
  const needsName = dialog?.action === 'remove';
  const nameMatches =
    !needsName ||
    confirmName.trim().toLowerCase() === (dialog?.restaurant.name ?? '').trim().toLowerCase();
  const needsRate = dialog?.action === 'approve' || dialog?.action === 'commission';
  const rateBps = Math.round(Number(rateInput || 0) * 100);
  const rateValid = Number.isFinite(rateBps) && rateBps >= 0 && rateBps <= 5000;

  const columns: Column<Restaurant>[] = [
    {
      key: 'name',
      header: t('admin.restaurant'),
      cell: (restaurant) => (
        <span className="block">
          <span className="block font-medium text-ink-900">{restaurant.name}</span>
          <CopyableId
            id={restaurant.id}
            label={t('admin.restaurantId')}
            onCopied={() => toast.show(t('common.copied'))}
          />
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
      /*
       * The commission rate, in the open.
       *
       * "RESTORANLARIN FAİZİ AÇIQ FORMADA GÖRSENMELİDİR" — it used to be
       * readable only by opening a restaurant's drawer, which meant nobody
       * comparing two of them ever saw both at once.
       */
      key: 'commission',
      header: t('sales.commission'),
      align: 'right',
      cell: (restaurant) => {
        const bps = rates[restaurant.id];
        return typeof bps === 'number' ? (
          <span className="font-medium tabular-nums text-ink-900">{formatBps(bps)}</span>
        ) : (
          <span className="text-ink-300">—</span>
        );
      },
      // Unknown rates sort last rather than as a free 0%.
      sortValue: (restaurant) => rates[restaurant.id] ?? -1,
    },
    {
      key: 'orders',
      header: t('sales.orderCount'),
      align: 'right',
      cell: (restaurant) => num(restaurant.completedOrderCount),
      sortValue: (restaurant) => num(restaurant.completedOrderCount),
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
    {
      key: 'created',
      header: t('admin.createdAt'),
      align: 'right',
      cell: (restaurant) => (
        <span className="text-xs text-ink-500">{when(restaurant.createdAt)}</span>
      ),
      sortValue: (restaurant) => restaurant.createdAt?.toMillis?.() ?? 0,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (restaurant) => (
        <span
          className="flex justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          {restaurant.status === RestaurantStatus.PENDING_APPROVAL && (
            <>
              <Button size="sm" onClick={() => open(restaurant, 'approve')}>
                <Check size={15} /> {t('admin.approve')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => open(restaurant, 'reject')}>
                <X size={15} />
              </Button>
            </>
          )}

          {restaurant.status === RestaurantStatus.ACTIVE && (
            <>
              <Button size="sm" variant="secondary" onClick={() => open(restaurant, 'commission')}>
                <Percent size={15} />
              </Button>
              {/* The only badge that is stored, because it is the only one that
                  is a decision — "new" is a date and "popular" is a count, both
                  computed from the restaurant's own fields. */}
              <Button
                size="sm"
                variant="secondary"
                aria-label={t(restaurant.featured ? 'admin.unfeature' : 'admin.feature')}
                onClick={() => open(restaurant, restaurant.featured ? 'unfeature' : 'feature')}
              >
                <Star
                  size={15}
                  className={restaurant.featured ? 'fill-amber-400 text-amber-500' : undefined}
                />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => open(restaurant, 'suspend')}>
                <Power size={15} />
              </Button>
            </>
          )}

          {/* Removal is offered on everything except an already-removed shop.
              Deliberately not limited to suspended ones: a rejected
              application and an abandoned draft are exactly the rows an admin
              wants out of the list, and neither can be suspended first. */}
          {restaurant.status !== RestaurantStatus.REMOVED && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('admin.remove')}
              onClick={() => open(restaurant, 'remove')}
            >
              <Trash2 size={15} className="text-danger" />
            </Button>
          )}

          {restaurant.status === RestaurantStatus.SUSPENDED && (
            <Button size="sm" onClick={() => open(restaurant, 'activate')}>
              {t('admin.activate')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('nav.restaurants')}
        subtitle={t('admin.restaurantsSubtitle')}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={15} /> {t('admin.addRestaurant')}
          </Button>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'PENDING_APPROVAL', label: t('status.PENDING_APPROVAL') },
          { value: 'ACTIVE', label: t('status.ACTIVE') },
          { value: 'SUSPENDED', label: t('status.SUSPENDED') },
          { value: 'REJECTED', label: t('status.REJECTED') },
          { value: 'REMOVED', label: t('status.REMOVED') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(restaurant) => restaurant.id}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noRestaurants')}
      />

      {/* --- Create ---------------------------------------------------- */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('admin.addRestaurant')}
        subtitle={t('admin.addRestaurantSubtitle')}
        footer={
          created ? (
            <Button fullWidth variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.close')}
            </Button>
          ) : (
            <Button
              fullWidth
              loading={createBusy}
              disabled={!createValid}
              onClick={() => void submitCreate()}
            >
              {t('admin.createRestaurant')}
            </Button>
          )
        }
      >
        {created ? (
          <div className="space-y-4">
            {/* Two genuinely different outcomes, and the difference decides
                whether anybody can log in. Neither is phrased as plain
                success. */}
            {created.ownerLinked ? (
              <Alert tone="success">{t('admin.ownerLinkedBody', { phone: formatPhone(form.ownerPhone) })}</Alert>
            ) : (
              <Alert tone="warning">
                <span className="block font-medium">{t('admin.ownerMissingTitle')}</span>
                <span className="mt-1 block">
                  {t('admin.ownerMissingBody', { phone: formatPhone(form.ownerPhone) })}
                </span>
              </Alert>
            )}

            <Card className="px-4 py-2">
              <Field label={t('admin.restaurant')}>{form.name}</Field>
              <Field label={t('admin.restaurantId')}>
                <CopyableId
                  id={created.restaurantId}
                  label={t('admin.restaurantId')}
                  onCopied={() => toast.show(t('common.copied'))}
                />
              </Field>
              <Field label={t('auth.phone')}>{formatPhone(form.ownerPhone)}</Field>
            </Card>

            <p className="text-xs text-ink-400">{t('admin.createdClosedHint')}</p>

            <Button variant="secondary" onClick={openCreate}>
              <Plus size={15} /> {t('admin.addAnotherRestaurant')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert tone="info">{t('admin.addRestaurantIntro')}</Alert>

            <Input
              label={t('admin.restaurantName')}
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
              maxLength={60}
            />

            <Input
              label={`${t('admin.legalName')} (${t('common.optional')})`}
              value={form.legalName}
              onChange={(event) => patch({ legalName: event.target.value })}
              maxLength={120}
              hint={t('admin.legalNameHint')}
            />

            <Select
              label={t('account.city')}
              value={form.regionId}
              onChange={(event) => patch({ regionId: event.target.value, district: '' })}
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>

            {createDistricts.length > 0 && (
              <Select
                label={t('account.district')}
                value={form.district}
                onChange={(event) => patch({ district: event.target.value })}
                hint={t('account.districtHint')}
              >
                <option value="">{t('account.districtChoose')}</option>
                {createDistricts.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            )}

            <Input
              label={t('account.addressLine')}
              value={form.addressLine}
              onChange={(event) => patch({ addressLine: event.target.value })}
              maxLength={300}
            />

            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-700">
                {t('map.pickTitle')}
              </span>
              <DeliveryMap
                value={pin}
                radiusMeters={ADMIN_CREATED_RADIUS_M}
                regionId={form.regionId}
                onChange={setPin}
              />
              {!pin && <p className="mt-1.5 text-sm text-ink-400">{t('admin.pinRequired')}</p>}
            </div>

            <PhoneInput
              label={t('admin.ownerPhone')}
              value={form.ownerPhone}
              onChange={(next) => patch({ ownerPhone: next })}
              hint={t('admin.ownerPhoneHint')}
            />

            <Input
              label={`${t('admin.contactName')} (${t('common.optional')})`}
              value={form.contactName}
              onChange={(event) => patch({ contactName: event.target.value })}
              maxLength={80}
            />

            <Input
              label={`${t('admin.commissionRate')} (%)`}
              value={form.commission}
              onChange={(event) => patch({ commission: event.target.value })}
              inputMode="decimal"
              error={createCommissionValid ? null : t('errors.VALIDATION_FAILED')}
              hint={
                createCommissionBps !== null && createCommissionValid
                  ? t('admin.rateHint', { rate: formatBps(createCommissionBps) })
                  : t('admin.commissionDefaultHint')
              }
            />

            {createError && <Alert tone="danger">{createError}</Alert>}
          </div>
        )}
      </Drawer>

      {/* --- Detail ---------------------------------------------------- */}
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

            <Card className="px-4 py-2">
              <Field label={t('admin.restaurantId')}>
                <CopyableId
                  id={detail.id}
                  label={t('admin.restaurantId')}
                  onCopied={() => toast.show(t('common.copied'))}
                />
              </Field>
              <Field label={t('account.city')}>
                {regionName(detail.regionId ?? '') || detail.city}
              </Field>
              {detail.district && <Field label={t('account.district')}>{detail.district}</Field>}
              <Field label={t('account.addressLine')}>{text(detail.addressLine) || '—'}</Field>
              <Field label={t('restaurant.cuisines')}>
                {list<string>(detail.cuisines)
                  .map((entry) => cuisineLabel(entry, t))
                  .join(', ') || '—'}
              </Field>
              {/* Marked when it is a guess from the cuisine text rather than a
                  choice the restaurant made, so nobody reads a fallback as a
                  decision — see `restaurantCategories`. */}
              <Field label={t('categories.title')}>
                {(() => {
                  const chosen = normaliseFoodCategories(detail.categories);
                  const shown = chosen.length > 0 ? chosen : inferFoodCategories(detail.cuisines);
                  if (shown.length === 0) return '—';
                  const names = shown.map((id) => t(`categories.${id}`)).join(', ');
                  return chosen.length > 0 ? names : `${names} (${t('admin.categoriesInferred')})`;
                })()}
              </Field>
            </Card>

            <Card className="px-4 py-2">
              <Field label={t('home.minOrder')}>
                {formatMinorUnits(num(detail.minOrderAmount))} ₼
              </Field>
              <Field label={t('home.deliveryFee')}>
                {formatMinorUnits(num(detail.deliveryFee))} ₼
              </Field>
              <Field label={t('map.radius')}>
                {(num(detail.deliveryRadiusMeters) / 1000).toFixed(1)} km
              </Field>
              <Field label={t('restaurant.paymentMethods')}>
                {list<string>(detail.paymentMethods)
                  .map((method) => t(`checkout.${method}`))
                  .join(', ') || '—'}
              </Field>
            </Card>

            <Card className="px-4 py-2">
              <Field label={t('sales.orderCount')}>{num(detail.completedOrderCount)}</Field>
              <Field label={t('filters.rating')}>
                {num(detail.ratingCount) > 0
                  ? `${num(detail.ratingAverage).toFixed(1)} (${num(detail.ratingCount)})`
                  : '—'}
              </Field>
              <Field label={t('admin.createdAt')}>{when(detail.createdAt)}</Field>
            </Card>

            {/* The restaurant's own money, read from the restaurant's own
                endpoints. See `RestaurantReport` for why it is not computed
                here. */}
            <RestaurantReport restaurantId={detail.id} restaurantName={detail.name} />

          </div>
        )}
      </Drawer>

      {/* --- Action --------------------------------------------------- */}
      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog ? t(`admin.${dialog.action}`) : ''}
        body={dialog ? t(`admin.warn_${dialog.action}`, { name: dialog.restaurant.name }) : ''}
        confirmLabel={t('common.confirm')}
        tone={
          dialog?.action === 'reject' ||
          dialog?.action === 'suspend' ||
          dialog?.action === 'remove'
            ? 'danger'
            : 'primary'
        }
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (needsReason && reason.trim().length < 10) return;
          if (needsRate && !rateValid) return;
          if (!nameMatches) return;
          void run();
        }}
      >
        {needsRate && (
          <Input
            label={`${t('admin.commissionRate')} (%)`}
            value={rateInput}
            onChange={(event) => setRateInput(event.target.value)}
            inputMode="decimal"
            error={rateValid ? null : t('errors.VALIDATION_FAILED')}
            hint={rateValid ? t('admin.rateHint', { rate: formatBps(rateBps) }) : undefined}
          />
        )}

        {needsName && (
          <>
            {/* Said in full before the box, not after. Somebody about to type a
                restaurant's name should already know that the menu goes, the
                staff are unlinked, and the orders and invoices stay. */}
            <Alert tone="danger">{t('admin.removeRestaurantWarning')}</Alert>
            <Input
              label={t('admin.removeRestaurantConfirm', {
                name: dialog?.restaurant.name ?? '',
              })}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              maxLength={120}
            />
          </>
        )}

        {/*
          Selling the slot.

          Only on the way IN. Turning a promotion off needs no price and no
          duration — it needs one press — and a form that asks for both anyway
          is a form somebody fills in wrongly on their way to cancelling
          something.
        */}
        {dialog?.action === 'feature' && (
          <>
            <Select
              label={t('admin.featureKind')}
              value={sponsored ? 'SPONSORED' : 'EDITORIAL'}
              onChange={(event) => setSponsored(event.target.value === 'SPONSORED')}
            >
              <option value="EDITORIAL">{t('admin.featureEditorial')}</option>
              <option value="SPONSORED">{t('admin.featureSponsored')}</option>
            </Select>

            {sponsored && (
              <>
                <Alert tone="warning">{t('admin.featureSponsoredNote')}</Alert>
                <Input
                  label={t('admin.featureMonths')}
                  type="number"
                  min={1}
                  max={12}
                  value={months}
                  onChange={(event) => setMonths(event.target.value)}
                />
                <Input
                  label={t('admin.featureFee')}
                  inputMode="decimal"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  hint={t('admin.featureFeeHint')}
                />
              </>
            )}
          </>
        )}

        {needsReason && (
          <Textarea
            label={t('admin.reasonRequired')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            hint={t('admin.reasonAudited')}
          />
        )}

        {needsReason && reason.trim().length < 10 && (
          <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </PanelShell>
  );
}
