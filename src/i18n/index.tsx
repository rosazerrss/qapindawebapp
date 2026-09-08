'use client';

/**
 * Translation.
 *
 * A tiny dictionary lookup with `{{param}}` substitution — no library, because
 * the whole need is "look up a dotted key, fill in a name". Missing keys fall
 * back to Azerbaijani rather than showing the raw key to a customer.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import az from './translations/az.json';
import ru from './translations/ru.json';
import en from './translations/en.json';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@/shared/enums';

type Dictionary = Record<string, unknown>;

const DICTIONARIES: Record<SupportedLocale, Dictionary> = { az, ru, en };

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  az: 'Azərbaycanca',
  ru: 'Русский',
  en: 'English',
};

const LOCALE_COOKIE = 'qapinda_locale';

function lookup(dictionary: Dictionary, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Dictionary)[part];
    return undefined;
  }, dictionary);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match,
  );
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface LocaleValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translate;
}

const LocaleContext = createContext<LocaleValue | null>(null);

function readCookieLocale(): SupportedLocale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  const value = match?.[1] as SupportedLocale | undefined;
  return value && SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: SupportedLocale;
}) {
  // Read the cookie once during initialisation rather than in an effect, so the
  // first paint is already in the right language.
  const [locale, setLocaleState] = useState<SupportedLocale>(
    () => initialLocale ?? readCookieLocale(),
  );

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    if (typeof document !== 'undefined') {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
    }
  }, []);

  const t = useCallback<Translate>(
    (key, params) => {
      const value =
        lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key) ?? key;
      return interpolate(value, params);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}

/** Just the translate function, for components that do not switch language. */
export function useT(): Translate {
  return useLocale().t;
}

/**
 * Turns an error code from a callable into a sentence the customer can read.
 *
 * The code is not always one of ours. When a function crashes rather than
 * failing deliberately, Firebase throws its own `internal`, and `call()` in
 * `firebase/callables.ts` has nothing better to pass along than that word. With
 * no dictionary entry for it, `t` used to hand back the key it was given, so
 * the screen showed the user "errors.internal" — which is how the admin panel
 * came to display ERRORINTERNAL. A raw key on screen is worse than useless: it
 * tells the person nothing and hides from us that a function is crashing.
 *
 * So anything we do not have a sentence for becomes the generic failure
 * message. The specific code still reaches the console for whoever is
 * debugging, because losing it entirely would trade one blindness for another.
 */
export function translateError(
  t: Translate,
  code: string | null,
  detail?: string | null,
): string {
  if (!code) return '';

  const key = `errors.${code}`;
  const params = detail ? { detail } : undefined;

  if (lookup(DICTIONARIES[DEFAULT_LOCALE], key) !== undefined) return t(key, params);

  if (typeof console !== 'undefined') {
    console.warn('[qapinda] untranslated error code', { code, detail });
  }
  return t('errors.INTERNAL');
}
