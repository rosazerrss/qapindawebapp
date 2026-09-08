'use client';

/**
 * Coupons.
 *
 * The one field that must never be guessed at is `fundedBy`. It decides whether
 * the discount comes out of the platform's commission or the restaurant's
 * margin, and there is no way to infer it later from the order — so the form
 * asks plainly, and explains the consequence next to the choice.
 *
 * A coupon is never deleted, only switched off: the redemptions that already
 * happened point at the code, so the list is a ledger of campaigns rather than
 * a list of live offers. That is why the table leads with the money — value,
 * usage and window — and why switching one off goes through a confirmation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Percent, Ticket, Users, Wallet } from 'lucide-react';

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
  type StatusTone,
} from '@/components/panel/ui';
import { CouponCustomers } from '@/components/panel/CouponCustomers';
import { Stat } from '@/components/panel/Stat';
import { when } from '@/components/panel/status';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Input, Money, Select, Textarea } from '@/components/ui';
import { InlineLoading } from '@/components/ui/loading';
import { useT, translateError } from '@/i18n';
import {
  couponRedemptions,
  createCoupon,
  listCoupons,
  setCouponActive,
  updateCoupon,
} from '@/firebase/callables';
import { useAuth } from '@/contexts/AuthContext';
import { list, matches, num, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { CouponFunding, CouponType } from '@/shared/enums';
import { formatBps, formatMinorUnits, parseMajorUnits } from '@/shared/pricing';

/**
 * `listCoupons` answers over the callable wire, so its timestamps arrive as
 * plain JSON — the admin SDK serialises a Timestamp as `_seconds`, not as an
 * object with `toMillis()`. Everything else on the row is already a primitive.
 */
interface WireTimestamp {
  _seconds?: number;
  seconds?: number;
}

interface CouponRow {
  code: string;
  type: string;
  value: number;
  fundedBy: string;
  active: boolean;
  firstOrderOnly: boolean;
  usedCount: number;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number;
  minSubtotal: number;
  maxDiscount: number | null;
  restaurantIds: string[];
  validFrom: WireTimestamp | null;
  validUntil: WireTimestamp | null;
  redemptionCount: number;
  uniqueCustomers: number;
  totalDiscount: number;
  platformFunded: number;
  restaurantFunded: number;
  redemptionsTruncated: boolean;
  allowedUserIds: string[];
  platformShareBps: number;
}

/** One redemption, as `couponRedemptions` sends it. */
interface RedemptionRow {
  orderId: string;
  orderCode: string | null;
  discountAmount: number;
  platformFunded: number;
  restaurantFunded: number;
  phoneMasked: string;
  createdAt: WireTimestamp | null;
}

type Tab = 'ACTIVE' | 'INACTIVE' | 'ALL';

/** Seconds on the wire, millis in the formatter — one place to bridge the two. */
const millis = (value: WireTimestamp | null | undefined): number | null => {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds === undefined ? null : seconds * 1000;
};

const wireWhen = (value: WireTimestamp | null | undefined): string => {
  const ms = millis(value);
  return ms === null ? '' : when({ toMillis: () => ms });
};

const emptyDraft = () => ({
  code: '',
  type: CouponType.FIXED as string,
  value: '4.00',
  fundedBy: CouponFunding.PLATFORM as string,
  /** Qapında's share of a shared discount, as a percentage the admin types. */
  platformShare: '50',
  restaurantIds: [] as string[],
  minSubtotal: '10.00',
  maxDiscount: '',
  firstOrderOnly: true,
  usageLimitTotal: '',
  usageLimitPerCustomer: '1',
  days: '30',
  /** Only the edit form uses these two: a date rather than "how many days". */
  validUntilDate: '',
  /** Named customers, one uid per line. Empty = open to everybody. */
  allowedUserIdsText: '',
  /** Written to the audit log beside the change. */
  reason: '',
});

/** `YYYY-MM-DD` for a `<input type="date">`, from wire seconds. */
const dateInput = (value: WireTimestamp | null | undefined): string => {
  const ms = millis(value);
  if (ms === null) return '';
  const at = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return at.toISOString().slice(0, 10);
};

/**
 * Where a campaign is in its own lifetime.
 *
 * "Active" on the coupon document only means the admin has not switched it
 * off; a coupon can be active and long expired, which is the state that makes
 * an admin think a campaign is running when it is not. So the window is a
 * badge of its own beside the switch.
 */
function windowLabel(coupon: {
  validFrom: WireTimestamp | null;
  validUntil: WireTimestamp | null;
}): string {
  const now = Date.now();
  const from = millis(coupon.validFrom);
  const until = millis(coupon.validUntil);

  if (from !== null && from > now) return 'admin.couponNotStarted';
  if (until !== null && until < now) return 'admin.couponExpired';
  return 'admin.couponRunning';
}

