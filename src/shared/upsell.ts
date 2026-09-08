/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — What else to offer the basket.
 *
 * WHY THIS IS NOT "THE CHEAPEST THINGS ON THE MENU"
 * ------------------------------------------------
 * The row under the basket used to be sorted by price, which meant a customer
 * who had ordered a dönər was shown the four cheapest lines in the shop — a
 * side of bread, a second bread, a portion of pickles — and never the Coke that
 * everyone actually wants with a dönər. Cheap is not the same as relevant, and
 * an irrelevant row gets learned as noise within a week and then stops being
 * looked at at all.
 *
 * So the question this file answers is not "what is cheap" but "what is missing
 * from this basket". A basket holding something hot and savoury and nothing to
 * drink is missing a drink; that is the single strongest signal there is, and
 * it is the one the owner asked for by name.
 *
 * WHERE THE SIGNAL COMES FROM
 * ---------------------------
 * Two things the menu already carries and nobody has to type again: the name of
 * the section a dish sits in — a restaurant that has a section called «İçkilər»
 * has told us everything — and the words in the dish's own name. Both are read
 * through `fold`, so «dönər», «doner» and «DÖNER» are one word, and matched
 * against whole tokens rather than substrings, because «su» is a substring of
 * «sup» and «suşi» and matching it there would offer soup as a beverage.
 *
 * WHY THE LOGIC LIVES HERE AND NOT IN THE COMPONENT
 * ------------------------------------------------
 * It is a rule about food, not about a row of cards, and it is the kind of rule
 * that is only ever wrong in one specific case somebody reports later. Kept
 * here it has tests; kept in the component it would have a screenshot.
 */

import { fold } from './search';

/**
 * What a dish is, for the purpose of deciding whether to offer it.
 *
 * Deliberately coarse. This is not a taxonomy of food, it is the four or five
 * distinctions that change the answer to "should this appear under a basket".
 */
export const UpsellRole = {
  /** A meal in its own right. Never suggested — nobody wants two dinners. */
  MAIN: 'MAIN',
  DRINK: 'DRINK',
  /** Chips, rings, rice, bread, a salad on the side. */
  SIDE: 'SIDE',
  SAUCE: 'SAUCE',
  DESSERT: 'DESSERT',
  /** Recognised as nothing in particular. Offered last, and only if cheap. */
  OTHER: 'OTHER',
} as const;
export type UpsellRole = (typeof UpsellRole)[keyof typeof UpsellRole];

/**
 * Words that mean a role, written folded.
 *
 * Azerbaijani first because that is what the menus are written in, then the
 * Russian and English spellings that appear on the same menus — a Baku kebab
 * shop writes «Coca Cola» and «Кока-кола» on the same board.
 *
 * A phrase containing a space is looked for in the running text. A single word
 * is matched against whole tokens, with one concession to Azerbaijani: a
 * keyword of four letters or more also matches a token that *starts* with it,
 * because the menu says «Dönərlər», «sousu» and «İçkilər» and a rule that only
 * accepted the bare stem would recognise almost none of a real menu. Anything
 * shorter than four letters must match exactly — «su» as a prefix would claim
 * «sup» and «suşi», and the app would offer soup to drink.
 */
