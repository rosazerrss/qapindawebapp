/**
 * QAPINDA — Collection paths and deterministic document ids.
 *
 * Every path in the system is written here once. Security Rules, Cloud
 * Functions and the web app all read from this file, so a path can never drift
 * between the rule that protects a document and the code that writes it.
 *
 * Deterministic ids are how uniqueness is enforced in Firestore: there is no
 * "unique index", so a uniqueness rule becomes "a document whose id IS the
 * unique value, created with a transaction that fails if it already exists".
 */

// ---------------------------------------------------------------------------
// Top-level collections
// ---------------------------------------------------------------------------

export const COLLECTIONS = {
  users: 'users',
  /** `phoneIndex/{e164}` — one document per phone number. The account lock. */
  phoneIndex: 'phoneIndex',
  /** `emailIndex/{lowercaseEmail}` — one document per email address. */
  emailIndex: 'emailIndex',

  restaurants: 'restaurants',
  /**
   * `restaurantInvites/{restaurantId}__{uid}` — "come and work here".
   *
   * A restaurant used to be able to attach any account to itself by typing its
   * telephone number: the person's role changed under them, their app turned
   * into a restaurant panel, and nobody asked. This is the document that stands
   * between the asking and the doing. The id is deterministic so inviting the
   * same person twice replaces one invitation rather than making two.
   */
  restaurantInvites: 'restaurantInvites',
  menuCategories: 'menuCategories',
  products: 'products',

  orders: 'orders',
  /** `deliveryCodes/{orderId}` — the hashed handover code. Server-only. */
  deliveryCodes: 'deliveryCodes',
  /** `payments/{paymentId}` — one attempt to collect money for one order. */
  payments: 'payments',
  /** Every message a payment provider ever sent us. Append-only. */
  paymentEvents: 'paymentEvents',
  /** `reviews/{orderId}` — one review per order, and the order id proves it. */
  reviews: 'reviews',
  /** `complaints/{orderId}` — same trick: one complaint per order, no more. */
  complaints: 'complaints',
  /**
   * `conversations/{restaurantId}` — the pre-ticket restaurant threads.
   *
   * Superseded by `supportTickets`. Kept, not dropped: every one of these was
   * migrated into a ticket rather than copied out and deleted, and the
   * originals stay as the record of what the thread looked like before. No
   * code writes here any more.
   */
  conversations: 'conversations',
  /** `supportTickets/{ticketId}` — one problem, from first word to closure. */
  supportTickets: 'supportTickets',
  /**
   * `supportFeedback/{ticketId}` — the closed ticket, as the customer sees it.
   *
   * Transient by design and deleted on a schedule; the id is the ticket's own
   * id, so one closed ticket can never produce two entries however many times
   * a status write is retried. See `shared/feedback.ts`.
   */
  supportFeedback: 'supportFeedback',
  coupons: 'coupons',
  couponRedemptions: 'couponRedemptions',

  ledgerEntries: 'ledgerEntries',
  settlements: 'settlements',

  notifications: 'notifications',

  /**
   * `pushTokens/{token}` — one row per device that may be woken.
   *
   * The FCM registration token is the document id: FCM issues one per browser
   * profile per device, so re-registering the same device overwrites its row
   * instead of collecting duplicates. Per device and not per account, because a
   * restaurant has a tablet in the kitchen, one at the counter and the owner's
   * telephone, and an order has to ring on all three.
   */
  pushTokens: 'pushTokens',
  auditLogs: 'auditLogs',
  consents: 'consents',
  systemSettings: 'systemSettings',
  idempotencyKeys: 'idempotencyKeys',
  /** Device fingerprints seen per phone. Feeds the anti-fraud review flag. */
  deviceSignals: 'deviceSignals',
  /** Pending six-digit email codes, hashed. Server only. */
  emailVerifications: 'emailVerifications',
  /**
   * Pending six-digit codes for a delivery address's phone, hashed.
   *
   * One document per address, keyed `{uid}_{addressId}`, so two addresses can
   * be verified without one code overwriting the other. Server only, for the
   * same reason as the email one: a readable copy of this collection would let
   * anyone verify anyone's number.
   */
  addressVerifications: 'addressVerifications',
} as const;

// ---------------------------------------------------------------------------
// Subcollections
// ---------------------------------------------------------------------------

export const SUBCOLLECTIONS = {
  /** `users/{uid}/addresses/{addressId}` */
  addresses: 'addresses',
  /** `users/{uid}/favourites/{favouriteId}` */
  favourites: 'favourites',
  /** `orders/{orderId}/events/{eventId}` — append-only status trail. */
  orderEvents: 'events',
  /** `restaurants/{id}/private/{doc}` and `orders/{id}/private/{doc}` */
  private: 'private',
  /** `conversations/{restaurantId}/messages/{messageId}` */
  messages: 'messages',
} as const;

