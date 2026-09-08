/**
 * QAPINDA — the pre-launch test-data reset.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The platform is not open yet. The owner is placing orders through it to see
 * what the screens do, and those orders carry payments, ledger entries,
 * settlements, reviews and notifications behind them. Before real customers
 * arrive he wants all of it gone, in one deliberate action, without losing the
 * restaurants he has set up or the accounts that exist.
 *
 * WHY THE RULES OF THIS FILE ARE STRICTER THAN THE FEATURE SOUNDS
 * --------------------------------------------------------------
 * Everything else in this system treats a financial record as something you
 * anonymise rather than delete, and an audit entry as something nobody may
 * touch at all. This one callable genuinely destroys ledger entries and
 * payments, because before launch those records describe nothing that ever
 * happened. That is only safe while it is impossible to fire by accident on a
 * live platform, so the permission to run it is not the only gate:
 *
 *   1. the caller must be a SUPER_ADMIN, checked server-side;
 *   2. `publicSettings.testDataResetEnabled` must be explicitly true — it is
 *      absent, and therefore false, on every deployment until somebody turns
 *      it on and that switch is itself audited;
 *   3. the caller must type the platform's name;
 *   4. every collection is opted into one at a time. There is no "everything".
 *
 * `refuseReset` below is where 1 to 3 are decided, and it is a pure function so
 * that the refusals can be tested without a database. The callable calls it and
 * does nothing else until it returns null.
 *
 * WHAT IS NEVER DELETED
 * ---------------------
 * `RESET_PROTECTED_COLLECTIONS` is the list, and it is not advice — the
 * callable derives its work from `resetTargets()` and there is no code path
 * that reaches a collection this file does not name. Accounts, the phone and
 * email uniqueness locks, restaurants and their menus, the platform settings,
 * consents and the audit log all survive; the reset writes *itself* into the
 * audit log, and that entry survives with them.
 */

import { COLLECTIONS, SUBCOLLECTIONS } from './collections';
import { AppErrorCode } from './errors';
import { UserRole } from './enums';

/** The name the owner has to type out before anything is deleted. */
export const PLATFORM_NAME = 'Qapında';

/**
 * One switch on the dialog, and one group of collections behind it.
 *
 * Grouped by what a person would say out loud — "the payments", "the money" —
 * rather than one switch per collection, because `payments` without
 * `paymentEvents` and `ledgerEntries` without `settlements` are half-states
 * nobody would deliberately ask for.
 */
export const ResetScope = {
  ORDERS: 'ORDERS',
  PAYMENTS: 'PAYMENTS',
  LEDGER: 'LEDGER',
  COMPLAINTS: 'COMPLAINTS',
  SUPPORT: 'SUPPORT',
  REVIEWS: 'REVIEWS',
  NOTIFICATIONS: 'NOTIFICATIONS',
  COUPON_REDEMPTIONS: 'COUPON_REDEMPTIONS',
  DELIVERY_CODES: 'DELIVERY_CODES',
  IDEMPOTENCY_KEYS: 'IDEMPOTENCY_KEYS',
} as const;
export type ResetScope = (typeof ResetScope)[keyof typeof ResetScope];

/** The order the dialog lists them in, and the order the server works them. */
export const RESET_SCOPES: ResetScope[] = [
  ResetScope.ORDERS,
  ResetScope.PAYMENTS,
  ResetScope.LEDGER,
  ResetScope.COMPLAINTS,
  ResetScope.SUPPORT,
  ResetScope.REVIEWS,
  ResetScope.NOTIFICATIONS,
  ResetScope.COUPON_REDEMPTIONS,
  ResetScope.DELIVERY_CODES,
  ResetScope.IDEMPOTENCY_KEYS,
];

/**
 * A collection to empty, and the subcollections that hang off each document.
 *
 * Firestore does not delete a document's subcollections with it — an order
 * deleted on its own leaves its event trail behind as orphaned documents that
 * nothing can ever reach again. So every parent names its children here.
 */
export interface ResetTarget {
  collection: string;
  subcollections: string[];
}

export const RESET_SCOPE_TARGETS: Record<ResetScope, ResetTarget[]> = {
  [ResetScope.ORDERS]: [
    {
      collection: COLLECTIONS.orders,
      // The append-only status trail, and the IP/device record beside it.
      subcollections: [SUBCOLLECTIONS.orderEvents, SUBCOLLECTIONS.private],
    },
  ],
  [ResetScope.PAYMENTS]: [
    { collection: COLLECTIONS.payments, subcollections: [] },
    { collection: COLLECTIONS.paymentEvents, subcollections: [] },
  ],
  [ResetScope.LEDGER]: [
    { collection: COLLECTIONS.ledgerEntries, subcollections: [] },
    { collection: COLLECTIONS.settlements, subcollections: [] },
  ],
  [ResetScope.COMPLAINTS]: [{ collection: COLLECTIONS.complaints, subcollections: [] }],
  [ResetScope.SUPPORT]: [
    { collection: COLLECTIONS.supportTickets, subcollections: [SUBCOLLECTIONS.messages] },
    { collection: COLLECTIONS.supportFeedback, subcollections: [] },
  ],
  [ResetScope.REVIEWS]: [{ collection: COLLECTIONS.reviews, subcollections: [] }],
  [ResetScope.NOTIFICATIONS]: [{ collection: COLLECTIONS.notifications, subcollections: [] }],
  [ResetScope.COUPON_REDEMPTIONS]: [
    { collection: COLLECTIONS.couponRedemptions, subcollections: [] },
  ],
  [ResetScope.DELIVERY_CODES]: [{ collection: COLLECTIONS.deliveryCodes, subcollections: [] }],
  [ResetScope.IDEMPOTENCY_KEYS]: [{ collection: COLLECTIONS.idempotencyKeys, subcollections: [] }],
};

