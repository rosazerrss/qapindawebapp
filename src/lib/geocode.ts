'use client';

/**
 * Turning a map pin into a line of text, and a line of text into a map pin.
 *
 * TWO PROVIDERS, ONE CONTRACT
 * ---------------------------
 * Google first when a browser key is configured, Nominatim otherwise — and
 * Nominatim again whenever Google returns nothing, which covers a key that was
 * refused, an API left switched off in the console, a spent quota and a lapsed
 * billing account. The screen above cannot tell which one answered and must
 * not be able to: an address saved with Google and an address saved without it
 * are the same address, because in both cases what the delivery radius is
 * measured against is the PIN.
 *
 * WHY NOMINATIM IS STILL HERE
 * ---------------------------
 * The map it belongs to is still here — see `LeafletDeliveryMap`. Keeping the
 * geocoder that matches it costs one file and buys a platform that keeps
 * taking orders on the Sunday somebody's card expires.
 *
 * WHICH MEANS RESPECTING SOMEBODY ELSE'S FREE SERVICE
 * ---------------------------------------------------
 * Nominatim's usage policy asks for at most one request a second, no bulk
 * querying, and an identifiable client. This module is the only place in the
 * app that talks to it, and it holds itself to that: every call goes through
 * one queue that will not let two requests leave inside `MIN_INTERVAL_MS`, a
 * dragged pin is debounced by the caller so a drag is one lookup rather than
 * forty, and an in-flight request is aborted the moment a newer one is wanted.
 *
 * AND DEGRADING WHEN IT IS NOT THERE
 * ----------------------------------
 * Every function here returns `null` or an empty list on any failure — offline,
 * rate-limited, blocked by a network, or simply slow. Nothing throws. That is
 * what lets the address screen fall back to "the pin is what counts; write the
 * street yourself", which is a complete, usable flow rather than an error
 * state: the PIN is what the delivery radius is measured against, and the
 * written line is for a human. Losing the geocoder costs convenience, never the
 * ability to save an address.
 */

import { hasGoogleMaps } from './googleMaps';
import {
  endGoogleSession,
  googleReverseGeocode,
  googleSearchAddress,
  resolveGooglePlace,
} from './googleGeocode';

/** One request a second, which is what the usage policy asks for. */
const MIN_INTERVAL_MS = 1100;

/** Past this, the answer is no longer worth waiting for on a phone. */
const TIMEOUT_MS = 6000;

const ENDPOINT = 'https://nominatim.openstreetmap.org';

/** Azerbaijan only. Nothing in this app delivers anywhere else. */
const COUNTRY = 'az';

let lastRequestAt = 0;

/**
 * One row in the address search.
 *
 * WHY THE COORDINATES ARE OPTIONAL
 * --------------------------------
 * Nominatim hands back the position with the suggestion; Google's autocomplete
 * deliberately does not. Fetching the position of all five Google suggestions
 * would be five paid lookups for the one the customer taps, and would end the
 * billing session five times over — see the note in `googleGeocode.ts`.
 *
 * So a row carries either a position or a place id, and `resolveResult` is what
 * turns whichever it has into a pin. Callers go through that function and never
 * read `lat`/`lng` off a row directly.
 */
export interface GeocodeResult {
  /** The single line to show and to save. */
  line: string;
  lat?: number;
  lng?: number;
  /** Google only: resolved on selection, which is what closes the session. */
  placeId?: string;
}

/**
 * Waits out the interval, then fetches — or gives up quietly.
 *
 * The queue is a module-level timestamp rather than a promise chain: a chain
 * would make a request that nobody is waiting for any more still hold the next
 * one back, and on this screen the request nobody is waiting for is the common
 * case (the pin moved again).
 */
