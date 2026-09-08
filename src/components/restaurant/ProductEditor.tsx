'use client';

/**
 * Editing one dish.
 *
 * Prices are typed in manat and converted to qəpik with `parseMajorUnits`, so
 * "12,50" and "12.50" both work and "12.567" is refused before it reaches the
 * server. Nothing here rounds silently.
 *
 * The option-group editor (sizes, extras and their price deltas) was taken out
 * of this form once, because owners found it the hardest part of the panel. The
 * cost of that turned out to be the whole feature: with no screen for them, no
 * restaurant could sell a large pizza with extra cheese, and a shop with three
 * sizes had to publish three separate dishes — which the menu, the search index
 * and every report then counted as three products.
 *
 * It is back, in `ModifierEditor`, rebuilt around one question instead of four
 * database fields. See that file for why the old version was hard.
 */

import { useState } from 'react';

import { useT, translateError } from '@/i18n';
import { Alert, Button, Input, Select, Sheet, Textarea } from '@/components/ui';
import { ImageUpload } from './ImageUpload';
import { ModifierEditor, validateModifierGroups } from './ModifierEditor';
import { saveProduct } from '@/firebase/callables';
import { ProductAvailability } from '@/shared/enums';
import { formatMinorUnits, parseMajorUnits } from '@/shared/pricing';
import type { ModifierGroup, Product } from '@/shared/models';

export function ProductEditor({
  open,
  restaurantId,
  categoryId,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  restaurantId: string;
  categoryId: string;
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? formatMinorUnits(product.price) : '');
  const [compareAtPrice, setCompareAtPrice] = useState(
    product?.compareAtPrice ? formatMinorUnits(product.compareAtPrice) : '',
  );
  const [popular, setPopular] = useState(product?.popular ?? false);
  const [availability, setAvailability] = useState<string>(
    product?.availability ?? ProductAvailability.AVAILABLE,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>(
    product?.modifierGroups ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);

    let priceMinor: number;
    let compareAtMinor: number | null;
    try {
      priceMinor = parseMajorUnits(price);
      // An empty box is not a zero — it is "this dish is not on offer", which
      // the model spells `null`. Sending 0 would claim a 100% discount.
      compareAtMinor = compareAtPrice.trim() ? parseMajorUnits(compareAtPrice) : null;
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    // The callable refuses this too. Catching it here costs a round trip less
    // and, more importantly, names the field the owner has to fix.
    if (compareAtMinor !== null && compareAtMinor <= priceMinor) {
      setBusy(false);
      setError(t('restaurantPanel.compareAtPriceInvalid'));
      return;
    }

    // Same reasoning, for the option groups: the server's answer would be a
    // validator's field path, which is no help to somebody adding a pizza size.
    const groupProblem = validateModifierGroups(modifierGroups, t);
    if (groupProblem) {
      setBusy(false);
      setError(groupProblem);
      return;
    }

    const result = await saveProduct({
      restaurantId,
      productId: product?.id ?? null,
      categoryId,
      name: name.trim(),
      description: description.trim(),
      price: priceMinor,
      compareAtPrice: compareAtMinor,
      sortOrder: product?.sortOrder ?? 0,
      popular,
      availability,
      imageUrl,
      // Trimmed on the way out. The boxes hold what somebody typed, spaces and
      // all, and the server stores exactly what it is sent.
      modifierGroups: modifierGroups.map((group) => ({
        ...group,
        name: group.name.trim(),
        options: group.options.map((option) => ({ ...option, name: option.name.trim() })),
      })),
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    onSaved();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product ? product.name : t('restaurantPanel.addProduct')}
      footer={
        <Button fullWidth loading={busy} disabled={!name.trim() || !price.trim()} onClick={submit}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <ImageUpload
          restaurantId={restaurantId}
          kind="dish"
          value={imageUrl}
          onChange={setImageUrl}
          label={t('upload.dish')}
        />

        <Input
          label={t('restaurantPanel.productName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />

        {/* Side by side, because they are one decision: the pair is either both
            filled in (an offer) or only the left one (the ordinary price). */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={`${t('restaurantPanel.productPrice')} (₼)`}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="5.50"
            hint={t('restaurantPanel.priceSeparatorHint')}
          />

          <Input
            label={`${t('restaurantPanel.compareAtPrice')} (₼)`}
            value={compareAtPrice}
            onChange={(event) => setCompareAtPrice(event.target.value)}
            inputMode="decimal"
            placeholder="7.00"
            hint={t('restaurantPanel.compareAtPriceHint')}
          />
        </div>

        <Textarea
          label={t('restaurantPanel.productDescription')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={400}
        />

        <Select
          label={t('restaurantPanel.availability')}
          value={availability}
          onChange={(event) => setAvailability(event.target.value)}
        >
          {[
            ProductAvailability.AVAILABLE,
            ProductAvailability.OUT_OF_STOCK_TODAY,
            ProductAvailability.HIDDEN,
          ].map((option) => (
            <option key={option} value={option}>
              {t(`restaurantPanel.${option}`)}
            </option>
          ))}
        </Select>

        <label className="flex items-center gap-2.5 text-[15px] text-ink-700">
          <input
            type="checkbox"
            checked={popular}
            onChange={(event) => setPopular(event.target.checked)}
            className="h-4 w-4 accent-brand-600"
          />
          {t('restaurant.popular')}
        </label>

        <div className="border-t border-card-edge pt-4">
          <ModifierEditor groups={modifierGroups} onChange={setModifierGroups} />
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Sheet>
  );
}
