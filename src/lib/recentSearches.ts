'use client';

/**
 * What this person searched for last, on this device.
 *
 * WHY IT IS LOCAL AND NOT AN ACCOUNT SETTING
 * ------------------------------------------
 * A search history is the most revealing list a food app holds — it is a record
 * of what somebody was hungry for, at what hour, on which days. Kept on the
 * server it would be readable by anyone who ever reaches that account, syncable
 * to a phone the person no longer owns, and one more thing to hand over when
 * somebody asks for their data or asks to be forgotten.
 *
 * Kept in `localStorage` it belongs to the browser it was typed in. It survives
 * a reload, disappears when the person clears their browser, never leaves the
 * device, and needs no rule, no collection and no deletion path. For a
 * convenience worth five taps, that is the right trade.
 *
 * A guest gets one too, for the same reason: this has nothing to do with
 * signing in.
 */

const KEY = 'qapinda.recentSearches';

/**
 * Five, not ten.
 *
 * The list sits above everything else on the search screen, and a list long
 * enough to scroll past is a list that pushes the thing being looked for off
 * the first screen. Five covers "what did I order last week" without becoming
 * the page.
 */
export const MAX_RECENT_SEARCHES = 5;

/** Too short to be a search anybody would want offered back to them. */
const MIN_LENGTH = 2;
const MAX_LENGTH = 40;

/*
 * A tiny store, so React can subscribe to it properly.
 *
 * `localStorage` is an external system, and the React API for reading one is
 * `useSyncExternalStore` — not an effect that calls `setState` on mount, which
 * is a cascading render and which the lint rule in this project refuses.
 *
 * Two things make that work, and both are easy to get wrong:
 *
 *   • `snapshot` is CACHED. `useSyncExternalStore` compares the returned
 *     reference on every render, so a function that parsed the JSON fresh each
 *     time would hand back a new array every time and loop for ever.
 *   • `SERVER_SNAPSHOT` is one frozen empty array, shared. There is no history
 *     on a server, and returning a new `[]` per call is the same infinite loop
 *     wearing different clothes.
 */
let snapshot: string[] | null = null;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: string[] = [];

export function subscribeToRecentSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cached view. Recomputed only when something actually changed it. */
export function recentSearchesSnapshot(): string[] {
  snapshot ??= read();
  return snapshot;
}

/** Never changes, so React never re-renders the server output into a loop. */
export function recentSearchesServerSnapshot(): string[] {
  return SERVER_SNAPSHOT;
}

function publish(next: string[]): string[] {
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECENT_SEARCHES);
  } catch {
    // Private window, cleared storage, or a value some other version wrote.
    // An empty history is a correct answer to all three.
    return [];
  }
}

function write(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked. The feature is a convenience; losing it is not
    // worth an error anybody sees.
  }
}

export function recentSearches(): string[] {
  return recentSearchesSnapshot();
}

/**
 * Remembers a term, most recent first, without duplicating it.
 *
 * Compared case-insensitively but STORED as typed: somebody who searched
 * "Dönər" should be offered "Dönər" back, not "dönər" — the list is a record of
 * what they did, and a record that tidies its own spelling reads as somebody
 * else's.
 */
export function rememberSearch(term: string): string[] {
  const trimmed = term.trim();
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return recentSearchesSnapshot();

  const lower = trimmed.toLocaleLowerCase('az');
  const next = [trimmed, ...read().filter((entry) => entry.toLocaleLowerCase('az') !== lower)].slice(
    0,
    MAX_RECENT_SEARCHES,
  );

  write(next);
  return publish(next);
}

/** Removes one entry — the × beside it. */
export function forgetSearch(term: string): string[] {
  const lower = term.toLocaleLowerCase('az');
  const next = read().filter((entry) => entry.toLocaleLowerCase('az') !== lower);
  write(next);
  return publish(next);
}

/** Clears the lot. */
export function forgetAllSearches(): string[] {
  write([]);
  return publish([]);
}
