'use client';

/**
 * "Seçilmişlər" — saved dishes and restaurants.
 *
 * The saved copy carries its own name and photo, so this page is one query
 * rather than one read per item, and a dish the restaurant has since deleted
 * still shows what was saved instead of quietly disappearing.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Heart } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button, Card, EmptyState, Money, cn } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { FavouriteButton } from '@/components/customer/FavouriteButton';
import { useAuth } from '@/contexts/AuthContext';
import { useFavourites } from '@/contexts/FavouritesContext';
import { useT } from '@/i18n';
import { Img } from '@/components/ui/Img';

export default function FavouritesPage() {
  const t = useT();
  const { firebaseUser, loading } = useAuth();
  const { items, loading: loadingFavourites } = useFavourites();
  const [tab, setTab] = useState<'PRODUCT' | 'RESTAURANT'>('PRODUCT');

  const { dishes, places } = useMemo(
    () => ({
      dishes: items.filter((item) => item.kind === 'PRODUCT'),
      places: items.filter((item) => item.kind === 'RESTAURANT'),
    }),
    [items],
  );

  if (loading) {
    return (
      <AppShell>
        <PageLoading label={t('common.loading')} />
      </AppShell>
    );
  }

  if (!firebaseUser) {
    return (
      <AppShell>
        <ScreenHeader title={t('favourites.title')} fallbackHref="/account" />
        <EmptyState
          title={t('favourites.signInTitle')}
          hint={t('favourites.signInHint')}
          action={
            <Link href="/login?next=/account/favourites">
              <Button size="sm">{t('auth.signIn')}</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  const shown = tab === 'PRODUCT' ? dishes : places;

  return (
    <AppShell>
      <ScreenHeader title={t('favourites.title')} fallbackHref="/account" />

      {/* A segmented control rather than two loose pills: the two tabs are one
          choice, and the shared track says so. */}
      <div
        className="mb-5 inline-flex rounded-xl bg-ink-100 p-1"
        role="tablist"
        aria-label={t('favourites.title')}
      >
        {(['PRODUCT', 'RESTAURANT'] as const).map((option) => {
          const count = (option === 'PRODUCT' ? dishes : places).length;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                'rounded-lg px-4 py-2 text-sm transition',
                tab === option
                  ? 'bg-white font-medium text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {option === 'PRODUCT' ? t('favourites.dishes') : t('favourites.places')}
              {count > 0 && <span className="ml-1.5 text-ink-400 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {loadingFavourites && items.length === 0 ? (
        <div className="space-y-2.5" role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-24 animate-pulse rounded-2xl bg-ink-100" aria-hidden />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={t('favourites.empty')}
          hint={t('favourites.emptyHint')}
          action={
            <Link href="/">
              <Button size="sm">{t('favourites.browse')}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {shown.map((item) => (
            <Card key={item.id} className="flex items-center gap-4 p-3">
              {item.imageUrl ? (
                 
                <Img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-300"
                >
                  <Heart size={22} />
                </span>
              )}

              <Link
                href={item.restaurantSlug ? `/restaurant/${item.restaurantSlug}` : '/'}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">{item.name}</span>
                  {item.kind === 'PRODUCT' && (
                    <span className="block truncate text-sm text-ink-500">
                      {item.restaurantName}
                    </span>
                  )}
                  {item.price !== null && (
                    <span className="mt-0.5 block text-sm font-medium text-ink-700">
                      <Money amount={item.price} />
                    </span>
                  )}
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-300" aria-hidden />
              </Link>

              <FavouriteButton
                kind={item.kind}
                targetId={(item.kind === 'PRODUCT' ? item.productId : item.restaurantId) ?? ''}
                className="shrink-0 bg-transparent shadow-none"
              />
            </Card>
          ))}
        </div>
      )}

      {tab === 'PRODUCT' && dishes.length > 0 && (
        <p className="mt-6 text-center text-xs text-ink-400">{t('favourites.priceNote')}</p>
      )}
    </AppShell>
  );
}
