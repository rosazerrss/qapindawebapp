/**
 * QAPINDA — Ledger and settlement administration.
 *
 * The ledger is append-only. A mistake is corrected by posting an opposing
 * entry with a reason, never by editing or deleting the original — a book that
 * can be edited is not a book anyone should settle against.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission, requireRestaurantAccess } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { isClosedSettlement, rebuildSettlement } from '../lib/settlement';
import {
  asObject,
  optionalInt,
  optionalString,
  requireArray,
  requireEnum,
  requireInt,
  requireString,
  optionalStringArray,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import {
  AuditAction,
  LedgerEntryType,
  PaymentMethod,
  SettlementPaymentDirection,
  SettlementPaymentMethod,
  SettlementStatus,
  V1_PAYMENT_METHODS,
} from '../shared/enums';
import {
  MAX_CANCEL_WINDOW_MINUTES,
  MIN_CANCEL_WINDOW_MINUTES,
} from '../shared/orderState';
import { FOOD_CATEGORY_IDS } from '../shared/categories';
import { Permission, hasPermission } from '../shared/permissions';
import { epointConfig } from '../payments/epoint';
import { isValidIban, looksLikeCardNumber, maskIban, normaliseIban } from '../shared/bank';
import { normaliseMaintenanceUntil } from '../shared/maintenance';
import {
  COLLECTIONS,
  normaliseReferenceKey,
  paths,
  periodOf,
  settlementPaymentIdempotencyKey,
} from '../shared/collections';
import { summariseLedger, settlementNetDue } from '../shared/pricing';
import { DELIVERY_CODE_POLICIES } from '../shared/deliveryCode';
import type { LedgerEntry, PayoutDetails, PublicSettings, Settlement } from '../shared/models';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const DAY_MILLIS = 24 * 60 * 60 * 1000;

/**
 * Posts a correcting entry.
 *
 * Positive means the restaurant owes more, negative means the platform does.
 * Both need a written reason, which the restaurant can see on its invoice.
 */
export const adjustLedger = onCall(
  guard('adjustLedger', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_ADJUST_LEDGER);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const period = requireString(data, 'period', { min: 7, max: 7 });
    if (!PERIOD.test(period)) fail(AppErrorCode.VALIDATION_FAILED, 'period');

    // Signed, so requireInt's minimum of zero would be wrong here.
    const amount = data.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'amount');
    }
    if (Math.abs(amount) > 10_000_00) fail(AppErrorCode.VALIDATION_FAILED, 'amount');

    const description = requireString(data, 'description', { min: 10, max: 300 });
    const orderId = optionalString(data, 'orderId', { max: 128 });

    const settlement = await db.doc(paths.settlement(restaurantId, period)).get();
    const status = settlement.data()?.status;
    if (status === SettlementStatus.PAID || status === SettlementStatus.WRITTEN_OFF) {
      // A closed month is closed. Corrections go onto the current one.
      fail(AppErrorCode.SETTLEMENT_LOCKED);
    }

    const ref = db.collection(COLLECTIONS.ledgerEntries).doc();
    await ref.set({
      id: ref.id,
      restaurantId,
      period,
      orderId,
      type: LedgerEntryType.ADJUSTMENT,
      amount,
      currency: 'AZN',
      description,
      idempotencyKey: `adjustment:${ref.id}`,
      createdBy: caller.uid,
      createdAt: now(),
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.LEDGER_ADJUSTED,
      targetType: 'ledgerEntry',
      targetId: ref.id,
      restaurantId,
      newValue: { amount, period, description },
      reason: description,
      ip: request.rawRequest.ip ?? null,
    });

    // The person who posted it sees the consequence now, rather than finding
    // out tomorrow whether they got the sign right.
    const settlementAfter = await rebuildSettlement(restaurantId, period);

    return { ok: true, entryId: ref.id, netDue: settlementAfter?.netDue ?? null };
  }),
);

