'use client';

/**
 * The cart.
 *
 * Two columns once there is room: the lines on the left, the money on the right
 * where it stays in view while the list is edited. Every figure here is an
 * estimate — the server prices the order for real at checkout — so the note
 * saying so sits with the total rather than in a footnote nobody reads.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Store, Trash2 } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import {
  MaintenanceNotice,
  useMaintenance,
} from '@/components/customer/MaintenanceNotice';
import { Alert, Button, Card, EmptyState, Money } from '@/components/ui';
import { QuantityStepper } from '@/components/customer/QuantityStepper';
import { CartUpsell } from '@/components/customer/CartUpsell';
import { WorkAccountNotice } from '@/components/customer/WorkAccountNotice';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useT } from '@/i18n';
import { getRestaurant, restaurantHref } from '@/services/catalog';
import { deliveryFeeFor } from '@/shared/pricing';
import { isWorkAccount } from '@/shared/permissions';
import type { Restaurant } from '@/shared/models';

export default function CartPage() {
  const t = useT();
  const router = useRouter();
  const cart = useCart();
  const { role, identityLoading } = useAuth();
  const maintenance = useMaintenance();
  const [loaded, setLoaded] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!cart.restaurantId) return;
    let cancelled = false;
    getRestaurant(cart.restaurantId).then((found) => {
      if (!cancelled) setLoaded(found);
    });
    return () => {
      cancelled = true;
    };
  }, [cart.restaurantId]);

  // Derived: an emptied cart must not keep showing the last restaurant's fees.
  const restaurant = cart.restaurantId && loaded?.id === cart.restaurantId ? loaded : null;

  /*
   * A work account has no cart at all.
   *
   * Checked before the cart is even read, and derived during render rather
   * than in an effect: the answer is a function of who is signed in, and a
   * screen that painted the cart first and took it away afterwards would be
   * offering the order for a frame. The wait on `identityLoading` is the same
   * one the courier panel makes — until the profile and the token have both
   * arrived, everybody looks like a customer.
   */
  if (!identityLoading && isWorkAccount(role)) {
    return (
      <AppShell>
        <WorkAccountNotice role={role} />
      </AppShell>
    );
  }

  if (!cart.hydrated) {
    return (
      <AppShell>
        <Header title={t('cart.title')} />
        <div className="space-y-2.5" role="status" aria-label={t('common.loading')}>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-24 animate-pulse rounded-2xl bg-ink-100" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <AppShell>
        <Header title={t('cart.title')} />
        <EmptyState
          title={t('cart.empty')}
          hint={t('cart.emptyHint')}
          action={
            <Link href="/">
              <Button size="sm">{t('home.allRestaurants')}</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  // Indicative figures only — the server recalculates all of this at checkout.
  const subtotal = cart.estimatedSubtotal;
  const deliveryFee = restaurant ? deliveryFeeFor(restaurant, subtotal) : 0;
  const belowMinimum = restaurant ? subtotal < restaurant.minOrderAmount : false;
  const missing = restaurant ? restaurant.minOrderAmount - subtotal : 0;

  return (
    <AppShell>
      <Header
        title={t('cart.title')}
        subtitle={t('cart.itemCount', { count: cart.itemCount })}
        action={
          <button
            type="button"
            onClick={cart.clear}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-500 transition hover:bg-red-50 hover:text-danger"
          >
            <Trash2 size={15} aria-hidden /> {t('cart.clear')}
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        <div>
          {cart.restaurantName && (
            <Card className="mb-4 flex items-center gap-3 p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Store size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs uppercase tracking-wide text-ink-400">
                  {t('cart.fromRestaurant')}
                </span>
                <span className="block truncate font-medium text-ink-900">
                  {cart.restaurantName}
                </span>
              </span>
              {restaurant && (
                <Link
                  href={restaurantHref(restaurant)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
                >
                  {t('cart.continueShopping')}
                </Link>
              )}
            </Card>
          )}

          <h2 className="mb-2.5 text-sm font-medium text-ink-500">{t('cart.items')}</h2>

          <Card className="divide-y divide-row-edge">
            {cart.lines.map((line) => (
              <div key={line.lineId} className="flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{line.name}</p>

                  {line.optionLabels.length > 0 && (
                    <p className="mt-1 text-sm text-ink-500">{line.optionLabels.join(' · ')}</p>
                  )}
                  {line.note && <p className="mt-1 text-sm italic text-ink-400">{line.note}</p>}

                  <p className="mt-2 font-semibold text-ink-900">
                    <Money amount={(line.unitPrice + line.optionsTotal) * line.quantity} />
                  </p>
                </div>

                {/*
                  The shared stepper, which is what this row should always have
                  used. The hand-written copy underneath it had 27-pixel targets
                  — well under the 44 needed for a thumb — on the one screen
                  where a mis-tap changes an order. The component that fixes
                  that was already in the codebase, written so that the menu and
                  the cart could not drift apart, and this page had drifted.
                */}
                <QuantityStepper
                  name={line.name}
                  quantity={line.quantity}
                  onDecrease={() => cart.setQuantity(line.lineId, line.quantity - 1)}
                  onIncrease={() => cart.setQuantity(line.lineId, line.quantity + 1)}
                />
              </div>
            ))}
          </Card>

          {/* Sits under the lines, where somebody has finished checking what
              they ordered and is about to think about a drink. */}
          {cart.restaurantId && (
            <CartUpsell
              restaurantId={cart.restaurantId}
              restaurantName={cart.restaurantName ?? ''}
            />
          )}
        </div>

        {/* The money column. Sticky on desktop so editing the list never scrolls
            the total out of sight; a plain block below the lines on a phone. */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-5">
            <h2 className="mb-4 text-base font-semibold text-ink-900">{t('cart.summary')}</h2>

            <dl className="space-y-2.5 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-ink-500">{t('cart.subtotal')}</dt>
                <dd className="text-ink-900">
                  <Money amount={subtotal} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">{t('cart.deliveryFee')}</dt>
                <dd className="text-ink-900">
                  {deliveryFee === 0 ? (
                    <span className="font-medium text-success">{t('home.freeDelivery')}</span>
                  ) : (
                    <Money amount={deliveryFee} />
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t border-card-edge pt-3 text-lg font-semibold text-ink-900">
                <dt>{t('cart.total')}</dt>
                <dd>
                  <Money amount={subtotal + deliveryFee} />
                </dd>
              </div>
            </dl>

            {belowMinimum && restaurant && (
              <div className="mt-4">
                <Alert tone="warning">
                  {t('cart.belowMinimum', {
                    amount: (restaurant.minOrderAmount / 100).toFixed(2),
                  })}{' '}
                  {t('cart.addMoreToMinimum', { amount: (missing / 100).toFixed(2) })}
                </Alert>
              </div>
            )}

            {/* The ordering path closes here rather than at the last step:
                a basket is still worth keeping while the platform is down, but
                walking somebody to the checkout to be refused there is the
                thing the owner asked us not to do. */}
            <MaintenanceNotice className="mt-4" />

            <div className="mt-5">
              <Button
                fullWidth
                size="lg"
                disabled={belowMinimum || maintenance.on}
                onClick={() => router.push('/checkout')}
              >
                {t('cart.checkout')}
              </Button>
              {maintenance.on ? (
                <p className="mt-2 text-center text-sm text-ink-500">{t('maintenance.body')}</p>
              ) : (
                belowMinimum && (
                  <p className="mt-2 text-center text-sm text-ink-500">
                    {t('cart.checkoutBlockedMinimum')}
                  </p>
                )
              )}
            </div>

            <p className="mt-4 text-sm text-ink-400">{t('cart.estimateNote')}</p>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

function Header({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
