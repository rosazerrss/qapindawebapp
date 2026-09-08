/**
 * QAPINDA — Firestore document models.
 *
 * MULTI-TENANCY CONTRACT
 * ----------------------
 * Every restaurant-owned document carries `restaurantId`. Security Rules match
 * that field against the caller's `restaurantId` custom claim, so one
 * restaurant can never read or write another's menu, orders or figures. The
 * field is not a convenience — it is the tenant boundary.
 *
 * MONEY
 * -----
 * All amounts are integer minor units (1 ₼ = 100 qəpik). No floats anywhere.
 */

import type {
  ComplaintReason,
  ComplaintStatus,
  AccountStatus,
  AuditAction,
  AuthProvider,
  CancellationReason,
  ConsentType,
  CouponFunding,
  CouponType,
  DeliveryFailureReason,
  FulfillmentType,
  InviteStatus,
  LedgerEntryType,
  ModifierSelection,
  NotificationType,
  OrderActor,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductAvailability,
  RestaurantStatus,
  ServiceState,
  SettlementPaymentDirection,
  SettlementPaymentMethod,
  SettlementStatus,
  SupportLane,
  SupportTicketStatus,
  SupportedLocale,
  UserRole,
} from './enums';
import type { FoodCategoryId } from './categories';
import type { DeliveryZone } from './geo';
import type { PrintStation } from './printStations';
import type { MessageTranslation } from './translation';
import type {
  NotificationDeliveryStatus,
  NotificationPrefs,
  NotificationPriority,
  NotificationStatus,
} from './notifications';

/** Firestore Timestamp on the client, admin Timestamp on the server. */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}

export type MinorUnits = number;
export type CurrencyCode = 'AZN';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** `users/{uid}` — private. Readable by the owner and by platform staff. */
export interface User {
  uid: string;
  /** E.164, e.g. +994501234567. The primary identity: one account per number. */
  phone: string;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  fullName: string;
  role: UserRole;
  /** Set only for restaurant staff roles. Mirrors the custom claim. */
  restaurantId: string | null;
  accountStatus: AccountStatus;
  locale: SupportedLocale;
  /** Which providers are linked to this one account (§ no duplicate accounts). */
  linkedProviders: AuthProvider[];
  /** Anti-fraud signals. Never auto-bans; raises REVIEW_REQUIRED instead. */
  riskFlags: string[];

  /**
   * What this account wants to hear about, and how loudly.
   *
   * Not everything is reachable from here. `shared/notifications.ts` marks
   * which types a setting may hide — a cancelled delivery is not one of them,
   * because a courier who muted their new-order sound is still driving to that
   * address. Sound and push, by contrast, reach every type: anybody may work in
   * silence.
   *
   * Partial because an account that has never opened Settings has never written
   * it. `resolveNotificationPrefs` fills in the defaults, and the server and the
   * screen call the same function, so the two cannot disagree about what a
   * missing field means.
   */
  notificationPrefs?: Partial<NotificationPrefs>;
  /** Set once the customer's first completed order exists. Gates first-order coupons. */
  hasCompletedOrder: boolean;
  /**
   * How many orders this customer has actually completed, and what they came to.
   *
   * WHY THESE ARE STORED RATHER THAN COUNTED
   * ----------------------------------------
   * "Who are my best customers" is a question the admin screen has to answer
   * over the whole roster at once. Counted live it is one query per account —
   * two hundred accounts on screen is two hundred queries, and Firestore cannot
   * sort on a number it does not hold, so the sort would have to happen after
   * fetching everybody. Neither survives a real customer base.
   *
   * They are incremented in the same transaction that already writes
   * `hasCompletedOrder`, so they cost nothing extra and cannot drift from it:
   * an order either completes and moves all three, or completes none of them.
   *
   * Optional, because every account that existed before this field did has none
   * — `backfillCustomerCounters` fills those in, and until it has run a missing
   * value reads as zero rather than as an error.
   */
  completedOrderCount?: number;
  /** Lifetime spend, minor units. The order's total, as the customer paid it. */
  totalSpent?: number;
  /** When the last completed order was delivered. Null for somebody who never ordered. */
  lastOrderAt?: TimestampLike | null;
  /** Last region the customer browsed. Only a convenience, never a permission. */
  lastRegionId: string | null;
  defaultAddressId: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  lastSeenAt: TimestampLike | null;
  /**
   * When this STAFF account's current session was last written to the audit log,
   * and from which address.
   *
   * Only ever set on work accounts — see `touchSession`. They are what stops one
   * person reloading the admin panel all morning from becoming forty entries,
   * and what makes the same account appearing from a new address a new one.
   */
  sessionAuditedAt?: TimestampLike | null;
  sessionAuditedIp?: string | null;
}

/** `phoneIndex/{e164}` and `emailIndex/{lowercaseEmail}` — uniqueness locks. */
export interface IdentityLock {
  uid: string;
  createdAt: TimestampLike;
}

/** `users/{uid}/addresses/{addressId}` — private to the owner. */
export interface Address {
  id: string;
  label: string;
  line: string;
  /** Free text the courier needs: entrance, floor, flat, landmark. */
  note: string | null;
  /** A `Region.id` from `shared/regions.ts`. Never a typed-in city name. */
  regionId: string;
  /** Baku's administrative district, where the region has them. */
  district: string | null;
  /** Kept as the display string so old orders still read correctly. */
  city: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;

  /*
   * WHAT A MAP PIN CANNOT TELL A COURIER
   * ------------------------------------
   * A pin gets somebody to the right building and then abandons them. These
   * five fields are the rest of the journey — which block, which flat, which
   * floor, which company's reception, and whose phone to ring from the street.
   * Each is optional because plenty of addresses genuinely have none of them
   * (a private house, a shop front), and a required field somebody has to
   * invent an answer for is worse than an empty one.
   */

  /** "Bina/Apartment adı" — the block or building, where it has a name. */
  building?: string | null;
  /** "Mənzil nömrəsi". */
  apartment?: string | null;
  /** "Mərtəbə". */
  floor?: string | null;
  /** "Şirkət" — for an office delivery, the name on the door. */
  company?: string | null;
  /**
   * The number the courier is given for THIS delivery.
   *
   * Separate from the account's phone on purpose: an order sent to a parent's
   * flat or to an office reception should ring the person who will open the
   * door, not the person who has the app. Absent means "use the account's
   * number", which is what every address written before this field says.
   */
  phone?: string | null;

  /**
   * Who opens the door.
   *
   * Name and surname, because "Elvin" at a block of forty flats identifies
   * nobody and the whole point of the field is that the driver can say who
   * they are looking for. Optional in the type only so that every address
   * saved before this existed still parses — `addressDeliverable` in
   * `shared/addressContact.ts` is what refuses to let an order be placed to
   * one, and `saveAddress` is what refuses to write a new one without it.
   */
  contactName?: string | null;

