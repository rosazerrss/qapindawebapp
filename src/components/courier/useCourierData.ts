'use client';

/**
 * The courier app's three subscriptions, in one place.
 *
 * The dashboard counts the active deliveries, the active list draws them, and
 * the account screen counts them again — three screens asking one question, and
 * three copies of "subscribe, remember whether it failed" is three places for
 * the failure state to be got subtly differently. So each subscription is a
 * hook here and every screen reads the same shape.
 *
 * "NOT LOADED YET" AND "LOADED, AND EMPTY" ARE DIFFERENT ANSWERS
 * -------------------------------------------------------------
 * `orders === null` is the first, `orders === []` is the second, and `failed`
 * is a third that is neither: a refused or broken subscription must never
 * render as "you have no deliveries" — a driver who is told that when the app
 * is actually broken simply goes home — and must never render as a spinner that
 * never resolves.
 */

import { useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import {
  watchCourierActiveOrders,
  watchCourierHistory,
  watchCourierOrder,
} from '@/services/courier';
import { watchRestaurant } from '@/services/catalog';
import { watchPublicSettings } from '@/services/settings';
import { DELIVERY_CODE_POLICY, deliveryCodePolicyOf } from '@/shared/deliveryCode';
import { UserRole } from '@/shared/enums';
import type { Order, PublicSettings } from '@/shared/models';

export interface CourierOrdersState {
  /** Null until the first snapshot lands. */
  orders: Order[] | null;
  /** The subscription was refused or broke. Not the same as an empty round. */
  failed: boolean;
  /**
   * Try the subscription again, without reloading the page.
   *
   * The retry button used to call `window.location.reload()`. On a courier's
   * phone, on a weak connection, that is the worst available answer: it throws
   * away the whole application, re-downloads it over the same connection that
   * just failed, and signs the driver back in — all to re-establish one
   * listener. This tears down that listener and opens a new one, which is the
   * only thing that was ever wrong.
   */
  retry: () => void;
}

/**
 * Whether the restaurant wants a code at the door.
 *
 * Four values, deliberately, because the difference between them changes what
 * the driver is asked to do: `true` means type six digits, `false` means one
 * button, `'loading'` means the answer is still on its way, and `'unknown'`
 * means it is not coming. The last two both leave the screen fully usable — the
 * server checks the code regardless, so the honest thing under either is to
 * offer the box and let it decide. Only `'unknown'` says so out loud.
 */
export type CodePolicy = boolean | 'loading' | 'unknown';

/** The deliveries in this driver's hands right now. */
export function useCourierActiveOrders(): CourierOrdersState {
  const { firebaseUser, role } = useAuth();
  const uid = role === UserRole.RESTAURANT_COURIER ? (firebaseUser?.uid ?? null) : null;

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);
  /*
   * Bumping this re-runs the effect, which is what "retry" means here: the old
   * unsubscribe runs, a fresh listener opens. A counter rather than a boolean
   * so that a second tap after a second failure also counts.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    return watchCourierActiveOrders(
      uid,
      (next) => {
        setOrders(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [uid, attempt]);

  return { orders, failed, retry: () => setAttempt((n) => n + 1) };
}

/** The deliveries this driver has finished, well or badly. Never anyone else's. */
export function useCourierHistory(): CourierOrdersState {
  const { firebaseUser, role } = useAuth();
  const uid = role === UserRole.RESTAURANT_COURIER ? (firebaseUser?.uid ?? null) : null;

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    return watchCourierHistory(
      uid,
      (next) => {
        setOrders(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [uid, attempt]);

  return { orders, failed, retry: () => setAttempt((n) => n + 1) };
}

export interface CourierOrderState {
  /** Undefined while loading, null when there is nothing this account may read. */
  order: Order | null | undefined;
  failed: boolean;
}

/**
 * One delivery, by id.
 *
 * A refusal — somebody else's order id typed into the address bar, or an order
 * reassigned away while the screen was open — arrives as an error rather than
 * as a missing document, and both end up saying the same honest thing: this
 * order is not on your list.
 */
export function useCourierOrder(orderId: string): CourierOrderState {
  const { firebaseUser, role } = useAuth();
  const uid = role === UserRole.RESTAURANT_COURIER ? (firebaseUser?.uid ?? null) : null;

  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uid) return;
    return watchCourierOrder(
      orderId,
      (next) => {
        setOrder(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [uid, orderId]);

  return { order, failed };
}

/**
 * The one thing this app needs from the restaurant document.
 *
 * A courier is not restaurant staff — `ownsRestaurant()` in the rules
 * deliberately excludes the role — so this read is only permitted while the
 * restaurant is ACTIVE, and it can legitimately fail. When it does, the screen
 * says so and stays usable.
 */
export function useDeliveryCodePolicy(): CodePolicy {
  const { role, restaurantId } = useAuth();
  const isCourier = role === UserRole.RESTAURANT_COURIER;

  const [subscribed, setSubscribed] = useState<CodePolicy>('loading');

  /*
   * THE PLATFORM'S ANSWER, WHICH USUALLY SETTLES IT.
   *
   * `publicSettings` is readable by everyone — the shopfront reads it — so
   * unlike the restaurant document below, this read cannot fail for permission
   * reasons. Under the default policy of ALWAYS it answers on its own and the
   * restaurant document is never needed, which also means a courier whose
   * restaurant they cannot read still gets a definite answer instead of
   * "unknown".
   */
  const [platform, setPlatform] = useState<PublicSettings | null | 'loading'>('loading');

  useEffect(() => {
    if (!isCourier) return;
    return watchPublicSettings((next) => setPlatform(next));
  }, [isCourier]);

  useEffect(() => {
    if (!isCourier || !restaurantId) return;

    return watchRestaurant(
      restaurantId,
      (next) => setSubscribed(next ? next.requireDeliveryCode === true : 'unknown'),
      () => setSubscribed('unknown'),
    );
  }, [restaurantId, isCourier]);

  // Derived during render rather than written into state from an effect, which
  // would be a render whose only job is to cause another one.
  if (platform === 'loading') return 'loading';

  /*
   * The platform override, when it is on, settles it without reading the
   * restaurant at all. It is off by default, so this branch is normally not
   * taken — see `shared/deliveryCode.ts`.
   */
  if (platform && deliveryCodePolicyOf(platform) === DELIVERY_CODE_POLICY.ALWAYS) return true;

  /*
   * Settings unreadable falls through to the restaurant's own answer, not to
   * "yes".
   *
   * This is the reverse of what it said a version ago, and the reason is the
   * customer's screen: it decides whether to offer "kodu göstər" from the same
   * resolved answer. A courier screen that demanded a code because a settings
   * document failed to load would be a driver at a door asking for six digits
   * the customer was never shown. "No code" is recoverable. "Cannot deliver"
   * is not.
   */

  // An account with no restaurant on it never subscribes, so there is nothing
  // to wait for.
  return restaurantId ? subscribed : 'unknown';
}