/**
 * Records that a settlement was actually paid — in either direction.
 *
 * This is the only way money is marked as having moved, and it works by posting
 * an entry, never by setting a field: the ledger is the record, and a status
 * that can be flipped without a corresponding entry is a status that will
 * eventually disagree with the bank. The settlement is then re-derived from the
 * entries, so the balance on screen is always the sum of what actually
 * happened.
 *
 * Idempotent on the payment's reference: two operators filing the same transfer
 * from the same statement write the same document and the balance moves once.
 */
export const recordSettlementPayment = onCall(
  guard('recordSettlementPayment', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MARK_SETTLEMENT_PAID);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const period = requireString(data, 'period', { min: 7, max: 7 });
    if (!PERIOD.test(period)) fail(AppErrorCode.VALIDATION_FAILED, 'period');

    // A positive magnitude plus an explicit direction, rather than a signed
    // number. "Minus twelve manats" means one thing to the person typing it and
    // the opposite to the person reading it back; "the restaurant paid us" does
    // not have that problem.
    const amount = requireInt(data, 'amount', { min: 1, max: 100_000_00 });
    const direction = requireEnum(data, 'direction', [
      SettlementPaymentDirection.FROM_RESTAURANT,
      SettlementPaymentDirection.TO_RESTAURANT,
    ]);
    const method = requireEnum(data, 'method', [
      SettlementPaymentMethod.BANK_TRANSFER,
      SettlementPaymentMethod.CASH,
      SettlementPaymentMethod.OFFSET,
    ]);
    const reference = requireString(data, 'reference', { min: 3, max: 100 });
    if (!normaliseReferenceKey(reference)) fail(AppErrorCode.VALIDATION_FAILED, 'reference');

    // When the money moved, which is rarely the day somebody got round to
    // filing it. Bounded so a mistyped year cannot land a payment in 1970 or in
    // a period that has not happened yet.
    const paidAtMillis = optionalInt(data, 'paidAt', { min: 0 }) ?? Date.now();
    if (paidAtMillis > Date.now() + DAY_MILLIS) fail(AppErrorCode.VALIDATION_FAILED, 'paidAt');

    const note = optionalString(data, 'note', { max: 300 });

    const settlementRef = db.doc(paths.settlement(restaurantId, period));
    const existing = (await settlementRef.get()).data() as Settlement | undefined;
    if (isClosedSettlement(existing?.status)) {
      // A closed month is closed. A late payment belongs on the open one, where
      // it can still be seen and argued about.
      fail(AppErrorCode.SETTLEMENT_LOCKED);
    }

    const key = settlementPaymentIdempotencyKey(restaurantId, period, reference);
    const entryRef = db.doc(paths.ledgerEntry(key));
    const already = await entryRef.get();

    if (!already.exists) {
      await entryRef.set({
        id: key,
        restaurantId,
        period,
        orderId: null,
        type: LedgerEntryType.PAYMENT_RECEIVED,
        // Negative when the restaurant paid us — it reduces what they owe.
        // Positive when we paid them, which reduces what we owe, and both are
        // the same sentence written from the ledger's point of view.
        amount:
          direction === SettlementPaymentDirection.FROM_RESTAURANT ? -amount : amount,
        currency: existing?.currency ?? 'AZN',
        description: note ?? `Ödəniş · ${reference}`,
        paymentDirection: direction,
        paymentMethod: method,
        paymentReference: reference,
        paidAt: Timestamp.fromMillis(paidAtMillis),
        orderTotal: null,
        idempotencyKey: key,
        createdBy: caller.uid,
        createdAt: now(),
      });
    }

    const settlement = await rebuildSettlement(restaurantId, period);

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.SETTLEMENT_PAYMENT_RECORDED,
      targetType: 'settlement',
      targetId: settlementRef.id,
      restaurantId,
      oldValue: { netDue: existing?.netDue ?? null, status: existing?.status ?? null },
      newValue: { amount, direction, method, reference, netDue: settlement?.netDue ?? null },
      reason: note,
      ip: request.rawRequest.ip ?? null,
    });

    return {
      ok: true,
      entryId: key,
      // False when the same reference had already been filed, so the screen can
      // say "this payment was already recorded" instead of implying it moved
      // the balance a second time.
      recorded: !already.exists,
      netDue: settlement?.netDue ?? null,
      status: settlement?.status ?? null,
    };
  }),
);

