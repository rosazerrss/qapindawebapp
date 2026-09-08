'use client';

/**
 * The operator's ready answers — seventy-odd of them, made findable.
 *
 * WHY THIS IS NOT THE CHIP ROW
 * ----------------------------
 * `TemplatePicker` shows nine options as chips, and that is right for the
 * customer and the restaurant: nine things fit in the eye at once. The
 * platform side asked for an answer ready for *any* restaurant problem, and
 * the honest version of that is seventy-three sentences. Seventy-three chips
 * is not a picker, it is a wall — an operator would scroll past the one they
 * want and type it instead, which makes the feature worse than not having it.
 *
 * So it is two moves at most: choose the situation you are in, then the
 * sentence. Or type two letters and take the match. Both land in the draft;
 * neither sends.
 *
 * WHY THE SEARCH MATCHES THE SENTENCE AND NOT ONLY THE LABEL
 * ----------------------------------------------------------
 * The label is short by design — "Geri qaytarma başladı" — and an operator
 * hunting for the refund timing line is as likely to remember "1-5 gün" as
 * the label. Searching the sentence too costs one string per template and
 * removes the case where the right answer exists and cannot be found.
 *
 * WHY IT COLLAPSES
 * ----------------
 * The composer is the important control on this screen. The picker opens on
 * demand, remembers nothing between tickets, and gets out of the way again.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import { fold } from '@/shared/search';
import {
  OPERATOR_TEMPLATES,
  groupedTemplates,
  templateParams,
  type SupportTemplateFacts,
} from '@/shared/supportTemplates';

export function OperatorTemplatePicker({
  facts,
  onPick,
  disabled = false,
  className,
}: {
  facts: SupportTemplateFacts;
  /** Receives the finished sentence, already interpolated. */
  onPick: (sentence: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupedTemplates(facts), [facts]);

  /** The sentence for a key, with this ticket's facts already in it. */
  const sentenceFor = (key: string): string => {
    const template = OPERATOR_TEMPLATES.find((entry) => entry.key === key);
    if (!template) return '';
    return t(`supportTemplateOperator.${key}`, templateParams(template, facts));
  };

  const searching = query.trim().length > 0;

  // A flat list when searching, because a search result split across eight
  // headings is a worse answer than the one the operator asked for.
  const matches = useMemo(() => {
    if (!searching) return [];
    const needle = fold(query.trim());

    return groups
      .flatMap((entry) => entry.templates)
      .filter((template) => {
        const label = fold(t(`supportLabelOperator.${template.key}`));
        const sentence = fold(sentenceFor(template.key));
        return label.includes(needle) || sentence.includes(needle);
      })
      .slice(0, 12);
    // `t` and `facts` are stable for the life of a ticket; the query is what
    // moves. Listing them would re-run this on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, groups, searching]);

  const active = groups.find((entry) => entry.group === group) ?? groups[0] ?? null;

  if (groups.length === 0) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2',
          'text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-800',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span>{t('support.templatesLabel')}</span>
        <ChevronDown
          size={16}
          className={cn('transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-ink-200 bg-white p-2.5">
          <label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-subtle px-2.5 py-1.5">
            <Search size={14} className="shrink-0 text-ink-400" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('support.templatesSearch')}
              aria-label={t('support.templatesSearch')}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
            />
          </label>

          {!searching && (
            <div className="mt-2 flex flex-wrap gap-1">
              {groups.map((entry) => (
                <button
                  key={entry.group}
                  type="button"
                  onClick={() => setGroup(entry.group)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                    active?.group === entry.group
                      ? 'bg-brand-600 text-white'
                      : 'bg-subtle text-ink-600 hover:bg-brand-50 hover:text-brand-800',
                  )}
                >
                  {t(`supportTemplateGroup.${entry.group}`)}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {(searching ? matches : (active?.templates ?? [])).map((template) => (
              <button
                key={template.key}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(sentenceFor(template.key));
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'rounded-lg border border-transparent px-2.5 py-1.5 text-left transition',
                  'hover:border-brand-200 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <span className="block text-sm font-medium text-ink-800">
                  {t(`supportLabelOperator.${template.key}`)}
                </span>
                {/* The first line of the sentence, so the operator picks the
                    words rather than the label. Clamped: the point is
                    recognition, not reading it twice. */}
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {sentenceFor(template.key)}
                </span>
              </button>
            ))}

            {searching && matches.length === 0 && (
              <p className="px-2.5 py-3 text-center text-sm text-ink-400">
                {t('support.templatesNoMatch')}
              </p>
            )}
          </div>

          <p className="mt-2 px-0.5 text-xs text-ink-400">{t('support.templatesHint')}</p>
        </div>
      )}
    </div>
  );
}
