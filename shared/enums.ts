/**
 * QAPINDA — Domain enumerations.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 */

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  RESTAURANT_OWNER: 'RESTAURANT_OWNER',
  RESTAURANT_MANAGER: 'RESTAURANT_MANAGER',
  RESTAURANT_STAFF: 'RESTAURANT_STAFF',
  /**
   * A driver who works for a restaurant, not for Qapında.
   *
   * The platform runs no fleet: it does not hire, assign, pay or insure
   * couriers. This role exists so that the person actually standing at the
   * door can close the order there, instead of ringing the kitchen so somebody
   * else can press a button ten minutes later.
   *
   * Deliberately outside RESTAURANT_ROLES. Those roles see everything the
   * restaurant has; a courier must see only the orders handed to them, because
   * the alternative is every customer's address and phone sitting on a phone
   * that gets lost, sold or handed to the next driver.
   */
  RESTAURANT_COURIER: 'RESTAURANT_COURIER',
  /** Support / operations staff. */
  OPERATOR: 'OPERATOR',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const RESTAURANT_ROLES: UserRole[] = [
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.RESTAURANT_STAFF,
];

/**
 * Every role that BELONGS to a restaurant, courier included.
 *
 * WHY THIS IS NOT `RESTAURANT_ROLES`
 * ----------------------------------
 * The two lists answer different questions and conflating them broke both ends
 * of the courier.
 *
 * `RESTAURANT_ROLES` answers "may this account act for the restaurant" — see
 * the shop's orders, edit its menu, read its customers. A courier deliberately
 * may not, because that account rides around on a personal telephone and must
 * see only the deliveries handed to it.
 *
 * This one answers "does this account have a restaurantId at all", and a
 * courier plainly does: it works for exactly one shop. Because the two were the
 * same list, `setUserRole` refused a courier WITH a restaurant ("this role may
 * not have one") and produced a useless account WITHOUT one — so the admin
 * screen could not create a courier at all, by any route.
 */
export const RESTAURANT_SCOPED_ROLES: UserRole[] = [
  ...RESTAURANT_ROLES,
  UserRole.RESTAURANT_COURIER,
];

export const PLATFORM_ROLES: UserRole[] = [UserRole.OPERATOR, UserRole.SUPER_ADMIN];

/**
 * Every role that belongs to a restaurant, couriers included.
 *
 * Use this for "which restaurant does this account belong to"; use
 * `RESTAURANT_ROLES` for "may this account act on the restaurant's behalf".
 * The two are different questions and conflating them is what would hand a
 * courier the menu editor.
 */
export const RESTAURANT_LINKED_ROLES: UserRole[] = [
  ...RESTAURANT_ROLES,
  UserRole.RESTAURANT_COURIER,
];

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  DELETION_REQUESTED: 'DELETION_REQUESTED',
  ANONYMIZED: 'ANONYMIZED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** How a customer proved who they are. Phone is the primary identity (§ one account per phone). */
export const AuthProvider = {
  PHONE: 'PHONE',
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

/**
 * Where one staff invitation has got to.
 *
 * Kept as a state on the document rather than by deleting it, because "did they
 * ever decline?" and "who was invited in March?" are questions a restaurant
 * with a staffing dispute actually asks — and a row that is removed on answer
 * can answer neither.
 */
export const InviteStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  /** Withdrawn by the restaurant before it was answered. */
  CANCELLED: 'CANCELLED',
  /** Nobody answered in time. Set on read, not by a job — see the callable. */
  EXPIRED: 'EXPIRED',
} as const;
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export const RestaurantStatus = {
  /** Owner is still filling in the application. */
  DRAFT: 'DRAFT',
  /** Submitted, waiting for the platform to approve. */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Approved and visible to customers. */
  ACTIVE: 'ACTIVE',
  /** Temporarily hidden by the platform. */
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
  /**
   * Removed by the platform. A tombstone, not a hole.
   *
   * WHY THE DOCUMENT SURVIVES A DELETION.
   *
   * Every order ever placed at this restaurant points at its id, and so does
   * every settlement, every ledger entry and every review. A hard delete would
   * turn each of those into a dangling reference — an invoice for a restaurant
   * that does not exist, a customer's order history with a blank where the shop
   * used to be — and it would take with it the record of money that was earned
   * and may still be owed. Those records carry a tax and accounting retention
   * obligation that is not the platform's to waive.
   *
   * So a removed restaurant keeps its id and its name and loses everything
   * else: it is gone from the shopfront, gone from search, gone from every
   * admin list, its menu is deleted, its staff are unlinked and cannot sign in
   * to it, and it can never take another order. From the owner's side of the
   * screen it has been deleted, which is what was asked for. From the books'
   * side it is still there, which is what the law asks for.
   */
  REMOVED: 'REMOVED',
} as const;
export type RestaurantStatus = (typeof RestaurantStatus)[keyof typeof RestaurantStatus];

/** Whether the restaurant is currently taking orders, independent of approval. */
export const ServiceState = {
  OPEN: 'OPEN',
  /** Manually paused by the restaurant ("busy"). */
  PAUSED: 'PAUSED',
  /** Outside opening hours. */
  CLOSED: 'CLOSED',
} as const;
export type ServiceState = (typeof ServiceState)[keyof typeof ServiceState];

