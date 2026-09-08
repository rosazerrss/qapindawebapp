import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { FAQ_GROUPS, faqKeys, faqMatches, faqQuestionIds } from '../shared/faq';

/**
 * The FAQ, checked against the three dictionaries it is written in.
 *
 * The house rule is that every user-visible string goes into az, en AND ru, and
 * the way that rule is normally broken is a question added to `shared/faq.ts`
 * with an Azerbaijani answer and nothing else — which renders as a raw key like
 * `faq.q.refundTime.a` in front of a Russian-speaking customer. That is not a
 * crash, so nothing else notices it. This does.
 *
 * The interpolation check is here for the same reason: `{{param}}` is the
 * syntax, single braces render literally, and a `{days}` has shipped as a
 * visible bug in this codebase before.
 */

const LOCALES = ['az', 'en', 'ru'] as const;

const DICTIONARIES = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(`src/i18n/translations/${locale}.json`, 'utf8')) as Record<
      string,
      unknown
    >,
  ]),
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

function lookup(dictionary: Record<string, unknown>, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, dictionary);
  return typeof value === 'string' ? value : undefined;
}

describe('the FAQ', () => {
  it('has no duplicate question ids', () => {
    const ids = faqQuestionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts every question and answer in all three languages', () => {
    const missing: string[] = [];

    for (const locale of LOCALES) {
      for (const group of FAQ_GROUPS) {
        if (!lookup(DICTIONARIES[locale], `faq.group.${group.id}`)) {
          missing.push(`${locale}: faq.group.${group.id}`);
        }
      }
      for (const id of faqQuestionIds()) {
        const keys = faqKeys(id);
        if (!lookup(DICTIONARIES[locale], keys.question)) missing.push(`${locale}: ${keys.question}`);
        if (!lookup(DICTIONARIES[locale], keys.answer)) missing.push(`${locale}: ${keys.answer}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('answers the questions the owner actually asked', () => {
    // Not decoration: these four are the ones the brief names, and each of them
    // is a promise the code has to keep. A future edit that quietly drops "the
    // restaurants deliver with their own couriers" fails here.
    const ids = faqQuestionIds();
    expect(ids).toContain('whoDelivers');
    expect(ids).toContain('cancelOrder');
    expect(ids).toContain('deliveryRadius');
    expect(ids).toContain('refundTime');

    // And the cancellation answer names the real window, not a vaguer one.
    expect(lookup(DICTIONARIES.az, 'faq.q.cancelOrder.a')).toContain('3 dəqiqə');
  });

  it('never writes an interpolation with single braces', () => {
    // `{{name}}` is the syntax; `{name}` renders literally and has shipped.
    const single = /(^|[^{])\{[a-zA-Z]\w*\}/;
    const offenders: string[] = [];

    for (const locale of LOCALES) {
      for (const id of faqQuestionIds()) {
        const keys = faqKeys(id);
        for (const key of [keys.question, keys.answer]) {
          const text = lookup(DICTIONARIES[locale], key);
          if (text && single.test(text)) offenders.push(`${locale}: ${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('searching the FAQ', () => {
  it('finds a question however the person spells the Azerbaijani letters', () => {
    // "sifariş" typed in a hurry is "sifaris", and a search that answers that
    // with nothing reads as "there is no answer to this".
    expect(faqMatches('sifaris', 'Necə sifariş verə bilərəm?', '')).toBe(true);
    expect(faqMatches('SİFARİŞ', 'Necə sifariş verə bilərəm?', '')).toBe(true);
  });

  it('matches the answer as well as the question', () => {
    expect(faqMatches('kuryer', 'Sifarişi kim çatdırır?', 'Restoranın öz kuryeri.')).toBe(true);
  });

  it('shows everything when nothing has been typed', () => {
    expect(faqMatches('   ', 'anything', 'anything')).toBe(true);
  });

  it('does not match a word that is in neither', () => {
    expect(faqMatches('velosiped', 'Necə sifariş verə bilərəm?', 'Səbətdən.')).toBe(false);
  });
});
