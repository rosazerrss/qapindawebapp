import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  MAX_BULK_TRANSLATIONS,
  MAX_TRANSLATABLE_CHARS,
  TRANSLATABLE_LOCALES,
  cachedTranslation,
  isTranslatable,
  isTranslatableLocale,
} from '../shared/translation';
import { SUPPORTED_LOCALES } from '../shared/enums';

/**
 * TRANSLATION, AND THE THINGS ABOUT IT THAT MUST NOT DRIFT.
 *
 * The interesting failures here are not arithmetic. They are: a target
 * language the interface offers but translation does not, a picture-only
 * message growing a button that cannot do anything, and — the one that would
 * matter in a dispute — a client being able to write the translation cache and
 * therefore able to put words in somebody else's bubble.
 */

describe('translation — the targets are the languages the app speaks', () => {
  /**
   * If a fourth language were added to the interface and not here, its
   * speakers would get a translate button that fails validation server-side.
   * A language the app offers is a language support can be read in.
   */
  it('offers exactly the interface locales', () => {
    expect([...TRANSLATABLE_LOCALES].sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('refuses anything else as a target', () => {
    expect(isTranslatableLocale('az')).toBe(true);
    expect(isTranslatableLocale('tr')).toBe(false);
    expect(isTranslatableLocale('')).toBe(false);
    expect(isTranslatableLocale(null)).toBe(false);
    // The API would happily accept this and bill for it.
    expect(isTranslatableLocale('en-GB')).toBe(false);
  });
});

describe('translation — what is worth offering a button for', () => {
  it('does not offer one for a message with no words', () => {
    expect(isTranslatable({ body: '' })).toBe(false);
    expect(isTranslatable({ body: '   ' })).toBe(false);
    // The picture-only message: photographs do not translate.
    expect(isTranslatable({})).toBe(false);
  });

  it('offers one for ordinary text', () => {
    expect(isTranslatable({ body: 'Sifariş gəlmədi' })).toBe(true);
  });

  /** One pathological document must not turn one click into a bill. */
  it('refuses a message longer than the platform will pay for', () => {
    expect(isTranslatable({ body: 'a'.repeat(MAX_TRANSLATABLE_CHARS) })).toBe(true);
    expect(isTranslatable({ body: 'a'.repeat(MAX_TRANSLATABLE_CHARS + 1) })).toBe(false);
  });

  /** The composer's own cap, so the button can never be the thing that fails. */
  it('is at least as large as the composer allows', () => {
    const chat = readFileSync('src/components/panel/Chat.tsx', 'utf8');
    const cap = Number(chat.match(/const MAX_BODY = (\d+)/)?.[1]);
    expect(cap).toBeGreaterThan(0);
    expect(MAX_TRANSLATABLE_CHARS).toBeGreaterThanOrEqual(cap);
  });

  /** One press is bounded. A migrated thread can be a hundred messages. */
  it('bounds a bulk translation', () => {
    expect(MAX_BULK_TRANSLATIONS).toBeGreaterThan(0);
    expect(MAX_BULK_TRANSLATIONS).toBeLessThanOrEqual(50);
  });
});

describe('translation — reading the cache is defensive', () => {
  /** Every message written before translation existed has no such field. */
  it('answers null for a message that has never been translated', () => {
    expect(cachedTranslation({}, 'ru')).toBeNull();
    expect(cachedTranslation({ translations: {} }, 'ru')).toBeNull();
    expect(cachedTranslation({ translations: null }, 'ru')).toBeNull();
  });

  it('answers the entry for the reader own language only', () => {
    const message = {
      translations: { ru: { text: 'Заказ не пришёл', sourceLanguage: 'az', same: false } },
    };
    expect(cachedTranslation(message, 'ru')?.text).toBe('Заказ не пришёл');
    expect(cachedTranslation(message, 'en')).toBeNull();
  });
});

describe('translation — the cache belongs to the server alone', () => {
  /**
   * The whole design rests on this line.
   *
   * The translation is stored on the message, and the message is what a
   * restaurant or a customer reads. If a client could write to it, a party to
   * a dispute could put any sentence they liked into the other side's bubble
   * and it would render labelled as a translation of what that person said.
   * The admin SDK bypasses these rules, so the callable writes it and nobody
   * else can.
   */
  it('leaves support messages read-only to every client', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const messages = rules.slice(rules.indexOf('match /messages/{messageId}'));
    const block = messages.slice(0, messages.indexOf('}\n    }'));
    expect(block).toContain('allow write: if false');
  });

  /** And no API key ever reaches the browser. */
  it('never puts a translation endpoint in the client bundle', () => {
    const callables = readFileSync('src/firebase/callables.ts', 'utf8');
    expect(callables).not.toContain('translation.googleapis.com');
    expect(callables).toContain("call<{ translation: MessageTranslation; cached: boolean }>");
  });
});
