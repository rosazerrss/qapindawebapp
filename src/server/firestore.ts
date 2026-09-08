import 'server-only';

/**
 * QAPINDA — Reading Firestore from the server, for the pages Google has to see.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Every page in this app is a client component, so the HTML a crawler receives
 * carries no restaurant name, no dish, no price — only the skeleton, with the
 * real content fetched afterwards by JavaScript the crawler may or may not run.
 * The measurable result was a food platform that could not be found by
 * searching for the food it sells.
 *
 * Fixing that means rendering the public pages on the server, and rendering on
 * the server means reading Firestore there.
 *
 * WHY THE REST API AND NOT `firebase-admin`
 * -----------------------------------------
 * The same reasoning as `/m/[...path]`, which had this problem first: adding
 * `firebase-admin` puts a large dependency and a credentials story into the web
 * bundle's server half for two queries. Cloud Run already runs as a service
 * account, Google's metadata server hands out an access token for it over plain
 * HTTP, and Firestore has a REST API. No key file, no new dependency.
 *
 * WHAT IT MAY AND MAY NOT DO
 * --------------------------
 * READS ONLY, and only of the two public collections. This module bypasses the
 * security rules — it holds the service's own credentials — so it is written to
 * be incapable of reading anything else: there is no generic "fetch this path"
 * export, and every function here answers one specific public question.
 *
 * OFF GOOGLE'S INFRASTRUCTURE IT ANSWERS NULL. On a laptop running `next dev`
 * there is no metadata server, so the page falls back to fetching in the
 * browser exactly as it did before. Nothing breaks; the HTML is simply not
 * pre-filled, which is the state the whole app was in until now.
 */

import { COLLECTIONS } from '@/shared/collections';
import type { MenuCategory, Product, Restaurant } from '@/shared/models';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Long enough to be worth caching, short enough that a price change lands. */
export const PUBLIC_REVALIDATE_SECONDS = 300;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  try {
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1000),
        cache: 'no-store',
      },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;

    cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
    };
    return cachedToken.value;
  } catch {
    // No metadata server. Not an error — see the header.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Firestore's REST shape, unwrapped.
//
// The API returns every field boxed: `{ stringValue: 'x' }`, `{ integerValue:
// '1200' }`, arrays as `{ arrayValue: { values: [...] } }`. These two functions
// turn that back into ordinary JavaScript so the rest of the app can use the
// same `Restaurant` and `Product` types it uses everywhere else.
// ---------------------------------------------------------------------------

type RestValue = Record<string, unknown>;

function unwrap(value: RestValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  // Integers arrive as strings because JSON cannot carry a 64-bit integer.
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) {
    return unwrapFields((value.mapValue as { fields?: Record<string, RestValue> }).fields ?? {});
  }
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: RestValue[] }).values ?? [];
    return values.map(unwrap);
  }
  return null;
}

function unwrapFields(fields: Record<string, RestValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = unwrap(value);
  return out;
}

interface RestDocument {
  name?: string;
  fields?: Record<string, RestValue>;
}

function documentToObject<T>(document: RestDocument | undefined): T | null {
  if (!document?.fields) return null;
  const data = unwrapFields(document.fields);
  // The id is the last path segment, and some documents do not repeat it in a
  // field. Filling it in here means callers never have to care which.
  const id = document.name?.split('/').pop();
  if (id && data.id === undefined) data.id = id;
  return data as T;
}

/**
 * Runs one structured query.
 *
 * Returns an empty list on every failure — no token, no network, a query the
 * indexes do not cover — because every caller's answer to all of them is the
 * same: render the page without pre-filled data and let the browser fetch it.
 */