const ROLE_WORDS: Record<Exclude<UpsellRole, 'OTHER'>, string[]> = {
  MAIN: [
    'doner', 'donar', 'durum', 'lavas', 'shaurma', 'saurma', 'shawarma',
    'kebab', 'kabab', 'tike', 'lule', 'sac', 'mangal', 'sis', 'shashlik', 'saslik',
    'burger', 'hamburger', 'cizburger', 'cheeseburger',
    'pizza', 'lahmacun', 'pide',
    'plov', 'pilav', 'dolma', 'bozbas', 'piti', 'kufte', 'kotlet', 'sup', 'corba',
    'steyk', 'stek', 'sendvic', 'sandwich', 'hotdog', 'hot dog',
    'sushi', 'susi', 'rol', 'roll', 'nudl', 'wok', 'makaron', 'lazanya',
    'burrito', 'taco', 'tako', 'sarma', 'kutab', 'qutab', 'sosiska',
    // A "menu", a "box" or a "combo" is a whole dinner on one line, whatever
    // else its name mentions. Offering one beside a basket is offering dinner
    // twice.
    'menu', 'menyu', 'kombo', 'combo', 'box', 'set', 'setler', 'ziyafet',
  ],
  DRINK: [
    'icki', 'napitok', 'drink', 'beverage',
    'cola', 'kola', 'pepsi', 'fanta', 'sprite', 'sprayt', 'schweppes', 'sweppes',
    'ayran', 'kefir', 'su', 'voda', 'water', 'mineral', 'limonad', 'limonata',
    'lemonade', 'cay', 'caylar', 'tea',
    'kofe', 'coffee', 'latte', 'kapucino', 'cappuccino', 'americano', 'espresso',
    'smuzi', 'smoothie', 'kokteyl', 'milkshake', 'sok', 'juice', 'nektar',
    'kompot', 'serbet', 'sherbet', 'buzlu cay', 'ice tea', 'aysti',
    'enerji', 'energy', 'redbull', 'red bull', 'soda', 'gazoz',
  ],
  SIDE: [
    'kartof', 'kartofel', 'fri', 'fries', 'frai', 'potato',
    'nagets', 'nuggets', 'nagits', 'strips',
    'sogan halqasi', 'onion ring', 'halqa', 'ring',
    'cips', 'chips', 'qarnir', 'garnir', 'elave', 'extra', 'side',
    'salat', 'salad', 'coleslaw', 'kolslo', 'tursu', 'pickle',
    'corek', 'bread', 'bulka', 'grissini',
    'duyu', 'rice', 'bulqur', 'bulgur',
  ],
  SAUCE: [
    'sous', 'sos', 'sauce', 'ketcup', 'ketchup', 'ketcap',
    'mayonez', 'mayonnaise', 'barbekyu', 'bbq', 'sarimsaqli', 'cheddar',
    'chili', 'cili', 'xardal', 'mustard', 'acika', 'ranch',
  ],
  DESSERT: [
    'desert', 'dessert', 'sirniyyat', 'tort', 'kek', 'cake', 'muffin', 'donut',
    'ponchik', 'baklava', 'pahlava', 'dondurma', 'ice cream', 'morojni',
    'pudinq', 'pudding', 'profitrol', 'cheesecake', 'tiramisu', 'sutlac',
    'firni', 'halva', 'kunefe', 'waffle', 'vafli', 'krep', 'crepe',
  ],
};

/** Below this a keyword must be the whole token; at or above it, a prefix. */
const PREFIX_MATCH_MIN_LENGTH = 4;

/**
 * The order roles are tested in, and MAIN goes first for a reason.
 *
 * Menus sell combinations: «Dönər menyu (kola + kartof)» names a drink and a
 * side and is neither — it is dinner. Any other order reads that line as a
 * Coke and offers a whole second meal under the basket. The one case this
 * costs us is a drink named after the dish it goes with, and that case is
 * already answered above the word list: the restaurant filed the bottle under
 * «İçkilər», and the section name is asked first.
 */
const ROLE_ORDER: Array<Exclude<UpsellRole, 'OTHER'>> = ['MAIN', 'DRINK', 'SAUCE', 'DESSERT', 'SIDE'];

/** Does this folded text mean the word, as a word rather than a fragment? */
function mentions(text: string, tokens: readonly string[], word: string): boolean {
  if (word.includes(' ')) return text.includes(word);
  if (word.length < PREFIX_MATCH_MIN_LENGTH) return tokens.includes(word);
  return tokens.some((token) => token.startsWith(word));
}

function roleOfText(value: string | null | undefined): UpsellRole | null {
  if (!value) return null;

  const text = fold(value);
  const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);

  for (const role of ROLE_ORDER) {
    if (ROLE_WORDS[role].some((word) => mentions(text, tokens, word))) return role;
  }
  return null;
}

/**
 * What this dish is.
 *
 * The section name is asked first and trusted: a restaurant that filed a dish
 * under «İçkilər» has classified it better than any word list can, and it is
 * the only signal that survives a bottle named nothing but «Coca-Cola 0.5».
 * The dish's own name answers when the section says nothing useful.
 */
export function classifyUpsellItem(item: {
  name: string;
  categoryName?: string | null;
}): UpsellRole {
  return roleOfText(item.categoryName) ?? roleOfText(item.name) ?? UpsellRole.OTHER;
}

/**
 * Above this a dish is dinner, not an afterthought. In qəpik: 9.00 ₼.
 *
 * It is also what stops a combo — «Dönər menyu: dönər + kartof + kola» — from
 * being read as a drink because its name happens to say «kola».
 */
export const UPSELL_PRICE_CEILING = 900;

/** One thing that could be offered. Shaped from a `Product`, not tied to it. */
export interface UpsellCandidate {
  id: string;
  name: string;
  price: number;
  popular: boolean;
  available: boolean;
  /** A dish with choices to make is a detour, not a suggestion. */
  hasOptions: boolean;
  categoryName?: string | null;
}

/** One line of the basket, reduced to what the matching actually reads. */
export interface UpsellBasketLine {
  productId: string;
  name: string;
  quantity: number;
  categoryName?: string | null;
}

