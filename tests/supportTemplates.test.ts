import { describe, expect, it } from 'vitest';

import az from '../src/i18n/translations/az.json';
import en from '../src/i18n/translations/en.json';
import ru from '../src/i18n/translations/ru.json';
import {
  OPERATOR_TEMPLATES,
  OPERATOR_TEMPLATE_GROUPS,
  availableTemplates,
  groupedTemplates,
} from '../shared/supportTemplates';

/**
 * THE READY ANSWERS, CHECKED AGAINST THE DICTIONARIES.
 *
 * Seventy-three sentences in three languages is 219 strings that live in a
 * different file from the keys that name them, and the failure mode is silent:
 * a missing key renders as `supportTemplateOperator.coldFood` in front of a
 * restaurant owner, which is worse than having no template at all.
 *
 * So the list is the source of truth and the dictionaries are asserted against
 * it — in both directions, because a leftover sentence for a template that no
 * longer exists is how a dictionary rots.
 */

const dictionaries = { az, en, ru } as unknown as Record<
  string,
  {
    supportTemplateOperator: Record<string, string>;
    supportLabelOperator: Record<string, string>;
    supportTemplateGroup: Record<string, string>;
  }
>;

const keys = OPERATOR_TEMPLATES.map((template) => template.key);

describe('operator templates — every key has words behind it', () => {
  it.each(Object.keys(dictionaries))('%s has a sentence for each template', (lang) => {
    const dictionary = dictionaries[lang].supportTemplateOperator;
    expect(keys.filter((key) => !dictionary[key])).toEqual([]);
  });

  it.each(Object.keys(dictionaries))('%s has a short label for each template', (lang) => {
    const dictionary = dictionaries[lang].supportLabelOperator;
    expect(keys.filter((key) => !dictionary[key])).toEqual([]);
  });

  it.each(Object.keys(dictionaries))('%s carries no sentence for a dead key', (lang) => {
    const dictionary = dictionaries[lang].supportTemplateOperator;
    expect(Object.keys(dictionary).filter((key) => !keys.includes(key))).toEqual([]);
  });

  it.each(Object.keys(dictionaries))('%s names every group', (lang) => {
    const dictionary = dictionaries[lang].supportTemplateGroup;
    expect(OPERATOR_TEMPLATE_GROUPS.filter((group) => !dictionary[group])).toEqual([]);
  });
});

describe('operator templates — a sentence never carries a hole', () => {
  /**
   * A template declaring `facts: ['code']` must interpolate `{{code}}` and
   * nothing else, in every language. The two ways this goes wrong are equally
   * quiet: a translator writes the sentence without the placeholder and the
   * order code silently vanishes from it, or writes `{{amount}}` in a template
   * that was never given one and the customer reads `{{amount}}`.
   */
  it.each(Object.keys(dictionaries))('%s interpolates exactly the declared facts', (lang) => {
    const dictionary = dictionaries[lang].supportTemplateOperator;

    for (const template of OPERATOR_TEMPLATES) {
      const used = [...dictionary[template.key].matchAll(/\{\{(\w+)\}\}/g)]
        .map((match) => match[1])
        .sort();
      expect(used, `${lang}/${template.key}`).toEqual([...(template.facts ?? [])].sort());
    }
  });

  /** And the picker refuses to offer one whose fact this ticket lacks. */
  it('drops fact-carrying templates on a ticket with no order', () => {
    const offered = availableTemplates(OPERATOR_TEMPLATES, {
      code: null,
      restaurant: null,
      amount: null,
    });

    expect(offered.every((template) => (template.facts ?? []).length === 0)).toBe(true);
    // But the ones that need nothing are still there — a ticket with no order
    // attached is exactly when "which order is this about?" is needed.
    expect(offered.map((template) => template.key)).toContain('whichOrder');
  });
});

describe('operator templates — the grouping covers the list', () => {
  it('places every template in a group, and shows every group', () => {
    const grouped = groupedTemplates({ code: 'A1', restaurant: 'X', amount: '5 ₼' });
    const seen = grouped.flatMap((entry) => entry.templates.map((template) => template.key));

    expect(seen.sort()).toEqual([...keys].sort());
    expect(grouped.map((entry) => entry.group)).toEqual([...OPERATOR_TEMPLATE_GROUPS]);
  });

  /** An empty heading is a control that looks broken, so it is not rendered. */
  it('drops a group whose every sentence needed a missing fact', () => {
    const grouped = groupedTemplates({ code: null, restaurant: null, amount: null });
    expect(grouped.every((entry) => entry.templates.length > 0)).toBe(true);
  });
});
