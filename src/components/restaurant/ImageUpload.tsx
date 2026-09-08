'use client';

/**
 * Uploading a photo.
 *
 * Two things happen before anything leaves the browser:
 *
 *  1. The image is **resized and re-encoded** on a canvas. A phone photo is
 *     often 4 MB; a menu thumbnail needs about 60 KB. Uploading the original
 *     would cost storage, cost bandwidth on every customer's phone, and make
 *     the menu crawl on a slow connection — for a picture nobody sees at full
 *     size.
 *  2. The result is written straight to Firebase Storage under the restaurant's
 *     own folder. The Storage rules allow that path only to that restaurant's
 *     owner or manager, and only for images under 5 MB.
 *
 * The download URL is then saved onto the product or the restaurant through the
 * usual callable — the photo and the record travel separately, so a failed
 * upload never leaves a half-written menu item.
 */

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { firebaseStorage } from '@/firebase/client';
import { useT } from '@/i18n';
import { Alert, cn } from '@/components/ui';
import { shrink } from '@/lib/image';
import { Img } from '@/components/ui/Img';

/** Long edge in pixels. Generous for a phone screen, small on the wire. */
const MAX_EDGE = { cover: 1400, dish: 800, logo: 500 } as const;

type Kind = keyof typeof MAX_EDGE;

export function ImageUpload({
  restaurantId,
  kind,
  value,
  onChange,
  label,
  aspect = 'square',
}: {
  restaurantId: string;
  kind: Kind;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  aspect?: 'square' | 'wide';
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;

    const storage = firebaseStorage();
    if (!storage) {
      setError(t('errors.NOT_CONFIGURED'));
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError(t('upload.notImage'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const blob = await shrink(file, MAX_EDGE[kind]);

      // A fresh name each time: overwriting would leave every customer's cached
      // copy of the old photo in place, and the menu would look unchanged.
      const name = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const target = ref(storage, `restaurants/${restaurantId}/${name}`);

      await uploadBytes(target, blob, { contentType: 'image/jpeg' });
      onChange(await getDownloadURL(target));
    } catch (caught) {
      console.error('upload', caught);
      setError(t('upload.failed'));
    } finally {
      setBusy(false);
      // Clearing lets the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>

      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-dashed border-ink-300 bg-ink-50',
          aspect === 'wide' ? 'aspect-[16/9]' : 'aspect-square w-40',
        )}
      >
        {value ? (
          <>
            <Img src={value} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t('common.delete')}
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-ink-600 shadow-sm hover:text-danger"
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-400 hover:text-brand-600"
          >
            {busy ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
            <span className="text-xs">{busy ? t('upload.working') : t('upload.choose')}</span>
          </button>
        )}
      </div>

      {value && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-2 text-sm text-brand-600 underline disabled:opacity-50"
        >
          {busy ? t('upload.working') : t('upload.replace')}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />

      <p className="mt-1.5 text-xs text-ink-400">{t('upload.hint')}</p>

      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}
