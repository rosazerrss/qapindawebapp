import { describe, expect, it } from 'vitest';

import {
  UPSELL_PRICE_CEILING,
  UpsellRole,
  classifyUpsellItem,
  profileBasket,
  rankUpsellSuggestions,
  type UpsellBasketLine,
  type UpsellCandidate,
} from '../shared/upsell';

/**
 * The row under the basket, tested as the rule it is.
 *
 * These cases are the ones the owner reported by name: a basket holding a
 * dönər has to be offered a Coke and chips, a suggestion the customer has
 * already added has to stay on screen so they can add another, and nothing may
 * ever offer a second dinner.
 */

function candidate(partial: Partial<UpsellCandidate> & { id: string; name: string }): UpsellCandidate {
  return {
    price: 200,
    popular: false,
    available: true,
    hasOptions: false,
    categoryName: null,
    ...partial,
  };
}

function line(partial: Partial<UpsellBasketLine> & { productId: string; name: string }): UpsellBasketLine {
  return { quantity: 1, categoryName: null, ...partial };
}

describe('classifyUpsellItem', () => {
  it('reads the Azerbaijani menu words, suffixes and all', () => {
    expect(classifyUpsellItem({ name: 'Dönər dürüm' })).toBe(UpsellRole.MAIN);
    expect(classifyUpsellItem({ name: 'Kartof fri' })).toBe(UpsellRole.SIDE);
    expect(classifyUpsellItem({ name: 'Sarımsaq sousu' })).toBe(UpsellRole.SAUCE);
    expect(classifyUpsellItem({ name: 'Ayran 0.3' })).toBe(UpsellRole.DRINK);
    expect(classifyUpsellItem({ name: 'Şokoladlı tort' })).toBe(UpsellRole.DESSERT);
  });

  it('trusts the restaurant’s own section name over the dish name', () => {
    // A bottle called nothing but its brand is only recognisable by the shelf
    // the restaurant put it on.
    expect(classifyUpsellItem({ name: 'Coca-Cola 0.5', categoryName: 'İçkilər' })).toBe(
      UpsellRole.DRINK,
    );
    expect(classifyUpsellItem({ name: 'Klassik', categoryName: 'Dönərlər' })).toBe(UpsellRole.MAIN);
  });

  it('does not read «su» inside «sup» or «suşi»', () => {
    expect(classifyUpsellItem({ name: 'Toyuq şorbası sup' })).toBe(UpsellRole.MAIN);
    expect(classifyUpsellItem({ name: 'Suşi seti' })).toBe(UpsellRole.MAIN);
    expect(classifyUpsellItem({ name: 'Su 0.5 L' })).toBe(UpsellRole.DRINK);
  });

  it('calls an unrecognised dish nothing rather than guessing', () => {
    expect(classifyUpsellItem({ name: 'Şef təklifi' })).toBe(UpsellRole.OTHER);
  });
});

describe('profileBasket', () => {
  it('counts the same product across two lines with different options', () => {
    const basket = profileBasket([
      line({ productId: 'cola', name: 'Coca-Cola', quantity: 2 }),
      line({ productId: 'cola', name: 'Coca-Cola', quantity: 1 }),
    ]);

    expect(basket.quantities.get('cola')).toBe(3);
    expect(basket.hasDrink).toBe(true);
    expect(basket.hasSavouryMain).toBe(false);
  });
});

describe('rankUpsellSuggestions', () => {
  const menu = [
    candidate({ id: 'cola', name: 'Coca-Cola 0.5', price: 250, categoryName: 'İçkilər' }),
    candidate({ id: 'fri', name: 'Kartof fri', price: 350 }),
    candidate({ id: 'sos', name: 'Sarımsaq sousu', price: 80 }),
    candidate({ id: 'tort', name: 'Şokoladlı tort', price: 700 }),
    candidate({ id: 'corek', name: 'Çörək', price: 40 }),
  ];

  const donerBasket = [line({ productId: 'doner', name: 'Toyuq dönər' })];

  it('offers a drink first when the basket has none', () => {
    const ranked = rankUpsellSuggestions(menu, donerBasket);
    expect(ranked[0].candidate.id).toBe('cola');
  });

  it('puts chips and sauce next to a savoury main, ahead of dessert', () => {
    const order = rankUpsellSuggestions(menu, donerBasket).map((entry) => entry.candidate.id);
    expect(order.indexOf('fri')).toBeLessThan(order.indexOf('tort'));
    expect(order.indexOf('sos')).toBeLessThan(order.indexOf('tort'));
    // The sauce goes on the chips, so it never outranks them.
    expect(order.indexOf('fri')).toBeLessThan(order.indexOf('sos'));
  });

  it('stops leading with a drink once there is one in the basket', () => {
    const ranked = rankUpsellSuggestions(menu, [
      ...donerBasket,
      line({ productId: 'cola', name: 'Coca-Cola 0.5' }),
    ]);
    // Which side dish leads is a matter of price; that it is a side dish and
    // not another bottle is the rule.
    expect(ranked[0].role).toBe(UpsellRole.SIDE);
  });

  it('keeps a suggestion on screen after it is added, with its count', () => {
    const ranked = rankUpsellSuggestions(menu, [
      ...donerBasket,
      line({ productId: 'fri', name: 'Kartof fri', quantity: 2 }),
    ]);

    const chips = ranked.find((entry) => entry.candidate.id === 'fri');
    expect(chips).toBeDefined();
    expect(chips?.inBasket).toBe(2);
    // Still there, but behind the ideas the customer has not had yet.
    expect(ranked[0].candidate.id).not.toBe('fri');
  });

  it('never offers a second main course', () => {
    const withMain = [
      ...menu,
      candidate({ id: 'doner2', name: 'Ət dönər', price: 500 }),
      candidate({ id: 'combo', name: 'Dönər menyu (kola + kartof)', price: 899 }),
    ];

    const ids = rankUpsellSuggestions(withMain, donerBasket).map((entry) => entry.candidate.id);
    expect(ids).not.toContain('doner2');
    expect(ids).not.toContain('combo');
  });

  it('never offers something that needs a choice made, or is sold out', () => {
    const awkward = [
      candidate({ id: 'sized', name: 'Ayran', hasOptions: true }),
      candidate({ id: 'gone', name: 'Kartof fri', available: false }),
    ];

    expect(rankUpsellSuggestions(awkward, donerBasket)).toEqual([]);
  });

  it('drops anything priced like a meal', () => {
    const pricey = [candidate({ id: 'jug', name: 'Limonad qrafin', price: UPSELL_PRICE_CEILING + 1 })];
    expect(rankUpsellSuggestions(pricey, donerBasket)).toEqual([]);
  });

  it('honours the limit and is stable for the same input', () => {
    const first = rankUpsellSuggestions(menu, donerBasket, { limit: 3 });
    const second = rankUpsellSuggestions(menu, donerBasket, { limit: 3 });

    expect(first).toHaveLength(3);
    expect(first.map((entry) => entry.candidate.id)).toEqual(
      second.map((entry) => entry.candidate.id),
    );
  });

  it('still suggests something sensible for a basket it cannot read', () => {
    // An unrecognised main is still a basket wanting a drink: the drink rule
    // does not depend on knowing what the food is, only on there being no
    // drink in there.
    const ranked = rankUpsellSuggestions(menu, [line({ productId: 'x', name: 'Şef təklifi' })]);
    expect(ranked[0].candidate.id).toBe('cola');
  });
});