/** Fixed document ids inside `private` subcollections. */
export const PRIVATE_DOCS = {
  /** Commission, contact and response window. Never public. */
  business: 'business',
  /** IP / device / risk flags on an order. Platform only. */
  meta: 'meta',
} as const;

/** `systemSettings/public` — the only settings document a customer may read. */
export const SETTINGS_DOC_PUBLIC = 'public';

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

/**
 * One path segment, checked before it is allowed into a path.
 *
 * A missing id used to travel all the way into the Firebase SDK before anything
 * complained, and what came back was `Cannot read properties of undefined
 * (reading 'indexOf')` from deep inside `ResourcePath.fromString` — a stack with
 * nothing in it that names the caller, thrown inside whatever promise happened
 * to be building the reference. That is the least useful failure this file could
 * produce: the one fact worth knowing is WHICH id was missing, and it was the
 * one fact the error did not carry.
 *
 * So a segment is validated here, at the only place that builds paths, and the
 * error names the builder and the argument. It throws rather than returning a
 * broken string on purpose: `restaurants/undefined/private/business` is a real
 * document path that a browser will happily subscribe to, and a listener quietly
 * reading a document that cannot exist is a screen that is wrong rather than a
 * screen that is broken. A caller that does not have an id yet must not ask for
 * a path — it must wait.
 */
function segment(builder: string, name: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `paths.${builder}(): "${name}" must be a non-empty string, got ${JSON.stringify(value)}.`,
    );
  }
  if (value.includes('/')) {
    throw new Error(`paths.${builder}(): "${name}" may not contain "/", got "${value}".`);
  }
  return value;
}

