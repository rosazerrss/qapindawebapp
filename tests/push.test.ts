import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

import {
  DEAD_TOKEN_CODES,
  PUSHABLE,
  PUSH_TOKEN_STALE_DAYS,
  isPushable,
  pushTag,
} from '../shared/push';
import { NotificationType } from '../shared/enums';
import { PUSH_TEXT } from '../functions/src/generated/pushText';

/**
 * PUSH — THE PARTS THAT FAIL SILENTLY.
 *
 * Every failure this file guards against is invisible at the time it happens.
 * A missing sentence sends a banner reading `notifications.X.title` to a
 * kitchen. A token deleted on a network blip stops a tablet ringing for ever
 * and nobody connects the two events. A generated file that has fallen behind
 * the dictionaries keeps sending last month's wording. None of it throws;
 * somebody just stops getting orders.
 */

const dictionaries = ['az', 'ru', 'en'] as const;

/**
 * The source with its comments removed.
 *
 * Every assertion below is about what the code *does*, and this file's comments
 * discuss at length the very things being asserted absent — the double-banner
 * trap names `showNotification` in order to explain why it is not called. Left
 * in, the prose would fail the test that protects it, which is the surest way
 * to get a useful comment deleted.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('push — the server can say every sentence it may need to', () => {
  it.each(dictionaries)('%s has a title and a body for every pushable type', (locale) => {
    const table = PUSH_TEXT[locale];
    expect(table, `no ${locale} table`).toBeTruthy();

    for (const type of PUSHABLE) {
      expect(table[type]?.title, `${locale}/${type} title`).toBeTruthy();
      expect(table[type]?.body, `${locale}/${type} body`).toBeTruthy();
    }
  });

  /**
   * The generated file against its source.
   *
   * This is the assertion the whole "generate, do not duplicate" arrangement
   * rests on. Change a notification's wording in `az.json`, forget to rebuild,
   * and the server keeps sending the old sentence forever — with no error, in
   * a file marked DO NOT EDIT that nobody opens.
   */
  it.each(dictionaries)('%s matches the dictionary it was generated from', (locale) => {
    const dictionary = JSON.parse(
      readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
    ) as { notifications: Record<string, { title?: string; body?: string }> };

    for (const type of PUSHABLE) {
      expect(PUSH_TEXT[locale][type].title, `${locale}/${type}`).toBe(
        dictionary.notifications[type].title,
      );
      expect(PUSH_TEXT[locale][type].body, `${locale}/${type}`).toBe(
        dictionary.notifications[type].body,
      );
    }
  });

  it('ships nothing it will never send', () => {
    // Sixty-nine notification types exist; only the pushable ones belong here.
    expect(Object.keys(PUSH_TEXT.az).sort()).toEqual([...PUSHABLE].sort());
  });
});

describe('push — an interruption is rarer than a notification', () => {
  /**
   * A record is not an interruption.
   *
   * A restaurant given a banner for every rating change stops reading banners,
   * and the one saying "new order" arrives in a stream nobody looks at. If this
   * list ever grows past a dozen, the feature has started eating itself.
   */
  it('wakes people for few things', () => {
    expect(PUSHABLE.length).toBeLessThanOrEqual(12);
    expect(PUSHABLE.length).toBeGreaterThan(0);
  });

  /** The one that pays for the whole system. */
  it('always includes a restaurant getting an order', () => {
    expect(isPushable(NotificationType.NEW_ORDER_FOR_RESTAURANT)).toBe(true);
    expect(isPushable(NotificationType.ORDER_CANCELLED)).toBe(true);
  });

  /**
   * The owner cut the customer's order-status messages from the product on
   * purpose. Push must not reintroduce them by the back door.
   */
  it('does not wake a customer for a review reminder', () => {
    expect(isPushable(NotificationType.REVIEW_REMINDER)).toBe(false);
    expect(isPushable(NotificationType.NEW_RESTAURANT_AVAILABLE)).toBe(false);
  });
});

describe('push — banners about one order collapse, a new order never does', () => {
  it('gives one order one tag', () => {
    const a = pushTag({ type: NotificationType.ORDER_ON_THE_WAY, orderId: 'o1' });
    const b = pushTag({ type: NotificationType.ORDER_CANCELLED, orderId: 'o1' });
    expect(a).toBe(b);
  });

  it('keeps different orders apart', () => {
    expect(pushTag({ type: NotificationType.ORDER_ON_THE_WAY, orderId: 'o1' })).not.toBe(
      pushTag({ type: NotificationType.ORDER_ON_THE_WAY, orderId: 'o2' }),
    );
  });

  /**
   * A new order must not be swallowed by an older banner about the same order.
   * It is the one the kitchen has not seen yet.
   */
  it('never collapses a new order into an existing banner', () => {
    const fresh = pushTag({ type: NotificationType.NEW_ORDER_FOR_RESTAURANT, orderId: 'o1' });
    const later = pushTag({ type: NotificationType.ORDER_ON_THE_WAY, orderId: 'o1' });
    expect(fresh).not.toBe(later);
  });
});

describe('push — a transient failure never unregisters a device', () => {
  /**
   * The asymmetry that matters.
   *
   * Deleting a token because FCM was briefly unreachable turns one missed
   * banner into every missed banner from then on, and the restaurant would
   * report it as "the app stopped working" weeks later.
   */
  it('deletes only on codes that mean the token is gone', () => {
    expect(DEAD_TOKEN_CODES).toContain('messaging/registration-token-not-registered');
    expect(DEAD_TOKEN_CODES).not.toContain('messaging/server-unavailable');
    expect(DEAD_TOKEN_CODES).not.toContain('messaging/internal-error');
    expect(DEAD_TOKEN_CODES).not.toContain('messaging/quota-exceeded');
  });

  it('gives a quiet device two months before pruning it', () => {
    expect(PUSH_TOKEN_STALE_DAYS).toBeGreaterThanOrEqual(30);
  });
});

