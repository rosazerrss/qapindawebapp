/**
 * QAPINDA — Coupons.
 *
 * A coupon is a promise to give money away, so the only interesting question is
 * who pays. `fundedBy` answers it, and it is the field the monthly settlement
 * reads: a PLATFORM coupon is deducted from what the restaurant owes, a
 * RESTAURANT coupon is not. Getting this wrong does not produce an error — it
 * produces a quiet, ongoing overcharge, which is why the field is mandatory and
 * why a restaurant cannot create a platform-funded coupon.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import {
  asObject,
  optionalInt,
  optionalString,
  optionalStringArray,
  requireEnum,
  requireInt,
  requirePhone,
  requireString,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, CouponFunding, CouponType } from '../shared/enums';
import {
  MAX_COUPON_CUSTOMERS,
  addCouponCustomerTo,
  removeCouponCustomerFrom,
  splitCouponFunding,
} from '../shared/pricing';
import { displayName } from '../shared/reviews';
import { COLLECTIONS, normaliseCouponCode, paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import type { Coupon, CouponRedemption, Order, User } from '../shared/models';

export const createCoupon = onCall(
  guard('createCoupon', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);

    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));
    if (code.length < 3) fail(AppErrorCode.VALIDATION_FAILED, 'code');

    const type = requireEnum<CouponType>(data, 'type', [
      CouponType.PERCENT,
      CouponType.FIXED,
      CouponType.FREE_DELIVERY,
    ]);
    const fundedBy = requireEnum<CouponFunding>(data, 'fundedBy', [
      CouponFunding.PLATFORM,
      CouponFunding.RESTAURANT,
      CouponFunding.SHARED,
    ]);

    // The share is only meaningful for SHARED; for the other two it is fixed at
    // the extreme, so that anything reading the split does not have to branch.
    const platformShareBps =
      fundedBy === CouponFunding.SHARED
        ? requireInt(data, 'platformShareBps', { min: 1, max: 9999 })
        : fundedBy === CouponFunding.PLATFORM
          ? 10000
          : 0;

    // PERCENT is basis points (2000 = 20%), FIXED is qəpik, FREE_DELIVERY has
    // no value of its own — it is worth whatever the delivery fee is.
    const value =
      type === CouponType.FREE_DELIVERY
        ? 0
        : requireInt(data, 'value', {
            min: 1,
            max: type === CouponType.PERCENT ? 10000 : 50_000,
          });

    const restaurantIds = optionalStringArray(data, 'restaurantIds', { max: 50, maxLength: 128 });
    const allowedUserIds = optionalStringArray(data, 'allowedUserIds', { max: 200, maxLength: 128 });
    const minSubtotal = requireInt(data, 'minSubtotal', { min: 0, max: 1_000_000 });
    const maxDiscount = optionalInt(data, 'maxDiscount', { min: 1, max: 100_000 });
    const firstOrderOnly = data.firstOrderOnly === true;
    const usageLimitTotal = optionalInt(data, 'usageLimitTotal', { min: 1, max: 1_000_000 });
    const usageLimitPerCustomer = requireInt(data, 'usageLimitPerCustomer', { min: 1, max: 50 });

    const validFromMs = requireInt(data, 'validFrom', { min: 0 });
    const validUntilMs = requireInt(data, 'validUntil', { min: 0 });
    if (validUntilMs <= validFromMs) fail(AppErrorCode.VALIDATION_FAILED, 'validUntil');

    // A restaurant-funded coupon that applies everywhere would bill restaurants
    // for a campaign they never agreed to.
    if (fundedBy === CouponFunding.RESTAURANT && restaurantIds.length === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'restaurantIds');
    }

    // Same reasoning for a shared campaign: somebody is being billed for part
    // of it, and that somebody has to be a restaurant that agreed to it.
    if (fundedBy === CouponFunding.SHARED && restaurantIds.length === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'restaurantIds');
    }

    // An uncapped percentage coupon is an open cheque against a large order.
    if (type === CouponType.PERCENT && maxDiscount === null && value > 3000) {
      fail(AppErrorCode.VALIDATION_FAILED, 'maxDiscount');
    }

    const ref = db.doc(paths.coupon(code));
    const coupon: Omit<Coupon, 'createdAt'> = {
      code,
      type,
      value,
      fundedBy,
      platformShareBps,
      restaurantIds,
      allowedUserIds,
      minSubtotal,
      maxDiscount,
      firstOrderOnly,
      usageLimitTotal,
      usageLimitPerCustomer,
      usedCount: 0,
      active: true,
      validFrom: Timestamp.fromMillis(validFromMs) as unknown as Coupon['validFrom'],
      validUntil: Timestamp.fromMillis(validUntilMs) as unknown as Coupon['validUntil'],
      createdBy: caller.uid,
    };

    try {
      await ref.create({ ...coupon, createdAt: now() });
    } catch {
      // Reusing a code would silently merge two campaigns' usage counts.
      fail(AppErrorCode.CONFLICT, 'code-exists');
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COUPON_CREATED,
      targetType: 'coupon',
      targetId: code,
      newValue: {
        type,
        value,
        fundedBy,
        platformShareBps,
        restaurantIds,
        allowedUserIds: allowedUserIds.length,
        usageLimitTotal,
      },
    });

    return { ok: true, code };
  }),
);

/**
 * Switches a coupon off.
 *
 * Never deleted: the redemptions that already happened point at this code, and
 * a settlement dispute six weeks from now needs to be able to look it up.
 */