async function runQuery(body: unknown): Promise<RestDocument[]> {
  if (!PROJECT_ID) return [];

  const token = await accessToken();
  if (!token) return [];

  try {
    const response = await fetch(`${BASE}:runQuery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!response.ok) return [];

    const rows = (await response.json()) as Array<{ document?: RestDocument }>;
    return rows.map((row) => row.document).filter((document): document is RestDocument =>
      Boolean(document),
    );
  } catch {
    return [];
  }
}

const ACTIVE = {
  fieldFilter: {
    field: { fieldPath: 'status' },
    op: 'EQUAL',
    value: { stringValue: 'ACTIVE' },
  },
};

/**
 * Every restaurant a guest may see. For the sitemap and the home page.
 *
 * Capped: a sitemap is allowed 50,000 entries and this platform will not reach
 * that, but an unbounded query on a page render is how a bill arrives.
 */
export async function publicRestaurants(limit = 1000): Promise<Restaurant[]> {
  const documents = await runQuery({
    structuredQuery: {
      from: [{ collectionId: COLLECTIONS.restaurants }],
      where: ACTIVE,
      orderBy: [{ field: { fieldPath: 'name' }, direction: 'ASCENDING' }],
      limit,
    },
  });

  return documents
    .map((document) => documentToObject<Restaurant>(document))
    .filter((restaurant): restaurant is Restaurant => restaurant !== null);
}

/** One restaurant by its handle — the slug in the URL, or the raw id. */
export async function publicRestaurant(handle: string): Promise<Restaurant | null> {
  const bySlug = await runQuery({
    structuredQuery: {
      from: [{ collectionId: COLLECTIONS.restaurants }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            ACTIVE,
            {
              fieldFilter: {
                field: { fieldPath: 'slug' },
                op: 'EQUAL',
                value: { stringValue: handle },
              },
            },
          ],
        },
      },
      limit: 1,
    },
  });

  const found = documentToObject<Restaurant>(bySlug[0]);
  if (found) return found;

  /*
   * Fall back to the id.
   *
   * `/restaurant/{handle}` accepts both — a slug for the shareable link and the
   * raw id for everything internal — and a page that only understood one of
   * them would render blank for the other, which is worse than not rendering
   * on the server at all.
   */
  const byId = await runQuery({
    structuredQuery: {
      from: [{ collectionId: COLLECTIONS.restaurants }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            ACTIVE,
            {
              fieldFilter: {
                field: { fieldPath: 'id' },
                op: 'EQUAL',
                value: { stringValue: handle },
              },
            },
          ],
        },
      },
      limit: 1,
    },
  });

  return documentToObject<Restaurant>(byId[0]);
}

/**
 * A restaurant's visible menu, for the server-rendered page.
 *
 * Two queries rather than one per category: a menu with twelve sections would
 * otherwise be thirteen round trips inside one page render.
 */
export async function publicMenu(
  restaurantId: string,
): Promise<{ categories: MenuCategory[]; products: Product[] }> {
  const restaurantIs = {
    fieldFilter: {
      field: { fieldPath: 'restaurantId' },
      op: 'EQUAL',
      value: { stringValue: restaurantId },
    },
  };

  const [categoryDocs, productDocs] = await Promise.all([
    runQuery({
      structuredQuery: {
        from: [{ collectionId: COLLECTIONS.menuCategories }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              restaurantIs,
              {
                fieldFilter: {
                  field: { fieldPath: 'visible' },
                  op: 'EQUAL',
                  value: { booleanValue: true },
                },
              },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: 'sortOrder' }, direction: 'ASCENDING' }],
        limit: 60,
      },
    }),
    runQuery({
      structuredQuery: {
        from: [{ collectionId: COLLECTIONS.products }],
        where: restaurantIs,
        orderBy: [{ field: { fieldPath: 'sortOrder' }, direction: 'ASCENDING' }],
        limit: 400,
      },
    }),
  ]);

  const categories = categoryDocs
    .map((document) => documentToObject<MenuCategory>(document))
    .filter((category): category is MenuCategory => category !== null);

  const products = productDocs
    .map((document) => documentToObject<Product>(document))
    .filter((product): product is Product => product !== null)
    // Hidden dishes are filtered here rather than in the query, because a
    // second inequality would need another composite index for no benefit at
    // these sizes.
    .filter((product) => product.availability !== 'HIDDEN');

  return { categories, products };
}
