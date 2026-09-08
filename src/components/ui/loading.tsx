'use client';

/**
 * Qapında's own loading system.
 *
 * Wolt, Uber Eats and Yemeksepeti each have a signature loading animation —
 * the exact thing a copycat marketplace gets accused of borrowing. So this
 * file avoids anything that moves in a distinctive way: no bouncing dots, no
 * travelling shimmer band. Every state here is the same calm brand-tinted
 * pulse the panel already uses for its tables, applied to the shapes the
 * customer app actually renders, so a screen never jumps when real data
 * replaces it.
 *
 * `InlineLoading` is the one export that duplicates something on purpose:
 * `Button`'s own `loading` prop already draws a spinner for the case "a click
 * is in flight", and stays the right tool for that. This file's inline state
 * is for the *other* small spot — a line of text answering while something
 * loads beside content that is already on screen (the "searching menus"
 * notice, a price box waiting on the server) — which is not a button and
 * should not turn into one just to get a spinner.
 */

import { Spinner, cn } from './index';
import { LogoMark } from '@/components/layout/Logo';
import { useT } from '@/i18n';

/** One skeleton block. Decorative — the region around it carries the label. */
function Bone({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded bg-ink-100', className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// InlineLoading — a line of text answering while something loads beside
// content that is already on screen. Not for buttons: Button's `loading`
// prop already covers that case, spinner included.
// ---------------------------------------------------------------------------

export function InlineLoading({ label, className }: { label?: string; className?: string }) {
  const t = useT();

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-sm text-ink-400', className)}
    >
      <Spinner className="h-3.5 w-3.5" />
      {label ?? t('common.loading')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PageLoading — the first paint of a route, before there is anything of its
// own shape to guess at (an account that might be signed in or not, a
// document that has not resolved yet). The mark pulses in place of a spinner
// so the brand is what a customer sees waiting, not a generic ring.
// ---------------------------------------------------------------------------

export function PageLoading({ label }: { label?: string }) {
  const t = useT();
  const text = label ?? t('common.loading');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16"
    >
      <LogoMark size={40} className="animate-pulse text-brand-200" aria-hidden />
      <span className="text-sm text-ink-400">{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuSkeleton — the shape of a restaurant page's menu: a rail of category
// pills, then sections of dish rows, each row the exact box a dish sits in
// once it arrives (thumbnail, name, description, price).
// ---------------------------------------------------------------------------

function DishRowSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-card-edge bg-white p-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="h-4 w-2/3" />
        <Bone className="h-3 w-full" />
        <Bone className="h-3 w-1/3" />
        <Bone className="mt-2 h-4 w-16" />
      </div>
      <Bone className="h-20 w-20 shrink-0 rounded-xl" />
    </div>
  );
}

export function MenuSkeleton({ sections = 2, rows = 4 }: { sections?: number; rows?: number }) {
  const t = useT();

  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loadingMenu')}>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-2.5" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <Bone key={index} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="space-y-8" aria-hidden>
        {Array.from({ length: sections }, (_, section) => (
          <div key={section}>
            <Bone className="mb-3 h-5 w-40" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              {Array.from({ length: rows }, (_, row) => (
                <DishRowSkeleton key={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrderListSkeleton — the shape of a row in "Sifarişlərim": name and code on
// one line, the item/price summary below, a status pill, a chevron.
// ---------------------------------------------------------------------------

function OrderRowSkeleton() {
  return (
    <div className="rounded-2xl border border-card-edge bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Bone className="h-4 w-28" />
            <Bone className="h-3 w-14" />
          </div>
          <Bone className="h-3 w-40" />
          <Bone className="h-5 w-20 rounded-full" />
        </div>
        <Bone className="h-4 w-4 shrink-0" />
      </div>
    </div>
  );
}

export function OrderListSkeleton({ count = 4 }: { count?: number }) {
  const t = useT();

  return (
    <div
      className="space-y-2.5"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t('common.loadingOrders')}
    >
      <div aria-hidden className="space-y-2.5">
        {Array.from({ length: count }, (_, index) => (
          <OrderRowSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccountSkeleton — the shape of "Hesabım": the profile card up top, then a
// titled group of rows, the way every settings section on the page reads.
// ---------------------------------------------------------------------------

function AccountRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <Bone className="h-[18px] w-[18px] shrink-0" />
      <Bone className="h-3 flex-1 max-w-40" />
    </div>
  );
}

export function AccountSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useT();

  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loadingAccount')}>
      <div aria-hidden>
        <div className="flex items-center gap-4 rounded-2xl border border-card-edge bg-white p-5 shadow-sm">
          <Bone className="h-14 w-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-4 w-32" />
            <Bone className="h-3 w-24" />
          </div>
        </div>

        <div className="mt-8">
          <Bone className="mb-2.5 h-3 w-28" />
          <div className="divide-y divide-row-edge rounded-2xl border border-card-edge bg-white">
            {Array.from({ length: rows }, (_, index) => (
              <AccountRowSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
