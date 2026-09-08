'use client';

/**
 * Typed wrappers around the Cloud Functions.
 *
 * Every one returns an `AppErrorCode` on failure rather than a raw exception,
 * so a screen can translate the message instead of showing the user something
 * in English about a Firestore document.
 */

import { httpsCallable, type HttpsCallableResult } from 'firebase/functions';

import { firebaseAuth, firebaseFunctions } from './client';
import { AppErrorCode } from '@/shared/errors';
import type {
  NotificationType,
  SettlementPaymentDirection,
  SettlementPaymentMethod,
  SupportLane,
  SupportTicketStatus,
} from '@/shared/enums';
import type { PlatformBankAccount, Settlement } from '@/shared/models';
import type { SettlementSummary } from '@/shared/pricing';
import type { MessageTranslation, TranslatableLocale } from '@/shared/translation';
import type { PushPlatform } from '@/shared/push';

/**
 * A settlement as it arrives over the wire.
 *
 * Timestamps cross the callable boundary as JSON, not as Firestore
 * `Timestamp`s, so the three date fields are re-typed rather than pretended
 * about — a screen that called `.toDate()` on one of these would throw.
 */
export type SettlementDoc = Omit<Settlement, 'invoicedAt' | 'paidAt' | 'updatedAt'> & {
  invoicedAt: string | null;
  paidAt: string | null;
  updatedAt: string | null;
};

/** Bank transfer details, in either direction. Never card details. */
export type BankAccount = Pick<PlatformBankAccount, 'accountHolder' | 'iban' | 'bankName'> & {
  note?: string | null;
};

export interface CallResult<T> {
  ok: boolean;
  data: T | null;
  errorCode: string | null;
  errorDetail: string | null;
}

/**
 * WAITING FOR FIREBASE TO REMEMBER WHO IS SIGNED IN.
 *
 * This is the fix for the 401 that greeted a panel on almost every cold load
 * and went away the moment somebody pressed "yenidən cəhd et".
 *
 * Restoring a session is asynchronous: on a fresh page load Firebase reads the
 * stored credential from IndexedDB and exchanges it for an ID token, and until
 * that finishes `auth.currentUser` is null. A screen that fires its callable in
 * a mount effect — which is every panel screen — usually beats it, so the
 * request goes out with no Authorization header at all and the server answers
 * 401. Pressing retry a second later works because by then the token exists.
 *
 * It looked intermittent, and it was: on a fast connection Firebase won the
 * race and nobody saw anything. That is the worst kind of bug, because it
 * reaches production looking fixed.
 *
 * `authStateReady()` resolves once Firebase has settled the question either
 * way — signed in with a token, or genuinely signed out. Awaiting it here, in
 * the one place every callable in the app goes through, fixes all ninety of
 * them at once rather than screen by screen, and costs nothing after the first
 * call because the promise is already resolved.
 *
 * It deliberately does NOT wait for somebody to BE signed in: a guest calling
 * `previewOrder` must still get through, and blocking here would hang the
 * shopfront for every visitor who has no account.
 */
async function waitForAuth(): Promise<void> {
  const auth = firebaseAuth();
  if (!auth) return;

  try {
    await auth.authStateReady();
  } catch {
    // Older SDKs, or a broken storage layer. Falling through is the same
    // behaviour this code had before — a possible 401 — rather than a hang.
  }
}

/** Calls a function, turning any failure into a translatable code. */
export async function call<T = unknown>(
  name: string,
  payload: unknown = {},
  /** Internal. Stops the one authentication retry below from looping. */
  retried = false,
): Promise<CallResult<T>> {
  const functions = firebaseFunctions();
  if (!functions) {
    return { ok: false, data: null, errorCode: AppErrorCode.INTERNAL, errorDetail: 'no-config' };
  }

  // Before the request, not after: a call sent without a token is a 401 the
  // caller has to recover from, and recovering from it is what the user was
  // doing by hand.
  await waitForAuth();

  try {
    const callable = httpsCallable(functions, name);
    const result = (await callable(payload)) as HttpsCallableResult<T>;
    return { ok: true, data: result.data, errorCode: null, errorDetail: null };
  } catch (error) {
    const httpsError = error as {
      code?: string;
      message?: string;
      details?: { code?: string; detail?: string };
    };

    /*
     * ONE RETRY, AND ONLY FOR "NOT SIGNED IN".
     *
     * `waitForAuth` above closes the ordinary race, but a token can also be
     * rejected because it expired in the second between being read and being
     * sent — a laptop coming back from sleep is the usual way. Forcing a fresh
     * token and trying once more turns that into nothing the user sees.
     *
     * Safe to retry precisely because of what this error means: the server
     * refused the request before running any of it, so nothing happened that a
     * second attempt could duplicate. No other failure is retried here, and
     * that restriction is deliberate — retrying a timeout on `createOrder`
     * would be how somebody gets two dinners.
     */
    const unauthenticated =
      httpsError.code === 'functions/unauthenticated' ||
      httpsError.details?.code === AppErrorCode.UNAUTHENTICATED;

    if (unauthenticated && !retried) {
      const auth = firebaseAuth();
      if (auth?.currentUser) {
        await auth.currentUser.getIdToken(true).catch(() => undefined);
        return call<T>(name, payload, true);
      }
    }

    return {
      ok: false,
      data: null,
      // `message` carries the code, because that is what the server threw.
      errorCode: httpsError.details?.code ?? httpsError.message ?? AppErrorCode.INTERNAL,
      errorDetail: httpsError.details?.detail ?? null,
    };
  }
}

