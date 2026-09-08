'use client';

/**
 * Hesabım → Ayarlar → Tez-tez verilən suallar.
 *
 * WHY THIS IS NOT ONE LONG PAGE OF TEXT
 * -------------------------------------
 * A wall of prose answers nobody: the person arriving here has exactly one
 * question and everything that is not it is in the way. So the page is a search
 * box over eight small groups of collapsed questions — typing narrows it to the
 * matching lines and opens them, and touching nothing leaves eight headings a
 * thumb can scan in a second.
 *
 * WHAT IS ON IT IS DECIDED IN `shared/faq.ts`
 * -------------------------------------------
 * The groups and the question ids live there so that the list, the three
 * dictionaries and the test that checks them cannot drift apart. This file
 * knows how to draw an accordion and nothing about what is inside it.
 *
 * EVERY ANSWER IS WHAT THE CODE ACTUALLY DOES
 * -------------------------------------------
 * The cancellation window is `CANCEL_WINDOW_MINUTES`, the delivery circle is
 * `shared/geo.ts`, and the couriers belong to the restaurants. Where an answer
 * would be nicer if it were vaguer, it is not vaguer.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { EmptyState, cn } from '@/components/ui';
import { useT } from '@/i18n';
import { FAQ_GROUPS, faqKeys, faqMatches } from '@/shared/faq';

export default function FaqPage() {
  const t = useT();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const searching = term.trim().length > 0;

  /*
   * The visible questions, derived during render rather than kept in state.
   *
   * Storing the filtered list would mean an effect to keep it in step with the
   * search box, and an effect that sets state from a value it can read during
   * render is the exact pattern `react-hooks/set-state-in-effect` refuses.
   */
  const groups = useMemo(
    () =>
      FAQ_GROUPS.map((group) => ({
        id: group.id,
        questions: group.questions.filter((id) => {
          const keys = faqKeys(id);
          return faqMatches(term, t(keys.question), t(keys.answer));
        }),
      })).filter((group) => group.questions.length > 0),
    [term, t],
  );

  const total = groups.reduce((count, group) => count + group.questions.length, 0);

  return (
    <AppShell>
      <ScreenHeader
        title={t('faq.title')}
        subtitle={t('faq.subtitle')}
        fallbackHref="/account/settings"
      />

      <div className="relative mb-5">
        <Search
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
        />
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('faq.searchPlaceholder')}
          aria-label={t('faq.searchPlaceholder')}
          className="min-h-12 w-full rounded-2xl border border-ink-200 bg-white pl-10 pr-10 text-[15px] text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-400"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setTerm('')}
            aria-label={t('common.clear')}
            className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {total === 0 ? (
        <EmptyState title={t('faq.noResults')} hint={t('faq.noResultsHint')} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.id}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {t(`faq.group.${group.id}`)}
              </h2>

              <div className="divide-y divide-row-edge overflow-hidden rounded-2xl border border-card-edge bg-white shadow-sm">
                {group.questions.map((id) => {
                  const keys = faqKeys(id);
                  // While somebody is searching, everything that matched is
                  // open: they have already told us what they are looking for
                  // and asking them to tap it as well is a step for nothing.
                  const expanded = searching || open === id;

                  return (
                    <div key={id}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(open === id ? null : id)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-50"
                      >
                        <span className="min-w-0 flex-1 text-[15px] font-medium text-ink-900">
                          {t(keys.question)}
                        </span>
                        <ChevronDown
                          size={18}
                          aria-hidden
                          className={cn(
                            'shrink-0 text-ink-400 transition-transform motion-reduce:transition-none',
                            expanded && 'rotate-180',
                          )}
                        />
                      </button>

                      {expanded && (
                        <p className="whitespace-pre-line px-4 pb-4 text-[15px] leading-relaxed text-ink-600">
                          {t(keys.answer)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 rounded-2xl bg-ink-50 px-4 py-3.5 text-sm text-ink-600">
        {t('faq.stillStuck')}
      </p>
    </AppShell>
  );
}