/**
 * The bank account a restaurant is paid into.
 *
 * The owner sets it — not a manager, and not the platform on their behalf:
 * whoever can change where the money lands is the person who can redirect it,
 * and that has to be the person whose money it is. Platform staff can read it,
 * because somebody has to type it into a transfer.
 *
 * Bank transfer details only. A card number is refused outright.
 */
export const setPayoutDetails = onCall(
  guard('setPayoutDetails', async (request) => {
    const { caller, user } = await requireActiveUser(request);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    requireRestaurantAccess(caller, Permission.RESTAURANT_EDIT_PAYOUT, restaurantId);

    const accountHolder = requireString(data, 'accountHolder', { min: 2, max: 120 });
    const bankName = requireString(data, 'bankName', { min: 2, max: 120 });
    const rawIban = requireString(data, 'iban', { min: 5, max: 42 });

    if (looksLikeCardNumber(rawIban)) fail(AppErrorCode.VALIDATION_FAILED, 'card-number');
    const iban = normaliseIban(rawIban);
    if (!isValidIban(iban)) fail(AppErrorCode.VALIDATION_FAILED, 'iban');

    const ref = db.doc(paths.restaurantBusiness(restaurantId));
    const before = (await ref.get()).data()?.payout as { iban?: string } | undefined;

    await ref.set(
      {
        payout: {
          accountHolder,
          iban,
          bankName,
          updatedAt: now(),
          updatedBy: caller.uid,
        },
        updatedAt: now(),
        updatedBy: caller.uid,
      },
      { merge: true },
    );

    // The old IBAN is recorded because "the payout went to a different account
    // last month" is a question that gets asked, and an audit trail that only
    // says "changed" cannot answer it.
    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.PAYOUT_DETAILS_CHANGED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      /*
       * Masked. `auditLogs` is readable by every operator, and the whole point
       * of narrowing the ledger and the private business document to a super
       * admin was to keep the payout account away from that role. The last four
       * digits answer "is this the same account as last month"; the rest would
       * only answer "where can I send this money instead".
       */
      oldValue: { iban: maskIban(before?.iban) },
      newValue: { iban: maskIban(iban), accountHolder, bankName },
      ip: request.rawRequest.ip ?? null,
    });

    return { ok: true };
  }),
);

/**
 * Moves a month between the states that are not about money arriving.
 *
 * Issued, overdue, written off. "Paid" is not here on purpose — see the list
 * inside.
 */
export const setSettlementStatus = onCall(
  guard('setSettlementStatus', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_MARK_SETTLEMENT_PAID);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const period = requireString(data, 'period', { min: 7, max: 7 });
    if (!PERIOD.test(period)) fail(AppErrorCode.VALIDATION_FAILED, 'period');

    const status = requireString(data, 'status', { max: 20 }) as SettlementStatus;
    // PAID is deliberately not on this list. A month becomes paid because a
    // payment was recorded against it and the balance reached zero — see
    // `recordSettlementPayment`. A status anybody can set by hand is a status
    // that says "paid" while the bank says otherwise.
    const allowed: SettlementStatus[] = [
      SettlementStatus.OPEN,
      SettlementStatus.INVOICED,
      SettlementStatus.OVERDUE,
      SettlementStatus.WRITTEN_OFF,
    ];
    if (!allowed.includes(status)) fail(AppErrorCode.VALIDATION_FAILED, 'status');

    const reason = requireString(data, 'reason', { min: 5, max: 300 });

    const ref = db.doc(paths.settlement(restaurantId, period));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.SETTLEMENT_NOT_FOUND);
    const settlement = snapshot.data() as Settlement;

    // A month that has been paid or written off is finished. Re-opening it
    // would let its figures move after both sides settled against them.
    if (isClosedSettlement(settlement.status)) fail(AppErrorCode.SETTLEMENT_LOCKED);

    const update: Record<string, unknown> = { status, updatedAt: now() };
    if (status === SettlementStatus.INVOICED && !settlement.invoicedAt) update.invoicedAt = now();

    await ref.update(update);

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.SETTLEMENT_MARKED_PAID,
      targetType: 'settlement',
      targetId: ref.id,
      restaurantId,
      oldValue: { status: settlement.status },
      newValue: { status },
      reason,
    });

    return { ok: true };
  }),
);