  /**
   * Has `phone` above been proved by SMS?
   *
   * Unverified, this field is a way to send an unwanted courier to any number
   * in the country. See `shared/addressContact.ts` for the whole argument.
   * True automatically when the number IS the account's own verified number,
   * which is the common case and costs no message.
   */
  phoneVerified?: boolean;

  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/**
 * `users/{uid}/favourites/{favouriteId}` — the customer's own shortlist.
 *
 * One document per saved thing, id = `p_{productId}` or `r_{restaurantId}`, so
 * saving twice is impossible and un-saving is a delete by a known path.
 */
export interface Favourite {
  id: string;
  kind: 'PRODUCT' | 'RESTAURANT';
  productId: string | null;
  restaurantId: string | null;
  /** Frozen for the list view, so showing favourites is one query, not N. */
  name: string;
  restaurantName: string;
  restaurantSlug: string;
  imageUrl: string | null;
  price: MinorUnits | null;
  createdAt: TimestampLike;
}

/**
 * `emailVerifications/{uid}` — server only.
 *
 * Holds a hash of the six-digit code, never the code itself: a leaked backup
 * of this collection must not let anyone verify someone else's address.
 */
export interface EmailVerification {
  uid: string;
  email: string;
  codeHash: string;
  expiresAt: TimestampLike;
  attempts: number;
  sentAt: TimestampLike;
  /**
   * Baku-local `YYYY-MM-DD` of the last send, and how many went out that day.
   *
   * Kept on this document rather than in a counter of its own, so there is
   * nothing separate to forget to increment — the same shape the address-phone
   * codes use. Optional because documents written before the daily cap existed
   * have neither field, and an absent day reads as "none sent today".
   */
  dayKey?: string;
  dayCount?: number;
}

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

export interface OpeningHours {
  /** 0 = Sunday … 6 = Saturday. Minutes from midnight, local time. */
  day: number;
  opensAt: number;
  closesAt: number;
  closed: boolean;
}

/** `restaurants/{restaurantId}` — publicly readable once ACTIVE. */
export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  /** Short marketing line shown under the name. */
  tagline: string;
  /** The restaurant's own words for what it cooks. Shown, never filtered on. */
  cuisines: string[];
  /**
   * The platform's closed list of food categories — see `shared/categories.ts`.
   *
   * Optional because every restaurant on the platform predates the field. A
   * document without it is not broken and does not disappear: the home page
   * falls back to `inferFoodCategories(cuisines)` until the owner ticks the
   * boxes in the panel, and the stored value wins from that moment on.
   */
  categories?: FoodCategoryId[];
  status: RestaurantStatus;
  serviceState: ServiceState;
  /**
   * When a PAUSED restaurant re-opens by itself.
   *
   * "Busy for twenty minutes" and "closed until further notice" were the same
   * state, and a kitchen that paused during a rush stayed shut until somebody
   * remembered to press the button again — usually the next morning, having
   * lost the evening. A pause with an end is a pause; one without is a
   * closure.
   *
   * Null means an open-ended pause, which is still allowed: a broken oven has
   * no end time. `resumePausedRestaurants` only touches the ones that named an
   * hour, so nothing re-opens a shop that did not ask to be re-opened.
   */
  pausedUntil?: TimestampLike | null;
  /** Kept for the panel, so it can say "paused for 30 minutes" rather than a clock time. */
  pausedMinutes?: number | null;

  /** A `Region.id`. The home page filters on this, so it must be an id. */
  regionId: string;
  district: string | null;
  /** Display string, kept alongside the id for old records and for search. */
  city: string;
  addressLine: string;
  /** The centre of the delivery circle, picked on the map. */
  lat: number | null;
  lng: number | null;
  /** Straight-line delivery radius. Simple on purpose; polygons can come later. */
  deliveryRadiusMeters: number;

  logoUrl: string | null;
  coverUrl: string | null;
  /** Brand tile colour used where no photo exists yet. */
  brandColor: string;

  minOrderAmount: MinorUnits;
  deliveryFee: MinorUnits;
  /**
   * Distance bands, each with its own fee and minimum.
   *
   * Optional and additive: a restaurant with none is priced by `deliveryFee`
   * and `minOrderAmount` above, exactly as every restaurant on the platform is
   * today. See `deliveryTermsFor` in `shared/geo.ts` for how the two combine
   * and why an unknown distance falls back to the flat fee.
   */
  deliveryZones?: DeliveryZone[] | null;
  /** Above this subtotal the delivery fee is waived. null = never waived. */
  freeDeliveryThreshold: MinorUnits | null;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;

  /** Which payment methods this restaurant actually accepts (POS terminal etc.). */
  paymentMethods: PaymentMethod[];
  /**
   * Whether a courier must type the customer's code to close a delivery.
   *
   * Off unless the restaurant turns it on. A two-person kebab shop where the
   * owner drives the moped himself gains nothing from a code and loses time to
   * it; a restaurant with six drivers gains an answer to "he says he delivered
   * it and the customer says nobody came".
   */
  requireDeliveryCode?: boolean;
  /**
   * Where this restaurant's slips print — see `shared/printStations.ts`.
   *
   * Absent means the one default counter slip, which is what every restaurant
   * had before this existed. It is NOT "printing is off": a missing field must
   * never be the reason a kitchen stops getting tickets.
   */
  printStations?: PrintStation[];
  fulfillmentTypes: FulfillmentType[];

  openingHours: OpeningHours[];

  /**
   * The number a customer may ring about their order.
   *
   * Public on purpose, and distinct from the private `contactPhone` the
   * platform uses to reach the owner: this one is the shop's own line, the
   * number already printed on their door, and a customer whose order is late
   * needs it without going through support.
   */
  publicPhone: string;

  /** Denormalised for listing. Maintained server-side. */
  ratingAverage: number;
  ratingCount: number;
  completedOrderCount: number;
  /**
   * An admin has put this restaurant forward.
   *
   * The only badge that is stored, because it is the only one that is a
   * decision rather than a fact — "new" is a date and "popular" is a count, and
   * both are computed from the fields above. See `shared/badges.ts`.
   */
  featured?: boolean;
  /**
   * Whether this promotion was bought or given.
   *
   * `EDITORIAL` is the platform's own pick, free, and reads as a
   * recommendation. `SPONSORED` was paid for and reads as "Reklam". They are
   * one field rather than two booleans because a promotion is exactly one of
   * the two and a document that says both is a document nothing can render.
   *
   * Absent means editorial: every promotion that existed before this field was
   * a free one, and a backfill that guessed otherwise would relabel the
   * platform's own recommendations as advertising.
   */
  featuredKind?: 'EDITORIAL' | 'SPONSORED' | null;
  /**
   * When the promotion ends, or null for open-ended.
   *
   * A sold slot MUST carry one. `featured` was a bare boolean, and a bare
   * boolean has to be turned off by somebody who remembers — which is how a
   * restaurant that paid for one month stays on top for six. `badgeFor` checks
   * this on every render, and a scheduled sweep clears the flag as well, so
   * neither has to be trusted alone.
   */
  featuredUntil?: TimestampLike | null;
  /**
   * Does this restaurant have at least one dish on offer?
   *
   * Recomputed after any menu change from one indexed query, so the shopfront
   * can mark the card without reading a single product. Optional because a
   * restaurant saved before this existed has no value, and absent reads as no.
   */
  hasDiscount?: boolean;
  /**
   * When the platform removed this restaurant — see `RestaurantStatus.REMOVED`.
   *
   * Absent on every restaurant that is still trading, which is what "is this a
   * tombstone" is actually read from in a hurry.
   */
  removedAt?: TimestampLike | null;

