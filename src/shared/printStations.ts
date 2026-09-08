/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Printing one order in more than one place.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * THE HONEST CONSTRAINT, FIRST
 * ----------------------------
 * A web page cannot choose which physical printer a job goes to. There is no
 * browser API for it and there is not going to be one: `window.print()` hands
 * the page to the operating system, and the operating system decides. Anybody
 * who tells you otherwise is describing a native application or a local print
 * server.
 *
 * So this is not "software that talks to three printers". It is the half of the
 * problem software CAN solve — deciding what belongs on each slip — plus a
 * setup, written down in the panel, that makes the browser send each slip to a
 * different machine.
 *
 * HOW A RESTAURANT ACTUALLY GETS THREE PRINTERS WORKING
 * ----------------------------------------------------
 * Chrome, launched with `--kiosk-printing`, prints silently to whatever is set
 * as the default printer, with no dialogue. One Chrome PROFILE per station,
 * each with its own default printer, each open on the panel, and each set to
 * auto-print its own station. The grill window prints the grill slip; the bar
 * window prints the bar slip; neither shows a dialogue and nobody presses
 * anything. That is how every web-based till system in the world does this.
 *
 * Without kiosk mode it still works — it just shows the print dialogue, and
 * whoever is standing there picks the printer. Which is the state the platform
 * was in before this file: one slip, one dialogue, one printer.
 *
 * WHAT A STATION IS
 * -----------------
 * A name, a kind of slip, and the menu categories whose items belong on it.
 *
 * The categories are the interesting part. A grill station's slip should carry
 * the kebabs and nothing else — a cook reading a ticket with the drinks on it
 * is reading past four lines that are not theirs, at the busiest moment of the
 * evening, which is exactly when a line gets missed.
 */

/** What a slip is FOR, which decides what goes on it. */
export const STATION_KIND = {
  /**
   * A cook's ticket. Items, quantities, notes. NO PRICES.
   *
   * Money on a kitchen ticket is noise at best; at worst it is a slip that
   * ends up in a customer's bag showing what the restaurant paid attention to.
   * Big type, because it is read at arm's length under a hot lamp.
   */
  KITCHEN: 'KITCHEN',
  /** The customer's receipt: everything, with prices and the address. */
  CUSTOMER: 'CUSTOMER',
  /**
   * The counter's copy — the whole order, prices included, for the person
   * packing the bag and checking it against what the kitchen sent out.
   */
  COUNTER: 'COUNTER',
} as const;

export type StationKind = (typeof STATION_KIND)[keyof typeof STATION_KIND];

export const STATION_KINDS = [
  STATION_KIND.KITCHEN,
  STATION_KIND.CUSTOMER,
  STATION_KIND.COUNTER,
] as const;

/**
 * How many stations one restaurant may define.
 *
 * Four. A kitchen, a grill, a bar and a counter is a large restaurant; beyond
 * that the slips are being used for something this was not built for, and each
 * one is a browser window somebody has to keep open.
 */
export const MAX_PRINT_STATIONS = 4;

export const STATION_NAME_MAX = 24;

export interface PrintStation {
  /** Stable across renames — the auto-print setting is keyed on it. */
  id: string;
  name: string;
  kind: StationKind;
  /**
   * Menu category ids whose items belong on this slip.
   *
   * EMPTY MEANS EVERYTHING, and that is the important default. A restaurant
   * that has not thought about routing gets complete slips rather than blank
   * ones — the failure mode of "empty means nothing" is a cook staring at a
   * ticket with no food on it, which is worse than a ticket with too much.
   */
  categoryIds: string[];
  /**
   * Print this station automatically when an order is accepted.
   *
   * Per station, because the answer differs: the kitchen wants its ticket the
   * instant the order is taken, and the customer's receipt is wanted when the
   * bag is packed.
   */
  autoPrint: boolean;
}

/** What a restaurant starts with: one counter slip, everything on it. */
export function defaultStations(): PrintStation[] {
  return [
    {
      id: 'counter',
      name: 'Kassa',
      kind: STATION_KIND.COUNTER,
      categoryIds: [],
      autoPrint: false,
    },
  ];
}

/**
 * Which items belong on this station's slip.
 *
 * `categoryIds` empty means every item — see the note on the field. Use
 * `slipsFor` rather than calling this directly: on its own it cannot know about
 * an item that belongs to NO station, which is the failure worth guarding.
 */
export function itemsForStation<T extends { categoryId?: string | null }>(
  items: T[],
  station: Pick<PrintStation, 'categoryIds'>,
): T[] {
  if (station.categoryIds.length === 0) return items;
  return items.filter((item) => item.categoryId && station.categoryIds.includes(item.categoryId));
}

