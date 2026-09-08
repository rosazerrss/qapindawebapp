'use client';

/**
 * QAPINDA — Google's answers to "what is at this pin" and "where is this text".
 *
 * This module never decides whether Google should be used. `geocode.ts` does
 * that, and everything here returns null or an empty list on any failure so
 * that the decision is easy to make: no answer means fall through to Nominatim.
 * Nothing in this file throws.
 *
 * THE TWO THINGS BEING BOUGHT, AND WHAT THEY COST
 * -----------------------------------------------
 * Address search is Places Autocomplete. Reverse geocoding — pin to street
 * name — is the Geocoding API. They are billed separately and one can be
 * switched off in the console without the other, so each is tried on its own
 * and each falls back on its own.
 *
 * THE SESSION TOKEN, WHICH IS THE WHOLE COST MODEL
 * ------------------------------------------------
 * Somebody typing "Nizami küçəsi" produces a request per keystroke. Billed per
 * request that is a dozen calls for one address. Billed per SESSION — which is
 * what a token buys — the typing and the final lookup of the chosen place
 * together count as one. It is the difference between the free monthly
 * allowance lasting weeks and lasting an afternoon.
 *
 * A session opens at the first keystroke and closes when a result is picked.
 * That is why `searchAddress` does not return coordinates: fetching them for
 * all five suggestions would be five lookups instead of the one the customer
 * actually chose, and would end the session five times over. Coordinates are
 * resolved in `resolveGooglePlace`, once, for the one they tapped.
 */

import { loadGoogleMaps } from './googleMaps';

/** Azerbaijan only. Nothing in this app delivers anywhere else. */
const REGION = 'az';

const LANGUAGE = 'az';

export interface GooglePrediction {
  placeId: string;
  line: string;
}

/**
 * The predictions from the current typing session, by place id.
 *
 * Held because a prediction has to be turned back into a `Place` through the
 * object Google handed us — that link is what keeps the session token attached
 * to the final lookup, and a `Place` rebuilt from a bare id would be billed as
 * a fresh one.
 *
 * Cleared when a session ends, so this never grows.
 */
let predictions = new Map<string, google.maps.places.PlacePrediction>();

/** The open typing session, if there is one. */
let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

/**
 * Ends the current session without spending it.
 *
 * Called when the search box is emptied or the sheet is closed: an abandoned
 * session is not billed, but a token left lying around would be reused by the
 * NEXT search, which is what Google treats as gaming the session pricing.
 */
export function endGoogleSession(): void {
  sessionToken = null;
  predictions = new Map();
}

/**
 * Turns the street-level parts of a Google result into one readable line.
 *
 * `formatted_address` on its own is unusable here: it ends in "Azerbaijan" and
 * carries the city and often a postcode the customer already chose from a list.
 * What a courier needs is the street and number, then the neighbourhood — so
 * that is what is assembled, in that order, and the rest is dropped.
 */
function lineOfComponents(
  components: google.maps.GeocoderAddressComponent[] | undefined,
  fallback: string | null,
): string | null {
  if (!components || components.length === 0) return fallback;

  const find = (type: string) =>
    components.find((component) => component.types.includes(type))?.long_name ?? null;

  const street = find('route');
  const number = find('street_number');
  const area = find('sublocality') ?? find('neighborhood') ?? find('sublocality_level_1');

  const parts = [street && number ? `${street} ${number}` : street, area].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : fallback;
}

/**
 * The address at a point, as a single readable line. Null if Google will not
 * or cannot say.
 */
export async function googleReverseGeocode(
  point: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<string | null> {
  const maps = await loadGoogleMaps();
  if (!maps || signal?.aborted) return null;

  try {
    const geocoder = new maps.Geocoder();
    const { results } = await geocoder.geocode({
      location: point,
      language: LANGUAGE,
      region: REGION,
    });
    if (signal?.aborted) return null;

    const best = results[0];
    if (!best) return null;

    return lineOfComponents(best.address_components, best.formatted_address ?? null);
  } catch {
    // ZERO_RESULTS, a refused key, an API that is not enabled, a network that
    // dropped. One answer to all of them: let Nominatim try.
    return null;
  }
}

/**
 * Places matching what somebody typed. At most five, Azerbaijan only.
 *
 * Returns place ids, NOT coordinates — see the note on session tokens above.
 * An empty list means "no suggestions" and also "Google did not answer", and
 * the caller must treat them the same, because the screen's reply to both is
 * the same: put the pin where you live instead.
 */
export async function googleSearchAddress(
  term: string,
  signal?: AbortSignal,
): Promise<GooglePrediction[]> {
  const query = term.trim();
  if (query.length < 3) return [];

  const maps = await loadGoogleMaps();
  if (!maps || signal?.aborted) return [];

  const places = maps.places as typeof google.maps.places | undefined;
  // The Places API can be switched off in the console while Maps and Geocoding
  // stay on. That is a configuration, not a fault — Nominatim takes the search.
  if (!places?.AutocompleteSuggestion || !places.AutocompleteSessionToken) return [];

  try {
    sessionToken ??= new places.AutocompleteSessionToken();

    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      sessionToken,
      includedRegionCodes: [REGION],
      language: LANGUAGE,
      region: REGION,
    });
    if (signal?.aborted) return [];

    const out: GooglePrediction[] = [];

    for (const suggestion of suggestions.slice(0, 5)) {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId) continue;

      /*
       * `mainText` is the street; `secondaryText` is the district and city.
       * Both, because "Nizami küçəsi" alone is ambiguous across three cities
       * and the customer is choosing between rows that would otherwise read
       * identically.
       */
      const main = prediction.mainText?.toString() ?? prediction.text?.toString() ?? '';
      const secondary = prediction.secondaryText?.toString() ?? '';
      const line = [main, secondary].filter(Boolean).join(', ');
      if (!line) continue;

      predictions.set(prediction.placeId, prediction);
      out.push({ placeId: prediction.placeId, line });
    }

    return out;
  } catch {
    return [];
  }
}

/**
 * Where a chosen suggestion actually is. This is what closes the session.
 *
 * Null when the place cannot be resolved — an id from a previous session, a
 * details call that was refused. The caller keeps the pin where it is and the
 * customer drags it, which is the flow this whole screen is built to survive
 * on.
 */
export async function resolveGooglePlace(
  placeId: string,
): Promise<{ lat: number; lng: number; line: string } | null> {
  const prediction = predictions.get(placeId);
  if (!prediction) return null;

  try {
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });

    const location = place.location;
    if (!location) return null;

    const line =
      place.displayName ??
      place.formattedAddress?.replace(/,\s*Azərbaycan$/i, '').replace(/,\s*Azerbaijan$/i, '') ??
      '';

    return { lat: location.lat(), lng: location.lng(), line };
  } catch {
    return null;
  } finally {
    // Spent or failed, the session is over either way. Reusing this token for
    // the next search is exactly what session pricing forbids.
    endGoogleSession();
  }
}