export const setCouponActive = onCall(
  guard('setCouponActive', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));
    const active = data.active === true;
    const reason = optionalString(data, 'reason', { max: 300 });

    const ref = db.doc(paths.coupon(code));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);

    await ref.update({ active });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COUPON_DISABLED,
      targetType: 'coupon',
      targetId: code,
      oldValue: { active: snapshot.data()?.active },
      newValue: { active },
      reason,
    });

    return { ok: true };
  }),
);

/**
 * Every coupon, plus how it has actually performed.
 *
 * The list is the campaign screen, so it carries the answers the admin came
 * for rather than the fields the document happens to hold: how many times a
 * code was redeemed, by how many DIFFERENT people, how much discount it has
 * given away in total, and how much of that Qapında funded rather than the
 * restaurant. The last one is the number that turns into money at the end of
 * the month, and it is computed here with `splitCouponFunding` — the same
 * function the settlement uses — so the campaign screen and the invoice can
 * never disagree about who paid for a discount.
 *
 * WHY THE REDEMPTIONS ARE COUNTED RATHER THAN READ OFF THE COUPON
 * --------------------------------------------------------------
 * `usedCount` is a counter on the coupon document, incremented in the same
 * transaction that writes the order. It is the number the LIMIT is enforced
 * against and it is correct — but it is one number, and it cannot answer "by
 * how many people" or "how much of that was ours". So the rows are read, and
 * `usedCount` is returned beside the counted total so a drift between the two
 * is visible on screen instead of hidden behind whichever one was picked.
 */
const MAX_REDEMPTIONS_SCANNED = 1000;

export const listCoupons = onCall(
  guard('listCoupons', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const snapshot = await db.collection(COLLECTIONS.coupons).limit(200).get();

    const coupons = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const coupon = doc.data() as Coupon;
        const spend = await db
          .collection(COLLECTIONS.couponRedemptions)
          .where('code', '==', coupon.code)
          .limit(MAX_REDEMPTIONS_SCANNED + 1)
          .get();

        const rows = spend.docs
          .slice(0, MAX_REDEMPTIONS_SCANNED)
          .map((redemption) => redemption.data() as CouponRedemption);

        let totalDiscount = 0;
        let platformFunded = 0;
        const customers = new Set<string>();

        for (const row of rows) {
          const discount = row.discountAmount ?? 0;
          totalDiscount += discount;
          platformFunded += splitCouponFunding(
            discount,
            coupon.fundedBy,
            coupon.platformShareBps,
          ).platform;
          if (row.customerId) customers.add(row.customerId);
        }

        return {
          ...coupon,
          redemptionCount: rows.length,
          uniqueCustomers: customers.size,
          totalDiscount,
          platformFunded,
          restaurantFunded: totalDiscount - platformFunded,
          // True when this coupon has more redemptions than one screen reads.
          // Said out loud rather than silently understating a campaign's cost.
          redemptionsTruncated: spend.size > MAX_REDEMPTIONS_SCANNED,
        };
      }),
    );

    return { ok: true, coupons };
  }),
);

