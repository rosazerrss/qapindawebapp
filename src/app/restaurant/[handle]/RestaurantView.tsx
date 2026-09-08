'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Unsubscribe } from 'firebase/firestore';
import { Clock, MapPin, MessageSquare, Star, Truck } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  MaintenanceNotice,
  useMaintenance,
} from '@/components/customer/MaintenanceNotice';
import { PriceWithDiscount, ProductSheet } from '@/components/customer/ProductSheet';
import { AddButton, QuantityStepper } from '@/components/customer/QuantityStepper';
import { ReviewsSheet } from '@/components/customer/ReviewsSheet';
import { FavouriteButton } from '@/components/customer/FavouriteButton';
import { Alert, Badge, Button, EmptyState, Money, Sheet, cn } from '@/components/ui';
import { MenuSkeleton, PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useT } from '@/i18n';
import {
  getRestaurant,
  getRestaurantBySlug,
  idFromHandle,
  isOpenNow,
  watchMenu,
  watchRestaurant,
  type MenuSection,
} from '@/services/catalog';
import { brandTint, categoryEmblem } from '@/lib/brand';
import { restaurantCategories } from '@/shared/categories';
import { watchAddresses } from '@/services/addresses';
import { ProductAvailability, ServiceState } from '@/shared/enums';
import { checkDeliveryRange, mayDeliverTo } from '@/shared/geo';
import { isWorkAccount } from '@/shared/permissions';
import { isDiscountedProduct } from '@/shared/pricing';
import type { Address, Product, Restaurant } from '@/shared/models';
import { Img } from '@/components/ui/Img';

/** How long to wait for the menu before saying it did not arrive. */
const LOAD_TIMEOUT_MS = 8000;