  ownerUserId: string;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  approvedAt: TimestampLike | null;
  approvedBy: string | null;
}

/**
 * `restaurants/{restaurantId}/private/business` — restaurant staff + platform.
 * Commission and contact details never appear in the public document.
 */
export interface RestaurantBusiness {
  legalName: string;
  taxId: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  /** Basis points: 1200 = 12.00%. Integer, so no floating-point commission. */
  commissionRateBps: number;
  /** Minutes the restaurant has to accept a new order before it expires. */
  responseWindowMinutes: number;
  notes: string | null;
  /**
   * Where the platform sends money the restaurant is owed.
   *
   * Null until the owner fills it in — a restaurant that only takes cash never
   * needs it, and demanding an IBAN at sign-up from a shop that will never be
   * paid out is asking for a number nobody will check.
   */
  payout?: PayoutDetails | null;
  updatedAt: TimestampLike;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/** `menuCategories/{categoryId}` */
export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  sortOrder: number;
  visible: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceDelta: MinorUnits;
  available: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  selection: ModifierSelection;
  /** SINGLE groups with required=true must have exactly one option chosen. */
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

/** `products/{productId}` — modifier groups live inline; a product is one read. */
export interface Product {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: MinorUnits;
  /**
   * The price before the discount, struck through on screen.
   *
   * Null when the dish is not on offer. Only ever *higher* than `price` — the
   * server refuses the reverse, because a "discount" that raises the price is
   * how a menu starts lying. `price` stays the one the customer pays and the
   * one every total is built from; this field is presentation only.
   */
  compareAtPrice: MinorUnits | null;
  imageUrl: string | null;
  availability: ProductAvailability;
  popular: boolean;
  sortOrder: number;
  modifierGroups: ModifierGroup[];
  /**
   * Folded words from the name and description.
   *
   * This is what makes "döner" on the home screen find the restaurants that
   * sell one. Written by `saveProduct`; never edited by hand.
   */
  searchTokens: string[];
  /**
   * Is this dish on offer, as saved?
   *
   * Derived from `compareAtPrice > price` (and false when hidden), stored
   * because Firestore cannot compare two fields against each other in a query.
   * That single limitation is the whole reason this field exists — see
   * `functions/src/menu/discounts.ts`.
   */
  discounted?: boolean;
  /**
   * Is the SHOP that sells this dish public right now?
   *
   * Mirrored from the restaurant's status onto every one of its dishes, because
   * a security rule that answered this by reading the restaurant document would
   * pay a document read per product — four hundred of them on one menu.
   *
   * Optional, and the rule asks `!= false` rather than `== true`, so a dish
   * saved before this field existed stays readable instead of every menu on the
   * platform going dark the moment the rule deployed. See
   * `functions/src/menu/visibility.ts`.
   */
  restaurantVisible?: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Frozen at order time. A later price change must not move an old order. */
export interface OrderItemModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: MinorUnits;
}

export interface OrderItem {
  productId: string;
  name: string;
  /**
   * The menu category this dish was in when it was ordered.
   *
   * Frozen onto the item, like its name and its price, because the print
   * stations route on it: a grill station's slip carries the kebabs and
   * nothing else. Looking it up from the product at print time would mean a
   * ticket that changes if somebody reorganises the menu next month, and a
   * ticket for a dish that has since been deleted would have no category at
   * all.
   *
   * Optional because every order placed before this existed has none.
   * `itemsForStation` treats a missing one as "not routed", and a station with
   * no categories chosen prints everything — so an old order still prints in
   * full rather than coming out blank.
   */
  categoryId?: string | null;
  /** Base price at the moment of ordering. */
  unitPrice: MinorUnits;
  quantity: number;
  modifiers: OrderItemModifier[];
  note: string | null;
  /** (unitPrice + Σ modifiers) × quantity. Recomputed server-side. */
  lineTotal: MinorUnits;
}

export interface OrderPricing {
  currency: CurrencyCode;
  subtotal: MinorUnits;
  /** The three buckets added together. Kept for readers that want one number. */
  discount: MinorUnits;
  /** Money off because of a coupon. */
  couponDiscount: MinorUnits;
  /** A price cut the restaurant is running itself. */
  restaurantDiscount: MinorUnits;
  /** A price cut Qapında is funding. */
  platformDiscount: MinorUnits;
  deliveryFee: MinorUnits;
  total: MinorUnits;
}

/**
 * The coupon as it was when this order was placed.
 *
 * A snapshot, not a reference: the campaign can be edited, renamed, re-split or
 * switched off tomorrow, and none of that may change what this order cost or
 * who paid for it.
 */
export interface OrderCouponSnapshot {
  code: string;
  type: CouponType;
  fundedBy: CouponFunding;
  discountAmount: MinorUnits;
  /** The restaurant's share of `discountAmount`, in qəpik. */
  restaurantFunding: MinorUnits;
  /** Qapında's share of `discountAmount`, in qəpik. */
  platformFunding: MinorUnits;
}

export interface OrderAddressSnapshot {
  label: string;
  line: string;
  note: string | null;
  regionId: string;
  district: string | null;
  city: string;
  lat: number | null;
  lng: number | null;

  /**
   * The address details, frozen with the order.
   *
   * Optional because every order placed before these fields existed has none,
   * and because a snapshot is a photograph: it must be readable as it was
   * taken, not patched up later from an address the customer has since edited.
   */
  building?: string | null;
  apartment?: string | null;
  floor?: string | null;
  company?: string | null;
  /** The number the courier rings for this delivery. */
  phone?: string | null;
  /**
   * The name the courier asks for at the door.
   *
   * Frozen onto the order like everything else in this snapshot: the person
   * receiving tonight's dinner is a fact about tonight, and a customer who
   * renames the address next week must not rewrite who answered the door.
   */
  contactName?: string | null;
  /**
   * Was `phone` above the account's own, or somebody else's?
   *
   * Recorded so a delivery failure can be read honestly afterwards. "We rang
   * the number on the address and nobody answered" and "we rang the account
   * holder and nobody answered" are different stories, and an operator handling
   * the complaint needs to know which one happened.
   */
  contactIsAccountHolder?: boolean;
}

/** `orders/{orderId}` — readable by its customer, its restaurant, and platform staff. */
export interface Order {
  id: string;
  /** Human-facing, e.g. "QP-2841". */
  code: string;

