'use client';

/**
 * Choosing options for one dish.
 *
 * The validation here mirrors `buildOrderItem` on the server exactly — required
 * groups, minimums, maximums. That is on purpose: the customer should find out
 * they forgot to pick a size *here*, not at checkout. The server still checks
 * again, because this copy runs in a browser.
 */

import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

import { useT } from '@/i18n';
import { Button, Money, Sheet, Textarea, cn } from '@/components/ui';
import { ModifierSelection } from '@/shared/enums';
import { isDiscountedProduct } from '@/shared/pricing';
import type { Product } from '@/shared/models';

/**
 * A dish's price, with the pre-discount one struck through beside it.
 *
 * The order of the two numbers is the accessibility decision. The price that
 * will actually be charged comes first in the DOM and is the only one exposed
 * to assistive technology; the old price is `aria-hidden` and lives in an `<s>`,
 * which carries no interaction and cannot be focused — so a screen reader
 * announces one price, the true one, and nothing here can be mistaken for a
 * control that changes it.
 *
 * Exported because the menu rows show exactly the same thing, and two copies of
 * a discount rule is how the two screens end up disagreeing about the price.
 */
export function PriceWithDiscount({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const discounted = isDiscountedProduct(product);

  if (!discounted) {
    return (
      <span className={className}>
        <Money amount={product.price} />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-2', className)}>
      <Money amount={product.price} />
      {/*
        The struck-through figure, and no word beside it.

        There WAS an "Endirim" badge here as well, and on a menu row it landed
        two words apart from the badge next to the dish's name — the same word,
        twice, about the same dish. A mark that repeats itself stops reading as
        a mark and starts reading as a mistake.

        The one on the name survives because that is the line a person scans
        down a menu of forty dishes. Here the crossed-out price already says
        "this used to cost more", in less space and without being read.
      */}
      <s aria-hidden className="font-normal text-ink-400">
        <Money amount={product.compareAtPrice!} />
      </s>
    </span>
  );
}

export function ProductSheet({
  product,
  open,
  onClose,
  onAdd,
  disabled,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAdd: (optionIds: string[], quantity: number, note: string | null) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  // Keying the sheet on the product id (below) remounts it per dish, so the
  // state resets without an effect that fights the render.
  const groups = product?.modifierGroups ?? [];

  const toggle = (groupId: string, optionId: string, single: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (single) {
        // Radio behaviour: clear the group's other options first.
        const group = groups.find((entry) => entry.id === groupId);
        for (const option of group?.options ?? []) next.delete(option.id);
        next.add(optionId);
      } else if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  };

  const { valid, missingGroup, unitPrice } = useMemo(() => {
    if (!product) return { valid: false, missingGroup: null as string | null, unitPrice: 0 };

    let extra = 0;
    let missing: string | null = null;

    for (const group of groups) {
      const chosen = group.options.filter((option) => selected.has(option.id));
      extra += chosen.reduce((sum, option) => sum + option.priceDelta, 0);

      const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
      if (chosen.length < minimum && !missing) missing = group.name;
      if (group.maxSelect > 0 && chosen.length > group.maxSelect && !missing) missing = group.name;
    }

    return { valid: missing === null, missingGroup: missing, unitPrice: product.price + extra };
  }, [product, groups, selected]);

  if (!product) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product.name}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-ink-200 p-1">
            <button
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 disabled:opacity-40"
              disabled={quantity <= 1}
              aria-label="-"
            >
              <Minus size={16} />
            </button>
            <span className="w-7 text-center font-medium tabular-nums">{quantity}</span>
            <button
              onClick={() => setQuantity((value) => Math.min(30, value + 1))}
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 disabled:opacity-40"
              disabled={quantity >= 30}
              aria-label="+"
            >
              <Plus size={16} />
            </button>
          </div>

          <Button
            fullWidth
            disabled={!valid || disabled}
            onClick={() => onAdd([...selected], quantity, note.trim() || null)}
          >
            {t('restaurant.addToCart')} · <Money amount={unitPrice * quantity} />
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-lg font-semibold text-ink-900">
        <PriceWithDiscount product={product} />
      </p>

      {product.description && <p className="mb-4 text-ink-600">{product.description}</p>}

      {groups.map((group) => {
        const single = group.selection === ModifierSelection.SINGLE;
        const chosenCount = group.options.filter((option) => selected.has(option.id)).length;
        const atMax = group.maxSelect > 0 && chosenCount >= group.maxSelect;

        return (
          <fieldset key={group.id} className="mb-5">
            <legend className="mb-2 flex w-full items-center justify-between">
              <span className="font-medium text-ink-900">{group.name}</span>
              <span className="text-xs text-ink-400">
                {group.required ? t('common.required') : t('common.optional')}
                {group.maxSelect > 1 && ` · ${t('common.all')} ${group.maxSelect}`}
              </span>
            </legend>

            <div className="space-y-1.5">
              {group.options.map((option) => {
                const isSelected = selected.has(option.id);
                const blocked = !option.available || (atMax && !isSelected && !single);

                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition',
                      isSelected ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white',
                      blocked && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={group.id}
                      checked={isSelected}
                      disabled={blocked}
                      onChange={() => toggle(group.id, option.id, single)}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <span className="flex-1 text-[15px] text-ink-800">{option.name}</span>
                    {option.priceDelta > 0 && (
                      <span className="text-sm text-ink-500">
                        +<Money amount={option.priceDelta} />
                      </span>
                    )}
                    {!option.available && (
                      <span className="text-xs text-ink-400">{t('restaurant.outOfStock')}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <Textarea
        label={t('restaurant.noteLabel')}
        placeholder={t('restaurant.notePlaceholder')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={200}
      />

      {missingGroup && (
        <p className="mt-3 text-sm text-danger">
          {t('errors.MODIFIER_REQUIRED', { detail: missingGroup })}
        </p>
      )}
    </Sheet>
  );
}
