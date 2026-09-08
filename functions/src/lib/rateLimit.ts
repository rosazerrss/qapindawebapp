/**
 * QAPINDA — how often one person may call one function.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Ninety-nine callables, and until now six of them had any limit at all. The
 * six were the ones where a limit was obviously part of the feature — an SMS
 * code, an email code, a support message. Everything else was open: a signed-in
 * customer with a loop could call `previewOrder` four hundred times a second.
 *
 * That matters most for one function in particular. `previewOrder` prices a
 * basket against a coupon code and answers "valid" or "not valid". Unlimited,
 * it is a free oracle for guessing live coupon codes — and coupon codes are
 * short, human-typed and shared on Instagram, so they are guessable. The same
 * shape appears elsewhere in smaller ways: `searchMenu` reads Firestore on
 * every keystroke, menu writes cost money, `sendTestNotification` sends a push.
 *
 * WHERE IT IS APPLIED
 * -------------------
 * In `guard()`, which every one of the ninety-nine already passes through. One
 * place, and a function added next year is covered on the day it is written
 * rather than the day somebody remembers. The scheduled jobs and the Epoint
 * callback do NOT use `guard`, so neither is affected — rate-limiting a payment
 * provider's callback would be a way to lose money.
 *
 * TWO LAYERS, AND THE HONEST LIMITS OF EACH
 * -----------------------------------------
 * 1. IN MEMORY, on every call, free. A sliding window per caller per function,
 *    held in the instance's own memory. It is *per instance*: Cloud Run may be
 *    running twenty of them, so a determined attacker who happens to spread
 *    across all twenty gets twenty times the budget. That is not a good
 *    guarantee — it is a cheap one, and twenty times a limit is still bounded
 *    where no limit at all is not.
 *
 * 2. IN FIRESTORE, for a short named list. One transaction per call, so it is
 *    real money and is spent only where the in-memory ceiling is not good
 *    enough: the coupon oracle, and anything that sends a message to a person.
 *
 * NEITHER IS THE REAL ANSWER. App Check is: it stops the caller being a script
 * at all. This is the layer underneath, for the day a real signed-in account
 * misbehaves — which App Check cannot see, because that account has a perfectly
 * good token.
 *
 * WHAT IS COUNTED
 * ---------------
 * The account, when there is one. The IP address, when there is not. Not the
 * phone and not the device: this is about protecting the server from volume,
 * and the person-level limits (one active order, three cancellations a week,
 * one coupon per human) are business rules that live where the business rule
 * lives, not here.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now } from './admin';
import { fail } from './errors';
import { AppErrorCode } from '../shared/errors';

export interface Budget {
  /** How many calls are allowed inside the window. */
  calls: number;
  windowMs: number;
  /**
   * Count in Firestore rather than in this instance's memory.
   *
   * Costs one transaction per call. Worth it only where an attacker spreading
   * across instances would defeat the point of the limit.
   */
  durable?: boolean;
}

/**
 * The default, and why it is loose.
 *
 * A limit's job here is to stop a script, not to police a person. A restaurant
 * on a busy Friday reorders its menu, flips six items to sold out and answers
 * nine orders inside a minute, and every one of those is a callable. A budget
 * tight enough to be interesting to an attacker would refuse that kitchen its
 * dinner service — which is a far more expensive failure than the one it
 * prevents. Ninety a minute is roughly one and a half calls a second, sustained,
 * from one account: comfortably above anything a person does with their hands
 * and comfortably below what a loop does.
 */
export const DEFAULT_BUDGET: Budget = { calls: 90, windowMs: 60_000 };

/**
 * The exceptions, each with the reason it is not the default.
 *
 * A name absent from this table gets `DEFAULT_BUDGET`. The six callables that
 * already carry their own domain limits — the SMS and email codes, support
 * messages, open tickets — keep those; this sits above them and catches the
 * volume they were never meant to measure.
 */