  customerId: string;
  customerName: string;
  customerPhone: string;

  restaurantId: string;
  restaurantName: string;
  /**
   * The kitchen's number, frozen onto the order.
   *
   * Copied rather than looked up so the "call the restaurant" button on a
   * customer's order keeps working without reading the restaurant document —
   * which the security rules would refuse once that restaurant is suspended,
   * exactly when somebody most needs to phone them.
   */
  restaurantPhone: string;

  fulfillment: FulfillmentType;
  address: OrderAddressSnapshot | null;

  items: OrderItem[];
  pricing: OrderPricing;
  coupon: OrderCouponSnapshot | null;

  /** Rate frozen at placement so a later change cannot rewrite history. */
  commissionRateBps: number;
  /** Written when the order completes; null until then. */
  commissionAmount: MinorUnits | null;
  /** Platform-funded discount owed back to the restaurant, if any. */
  platformFundedDiscount: MinorUnits;

  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** The online attempt that is carrying this order's money, if any. */
  paymentId?: string | null;
  /**
   * The slot a single online payment attempt is allowed to occupy.
   *
   * Written only inside a transaction on this order, which is what makes "one
   * live attempt per order" true rather than merely likely. Checking for a
   * live attempt with a plain query — as this used to — leaves a window
   * between the read and the write in which a second tap sees no attempt
   * either, opens its own bank session, and the customer is charged twice for
   * one dinner. Two concurrent requests now contend on this one field: the
   * loser retries, sees the claim, and is refused.
   *
   * `claimedAt` is what lets a crashed attempt be taken over: a claim whose
   * payment document never appeared is only respected for a short grace
   * period, after which the slot is free again.
   */
  paymentClaim?: {
    paymentId: string;
    claimedAt: TimestampLike;
  } | null;
  /** Set when a provider confirmed payment to the server. Never by a client. */
  paidAt?: TimestampLike | null;

  status: OrderStatus;
  /** The restaurant must accept before this instant or the order expires. */
  responseDeadlineAt: TimestampLike | null;
  estimatedDeliveryAt: TimestampLike | null;
  /**
   * What the kitchen said it needed, in minutes, when it accepted.
   *
   * Kept beside the resulting timestamp because the two answer different
   * questions: the timestamp is "when will it be here", which is what the
   * customer wants, and this is "how long did they say", which is what a
   * restaurant's own performance report is built from. Absent on every order
   * accepted before the kitchen was asked.
   */
  prepMinutes?: number | null;

  customerNote: string | null;
  cancellation: {
    by: OrderActor;
    reason: CancellationReason;
    note: string | null;
    at: TimestampLike;
  } | null;

  /**
   * The restaurant's driver carrying this order, once one is assigned.
   *
   * A snapshot of the name as well as the id: a courier who leaves next month
   * must not turn last month's orders into a blank space.
   */
  courier: {
    id: string;
    name: string;
    assignedAt: TimestampLike;
    /**
     * When the driver said they had it. Null while nobody has answered.
     *
     * Assignment is the restaurant's decision; acceptance is the driver's. The
     * gap between the two is the only thing that tells an operator a delivery
     * has been handed to a phone that is face-down on a table somewhere, which
     * is what `OPS_COURIER_NOT_ACCEPTED` is for.
     */
    acceptedAt?: TimestampLike | null;
  } | null;

  /**
   * The one-shot operational alerts already raised on this order.
   *
   * A marker per alert, written in the same batch as the notification. The
   * notification's id would already collapse a repeat into one document, but a
   * second write would reset it to unread and ring again — so the scheduled
   * jobs skip an order they have already reported rather than rely on the id to
   * absorb it. "Must not repeat endlessly" is enforced here.
   */
  alerts?: {
    /** Past the promised preparation time with the food still in the kitchen. */
    lateAt?: TimestampLike | null;
    /** The delivery itself is running past its estimate. */
    deliveryLateAt?: TimestampLike | null;
    /** Assigned, and the courier has not answered. */
    courierUnacceptedAt?: TimestampLike | null;
    /** The courier holding this order has gone quiet. */
    courierOfflineAt?: TimestampLike | null;
  } | null;

  /** Set when the customer reviews the order. Null means "still askable". */
  reviewedAt: TimestampLike | null;
  /**
   * When the customer's emailed receipt went out, or absent if it never did.
   *
   * Checked before sending and written only after the provider accepted it, so
   * a retried job sends nothing twice and a failed send is tried again by the
   * next completion rather than being remembered as done.
   */
  receiptEmailedAt?: TimestampLike | null;
  /**
   * When "how was it?" was asked, or decided against.
   *
   * Stamped either way — including when the customer has the reminder switched
   * off — so the hourly job stops re-reading the same order for a day to
   * re-make a decision it already made. It records that the question was
   * settled, not that a message was sent.
   */
  reviewReminderAt?: TimestampLike | null;
  /** Set when a complaint is filed, so the screens can say so at a glance. */
  complaintAt: TimestampLike | null;
  /**
   * An upheld complaint before settlement. The settlement job skips the order
   * entirely, so no commission is ever charged for a meal that failed.
   */
  commissionWaived?: boolean;

  /**
   * Why a delivery that was attempted did not arrive. Only ever set together
   * with `DELIVERY_FAILED`.
   */
  deliveryFailure: {
    reason: DeliveryFailureReason;
    note: string | null;
    at: TimestampLike;
  } | null;