/** Does this station have anything to print for this order? */
export function stationHasItems<T extends { categoryId?: string | null }>(
  items: T[],
  station: Pick<PrintStation, 'categoryIds'>,
): boolean {
  return itemsForStation(items, station).length > 0;
}

/**
 * The slips to print for one order, in order, with what goes on each.
 *
 * ONE FUNCTION BECAUSE THE THREE RULES HAVE TO BE APPLIED TOGETHER
 * ---------------------------------------------------------------
 * Routing, orphans and empties interact, and a caller combining them by hand
 * would eventually get the order wrong. In particular:
 *
 * THE ORPHAN RULE, WHICH IS THE WHOLE REASON THIS EXISTS.
 *
 * Every dish belongs to exactly one menu category, and a station carries the
 * categories it was given. So if a restaurant routes EVERY station and forgets
 * one category — a new "Salatlar" section added next month, say — the dishes in
 * it would land on no slip at all. Nothing on screen would say so. The kitchen
 * would simply never see them, and the first anybody hears of it is a customer
 * ringing about a salad that never came.
 *
 * So an item that no station claims is appended to the FIRST slip. That is not
 * where it belongs, and it is not meant to be: it is the loud, visible place
 * where somebody notices and goes and fixes the routing. `uncoveredCategoryIds`
 * is what tells them before it ever comes to that.
 *
 * A restaurant with an unrouted station — which is the common shape, because
 * the counter slip usually carries everything — never reaches this rule at all.
 */
export function slipsFor<T extends { categoryId?: string | null }>(
  items: T[],
  stations: PrintStation[],
): Array<{ station: PrintStation; items: T[] }> {
  if (stations.length === 0) return [];

  const claimed = new Set<T>();
  const slips = stations.map((station) => {
    const mine = itemsForStation(items, station);
    for (const item of mine) claimed.add(item);
    return { station, items: mine };
  });

  const orphans = items.filter((item) => !claimed.has(item));
  if (orphans.length > 0) slips[0] = { ...slips[0], items: [...slips[0].items, ...orphans] };

  // An empty slip is a blank ticket on the pile, and a real one gets thrown
  // away with them.
  return slips.filter((slip) => slip.items.length > 0);
}

/**
 * Menu categories that would print nowhere.
 *
 * Empty whenever any station is unrouted, because an unrouted station carries
 * everything. Non-empty means the restaurant has routed every slip and left a
 * section out — the editor says which, by name, before it costs anybody a
 * dinner.
 */
export function uncoveredCategoryIds(
  categoryIds: string[],
  stations: PrintStation[],
): string[] {
  if (stations.length === 0) return [];
  if (stations.some((station) => station.categoryIds.length === 0)) return [];

  const covered = new Set(stations.flatMap((station) => station.categoryIds));
  return categoryIds.filter((id) => !covered.has(id));
}

/** Prices belong on every slip except the kitchen's. */
export function stationShowsPrices(kind: StationKind): boolean {
  return kind !== STATION_KIND.KITCHEN;
}

/** The delivery address belongs on the slips that travel with the food. */
export function stationShowsAddress(kind: StationKind): boolean {
  return kind !== STATION_KIND.KITCHEN;
}

/**
 * Whatever was stored, reduced to something safe to render.
 *
 * Runs on the server when a restaurant saves and on the screen when one is
 * read, because a settings document written by an older version — or by hand —
 * must not be able to produce a station with no name, no id, or a `kind` that
 * no slip knows how to draw.
 *
 * An empty result means "no stations configured", and the panel treats that as
 * the single default counter slip rather than as "printing is off".
 */
export function normaliseStations(values: unknown): PrintStation[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const kept: PrintStation[] = [];

  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const raw = value as Partial<PrintStation>;

    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 40) : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, STATION_NAME_MAX) : '';
    if (!id || !name) continue;

    // A duplicate id would make the auto-print setting ambiguous and the React
    // list unstable. The first wins.
    if (seen.has(id)) continue;
    seen.add(id);

    const kind = (STATION_KINDS as readonly string[]).includes(raw.kind as string)
      ? (raw.kind as StationKind)
      : STATION_KIND.COUNTER;

    const categoryIds = Array.isArray(raw.categoryIds)
      ? [
          ...new Set(
            raw.categoryIds.filter(
              (entry): entry is string => typeof entry === 'string' && entry.length > 0,
            ),
          ),
        ].slice(0, 60)
      : [];

    kept.push({ id, name, kind, categoryIds, autoPrint: raw.autoPrint === true });

    if (kept.length >= MAX_PRINT_STATIONS) break;
  }

  return kept;
}

/** A new station's id. Readable, unique enough, and stable once written. */
export function newStationId(): string {
  return `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
