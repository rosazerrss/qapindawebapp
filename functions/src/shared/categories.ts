/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Food categories.
 *
 * WHY A CLOSED LIST AND NOT THE CUISINE TEXT
 * ------------------------------------------
 * `Restaurant.cuisines` is free text a restaurant types in itself, and free
 * text splits a market: «Dönər», «doner», «Döner-Kebab» and «DÖNƏR» are four
 * chips on the home page, each holding a fraction of the shops that sell the
 * same thing, and a customer tapping one of them sees a nearly empty screen.
 * The categories below are a closed list with stable ids, so «kebab» means the
 * same thing on the home page, in the restaurant panel and in the admin table.
 *
 * The cuisine text stays: it is the restaurant's own description of itself and
 * it still reads well under the name on a card. The category is what the
 * platform sorts by.
 *
 * WHAT IS NOT HERE
 * ----------------
 * The names a customer reads. Those live in `i18n/translations/*.json` under
 * `categories.<id>`, because every visible string in this app goes through
 * `useT()` and a customer may be reading in Russian. This file holds the id,
 * the emoji and the words that map an old free-text cuisine onto the id.
 */

import { fold } from './search';

/**
 * The order is the order of the rail on the home page.
 *
 * It is roughly what Azerbaijan actually orders, most first: the kebab and the
 * döner shop outnumber everything else, sweets and drinks are what somebody
 * adds at the end of an evening rather than what they open the app for.
 */
export const FOOD_CATEGORY_IDS = [
  'KEBAB',
  'DONER',
  'BURGER',
  'PIZZA',
  'TOYUQ',
  'EV_YEMEYI',
  'SEHER_YEMEYI',
  'SUSHI',
  'SALAT',
  'SIRNIYYAT',
  'ICKI',
] as const;

export type FoodCategoryId = (typeof FOOD_CATEGORY_IDS)[number];

export interface FoodCategoryDefinition {
  id: FoodCategoryId;
  /**
   * Drawn instead of an icon set.
   *
   * An emoji is not a design decision taken lightly — it is a picture we do not
   * control the rendering of. It wins here because the alternative is eleven
   * commissioned illustrations that do not exist yet, and a rail of identical
   * grey glyphs reads as a form, not as food.
   */
  emoji: string;
  /**
   * Folded words that mean this category in an old free-text cuisine.
   *
   * Used only by `inferFoodCategories`, to give the restaurants that signed up
   * before this list existed a place on the rail without anyone retyping their
   * profile. Written folded (see `fold`) so «dönər» and «doner» both hit.
   */
  aliases: string[];
}

export const FOOD_CATEGORIES: FoodCategoryDefinition[] = [
  {
    id: 'KEBAB',
    emoji: '🍢',
    aliases: ['kebab', 'kabab', 'tike', 'lule', 'sac', 'mangal', 'sis', 'shashlik', 'saslik'],
  },
  { id: 'DONER', emoji: '🌯', aliases: ['doner', 'durum', 'lavas', 'shaurma', 'saurma', 'shawarma'] },
  { id: 'BURGER', emoji: '🍔', aliases: ['burger', 'hamburger', 'cizburger', 'fast food', 'fastfood'] },
  { id: 'PIZZA', emoji: '🍕', aliases: ['pizza', 'pide', 'lahmacun', 'lahmacun', 'italyan'] },
  { id: 'TOYUQ', emoji: '🍗', aliases: ['toyuq', 'tovuq', 'chicken', 'kanat', 'qanad', 'nagets', 'nuggets'] },
  {
    id: 'EV_YEMEYI',
    emoji: '🍲',
    aliases: ['ev yemeyi', 'ev yemekleri', 'milli', 'azerbaycan', 'plov', 'dolma', 'sup', 'corba', 'bozbas', 'piti'],
  },
  {
    id: 'SEHER_YEMEYI',
    emoji: '🍳',
    aliases: ['seher yemeyi', 'sehr yemeyi', 'nahar', 'breakfast', 'zavtrak', 'kahvalti', 'qayqanaq', 'omlet'],
  },
  { id: 'SUSHI', emoji: '🍣', aliases: ['sushi', 'susi', 'rol', 'roll', 'yapon', 'asiya', 'asian', 'wok', 'nudl'] },
  { id: 'SALAT', emoji: '🥗', aliases: ['salat', 'salad', 'saglam', 'vegan', 'vegetarian', 'fit', 'detoks'] },
  {
    id: 'SIRNIYYAT',
    emoji: '🍰',
    aliases: ['sirniyyat', 'desert', 'dessert', 'tort', 'pasta', 'baklava', 'pahlava', 'dondurma', 'cake'],
  },
  { id: 'ICKI', emoji: '🥤', aliases: ['icki', 'ickiler', 'kofe', 'coffee', 'cay', 'smuzi', 'kokteyl', 'drink'] },
];

const CATEGORY_IDS = new Set<string>(FOOD_CATEGORY_IDS);

