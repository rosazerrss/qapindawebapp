'use client';

/**
 * Attaching photographs to something.
 *
 * WHY THIS EXISTS AS ONE COMPONENT
 * --------------------------------
 * The complaint form grew a photo picker first, and support chat now needs the
 * same thing: pick, shrink, upload, show a thumbnail, allow a removal, survive
 * a failed upload without losing the others. Copying that into a second screen
 * is how the two drift — one gets a size limit the other does not, one shrinks
 * and the other uploads a 12 MB photograph from a modern phone camera.
 *
 * WHY THE PHOTO IS SHRUNK BEFORE IT IS SENT
 * -----------------------------------------
 * A phone photograph is several thousand pixels wide and several megabytes. It
 * is looked at in a chat bubble a few hundred pixels across, usually by
 * somebody on mobile data, and stored forever. Shrinking on the device costs a
 * moment of the sender's battery and saves everybody else the bandwidth, the
 * storage and the wait — and it strips the EXIF block on the way, which is
 * where a phone writes the GPS coordinates the photograph was taken at. A
 * customer complaining about a cold pizza should not also be publishing their
 * home's coordinates to a restaurant.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * Delete. The storage rules give these accounts write but not delete on their
 * own folder, deliberately: an "undo" that can erase evidence from a dispute
 * is not an undo. Removing a photo here drops it from the list being sent; the
 * file stays in Storage, unreferenced, and is nobody's problem.
 */

import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { firebaseStorage } from '@/firebase/client';
import { useT } from '@/i18n';
import { shrink } from '@/lib/image';
import { cn } from '@/components/ui';
import { SecureImage } from '@/components/ui/Img';

/** Long edge in pixels. Enough to read a receipt; far less than a camera makes. */
const MAX_EDGE = 1600;

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

export function PhotoPicker({
  /** Storage folder, without the trailing slash. Must match a storage rule. */
  folder,
  urls,
  onChange,
  max = 3,
  disabled = false,
  label,
}: {
  folder: string;
  urls: string[];
  onChange: (next: string[]) => void;
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);

  const patch = (id: string, next: Partial<Photo>) =>
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...next } : photo)),
    );

  const upload = async (id: string, file: File) => {
    const storage = firebaseStorage();

    // Checked here as well as by the storage rule: a rejection that arrives
    // after a ten-second upload is a worse answer than one that arrives now.
    if (!storage || !file.type.startsWith('image/')) {
      patch(id, { busy: false, error: true });
      return;
    }

    try {
      const blob = await shrink(file, MAX_EDGE);
      const name = unguessableName('jpg');
      const target = ref(storage, `${folder}/${name}`);

      await uploadBytes(target, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(target);

      patch(id, { busy: false, url });
      onChange([...urls, url]);
    } catch (caught) {
      console.error('photo upload failed', caught);
      patch(id, { busy: false, error: true });
    }
  };

  const pick = (files: FileList | null) => {
    if (!files) return;

    const room = max - urls.length - photos.filter((photo) => photo.busy).length;

    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      const id = unguessableName('');
      setPhotos((current) => [...current, { id, busy: true, error: false, url: null }]);
      void upload(id, file);
    }

    // Cleared so the same file can be chosen again after a failure.
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (id: string, url: string | null) => {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    if (url) onChange(urls.filter((entry) => entry !== url));
  };

  const full = urls.length >= max;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => pick(event.target.files)}
      />

      <div className="flex flex-wrap items-center gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className={cn(
              'relative h-16 w-16 overflow-hidden rounded-xl border',
              photo.error ? 'border-danger bg-danger/5' : 'border-card-edge bg-subtle',
            )}
          >
            {photo.url && (
               
              <SecureImage src={photo.url} alt="" className="h-full w-full object-cover" />
            )}

            {photo.busy && (
              <span className="absolute inset-0 grid place-items-center text-xs text-ink-400">
                …
              </span>
            )}

            {photo.error && (
              <span className="absolute inset-0 grid place-items-center px-1 text-center text-[10px] leading-tight text-danger">
                {t('upload.failed')}
              </span>
            )}

            {!photo.busy && (
              <button
                type="button"
                aria-label={t('common.remove')}
                onClick={() => remove(photo.id, photo.url)}
                className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-900/70 text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}

        {!full && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-label={label ?? t('upload.addPhoto')}
            className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-card-edge text-ink-400 transition hover:bg-ink-50 disabled:opacity-50"
          >
            <ImagePlus size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