/**
 * One coupon's redemptions, newest first.
 *
 * WHAT IS DELIBERATELY NOT IN HERE
 * --------------------------------
 * The customer's name. A redemption row identifies a person by their order —
 * which is the thing an admin actually needs in order to look into a dispute —
 * and by a masked phone number, which is enough to recognise a repeat user
 * without printing somebody's number onto a screen that is often on a
 * projector in an office. The full number is on the order itself, one click
 * away, for the person who genuinely needs it.
 */
export const couponRedemptions = onCall(
  guard('couponRedemptions', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));

    const couponSnap = await db.doc(paths.coupon(code)).get();
    if (!couponSnap.exists) fail(AppErrorCode.COUPON_NOT_FOUND);
    const coupon = couponSnap.data() as Coupon;

    const snapshot = await db
      .collection(COLLECTIONS.couponRedemptions)
      .where('code', '==', code)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const rows = snapshot.docs.map((doc) => doc.data() as CouponRedemption);

    // The order codes, so a row reads as "QP-2841" rather than as a document
    // id nobody can look up. Read in one batch; a missing order (deleted by the
    // pre-launch reset, say) simply has no code rather than failing the list.
    const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))].slice(0, 100);
    const orderDocs =
      orderIds.length > 0
        ? await db.getAll(...orderIds.map((orderId) => db.doc(paths.order(orderId))))
        : [];

    const codes = new Map<string, string>();
    for (const doc of orderDocs) {
      if (!doc.exists) continue;
      codes.set(doc.id, (doc.data() as Order).code ?? '');
    }

    return {
      ok: true,
      redemptions: rows.map((row) => {
        const split = splitCouponFunding(
          row.discountAmount ?? 0,
          coupon.fundedBy,
          coupon.platformShareBps,
        );

        return {
          orderId: row.orderId,
          orderCode: codes.get(row.orderId) ?? null,
          discountAmount: row.discountAmount ?? 0,
          platformFunded: split.platform,
          restaurantFunded: split.restaurant,
          phoneMasked: maskPhone(row.phone),
          createdAt: row.createdAt,
        };
      }),
    };
  }),
);

/** "+994 50 *** ** 41" — enough to recognise, not enough to ring. */
function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '—';
  return `••• ${digits.slice(-4)}`;
}

/**
 * Edits a live campaign.
 *
 * WHAT CANNOT BE EDITED, AND WHY
 * ------------------------------
 * The code and the funding split. The code is the document id and the thing
 * every redemption points at, so changing it would orphan the campaign's own
 * history. `fundedBy` and `platformShareBps` decide who paid for discounts
 * that have ALREADY been given — the settlement re-reads them when it bills the
 * month — so editing them would rewrite invoices retroactively. A campaign
 * whose funding needs to change is a new campaign; this one gets switched off.
 *
 * Everything else is a business decision that legitimately changes mid-flight:
 * extending the window, raising the cap, adding a restaurant that asked to join
 * in. Each change is written to the audit log with its before and after.
 */
