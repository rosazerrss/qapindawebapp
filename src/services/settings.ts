'use client';

/**
 * The platform's public settings.
 *
 * `systemSettings/public` is the one settings document a guest may read, and
 * it is read live rather than fetched once: an admin switching phone support
 * on should see it appear on the customer's screen without anybody reloading.
 *
 * Everything here is a read. Writing goes through `updatePublicSettings`,
 * which is admin-only — a screen that could write its own settings would be a
 * screen that could turn on a hotline nobody is sitting behind.
 */

import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import type { PublicSettings } from '@/shared/models';

export function watchPublicSettings(
  onChange: (settings: PublicSettings | null) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, paths.publicSettings()),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as PublicSettings) : null),
    () => onChange(null),
  );
}

/**
 * Whether "Dəstəyə zəng et" may be shown, and the number behind it.
 *
 * Two conditions, not one. The admin's switch is the decision, but a number
 * that has not been filled in makes the button dial nothing — so the option
 * appears only when both are true, and every screen asks this one function
 * rather than re-deciding it and getting it slightly different.
 */
export function supportCallNumber(settings: PublicSettings | null): string | null {
  if (!settings?.supportCallEnabled) return null;
  const phone = settings.supportPhone?.trim();
  return phone ? phone : null;
}

/**
 * The values the legal texts leave blank, ready to be substituted.
 *
 * WHY THE TEXTS HAVE HOLES IN THEM AT ALL
 * ---------------------------------------
 * "Qapındanı {{OPERATOR_LEGAL_NAME}} (VÖEN: {{OPERATOR_TAX_ID}}) idarə edir" is
 * written that way because the operator's registered name, tax id and address
 * are not knowable from a source file — they are decided when the business is
 * registered, and they change if it is restructured. Baking them into three
 * language files would guarantee that one of them goes stale.
 *
 * WHAT WENT WRONG
 * ---------------
 * Nothing ever filled them in. The page rendered `section.body` verbatim, so a
 * customer opening the terms read, literally, `Telefon: {{SUPPORT_PHONE}}` —
 * ten times across the Azerbaijani text. It reads as an unfinished website,
 * which for a legal document is worse than a plain one.
 *
 * WHAT THIS DOES
 * --------------
 * Support contact comes from the settings document the platform already keeps
 * — one source of truth, editable by an admin, live on the screen. The
 * operator's legal identity comes from `legalPlaceholders`, a free-form map on
 * the same document, so a lawyer's wording can add a placeholder without a
 * deployment.
 *
 * A value that is genuinely not filled in yet stays as its own placeholder
 * rather than becoming an empty string: `Telefon: {{SUPPORT_PHONE}}` is at
 * least an obvious hole, where `Telefon: ` is a document that looks finished
 * and says nothing.
 */
export function legalValues(settings: PublicSettings | null): Record<string, string> {
  const values: Record<string, string> = {};

  const phone = settings?.supportPhone?.trim();
  if (phone) values.SUPPORT_PHONE = phone;

  const email = settings?.supportEmail?.trim();
  if (email) values.SUPPORT_EMAIL = email;

  // Whatever the admin has filled in — operator legal name, tax id, address,
  // and anything a lawyer adds later. Written last so a deliberate override
  // beats the derived support values above.
  for (const [key, value] of Object.entries(settings?.legalPlaceholders ?? {})) {
    if (typeof value === 'string' && value.trim()) values[key] = value.trim();
  }

  return values;
}

/**
 * Substitutes `{{TOKEN}}` in a legal paragraph.
 *
 * Deliberately leaves an unknown token exactly as it found it — see above.
 */
export function fillLegalText(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);
}
