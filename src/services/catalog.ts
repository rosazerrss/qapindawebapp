'use client';

/**
 * Reading the shopfront.
 *
 * Every query here is bounded and indexed — an unbounded `collection().get()`
 * on a growing catalogue is a bill that arrives quietly.
 *
 * These are direct Firestore reads rather than callables because the data is
 * public: the security rules already say only ACTIVE restaurants and visible
 * dishes are readable, so there is nothing a function would add except latency.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { COLLECTIONS, paths } from '@/shared/collections';
import { isOpenByHours } from '@/shared/hours';
import { ProductAvailability, RestaurantStatus, ServiceState } from '@/shared/enums';
import type { MenuCategory, Order, Product, Restaurant } from '@/shared/models';

/**
 * How many restaurants the shopfront holds.
 *
 * THE OLD NUMBER WAS SIXTY, AND IT MADE EVERY FILTER LIE.
 *
 * The list was capped at the sixty best-rated restaurants and every filter and
 * sort then ran in the browser on top of that. So "ən ucuz çatdırılma" did not
 * mean the cheapest delivery in the city — it meant the cheapest among the
 * sixty best-rated — and the sixty-first restaurant was unreachable by any
 * filter at all, findable only by searching for it by name. A customer using a
 * sort to make a decision was being shown a confident answer to a question they
 * had not asked.
 *
 * Three hundred covers the whole active catalogue several times over at the
 * size this platform is and will be for a long time, so the filters now run
 * over everything and mean what they say. It is still a ceiling rather than an
 * unbounded read, because an unbounded live subscription is the one thing that
 * cannot be allowed to grow with the platform — and `truncated` below is how
 * the screen finds out it has hit it, instead of silently believing it has
 * seen everything.
 *
 * When the catalogue does outgrow this, the replacement is a server-side list
 * endpoint that filters and sorts before it answers. The shape here — one
 * query, one cap, an explicit truncation flag — is what it would replace.
 */
export const CATALOG_LIMIT = 300;

/**
 * Active restaurants, optionally in one region.
 *
 * The `status == ACTIVE` filter is not just a convenience: the security rule
 * proves the query safe *because* of it. Dropping it would get the whole query
 * denied, not silently widened.
 */
export async function listRestaurants(regionId?: string): Promise<Restaurant[]> {
  const db = firestore();
  if (!db) return [];

  const constraints = [
    where('status', '==', RestaurantStatus.ACTIVE),
    ...(regionId ? [where('regionId', '==', regionId)] : []),
    orderBy('ratingAverage', 'desc'),
    limitTo(CATALOG_LIMIT),
  ];

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.restaurants), ...constraints));
  return snapshot.docs.map((entry) => entry.data() as Restaurant);
}

/**
 * The public URL of a restaurant.
 *
 * `donerci-baku-x7Kq2mN...` — a readable slug for the person, the document id
 * for the machine. Two restaurants may legitimately be called the same thing;
 * the id is what makes the address unambiguous, and it is read from the end of
 * the last hyphen so a renamed restaurant's old links still resolve.
 *
 * This is *not* a security measure. The page is public on purpose — a customer
 * has to be able to find it. What protects the data is the security rules.
 */
export function restaurantHandle(restaurant: Pick<Restaurant, 'slug' | 'id'>): string {
  return `${restaurant.slug}-${restaurant.id}`;
}

export function restaurantHref(restaurant: Pick<Restaurant, 'slug' | 'id'>): string {
  return `/restaurant/${restaurantHandle(restaurant)}`;
}

/** Pulls the document id back out of a handle. */
export function idFromHandle(handle: string): string {
  const cut = handle.lastIndexOf('-');
  return cut === -1 ? handle : handle.slice(cut + 1);
}

export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const db = firestore();
  if (!db) return null;

  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.restaurants),
      where('slug', '==', slug),
      limitTo(1),
    ),
  );
  return snapshot.empty ? null : (snapshot.docs[0].data() as Restaurant);
}

export async function getRestaurant(restaurantId: string): Promise<Restaurant | null> {
  const db = firestore();
  if (!db) return null;
  const snapshot = await getDoc(doc(db, paths.restaurant(restaurantId)));
  return snapshot.exists() ? (snapshot.data() as Restaurant) : null;
}

/**
 * THE RULE THAT BITES HERE
 * ------------------------
 * Firestore evaluates security rules against the *query*, not against each
 * document it would return. `menuCategories` is readable when `visible == true`,
 * and `products` when `availability != 'HIDDEN'` — so a query that does not say
 * so cannot be proven safe, and the whole query is refused. Not filtered:
 * refused.
 *
 * That is why a customer saw the restaurant but an empty menu while the owner
 * saw everything: `ownsRestaurant` satisfied the rule for one of them and not
 * the other. The queries below therefore carry the same conditions the rules
 * check, and only the owner's `includeHidden` path omits them.
 */