function windowTone(coupon: {
  validFrom: WireTimestamp | null;
  validUntil: WireTimestamp | null;
}): StatusTone {
  const key = windowLabel(coupon);
  if (key === 'admin.couponRunning') return 'success';
  if (key === 'admin.couponNotStarted') return 'warning';
  return 'neutral';
}

export default function AdminCouponsPage() {
  const t = useT();
  const toast = useToast();
  const { firebaseUser, loading } = useAuth();

  const [coupons, setCoupons] = useState<CouponRow[] | null>(null);
  // `listCoupons` failing used to leave an empty table saying "no coupons",
  // which is the one answer a campaign screen must never give when it does not
  // actually know.
  const [loadError, setLoadError] = useState<string | null>(null);
  // The restaurant list is only needed while a coupon is being written, but it
  // is small and read once, so it is loaded with the page rather than opening a
  // second connection the moment somebody starts typing a code.
  const [restaurants, setRestaurants] = useState<Array<{ id: string; name: string }>>([]);
  const [restaurantTerm, setRestaurantTerm] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<CouponRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [toggling, setToggling] = useState<CouponRow | null>(null);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  // The redemptions belong to whichever coupon is open. Held with the code they
  // were loaded for, so switching campaigns shows the spinner by derivation
  // rather than by an effect clearing state after the render that used it.
  const [redemptionsFor, setRedemptionsFor] = useState<{
    code: string;
    rows: RedemptionRow[] | null;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = redemptionsFor && detail && redemptionsFor.code === detail.code ? redemptionsFor : null;
  const redemptions = loaded ? loaded.rows : null;
  const redemptionError = loaded ? loaded.error : null;

  const reload = useCallback(async () => {
    const result = await listCoupons();

    if (!result.ok || !result.data) {
      setCoupons([]);
      setLoadError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setCoupons(list<CouponRow>(result.data.coupons));
    setLoadError(null);
  }, [t]);

  useEffect(() => {
    /*
     * WAIT FOR THE SESSION BEFORE ASKING THE SERVER.
     *
     * This is the bug the owner was looking at. `listCoupons` was fired the
     * moment the page mounted, which on a cold load is BEFORE Firebase has
     * finished restoring the session from storage — so the call went out with
     * no ID token, the server answered UNAUTHENTICATED, and the campaign
     * screen rendered "Bu əməliyyat üçün daxil olmalısınız." where the coupons
     * should have been. Nothing was wrong with the admin's account and nothing
     * retried, so the sentence simply sat there.
     *
     * `PanelShell` gates what it RENDERS on the same condition, but a page
     * component's effects run regardless of what its shell decided to draw,
     * which is why the gate has to be repeated here.
     */
    if (loading || !firebaseUser) return;

    // Every state update in the loader happens after an `await`, so nothing is
    // set synchronously during this effect. The rule cannot see past the async
    // boundary, so it is silenced here rather than the code contorted around it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload, loading, firebaseUser]);

  /**
   * The open coupon's redemptions.
   *
   * Gated on the session for exactly the reason the list above is: a callable
   * fired before Firebase has restored the token comes back UNAUTHENTICATED,
   * and the panel would print that refusal where the redemptions belong.
   */
  const openCode = detail?.code ?? null;
  useEffect(() => {
    if (!openCode || loading || !firebaseUser) return;

    let cancelled = false;
    void couponRedemptions(openCode).then((result) => {
      if (cancelled) return;
      setRedemptionsFor({
        code: openCode,
        rows: result.ok && result.data ? list<RedemptionRow>(result.data.redemptions) : null,
        error: result.ok ? null : translateError(t, result.errorCode, result.errorDetail),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [openCode, loading, firebaseUser, t]);

  const counts = useMemo(() => {
    const all = coupons ?? [];
    return {
      ACTIVE: all.filter((coupon) => coupon.active).length,
      INACTIVE: all.filter((coupon) => !coupon.active).length,
    } as Partial<Record<Tab, number>>;
  }, [coupons]);

  const rows = useMemo(() => {
    if (!coupons) return null;
    const needle = term.trim().toLowerCase();

    return coupons
      .filter((coupon) => (tab === 'ALL' ? true : tab === 'ACTIVE' ? coupon.active : !coupon.active))
      .filter((coupon) => matches(needle, coupon.code));
  }, [coupons, tab, term]);

  /** What the coupon is worth, in the unit its type is stored in. */
  const valueLabel = (coupon: CouponRow) =>
    coupon.type === CouponType.PERCENT
      ? `${num(coupon.value) / 100}%`
      : coupon.type === CouponType.FREE_DELIVERY
        ? t('admin.FREE_DELIVERY')
        : `${(num(coupon.value) / 100).toFixed(2)} ₼`;

  const submit = async () => {
    setBusy(true);
    setError(null);

    let value: number;
    let minSubtotal: number;
    let maxDiscount: number | null = null;

    try {
      // A percentage is basis points; everything else is money in qəpik.
      value =
        draft.type === CouponType.PERCENT
          ? Math.round(Number(draft.value) * 100)
          : draft.type === CouponType.FREE_DELIVERY
            ? 0
            : parseMajorUnits(draft.value);
      minSubtotal = parseMajorUnits(draft.minSubtotal || '0');
      if (draft.maxDiscount.trim()) maxDiscount = parseMajorUnits(draft.maxDiscount);
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const now = Date.now();
    const result = await createCoupon({
      code: draft.code,
      type: draft.type,
      value,
      fundedBy: draft.fundedBy,
      // A percentage on screen, basis points on the wire — the server stores
      // and splits in basis points so no fraction of a qəpik is ever lost.
      platformShareBps:
        draft.fundedBy === CouponFunding.SHARED
          ? Math.round(Number(draft.platformShare) * 100)
          : undefined,
      restaurantIds: draft.restaurantIds,
      allowedUserIds: draft.allowedUserIdsText
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      minSubtotal,
      maxDiscount,
      firstOrderOnly: draft.firstOrderOnly,
      usageLimitTotal: draft.usageLimitTotal.trim() ? Number(draft.usageLimitTotal) : null,
      usageLimitPerCustomer: Number(draft.usageLimitPerCustomer),
      validFrom: now,
      validUntil: now + Number(draft.days) * 24 * 60 * 60 * 1000,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setCreating(false);
    setDraft(emptyDraft());
    toast.show(t('admin.done_coupon_created'));
    await reload();
  };

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    return onSnapshot(
      query(collection(db, COLLECTIONS.restaurants), orderBy('name', 'asc'), limit(300)),
      (snapshot) =>
        setRestaurants(
          snapshot.docs.map((entry) => {
            const data = entry.data() as { id?: string; name?: string };
            return { id: data.id ?? entry.id, name: text(data.name) || entry.id };
          }),
        ),
      // The picker degrades to "no restaurants to choose", which the sentence
      // under it already explains as "every restaurant" — a coupon can still
      // be written platform-wide with the list unavailable.
      () => setRestaurants([]),
    );
  }, []);

  // Picked restaurants stay at the top even once the search no longer matches
  // them — otherwise a choice made two searches ago silently looks undone.
  const restaurantChoices = useMemo(() => {
    const needle = restaurantTerm.trim().toLowerCase();
    const picked = restaurants.filter((entry) => draft.restaurantIds.includes(entry.id));
    const rest = restaurants
      .filter((entry) => !draft.restaurantIds.includes(entry.id))
      .filter((entry) => matches(needle, entry.name))
      .slice(0, 20);
    return [...picked, ...rest];
  }, [restaurants, restaurantTerm, draft.restaurantIds]);

  /** Puts the stored coupon into the draft the edit form reads. */
  const openEdit = (coupon: CouponRow) => {
    setError(null);
    setRestaurantTerm('');
    setDraft({
      ...emptyDraft(),
      code: coupon.code,
      type: coupon.type,
      fundedBy: coupon.fundedBy,
      // A percentage is stored in basis points and typed as a percentage; money
      // is stored in qəpik and typed in manat. Both conversions happen here and
      // in `saveEdit`, and nowhere else.
      value:
        coupon.type === CouponType.PERCENT
          ? String(num(coupon.value) / 100)
          : formatMinorUnits(num(coupon.value)),
      minSubtotal: formatMinorUnits(num(coupon.minSubtotal)),
      maxDiscount: coupon.maxDiscount === null ? '' : formatMinorUnits(coupon.maxDiscount),
      restaurantIds: list<string>(coupon.restaurantIds),
      allowedUserIdsText: list<string>(coupon.allowedUserIds).join('\n'),
      firstOrderOnly: coupon.firstOrderOnly,
      usageLimitTotal: coupon.usageLimitTotal === null ? '' : String(coupon.usageLimitTotal),
      usageLimitPerCustomer: String(num(coupon.usageLimitPerCustomer)),
      validUntilDate: dateInput(coupon.validUntil),
    });
    setEditing(coupon);
  };

  const toggleRestaurant = (id: string) =>
    setDraft((current) => ({
      ...current,
      restaurantIds: current.restaurantIds.includes(id)
        ? current.restaurantIds.filter((entry) => entry !== id)
        : [...current.restaurantIds, id],
    }));

  /** Ids mean nothing to a reader; the names the admin picked do. */
  const restaurantNames = (ids: string[]): string => {
    const chosen = list<string>(ids);
    const named = chosen
      .map((id) => restaurants.find((entry) => entry.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    // Falls back to the count when the roster has not loaded, rather than to a
    // row of raw document ids.
    return named.length === chosen.length && named.length > 0
      ? named.join(', ')
      : t('admin.couponRestaurantCount', { count: chosen.length });
  };

  const saveEdit = async () => {
    if (!editing) return;

    setBusy(true);
    setError(null);

    let value: number;
    let minSubtotal: number;
    let maxDiscount: number | null = null;
    let validUntil: number;

    try {
      value =
        editing.type === CouponType.PERCENT
          ? Math.round(Number(draft.value) * 100)
          : editing.type === CouponType.FREE_DELIVERY
            ? 0
            : parseMajorUnits(draft.value);
      minSubtotal = parseMajorUnits(draft.minSubtotal || '0');
      if (draft.maxDiscount.trim()) maxDiscount = parseMajorUnits(draft.maxDiscount);

      // End of the chosen day, not the start of it: an admin who types today's
      // date means "valid for the rest of today".
      const day = new Date(`${draft.validUntilDate}T23:59:59`);
      validUntil = day.getTime();
      if (!Number.isFinite(validUntil)) throw new Error('date');
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const result = await updateCoupon({
      code: editing.code,
      value,
      minSubtotal,
      maxDiscount,
      restaurantIds: draft.restaurantIds,
      /*
       * `allowedUserIds` is deliberately NOT sent from this form.
       *
       * Who a coupon is for is edited one person at a time, by phone number, in
       * `CouponCustomers` on the detail drawer — and each of those changes is
       * audited by name. Sending the whole array from here as well would give
       * two ways to change the same field, one of which silently overwrites
       * whatever the other did while the form was open, and would replace those
       * per-customer audit entries with a diff of two lists of uids.
       */
      firstOrderOnly: draft.firstOrderOnly,
      usageLimitTotal: draft.usageLimitTotal.trim() ? Number(draft.usageLimitTotal) : null,
      usageLimitPerCustomer: Number(draft.usageLimitPerCustomer),
      validUntil,
      reason: draft.reason.trim() || null,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setEditing(null);
    setDetail(null);
    toast.show(t('admin.done_coupon_updated'));
    await reload();
  };

  const toggle = async () => {
    if (!toggling) return;

    setBusy(true);
    const target = toggling;

    const result = await setCouponActive({
      code: target.code,
      active: !target.active,
      // The audit reason is read months later by whoever disputes a settlement,
      // so it stays in one language rather than following the admin's locale.
      reason: target.active ? 'Admin tərəfindən dayandırıldı' : 'Yenidən aktivləşdirildi',
    });

    setBusy(false);

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }

    setToggling(null);
    setDetail(null);
    toast.show(t(target.active ? 'admin.done_coupon_paused' : 'admin.done_coupon_resumed'));
    await reload();
  };

  const columns: Column<CouponRow>[] = [
    {
      key: 'code',
      header: t('admin.couponCode'),
      cell: (coupon) => (
        <span className="block">
          <span className="block font-mono font-semibold text-ink-900">{coupon.code}</span>
          <span className="block text-xs text-ink-400">
            {t(`admin.${coupon.fundedBy}`)}
            {coupon.firstOrderOnly ? ` · ${t('admin.firstOrderOnly')}` : ''}
          </span>
        </span>
      ),
      sortValue: (coupon) => text(coupon.code),
    },
    {
      key: 'type',
      header: t('admin.couponType'),
      cell: (coupon) => t(`admin.${coupon.type}`),
      sortValue: (coupon) => coupon.type,
    },
    {
      key: 'value',
      header: t('admin.couponValue'),
      align: 'right',
      cell: (coupon) => valueLabel(coupon),
      sortValue: (coupon) => num(coupon.value),
    },
    {
      key: 'usage',
      header: t('admin.couponUsage'),
      align: 'right',
      cell: (coupon) => (
        <span>
          {num(coupon.redemptionCount)}
          <span className="text-ink-400">
            {' / '}
            {coupon.usageLimitTotal ?? t('admin.couponUnlimited')}
          </span>
        </span>
      ),
      sortValue: (coupon) => num(coupon.redemptionCount),
    },
    {
      key: 'window',
      header: t('admin.couponWindow'),
      align: 'right',
      cell: (coupon) => (
        <span className="text-xs text-ink-500">
          {wireWhen(coupon.validFrom)} — {wireWhen(coupon.validUntil)}
        </span>
      ),
      sortValue: (coupon) => millis(coupon.validUntil) ?? 0,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (coupon) => (
        <StatusBadge tone={coupon.active ? 'success' : 'neutral'}>
          {t(coupon.active ? 'admin.couponActive' : 'admin.couponInactive')}
        </StatusBadge>
      ),
      sortValue: (coupon) => (coupon.active ? 0 : 1),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (coupon) => (
        <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="secondary" onClick={() => setToggling(coupon)}>
            {coupon.active ? t('admin.suspend') : t('admin.activate')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('nav.coupons')}
        subtitle={t('admin.couponsSubtitle')}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            {t('admin.newCoupon')}
          </Button>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'ACTIVE', label: t('admin.couponActive') },
          { value: 'INACTIVE', label: t('admin.couponInactive') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('admin.couponSearch')} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(coupon) => coupon.code}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noCoupons')}
        emptyHint={t('admin.noCouponsHint')}
      />

      {/* --- Detail ---------------------------------------------------- */}
      {/*
        WHAT THIS PANEL IS FOR.

        Not "the coupon document, rendered". An admin opens a campaign to
        answer three questions in order: is it live and until when, what does
        it cost us, and who has actually used it. So the panel is arranged in
        that order, every figure is read from real redemptions, and there is no
        line of filler anywhere in it — an empty campaign says "nobody has used
        this yet", which is an answer, rather than a prompt to go and log in.
      */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.code ?? ''}
        subtitle={detail ? t(`admin.${detail.type}`) : undefined}
        footer={
          detail && (
            <div className="flex gap-2">
              <Button fullWidth onClick={() => openEdit(detail)}>
                {t('admin.couponEdit')}
              </Button>
              <Button fullWidth variant="secondary" onClick={() => setToggling(detail)}>
                {detail.active ? t('admin.suspend') : t('admin.activate')}
              </Button>
            </div>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={detail.active ? 'success' : 'neutral'}>
                {t(detail.active ? 'admin.couponActive' : 'admin.couponInactive')}
              </StatusBadge>
              <StatusBadge tone={windowTone(detail)}>{t(windowLabel(detail))}</StatusBadge>
              {detail.firstOrderOnly && (
                <StatusBadge tone="neutral">{t('admin.firstOrderOnly')}</StatusBadge>
              )}
            </div>

            {/* --- How it has performed ------------------------------- */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {t('admin.couponPerformance')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  icon={Ticket}
                  label={t('admin.couponRedemptions')}
                  value={String(num(detail.redemptionCount))}
                  hint={t('admin.couponUsageOfLimit', {
                    limit: String(detail.usageLimitTotal ?? t('admin.couponUnlimited')),
                  })}
                />
                <Stat
                  icon={Users}
                  label={t('admin.couponUniqueCustomers')}
                  value={String(num(detail.uniqueCustomers))}
                  hint={t('admin.couponUniqueCustomersHint')}
                />
                <Stat
                  icon={Percent}
                  label={t('admin.couponTotalDiscount')}
                  amount={num(detail.totalDiscount)}
                  hint={t('admin.couponTotalDiscountHint')}
                />
                <Stat
                  icon={Wallet}
                  label={t('admin.couponPlatformFunded')}
                  amount={num(detail.platformFunded)}
                  tone="brand"
                  hint={t('admin.couponPlatformFundedHint')}
                />
              </div>

              {/* The other half of the split, said in money rather than left
                  to be worked out by subtraction. */}
              <div className="mt-3">
                <Card className="px-4 py-2">
                  <Field label={t('admin.couponRestaurantFunded')}>
                    <Money amount={num(detail.restaurantFunded)} />
                  </Field>
                  <Field label={t('admin.couponAverageDiscount')}>
                    <Money
                      amount={
                        num(detail.redemptionCount) > 0
                          ? Math.round(num(detail.totalDiscount) / num(detail.redemptionCount))
                          : 0
                      }
                    />
                  </Field>
                </Card>
              </div>

              {detail.redemptionsTruncated && (
                <p className="mt-2 text-xs text-ink-400">{t('admin.couponTruncated')}</p>
              )}
              {/* The counter on the document and the counted rows should agree.
                  When they do not, saying so is more useful than picking one. */}
              {num(detail.usedCount) !== num(detail.redemptionCount) &&
                !detail.redemptionsTruncated && (
                  <p className="mt-2 text-xs text-warning">
                    {t('admin.couponCountMismatch', {
                      counter: String(num(detail.usedCount)),
                      counted: String(num(detail.redemptionCount)),
                    })}
                  </p>
                )}
            </div>

            {/* --- The terms ------------------------------------------ */}
            <Card className="px-4 py-2">
              <Field label={t('admin.couponValue')}>{valueLabel(detail)}</Field>
              <Field label={t('admin.fundedBy')}>
                {t(`admin.${detail.fundedBy}`)}
                {detail.fundedBy === CouponFunding.SHARED
                  ? ` · ${formatBps(num(detail.platformShareBps))}`
                  : ''}
              </Field>
              <Field label={t('admin.minSubtotal')}>
                <Money amount={num(detail.minSubtotal)} />
              </Field>
              <Field label={t('admin.maxDiscount')}>
                {detail.maxDiscount === null ? (
                  t('admin.couponUncapped')
                ) : (
                  <Money amount={detail.maxDiscount} />
                )}
              </Field>
              <Field label={t('admin.firstOrderOnly')}>
                {t(detail.firstOrderOnly ? 'common.yes' : 'common.no')}
              </Field>
            </Card>

            <Card className="px-4 py-2">
              <Field label={t('admin.usageLimitTotal')}>
                {detail.usageLimitTotal ?? t('admin.couponUnlimited')}
              </Field>
              <Field label={t('admin.usageLimitPerCustomer')}>
                {num(detail.usageLimitPerCustomer)}
              </Field>
              <Field label={t('admin.validFrom')}>{wireWhen(detail.validFrom)}</Field>
              <Field label={t('admin.validUntil')}>{wireWhen(detail.validUntil)}</Field>
              <Field label={t('admin.couponScope')}>
                {list(detail.restaurantIds).length === 0
                  ? t('admin.couponAllRestaurants')
                  : restaurantNames(detail.restaurantIds)}
              </Field>
              <Field label={t('admin.couponAudience')}>
                {list(detail.allowedUserIds).length === 0
                  ? t('admin.couponEveryCustomer')
                  : t('admin.couponNamedCustomers', {
                      count: list(detail.allowedUserIds).length,
                    })}
              </Field>
            </Card>

            {/* --- Who it is for -------------------------------------- */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {t('admin.couponAudience')}
              </h3>
              <CouponCustomers
                key={detail.code}
                code={detail.code}
                // The list is served by a callable, not by the live query behind
                // this table, so removing the last customer — which switches the
                // coupon off — has to be reflected here by hand.
                onDeactivated={() => toast.show(t('admin.done_coupon_deactivated'))}
              />
            </div>

            {/* --- Who used it ---------------------------------------- */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {t('admin.couponRedemptionList')}
              </h3>

              {redemptionError ? (
                <Alert tone="danger">{redemptionError}</Alert>
              ) : redemptions === null ? (
                <InlineLoading label={t('common.loading')} className="py-4" />
              ) : redemptions.length === 0 ? (
                <p className="rounded-xl border border-ink-200 px-3.5 py-3 text-sm text-ink-500">
                  {t('admin.couponNoRedemptions')}
                </p>
              ) : (
                <ul className="divide-y divide-row-edge rounded-xl border border-ink-200">
                  {redemptions.map((row) => (
                    <li key={row.orderId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block font-mono text-sm text-ink-900">
                          {row.orderCode ?? t('admin.couponOrderGone')}
                        </span>
                        <span className="block text-xs text-ink-400">
                          {wireWhen(row.createdAt)} · {row.phoneMasked}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm text-ink-900">
                          <Money amount={row.discountAmount} />
                        </span>
                        <span className="block text-xs text-ink-400">
                          {t('admin.couponPlatformShareShort')}{' '}
                          <Money amount={row.platformFunded} />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-xs text-ink-400">{t('admin.couponNeverDeleted')}</p>
          </div>
        )}
      </Drawer>

      {/* --- Edit ------------------------------------------------------ */}
      {/*
        The code, the type and the funding split are shown but never editable —
        see `updateCoupon` on the server for why: the code is what every
        redemption points at, and the split decides who was billed for
        discounts that have already been given.
      */}
      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? t('admin.couponEditTitle', { code: editing.code }) : ''}
        subtitle={t('admin.couponEditSubtitle')}
        footer={
          <Button fullWidth loading={busy} onClick={() => void saveEdit()}>
            {t('common.save')}
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Card className="px-4 py-2">
              <Field label={t('admin.couponCode')}>
                <span className="font-mono">{editing.code}</span>
              </Field>
              <Field label={t('admin.couponType')}>{t(`admin.${editing.type}`)}</Field>
              <Field label={t('admin.fundedBy')}>{t(`admin.${editing.fundedBy}`)}</Field>
            </Card>
            <p className="text-sm text-ink-400">{t('admin.couponImmutableHint')}</p>

            {editing.type !== CouponType.FREE_DELIVERY && (
              <Input
                label={editing.type === CouponType.PERCENT ? `${t('admin.couponValue')} (%)` : `${t('admin.couponValue')} (₼)`}
                value={draft.value}
                onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                inputMode="decimal"
                hint={
                  editing.type === CouponType.PERCENT
                    ? t('admin.couponValuePercentHint')
                    : t('admin.couponValueFixedHint')
                }
              />
            )}

            <Input
              label={`${t('admin.minSubtotal')} (₼)`}
              value={draft.minSubtotal}
              onChange={(event) =>
                setDraft((current) => ({ ...current, minSubtotal: event.target.value }))
              }
              inputMode="decimal"
              hint={t('admin.minSubtotalHint')}
            />

            {editing.type === CouponType.PERCENT && (
              <Input
                label={`${t('admin.maxDiscount')} (₼)`}
                value={draft.maxDiscount}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, maxDiscount: event.target.value }))
                }
                inputMode="decimal"
                hint={t('admin.maxDiscountHint')}
              />
            )}

            <RestaurantScopePicker
              choices={restaurantChoices}
              term={restaurantTerm}
              onTerm={setRestaurantTerm}
              picked={draft.restaurantIds}
              onToggle={toggleRestaurant}
              locked={editing.fundedBy !== CouponFunding.PLATFORM}
              t={t}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('admin.usageLimitTotal')}
                value={draft.usageLimitTotal}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, usageLimitTotal: event.target.value }))
                }
                inputMode="numeric"
                placeholder={t('admin.couponUnlimited')}
                hint={t('admin.usageLimitTotalHint')}
              />
              <Input
                label={t('admin.usageLimitPerCustomer')}
                value={draft.usageLimitPerCustomer}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, usageLimitPerCustomer: event.target.value }))
                }
                inputMode="numeric"
                hint={t('admin.usageLimitPerCustomerHint')}
              />
            </div>

            <Input
              type="date"
              label={t('admin.validUntil')}
              value={draft.validUntilDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, validUntilDate: event.target.value }))
              }
              hint={t('admin.couponValidUntilHint')}
            />

            <Textarea
              label={t('admin.couponNamedCustomerIds')}
              value={draft.allowedUserIdsText}
              onChange={(event) =>
                setDraft((current) => ({ ...current, allowedUserIdsText: event.target.value }))
              }
              rows={3}
              hint={t('admin.couponNamedCustomerIdsHint')}
            />

            <label className="flex items-center gap-2.5 text-[15px] text-ink-700">
              <input
                type="checkbox"
                checked={draft.firstOrderOnly}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, firstOrderOnly: event.target.checked }))
                }
                className="h-4 w-4 accent-brand-600"
              />
              {t('admin.firstOrderOnly')}
            </label>
            <p className="-mt-2 text-sm text-ink-400">{t('admin.firstOrderOnlyHint')}</p>

            <Input
              label={t('admin.couponEditReason')}
              value={draft.reason}
              onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}
              maxLength={300}
              hint={t('admin.reasonAudited')}
            />

            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
      </Drawer>

      {/* --- Create ---------------------------------------------------- */}
      {/* The form is long enough that a centred sheet would scroll off a laptop
          screen; the drawer keeps the list visible beside it. */}
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title={t('admin.newCoupon')}
        subtitle={t('admin.newCouponSubtitle')}
        footer={
          <Button fullWidth loading={busy} disabled={draft.code.trim().length < 3} onClick={submit}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            label={t('admin.couponCode')}
            value={draft.code}
            onChange={(event) =>
              setDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
            maxLength={24}
            placeholder="ILKSIFARIS"
            className="font-mono"
            hint={t('admin.couponCodeHint')}
          />

          <Select
            label={t('admin.couponType')}
            value={draft.type}
            onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
          >
            <option value={CouponType.FIXED}>{t('admin.FIXED')}</option>
            <option value={CouponType.PERCENT}>{t('admin.PERCENT')}</option>
            <option value={CouponType.FREE_DELIVERY}>{t('admin.FREE_DELIVERY')}</option>
          </Select>
          <p className="-mt-2 text-sm text-ink-400">{t('admin.couponTypeHint')}</p>

          {draft.type !== CouponType.FREE_DELIVERY && (
            <Input
              label={draft.type === CouponType.PERCENT ? '%' : '₼'}
              value={draft.value}
              onChange={(event) =>
                setDraft((current) => ({ ...current, value: event.target.value }))
              }
              inputMode="decimal"
              hint={
                draft.type === CouponType.PERCENT
                  ? t('admin.couponValuePercentHint')
                  : t('admin.couponValueFixedHint')
              }
            />
          )}

          <div>
            <Select
              label={t('admin.fundedBy')}
              value={draft.fundedBy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, fundedBy: event.target.value }))
              }
            >
              <option value={CouponFunding.PLATFORM}>{t('admin.PLATFORM')}</option>
              <option value={CouponFunding.RESTAURANT}>{t('admin.RESTAURANT')}</option>
              <option value={CouponFunding.SHARED}>{t('admin.SHARED')}</option>
            </Select>
            <p className="mt-1.5 text-sm text-ink-400">{t('admin.fundedByHint')}</p>
          </div>

          {draft.fundedBy === CouponFunding.SHARED && (
            <div>
              <Input
                label={`${t('admin.platformShare')} (%)`}
                value={draft.platformShare}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, platformShare: event.target.value }))
                }
                inputMode="decimal"
              />
              {/* The split is stated in both directions on purpose: "Qapında
                  pays 40%" and "the restaurant pays 60%" are the same fact, and
                  the second is the one the restaurant will argue about. */}
              <p className="mt-1.5 text-sm text-ink-400">
                {t('admin.platformShareHint', {
                  platform: draft.platformShare || '0',
                  restaurant: String(Math.max(0, 100 - Number(draft.platformShare || 0))),
                })}
              </p>
            </div>
          )}

          <RestaurantScopePicker
            choices={restaurantChoices}
            term={restaurantTerm}
            onTerm={setRestaurantTerm}
            picked={draft.restaurantIds}
            onToggle={toggleRestaurant}
            locked={draft.fundedBy !== CouponFunding.PLATFORM}
            t={t}
          />

          <Input
            label={`${t('admin.minSubtotal')} (₼)`}
            value={draft.minSubtotal}
            onChange={(event) =>
              setDraft((current) => ({ ...current, minSubtotal: event.target.value }))
            }
            inputMode="decimal"
            hint={t('admin.minSubtotalHint')}
          />

          {draft.type === CouponType.PERCENT && (
            <Input
              label={`${t('admin.maxDiscount')} (₼)`}
              value={draft.maxDiscount}
              onChange={(event) =>
                setDraft((current) => ({ ...current, maxDiscount: event.target.value }))
              }
              inputMode="decimal"
              hint={t('admin.maxDiscountHint')}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('admin.usageLimitTotal')}
              value={draft.usageLimitTotal}
              onChange={(event) =>
                setDraft((current) => ({ ...current, usageLimitTotal: event.target.value }))
              }
              inputMode="numeric"
              placeholder={t('admin.couponUnlimited')}
              hint={t('admin.usageLimitTotalHint')}
            />
            <Input
              label={t('admin.usageLimitPerCustomer')}
              value={draft.usageLimitPerCustomer}
              onChange={(event) =>
                setDraft((current) => ({ ...current, usageLimitPerCustomer: event.target.value }))
              }
              inputMode="numeric"
              hint={t('admin.usageLimitPerCustomerHint')}
            />
          </div>

          <Input
            label={t('admin.couponDays')}
            value={draft.days}
            onChange={(event) => setDraft((current) => ({ ...current, days: event.target.value }))}
            inputMode="numeric"
            hint={t('admin.couponDaysHint')}
          />

          <label className="flex items-center gap-2.5 text-[15px] text-ink-700">
            <input
              type="checkbox"
              checked={draft.firstOrderOnly}
              onChange={(event) =>
                setDraft((current) => ({ ...current, firstOrderOnly: event.target.checked }))
              }
              className="h-4 w-4 accent-brand-600"
            />
            {t('admin.firstOrderOnly')}
          </label>
          <p className="-mt-2 text-sm text-ink-400">{t('admin.firstOrderOnlyHint')}</p>

          {/* No uid textarea here: the customers are edited by phone number on
              the detail drawer, which is the only handle an admin has. */}
          <Alert tone="info">{t('admin.couponLimitHint')}</Alert>

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Drawer>

      {/* --- Switch off ------------------------------------------------ */}
      <ConfirmDialog
        open={Boolean(toggling)}
        title={toggling?.active ? t('admin.suspend') : t('admin.activate')}
        body={
          toggling
            ? t(toggling.active ? 'admin.warn_coupon_pause' : 'admin.warn_coupon_resume', {
                code: toggling.code,
              })
            : ''
        }
        confirmLabel={t('common.confirm')}
        tone={toggling?.active ? 'danger' : 'primary'}
        busy={busy}
        onCancel={() => setToggling(null)}
        onConfirm={() => void toggle()}
      />
    </PanelShell>
  );
}