// --- Account -------------------------------------------------------------

export const registerAccount = (payload: {
  fullName: string;
  email?: string | null;
  locale?: string;
}) => call<{ created: boolean; role: string }>('registerAccount', payload);

export const linkEmail = (email: string) => call<{ email: string }>('linkEmail', { email });

export const saveAddress = (payload: {
  addressId?: string | null;
  label: string;
  line: string;
  note?: string | null;
  regionId: string;
  district?: string | null;
  isDefault?: boolean;
  lat?: number | null;
  lng?: number | null;
  /** The details a map pin cannot carry. All optional; see `Address`. */
  building?: string | null;
  apartment?: string | null;
  floor?: string | null;
  company?: string | null;
  /** The number the courier is given for a delivery to this address. Required. */
  phone?: string | null;
  /** Name and surname of whoever opens the door. Required. */
  contactName: string;
}) =>
  call<{ addressId: string; phoneVerified: boolean; needsCode: boolean }>('saveAddress', payload);

export const deleteAddress = (addressId: string) => call('deleteAddress', { addressId });

/**
 * Sends a six-digit code to the number saved on one address.
 *
 * `alreadyVerified` comes back true — with nothing sent — when the number is
 * the account's own. That is the common case and it costs no message.
 */
export const sendAddressPhoneCode = (payload: { addressId: string }) =>
  call<{ alreadyVerified: boolean; sent: boolean; expiresInMinutes?: number }>(
    'sendAddressPhoneCode',
    payload,
  );

export const verifyAddressPhoneCode = (payload: { addressId: string; code: string }) =>
  call('verifyAddressPhoneCode', payload);

export const sendEmailCode = (email?: string | null) =>
  call<{ expiresInMinutes: number }>('sendEmailCode', { email });

export const verifyEmailCode = (code: string) =>
  call<{ email: string }>('verifyEmailCode', { code });

export const toggleFavourite = (payload: { kind: 'PRODUCT' | 'RESTAURANT'; targetId: string }) =>
  call<{ saved: boolean }>('toggleFavourite', payload);

export const recordConsent = (payload: {
  consentType: string;
  granted: boolean;
  documentVersion?: string | null;
}) => call('recordConsent', payload);

export const requestAccountDeletion = (confirm: string) =>
  call('requestAccountDeletion', { confirm });

/**
 * The customer's own display name.
 *
 * A callable rather than a direct Firestore write, because the name reaches
 * the restaurant's printed ticket and the courier's screen — so it is trimmed,
 * bounded, run through the same profanity filter as reviews, and audited.
 * Past orders keep the name they were placed under; nothing here rewrites one.
 */
export const updateProfile = (fullName: string) =>
  call<{ ok: true; changed: boolean; fullName: string; filtered?: boolean }>('updateProfile', {
    fullName,
  });

/**
 * Moves a telephone number to another account. Super admin only.
 *
 * The support tool for "I lost my number" — which, with sign-in being a code to
 * that number and nothing else, is otherwise the end of somebody's account.
 * `authUpdated: false` means the platform's own records moved but Firebase Auth
 * did not, so the person still cannot sign in and the call should be retried.
 */
export const changeUserPhone = (payload: { uid: string; phone: string; reason: string }) =>
  call<{ ok: true; changed: boolean; authUpdated?: boolean }>('changeUserPhone', payload);

/** Fills in the order counters for accounts created before they existed. */
/**
 * Records that a search led somewhere.
 *
 * Called when a customer OPENS a result, never on a keystroke: a term somebody
 * typed and abandoned is a search that failed, and offering it back to the next
 * customer would be recommending the query that did not work. Fire and forget —
 * nothing on the screen waits for it, and a refusal is not worth a message on
 * the way into a restaurant.
 */
export const recordSearchHit = (term: string) =>
  call<{ ok: true; counted: boolean }>('recordSearchHit', { term });

/** Wipes one term off the public chips. Super admin only. */
export const removeSearchTerm = (term: string) =>
  call<{ ok: true }>('removeSearchTerm', { term });

export const backfillCustomerCounters = (after?: string | null) =>
  call<{ ok: true; scanned: number; updated: number; more: boolean; last: string | null }>(
    'backfillCustomerCounters',
    { after: after ?? null },
  );

/**
 * Saves notification settings.
 *
 * Every field is optional and an absent one is left as it was — a settings
 * screen sends the switches it actually shows, and the customer's screen does
 * not know the operator's nine types exist. `mutedTypes` is refused server-side
 * for any role that `hasPerTypeSwitches` does not name.
 */
