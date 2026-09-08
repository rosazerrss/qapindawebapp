'use client';

/**
 * "Yenidən sifariş et" — the same again.
 *
 * WHY THERE IS A SHEET AND NOT JUST A BUTTON
 * ------------------------------------------
 * The tempting version of this feature is one tap that fills the basket and
 * sends the customer to checkout. It is also the version that quietly charges
 * them more than they expect: a menu moves between orders, and the dish that
 * cost 8 ₼ last Friday can cost 9 ₼ tonight, be sold out, have lost the "large"
 * option, or be off the menu entirely.
 *
 * Silently adjusting any of those is how somebody ends up paying for a basket
 * they did not agree to. So `prepareReorder` resolves every line against
 * tonight's menu and this shows what changed — plainly, before anything is
 * added — and the customer presses the button knowing. When nothing changed,
 * which is the ordinary case, the sheet says so in one line and the same press
 * carries on.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * Order anything. It fills the basket and opens it. The order is placed on the
 * checkout screen, through the same guard as every other order.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';

import { Alert, Button, Sheet, Money } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { useCart } from '@/contexts/CartContext';
import { prepareReorder } from '@/firebase/callables';
import type { Product } from '@/shared/models';

type LineState = 'OK' | 'PRICE_CHANGED' | 'OPTIONS_CHANGED' | 'UNAVAILABLE' | 'GONE';

interface ReorderLine {
  productId: string;
  name: string;
  quantity: number;
  state: LineState;
  selectedOptionIds: string[];
  previousUnitPrice: number;
  unitPrice: number | null;
  droppedOptions: string[];
}

interface Prepared {
  restaurantId: string;
  restaurantName: string;
  restaurantAvailable: boolean;
  restaurantOpen: boolean;
  lines: ReorderLine[];
  products: Product[];
}

/** The states that can still go in the basket. */
const ADDABLE: LineState[] = ['OK', 'PRICE_CHANGED', 'OPTIONS_CHANGED'];

export function ReorderButton({
  orderId,
  className,
}: {
  orderId: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const cart = useCart();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);

    const result = await prepareReorder({ orderId });
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setPrepared(result.data as unknown as Prepared);
  };

  const confirm = () => {
    if (!prepared) return;

    const byId = new Map(prepared.products.map((product) => [product.id, product]));

    const lines = prepared.lines
      .filter((line) => ADDABLE.includes(line.state))
      .map((line) => {
        const product = byId.get(line.productId);
        return product
          ? { product, selectedOptionIds: line.selectedOptionIds, quantity: line.quantity }
          : null;
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (lines.length === 0) return;

    cart.fillFrom(prepared.restaurantId, prepared.restaurantName, lines);
    setPrepared(null);
    router.push('/cart');
  };

  const addable = prepared?.lines.filter((line) => ADDABLE.includes(line.state)) ?? [];
  const changed = prepared?.lines.filter((line) => line.state !== 'OK') ?? [];

  return (
    <>
      <Button variant="secondary" fullWidth loading={busy} onClick={open} className={className}>
        <RotateCcw size={17} aria-hidden />
        {t('order.reorder')}
      </Button>

      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Sheet
        open={Boolean(prepared)}
        onClose={() => setPrepared(null)}
        title={prepared ? `${t('order.reorder')} · ${prepared.restaurantName}` : t('order.reorder')}
        footer={
          <Button
            fullWidth
            disabled={!prepared?.restaurantAvailable || addable.length === 0}
            onClick={confirm}
          >
            {t('order.reorderConfirm', { count: addable.length })}
          </Button>
        }
      >
        {prepared && (
          <div className="space-y-4">
            {/* The restaurant has left the platform. Nothing below matters. */}
            {!prepared.restaurantAvailable && (
              <Alert tone="danger">{t('order.reorderRestaurantGone')}</Alert>
            )}

            {/* Shut right now is not shut for good: the basket can still be
                filled, and the checkout is what refuses an order to a closed
                kitchen. Saying so beats an empty screen with a dead button. */}
            {prepared.restaurantAvailable && !prepared.restaurantOpen && (
              <Alert tone="warning">{t('order.reorderClosed')}</Alert>
            )}

            {/* The ordinary case, said in one line so the sheet does not feel
                like an interrogation when nothing has actually changed. */}
            {prepared.restaurantAvailable && changed.length === 0 && (
              <p className="text-[15px] text-ink-600">{t('order.reorderUnchanged')}</p>
            )}

            <ul className="space-y-2">
              {prepared.lines.map((line, index) => (
                <li
                  key={`${line.productId}-${index}`}
                  className="rounded-2xl border border-card-edge bg-surface p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={
                        line.state === 'GONE' || line.state === 'UNAVAILABLE'
                          ? 'text-ink-400 line-through'
                          : 'font-medium text-ink-900'
                      }
                    >
                      {line.quantity}× {line.name}
                    </span>

                    {line.unitPrice !== null && (
                      <span className="shrink-0 text-sm tabular-nums text-ink-700">
                        <Money amount={line.unitPrice} />
                      </span>
                    )}
                  </div>

                  {/* Each difference named, in the customer's terms. A price
                      that moved shows both numbers — "it costs more now" with
                      no figures is not information. */}
                  {line.state === 'PRICE_CHANGED' && line.unitPrice !== null && (
                    <p className="mt-1 text-xs text-warning">
                      {t('order.reorderPriceChanged')}{' '}
                      <span className="line-through">
                        <Money amount={line.previousUnitPrice} />
                      </span>{' '}
                      → <Money amount={line.unitPrice} />
                    </p>
                  )}

                  {line.state === 'OPTIONS_CHANGED' && (
                    <p className="mt-1 text-xs text-warning">
                      {t('order.reorderOptionsDropped', {
                        options: line.droppedOptions.join(', '),
                      })}
                    </p>
                  )}

                  {line.state === 'UNAVAILABLE' && (
                    <p className="mt-1 text-xs text-ink-500">{t('order.reorderSoldOut')}</p>
                  )}

                  {line.state === 'GONE' && (
                    <p className="mt-1 text-xs text-ink-500">{t('order.reorderGone')}</p>
                  )}
                </li>
              ))}
            </ul>

            {/* Filling the basket throws away whatever is in it, and somebody
                halfway through a different order deserves to be told first. */}
            {cart.lines.length > 0 && (
              <Alert tone="info">{t('order.reorderReplacesCart')}</Alert>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
