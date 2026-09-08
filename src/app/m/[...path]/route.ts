/**
 * QAPINDA — `/m/<object path>` — every public picture, from our own address.
 *
 * WHAT IT REPLACES
 * ----------------
 * `https://firebasestorage.googleapis.com/v0/b/qapindanew.firebasestorage.app/
 *  o/restaurants%2Fabc%2Flogo.jpg?alt=media&token=…`
 *
 * That is what the address bar used to say when somebody opened a dish photo in
 * a new tab: Google's hostname, the bucket's name, and a permanent
 * unauthenticated link that keeps working long after the dish leaves the menu.
 * Now it says `/m/restaurants/abc/logo.jpg`, and the token never leaves this
 * server.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not access control, and the day somebody treats it as such is the day
 * it becomes a hole. This route reads objects with the SERVER'S credentials, so
 * anything it agrees to serve is served to the whole internet regardless of the
 * storage rules. `isProxyablePath` is therefore the only thing standing between
 * this route and a stranger reading a restaurant's tax documents, and it allows
 * exactly the prefixes whose rule already says `allow read: if true`.
 *
 * Complaint photos, support attachments and licence papers are deliberately
 * refused here. `SecureImage` shows those in panels — fetched by the browser as
 * the signed-in user, so the storage rules still decide — and renders them as a
 * `blob:` URL, which also puts no Google hostname on screen.
 *
 * HOW IT READS THE OBJECT WITH NO SDK
 * -----------------------------------
 * The Next.js server runs on Cloud Run with a service account attached, and
 * Google's metadata server hands out an access token for it over plain HTTP —
 * no key file, no `firebase-admin`, nothing added to the bundle. That token
 * then authorises a normal download request. Outside Google's infrastructure
 * (a laptop running `next dev`) there is no metadata server, and this route
 * says so rather than half-working.
 */

import { isProxyablePath } from '@/shared/media';

/** Node, not Edge: the metadata lookup below is a plain HTTP call to a link-local address. */
export const runtime = 'nodejs';

/**
 * Never prerendered, and never cached by Next itself.
 *
 * The caching that matters happens in the browser and in Firebase Hosting's
 * CDN, driven by the `Cache-Control` header below. Letting Next cache these as
 * well would put image bytes in the server's own memory for no gain.
 */
export const dynamic = 'force-dynamic';

const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';

/** How long a browser may keep a picture. */
const CACHE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The access token for this service, from Google's metadata server.
 *
 * Cached in module scope until shortly before it expires. Every image on a menu
 * page is a separate request to this route, and asking the metadata server sixty
 * times for the same token would add a round trip to each of them.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  try {
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        // A second is generous for a link-local address. If the metadata server
        // is not there, it is not there — waiting will not conjure one.
        signal: AbortSignal.timeout(1000),
        cache: 'no-store',
      },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;

    cachedToken = {
      value: payload.access_token,
      // A minute of headroom, so a token never expires mid-request.
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
    };

    return cachedToken.value;
  } catch {
    // No metadata server: a laptop, a container, anything not on Google's
    // infrastructure. The caller turns this into an honest 503.
    return null;
  }
}

/**
 * May this request have the picture?
 *
 * WHAT THIS STOPS, AND WHAT IT CANNOT
 * -----------------------------------
 * It stops two specific things, and both are worth stopping:
 *
 *   • ANOTHER SITE EMBEDDING OUR IMAGES. Somebody builds a competing menu and
 *     points `<img>` at our photographs: their page, our bandwidth, our
 *     restaurants' pictures presented as theirs.
 *   • OPENING THE PICTURE AS A PAGE. Right-click → open image in new tab, or
 *     pasting the `/m/…` address into the bar. The image is served to a page
 *     that displays it, and to nothing else.
 *
 * It does NOT make an image impossible to take, and nothing can. A browser has
 * to receive the bytes in order to draw them, so anybody who can see a picture
 * can screenshot it, read it out of the network tab, or find it in the browser
 * cache. Claiming otherwise would be a lie told to a padlock icon. What is
 * achievable is that it stops being *convenient* and stops being *free* — and
 * that is what this does.
 *
 * HOW IT DECIDES
 * --------------
 * `Sec-Fetch-*` first, because it is sent by the browser and cannot be set by
 * page script. `Sec-Fetch-Dest: document` means the picture itself is being
 * navigated to; `Sec-Fetch-Site: cross-site` means somebody else's page is
 * doing the asking.
 *
 * A client that sends neither header falls back to `Referer`, compared against
 * the host this very request arrived on — so it keeps working on
 * qapindanew.web.app, on a custom domain, and on localhost without any of them
 * being written down here.
 *
 * The known cost, stated rather than discovered later: link-preview crawlers
 * (WhatsApp, Facebook, Telegram) send no `Referer` and no `Sec-Fetch-*`, so a
 * shared link will not show a picture in its preview card. That is the trade —
 * a preview thumbnail against every other site being able to help itself.
 */