  placedAt: TimestampLike;
  acceptedAt: TimestampLike | null;
  preparingAt: TimestampLike | null;
  readyAt: TimestampLike | null;
  outForDeliveryAt: TimestampLike | null;
  deliveredAt: TimestampLike | null;
  completedAt: TimestampLike | null;
  updatedAt: TimestampLike;
}

/**
 * `deliveryCodes/{orderId}` — the handover secret.
 *
 * Its own collection because it is the one document in the system that *no*
 * client may read: not the customer, not the restaurant, not the courier. Six
 * digits means whoever holds the hash holds the code, so the only safe number
 * of readers is zero. Only the Cloud Functions that issue and check a code
 * touch it, through the Admin SDK, which the security rules do not apply to.
 */
export interface DeliveryCode {
  orderId: string;
  /** SHA-256 of `orderId:code`. The digits themselves are never stored. */
  codeHash: string;
  /** Wrong tries against the current code. Reset when a new one is issued. */
  attempts: number;
  expiresAt: TimestampLike;
  usedAt: TimestampLike | null;
  createdAt: TimestampLike;
}

/** `orders/{orderId}/events/{eventId}` — append-only status trail. */
export interface OrderEvent {
  id: string;
  from: OrderStatus | null;
  to: OrderStatus;
  actor: OrderActor;
  actorId: string;
  note: string | null;
  at: TimestampLike;
}

/** `orders/{orderId}/private/meta` — platform only. Anti-fraud signals. */
export interface OrderPrivateMeta {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  /** Populated when a rule fired, e.g. "same-device-multi-account". */
  riskFlags: string[];
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

/** `coupons/{couponId}` — the document id is the uppercased code. */
export interface Coupon {
  code: string;
  type: CouponType;
  /** PERCENT: basis points. FIXED: minor units. FREE_DELIVERY: ignored. */
  value: number;
  fundedBy: CouponFunding;
  /**
   * How much of the discount Qapında pays, in basis points, when `fundedBy` is
   * SHARED. Ignored otherwise — PLATFORM is always the whole of it and
   * RESTAURANT is always none — but stored on every coupon so the split can be
   * read without first branching on the funding type.
   */
  platformShareBps: number;
  /** Empty = valid at every restaurant. */
  restaurantIds: string[];
  /**
   * Empty = open to every customer. Otherwise the coupon belongs to exactly
   * these people — a thank-you to regulars, or an apology to someone whose
   * order went wrong. Enforced on the server, not merely hidden in the app.
   */
  allowedUserIds: string[];
  minSubtotal: MinorUnits;
  /** Caps a percentage discount. null = uncapped. */
  maxDiscount: MinorUnits | null;
  firstOrderOnly: boolean;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number;
  usedCount: number;
  active: boolean;
  validFrom: TimestampLike;
  validUntil: TimestampLike;
  createdBy: string;
  createdAt: TimestampLike;
}

/**
 * `couponRedemptions/{couponCode}_{customerId}_{orderId}` — server only.
 *
 * Also carries the phone and address hash: the per-account limit alone is easy
 * to walk around with a second account, so the real limit is per person.
 */
export interface CouponRedemption {
  id: string;
  code: string;
  customerId: string;
  orderId: string;
  phone: string;
  addressHash: string;
  deviceId: string | null;
  discountAmount: MinorUnits;
  createdAt: TimestampLike;
}

// ---------------------------------------------------------------------------
// Commission and settlement
// ---------------------------------------------------------------------------

/** `ledgerEntries/{entryId}` — immutable. The source of every invoice figure. */
export interface LedgerEntry {
  id: string;
  restaurantId: string;
  /** YYYY-MM, so a month's entries are one query. */
  period: string;
  orderId: string | null;
  type: LedgerEntryType;
  /** Signed: positive = restaurant owes the platform. */
  amount: MinorUnits;
  currency: CurrencyCode;
  description: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: TimestampLike;

  /**
   * What the order was sold for, carried on the COMMISSION entry only.
   *
   * The month's gross sales have to come from somewhere, and re-reading every
   * order of the month at roll-up time would be thousands of reads to recover a
   * number the settling job already had in its hand. Null on every other kind
   * of entry, and on entries written before this field existed — which is why
   * the roll-up treats a missing value as zero rather than as a reason to fail.
   */
  orderTotal?: MinorUnits | null;