export const FulfillmentType = {
  /** The restaurant delivers with its own driver. No platform courier exists. */
  DELIVERY: 'DELIVERY',
  /** Reserved: customer collects. Not offered in V1. */
  PICKUP: 'PICKUP',
} as const;
export type FulfillmentType = (typeof FulfillmentType)[keyof typeof FulfillmentType];

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

/**
 * V1 settles at the door: the money goes straight to the restaurant and never
 * passes through the platform. `ONLINE_CARD` is declared now so that adding it
 * later needs a provider adapter and a screen — not a data migration.
 */
export const PaymentMethod = {
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
  CARD_ON_DELIVERY: 'CARD_ON_DELIVERY',
  ONLINE_CARD: 'ONLINE_CARD',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * What checkout may offer.
 *
 * Online card is in the list, but a restaurant still has to enable it and the
 * platform still has to be configured with a provider — `paymentMethodsFor`
 * below is what the checkout screen actually asks. Listing a method the server
 * would refuse is how a customer ends up at a dead end holding a full basket.
 */
export const V1_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.CARD_ON_DELIVERY,
  PaymentMethod.ONLINE_CARD,
];

/**
 * What the platform offers until somebody deliberately says otherwise.
 *
 * The two methods settled at the door, and NOT online card. Online card needs a
 * payment provider configured in the server's environment, and every deployment
 * starts without one — so a client that fell back to `V1_PAYMENT_METHODS` was
 * offering a customer a payment the server would refuse the moment they pressed
 * the button. `V1_PAYMENT_METHODS` remains what the server VALIDATES against,
 * because online card is a legitimate value; this is what a screen ASSUMES when
 * the settings document has not been read or has never been written.
 *
 * Turning online card on is therefore a deliberate act by an admin, on the
 * platform settings screen, and `updatePublicSettings` refuses it outright
 * while there is no provider behind it.
 */
export const DEFAULT_ENABLED_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.CARD_ON_DELIVERY,
];

/** Online payment leaves the site; the other two are settled at the door. */
export function isOnlinePayment(method: PaymentMethod): boolean {
  return method === PaymentMethod.ONLINE_CARD;
}

/**
 * Where the money is — deliberately a different axis from the order's status.
 *
 * An order can be PREPARING and PAID, or DELIVERED and NOT_COLLECTED. Folding
 * the two together is the classic way a marketplace ends up unable to answer
 * "did we get the money for this one?", so they never merge.
 */
export const PaymentStatus = {
  /** Cash/card at the door: nothing is owed to the platform up front. */
  DUE_ON_DELIVERY: 'DUE_ON_DELIVERY',
  COLLECTED: 'COLLECTED',
  NOT_COLLECTED: 'NOT_COLLECTED',
  /** Online: the customer has been sent to the bank and has not come back. */
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  /** The customer abandoned the bank page, or pressed cancel there. */
  CANCELLED: 'CANCELLED',
  /** Sent to the bank but never answered — swept up by a scheduled job. */
  EXPIRED: 'EXPIRED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const OrderStatus = {
  /** Reserved for online payment: order exists, money not taken yet. */
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  /** Submitted and waiting for the restaurant to accept. */
  PLACED: 'PLACED',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  /** Settled: counts towards commission and statistics. */
  COMPLETED: 'COMPLETED',

  // Terminal, unhappy paths
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  /** The restaurant did not answer within the response window. */
  EXPIRED: 'EXPIRED',
  /**
   * The courier went out and came back with the food.
   *
   * Deliberately not CANCELLED: a cancellation is a decision somebody made
   * before the food travelled, while this is a delivery that was attempted and
   * failed. Merging the two hides the single most useful signal a marketplace
   * has about bad addresses, unreachable customers and restaurants that send
   * couriers to the wrong street.
   */
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Statuses in which the order is still moving. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

/** Statuses from which nothing further happens. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.REFUNDED,
  // A failed delivery ends the order. What happens to the money afterwards is a
  // complaint or a refund, both of which are their own records.
  OrderStatus.DELIVERY_FAILED,
];

/**
 * Everything an order can be once it has stopped moving.
 *
 * THIS LIST EXISTS BECAUSE ORDERS WERE DISAPPEARING.
 *
 * The restaurant panel kept its own copy of "past statuses" and that copy had
 * five entries in it. `DELIVERY_FAILED` was not one of them. So an order the
 * courier could not deliver left the live queue — it is no longer active — and
 * never arrived in the history, because the history query did not ask for it.
 * It was not hidden or archived: it was simply in neither of the two lists the
 * restaurant can see, and from the owner's side of the screen it had ceased to
 * exist. The same hole was in the admin's "uğursuz" tab, which listed
 * cancellations and rejections and expiries and not the one failure a customer
 * actually rings about.
 *
 * A hand-maintained list is wrong the first time somebody adds a status and
 * right-looking for ever afterwards, which is exactly how this happened. So
 * there is one list, here, beside the statuses themselves.
 *
 * DELIVERED is in it. It is not terminal — `settleDeliveredOrders` turns it
 * into COMPLETED after the grace period — but it is finished from the point of
 * view of anybody looking at a queue, and leaving it out would hide an order
 * for the twenty minutes between the door and the settlement.
 *
 * REFUND_PENDING is in it too. The money is still moving, but the ORDER is
 * over — nobody is cooking and nobody is driving — and a restaurant whose
 * customer is mid-refund needs to be able to find that order rather than
 * discover it on next month's settlement.
 *
 * Nine values, which matters: Firestore refuses an `in` query with more than
 * ten. There is one slot left. Anything added here has to be counted against
 * that, and when a tenth and eleventh are ever needed the queries become two.
 */
export const PAST_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUNDED,
];