export function RestaurantView({
  handle,
  initialRestaurant,
  initialSections,
}: {
  handle: string;
  /**
   * What the server already knows, rendered into the HTML before any script
   * runs.
   *
   * This is the whole SEO fix and it is worth being precise about why it takes
   * this shape. The page must stay interactive — the basket, the options sheet,
   * the delivery-radius warning are all client state — so it cannot simply
   * become a server component. Seeding the state instead means the FIRST render
   * (which happens on the server) already contains the restaurant's name and
   * every dish and price, and the live listener then takes over for anything
   * that changes while the page is open.
   *
   * Null when the server could not read Firestore — a laptop with no metadata
   * server, or a transient failure. The page then behaves exactly as it did
   * before: skeleton first, content when the listener answers.
   */
  initialRestaurant: Restaurant | null;
  initialSections: MenuSection[] | null;
}) {
  const t = useT();
  const cart = useCart();
  const maintenance = useMaintenance();
  const { firebaseUser, profile, role, identityLoading } = useAuth();

  // Both pieces carry the handle they belong to, and neither is written outside
  // an async callback. Clearing them at the top of the effect instead would
  // mean a synchronous state change on every render pass — and, worse, a moment
  // where the restaurant is from the new handle and the menu from the old one.
  const [loaded, setLoaded] = useState<{ handle: string; restaurant: Restaurant | null } | null>(
    initialRestaurant ? { handle, restaurant: initialRestaurant } : null,
  );
  const [menu, setMenu] = useState<{ handle: string; sections: MenuSection[] } | null>(
    initialSections ? { handle, sections: initialSections } : null,
  );
  const [active, setActive] = useState<Product | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [conflict, setConflict] = useState<{
    product: Product;
    optionIds: string[];
    quantity: number;
    note: string | null;
  } | null>(null);

  /**
   * Resolve the handle once, then stay subscribed.
   *
   * The id is read from the end of the handle, so a renamed restaurant keeps
   * working. Links printed on a flyer before handles existed carry the bare
   * slug, and those still have to open — hence the second lookup when the id
   * finds nothing. It is a one-shot read rather than a subscription because
   * only a definite "no such document" may trigger the fallback; a live
   * listener's first `null` could equally be a rule denying the read.
   *
   * Once resolved, the document and the menu are both watched: a price change,
   * a dish marked sold out, or the kitchen tapping "pause" reaches this screen
   * within the second. Without that, the customer taps Add and the server
   * refuses an order the page told them they could place.
   */
  /*
   * Whether the menu ever arrived.
   *
   * `onSnapshot` has no timeout: a blocked or half-open connection means the
   * callback simply never fires, and this page rendered `<MenuSkeleton/>` for
   * ever with nothing on screen to act on. The home page already solved this;
   * the restaurant page — the one somebody arrives on from a shared link — did
   * not. `attempt` is what "try again" bumps.
   */
  const [attempt, setAttempt] = useState(0);
  /*
   * Which attempt gave up, rather than a boolean.
   *
   * Derived during render by comparing it to the current key, so nothing has to
   * be cleared synchronously when the effect restarts — the same shape the home
   * page uses, and the reason neither of them needs a second render whose only
   * job is to catch up with the first.
   */
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const loadKey = `${handle}:${attempt}`;
  const timedOut = failedKey === loadKey;

  useEffect(() => {
    let cancelled = false;
    let stop: Unsubscribe | null = null;

    const timer = setTimeout(() => {
      if (!cancelled) setFailedKey(loadKey);
    }, LOAD_TIMEOUT_MS);

    void (async () => {
      const byId = await getRestaurant(idFromHandle(handle));
      const found = byId ?? (await getRestaurantBySlug(handle));
      if (cancelled) return;

      if (!found) {
        setLoaded({ handle, restaurant: null });
        return;
      }

      setLoaded({ handle, restaurant: found });

      const stopRestaurant = watchRestaurant(found.id, (live) => {
        if (!cancelled) setLoaded({ handle, restaurant: live });
      });
      const stopMenu = watchMenu(found.id, (live) => {
        if (cancelled) return;
        clearTimeout(timer);
        setMenu({ handle, sections: live });
      });

      stop = () => {
        stopRestaurant();
        stopMenu();
      };
      // The effect may already have been torn down while the reads were in
      // flight; without this the listeners would outlive the screen.
      if (cancelled) stop();
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [handle, attempt, loadKey]);

  /*
   * The customer's own addresses, so the delivery circle can be answered here
   * rather than three screens later at the checkout. A guest has none, and
   * nothing is asked of them: they are told about the radius when they have an
   * address to be told about.
   */
  useEffect(() => {
    if (!firebaseUser) return;
    return watchAddresses(firebaseUser.uid, setAddresses);
  }, [firebaseUser]);

  const restaurant = loaded?.handle === handle ? loaded.restaurant : undefined;
  const sections = menu?.handle === handle ? menu.sections : null;

  const open = useMemo(() => (restaurant ? isOpenNow(restaurant) : false), [restaurant]);
  const paused = restaurant?.serviceState === ServiceState.PAUSED;

  /*
   * WHO IS LOOKING, AND WHERE THEY LIVE.
   *
   * Two questions this page has to answer before it offers anybody a dish.
   *
   * A work account may not order at all — the server refuses it in
   * `createOrder`, and hiding the buttons here is the courtesy that keeps
   * somebody from building a basket they can never check out.
   *
   * And the restaurant's delivery circle is measured against the address the
   * customer would actually order to, using the same shared function the
   * server refuses the order with. The menu stays readable either way: being
   * outside the radius is a fact about the address, and the customer may well
   * have another one.
   */
  const workAccount = !identityLoading && isWorkAccount(role);

  const defaultAddress =
    addresses.find((address) => address.id === profile?.defaultAddressId) ??
    addresses.find((address) => address.isDefault) ??
    addresses[0] ??
    null;

  const range =
    restaurant && defaultAddress ? checkDeliveryRange(restaurant, defaultAddress) : null;
  const outOfRange = range !== null && !mayDeliverTo(range);

  const categories = restaurant ? restaurantCategories(restaurant) : [];
  const emblem = restaurant ? categoryEmblem(restaurant) : null;

  /**
   * How many of each dish are already in the cart, and which line to take one
   * off when the customer taps minus.
   *
   * A dish with options can sit in the cart as several lines — large with extra
   * cheese is not the same order as small without — and the row on the menu is
   * about the dish, not about one particular combination, so the number shown
   * is the total across those lines. Minus then works on the line added last,
   * because that is the one the customer just created and therefore the one
   * they mean; taking a portion off an earlier line would quietly edit a choice
   * they made a while ago. `add` appends new lines and rewrites existing ones in
   * place, so the last entry of the array is that most recently created line.
   */
  const inCart = useMemo(() => {
    const map = new Map<string, { total: number; lastLineId: string; lastQuantity: number }>();
    for (const line of cart.lines) {
      const previous = map.get(line.productId);
      map.set(line.productId, {
        total: (previous?.total ?? 0) + line.quantity,
        lastLineId: line.lineId,
        lastQuantity: line.quantity,
      });
    }
    return map;
  }, [cart.lines]);

  if (restaurant === undefined) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/" />
        <PageLoading label={t('common.loading')} />
      </AppShell>
    );
  }

  if (restaurant === null) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/" />
        <EmptyState
          title={t('errors.RESTAURANT_NOT_FOUND')}
          action={
            <Link href="/" className="text-sm font-medium text-brand-600 underline">
              {t('home.allRestaurants')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  const handleAdd = (optionIds: string[], quantity: number, note: string | null) => {
    if (!active) return;
    const result = cart.add(active, restaurant.name, optionIds, quantity, note);

    if (result.conflict) {
      // Do not silently throw away someone's cart — ask.
      setConflict({ product: active, optionIds, quantity, note });
    }
    setActive(null);
  };

  /**
   * The one-tap path: no sheet, no options, straight into the cart. Only ever
   * reached for a dish with no option groups — anything else has choices the
   * server needs, and inventing them here would send an order nobody placed.
   */
  const quickAdd = (product: Product) => {
    const result = cart.add(product, restaurant.name, [], 1);
    if (result.conflict) setConflict({ product, optionIds: [], quantity: 1, note: null });
  };

  return (
    <AppShell>
      <ScreenHeader fallbackHref="/" className="mb-2" />

      {/* Before the menu, not after it. Somebody who cannot order should read
          that while they are still deciding whether to look. */}
      <MaintenanceNotice className="mb-4" />

      {/* The same tinted field the cards use when there is no photograph, so a
          restaurant looks like itself on the way in and once it is open. */}
      <div
        className="relative -mx-4 mb-4 h-40 overflow-hidden sm:mx-0 sm:h-56 sm:rounded-2xl"
        style={{ background: brandTint(restaurant.brandColor) }}
      >
        {restaurant.coverUrl ? (
           
          <Img
            src={restaurant.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover sm:rounded-2xl"
          />
        ) : (
          emblem && (
            <span
              aria-hidden
              className="flex h-full w-full items-center justify-center text-6xl opacity-80"
            >
              {emblem}
            </span>
          )
        )}
      </div>

      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{restaurant.name}</h1>
        {restaurant.tagline && <p className="mt-1 text-ink-500">{restaurant.tagline}</p>}

        {/* Each one is the way back out to everything else of this kind — the
            same rail the customer came in through, already narrowed. */}
        {categories.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {categories.map((id) => (
              <Link
                key={id}
                href={`/?kateqoriya=${id}`}
                className="inline-flex min-h-8 items-center rounded-full bg-ink-50 px-3 py-1 text-sm text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
              >
                {t(`categories.${id}`)}
              </Link>
            ))}
          </div>
        )}

        {/* The score and the way to read the reviews behind it sit together:
            a number nobody can check is only half an answer. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {restaurant.ratingCount > 0 ? (
            <span className="flex items-center gap-1 text-sm text-ink-700">
              <Star size={16} className="fill-amber-400 text-amber-400" />
              <span className="font-medium">{restaurant.ratingAverage.toFixed(1)}</span>
              <span className="text-ink-400">
                ({t('review.count', { count: restaurant.ratingCount })})
              </span>
            </span>
          ) : (
            <span className="text-sm text-ink-400">{t('review.none')}</span>
          )}

          <Button size="sm" variant="secondary" onClick={() => setReviewsOpen(true)}>
            <MessageSquare size={15} />
            {t('review.title')}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-600">
          <span className="flex items-center gap-1.5">
            <Clock size={15} />
            {restaurant.estimatedMinutesMin}–{restaurant.estimatedMinutesMax} {t('common.minutes')}
          </span>
          <span className="flex items-center gap-1.5">
            <Truck size={15} />
            {restaurant.deliveryFee === 0 ? (
              t('home.freeDelivery')
            ) : (
              <Money amount={restaurant.deliveryFee} />
            )}
          </span>
          {restaurant.minOrderAmount > 0 && (
            <span>
              {t('home.minOrder')}: <Money amount={restaurant.minOrderAmount} />
            </span>
          )}
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-400">
          <MapPin size={14} /> {restaurant.addressLine}
        </p>
        <p className="mt-1 text-sm text-ink-400">{t('restaurant.deliversOwn')}</p>
      </header>

      {/* Two different situations that both stop an order, and the customer is
          told which one it is: "paused" ends today, "closed" ends at opening
          time. Saying only "unavailable" makes people leave. */}
      {!open && (
        <div className="mb-5">
          <Alert tone="warning">
            {paused ? t('restaurant.pausedNotice') : t('restaurant.closedNotice')}
          </Alert>
        </div>
      )}

      {/* Said before the menu, not after the basket: "this restaurant does not
          deliver to you" is the first thing worth knowing about a shop, and
          the address it is about is named so the customer can tell which of
          theirs is meant. */}
      {outOfRange && defaultAddress && (
        <div className="mb-5">
          <Alert tone={range?.reason === 'address-not-pinned' ? 'warning' : 'danger'}>
            <span className="block font-medium">{t('restaurant.outOfRangeTitle')}</span>
            <span className="mt-1 block">
              {range?.reason === 'address-not-pinned'
                ? t('restaurant.addressNoPinBody', { address: defaultAddress.label })
                : t('restaurant.outOfRangeBody', { address: defaultAddress.label })}
            </span>
          </Alert>
        </div>
      )}

      {workAccount && (
        <div className="mb-5">
          <Alert tone="info">{t('workAccount.menuNotice')}</Alert>
        </div>
      )}

      {sections === null && timedOut ? (
        /*
         * Not an empty menu — we could not find out what the menu is. Saying
         * "bu restoranda yemək yoxdur" here would be a lie told to somebody
         * whose connection dropped, and it would send them away from a
         * restaurant that is open.
         */
        <EmptyState
          title={t('home.loadFailed')}
          hint={t('home.loadFailedHint')}
          action={
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : sections === null ? (
        <MenuSkeleton />
      ) : sections.length === 0 ? (
        <EmptyState title={t('common.empty')} />
      ) : (
        <>
          {/* A sticky rail so a long menu stays navigable on a phone. */}
          <nav className="no-scrollbar sticky top-14 z-20 -mx-4 mb-4 flex gap-2 overflow-x-auto bg-canvas/95 px-4 py-2.5 backdrop-blur">
            {sections.map((section) => (
              <a
                key={section.category.id}
                href={`#kateqoriya-${section.category.id}`}
                className="shrink-0 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm text-ink-700 hover:border-brand-300"
              >
                {section.category.name}
              </a>
            ))}
          </nav>

          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.category.id} id={`kateqoriya-${section.category.id}`}>
                <h2 className="mb-3 text-lg font-semibold text-ink-900">
                  {section.category.name}
                </h2>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {section.products.map((product) => {
                    const soldOut = product.availability !== ProductAvailability.AVAILABLE;

                    // A dish with options cannot be added blind: the plus opens
                    // the sheet instead, and says so in its label rather than
                    // promising an add it will not perform.
                    const hasOptions = (product.modifierGroups?.length ?? 0) > 0;
                    const optionsLabel = t('restaurant.chooseOptionsFor', { name: product.name });

                    // Before hydration the cart is empty by definition, so the
                    // row starts as a plain plus and gains its count once the
                    // stored cart is read — never a server/client mismatch.
                    const entry = cart.hydrated ? inCart.get(product.id) : undefined;

                    const blocked = soldOut || !open || workAccount;
                    const blockedReason = soldOut
                      ? t('restaurant.outOfStock')
                      : workAccount
                        ? t('workAccount.menuNotice')
                        : paused
                          ? t('restaurant.pausedNotice')
                          : t('restaurant.closedNotice');

                    const openOrAdd = () => (hasOptions ? setActive(product) : quickAdd(product));

                    return (
                      // A row, not a button: the heart lives inside it and a
                      // button inside a button is invalid — and would be
                      // disabled along with the parent when a dish sells out,
                      // which is exactly when people want to save it.
                      <div
                        key={product.id}
                        className={cn(
                          'relative flex items-start gap-3 rounded-2xl border border-card-edge bg-white p-3 transition',
                          !soldOut && open && 'hover:border-brand-200 hover:shadow-sm',
                          soldOut && 'opacity-60',
                        )}
                      >
                        {/* Closed or paused disables every way into the cart.
                            The server refuses such an order anyway; this exists
                            so nobody builds a basket first and is told after. */}
                        <button
                          onClick={() => setActive(product)}
                          disabled={blocked}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-not-allowed"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium text-ink-900">
                                {product.name}
                              </span>
                              {/*
                                The word, once, and only the word.

                                The struck-through "before" figure is already
                                under the name — the saving is visible without a
                                second number. This is the mark somebody scanning
                                a menu of forty dishes catches, and it says
                                "Endirim" and nothing else: no percentage, no
                                code, no conditions. A badge that carries terms
                                is a badge nobody finishes reading.

                                COMPUTED, NOT READ FROM `discounted`.
                                The stored flag exists for a query the shopfront
                                runs across every restaurant, and it is only
                                right once the menu backfill has written it. Here
                                the dish itself is in hand, so the same shared
                                rule answers directly — and the mark is correct
                                on a menu saved five minutes ago as well as on
                                one saved last year.
                              */}
                              {isDiscountedProduct(product) && (
                                <Badge tone="brand">{t('badge.DISCOUNT')}</Badge>
                              )}
                              {product.popular && !isDiscountedProduct(product) && (
                                <Badge tone="neutral">{t('restaurant.popular')}</Badge>
                              )}
                            </span>

                            {product.description && (
                              <span className="mt-1 line-clamp-2 block text-sm text-ink-500">
                                {product.description}
                              </span>
                            )}

                            <span className="mt-2 block font-medium text-ink-900">
                              <PriceWithDiscount product={product} />
                            </span>

                            {soldOut ? (
                              <span className="mt-1 block text-sm text-ink-400">
                                {t('restaurant.outOfStock')}
                              </span>
                            ) : !open ? (
                              <span className="mt-1 block text-sm text-ink-400">
                                {t(paused ? 'home.paused' : 'home.closed')}
                              </span>
                            ) : null}
                          </span>

                          {product.imageUrl && (
                             
                            <Img
                              src={product.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-20 w-20 shrink-0 rounded-xl object-cover"
                            />
                          )}
                        </button>

                        {/* Sits at the bottom of the row, clear of the heart in
                            the corner, so neither control is a mis-tap away
                            from the other. */}
                        {entry ? (
                          <QuantityStepper
                            className="self-end"
                            name={product.name}
                            quantity={entry.total}
                            disabled={blocked}
                            disabledReason={blocked ? blockedReason : undefined}
                            increaseLabel={hasOptions ? optionsLabel : undefined}
                            onDecrease={() =>
                              cart.setQuantity(entry.lastLineId, entry.lastQuantity - 1)
                            }
                            onIncrease={openOrAdd}
                          />
                        ) : (
                          <AddButton
                            className="self-end"
                            name={product.name}
                            disabled={blocked}
                            disabledReason={blocked ? blockedReason : undefined}
                            label={hasOptions ? optionsLabel : undefined}
                            onClick={openOrAdd}
                          />
                        )}

                        <FavouriteButton
                          kind="PRODUCT"
                          targetId={product.id}
                          size={16}
                          className="absolute right-1.5 top-1.5"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* A dish sheet keyed per product, so its state resets naturally. */}
      <ProductSheet
        key={active?.id ?? 'none'}
        product={active}
        open={Boolean(active)}
        onClose={() => setActive(null)}
        onAdd={handleAdd}
        disabled={!open || workAccount}
      />

      <ReviewsSheet
        open={reviewsOpen}
        onClose={() => setReviewsOpen(false)}
        restaurantId={restaurant.id}
        average={restaurant.ratingAverage}
        count={restaurant.ratingCount}
      />

      <Sheet
        open={Boolean(conflict)}
        onClose={() => setConflict(null)}
        title={t('cart.title')}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setConflict(null)}>
              {t('cart.keepCart')}
            </Button>
            <Button
              fullWidth
              onClick={() => {
                if (!conflict) return;
                cart.replaceWith(
                  conflict.product,
                  restaurant.name,
                  conflict.optionIds,
                  conflict.quantity,
                  conflict.note,
                );
                setConflict(null);
              }}
            >
              {t('cart.clearAndAdd')}
            </Button>
          </div>
        }
      >
        <p className="text-ink-700">{t('cart.differentRestaurant')}</p>
        {cart.restaurantName && (
          <p className="mt-2 text-sm text-ink-400">{cart.restaurantName}</p>
        )}
      </Sheet>

      {/* A floating bar so the cart is never more than one tap away. */}
      {cart.hydrated && cart.itemCount > 0 && !workAccount && !maintenance.on && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-4 sm:bottom-6">
          <Link href="/cart" className="mx-auto block max-w-md">
            <Button fullWidth size="lg" className="shadow-lg">
              <span className="flex-1 text-left">
                {t('cart.itemCount', { count: cart.itemCount })}
              </span>
              <Money amount={cart.estimatedSubtotal} />
            </Button>
          </Link>
        </div>
      )}
    </AppShell>
  );
}