export const updateNotificationPrefs = (payload: {
  enabled?: boolean;
  sound?: boolean;
  push?: boolean;
  marketing?: boolean;
  newRestaurants?: boolean;
  reviewReminders?: boolean;
  support?: boolean;
  newOrderSound?: boolean;
  mutedTypes?: NotificationType[];
  /** The per-type switches this screen shows, and only those. */
  types?: Partial<Record<NotificationType, boolean>>;
}) => call('updateNotificationPrefs', payload);

/**
 * "I am here" — and, for a staff account, a line in the audit log.
 *
 * Called on sign-in and again with `END` when somebody presses Çıxış. For a
 * customer it does nothing but move `lastSeenAt`; for an account that can
 * suspend a restaurant or read an order it records the session. See
 * `functions/src/users/account.ts` for why the two are treated differently.
 */
export const touchSession = (event?: 'END') =>
  call<{ audited: boolean }>('touchSession', event ? { event } : {});

/**
 * "Test bildirişi göndər".
 *
 * Writes a real notification to the caller's own inbox, so what comes back is
 * only what the SERVER managed to do. Whether it then arrives is the thing the
 * person is about to watch for on their own screen — which is the whole point
 * of the button, and why there is nothing here that could fake it.
 */
export const sendTestNotification = () =>
  call<{ ok: boolean; soundEnabled: boolean }>('sendTestNotification', {});

// --- Orders --------------------------------------------------------------

export interface CartLinePayload {
  productId: string;
  quantity: number;
  selectedOptionIds: string[];
  note?: string | null;
}

export const previewOrder = (payload: {
  restaurantId: string;
  items: CartLinePayload[];
  couponCode?: string | null;
  addressId?: string | null;
}) =>
  call<{
    ok: boolean;
    problems: Array<{ productId: string; code: string; detail?: string }>;
    pricing: {
      currency: string;
      subtotal: number;
      discount: number;
      deliveryFee: number;
      total: number;
      belowMinimum: boolean;
    };
    couponError: string | null;
    couponFundedBy: string | null;
    open: boolean;
  }>('previewOrder', payload);

export const createOrder = (payload: {
  restaurantId: string;
  clientRequestId: string;
  paymentMethod: string;
  addressId: string;
  items: CartLinePayload[];
  couponCode?: string | null;
  customerNote?: string | null;
  deviceId?: string | null;
  /**
   * The item subtotal the customer was shown, in qəpik.
   *
   * The server re-prices from the live menu and refuses with PRICE_CHANGED if
   * the two disagree. Sending it is what makes that guard exist at all — it did
   * nothing for months because no screen ever passed the old `expectedTotal`.
   */
  expectedSubtotal?: number;
}) =>
  call<{ orderId: string; code: string; total: number; duplicated: boolean }>(
    'createOrder',
    payload,
  );

export const prepareReorder = (payload: { orderId: string }) =>
  call<{
    restaurantId: string;
    restaurantName: string;
    restaurantAvailable: boolean;
    restaurantOpen: boolean;
    lines: unknown[];
    products: unknown[];
  }>('prepareReorder', payload);

export const updateOrderStatus = (payload: {
  orderId: string;
  status: string;
  note?: string | null;
  reason?: string | null;
  /**
   * How long the kitchen says the food will take, sent with an acceptance.
   *
   * This is what turns `estimatedDeliveryAt` from a placeholder copied off the
   * restaurant's profile into a number somebody actually stood over the pans
   * and said. Null falls back to that profile estimate.
   */
  prepMinutes?: number | null;
}) => call<{ from: string; to: string }>('updateOrderStatus', payload);

// --- Restaurant ----------------------------------------------------------

export const applyForRestaurant = (payload: Record<string, unknown>) =>
  call<{ restaurantId: string }>('applyForRestaurant', payload);

export const updateRestaurantProfile = (payload: Record<string, unknown>) =>
  call('updateRestaurantProfile', payload);

export const setServiceState = (
  restaurantId: string,
  serviceState: string,
  /**
   * How long a pause lasts, in minutes.
   *
   * Only meaningful with PAUSED, and omitting it is a real choice rather than
   * an oversight: an open-ended pause is what a broken oven needs. A number
   * makes the shop re-open by itself, which is what "busy right now" needs.
   */
  pauseMinutes?: number | null,
) =>
  call<{ serviceState: string; pauseMinutes: number | null }>('setServiceState', {
    restaurantId,
    serviceState,
    pauseMinutes: pauseMinutes ?? null,
  });

export const restaurantDashboard = (restaurantId: string) =>
  call<{
    period: string;
    activeOrders: unknown[];
    monthToDate: {
      commission: number;
      platformCredits: number;
      /** Online takings the platform is holding on the restaurant's behalf. */
      onlineCollected: number;
      /** Positive: the restaurant owes. Negative: the platform owes. */
      netDue: number;
      entryCount: number;
    };
  }>('restaurantDashboard', { restaurantId });

export const setRestaurantStaff = (payload: {
  restaurantId: string;
  phone: string;
  role: string;
}) => call<{ uid: string; invited: boolean }>('setRestaurantStaff', payload);

/**
 * The invited person's answer.
 *
 * Named by the RESTAURANT, not by an invitation id: the invitation belonging to
 * this account and that restaurant is a single deterministic document, and a
 * caller who could name an arbitrary id is a caller worth checking. The server
 * still compares the document's uid against the caller's own.
 */
