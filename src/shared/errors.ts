/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Error codes.
 *
 * Cloud Functions never send a human sentence to the browser. They send a code
 * from this list, and the app looks the code up in the customer's own language.
 * That keeps error text translatable, and keeps internal detail (which document
 * failed, which rule fired) out of the response.
 */

export const AppErrorCode = {
  // Auth and identity
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  ACCOUNT_UNDER_REVIEW: 'ACCOUNT_UNDER_REVIEW',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  /**
   * A work account tried to order food.
   *
   * Its own code rather than FORBIDDEN, because the customer must never be
   * shown "permission denied" for this: the account is not broken and has done
   * nothing wrong, it is simply the wrong kind of account for ordering. The
   * technical reason stays in the server log.
   */
  WORK_ACCOUNT_CANNOT_ORDER: 'WORK_ACCOUNT_CANNOT_ORDER',
  /**
   * Registration on a phone number that already belongs to a restaurant,
   * courier, operator or admin account. One phone, one account — and a work
   * number cannot double as a customer's.
   */
  WORK_PHONE_NOT_CUSTOMER: 'WORK_PHONE_NOT_CUSTOMER',
  INVALID_PHONE: 'INVALID_PHONE',
  INVALID_EMAIL: 'INVALID_EMAIL',
  EMAIL_CODE_WRONG: 'EMAIL_CODE_WRONG',
  EMAIL_CODE_EXPIRED: 'EMAIL_CODE_EXPIRED',
  EMAIL_CODE_TOO_MANY: 'EMAIL_CODE_TOO_MANY',
  EMAIL_SENDING_DISABLED: 'EMAIL_SENDING_DISABLED',

  /*
   * The delivery address's own telephone number.
   *
   * Kept apart from the email codes above rather than reusing them, because
   * the sentences shown are different in the one way that matters: an email
   * code that fails leaves somebody without receipts, and an address code that
   * fails leaves an order that cannot be placed. The screens say so.
   */
  ADDRESS_CODE_WRONG: 'ADDRESS_CODE_WRONG',
  ADDRESS_CODE_EXPIRED: 'ADDRESS_CODE_EXPIRED',
  ADDRESS_CODE_TOO_MANY: 'ADDRESS_CODE_TOO_MANY',
  /** No SMS gateway is configured. A setup answer, not the customer's fault. */
  SMS_SENDING_DISABLED: 'SMS_SENDING_DISABLED',
  SMS_SEND_FAILED: 'SMS_SEND_FAILED',
  /** The address has no name, no number, or an unproved number. */
  ADDRESS_NOT_DELIVERABLE: 'ADDRESS_NOT_DELIVERABLE',

  INVALID_REGION: 'INVALID_REGION',
  INVALID_DISTRICT: 'INVALID_DISTRICT',

  // Restaurant
  RESTAURANT_NOT_FOUND: 'RESTAURANT_NOT_FOUND',
  RESTAURANT_NOT_ACTIVE: 'RESTAURANT_NOT_ACTIVE',
  RESTAURANT_CLOSED: 'RESTAURANT_CLOSED',
  RESTAURANT_PAUSED: 'RESTAURANT_PAUSED',
  NOT_YOUR_RESTAURANT: 'NOT_YOUR_RESTAURANT',
  ALREADY_APPLIED: 'ALREADY_APPLIED',

  // Menu
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_NOT_EMPTY: 'CATEGORY_NOT_EMPTY',
  MODIFIER_REQUIRED: 'MODIFIER_REQUIRED',
  MODIFIER_TOO_FEW: 'MODIFIER_TOO_FEW',
  MODIFIER_TOO_MANY: 'MODIFIER_TOO_MANY',
  MODIFIER_UNKNOWN: 'MODIFIER_UNKNOWN',
  MODIFIER_UNAVAILABLE: 'MODIFIER_UNAVAILABLE',

  // Cart and order
  CART_EMPTY: 'CART_EMPTY',
  CART_MIXED_RESTAURANTS: 'CART_MIXED_RESTAURANTS',
  BELOW_MINIMUM_ORDER: 'BELOW_MINIMUM_ORDER',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  ADDRESS_REQUIRED: 'ADDRESS_REQUIRED',
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  /** No account with that id. */
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ADDRESS_OUT_OF_RANGE: 'ADDRESS_OUT_OF_RANGE',
  /**
   * The address has no map pin, so it cannot be measured against the
   * restaurant's delivery circle. Refused rather than guessed at — see
   * `shared/geo.ts` for why, and for why a restaurant with no pin is treated
   * differently.
   */
  ADDRESS_LOCATION_MISSING: 'ADDRESS_LOCATION_MISSING',
  PAYMENT_METHOD_NOT_ACCEPTED: 'PAYMENT_METHOD_NOT_ACCEPTED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_ALREADY_FINISHED: 'ORDER_ALREADY_FINISHED',
  /**
   * The customer's own cancellation window has closed — three minutes have
   * passed, or the kitchen has already accepted. Measured by the server's
   * clock; see `CUSTOMER_CANCEL_WINDOW_MS` in `shared/orderState.ts`.
   */
  CANCEL_WINDOW_CLOSED: 'CANCEL_WINDOW_CLOSED',

  // Reviews
  /** The order has not been delivered, so there is nothing to review yet. */
  REVIEW_NOT_ELIGIBLE: 'REVIEW_NOT_ELIGIBLE',
  REVIEW_ALREADY_SUBMITTED: 'REVIEW_ALREADY_SUBMITTED',
  /** Too long after delivery. */
  REVIEW_WINDOW_CLOSED: 'REVIEW_WINDOW_CLOSED',
  REVIEW_NOT_FOUND: 'REVIEW_NOT_FOUND',

  // Complaints
  COMPLAINT_NOT_ELIGIBLE: 'COMPLAINT_NOT_ELIGIBLE',
  COMPLAINT_ALREADY_FILED: 'COMPLAINT_ALREADY_FILED',
  COMPLAINT_WINDOW_CLOSED: 'COMPLAINT_WINDOW_CLOSED',
  COMPLAINT_NOT_FOUND: 'COMPLAINT_NOT_FOUND',
  COMPLAINT_ALREADY_RESOLVED: 'COMPLAINT_ALREADY_RESOLVED',

  // Support tickets
  TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
  /** Closed tickets are kept forever and take no new messages. */
  TICKET_CLOSED: 'TICKET_CLOSED',
  TICKET_ALREADY_ESCALATED: 'TICKET_ALREADY_ESCALATED',
  /** This role may not open — or answer — a ticket in that lane. */
  SUPPORT_LANE_NOT_ALLOWED: 'SUPPORT_LANE_NOT_ALLOWED',
  TICKET_TRANSITION_NOT_ALLOWED: 'TICKET_TRANSITION_NOT_ALLOWED',
  /** The message id given does not belong to that ticket, or does not exist. */
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  /**
   * Translation is switched off, or the project has never had the Cloud
   * Translation API enabled.
   *
   * Its own code rather than INTERNAL, because it is not a fault: it is a
   * setting, the sentence the reader needs says so, and an operator who sees
   * "internal error" opens a ticket about a working system.
   */
  TRANSLATION_UNAVAILABLE: 'TRANSLATION_UNAVAILABLE',
  /** The message has no words, or has more than translation will pay for. */
  NOTHING_TO_TRANSLATE: 'NOTHING_TO_TRANSLATE',

  /** Too many cancelled orders lately. Ordering is paused, not banned. */
  TOO_MANY_CANCELLATIONS: 'TOO_MANY_CANCELLATIONS',
  TRANSITION_NOT_ALLOWED: 'TRANSITION_NOT_ALLOWED',
  ACTOR_NOT_ALLOWED: 'ACTOR_NOT_ALLOWED',
  REASON_REQUIRED: 'REASON_REQUIRED',
  TOO_MANY_ACTIVE_ORDERS: 'TOO_MANY_ACTIVE_ORDERS',

  // Coupons
  COUPON_NOT_FOUND: 'COUPON_NOT_FOUND',
  COUPON_INACTIVE: 'COUPON_INACTIVE',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_NOT_STARTED: 'COUPON_NOT_STARTED',
  COUPON_WRONG_RESTAURANT: 'COUPON_WRONG_RESTAURANT',
  COUPON_BELOW_MINIMUM: 'COUPON_BELOW_MINIMUM',
  COUPON_FIRST_ORDER_ONLY: 'COUPON_FIRST_ORDER_ONLY',
  COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
  COUPON_ALREADY_USED: 'COUPON_ALREADY_USED',
  /** The coupon belongs to named customers and this is not one of them. */
  COUPON_NOT_FOR_CUSTOMER: 'COUPON_NOT_FOR_CUSTOMER',
  /** The handover code was wrong. The detail carries the tries left. */
  DELIVERY_CODE_INVALID: 'DELIVERY_CODE_INVALID',
  /** The code ran out before the courier arrived; the customer asks for a new one. */
  DELIVERY_CODE_EXPIRED: 'DELIVERY_CODE_EXPIRED',
  /** The customer has not opened their code yet, so there is nothing to check. */
  DELIVERY_CODE_MISSING: 'DELIVERY_CODE_MISSING',
  /** Online payment asked for before the platform has a provider configured. */
  PAYMENT_NOT_CONFIGURED: 'PAYMENT_NOT_CONFIGURED',
  /** The payment or record asked for does not exist. */
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** The provider reported a different amount than the server calculated. */
  PAYMENT_AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',

  // Settlement
  SETTLEMENT_NOT_FOUND: 'SETTLEMENT_NOT_FOUND',
  SETTLEMENT_LOCKED: 'SETTLEMENT_LOCKED',

  /**
   * The whole message was profanity, so there was nothing left to send.
   *
   * A message with one swear word in it is never refused — the word is masked
   * and the rest goes through. This code exists for the message that has
   * nothing else in it, where masking would deliver an empty bubble.
   */
  PROFANITY_ONLY: 'PROFANITY_ONLY',

  // The pre-launch test-data reset
  /**
   * The reset was asked for while `publicSettings.testDataResetEnabled` was
   * off. Its own code rather than FORBIDDEN, because nothing is wrong with the
   * caller — the platform is simply not open to being emptied, which is the
   * state every deployment is in until somebody deliberately changes it.
   */
  RESET_NOT_ENABLED: 'RESET_NOT_ENABLED',
  /** The platform's name was not typed correctly into the confirmation box. */
  RESET_CONFIRMATION_MISMATCH: 'RESET_CONFIRMATION_MISMATCH',

  /**
   * A report could not be built from the orders behind it.
   *
   * Its own code rather than INTERNAL, because the two need different sentences
   * and different reactions. INTERNAL says "something is broken", which on a
   * date-range screen is both frightening and useless; this says "the figures
   * for these dates did not load", which is a thing the person can act on by
   * pressing the button again or narrowing the range. It also stops a transient
   * read failure being indistinguishable, in a screenshot, from a crash.
   */
  REPORT_UNAVAILABLE: 'REPORT_UNAVAILABLE',

  /**
   * The platform is closed for technical work, so no new order may be created.
   *
   * Its own code rather than FORBIDDEN, because nothing is wrong with the
   * customer or with their cart: the platform is shut, and the sentence they
   * need to read says so and — when the admin gave one — says when it is back.
   */
  PLATFORM_MAINTENANCE: 'PLATFORM_MAINTENANCE',

  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

/** The shape every failed callable puts in `HttpsError.details`. */
export interface AppErrorDetails {
  code: AppErrorCode;
  /** Optional value to substitute into the translated message, e.g. a product name. */
  detail?: string;
}

/** Maps a line-level pricing failure onto the shared code list. */
export const LINE_ERROR_TO_CODE = {
  'product-not-found': AppErrorCode.PRODUCT_NOT_FOUND,
  'product-unavailable': AppErrorCode.PRODUCT_UNAVAILABLE,
  'invalid-quantity': AppErrorCode.INVALID_QUANTITY,
  'modifier-required': AppErrorCode.MODIFIER_REQUIRED,
  'modifier-too-few': AppErrorCode.MODIFIER_TOO_FEW,
  'modifier-too-many': AppErrorCode.MODIFIER_TOO_MANY,
  'modifier-unknown': AppErrorCode.MODIFIER_UNKNOWN,
  'modifier-unavailable': AppErrorCode.MODIFIER_UNAVAILABLE,
} as const;

export const COUPON_ERROR_TO_CODE = {
  'coupon-not-found': AppErrorCode.COUPON_NOT_FOUND,
  'coupon-inactive': AppErrorCode.COUPON_INACTIVE,
  'coupon-expired': AppErrorCode.COUPON_EXPIRED,
  'coupon-not-started': AppErrorCode.COUPON_NOT_STARTED,
  'coupon-wrong-restaurant': AppErrorCode.COUPON_WRONG_RESTAURANT,
  'coupon-below-minimum': AppErrorCode.COUPON_BELOW_MINIMUM,
  'coupon-first-order-only': AppErrorCode.COUPON_FIRST_ORDER_ONLY,
  'coupon-limit-reached': AppErrorCode.COUPON_LIMIT_REACHED,
  'coupon-already-used': AppErrorCode.COUPON_ALREADY_USED,
  'coupon-not-for-customer': AppErrorCode.COUPON_NOT_FOR_CUSTOMER,
} as const;

export const SUPPORT_TRANSITION_ERROR_TO_CODE = {
  'ticket-closed': AppErrorCode.TICKET_CLOSED,
  'transition-not-allowed': AppErrorCode.TICKET_TRANSITION_NOT_ALLOWED,
  'actor-not-allowed': AppErrorCode.ACTOR_NOT_ALLOWED,
} as const;

export const TRANSITION_ERROR_TO_CODE = {
  'terminal-status': AppErrorCode.ORDER_ALREADY_FINISHED,
  'transition-not-allowed': AppErrorCode.TRANSITION_NOT_ALLOWED,
  'actor-not-allowed': AppErrorCode.ACTOR_NOT_ALLOWED,
  'reason-required': AppErrorCode.REASON_REQUIRED,
} as const;

/** Translation key for an error code: `errors.COUPON_EXPIRED`. */
export function errorMessageKey(code: AppErrorCode): string {
  return `errors.${code}`;
}
