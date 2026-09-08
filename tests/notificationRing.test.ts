import { describe, expect, it } from 'vitest';

import {
  createRingMemory,
  decideRing,
  type RingCandidate,
} from '../shared/notificationRing';
import {
  SIMULTANEOUS_EVENT_WINDOW_MS,
  courierPickupNotification,
} from '../shared/notifications';
import { NotificationType } from '../shared/enums';

/**
 * The sound rules, executed.
 *
 * Both of the bugs these assertions describe were real and both were reported
 * as "the app keeps beeping": a Firestore listener re-delivering its window on
 * reconnect, and a kitchen marking an order ready in the same breath as the
 * driver was put on it. Neither is visible in any screenshot, and neither
 * reproduces on a good connection, which is exactly why they are pinned here
 * rather than left to somebody noticing.
 */

const T0 = 1_700_000_000_000;

function candidate(
  notificationId: string,
  type: NotificationType,
  overrides: Partial<RingCandidate> = {},
): RingCandidate {
  return {
    notificationId,
    type,
    soundEnabled: true,
    orderId: null,
    restaurantId: null,
    ...overrides,
  };
}

describe('the first snapshot is history, not news', () => {
  it('says nothing when the window first lands', () => {
    const memory = createRingMemory();

    const tone = decideRing(
      memory,
      [
        candidate('a', NotificationType.COURIER_ASSIGNED),
        candidate('b', NotificationType.NEW_RESTAURANT_AVAILABLE),
      ],
      T0,
    );

    expect(tone).toBeNull();
  });

  it('rings for what arrives after it', () => {
    const memory = createRingMemory();
    decideRing(memory, [candidate('a', NotificationType.NEW_RESTAURANT_AVAILABLE)], T0);

    const tone = decideRing(
      memory,
      [
        candidate('b', NotificationType.NEW_RESTAURANT_AVAILABLE),
        candidate('a', NotificationType.NEW_RESTAURANT_AVAILABLE),
      ],
      T0 + 5_000,
    );

    expect(tone).toBe('chime');
  });
});

describe('one ring per notification, however often it is delivered', () => {
  it('is silent when the listener re-delivers the same document', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const arrival = [candidate('order-1~courier-1', NotificationType.COURIER_ASSIGNED)];
    expect(decideRing(memory, arrival, T0 + 1_000)).toBe('alert');

    // A reconnect replays the whole window. The document is identical, the id
    // is identical, and the phone must stay quiet — three times over, because
    // a flaky connection reconnects more than once.
    expect(decideRing(memory, arrival, T0 + 2_000)).toBeNull();
    expect(decideRing(memory, arrival, T0 + 90_000)).toBeNull();
    expect(decideRing(memory, arrival, T0 + 3_600_000)).toBeNull();
  });

  it('is silent when a local write re-emits the document as read', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const unread = candidate('n1', NotificationType.NEW_ORDER_FOR_RESTAURANT);
    expect(decideRing(memory, [unread], T0 + 1_000)).toBe('alert');

    // Marking it read is a write to the same document, which the listener
    // delivers straight back. Same id, so no second sound.
    expect(decideRing(memory, [{ ...unread }], T0 + 1_200)).toBeNull();
  });

  it('does not ring for a notification whose sound was frozen off', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const tone = decideRing(
      memory,
      [candidate('n1', NotificationType.ORDER_CANCELLED, { soundEnabled: false })],
      T0 + 1_000,
    );

    expect(tone).toBeNull();
  });

  it('does not let a silent notification ring on its next delivery', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const silent = candidate('n1', NotificationType.ORDER_CANCELLED, { soundEnabled: false });
    decideRing(memory, [silent], T0 + 1_000);

    // It was rejected for being silent, not skipped — so it is still "seen",
    // and a re-delivery cannot bring it back as news.
    expect(decideRing(memory, [{ ...silent, soundEnabled: true }], T0 + 2_000)).toBeNull();
  });
});