export interface MenuSection {
  category: MenuCategory;
  products: Product[];
}

/**
 * The whole menu in two queries.
 *
 * Hidden dishes are dropped here rather than in the query, because a restaurant
 * viewing its own menu needs to see them — the caller decides.
 */
/**
 * The category half of the menu query.
 *
 * A visitor must ask only for visible categories, because that is the exact
 * condition the security rule can prove. The owner asks for everything, and the
 * rule lets them through on ownership instead.
 */
function categoryQuery(restaurantId: string, includeHidden: boolean) {
  return includeHidden
    ? [where('restaurantId', '==', restaurantId), orderBy('sortOrder', 'asc'), limitTo(60)]
    : [
        where('restaurantId', '==', restaurantId),
        where('visible', '==', true),
        orderBy('sortOrder', 'asc'),
        limitTo(60),
      ];
}

/**
 * The dish half.
 *
 * The inequality has to be in the query for the rule to accept it, and
 * Firestore then insists the first ordering is on that same field — hence
 * `orderBy('availability')` before `sortOrder`. The visual order the customer
 * sees is restored when the sections are assembled.
 */
function productQuery(restaurantId: string, includeHidden: boolean) {
  return includeHidden
    ? [where('restaurantId', '==', restaurantId), orderBy('sortOrder', 'asc'), limitTo(400)]
    : [
        where('restaurantId', '==', restaurantId),
        where('availability', '!=', ProductAvailability.HIDDEN),
        orderBy('availability', 'asc'),
        orderBy('sortOrder', 'asc'),
        limitTo(400),
      ];
}

export async function getMenu(
  restaurantId: string,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<MenuSection[]> {
  const db = firestore();
  if (!db) return [];

  const [categoriesSnap, productsSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.menuCategories), ...categoryQuery(restaurantId, includeHidden))),
    getDocs(query(collection(db, COLLECTIONS.products), ...productQuery(restaurantId, includeHidden))),
  ]);

  const products = productsSnap.docs
    .map((entry) => entry.data() as Product)
    .filter((product) => includeHidden || product.availability !== ProductAvailability.HIDDEN)
    // The visitor's query orders by availability first to satisfy the rule;
    // the menu's own order is what belongs on screen.
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const byCategory = new Map<string, Product[]>();
  for (const product of products) {
    const list = byCategory.get(product.categoryId) ?? [];
    list.push(product);
    byCategory.set(product.categoryId, list);
  }

  return categoriesSnap.docs
    .map((entry) => entry.data() as MenuCategory)
    .filter((category) => includeHidden || category.visible)
    .map((category) => ({ category, products: byCategory.get(category.id) ?? [] }))
    .filter((section) => includeHidden || section.products.length > 0);
}

/**
 * Live updates for one restaurant.
 *
 * Used by both the customer's menu page and the panel, so when the kitchen taps
 * "pause", the customer looking at that menu sees it within the second — no
 * refresh, no stale "Add to cart" button that will be refused by the server.
 */
export function watchRestaurant(
  restaurantId: string,
  onChange: (restaurant: Restaurant | null) => void,
  /**
   * Told when the subscription itself failed, as opposed to succeeding and
   * finding nothing. Callers that can carry on without the document ignore it;
   * a screen that would otherwise sit on a spinner must not.
   */
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, paths.restaurant(restaurantId)),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as Restaurant) : null),
    (error) => {
      onChange(null);
      onError?.(error);
    },
  );
}

/**
 * Live updates for the whole menu.
 *
 * Two subscriptions, one merged result: a price change or a dish marked "sold
 * out today" reaches every open menu immediately. The panel uses the same
 * function with `includeHidden`, so an edit appears in the editor without a
 * reload — the screen never has to guess whether its own write landed.
 */
export function watchMenu(
  restaurantId: string,
  onChange: (sections: MenuSection[]) => void,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  let categories: MenuCategory[] | null = null;
  let products: Product[] | null = null;

  // Emit only once both halves have arrived, so the screen never flashes a
  // menu with categories but no dishes.
  const emit = () => {
    if (!categories || !products) return;

    const visible = products
      .filter((product) => includeHidden || product.availability !== ProductAvailability.HIDDEN)
      // The customer query is ordered by availability first for the rule's sake;
      // what the reader should see is the menu's own order.
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const byCategory = new Map<string, Product[]>();
    for (const product of visible) {
      const list = byCategory.get(product.categoryId) ?? [];
      list.push(product);
      byCategory.set(product.categoryId, list);
    }

    onChange(
      categories
        .filter((category) => includeHidden || category.visible)
        .map((category) => ({ category, products: byCategory.get(category.id) ?? [] }))
        .filter((section) => includeHidden || section.products.length > 0),
    );
  };

  const stopCategories = onSnapshot(
    query(collection(db, COLLECTIONS.menuCategories), ...categoryQuery(restaurantId, includeHidden)),
    (snapshot) => {
      categories = snapshot.docs.map((entry) => entry.data() as MenuCategory);
      emit();
    },
    () => {
      categories = [];
      emit();
    },
  );

  const stopProducts = onSnapshot(
    query(collection(db, COLLECTIONS.products), ...productQuery(restaurantId, includeHidden)),
    (snapshot) => {
      products = snapshot.docs.map((entry) => entry.data() as Product);
      emit();
    },
    () => {
      products = [];
      emit();
    },
  );

  return () => {
    stopCategories();
    stopProducts();
  };
}