export const BUDGETS: Record<string, Budget> = {
  /*
   * The coupon oracle. Durable, because this is the one an attacker would
   * actually bother to spread across instances: each call is a free guess at a
   * live code, and a code is worth real money.
   *
   * Sixty a minute is deliberately generous. Only the checkout screen calls it,
   * on a 350 ms debounce, and only when the basket, the address or the coupon
   * actually changes — so real use is nowhere near it. The generosity costs
   * almost nothing in protection, because guessing a coupon code needs orders of
   * magnitude more than a few thousand tries an hour, and it buys the thing
   * worth buying: a customer who fiddles with their order for a minute is never
   * told to wait at the moment they are trying to pay.
   */
  previewOrder: { calls: 60, windowMs: 60_000, durable: true },

  /*
   * Order creation. The business rules already allow only one live order, so
   * this is not about ordering too much dinner — it is about the *failed*
   * attempts, which cost the same reads and write nothing to stop themselves.
   */
  createOrder: { calls: 12, windowMs: 60_000 },

  /*
   * Search reads Firestore on a debounce, so it is the highest-volume callable
   * in the app by some distance and the one most worth capping on cost alone.
   * In memory rather than durable: a Firestore write to police a Firestore read
   * costs more than the read it is policing.
   */
  searchMenu: { calls: 60, windowMs: 60_000 },

  /*
   * Anything that puts a message on somebody's phone is durable, whatever the
   * volume. An instance-local limit on a push sender means the twentieth
   * instance can still buzz a person at three in the morning.
   */
  sendTestNotification: { calls: 5, windowMs: 60_000, durable: true },
  registerPushToken: { calls: 20, windowMs: 60_000 },

  /* Money leaving, and a restaurant's takings. Low volume by nature. */
  startOnlinePayment: { calls: 10, windowMs: 60_000, durable: true },
  refundPayment: { calls: 20, windowMs: 60_000 },

  /* One-per-person actions. A second call is a mistake or a script. */
  applyForRestaurant: { calls: 5, windowMs: 60_000, durable: true },
  submitReview: { calls: 10, windowMs: 60_000 },
  fileComplaint: { calls: 5, windowMs: 60_000, durable: true },
  requestAccountDeletion: { calls: 3, windowMs: 60_000, durable: true },

  /*
   * Kept deliberately high. `touchSession` is called on every app start and
   * every wake from background; a tight budget here would report a rate limit
   * to somebody who did nothing but open the app twice.
   */
  touchSession: { calls: 240, windowMs: 60_000 },

  /* Menu editing during a real service. Generous on purpose — see DEFAULT. */
  saveProduct: { calls: 120, windowMs: 60_000 },
  setProductAvailability: { calls: 180, windowMs: 60_000 },
  reorderProducts: { calls: 60, windowMs: 60_000 },
  updateOrderStatus: { calls: 180, windowMs: 60_000 },
};

// ---------------------------------------------------------------------------
// Layer 1 — this instance's memory.
// ---------------------------------------------------------------------------

interface Window {
  count: number;
  /** When the current window opened, in epoch millis. */
  openedAt: number;
}

/**
 * The whole table, capped.
 *
 * An unbounded map keyed by caller is a memory leak with a friendly name: every
 * uid and every IP that ever called stays until the instance is recycled. The
 * cap makes it a cache instead — and eviction is deliberately the *oldest
 * window*, not the least recently used, because an entry whose window has
 * already expired is worth nothing and there is no reason to keep it over one
 * still counting.
 */
const MAX_KEYS = 20_000;
const windows = new Map<string, Window>();

function evictIfFull(): void {
  if (windows.size < MAX_KEYS) return;

  // Drop everything already expired first. That is almost always enough.
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, window] of windows) {
    if (window.openedAt < cutoff) windows.delete(key);
  }

  // Still full — an unusual burst of distinct callers. Drop the oldest tenth
  // rather than clearing everything, so a flood cannot reset every limit in
  // the process by simply being wide enough.
  if (windows.size >= MAX_KEYS) {
    const oldest = [...windows.entries()]
      .sort((a, b) => a[1].openedAt - b[1].openedAt)
      .slice(0, Math.floor(MAX_KEYS / 10));
    for (const [key] of oldest) windows.delete(key);
  }
}

