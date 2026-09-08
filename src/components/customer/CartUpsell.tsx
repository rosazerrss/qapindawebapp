'use client';

/**
 * "You can add these too" — the drink and the sauce.
 *
 * Somebody who has already chosen a kebab and is looking at the total is
 * exactly the person who wants a Coke with it, and going back to the menu to
 * find one is enough friction that most people do not bother. That is a worse
 * basket for the restaurant and a worse dinner for the customer, for no reason
 * except that the app did not ask.
 *
 * WHAT IT OFFERS, AND WHY
 * -----------------------
 * Whatever the basket is missing, from the restaurant the basket already
 * belongs to. The matching itself is a rule about food rather than about a row
 * of cards, so it lives in `/shared/upsell.ts` where it has tests: this file
 * shapes the menu into candidates, hands them over, and draws the answer.
 *
 * A dish that is already in the basket stays in the row, showing how many are
 * in there. It used to disappear on the tap that added it — the card vanished
 * under the customer's thumb, the rest slid left, and a second Coke meant
 * walking back to the menu for it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { Money, cn } from '@/components/ui';
import { useCart } from '@/contexts/CartContext';
import { useT } from '@/i18n';
import { watchMenu, type MenuSection } from '@/services/catalog';
import { ProductAvailability } from '@/shared/enums';
import { rankUpsellSuggestions, type UpsellCandidate } from '@/shared/upsell';
import type { Product } from '@/shared/models';
import { Img } from '@/components/ui/Img';

/** More than this and the row becomes a second menu to read. */
const MAX_SUGGESTIONS = 8;

export function CartUpsell({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const t = useT();
  const cart = useCart();

  const [sections, setSections] = useState<MenuSection[] | null>(null);

  useEffect(() => {
    return watchMenu(restaurantId, setSections);
  }, [restaurantId]);

  // The section name travels with every dish, because it is the strongest hint
  // the menu carries: a restaurant that has a section called «İçkilər» has
  // already told us which of its lines are drinks.
  const candidates = useMemo<Array<UpsellCandidate & { product: Product }>>(
    () =>
      (sections ?? []).flatMap((section) =>
        section.products.map((product) => ({
          id: product.id,
          name: product.name,
          price: product.price,
          popular: product.popular,
          available: product.availability === ProductAvailability.AVAILABLE,
          hasOptions: (product.modifierGroups?.length ?? 0) > 0,
          categoryName: section.category.name,
          product,
        })),
      ),
    [sections],
  );

  const basketLines = useMemo(
    () =>
      cart.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
      })),
    [cart.lines],
  );

  const suggestions = useMemo(
    () => rankUpsellSuggestions(candidates, basketLines, { limit: MAX_SUGGESTIONS }),
    [candidates, basketLines],
  );

  // Nothing worth suggesting is a normal outcome — a kebab shop with no drinks
  // on the menu should show an empty space, not an empty heading.
  if (suggestions.length === 0) return null;

  // The basket already belongs to this restaurant — that is the only reason
  // this row is on screen — so `add` cannot hit its one-restaurant guard.
  const add = (product: Product) => {
    cart.add(product, restaurantName, [], 1);
  };

  return (
    <section className="mt-6" aria-labelledby="cart-upsell">
      <h2 id="cart-upsell" className="mb-2.5 text-sm font-medium text-ink-700">
        {t('cart.alsoAdd')}
      </h2>

      {/* A scrolling row rather than a grid: it must read as an afterthought
          beside the basket, not as a second basket competing with it. */}
      <ul className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
        {suggestions.map(({ candidate, inBasket }) => {
          const { product } = candidate;

          return (
            <li key={candidate.id} className="w-36 shrink-0">
              <button
                type="button"
                onClick={() => add(product)}
                aria-label={
                  inBasket > 0
                    ? t('cart.inCart', { name: product.name, count: inBasket })
                    : t('cart.addNamed', { name: product.name })
                }
                className={cn(
                  'flex h-full w-full flex-col rounded-2xl border bg-white p-2.5 text-left transition',
                  inBasket > 0
                    ? 'border-brand-300 bg-brand-50/50'
                    : 'border-card-edge hover:border-brand-200 hover:shadow-sm',
                )}
              >
                <span className="relative mb-2 block">
                  {product.imageUrl ? (
                     
                    <Img
                      src={product.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-20 w-full rounded-xl object-cover"
                    />
                  ) : (
                    <span aria-hidden className="block h-20 w-full rounded-xl bg-ink-50" />
                  )}

                  {/* What is already in the basket, said on the card itself —
                      so tapping again is obviously "one more", not "again?". */}
                  {inBasket > 0 && (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold tabular-nums text-white shadow"
                    >
                      {inBasket}
                    </span>
                  )}
                </span>

                <span className="line-clamp-2 flex-1 text-sm font-medium text-ink-900">
                  {product.name}
                </span>

                <span className="mt-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-900">
                    <Money amount={product.price} />
                  </span>
                  <span
                    aria-hidden
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white"
                  >
                    <Plus size={16} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