/**
 * The one status that is deliberately in neither queue.
 *
 * PENDING_PAYMENT is an order that exists only because the customer was sent
 * to the bank and has not come back. No kitchen should see it: it is not an
 * order yet, and showing it would put a ticket on a restaurant's board for food
 * nobody has paid for and may never pay for. The customer sees it on their own
 * order screen, and the platform's unfiltered admin view sees it — which is
 * where somebody investigating an abandoned bank session actually looks.
 *
 * It is named here rather than merely left out, so that `PAST_ORDER_STATUSES`
 * plus `ACTIVE_ORDER_STATUSES` plus this list is provably every status. That
 * completeness is what the visibility test asserts, and it is what would have
 * caught the failed-delivery hole before it shipped.
 */
export const QUEUE_EXCLUDED_ORDER_STATUSES: OrderStatus[] = [OrderStatus.PENDING_PAYMENT];

/**
 * Orders that ended without the customer being fed.
 *
 * Grouped for the reports, which need one honest "how many went wrong" figure
 * beside the takings. `DELIVERY_FAILED` is in here deliberately, even though it
 * is not a cancellation: from the restaurant's and the platform's point of view
 * it is food that was made and money that was not earned, which is the question
 * the number on the report is answering.
 */
export const FAILED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
  OrderStatus.DELIVERY_FAILED,
];

/** Only a completed order earns the platform its commission. */
export const COMMISSIONABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

/** Who is asking for a status change. Never taken from the request body. */
export const OrderActor = {
  CUSTOMER: 'CUSTOMER',
  RESTAURANT: 'RESTAURANT',
  PLATFORM: 'PLATFORM',
  /** Scheduled jobs: expiry, auto-completion. */
  SYSTEM: 'SYSTEM',
} as const;
export type OrderActor = (typeof OrderActor)[keyof typeof OrderActor];

export const CancellationReason = {
  CUSTOMER_CHANGED_MIND: 'CUSTOMER_CHANGED_MIND',
  RESTAURANT_TOO_BUSY: 'RESTAURANT_TOO_BUSY',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  CUSTOMER_UNREACHABLE: 'CUSTOMER_UNREACHABLE',
  ADDRESS_OUT_OF_RANGE: 'ADDRESS_OUT_OF_RANGE',
  RESTAURANT_CLOSED: 'RESTAURANT_CLOSED',
  DUPLICATE_ORDER: 'DUPLICATE_ORDER',
  SUSPECTED_FRAUD: 'SUSPECTED_FRAUD',
  OTHER: 'OTHER',
} as const;
export type CancellationReason = (typeof CancellationReason)[keyof typeof CancellationReason];

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/** A modifier group is either "pick exactly one" or "pick any number". */
export const ModifierSelection = {
  SINGLE: 'SINGLE',
  MULTIPLE: 'MULTIPLE',
} as const;
export type ModifierSelection = (typeof ModifierSelection)[keyof typeof ModifierSelection];

export const ProductAvailability = {
  AVAILABLE: 'AVAILABLE',
  /** Sold out for today; comes back automatically at the next opening. */
  OUT_OF_STOCK_TODAY: 'OUT_OF_STOCK_TODAY',
  /** Hidden by the restaurant until they turn it back on. */
  HIDDEN: 'HIDDEN',
} as const;
export type ProductAvailability = (typeof ProductAvailability)[keyof typeof ProductAvailability];

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export const CouponType = {
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
  FREE_DELIVERY: 'FREE_DELIVERY',
} as const;
export type CouponType = (typeof CouponType)[keyof typeof CouponType];

/**
 * Who pays for the discount. This single field is what makes the monthly
 * settlement honest: a platform-funded discount is deducted from the platform's
 * commission invoice, a restaurant-funded one is not.
 */
export const CouponFunding = {
  PLATFORM: 'PLATFORM',
  RESTAURANT: 'RESTAURANT',
  /**
   * Both sides pay a share of the same discount.
   *
   * The split lives on the coupon as `platformShareBps`, and the money it
   * resolves to is written onto the order when the coupon is applied. It has to
   * be a snapshot: a campaign renegotiated in November must not silently
   * re-price an order from September.
   */
  SHARED: 'SHARED',
} as const;
export type CouponFunding = (typeof CouponFunding)[keyof typeof CouponFunding];

// ---------------------------------------------------------------------------
// Commission and settlement
// ---------------------------------------------------------------------------