/** What the basket already is, in the only terms this file reasons about. */
export interface BasketProfile {
  hasSavouryMain: boolean;
  hasDrink: boolean;
  hasSide: boolean;
  hasDessert: boolean;
  /** productId → how many are in the basket right now. */
  quantities: Map<string, number>;
}

export function profileBasket(lines: readonly UpsellBasketLine[]): BasketProfile {
  const quantities = new Map<string, number>();
  let hasSavouryMain = false;
  let hasDrink = false;
  let hasSide = false;
  let hasDessert = false;

  for (const line of lines) {
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);

    switch (classifyUpsellItem(line)) {
      case UpsellRole.MAIN:
        hasSavouryMain = true;
        break;
      case UpsellRole.DRINK:
        hasDrink = true;
        break;
      case UpsellRole.SIDE:
        hasSide = true;
        break;
      case UpsellRole.DESSERT:
        hasDessert = true;
        break;
      default:
        break;
    }
  }

  return { hasSavouryMain, hasDrink, hasSide, hasDessert, quantities };
}

/**
 * How badly this basket wants that role, before anything else is considered.
 *
 * The numbers are gaps, not measurements: a drink the basket is missing must
 * beat every side dish in the shop, and a sauce must never outrank the chips
 * it goes on. Written as one table so the ordering is something a person can
 * read and argue with rather than something that emerges from four `sort`
 * comparators.
 */
function appetite(role: UpsellRole, basket: BasketProfile): number {
  switch (role) {
    case UpsellRole.DRINK:
      // The one the owner asked for by name: no drink in the basket means a
      // drink is the suggestion, ahead of everything.
      return basket.hasDrink ? 20 : 100;
    case UpsellRole.SIDE:
      // Chips beside a dönər is the second most obvious basket in the country.
      if (!basket.hasSavouryMain) return 25;
      return basket.hasSide ? 45 : 70;
    case UpsellRole.SAUCE:
      // Only ever an accompaniment: worth offering next to hot food, worth
      // nothing next to a basket holding one bottle of water.
      return basket.hasSavouryMain ? 55 : 10;
    case UpsellRole.DESSERT:
      // Something people add at the end of an evening, not something they are
      // shopping for — so it sits under the drink and the chips, never above.
      if (basket.hasDessert) return 12;
      return basket.hasSavouryMain ? 35 : 15;
    default:
      return 5;
  }
}

/**
 * A dish already in the basket loses ground but is never dropped.
 *
 * Removing it is what the row used to do, and it made the row jump: the card
 * the customer had just tapped vanished under their thumb, the rest slid left,
 * and adding a second Coke meant going back to the menu. So it stays, showing
 * what is already in there, and simply ranks behind the ideas the customer has
 * not had yet.
 */
const ALREADY_IN_BASKET_PENALTY = 55;

/** A kitchen that marked something popular knows its customers. */
const POPULAR_BONUS = 15;

export interface RankedUpsell<T extends UpsellCandidate = UpsellCandidate> {
  candidate: T;
  role: UpsellRole;
  /** How many of this product the basket already holds. Zero for a new idea. */
  inBasket: number;
  score: number;
}

/**
 * The row, in the order it should be drawn.
 *
 * Everything that could never be a one-tap addition is gone before scoring:
 * a second main course, a dish with options to choose, a dish the kitchen has
 * run out of, and anything priced like a meal. What is left is ranked by what
 * the basket is missing.
 */
export function rankUpsellSuggestions<T extends UpsellCandidate>(
  candidates: readonly T[],
  basketLines: readonly UpsellBasketLine[],
  { limit = 8, priceCeiling = UPSELL_PRICE_CEILING }: { limit?: number; priceCeiling?: number } = {},
): Array<RankedUpsell<T>> {
  const basket = profileBasket(basketLines);

  const ranked: Array<RankedUpsell<T>> = [];

  for (const candidate of candidates) {
    if (!candidate.available || candidate.hasOptions) continue;
    if (candidate.price > priceCeiling) continue;

    const role = classifyUpsellItem(candidate);
    if (role === UpsellRole.MAIN) continue;

    const inBasket = basket.quantities.get(candidate.id) ?? 0;

    ranked.push({
      candidate,
      role,
      inBasket,
      score:
        appetite(role, basket) +
        (candidate.popular ? POPULAR_BONUS : 0) -
        (inBasket > 0 ? ALREADY_IN_BASKET_PENALTY : 0),
    });
  }

  // Cheapest breaks a tie, and the name breaks that, so two customers looking
  // at the same menu see the same row in the same order every time.
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidate.price - b.candidate.price ||
      a.candidate.name.localeCompare(b.candidate.name),
  );

  return ranked.slice(0, limit);
}