/**
 * One restaurant's account: this month, the entries behind it, and the history.
 *
 * Answers the whole of the restaurant's settlement screen in one call, because
 * that screen must never have to work anything out for itself — including which
 * side owes which, which is decided in `shared/pricing` and read from here.
 */
export const getSettlement = onCall(
  guard('getSettlement', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const period = optionalString(data, 'period', { max: 7 }) ?? periodOf(new Date());
    if (!PERIOD.test(period)) fail(AppErrorCode.VALIDATION_FAILED, 'period');

    /*
     * Asked as a PERMISSION, not as a list of role names.
     *
     * This check used to read `['OPERATOR','SUPER_ADMIN'].includes(...)`, and
     * that spelling is why it was wrong. `PLATFORM_VIEW_LEDGER` was taken away
     * from OPERATOR deliberately — `listSettlements`, `listPayments` and
     * `platformReport` all stopped answering an operator the day it was — but
     * a check that names roles instead of asking the table never noticed the
     * change. The response below carries every ledger line, the commission
     * rate and the payout IBAN, so an operator kept a console-sized hole into
     * the one thing the permission was removed to protect.
     *
     * Naming the permission means the next change to the table reaches here by
     * itself. It also correctly drops RESTAURANT_MANAGER, who holds neither
     * `PLATFORM_VIEW_LEDGER` nor `RESTAURANT_VIEW_FINANCE`.
     */
    const platformSide = hasPermission(caller.role, Permission.PLATFORM_VIEW_LEDGER);
    const ownSide =
      hasPermission(caller.role, Permission.RESTAURANT_VIEW_FINANCE) &&
      caller.restaurantId === restaurantId;
    if (!platformSide && !ownSide) fail(AppErrorCode.NOT_YOUR_RESTAURANT);

    const [settlement, entries, business, history, settings] = await Promise.all([
      db.doc(paths.settlement(restaurantId, period)).get(),
      db
        .collection(COLLECTIONS.ledgerEntries)
        .where('restaurantId', '==', restaurantId)
        .where('period', '==', period)
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get(),
      // The rate is shown next to the figures so the restaurant can check the
      // arithmetic itself. It lives in the private doc, which the client cannot
      // read directly — reading it here is the only way it reaches the screen.
      db.doc(paths.restaurantBusiness(restaurantId)).get(),
      db
        .collection(COLLECTIONS.settlements)
        .where('restaurantId', '==', restaurantId)
        .orderBy('period', 'desc')
        .limit(12)
        .get(),
      db.doc(paths.publicSettings()).get(),
    ]);

    const rows = entries.docs.map((doc) => doc.data() as LedgerEntry);
    const summary = summariseLedger(rows);
    const payout = (business.data()?.payout as PayoutDetails | undefined) ?? null;

    return {
      ok: true,
      period,
      settlement: settlement.exists ? settlement.data() : null,
      entries: rows,
      // Derived from the entries here and now, not read off the settlement
      // document: if the two ever disagree, the entries are the record and the
      // roll-up is merely stale.
      summary,
      computedNetDue: settlementNetDue(summary),
      history: history.docs.map((doc) => doc.data() as Settlement),
      commissionRateBps: (business.data()?.commissionRateBps as number | undefined) ?? null,
      payout,
      // Where a restaurant that owes money sends it. Read from the platform's
      // own settings so it is never typed into a screen by hand.
      platformBankAccount:
        (settings.data() as PublicSettings | undefined)?.platformBankAccount ?? null,
    };
  }),
);

