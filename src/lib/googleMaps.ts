'use client';

/**
 * QAPINDA — Loading Google Maps once, and answering "is it there?".
 *
 * WHY A LOADER RATHER THAN A SCRIPT TAG IN THE LAYOUT
 * ---------------------------------------------------
 * Three screens use a map and most visits touch none of them. A tag in the
 * layout would fetch the library — and bill a map load — on the home page, the
 * basket, the order list, every time. This loads it the first time a map is
 * actually about to be drawn, and once for the whole session however many maps
 * follow.
 *
 * NO KEY IS A SUPPORTED STATE, NOT AN ERROR
 * -----------------------------------------
 * `hasGoogleMaps()` answering false is how every caller falls back to the
 * OpenStreetMap map and the Nominatim geocoder that were here before. That is
 * not a degraded mode bolted on — it is the mode this platform ran in until
 * today, and it stays complete. So:
 *
 *   • a deployment with no key keeps working exactly as it did;
 *   • a key that stops working — expired billing, a quota hit, a referrer
 *     restriction that no longer matches a new domain — degrades to a working
 *     map rather than to an empty grey box.
 *
 * That second case is the one worth building for. A billing account can lapse
 * on a Sunday, and "the address screen is broken" is not an acceptable answer
 * to it.
 *
 * WHAT IS LOADED
 * --------------
 * `places` for the address search and `geometry` for the distance the delivery
 * circle is drawn from. Nothing else: every extra library is bytes on a phone.
 */

/**
 * The browser key.
 *
 * Public, and unavoidably so — see the note in `.env.local`. It is protected by
 * the referrer restriction on Google's side, not by secrecy.
 */
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? '';

/**
 * The shortest string that could be a real key.
 *
 * The same lesson as the VAPID key in `fcm.ts`: the ordinary way this goes
 * wrong is not an absent value but a placeholder one — somebody copies
 * `NEXT_PUBLIC_GOOGLE_MAPS_KEY=BURAYA_ACAR` out of the instructions and the
 * file now holds a non-empty string that is not a key. Without this check the
 * app would load the library, be refused by Google, and show a grey box with a
 * console error nobody reads.
 *
 * Google's browser keys are 39 characters and begin `AIza`.
 */
export function hasGoogleMaps(): boolean {
  return KEY.length >= 30 && KEY.startsWith('AIza');
}

/** Resolved once the library is on the page; null while it is not. */
let loading: Promise<typeof google.maps | null> | null = null;

/**
 * The global Google calls when the library is genuinely ready.
 *
 * Unusual enough to name: the name is written on `window` and then handed to
 * Google inside the script URL, because `callback` is the ONLY signal Google
 * gives that says "ready", and it can only name a global.
 */
const CALLBACK = '__qapindaMapsReady';

/** Past this, a map that has not loaded is not going to. */
const LOAD_TIMEOUT_MS = 12_000;

declare global {
  interface Window {
    [CALLBACK]?: () => void;
  }
}

/**
 * Loads the Maps JavaScript API, once.
 *
 * WHY `callback` AND NOT THE SCRIPT'S `load` EVENT
 * ------------------------------------------------
 * This is the bug that shipped in v33, and it is worth writing down because it
 * is invisible in every way a bug can be.
 *
 * The script tag's `load` event fires when the BOOTSTRAP has run. Under
 * `loading=async` the bootstrap's whole job is to go and fetch the real library
 * afterwards — so at `load` time `window.google.maps` is either absent or
 * half-built. The first version of this file read it there, found nothing, and
 * concluded the key had been refused. Every map on the platform silently fell
 * back to OpenStreetMap while the network tab showed Google's files arriving
 * with 200s, the console showed no error at all, and typing
 * `google.maps.importLibrary('maps')` into that same console a second later
 * answered OK — because by then the library HAD finished loading. Every
 * available signal said the key was fine. It was.
 *
 * `callback` is Google's own answer and the only one that is not a guess: the
 * library calls it when it is ready to use, and never before.
 *
 * Returns null rather than throwing on every real failure — a blocked script,
 * an offline phone, a rejected key — because every caller's right answer to all
 * of them is the same: draw the OpenStreetMap map instead.
 */
