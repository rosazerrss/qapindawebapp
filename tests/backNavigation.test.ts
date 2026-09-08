import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ADMIN_NAV, OPERATOR_ROOT, RESTAURANT_NAV } from '../shared/permissions';

/**
 * "İstənilən səhifəyə girdikdə geri çıxmaq üçün buton olmalıdır."
 *
 * Every screen somebody navigates *into* needs a visible ← Geri. A tab does
 * not: the bar it lives on is already the way out, and a second control there
 * is one more thing between a thumb and the food. Everything below a tab does.
 *
 * This is a source test rather than a rendering one because the failure it
 * catches is a new route added without one — and a new route is exactly the
 * thing no existing test knows about. It walks `src/app`, works out which
 * routes are top level, and requires one of the three mechanisms this codebase
 * already has on all the rest. There is deliberately no fourth: `ScreenHeader`
 * (history-aware, for the customer app), `PageHeader backHref` (fixed, for the
 * panels) and the shells that take a `backHref` of their own.
 */

/** The customer's bottom bar. `src/components/layout/AppShell.tsx`. */
const CUSTOMER_TABS = ['/', '/search', '/cart', '/orders', '/account'];

/** The courier's bottom bar. `src/components/courier/CourierShell.tsx`. */
const COURIER_TABS = [
  '/courier',
  '/courier/orders',
  '/courier/history',
  '/courier/notifications',
  '/courier/account',
];

/**
 * The panels' sidebars, read from the same list the sidebars render.
 *
 * Taken from `shared/permissions.ts` rather than written out again, so adding a
 * sidebar entry does not need an edit here — and, more usefully, so REMOVING
 * one turns that screen into a page that now needs a back button, which is
 * exactly the change that would otherwise be missed.
 */
const PANEL_TABS = [
  ...ADMIN_NAV.map((item) => item.href),
  ...RESTAURANT_NAV.map((item) => item.href),
  OPERATOR_ROOT,
  // Doors, not screens inside anything: signing in and the admin bootstrap are
  // where a session starts. They carry a way home anyway — see below — but they
  // are not "inside" a tab.
  '/login',
];

const TOP_LEVEL = new Set([...CUSTOMER_TABS, ...COURIER_TABS, ...PANEL_TABS]);

/** Every `page.tsx` under `src/app`, with the route it serves. */
function routes(): Array<{ route: string; file: string }> {
  const found: Array<{ route: string; file: string }> = [];

  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        // A route group `(name)` adds nothing to the URL; a dynamic segment
        // keeps its brackets, which is enough to identify it here.
        const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
        walk(path, prefix + segment);
      } else if (entry === 'page.tsx') {
        found.push({ route: prefix === '' ? '/' : prefix, file: path });
      }
    }
  };

  walk('src/app', '');
  return found.sort((a, b) => a.route.localeCompare(b.route));
}

/** Whether this file provides a way back, by one of the three mechanisms. */
function hasBackControl(file: string): boolean {
  const source = readFileSync(file, 'utf8');

  // A page that re-exports another page's default gets that page's header.
  if (/export \{ default \} from/.test(source)) return true;

  /*
   * A server page that renders a client view.
   *
   * `/restaurant/[handle]` was split in two so the menu could be rendered into
   * the HTML for search engines: the `page.tsx` reads Firestore and emits the
   * metadata, and the screen itself — header, back control and all — lives in
   * the component it renders. The back control is still there; it is one file
   * further along, and following the import is what keeps this check honest
   * rather than excusing the route.
   */
  const rendered = source.match(/from '\.\/([A-Za-z]+)'/);
  if (rendered) {
    const sibling = join(dirname(file), `${rendered[1]}.tsx`);
    if (existsSync(sibling) && hasBackControl(sibling)) return true;
  }

  return (
    source.includes('<ScreenHeader') ||
    source.includes('backHref') ||
    // A page that is not inside any shell draws the control itself; the label
    // is the one thing every version of it shares.
    source.includes("t('common.back')")
  );
}

describe('every screen you walk into has a way back', () => {
  const all = routes();

  it('finds the routes at all', () => {
    // Guards against the walk quietly matching nothing and the check below
    // passing for the wrong reason.
    expect(all.length).toBeGreaterThan(30);
  });

  it('knows every top-level route it claims exists', () => {
    // A tab in the allowlist with no page behind it means the list has drifted
    // from the app, and a drifted list is how a real screen gets excused.
    const known = new Set(all.map((entry) => entry.route));
    const stale = [...TOP_LEVEL].filter((route) => !known.has(route));
    expect(stale).toEqual([]);
  });

  it('gives every non-tab route a ← Geri', () => {
    const missing = all
      .filter((entry) => !TOP_LEVEL.has(entry.route))
      .filter((entry) => !hasBackControl(entry.file))
      .map((entry) => `${entry.route}   (${entry.file})`);

    expect(missing).toEqual([]);
  });

  it('does not put a redundant one on a top-level tab', () => {
    // Only the ones that genuinely have no parent. `/orders` carries a
    // header for its own reasons and `/login` has a way out of a half-finished
    // sign-in, so neither is asserted about here — this is about the five
    // screens the bottom bar is FOR.
    for (const route of ['/', '/search', '/cart', '/account']) {
      const entry = all.find((candidate) => candidate.route === route);
      expect(entry, `${route} has no page`).toBeDefined();
      expect(hasBackControl(entry!.file), `${route} should not have a back button`).toBe(false);
    }
  });
});
