/**
 * Legal texts, one set per language.
 *
 * DRAFT, NOT LEGAL ADVICE. These texts were written to describe this platform
 * accurately — a marketplace with no couriers of its own, cash or card at the
 * door, contract of sale between customer and restaurant — but they still have
 * to be reviewed by a lawyer qualified in Azerbaijani law before the platform
 * takes a real order. The page says so to the reader as well; do not remove
 * that banner until a lawyer has signed the text off.
 */

import { LEGAL_AZ } from './az';
import { LEGAL_RU } from './ru';
import { LEGAL_EN } from './en';
import type { LegalDocument, LegalDocuments, LegalSlug } from './types';
import { DEFAULT_LOCALE, type SupportedLocale } from '@/shared/enums';

export { LEGAL_SLUGS } from './types';
export type { LegalDocument, LegalSection, LegalSlug } from './types';

const BY_LOCALE: Record<SupportedLocale, LegalDocuments> = {
  az: LEGAL_AZ,
  ru: LEGAL_RU,
  en: LEGAL_EN,
};

function isLegalSlug(value: string): value is LegalSlug {
  return value in LEGAL_AZ;
}

/**
 * The document for a slug in the reader's language, or null if the slug is not
 * one of ours. Falls back to Azerbaijani if a translation is ever missing.
 */
export function getLegalDocument(
  slug: string,
  locale: SupportedLocale,
): LegalDocument | null {
  if (!isLegalSlug(slug)) return null;
  return BY_LOCALE[locale][slug] ?? BY_LOCALE[DEFAULT_LOCALE][slug];
}