export const respondToRestaurantInvite = (payload: {
  restaurantId: string;
  accept: boolean;
}) => call<{ accepted: boolean }>('respondToRestaurantInvite', payload);

/** The restaurant withdraws an offer nobody has answered. */
export const cancelRestaurantInvite = (payload: { restaurantId: string; uid: string }) =>
  call('cancelRestaurantInvite', payload);

// --- Menu ----------------------------------------------------------------

export const saveMenuCategory = (payload: Record<string, unknown>) =>
  call<{ categoryId: string }>('saveMenuCategory', payload);

export const deleteMenuCategory = (payload: { restaurantId: string; categoryId: string }) =>
  call('deleteMenuCategory', payload);

export const reorderMenuCategories = (payload: { restaurantId: string; categoryIds: string[] }) =>
  call('reorderMenuCategories', payload);

export const saveProduct = (payload: Record<string, unknown>) =>
  call<{ productId: string }>('saveProduct', payload);

export const deleteProduct = (payload: { restaurantId: string; productId: string }) =>
  call('deleteProduct', payload);

export const setProductAvailability = (payload: {
  restaurantId: string;
  productId: string;
  availability: string;
}) => call('setProductAvailability', payload);

export const reorderProducts = (payload: { restaurantId: string; productIds: string[] }) =>
  call('reorderProducts', payload);

export const bulkAdjustPrices = (payload: {
  restaurantId: string;
  deltaBps: number;
  categoryId?: string | null;
}) => call<{ updated: number }>('bulkAdjustPrices', payload);

/**
 * "Who sells döner?" — searches every menu, returns the restaurants.
 *
 * Deliberately a callable: an unscoped read across all products is not
 * something the security rules should ever permit a browser to do.
 */
export const searchMenu = (payload: { term: string; regionId?: string }) =>
  call<{
    term: string;
    restaurants: Array<{ restaurant: Record<string, unknown>; matchedProducts: string[] }>;
  }>('searchMenu', payload);

export const backfillProductSearch = (after?: string | null) =>
  call<{ scanned: number; updated: number; more: boolean; last: string | null }>(
    'backfillProductSearch',
    after ? { after } : {},
  );

// --- Reviews -------------------------------------------------------------

export const submitReview = (payload: {
  orderId: string;
  rating: number;
  tags?: string[];
  comment?: string | null;
}) => call<{ restaurantId: string }>('submitReview', payload);

export const listReviews = (restaurantId: string) =>
  call<{
    reviews: Array<{
      id: string;
      orderCode: string;
      customerName: string;
      rating: number;
      tags: string[];
      comment: string | null;
      reply: string | null;
      createdAt: { _seconds: number } | null;
    }>;
    breakdown: number[];
  }>('listReviews', { restaurantId });

export const replyToReview = (payload: { reviewId: string; reply: string }) =>
  call('replyToReview', payload);

export const setReviewHidden = (payload: { reviewId: string; hidden: boolean; reason: string }) =>
  call('setReviewHidden', payload);

/** Delivered orders this customer has not reviewed yet. */
export const pendingReviews = () =>
  call<{
    pending: Array<{
      orderId: string;
      orderCode: string;
      restaurantId: string;
      restaurantName: string;
      deliveredAt: { _seconds: number } | null;
    }>;
  }>('pendingReviews');

// --- Complaints ----------------------------------------------------------

export const fileComplaint = (payload: {
  orderId: string;
  reason: string;
  detail?: string | null;
  photoUrls?: string[];
}) => call('fileComplaint', payload);

export const resolveComplaint = (payload: {
  orderId: string;
  /** Whether the complaint itself is upheld. Separate from what is paid out. */
  upheld: boolean;
  resolution: string;
  /** 'NONE' | 'REFUND' | 'COUPON' — see `shared/compensation.ts`. */
  compensation: string;
  /** Qəpik. Ignored when the compensation is NONE. */
  amount: number;
  /** Its own question: does the restaurant still pay commission on this order? */
  waiveCommission: boolean;
}) =>
  call<{
    credited: number;
    couponCode: string | null;
    /** True when money is still to be sent — `refundPayment` does that. */
    refundPending: boolean;
    refundAmount: number;
    paymentId: string | null;
  }>('resolveComplaint', payload);

export const listComplaints = (status?: string) =>
  call<{ complaints: Array<Record<string, unknown>> }>('listComplaints', { status });

// --- Support tickets ------------------------------------------------------

/**
 * Raises a ticket.
 *
 * `restaurantId` is only ever read when an operator or admin opens a thread
 * with a restaurant on the platform's own initiative. A restaurant opening its
 * own ticket does not send one, and would be ignored if it did — the server
 * takes the tenant from the caller's claim, never from the payload.
 */
export const openSupportTicket = (payload: {
  lane: SupportLane;
  subject: string;
  body: string;
  orderId?: string | null;
  restaurantId?: string;
}) => call<{ ticketId: string }>('openSupportTicket', payload);