  /** How a PAYMENT_RECEIVED entry moved, and under what reference. */
  paymentDirection?: SettlementPaymentDirection | null;
  paymentMethod?: SettlementPaymentMethod | null;
  paymentReference?: string | null;
  /** When the money actually moved, which is rarely when it was filed. */
  paidAt?: TimestampLike | null;
}

/**
 * Where a restaurant's money is sent.
 *
 * Bank transfer details only. A card number, a CVV or an expiry date is never
 * stored here or anywhere else in Qapında — the platform pays out by transfer,
 * and holding card details would be both useless and a breach waiting to be
 * reported.
 */
export interface PayoutDetails {
  /** The name on the account, which the bank checks against the IBAN. */
  accountHolder: string;
  iban: string;
  bankName: string;
  updatedAt: TimestampLike;
  updatedBy: string;
}

/**
 * The platform's own collection account, shown to restaurants that owe money.
 *
 * Public by necessity: a restaurant cannot pay an invoice to an account it
 * cannot see. It is the platform's account, not a person's, and it holds no
 * card details for the same reason `PayoutDetails` holds none.
 */
export interface PlatformBankAccount {
  accountHolder: string;
  iban: string;
  bankName: string;
  /** What to write in the payment description, e.g. the restaurant's name. */
  note: string | null;
}

/** `settlements/{restaurantId}_{period}` — a month's rolled-up invoice. */
export interface Settlement {
  id: string;
  restaurantId: string;
  restaurantName: string;
  period: string;
  orderCount: number;
  /** What the customers paid for the month's settled orders, summed. */
  grossSales: MinorUnits;
  commissionAmount: MinorUnits;
  platformFundedDiscount: MinorUnits;
  adjustments: MinorUnits;
  /** Online takings the platform received on the restaurant's behalf. */
  onlineCollected: MinorUnits;
  /** What has already been settled in either direction, as a positive figure. */
  paymentsReceived: MinorUnits;
  /**
   * commission − platform-funded discounts + adjustments − online takings −
   * payments already made.
   *
   * The sign carries the meaning and is never dropped: positive means the
   * restaurant pays the platform, negative means the platform pays the
   * restaurant. Every screen must say which of the two it is in words, because
   * a minus sign in front of a number is not an answer to "do I owe you money".
   */
  netDue: MinorUnits;
  currency: CurrencyCode;
  status: SettlementStatus;
  invoicedAt: TimestampLike | null;
  paidAt: TimestampLike | null;
  updatedAt: TimestampLike;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/**
 * `notifications/{notificationId}` — one row in somebody's bell.
 *
 * THE ID IS THE DEDUPLICATION
 * ---------------------------
 * `id` is not random. It is `notificationDedupeKey(...)` — a pure function of
 * the event, the recipient and, where a repeat is legitimate, the day it
 * happened on. Two writes of the same event therefore land on the same document
 * and leave one row, whether they come from a retried transaction, a scheduled
 * job passing over the same order twice, or two function instances racing the
 * same webhook. Nothing downstream has to be clever about it.
 *
 * STORED AS A KEY, NEVER AS A SENTENCE
 * ------------------------------------
 * `titleKey`/`bodyKey` plus `params`, never finished text: somebody who
 * switches the app to Russian must see their old notifications in Russian too.
 */
export interface AppNotification {
  id: string;
  /**
   * The same string as `id`, stored on the document as well.
   *
   * Written from the one place that builds a notification, so the two cannot
   * drift. It exists because a notification is often read out of a snapshot
   * that has been mapped to plain data — and a row that cannot say what its own
   * id is cannot be deduplicated by whoever is holding it.
   */
  notificationId: string;
  /**
   * Who this is for. `recipientId` is the name the system uses for it.
   *
   * `userId` carries the same value and is what the security rules and every
   * index are written against; it predates the rest of this document and
   * renaming it would make every notification already written unreadable to its
   * own owner. Both are set together in `build()` and neither is ever written
   * alone.
   */
  userId: string;
  recipientId: string;
  /** The panel this belongs in — the recipient's role at the time of writing. */
  role: UserRole;
  /** The order this is about, when it is about one. */
  orderId: string | null;
  restaurantId: string | null;
  type: NotificationType;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  link: string | null;
  /** How much of the recipient's attention this is allowed to take. */
  priority: NotificationPriority;
  /**
   * Whether this one should ring, decided against the recipient's settings at
   * the moment it was written.
   *
   * Frozen onto the document rather than recomputed by the bell: a person who
   * turns the sound off should not silence the notification they were already
   * looking at, and a person who turns it on should not make yesterday's ring.
   */
  soundEnabled: boolean;
  read: boolean;
  /** When it was read. Null while unread — `read` is the flag, this is the log. */
  readAt: TimestampLike | null;
  /**
   * The read lifecycle as one word, kept in step with `read`.
   *
   * A duplicate of the boolean, and deliberately so: the notification log is
   * read by a person diagnosing "the restaurant says it never got the order",
   * and `status: "READ"` next to `deliveryStatus: "sent"` is a sentence. A
   * boolean called `read` next to a timestamp is a puzzle. `read` stays because
   * every index and every query in the product is written against it.
   */
  status: NotificationStatus;
  /**
   * Whether this notification is known to have reached a device.
   *
   * NOT WRITTEN AS "sent" BECAUSE IT WAS WRITTEN
   * --------------------------------------------
   * The whole value of this field is that it can say no. A notification the
   * server stored and nobody's browser ever collected is exactly the case
   * somebody is trying to diagnose, and a field set to `sent` at write time
   * would report that case as a success. So the server writes `pending`, and
   * only a client that has actually received the document in the recipient's
   * own session moves it to `sent` — see `confirmNotificationDelivery`.
   * `failed` is written by the server when the write itself could not be
   * completed the first time.
   */
  deliveryStatus: NotificationDeliveryStatus;
  /** When a device confirmed it. Null until one does. */
  deliveredAt: TimestampLike | null;
  /**
   * The sentence a device actually showed, in the language it showed it in.
   *
   * ALONGSIDE `titleKey`/`bodyKey`, NEVER INSTEAD OF THEM. The keys are what
   * every screen renders, which is why a customer who switches to Russian sees
   * last week's notifications in Russian. These two are the log's copy — filled
   * in by the client that received it, because the client is the only part of
   * this system that owns the translations — and nothing reads them back into
   * the product.
   */
  title: string | null;
  body: string | null;
  createdAt: TimestampLike;
}

/** `auditLogs/{logId}` — append-only; no client writes at all. */
export interface AuditLog {
  id: string;
  actorId: string;
  actorRole: UserRole | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  restaurantId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ip: string | null;
  at: TimestampLike;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  consentType: ConsentType;
  documentVersion: string | null;
  granted: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: TimestampLike;
}

/** `systemSettings/public` — world readable, platform writable. */
export interface PublicSettings {
  currency: CurrencyCode;
  city: string;
  /** Default commission applied to a newly approved restaurant. */
  defaultCommissionRateBps: number;
  defaultResponseWindowMinutes: number;
  /** Minutes after delivery before an order auto-completes. */
  autoCompleteAfterMinutes: number;
  /**
   * How long a customer may cancel an order the kitchen has not accepted.
   *
   * Three minutes, and it was written into `shared/orderState.ts` as a
   * constant — which meant changing the platform's own cancellation policy
   * required a developer and a deploy. It is a business rule, not a physical
   * one, and it belongs where the commission rate and the response window
   * already live.
   *
   * Optional: every settings document written before this field has none, and
   * `CUSTOMER_CANCEL_WINDOW_MINUTES` is the answer for those.
   */
  customerCancelWindowMinutes?: number;
  /**
   * Which food categories the home screen shows, in order.
   *
   * The categories themselves live in `shared/categories.ts` — each needs an
   * emoji, search aliases and three translations, which is a commit rather than
   * a form. What belongs here is the half that changes with the city: hiding
   * the ones no restaurant serves, and putting the ones it lives on first.
   *
   * Absent or empty means all of them, in the order the code lists. See
   * `visibleCategories`.
   */
  homeCategories?: string[];
  /** Payment methods the platform allows at all, before a restaurant narrows them. */
  enabledPaymentMethods: PaymentMethod[];
  minimumAge: number;
  supportPhone: string;
  supportEmail: string;
  /**
   * Whether "Dəstəyə zəng et" is offered at all.
   *
   * Off until an admin turns it on, and the number has to be set as well: a
   * button that dials nothing is worse than no button, and a hotline that
   * nobody is sitting behind is worse than both. The customer and restaurant
   * support screens check the flag and the number together.
   */
  supportCallEnabled: boolean;
  /**
   * The platform is closed for technical work — see `shared/maintenance.ts`.
   *
   * While this is true the server refuses `createOrder` and `previewOrder`
   * outright. Every panel keeps working, and orders already in flight are
   * finished normally: the door is shut, the building is not emptied.
   */
  maintenanceMode: boolean;
  /** Optional sentence shown to customers explaining why. Null = no reason given. */
  maintenanceMessage?: string | null;
  /** Optional "back by" time, epoch millis. Null = no promise made. */
  maintenanceUntil?: number | null;
  acceptingNewRestaurants: boolean;
  /** Where a restaurant that owes commission sends it. Null until configured. */
  platformBankAccount: PlatformBankAccount | null;
  /**
   * Whether the pre-launch test-data reset may run at all.
   *
   * Absent — and therefore false — on every deployment. It exists so that the
   * one callable in the system that permanently deletes orders, payments and
   * ledger entries cannot be fired by an accidental click on a live platform:
   * an admin has to come to Ayarlar and switch it on first, that switch is
   * itself written to the audit log, and the reset refuses outright while it
   * is off. Turn it off again the moment the platform has real customers.
   */
  testDataResetEnabled?: boolean;
  /**
   * Does every delivery close with a code from the customer?
   *
   * `requireDeliveryCode` on the restaurant used to be the only answer, and it
   * was off by default — so the ordinary case was a driver marking an order
   * delivered with nothing but their own word. When the customer then says
   * nobody came, there is no fact to appeal to, and both the restaurant and the
   * platform are left arbitrating between two accounts of the same evening.
   *
   * So the platform's answer comes first:
   *
   *   ALWAYS             — every delivery takes a code. The default.
   *   RESTAURANT_CHOICE  — each restaurant's own switch decides.
   *
   * A restaurant may always turn codes ON for itself; what it cannot do is turn
   * them off while the platform says ALWAYS. `deliveryCodeRequired` in
   * `shared/deliveryCode.ts` is the one place that resolves the two, and it is
   * what the server enforces and what the courier's screen displays.
   *
   * Absent means ALWAYS: a settings document written before this field existed
   * should get the safer behaviour, not the older one.
   */
  deliveryCodePolicy?: 'ALWAYS' | 'RESTAURANT_CHOICE';
  legalPlaceholders: Record<string, string>;
  updatedAt: TimestampLike;
}

/**
 * `reviews/{orderId}` — what a customer said about one delivered order.
 *
 * The document id is the order id, so the "only people who ordered may review"
 * rule is structural rather than a check somebody could forget. There is no
 * review that does not correspond to a real, completed order.
 *
 * `customerName` is stored as the *display* name (first name plus an initial),
 * never the full legal name — a review is public and a full name is not.
 */
export interface Review {
  /** Equals the order id. */
  id: string;
  orderId: string;
  orderCode: string;