/** The platform's overview: what every restaurant owes this month. */
export const listSettlements = onCall(
  guard('listSettlements', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_VIEW_LEDGER);

    const data = asObject(request.data);
    const period = optionalString(data, 'period', { max: 7 }) ?? periodOf(new Date());
    if (!PERIOD.test(period)) fail(AppErrorCode.VALIDATION_FAILED, 'period');

    const snapshot = await db
      .collection(COLLECTIONS.settlements)
      .where('period', '==', period)
      .orderBy('netDue', 'desc')
      .limit(200)
      .get();

    const settlements = snapshot.docs.map((doc) => doc.data() as Settlement);

    // The two sides are totalled separately as well as netted. "Forty thousand
    // net" hides the fact that it is a hundred thousand coming in and sixty
    // going out, and those are two different bank runs with two different
    // deadlines.
    const totals = settlements.reduce(
      (sum, settlement) => ({
        commission: sum.commission + settlement.commissionAmount,
        credits: sum.credits + settlement.platformFundedDiscount,
        onlineCollected: sum.onlineCollected + (settlement.onlineCollected ?? 0),
        grossSales: sum.grossSales + (settlement.grossSales ?? 0),
        owedToPlatform: sum.owedToPlatform + Math.max(0, settlement.netDue),
        owedToRestaurants: sum.owedToRestaurants + Math.max(0, -settlement.netDue),
        netDue: sum.netDue + settlement.netDue,
      }),
      {
        commission: 0,
        credits: 0,
        onlineCollected: 0,
        grossSales: 0,
        owedToPlatform: 0,
        owedToRestaurants: 0,
        netDue: 0,
      },
    );

    return { ok: true, period, settlements, totals };
  }),
);

