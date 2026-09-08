'use client';

/**
 * Checkout.
 *
 * This is the one screen where a guest is stopped — and even here the cart is
 * not lost: they sign in, come back, and the order is still there.
 *
 * Every figure shown comes from `previewOrder` on the server, computed by the
 * same code that will price the real order. The client never adds up money.
 *
 * The four decisions are numbered, because a checkout that reads as one long
 * scroll is where people abandon; and the button that ends it always says why
 * it cannot be pressed yet, rather than sitting greyed out and silent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Plus, TicketPercent } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AddressForm, AddressRow } from '@/components/customer/AddressForm';
import { WorkAccountNotice } from '@/components/customer/WorkAccountNotice';
import { Alert, Button, Card, EmptyState, Input, Money, Textarea, cn } from '@/components/ui';
import { InlineLoading, PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useT, translateError } from '@/i18n';
import { createOrder, myCoupons, previewOrder, startOnlinePayment } from '@/firebase/callables';
import { watchAddresses } from '@/services/addresses';
import { getRestaurant } from '@/services/catalog';
import {
  CouponType,
  DEFAULT_ENABLED_PAYMENT_METHODS,
  PaymentMethod,
  V1_PAYMENT_METHODS,
} from '@/shared/enums';
import { checkDeliveryRange, mayDeliverTo, type DeliveryRange } from '@/shared/geo';
import { isWorkAccount } from '@/shared/permissions';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import { formatMinorUnits } from '@/shared/pricing';
import type { Address, PublicSettings, Restaurant } from '@/shared/models';
import {
  MaintenanceNotice,
  useMaintenance,
} from '@/components/customer/MaintenanceNotice';

type Pricing = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  belowMinimum: boolean;
};

/** Stable per attempt: the same id on a retry means one order, not two. */
function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Only what the picker needs from `myCoupons`; the rest is not this screen's. */
interface CheckoutCoupon {
  code: string;
  type: string;
  value: number;
  minSubtotal: number;
  restaurantIds: string[];
  remainingForMe: number;
}

/**
 * How long the basket must sit still before it is priced again.
 *
 * See the note at the effect below: this is the difference between one server
 * call and one per tap.
 */
const PRICE_DEBOUNCE_MS = 350;

