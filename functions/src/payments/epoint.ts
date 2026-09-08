/**
 * QAPINDA — Epoint adapter.
 *
 * The only file in the system that knows what Epoint is. Everything above it
 * speaks the vocabulary in `shared/payments.ts`, so a second provider is a
 * second file like this one rather than a rewrite of checkout.
 *
 * HOW EPOINT WORKS, IN ONE PARAGRAPH
 * ----------------------------------
 * You base64 the JSON of your request, sign `private_key + that + private_key`
 * with SHA-1, base64 the digest, and POST both as `data` and `signature`. Epoint
 * answers with a URL to send the customer to. When the payment finishes, Epoint
 * POSTs the same `data`/`signature` pair back to a callback URL of yours, and
 * the signature is computed the same way — which is what makes it a statement
 * from Epoint rather than from whoever found the URL.
 *
 * WHY THE SIGNATURE CHECK IS THE WHOLE FILE'S POINT
 * ------------------------------------------------
 * The callback is a public HTTP endpoint. Anyone can POST to it. The only thing
 * separating "the bank confirmed this payment" from "a stranger typed a URL" is
 * that the signature was produced with a key only Epoint and this server hold.
 * So: the signature is verified before the payload is trusted for anything,
 * the comparison is constant-time, and an unsigned or badly-signed callback is
 * recorded and refused rather than quietly ignored.
 *
 * THE KEY NEVER LEAVES THE SERVER
 * -------------------------------
 * `EPOINT_PRIVATE_KEY` is read from the function's environment. It is never
 * sent to the browser, never written to a document, never logged — not even in
 * an error path, which is exactly where secrets usually escape.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import type { MinorUnits } from '../shared/models';

/** Epoint's own endpoint. Overridable for a sandbox without touching code. */
const API_BASE = process.env.EPOINT_API_BASE ?? 'https://epoint.az/api/1';

export interface EpointConfig {
  merchantId: string;
  privateKey: string;
  /** Where Epoint sends the customer back to. */
  successUrl: string;
  errorUrl: string;
  /** Where Epoint POSTs the result, server to server. */
  callbackUrl: string;
}

/**
 * Reads the configuration, or says plainly that it is missing.
 *
 * Returning null rather than throwing lets checkout hide the online-payment
 * option when the platform is not configured yet, instead of offering a button
 * that fails at the worst possible moment.
 */
export function epointConfig(): EpointConfig | null {
  const merchantId = process.env.EPOINT_MERCHANT_ID;
  const privateKey = process.env.EPOINT_PRIVATE_KEY;
  const baseUrl = process.env.PUBLIC_SITE_URL;

  if (!merchantId || !privateKey || !baseUrl) return null;

  return {
    merchantId,
    privateKey,
    successUrl: `${baseUrl}/checkout/success`,
    errorUrl: `${baseUrl}/checkout/failed`,
    callbackUrl: process.env.EPOINT_CALLBACK_URL ?? '',
  };
}

/** Epoint's signature: base64(sha1(key + base64(json) + key)), digest raw. */
function sign(privateKey: string, data: string): string {
  return createHash('sha1').update(`${privateKey}${data}${privateKey}`).digest('base64');
}

function encode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Checks a callback's signature without leaking timing.
 *
 * A plain `===` on a signature compares byte by byte and stops at the first
 * difference, which tells an attacker how much of their guess was right. It is
 * a real attack on a real endpoint, and the fix costs nothing.
 */
export function verifySignature(
  privateKey: string,
  data: string,
  signature: string,
): boolean {
  const expected = Buffer.from(sign(privateKey, data), 'utf8');
  const received = Buffer.from(signature ?? '', 'utf8');

  if (expected.length !== received.length || received.length === 0) return false;
  return timingSafeEqual(expected, received);
}

