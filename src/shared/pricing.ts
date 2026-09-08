/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Money.
 *
 * Every figure a customer or a restaurant ever sees is produced here, and the
 * server runs it again at order time. Prices that arrive from a browser are
 * treated as a stale hint, never as a fact: the cart may have been sitting open
 * while the restaurant changed a price.
 *
 * All amounts are integer minor units (qəpik). Percentages are basis points
 * (1200 = 12.00%), so commission never drifts through floating point.
 */

import { CouponFunding, CouponType, LedgerEntryType, ProductAvailability } from './enums';
import { deliveryTermsFor } from './geo';
import type {
  Coupon,
  CurrencyCode,
  MinorUnits,
  ModifierGroup,
  OrderItem,
  OrderItemModifier,
  OrderPricing,
  Product,
  Restaurant,
} from './models';

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

export interface CartLineInput {
  productId: string;
  quantity: number;
  /** Option ids the customer picked, grouped by modifier group id. */
  selectedOptionIds: string[];
  note?: string | null;
}

export type LineError =
  | 'product-not-found'
  | 'product-unavailable'
  | 'invalid-quantity'
  | 'modifier-required'
  | 'modifier-too-few'
  | 'modifier-too-many'
  | 'modifier-unknown'
  | 'modifier-unavailable';

export interface LineResult {
  ok: boolean;
  error?: LineError;
  detail?: string;
  item?: OrderItem;
}

const MAX_QUANTITY_PER_LINE = 30;

/**
 * Turns one cart line into a priced, frozen order item — validating the
 * modifier rules the restaurant configured on its way through.
 */
