'use client';

/**
 * Compact language switcher.
 *
 * The old picker put three full-width buttons in a row — most of a settings
 * card spent on a choice people make once and rarely revisit. This is one
 * small trigger showing the current language; the other two only appear in a
 * popover while it's open.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';

import { cn } from '@/components/ui';
import { POPOVER_SURFACE } from '@/components/ui/overlay';
import { LOCALE_LABELS, useLocale } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/shared/enums';

export function LanguageMenu({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside click and Escape both close the popover; a menu that only closes
  // on its own item click traps a person who changed their mind.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
      >
        <Globe size={15} className="text-ink-400" aria-hidden />
        {LOCALE_LABELS[locale]}
        <ChevronDown size={14} className="text-ink-400" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('account.language')}
          /* The same edge, ground and lift every other floating surface in the
             app gets. A dropdown drawn in plain `bg-white` on a white page is
             the white-on-white complaint in miniature, and it was the last one
             left. */
          className={cn(
            'absolute right-0 z-10 mt-1.5 w-44 overflow-hidden rounded-xl py-1',
            POPOVER_SURFACE,
          )}
        >
          {SUPPORTED_LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={locale === option}
              onClick={() => {
                setLocale(option);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition',
                locale === option ? 'font-medium text-brand-700' : 'text-ink-700 hover:bg-ink-50',
              )}
            >
              {LOCALE_LABELS[option]}
              {locale === option && <Check size={15} className="text-brand-600" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
