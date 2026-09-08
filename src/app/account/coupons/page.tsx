'use client';

/**
 * "Kuponlarım".
 *
 * Every coupon this person can actually use, and nothing else. A campaign
 * addressed to eight regulars is invisible to the ninth customer, and a
 * welcome coupon disappears the moment their first order completes — because a
 * coupon you can see but cannot use is worse than no coupon at all: it reads as
 * the app going back on its word at exactly the moment somebody is paying.
 *
 * Each card says the three things that decide whether it is worth using: what
 * it takes off, what the basket has to reach, and where it works. What it does
 * not say is who pays for the discount. That is a matter between Qapında and
 * the restaurant, and putting it on the customer's screen only invites an
 * argument at the door.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, TicketPercent } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Badge, Button, Card, EmptyState, Money } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { myCoupons } from '@/firebase/callables';
import { whenDeadline } from '@/components/panel/status';
import { restaurantHref } from '@/services/catalog';
import { CouponType } from '@/shared/enums';

interface MyCoupon {
  code: string;
  type: string;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  firstOrderOnly: boolean;
  restaurantIds: string[];
  /** Name and slug for each restaurant it works at, so the card can link. */
  restaurants: Array<{ id: string; name: string; slug: string }>;
  validUntil: { _seconds?: number; seconds?: number } | null;
  remainingForMe: number;
}

/** The callable answers over the wire, so timestamps arrive as `_seconds`. */
function expiry(value: MyCoupon['validUntil']): string {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds ? whenDeadline({ toMillis: () => seconds * 1000 }) : '';
}

export default function MyCouponsPage() {
  const t = useT();
  const { firebaseUser, loading } = useAuth();

  const [coupons, setCoupons] = useState<MyCoupon[] | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;

    let cancelled = false;
    void myCoupons().then((result) => {
      if (cancelled) return;
      setCoupons(result.ok && result.data ? (result.data.coupons as MyCoupon[]) : []);
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const header = <ScreenHeader title={t('account.coupons')} fallbackHref="/account" />;

  if (loading) {
    return (
      <AppShell>
        {header}
        <PageLoading />
      </AppShell>
    );
  }

  if (!firebaseUser) {
    return (
      <AppShell>
        {header}
        <EmptyState
          title={t('auth.guestHint')}
          action={
            <Link
              href="/login?next=/account/coupons"
              className="text-sm font-medium text-brand-600 underline"
            >
              {t('auth.signIn')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {header}

      {coupons === null ? (
        <div className="space-y-3" role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-20 animate-pulse rounded-2xl bg-ink-100" aria-hidden />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <EmptyState title={t('coupons.none')} hint={t('coupons.noneHint')} />
      ) : (
        <div className="space-y-3">
          {coupons.map((coupon) => {
            const spent = coupon.remainingForMe === 0;

            return (
              <Card
                key={coupon.code}
                className={spent ? 'p-4 opacity-60' : 'p-4'}
                aria-label={coupon.code}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <TicketPercent size={20} aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">
                      {coupon.type === CouponType.PERCENT
                        ? t('coupons.percentOff', { value: (coupon.value / 100).toFixed(0) })
                        : coupon.type === CouponType.FREE_DELIVERY
                          ? t('coupons.freeDelivery')
                          : t('coupons.amountOff')}
                      {coupon.type === CouponType.FIXED && (
                        <span className="ml-1">
                          <Money amount={coupon.value} />
                        </span>
                      )}
                    </p>

                    <p className="mt-0.5 font-mono text-sm tracking-wide text-ink-500">
                      {coupon.code}
                    </p>

                    <ul className="mt-2 space-y-0.5 text-sm text-ink-600">
                      {coupon.minSubtotal > 0 && (
                        <li>
                          {t('coupons.minimum')} <Money amount={coupon.minSubtotal} />
                        </li>
                      )}
                      {coupon.maxDiscount !== null && (
                        <li>
                          {t('coupons.maximum')} <Money amount={coupon.maxDiscount} />
                        </li>
                      )}
                      <li>
                        {coupon.restaurantIds.length === 0
                          ? t('coupons.everywhere')
                          : t('coupons.selectedRestaurants', {
                              count: coupon.restaurantIds.length,
                            })}
                      </li>
                      {expiry(coupon.validUntil) && (
                        <li>{t('coupons.validUntil', { date: expiry(coupon.validUntil) })}</li>
                      )}
                    </ul>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {coupon.firstOrderOnly && <Badge tone="brand">{t('coupons.firstOrder')}</Badge>}
                      {spent && <Badge tone="neutral">{t('coupons.used')}</Badge>}
                    </div>

                    {/* The way in. A coupon that names restaurants but does not
                        let you reach them is a coupon that expires unused —
                        the customer has no way to look up an id. A spent one
                        gets no buttons: there is nothing to go and do. */}
                    {!spent && coupon.restaurants.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {coupon.restaurants.map((entry) => (
                          <Link key={entry.id} href={restaurantHref(entry)}>
                            <Button size="sm" variant="secondary">
                              {entry.name}
                              <ArrowRight size={15} aria-hidden />
                            </Button>
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Valid everywhere: one button to the whole shopfront
                        rather than a list nobody could finish reading. */}
                    {!spent && coupon.restaurantIds.length === 0 && (
                      <div className="mt-3">
                        <Link href="/">
                          <Button size="sm" variant="secondary">
                            {t('coupons.browseAll')}
                            <ArrowRight size={15} aria-hidden />
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-400">{t('coupons.checkoutHint')}</p>
    </AppShell>
  );
}