/** True when this call fits inside the budget. Counts the call either way. */
export function allowInMemory(key: string, budget: Budget, atMs = Date.now()): boolean {
  const window = windows.get(key);

  if (!window || atMs - window.openedAt >= budget.windowMs) {
    evictIfFull();
    windows.set(key, { count: 1, openedAt: atMs });
    return true;
  }

  window.count += 1;
  return window.count <= budget.calls;
}

/** Test seam — the map is module-level and would otherwise leak between cases. */
export function resetInMemoryLimits(): void {
  windows.clear();
}

// ---------------------------------------------------------------------------
// Layer 2 — Firestore, for the short list.
// ---------------------------------------------------------------------------

/**
 * A fixed window rather than a sliding one.
 *
 * The window index is part of the document id, so a new window is a new
 * document and the old one simply stops being read. That costs nothing to
 * expire and cannot drift; the price is that a caller who lands at the very end
 * of one window and the very start of the next gets two budgets back to back.
 * For the values in this table — five, ten, thirty a minute — that is a rounding
 * error against the thing being prevented.
 */
export function rateLimitDocId(name: string, subject: string, atMs: number, windowMs: number): string {
  const index = Math.floor(atMs / windowMs);
  // The subject can be an IPv6 address, which contains colons; document ids may
  // not contain `/` but a colon is fine, and the parts are joined with `~` so
  // no address can forge a different function's key.
  return `${name}~${subject.replace(/[/~]/g, '_')}~${index}`;
}

async function allowDurable(
  name: string,
  subject: string,
  budget: Budget,
  atMs: number,
): Promise<boolean> {
  const ref = db.collection('rateLimits').doc(rateLimitDocId(name, subject, atMs, budget.windowMs));

  try {
    return await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const count = ((snapshot.data()?.count as number | undefined) ?? 0) + 1;

      tx.set(
        ref,
        {
          count,
          name,
          // Read by the daily prune. Stored rather than derived from the id so
          // the prune is one indexed query instead of parsing every id.
          expiresAt: new Date(atMs + budget.windowMs + 60_000),
          updatedAt: now(),
        },
        { merge: true },
      );

      return count <= budget.calls;
    });
  } catch (error) {
    /*
     * Firestore is unreachable or the transaction lost too many times.
     *
     * FAIL OPEN. A rate limiter that refuses everybody when its own storage is
     * having a bad minute has turned a hardening layer into an outage — and the
     * in-memory layer above has already had its say. The alternative, failing
     * closed, means one Firestore hiccup stops the platform taking orders.
     */
    logger.warn('rate limit storage unavailable — allowing', {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// What `guard` calls.
// ---------------------------------------------------------------------------

/** Who is being counted: the account, or the address when there is no account. */
export function subjectOf(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (uid) return `u:${uid}`;

  const ip = request.rawRequest?.ip;
  return ip ? `ip:${ip}` : 'anon';
}

/**
 * Refuses with `RATE_LIMITED` when the caller is over budget.
 *
 * The in-memory check runs first and always, so a caller already over the local
 * ceiling never reaches Firestore — which is the point of having both: the
 * cheap layer absorbs the flood, and the expensive one only ever sees traffic
 * that already looks reasonable.
 */
export async function enforceRateLimit(
  name: string,
  request: CallableRequest<unknown>,
): Promise<void> {
  const budget = BUDGETS[name] ?? DEFAULT_BUDGET;
  const subject = subjectOf(request);
  const key = `${name}~${subject}`;

  if (!allowInMemory(key, budget)) {
    logger.warn('rate limited (memory)', { name, subject, budget: budget.calls });
    fail(AppErrorCode.RATE_LIMITED, name);
  }

  if (!budget.durable) return;

  if (!(await allowDurable(name, subject, budget, Date.now()))) {
    logger.warn('rate limited (durable)', { name, subject, budget: budget.calls });
    fail(AppErrorCode.RATE_LIMITED, name);
  }
}
