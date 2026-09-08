/**
 * QAPINDA — Translating a support message.
 *
 * WHY THE BROWSER NEVER TALKS TO THE TRANSLATION API
 * ---------------------------------------------------
 * The same rule the payment code lives by. Anything the browser can call, the
 * browser can be made to call a million times by somebody who is not a
 * customer — and a translation API bills by the character. So the client asks
 * *this* callable for "the translation of message X of ticket Y", and the
 * callable decides. It answers only for a ticket the caller may already read,
 * which is checked with `supportAccess` — the same predicate the rest of
 * support uses, so the lane rules and the two-week retention rule apply here
 * without being written a second time and without being able to drift.
 *
 * There is no API key anywhere in this file. The function authenticates to
 * Google with its own service account through Application Default Credentials,
 * which means the credential is never a string that could be committed, leaked
 * in a bundle, or read out of a browser.
 *
 * THE CACHE IS THE POINT
 * ----------------------
 * A support message is immutable once written, so its translation is too. The
 * first person to ask for it pays; it is written onto the message document
 * under `translations.<language>`, and everyone after them — the operator who
 * comes back, the admin who reads the whole thread on escalation, the same
 * person re-opening the ticket tomorrow — reads it for free. Without this, an
 * escalated ten-message thread read by three people is thirty translations of
 * ten messages.
 *
 * The cache is written by the admin SDK, which bypasses the security rules, so
 * `firestore.rules` can keep messages read-only to every client. Nobody can
 * write themselves a translation that says something the original did not.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * -----------------------------
 * The original is never replaced, never overwritten, and never hidden by
 * default. A support thread is the record of a commercial dispute — who
 * promised what refund, what a restaurant said about an invoice — and a
 * machine translation standing in for the record is not the record. The
 * translation is an aid to reading it, labelled as machine output every time
 * it is shown, and one tap away from the words that were actually typed.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { GoogleAuth } from 'google-auth-library';

import { db, FieldValue } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { paths } from '../shared/collections';
import { supportAccess, type SupportTicketRef, type SupportViewer } from '../shared/supportState';
import {
  MAX_TRANSLATABLE_CHARS,
  isTranslatableLocale,
  type MessageTranslation,
  type TranslatableLocale,
} from '../shared/translation';
import type { SupportMessage, SupportTicket } from '../shared/models';

/**
 * One auth client for the life of the container.
 *
 * `getAccessToken` caches the token internally and refreshes it before it
 * expires, so this costs one metadata round trip per hour rather than one per
 * translated message.
 */
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/** Cloud Translation, Basic edition. The one that detects the source for us. */
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

/**
 * How long the platform will wait for a translation.
 *
 * Short on purpose. The reader is looking at a spinner on a chat bubble; a
 * translation that takes eight seconds has already failed at its job, and
 * holding the callable open costs a function instance the whole time.
 */
const TIMEOUT_MS = 8_000;

interface TranslateResponse {
  data?: {
    translations?: Array<{ translatedText?: string; detectedSourceLanguage?: string }>;
  };
  error?: { message?: string; status?: string };
}

/**
 * Asks Google for the translation. Returns `null` when the service is not
 * usable at all, which the caller turns into TRANSLATION_UNAVAILABLE.
 *
 * The distinction matters: "the API is not enabled on this project" is a
 * configuration answer the owner can act on, and it must not reach an operator
 * as an internal error about a system that is otherwise working.
 */
