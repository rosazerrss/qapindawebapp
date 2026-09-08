/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Serving pictures from our own address.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * THE PROBLEM
 * -----------
 * Every image on this platform was a `firebasestorage.googleapis.com` URL. Open
 * a dish photo in a new tab and that is what the address bar says — Google's
 * domain, the bucket's name, an object path and an access token. It tells any
 * visitor which infrastructure the platform runs on, and it hands them a
 * permanent, unauthenticated link to the file that keeps working after the
 * picture is taken off the menu.
 *
 * So public images now go out through `/m/<path>` on the platform's own domain,
 * and the proxy behind it fetches the object server-side. Nothing about Google
 * reaches the browser: not the host, not the bucket, not the token.
 *
 * WHAT IS *NOT* SOLVED HERE, SAID PLAINLY
 * ---------------------------------------
 * This hides an address. It is not access control, and it must never be
 * mistaken for it. `/m/` serves exactly the objects that were already public to
 * the whole internet — restaurant logos, cover photos, dish pictures, avatars —
 * and `PROXYABLE_PREFIXES` below is what keeps it that way.
 *
 * Complaint photographs, support attachments and a restaurant's licence
 * documents are NOT in that list, and adding them would be a real security
 * hole: the proxy reads with the server's own credentials, so it would hand a
 * stranger files the storage rules currently refuse them. Those are shown
 * inside panels by `SecureImage`, which fetches them in the browser as the
 * signed-in user and renders a `blob:` URL — no Google domain on screen either,
 * and the storage rules still decide who may read.
 */

/**
 * Where public images may be proxied from.
 *
 * Exactly the prefixes whose `storage.rules` entry says `allow read: if true`.
 * Keep the two in step: a prefix added here that is not public there turns this
 * route into a way around the rules.
 */
export const PROXYABLE_PREFIXES = ['restaurants/', 'users/'] as const;

/** The route the proxy lives on. Short, because it appears in every image URL. */
export const MEDIA_ROUTE = '/m';

/**
 * Is this object one the proxy may serve without asking who is looking?
 *
 * Defensive about the path itself, not only its prefix. `..` segments and
 * backslashes are refused outright — a proxy that resolves paths is a proxy
 * that can be talked into leaving its own folder, and the cost of being strict
 * here is nothing.
 */
export function isProxyablePath(objectPath: string): boolean {
  if (!objectPath || objectPath.length > 512) return false;
  if (objectPath.includes('..') || objectPath.includes('\\')) return false;
  if (objectPath.startsWith('/')) return false;

  /*
   * `users/` is public only for avatars. The rule in `storage.rules` is
   * `users/{userId}/avatar/{fileName}` and nothing else under `users/` is
   * readable, so the prefix alone would be too generous.
   */
  if (objectPath.startsWith('users/')) {
    return /^users\/[^/]+\/avatar\/[^/]+$/.test(objectPath);
  }

  return PROXYABLE_PREFIXES.some((prefix) => objectPath.startsWith(prefix));
}

/**
 * The object path inside a Firebase Storage download URL.
 *
 * Those URLs look like
 *
 *   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?alt=media&token=…
 *
 * where the path is percent-encoded, so `restaurants/abc/logo.jpg` arrives as
 * `restaurants%2Fabc%2Flogo.jpg`. Returns null for anything that is not one of
 * these — a data URI, a relative path, a URL somewhere else entirely — because
 * every caller's right answer for those is "leave it alone".
 */
export function storageObjectPath(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('firebasestorage.googleapis.com')) return null;

  const match = url.match(/\/o\/([^?]+)/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed escape sequence. Not a path we can serve.
    return null;
  }
}

/**
 * What an `<img src>` should point at.
 *
 * Three answers, and the order matters:
 *
 *  1. Not a storage URL at all — a data URI, an already-proxied path, an
 *     external image — returned untouched. This function is safe to apply
 *     everywhere precisely because it does nothing to what it does not
 *     recognise.
 *  2. A storage URL for a public object — rewritten onto our own domain.
 *  3. A storage URL for a private one — returned untouched, because the proxy
 *     would refuse it and a broken picture in an operator's panel is worse than
 *     a visible hostname. `SecureImage` is what hides those.
 */
export function mediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;

  const objectPath = storageObjectPath(url);
  if (!objectPath) return url;
  if (!isProxyablePath(objectPath)) return url;

  // Each segment encoded separately: the slashes are real path separators in
  // the route, and a whole-string `encodeURIComponent` would turn them into
  // `%2F` and produce a single segment nothing matches.
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  return `${MEDIA_ROUTE}/${encoded}`;
}

/** True when this URL is one only a signed-in panel may load. See `SecureImage`. */
export function isPrivateMedia(url: string | null | undefined): boolean {
  const objectPath = storageObjectPath(url);
  return objectPath !== null && !isProxyablePath(objectPath);
}