export const updateCoupon = onCall(
  guard('updateCoupon', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));

    const ref = db.doc(paths.coupon(code));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);
    const before = snapshot.data() as Coupon;

    const update: Record<string, unknown> = {};

    if (data.value !== undefined) {
      update.value =
        before.type === CouponType.FREE_DELIVERY
          ? 0
          : requireInt(data, 'value', {
              min: 1,
              max: before.type === CouponType.PERCENT ? 10000 : 50_000,
            });
    }
    if (data.minSubtotal !== undefined) {
      update.minSubtotal = requireInt(data, 'minSubtotal', { min: 0, max: 1_000_000 });
    }
    if (data.maxDiscount !== undefined) {
      update.maxDiscount = optionalInt(data, 'maxDiscount', { min: 1, max: 100_000 });
    }
    if (data.restaurantIds !== undefined) {
      update.restaurantIds = optionalStringArray(data, 'restaurantIds', {
        max: 50,
        maxLength: 128,
      });
    }
    if (data.allowedUserIds !== undefined) {
      update.allowedUserIds = optionalStringArray(data, 'allowedUserIds', {
        max: 200,
        maxLength: 128,
      });
    }
    if (data.firstOrderOnly !== undefined) update.firstOrderOnly = data.firstOrderOnly === true;
    if (data.usageLimitTotal !== undefined) {
      update.usageLimitTotal = optionalInt(data, 'usageLimitTotal', { min: 1, max: 1_000_000 });
    }
    if (data.usageLimitPerCustomer !== undefined) {
      update.usageLimitPerCustomer = requireInt(data, 'usageLimitPerCustomer', { min: 1, max: 50 });
    }
    if (data.validFrom !== undefined) {
      update.validFrom = Timestamp.fromMillis(requireInt(data, 'validFrom', { min: 0 }));
    }
    if (data.validUntil !== undefined) {
      update.validUntil = Timestamp.fromMillis(requireInt(data, 'validUntil', { min: 0 }));
    }

    const fromMs =
      update.validFrom !== undefined
        ? (update.validFrom as { toMillis: () => number }).toMillis()
        : (before.validFrom?.toMillis?.() ?? 0);
    const untilMs =
      update.validUntil !== undefined
        ? (update.validUntil as { toMillis: () => number }).toMillis()
        : (before.validUntil?.toMillis?.() ?? 0);
    if (untilMs <= fromMs) fail(AppErrorCode.VALIDATION_FAILED, 'validUntil');

    // The same two rules the creation path enforces, re-checked here: an edit
    // that removed the last restaurant from a restaurant-funded campaign would
    // start billing every restaurant on the platform for it.
    const restaurantIds = (update.restaurantIds as string[] | undefined) ?? before.restaurantIds;
    if (before.fundedBy !== CouponFunding.PLATFORM && (restaurantIds?.length ?? 0) === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'restaurantIds');
    }

    // And the open-cheque rule: an uncapped percentage above 30%.
    const value = (update.value as number | undefined) ?? before.value;
    const maxDiscount =
      update.maxDiscount !== undefined ? (update.maxDiscount as number | null) : before.maxDiscount;
    if (before.type === CouponType.PERCENT && maxDiscount === null && value > 3000) {
      fail(AppErrorCode.VALIDATION_FAILED, 'maxDiscount');
    }

    if (Object.keys(update).length === 0) return { ok: true, code };

    await ref.update(update);

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COUPON_UPDATED,
      targetType: 'coupon',
      targetId: code,
      // Only the fields that actually moved, so the entry reads as a change
      // rather than as a second copy of the document.
      oldValue: Object.fromEntries(
        Object.keys(update).map((key) => [key, (before as unknown as Record<string, unknown>)[key]]),
      ),
      newValue: update,
      reason: optionalString(data, 'reason', { max: 300 }),
    });

    return { ok: true, code };
  }),
);

/**
 * The coupons this customer can actually use, right now.
 *
 * WHY A CALLABLE AND NOT A QUERY
 * ------------------------------
 * "Which coupons apply to me" is not a question Firestore rules can answer.
 * A coupon addressed to eight named customers must be invisible to everyone
 * else, and a rule that let the client read the coupon collection to work that
 * out would hand every customer the list of names. So the filtering happens
 * here, where the caller's identity is known and only the answer travels back.
 *
 * The result is advisory. Nothing here decides a discount — `createOrder`
 * re-evaluates every coupon from scratch against the real cart. A stale or
 * doctored response from this function can at most show somebody a card that
 * then fails at checkout.
 */
