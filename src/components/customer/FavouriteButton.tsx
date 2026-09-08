'use client';

/**
 * The heart.
 *
 * Sits on restaurant cards and dish rows, both of which are themselves links —
 * hence `preventDefault`, or saving a dish would also open it.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';

import { useFavourites } from '@/contexts/FavouritesContext';
import { useT } from '@/i18n';
import { cn } from '@/components/ui';

export function FavouriteButton({
  kind,
  targetId,
  className,
  size = 18,
}: {
  kind: 'PRODUCT' | 'RESTAURANT';
  targetId: string;
  className?: string;
  size?: number;
}) {
  const t = useT();
  const router = useRouter();
  const { isSaved, toggle } = useFavourites();
  const [busy, setBusy] = useState(false);

  const saved = isSaved(kind, targetId);

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? t('favourites.remove') : t('favourites.add')}
      title={saved ? t('favourites.remove') : t('favourites.add')}
      disabled={busy}
      onClick={async (event) => {
        // The card around this is a link; tapping the heart must not navigate.
        event.preventDefault();
        event.stopPropagation();

        setBusy(true);
        const result = await toggle(kind, targetId);
        setBusy(false);

        // A guest gets sent to sign in rather than a silent no-op.
        if (result.signInRequired) router.push('/login?next=/account/favourites');
      }}
      className={cn(
        'inline-flex items-center justify-center rounded-full p-2 transition',
        'bg-white/90 shadow-sm backdrop-blur hover:bg-white',
        saved ? 'text-brand-600' : 'text-ink-400 hover:text-brand-500',
        busy && 'opacity-60',
        className,
      )}
    >
      <Heart size={size} className={cn(saved && 'fill-brand-600')} />
    </button>
  );
}