export const SettlementStatus = {
  OPEN: 'OPEN',
  INVOICED: 'INVOICED',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

/** Immutable ledger entry kinds behind a restaurant's monthly invoice. */
export const LedgerEntryType = {
  COMMISSION: 'COMMISSION',
  /** Platform-funded discount the platform owes back to the restaurant. */
  PLATFORM_DISCOUNT: 'PLATFORM_DISCOUNT',
  /**
   * Money the customer paid online, which landed in the platform's account.
   *
   * The restaurant sold the food and was paid nothing for it, so this is the
   * platform holding the restaurant's money. Stored negative, like any other
   * amount the platform owes back, and netted against the commission at the end
   * of the month — which is the whole reason a restaurant taking online cards
   * can be owed money instead of owing it.
   *
   * A refund posts a second, positive entry of the same kind: the platform is
   * no longer holding money it has already sent back to the customer.
   */
  ONLINE_COLLECTED: 'ONLINE_COLLECTED',
  ADJUSTMENT: 'ADJUSTMENT',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

/**
 * Which way the money moved when a settlement was paid.
 *
 * Both directions are real and both happen every month: a restaurant that takes
 * cash owes commission, and a restaurant that takes online cards is owed its
 * takings. Recording the direction explicitly is what stops a bank transfer
 * being filed with the wrong sign.
 */
export const SettlementPaymentDirection = {
  /** The restaurant paid the platform. */
  FROM_RESTAURANT: 'FROM_RESTAURANT',
  /** The platform paid the restaurant. */
  TO_RESTAURANT: 'TO_RESTAURANT',
} as const;
export type SettlementPaymentDirection =
  (typeof SettlementPaymentDirection)[keyof typeof SettlementPaymentDirection];

/** How a settlement payment physically happened. Kept for reconciliation. */
export const SettlementPaymentMethod = {
  BANK_TRANSFER: 'BANK_TRANSFER',
  CASH: 'CASH',
  /** Settled against another balance rather than moved. */
  OFFSET: 'OFFSET',
} as const;
export type SettlementPaymentMethod =
  (typeof SettlementPaymentMethod)[keyof typeof SettlementPaymentMethod];

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * Which two parties a support ticket is between.
 *
 * The lane is not a label on the ticket — it is the ticket's whole access
 * story. Who may open it, who answers it and who must never see it are all
 * read off this one field, which is why it is set once at creation and never
 * changes afterwards. A ticket that could move between lanes would be a ticket
 * whose audience could change under the person who wrote into it.
 */
export const SupportLane = {
  /** A customer's problem, answered by an operator. Usually about one order. */
  CUSTOMER_TO_OPERATOR: 'CUSTOMER_TO_OPERATOR',
  /** A restaurant's day-to-day operational problem, answered by an operator. */
  RESTAURANT_TO_OPERATOR: 'RESTAURANT_TO_OPERATOR',
  /**
   * A restaurant writing to the platform's owner, not to support.
   *
   * Commission, invoices, the contract, an account problem — and a complaint
   * about an operator. An operator must never see this lane, and that is not a
   * courtesy: a person cannot be expected to forward a complaint about
   * themselves. The security rules and every callable exclude OPERATOR from it
   * by lane, not by hiding a tab.
   */
  RESTAURANT_TO_ADMIN: 'RESTAURANT_TO_ADMIN',
} as const;
export type SupportLane = (typeof SupportLane)[keyof typeof SupportLane];

/** The lanes a restaurant may start. Couriers have none — see `supportState`. */
export const RESTAURANT_SUPPORT_LANES: SupportLane[] = [
  SupportLane.RESTAURANT_TO_OPERATOR,
  SupportLane.RESTAURANT_TO_ADMIN,
];

/** The lanes an operator is allowed to work. Deliberately not all of them. */
export const OPERATOR_SUPPORT_LANES: SupportLane[] = [
  SupportLane.CUSTOMER_TO_OPERATOR,
  SupportLane.RESTAURANT_TO_OPERATOR,
];

/**
 * Where a ticket is in its life.
 *
 * OPEN → IN_PROGRESS → WAITING_FOR_CUSTOMER → RESOLVED → CLOSED is the happy
 * path; the moves that are actually permitted live in `shared/supportState.ts`
 * rather than being implied by the order of this list.
 *
 * CLOSED is terminal and permanent. A closed ticket is never deleted, stays
 * readable forever, and takes no further messages — a new problem is a new
 * ticket, which is the only way "what did we agree about this?" has a single
 * answer instead of a thread that has drifted through four unrelated issues.
 */
export const SupportTicketStatus = {
  /** Filed, nobody on the platform has picked it up yet. */
  OPEN: 'OPEN',
  /** An operator or the admin is working on it. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** The platform has answered and is waiting on the party who opened it. */
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  /** Answered. Still open to a reply if the answer did not land. */
  RESOLVED: 'RESOLVED',
  /** Finished. Read-only, forever. */
  CLOSED: 'CLOSED',
} as const;
export type SupportTicketStatus =
  (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];

/** Statuses in which the ticket is still somebody's job. Drives the queues. */
export const ACTIVE_SUPPORT_STATUSES: SupportTicketStatus[] = [
  SupportTicketStatus.OPEN,
  SupportTicketStatus.IN_PROGRESS,
  SupportTicketStatus.WAITING_FOR_CUSTOMER,
];

/** The one status from which nothing further happens. */
export const TERMINAL_SUPPORT_STATUSES: SupportTicketStatus[] = [
  SupportTicketStatus.CLOSED,
];

/**
 * Who is asking for a ticket change. Never taken from the request body.
 *
 * Note that OPERATOR and ADMIN are separate actors even though both are
 * platform staff: escalation exists precisely because the two are not
 * interchangeable.
 */
export const SupportActor = {
  CUSTOMER: 'CUSTOMER',
  RESTAURANT: 'RESTAURANT',
  OPERATOR: 'OPERATOR',
  ADMIN: 'ADMIN',
  /** Scheduled jobs and automatic follow-ups. */
  SYSTEM: 'SYSTEM',
} as const;
export type SupportActor = (typeof SupportActor)[keyof typeof SupportActor];

// ---------------------------------------------------------------------------
// Notifications, moderation, audit
// ---------------------------------------------------------------------------

export const NotificationType = {
  COMPLAINT_FILED: 'COMPLAINT_FILED',
  SUPPORT_MESSAGE: 'SUPPORT_MESSAGE',
  /** A ticket the recipient opened has been answered or closed. */
  SUPPORT_TICKET_UPDATED: 'SUPPORT_TICKET_UPDATED',
  /** An operator handed a ticket to the admin. Only the admin ever gets this. */
  SUPPORT_TICKET_ESCALATED: 'SUPPORT_TICKET_ESCALATED',
  COMPLAINT_RESOLVED: 'COMPLAINT_RESOLVED',

  /*
   * THERE ARE NO ORDER-STATUS NOTIFICATIONS FOR A CUSTOMER.
   *
   * There were seven — placed, accepted, rejected, preparing, on the way,
   * delivered, late — and the owner removed the lot: a customer follows their
   * order on the order screen, which updates live, and a phone that announces
   * every step of a delivery is how people learn to switch the app's
   * notifications off at the operating system and then miss the two messages
   * that matter. They are deleted rather than switched off, so that no call
   * site can quietly start sending one again.
   *
   * What a customer is still told about is not the order's progress but their
   * money and their questions: a refund, the answer to a complaint, a support
   * reply, a campaign they asked for.
   */

  /**
   * An order was cancelled — the RESTAURANT's copy of that fact.
   *
   * Kept because a kitchen that is mid-preparation has to hear that the
   * customer called it off. The customer's copy went with the rest of the
   * status notifications; they see it on the order screen.
   */
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  /**
   * A delivery came back — the RESTAURANT's copy of that fact.
   *
   * The order already went to the operator's desk, and it now sits in the
   * restaurant's history rather than vanishing out of both its lists. Neither
   * of those reaches the person standing in the kitchen at eight in the
   * evening, and they are the one who has food that came back, a customer who
   * has not eaten, and a driver to talk to.
   *
   * Not silenceable. A restaurant that has muted this is a restaurant that
   * finds out tomorrow.
   */
  RESTAURANT_DELIVERY_FAILED: 'RESTAURANT_DELIVERY_FAILED',
  NEW_ORDER_FOR_RESTAURANT: 'NEW_ORDER_FOR_RESTAURANT',
  RESTAURANT_APPROVED: 'RESTAURANT_APPROVED',
  RESTAURANT_REJECTED: 'RESTAURANT_REJECTED',
  /**
   * "A restaurant has invited you to join its team."
   *
   * Sent to the PERSON, not to the restaurant, and it is the whole point of the
   * invitation flow: nobody's account changes what it is until they have been
   * told and have said yes.
   */
  RESTAURANT_INVITE: 'RESTAURANT_INVITE',
  /**
   * The person answered — and which way, in the type itself.
   *
   * One "answered" type carried the yes-or-no in a parameter the sentence never
   * printed, so the restaurant read "X answered your invitation" and had to go
   * and look. Two types means the banner says it.
   */
  RESTAURANT_INVITE_ACCEPTED: 'RESTAURANT_INVITE_ACCEPTED',
  RESTAURANT_INVITE_DECLINED: 'RESTAURANT_INVITE_DECLINED',
  /**
   * Somebody applied to join the platform. The admin's, and nobody else's.
   *
   * An application sits in PENDING_APPROVAL until a human looks at it, so it is
   * one of the four things the admin asked to keep being told about: it is
   * money waiting to be let in, and until now it was only visible to whoever
   * happened to open the Restoranlar page.
   */
  RESTAURANT_APPLICATION_RECEIVED: 'RESTAURANT_APPLICATION_RECEIVED',
  /** Money going back to a customer after a refund is confirmed. */
  REFUND_ISSUED: 'REFUND_ISSUED',
  /**
   * An apology coupon, put on a customer's account after a complaint.
   *
   * Its own type rather than a general "you have a coupon": this one is owed to
   * somebody whose order went wrong, and a person who has just been let down
   * should be told what was done about it — not left to find a code by opening
   * a menu they had no reason to look in.
   */
  COMPENSATION_COUPON: 'COMPENSATION_COUPON',
  /** A restaurant somebody might want opened in their area. Off by default. */
  NEW_RESTAURANT_AVAILABLE: 'NEW_RESTAURANT_AVAILABLE',
  /**
   * THE ONE ORDER-STATUS NOTIFICATION A CUSTOMER GETS.
   *
   * Seven of these were removed on the owner's instruction, and rightly: an app
   * that announces every step of a delivery teaches people to switch its
   * notifications off at the operating system, after which it cannot reach them
   * with anything that matters.
   *
   * This one is different because of what the customer is expected to DO. Every
   * other step is something to read on a screen they can open when they choose;
   * this one means somebody will shortly be at the door, and a person who
   * misses it is a person the courier cannot hand food to. That is the test the
   * other six failed.
   */
  ORDER_ON_THE_WAY: 'ORDER_ON_THE_WAY',
  /**
   * "How was it?" — asked once, a while after the food arrived.
   *
   * Off by default and switchable, because it is a favour being asked rather
   * than information being given. The setting for it has existed on the
   * customer's screen since launch and nothing ever sent one, which is the
   * worst of both: a switch that does nothing still teaches people the
   * settings are decorative.
   */
  REVIEW_REMINDER: 'REVIEW_REMINDER',
  /**
   * "Test bildirişi göndər" — the one notification a person asks for.
   *
   * It exists as a real type rather than as a fake row drawn on screen because
   * the whole point of the button is to answer "do notifications actually reach
   * me": it is written by the server, stored like any other, delivered by the
   * same listener, and rings through the same sound layer. A mock would have
   * told the restaurant nothing true.
   */
  NOTIFICATION_TEST: 'NOTIFICATION_TEST',
  SYSTEM: 'SYSTEM',

  // -------------------------------------------------------------------------
  // The operator's desk.
  //
  // Prefixed OPS_ because an operator is not a spectator on every event in the
  // marketplace — these are the eight situations that need somebody to pick up
  // a phone. An order that is placed, accepted, cooked and delivered without
  // incident produces NONE of them: OPS_NEW_ORDER used to be raised for every
  // order and was removed for exactly that reason. The desk has a live order
  // list; a queue that also rings for the orders going well is a queue nobody
  // reads when one of them goes wrong.
  // -------------------------------------------------------------------------

  /** The response window elapsed with no answer from the kitchen. */
  OPS_RESTAURANT_NO_RESPONSE: 'OPS_RESTAURANT_NO_RESPONSE',
  /** The restaurant refused an order, and why. */
  OPS_RESTAURANT_REJECTED: 'OPS_RESTAURANT_REJECTED',
  /** Still not ready well past the preparation time the restaurant promised. */
  OPS_RESTAURANT_LATE: 'OPS_RESTAURANT_LATE',
  /** An order was cancelled, by whom. */
  OPS_ORDER_CANCELLED: 'OPS_ORDER_CANCELLED',
  /** Somebody reported a problem: restaurant, customer, delivery or payment. */
  OPS_ORDER_PROBLEM: 'OPS_ORDER_PROBLEM',
  /** Shut or paused during its own opening hours. */
  OPS_RESTAURANT_OFFLINE: 'OPS_RESTAURANT_OFFLINE',
  /** A courier out of contact while the order they hold is still moving. */
  OPS_COURIER_OFFLINE: 'OPS_COURIER_OFFLINE',
  /** An assigned delivery nobody has picked up. */
  OPS_COURIER_NOT_ACCEPTED: 'OPS_COURIER_NOT_ACCEPTED',

  // -------------------------------------------------------------------------
  // The courier's phone. Only ever about an order assigned to that courier.
  // -------------------------------------------------------------------------

  /**
   * A delivery was handed to you — order code, restaurant, address.
   *
   * This is also the notification a courier gets when an order that is already
   * READY is assigned to them: "assigned to you" and "ready for pickup" at the
   * same moment are one event, not two. See `courierPickupNotification`.
   */
  COURIER_ASSIGNED: 'COURIER_ASSIGNED',
  /** The order you are carrying is out of the kitchen and waiting for you. */
  COURIER_ORDER_READY: 'COURIER_ORDER_READY',
  /**
   * Something about a delivery you are holding changed.
   *
   * Raised when the restaurant re-runs the assignment on an order: either it
   * was handed to somebody else, in which case the driver who had it must be
   * told it has left their list, or it was handed to the same driver again,
   * in which case the details on the card are not the ones they memorised.
   * Neither of those is a cancellation and neither is a new delivery, so
   * routing them through either of those types would have said something
   * untrue on a phone somebody is reading at a traffic light.
   */
  COURIER_DELIVERY_UPDATED: 'COURIER_DELIVERY_UPDATED',
  /** This delivery is running past its estimate. Sent once, never repeated. */
  COURIER_DELIVERY_LATE: 'COURIER_DELIVERY_LATE',
  /** Stop driving: the order in your bag is cancelled. */
  COURIER_ORDER_CANCELLED: 'COURIER_ORDER_CANCELLED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * What went wrong with a delivered order.
 *
 * A closed list, not free text: it lets a restaurant see a pattern ("three
 * missing items this week") and lets the platform decide consistently. The
 * free-text box exists alongside it for the details.
 */
/** Why a delivery that was attempted did not arrive. */
export const DeliveryFailureReason = {
  CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE',
  CUSTOMER_REFUSED: 'CUSTOMER_REFUSED',
  WRONG_ADDRESS: 'WRONG_ADDRESS',
  PHONE_UNREACHABLE: 'PHONE_UNREACHABLE',
  RESTAURANT_ISSUE: 'RESTAURANT_ISSUE',
  OTHER: 'OTHER',
} as const;
export type DeliveryFailureReason =
  (typeof DeliveryFailureReason)[keyof typeof DeliveryFailureReason];

export const ComplaintReason = {
  MISSING_ITEM: 'MISSING_ITEM',
  WRONG_ITEM: 'WRONG_ITEM',
  COLD_FOOD: 'COLD_FOOD',
  QUALITY: 'QUALITY',
  VERY_LATE: 'VERY_LATE',
  NEVER_ARRIVED: 'NEVER_ARRIVED',
  OTHER: 'OTHER',
} as const;
export type ComplaintReason = (typeof ComplaintReason)[keyof typeof ComplaintReason];

export const ComplaintStatus = {
  /** Filed, nobody has looked yet. */
  OPEN: 'OPEN',
  /** Upheld: the commission on that order is returned to the restaurant.
   *  The refund to the customer is between them and the restaurant — the
   *  platform never held the money. */
  RESOLVED_CREDITED: 'RESOLVED_CREDITED',
  /** Looked at and not upheld. The reason is recorded either way. */
  REJECTED: 'REJECTED',
} as const;
export type ComplaintStatus = (typeof ComplaintStatus)[keyof typeof ComplaintStatus];

export const AuditAction = {
  /**
   * A staff account began a session, or pressed Çıxış.
   *
   * STAFF ONLY, and deliberately: this log exists to answer questions about the
   * people who can suspend a restaurant, move money or read a customer's
   * orders. The same record kept for customers would be a diary of thousands of
   * people's evenings, kept for ever, answering nothing.
   *
   * A STARTED entry is written once per session rather than per page load — six
   * hours, or a change of address, restarts it. An ENDED entry means the person
   * pressed the button; a session with no ENDED entry means nothing in
   * particular, because closing a laptop sends no message to any server.
   */
  STAFF_SESSION_STARTED: 'STAFF_SESSION_STARTED',
  STAFF_SESSION_ENDED: 'STAFF_SESSION_ENDED',
  RESTAURANT_APPLIED: 'RESTAURANT_APPLIED',
  RESTAURANT_APPROVED: 'RESTAURANT_APPROVED',
  RESTAURANT_REJECTED: 'RESTAURANT_REJECTED',
  RESTAURANT_SUSPENDED: 'RESTAURANT_SUSPENDED',
  /**
   * A restaurant was removed from the platform.
   *
   * Its own action rather than a status change, because it is the one that is
   * irreversible from the panel and the one an auditor looks for by name. The
   * entry carries the restaurant's name and the number of orders it had, so the
   * record still means something after the shopfront is gone.
   */
  RESTAURANT_REMOVED: 'RESTAURANT_REMOVED',
  /**
   * A restaurant was put forward on the shopfront, or taken back down.
   *
   * Its own action rather than a general "profile updated" because it changes
   * what every customer is shown first, and "who featured them, and why" is a
   * question that gets asked about exactly this and about nothing else in a
   * restaurant's profile.
   */
  RESTAURANT_FEATURED: 'RESTAURANT_FEATURED',
  RESTAURANT_COMMISSION_CHANGED: 'RESTAURANT_COMMISSION_CHANGED',
  /**
   * A staff invitation was withdrawn, or turned down.
   *
   * Accepting one is recorded as USER_ROLE_CHANGED, because that is what it is
   * and it belongs in the same place an admin's role change does. The other two
   * endings get names of their own: "we offered and they said no" and "we
   * changed our mind" are different facts, and a staffing dispute turns on
   * which one happened.
   */
  RESTAURANT_INVITE_SENT: 'RESTAURANT_INVITE_SENT',
  RESTAURANT_INVITE_DECLINED: 'RESTAURANT_INVITE_DECLINED',
  RESTAURANT_INVITE_CANCELLED: 'RESTAURANT_INVITE_CANCELLED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  ORDER_FORCE_CANCELLED: 'ORDER_FORCE_CANCELLED',
  COUPON_CREATED: 'COUPON_CREATED',
  COUPON_DISABLED: 'COUPON_DISABLED',
  /**
   * A live campaign was edited — its window, its limits, its restaurants.
   *
   * Separate from COUPON_CREATED because the interesting dispute is never
   * "who made this coupon", it is "who moved the end date after I planned
   * around it". The entry carries the before and after of exactly the fields
   * that changed.
   */
  COUPON_UPDATED: 'COUPON_UPDATED',
  /**
   * A named customer was given, or taken off, a personal coupon.
   *
   * Kept apart from COUPON_UPDATED even though both edit `allowedUserIds`,
   * because the question asked about them is different. Nobody audits a
   * campaign to find out when its end date moved; they audit a personal coupon
   * to find out WHO gave a specific customer money off, and when. One entry per
   * customer, naming that customer, answers that; a diff of a 200-element array
   * does not.
   */
  COUPON_CUSTOMER_ADDED: 'COUPON_CUSTOMER_ADDED',
  COUPON_CUSTOMER_REMOVED: 'COUPON_CUSTOMER_REMOVED',
  LEDGER_ADJUSTED: 'LEDGER_ADJUSTED',
  /**
   * A payment moved state — taken, refused, refunded.
   *
   * Written by the provider callback with `system:epoint` as the actor, because
   * no person performs it. `paymentEvents` already keeps the provider's raw
   * message, but that is a provider log: it answers "what did Epoint send",
   * not "when did this order's money change hands, and on whose authority".
   * A marketplace holding customer money needs the second question answered in
   * the same append-only place as everything else.
   */
  PAYMENT_STATUS_CHANGED: 'PAYMENT_STATUS_CHANGED',
  SETTLEMENT_MARKED_PAID: 'SETTLEMENT_MARKED_PAID',
  /** A real payment — a bank transfer, cash — was filed against a month. */
  SETTLEMENT_PAYMENT_RECORDED: 'SETTLEMENT_PAYMENT_RECORDED',
  /** The bank account a restaurant is paid into changed. */
  PAYOUT_DETAILS_CHANGED: 'PAYOUT_DETAILS_CHANGED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  /** A person edited their own display name. */
  USER_PROFILE_CHANGED: 'USER_PROFILE_CHANGED',
  /**
   * An admin moved a telephone number to another account.
   *
   * Its own action rather than a `USER_PROFILE_CHANGED` variant, because this
   * is the one row somebody will search the log for after a dispute about who
   * an account belongs to. The old number is in `oldValue`.
   */
  USER_PHONE_CHANGED: 'USER_PHONE_CHANGED',
  /**
   * A stranded phone or email index entry was cleared.
   *
   * Its own action rather than a status change, because nothing about an
   * account changed — a lock naming a uid that no longer exists was removed so
   * the number's real owner could register again. Audited because releasing a
   * lock is exactly the operation that would let somebody take over a number if
   * it were ever done to a live account, and the record is what shows it was
   * not: every entry names the uid the lock pointed at and why it was dead.
   */
  ACCOUNT_LOCK_RELEASED: 'ACCOUNT_LOCK_RELEASED',
  MENU_PRICE_CHANGED: 'MENU_PRICE_CHANGED',
  SYSTEM_FLAGGED_REVIEW: 'SYSTEM_FLAGGED_REVIEW',
  REVIEW_MODERATED: 'REVIEW_MODERATED',
  COMPLAINT_RESOLVED: 'COMPLAINT_RESOLVED',
  /**
   * Value handed to a customer to make an order right.
   *
   * Separate from COMPLAINT_RESOLVED because the two answer different
   * questions. That one records a judgement; this one records money leaving,
   * with the amount, the instrument and whose money it was — which is what
   * anybody auditing an operator actually needs to see.
   */
  COMPENSATION_GRANTED: 'COMPENSATION_GRANTED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  /**
   * The platform was closed for technical work, or opened again.
   *
   * Separated from the general settings entry because it is the one setting
   * whose flip stops every customer ordering: "who closed the platform, when,
   * and why" has to be one row somebody can find, not a diff buried inside a
   * settings update that also changed the support phone number.
   */
  MAINTENANCE_MODE_CHANGED: 'MAINTENANCE_MODE_CHANGED',
  SUPPORT_TICKET_ESCALATED: 'SUPPORT_TICKET_ESCALATED',
  SUPPORT_TICKET_CLOSED: 'SUPPORT_TICKET_CLOSED',
  /** An admin took a ticket off an operator. Worth a record, not a scolding. */
  SUPPORT_TICKET_TAKEN_OVER: 'SUPPORT_TICKET_TAKEN_OVER',
  /**
   * Test data was deleted before launch — see `shared/reset.ts`.
   *
   * The one action in the system that destroys financial records, and
   * therefore the one whose audit entry matters most: it names who ran it,
   * which collections they chose, and how many documents went. The entry
   * survives the reset that wrote it, because `auditLogs` is on the protected
   * list and no scope can reach it.
   */
  PLATFORM_DATA_RESET: 'PLATFORM_DATA_RESET',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ConsentType = {
  PRIVACY_NOTICE: 'PRIVACY_NOTICE',
  TERMS: 'TERMS',
  EXPLICIT_DATA_CONSENT: 'EXPLICIT_DATA_CONSENT',
  MARKETING: 'MARKETING',
} as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];

// ---------------------------------------------------------------------------
// Localisation
// ---------------------------------------------------------------------------

export const SupportedLocale = {
  AZ: 'az',
  RU: 'ru',
  EN: 'en',
} as const;
export type SupportedLocale = (typeof SupportedLocale)[keyof typeof SupportedLocale];

export const SUPPORTED_LOCALES: SupportedLocale[] = ['az', 'ru', 'en'];
export const DEFAULT_LOCALE: SupportedLocale = 'az';