/** Updates the platform-wide settings document. Super admin only. */
export const updatePublicSettings = onCall(
  guard('updatePublicSettings', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_EDIT_SETTINGS);

    const data = asObject(request.data);
    const ref = db.doc(paths.publicSettings());
    const before = (await ref.get()).data() ?? {};

    const update: Record<string, unknown> = { updatedAt: now() };

    if (data.city !== undefined) update.city = requireString(data, 'city', { max: 60 });
    if (data.defaultCommissionRateBps !== undefined) {
      update.defaultCommissionRateBps = requireInt(data, 'defaultCommissionRateBps', {
        min: 0,
        max: 5000,
      });
    }
    if (data.defaultResponseWindowMinutes !== undefined) {
      update.defaultResponseWindowMinutes = requireInt(data, 'defaultResponseWindowMinutes', {
        min: 2,
        max: 60,
      });
    }
    if (data.autoCompleteAfterMinutes !== undefined) {
      update.autoCompleteAfterMinutes = requireInt(data, 'autoCompleteAfterMinutes', {
        min: 5,
        max: 1440,
      });
    }
    /*
     * The customer's cancellation window, which used to be a constant in the
     * code — so changing the platform's own cancellation policy meant a
     * developer and a deploy. Bounded by the same two numbers the panel bounds
     * it with, from `shared/orderState.ts`, so the screen and the server cannot
     * disagree about what is allowed.
     */
    /*
     * The home screen's category row, as an ordered list of ids.
     *
     * Unknown ids are refused rather than dropped: an admin who mistypes should
     * be told, and the only way an id gets here is from a picker that lists the
     * real ones. An empty array is a real answer — it means "show them all" —
     * so it is stored rather than treated as absent.
     */
    if (data.homeCategories !== undefined) {
      const chosen = optionalStringArray(data, 'homeCategories', { max: 20, maxLength: 40 });
      for (const id of chosen) {
        if (!(FOOD_CATEGORY_IDS as readonly string[]).includes(id)) {
          fail(AppErrorCode.VALIDATION_FAILED, 'homeCategories');
        }
      }
      // De-duplicated, because the same category twice in the row is a bug the
      // picker should not be able to produce and the screen cannot render.
      update.homeCategories = [...new Set(chosen)];
    }

    if (data.customerCancelWindowMinutes !== undefined) {
      update.customerCancelWindowMinutes = requireInt(data, 'customerCancelWindowMinutes', {
        min: MIN_CANCEL_WINDOW_MINUTES,
        max: MAX_CANCEL_WINDOW_MINUTES,
      });
    }
    // Optional, not required. The settings form posts every field it holds on
    // every save, so demanding a non-empty string here made the whole form
    // fail with VALIDATION_FAILED whenever the support number had simply not
    // been filled in yet — which is the state every new deployment starts in.
    if (data.supportPhone !== undefined) {
      update.supportPhone = optionalString(data, 'supportPhone', { max: 20 }) ?? '';
    }
    if (data.supportEmail !== undefined) {
      update.supportEmail = optionalString(data, 'supportEmail', { max: 254 }) ?? '';
    }
    // The phone-support switch. Off unless the admin turns it on, and the
    // screens additionally require a number before they offer the option — a
    // button that dials nothing is worse than no button at all.
    if (data.supportCallEnabled !== undefined) {
      update.supportCallEnabled = data.supportCallEnabled === true;
    }
    /*
     * Maintenance mode: the switch that closes the platform.
     *
     * The message and the return time travel with it because they are only
     * ever read together — a closed platform with no explanation is the thing
     * customers ring support about. `normaliseMaintenanceUntil` throws nothing
     * away that would stop the admin closing the platform in a hurry: a bad
     * time becomes "no promise" rather than a validation failure standing
     * between an outage and the switch that contains it.
     */
    /*
     * Does every delivery close with a code from the customer?
     *
     * ALWAYS by default, and the enum is closed rather than a boolean so that
     * a third answer can be added later without rewriting what is stored. An
     * unrecognised value is refused rather than silently becoming ALWAYS: an
     * admin who mistypes should be told, and the only way a value reaches here
     * is from a two-option control.
     */
    if (data.deliveryCodePolicy !== undefined) {
      update.deliveryCodePolicy = requireEnum(data, 'deliveryCodePolicy', DELIVERY_CODE_POLICIES);
    }
    if (data.maintenanceMode !== undefined) update.maintenanceMode = data.maintenanceMode === true;
    if (data.maintenanceMessage !== undefined) {
      update.maintenanceMessage = optionalString(data, 'maintenanceMessage', { max: 400 });
    }
    if (data.maintenanceUntil !== undefined) {
      update.maintenanceUntil = normaliseMaintenanceUntil(data.maintenanceUntil, Date.now());
    }
    /*
     * The production guard on the test-data reset.
     *
     * Strictly `=== true`, like every other switch here, and its whole purpose
     * is that it is off until somebody comes to this screen and turns it on.
     * The change lands in the audit log with the rest of the settings diff, so
     * "who opened the door" is answerable separately from "who walked through
     * it" — see `functions/src/admin/reset.ts`.
     */
    if (data.testDataResetEnabled !== undefined) {
      update.testDataResetEnabled = data.testDataResetEnabled === true;
    }
    if (data.acceptingNewRestaurants !== undefined) {
      update.acceptingNewRestaurants = data.acceptingNewRestaurants === true;
    }

    /*
     * Which payment methods the platform offers at all.
     *
     * ONLINE CARD CANNOT BE SWITCHED ON WITHOUT A PROVIDER BEHIND IT.
     *
     * `createOrder` already refuses an online order when Epoint is not
     * configured, but that refusal arrives at the worst possible moment: the
     * customer has chosen the method, filled the basket and pressed the button.
     * The honest place to stop it is here, where an admin is deciding what
     * checkout may offer — so the switch simply will not turn on, and the
     * screen says why, rather than the platform advertising a payment it cannot
     * take. `epointConfig()` reads the server's own environment, which is the
     * only thing that actually knows.
     *
     * At least one method has to survive, or the platform has quietly stopped
     * accepting orders without anybody saying so.
     */
    if (data.enabledPaymentMethods !== undefined) {
      const requested = requireArray<string>(data, 'enabledPaymentMethods', { max: 3 });
      const methods = requested.filter((method): method is PaymentMethod =>
        V1_PAYMENT_METHODS.includes(method as PaymentMethod),
      );

      if (methods.length !== requested.length) {
        fail(AppErrorCode.VALIDATION_FAILED, 'enabledPaymentMethods');
      }
      if (methods.length === 0) fail(AppErrorCode.VALIDATION_FAILED, 'enabledPaymentMethods');
      if (methods.includes(PaymentMethod.ONLINE_CARD) && !epointConfig()) {
        fail(AppErrorCode.PAYMENT_NOT_CONFIGURED);
      }

      update.enabledPaymentMethods = [...new Set(methods)];
    }
    if (data.legalPlaceholders !== undefined && typeof data.legalPlaceholders === 'object') {
      update.legalPlaceholders = data.legalPlaceholders;
    }

    // The account restaurants transfer their commission to. It is shown on
    // their settlement screen, so a typo here is a month of payments landing
    // nowhere — hence the same check-digit validation the payout form uses.
    // Bank transfer details only: a card number is refused outright.
    if (data.platformBankAccount !== undefined) {
      const account = asObject(data.platformBankAccount);
      const rawIban = requireString(account, 'iban', { min: 5, max: 42 });
      if (looksLikeCardNumber(rawIban)) fail(AppErrorCode.VALIDATION_FAILED, 'card-number');
      const iban = normaliseIban(rawIban);
      if (!isValidIban(iban)) fail(AppErrorCode.VALIDATION_FAILED, 'iban');

      update.platformBankAccount = {
        accountHolder: requireString(account, 'accountHolder', { min: 2, max: 120 }),
        iban,
        bankName: requireString(account, 'bankName', { min: 2, max: 120 }),
        note: optionalString(account, 'note', { max: 200 }),
      };
    }

    await ref.set(update, { merge: true });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.SETTINGS_UPDATED,
      targetType: 'settings',
      targetId: 'public',
      oldValue: before,
      newValue: update,
    });

    /*
     * Closing the platform gets a row of its own.
     *
     * It is buried inside the settings diff above as well, but nobody scanning
     * the audit log for "why could nobody order on Tuesday evening" is going
     * to find it there. This entry names the action, who took it, and the
     * reason they typed — which is the whole record the owner asked for.
     */
    const wasOn = (before as { maintenanceMode?: boolean }).maintenanceMode === true;
    if (update.maintenanceMode !== undefined && update.maintenanceMode !== wasOn) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.MAINTENANCE_MODE_CHANGED,
        targetType: 'settings',
        targetId: 'public',
        oldValue: { maintenanceMode: wasOn },
        newValue: {
          maintenanceMode: update.maintenanceMode,
          maintenanceMessage: update.maintenanceMessage ?? null,
          maintenanceUntil: update.maintenanceUntil ?? null,
        },
        // The message the customers were shown is the closest thing to a stated
        // reason, so it doubles as one when the admin did not type a separate
        // note. Kept in whatever language it was written in — an audit row is
        // read by whoever disputes it, not translated for them.
        reason:
          optionalString(data, 'maintenanceReason', { max: 300 }) ??
          (typeof update.maintenanceMessage === 'string' ? update.maintenanceMessage : null),
      });
    }

    return { ok: true };
  }),
);