/**
 * Which restaurants a campaign runs at.
 *
 * One component for the create form and the edit form, because the rule behind
 * it is not cosmetic: a RESTAURANT- or SHARED-funded coupon must name the
 * restaurants that are paying for it, and the server refuses one that does not.
 * `locked` says the list cannot be left empty — the sentence under the picker
 * changes from "every restaurant" to "at least one is required" so the admin
 * learns it here rather than from a validation failure on save.
 */
function RestaurantScopePicker({
  choices,
  term,
  onTerm,
  picked,
  onToggle,
  locked,
  t,
}: {
  choices: Array<{ id: string; name: string }>;
  term: string;
  onTerm: (value: string) => void;
  picked: string[];
  onToggle: (id: string) => void;
  locked: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink-700">
        {t('admin.couponRestaurants')}
      </span>
      <SearchInput value={term} onChange={onTerm} placeholder={t('search.hintRestaurants')} />

      <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
        {choices.map((choice) => {
          const on = picked.includes(choice.id);
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(choice.id)}
              className={
                on
                  ? 'w-full rounded-lg border border-brand-600 bg-brand-50 px-3 py-2 text-left text-sm'
                  : 'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm hover:bg-ink-50'
              }
            >
              {choice.name}
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-sm text-ink-400">
        {picked.length > 0
          ? t('admin.couponRestaurantCount', { count: picked.length })
          : locked
            ? t('admin.couponRestaurantsRequired')
            : t('admin.couponEveryRestaurant')}
      </p>
    </div>
  );
}