  restaurantId: string;
  customerId: string;
  /** "Aysel M." — never the full name. */
  customerName: string;

  /** 1–5. Whole stars only; half stars invite meaningless precision. */
  rating: number;
  /** Chosen from the fixed list — free text is optional, tags are not typed. */
  tags: string[];
  comment: string | null;
  /** True when the profanity filter masked something in the comment. */
  filtered?: boolean;

  /** Hidden by a moderator: still stored, no longer shown. */
  hidden: boolean;
  hiddenReason: string | null;

  /** The restaurant may answer once. */
  reply: string | null;
  /** True when the profanity filter masked something in that answer. */
  replyFiltered?: boolean;
  repliedAt: TimestampLike | null;

  createdAt: TimestampLike;
}

/**
 * `complaints/{orderId}` — something was wrong with a delivered order.
 *
 * The money is already with the restaurant: payment happens at the door, and
 * Qapında never touches it. So a complaint cannot "refund" anything. What it
 * does is put the problem in front of the restaurant and the platform, and give
 * the platform its one financial lever — returning the commission on that order
 * so the restaurant is not charged for a meal that failed.
 *
 * Filed once per order. Never deleted; a rejected complaint is still a record.
 */
export interface Complaint {
  /** Equals the order id. */
  id: string;
  orderId: string;
  orderCode: string;

  restaurantId: string;
  restaurantName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;

  reason: ComplaintReason;
  detail: string | null;
  /** True when the profanity filter masked something in the detail. */
  filtered?: boolean;
  /** Storage URLs of photos the customer attached. Often the whole evidence. */
  photoUrls: string[];

  status: ComplaintStatus;
  /** Filled when an operator decides. */
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: TimestampLike | null;
  /** The commission handed back, in qəpik. Zero unless it was waived. */
  creditedAmount: MinorUnits;
  /**
   * What was actually done for the customer.
   *
   * Kept on the complaint rather than reassembled from the ledger, the coupons
   * and the payments, so that "what happened about this?" is one read — which
   * is the question an operator picking up somebody else's case asks first.
   * Absent on every complaint resolved before compensation existed.
   */
  compensation?: {
    kind: 'NONE' | 'REFUND' | 'COUPON';
    amount: MinorUnits;
    /** The personal coupon written for this customer, when one was given. */
    couponCode: string | null;
    /** Whether the restaurant was let off the commission as well. */
    commissionWaived: boolean;
    by: string;
    at: TimestampLike;
  } | null;

  createdAt: TimestampLike;
}

/**
 * `supportTickets/{ticketId}` — one problem, from the first word to closure.
 *
 * A ticket is not a chat window with a status field bolted on. It carries the
 * facts an answerer needs before they ask for them — which order, which
 * restaurant, who raised it — because the alternative is an operator opening
 * with "salam, hansı sifariş?" on every single ticket.
 *
 * WHAT IS FROZEN AND WHY
 * ----------------------
 * `lane`, `customerId`, `restaurantId` and `openedBy` are written once at
 * creation and never change. They are what every access decision reads, in the
 * rules and in the callables alike, so a ticket whose lane could move would be
 * a ticket whose audience could change under the people already writing in it.
 * Escalation therefore does not change the lane: it hands the ticket to the
 * admin by name and leaves the lane — and so the history and the readers —
 * exactly where they were.
 *
 * Names are display names ("Aysel M."), never the legal name on the account.
 * An operator needs to address a person, not to identify them; the phone is on
 * the order for the cases where they must actually reach somebody.
 */
export interface SupportTicket {
  id: string;

  /** Frozen at creation. The whole access story — see `shared/supportState`. */
  lane: SupportLane;

  /** The account that raised it, and the role it raised it as. */
  openedBy: string;
  openedByRole: UserRole;
  /** Display name. Never the full legal name, on any screen. */
  openedByName: string;

  /** Set for both restaurant lanes, and for a customer ticket about an order. */
  restaurantId: string | null;
  restaurantName: string | null;

  /** Set on a customer ticket. Null on a restaurant's own. */
  customerId: string | null;
  customerName: string | null;

  /**
   * The order the ticket was opened from, if any.
   *
   * This is the single most valuable field on the document: it is the
   * difference between "there is a problem with my order" and an operator
   * already looking at the right one.
   */
  orderId: string | null;
  orderCode: string | null;

  /**
   * The rolling one-minute window used to rate-limit messages on this ticket.
   *
   * Kept on the ticket rather than in a counter of its own so the check costs
   * no extra read: the transaction that appends a message is already holding
   * this document. Optional — a ticket written before the limit existed has
   * neither field, which reads as "no messages in the current window".
   */
  rateWindowAt?: TimestampLike;
  rateCount?: number;

  /** The operator working it. Null until somebody picks it up. */
  assignedOperatorId: string | null;
  /** The admin working it. Set by an escalation or by a takeover. */
  assignedAdminId: string | null;

  subject: string;
  status: SupportTicketStatus;

  /** True once anything written into this ticket has been masked. */
  filtered?: boolean;

  /** True once an operator handed it up. The lane does not change with it. */
  escalated: boolean;
  escalatedBy: string | null;
  escalatedAt: TimestampLike | null;
  /** Why the operator could not finish it. Mandatory when escalating. */
  escalationReason: string | null;

  /** A closed ticket is retained, readable and unwritable. Never deleted. */
  closedBy: string | null;
  closedByRole: UserRole | null;
  closedAt: TimestampLike | null;

  /**
   * What the customer thought of how it was handled, 1–5.
   *
   * Kept HERE and not only on the transient `supportFeedback` entry, and that
   * is the whole point of the field: the entry expires after
   * `SUPPORT_FEEDBACK_RETENTION_DAYS` and is deleted, so a rating that lived
   * only there would be deleted with it. The ticket is retained, so the rating
   * is written onto the ticket at the moment it is given.
   *
   * Optional because every ticket closed before Geri bildirim existed has none,
   * and an absent rating is "never asked", not zero.
   */
  supportRating?: number | null;
  supportRatingComment?: string | null;
  supportRatingAt?: TimestampLike | null;

