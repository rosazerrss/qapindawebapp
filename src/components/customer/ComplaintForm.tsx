'use client';

/**
 * The complaint composer.
 *
 * One reason, then — optionally — the story behind it. The reason is a chip
 * list rather than a dropdown because a person who has just been handed the
 * wrong meal should be able to answer with one tap.
 *
 * A cold plate or a swapped dish is proved with a picture, so up to three may
 * be attached. `storage.rules` gives a customer a folder of their own for this
 * exact purpose — `complaints/{their-uid}/{fileName}` — so each photo is
 * uploaded the moment it is picked, before the complaint itself is ever sent:
 * the record and the pictures travel separately, the same way a restaurant's
 * menu photo does, so a failed upload never blocks filing with text alone.
 *
 * Rendered as the body of a `Sheet`, submit button included, so every screen
 * that files a complaint opens the identical thing.
 */

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { Alert, Button, Textarea, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { fileComplaint } from '@/firebase/callables';
import { firebaseStorage } from '@/firebase/client';
import { useAuth } from '@/contexts/AuthContext';
import { shrink } from '@/lib/image';
import { ComplaintReason } from '@/shared/enums';
import { SecureImage } from '@/components/ui/Img';

/** Mirrors the server's `optionalString(…, { max: 600 })` on `detail`. */
const MAX_DETAIL = 600;

/** Mirrors the server's `optionalStringArray(…, { max: 4 })` — kept at 3 here
 * so a customer always has one slot of headroom before the server's own cap. */
const MAX_PHOTOS = 3;

/** Long edge in pixels — a complaint photo is evidence, not a gallery piece. */
const MAX_EDGE = 1000;

const REASONS = Object.values(ComplaintReason);

/** One picked photo, tracked from upload through to (optional) removal.
 * `url` is null while `busy`, and stays null on `error` — only a slot with a
 * url is ever sent to the server. */
interface Photo {
  id: string;
  busy: boolean;
  error: boolean;
  url: string | null;
}

/**
 * A name nobody can guess.
 *
 * These files live under a path any signed-in account may read — a storage
 * rule cannot reach into Firestore to ask which restaurant is on the order, so
 * "unguessable URL" is the whole of the protection. `Date.now()` is not
 * unguessable: an attacker who filed their own complaint a second earlier
 * knows the millisecond to within a narrow window, and the remaining six
 * characters are a few billion tries against a known uid.
 *
 * A v4 UUID is 122 random bits. `crypto.randomUUID` exists in every browser
 * this app supports and is the browser's CSPRNG, not `Math.random`.
 */
function unguessableName(extension: string): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  return extension ? `${id}.${extension}` : id;
}

export function ComplaintForm({
  orderId,
  onSubmitted,
}: {
  orderId: string;
  /** Called after the server has accepted the complaint. */
  onSubmitted?: (orderId: string) => void;
}) {
  const t = useT();
  const { firebaseUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [detail, setDetail] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadPhoto = async (id: string, file: File) => {
    const uid = firebaseUser?.uid;
    const storage = firebaseStorage();

    if (!uid || !storage) {
      setPhotos((current) =>
        current.map((photo) => (photo.id === id ? { ...photo, busy: false, error: true } : photo)),
      );
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotos((current) =>
        current.map((photo) => (photo.id === id ? { ...photo, busy: false, error: true } : photo)),
      );
      return;
    }

    try {
      const blob = await shrink(file, MAX_EDGE);
      const name = unguessableName('jpg');
      const target = ref(storage, `complaints/${uid}/${name}`);

      await uploadBytes(target, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(target);

      setPhotos((current) =>
        current.map((photo) => (photo.id === id ? { ...photo, busy: false, url } : photo)),
      );
    } catch (caught) {
      console.error('complaint photo upload', caught);
      setPhotos((current) =>
        current.map((photo) => (photo.id === id ? { ...photo, busy: false, error: true } : photo)),
      );
    }
  };

  const pickPhotos = (fileList: FileList | null) => {
    if (!fileList) return;

    const room = MAX_PHOTOS - photos.length;
    const files = Array.from(fileList).slice(0, Math.max(0, room));

    for (const file of files) {
      const id = unguessableName('');
      setPhotos((current) => [...current, { id, busy: true, error: false, url: null }]);
      void uploadPhoto(id, file);
    }

    // Clearing lets the same file be chosen again after a failure.
    if (inputRef.current) inputRef.current.value = '';
  };

  const removePhoto = (id: string) => {
    // Dropping the URL from the list is all a customer can do here — the
    // storage rule gives them write, not delete, on this path, so the file
    // itself is orphaned in Storage rather than removed.
    setPhotos((current) => current.filter((photo) => photo.id !== id));
  };

  const submit = async () => {
    if (!reason) return;

    setBusy(true);
    setError(null);

    const photoUrls = photos
      .map((photo) => photo.url)
      .filter((url): url is string => url !== null);

    const result = await fileComplaint({
      orderId,
      reason,
      detail: detail.trim() || null,
      photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    onSubmitted?.(orderId);
  };

  return (
    <div>
      <p className="text-sm text-ink-500">{t('complaint.policy')}</p>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink-700">
          {t('complaint.reasonLabel')}
        </legend>

        <div role="radiogroup" aria-label={t('complaint.reasonLabel')} className="flex flex-wrap gap-2">
          {REASONS.map((option) => {
            const selected = reason === option;
            return (
              <button
                key={option}
                type="button"
                // A radio group in chip clothing: exactly one reason reaches the
                // server, so the chips announce themselves as radios rather than
                // as toggles that could all be on at once.
                role="radio"
                aria-checked={selected}
                onClick={() => setReason(option)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm transition',
                  selected
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                )}
              >
                {t(`complaintReason.${option}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <Textarea
          label={t('complaint.detailLabel')}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={MAX_DETAIL}
          placeholder={t('complaint.detailPlaceholder')}
          hint={t('complaint.detailOptional')}
        />
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-sm font-medium text-ink-700">
          {t('complaint.photosLabel')}
        </span>

        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative h-20 w-20 overflow-hidden rounded-xl border border-ink-200 bg-ink-50"
            >
              {photo.url && (
                <>
                  <SecureImage src={photo.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    aria-label={t('common.delete')}
                    className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-600 shadow-sm hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </>
              )}

              {photo.busy && (
                <div className="flex h-full w-full items-center justify-center text-ink-400">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              )}

              {photo.error && (
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-danger"
                >
                  <X size={16} />
                  {t('upload.failed')}
                </button>
              )}
            </div>
          ))}

          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300 text-ink-400 hover:text-brand-600"
            >
              <ImagePlus size={20} />
              <span className="text-xs">{t('upload.choose')}</span>
            </button>
          )}
        </div>

        <p className="mt-1.5 text-xs text-ink-400">{t('complaint.photosHint')}</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => pickPhotos(event.target.files)}
        />
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mt-5">
        <Button fullWidth loading={busy} disabled={reason === null} onClick={submit}>
          {t('complaint.submit')}
        </Button>
      </div>
    </div>
  );
}
