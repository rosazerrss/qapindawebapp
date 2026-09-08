import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  PaymentState,
  canMovePayment,
  orderPaymentStatusFor,
  TERMINAL_PAYMENT_STATES,
} from '../shared/payments';
import { decodePayload, verifySignature } from '../functions/src/payments/epoint';

/**
 * These are the tests that can be written without Epoint credentials.
 *
 * They cover the two things that decide whether money is real: the state
 * machine that refuses to let a payment move backwards, and the signature check
 * that separates "the bank said so" from "somebody POSTed to our URL". What
 * they cannot cover is a live transaction — that needs a merchant account, and
 * a test claiming otherwise would be a lie about the most expensive part of the
 * system.
 */

describe('payment state machine', () => {
  it('lets a fresh attempt reach the bank and come back either way', () => {
    expect(canMovePayment(PaymentState.CREATED, PaymentState.PENDING)).toBe(true);
    expect(canMovePayment(PaymentState.PENDING, PaymentState.PAID)).toBe(true);
    expect(canMovePayment(PaymentState.PENDING, PaymentState.FAILED)).toBe(true);
    expect(canMovePayment(PaymentState.PENDING, PaymentState.CANCELLED)).toBe(true);
  });

  it('refuses to confirm the same payment twice', () => {
    // The provider answering twice is normal. The second answer must change
    // nothing, or one order gets credited two payments.
    expect(canMovePayment(PaymentState.PAID, PaymentState.PAID)).toBe(false);
  });

  it('never walks a confirmed payment back to pending or failed', () => {
    expect(canMovePayment(PaymentState.PAID, PaymentState.PENDING)).toBe(false);
    expect(canMovePayment(PaymentState.PAID, PaymentState.FAILED)).toBe(false);
    expect(canMovePayment(PaymentState.PAID, PaymentState.EXPIRED)).toBe(false);
  });

  it('lets confirmed money go back out, and only that way', () => {
    expect(canMovePayment(PaymentState.PAID, PaymentState.REFUND_PENDING)).toBe(true);
    expect(canMovePayment(PaymentState.REFUND_PENDING, PaymentState.REFUNDED)).toBe(true);
    // A refund the provider refuses leaves the money where it was.
    expect(canMovePayment(PaymentState.REFUND_PENDING, PaymentState.PAID)).toBe(true);
  });

  it('cannot resurrect a failed, cancelled or expired attempt', () => {
    for (const dead of [PaymentState.FAILED, PaymentState.CANCELLED, PaymentState.EXPIRED]) {
      expect(canMovePayment(dead, PaymentState.PAID)).toBe(false);
      expect(canMovePayment(dead, PaymentState.PENDING)).toBe(false);
    }
  });

  it('treats a late callback on an expired attempt as illegal', () => {
    // The sweeper gave up; the customer has moved on or paid again. Accepting
    // the late answer would mark an order paid that nobody is watching.
    expect(canMovePayment(PaymentState.EXPIRED, PaymentState.PAID)).toBe(false);
  });

  it('leaves every terminal state with nowhere to go', () => {
    for (const state of TERMINAL_PAYMENT_STATES) {
      for (const target of Object.values(PaymentState)) {
        expect(canMovePayment(state, target)).toBe(false);
      }
    }
  });

  it('maps states onto the order without inventing a paid order', () => {
    expect(orderPaymentStatusFor(PaymentState.PAID)).toBe('PAID');
    expect(orderPaymentStatusFor(PaymentState.CREATED)).toBe('PENDING');
    expect(orderPaymentStatusFor(PaymentState.PENDING)).toBe('PENDING');
    expect(orderPaymentStatusFor(PaymentState.FAILED)).toBe('FAILED');
  });
});

describe('epoint callback signature', () => {
  // Not a real key — the algorithm is what is under test, not the credential.
  const KEY = 'test-private-key';
  const payload = { order_id: 'p1', status: 'success', amount: '20.00' };
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  /** The provider's own recipe: base64(sha1(key + data + key)). */
  const validSignature = () => {
    return createHash('sha1').update(`${KEY}${data}${KEY}`).digest('base64');
  };

  it('accepts a callback signed with the key', () => {
    expect(verifySignature(KEY, data, validSignature())).toBe(true);
  });

  it('rejects one signed with a different key', () => {
    // This is the whole attack: anybody can POST to the callback URL. Only
    // somebody holding the key can produce a signature that survives this.
    const forged = createHash('sha1').update(`wrong${data}wrong`).digest('base64');
    expect(verifySignature(KEY, data, forged)).toBe(false);
  });

  it('rejects an empty or missing signature', () => {
    expect(verifySignature(KEY, data, '')).toBe(false);
    expect(verifySignature(KEY, data, undefined as unknown as string)).toBe(false);
  });

  it('rejects a payload that was edited after signing', () => {
    const tampered = Buffer.from(
      JSON.stringify({ ...payload, amount: '2000.00' }),
      'utf8',
    ).toString('base64');
    expect(verifySignature(KEY, tampered, validSignature())).toBe(false);
  });

  it('reads a well-formed payload and refuses a malformed one', () => {
    expect(decodePayload(data)).toMatchObject({ order_id: 'p1', status: 'success' });
    expect(decodePayload('not-base64-at-all!!')).toBeNull();
    expect(decodePayload(Buffer.from('[1,2,3]').toString('base64'))).toBeNull();
  });
});
