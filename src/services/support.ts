'use client';

/**
 * Reading support tickets.
 *
 * Writing goes through the callables, because a message, the unread counters,
 * the ticket summary and the status all have to move in one transaction.
 * Reading does not: the security rules already say who may see which ticket,
 * so a callable would add a round trip and take away the live update that
 * makes a chat feel like a chat.
 *
 * EVERY QUERY HERE CARRIES THE FILTERS ITS RULE NAMES
 * ---------------------------------------------------
 * Firestore evaluates a `list` against the query, not against the documents it
 * would return, so a query that leaves out a filter the rule depends on is
 * refused outright — it does not quietly return less. The customer's list
 * therefore filters on `customerId` *and* on the lane, and the restaurant's on
 * `restaurantId` *and* the two restaurant lanes, matching
 * `firestore.rules` clause for clause. Changing one without the other breaks
 * the screen, not the boundary.
 *
 * The platform's own inbox is here too now, and it did not used to be. It came
 * from `listSupportTickets`, a callable, on the belief that "every ticket in
 * the lanes I work" was the unscoped read the rules refuse. It is not: the
 * operator's clause names `lane in [...]`, and a query carrying that same `in`
 * filter proves itself against it exactly as a customer's own list does. The
 * callable cost the operator a screen that only changed when they reloaded it,
 * which is precisely what the owner asked to be rid of — *"operator terefinde
 * saytı yenilemedende herşey real time yenilensin"*. See `watchInboxTickets`.
 */

import {
  collection,
  doc,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { COLLECTIONS, paths } from '@/shared/collections';
import { RESTAURANT_SUPPORT_LANES, SupportLane } from '@/shared/enums';
import { visibleToAsker } from '@/shared/supportState';
import type { SupportMessage, SupportTicket } from '@/shared/models';

/** How much history one ticket carries on screen. */
const WINDOW = 200;

/** How many of a party's own tickets a list shows before it needs filtering. */
const LIST_WINDOW = 50;

/**
 * How many tickets the platform's inbox carries.
 *
 * A window rather than everything, because a listener on an unbounded
 * collection is a bill that grows with the platform. Ordered by last activity,
 * so what falls off the end is the quietest history and never the queue.
 */
const INBOX_WINDOW = 200;

/**
 * One ticket's summary — status, assignment, unread counters.
 *
 * Watched separately from its messages so a badge clears the instant
 * `markSupportTicketRead` lands, without waiting on the message list.
 */
export function watchTicket(
  ticketId: string,
  onChange: (ticket: SupportTicket | null) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, paths.supportTicket(ticketId)),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as SupportTicket) : null),
    () => onChange(null),
  );
}

/**
 * The last two hundred messages of a ticket, oldest first.
 *
 * Firestore's `limit` keeps the *first* rows a query returns, so asking for
 * ascending order and two hundred rows would pin the screen to the oldest two
 * hundred messages and never show today's. The query therefore reads newest
 * first and the window is reversed here — what arrives is the recent tail, in
 * reading order.
 */
export function watchTicketMessages(
  ticketId: string,
  onChange: (messages: SupportMessage[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, paths.supportTicketMessages(ticketId)),
      orderBy('createdAt', 'desc'),
      limitTo(WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as SupportMessage).reverse()),
    () => onChange([]),
  );
}

/**
 * A customer's own tickets, newest activity first.
 *
 * The lane filter is not cosmetic — see the note at the top of this file. It
 * is half of what makes the rule provable.
 */
export function watchMyTickets(
  customerId: string,
  onChange: (tickets: SupportTicket[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.supportTickets),
      where('customerId', '==', customerId),
      where('lane', '==', SupportLane.CUSTOMER_TO_OPERATOR),
      orderBy('lastMessageAt', 'desc'),
      limitTo(LIST_WINDOW),
    ),
    (snapshot) => onChange(askerVisible(snapshot.docs.map((entry) => entry.data() as SupportTicket))),
    () => onChange([]),
  );
}

/**
 * Drops the finished conversations this party has stopped being shown.
 *
 * Filtered here rather than in the query because Firestore cannot express "or
 * closed less than fourteen days ago" alongside the filters already on it, and
 * because the rule belongs in one place — `visibleToAsker`, which the server
 * also consults when somebody opens a ticket by its id. A list that hid a
 * ticket the "open by id" path still served would not be hiding it.
 *
 * Nothing is deleted. The platform keeps every ticket; the party who raised it
 * simply stops seeing the old ones. See `CLOSED_TICKET_VISIBLE_DAYS`.
 */
function askerVisible(tickets: SupportTicket[]): SupportTicket[] {
  const now = Date.now();
  return tickets.filter((ticket) =>
    visibleToAsker(
      { status: ticket.status, closedAtMs: ticket.closedAt?.toMillis?.() ?? null },
      now,
    ),
  );
}

/**
 * A restaurant's own tickets, across both of its lanes.
 *
 * One subscription rather than two, because the restaurant's screen shows the
 * operator lane and the admin lane side by side and splitting the read would
 * only mean two spinners resolving at different moments.
 */
export function watchRestaurantTickets(
  restaurantId: string,
  onChange: (tickets: SupportTicket[]) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.supportTickets),
      where('restaurantId', '==', restaurantId),
      where('lane', 'in', RESTAURANT_SUPPORT_LANES),
      orderBy('lastMessageAt', 'desc'),
      limitTo(LIST_WINDOW),
    ),
    (snapshot) => onChange(askerVisible(snapshot.docs.map((entry) => entry.data() as SupportTicket))),
    () => onChange([]),
  );
}

/**
 * The platform's inbox, live.
 *
 * This used to be `listSupportTickets`, a callable, and the header above says
 * why: "every ticket in the lanes I work" reads like the unscoped query the
 * rules refuse. It is not, quite — and the difference is the whole reason this
 * function exists. The rule for an operator is `resource.data.lane in
 * ['CUSTOMER_TO_OPERATOR', 'RESTAURANT_TO_OPERATOR']`, and a query carrying
 * exactly that `in` filter proves itself against it the same way the
 * customer's own list does. An admin passes on `isSuperAdmin()` regardless.
 *
 * So the lane filter is not decoration and must never be dropped for
 * "convenience": without it Firestore refuses the whole subscription, and the
 * operator's screen goes dark rather than quietly showing less.
 *
 * The lanes come from `lanesHandledBy`, so the widest query an operator can
 * produce is still the two lanes they may see. That is not the security — the
 * rule is, and it is evaluated on the server against this exact query — but it
 * does mean the screen never asks for something it would be refused.
 *
 * `onError` is real and must be shown. A refused subscription that left a
 * spinner turning would be indistinguishable from a quiet platform.
 */
export function watchInboxTickets(
  lanes: SupportLane[],
  onChange: (tickets: SupportTicket[]) => void,
  onError: () => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onError();
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.supportTickets),
      where('lane', 'in', lanes),
      orderBy('lastMessageAt', 'desc'),
      limitTo(INBOX_WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as SupportTicket)),
    onError,
  );
}