export const sendSupportMessage = (payload: {
  ticketId: string;
  /** May be empty when photographs are attached — a picture is a message. */
  body: string;
  /** Firebase Storage URLs, at most three; the server checks the host. */
  photoUrls?: string[];
}) => call('sendSupportMessage', payload);

/**
 * Claims this device so the server can reach it when no tab is open.
 *
 * A callable and not a client write: the FCM token is the document id, so a
 * browser able to write the collection could register somebody else's phone
 * against its own account and receive their orders. See
 * `functions/src/notifications/tokens.ts`.
 */
export const registerPushToken = (payload: {
  token: string;
  platform: PushPlatform;
  device?: string | null;
}) => call('registerPushToken', payload);

/** Stops this device being sent to. Called on sign-out as well as on the switch. */
export const unregisterPushToken = (payload: { token: string }) =>
  call('unregisterPushToken', payload);

export const markSupportTicketRead = (ticketId: string) =>
  call('markSupportTicketRead', { ticketId });

/**
 * A machine translation of one support message, into the reader's language.
 *
 * A callable and not a browser API call because the translation service bills
 * by the character: anything the browser may call directly, the browser may be
 * made to call a million times. The server also caches the answer on the
 * message, so the second reader of a thread — and the same reader tomorrow —
 * pays nothing. See `functions/src/support/translate.ts`.
 */
export const translateSupportMessage = (payload: {
  ticketId: string;
  messageId: string;
  target: TranslatableLocale;
}) =>
  call<{ translation: MessageTranslation; cached: boolean }>(
    'translateSupportMessage',
    payload,
  );

export const setSupportTicketStatus = (payload: {
  ticketId: string;
  status: SupportTicketStatus;
}) => call('setSupportTicketStatus', payload);

/**
 * Rates a closed ticket from Ayarlar → Geri bildirim.
 *
 * A callable rather than a direct write because the rating has to reach two
 * documents at once: the transient feedback entry the customer is looking at,
 * and the support ticket, which is the copy that survives the entry being
 * deleted at the end of its retention period.
 */
export const rateSupportFeedback = (payload: {
  feedbackId: string;
  rating: number;
  comment?: string | null;
}) => call('rateSupportFeedback', payload);

export const escalateSupportTicket = (payload: { ticketId: string; reason: string }) =>
  call('escalateSupportTicket', payload);

export const claimSupportTicket = (ticketId: string) =>
  call('claimSupportTicket', { ticketId });

/**
 * The platform's inbox.
 *
 * Timestamps arrive as JSON here rather than as Firestore `Timestamp`s, so the
 * rows are typed loosely and the screen re-subscribes to the ticket it opens.
 */
export const listSupportTickets = (status?: string) =>
  call<{ tickets: Array<Record<string, unknown>> }>('listSupportTickets', { status });

export const supportQueueCounts = () =>
  call<{
    counts: Array<{ lane: SupportLane; active: number; waiting: number; unassigned: number }>;
  }>('supportQueueCounts');

export const migrateSupportConversations = () =>
  call<{ migrated: number; messagesCopied: number }>('migrateSupportConversations');

// --- Platform admin ------------------------------------------------------

export const approveRestaurant = (payload: {
  restaurantId: string;
  commissionRateBps?: number;
}) => call('approveRestaurant', payload);

export const createRestaurantByAdmin = (payload: {
  name: string;
  legalName?: string;
  regionId: string;
  district?: string | null;
  addressLine: string;
  lat: number;
  lng: number;
  ownerPhone: string;
  contactName?: string;
  commissionRateBps?: number;
}) => call<{ restaurantId: string; ownerLinked: boolean }>('createRestaurantByAdmin', payload);

export const rejectRestaurant = (payload: { restaurantId: string; reason: string }) =>
  call('rejectRestaurant', payload);

export const setRestaurantStatus = (payload: {
  restaurantId: string;
  status: string;
  reason: string;
}) => call('setRestaurantStatus', payload);

export const setRestaurantFeatured = (payload: {
  restaurantId: string;
  featured: boolean;
  /**
   * `EDITORIAL` is the platform's own pick — free, and shown as a
   * recommendation. `SPONSORED` was paid for and is shown to the customer as
   * "Reklam". Omitted means editorial: a promotion is never sold by accident.
   */
  kind?: 'EDITORIAL' | 'SPONSORED';
  /** Epoch millis. Required for a sold slot, so it ends without being remembered. */
  untilMs?: number | null;
  /** The monthly fee in qəpik. Posted to the restaurant's ledger, once per month. */
  feeAmount?: number | null;
  /** Written into the audit log — this changes what every customer sees first. */
  reason: string;
}) =>
  call<{ featured: boolean; sponsored: boolean; feePosted: boolean }>(
    'setRestaurantFeatured',
    payload,
  );

/**
 * Removes a restaurant from the platform. Super admin only, not reversible.
 *
 * `confirmName` must be the restaurant's own name — the server checks it, so a
 * misclick in a long list cannot end a business. Refused while an order is
 * moving or a settlement still has a balance; the detail says which.
 */