describe('push — the client half is wired the way it has to be', () => {
  const worker = withoutComments(readFileSync('public/firebase-messaging-sw.js', 'utf8'));

  /**
   * THE DOUBLE-BANNER TRAP.
   *
   * The server sends a real `notification` block, because on iOS nothing else
   * is drawn for an app that is not running. The browser then displays it
   * itself. A worker that also calls `showNotification` produces two identical
   * banners for one order — and the hand-drawn second one carries none of the
   * grouping the first had.
   */
  it('never draws a banner of its own', () => {
    expect(worker).not.toContain('showNotification');
    expect(worker).not.toContain('onBackgroundMessage');
  });

  /** Its whole job is the tap, and reusing the window that is already open. */
  it('handles the tap and reuses an open window', () => {
    expect(worker).toContain('notificationclick');
    expect(worker).toContain('matchAll');
    expect(worker).toContain('openWindow');
  });

  /**
   * A kitchen tablet is never closed, so without these a fix shipped at noon
   * reaches it next week.
   */
  it('takes over from the previous version immediately', () => {
    expect(worker).toContain('skipWaiting');
    expect(worker).toContain('clients.claim');
  });

  it('is served from the site root, where FCM looks for it', () => {
    expect(existsSync('public/firebase-messaging-sw.js')).toBe(true);
  });
});

describe('push — the installable app', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as {
    display: string;
    start_url: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
    theme_color: string;
  };

  it('installs as an app rather than a bookmark', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  /**
   * Android launchers crop a maskable icon to whatever shape the phone uses.
   * Without a maskable variant the mark loses its corners on a Pixel and keeps
   * them on a Samsung, which is how one icon ends up looking broken on half the
   * phones in a city.
   */
  it('ships both an ordinary and a maskable icon at both sizes', () => {
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(
          manifest.icons.some((icon) => icon.purpose === purpose && icon.sizes === size),
          `${purpose} ${size}`,
        ).toBe(true);
      }
    }
  });

  it('has every icon file it names', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
    }
    // iOS ignores the manifest and reads this instead.
    expect(existsSync('public/icons/apple-touch-icon.png')).toBe(true);
  });

  it('uses the brand colour the app itself uses', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain(`--color-brand-600: ${manifest.theme_color}`);
  });
});

describe('push — tokens are the server’s alone', () => {
  /**
   * The token is the document id. A client able to write the collection could
   * register somebody else's telephone against its own account and receive
   * their orders — and no rule can catch it, because it looks like a signed-in
   * person creating a row with their own uid on it.
   */
  it('closes the collection to every client', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const block = rules.slice(rules.indexOf('match /pushTokens/{token}'));
    expect(block.slice(0, 200)).toContain('allow read, write: if false');
  });

  it('registers through a callable that claims the token for the caller', () => {
    const tokens = readFileSync('functions/src/notifications/tokens.ts', 'utf8');
    expect(tokens).toContain('requireActiveUser');
    // `set` without merge: a tablet that changed hands stops ringing for the
    // previous owner the moment somebody else signs in on it.
    expect(tokens).toContain('.set({');
    // And unregistering somebody else's device is refused, or this callable
    // would be a way to silence a competitor's kitchen.
    expect(tokens).toContain('fail(AppErrorCode.FORBIDDEN)');
  });

  /**
   * Order of operations on sign-out.
   *
   * `unregisterPushToken` is a callable and needs the credential that is about
   * to be discarded. Signing out first leaves a live token on a shared tablet,
   * and the next person to pick it up reads the last person's orders.
   */
  it('unregisters the device before signing out', () => {
    const context = withoutComments(readFileSync('src/contexts/AuthContext.tsx', 'utf8'));
    const signOut = context.slice(context.indexOf('const signOut = useCallback'));
    const body = signOut.slice(0, signOut.indexOf('}, []);'));
    expect(body.indexOf('disablePushOnThisDevice')).toBeGreaterThan(-1);
    expect(body.indexOf('disablePushOnThisDevice')).toBeLessThan(body.indexOf('firebaseSignOut'));
  });
});

describe('push — delivery hangs off the row, not off the call sites', () => {
  const source = readFileSync('functions/src/notifications/push.ts', 'utf8');
  const trigger = withoutComments(source);

  /**
   * Notifications written inside a transaction never pass through `notify()` —
   * a transaction may not read once it has begun writing, so they go through
   * `notifyIn`. A restaurant's new-order alert is one of those. A "send push"
   * line added to `notify()` would have shipped a push system that did not push
   * the single most important message in the product.
   */
  it('triggers on the notification document being created', () => {
    expect(trigger).toContain('onDocumentCreated');
    expect(trigger).toContain('notifications/{notificationId}');
  });

  /** The banner is read by whoever holds the phone, including a stranger. */
  it('puts no name, telephone or address in the payload', () => {
    const start = trigger.indexOf('const message: TokenMessage');
    const payload = trigger.slice(start, trigger.indexOf('await messaging.send', start));
    for (const field of ['customerName', 'phone', 'address', 'fullName']) {
      expect(payload, field).not.toContain(field);
    }
  });

  /** A failed banner must never retry a trigger over an order already stored. */
  it('swallows its own failures', () => {
    expect(trigger).toContain('catch');
    expect(source).toContain('deliverPush failed');
  });
});
