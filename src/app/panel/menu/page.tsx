'use client';

/**
 * The menu editor.
 *
 * "Restoran öz tərəfindən menyularını rahat düzəlişlər edə bilsin" — so the
 * common actions are one tap and never behind a dialog: a price is edited in
 * place, sold-out is a toggle on the row. Only structural changes (a new dish,
 * a renamed section) open a form.
 *
 * Deleting is the exception. A category or a dish removed by a mis-tap during
 * service is not recoverable from this screen, so both go through a dialog that
 * names the thing about to disappear.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { ProductEditor } from '@/components/restaurant/ProductEditor';
import { ConfirmDialog, PageHeader, SearchInput, Toolbar } from '@/components/panel/ui';
import { MenuQualityCard } from '@/components/restaurant/MenuQualityCard';
import { useToast } from '@/components/panel/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Loading,
  Money,
  Sheet,
  cn,
} from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import {
  deleteMenuCategory,
  deleteProduct,
  reorderMenuCategories,
  saveMenuCategory,
  setProductAvailability,
} from '@/firebase/callables';
import { getMenu, type MenuSection } from '@/services/catalog';
import { ProductAvailability } from '@/shared/enums';
import type { Product } from '@/shared/models';

/** What the confirmation dialog is currently holding. */
type Pending =
  | { kind: 'category'; id: string; name: string }
  | { kind: 'product'; product: Product };

export default function MenuEditorRoute() {
  // `useSearchParams` suspends, and the ⌘K palette deep-links here with `?q=`.
  return (
    <Suspense fallback={<Loading />}>
      <MenuEditorPage />
    </Suspense>
  );
}

