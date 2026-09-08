'use client';

/**
 * Cookie consent.
 *
 * Two buttons, not one: "essential only" has to be as easy to press as
 * "accept", or the consent is not freely given. Nothing beyond the strictly
 * necessary cookies is set before a choice is made.
 *
 * `useSyncExternalStore` reads localStorage without an effect, so the banner
 * does not flash in for people who already answered.
 */

import { useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';

import { useT } from '@/i18n';
import { Button, cn } from '@/components/ui';
import { POPOVER_SURFACE } from '@/components/ui/overlay';

const KEY = 'qapinda_cookie_consent';

let listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function snapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked: treat as undecided but never crash the page.
    return null;
  }
}

/** The server has no storage; rendering "already decided" avoids a flash. */
function serverSnapshot(): string | null {
  return 'unknown';
}

function decide(value: 'all' | 'essential') {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Nothing to do — the banner will simply come back next visit.
  }
  for (const listener of listeners) listener();
}

export function CookieConsent() {
  const t = useT();
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const acceptAll = useCallback(() => decide('all'), []);
  const essentialOnly = useCallback(() => decide('essential'), []);

  if (value !== null) return null;

  return (
    /*
      Sits ABOVE the mobile tab bar, not on top of it.

      `bottom-0` put this banner over the fixed bottom navigation, so on a
      telephone the five primary destinations of the whole app were unreachable
      until the banner was dismissed — and the banner is the first thing a new
      visitor sees. `bottom-20` clears the bar; on `sm:` and up there is no bar
      to clear.
    */
    <div className="fixed inset-x-0 bottom-20 z-40 px-3 pb-3 sm:bottom-0 sm:px-4 sm:pb-4">
      <div className={cn('mx-auto max-w-3xl rounded-2xl p-4', POPOVER_SURFACE)}>
        <p className="text-sm text-ink-700">
          {t('legal.cookieBanner')}{' '}
          <Link href="/legal/cookies" className="text-brand-600 underline">
            {t('legal.cookies')}
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={acceptAll}>
            {t('legal.cookieAccept')}
          </Button>
          <Button size="sm" variant="secondary" onClick={essentialOnly}>
            {t('legal.cookieEssentialOnly')}
          </Button>
        </div>
      </div>
    </div>
  );
}
