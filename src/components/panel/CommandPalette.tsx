'use client';

/**
 * ⌘K.
 *
 * Two honest jobs, and no third:
 *
 *  1. **Go somewhere.** Type three letters of a section and press Enter. On a
 *     console you visit twenty times a day this beats aiming at a sidebar.
 *  2. **Search a list.** Type an order code, a phone number or a restaurant
 *     name and it hands the term to the page that can actually search it, which
 *     opens with the term already in its box.
 *
 * What it deliberately does *not* do is show results itself. A palette that
 * previews orders would have to query every collection on every keystroke, and
 * would show a customer's phone number to whoever glanced at the screen. The
 * page that owns the data does the searching, with that page's permissions.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search, Store, Users, Receipt } from 'lucide-react';

import { cn } from '@/components/ui';
import {
  DIALOG_ENTRANCE,
  DIALOG_SCRIM,
  DIALOG_SURFACE,
  useDialogChrome,
} from '@/components/ui/overlay';
import { useT } from '@/i18n';
import type { NavItem } from '@/shared/permissions';

/** The button in the header that says the shortcut out loud. */
export function CommandTrigger({ onClick }: { onClick: () => void }) {
  const t = useT();

  return (
    <button
      onClick={onClick}
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50/60 px-3 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-white sm:max-w-sm"
    >
      <Search size={15} className="shrink-0" />
      <span className="truncate">{t('search.placeholder')}</span>
      <kbd className="ml-auto hidden shrink-0 rounded border border-ink-200 bg-white px-1.5 py-0.5 font-sans text-[11px] text-ink-400 sm:block">
        ⌘K
      </kbd>
    </button>
  );
}

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  href: string;
}

/**
 * Mounted only while it is open — the shell renders it conditionally.
 *
 * That is deliberate rather than incidental: unmounting is what clears the
 * typed term and the highlighted row, so the palette never reopens showing the
 * last thing somebody searched for.
 */
export function CommandPalette({
  onClose,
  items,
  kind,
}: {
  onClose: () => void;
  items: NavItem[];
  kind: 'admin' | 'restaurant';
}) {
  const t = useT();
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);

  // Always live: the shell mounts this only while it is open, so there is no
  // closed state for the hook to sit out.
  const surface = useDialogChrome<HTMLDivElement>(true, onClose);

  const trimmed = term.trim();

  const actions = useMemo<Action[]>(() => {
    const needle = trimmed.toLowerCase();

    const pages: Action[] = items
      .map((item) => ({
        id: item.href,
        label: t(item.labelKey),
        icon: Search,
        href: item.href,
      }))
      .filter((entry) => !needle || entry.label.toLowerCase().includes(needle));

    if (!trimmed) return pages;

    // Hand the term to the pages that can search it. Restaurant staff get the
    // one list they own; the platform gets all three.
    const searches: Action[] =
      kind === 'admin'
        ? [
            {
              id: 'orders',
              label: t('search.inOrders', { term: trimmed }),
              hint: t('search.hintOrders'),
              icon: Receipt,
              href: `/qapinda-idare-merkezi-7xk4m2/orders?q=${encodeURIComponent(trimmed)}`,
            },
            {
              id: 'restaurants',
              label: t('search.inRestaurants', { term: trimmed }),
              icon: Store,
              href: `/qapinda-idare-merkezi-7xk4m2/restaurants?q=${encodeURIComponent(trimmed)}`,
            },
            {
              id: 'users',
              label: t('search.inUsers', { term: trimmed }),
              hint: t('search.hintUsers'),
              icon: Users,
              href: `/qapinda-idare-merkezi-7xk4m2/users?q=${encodeURIComponent(trimmed)}`,
            },
          ]
        : [
            {
              id: 'menu',
              label: t('search.inMenu', { term: trimmed }),
              icon: Receipt,
              href: `/panel/menu?q=${encodeURIComponent(trimmed)}`,
            },
          ];

    return [...searches, ...pages];
  }, [items, trimmed, kind, t]);

  const go = (action: Action | undefined) => {
    if (!action) return;
    router.push(action.href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className={DIALOG_SCRIM}
      />

      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.placeholder')}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg overflow-hidden rounded-dialog',
          DIALOG_SURFACE,
          DIALOG_ENTRANCE,
        )}
      >
        <div className="flex items-center gap-3 border-b border-card-edge px-4">
          <Search size={17} className="shrink-0 text-ink-400" />
          <input
            autoFocus
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => Math.min(value + 1, actions.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) => Math.max(value - 1, 0));
              }
              if (event.key === 'Enter') go(actions[cursor]);
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {actions.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-400">{t('home.noResults')}</p>
          ) : (
            actions.map((action, index) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.id}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(action)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition',
                    index === cursor ? 'bg-ink-100 text-ink-900' : 'text-ink-600',
                  )}
                >
                  <Icon size={16} className="shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{action.label}</span>
                    {action.hint && (
                      <span className="block truncate text-xs text-ink-400">{action.hint}</span>
                    )}
                  </span>
                  {index === cursor && (
                    <CornerDownLeft size={14} className="shrink-0 text-ink-400" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
