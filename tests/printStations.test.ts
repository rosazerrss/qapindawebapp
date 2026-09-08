/**
 * Printing one order in more than one place.
 *
 * THE FAILURE THAT MATTERS
 * ------------------------
 * A blank ticket, or a ticket missing a dish. Both are silent — nobody notices
 * a slip that did not print until a customer rings about food that never came —
 * so every default below leans towards printing too much rather than too
 * little. A dish on two slips is a conversation; a dish on none is a missing
 * dish.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  MAX_PRINT_STATIONS,
  STATION_KIND,
  defaultStations,
  itemsForStation,
  normaliseStations,
  slipsFor,
  stationHasItems,
  stationShowsAddress,
  uncoveredCategoryIds,
  stationShowsPrices,
  type PrintStation,
} from '../shared/printStations';

const station = (over: Partial<PrintStation> = {}): PrintStation => ({
  id: 'st_1',
  name: 'Mətbəx',
  kind: STATION_KIND.KITCHEN,
  categoryIds: [],
  autoPrint: false,
  ...over,
});

const items = [
  { productId: 'a', categoryId: 'kebab' },
  { productId: 'b', categoryId: 'drinks' },
  { productId: 'c', categoryId: null },
];

describe('routing items onto a slip', () => {
  it('prints everything when no categories are chosen', () => {
    // The single most important default here. "Nothing ticked means nothing
    // prints" would hand a cook an empty ticket at the busiest moment.
    expect(itemsForStation(items, station())).toHaveLength(3);
  });

  it('prints only the chosen categories once some are chosen', () => {
    const grill = station({ categoryIds: ['kebab'] });
    expect(itemsForStation(items, grill).map((entry) => entry.productId)).toEqual(['a']);
  });

  it('leaves an uncategorised item off a routed slip', () => {
    // It still prints on any unrouted station, which every restaurant has at
    // least one of unless it has deliberately routed all of them.
    const grill = station({ categoryIds: ['kebab'] });
    expect(itemsForStation(items, grill).some((entry) => entry.categoryId === null)).toBe(false);
  });

  it('knows when a slip would come out blank', () => {
    // A bar ticket on an order with no drinks. Printing it would put a blank
    // slip on the pile, and a real one gets thrown away with them.
    expect(stationHasItems(items, station({ categoryIds: ['sushi'] }))).toBe(false);
    expect(stationHasItems(items, station({ categoryIds: ['drinks'] }))).toBe(true);
    expect(stationHasItems(items, station())).toBe(true);
  });
});

describe('what each kind of slip carries', () => {
  it('keeps money off the kitchen ticket', () => {
    // Noise to a cook, and a slip that ends up in a customer's bag showing
    // what the restaurant was paid.
    expect(stationShowsPrices(STATION_KIND.KITCHEN)).toBe(false);
    expect(stationShowsPrices(STATION_KIND.CUSTOMER)).toBe(true);
    expect(stationShowsPrices(STATION_KIND.COUNTER)).toBe(true);
  });

  it('keeps the address off the kitchen ticket too', () => {
    expect(stationShowsAddress(STATION_KIND.KITCHEN)).toBe(false);
    expect(stationShowsAddress(STATION_KIND.CUSTOMER)).toBe(true);
  });
});

describe('reading what was stored', () => {
  it('treats an absent field as no stations', () => {
    // Which the printer turns into the single whole receipt it printed before
    // any of this existed — NOT into "printing is off".
    expect(normaliseStations(undefined)).toEqual([]);
    expect(normaliseStations(null)).toEqual([]);
    expect(normaliseStations('kitchen')).toEqual([]);
  });

  it('drops a station that could not be drawn', () => {
    expect(
      normaliseStations([
        { id: '', name: 'No id', kind: 'KITCHEN' },
        { id: 'st_2', name: '', kind: 'KITCHEN' },
        null,
        'nonsense',
      ]),
    ).toEqual([]);
  });

  it('keeps the first of a duplicated id', () => {
    // Two stations with one id would make the auto-print setting ambiguous and
    // the React list unstable.
    const kept = normaliseStations([
      { id: 'st_1', name: 'First', kind: 'KITCHEN', categoryIds: [], autoPrint: true },
      { id: 'st_1', name: 'Second', kind: 'COUNTER', categoryIds: [], autoPrint: false },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe('First');
  });

  it('falls back to a counter slip for an unknown kind', () => {
    // A kind nothing knows how to draw would render an empty slip.
    const kept = normaliseStations([{ id: 'st_1', name: 'X', kind: 'GRILL_MASTER' }]);
    expect(kept[0].kind).toBe(STATION_KIND.COUNTER);
  });

  it('never returns more than the cap', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `st_${index}`,
      name: `Slip ${index}`,
      kind: 'KITCHEN',
    }));
    expect(normaliseStations(many)).toHaveLength(MAX_PRINT_STATIONS);
  });

  it('treats autoPrint strictly', () => {
    // Anything but `true` is off. A truthy string from an old document must not
    // start a printer running on its own.
    expect(normaliseStations([{ id: 'a', name: 'A', autoPrint: 'yes' }])[0].autoPrint).toBe(false);
    expect(normaliseStations([{ id: 'a', name: 'A', autoPrint: true }])[0].autoPrint).toBe(true);
  });

  it('starts a restaurant with one full counter slip', () => {
    const [first] = defaultStations();
    expect(first.kind).toBe(STATION_KIND.COUNTER);
    expect(first.categoryIds).toEqual([]);
    expect(first.autoPrint).toBe(false);
  });
});

describe('a dish always comes out somewhere', () => {
  /*
   * THE SILENT FAILURE THIS BLOCK EXISTS FOR.
   *
   * Every dish belongs to exactly one menu category. A station carries the
   * categories it was given. So a restaurant that routes EVERY slip and forgets
   * one section — a "Salatlar" added next month — would have those dishes land
   * on no slip at all, with nothing on any screen saying so. The kitchen never
   * sees them and the first anybody hears is a customer ringing.
   */
  const kitchen = station({ id: 'k', name: 'Mətbəx', categoryIds: ['kebab'] });
  const bar = station({ id: 'b', name: 'Bar', categoryIds: ['drinks'] });

  it('routes each item to the slip that claims its category', () => {
    const slips = slipsFor([{ categoryId: 'kebab' }, { categoryId: 'drinks' }], [kitchen, bar]);
    expect(slips.map((slip) => slip.station.id)).toEqual(['k', 'b']);
    expect(slips[0].items).toHaveLength(1);
    expect(slips[1].items).toHaveLength(1);
  });

  it('puts an item no slip claims onto the first one', () => {
    // Not where it belongs, and not meant to be — it is the visible place
    // somebody notices and goes and fixes the routing.
    const slips = slipsFor([{ categoryId: 'salads' }], [kitchen, bar]);
    expect(slips).toHaveLength(1);
    expect(slips[0].station.id).toBe('k');
    expect(slips[0].items).toHaveLength(1);
  });

  it('never loses an item, whatever the routing', () => {
    const items = [
      { categoryId: 'kebab' },
      { categoryId: 'drinks' },
      { categoryId: 'salads' },
      { categoryId: null },
    ];
    const printed = slipsFor(items, [kitchen, bar]).flatMap((slip) => slip.items);
    // Every single line reaches paper. This is the assertion that matters most
    // in this file.
    expect(new Set(printed).size).toBe(items.length);
  });

  it('reaches the orphan rule only when every slip is routed', () => {
    // The common shape — a counter slip carrying everything — never gets here.
    const counter = station({ id: 'c', name: 'Kassa', categoryIds: [] });
    const slips = slipsFor([{ categoryId: 'salads' }], [kitchen, counter]);
    expect(slips.map((slip) => slip.station.id)).toEqual(['c']);
  });

  it('drops the slips that would have come out blank', () => {
    const slips = slipsFor([{ categoryId: 'kebab' }], [kitchen, bar]);
    expect(slips.map((slip) => slip.station.id)).toEqual(['k']);
  });

  it('prints nothing at all when no stations are configured', () => {
    // The caller turns this into the single whole receipt.
    expect(slipsFor([{ categoryId: 'kebab' }], [])).toEqual([]);
  });
});