export const myCoupons = onCall(
  guard('myCoupons', async (request) => {
    const { caller, user } = await requireActiveUser(request);

    const nowMs = Date.now();

    // Only live campaigns. An expired coupon in "my coupons" is a promise the
    // checkout will break, and the customer will blame the restaurant for it.
    const snapshot = await db
      .collection(COLLECTIONS.coupons)
      .where('active', '==', true)
      .limit(200)
      .get();

    const candidates = snapshot.docs
      .map((doc) => doc.data() as Coupon)
      .filter((coupon) => {
        const from = coupon.validFrom?.toMillis?.() ?? 0;
        const until = coupon.validUntil?.toMillis?.() ?? 0;
        if (from > nowMs || (until > 0 && until < nowMs)) return false;

        // Addressed to named customers: everybody else must not even see it.
        if (coupon.allowedUserIds?.length > 0 && !coupon.allowedUserIds.includes(caller.uid)) {
          return false;
        }

        // A welcome coupon shown to somebody who has already ordered is a
        // small, daily insult. Hide it rather than let checkout refuse it.
        if (coupon.firstOrderOnly && user.hasCompletedOrder) return false;

        if (coupon.usageLimitTotal !== null && coupon.usedCount >= coupon.usageLimitTotal) {
          return false;
        }

        return true;
      });

    // How many times this person has already used each one. Counted per phone
    // as well as per account, the same way `createOrder` counts it, so the two
    // never disagree about whether a coupon is spent.
    const used = await Promise.all(
      candidates.map(async (coupon) => {
        const [byUid, byPhone] = await Promise.all([
          db
            .collection(COLLECTIONS.couponRedemptions)
            .where('code', '==', coupon.code)
            .where('customerId', '==', caller.uid)
            .count()
            .get(),
          db
            .collection(COLLECTIONS.couponRedemptions)
            .where('code', '==', coupon.code)
            .where('phone', '==', user.phone)
            .count()
            .get(),
        ]);
        return Math.max(byUid.data().count, byPhone.data().count);
      }),
    );

    // The restaurants each coupon is tied to, so the card can offer a way in.
    // A coupon that says "only at three restaurants" and does not say which
    // three is a coupon nobody uses — and the customer cannot look them up,
    // because the ids mean nothing to them.
    const wantedIds = [
      ...new Set(candidates.flatMap((coupon) => coupon.restaurantIds ?? [])),
    ].slice(0, 60);

    const restaurantDocs = await Promise.all(
      wantedIds.map((id) => db.doc(paths.restaurant(id)).get()),
    );

    const byId = new Map<string, { id: string; name: string; slug: string }>();
    for (const doc of restaurantDocs) {
      if (!doc.exists) continue;
      const restaurant = doc.data() as { id?: string; name?: string; slug?: string };
      byId.set(doc.id, {
        id: restaurant.id ?? doc.id,
        name: restaurant.name ?? '',
        slug: restaurant.slug ?? '',
      });
    }

    const coupons = candidates
      .map((coupon, index) => ({
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        minSubtotal: coupon.minSubtotal,
        maxDiscount: coupon.maxDiscount,
        firstOrderOnly: coupon.firstOrderOnly,
        restaurantIds: coupon.restaurantIds ?? [],
        // Name and slug only — enough to show a button and build its link, and
        // nothing about the restaurant the customer could not already see.
        restaurants: (coupon.restaurantIds ?? [])
          .map((id) => byId.get(id))
          .filter((entry): entry is { id: string; name: string; slug: string } =>
            Boolean(entry),
          ),
        validUntil: coupon.validUntil,
        usedByMe: used[index],
        remainingForMe: Math.max(0, coupon.usageLimitPerCustomer - used[index]),
        // Deliberately absent: fundedBy and the funding split. Who pays for a
        // discount is a matter between Qapında and the restaurant, and telling
        // the customer invites an argument at the door that helps nobody.
      }))
      .sort((a, b) => Number(b.remainingForMe > 0) - Number(a.remainingForMe > 0));

    return { ok: true, coupons };
  }),
);

// ---------------------------------------------------------------------------
// Personal coupons — a coupon addressed to one named customer
// ---------------------------------------------------------------------------