export function isFoodCategoryId(value: unknown): value is FoodCategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

/**
 * How many categories one restaurant may claim.
 *
 * A shop that ticks every box is in every list and therefore describes itself
 * to nobody, so there is still a limit. Three turned out to be below what a
 * real menu looks like: the kebab house that also sells burgers, breakfast,
 * sweets and drinks was being asked to hide two of the five things it cooks,
 * and customers searching for those two never found it. Five covers that shop
 * and still leaves six of the eleven tiles unticked, which is what keeps the
 * choice meaningful.
 */
export const MAX_RESTAURANT_CATEGORIES = 5;

/** Whatever arrived, reduced to valid ids: de-duplicated, ordered, capped. */
export function normaliseFoodCategories(values: unknown): FoodCategoryId[] {
  if (!Array.isArray(values)) return [];

  const kept = new Set<FoodCategoryId>();
  for (const value of values) {
    if (isFoodCategoryId(value)) kept.add(value);
  }

  // Rail order rather than the order they were ticked, so two restaurants that
  // chose the same categories describe themselves identically.
  return FOOD_CATEGORY_IDS.filter((id) => kept.has(id)).slice(0, MAX_RESTAURANT_CATEGORIES);
}

/**
 * The categories an old restaurant's cuisine text implies.
 *
 * THE MIGRATION, AND WHY THERE IS NO SCRIPT
 * -----------------------------------------
 * Every restaurant on the platform predates this field. A backfill would have
 * to guess for them anyway, and it would freeze that guess into the document
 * where nobody can tell it apart from a choice the owner made. Guessing at read
 * time instead keeps the two separable: the moment the owner ticks a box in the
 * panel, the stored value wins and this function is never consulted for them
 * again.
 *
 * A restaurant whose cuisines match nothing gets an empty list. That is not a
 * failure — it means "uncategorised", it still appears on the home page under
 * every heading, and it is only absent when a customer has narrowed to one
 * category, where showing it would be a lie.
 */
export function inferFoodCategories(cuisines: readonly string[] | null | undefined): FoodCategoryId[] {
  if (!cuisines || cuisines.length === 0) return [];

  const haystack = cuisines.map((entry) => fold(entry));
  const found = new Set<FoodCategoryId>();

  for (const category of FOOD_CATEGORIES) {
    const hit = category.aliases.some((alias) =>
      haystack.some((entry) => entry.includes(alias)),
    );
    if (hit) found.add(category.id);
  }

  return FOOD_CATEGORY_IDS.filter((id) => found.has(id)).slice(0, MAX_RESTAURANT_CATEGORIES);
}

/**
 * The categories to file this restaurant under, whatever it has stored.
 *
 * The single place both the app and the server ask, so the home page rail and
 * the restaurant panel can never disagree about where a shop belongs.
 */
export function restaurantCategories(restaurant: {
  categories?: string[] | null;
  cuisines?: string[] | null;
}): FoodCategoryId[] {
  const stored = normaliseFoodCategories(restaurant.categories);
  return stored.length > 0 ? stored : inferFoodCategories(restaurant.cuisines);
}

/** Does this restaurant belong under the chosen category? */
export function matchesFoodCategory(
  restaurant: { categories?: string[] | null; cuisines?: string[] | null },
  category: FoodCategoryId,
): boolean {
  return restaurantCategories(restaurant).includes(category);
}


/**
 * WHICH CATEGORIES THE HOME SCREEN SHOWS, AND IN WHAT ORDER.
 *
 * The list above stays in code, and that is deliberate rather than lazy: every
 * category needs an emoji, a set of search aliases and a name in three
 * languages, and an admin form that asked for all four would be a worse way to
 * add "Sushi" than a one-line commit. What an admin genuinely needs is the
 * other half — hiding the categories this city has no restaurants for, and
 * putting the ones it lives on first. A row of eleven icons where four lead to
 * empty screens is the complaint that matters, and it is a *settings* problem.
 *
 * So the platform's settings may carry an ordered list of ids. Absent or empty
 * means "all of them, in the order written above", which is what every
 * deployment starts as and what happens if the setting is ever cleared.
 *
 * Unknown ids are dropped rather than refused: a category removed from the code
 * while it was still listed in settings must not empty the whole row.
 */
export function visibleCategories(
  chosen: readonly string[] | null | undefined,
): FoodCategoryDefinition[] {
  if (!chosen || chosen.length === 0) return FOOD_CATEGORIES;

  const known = new Map(FOOD_CATEGORIES.map((category) => [category.id, category]));
  const ordered = chosen
    .map((id) => known.get(id as FoodCategoryId))
    .filter((category): category is FoodCategoryDefinition => Boolean(category));

  // A settings list that names nothing this build knows about is treated as no
  // setting at all — an empty home screen is never the intended answer.
  return ordered.length > 0 ? ordered : FOOD_CATEGORIES;
}