export default function CheckoutPage() {
  const t = useT();
  const router = useRouter();
  const cart = useCart();
  const { firebaseUser, profile, role, loading, identityLoading } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  // Read once, not watched: which payment methods the platform allows changes
  // about twice a year, and a live listener on it would be a connection held
  // open for nothing.
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  // Live, unlike `settings` above: the whole point of the flag is that it can
  // change while somebody is standing on this screen.
  const maintenance = useMaintenance();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [chosenAddressId, setChosenAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<string>(PaymentMethod.CASH_ON_DELIVERY);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    let cancelled = false;
    void getDoc(doc(db, paths.publicSettings())).then((snapshot) => {
      if (!cancelled) setSettings(snapshot.exists() ? (snapshot.data() as PublicSettings) : null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The customer's coupons, fetched once. Advisory only — `createOrder`
  // re-checks every one of them against the real basket.
  const [myCouponList, setMyCouponList] = useState<CheckoutCoupon[]>([]);

  useEffect(() => {
    if (!firebaseUser) return;

    let cancelled = false;
    void myCoupons().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setMyCouponList(result.data.coupons);
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  // The server's word on whether the kitchen is taking orders right now. The
  // card on the home page can be a minute stale; this cannot.
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [couponError, setCouponError] = useState<string | null>(null);
  // Set only from the Apply click, never from the pricing effect.
  const [applying, setApplying] = useState(false);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  // Created once per mount and reused on every retry of this same order.
  const requestId = useRef(newRequestId());

  const items = useMemo(
    () =>
      cart.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        selectedOptionIds: line.selectedOptionIds,
        note: line.note,
      })),
    [cart.lines],
  );

  useEffect(() => {
    if (!cart.restaurantId) return;
    let cancelled = false;
    getRestaurant(cart.restaurantId).then((found) => {
      if (!cancelled) setRestaurant(found);
    });
    return () => {
      cancelled = true;
    };
  }, [cart.restaurantId]);

  useEffect(() => {
    if (!firebaseUser) return;
    return watchAddresses(firebaseUser.uid, setAddresses);
  }, [firebaseUser]);

  // The person's default, unless they have picked something else. Derived, so
  // the list arriving does not need an effect to nudge the selection.
  const addressId =
    chosenAddressId ??
    addresses.find((address) => address.id === profile?.defaultAddressId)?.id ??
    addresses.find((address) => address.isDefault)?.id ??
    addresses[0]?.id ??
    null;

  /**
   * Asks the server what this cart costs.
   *
   * Every state update happens after the await, so calling it from an effect
   * cannot cascade a synchronous re-render.
   */
  const refreshPricing = useCallback(
    async (coupon: string | null): Promise<void> => {
      if (!cart.restaurantId || items.length === 0 || !firebaseUser) return;

      const result = await previewOrder({
        restaurantId: cart.restaurantId,
        items,
        couponCode: coupon,
        addressId,
      });

      if (!result.ok || !result.data) {
        setPricingError(translateError(t, result.errorCode, result.errorDetail));
        return;
      }

      setPricingError(
        result.data.problems.length > 0
          ? translateError(t, result.data.problems[0].code, result.data.problems[0].detail)
          : null,
      );

      setPricing(result.data.pricing);
      setAcceptingOrders(result.data.open);

      if (coupon) {
        setCouponError(
          result.data.couponError ? translateError(t, result.data.couponError) : null,
        );
        setAppliedCoupon(result.data.couponError ? null : coupon);
      }
    },
    [cart.restaurantId, items, firebaseUser, addressId, t],
  );

  /*
   * Re-price when the cart, the address or the applied coupon changes —
   * DEBOUNCED.
   *
   * `previewOrder` is a Cloud Function: it reads the restaurant, every product
   * in the basket and, when there is one, the coupon. Firing it on every change
   * meant that somebody tapping "+" four times to order four kebabs paid for
   * four full server round trips, and saw the total flicker through three
   * intermediate values on the way to the right one.
   *
   * A third of a second is below the threshold at which a person notices a
   * delay and comfortably above the gap between two deliberate taps, so a run
   * of taps becomes one call. The cleanup cancels the pending one, so the
   * request that eventually goes is always for the basket as it finally stands.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      // Every state update in the loader happens after an `await`, so nothing
      // is set synchronously during this effect.
      void refreshPricing(appliedCoupon);
    }, PRICE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [refreshPricing, appliedCoupon]);

  /** The Apply button's own path, so it can show its own spinner. */
  const applyCoupon = async (code: string) => {
    setApplying(true);
    await refreshPricing(code);
    setApplying(false);
  };

  /*
   * Which of these addresses this restaurant will actually drive to.
   *
   * Computed during render from the restaurant document and the address
   * documents the screen already holds — no extra round trip — and computed by
   * `checkDeliveryRange`, the same function `createOrder` refuses the order
   * with. That shared function is the whole point: an address marked
   * deliverable here cannot be refused there, and one marked out of range here
   * would have been refused anyway.
   *
   * Until the restaurant document has loaded there is no circle to measure
   * against, so nothing is marked and the button is held by the pricing gate
   * instead — the screen never guesses.
   */
  const rangeByAddress = new Map<string, DeliveryRange>();
  if (restaurant) {
    for (const address of addresses) {
      rangeByAddress.set(address.id, checkDeliveryRange(restaurant, address));
    }
  }

  const chosenRange = addressId ? (rangeByAddress.get(addressId) ?? null) : null;
  const addressDeliverable = chosenRange === null || mayDeliverTo(chosenRange);

  /** The sentence a row gets when this restaurant cannot deliver to it. */
  const rangeNotice = (range: DeliveryRange | undefined) => {
    if (!range || mayDeliverTo(range)) return null;
    if (range.reason === 'address-not-pinned') {
      return { tone: 'warning' as const, text: t('checkout.addressNoPin') };
    }
    return {
      tone: 'danger' as const,
      text: `${t('checkout.addressOutOfRange')} · ${t('checkout.rangeDistance', {
        distance: ((range.distanceMetres ?? 0) / 1000).toFixed(1),
        radius: (range.radiusMetres / 1000).toFixed(1),
      })}`,
    };
  };

  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/cart" />
        <PageLoading label={t('common.loading')} />
      </AppShell>
    );
  }

  /*
   * A work account never reaches the checkout.
   *
   * `createOrder` and `previewOrder` both refuse it server-side, from the
   * stored user document — this is only so that a restaurant owner who typed
   * /checkout is told why instead of watching a pricing spinner that ends in an
   * error. Derived during render, and only once the identity is actually
   * known: before that, everybody looks like a customer.
   */
  if (!identityLoading && isWorkAccount(role)) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/" />
        <WorkAccountNotice role={role} />
      </AppShell>
    );
  }

  if (cart.hydrated && cart.lines.length === 0) {
    return (
      <AppShell>
        <ScreenHeader title={t('checkout.title')} fallbackHref="/cart" />
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

  // The sign-in wall. It appears here and nowhere earlier.
  if (!firebaseUser) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/cart" />
        <div className="mx-auto max-w-md py-6">
          <Card className="p-8 text-center">
            <h1 className="text-xl font-semibold text-ink-900">{t('checkout.loginRequired')}</h1>
            <p className="mt-2.5 text-ink-500">{t('checkout.loginHint')}</p>
            <div className="mt-6 space-y-2">
              <Link href="/login?next=/checkout" className="block">
                <Button fullWidth size="lg">
                  {t('auth.signIn')}
                </Button>
              </Link>
              <Link href="/login?next=/checkout" className="block">
                <Button fullWidth variant="secondary">
                  {t('auth.signUp')}
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Three gates, narrowest last: what the platform allows at all, what this
  // restaurant accepts, and what the code knows how to do. Offering a method
  // the server would refuse is a dead end at the worst possible moment.
  // Only the coupons that would survive this basket's restaurant and that the
  // customer has uses left on. The minimum-order test is left to the server:
  // a coupon just under the threshold should be visible, because adding one
  // more dish is exactly what the customer might do about it.
  const usableCoupons = myCouponList.filter(
    (coupon) =>
      coupon.remainingForMe > 0 &&
      (coupon.restaurantIds.length === 0 ||
        (cart.restaurantId !== null && coupon.restaurantIds.includes(cart.restaurantId))),
  );

  /*
   * What the platform offers when its settings document has not been read yet.
   *
   * The two methods settled at the door — never online card. Falling back to
   * the full V1 list offered a payment the server refuses whenever no provider
   * is configured, which is every deployment until somebody sets one up: the
   * customer picked it, filled the basket and only then met
   * "Onlayn ödəniş hələ qurulmayıb".
   */
  const platformMethods = settings?.enabledPaymentMethods ?? DEFAULT_ENABLED_PAYMENT_METHODS;
  const restaurantMethods = restaurant?.paymentMethods ?? DEFAULT_ENABLED_PAYMENT_METHODS;

  /*
   * Built by walking the platform's own list rather than the restaurant's.
   *
   * The restaurant's array is whatever was last written to its document, and a
   * document can hold the same value twice — an old onboarding write plus a
   * later settings save is enough. Filtering that array kept the duplicate, so
   * a restaurant that had switched online card on saw «Onlayn kart» listed
   * twice at checkout. Walking V1_PAYMENT_METHODS instead makes the list
   * unique and identically ordered for every restaurant, by construction.
   */
  const acceptedMethods = V1_PAYMENT_METHODS.filter(
    (method) => restaurantMethods.includes(method) && platformMethods.includes(method),
  );

  /*
   * The platform's own door, watched live.
   *
   * The server refuses the order regardless — see `orderingIsOpen` in
   * `createOrder`. This is what stops the customer getting that far: the
   * button goes away while the platform is closed, and comes back by itself
   * when the admin opens it, without the page being reloaded.
   */
  const canPlace =
    !maintenance.on &&
    Boolean(addressId) &&
    addressDeliverable &&
    Boolean(pricing) &&
    !pricing?.belowMinimum &&
    !pricingError &&
    acceptingOrders &&
    acceptedMethods.includes(paymentMethod as PaymentMethod);

  /**
   * The same conditions as `canPlace`, in the order a person can act on them:
   * fix the address first, then wait for the kitchen, then the basket, then the
   * card. A disabled button that does not say why is a dead end.
   */
  const blockReason = maintenance.on
    ? (maintenance.message ?? t('maintenance.body'))
    : !addressId
    ? t('checkout.blockedNoAddress')
    : chosenRange?.reason === 'address-not-pinned'
      ? t('checkout.blockedAddressNoPin')
      : !addressDeliverable
        ? t('checkout.blockedOutOfRange')
        : !acceptingOrders
          ? t('checkout.restaurantClosed')
          : pricing?.belowMinimum
            ? t('checkout.blockedMinimum')
            : pricingError
              ? pricingError
              : !acceptedMethods.includes(paymentMethod as PaymentMethod)
                ? t('checkout.blockedPayment')
                : !pricing
                  ? t('checkout.blockedPricing')
                  : null;

  const place = async () => {
    if (!cart.restaurantId || !addressId) return;

    setPlacing(true);
    setPlaceError(null);

    const result = await createOrder({
      restaurantId: cart.restaurantId,
      clientRequestId: requestId.current,
      paymentMethod,
      addressId,
      items,
      couponCode: appliedCoupon,
      customerNote: note.trim() || null,
      /*
       * The number the customer is looking at as they press this button.
       *
       * The server re-prices the basket from the live menu and refuses the
       * order if the items no longer come to this, so a price the restaurant
       * changed in the last thirty seconds surfaces as "the price changed" —
       * on this screen, before anything is ordered — instead of as a bigger
       * figure the customer discovers when the courier is at the door.
       *
       * The subtotal rather than the total: the delivery fee and the discount
       * are the server's own arithmetic, and comparing those would fail the
       * order over a rounding difference that has nothing to do with the menu.
       */
      expectedSubtotal: pricing?.subtotal,
    });

    setPlacing(false);

    if (!result.ok || !result.data) {
      setPlaceError(translateError(t, result.errorCode, result.errorDetail));
      // A fresh id for a genuinely new attempt — but only after a real failure.
      requestId.current = newRequestId();

      /*
       * "The price changed" is only half a sentence without the new price.
       *
       * The server refused because the menu moved under this basket, so the
       * figures on screen are the stale ones — the customer would be reading
       * the very number the order was just rejected for. Re-pricing puts the
       * real total in front of them, and the next press is a decision they are
       * making with their eyes open.
       */
      if (result.errorCode === 'PRICE_CHANGED') void refreshPricing(appliedCoupon);
      return;
    }

    const orderId = result.data.orderId;

    // Cash and card at the door are finished here. An online order is not: the
    // order exists but is worth nothing to anyone until the bank confirms it,
    // so the basket is only cleared once the customer is actually on their way
    // to pay — a failed redirect must not leave them with an empty basket and
    // an order they never paid for.
    if (paymentMethod !== PaymentMethod.ONLINE_CARD) {
      cart.clear();
      router.replace(`/orders/${orderId}`);
      return;
    }

    setPlacing(true);
    const payment = await startOnlinePayment(orderId);
    setPlacing(false);

    if (!payment.ok || !payment.data) {
      // The order is already stored and unpaid; sending them to it is better
      // than losing it, and the order screen offers the retry.
      setPlaceError(translateError(t, payment.errorCode, payment.errorDetail));
      cart.clear();
      router.replace(`/orders/${orderId}`);
      return;
    }

    cart.clear();
    // A full page navigation, not the router: the destination is the bank's,
    // not ours, and Next's client router has no business trying to own it.
    window.location.href = payment.data.redirectUrl;
  };

  return (
    <AppShell>
      <ScreenHeader
        title={t('checkout.title')}
        subtitle={
          cart.restaurantName ? `${t('cart.fromRestaurant')} · ${cart.restaurantName}` : undefined
        }
        fallbackHref="/cart"
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          {/* 1 — Address --------------------------------------------------- */}
          <Step number={1} title={t('checkout.address')}>
            {addresses.length === 0 ? (
              <Card className="p-5">
                <p className="text-ink-600">{t('checkout.noAddress')}</p>
                <p className="mt-1 text-sm text-ink-400">{t('account.addressesHint')}</p>
                <Button size="sm" className="mt-4" onClick={() => setAddingAddress(true)}>
                  <Plus size={16} aria-hidden /> {t('checkout.addAddress')}
                </Button>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {addresses.map((address) => (
                  <AddressRow
                    key={address.id}
                    address={address}
                    selected={addressId === address.id}
                    onSelect={() => setChosenAddressId(address.id)}
                    notice={rangeNotice(rangeByAddress.get(address.id))}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => setAddingAddress(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-300 p-4 text-sm font-medium text-ink-500 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
                >
                  <Plus size={16} aria-hidden /> {t('checkout.addAddress')}
                </button>
              </div>
            )}
          </Step>

          {/* 2 — Payment --------------------------------------------------- */}
          <Step number={2} title={t('checkout.payment')}>
            <div className="space-y-2.5" role="radiogroup" aria-label={t('checkout.payment')}>
              {acceptedMethods.map((method) => (
                <button
                  key={method}
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === method}
                  onClick={() => setPaymentMethod(method)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition',
                    paymentMethod === method
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-ink-200 bg-white hover:border-ink-300',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      paymentMethod === method
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-ink-300',
                    )}
                  >
                    {paymentMethod === method && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="text-[15px] text-ink-800">{t(`checkout.${method}`)}</span>
                </button>
              ))}

              {/* The place online payment will take, kept visible and honest —
                  but only while it is genuinely not on offer here. Once the
                  restaurant enables it, the real button above is the online
                  card, and this placeholder was the second «Onlayn kart» the
                  owner was looking at. */}
              {!acceptedMethods.includes(PaymentMethod.ONLINE_CARD) && (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 p-4">
                  <span aria-hidden className="h-5 w-5 shrink-0 rounded-full border border-ink-300" />
                  <span className="text-[15px] text-ink-400">{t('checkout.ONLINE_CARD')}</span>
                  <span className="ml-auto text-xs font-medium text-ink-400">
                    {t('checkout.onlineSoon')}
                  </span>
                </div>
              )}
            </div>
          </Step>

          {/* 3 — Coupon ---------------------------------------------------- */}
          <Step number={3} title={t('checkout.coupon')} optional={t('common.optional')}>
            {appliedCoupon ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3.5">
                <span className="flex items-center gap-2 font-medium text-success">
                  <Check size={16} aria-hidden />
                  {appliedCoupon}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null);
                    setCouponInput('');
                    setCouponError(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-ink-500 underline transition hover:text-ink-800"
                >
                  {t('checkout.couponRemove')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* The customer's own coupons, filtered to the ones that
                    actually work at THIS restaurant. Showing a coupon here
                    that the basket would then refuse is worse than showing
                    none — it reads as the app changing its mind at the till.
                    Typing a code by hand still works, for a coupon somebody
                    was handed rather than granted. */}
                {usableCoupons.length > 0 && (
                  <ul className="space-y-2">
                    {usableCoupons.map((coupon) => (
                      <li key={coupon.code}>
                        <button
                          type="button"
                          disabled={applying}
                          onClick={() => void applyCoupon(coupon.code)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60"
                        >
                          <TicketPercent size={18} className="shrink-0 text-brand-600" aria-hidden />

                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-ink-900">
                              {coupon.type === CouponType.PERCENT
                                ? t('coupons.percentOff', {
                                    value: (coupon.value / 100).toFixed(0),
                                  })
                                : coupon.type === CouponType.FREE_DELIVERY
                                  ? t('coupons.freeDelivery')
                                  : `${formatMinorUnits(coupon.value)} ₼`}
                            </span>
                            <span className="block font-mono text-xs text-ink-400">
                              {coupon.code}
                            </span>
                            {coupon.minSubtotal > 0 && (
                              <span className="block text-xs text-ink-500">
                                {t('coupons.minimum')} {formatMinorUnits(coupon.minSubtotal)} ₼
                              </span>
                            )}
                          </span>

                          <span className="shrink-0 text-sm font-medium text-brand-600">
                            {t('checkout.couponApply')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-start gap-2">
                  <Input
                    value={couponInput}
                    onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                    placeholder={t('checkout.couponPlaceholder')}
                    aria-label={t('checkout.coupon')}
                    maxLength={24}
                    error={couponError}
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    disabled={couponInput.trim().length < 3}
                    loading={applying}
                    onClick={() => void applyCoupon(couponInput.trim())}
                  >
                    {t('checkout.couponApply')}
                  </Button>
                </div>
              </div>
            )}
          </Step>

          {/* 4 — Note ------------------------------------------------------ */}
          <Step number={4} title={t('checkout.noteSection')} optional={t('common.optional')}>
            <Textarea
              label={t('checkout.note')}
              placeholder={t('checkout.notePlaceholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
            />
          </Step>
        </div>

        {/* The money column, in view while the steps above are filled in. */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-5">
            <h2 className="mb-4 text-base font-semibold text-ink-900">{t('checkout.summary')}</h2>

            {pricing ? (
              <dl className="space-y-2.5 text-[15px]">
                <div className="flex justify-between">
                  <dt className="text-ink-500">{t('cart.subtotal')}</dt>
                  <dd className="text-ink-900">
                    <Money amount={pricing.subtotal} />
                  </dd>
                </div>
                {pricing.discount > 0 && (
                  <div className="flex justify-between text-success">
                    <dt>{t('cart.discount')}</dt>
                    <dd>
                      −<Money amount={pricing.discount} />
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-ink-500">{t('cart.deliveryFee')}</dt>
                  <dd className="text-ink-900">
                    {pricing.deliveryFee === 0 ? (
                      <span className="font-medium text-success">{t('home.freeDelivery')}</span>
                    ) : (
                      <Money amount={pricing.deliveryFee} />
                    )}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-card-edge pt-3 text-lg font-semibold text-ink-900">
                  <dt>{t('cart.total')}</dt>
                  <dd>
                    <Money amount={pricing.total} />
                  </dd>
                </div>
              </dl>
            ) : (
              <InlineLoading label={t('checkout.blockedPricing')} className="justify-center py-4" />
            )}

            <div className="mt-4 space-y-2.5">
              {/* First in the stack, because it outranks every other reason
                  the order cannot be placed. */}
              <MaintenanceNotice />
              {pricingError && <Alert tone="danger">{pricingError}</Alert>}
              {!acceptingOrders && <Alert tone="warning">{t('checkout.restaurantClosed')}</Alert>}
              {/* The radius, said once where the money is, because the row
                  marking is easy to scroll past on a phone. */}
              {addressId && !addressDeliverable && (
                <Alert tone="danger">
                  {chosenRange?.reason === 'address-not-pinned'
                    ? t('checkout.blockedAddressNoPin')
                    : t('checkout.blockedOutOfRange')}
                </Alert>
              )}
              {pricing?.belowMinimum && restaurant && (
                <Alert tone="warning">
                  {t('cart.belowMinimum', {
                    amount: (restaurant.minOrderAmount / 100).toFixed(2),
                  })}
                </Alert>
              )}
              {placeError && <Alert tone="danger">{placeError}</Alert>}
            </div>

            <div className="mt-5">
              <Button fullWidth size="lg" loading={placing} disabled={!canPlace} onClick={place}>
                {placing
                  ? t('checkout.placing')
                  : t('checkout.place', {
                      total: pricing ? (pricing.total / 100).toFixed(2) : '—',
                    })}
              </Button>

              {!canPlace && blockReason && !placing && (
                <p className="mt-2.5 text-center text-sm text-ink-500" role="status">
                  {blockReason}
                </p>
              )}
            </div>

            <p className="mt-4 text-center text-xs text-ink-400">{t('auth.termsNotice')}</p>
          </Card>
        </aside>
      </div>

      {/* The restaurant this basket belongs to, so the map can say "we
          deliver here" while the pin is still being placed rather than after
          the address has been saved and chosen. */}
      <AddressForm
        open={addingAddress}
        onClose={() => setAddingAddress(false)}
        onSaved={(id) => setChosenAddressId(id)}
        origin={
          restaurant
            ? {
                name: restaurant.name,
                lat: restaurant.lat,
                lng: restaurant.lng,
                deliveryRadiusMeters: restaurant.deliveryRadiusMeters,
              }
            : null
        }
      />
    </AppShell>
  );
}

function Step({
  number,
  title,
  optional,
  children,
}: {
  number: number;
  title: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white"
        >
          {number}
        </span>
        <span className="text-base font-semibold text-ink-900">{title}</span>
        {optional && (
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
            {optional}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}