export const paths = {
  user: (uid: string) => `${COLLECTIONS.users}/${segment('user', 'uid', uid)}`,

  /**
   * One invitation, addressed to one person by one restaurant.
   *
   * `__` rather than `:` or `/`: a Firestore document id may not contain a
   * slash, and a colon survives but reads badly in a console. Deterministic on
   * purpose — see `COLLECTIONS.restaurantInvites`.
   */
  restaurantInvite: (restaurantId: string, uid: string) =>
    `${COLLECTIONS.restaurantInvites}/${segment('restaurantInvite', 'restaurantId', restaurantId)}__${segment('restaurantInvite', 'uid', uid)}`,
  userAddresses: (uid: string) =>
    `${COLLECTIONS.users}/${segment('userAddresses', 'uid', uid)}/${SUBCOLLECTIONS.addresses}`,
  userAddress: (uid: string, addressId: string) =>
    `${COLLECTIONS.users}/${segment('userAddress', 'uid', uid)}/${SUBCOLLECTIONS.addresses}/${segment('userAddress', 'addressId', addressId)}`,

  userFavourites: (uid: string) =>
    `${COLLECTIONS.users}/${segment('userFavourites', 'uid', uid)}/${SUBCOLLECTIONS.favourites}`,
  userFavourite: (uid: string, favouriteId: string) =>
    `${COLLECTIONS.users}/${segment('userFavourite', 'uid', uid)}/${SUBCOLLECTIONS.favourites}/${segment('userFavourite', 'favouriteId', favouriteId)}`,

  emailVerification: (uid: string) =>
    `${COLLECTIONS.emailVerifications}/${segment('emailVerification', 'uid', uid)}`,

  /**
   * One pending address code.
   *
   * Keyed by uid AND address so that verifying the office does not throw away
   * the code just sent for home. The uid comes first so a stray document can
   * always be traced back to an account.
   */
  addressVerification: (uid: string, addressId: string) =>
    `${COLLECTIONS.addressVerifications}/${segment(
      'addressVerification',
      'uid',
      uid,
    )}_${segment('addressVerification', 'addressId', addressId)}`,

  // The lock's key is the NORMALISED value, so that is what is checked: a phone
  // with no digits in it and an email with nothing before the "@" both
  // normalise to an empty string, and a lock document with an empty id would be
  // one lock shared by every malformed input in the system.
  phoneLock: (phoneE164: string) =>
    `${COLLECTIONS.phoneIndex}/${segment(
      'phoneLock',
      'phoneE164',
      normalisePhoneKey(segment('phoneLock', 'phoneE164', phoneE164)),
    )}`,
  emailLock: (email: string) =>
    `${COLLECTIONS.emailIndex}/${segment(
      'emailLock',
      'email',
      normaliseEmailKey(segment('emailLock', 'email', email)),
    )}`,

  restaurant: (restaurantId: string) =>
    `${COLLECTIONS.restaurants}/${segment('restaurant', 'restaurantId', restaurantId)}`,
  /**
   * The review's id *is* the order's id.
   *
   * That single choice enforces the whole rule: one review per order, only from
   * an order that exists, and no way to review without having ordered — there
   * is no second document to write.
   */
  review: (orderId: string) => `${COLLECTIONS.reviews}/${segment('review', 'orderId', orderId)}`,
  complaint: (orderId: string) =>
    `${COLLECTIONS.complaints}/${segment('complaint', 'orderId', orderId)}`,

  /**
   * The legacy support thread for one restaurant. Read-only from now on.
   *
   * These were keyed by the restaurant because the design was one permanent
   * thread per restaurant. Every one of them now also exists as an open ticket
   * — see `legacyTicketId` — and only the migration reads these paths.
   */
  conversation: (restaurantId: string) =>
    `${COLLECTIONS.conversations}/${segment('conversation', 'restaurantId', restaurantId)}`,
  conversationMessages: (restaurantId: string) =>
    `${COLLECTIONS.conversations}/${segment('conversationMessages', 'restaurantId', restaurantId)}/${SUBCOLLECTIONS.messages}`,

  /** One ticket, and the messages inside it. */
  supportTicket: (ticketId: string) =>
    `${COLLECTIONS.supportTickets}/${segment('supportTicket', 'ticketId', ticketId)}`,
  /** The id IS the ticket's id — one closed ticket, one entry, or none. */
  supportFeedback: (ticketId: string) =>
    `${COLLECTIONS.supportFeedback}/${segment('supportFeedback', 'ticketId', ticketId)}`,
  supportTicketMessages: (ticketId: string) =>
    `${COLLECTIONS.supportTickets}/${segment('supportTicketMessages', 'ticketId', ticketId)}/${SUBCOLLECTIONS.messages}`,
  restaurantBusiness: (restaurantId: string) =>
    `${COLLECTIONS.restaurants}/${segment('restaurantBusiness', 'restaurantId', restaurantId)}/${SUBCOLLECTIONS.private}/${PRIVATE_DOCS.business}`,

  menuCategory: (categoryId: string) =>
    `${COLLECTIONS.menuCategories}/${segment('menuCategory', 'categoryId', categoryId)}`,
  product: (productId: string) =>
    `${COLLECTIONS.products}/${segment('product', 'productId', productId)}`,

  order: (orderId: string) => `${COLLECTIONS.orders}/${segment('order', 'orderId', orderId)}`,
  orderEvents: (orderId: string) =>
    `${COLLECTIONS.orders}/${segment('orderEvents', 'orderId', orderId)}/${SUBCOLLECTIONS.orderEvents}`,
  deliveryCode: (orderId: string) =>
    `${COLLECTIONS.deliveryCodes}/${segment('deliveryCode', 'orderId', orderId)}`,
  payment: (paymentId: string) =>
    `${COLLECTIONS.payments}/${segment('payment', 'paymentId', paymentId)}`,
  orderPrivateMeta: (orderId: string) =>
    `${COLLECTIONS.orders}/${segment('orderPrivateMeta', 'orderId', orderId)}/${SUBCOLLECTIONS.private}/${PRIVATE_DOCS.meta}`,

  // The coupon's id is the normalised code, so — as with the locks above — the
  // normalised value is what has to be there. "!!!" is a code a person can type
  // and normalises to nothing at all.
  coupon: (code: string) =>
    `${COLLECTIONS.coupons}/${segment(
      'coupon',
      'code',
      normaliseCouponCode(segment('coupon', 'code', code)),
    )}`,
  couponRedemption: (code: string, customerId: string, orderId: string) =>
    `${COLLECTIONS.couponRedemptions}/${segment(
      'couponRedemption',
      'id',
      couponRedemptionId(
        segment(
          'couponRedemption',
          'code',
          normaliseCouponCode(segment('couponRedemption', 'code', code)),
        ),
        segment('couponRedemption', 'customerId', customerId),
        segment('couponRedemption', 'orderId', orderId),
      ),
    )}`,

  ledgerEntry: (entryId: string) =>
    `${COLLECTIONS.ledgerEntries}/${segment('ledgerEntry', 'entryId', entryId)}`,
  settlement: (restaurantId: string, period: string) =>
    `${COLLECTIONS.settlements}/${segment(
      'settlement',
      'id',
      settlementId(
        segment('settlement', 'restaurantId', restaurantId),
        segment('settlement', 'period', period),
      ),
    )}`,

  notification: (notificationId: string) =>
    `${COLLECTIONS.notifications}/${segment('notification', 'notificationId', notificationId)}`,
  auditLog: (logId: string) => `${COLLECTIONS.auditLogs}/${segment('auditLog', 'logId', logId)}`,
  idempotencyKey: (key: string) =>
    `${COLLECTIONS.idempotencyKeys}/${segment('idempotencyKey', 'key', key)}`,
  deviceSignal: (deviceId: string) =>
    `${COLLECTIONS.deviceSignals}/${segment('deviceSignal', 'deviceId', deviceId)}`,
  publicSettings: () => `${COLLECTIONS.systemSettings}/${SETTINGS_DOC_PUBLIC}`,
} as const;

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

