import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  COURIER_ACTIVE_STATUSES,
  COURIER_HISTORY_STATUSES,
  courierBucket,
} from '../shared/courier';
import { NotificationType, OrderStatus } from '../shared/enums';
import { NOTIFICATION_SPEC, NotificationPriority } from '../shared/notifications';

/**
 * QAPINDA — the four panels tell one story.
 *
 * "KURYER RESTORAN ADMİN OPERATOR HAMISI BİRBİRİNE BAĞLI OLMALIDIR SİFARİŞLERDE
 * LEĞV OLAN SİFARİŞLER VE S."
 *
 * They already read the same document, so they cannot disagree about what the
 * status IS. What they could disagree about — and did — is everything around
 * it: what colour the status is drawn in, whether a cancelled order is still on
 * a driver's active list, whether anybody says who cancelled it, and whether a
 * panel finds out without being reloaded.
 *
 * Four of those five are decidable without a browser, and this is where they
 * are decided.
 */

const ENDINGS = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.COMPLETED,
  OrderStatus.DELIVERED,
] as const;

describe('an order that ended leaves the courier’s active list', () => {
  it.each(ENDINGS)('%s is history, never active', (status) => {
    expect(COURIER_ACTIVE_STATUSES).not.toContain(status);
    expect(COURIER_HISTORY_STATUSES).toContain(status);
    expect(courierBucket(status)).toBe('history');
  });

  it('the active list is a live query on exactly those statuses', () => {
    // A `where('status','in', ACTIVE)` listener is what makes the row vanish
    // the instant somebody else cancels: the order simply stops matching. A
    // one-off fetch would leave the driver riding to a cancelled address.
    const service = readFileSync('src/services/courier.ts', 'utf8');
    expect(service).toContain('onSnapshot');
    expect(service).toContain("where('status', 'in', COURIER_ACTIVE_STATUSES)");
  });
});

describe('every panel subscribes rather than fetching once', () => {
  const panels: Array<[string, string]> = [
    ['the restaurant’s board', 'src/app/panel/page.tsx'],
    ['the operator’s live orders', 'src/app/operator/LiveOrders.tsx'],
    ['the admin’s orders list', 'src/app/qapinda-idare-merkezi-7xk4m2/orders/page.tsx'],
    ['the customer’s orders', 'src/app/orders/page.tsx'],
  ];

  it.each(panels)('%s is live', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(/onSnapshot|watch[A-Z]/.test(source)).toBe(true);
  });

  it('the courier’s screens are live too', () => {
    const data = readFileSync('src/components/courier/useCourierData.ts', 'utf8');
    expect(data).toContain('watchCourierActiveOrders');
    expect(data).toContain('watchCourierHistory');
    expect(data).toContain('watchCourierOrder');
  });
});

describe('one status vocabulary and one set of colours', () => {
  it('every panel takes its tone from `status.ts` rather than its own table', () => {
    for (const path of [
      'src/app/panel/page.tsx',
      'src/app/operator/LiveOrders.tsx',
      'src/app/qapinda-idare-merkezi-7xk4m2/orders/page.tsx',
      'src/components/courier/OrderCards.tsx',
      'src/app/orders/page.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toMatch(/orderTone|orderBadgeTone|orderAccentClass/);
    }
  });

  it('the customer’s list no longer decides its own colours', () => {
    // It used to: a hand-written ternary that made every non-terminal order
    // "brand" and every terminal one "danger" — so an EXPIRED order was red on
    // a phone and amber in the panel.
    const source = readFileSync('src/app/orders/page.tsx', 'utf8');
    expect(source).toContain('orderBadgeTone');
    expect(source).not.toContain("? 'success'");
  });
});

describe('who cancelled it, and why, on every screen', () => {
  const screens = [
    'src/app/panel/page.tsx',
    'src/app/operator/LiveOrders.tsx',
    'src/app/qapinda-idare-merkezi-7xk4m2/orders/page.tsx',
    'src/app/courier/orders/[orderId]/page.tsx',
    'src/app/courier/history/[orderId]/page.tsx',
  ];

  it.each(screens)('%s renders the shared cancellation note', (path) => {
    expect(readFileSync(path, 'utf8')).toContain('CancellationNote');
  });

  it('names the actor in words rather than printing the stored enum', () => {
    const note = readFileSync('src/components/panel/CancellationNote.tsx', 'utf8');
    expect(note).toContain('orderActor.');
    expect(note).toContain('order.cancelledBy');

    // And the words exist in all three languages, for all four actors.
    for (const locale of ['az', 'en', 'ru']) {
      const dictionary = JSON.parse(
        readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
      ) as Record<string, Record<string, string>>;
      for (const actor of ['CUSTOMER', 'RESTAURANT', 'PLATFORM', 'SYSTEM']) {
        expect(dictionary.orderActor?.[actor]).toBeTruthy();
      }
      expect(dictionary.order?.cancelledBy).toContain('{{actor}}');
    }
  });
});

describe('the courier is told, and it is not a preference', () => {
  it('a cancelled, rejected or expired order notifies the assigned driver', () => {
    const status = readFileSync('functions/src/orders/status.ts', 'utf8');
    expect(status).toContain('COURIER_ORDER_CANCELLED');
    // Sent from inside the same transaction that moves the status, so a
    // cancellation that lands cannot leave the notification unwritten.
    expect(status).toContain('notifyIn(tx, {');
  });

  it('and no setting can hide it', () => {
    // `shared/notifications.ts` marks which types a preference may silence.
    // This one is not among them: a driver who muted their sound is still
    // riding to that address.
    const rule = NOTIFICATION_SPEC[NotificationType.COURIER_ORDER_CANCELLED];
    expect(rule.silenceable).toBe(false);
    expect(rule.priority).toBe(NotificationPriority.CRITICAL);
  });
});
