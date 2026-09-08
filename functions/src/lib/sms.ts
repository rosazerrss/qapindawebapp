/**
 * QAPINDA — Sending one SMS.
 *
 * WHY THIS IS ONE FILE WITH ONE FUNCTION IN IT
 * --------------------------------------------
 * Everything else about verifying a telephone number — generating the code,
 * hashing it, the attempt limits, the daily cap, what the screens say — is
 * written and tested and does not care who carries the message. This is the
 * only part that does.
 *
 * So the provider is a seam, and a deliberately small one. Choosing a gateway
 * means filling in `deliver` below and putting two values in `functions/.env`.
 * Nothing above this file changes, and nothing above it knows the difference.
 *
 * WHY NOT TWILIO
 * --------------
 * Twilio's published rate to Azerbaijan is $0.411 per message segment — around
 * 0.70 AZN — which is what international carriers charge to terminate on
 * Azercell, Bakcell and Nar. A local gateway is an order of magnitude below
 * that and is the only sensible answer for a platform whose customers are all
 * in one country. The adapter exists so that this decision is reversible, not
 * because it is in doubt.
 *
 * WHAT HAPPENS BEFORE THE GATEWAY IS CONFIGURED
 * ---------------------------------------------
 * `SMS_NOT_CONFIGURED`, and the screen says so in words: "we cannot send the
 * code right now". It does NOT pretend to succeed. A verification flow that
 * silently accepts an unverifiable number would put a wrong telephone on a
 * delivery and the failure would surface at somebody's door, days later, as a
 * courier ringing a stranger.
 *
 * THE CODE IS NEVER LOGGED
 * ------------------------
 * Not at any level, not in development. A verification code in a log is a
 * verification code in whatever reads the logs, and Cloud Logging is readable
 * by every project member. The functions below log that a message was sent and
 * to which operator, never what it said.
 */

import { logger } from 'firebase-functions/v2';

/** How long the platform waits for the gateway before giving up. */
const TIMEOUT_MS = 10_000;

export type SmsResult =
  | { ok: true; providerId: string | null }
  /** The gateway is not set up. A configuration answer, not a failure. */
  | { ok: false; reason: 'NOT_CONFIGURED' }
  /** The gateway refused, timed out, or answered with something unusable. */
  | { ok: false; reason: 'FAILED' };

/** True when a gateway has been configured at all. */
export function smsConfigured(): boolean {
  return Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY);
}

/**
 * Hands one message to the gateway.
 *
 * THE SHAPE BELOW IS THE COMMON ONE AND MAY NOT BE YOURS.
 * ------------------------------------------------------
 * Azerbaijani gateways almost all expose a JSON or form POST taking a key, a
 * sender name, a number and a body, and answer with a message id. This sends
 * that. When the provider is chosen, check their document against these four
 * lines and change them — that is the whole integration.
 *
 *   SMS_API_URL     the endpoint they give you
 *   SMS_API_KEY     the key or token
 *   SMS_SENDER      the registered sender name, e.g. QAPINDA
 *
 * The sender name is the part with a lead time: an alphanumeric sender has to
 * be registered with the operators before anything can be sent under it, and
 * that takes days rather than minutes. Start it before the code is needed.
 */
export async function sendSms(input: { to: string; body: string }): Promise<SmsResult> {
  const url = process.env.SMS_API_URL;
  const key = process.env.SMS_API_KEY;
  const sender = process.env.SMS_SENDER ?? 'QAPINDA';

  if (!url || !key) {
    logger.warn('sms: gateway not configured');
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        // Most local gateways want the number without the leading `+`.
        to: input.to.replace(/^\+/, ''),
        from: sender,
        text: input.body,
      }),
    });

    if (!response.ok) {
      // The status and nothing else. A gateway's error body frequently echoes
      // the message it refused, and the message contains the code.
      logger.error('sms: gateway refused', { status: response.status });
      return { ok: false, reason: 'FAILED' };
    }

    /*
     * The message id, when the gateway gives one.
     *
     * Read defensively and never required: gateways disagree about what to
     * call it and some answer with plain text. It is kept only so a delivery
     * complaint can be traced back to a specific send, so a missing one is not
     * worth failing a message that has already gone.
     */
    const payload = (await response.json().catch(() => null)) as
      | { messageId?: string; id?: string; message_id?: string }
      | null;

    const providerId = payload?.messageId ?? payload?.id ?? payload?.message_id ?? null;

    logger.info('sms: sent', { providerId });
    return { ok: true, providerId };
  } catch (error) {
    // The error object only — a thrown request can carry the body with it.
    logger.error('sms: send failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return { ok: false, reason: 'FAILED' };
  } finally {
    clearTimeout(timer);
  }
}
