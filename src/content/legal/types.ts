/**
 * Shape of the legal texts.
 *
 * The texts themselves live one file per language next to this one. They are
 * plain data so the page can render them without knowing anything about the
 * content, and so a lawyer's edits stay in one predictable place.
 *
 * Placeholders written as {{LIKE_THIS}} are deliberate: they are the values
 * that must come from platform settings (support contacts) or from the
 * company's registration documents. They are never filled in by the app — a
 * human must replace them before launch, and the page tells the reader so.
 */

export const LEGAL_SLUGS = ['terms', 'privacy', 'cookies'] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export interface LegalSection {
  /** Numbered heading, e.g. "3. Hesab". */
  heading: string;
  /** Paragraphs. Rendered in order, one <p> each. */
  body: string[];
}

export interface LegalDocument {
  title: string;
  /** One or two sentences before the numbered sections. */
  intro: string;
  /** Document version, bumped by hand whenever the wording changes. */
  version: string;
  /** Date the version takes effect, already formatted for the language. */
  effectiveDate: string;
  sections: LegalSection[];
}

export type LegalDocuments = Record<LegalSlug, LegalDocument>;