/*
 * "ADMİN İSTİFADEÇİLERE AYRI AYRILIQLDA ÖZEL KUPONLAR VERE BİLMELİDİR."
 *
 * The model already had `allowedUserIds`, and `evaluateCoupon` already refused
 * anybody not on that list — the rule was there, the workflow was not. There
 * was exactly one way to put a customer on a coupon: paste their raw Firestore
 * uid into a textarea on the campaign screen. Nobody knows a uid. So an admin
 * looking at a customer had no way to give that customer anything, and a
 * coupon aimed at eight people showed as "8 named customers" and nothing else.
 *
 * These four callables are that workflow. They change no rule: the coupon is
 * still refused server-side by `evaluateCoupon` inside `createOrder`, which is
 * the only place a discount is ever decided. What they add is a way in — by
 * PHONE NUMBER, which is the identity this platform is actually built on and
 * the only handle an admin has after a phone call from an unhappy customer.
 *
 * WHAT IS DELIBERATELY NOT RETURNED
 * ---------------------------------
 * Full legal names. `displayName` from `/shared` turns "Aysel Məmmədova" into
 * "Aysel M." and it is the same function the reviews use, so the promise not to
 * print a customer's full name is kept by one function rather than by everybody
 * remembering. The phone is returned in full, because it is the thing the admin
 * typed in to get here and the thing they will ring.
 */

/**
 * Turns a phone number into the account it belongs to.
 *
 * Through `phoneIndex`, which is the uniqueness lock — one document per number,
 * holding the uid. That makes this a single point read rather than a query, and
 * it cannot return two accounts for one number, because the lock is what stops
 * a second one existing.
 */
async function uidForPhone(phoneE164: string): Promise<string> {
  const lock = await db.doc(paths.phoneLock(phoneE164)).get();
  const uid = (lock.data() as { uid?: string } | undefined)?.uid;
  if (!lock.exists || !uid) fail(AppErrorCode.ACCOUNT_NOT_FOUND, 'phone');
  return uid;
}

/** The two facts a screen may show about a named customer, and no more. */
interface CouponCustomer {
  uid: string;
  phone: string;
  /** "Aysel M." — never the full legal name. */
  name: string;
}

async function describeCustomers(uids: readonly string[]): Promise<CouponCustomer[]> {
  if (uids.length === 0) return [];

  const docs = await db.getAll(...uids.map((uid) => db.doc(paths.user(uid))));

  return uids.map((uid) => {
    const doc = docs.find((entry) => entry.id === uid);
    const data = doc?.exists ? (doc.data() as User) : null;
    return {
      uid,
      // A uid that no longer resolves is shown as itself rather than dropped:
      // an admin looking at a coupon needs to see that somebody on it has been
      // deleted, not to have the row quietly disappear.
      phone: data?.phone ?? '',
      name: data?.fullName ? displayName(data.fullName) : '',
    };
  });
}

/**
 * Who a coupon is for.
 *
 * Empty `customers` with `named: false` means the coupon is open to everyone —
 * which is a different answer from "aimed at nobody", and the screen says so.
 */
export const couponCustomers = onCall(
  guard('couponCustomers', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));

    const snapshot = await db.doc(paths.coupon(code)).get();
    if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);

    const coupon = snapshot.data() as Coupon;
    const uids = (coupon.allowedUserIds ?? []).slice(0, MAX_COUPON_CUSTOMERS);

    return { ok: true, named: uids.length > 0, customers: await describeCustomers(uids) };
  }),
);

/**
 * Adds one customer, found by phone number, to a coupon.
 *
 * A transaction because the read that decides whether the list is full and the
 * write that extends it have to be the same list — two admins adding the last
 * two names at once must not both be told there was room. Reads before writes,
 * as everywhere.
 */
export const addCouponCustomer = onCall(
  guard('addCouponCustomer', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));
    const phone = requirePhone(data);
    const reason = optionalString(data, 'reason', { max: 300 });

    const uid = await uidForPhone(phone);

    const ref = db.doc(paths.coupon(code));

    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);

      const coupon = snapshot.data() as Coupon;

      // Both rules — "a public campaign does not become a private one" and the
      // ceiling — live in `/shared`, where they are tested. This only carries
      // the answer into a write.
      const change = addCouponCustomerTo(coupon.allowedUserIds, uid, MAX_COUPON_CUSTOMERS);
      if (change.error) fail(AppErrorCode.VALIDATION_FAILED, change.error);
      if (!change.changed) return { added: false, count: change.allowedUserIds.length };

      tx.update(ref, { allowedUserIds: change.allowedUserIds });
      return { added: true, count: change.allowedUserIds.length };
    });

    if (outcome.added) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.COUPON_CUSTOMER_ADDED,
        targetType: 'coupon',
        targetId: code,
        // The customer is named by uid and phone, because "who was given this"
        // is the only question this entry exists to answer.
        newValue: { customerId: uid, phone, customerCount: outcome.count },
        reason,
      });
    }

    return { ok: true, customers: await describeCustomers([uid]) };
  }),
);

