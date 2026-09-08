/**
 * QAPINDA — Cloud Functions entry point.
 *
 * Everything that decides money, roles or order state lives behind one of these
 * exports. The client's job is to ask; the server's job is to decide.
 */

// Accounts and identity
export {
  registerAccount,
  linkEmail,
  saveAddress,
  deleteAddress,
  requestAccountDeletion,
  recordConsent,
  touchSession,
  updateNotificationPrefs,
  sendTestNotification,
} from './users/account';

// Email verification by six-digit code
export { sendEmailCode, verifyEmailCode } from './users/email';

// The delivery address's own telephone number, proved by SMS
export { sendAddressPhoneCode, verifyAddressPhoneCode } from './users/addressPhone';

// Favourites
export { toggleFavourite } from './users/favourites';

// A person's own name; an admin moving a telephone number; and the one-off
// backfill that gives existing accounts the order counters the newer ones
// accumulate as they go.
export {
  updateProfile,
  changeUserPhone,
  backfillCustomerCounters,
} from './users/profile';

// User administration
export {
  setUserRole,
  setUserStatus,
  anonymiseUser,
  bootstrapSuperAdmin,
} from './users/admin';

// Account lock repair — see functions/src/users/locks.ts
export {
  inspectAccountLocks,
  releaseAccountLock,
  sweepStaleAccountLocks,
} from './users/locks';

// Removing a restaurant from the platform — see restaurants/remove.ts
export { removeRestaurant } from './restaurants/remove';

// Restaurant onboarding and administration
export {
  applyForRestaurant,
  approveRestaurant,
  createRestaurantByAdmin,
  rejectRestaurant,
  setRestaurantStatus,
  setCommissionRate,
  setRestaurantFeatured,
  updateRestaurantProfile,
  setRestaurantStaff,
} from './restaurants/onboarding';

// Joining a restaurant's team is an offer, not an assignment — see
// restaurants/invites.ts.
export { respondToRestaurantInvite, cancelRestaurantInvite } from './restaurants/invites';

// Reports (date range)
export { restaurantReport } from './restaurants/reports';
export { platformReport } from './admin/report';

// Reviews
export {
  submitReview,
  replyToReview,
  setReviewHidden,
  listReviews,
  pendingReviews,
} from './reviews/crud';

// Complaints
export { fileComplaint, listComplaints } from './complaints/crud';
export { resolveComplaint } from './complaints/resolve';
// Everything an operator needs about the customer behind one order. The
// request names an ORDER, never a customer — see complaints/context.ts.
export { customerOrderContext } from './complaints/context';

// Support tickets — customer → operator, restaurant → operator, restaurant → admin
export {
  openSupportTicket,
  sendSupportMessage,
  markSupportTicketRead,
  setSupportTicketStatus,
  escalateSupportTicket,
  claimSupportTicket,
  listSupportTickets,
  supportQueueCounts,
  getSupportTicket,
  migrateSupportConversations,
  rateSupportFeedback,
} from './support/chat';
export { translateSupportMessage } from './support/translate';

// Push notifications — the half that reaches a closed browser
export { deliverPush, pruneStalePushTokens } from './notifications/push';
export { registerPushToken, unregisterPushToken } from './notifications/tokens';

// Menu
export {
  saveMenuCategory,
  deleteMenuCategory,
  reorderMenuCategories,
  saveProduct,
  deleteProduct,
  setProductAvailability,
  reorderProducts,
  bulkAdjustPrices,
} from './menu/crud';

// Menu search across the whole platform
export { searchMenu, backfillProductSearch } from './menu/search';

// What people search for and then actually open — the chips on the search
// screen. Counted on the open rather than on the keystroke; see the file.
export { recordSearchHit, removeSearchTerm } from './menu/popular';

// Orders
export { createOrder, previewOrder } from './orders/create';
export { updateOrderStatus, setServiceState, restaurantDashboard } from './orders/status';
export { prepareReorder } from './orders/reorder';

// The last hundred metres: assignment, the handover code, and the two endings.
export {
  assignCourier,
  acceptDelivery,
  issueDeliveryCode,
  courierConfirmDelivery,
  reportDeliveryFailure,
} from './orders/delivery';

// Online payment. Epoint today; the order engine never learns its name.
export {
  startOnlinePayment,
  epointCallback,
  paymentStatus,
  refundPayment,
  expirePendingPayments,
  chaseUnfinishedRefunds,
  listPayments,
} from './payments/flow';

// Coupons
export {
  createCoupon,
  updateCoupon,
  setCouponActive,
  listCoupons,
  couponRedemptions,
  myCoupons,
  // Personal coupons: one coupon addressed to one named customer, granted from
  // the customer's own row in Admin → İstifadəçilər.
  couponCustomers,
  addCouponCustomer,
  removeCouponCustomer,
  grantCustomerCoupon,
} from './coupons/manage';

// The pre-launch test-data reset. Super admin only, and refused outright
// unless `publicSettings.testDataResetEnabled` has been switched on.
export { platformResetStatus, resetPlatformData } from './admin/reset';

// Finance
export {
  adjustLedger,
  recordSettlementPayment,
  setPayoutDetails,
  setSettlementStatus,
  getSettlement,
  listSettlements,
  updatePublicSettings,
} from './admin/finance';

// Scheduled jobs
//
// `watchActiveOrders` and `watchRestaurantAvailability` were written, commented
// and then never listed here — so they never deployed and never ran. Four
// operator alerts depended on them (an order the kitchen has not answered, a
// delivery no courier has accepted, a courier who has gone offline mid-run, a
// restaurant closed during its own opening hours), and all four were silently
// dead. A function that is not exported from this file does not exist.
export {
  expireStaleOrders,
  askForReviews,
  resumePausedRestaurants,
  expirePromotions,
  watchActiveOrders,
  watchRestaurantAvailability,
  settleDeliveredOrders,
  rollUpSettlements,
  pruneIdempotencyKeys,
} from './orders/jobs';
export { purgeExpiredSupportFeedback } from './support/jobs';