/** The shopfront list, live — so a restaurant going offline leaves the grid. */
export function watchRestaurants(
  regionId: string | undefined,
  onChange: (restaurants: Restaurant[], truncated: boolean) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([], false);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.restaurants),
      where('status', '==', RestaurantStatus.ACTIVE),
      ...(regionId ? [where('regionId', '==', regionId)] : []),
      orderBy('ratingAverage', 'desc'),
      limitTo(CATALOG_LIMIT),
    ),
    (snapshot) =>
      onChange(
        snapshot.docs.map((entry) => entry.data() as Restaurant),
        // Hitting the cap exactly is the only signal there is that there may be
        // more. Passed up rather than swallowed, so a screen can say so instead
        // of presenting a truncated list as the whole city.
        snapshot.size >= CATALOG_LIMIT,
      ),
    () => onChange([], false),
  );
}

/**
 * Every restaurant, live — the admin's own list, not the shopfront's.
 *
 * WHY IT IS NOT `watchRestaurants`
 * -------------------------------
 * That one filters to ACTIVE, because a customer must not be offered a
 * restaurant that cannot take the order. An admin attaching a manager to a
 * restaurant is doing the opposite job: the restaurant is very often the one
 * that was approved an hour ago and has not opened yet, or the suspended one
 * whose owner is about to fix whatever caused it. Hiding those is hiding
 * exactly the rows this screen exists to reach.
 *
 * Ordered by name rather than by rating or date, because this is a list
 * somebody reads down looking for a name they already know.
 */
export function watchRestaurantDirectory(
  onChange: (restaurants: Restaurant[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(collection(db, COLLECTIONS.restaurants), orderBy('name'), limitTo(500)),
    (snapshot) =>
      onChange(
        snapshot.docs.map((entry) => {
          // `id` is a field on the document as well as the document's name. A
          // restaurant written before that field existed arrives without it,
          // and everything built from it downstream — the option value that
          // becomes `restaurantId` on a staff account — would be `undefined`.
          const data = entry.data() as Restaurant;
          return data.id ? data : { ...data, id: entry.id };
        }),
      ),
    () => onChange([]),
  );
}

/** Live updates for one order — what the customer's tracking screen watches. */
export function watchOrder(orderId: string, onChange: (order: Order | null) => void): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, paths.order(orderId)),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as Order) : null),
    () => onChange(null),
  );
}

export function watchMyOrders(
  customerId: string,
  onChange: (orders: Order[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.orders),
      where('customerId', '==', customerId),
      orderBy('placedAt', 'desc'),
      limitTo(50),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Order)),
    () => onChange([]),
  );
}

/** The restaurant panel's live queue. */
export function watchRestaurantOrders(
  restaurantId: string,
  statuses: string[],
  onChange: (orders: Order[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.orders),
      where('restaurantId', '==', restaurantId),
      where('status', 'in', statuses.slice(0, 10)),
      orderBy('placedAt', 'desc'),
      limitTo(80),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Order)),
    () => onChange([]),
  );
}

/**
 * One restaurant's most recent orders, whatever state they are in.
 *
 * Used by the admin's restaurant detail, where the question is "what is
 * happening at this shop right now" rather than "what is in the queue". No
 * status filter, so it needs only the (`restaurantId`, `placedAt` DESC) index
 * the panel already relies on — and `failed` is reported separately from an
 * empty list, because "this restaurant has no orders" and "we could not read
 * its orders" must not look the same on an admin's screen.
 */
export function watchLatestRestaurantOrders(
  restaurantId: string,
  max: number,
  onChange: (orders: Order[] | null) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.orders),
      where('restaurantId', '==', restaurantId),
      orderBy('placedAt', 'desc'),
      limitTo(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Order)),
    () => onChange(null),
  );
}

/** Is this restaurant taking orders at this instant? Mirrors the server. */
export function isOpenNow(restaurant: Restaurant, at: Date = new Date()): boolean {
  // Three separate reasons a shop is shut, and only the third is about the
  // clock. Keeping them apart is what lets the clock half live in
  // `shared/hours.ts`, where the server reads the same answer.
  if (restaurant.status !== RestaurantStatus.ACTIVE) return false;
  if (restaurant.serviceState !== ServiceState.OPEN) return false;
  return isOpenByHours(restaurant.openingHours, at);
}
