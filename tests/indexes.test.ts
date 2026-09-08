import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every composite query must have an index declared for it.
 *
 * Firestore does not fail a missing index at build time, at deploy time, or in
 * any test that does not hit the database. It fails at the moment a customer
 * presses "order" — as FAILED_PRECONDITION, which the caller sees as a bare
 * "something went wrong". Two of those reached production in one evening, and
 * each one was invisible until somebody tried the exact combination that
 * triggered it.
 *
 * So this test reads the source, works out which composite indexes the code
 * actually needs, and checks each one against `firestore.indexes.json`. It is
 * an approximation of Firestore's own rules, deliberately erring towards
 * demanding an index that might not be needed — a redundant index costs a few
 * megabytes; a missing one costs an order.
 *
 * The rules it encodes:
 *   - equality filters come first, in any order;
 *   - a range filter and any orderBy come after, in order;
 *   - with a range and no explicit orderBy, Firestore sorts by the range field
 *     ASCENDING. That exact detail is what broke ordering: the declared index
 *     had it DESCENDING.
 */

interface DeclaredIndex {
  collectionGroup: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
}

interface SourceQuery {
  file: string;
  collection: string;
  equality: string[];
  ordered: Array<{ field: string; direction: 'ASCENDING' | 'DESCENDING' }>;
}

const EQUALITY_OPS = new Set(['==', 'in', 'array-contains', 'array-contains-any']);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        // The synced copies of `shared/` would double-count every query.
        if (entry === 'shared' || entry === 'node_modules') continue;
        walk(path);
      } else if (/\.tsx?$/.test(path)) {
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

/** Pulls `.where`/`.orderBy` chains out of one file, with their collection. */
function queriesIn(file: string): SourceQuery[] {
  const source = readFileSync(file, 'utf8');
  const found: SourceQuery[] = [];

  const chain =
    /collection\(\s*(?:db\s*,\s*)?(?:COLLECTIONS\.(\w+)|'(\w+)')\s*\)((?:[\s)]*\.(?:where|orderBy|limit|limitTo|count)\([^)]*\))+)/g;

  for (const match of source.matchAll(chain)) {
    const collection = match[1] ?? match[2];
    const tail = match[3];

    const equality: string[] = [];
    const ordered: SourceQuery['ordered'] = [];
    let range: string | null = null;

    for (const where of tail.matchAll(/\.where\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      const [, field, op] = where;
      if (EQUALITY_OPS.has(op)) equality.push(field);
      else range = field;
    }

    for (const order of tail.matchAll(/\.orderBy\(\s*'([^']+)'(?:\s*,\s*'(\w+)')?/g)) {
      ordered.push({
        field: order[1],
        direction: order[2] === 'desc' ? 'DESCENDING' : 'ASCENDING',
      });
    }

    // A range with no explicit sort is sorted by that field, ascending.
    if (range && !ordered.some((entry) => entry.field === range)) {
      ordered.unshift({ field: range, direction: 'ASCENDING' });
    }

    // One filter and nothing else is served by the automatic single-field index.
    if (equality.length + ordered.length < 2) continue;
    if (equality.length <= 1 && ordered.length === 0) continue;
    // A range plus a sort on the same single field also needs no composite.
    if (equality.length === 0 && ordered.length === 1) continue;

    /*
     * One equality plus a sort by document id needs no composite either.
     *
     * Firestore's automatic single-field index on `f` is stored as `(f,
     * __name__)` — the document id is always the tiebreaker. So
     * `where('restaurantId', '==', x).orderBy('__name__')`, which is how every
     * resumable page in this codebase walks one restaurant's rows, is served by
     * an index that already exists. Declaring one would cost storage on every
     * write to buy nothing.
     */
    if (
      equality.length === 1 &&
      ordered.length === 1 &&
      ordered[0].field === '__name__' &&
      ordered[0].direction === 'ASCENDING'
    ) {
      continue;
    }

    found.push({ file, collection, equality, ordered });
  }

  return found;
}

function servedBy(query: SourceQuery, index: DeclaredIndex, collectionName: string): boolean {
  if (index.collectionGroup !== collectionName) return false;

  const prefix = index.fields.slice(0, query.equality.length);
  const prefixFields = new Set(prefix.map((field) => field.fieldPath));
  if (prefixFields.size !== query.equality.length) return false;
  if (!query.equality.every((field) => prefixFields.has(field))) return false;

  const rest = index.fields.slice(query.equality.length);
  return query.ordered.every((wanted, position) => {
    const declared = rest[position];
    return declared?.fieldPath === wanted.field && declared.order === wanted.direction;
  });
}

describe('firestore composite indexes', () => {
  const declared = (
    JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as { indexes: DeclaredIndex[] }
  ).indexes;

  const collectionNames = (() => {
    const source = readFileSync('shared/collections.ts', 'utf8');
    const map: Record<string, string> = {};
    for (const line of source.matchAll(/^\s*(\w+):\s*'([\w-]+)',/gm)) map[line[1]] = line[2];
    return map;
  })();

  const queries = [...sourceFiles('functions/src'), ...sourceFiles('src')].flatMap(queriesIn);

  it('finds the queries at all', () => {
    // Guards against the extraction quietly matching nothing and the whole
    // check passing for the wrong reason.
    expect(queries.length).toBeGreaterThan(8);
  });

  it('declares an index for every composite query in the code', () => {
    const missing = queries
      .filter((query) => {
        const name = collectionNames[query.collection] ?? query.collection;
        return !declared.some((index) => servedBy(query, index, name));
      })
      .map((query) => {
        const name = collectionNames[query.collection] ?? query.collection;
        const where = query.equality.join(' + ') || '—';
        const order = query.ordered
          .map((entry) => `${entry.field} ${entry.direction}`)
          .join(' + ');
        return `${name}: WHERE ${where} ORDER ${order}   (${query.file})`;
      });

    expect(missing).toEqual([]);
  });
});