/** Takes one customer off a coupon. The coupon itself is never touched. */
export const removeCouponCustomer = onCall(
  guard('removeCouponCustomer', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const code = normaliseCouponCode(requireString(data, 'code', { min: 3, max: 24 }));
    const customerId = requireString(data, 'customerId', { min: 1, max: 128 });
    const reason = optionalString(data, 'reason', { max: 300 });

    const ref = db.doc(paths.coupon(code));

    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);

      const coupon = snapshot.data() as Coupon;

      const change = removeCouponCustomerFrom(coupon.allowedUserIds, customerId);
      if (!change.changed) return { removed: false, count: change.allowedUserIds.length };

      /*
       * `deactivate` is the shared rule's answer to the last name coming off:
       * an empty `allowedUserIds` means "everyone", so the coupon would
       * silently become a public giveaway. It is switched off in the same write
       * instead — there is nobody left it was ever for.
       */
      tx.update(
        ref,
        change.deactivate
          ? { allowedUserIds: change.allowedUserIds, active: false }
          : { allowedUserIds: change.allowedUserIds },
      );

      return {
        removed: true,
        count: change.allowedUserIds.length,
        deactivated: change.deactivate,
      };
    });

    if (outcome.removed) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.COUPON_CUSTOMER_REMOVED,
        targetType: 'coupon',
        targetId: code,
        oldValue: { customerId },
        newValue: { customerCount: outcome.count, deactivated: outcome.deactivated === true },
        reason,
      });
    }

    return { ok: true, deactivated: outcome.deactivated === true };
  }),
);

/**
 * A generated code for a coupon nobody has to type.
 *
 * A personal coupon is picked from a list in the app rather than typed off a
 * poster, so its code only has to be unique and recognisable in the audit log.
 * `SHEXSI` plus six characters from an alphabet with no 0/O/1/I in it, so the
 * one time somebody does read it down a phone line it survives.
 *
 * The prefix is the ASCII spelling of "şəxsi", and it is SHEXSI rather than
 * SEXSI. Coupon codes are stripped to A-Z0-9 — the Azerbaijani letters cannot
 * survive — so the transliteration is what people actually read, and the old
 * one read as an English word nobody wanted printed on a customer's screen.
 * Codes already issued keep working: this is a prefix for new ones, and
 * nothing anywhere matches on it.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function personalCouponCode(): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return normaliseCouponCode(`SHEXSI${suffix}`);
}

/**
 * Gives one customer a coupon — an existing personal one, or a new one made
 * for them on the spot.
 *
 * Reached from Admin → İstifadəçilər, with a customer already on screen. That
 * is the whole reason it exists rather than the admin being sent to the coupon
 * screen to paste a uid: the person handling the complaint is looking at the
 * customer, and the coupon is the answer to the complaint.
 *
 * A coupon created here is always PLATFORM funded. A restaurant cannot be
 * billed for an apology it was not asked about, and there is no restaurant in
 * this flow to ask.
 */
