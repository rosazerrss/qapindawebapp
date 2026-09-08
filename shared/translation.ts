/**
 * QAPINDA — Machine translation of support messages.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY THERE IS A BUTTON AND NOT AN AUTOMATIC TRANSLATION
 * ------------------------------------------------------
 * Baku support is answered in three languages and a restaurant owner writing
 * in Russian to an operator who reads Azerbaijani is an ordinary Tuesday. The
 * obvious build is to translate every message on arrival and show everyone
 * their own language. That is the wrong build, for two reasons.
 *
 * The first is money and waste: every message would be translated into two
 * languages nobody asked for, forever, including the ones that were already in
 * the right language. The second matters more. A support thread is the record
 * of a commercial dispute — a refund, a commission, who said what about an
 * invoice — and a machine translation silently replacing what somebody wrote
 * turns the record into an approximation of the record. So the original is
 * always what is stored and always what is shown by default, translation is
 * asked for, and the translated text is labelled as a machine translation
 * every time it is shown.
 *
 * WHY THE RESULT IS CACHED ON THE MESSAGE
 * ---------------------------------------
 * A ticket is read many times: the customer re-opens it, the operator comes
 * back after ringing the restaurant, the admin reads the whole thread when it
 * is escalated. Translating the same forty words on each of those is paying
 * repeatedly for an answer that cannot change — the message is immutable. So
 * the first person to ask pays for it and everybody after them reads the
 * cache, which is written by the server, on the message, keyed by language.
 */

/** The languages the interface speaks, and therefore the only targets. */
export const TRANSLATABLE_LOCALES = ['az', 'ru', 'en'] as const;
export type TranslatableLocale = (typeof TRANSLATABLE_LOCALES)[number];

export function isTranslatableLocale(value: unknown): value is TranslatableLocale {
  return (
    typeof value === 'string' && (TRANSLATABLE_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * One cached translation of one message.
 *
 * `sourceLanguage` is what the detector said, not what anybody declared. It is
 * kept because it is the answer to "why did this not translate?" — a message
 * detected as Azerbaijani and asked for in Azerbaijani comes back untouched,
 * and without this field that looks like a broken button.
 */
export interface MessageTranslation {
  /** The translated words. Empty when `same` is true — there is nothing to show. */
  text: string;
  /** What the message was detected to be written in. `null` when unknown. */
  sourceLanguage: string | null;
  /** True when the message was already in the requested language. */
  same: boolean;
}

/**
 * The cap on a message the platform will pay to translate.
 *
 * The composer already stops at 2000 characters, so this can only be reached
 * by a message written before that cap existed or by one assembled from
 * templates. It is here so a single pathological document cannot turn one
 * click into a bill.
 */
export const MAX_TRANSLATABLE_CHARS = 2000;

/**
 * How many messages one "translate the whole thread" press may cost.
 *
 * A thread longer than this is translated in the visible order and stops; the
 * reader presses again for the rest. The alternative — an unbounded loop
 * behind one click — is how a support screen quietly spends money on a
 * hundred-message migrated conversation nobody is reading.
 */
export const MAX_BULK_TRANSLATIONS = 25;

/**
 * Is this message worth offering a translation for?
 *
 * Photographs do not translate and an empty body has nothing to translate, so
 * the button is not drawn — an inert control teaches a reader to stop trusting
 * the controls next to it.
 */
export function isTranslatable(message: { body?: string | null }): boolean {
  const body = (message.body ?? '').trim();
  return body.length > 0 && body.length <= MAX_TRANSLATABLE_CHARS;
}

/**
 * The cached translation for this viewer's language, if the server has one.
 *
 * Reads the map defensively: every message written before translation existed
 * has no such field, and a missing field is not an error.
 */
export function cachedTranslation(
  message: { translations?: Record<string, MessageTranslation> | null },
  locale: TranslatableLocale,
): MessageTranslation | null {
  return message.translations?.[locale] ?? null;
}
