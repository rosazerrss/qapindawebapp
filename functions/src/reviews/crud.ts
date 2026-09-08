/**
 * QAPINDA — Reviews.
 *
 * THE RULE THE USER ASKED FOR, MADE STRUCTURAL
 * --------------------------------------------
 * "Nobody who has not ordered may rate or review." That is not implemented as a
 * check here; it is implemented as a *shape*. A review's document id is the
 * order's id. To write one you must name an order, that order is loaded, and it
 * must be yours and delivered. Writing a second one collides with the first, so
 * "one review per order" needs no separate guard either.
 *
 * The rating average is folded inside the same transaction that creates the
 * review. If the transaction retries, the review is not there yet on the retry,
 * so the rating cannot be counted twice — which is exactly the bug a separate
 * "update the average afterwards" step would eventually produce.
 *
 * Reviews are never deleted. A moderator hides one, with a reason, and the
 * document stays: a restaurant that loses a bad review overnight has no way to
 * find out why, and neither does anyone auditing the platform.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { clean, cleanOptional } from '../lib/moderation';
import { requireActiveUser, requirePermission, requireRestaurantAccess } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import {
  asObject,
  optionalString,
  optionalStringArray,
  requireInt,
  requireString,
  sanitiseText,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, paths } from '../shared/collections';
import { AuditAction, OrderStatus, UserRole } from '../shared/enums';
import { Permission } from '../shared/permissions';
import {
  ALL_REVIEW_TAGS,
  MAX_REVIEW_COMMENT,
  MAX_REVIEW_REPLY,
  MAX_REVIEW_TAGS,
  REVIEW_WINDOW_DAYS,
  displayName,
  foldRating,
} from '../shared/reviews';
import type { Order, Restaurant, Review, User } from '../shared/models';

const WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** The two statuses that mean the food reached the customer. */
const DELIVERED_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED];

export const submitReview = onCall(
  guard('submitReview', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    const rating = requireInt(data, 'rating', { min: 1, max: 5 });

    const tags = optionalStringArray(data, 'tags', { max: MAX_REVIEW_TAGS, maxLength: 40 }).filter(
      (tag) => ALL_REVIEW_TAGS.includes(tag),
    );

    // A review is read by everyone who looks at the restaurant, so it is the
    // most public thing a customer writes here — moderated before it is stored,
    // not before it is displayed.
    const rawComment = optionalString(data, 'comment', { max: MAX_REVIEW_COMMENT });
    const comment = cleanOptional(rawComment ? sanitiseText(rawComment) : null);

    const orderRef = db.doc(paths.order(orderId));
    const reviewRef = db.doc(paths.review(orderId));

    const restaurantId = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, reviewSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(reviewRef),
      ]);

      if (!orderSnapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
      const order = orderSnapshot.data() as Order;

      // Yours, delivered, and recent. All three, or nothing is written.
      if (order.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);
      if (!DELIVERED_STATUSES.includes(order.status)) fail(AppErrorCode.REVIEW_NOT_ELIGIBLE);
      if (reviewSnapshot.exists) fail(AppErrorCode.REVIEW_ALREADY_SUBMITTED);

      const deliveredAt = order.deliveredAt?.toMillis?.() ?? order.completedAt?.toMillis?.() ?? 0;
      if (deliveredAt > 0 && Date.now() - deliveredAt > WINDOW_MS) {
        fail(AppErrorCode.REVIEW_WINDOW_CLOSED);
      }

      const restaurantRef = db.doc(paths.restaurant(order.restaurantId));
      const restaurantSnapshot = await transaction.get(restaurantRef);
      if (!restaurantSnapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
      const restaurant = restaurantSnapshot.data() as Restaurant;

      // `now()` is a server sentinel until it commits; the typed model wants a
      // Timestamp. The cast is confined to this one write rather than loosening
      // the model for every reader.
      const review = {
        id: orderId,
        orderId,
        orderCode: order.code,
        restaurantId: order.restaurantId,
        customerId: caller.uid,
        // Public text, so the shortened form — never the full legal name.
        customerName: displayName((user as User).fullName),
        rating,
        tags,
        comment: comment.text && comment.text.length > 0 ? comment.text : null,
        filtered: comment.filtered,
        hidden: false,
        hiddenReason: null,
        reply: null,
        replyFiltered: false,
        repliedAt: null,
        createdAt: now(),
      } as unknown as Review;

      transaction.set(reviewRef, review);

      const folded = foldRating(
        { average: restaurant.ratingAverage ?? 0, count: restaurant.ratingCount ?? 0 },
        rating,
      );
      transaction.update(restaurantRef, {
        ratingAverage: folded.average,
        ratingCount: folded.count,
        updatedAt: now(),
      });

      // Stamped on the order too, so "have I reviewed this?" is answerable from
      // the order the customer is already looking at, without a second read.
      transaction.update(orderRef, { reviewedAt: now() });

      return order.restaurantId;
    });

    return { ok: true, restaurantId };
  }),
);