export function buildOrderItem(line: CartLineInput, product: Product | undefined): LineResult {
  if (!product) return { ok: false, error: 'product-not-found' };
  if (product.availability !== ProductAvailability.AVAILABLE) {
    return { ok: false, error: 'product-unavailable', detail: product.name };
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY_PER_LINE) {
    return { ok: false, error: 'invalid-quantity', detail: product.name };
  }

  const selected = new Set(line.selectedOptionIds);
  const modifiers: OrderItemModifier[] = [];

  for (const group of product.modifierGroups ?? []) {
    const chosen = group.options.filter((option) => selected.has(option.id));

    if (group.required && chosen.length === 0) {
      return { ok: false, error: 'modifier-required', detail: group.name };
    }
    if (chosen.length < (group.required ? Math.max(1, group.minSelect) : group.minSelect)) {
      return { ok: false, error: 'modifier-too-few', detail: group.name };
    }
    if (group.maxSelect > 0 && chosen.length > group.maxSelect) {
      return { ok: false, error: 'modifier-too-many', detail: group.name };
    }
    for (const option of chosen) {
      if (!option.available) {
        return { ok: false, error: 'modifier-unavailable', detail: option.name };
      }
      modifiers.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }

  // Any selected id that belongs to no group of this product is a stale cart.
  const knownIds = new Set(
    (product.modifierGroups ?? []).flatMap((group) => group.options.map((option) => option.id)),
  );
  for (const id of selected) {
    if (!knownIds.has(id)) return { ok: false, error: 'modifier-unknown', detail: id };
  }

  const unit = product.price + modifiers.reduce((sum, modifier) => sum + modifier.priceDelta, 0);

  return {
    ok: true,
    item: {
      productId: product.id,
      name: product.name,
      // Frozen for the print stations — see `OrderItem.categoryId`.
      categoryId: product.categoryId ?? null,
      unitPrice: product.price,
      quantity: line.quantity,
      modifiers,
      note: line.note?.trim() ? line.note.trim().slice(0, 200) : null,
      lineTotal: unit * line.quantity,
    },
  };
}

export function subtotalOf(items: readonly OrderItem[]): MinorUnits {
  return items.reduce((sum, item) => sum + item.lineTotal, 0);
}

// ---------------------------------------------------------------------------
// Delivery fee
// ---------------------------------------------------------------------------

/**
 * What this delivery costs.
 *
 * Two things decide it, in this order. The distance picks a band — see
 * `deliveryTermsFor` in `shared/geo.ts`, and note that a restaurant with no
 * bands, or a delivery whose distance is unknown, simply gets the flat fee it
 * always got. Then the free-delivery threshold can waive whatever that came to.
 *
 * The threshold waives the *zone's* fee, not the flat one. A restaurant that
 * charges 3 ₼ to the far edge and promises free delivery over 30 ₼ means free
 * to the far edge as well; reading the flat fee here would leave that customer
 * paying a fee the restaurant told them they would not.
 */
export function deliveryFeeFor(
  restaurant: Pick<
    Restaurant,
    'deliveryFee' | 'freeDeliveryThreshold' | 'minOrderAmount' | 'deliveryZones'
  >,
  subtotal: MinorUnits,
  distanceMetres?: number | null,
): MinorUnits {
  const terms = deliveryTermsFor({
    zones: restaurant.deliveryZones,
    distanceMetres: distanceMetres ?? null,
    fee: restaurant.deliveryFee,
    minOrderAmount: restaurant.minOrderAmount,
  });

  const threshold = restaurant.freeDeliveryThreshold;
  if (threshold !== null && threshold >= 0 && subtotal >= threshold) return 0;
  return terms.fee;
}

/** The basket this delivery has to be worth — the zone's minimum, or the shop's. */
export function minimumFor(
  restaurant: Pick<Restaurant, 'deliveryFee' | 'minOrderAmount' | 'deliveryZones'>,
  distanceMetres?: number | null,
): MinorUnits {
  return deliveryTermsFor({
    zones: restaurant.deliveryZones,
    distanceMetres: distanceMetres ?? null,
    fee: restaurant.deliveryFee,
    minOrderAmount: restaurant.minOrderAmount,
  }).minOrderAmount;
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export type CouponError =
  | 'coupon-not-found'
  | 'coupon-inactive'
  | 'coupon-expired'
  | 'coupon-not-started'
  | 'coupon-wrong-restaurant'
  | 'coupon-below-minimum'
  | 'coupon-first-order-only'
  | 'coupon-limit-reached'
  | 'coupon-already-used'
  | 'coupon-not-for-customer';

export interface CouponContext {
  subtotal: MinorUnits;
  deliveryFee: MinorUnits;
  restaurantId: string;
  /** True when this customer has never completed an order. */
  isFirstOrder: boolean;
  /** How many times this person already redeemed this coupon. */
  redemptionsByCustomer: number;
  /** Who is ordering. Needed for coupons aimed at named customers. */
  customerId: string;
  nowMillis: number;
}

export interface CouponResult {
  valid: boolean;
  error?: CouponError;
  discount: MinorUnits;
  fundedBy?: CouponFunding;
  /** The discount split, in money, at the moment it was applied. */
  funding?: CouponFundingSplit;
}

/**
 * Who actually pays for a discount, in qəpik.
 *
 * Two numbers rather than a percentage, because the percentage can be
 * renegotiated and the money cannot: once an order is placed, the split it was
 * placed under is a fact about that order forever. `restaurant + platform`
 * always equals the discount exactly — the rounding is resolved here, once, so
 * no downstream sum can drift by a qəpik.
 */
export interface CouponFundingSplit {
  restaurant: MinorUnits;
  platform: MinorUnits;
}

/** Splits `discount` according to how the coupon is funded. */
/**
 * WHO A COUPON IS FOR — the arithmetic of `allowedUserIds`.
 *
 * A coupon addressed to named customers is enforced by `evaluateCoupon` below,
 * which refuses anybody not on the list. These two functions are the other end
 * of the same rule: how that list is allowed to change.
 *
 * They live in `/shared` rather than inside the callable for the usual reason —
 * the two decisions here are the ones that can quietly give a discount to the
 * whole country, and a decision nobody can run in a test is a decision nobody
 * has checked:
 *
 *   - AN EMPTY LIST MEANS "EVERYBODY". So adding the first name to a public
 *     campaign would take that campaign away from every other customer at once,
 *     and removing the last name from a personal coupon would hand it to
 *     everybody. Both are refused or compensated for here, not in a screen.
 *   - The list is bounded, because it is stored in one document.
 */

/** How many customers one coupon may name. Matches the callable's validator. */
export const MAX_COUPON_CUSTOMERS = 200;

export type CouponAudienceError = 'coupon-is-public' | 'coupon-audience-full';

export interface CouponAudienceChange {
  /** The list as it should be stored. Unchanged when nothing happened. */
  allowedUserIds: string[];
  /** False when the customer was already on (or already off) the list. */
  changed: boolean;
  /**
   * Set when the change emptied the list. An empty `allowedUserIds` means
   * "open to everybody", so the caller must switch the coupon off rather than
   * store it as it stands.
   */
  deactivate: boolean;
  error?: CouponAudienceError;
}

/**
 * Puts one customer on a coupon.
 *
 * Refuses a coupon that is currently open to everybody: turning a live public
 * campaign into a private one by adding a name is a platform-wide outage
 * dressed up as a favour. A personal coupon has to be created as one.
 */
export function addCouponCustomerTo(
  current: readonly string[] | null | undefined,
  customerId: string,
  max: number = MAX_COUPON_CUSTOMERS,
): CouponAudienceChange {
  const list = [...(current ?? [])];

  if (list.includes(customerId)) {
    // Already true. Not an error, and not a second audit entry either.
    return { allowedUserIds: list, changed: false, deactivate: false };
  }
  if (list.length === 0) {
    return { allowedUserIds: list, changed: false, deactivate: false, error: 'coupon-is-public' };
  }
  if (list.length >= max) {
    return {
      allowedUserIds: list,
      changed: false,
      deactivate: false,
      error: 'coupon-audience-full',
    };
  }

  return { allowedUserIds: [...list, customerId], changed: true, deactivate: false };
}

/**
 * Takes one customer off a coupon.
 *
 * Removing the last name asks for `deactivate`, because the alternative —
 * storing an empty list — is the same coupon, still active, now valid for
 * everybody on the platform.
 */
export function removeCouponCustomerFrom(
  current: readonly string[] | null | undefined,
  customerId: string,
): CouponAudienceChange {
  const list = [...(current ?? [])];

  if (!list.includes(customerId)) {
    return { allowedUserIds: list, changed: false, deactivate: false };
  }

  const next = list.filter((entry) => entry !== customerId);
  return { allowedUserIds: next, changed: true, deactivate: next.length === 0 };
}

export function splitCouponFunding(
  discount: MinorUnits,
  fundedBy: CouponFunding,
  platformShareBps: number,
): CouponFundingSplit {
  if (fundedBy === CouponFunding.PLATFORM) return { restaurant: 0, platform: discount };
  if (fundedBy === CouponFunding.RESTAURANT) return { restaurant: discount, platform: 0 };

  // SHARED. The platform's share is rounded and the restaurant takes the
  // remainder, so the two halves always add back up to the whole.
  // A stored document can carry anything, including nothing. NaN here would
  // silently produce a NaN discount and a corrupted order total, so the value
  // is forced into range before it is used for arithmetic about money.
  const raw = Number.isFinite(platformShareBps) ? platformShareBps : 0;
  const bps = Math.min(10000, Math.max(0, raw));
  const platform = Math.round((discount * bps) / 10000);
  return { restaurant: discount - platform, platform };
}

/**
 * Validates a coupon and returns the discount it is worth in this cart.
 *
 * `redemptionsByCustomer` is deliberately counted per *person* (phone plus
 * address), not per account — a per-account limit is one new sign-up away from
 * being meaningless.
 */
export function evaluateCoupon(coupon: Coupon | null, context: CouponContext): CouponResult {
  if (!coupon) return { valid: false, error: 'coupon-not-found', discount: 0 };
  if (!coupon.active) return { valid: false, error: 'coupon-inactive', discount: 0 };

  const from = toMillis(coupon.validFrom);
  const until = toMillis(coupon.validUntil);
  if (from && context.nowMillis < from) {
    return { valid: false, error: 'coupon-not-started', discount: 0 };
  }
  if (until && context.nowMillis > until) {
    return { valid: false, error: 'coupon-expired', discount: 0 };
  }

  if (
    (coupon.restaurantIds ?? []).length > 0 &&
    !(coupon.restaurantIds ?? []).includes(context.restaurantId)
  ) {
    return { valid: false, error: 'coupon-wrong-restaurant', discount: 0 };
  }
  if (context.subtotal < coupon.minSubtotal) {
    return { valid: false, error: 'coupon-below-minimum', discount: 0 };
  }
  if (coupon.firstOrderOnly && !context.isFirstOrder) {
    return { valid: false, error: 'coupon-first-order-only', discount: 0 };
  }
  // A coupon addressed to named customers is not merely hidden from everyone
  // else — it is refused for them. Hiding is a UI decision; this is the rule.
  //
  // Read defensively: coupons created before this field existed have no
  // `allowedUserIds` at all, and a stored document is not a TypeScript type.
  // Treating "absent" as "open to everyone" is both the safe reading and the
  // one that matches what those campaigns were sold as.
  const named = coupon.allowedUserIds ?? [];
  if (named.length > 0 && !named.includes(context.customerId)) {
    return { valid: false, error: 'coupon-not-for-customer', discount: 0 };
  }
  if (coupon.usageLimitTotal !== null && coupon.usedCount >= coupon.usageLimitTotal) {
    return { valid: false, error: 'coupon-limit-reached', discount: 0 };
  }
  if (context.redemptionsByCustomer >= coupon.usageLimitPerCustomer) {
    return { valid: false, error: 'coupon-already-used', discount: 0 };
  }

  let discount = 0;
  switch (coupon.type) {
    case CouponType.PERCENT: {
      discount = Math.round((context.subtotal * coupon.value) / 10000);
      if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
      discount = Math.min(discount, context.subtotal);
      break;
    }
    case CouponType.FIXED: {
      discount = Math.min(coupon.value, context.subtotal);
      break;
    }
    case CouponType.FREE_DELIVERY: {
      discount = context.deliveryFee;
      break;
    }
  }

  const finalDiscount = Math.max(0, discount);

  return {
    valid: true,
    discount: finalDiscount,
    fundedBy: coupon.fundedBy,
    // Same reasoning for the split: an older coupon has no share stored, and
    // for PLATFORM or RESTAURANT it is not consulted anyway. Defaulting it
    // keeps an old campaign priced exactly as it always was.
    funding: splitCouponFunding(finalDiscount, coupon.fundedBy, coupon.platformShareBps ?? 0),
  };
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  if (typeof candidate.seconds === 'number') return candidate.seconds * 1000;
  if (typeof value === 'number') return value;
  return null;
}

// ---------------------------------------------------------------------------
// Whole-order pricing
// ---------------------------------------------------------------------------

export interface OrderTotalsInput {
  items: readonly OrderItem[];
  restaurant: Pick<
    Restaurant,
    'deliveryFee' | 'freeDeliveryThreshold' | 'minOrderAmount' | 'deliveryZones'
  >;
  /**
   * How far the food has to travel, in metres.
   *
   * Optional, and its absence is not an error: an order being priced before an
   * address is chosen, a restaurant that never dropped a map pin, and every
   * caller written before delivery zones existed all pass nothing, and all get
   * the flat fee. Only a restaurant that has drawn bands AND a delivery whose
   * distance is known is priced by distance.
   */
  distanceMetres?: number | null;
  /** Money off from a coupon. */
  couponDiscount?: MinorUnits;
  /** A price cut the restaurant is running itself, outside any coupon. */
  restaurantDiscount?: MinorUnits;
  /** A price cut Qapında is funding, outside any coupon. */
  platformDiscount?: MinorUnits;
  currency?: CurrencyCode;
}

export interface OrderTotals extends OrderPricing {
  belowMinimum: boolean;
}

/**
 * Adds up an order.
 *
 * The three discount sources are kept apart all the way through rather than
 * merged into one number, because "who paid for this discount" is a question
 * the settlement has to answer months later and cannot reconstruct from a
 * total. `discount` remains the sum of the three, so every existing reader
 * keeps working.
 *
 * Each bucket is clamped, then the sum is clamped again: three separately
 * plausible discounts can still add up to more than the order is worth, and a
 * negative total would be a refund nobody authorised.
 */
export function calculateTotals(input: OrderTotalsInput): OrderTotals {
  const subtotal = subtotalOf(input.items);
  const deliveryFee = deliveryFeeFor(input.restaurant, subtotal, input.distanceMetres);
  const ceiling = subtotal + deliveryFee;

  const clamp = (value: MinorUnits | undefined) => Math.min(Math.max(0, value ?? 0), ceiling);

  const couponDiscount = clamp(input.couponDiscount);
  const restaurantDiscount = clamp(input.restaurantDiscount);
  const platformDiscount = clamp(input.platformDiscount);

  const discount = Math.min(couponDiscount + restaurantDiscount + platformDiscount, ceiling);
  const total = Math.max(0, ceiling - discount);

  return {
    currency: input.currency ?? 'AZN',
    subtotal,
    discount,
    couponDiscount,
    restaurantDiscount,
    platformDiscount,
    deliveryFee,
    total,
    // The minimum applies to the food, before any discount or delivery fee —
    // and it is the zone's minimum where the restaurant has drawn one, because
    // "we do not drive eight kilometres for six manats" is exactly the rule a
    // far band exists to express.
    belowMinimum: subtotal < minimumFor(input.restaurant, input.distanceMetres),
  };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export interface CommissionInput {
  subtotal: MinorUnits;
  /** The part of the discount the restaurant is paying for. */
  restaurantFunded: MinorUnits;
  /** The part Qapında is paying for. */
  platformFunded: MinorUnits;
  commissionRateBps: number;
}

export interface CommissionResult {
  /** What the commission percentage is applied to. */
  base: MinorUnits;
  amount: MinorUnits;
  /** Owed back to the restaurant because the platform funded the discount. */
  platformFundedDiscount: MinorUnits;
  /** commission − platform-funded discount. What the restaurant actually owes. */
  netDue: MinorUnits;
}

/**
 * Commission is charged on the food the restaurant sold, never on the delivery
 * fee — that money is the restaurant's cost of driving, not its revenue.
 *
 * When the restaurant funds a discount it sold for less, so the base drops.
 * When the platform funds it the restaurant was made whole, so the base stays
 * at full subtotal and the platform owes the discount back.
 */
/**
 * Reads the funding split off an order that has already been placed.
 *
 * Orders written before the split existed carry only `fundedBy` and one
 * discount figure, and they must keep settling exactly as they always did —
 * a migration that re-priced history would be a worse bug than the one it
 * fixed. So the old shape is mapped onto the new one here rather than being
 * rewritten in the database.
 */
export function orderFundingSplit(order: {
  pricing?: { discount?: MinorUnits; couponDiscount?: MinorUnits };
  coupon?: {
    fundedBy: CouponFunding;
    discountAmount: MinorUnits;
    restaurantFunding?: MinorUnits;
    platformFunding?: MinorUnits;
  } | null;
}): CouponFundingSplit {
  const coupon = order.coupon;
  if (!coupon) return { restaurant: 0, platform: 0 };

  // The snapshot is authoritative whenever it is there.
  if (coupon.restaurantFunding !== undefined && coupon.platformFunding !== undefined) {
    return { restaurant: coupon.restaurantFunding, platform: coupon.platformFunding };
  }

  // Older order: one funder, and the discount was the whole coupon's.
  // Every one of these can be absent on an order written before the field
  // existed, and reaching through a missing `pricing` is a TypeError that
  // travels all the way up as a bare INTERNAL. Nothing here is worth taking a
  // screen down for: an unknown funding split is zero, not a crash.
  const amount =
    coupon.discountAmount ?? order.pricing?.couponDiscount ?? order.pricing?.discount ?? 0;
  return splitCouponFunding(amount, coupon.fundedBy, coupon.fundedBy === CouponFunding.PLATFORM ? 10000 : 0);
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  // The restaurant's own share of the discount means it sold for less, so the
  // commission base drops with it. The platform's share left the restaurant
  // whole, so the base stays — and the platform owes that money back. A shared
  // discount does both, each on its own half, which is why the two numbers are
  // carried separately instead of a single "who funded it" flag.
  const restaurantFunded = Math.max(0, input.restaurantFunded);
  const platformFundedDiscount = Math.max(0, input.platformFunded);

  const base = Math.max(0, input.subtotal - restaurantFunded);
  const amount = Math.round((base * input.commissionRateBps) / 10000);

  return {
    base,
    amount,
    platformFundedDiscount,
    netDue: amount - platformFundedDiscount,
  };
}

/**
 * What one order costs the restaurant in commission, ready to put on a screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * "RESTORANLAR ÖZLƏRİ NƏ QƏDƏR KOMİSSİYA ÖDƏYİR GÖRMƏLİDİR — TAM ŞƏFFAF." A
 * monthly total answers "how much"; it does not answer "why". An owner looking
 * at 200 ₼ for the month has to be able to open the orders behind it and read
 * the same arithmetic, order by order, in the same words.
 *
 * Three facts have to be told apart, and a single number cannot tell them:
 *
 *  - **Charged.** The order completed and the commission was posted to the
 *    ledger. `order.commissionAmount` is the figure that was actually billed
 *    and it is authoritative — it was calculated at the rate the order froze,
 *    and a later rate change must never move it.
 *  - **Expected.** The order was delivered but has not completed yet, so
 *    nothing has been billed. The figure is computed from the order's own
 *    frozen rate so the owner can see what is coming, labelled as not final.
 *  - **None.** Cancelled, rejected, expired, failed — or waived after an upheld
 *    complaint. No commission was charged and none ever will be. This must read
 *    as zero rather than being quietly omitted: an order missing from a list is
 *    an order somebody has to go and check.
 */
export const OrderCommissionState = {
  CHARGED: 'CHARGED',
  EXPECTED: 'EXPECTED',
  NONE: 'NONE',
} as const;
export type OrderCommissionState =
  (typeof OrderCommissionState)[keyof typeof OrderCommissionState];

export interface OrderCommissionView extends CommissionResult {
  state: OrderCommissionState;
  /** The rate this order froze at checkout, in basis points. */
  rateBps: number;
}

/** The statuses after which no commission is, or ever will be, charged. */
const NO_COMMISSION_STATUSES: string[] = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'DELIVERY_FAILED',
  'REFUND_PENDING',
  'REFUNDED',
];

/**
 * Reads one order's commission the way both the panel and the ledger read it.
 *
 * Deliberately typed against the fields it actually needs rather than against
 * `Order`, so that a row arriving from a callable as plain JSON — no Firestore
 * types, no methods — can be passed straight in.
 */
export function orderCommission(order: {
  status: string;
  pricing?: { subtotal?: MinorUnits; couponDiscount?: MinorUnits; discount?: MinorUnits } | null;
  commissionRateBps?: number | null;
  commissionAmount?: MinorUnits | null;
  platformFundedDiscount?: MinorUnits | null;
  commissionWaived?: boolean | null;
  coupon?: {
    fundedBy: CouponFunding;
    discountAmount: MinorUnits;
    restaurantFunding?: MinorUnits;
    platformFunding?: MinorUnits;
  } | null;
}): OrderCommissionView {
  const rateBps = order.commissionRateBps ?? 0;
  const nothing: OrderCommissionView = {
    state: OrderCommissionState.NONE,
    rateBps,
    base: 0,
    amount: 0,
    platformFundedDiscount: 0,
    netDue: 0,
  };

  // An order that never became food, and one whose commission an upheld
  // complaint waived, are both "no commission" — for different reasons, but the
  // number on the screen is the same and it is zero.
  if (NO_COMMISSION_STATUSES.includes(order.status)) return nothing;
  if (order.commissionWaived) return nothing;

  const split = orderFundingSplit({ pricing: order.pricing ?? undefined, coupon: order.coupon });

  // Already billed: the stored figure wins over anything recomputed here, so a
  // rate renegotiated last week cannot rewrite what was invoiced last month.
  if (order.commissionAmount !== null && order.commissionAmount !== undefined) {
    const amount = order.commissionAmount;
    const platformFundedDiscount = order.platformFundedDiscount ?? 0;
    return {
      state: OrderCommissionState.CHARGED,
      rateBps,
      base: Math.max(0, (order.pricing?.subtotal ?? 0) - split.restaurant),
      amount,
      platformFundedDiscount,
      netDue: amount - platformFundedDiscount,
    };
  }

  // Not yet billed. Only a delivered order has an expected commission at all —
  // one still in the kitchen may still be cancelled, and showing a figure for
  // it would be charging for food that has not left the building.
  if (order.status !== 'DELIVERED') return nothing;

  return {
    state: OrderCommissionState.EXPECTED,
    rateBps,
    ...calculateCommission({
      subtotal: order.pricing?.subtotal ?? 0,
      restaurantFunded: split.restaurant,
      platformFunded: split.platform,
      commissionRateBps: rateBps,
    }),
  };
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * A month's ledger, added up.
 *
 * Every figure is a positive magnitude — "how much commission", "how much of
 * the customers' money is the platform holding" — and the direction lives in
 * the names, not in the signs. The one signed number is `netDue`, computed by
 * `settlementNetDue` below, because exactly one sign in the whole calculation
 * is one sign that can be got wrong.
 */
export interface SettlementSummary {
  orderCount: number;
  /** What customers paid for the month's settled orders. */
  grossSales: MinorUnits;
  commission: MinorUnits;
  /** Discounts Qapında funded, which it owes back to the restaurant. */
  platformFundedDiscount: MinorUnits;
  /** Online card takings that landed in the platform's account, net of refunds. */
  onlineCollected: MinorUnits;
  /** Signed: a positive adjustment is one the restaurant owes. */
  adjustments: MinorUnits;
  /**
   * Money already moved for this month, as a positive figure when it reduced
   * what the restaurant owes and negative when the platform paid out.
   */
  paymentsReceived: MinorUnits;
}

export const EMPTY_SETTLEMENT_SUMMARY: SettlementSummary = {
  orderCount: 0,
  grossSales: 0,
  commission: 0,
  platformFundedDiscount: 0,
  onlineCollected: 0,
  adjustments: 0,
  paymentsReceived: 0,
};

/**
 * What is left between the two parties at the end of a month.
 *
 *   netDue = commission − platform-funded discounts + adjustments
 *            − online takings − payments already made
 *
 * Positive means the restaurant pays Qapında; negative means Qapında pays the
 * restaurant. Both are ordinary outcomes: a restaurant taking cash at the door
 * has been paid in full and owes its commission, while a restaurant whose
 * customers pay online has been paid nothing and is owed its takings less that
 * same commission.
 */
export function settlementNetDue(summary: SettlementSummary): MinorUnits {
  return (
    summary.commission -
    summary.platformFundedDiscount +
    summary.adjustments -
    summary.onlineCollected -
    summary.paymentsReceived
  );
}

/** Which way the remaining money has to travel. */
export const SettlementDirection = {
  /** The restaurant transfers to Qapında. */
  RESTAURANT_PAYS: 'RESTAURANT_PAYS',
  /** Qapında transfers to the restaurant. */
  PLATFORM_PAYS: 'PLATFORM_PAYS',
  /** Nothing is owed either way. */
  SETTLED: 'SETTLED',
} as const;
export type SettlementDirection =
  (typeof SettlementDirection)[keyof typeof SettlementDirection];

/**
 * Turns the sign into a word.
 *
 * Screens ask this rather than testing `netDue > 0` themselves, so that no
 * screen can accidentally tell an owner they owe money the platform in fact
 * owes them. "Which of us pays" is a decision made once, here.
 */
export function settlementDirection(netDue: MinorUnits): SettlementDirection {
  if (netDue > 0) return SettlementDirection.RESTAURANT_PAYS;
  if (netDue < 0) return SettlementDirection.PLATFORM_PAYS;
  return SettlementDirection.SETTLED;
}

/** The figure to print next to that sentence: always positive. */
export function settlementAmountToShow(netDue: MinorUnits): MinorUnits {
  return Math.abs(netDue);
}

/** One ledger row, as much of it as the arithmetic needs. */
export interface LedgerRowInput {
  type: LedgerEntryType;
  /** Signed: positive = the restaurant owes the platform. */
  amount: MinorUnits;
  orderId?: string | null;
  orderTotal?: MinorUnits | null;
}

/**
 * Folds a month's ledger entries into the summary an invoice is built from.
 *
 * The roll-up job, the restaurant's screen and the admin's screen all call
 * this, so all three can only ever agree. The sign convention it decodes is the
 * one the ledger stores: an amount is positive when the restaurant owes the
 * platform, so the credits — platform discounts, online takings, a payment that
 * has been made — arrive negative and are turned back into positive magnitudes
 * here.
 */
export function summariseLedger(entries: readonly LedgerRowInput[]): SettlementSummary {
  const orders = new Set<string>();
  const summary: SettlementSummary = { ...EMPTY_SETTLEMENT_SUMMARY };

  for (const entry of entries) {
    switch (entry.type) {
      case LedgerEntryType.COMMISSION:
        summary.commission += entry.amount;
        summary.grossSales += entry.orderTotal ?? 0;
        break;
      case LedgerEntryType.PLATFORM_DISCOUNT:
        summary.platformFundedDiscount += -entry.amount;
        break;
      case LedgerEntryType.ONLINE_COLLECTED:
        summary.onlineCollected += -entry.amount;
        break;
      case LedgerEntryType.PAYMENT_RECEIVED:
        summary.paymentsReceived += -entry.amount;
        break;
      default:
        summary.adjustments += entry.amount;
        break;
    }

    // A set, because one order writes several entries — commission, a platform
    // discount, its online takings — and counting rows would report one dinner
    // as three.
    if (entry.orderId) orders.add(entry.orderId);
  }

  summary.orderCount = orders.size;
  return summary;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 1250 → "12.50" */
export function formatMinorUnits(amount: MinorUnits): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatMoney(amount: MinorUnits, currency: CurrencyCode = 'AZN'): string {
  return `${formatMinorUnits(amount)} ${currency === 'AZN' ? '₼' : currency}`;
}

/** "12" or "12,50" → 1250. Throws on anything that is not a clean amount. */
export function parseMajorUnits(input: string): MinorUnits {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid amount: "${input}"`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Is this dish actually on offer to a customer right now?
 *
 * WHY THIS LIVES HERE AND NOT IN TWO PLACES
 * -----------------------------------------
 * The server needs it to write the stored `discounted` flag, which is what the
 * shopfront's "this restaurant has a discount" query reads. The menu screen
 * needs it to draw the mark on the dish. Written twice, the two answers drift —
 * and the shape of that drift is a restaurant card promising a discount whose
 * menu shows none, which is worse than no badge at all.
 *
 * A `compareAtPrice` at or below the price is not a discount whatever it says:
 * old rows written before the server enforced this must not render as an offer
 * that raises the price.
 *
 * A HIDDEN dish is not on the menu, so a saving on it is not an offer to
 * anybody.
 */
export function isDiscountedProduct(
  product: Pick<Product, 'price' | 'compareAtPrice' | 'availability'>,
): boolean {
  if (product.availability === ProductAvailability.HIDDEN) return false;
  const compare = product.compareAtPrice;
  return typeof compare === 'number' && compare > product.price;
}

/** 1200 → "12%" (drops a trailing ".00"). */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/** Sums how many options a group would let a customer choose — used by the menu editor. */
export function describeModifierGroup(group: ModifierGroup): string {
  if (group.required && group.maxSelect === 1) return 'Məcburi · bir seçim';
  if (group.maxSelect === 1) return 'Bir seçim';
  if (group.maxSelect > 1) return `Ən çox ${group.maxSelect} seçim`;
  return 'İstənilən qədər';
}