/** Decodes the base64 payload Epoint sends. Returns null on anything malformed. */
export function decodePayload(data: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(data, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface CreatedPayment {
  /** Where to send the customer. */
  redirectUrl: string;
  /** Epoint's own id for the transaction, when it gives one at creation. */
  transactionId: string | null;
}

/**
 * Asks Epoint to open a payment and hand back a URL for the customer.
 *
 * `amount` arrives in qəpik because that is how the whole system carries money;
 * Epoint wants manats with decimals, and this is the only place that conversion
 * is allowed to happen.
 */
export async function createEpointPayment(
  config: EpointConfig,
  input: {
    orderCode: string;
    paymentId: string;
    amount: MinorUnits;
    description: string;
  },
): Promise<CreatedPayment> {
  const payload = {
    public_key: config.merchantId,
    amount: (input.amount / 100).toFixed(2),
    currency: 'AZN',
    language: 'az',
    // Our own id travels there and comes back, which is how a callback is
    // matched to a payment without trusting anything else in the payload.
    order_id: input.paymentId,
    description: input.description,
    // The payment id rides along on the return URL so the page the customer
    // lands on knows what to ask the server about. It is not a secret and it
    // is not trusted: the page uses it to look up a record the server owns.
    success_redirect_url: `${config.successUrl}?payment=${encodeURIComponent(input.paymentId)}`,
    error_redirect_url: `${config.errorUrl}?payment=${encodeURIComponent(input.paymentId)}`,
  };

  const data = encode(payload);
  const signature = sign(config.privateKey, data);

  const response = await fetch(`${API_BASE}/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data, signature }).toString(),
  });

  if (!response.ok) {
    // Deliberately without the body: a provider's error page can echo back
    // parts of the request, and the request was signed with the private key.
    throw new Error(`epoint-http-${response.status}`);
  }

  const body = (await response.json()) as {
    status?: string;
    redirect_url?: string;
    transaction?: string;
    message?: string;
  };

  if (body.status !== 'success' || !body.redirect_url) {
    throw new Error(`epoint-refused-${body.status ?? 'unknown'}`);
  }

  return { redirectUrl: body.redirect_url, transactionId: body.transaction ?? null };
}

export interface EpointResult {
  /** Our payment id, echoed back. */
  paymentId: string | null;
  transactionId: string | null;
  bankTransactionId: string | null;
  /** Epoint's own word: 'success', 'failed', 'error'… kept verbatim. */
  status: string;
  /** In qəpik, converted back from the manats Epoint reports. */
  amount: MinorUnits | null;
  /**
   * The provider's own cut, in qəpik, when it reports one.
   *
   * Null when the callback does not carry it — which is not the same as zero.
   * The books need to be able to say "we do not know what Epoint kept on this
   * one" rather than quietly recording that it kept nothing, because the second
   * makes a reconciliation come out wrong with no sign of why.
   */
  fee: MinorUnits | null;
  currency: string | null;
  message: string | null;
}

/** Reads a verified callback payload into something the rest of the code knows. */
export function readResult(payload: Record<string, unknown>): EpointResult {
  const text = (key: string): string | null => {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const money = (value: unknown): number | null =>
    typeof value === 'string' || typeof value === 'number'
      ? Math.round(Number(value) * 100)
      : null;

  const amount = money(payload.amount);

  /*
   * Epoint's field for its own charge.
   *
   * Two spellings are read because the provider's documentation and its live
   * responses have used both, and a fee recorded as null when it was in fact
   * reported is a reconciliation that fails for no reason. Reading two keys
   * costs nothing; guessing wrong costs a monthly investigation.
   */
  const fee = money(payload.commission ?? payload.fee);

  return {
    paymentId: text('order_id'),
    transactionId: text('transaction'),
    bankTransactionId: text('bank_transaction'),
    /*
     * NORMALISED, and this is not cosmetic.
     *
     * The caller compares this to the literal `'success'`. Epoint's own
     * documentation and its live traffic have not always agreed on the case,
     * and a provider that answers `"SUCCESS"` — or `" success"` with the space
     * a proxy added — would be read as a FAILURE for a payment that was
     * actually taken. FAILED is terminal, so the order would die holding the
     * customer's money with no path back except a manual refund nobody knew to
     * make.
     *
     * Lower-cased and trimmed here, once, at the only place the provider's
     * words enter the system.
     */
    status: (text('status') ?? 'unknown').trim().toLowerCase(),
    amount: Number.isFinite(amount) ? amount : null,
    fee: Number.isFinite(fee) ? fee : null,
    currency: text('currency'),
    message: text('message'),
  };
}

/**
 * Asks Epoint to send money back.
 *
 * Partial refunds are supported by passing an amount; omitting it refunds the
 * lot. Either way the caller has already decided how much, and has already
 * written that decision down — this only carries it out.
 */
export async function refundEpointPayment(
  config: EpointConfig,
  input: { transactionId: string; amount: MinorUnits },
): Promise<{ status: string; message: string | null }> {
  const payload = {
    public_key: config.merchantId,
    transaction: input.transactionId,
    currency: 'AZN',
    amount: (input.amount / 100).toFixed(2),
  };

  const data = encode(payload);
  const signature = sign(config.privateKey, data);

  const response = await fetch(`${API_BASE}/reverse`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data, signature }).toString(),
  });

  if (!response.ok) throw new Error(`epoint-http-${response.status}`);

  const body = (await response.json()) as { status?: string; message?: string };
  return { status: body.status ?? 'unknown', message: body.message ?? null };
}
