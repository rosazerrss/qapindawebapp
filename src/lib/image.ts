/**
 * Client-side image shrinking, shared by every uploader.
 *
 * A phone photo is often several megabytes; nothing we show it for — a menu
 * thumbnail, a complaint photo — needs more than a few hundred kilobytes.
 * Resizing and re-encoding on a canvas before the file ever leaves the browser
 * saves storage, saves bandwidth on every viewer's connection, and keeps the
 * upload fast on a weak connection.
 */

/** JPEG quality passed to `canvas.toBlob`. Good enough for a food photo, small on the wire. */
export const SHRINK_QUALITY = 0.82;

/** Draws the file onto a canvas at a sane size and re-encodes it as JPEG. */
export async function shrink(file: File, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY),
  );
  if (!blob) throw new Error('encode');
  return blob;
}