describe('warning about a section that would print nowhere', () => {
  const kitchen = station({ id: 'k', name: 'Mətbəx', categoryIds: ['kebab'] });
  const bar = station({ id: 'b', name: 'Bar', categoryIds: ['drinks'] });

  it('names the sections no slip carries', () => {
    expect(uncoveredCategoryIds(['kebab', 'drinks', 'salads'], [kitchen, bar])).toEqual(['salads']);
  });

  it('says nothing while any slip is unrouted', () => {
    const counter = station({ id: 'c', name: 'Kassa', categoryIds: [] });
    expect(uncoveredCategoryIds(['kebab', 'salads'], [kitchen, counter])).toEqual([]);
  });

  it('says nothing when no stations exist', () => {
    expect(uncoveredCategoryIds(['kebab'], [])).toEqual([]);
  });

  it('is shown on the settings screen, by name', () => {
    const editor = fs.readFileSync('src/components/restaurant/PrintStationEditor.tsx', 'utf8');
    expect(editor).toContain('uncoveredCategoryIds');
    expect(editor).toContain('printStations.uncovered');
  });
});

describe('the printer prints them one at a time', () => {
  const receipt = fs.readFileSync('src/components/restaurant/Receipt.tsx', 'utf8');

  it('advances on afterprint rather than on a timer', () => {
    // `window.print()` is modal. Calling it twice in a row either loses the
    // second job or prints the first slip twice, and a timeout is a guess that
    // prints one station's items onto another station's paper.
    expect(receipt).toContain("window.addEventListener('afterprint', done)");
  });

  it('resolves the slips through the one shared function', () => {
    // Routing, orphans and empty slips interact; combining them by hand here
    // is how an item would eventually be lost.
    expect(receipt).toContain('slipsFor(order.items, stations ?? [])');
  });

  it('falls back to one whole receipt when nothing is configured', () => {
    expect(receipt).toContain('resolved.length > 0 ? resolved : [{}]');
  });

  it('replaces the slip rather than patching one into another', () => {
    expect(receipt).toContain("key={current?.station?.id ?? 'whole'}");
  });
});

