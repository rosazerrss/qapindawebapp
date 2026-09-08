/**
 * QAPINDA — every link in the app leads somewhere.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * v37 renamed every route to English and rewrote every path in the codebase to
 * match. The sweep matched paths that begin with `/`, which is almost all of
 * them — and missed the ones built by joining a root constant to a tail:
 *
 *     href: `${ROOT}/gorunus`
 *
 * Nothing failed. TypeScript is happy, the build is happy, the tests were happy,
 * and every settings page in both panels answered 404 to whoever pressed it.
 * Two whole settings screens — the admin's eight pages and the restaurant's
 * nine — were unreachable for a release and a half.
 *
 * A grep for Azerbaijani words would have caught that one instance and nothing
 * about the next one. So this walks the actual route tree on disk, collects
 * every internal link the source builds, and checks each against it. It cannot
 * be fooled by a template string, and it fails the moment a folder is renamed
 * without its links.
 *
 * WHAT IT DELIBERATELY CANNOT CHECK
 * ---------------------------------
 * A path assembled from a variable whose value is not in the file — a href built
 * from a database field, say. Those are skipped rather than guessed at: a test
 * that invents a value to check produces a failure nobody can act on.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'src/app';

/** Every route the app actually serves, as path segment arrays. */
function routeTree(dir = APP, prefix: string[] = []): string[][] {
  const routes: string[][] = [];

  if (
    ['page.tsx', 'route.ts'].some((file) => {
      try {
        return statSync(join(dir, file)).isFile();
      } catch {
        return false;
      }
    })
  ) {
    routes.push(prefix);
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Route groups and private folders are not path segments.
    if (entry.name.startsWith('_') || entry.name.startsWith('(')) continue;
    routes.push(...routeTree(join(dir, entry.name), [...prefix, entry.name]));
  }

  return routes;
}

const ROUTES = routeTree();

/** Does `path` match a real route, allowing `[param]` to stand for anything? */
function resolves(path: string): boolean {
  const parts = path.split('/').filter(Boolean);

  return ROUTES.some((route) => {
    // A catch-all (`[...path]`) swallows the rest of the address.
    const catchAll = route.findIndex((segment) => segment.startsWith('[...'));
    if (catchAll >= 0) {
      return (
        parts.length >= catchAll &&
        route.slice(0, catchAll).every((segment, i) => segment === parts[i])
      );
    }

    if (route.length !== parts.length) return false;
    return route.every((segment, i) => segment.startsWith('[') || segment === parts[i]);
  });
}

/** Every .ts/.tsx file under a directory. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'shared') continue; // A synced copy; checked at its source.
      found.push(...sources(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The roots a template string may be built on, and what they resolve to.
 *
 * Only these two, because only these two are constants the whole app shares.
 * A local `const ROOT = '/panel/settings'` is resolved from the file itself.
 */
const SHARED_ROOTS: Record<string, string> = {
  ADMIN_ROOT: '/qapinda-idare-merkezi-7xk4m2',
  OPERATOR_ROOT: '/operator',
};

interface Link {
  path: string;
  file: string;
}

function linksIn(file: string): Link[] {
  const text = readFileSync(file, 'utf8');
  const found: Link[] = [];

  // A local root: `const ROOT = '/panel/settings';`
  const locals: Record<string, string> = {};
  for (const match of text.matchAll(/const\s+(\w+)\s*=\s*'(\/[^']*)'/g)) {
    locals[match[1]] = match[2];
  }

  const roots = { ...SHARED_ROOTS, ...locals };

  /*
   * A path inside `startsWith(...)` is a PREFIX, not a destination.
   *
   * `pathname.startsWith('/legal')` is correct code even though `/legal` has no
   * page of its own — only `/legal/[document]` does. Checking it as a link would
   * fail a test on working code, which is how a test gets switched off.
   */
  const prefixes = new Set(
    [...text.matchAll(/startsWith\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );

  // Plain string paths: '/panel/settings/hours'
  for (const match of text.matchAll(/['"](\/[a-z0-9\-/[\]._]*)['"]/gi)) {
    const path = match[1].replace(/\/$/, '');
    if (prefixes.has(match[1]) || prefixes.has(path)) continue;
    found.push({ path, file });
  }

  // Built paths: `${ROOT}/hours`
  for (const match of text.matchAll(/`\$\{(\w+)\}(\/[a-z0-9\-/]*)`/gi)) {
    const base = roots[match[1]];
    if (base) found.push({ path: base + match[2], file });
  }

  return found;
}

/** Paths that are not app routes and must not be checked as if they were. */
const NOT_A_ROUTE = [
  '/m/', // the image proxy, checked by its own tests
  '/icons/',
  '/api/',
  '/_next',
  '/shared', // an import specifier
  '/components',
  '/contexts',
  '/firebase',
  '/services',
  '/lib',
  '/i18n',
  '/server',
  '/content',
  '/app/',
];

describe('every internal link leads to a route that exists', () => {
  const files = sources('src');

  const links = files
    .flatMap(linksIn)
    .filter((link) => link.path !== '/' && !link.path.includes('.'))
    .filter((link) => !NOT_A_ROUTE.some((prefix) => link.path.startsWith(prefix)))
    // A bare `/word` that is also a real word in an import or a class name would
    // be noise; every real route has at least one segment we can find on disk,
    // so anything whose FIRST segment is not a folder in `src/app` is not a link.
    .filter((link) => {
      const first = link.path.split('/')[1];
      return ROUTES.some((route) => route[0] === first);
    });

  it('finds links to check at all', () => {
    // A test that silently checks nothing is worse than no test.
    expect(links.length).toBeGreaterThan(40);
  });

  it('resolves every one of them', () => {
    const broken = links
      .filter((link) => !resolves(link.path))
      .map((link) => `${link.path}  ← ${link.file}`);

    expect(broken, `dead links:\n${broken.join('\n')}`).toEqual([]);
  });
});

describe('both settings screens reach all of their own pages', () => {
  /*
   * The specific failure this file was written for: eight admin settings pages
   * and nine restaurant ones, every link 404, because the folders were renamed
   * and the hrefs were built with a template string the rename did not match.
   */
  for (const [name, index, root] of [
    [
      'admin',
      'src/app/qapinda-idare-merkezi-7xk4m2/settings/page.tsx',
      'src/app/qapinda-idare-merkezi-7xk4m2/settings',
    ],
    ['restaurant', 'src/app/panel/settings/page.tsx', 'src/app/panel/settings'],
  ] as const) {
    it(`${name}: every tile has a page behind it`, () => {
      const text = readFileSync(index, 'utf8');
      // `const root = `${ADMIN_ROOT}/settings`` has the same shape as a tile, so
      // the line that DEFINES the root is skipped rather than checked as one.
      const tails = [...text.matchAll(/href:\s*`\$\{\w+\}\/([a-z-]+)`/g)].map((m) => m[1]);

      expect(tails.length, `${name} settings index has no tiles`).toBeGreaterThan(5);

      const folders = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      for (const tail of tails) {
        expect(folders, `${name} settings links to /${tail}, which does not exist`).toContain(tail);
      }
    });
  }
});
