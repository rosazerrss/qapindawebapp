/**
 * QAPINDA — What kind of kitchen is this?
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY IT STOPPED BEING FREE TEXT
 * ------------------------------
 * `cuisines` was a comma-separated box a restaurant owner typed into. Twenty
 * restaurants therefore produced twenty spellings of the same four ideas —
 * "milli", "Milli mətbəx", "azerbaycan", "Azərbaycan mətbəxi", "milli yemek" —
 * and the home page's filter row, which is built from the distinct values
 * across every restaurant, turned into a list of near-duplicates that filtered
 * almost nothing. A customer tapping "Milli mətbəx" saw the four shops that had
 * spelled it that way and none of the others.
 *
 * A closed list fixes that at the source. It also means the words can be
 * translated: a Russian-speaking customer sees "Национальная кухня" without any
 * restaurant having typed a word of Russian.
 *
 * HOW THIS DIFFERS FROM `categories.ts`, WHICH LOOKS SIMILAR
 * ---------------------------------------------------------
 * Categories are DISHES — kebab, pizza, burger, sushi. They drive the row of
 * round icons at the top of the home page, and a restaurant may pick five,
 * because a shop that sells kebabs and burgers and breakfast genuinely belongs
 * in three of those rails.
 *
 * Cuisines are the KITCHEN — national, Turkish, fast food, home cooking. It is
 * what a restaurant IS rather than what it happens to sell, which is why the
 * cap is three rather than five: a place claiming five kitchens is claiming
 * none of them.
 *
 * THE OLD VALUES STILL HAVE TO SHOW
 * ---------------------------------
 * Every restaurant on the platform today has free text in this field. Those
 * documents are not broken and are not migrated: `cuisineLabel` returns the
 * translation for an id it knows, and the raw string for anything else, so an
 * old restaurant keeps reading exactly as it did until its owner opens the
 * panel and picks from the list.
 */

/**
 * The kitchens, in the order they appear in the picker.
 *
 * Ordered by how common they are in Baku rather than alphabetically: the first
 * three cover most of the platform, and a list whose likely answer is at the
 * top is a list somebody finishes.
 *
 * Adding one is a code change on purpose. It needs three translations and it
 * changes what every customer can filter by, which is a decision rather than a
 * form field.
 */
export const CUISINE_IDS = [
  /** Azerbaijani national cooking — kebab, dolma, plov, bozbaş. */
  'MILLI',
  'FASTFOOD',
  'TURK',
  /** Cooked-at-home style: soups, stews, the daily menu. */
  'EV',
  'ITALYAN',
  /** Japanese, Chinese, Thai, Korean — sushi, wok, noodles. */
  'ASIYA',
  'GURCU',
  'AVROPA',
  /** Sweet shops, patisseries, cake and baklava. */
  'SIRNIYYAT',
  /** Coffee houses and juice bars whose food is a sideline. */
  'KOFE',
  /** Salads, bowls, calorie-counted menus. */
  'SAGLAM',
  /** Grilled meat as the whole proposition — steakhouse, mangal. */
  'MANGAL',
  'DENIZ',
  'VEGAN',
] as const;

export type CuisineId = (typeof CUISINE_IDS)[number];

/**
 * How many a restaurant may claim.
 *
 * Three. Enough for "national + grill + home cooking", which is a real
 * description of a real restaurant, and few enough that the answer still means
 * something — a shop tagged with eight kitchens is telling a customer nothing.
 */
export const MAX_RESTAURANT_CUISINES = 3;

export function isCuisineId(value: unknown): value is CuisineId {
  return typeof value === 'string' && (CUISINE_IDS as readonly string[]).includes(value);
}

/**
 * Whatever arrived, reduced to valid ids: de-duplicated, ordered, capped.
 *
 * List order rather than the order they were ticked, so two restaurants that
 * chose the same kitchens describe themselves identically — which is what makes
 * the home page's filter row stable.
 *
 * Anything unrecognised is DROPPED rather than kept. This runs on the server
 * when a restaurant saves, and the only way an unknown value reaches it is a
 * hand-made request; the free text on existing documents is never passed
 * through here, because nothing rewrites those documents until their owner
 * saves a real choice.
 */
export function normaliseCuisines(values: unknown): CuisineId[] {
  if (!Array.isArray(values)) return [];

  const kept = new Set<CuisineId>();
  for (const value of values) {
    if (isCuisineId(value)) kept.add(value);
  }

  return CUISINE_IDS.filter((id) => kept.has(id)).slice(0, MAX_RESTAURANT_CUISINES);
}

/**
 * What to show on screen for one stored value.
 *
 * The translation for an id from the list; the raw string for anything else.
 * That second branch is the whole backwards-compatibility story: a restaurant
 * that typed "Milli yemekler" three months ago still reads as "Milli yemekler"
 * to every customer, in every language, until its owner picks from the list.
 *
 * `translate` is passed in rather than imported so this file stays free of the
 * i18n layer and can be used by the server, which has no `t`.
 */
export function cuisineLabel(value: string, translate: (key: string) => string): string {
  return isCuisineId(value) ? translate(`cuisine.${value}`) : value;
}

/** True once a restaurant has moved off free text. Used to nudge, never to hide. */
export function usesCuisineList(values: string[] | null | undefined): boolean {
  const list = values ?? [];
  return list.length > 0 && list.every(isCuisineId);
}
