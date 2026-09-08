'use client';

/**
 * Sizes, extras and the price of each.
 *
 * WHY IT IS BACK
 * --------------
 * This editor used to exist, was found to be the hardest part of the panel, and
 * was taken out — leaving the *data* intact and the screen gone. The result was
 * a marketplace that could not sell a large pizza with extra cheese: a
 * restaurant with three sizes had to publish three dishes, at which point the
 * menu, the search index and every report counted them as three products. It is
 * not a nicety. It is how food is actually sold, and the whole backend for it —
 * validation, cart pricing, order snapshots, receipts — has been finished and
 * sitting unused this entire time.
 *
 * WHY IT WAS HARD, AND WHAT IS DIFFERENT
 * --------------------------------------
 * The old form asked the owner to fill in `selection`, `required`, `minSelect`
 * and `maxSelect` — four fields describing one idea, in a vocabulary borrowed
 * from the database. Most of the invalid combinations they produced ("required,
 * choose zero"; "between three and two") were refused by the server with an
 * error naming a field the owner had never heard of.
 *
 * So the four fields are gone from the screen and one question replaces them:
 * how does the customer choose from this group? Three answers, in the words a
 * restaurant already uses — pick one, pick one or none, pick as many as you
 * like — and each maps onto a combination the server accepts by construction.
 * The invalid states are not validated against; they are unreachable.
 *
 * PRICES ARE DIFFERENCES, NOT PRICES
 * ----------------------------------
 * "Large" does not cost 12 ₼; it costs 3 ₼ *more*. Typing the full price into a
 * delta is the single most likely mistake here, so the field says "+₼" and the
 * hint says so in words. Negative deltas are refused by the server on purpose —
 * a discount buried in a menu option is money moving outside the coupon system
 * and therefore outside commission accounting — so the input does not accept a
 * minus sign either.
 */

import { useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import { Button, Input, Select, cn } from '@/components/ui';
import { ModifierSelection } from '@/shared/enums';
import { formatMinorUnits, parseMajorUnits } from '@/shared/pricing';
import type { ModifierGroup, ModifierOption } from '@/shared/models';

/** Mirrors `MAX_MODIFIER_GROUPS` / `MAX_OPTIONS_PER_GROUP` in `menu/crud.ts`. */
const MAX_GROUPS = 8;
const MAX_OPTIONS = 20;

/**
 * The one question the owner is actually asked.
 *
 * Each answer is a whole valid `(selection, required, minSelect, maxSelect)`
 * combination, so there is no way to describe a group the server will refuse
 * and no way to describe a cart the customer cannot satisfy.
 */
type Rule = 'ONE_REQUIRED' | 'ONE_OPTIONAL' | 'MANY';

function ruleOf(group: ModifierGroup): Rule {
  if (group.selection === ModifierSelection.MULTIPLE) return 'MANY';
  return group.required ? 'ONE_REQUIRED' : 'ONE_OPTIONAL';
}

/** The other direction: an answer back into the four stored fields. */
function applyRule(group: ModifierGroup, rule: Rule): ModifierGroup {
  const count = group.options.length;

  if (rule === 'MANY') {
    return {
      ...group,
      selection: ModifierSelection.MULTIPLE,
      required: false,
      minSelect: 0,
      // Recomputed from the option count every time, which is what keeps
      // `maxSelect` correct after an option is deleted — a stale ceiling of 4
      // on a group with 2 options is one of the ways the old editor produced
      // groups the server refused.
      maxSelect: Math.max(count, 1),
    };
  }

  return {
    ...group,
    selection: ModifierSelection.SINGLE,
    required: rule === 'ONE_REQUIRED',
    minSelect: rule === 'ONE_REQUIRED' ? 1 : 0,
    maxSelect: 1,
  };
}

function blankOption(groupId: string, index: number): ModifierOption {
  return { id: `${groupId}-o${index}-${rid()}`, name: '', priceDelta: 0, available: true };
}

/** Enough to not collide inside one product; ids are scoped to the dish. */
function rid(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function ModifierEditor({
  groups,
  onChange,
}: {
  groups: ModifierGroup[];
  onChange: (next: ModifierGroup[]) => void;
}) {
  const t = useT();

  /*
   * The price boxes are text, not numbers, and they live here rather than in
   * the group objects.
   *
   * A price field has to hold "1," and "1.5" and "" while somebody is typing,
   * and none of those is a number. Parsing on every keystroke and storing the
   * result is what makes a field that erases the comma the moment you type it.
   * So the typed text is kept as text, keyed by option id, and converted to
   * qəpik only on the way out.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      groups.flatMap((group) =>
        group.options.map((option) => [
          option.id,
          option.priceDelta > 0 ? formatMinorUnits(option.priceDelta) : '',
        ]),
      ),
    ),
  );

  const update = (index: number, next: ModifierGroup) => {
    onChange(groups.map((group, at) => (at === index ? next : group)));
  };

  const addGroup = () => {
    const id = `g${groups.length}-${rid()}`;
    onChange([
      ...groups,
      applyRule(
        {
          id,
          name: '',
          selection: ModifierSelection.SINGLE,
          required: true,
          minSelect: 1,
          maxSelect: 1,
          // A group with no options is refused by the server, and an empty
          // group is not a thing anybody wants anyway — so it starts with the
          // two rows a real group has at minimum.
          options: [blankOption(id, 0), blankOption(id, 1)],
        },
        'ONE_REQUIRED',
      ),
    ]);
  };

  const setPrice = (optionId: string, text: string, index: number, optionIndex: number) => {
    // Only digits and one separator. A minus sign is not a typo to correct
    // later — the server refuses negative deltas, so it never gets typed.
    const cleaned = text.replace(/[^\d.,]/g, '');
    setDrafts((current) => ({ ...current, [optionId]: cleaned }));

    let minor = 0;
    try {
      minor = cleaned.trim() ? parseMajorUnits(cleaned) : 0;
    } catch {
      // Mid-typing ("1," or "."). The last good value stands until the text
      // parses again; the save button reads the parsed value, not the text.
      return;
    }

    const group = groups[index];
    update(index, {
      ...group,
      options: group.options.map((option, at) =>
        at === optionIndex ? { ...option, priceDelta: minor } : option,
      ),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-900">
            {t('restaurantPanel.modifierGroups')}
          </h3>
          <p className="mt-0.5 text-sm text-ink-500">{t('restaurantPanel.modifierIntro')}</p>
        </div>
      </div>

      {/*
        A WORKED EXAMPLE, SHOWN ONLY WHEN THERE IS NOTHING TO LOOK AT.

        The words "seçim qrupu" mean nothing to somebody who runs a kebab shop,
        and neither does an empty form with a "Qrup əlavə et" button under it.
        What does mean something is the thing they sell every day, written out
        the way this screen would hold it — so the first group they build is a
        copy of a shape they recognise rather than a guess at what the fields
        want.

        It disappears the moment a real group exists: an example beside real
        data is clutter, and worse, it invites somebody to read the example's
        numbers as their own.
      */}
      {groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-subtle p-4">
          <p className="text-sm font-medium text-ink-800">
            {t('restaurantPanel.modifierExampleTitle')}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-600">
            {t('restaurantPanel.modifierExampleBody')}
          </p>
          <p className="mt-2.5 text-sm text-ink-500">
            {t('restaurantPanel.modifierExamplePrice')}
          </p>
        </div>
      )}

      {groups.map((group, index) => {
        const rule = ruleOf(group);

        return (
          <div
            key={group.id}
            className="rounded-2xl border border-card-edge bg-subtle p-4 shadow-[0_1px_2px_rgb(38_36_35/0.05)]"
          >
            <div className="flex items-start gap-2">
              <GripVertical size={18} className="mt-3 shrink-0 text-ink-300" aria-hidden />

              <div className="min-w-0 flex-1 space-y-3">
                <Input
                  label={t('restaurantPanel.modifierGroupName')}
                  value={group.name}
                  onChange={(event) => update(index, { ...group, name: event.target.value })}
                  maxLength={60}
                  placeholder={t('restaurantPanel.modifierGroupNamePlaceholder')}
                />

                <Select
                  label={t('restaurantPanel.modifierRuleLabel')}
                  value={rule}
                  onChange={(event) => update(index, applyRule(group, event.target.value as Rule))}
                  hint={t(`restaurantPanel.modifierRuleHint.${rule}`)}
                >
                  <option value="ONE_REQUIRED">{t('restaurantPanel.modifierRuleOption.ONE_REQUIRED')}</option>
                  <option value="ONE_OPTIONAL">{t('restaurantPanel.modifierRuleOption.ONE_OPTIONAL')}</option>
                  <option value="MANY">{t('restaurantPanel.modifierRuleOption.MANY')}</option>
                </Select>
              </div>

              <button
                type="button"
                aria-label={t('restaurantPanel.removeModifierGroup')}
                onClick={() => onChange(groups.filter((_, at) => at !== index))}
                className="mt-1 rounded-xl p-2 text-ink-400 transition hover:bg-ink-100 hover:text-danger"
              >
                <Trash2 size={17} />
              </button>
            </div>

            <div className="mt-4 space-y-2 border-t border-card-edge pt-3">
              {group.options.map((option, optionIndex) => (
                <div key={option.id} className="flex items-center gap-2">
                  <input
                    value={option.name}
                    maxLength={60}
                    placeholder={t('restaurantPanel.modifierOptionPlaceholder')}
                    onChange={(event) =>
                      update(index, {
                        ...group,
                        options: group.options.map((each, at) =>
                          at === optionIndex ? { ...each, name: event.target.value } : each,
                        ),
                      })
                    }
                    className="h-11 min-w-0 flex-1 rounded-xl border border-card-edge bg-surface px-3 text-[15px] text-ink-900 outline-none transition focus:border-brand-500"
                  />

                  {/* Fixed width and right-aligned so a column of prices lines
                      up on the decimal point, which is how a menu is read. */}
                  <div className="relative w-24 shrink-0">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                      +₼
                    </span>
                    <input
                      value={drafts[option.id] ?? ''}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(event) =>
                        setPrice(option.id, event.target.value, index, optionIndex)
                      }
                      className="h-11 w-full rounded-xl border border-card-edge bg-surface pl-8 pr-2 text-right text-[15px] tabular-nums text-ink-900 outline-none transition focus:border-brand-500"
                    />
                  </div>

                  {/* "Bitib" rather than deleting the row: an extra that has run
                      out today comes back tomorrow, and deleting it loses the
                      price the owner set. */}
                  <button
                    type="button"
                    aria-label={t('restaurantPanel.modifierOptionAvailable')}
                    aria-pressed={option.available}
                    onClick={() =>
                      update(index, {
                        ...group,
                        options: group.options.map((each, at) =>
                          at === optionIndex ? { ...each, available: !each.available } : each,
                        ),
                      })
                    }
                    className={cn(
                      'h-11 shrink-0 rounded-xl border px-2.5 text-xs font-medium transition',
                      option.available
                        ? 'border-card-edge bg-surface text-ink-500 hover:bg-ink-50'
                        : 'border-warning bg-warning/10 text-warning',
                    )}
                  >
                    {option.available
                      ? t('restaurantPanel.modifierOptionOn')
                      : t('restaurantPanel.modifierOptionOff')}
                  </button>

                  {/* A group needs at least one option, so the last row cannot
                      be removed — the button is gone rather than disabled,
                      because a disabled control invites a second press. */}
                  {group.options.length > 1 && (
                    <button
                      type="button"
                      aria-label={t('restaurantPanel.removeModifierOption')}
                      onClick={() =>
                        update(
                          index,
                          applyRule(
                            {
                              ...group,
                              options: group.options.filter((_, at) => at !== optionIndex),
                            },
                            // Re-derived, so `maxSelect` follows the option
                            // count down instead of pointing past the end.
                            rule,
                          ),
                        )
                      }
                      className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-100 hover:text-danger"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}

              {group.options.length < MAX_OPTIONS && (
                <button
                  type="button"
                  onClick={() =>
                    update(
                      index,
                      applyRule(
                        {
                          ...group,
                          options: [...group.options, blankOption(group.id, group.options.length)],
                        },
                        rule,
                      ),
                    )
                  }
                  className="flex h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
                >
                  <Plus size={16} /> {t('restaurantPanel.addModifierOption')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {groups.length < MAX_GROUPS && (
        <Button variant="secondary" fullWidth onClick={addGroup}>
          <Plus size={17} /> {t('restaurantPanel.addModifierGroup')}
        </Button>
      )}
    </div>
  );
}

/**
 * What is wrong with these groups, in the owner's words, or null.
 *
 * Exported so the form can block saving *and* say why, rather than sending a
 * request that comes back with `modifierGroups.option.name` — a field name from
 * a validator, shown to somebody who was adding a pizza size.
 */
export function validateModifierGroups(groups: ModifierGroup[], t: (key: string) => string):
  | string
  | null {
  for (const group of groups) {
    if (!group.name.trim()) return t('restaurantPanel.modifierGroupNameRequired');
    if (group.options.length === 0) return t('restaurantPanel.modifierOptionsRequired');
    if (group.options.some((option) => !option.name.trim())) {
      return t('restaurantPanel.modifierOptionNameRequired');
    }

    const names = group.options.map((option) => option.name.trim().toLocaleLowerCase('az'));
    if (new Set(names).size !== names.length) return t('restaurantPanel.modifierOptionDuplicate');

    // The server refuses this too, and rightly: a required group with nothing
    // available is a dish nobody can order. Catching it here means the owner
    // finds out while looking at the switch they just turned off.
    if (group.required && !group.options.some((option) => option.available)) {
      return t('restaurantPanel.modifierAllUnavailable');
    }
  }

  return null;
}