/**
 * The customer behind one order, for an operator deciding what to do.
 *
 * The payload names an ORDER. The server reads the customer id from that
 * order's document — there is deliberately no way to ask about a customer by
 * name or id. See `functions/src/complaints/context.ts`.
 */
export type CustomerContext = {
  customer: { name: string; phone: string };
  summary: {
    orderCount: number;
    failedCount: number;
    complaintCount: number;
    refundedTotal: number;
    /** True when the window filled up: "at least this many", not "exactly". */
    truncated: boolean;
  };
  orders: Array<{
    id: string;
    code: string;
    restaurantId: string;
    restaurantName: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    total: number;
    refundedAmount: number;
    placedAt: number | null;
    addressLine: string | null;
    contactName: string | null;
    contactPhone: string | null;
    failureReason: string | null;
    failureNote: string | null;
    /** Why a cancelled order was cancelled. See `customerOrderContext`. */
    cancelReason: string | null;
    cancelNote: string | null;
    hasComplaint: boolean;
    isSubject: boolean;
  }>;
};

export const customerOrderContext = (payload: { orderId: string }) =>
  call<CustomerContext>('customerOrderContext', payload);

export const removeRestaurant = (payload: {
  restaurantId: string;
  reason: string;
  confirmName: string;
}) =>
  call<{ alreadyRemoved: boolean; menuItemsDeleted?: number; staffUnlinked?: number }>(
    'removeRestaurant',
    payload,
  );

export const setCommissionRate = (payload: {
  restaurantId: string;
  commissionRateBps: number;
  reason: string;
}) => call('setCommissionRate', payload);

export const setUserStatus = (payload: { uid: string; status: string; reason: string }) =>
  call('setUserStatus', payload);

/**
 * The state of a phone/email index entry — read-only.
 *
 * Answers "is this number really taken, and by what". See
 * `functions/src/users/locks.ts`.
 */
export type AccountLockReport = {
  kind: 'PHONE' | 'EMAIL';
  key: string;
  exists: boolean;
  holderUid: string | null;
  holderExists: boolean;
  holderRole: string | null;
  holderStatus: string | null;
  live: boolean;
  stale: 'NO_UID' | 'NO_ACCOUNT' | 'ANONYMISED' | 'MOVED_ON' | null;
};

export const inspectAccountLocks = (payload: { phone?: string; email?: string }) =>
  call<{ locks: AccountLockReport[] }>('inspectAccountLocks', payload);

/** Refused by the server for a live lock — that is deliberate, not a bug. */
export const releaseAccountLock = (payload: { phone?: string; email?: string }) =>
  call<{ released: boolean; reason: string | null }>('releaseAccountLock', payload);

export const setUserRole = (payload: {
  uid: string;
  role: string;
  restaurantId?: string | null;
  reason: string;
}) => call('setUserRole', payload);

export const createCoupon = (payload: Record<string, unknown>) =>
  call<{ code: string }>('createCoupon', payload);

export const setCouponActive = (payload: { code: string; active: boolean; reason?: string }) =>
  call('setCouponActive', payload);

export const updateCoupon = (payload: Record<string, unknown>) =>
  call<{ code: string }>('updateCoupon', payload);

export const listCoupons = () =>
  call<{ coupons: Array<Record<string, unknown>> }>('listCoupons');

/**
 * One coupon's redemptions, newest first.
 *
 * Carries no customer name by design — see `couponRedemptions` on the server.
 * `createdAt` arrives as the admin SDK's `_seconds` shape, like every other
 * timestamp that crosses this boundary.
 */
export const couponRedemptions = (code: string) =>
  call<{
    redemptions: Array<{
      orderId: string;
      orderCode: string | null;
      discountAmount: number;
      platformFunded: number;
      restaurantFunded: number;
      phoneMasked: string;
      createdAt: { _seconds?: number; seconds?: number } | null;
    }>;
  }>('couponRedemptions', { code });

/**
 * A customer a coupon is addressed to.
 *
 * The short display name — "Aysel M." — and the phone, and nothing else. The
 * server decides that; this type only records that a full legal name is not
 * part of the answer, so nothing downstream can start rendering one.
 */
export interface CouponCustomerRow {
  uid: string;
  phone: string;
  name: string;
}

/** Who a coupon is for. `named: false` means it is open to everybody. */
export const couponCustomers = (code: string) =>
  call<{ named: boolean; customers: CouponCustomerRow[] }>('couponCustomers', { code });

/** Adds a customer to a personal coupon, found by their phone number. */
export const addCouponCustomer = (payload: { code: string; phone: string; reason?: string }) =>
  call<{ customers: CouponCustomerRow[] }>('addCouponCustomer', payload);

/**
 * Takes a customer off a personal coupon.
 *
 * `deactivated` is true when that was the last name on it — an empty list would
 * mean "everybody", so the server switches the coupon off instead.
 */
export const removeCouponCustomer = (payload: {
  code: string;
  customerId: string;
  reason?: string;
}) => call<{ deactivated: boolean }>('removeCouponCustomer', payload);

/**
 * Gives one customer a coupon.
 *
 * Two shapes in one call: with `code`, an existing personal coupon gains this
 * customer; without one, a new coupon is created for them alone and its
 * generated code comes back.
 */
