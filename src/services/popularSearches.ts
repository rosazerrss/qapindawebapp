'use client';

/**
 * The chips under "Populyar axtarışlar".
 *
 * Read straight from Firestore rather than through a callable: the collection
 * is publicly readable on purpose (a folded word and a number, attached to
 * nobody), so this is one small indexed query instead of a function call and
 * its cold start on the screen a hungry person opens first.
 */

import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { firestore } from '@/firebase/client';

/** How many chips fit under the heading without becoming a wall. */
export const POPULAR_SEARCH_COUNT = 8;

/**
 * How many people must have used a term before it is offered to everybody.
 *
 * One is noise — it is one person's typo, promoted to the front page. Three is
 * low enough that a small platform's list fills within a week and high enough
 * that nothing reaches the screen by accident.
 */
const MIN_COUNT = 3;

/**
 * What a brand-new platform shows instead.
 *
 * WHY THERE IS A FALLBACK AT ALL
 * ------------------------------
 * On day one nobody has searched for anything, so the query answers nothing and
 * the heading would sit above an empty space. An empty section on the first
 * screen of a new app does not read as "no data yet" — it reads as broken, and
 * the person who thinks it is broken is the first customer.
 *
 * These are the dishes this catalogue is actually built around, so they are
 * useful suggestions rather than filler, and they disappear on their own as
 * real searches overtake them.
 */
const FALLBACK = ['Dönər', 'Kabab', 'Pizza', 'Burger', 'Şirniyyat', 'Salat', 'Çörək', 'Ayran'];

export interface PopularSearch {
  term: string;
  display: string;
}

/**
 * Returns the most-used terms, padded with the fallback so the row is never
 * short.
 *
 * A failed read answers with the fallback rather than an error: this is a row
 * of suggestions, and a suggestion nobody asked for is not worth a message
 * about a network problem.
 */
export async function popularSearches(): Promise<string[]> {
  const db = firestore();
  if (!db) return FALLBACK;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'searchTerms'),
        where('count', '>=', MIN_COUNT),
        orderBy('count', 'desc'),
        limit(POPULAR_SEARCH_COUNT),
      ),
    );

    const found = snapshot.docs
      .map((doc) => (doc.data() as { display?: string }).display)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (found.length >= POPULAR_SEARCH_COUNT) return found;

    // Padded, not replaced. A platform with three real terms shows those three
    // first and fills the rest, so the row grows into the real data rather than
    // switching over to it on some threshold nobody can see.
    const lower = new Set(found.map((entry) => entry.toLocaleLowerCase('az')));
    const padding = FALLBACK.filter((entry) => !lower.has(entry.toLocaleLowerCase('az')));

    return [...found, ...padding].slice(0, POPULAR_SEARCH_COUNT);
  } catch {
    return FALLBACK;
  }
}
