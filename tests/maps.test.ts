/**
 * QAPINDA — Google Maps, and the promise that losing it costs nothing.
 *
 * WHAT THESE TESTS ARE ACTUALLY DEFENDING
 * ---------------------------------------
 * Not that Google draws a map — nothing here can verify that, and a test that
 * pretended to would be theatre. What they defend is the decision that a
 * SECOND provider stays complete beside it.
 *
 * That decision is easy to make once and impossible to keep by accident. Six
 * months from now, tidying up, somebody deletes the Leaflet map because "we use
 * Google now". The app keeps working on their machine, keeps working in review,
 * and then goes blank on the evening the billing card expires — with a dozen
 * restaurants unable to set a delivery area and every customer unable to save
 * an address. These tests are what makes that deletion fail loudly, here,
 * instead of quietly, then.
 *
 * They read source rather than run components, which is the same limitation the
 * rest of this suite has and worth restating: they prove the fallback is still
 * WIRED, not that it renders. Comments are stripped before every assertion, so
 * a match is code and never the prose above it explaining the code.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/**
 * Source with comments removed.
 *
 * This suite has caught itself six times over: an assertion looking for a rule
 * matches the paragraph that explains the rule, and passes for ever after
 * somebody deletes the code and leaves the paragraph.
 *
 * The `[^:]` guard is not decoration. This file is full of assertions about
 * URLs, and a naive line-comment strip cuts every one of them in half at the
 * `//` in `https://` — which turned four passing checks into four failures the
 * first time it ran, all of them claiming a tile server had been deleted that
 * was sitting there in plain sight.
 */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the key is treated as public and the private one is not', () => {
  it('reads the browser key from a NEXT_PUBLIC variable', () => {
    // Not a mistake and not a leak. A Maps browser key is sent to the browser
    // by design and is protected by the referrer restriction on Google's side.
    expect(code('src/lib/googleMaps.ts')).toContain('NEXT_PUBLIC_GOOGLE_MAPS_KEY');
  });

  it('never puts the Epoint private key anywhere a browser could read it', () => {
    /*
     * The opposite rule, asserted in the same file that breaks the first one,
     * because the two live one line apart in `.env.local` and the failure mode
     * is somebody copying the wrong prefix onto the wrong secret.
     */
    for (const file of ['src/lib/googleMaps.ts', 'src/lib/googleGeocode.ts', '.env.local']) {
      expect(read(file)).not.toMatch(/NEXT_PUBLIC_EPOINT_PRIVATE/);
    }
  });
});

