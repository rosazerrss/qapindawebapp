'use client';

/**
 * The cart.
 *
 * Held in the browser, on purpose. A guest must be able to fill a cart before
 * they have an account — that is the flow the brief asked for — and a cart is
 * not worth a Firestore write per tap.
 *
 * Prices here are for display only. The server recomputes every figure at
 * checkout from its own menu, so a stale or edited cart cannot change what
 * anything costs. What is stored is a shopping list, not a bill.
 *
 * The state lives in a module-level store read through `useSyncExternalStore`
 * rather than in an effect. That gives the right server snapshot for hydration,
 * and it means two open tabs stay in step instead of quietly overwriting each
 * other's cart.
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type { ModifierGroup, Product } from '@/shared/models';

const STORAGE_KEY = 'qapinda_cart_v1';

export interface CartLine {
  /** Distinguishes the same dish ordered twice with different options. */
  lineId: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  selectedOptionIds: string[];
  optionLabels: string[];
  optionsTotal: number;
  note: string | null;
}

export interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
}

const EMPTY: CartState = { restaurantId: null, restaurantName: null, lines: [] };

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let cache: CartState = EMPTY;
let cachedRaw: string | null = null;
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  // Another tab changing the cart must reach this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Must return a referentially stable value while nothing changed, or
 * `useSyncExternalStore` re-renders forever — hence the parsed-value cache.
 */
function snapshot(): CartState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private window with storage disabled: the cart lives in memory only.
    return cache;
  }

  if (raw === cachedRaw) return cache;
  cachedRaw = raw;

  if (!raw) {
    cache = EMPTY;
    return cache;
  }

  try {
    const parsed = JSON.parse(raw) as CartState;
    cache = Array.isArray(parsed.lines) ? parsed : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

/** The server has no cart. Rendering empty keeps the first paint consistent. */
function serverSnapshot(): CartState {
  return EMPTY;
}

function write(next: CartState): void {
  cache = next;
  try {
    cachedRaw = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    cachedRaw = null;
  }
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineKey(productId: string, optionIds: string[], note: string | null): string {
  return `${productId}::${[...optionIds].sort().join(',')}::${note ?? ''}`;
}

function describeOptions(
  groups: ModifierGroup[] | undefined,
  selected: string[],
): { labels: string[]; total: number } {
  const chosen = new Set(selected);
  const labels: string[] = [];
  let total = 0;

  for (const group of groups ?? []) {
    for (const option of group.options) {
      if (!chosen.has(option.id)) continue;
      labels.push(option.name);
      total += option.priceDelta;
    }
  }
  return { labels, total };
}

function buildLine(
  product: Product,
  selectedOptionIds: string[],
  quantity: number,
  note: string | null,
): CartLine {
  const { labels, total } = describeOptions(product.modifierGroups, selectedOptionIds);
  return {
    lineId: lineKey(product.id, selectedOptionIds, note),
    productId: product.id,
    name: product.name,
    unitPrice: product.price,
    quantity,
    imageUrl: product.imageUrl,
    selectedOptionIds,
    optionLabels: labels,
    optionsTotal: total,
    note,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CartValue extends CartState {
  itemCount: number;
  /** Indicative only — the server's number is the one that counts. */
  estimatedSubtotal: number;
  add: (
    product: Product,
    restaurantName: string,
    selectedOptionIds: string[],
    quantity: number,
    note?: string | null,
  ) => { ok: boolean; conflict?: boolean };
  setQuantity: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  /** Empties the cart and adds the dish that caused the clash. */
  replaceWith: (
    product: Product,
    restaurantName: string,
    selectedOptionIds: string[],
    quantity: number,
    note?: string | null,
  ) => void;
  /**
   * Rebuilds the basket from a past order. Replaces the current contents.
   *
   * Takes whole `Product` documents rather than ids so the lines carry today's
   * price and today's options — see `prepareReorder`, which is what resolves an
   * old order against the live menu.
   */
  fillFrom: (
    restaurantId: string,
    restaurantName: string,
    lines: Array<{ product: Product; selectedOptionIds: string[]; quantity: number }>,
  ) => void;
  /** False during the server render and the first client paint. */
  hydrated: boolean;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const add = useCallback<CartValue['add']>(
    (product, restaurantName, selectedOptionIds, quantity, note = null) => {
      const current = snapshot();

      // One order, one restaurant. Mixing them would make delivery fees,
      // minimums and commission meaningless.
      if (current.restaurantId && current.restaurantId !== product.restaurantId) {
        return { ok: false, conflict: true };
      }

      const line = buildLine(product, selectedOptionIds, quantity, note);
      const existing = current.lines.find((entry) => entry.lineId === line.lineId);

      write({
        restaurantId: product.restaurantId,
        restaurantName,
        lines: existing
          ? current.lines.map((entry) =>
              entry.lineId === line.lineId
                ? { ...entry, quantity: Math.min(30, entry.quantity + quantity) }
                : entry,
            )
          : [...current.lines, line],
      });

      return { ok: true };
    },
    [],
  );

  const replaceWith = useCallback<CartValue['replaceWith']>(
    (product, restaurantName, selectedOptionIds, quantity, note = null) => {
      write({
        restaurantId: product.restaurantId,
        restaurantName,
        lines: [buildLine(product, selectedOptionIds, quantity, note)],
      });
    },
    [],
  );

  /**
   * Fills the basket from a past order, replacing whatever was in it.
   *
   * Replacing rather than merging, because a reorder is "give me that again"
   * and a basket that quietly grows by six items somebody had forgotten they
   * left in it is not that. The one-restaurant rule makes it necessary anyway:
   * two restaurants in one cart is refused everywhere else in this file.
   *
   * The products come from `prepareReorder`, which resolved them against
   * tonight's menu — so the prices and the option lists here are today's, not
   * the old order's. Nothing about the photograph reaches the cart.
   */
  const fillFrom = useCallback<CartValue['fillFrom']>(
    (restaurantId, restaurantName, lines) => {
      const built = lines
        .filter((line) => line.quantity > 0)
        .map((line) => buildLine(line.product, line.selectedOptionIds, line.quantity, null));

      if (built.length === 0) return;
      write({ restaurantId, restaurantName, lines: built });
    },
    [],
  );

  const setQuantity = useCallback((lineId: string, quantity: number) => {
    const current = snapshot();

    const lines =
      quantity <= 0
        ? current.lines.filter((line) => line.lineId !== lineId)
        : current.lines.map((line) =>
            line.lineId === lineId ? { ...line, quantity: Math.min(30, quantity) } : line,
          );

    write(lines.length === 0 ? EMPTY : { ...current, lines });
  }, []);

  const remove = useCallback((lineId: string) => setQuantity(lineId, 0), [setQuantity]);
  const clear = useCallback(() => write(EMPTY), []);

  const value = useMemo<CartValue>(() => {
    const itemCount = state.lines.reduce((sum, line) => sum + line.quantity, 0);
    const estimatedSubtotal = state.lines.reduce(
      (sum, line) => sum + (line.unitPrice + line.optionsTotal) * line.quantity,
      0,
    );

    return {
      ...state,
      itemCount,
      estimatedSubtotal,
      add,
      setQuantity,
      remove,
      clear,
      replaceWith,
      fillFrom,
      hydrated,
    };
  }, [state, add, setQuantity, remove, clear, replaceWith, fillFrom, hydrated]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
