/**
 * The application must never reload itself.
 *
 * WHAT "IT FEELS LIKE A RELOAD" ACTUALLY WAS
 * ------------------------------------------
 * Two separate faults with the same symptom, and only one of them was a real
 * navigation:
 *
 *  1. `window.location` — tapping a notification banner, or the retry button on
 *     a courier screen, threw the whole application away and rebuilt it. On a
 *     restaurant tablet that happened at the exact moment a new order arrived.
 *
 *  2. The blank frame. Navigation was already client-side, but every panel
 *     screen subscribed to its data on mount and drew "Yüklənir…" until the
 *     first snapshot came back from Google. Content flashed away and returned,
 *     which reads as a page load whatever the router did. `persistentLocalCache`
 *     is the fix: `onSnapshot` fires from IndexedDB before any network round
 *     trip, so the screen is filled from the first frame.
 *
 * These assertions cover both, and the second one is the one worth keeping —
 * the local cache is a single line somebody could remove while tidying up.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Every .ts/.tsx under src, minus the synced copies of `shared`. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'shared' ? [] : walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = walk('src');

/**
 * A file with its prose removed.
 *
 * These assertions search for the very patterns the code comments EXPLAIN —
 * `window.location.reload()` is named in the note that says why it is no longer
 * used. Matching against comments would fail the test for being well explained,
 * which is a test nobody keeps.
 */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('no hard navigation inside the app', () => {
  /**
   * The two places a full page load is CORRECT, and why.
   *
   * Both hand the browser to the bank. That is a different origin and the
   * customer has to actually arrive there — a client-side route change would
   * do nothing at all.
   */
  const ALLOWED = ['src/components/customer/PayAgain.tsx', 'src/app/checkout/page.tsx'];

  it('never assigns window.location except on the way to the payment provider', () => {
    const offenders = files.filter((file) => {
      if (ALLOWED.some((allowed) => file.endsWith(allowed.replace('src/', '')))) return false;
      // `window.location.href = ...` — an assignment, not a read. Reading the
      // current URL is fine and several screens do it.
      return /window\.location\.(href|assign|replace)\s*=|window\.location\.(assign|replace)\(/.test(
        code(file),
      );
    });

    expect(offenders).toEqual([]);
  });

  it('never reloads the page to recover from a failed subscription', () => {
    // A courier on a weak connection tapping "retry" used to re-download the
    // entire application over the connection that had just failed.
    const offenders = files.filter((file) => /window\.location\.reload\(/.test(code(file)));

    expect(offenders).toEqual([]);
  });

  it('gives the courier hooks a retry that re-subscribes instead', () => {
    const hooks = fs.readFileSync('src/components/courier/useCourierData.ts', 'utf8');
    expect(hooks).toContain('retry: () => setAttempt((n) => n + 1)');
    // The counter has to be in the effect's dependencies or "retry" does
    // nothing at all — which would look exactly like a broken button.
    expect(hooks).toContain('[uid, attempt]');
  });

  it('opens a notification through the router', () => {
    const notifications = fs.readFileSync(
      'src/components/notifications/useNotifications.ts',
      'utf8',
    );
    expect(notifications).toContain('push.current.navigate(link)');
    expect(notifications).toContain("useRouter");
  });
});

describe('screens are painted before the network answers', () => {
  const client = fs.readFileSync('src/firebase/client.ts', 'utf8');

  it('keeps Firestore documents in a persistent local cache', () => {
    // Without this every navigation blanks the destination screen until a
    // round trip completes, which is what made client-side routing feel like
    // a page load.
    expect(client).toContain('persistentLocalCache');
  });

  it('shares that cache across tabs', () => {
    // Restaurants really do run the order board and the menu editor side by
    // side. Without a multi-tab manager the second tab silently loses
    // persistence and goes back to blanking.
    expect(client).toContain('persistentMultipleTabManager');
  });

  it('still works where persistence is refused', () => {
    // A private window, blocked site data, a device out of disk. The app must
    // lose the instant paint and nothing else.
    expect(client).toContain('experimentalAutoDetectLongPolling: true');
    expect(client).toContain('getFirestore(instance)');
  });

  it('keeps the long-polling fallback alongside the cache', () => {
    // The two solve unrelated problems — networks that swallow the stream, and
    // the blank first frame — and losing either brings its own bug back.
    const call = client.slice(client.indexOf('initializeFirestore(instance, {'));
    expect(call.slice(0, 300)).toContain('localCache');
    expect(call.slice(0, 300)).toContain('experimentalAutoDetectLongPolling');
  });
});