export const grantCustomerCoupon = onCall(
  guard('grantCustomerCoupon', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MANAGE_COUPONS);

    const data = asObject(request.data);
    const customerId = requireString(data, 'customerId', { min: 1, max: 128 });
    const reason = optionalString(data, 'reason', { max: 300 });

    const customerSnap = await db.doc(paths.user(customerId)).get();
    if (!customerSnap.exists) fail(AppErrorCode.ACCOUNT_NOT_FOUND);
    const customer = customerSnap.data() as User;

    // ---- An existing personal coupon -------------------------------------
    const existingCode = optionalString(data, 'code', { max: 24 });
    if (existingCode) {
      const code = normaliseCouponCode(existingCode);
      const ref = db.doc(paths.coupon(code));

      const outcome = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) fail(AppErrorCode.COUPON_NOT_FOUND);

        const coupon = snapshot.data() as Coupon;

        // The same shared rule as `addCouponCustomer`, so the two entry points
        // cannot drift apart about what may be added to what.
        const change = addCouponCustomerTo(
          coupon.allowedUserIds,
          customerId,
          MAX_COUPON_CUSTOMERS,
        );
        if (change.error) fail(AppErrorCode.VALIDATION_FAILED, change.error);
        if (!change.changed) return { added: false, count: change.allowedUserIds.length };

        tx.update(ref, { allowedUserIds: change.allowedUserIds });
        return { added: true, count: change.allowedUserIds.length };
      });

      if (outcome.added) {
        await writeAudit({
          actorId: caller.uid,
          actorRole: user.role,
          action: AuditAction.COUPON_CUSTOMER_ADDED,
          targetType: 'coupon',
          targetId: code,
          newValue: { customerId, phone: customer.phone, customerCount: outcome.count },
          reason,
        });
      }

      return { ok: true, code };
    }

    // ---- A new coupon, for this customer alone ---------------------------
    const type = requireEnum<CouponType>(data, 'type', [
      CouponType.PERCENT,
      CouponType.FIXED,
      CouponType.FREE_DELIVERY,
    ]);

    const value =
      type === CouponType.FREE_DELIVERY
        ? 0
        : requireInt(data, 'value', {
            min: 1,
            max: type === CouponType.PERCENT ? 10000 : 50_000,
          });

    const minSubtotal = requireInt(data, 'minSubtotal', { min: 0, max: 1_000_000 });
    const maxDiscount = optionalInt(data, 'maxDiscount', { min: 1, max: 100_000 });
    const validFromMs = requireInt(data, 'validFrom', { min: 0 });
    const validUntilMs = requireInt(data, 'validUntil', { min: 0 });
    if (validUntilMs <= validFromMs) fail(AppErrorCode.VALIDATION_FAILED, 'validUntil');

    // The same open-cheque rule the campaign screen enforces. A personal coupon
    // is small by nature, but "personal" is not a reason to skip the cap.
    if (type === CouponType.PERCENT && maxDiscount === null && value > 3000) {
      fail(AppErrorCode.VALIDATION_FAILED, 'maxDiscount');
    }

    /*
     * A generated code can collide, however unlikely. `create` is what makes
     * that harmless — it fails on an existing document rather than merging two
     * campaigns' usage counters — so the answer is simply to try again.
     */
    let code = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = personalCouponCode();
      const coupon: Omit<Coupon, 'createdAt'> = {
        code: candidate,
        type,
        value,
        fundedBy: CouponFunding.PLATFORM,
        platformShareBps: 10000,
        restaurantIds: [],
        allowedUserIds: [customerId],
        minSubtotal,
        maxDiscount,
        firstOrderOnly: false,
        usageLimitTotal: 1,
        // One coupon, one customer, one use. Anything else is a campaign.
        usageLimitPerCustomer: 1,
        usedCount: 0,
        active: true,
        validFrom: Timestamp.fromMillis(validFromMs) as unknown as Coupon['validFrom'],
        validUntil: Timestamp.fromMillis(validUntilMs) as unknown as Coupon['validUntil'],
        createdBy: caller.uid,
      };

      try {
        await db.doc(paths.coupon(candidate)).create({ ...coupon, createdAt: now() });
        code = candidate;
        break;
      } catch {
        // Taken. Draw another one.
      }
    }

    if (!code) fail(AppErrorCode.CONFLICT, 'code-exists');

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COUPON_CREATED,
      targetType: 'coupon',
      targetId: code,
      newValue: {
        type,
        value,
        fundedBy: CouponFunding.PLATFORM,
        minSubtotal,
        maxDiscount,
        personal: true,
      },
      reason,
    });

    // Two entries on purpose: one says the coupon was made, the other says who
    // it was made for. The second is the one somebody comes looking for.
    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COUPON_CUSTOMER_ADDED,
      targetType: 'coupon',
      targetId: code,
      newValue: { customerId, phone: customer.phone, customerCount: 1 },
      reason,
    });

    return { ok: true, code };
  }),
);