function MenuEditorPage() {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();
  const { restaurantId } = useAuth();

  const [sections, setSections] = useState<MenuSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState(params.get('q') ?? '');

  const [categorySheet, setCategorySheet] = useState<{ id?: string; name: string } | null>(null);
  const [editing, setEditing] = useState<{ product: Product | null; categoryId: string } | null>(
    null,
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!restaurantId) return;
    setSections(await getMenu(restaurantId, { includeHidden: true }));
  }, [restaurantId]);

  useEffect(() => {
    // Every state update in the loader happens after an `await`, so nothing is
    // set synchronously during this effect. The rule cannot see past the async
    // boundary, so it is silenced here rather than the code contorted around it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  /**
   * The search narrows dishes, not sections — but a section left with nothing
   * matching is noise, so it drops out entirely while a search is active. The
   * index of each surviving section is carried along because reordering is
   * expressed against the *full* list, never the filtered one.
   */
  const visibleSections = useMemo(() => {
    if (!sections) return null;
    const needle = term.trim().toLowerCase();

    return sections
      .map((section, index) => ({
        section: needle
          ? {
              ...section,
              products: section.products.filter((product) =>
                product.name.toLowerCase().includes(needle),
              ),
            }
          : section,
        index,
      }))
      .filter((entry) => !needle || entry.section.products.length > 0);
  }, [sections, term]);

  const saveCategory = async () => {
    if (!restaurantId || !categorySheet) return;

    const result = await saveMenuCategory({
      restaurantId,
      categoryId: categorySheet.id ?? null,
      name: categorySheet.name,
      sortOrder: categorySheet.id
        ? (sections?.findIndex((section) => section.category.id === categorySheet.id) ?? 0)
        : (sections?.length ?? 0),
      visible: true,
    });

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    setCategorySheet(null);
    toast.show(t('restaurantPanel.doneCategorySaved'));
    await reload();
  };

  const moveCategory = async (index: number, direction: -1 | 1) => {
    if (!restaurantId || !sections) return;

    const order = sections.map((section) => section.category.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;

    [order[index], order[target]] = [order[target], order[index]];

    // Optimistic: the list reorders instantly, the write follows.
    setSections((current) => {
      if (!current) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

    await reorderMenuCategories({ restaurantId, categoryIds: order });
  };

  const toggleAvailability = async (product: Product) => {
    if (!restaurantId) return;

    const next =
      product.availability === ProductAvailability.AVAILABLE
        ? ProductAvailability.OUT_OF_STOCK_TODAY
        : ProductAvailability.AVAILABLE;

    setSections((current) =>
      current?.map((section) => ({
        ...section,
        products: section.products.map((entry) =>
          entry.id === product.id ? { ...entry, availability: next } : entry,
        ),
      })) ?? current,
    );

    const result = await setProductAvailability({
      restaurantId,
      productId: product.id,
      availability: next,
    });

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      await reload();
    }
  };

  const runPending = async () => {
    if (!restaurantId || !pending) return;

    setBusy(true);
    setError(null);

    const result =
      pending.kind === 'category'
        ? await deleteMenuCategory({ restaurantId, categoryId: pending.id })
        : await deleteProduct({ restaurantId, productId: pending.product.id });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      setPending(null);
      return;
    }

    toast.show(
      t(
        pending.kind === 'category'
          ? 'restaurantPanel.doneCategoryDeleted'
          : 'restaurantPanel.doneProductDeleted',
      ),
    );
    setPending(null);
    await reload();
  };

  const pendingName = pending
    ? pending.kind === 'category'
      ? pending.name
      : pending.product.name
    : '';

  const addCategoryButton = (
    <Button size="sm" onClick={() => setCategorySheet({ name: '' })}>
      <Plus size={16} /> {t('restaurantPanel.addCategory')}
    </Button>
  );

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('restaurantPanel.menuTitle')}
        subtitle={t('restaurantPanel.menuSubtitle')}
        actions={addCategoryButton}
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {/* Above the search, because it is about the whole menu rather than
          about what is being looked for right now. Recomputed from the
          sections already in memory — no callable, nothing to go stale. */}
      {sections && <MenuQualityCard products={sections.flatMap((section) => section.products)} />}

      <Toolbar>
        <SearchInput
          value={term}
          onChange={setTerm}
          placeholder={t('restaurantPanel.searchProducts')}
        />
      </Toolbar>

      {visibleSections === null ? (
        <Loading />
      ) : sections?.length === 0 ? (
        <EmptyState
          title={t('restaurantPanel.menuEmpty')}
          hint={t('restaurantPanel.menuEmptyHint')}
          action={addCategoryButton}
        />
      ) : visibleSections.length === 0 ? (
        <EmptyState
          title={t('restaurantPanel.noProductsFound')}
          hint={t('restaurantPanel.noProductsFoundHint')}
        />
      ) : (
        <div className="space-y-6">
          {visibleSections.map(({ section, index }) => (
            <section key={section.category.id}>
              <div className="mb-2.5 flex items-center gap-2">
                <button
                  onClick={() =>
                    setCategorySheet({
                      id: section.category.id,
                      name: section.category.name,
                    })
                  }
                  title={t('restaurantPanel.editCategory')}
                  className="text-lg font-semibold text-ink-900 hover:text-brand-600"
                >
                  {section.category.name}
                </button>

                <span className="text-sm text-ink-400">({section.products.length})</span>

                <div className="ml-auto flex items-center gap-1">
                  {/* The dashed button at the foot of the list is easy to miss
                      once a section runs past the fold, so the same action is
                      spelled out here, next to the section it belongs to. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing({ product: null, categoryId: section.category.id })}
                  >
                    <Plus size={15} /> {t('restaurantPanel.addProduct')}
                  </Button>

                  <button
                    onClick={() => void moveCategory(index, -1)}
                    disabled={index === 0}
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                    aria-label={t('restaurantPanel.moveUp')}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    onClick={() => void moveCategory(index, 1)}
                    disabled={index === (sections?.length ?? 0) - 1}
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                    aria-label={t('restaurantPanel.moveDown')}
                  >
                    <ChevronDown size={16} />
                  </button>
                  {section.products.length === 0 && (
                    <button
                      onClick={() =>
                        setPending({
                          kind: 'category',
                          id: section.category.id,
                          name: section.category.name,
                        })
                      }
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-danger"
                      aria-label={t('restaurantPanel.deleteCategory')}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {section.products.map((product) => {
                  const available = product.availability === ProductAvailability.AVAILABLE;

                  return (
                    <Card
                      key={product.id}
                      className={cn('flex items-center gap-3 p-3', !available && 'bg-ink-50')}
                    >
                      <button
                        onClick={() => setEditing({ product, categoryId: section.category.id })}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink-900">{product.name}</span>
                          {product.popular && <Badge tone="brand">{t('restaurant.popular')}</Badge>}
                          {product.availability === ProductAvailability.HIDDEN && (
                            <Badge tone="neutral">{t('restaurantPanel.HIDDEN')}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-500">
                          <Money amount={product.price} />
                          {product.modifierGroups.length > 0 &&
                            ` · ${product.modifierGroups.length} ${t('restaurantPanel.modifierGroups').toLowerCase()}`}
                        </p>
                      </button>

                      {/* The one-tap action a kitchen needs mid-service. */}
                      <Button
                        size="sm"
                        variant={available ? 'secondary' : 'success'}
                        onClick={() => void toggleAvailability(product)}
                      >
                        {available ? t('restaurantPanel.soldOut') : t('restaurantPanel.backInStock')}
                      </Button>

                      <button
                        onClick={() => setPending({ kind: 'product', product })}
                        className="rounded-lg p-2 text-ink-300 hover:bg-red-50 hover:text-danger"
                        aria-label={t('restaurantPanel.deleteProduct')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </Card>
                  );
                })}

                <button
                  onClick={() => setEditing({ product: null, categoryId: section.category.id })}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 py-3 text-sm text-ink-500 hover:border-brand-300 hover:text-brand-600"
                >
                  <Plus size={16} />{' '}
                  {t('restaurantPanel.addProductTo', { name: section.category.name })}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      <Sheet
        open={Boolean(categorySheet)}
        onClose={() => setCategorySheet(null)}
        title={
          categorySheet?.id
            ? t('restaurantPanel.editCategory')
            : t('restaurantPanel.addCategory')
        }
        footer={
          <Button fullWidth disabled={!categorySheet?.name.trim()} onClick={saveCategory}>
            {t('common.save')}
          </Button>
        }
      >
        <Input
          label={t('restaurantPanel.categoryName')}
          value={categorySheet?.name ?? ''}
          onChange={(event) =>
            setCategorySheet((current) => ({ ...current!, name: event.target.value }))
          }
          maxLength={60}
          placeholder={t('restaurantPanel.categoryPlaceholder')}
        />
      </Sheet>

      {editing && restaurantId && (
        <ProductEditor
          key={editing.product?.id ?? `new-${editing.categoryId}`}
          open
          restaurantId={restaurantId}
          categoryId={editing.categoryId}
          product={editing.product}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        title={t(
          pending?.kind === 'category'
            ? 'restaurantPanel.deleteCategory'
            : 'restaurantPanel.deleteProduct',
        )}
        body={t(
          pending?.kind === 'category'
            ? 'restaurantPanel.warnDeleteCategory'
            : 'restaurantPanel.warnDeleteProduct',
          { name: pendingName },
        )}
        confirmLabel={t('common.delete')}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </PanelShell>
  );
}
