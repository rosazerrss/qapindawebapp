import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AppErrorCode } from '../shared/errors';

/**
 * The dictionaries, checked for the two mistakes that have actually shipped.
 *
 *  1. A key added to Azerbaijani and forgotten in the other two. `t()` falls
 *     back to Azerbaijani rather than showing the raw key, so this never
 *     crashes — it just quietly serves one language to somebody who chose
 *     another, which is the kind of bug nobody reports.
 *  2. A single-brace placeholder. Interpolation is `{{param}}`; `{param}`
 *     renders literally, and a customer has been shown "{name}" on screen
 *     because of it.
 */

type Dictionary = { [key: string]: string | Dictionary };

const LOCALES = ['az', 'en', 'ru'] as const;

function load(locale: string): Dictionary {
  return JSON.parse(
    readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
  ) as Dictionary;
}

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`, the way `t()` addresses it. */
function flatten(dictionary: Dictionary, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }

  return out;
}

const dictionaries = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(load(locale))]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

describe('translations', () => {
  it('reads a real dictionary rather than passing on an empty one', () => {
    expect(Object.keys(dictionaries.az).length).toBeGreaterThan(500);
  });

  it.each(['en', 'ru'] as const)('has every Azerbaijani key in %s', (locale) => {
    const missing = Object.keys(dictionaries.az).filter((key) => !(key in dictionaries[locale]));
    expect(missing).toEqual([]);
  });

  it.each(['en', 'ru'] as const)('has no key in %s that Azerbaijani lacks', (locale) => {
    const extra = Object.keys(dictionaries[locale]).filter((key) => !(key in dictionaries.az));
    expect(extra).toEqual([]);
  });

  it.each(LOCALES)('uses double braces for every placeholder in %s', (locale) => {
    // A lone `{` — one not part of a `{{` pair — is a placeholder that will be
    // rendered to the reader verbatim.
    const lone = /(^|[^{])\{(?!\{)/;

    const offenders = Object.entries(dictionaries[locale])
      .filter(([, value]) => lone.test(value))
      .map(([key, value]) => `${key}: ${value}`);

    expect(offenders).toEqual([]);
  });

  /**
   * Every code a callable can throw needs a sentence.
   *
   * `translateError` falls back to the generic failure message for anything it
   * has no entry for, which stops "errors.INTERNAL" reaching a screen — but a
   * generic message is still the wrong thing to show somebody whose refund
   * failed because the payment does not exist. Four codes were reaching the
   * admin panel that way.
   */
  it.each(LOCALES)('has a sentence for every error code in %s', (locale) => {
    const missing = Object.values(AppErrorCode).filter(
      (code) => !(`errors.${code}` in dictionaries[locale]),
    );
    expect(missing).toEqual([]);
  });

  it('carries the reset dialog in all three languages', () => {
    // The screen this brief added, spot-checked by name so that a future
    // translation pass cannot drop it silently.
    for (const locale of LOCALES) {
      expect(dictionaries[locale]['admin.resetOpen']).toBeTruthy();
      expect(dictionaries[locale]['admin.resetTypeName']).toContain('{{name}}');
      expect(dictionaries[locale]['resetScope.ORDERS']).toBeTruthy();
      expect(dictionaries[locale]['resetCollection.auditLogs']).toBeTruthy();
      expect(dictionaries[locale]['errors.RESET_NOT_ENABLED']).toBeTruthy();
      expect(dictionaries[locale]['errors.RESET_CONFIRMATION_MISMATCH']).toBeTruthy();
    }
  });
});

/**
 * EVERY KEY A SCREEN ASKS FOR ACTUALLY EXISTS.
 *
 * The bug that produced this test shipped to a customer's telephone: a rename
 * with `sed` changed a function's name and, in the same sweep, the translation
 * key beside it — so the button in the address sheet read, literally,
 * `address.switchToOwnNumber`. Every check in this file passed. The
 * dictionaries were complete and consistent with each other; they simply did
 * not contain the key the code was asking for, and nothing was comparing the
 * two.
 *
 * `t()` has no fallback for a missing key — it returns the key — so this is
 * always visible to the user, and it is always ugly.
 *
 * Only plain string literals are checked. A key built from a template literal
 * (`t(`order.status.${status}`)`) cannot be resolved without running the code,
 * and pretending otherwise would either fail constantly or check nothing.
 */
describe('every key the app asks for is in the dictionary', () => {
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk('src');

  it('finds the screens at all', () => {
    // Guards against the walk matching nothing and the check below passing for
    // the wrong reason.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no key used in code that the dictionary lacks', () => {
    const used = new Map<string, string>();

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // `t('a.b')` and `t('a.b', { … })`, single or double quoted. Template
      // literals are deliberately not matched.
      for (const match of source.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) {
        used.set(match[1], file);
      }
    }

    const missing = [...used.entries()]
      .filter(([key]) => !(key in dictionaries.az))
      .map(([key, file]) => `${key} (${file})`);

    expect(missing).toEqual([]);
  });
});
