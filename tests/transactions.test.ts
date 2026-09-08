import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Firestore refuses a transaction that reads after it has written.
 *
 * This took an order with a coupon down in production, and the symptom was the
 * worst kind: a bare "something went wrong" at the moment of paying, only for
 * customers holding a coupon — so it read as "coupons are broken" rather than
 * "the transaction is written in the wrong order". Orders without a coupon
 * never reached the second read and worked perfectly, which is why it survived
 * every check that did not involve a coupon.
 *
 * A unit test cannot run Firestore, so this reads the source instead and
 * asserts the shape that makes the mistake impossible: inside `createOrder`'s
 * transaction, no `tx.get` may appear after the first `tx.set` or `tx.update`.
 * Crude, but it fails loudly the day somebody adds a read in the wrong place —
 * which is precisely how this happened the first time.
 */

function transactionBody(source: string): string {
  const start = source.indexOf('db.runTransaction(async (tx) => {');
  expect(start).toBeGreaterThan(-1);

  // Walk braces from the opening one so nested blocks are included whole.
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i);
    }
  }
  throw new Error('unbalanced transaction body');
}

/** The body of the transaction that starts at `from`, braces balanced. */
function transactionBodyAfter(source: string, from: number): string {
  return transactionBody(source.slice(from));
}

describe('createOrder transaction ordering', () => {
  const source = readFileSync('functions/src/orders/create.ts', 'utf8');
  const body = transactionBody(source);

  it('does every read before its first write', () => {
    const firstWrite = Math.min(
      ...['tx.set(', 'tx.update(', 'tx.delete(', 'writeClaimIn(']
        .map((token) => body.indexOf(token))
        .filter((index) => index !== -1),
    );

    const lastRead = body.lastIndexOf('tx.get(');

    // Both must actually exist, or the test would pass by finding nothing.
    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastRead).toBeGreaterThan(-1);
    expect(lastRead).toBeLessThan(firstWrite);
  });

  it('does not use the read-and-write-together helper here', () => {
    // `claimKeyIn` writes as it reads, which is safe only in a transaction
    // that reads nothing else. This one reads the coupon too.
    expect(body).not.toContain('claimKeyIn(');
  });
});

/**
 * The settling job posts three ledger entries and reads four documents to
 * decide what they should say — including the payment record, which is the only
 * thing allowed to answer "is the platform holding this order's money".
 *
 * That read was added after the transaction already existed, which is exactly
 * the circumstance the createOrder outage came out of: a read appended below
 * the writes, working perfectly for every order until one took the branch that
 * reached it. Same check, same reason.
 */
describe('settleDeliveredOrders transaction ordering', () => {
  const source = readFileSync('functions/src/orders/jobs.ts', 'utf8');
  const body = transactionBodyAfter(source, source.indexOf('export const settleDeliveredOrders'));

  it('does every read before its first write', () => {
    const firstWrite = Math.min(
      ...['tx.set(', 'tx.update(', 'tx.delete(']
        .map((token) => body.indexOf(token))
        .filter((index) => index !== -1),
    );

    const lastRead = body.lastIndexOf('tx.get(');

    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastRead).toBeGreaterThan(-1);
    expect(lastRead).toBeLessThan(firstWrite);
  });

  it('reads the payment record, not the order, to decide about online money', () => {
    // An order's `paymentStatus` is a denormalised copy that can lag the
    // provider's callback. Crediting a restaurant from it would eventually
    // credit one for money that never cleared.
    expect(body).toContain('isCapturedPayment(');
    expect(body).toContain('paths.payment(');
  });
});

/**
 * `updateOrderStatus` posts the same ledger entries when an order is completed
 * by hand, and it reads four documents to decide what they say.
 *
 * It used to read the platform-discount entry *after* writing the commission
 * one, which is illegal and would have thrown a bare INTERNAL — but only for an
 * order that had both a commission and a platform-funded discount, which is why
 * nothing noticed. That is the same shape of bug, in the same file, as the one
 * this whole test exists for.
 */
describe('updateOrderStatus transaction ordering', () => {
  const source = readFileSync('functions/src/orders/status.ts', 'utf8');
  const body = transactionBodyAfter(source, source.indexOf('export const updateOrderStatus'));

  it('does every read before its first write', () => {
    const firstWrite = Math.min(
      ...['tx.set(', 'tx.update(', 'tx.delete(', 'notifyIn(', 'auditIn(']
        .map((token) => body.indexOf(token))
        .filter((index) => index !== -1),
    );

    const lastRead = body.lastIndexOf('tx.get(');

    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastRead).toBeGreaterThan(-1);
    expect(lastRead).toBeLessThan(firstWrite);
  });

  it('posts the online takings too, so a hand-completed order still settles', () => {
    // Otherwise an order completed by an operator leaves the platform holding
    // the customer's money with nothing in the ledger saying it owes it.
    expect(body).toContain('LedgerEntryType.ONLINE_COLLECTED');
    expect(body).toContain('isCapturedPayment(');
  });
});