describe('ready and assigned at the same moment are one buzz', () => {
  it('collapses the pair when they arrive in one snapshot', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const tone = decideRing(
      memory,
      [
        candidate('assigned', NotificationType.COURIER_ASSIGNED, { orderId: 'order-1' }),
        candidate('ready', NotificationType.COURIER_ORDER_READY, { orderId: 'order-1' }),
      ],
      T0 + 1_000,
    );

    // One tone, not two — and the loud one, because a pickup is a pickup.
    expect(tone).toBe('alert');
  });

  it('stays quiet when the second one lands a few seconds later', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    expect(
      decideRing(
        memory,
        [candidate('assigned', NotificationType.COURIER_ASSIGNED, { orderId: 'order-1' })],
        T0 + 1_000,
      ),
    ).toBe('alert');

    expect(
      decideRing(
        memory,
        [candidate('ready', NotificationType.COURIER_ORDER_READY, { orderId: 'order-1' })],
        T0 + 6_000,
      ),
    ).toBeNull();
  });

  it('rings again once the two are genuinely separate events', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    decideRing(
      memory,
      [candidate('assigned', NotificationType.COURIER_ASSIGNED, { orderId: 'order-1' })],
      T0,
    );

    const later = T0 + SIMULTANEOUS_EVENT_WINDOW_MS + 1;
    expect(
      decideRing(
        memory,
        [candidate('ready', NotificationType.COURIER_ORDER_READY, { orderId: 'order-1' })],
        later,
      ),
    ).toBe('alert');
  });

  it('does not collapse two different orders', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    // Two bags, one sound — the rule is one sound per delivery, not one per
    // order — but both must be *counted* as rung, so neither can ring again a
    // second later on its own.
    expect(
      decideRing(
        memory,
        [
          candidate('a', NotificationType.COURIER_ASSIGNED, { orderId: 'order-1' }),
          candidate('b', NotificationType.COURIER_ASSIGNED, { orderId: 'order-2' }),
        ],
        T0 + 1_000,
      ),
    ).toBe('alert');

    expect(
      decideRing(
        memory,
        [candidate('c', NotificationType.COURIER_ORDER_READY, { orderId: 'order-2' })],
        T0 + 2_000,
      ),
    ).toBeNull();
  });
});

describe('the server side of the same rule', () => {
  it('writes only the assignment when a ready order is handed to a driver', () => {
    // Assigned now; the kitchen marked it ready a moment ago.
    expect(
      courierPickupNotification({ assignedAtMs: T0, readyAtMs: T0 - 5_000, trigger: 'assigned' }),
    ).toBe(NotificationType.COURIER_ASSIGNED);

    // And the "ready" side, arriving second, says nothing.
    expect(
      courierPickupNotification({ assignedAtMs: T0, readyAtMs: T0 + 5_000, trigger: 'ready' }),
    ).toBeNull();
  });

  it('still tells a driver when the order becomes ready much later', () => {
    expect(
      courierPickupNotification({
        assignedAtMs: T0,
        readyAtMs: T0 + SIMULTANEOUS_EVENT_WINDOW_MS + 1,
        trigger: 'ready',
      }),
    ).toBe(NotificationType.COURIER_ORDER_READY);
  });

  it('tells nobody about a pickup with no driver on it', () => {
    expect(
      courierPickupNotification({ assignedAtMs: null, readyAtMs: T0, trigger: 'ready' }),
    ).toBeNull();
  });
});

describe('the loudest tone wins when several land together', () => {
  it('picks alert over chime', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    const tone = decideRing(
      memory,
      [
        candidate('a', NotificationType.NEW_RESTAURANT_AVAILABLE, { orderId: 'order-1' }),
        candidate('b', NotificationType.COURIER_ORDER_CANCELLED, { orderId: 'order-2' }),
      ],
      T0 + 1_000,
    );

    expect(tone).toBe('alert');
  });

  it('leaves a quiet moment quiet', () => {
    const memory = createRingMemory();
    decideRing(memory, [], T0);

    expect(
      decideRing(
        memory,
        [candidate('a', NotificationType.SUPPORT_MESSAGE, { orderId: 'order-1' })],
        T0 + 1_000,
      ),
    ).toBe('chime');
  });
});