describe('the order carries what the routing needs', () => {
  it('freezes the category onto every ordered item', () => {
    // Looking it up from the product at print time would mean a ticket that
    // changes when the menu is reorganised, and no category at all for a dish
    // that has since been deleted.
    const pricing = fs.readFileSync('shared/pricing.ts', 'utf8');
    expect(pricing).toContain('categoryId: product.categoryId ?? null');
  });

  it('is validated by the same function the panel renders through', () => {
    const onboarding = fs.readFileSync('functions/src/restaurants/onboarding.ts', 'utf8');
    expect(onboarding).toContain('update.printStations = normaliseStations(data.printStations)');
  });
});

describe('a restaurant with one printer has to do nothing', () => {
  const panel = fs.readFileSync('src/app/panel/page.tsx', 'utf8');
  const editor = fs.readFileSync('src/components/restaurant/PrintStationEditor.tsx', 'utf8');

  it('keeps the old behaviour when nothing is configured', () => {
    // Accepting an order still prints one full receipt, exactly as before
    // stations existed. Configuring them is opt-in and per restaurant.
    expect(panel).toContain('stations.length === 0 || auto.length > 0');
  });

  it('turns auto-print ON for a newly added slip', () => {
    // Off by default would mean a restaurant configures a kitchen slip, accepts
    // an order, and gets no paper at all — the feature looking broken in the
    // direction that costs them a meal.
    expect(editor).toContain('autoPrint: true');
  });

  it('says so when nothing would print automatically', () => {
    expect(editor).toContain('printStations.noneAuto');
  });
});

describe('the panel says what a browser cannot do', () => {
  const editor = fs.readFileSync('src/components/restaurant/PrintStationEditor.tsx', 'utf8');

  it('warns on the screen, not in a help page nobody opens', () => {
    // A restaurant reading this screen is a restaurant about to buy a second
    // printer. Finding out afterwards is the worst possible moment.
    expect(editor).toContain("printStations.limitTitle");
    expect(editor).toContain("printStations.kioskBody");
  });
});