describe('a missing or broken key is a supported state', () => {
  it('rejects a placeholder that is not a key', () => {
    /*
     * The ordinary way this goes wrong is not an empty value but
     * `NEXT_PUBLIC_GOOGLE_MAPS_KEY=BURAYA_ACAR` copied out of the
     * instructions — a non-empty string that Google will refuse. Without the
     * shape check the app would load the library and show a grey box.
     */
    const source = code('src/lib/googleMaps.ts');
    expect(source).toMatch(/KEY\.startsWith\('AIza'\)/);
    expect(source).toMatch(/KEY\.length\s*>=\s*30/);
  });

  it('resolves null instead of throwing when the library will not load', () => {
    const source = code('src/lib/googleMaps.ts');
    expect(source).toContain('finish(null)');
    expect(source).not.toMatch(/throw new/);
  });

  it('waits for Google to say it is ready, not for the script tag', () => {
    /*
     * The v33 bug, nailed down.
     *
     * The script's `load` event fires when the BOOTSTRAP has run; under
     * `loading=async` the bootstrap then goes and fetches the real library. Code
     * that read `window.google.maps` at `load` time found nothing and concluded
     * the key had been refused — so every map on the platform silently drew
     * OpenStreetMap while the network tab showed Google's files arriving with
     * 200s and the console showed no error at all.
     *
     * `callback` is the only signal that means ready. Going back to the `load`
     * event would reintroduce a bug with no symptom except a Google bill for a
     * map nobody is being shown.
     */
    const source = code('src/lib/googleMaps.ts');
    expect(source).toContain('&callback=');
    expect(source).not.toMatch(/addEventListener\('load'/);
  });

  it('gives up after a timeout rather than waiting for ever', () => {
    // A refused key does not fail the script — Google serves the bootstrap to
    // anybody — and may never call back at all. Without this the screen sits on
    // "Yüklənir…", which is the one outcome worse than the fallback map.
    expect(code('src/lib/googleMaps.ts')).toMatch(/LOAD_TIMEOUT_MS/);
  });

  it('says out loud when it falls back', () => {
    /*
     * A silent fallback is indistinguishable from a working map to everyone
     * except the person paying for the one that is not being drawn. The v33 bug
     * cost an afternoon precisely because nothing anywhere said "I gave up".
     */
    expect(code('src/lib/googleMaps.ts')).toMatch(/console\.warn/);
  });
});

describe('the OpenStreetMap map is still there, and still reachable', () => {
  it('keeps a complete Leaflet delivery map', () => {
    const source = code('src/components/restaurant/maps/LeafletDeliveryMap.tsx');
    expect(source).toContain('tile.openstreetmap.org');
    // Draggable pin and the circle that follows it: the two things the screen
    // exists to do. A stub with tiles and no marker would pass a laxer test.
    expect(source).toMatch(/draggable:\s*true/);
    expect(source).toContain('L.circle');
  });

  it('chooses between the two maps rather than hard-wiring one', () => {
    const source = code('src/components/restaurant/DeliveryMap.tsx');
    expect(source).toContain('hasGoogleMaps()');
    expect(source).toContain('GoogleDeliveryMap');
    expect(source).toContain('LeafletDeliveryMap');
  });

  it('falls back at RUNTIME too, not only when the key is absent', () => {
    /*
     * The distinction this whole design turns on. `hasGoogleMaps()` is answered
     * at build time from a baked-in variable: it says a key was CONFIGURED. It
     * cannot say the key still works. Billing lapses, quotas are spent, an API
     * gets switched off in the console, a referrer restriction stops matching a
     * new domain — every one of those produces a configured key and a refused
     * map, and a build-time-only check would render a grey box for each.
     */
    const source = code('src/components/restaurant/maps/GoogleDeliveryMap.tsx');
    expect(source).toContain("'fallback'");
    expect(source).toContain('<LeafletDeliveryMap');
  });

  it('gives the courier the same runtime fallback', () => {
    const source = code('src/components/restaurant/DestinationMap.tsx');
    expect(source).toContain('drawLeaflet');
    expect(source).toContain('tile.openstreetmap.org');
  });

  it('keeps the navigation link, which needs no key at all', () => {
    /*
     * The link — not the map — is what actually gets the food to the door. It
     * is a plain URL, it costs nothing, and it keeps working on a driver's
     * phone whatever has happened to the billing account.
     */
    expect(code('src/components/restaurant/DestinationMap.tsx')).toContain(
      'google.com/maps/dir/?api=1&destination=',
    );
  });
});

describe('the geocoder falls back the same way', () => {
  it('keeps Nominatim as the second answer, not as dead code', () => {
    const source = code('src/lib/geocode.ts');
    expect(source).toContain('nominatim.openstreetmap.org');
    // Google is asked first and Nominatim is reached when it says nothing —
    // which is the same line that covers "Places API not enabled".
    expect(source).toContain('googleSearchAddress');
    expect(source).toContain('googleReverseGeocode');
  });

  it('still holds itself to one Nominatim request a second', () => {
    // Somebody else's free service. The politeness that made it acceptable to
    // use must not quietly lapse now that it is the second choice.
    expect(code('src/lib/geocode.ts')).toMatch(/MIN_INTERVAL_MS\s*=\s*1100/);
  });

  it('never throws out of either provider', () => {
    for (const file of ['src/lib/geocode.ts', 'src/lib/googleGeocode.ts']) {
      expect(code(file)).not.toMatch(/throw new/);
    }
  });
});

describe('autocomplete is billed by session, not by keystroke', () => {
  it('opens a session token and reuses it while typing', () => {
    /*
     * Without a token every keystroke is a billable request: "Nizami küçəsi" is
     * a dozen calls for one address. With one, the typing and the final lookup
     * are a single session. It is the difference between the free monthly
     * allowance lasting weeks and lasting an afternoon.
     */
    const source = code('src/lib/googleGeocode.ts');
    expect(source).toContain('AutocompleteSessionToken');
    expect(source).toMatch(/sessionToken\s*\?\?=/);
  });

  it('closes the session when the chosen place is fetched', () => {
    const source = code('src/lib/googleGeocode.ts');
    expect(source).toContain('endGoogleSession');
    // In a `finally`, so a failed lookup ends the session too — a token kept
    // after a failure would be reused by the next search, which is exactly the
    // reuse session pricing forbids.
    expect(source).toMatch(/finally\s*\{[\s\S]*endGoogleSession\(\)/);
  });

  it('does not fetch coordinates for suggestions nobody chose', () => {
    /*
     * The reason `searchAddress` returns rows without coordinates. Resolving
     * all five suggestions would be five paid lookups for the one the customer
     * tapped, and would end the session five times over.
     */
    const source = code('src/lib/googleGeocode.ts');
    const search = source.slice(
      source.indexOf('export async function googleSearchAddress'),
      source.indexOf('export async function resolveGooglePlace'),
    );
    expect(search).not.toContain('fetchFields');
  });
});

describe('the address screen does not care which provider answered', () => {
  it('resolves a chosen row through one function', () => {
    const source = code('src/components/customer/AddressForm.tsx');
    expect(source).toContain('resolveResult');
    // Reading `result.lat` directly would work for Nominatim rows and silently
    // put the pin at `undefined` for Google ones.
    expect(source).not.toMatch(/setFocus\(\{\s*lat:\s*result\.lat/);
  });

  it('still saves an address when no geocoder answers at all', () => {
    /*
     * The load-bearing claim of the whole address flow: the PIN is what the
     * delivery radius is measured against, and the written line is for a human.
     * Losing every geocoder costs convenience, never the ability to save.
     */
    const source = code('src/components/customer/AddressForm.tsx');
    expect(source).toContain('pinOnMapInstead');
  });
});