async function politeFetch(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (signal?.aborted) return null;
  lastRequestAt = Date.now();

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // Aborted, offline, CORS, rate-limited, malformed JSON. Every one of them
    // means the same thing to the caller: no answer, carry on without one.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Builds the one readable line out of Nominatim's address parts.
 *
 * `display_name` on its own is unusable here: it ends in "Azərbaycan" and often
 * carries a postcode, a district and a region the customer already chose from a
 * list. What a courier needs is street and number, then the neighbourhood — so
 * that is what is assembled, in that order, and the rest is dropped.
 */
function lineOf(payload: Record<string, unknown>): string | null {
  const address = payload.address as Record<string, string> | undefined;
  if (!address) {
    const display = payload.display_name;
    return typeof display === 'string' ? display : null;
  }

  const street = address.road ?? address.pedestrian ?? address.residential ?? null;
  const number = address.house_number ?? null;
  const area = address.suburb ?? address.neighbourhood ?? address.quarter ?? address.village ?? null;

  const parts = [street && number ? `${street} ${number}` : street, area].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');

  const display = payload.display_name;
  return typeof display === 'string' ? display : null;
}

/**
 * The address at a point, as a single readable line.
 *
 * Null means "we could not say", never "there is nothing there" — the caller
 * must treat the two identically anyway, because a pin in a field is a valid
 * place to deliver to and the customer can type the line themselves.
 */
export async function reverseGeocode(
  point: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<string | null> {
  if (hasGoogleMaps()) {
    const answer = await googleReverseGeocode(point, signal);
    if (answer) return answer;
    if (signal?.aborted) return null;
    // Google had nothing, or would not answer. Nominatim gets a turn: a pin in
    // a village Google names poorly is often a street OSM knows perfectly well.
  }

  const url =
    `${ENDPOINT}/reverse?format=jsonv2&zoom=18&addressdetails=1` +
    `&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lng)}`;

  const payload = await politeFetch(url, signal);
  if (!payload || typeof payload !== 'object') return null;
  return lineOf(payload as Record<string, unknown>);
}

/**
 * Places matching what somebody typed. At most five, Azerbaijan only.
 *
 * An empty list is the honest answer to "we found nothing" AND to "the service
 * did not answer", and the screen says the same thing for both: put the pin
 * where you live instead. Telling them apart would only offer a distinction
 * there is nothing to do about.
 */
export async function searchAddress(
  term: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const query = term.trim();
  if (query.length < 3) return [];

  if (hasGoogleMaps()) {
    const suggestions = await googleSearchAddress(query, signal);
    if (suggestions.length > 0) {
      return suggestions.map((entry) => ({ line: entry.line, placeId: entry.placeId }));
    }
    if (signal?.aborted) return [];
  }

  const url =
    `${ENDPOINT}/search?format=jsonv2&addressdetails=1&limit=5` +
    `&countrycodes=${COUNTRY}&q=${encodeURIComponent(query)}`;

  const payload = await politeFetch(url, signal);
  if (!Array.isArray(payload)) return [];

  return payload
    .map((entry): GeocodeResult | null => {
      const row = entry as Record<string, unknown>;
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const line = lineOf(row) ?? (typeof row.display_name === 'string' ? row.display_name : null);
      if (!line) return null;

      return { lat, lng, line } satisfies GeocodeResult;
    })
    .filter((entry): entry is GeocodeResult => entry !== null);
}

/**
 * Where a chosen suggestion is, whichever provider produced it.
 *
 * Nominatim rows already know; Google rows are looked up here, once, for the
 * one the customer tapped. Null means the lookup failed — the caller leaves the
 * pin where it is and the customer drags it, which is the flow the whole
 * address screen is built to survive on.
 *
 * `line` comes back too, because Google's own name for the place ("Nizami
 * küçəsi 12") is usually better than the label that was shown in the list.
 */
export async function resolveResult(
  result: GeocodeResult,
): Promise<{ lat: number; lng: number; line: string } | null> {
  if (typeof result.lat === 'number' && typeof result.lng === 'number') {
    return { lat: result.lat, lng: result.lng, line: result.line };
  }

  if (!result.placeId) return null;

  const place = await resolveGooglePlace(result.placeId);
  if (!place) return null;

  // An empty name from Google is worse than the row the customer just read.
  return { lat: place.lat, lng: place.lng, line: place.line || result.line };
}

/**
 * Abandon an open address-search session.
 *
 * Only Google has one. Called when the search box is cleared or the sheet is
 * closed, so the next search opens a session of its own rather than inheriting
 * a stale token.
 */
export function endAddressSearch(): void {
  if (hasGoogleMaps()) endGoogleSession();
}

/**
 * The browser's own answer to "where am I".
 *
 * Wrapped rather than called directly because the Geolocation API is a callback
 * API that can hang: a device with location switched off at the OS level never
 * calls either handler on some browsers, so the timeout is not optional. A
 * refusal is not an error worth a red box — it is a person saying no, and the
 * pin still works.
 */
export function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { lat: number; lng: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), TIMEOUT_MS + 4000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}
