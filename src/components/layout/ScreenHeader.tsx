'use client';

/**
 * The back control every secondary screen shares.
 *
 * "Secondary" means a screen somebody walks *into* — a restaurant, an order,
 * one item of Hesabım — as opposed to a bottom-bar destination, which already
 * has its own way out and would only get a second, redundant one here. Named
 * `ScreenHeader` rather than `PageHeader` on purpose: `src/components/panel/
 * ui.tsx` already exports a `PageHeader` for the admin/restaurant panels, and
 * the two are not interchangeable — this one carries a back control the panel
 * version has no use for, because the panel's sidebar never goes away.
 *
 * Where the button goes is not always the same place. Someone who reached a
 * restaurant from a search result should return to that search, filters and
 * all; someone who opened the same restaurant from a notification has no
 * search to return to. `router.back()` gives the first person exactly what
 * they want, for free — but calling it on the second person leaves the app or
 * lands nowhere, because they have no history of their own here. `fallbackHref`
 * is the honest answer for that second person: a fixed, sensible place — the
 * list this thing belongs to, or home — used only when there is nothing to go
 * back to. See `src/lib/navigationHistory.ts` for how that is told apart.
 *
 * `backHref` is the third case, and it exists for one situation: a screen the
 * person arrived at from OUTSIDE the app. The payment return pages are it — the
 * previous history entry is the bank's own page, so `router.back()` there sends
 * somebody back into a payment flow they have just finished. Given `backHref`,
 * the control is a plain link to a fixed place and never consults history at
 * all. Use `fallbackHref` everywhere else; a fixed destination throws away the
 * search results and filters somebody came in with.
 */

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import { hasInAppHistory } from '@/lib/navigationHistory';

export function ScreenHeader({
  title,
  subtitle,
  action,
  fallbackHref,
  backHref,
  className,
}: {
  /** Omit on a screen that draws its own heading nearby — this then renders
   *  just the back control, e.g. above a restaurant's cover photo. */
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  /** Where "back" lands when there is no in-app screen to return to. */
  fallbackHref: string;
  /**
   * Always go here, whatever the history says.
   *
   * Only for a screen reached from outside the app — see the note above. When
   * this is given, `fallbackHref` is unused and the two are the same value in
   * practice; both are still accepted so a call site cannot forget the
   * destination entirely.
   */
  backHref?: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();

  const goBack = () => {
    if (backHref) {
      router.push(backHref);
      return;
    }
    if (hasInAppHistory()) router.back();
    else router.push(fallbackHref);
  };

  return (
    <header className={cn('mb-4 flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-1.5">
        {/* 44px square, the minimum comfortable tap target — smaller than that
            and a back control on a phone is the thing people mis-tap. */}
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back')}
          className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
        >
          <ArrowLeft size={19} aria-hidden />
        </button>
        {title && (
          <div>
            <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
          </div>
        )}
      </div>
      {action}
    </header>
  );
}