export function loadGoogleMaps(): Promise<typeof google.maps | null> {
  if (loading) return loading;

  if (typeof window === 'undefined' || !hasGoogleMaps()) {
    loading = Promise.resolve(null);
    return loading;
  }

  loading = new Promise((resolve) => {
    let settled = false;

    /**
     * Answers once, and says out loud when the answer is "no".
     *
     * The warning is the lesson of v33 turned into a line of code. A silent
     * fallback is indistinguishable from a working map to everyone except the
     * person paying Google for the one that is not being drawn, and the only
     * reason that bug took an afternoon to find is that nothing anywhere said
     * "I gave up". Now something does.
     */
    const finish = (maps: typeof google.maps | null) => {
      if (settled) return;
      settled = true;
      /*
       * Replaced with a no-op rather than deleted. On the timeout path Google
       * may still call this afterwards, and a missing global there is an
       * uncaught error in the customer's console for a decision that has
       * already been made.
       */
      window[CALLBACK] = () => {};
      if (!maps) {
        console.warn('[Qapında] Google Maps yüklənmədi — OpenStreetMap istifadə olunur.');
        // Let a later map try again: a phone that lost signal in a lift should
        // not be stuck on the fallback for the rest of the session.
        loading = null;
      }
      resolve(maps);
    };

    // Already on the page — a second copy of this module, or a hot reload.
    if (window.google?.maps?.Map) {
      finish(window.google.maps);
      return;
    }

    /*
     * Ready. `importLibrary` is awaited for the pieces this app uses, but every
     * one of them is optional: a project with the Places API switched off still
     * gets a working map, and the address search falls back to Nominatim on its
     * own. Only the map itself is required, and the callback has already
     * guaranteed that.
     */
    window[CALLBACK] = () => {
      const maps = window.google?.maps;
      if (!maps) {
        finish(null);
        return;
      }

      void (async () => {
        await Promise.allSettled([
          maps.importLibrary('maps'),
          maps.importLibrary('places'),
          maps.importLibrary('geocoding'),
        ]);
        finish(window.google?.maps ?? null);
      })();
    };

    const script = document.createElement('script');
    /*
     * `loading=async` with `callback` is Google's recommended pair: the library
     * initialises without blocking the page, which on a phone is the difference
     * between the address sheet opening at once and opening after the map has
     * downloaded — and the callback removes the race that comes with it.
     *
     * `language=az` and `region=AZ` so street names and the geocoder's answers
     * come back in the language the customer is typing in.
     */
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}` +
      `&libraries=places,geometry&language=az&region=AZ&loading=async&v=weekly` +
      `&callback=${CALLBACK}`;
    script.async = true;

    // The script itself never arrived: blocked, offline, or a network that
    // refuses Google.
    script.addEventListener('error', () => finish(null));

    /*
     * And the case with no event at all.
     *
     * A refused key does not fail the script — Google serves the bootstrap to
     * anybody — it fails afterwards, sometimes without ever calling back. With
     * no timeout the map would sit on "Yüklənir…" for ever, which is the one
     * outcome worse than the OpenStreetMap map.
     */
    setTimeout(() => finish(window.google?.maps?.Map ? window.google.maps : null), LOAD_TIMEOUT_MS);

    document.head.appendChild(script);
  });

  return loading;
}

/**
 * A session token for the address search.
 *
 * WHAT IT SAVES, IN MONEY
 * -----------------------
 * Autocomplete is billed per SESSION when a token is used, and per REQUEST when
 * it is not. Somebody typing "Nizami küçəsi" sends a dozen requests; without a
 * token that is a dozen billable calls, with one it is a single session that
 * ends when they pick a result. It is the difference between the free monthly
 * allowance lasting weeks and lasting an afternoon.
 *
 * A token is used for one search and thrown away. Reusing one across searches
 * is what Google treats as abuse of the session pricing.
 */
export function newSessionToken(
  maps: typeof google.maps,
): google.maps.places.AutocompleteSessionToken {
  return new maps.places.AutocompleteSessionToken();
}