  lastMessage: string;
  lastMessageAt: TimestampLike | null;
  lastSenderRole: UserRole | null;

  /** Counters, so neither side reads the whole thread to draw a badge. */
  unreadForPlatform: number;
  /** Unread by the party who raised it — the customer or the restaurant. */
  unreadForAsker: number;

  /** The `conversations/{restaurantId}` thread this was carried over from. */
  migratedFrom: string | null;

  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/**
 * `supportFeedback/{ticketId}` — one closed ticket, in the customer's Ayarlar.
 *
 * TRANSIENT ON PURPOSE. Written when an operator closes a customer's ticket,
 * read by that customer alone, and deleted by `purgeExpiredSupportFeedback`
 * once `expiresAt` has passed. Nothing here is a financial or legal record —
 * the record is the `SupportTicket`, which is retained and never deleted — and
 * the one thing a person adds to it, their rating, is copied onto that ticket
 * as it is given. See `shared/feedback.ts` for the period and the reasoning.
 */
export interface SupportFeedback {
  /** The same id as the ticket it belongs to. */
  id: string;
  ticketId: string;

  /** The customer this entry belongs to. The only account that may read it. */
  userId: string;

  /** Frozen so the list reads without opening the ticket. */
  subject: string;
  lane: SupportLane;
  orderId: string | null;
  orderCode: string | null;
  restaurantName: string | null;

  /** The role that closed it — an operator or an admin. Never a name. */
  closedByRole: UserRole | null;
  closedAt: TimestampLike;

  /** Null until the customer rates it. 1–5. */
  rating: number | null;
  ratingComment: string | null;
  ratedAt: TimestampLike | null;

  /** When this entry stops being shown and is deleted. */
  expiresAt: TimestampLike;
  createdAt: TimestampLike;
}

/** `supportTickets/{ticketId}/messages/{messageId}` — append-only. */
export interface SupportMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: UserRole;
  /**
   * Shown in the bubble.
   *
   * The platform side is always written as "Qapında dəstək", operator and
   * admin alike. Support speaks with one voice: an individual's name invites
   * going around them, and it tells a restaurant which operator to complain
   * about by name rather than through the lane built for exactly that.
   */
  senderName: string;
  body: string;
  /**
   * Photographs attached to this message.
   *
   * A message may carry pictures with no words at all — "which item was
   * missing?" is often answered fastest with a photograph of the bag — so the
   * body can be empty when this is not. Always an array, so every reader can
   * map over it without first checking whether it exists.
   *
   * Optional in the type because every message written before photographs
   * existed has no such field.
   */
  photoUrls?: string[];
  /** A note the system wrote — an escalation, a takeover, a closure. */
  system: boolean;
  /**
   * True when the profanity filter replaced something in this message.
   *
   * The original words are not kept anywhere: masking is the record, and a
   * field holding what somebody was stopped from saying would be a copy of the
   * abuse sitting in the database waiting to be read. What is kept is the fact
   * that moderation happened, so an operator can see why a sentence has a gap
   * in it and does not read `***` as the person's own typing.
   *
   * Optional because tickets written before the filter existed have no such
   * field, and a missing field is not `false` — it is "never asked".
   */
  filtered?: boolean;
  /**
   * Machine translations of `body`, keyed by language.
   *
   * Written only by `translateSupportMessage`, and only when somebody asked.
   * The original is never touched: this sits beside it, is labelled as machine
   * output wherever it is shown, and exists so that a support thread read in
   * three languages is still one record rather than three approximations of
   * one. See `shared/translation.ts` for why it is a cache and not an
   * automatic translation of everything.
   *
   * Optional because every message written before translation existed has no
   * such field, and a missing field is not an empty map — it is "never asked".
   */
  translations?: Record<string, MessageTranslation>;
  /** When the most recent translation of this message was fetched. */
  translatedAt?: TimestampLike;
  createdAt: TimestampLike;
}

/**
 * `conversations/{restaurantId}` — the pre-ticket support thread.
 *
 * The design used to be one permanent thread per restaurant, and customers
 * were deliberately excluded from it. Both halves of that have been reversed:
 * customer support is now in scope, and a thread is now a ticket that can be
 * closed. Every document of this shape was migrated into a `SupportTicket`
 * with its messages intact; the originals are retained and read by nothing but
 * the migration.
 */
export interface Conversation {
  /** Equals the restaurant id. */
  id: string;
  restaurantId: string;
  restaurantName: string;

  lastMessage: string;
  lastMessageAt: TimestampLike | null;
  lastSenderRole: UserRole | null;

  /** Counters, so neither side has to read the whole thread to see a badge. */
  unreadForPlatform: number;
  unreadForRestaurant: number;

  createdAt: TimestampLike;
}

/** `conversations/{restaurantId}/messages/{messageId}` — append-only. */
export interface ConversationMessage {
  id: string;
  restaurantId: string;
  senderId: string;
  senderRole: UserRole;
  /** Shown in the bubble. The platform side is written as "Qapında dəstək". */
  senderName: string;
  body: string;
  createdAt: TimestampLike;
}

/** `idempotencyKeys/{key}` — server only. Guards order and ledger writes. */
export interface IdempotencyRecord {
  key: string;
  operation: string;
  resultRef: string | null;
  createdAt: TimestampLike;
}

/**
 * `restaurantInvites/{restaurantId}__{uid}` — an offer of a job, awaiting an
 * answer.
 *
 * WHY THIS DOCUMENT EXISTS
 * ------------------------
 * `setRestaurantStaff` used to take a telephone number and change that
 * account's role there and then. The person found out by opening the app and
 * discovering it had become a restaurant panel — no message, no question, and
 * no way back except asking the restaurant to undo it. It also meant anybody
 * who could manage staff could bind a stranger's account to their business by
 * typing a number they had seen once.
 *
 * Now the number produces this instead: a named offer that does nothing until
 * the person accepts it. Their role changes on their own tap and on nothing
 * else.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * -------------------------------
 * The invited person's name and telephone number. The restaurant already knows
 * the number — they typed it — and the document is readable by every member of
 * that restaurant's staff who can manage the team. Copying the person's real
 * name into it would publish it to a group the person has not joined and may
 * refuse to.
 */
export interface RestaurantInvite {
  id: string;
  restaurantId: string;
  /** Shown to the invited person: "X restoranı sizi dəvət edir". */
  restaurantName: string;
  /** The account being invited. */
  uid: string;
  /** What they are being offered. Never RESTAURANT_OWNER — see the callable. */
  role: UserRole;
  status: InviteStatus;
  invitedBy: string;
  createdAt: TimestampLike;
  expiresAt: TimestampLike;
  /** When it was accepted, declined or withdrawn. Null while pending. */
  answeredAt: TimestampLike | null;
}