function mayServe(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  const site = request.headers.get('sec-fetch-site');

  if (dest || site) {
    // Navigating TO the image — a new tab, a pasted address, a bookmark.
    if (dest === 'document') return false;
    // Somebody else's page asking for it.
    if (site === 'cross-site') return false;
    // `none` with a non-document destination is unusual but not an embed;
    // same-origin and same-site are our own pages.
    return true;
  }

  const referer = request.headers.get('referer');
  if (!referer) return false;

  try {
    // The host this request arrived on, so no domain has to be listed here.
    const host = request.headers.get('host');
    return Boolean(host) && new URL(referer).host === host;
  } catch {
    return false;
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;

  /*
   * Refused as 404 rather than 403.
   *
   * A 403 says "this exists and you may not have it", which is an invitation to
   * work out how to ask properly. A 404 says nothing at all, and matches what
   * every other refusal in this route already answers.
   */
  if (!mayServe(request)) {
    return new Response('Not found', { status: 404 });
  }

  /*
   * The segments arrive already decoded by Next, so joining them reconstructs
   * the object path exactly as Storage knows it — `restaurants/abc/logo.jpg`.
   */
  const objectPath = (path ?? []).join('/');

  // The line that keeps this from being a way around the storage rules.
  if (!isProxyablePath(objectPath)) {
    return new Response('Not found', { status: 404 });
  }

  if (!BUCKET) {
    return new Response('Storage not configured', { status: 503 });
  }

  const token = await accessToken();
  if (!token) {
    return new Response('Media proxy unavailable outside the deployed environment', {
      status: 503,
    });
  }

  const upstream = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(objectPath)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        // Passed through so a browser revalidating gets a 304 rather than the
        // whole file again.
        ...(request.headers.get('if-none-match')
          ? { 'If-None-Match': request.headers.get('if-none-match')! }
          : {}),
      },
      cache: 'no-store',
    },
  );

  if (upstream.status === 304) {
    return new Response(null, { status: 304 });
  }

  if (!upstream.ok || !upstream.body) {
    /*
     * Deliberately flattened to 404.
     *
     * Upstream distinguishes "no such object" from "the service account may not
     * read it", and passing that difference on would let anyone map the bucket
     * by watching which paths answer 403 and which answer 404.
     */
    return new Response('Not found', { status: 404 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      /*
       * `immutable`, which is honest here: an uploaded file's name carries a
       * timestamp and a random suffix, so a changed picture is a different
       * path. Nothing at a given path is ever rewritten.
       */
      'Cache-Control': `public, max-age=${CACHE_SECONDS}, immutable`,
      ...(upstream.headers.get('etag') ? { ETag: upstream.headers.get('etag')! } : {}),
      ...(upstream.headers.get('content-length')
        ? { 'Content-Length': upstream.headers.get('content-length')! }
        : {}),
      // The picture is ours to display, not to be framed by somebody else.
      'X-Content-Type-Options': 'nosniff',
      /*
       * The browser's own half of the same rule.
       *
       * `mayServe` above refuses the request; this refuses the RESPONSE if one
       * ever gets through — a cached copy, a header this server did not see, a
       * future route that forgets the check. A browser will not hand a
       * `same-origin` resource to a document from another origin whatever the
       * page asks, which makes the protection two independent mechanisms rather
       * than one function nobody re-reads.
       */
      'Cross-Origin-Resource-Policy': 'same-origin',
      // And it is not to be put inside somebody's frame either.
      'X-Frame-Options': 'SAMEORIGIN',
      /*
       * Shared caches must not answer for everyone from one allowed request.
       * The decision above depends on request headers, so the cache key has to
       * as well — otherwise a CDN that stored a copy for a legitimate page
       * would happily serve it to the site we just refused.
       *
       * `Referer` is deliberately NOT in this list even though the fallback
       * reads it. Varying on it would key the cache by the referring PAGE, so
       * every menu would re-fetch every photograph — a cache that never hits.
       * Every current browser sends the `Sec-Fetch-*` headers, so the referer
       * path only handles old clients, and for those a browser cache is enough.
       */
      Vary: 'Sec-Fetch-Dest, Sec-Fetch-Site',
    },
  });
}