/**
 * The restaurant's one answer.
 *
 * One, not a thread: a comment section under a review turns into an argument in
 * public, and neither side wins that. The restaurant gets a right of reply and
 * the conversation moves to the phone.
 */
export const replyToReview = onCall(
  guard('replyToReview', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const reviewId = requireString(data, 'reviewId', { max: 128 });
    // The restaurant's answer is as public as the review it answers.
    const reply = clean(sanitiseText(requireString(data, 'reply', { min: 2, max: MAX_REVIEW_REPLY })));

    const ref = db.doc(paths.review(reviewId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.REVIEW_NOT_FOUND);

    const review = snapshot.data() as Review;
    requireRestaurantAccess(caller, Permission.RESTAURANT_EDIT_PROFILE, review.restaurantId);

    await ref.update({ reply: reply.text, replyFiltered: reply.filtered, repliedAt: now() });
    return { ok: true };
  }),
);

/**
 * Moderation.
 *
 * Hiding, never deleting — and the reason is required. A platform that can make
 * criticism disappear without a trace is a platform whose ratings mean nothing.
 */
export const setReviewHidden = onCall(
  guard('setReviewHidden', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MODERATE_REVIEWS);

    const data = asObject(request.data);
    const reviewId = requireString(data, 'reviewId', { max: 128 });
    const hidden = data.hidden === true;
    const reason = sanitiseText(requireString(data, 'reason', { min: 10, max: 300 }));

    const ref = db.doc(paths.review(reviewId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.REVIEW_NOT_FOUND);

    const review = snapshot.data() as Review;

    await db.runTransaction(async (transaction) => {
      const restaurantRef = db.doc(paths.restaurant(review.restaurantId));
      const restaurantSnapshot = await transaction.get(restaurantRef);

      transaction.update(ref, { hidden, hiddenReason: hidden ? reason : null });

      // A hidden review must stop counting towards the score, or hiding it
      // would be cosmetic. Removing one rating from an average is exact
      // arithmetic, not an approximation.
      if (restaurantSnapshot.exists && review.hidden !== hidden) {
        const restaurant = restaurantSnapshot.data() as Restaurant;
        const count = restaurant.ratingCount ?? 0;
        const total = (restaurant.ratingAverage ?? 0) * count;

        const nextCount = hidden ? Math.max(0, count - 1) : count + 1;
        const nextTotal = hidden ? total - review.rating : total + review.rating;

        transaction.update(restaurantRef, {
          ratingCount: nextCount,
          ratingAverage: nextCount > 0 ? Math.round((nextTotal / nextCount) * 100) / 100 : 0,
          updatedAt: now(),
        });
      }
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: caller.role as UserRole,
      action: AuditAction.REVIEW_MODERATED,
      targetType: 'review',
      targetId: reviewId,
      oldValue: { hidden: review.hidden },
      newValue: { hidden },
      reason,
    });

    return { ok: true };
  }),
);

/**
 * Reviews for one restaurant, newest first.
 *
 * A callable rather than a direct read, because the client must never be able
 * to widen the query to "all reviews by this customer" — that would turn a
 * public rating into a map of one person's eating habits.
 */
export const listReviews = onCall(
  guard('listReviews', async (request) => {
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    const snapshot = await db
      .collection(COLLECTIONS.reviews)
      .where('restaurantId', '==', restaurantId)
      .where('hidden', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(60)
      .get();

    const reviews = snapshot.docs.map((doc) => {
      const review = doc.data() as Review;

      // Only what a stranger may see. `customerId` in particular never leaves
      // the server: it would let anyone link a review to an account.
      return {
        id: review.id,
        orderCode: review.orderCode,
        customerName: review.customerName,
        rating: review.rating,
        tags: review.tags,
        comment: review.comment,
        reply: review.reply,
        createdAt: review.createdAt,
      };
    });

    const breakdown = [0, 0, 0, 0, 0];
    for (const review of reviews) breakdown[review.rating - 1] += 1;

    return { ok: true, reviews, breakdown };
  }),
);

/**
 * "Which of my delivered orders still need a review?"
 *
 * The customer app asks this once and shows a prompt. Doing it here rather than
 * from the client keeps the eligibility rule — delivered, mine, in the window,
 * not yet reviewed — in the same place as the rule that enforces it on write.
 */
export const pendingReviews = onCall(
  guard('pendingReviews', async (request) => {
    const { caller } = await requireActiveUser(request);

    const since = Timestamp.fromMillis(Date.now() - WINDOW_MS);

    const snapshot = await db
      .collection(COLLECTIONS.orders)
      .where('customerId', '==', caller.uid)
      .where('status', 'in', DELIVERED_STATUSES)
      .where('placedAt', '>=', since)
      .orderBy('placedAt', 'desc')
      .limit(20)
      .get();

    const pending = snapshot.docs
      .map((doc) => doc.data() as Order & { reviewedAt?: unknown })
      .filter((order) => !order.reviewedAt)
      .map((order) => ({
        orderId: order.id,
        orderCode: order.code,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        deliveredAt: order.deliveredAt ?? order.completedAt,
      }));

    return { ok: true, pending };
  }),
);
