/**
 * QAPINDA — Deriving a month's invoice from the ledger.
 *
 * The ledger is the record; a settlement document is a cache of it. Everything
 * that changes a restaurant's balance — the nightly roll-up, an adjustment, a
 * payment filed by an operator — ends here, so there is exactly one piece of
 * code that decides what a month says and no way for two of them to disagree.
 *
 * Nothing in this file invents a figure. It reads entries, adds them up with
 * the shared arithmetic the screens also use, and writes the result down.
 */

import { db, now } from './admin';
import { COLLECTIONS, paths } from '../shared/collections';
import { SettlementStatus } from '../shared/enums';
import {
  settlementNetDue,
  summariseLedger,
  type LedgerRowInput,
  type SettlementSummary,
} from '../shared/pricing';
import type { LedgerEntry, MinorUnits, Settlement } from '../shared/models';

/**
 * What a rebuild produced.
 *
 * Not the stored `Settlement`: the document is written with server timestamps,
 * which are placeholders until Firestore resolves them and are therefore not
 * values anything here could return. Callers want the figures and the state,
 * and those are exactly what this carries.
 */
export interface DerivedSettlement {
  id: string;
  restaurantId: string;
  period: string;
  summary: SettlementSummary;
  netDue: MinorUnits;
  status: SettlementStatus;
}

/**
 * Months that may no longer be recalculated.
 *
 * A paid or written-off month was agreed by two parties; recomputing it because
 * a late entry landed would silently change a number somebody has already
 * transferred money against. Corrections go onto the open month instead, which
 * is the same rule `adjustLedger` enforces at the front door.
 */
const CLOSED_STATUSES: SettlementStatus[] = [SettlementStatus.PAID, SettlementStatus.WRITTEN_OFF];

export function isClosedSettlement(status: unknown): boolean {
  return CLOSED_STATUSES.includes(status as SettlementStatus);
}

/** Reads one restaurant's entries for one month. */
export async function readLedger(restaurantId: string, period: string): Promise<LedgerRowInput[]> {
  const snapshot = await db
    .collection(COLLECTIONS.ledgerEntries)
    .where('restaurantId', '==', restaurantId)
    .where('period', '==', period)
    .get();

  return snapshot.docs.map((doc) => doc.data() as LedgerEntry);
}

/**
 * Writes the settlement for one restaurant-month.
 *
 * `restaurantName` is denormalised onto the document because the admin's list
 * is one query over settlements: reading a restaurant per row would turn one
 * screen into two hundred reads.
 *
 * Returns the figures it wrote, or null when the month was closed and left
 * alone — the caller usually wants to say which of the two happened.
 */
export async function writeSettlement(
  restaurantId: string,
  period: string,
  summary: SettlementSummary,
  restaurantName?: string,
): Promise<DerivedSettlement | null> {
  const ref = db.doc(paths.settlement(restaurantId, period));
  const existing = await ref.get();
  const current = existing.data() as Settlement | undefined;

  if (isClosedSettlement(current?.status)) return null;

  const netDue = settlementNetDue(summary);

  // A month that has been settled in full is marked paid here rather than by
  // anybody pressing a button: the balance reaching zero *is* the event, and a
  // status that has to be set by hand is a status that drifts from the money.
  // The guard on `paymentsReceived` is what stops a restaurant that simply had
  // no orders being reported as having paid an invoice that never existed.
  const settledByPayment = netDue === 0 && summary.paymentsReceived !== 0;
  const status = settledByPayment
    ? SettlementStatus.PAID
    : ((current?.status as SettlementStatus | undefined) ?? SettlementStatus.OPEN);

  const name =
    restaurantName ??
    current?.restaurantName ??
    ((await db.doc(paths.restaurant(restaurantId)).get()).data()?.name as string | undefined) ??
    restaurantId;

  await ref.set(
    {
      id: ref.id,
      restaurantId,
      restaurantName: name,
      period,
      orderCount: summary.orderCount,
      grossSales: summary.grossSales,
      commissionAmount: summary.commission,
      platformFundedDiscount: summary.platformFundedDiscount,
      adjustments: summary.adjustments,
      onlineCollected: summary.onlineCollected,
      paymentsReceived: summary.paymentsReceived,
      netDue,
      currency: 'AZN',
      status,
      invoicedAt: current?.invoicedAt ?? null,
      // Stamped once, the first time the balance closes. Re-stamping it on
      // every later rebuild would move the date a month was settled on.
      paidAt: current?.paidAt ?? (settledByPayment ? now() : null),
      updatedAt: now(),
    },
    { merge: true },
  );

  return { id: ref.id, restaurantId, period, summary, netDue, status };
}

/**
 * Re-derives one restaurant-month from its entries.
 *
 * Called after anything is posted by hand, so that the person who posted it
 * sees the consequence immediately instead of waiting for tonight's job.
 */
export async function rebuildSettlement(
  restaurantId: string,
  period: string,
): Promise<DerivedSettlement | null> {
  const entries = await readLedger(restaurantId, period);
  return writeSettlement(restaurantId, period, summariseLedger(entries));
}