export const grantCustomerCoupon = (payload: {
  customerId: string;
  code?: string;
  type?: string;
  value?: number;
  minSubtotal?: number;
  maxDiscount?: number | null;
  validFrom?: number;
  validUntil?: number;
  reason?: string;
}) => call<{ code: string }>('grantCustomerCoupon', payload);

/**
 * One ledger row as it crosses the callable boundary.
 *
 * `createdAt` is deliberately absent: the admin SDK serialises a Firestore
 * timestamp into a shape the browser's SDK cannot turn back into a date, and a
 * screen that tried would render "Invalid Date" next to somebody's money. The
 * period and the order code in the description are what these rows are read by.
 */
export interface LedgerRowDoc {
  id: string;
  orderId: string | null;
  type: string;
  /** Signed: positive means the restaurant owes the platform. */
  amount: number;
  currency: string;
  description: string;
  /** What the order was sold for, on a commission row. Null on every other. */
  orderTotal: number | null;
}

export const getSettlement = (payload: { restaurantId: string; period?: string }) =>
  call<{
    period: string;
    settlement: SettlementDoc | null;
    entries: LedgerRowDoc[];
    summary: SettlementSummary;
    computedNetDue: number;
    /** The last twelve months, newest first. */
    history: SettlementDoc[];
    commissionRateBps: number | null;
    payout: BankAccount | null;
    platformBankAccount: BankAccount | null;
  }>('getSettlement', payload);

export const listSettlements = (period?: string) =>
  call<{
    period: string;
    settlements: SettlementDoc[];
    totals: {
      commission: number;
      credits: number;
      onlineCollected: number;
      grossSales: number;
      /** What restaurants owe the platform, before netting. */
      owedToPlatform: number;
      /** What the platform owes restaurants, before netting. */
      owedToRestaurants: number;
      netDue: number;
    };
  }>('listSettlements', { period });

export const adjustLedger = (payload: {
  restaurantId: string;
  period: string;
  amount: number;
  description: string;
}) => call('adjustLedger', payload);

export const setSettlementStatus = (payload: {
  restaurantId: string;
  period: string;
  status: string;
  reason: string;
}) => call('setSettlementStatus', payload);

/**
 * Files a payment against a month, in whichever direction it moved.
 *
 * `reference` is what makes it idempotent — the bank's reference for the
 * transfer — so filing the same statement line twice moves the balance once.
 */
export const recordSettlementPayment = (payload: {
  restaurantId: string;
  period: string;
  amount: number;
  direction: SettlementPaymentDirection;
  method: SettlementPaymentMethod;
  reference: string;
  paidAt?: number;
  note?: string | null;
}) =>
  call<{
    entryId: string;
    /** False when this reference had already been filed. */
    recorded: boolean;
    netDue: number | null;
    status: string | null;
  }>('recordSettlementPayment', payload);

/** The bank account the restaurant is paid into. Owner only, server-validated. */
export const setPayoutDetails = (payload: {
  restaurantId: string;
  accountHolder: string;
  iban: string;
  bankName: string;
}) => call('setPayoutDetails', payload);

export const updatePublicSettings = (payload: Record<string, unknown>) =>
  call('updatePublicSettings', payload);

// --- The pre-launch test-data reset ---------------------------------------

/**
 * What is in each collection right now, and whether the reset is permitted.
 *
 * Read every time the dialog opens rather than once with the page: the whole
 * point of the counts is that the person confirming is looking at what is
 * actually there, not at what was there when they arrived.
 */
export const platformResetStatus = () =>
  call<{
    /** False until an admin turns the switch on in Ayarlar. */
    enabled: boolean;
    platformName: string;
    counts: Record<string, number>;
    countCap: number;
    /** The collections no scope can reach. Listed to the owner verbatim. */
    kept: string[];
  }>('platformResetStatus');

/**
 * Deletes the chosen test data.
 *
 * `done` is false when the invocation's budget ran out with documents still
 * left; the screen then offers the button again, and running it a second time
 * simply continues — there is no resume token, because "what is left" is what
 * is still in the collections.
 */
export const resetPlatformData = (payload: {
  scopes: string[];
  /** The platform's name, as the owner typed it. */
  confirmation: string;
  limit?: number;
}) =>
  call<{
    scopes: string[];
    deleted: Record<string, number>;
    nestedDeleted: Record<string, number>;
    remaining: Record<string, number>;
    documentsDeleted: number;
    done: boolean;
    countCap: number;
  }>('resetPlatformData', payload);

/**
 * Sales for a date range: totals, one line per dish, one line per day.
 *
 * `from`/`to` are plain millisecond timestamps — the screen decides what a
 * "month" means locally, and the server only has to agree on an interval.
 */