async function translateText(
  text: string,
  target: TranslatableLocale,
): Promise<{ text: string; sourceLanguage: string | null } | null> {
  let token: string | null | undefined;

  try {
    token = await auth.getAccessToken();
  } catch (error) {
    logger.error('translation: no credential', error);
    return null;
  }

  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        target,
        // The message is plain text typed by a person. Asking for `text`
        // rather than the default `html` stops the API escaping apostrophes
        // into `&#39;` — which is what makes a machine translation look like
        // a bug rather than a translation.
        format: 'text',
      }),
    });

    const payload = (await response.json()) as TranslateResponse;

    if (!response.ok) {
      logger.error('translation: rejected', {
        status: response.status,
        message: payload.error?.message,
      });
      return null;
    }

    const first = payload.data?.translations?.[0];
    if (!first?.translatedText) return null;

    return {
      text: first.translatedText,
      sourceLanguage: first.detectedSourceLanguage ?? null,
    };
  } catch (error) {
    logger.error('translation: failed', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The slice of a ticket the shared predicates read. Mirrors `chat.ts`. */
function refOf(ticket: SupportTicket): SupportTicketRef {
  return {
    lane: ticket.lane,
    status: ticket.status,
    customerId: ticket.customerId,
    restaurantId: ticket.restaurantId,
    closedAtMs: ticket.closedAt?.toMillis?.() ?? null,
  };
}

/**
 * Translate one message of one ticket into the caller's language.
 *
 * Idempotent and cheap on repeat: a message already translated into the
 * requested language is served from the document without touching the API.
 */
export const translateSupportMessage = onCall(
  guard('translateSupportMessage', async (request) => {
    const { caller } = await requireActiveUser(request);

    const input = asObject(request.data);
    const ticketId = requireString(input, 'ticketId', { max: 200 });
    const messageId = requireString(input, 'messageId', { max: 200 });
    const target = input.target;

    if (!isTranslatableLocale(target)) fail(AppErrorCode.VALIDATION_FAILED, 'target');

    // Access first, always. Everything below this line assumes the caller is
    // entitled to read this conversation, and that entitlement is decided by
    // the same function the client and the chat callables use.
    const ticketSnapshot = await db.doc(paths.supportTicket(ticketId)).get();
    if (!ticketSnapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

    const ticket = ticketSnapshot.data() as SupportTicket;
    const viewer: SupportViewer = {
      role: caller.role,
      uid: caller.uid,
      restaurantId: caller.restaurantId,
    };
    if (!supportAccess(viewer, refOf(ticket)).read) fail(AppErrorCode.TICKET_NOT_FOUND);

    const messageRef = db.doc(`${paths.supportTicketMessages(ticketId)}/${messageId}`);
    const messageSnapshot = await messageRef.get();
    if (!messageSnapshot.exists) fail(AppErrorCode.MESSAGE_NOT_FOUND);

    const message = messageSnapshot.data() as SupportMessage;

    // Served from the cache when somebody has already asked. This is the
    // common path once a thread has been read twice.
    const cached = (message.translations ?? {})[target] as MessageTranslation | undefined;
    if (cached) return { ok: true as const, translation: cached, cached: true };

    const body = (message.body ?? '').trim();
    if (!body || body.length > MAX_TRANSLATABLE_CHARS) {
      fail(AppErrorCode.NOTHING_TO_TRANSLATE);
    }

    const result = await translateText(body, target);
    if (!result) fail(AppErrorCode.TRANSLATION_UNAVAILABLE);

    /*
     * A message already in the reader's language.
     *
     * The API still returns text — usually the original, sometimes a
     * needlessly reworded version of it — and showing that as "the
     * translation" is how a reader concludes the feature is broken. So the
     * answer is recorded as `same`, with no text, and the screen says the
     * message is already in their language. It is cached exactly like a real
     * translation, so the second press costs nothing either.
     */
    const same = result.sourceLanguage === target;

    const translation: MessageTranslation = {
      text: same ? '' : result.text,
      sourceLanguage: result.sourceLanguage,
      same,
    };

    // Written with dotted-path merge so two people translating the same
    // message into two languages at the same moment cannot overwrite each
    // other's field, and so the original message can never be touched by this
    // write no matter what else is in the document.
    await messageRef.update({
      [`translations.${target}`]: translation,
      translatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true as const, translation, cached: false };
  }),
);