/**
 * One redemption document per (coupon, customer, order).
 *
 * Making the id deterministic means a retried request cannot double-spend a
 * coupon: the second create hits an existing document and the transaction
 * aborts, instead of quietly writing a second discount.
 */
export function couponRedemptionId(code: string, customerId: string, orderId: string): string {
  return `${normaliseCouponCode(code)}_${customerId}_${orderId}`;
}

/**
 * The ticket a pre-ticket restaurant thread becomes.
 *
 * Derived from the restaurant id rather than random, so the migration can be
 * run twice — after a failure, or simply by a nervous operator — and the
 * second run writes the same document instead of a duplicate ticket carrying a
 * second copy of the same history.
 */
export function legacyTicketId(restaurantId: string): string {
  return `legacy_${restaurantId}`;
}

/** `settlements/{restaurantId}_{YYYY-MM}` — one invoice per restaurant per month. */
export function settlementId(restaurantId: string, period: string): string {
  return `${restaurantId}_${period}`;
}

/** Commission is posted once per order, however many times the job runs. */
export function commissionIdempotencyKey(orderId: string): string {
  return `commission:${orderId}`;
}

/** The platform-funded discount credit is likewise posted once per order. */
export function platformDiscountIdempotencyKey(orderId: string): string {
  return `platform-discount:${orderId}`;
}

/** The online takings the platform is holding, posted once per order. */
export function onlineCollectedIdempotencyKey(orderId: string): string {
  return `online-collected:${orderId}`;
}

/**
 * The reversal of those takings when money goes back to the customer.
 *
 * Keyed by the payment rather than the order, and carrying the refunded amount,
 * because an order can be refunded in parts: two partial refunds are two
 * separate movements of money and must both be recorded, while the same refund
 * retried after a timeout must not be recorded twice.
 */
export function onlineRefundIdempotencyKey(paymentId: string, refundedTotal: number): string {
  return `online-refund:${paymentId}:${refundedTotal}`;
}

/**
 * A payment filed against a month, keyed by the reference it arrived under.
 *
 * The bank reference is what makes this idempotent: filing the same transfer
 * twice — two operators looking at the same statement — writes the same
 * document and changes nothing, while two genuinely different transfers carry
 * two different references and both land.
 */
export function settlementPaymentIdempotencyKey(
  restaurantId: string,
  period: string,
  reference: string,
): string {
  return `settlement-payment:${restaurantId}:${period}:${normaliseReferenceKey(reference)}`;
}

/** Document ids may not contain "/", and a reference is typed off a statement. */
export function normaliseReferenceKey(reference: string): string {
  return reference
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 64);
}

/**
 * One order per (customer, client-generated request id).
 *
 * The client sends the same id when it retries a failed submit, so a flaky
 * connection cannot turn one tap into two dinners.
 */
export function orderIdempotencyKey(customerId: string, clientRequestId: string): string {
  return `order:${customerId}:${clientRequestId}`;
}

/** A restaurant may only have one pending application per owner. */
export function restaurantApplicationIdempotencyKey(ownerUserId: string): string {
  return `restaurant-application:${ownerUserId}`;
}

// ---------------------------------------------------------------------------
// Key normalisation
// ---------------------------------------------------------------------------

/**
 * Firestore document ids may not contain "/", and a lock only works if the same
 * number always produces the same key. Phones are stored E.164 with the "+"
 * dropped: "+994501234567" → "994501234567".
 */
export function normalisePhoneKey(phoneE164: string): string {
  return phoneE164.replace(/[^\d]/g, '');
}

/**
 * Email locks are case-insensitive, and Gmail-style dots and "+tags" are
 * stripped — otherwise `a.b+1@gmail.com` and `ab@gmail.com` are the same inbox
 * but two accounts, which is exactly the loophole this index exists to close.
 */
export function normaliseEmailKey(email: string): string {
  // "/" would split the document path, and Firestore forbids it in an id.
  const trimmed = email.trim().toLowerCase().replace(/\//g, '');
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

/**
 * Favourite ids are derived, not random.
 *
 * Saving the same dish twice then writes the same document, which is a no-op —
 * no duplicate hearts, and un-saving is a delete by a path we can compute.
 */
export function favouriteId(kind: 'PRODUCT' | 'RESTAURANT', targetId: string): string {
  return `${kind === 'PRODUCT' ? 'p' : 'r'}_${targetId}`;
}

/** YYYY-MM for a given instant, in the platform's timezone (UTC+4). */
export function periodOf(date: Date): string {
  const local = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