export const restaurantReport = (payload: { restaurantId: string; from: number; to: number }) =>
  call<{
    from: number;
    to: number;
    truncated: boolean;
    /** Null when the platform default applies rather than an agreed rate. */
    commissionRateBps: number | null;
    totals: {
      orderCount: number;
      itemsSold: number;
      grossSales: number;
      deliveryFees: number;
      discounts: number;
      commission: number;
      platformCredits: number;
      netToRestaurant: number;
      averageOrder: number;
      failedCount: number;
      failedValue: number;
      failedByStatus: Record<string, number>;
      /**
       * How the kitchen is run, as opposed to how much it sold.
       *
       * Null rather than zero where there is nothing to measure — a restaurant
       * with no orders has not achieved a perfect acceptance rate.
       */
      acceptanceRate: number | null;
      rejectedCount: number;
      expiredCount: number;
      averageAnswerMinutes: number | null;
      averagePrepMinutes: number | null;
    };
    products: Array<{
      productId: string;
      name: string;
      quantity: number;
      revenue: number;
      orderCount: number;
    }>;
    daily: Array<{ day: string; revenue: number; orders: number }>;
  }>('restaurantReport', payload);

/** The marketplace's own numbers for a date range. Admin only. */
export const platformReport = (payload: { from: number; to: number }) =>
  call<{
    truncated: boolean;
    totals: {
      placed: number;
      completed: number;
      cancelled: number;
      grossSales: number;
      commission: number;
      platformCredits: number;
      netCommission: number;
      averageOrder: number;
      cancelRateBps: number;
    };
    daily: Array<{ day: string; orders: number; revenue: number; commission: number }>;
    restaurants: Array<{ restaurantId: string; name: string; orders: number; revenue: number }>;
  }>('platformReport', payload);

export const bootstrapSuperAdmin = (secret: string) =>
  call('bootstrapSuperAdmin', { secret });

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** The courier went out and came back with the food. */
export const reportDeliveryFailure = (payload: {
  orderId: string;
  reason: string;
  note?: string | null;
}) => call('reportDeliveryFailure', payload);

/** Hands an order to one of the restaurant's couriers, or clears it (`courierId: null`). */
export const assignCourier = (payload: { orderId: string; courierId?: string | null }) =>
  call('assignCourier', payload);

/**
 * Gives the customer their six digits. `code` is null when a live one already
 * exists and cannot be shown again — see `unchanged`.
 */
export const issueDeliveryCode = (orderId: string) =>
  call<{ code: string | null; unchanged: boolean }>('issueDeliveryCode', { orderId });

/**
 * The driver says they have the delivery.
 *
 * Nothing about the order's status moves — the food is exactly where it was.
 * What it records is that the phone the delivery was handed to is a phone
 * somebody is holding, which is the only thing that clears the operator's
 * "assigned and nobody answered" alert.
 */
export const acceptDelivery = (orderId: string) => call('acceptDelivery', { orderId });

/** The courier closes the order at the door, with the code if the restaurant asks for one. */
export const courierConfirmDelivery = (payload: { orderId: string; code?: string | null }) =>
  call('courierConfirmDelivery', payload);

/** The coupons this customer can actually use. Advisory — checkout re-checks. */
export const myCoupons = () =>
  call<{
    coupons: Array<{
      code: string;
      type: string;
      value: number;
      minSubtotal: number;
      maxDiscount: number | null;
      firstOrderOnly: boolean;
      restaurantIds: string[];
      restaurants: Array<{ id: string; name: string; slug: string }>;
      validUntil: { _seconds?: number; seconds?: number } | null;
      usedByMe: number;
      remainingForMe: number;
    }>;
  }>('myCoupons');

// ---------------------------------------------------------------------------
// Online payment
// ---------------------------------------------------------------------------

/**
 * Opens a payment for an order and returns where to send the customer.
 *
 * The amount is never passed in: the server reads it from the stored order, so
 * a client cannot ask to pay less than the order is worth.
 */
export const startOnlinePayment = (orderId: string) =>
  call<{ redirectUrl: string; paymentId: string; reused: boolean }>('startOnlinePayment', {
    orderId,
  });

/**
 * Asks what actually happened to a payment.
 *
 * The success page calls this rather than believing the URL it landed on —
 * that URL proves the customer's browser was redirected, nothing more.
 */
export const paymentStatus = (paymentId: string) =>
  call<{ state: string; orderId: string; amount: number }>('paymentStatus', { paymentId });

/** An operator sends money back. Audited; the ledger keeps the record. */
export const refundPayment = (payload: {
  paymentId: string;
  reason: string;
  amount?: number;
}) => call<{ refunded: number; full: boolean }>('refundPayment', payload);

/**
 * The payments an operator can look at, for a date range.
 *
 * Reconciliation, not the happy path: every attempt in the window comes back,
 * failed and expired ones included, alongside the totals a reconciliation
 * actually starts from.
 */
export const listPayments = (payload: { from: number; to: number }) =>
  call<{
    payments: Array<{
      id: string;
      orderId: string;
      restaurantId: string;
      provider: string;
      providerTransactionId: string | null;
      providerBankTransactionId: string | null;
      amount: number;
      refundedAmount: number;
      currency: string;
      state: string;
      failureReason: string | null;
      createdAt: { _seconds?: number; seconds?: number } | null;
      confirmedAt: { _seconds?: number; seconds?: number } | null;
    }>;
    totals: { attempted: number; paid: number; refunded: number; failed: number };
  }>('listPayments', payload);
