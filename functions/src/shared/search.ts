/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Menu search.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY TOKENS AND NOT A SEARCH ENGINE
 * ----------------------------------
 * Somebody types "döner" and expects to see the restaurants that sell one. That
 * is a search across every menu on the platform, and Firestore has no full-text
 * index — the honest options are a paid search service, or doing the small
 * amount of work that makes the common case work well.
 *
 * The small amount of work: when a dish is saved, its name and description are
 * folded into a list of strings stored on the document. A search is then an
 * `array-contains` on that list, which Firestore indexes automatically and
 * answers in one query, at any catalogue size.
 *
 * THREE THINGS THIS USED TO GET WRONG
 * -----------------------------------
 * 1. IT SEARCHED ONE WORD. `searchToken` took the first word of the query and
 *    threw the rest away, so "toyuq burger" searched for "toyuq" and returned
 *    every chicken dish on the platform — the second word, the one that
 *    narrowed it, was silently discarded.
 *
 * 2. IT MATCHED WHOLE WORDS ONLY. Typing "dön" found nothing, and a person
 *    searching a food app types three letters and looks at the results. A
 *    search that needs the word spelled out in full is a search that answers
 *    after the customer has given up.
 *
 * 3. IT INDEXED SEARCHABLE WORDS AND NOTHING ELSE. The restaurant's own name
 *    was not among a product's tokens, so "Dönərçi" — the name on the sign —
 *    matched no dish at all.
 *
 * HOW EACH IS ANSWERED
 * --------------------
 * Prefixes are stored, not computed at query time: every word of a dish's name
 * contributes `do`, `don`, `done`, `doner`, so `array-contains "dön"` finds it
 * in one indexed query with no scanning. Prefixes come from the NAME and the
 * restaurant name only — a paragraph of description exploded into prefixes
 * would blow past Firestore's document limits for no benefit, so descriptions
 * keep contributing whole words.
 *
 * Several words are answered by querying the most selective one and filtering
 * the rest in memory. Firestore cannot AND two `array-contains` clauses, and
 * `array-contains-any` is an OR — which would widen the search rather than
 * narrow it. One query, then a filter, gives real AND semantics for the price
 * of a few dozen objects in memory.
 *
 * What it still does not do, stated plainly: it does not rank by relevance
 * beyond "the restaurant is open", and it does not correct spelling. When the
 * catalogue outgrows that, the replacement is a search service, and the shape
 * of `searchTokens` is what it would be fed.
 */

/**
 * Azerbaijani letters folded to their nearest ASCII.
 *
 * People type "doner", "döner" and "dõner" for the same thing, and a phone
 * keyboard set to English cannot produce ə at all. Folding both the stored
 * token and the typed word makes all of those the same string.
 *
 * Uppercase is folded too. `toLowerCase()` alone leaves "İ" as "i̇" — an i with
 * a combining dot — which is a different string from "i" and matches nothing;
 * that one character is why searching for a restaurant typed in capitals used
 * to fail.
 */
export function fold(value: string): string {
  return value
    .replace(/İ/g, 'I')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Folded words of two letters or more, in order, de-duplicated. */
export function words(...parts: Array<string | null | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!part) continue;

    for (const word of fold(part).split(/[^a-z0-9]+/)) {
      // One-letter words match everything and help nobody.
      if (word.length < 2 || seen.has(word)) continue;
      seen.add(word);
      found.push(word);
    }
  }

  return found;
}

/** The shortest prefix worth storing. One letter would match the whole menu. */
const MIN_PREFIX = 2;
/**
 * The longest.
 *
 * Beyond eight characters somebody has typed enough that the whole word is in
 * the list anyway, and every extra prefix is stored on every dish for a query
 * nobody makes.
 */
const MAX_PREFIX = 8;

/**
 * The cap on one dish's stored tokens.
 *
 * Firestore's limit is on the document, not the array, and a dish with a long
 * description and four words of name is nowhere near it — but an unbounded
 * array is an unbounded index entry, and the cap is what keeps a pasted recipe
 * from becoming a thousand index writes.
 */
const MAX_TOKENS = 120;

/**
 * What a dish is findable by.
 *
 * `searchable` are the words that also contribute prefixes — the dish's name
 * and the restaurant's. `extra` are whole words only: the description, where
 * prefixes would multiply without helping anyone find anything.
 */
export function buildSearchTokens(input: {
  name: string;
  description?: string | null;
  restaurantName?: string | null;
}): string[] {
  const tokens = new Set<string>();

  for (const word of words(input.name, input.restaurantName)) {
    tokens.add(word);
    const limit = Math.min(word.length, MAX_PREFIX);
    for (let length = MIN_PREFIX; length < limit; length += 1) {
      tokens.add(word.slice(0, length));
    }
  }

  for (const word of words(input.description)) tokens.add(word);

  return [...tokens].slice(0, MAX_TOKENS);
}

/**
 * A typed query, broken into the words that must ALL match.
 *
 * Capped, because a customer pasting a sentence should narrow the search, not
 * turn it into a hundred in-memory comparisons per result.
 */
export function queryTokens(term: string): string[] {
  return words(term).slice(0, 6);
}

/**
 * The word to send to Firestore, out of a query that may have several.
 *
 * The longest, because it is the most selective: "toyuq burger" is answered far
 * faster by looking up "burger" and filtering for chicken than the other way
 * round. The remaining words are then checked against each result's own tokens
 * by `matchesAllTokens`.
 */
export function primaryToken(term: string): string {
  const all = queryTokens(term);
  if (all.length === 0) return '';
  return all.reduce((longest, word) => (word.length > longest.length ? word : longest));
}

/** Does this document's token list satisfy every word the customer typed? */
export function matchesAllTokens(tokens: string[] | undefined, term: string): boolean {
  const wanted = queryTokens(term);
  if (wanted.length === 0) return true;
  if (!tokens || tokens.length === 0) return false;

  const held = new Set(tokens);
  // A stored prefix is a real token, so an exact hit answers most words. The
  // fallback covers the case a prefix cannot: a word longer than MAX_PREFIX
  // typed in full, where the stored side has the whole word and the query is
  // the same word — and a query word that is itself a prefix of a stored one.
  return wanted.every(
    (word) => held.has(word) || tokens.some((token) => token.startsWith(word)),
  );
}

/**
 * Loose matching for text already in front of the reader.
 *
 * Used by the shopfront's filter box, where the restaurants are already loaded
 * and the question is only which of them to draw. Folded on both sides, so
 * "doner" finds "Dönərçi" — which it did not before, because the client was
 * comparing raw lowercase strings and ə is not e.
 */
export function looselyMatches(haystack: string, term: string): boolean {
  const folded = fold(haystack);
  return queryTokens(term).every((word) => folded.includes(word));
}

/** @deprecated Kept so older callers still compile. Use `buildSearchTokens`. */
export function tokenise(...parts: Array<string | null | undefined>): string[] {
  return words(...parts).slice(0, 40);
}
