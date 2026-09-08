/**
 * Error handling.
 *
 * A callable never returns a raw exception to the browser. It returns an
 * `AppErrorCode` the app translates, and logs the real detail server-side —
 * so a customer sees "Bu kupon artıq istifadə olunub", not a stack trace that
 * tells them which document check failed.
 */

import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { AppErrorCode } from '../shared/errors';
import { enforceRateLimit } from './rateLimit';

type Category =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'permission-denied'
  | 'unauthenticated'
  | 'not-found'
  | 'already-exists'
  | 'resource-exhausted'
  | 'internal';

/** Which gRPC category each code reports as. Affects client retry behaviour. */
const CATEGORY: Partial<Record<AppErrorCode, Category>> = {
  [AppErrorCode.UNAUTHENTICATED]: 'unauthenticated',
  [AppErrorCode.FORBIDDEN]: 'permission-denied',
  [AppErrorCode.NOT_YOUR_RESTAURANT]: 'permission-denied',
  [AppErrorCode.ACCOUNT_SUSPENDED]: 'permission-denied',
  [AppErrorCode.ACCOUNT_BANNED]: 'permission-denied',
  [AppErrorCode.ACCOUNT_UNDER_REVIEW]: 'permission-denied',
  [AppErrorCode.ACTOR_NOT_ALLOWED]: 'permission-denied',
  // Reported as permission-denied because that is what it is on the wire. What
  // the customer READS is `errors.WORK_ACCOUNT_CANNOT_ORDER` from the
  // dictionary — the app never renders the gRPC category, and this one in
  // particular must never reach a screen as "PERMISSION_DENIED".
  [AppErrorCode.WORK_ACCOUNT_CANNOT_ORDER]: 'permission-denied',

  [AppErrorCode.PHONE_ALREADY_REGISTERED]: 'already-exists',
  [AppErrorCode.WORK_PHONE_NOT_CUSTOMER]: 'already-exists',
  [AppErrorCode.EMAIL_ALREADY_REGISTERED]: 'already-exists',
  [AppErrorCode.ALREADY_APPLIED]: 'already-exists',
  [AppErrorCode.REVIEW_ALREADY_SUBMITTED]: 'already-exists',
  [AppErrorCode.COMPLAINT_ALREADY_FILED]: 'already-exists',
  [AppErrorCode.DUPLICATE_REQUEST]: 'already-exists',

  [AppErrorCode.RESTAURANT_NOT_FOUND]: 'not-found',
  [AppErrorCode.PRODUCT_NOT_FOUND]: 'not-found',
  [AppErrorCode.CATEGORY_NOT_FOUND]: 'not-found',
  [AppErrorCode.ORDER_NOT_FOUND]: 'not-found',
  [AppErrorCode.ADDRESS_NOT_FOUND]: 'not-found',
  [AppErrorCode.COUPON_NOT_FOUND]: 'not-found',
  [AppErrorCode.SETTLEMENT_NOT_FOUND]: 'not-found',
  [AppErrorCode.REVIEW_NOT_FOUND]: 'not-found',
  [AppErrorCode.COMPLAINT_NOT_FOUND]: 'not-found',
  [AppErrorCode.TICKET_NOT_FOUND]: 'not-found',
  [AppErrorCode.NOT_FOUND]: 'not-found',

  [AppErrorCode.SUPPORT_LANE_NOT_ALLOWED]: 'permission-denied',

  [AppErrorCode.RATE_LIMITED]: 'resource-exhausted',
  [AppErrorCode.TOO_MANY_ACTIVE_ORDERS]: 'resource-exhausted',

  // Typing the platform's name wrongly is a bad argument, not a broken state:
  // reported as such so the screen can keep the dialog open and let the person
  // try again rather than treating it as a failure of the platform.
  [AppErrorCode.RESET_CONFIRMATION_MISMATCH]: 'invalid-argument',

  [AppErrorCode.VALIDATION_FAILED]: 'invalid-argument',
  [AppErrorCode.INVALID_PHONE]: 'invalid-argument',
  [AppErrorCode.INVALID_EMAIL]: 'invalid-argument',
  [AppErrorCode.INVALID_QUANTITY]: 'invalid-argument',

  [AppErrorCode.INTERNAL]: 'internal',
};

/** Throws the one error type callables are allowed to produce. */
export function fail(code: AppErrorCode, detail?: string): never {
  throw new HttpsError(CATEGORY[code] ?? 'failed-precondition', code, { code, detail });
}

/**
 * Wraps a handler so that anything unexpected is logged in full and reported to
 * the client as a bare INTERNAL. Deliberate `HttpsError`s pass through
 * untouched.
 */
export function guard<R>(
  name: string,
  handler: (request: CallableRequest<unknown>) => Promise<R>,
): (request: CallableRequest<unknown>) => Promise<R> {
  return async (request) => {
    try {
      /*
       * The rate limit, before the handler and before any read.
       *
       * Here rather than inside each callable because there are ninety-nine of
       * them and the one that gets forgotten is always the one added last. It
       * throws `RATE_LIMITED`, which is an `HttpsError`, so it leaves through
       * the branch below that passes deliberate errors out untouched.
       */
      await enforceRateLimit(name, request);
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`[${name}] unhandled`, {
        uid: request.auth?.uid ?? null,
        error: error instanceof Error ? error.stack : String(error),
      });
      fail(AppErrorCode.INTERNAL);
    }
  };
}