/**
 * The collections no scope may ever name.
 *
 * Deleting a user account would orphan the phone lock and let the number be
 * claimed again; deleting a restaurant would take its menu, its history and
 * its owner's login with it; deleting the audit log would erase the record of
 * the reset itself. `resetTargets` is checked against this list by the tests,
 * and by the callable before it deletes anything.
 */
export const RESET_PROTECTED_COLLECTIONS: string[] = [
  COLLECTIONS.users,
  COLLECTIONS.phoneIndex,
  COLLECTIONS.emailIndex,
  COLLECTIONS.restaurants,
  COLLECTIONS.menuCategories,
  COLLECTIONS.products,
  COLLECTIONS.coupons,
  COLLECTIONS.systemSettings,
  COLLECTIONS.auditLogs,
  COLLECTIONS.consents,
  COLLECTIONS.conversations,
  COLLECTIONS.deviceSignals,
  COLLECTIONS.emailVerifications,
];

export function isProtectedCollection(name: string): boolean {
  return RESET_PROTECTED_COLLECTIONS.includes(name);
}

export function isResetScope(value: unknown): value is ResetScope {
  return typeof value === 'string' && (RESET_SCOPES as string[]).includes(value);
}

/**
 * The collections one selection actually touches, in a fixed order and with no
 * duplicates — two scopes could name the same collection tomorrow, and a
 * double pass over one of them would report its documents as deleted twice.
 */
export function resetTargets(scopes: readonly ResetScope[]): ResetTarget[] {
  const seen = new Set<string>();
  const out: ResetTarget[] = [];

  for (const scope of RESET_SCOPES) {
    if (!scopes.includes(scope)) continue;
    for (const target of RESET_SCOPE_TARGETS[scope]) {
      if (seen.has(target.collection)) continue;
      seen.add(target.collection);
      out.push(target);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

/**
 * How many documents one invocation will delete before it stops and says what
 * is left.
 *
 * The point is not politeness to Firestore. A callable that tries to empty an
 * unbounded collection in one go is a callable that hits the 540-second wall
 * with the work half done and no report of what it managed — so this one
 * always stops on its own terms, always says what remains, and is always safe
 * to press again. "Safe to press again" is structural rather than careful:
 * deleting a document that is already gone is a no-op, so a run that is
 * interrupted and repeated deletes the remainder and nothing else.
 */
export const RESET_DEFAULT_LIMIT = 500;
export const RESET_MIN_LIMIT = 50;
export const RESET_MAX_LIMIT = 2000;

/** Documents read and deleted per round. Firestore's own batch cap is 500. */
export const RESET_CHUNK = 200;

/**
 * How long one invocation may spend, in milliseconds.
 *
 * Comfortably inside the callable's own timeout, so the run ends by returning
 * a report rather than by being killed.
 */
export const RESET_TIME_BUDGET_MS = 180_000;

/** Never asks for more than is left in the budget, and never for nothing. */
export function chunkSize(budgetLeft: number, chunk: number = RESET_CHUNK): number {
  return Math.max(0, Math.min(chunk, budgetLeft));
}

/** True once every selected collection reports nothing left to delete. */
export function isResetComplete(remaining: Record<string, number>): boolean {
  return Object.values(remaining).every((count) => count === 0);
}

/** The totals a report adds up to, for the sentence the screen shows. */
export function totalOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/**
 * The platform name as typed, reduced to something comparable.
 *
 * Azerbaijani letters are folded to their Latin bases so that "Qapinda" typed
 * on an English keyboard is accepted. That is not a weakening of the check:
 * the person still has to write the platform's name out, which is the whole
 * point — it is a wall against a mis-click, not against an attacker who has
 * already got a super-admin session.
 */
export function normaliseConfirmation(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      // Decomposing and dropping the combining marks folds ş, ç, ğ, ö and ü in
      // one step — and also the dot that "İ".toLowerCase() leaves behind.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // ə and ı have no decomposition, so they are named.
      .replace(/ə/g, 'e')
      .replace(/ı/g, 'i')
  );
}

export interface ResetRequest {
  role: UserRole | null | undefined;
  /** `publicSettings.testDataResetEnabled`, exactly as stored. */
  resetEnabled: unknown;
  /** What the person typed into the confirmation box. */
  confirmation: string;
  /** The switches they turned on. */
  scopes: readonly string[];
}

/**
 * Why this reset must not run, or null if it may.
 *
 * All four checks in one place so that no caller can implement three of them.
 * The order is the order a person would want to be told: who you are first,
 * then whether the platform is open to this at all, then what you asked for,
 * then whether you meant it.
 */
export function refuseReset(request: ResetRequest): AppErrorCode | null {
  if (request.role !== UserRole.SUPER_ADMIN) return AppErrorCode.FORBIDDEN;

  // Strictly `true`. A missing field, a string "true", a 1 — none of them are
  // somebody having deliberately switched this on.
  if (request.resetEnabled !== true) return AppErrorCode.RESET_NOT_ENABLED;

  if (request.scopes.length === 0) return AppErrorCode.VALIDATION_FAILED;
  if (!request.scopes.every(isResetScope)) return AppErrorCode.VALIDATION_FAILED;

  if (normaliseConfirmation(request.confirmation) !== normaliseConfirmation(PLATFORM_NAME)) {
    return AppErrorCode.RESET_CONFIRMATION_MISMATCH;
  }

  return null;
}
