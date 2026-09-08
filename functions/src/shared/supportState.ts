/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Support ticket state machine and lane access.
 *
 * The single place that answers two questions about a support ticket:
 *   - may this actor move it from status A to status B?
 *   - may this person read it, reply to it, close it or escalate it at all?
 *
 * Cloud Functions call these before every write, the security rules mirror the
 * same predicates, and the UI calls them to decide which buttons to draw — so
 * the screen and the server can never disagree about what is allowed. Modelled
 * on `shared/orderState.ts`, deliberately: a support ticket is a small order
 * with a different vocabulary, and there is no reason for the two to be shaped
 * differently.
 *
 * THE LANE IS THE BOUNDARY
 * ------------------------
 * `SupportLane` decides the audience, and nothing else does. In particular
 * RESTAURANT_TO_ADMIN excludes OPERATOR here, in the callables and in
 * `firestore.rules` — three independent places, because the one thing that
 * lane exists for is a restaurant complaining about an operator, and a
 * boundary that lives only in the UI is not a boundary.
 *
 * COURIERS HAVE NO SUPPORT AT ALL
 * -------------------------------
 * Not "an empty inbox" — no lane they may open, no ticket they may read. A
 * courier's problem goes through the restaurant they ride for, which is the
 * same account boundary that keeps every other customer's address off that
 * phone. `supportAccess` returns all-false for RESTAURANT_COURIER before it
 * looks at anything else, and the matrix test asserts it.
 */

import {
  RESTAURANT_ROLES,
  SupportActor,
  SupportLane,
  SupportTicketStatus,
  TERMINAL_SUPPORT_STATUSES,
  UserRole,
} from './enums';

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface SupportTransition {
  to: SupportTicketStatus;
  actors: SupportActor[];
}

/**
 * Allowed moves out of each status.
 *
 * The happy path runs straight down the list, but two backward moves are here
 * on purpose. WAITING_FOR_CUSTOMER → IN_PROGRESS is what happens the moment
 * the person writes back — the platform owes an answer again, and SYSTEM makes
 * that move so the operator does not have to remember to. RESOLVED →
 * IN_PROGRESS is the same admission for an answer that did not land: a ticket
 * reopened by a reply is far better than a second ticket about the same thing.
 *
 * Nothing leads out of CLOSED. That is the whole point of closing.
 */
export const SUPPORT_TRANSITIONS: Record<SupportTicketStatus, SupportTransition[]> = {
  [SupportTicketStatus.OPEN]: [
    {
      to: SupportTicketStatus.IN_PROGRESS,
      actors: [SupportActor.OPERATOR, SupportActor.ADMIN, SupportActor.SYSTEM],
    },
    { to: SupportTicketStatus.WAITING_FOR_CUSTOMER, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
    { to: SupportTicketStatus.RESOLVED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
    { to: SupportTicketStatus.CLOSED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
  ],

  [SupportTicketStatus.IN_PROGRESS]: [
    { to: SupportTicketStatus.WAITING_FOR_CUSTOMER, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
    { to: SupportTicketStatus.RESOLVED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
    { to: SupportTicketStatus.CLOSED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
  ],

  [SupportTicketStatus.WAITING_FOR_CUSTOMER]: [
    // The party who opened it wrote back, so the ball is on the platform again.
    {
      to: SupportTicketStatus.IN_PROGRESS,
      actors: [SupportActor.OPERATOR, SupportActor.ADMIN, SupportActor.SYSTEM],
    },
    { to: SupportTicketStatus.RESOLVED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
    { to: SupportTicketStatus.CLOSED, actors: [SupportActor.OPERATOR, SupportActor.ADMIN] },
  ],

  [SupportTicketStatus.RESOLVED]: [
    // Answered, but not to the asker's satisfaction — reopened by their reply.
    {
      to: SupportTicketStatus.IN_PROGRESS,
      actors: [SupportActor.OPERATOR, SupportActor.ADMIN, SupportActor.SYSTEM],
    },
    {
      to: SupportTicketStatus.CLOSED,
      actors: [SupportActor.OPERATOR, SupportActor.ADMIN, SupportActor.SYSTEM],
    },
  ],

  // Terminal. Retained forever, readable forever, writable never.
  [SupportTicketStatus.CLOSED]: [],
};

export type SupportTransitionRejection =
  | 'ticket-closed'
  | 'transition-not-allowed'
  | 'actor-not-allowed';

export interface SupportTransitionCheck {
  allowed: boolean;
  reason?: SupportTransitionRejection;
}

/** The one authority on whether a ticket's status may change. */
export function checkSupportTransition(
  from: SupportTicketStatus,
  to: SupportTicketStatus,
  actor: SupportActor,
): SupportTransitionCheck {
  if (isTicketClosed(from)) return { allowed: false, reason: 'ticket-closed' };

  const transition = (SUPPORT_TRANSITIONS[from] ?? []).find((entry) => entry.to === to);
  if (!transition) return { allowed: false, reason: 'transition-not-allowed' };

  if (!transition.actors.includes(actor)) {
    return { allowed: false, reason: 'actor-not-allowed' };
  }

  return { allowed: true };
}

export function isTicketClosed(status: SupportTicketStatus): boolean {
  return TERMINAL_SUPPORT_STATUSES.includes(status);
}

/** Statuses this actor may move the ticket to right now — drives the buttons. */
export function nextTicketStatusesFor(
  from: SupportTicketStatus,
  actor: SupportActor,
): SupportTicketStatus[] {
  return (SUPPORT_TRANSITIONS[from] ?? [])
    .filter((transition) => transition.actors.includes(actor))
    .map((transition) => transition.to);
}

/**
 * The status a ticket lands in when the party who opened it writes.
 *
 * A reply from the asker always means the platform owes an answer, whatever
 * the ticket said a moment ago. Returning null means "leave it where it is".
 */
export function statusAfterAskerReply(
  status: SupportTicketStatus,
): SupportTicketStatus | null {
  if (status === SupportTicketStatus.WAITING_FOR_CUSTOMER || status === SupportTicketStatus.RESOLVED) {
    return SupportTicketStatus.IN_PROGRESS;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who is who
// ---------------------------------------------------------------------------

/** The actor a role acts as. Null for a role with no place in support at all. */
export function supportActorFor(role: UserRole | null | undefined): SupportActor | null {
  if (role === UserRole.CUSTOMER) return SupportActor.CUSTOMER;
  if (role === UserRole.OPERATOR) return SupportActor.OPERATOR;
  if (role === UserRole.SUPER_ADMIN) return SupportActor.ADMIN;
  if (role && (RESTAURANT_ROLES as readonly UserRole[]).includes(role)) {
    return SupportActor.RESTAURANT;
  }
  // RESTAURANT_COURIER lands here, and that is the courier rule in one line.
  return null;
}

/** True for the three roles that may act on a restaurant's behalf. */
function isRestaurantParty(role: UserRole | null | undefined): boolean {
  return !!role && (RESTAURANT_ROLES as readonly UserRole[]).includes(role);
}

// ---------------------------------------------------------------------------
// Lane access
// ---------------------------------------------------------------------------

/**
 * May this role start a ticket in this lane, as a party to it?
 *
 * Platform staff are absent from every answer here on purpose: an operator
 * does not have a problem to raise, they answer other people's. The one thing
 * the platform may start is a restaurant thread of its own accord, which is a
 * different question — see `canReachOut`.
 */
export function canOpenLane(role: UserRole | null | undefined, lane: SupportLane): boolean {
  if (role === UserRole.CUSTOMER) return lane === SupportLane.CUSTOMER_TO_OPERATOR;
  if (isRestaurantParty(role)) {
    return lane === SupportLane.RESTAURANT_TO_OPERATOR || lane === SupportLane.RESTAURANT_TO_ADMIN;
  }
  return false;
}

/**
 * May this role open a restaurant thread on the platform's behalf?
 *
 * The most useful support message is often the first one — "your acceptance
 * times are slipping" — and losing that with the old one-thread-per-restaurant
 * design would have been a regression nobody asked for. It only ever produces
 * a RESTAURANT_TO_OPERATOR ticket: the platform does not raise a ticket
 * against itself, and it does not open a customer's ticket for them.
 */
export function canReachOut(role: UserRole | null | undefined): boolean {
  return role === UserRole.OPERATOR || role === UserRole.SUPER_ADMIN;
}

/** The lanes a platform role works. An operator's list is short by design. */
export function lanesHandledBy(role: UserRole | null | undefined): SupportLane[] {
  if (role === UserRole.SUPER_ADMIN) return Object.values(SupportLane);
  if (role === UserRole.OPERATOR) {
    return [SupportLane.CUSTOMER_TO_OPERATOR, SupportLane.RESTAURANT_TO_OPERATOR];
  }
  return [];
}

/** Who is asking, in the only three facts that decide access. */
export interface SupportViewer {
  role: UserRole | null | undefined;
  uid: string;
  /** The claim, not a field from the request. Null for anyone unattached. */
  restaurantId: string | null;
}

/** The parts of a ticket access depends on. Deliberately not the whole ticket. */
export interface SupportTicketRef {
  lane: SupportLane;
  status: SupportTicketStatus;
  customerId: string | null;
  restaurantId: string | null;
  /**
   * When it was closed, in milliseconds. Null while it is still open.
   *
   * Only used by the retention rule below — access itself does not depend on
   * when something happened, except for this one case.
   */
  closedAtMs?: number | null;
}

/**
 * HOW LONG A FINISHED TICKET STAYS ON THE ASKER'S SCREEN.
 *
 * Two weeks after it was closed, a resolved ticket disappears from the
 * restaurant's (or customer's) support list. The reason is clutter and nothing
 * else: a shop that raises one ticket a week is looking at a list of ninety
 * finished conversations by the end of the year, and the two that are still
 * open are somewhere in the middle of it.
 *
 * WHAT "DISAPPEARS" MEANS, PRECISELY
 * ----------------------------------
 * Hidden from the party who raised it. NOT deleted, and that distinction is
 * deliberate rather than a compromise: a support ticket about a settlement or
 * a refund is the record of a commercial dispute, and a restaurant that queries
 * an invoice three months later is asking about a conversation that has to
 * still exist. Deleting it would take the evidence away from BOTH sides —
 * including the side that wanted it gone.
 *
 * So the platform keeps every ticket, forever, exactly as before. The
 * restaurant simply stops being shown the old ones. If the owner does want
 * them destroyed, that is a different decision — a retention policy with a
 * legal answer behind it — and it belongs in one place, not in a screen.
 */
export const CLOSED_TICKET_VISIBLE_DAYS = 14;

/**
 * Should the party who raised this ticket still be shown it?
 *
 * Answered here rather than in a query so the list and the "open this one by
 * id" path cannot disagree — a ticket hidden from the list but reachable by
 * its id is not hidden, it is merely inconvenient to find.
 */
export function visibleToAsker(
  ticket: Pick<SupportTicketRef, 'status' | 'closedAtMs'>,
  nowMs: number = Date.now(),
): boolean {
  if (!isTicketClosed(ticket.status)) return true;

  // Closed with no timestamp: every ticket closed before this field existed.
  // Shown, because hiding something on the strength of a missing value is how
  // a person loses a conversation they were in the middle of reading.
  const closedAtMs = ticket.closedAtMs ?? null;
  if (closedAtMs === null) return true;

  return nowMs - closedAtMs < CLOSED_TICKET_VISIBLE_DAYS * 24 * 60 * 60_000;
}

export interface SupportAccess {
  read: boolean;
  reply: boolean;
  /** Closing, and every other status move. Only the platform side ever does. */
  close: boolean;
  escalate: boolean;
}

const NO_ACCESS: SupportAccess = { read: false, reply: false, close: false, escalate: false };

/**
 * The permission matrix, executed.
 *
 * Read is the widest of the four and still never crosses a party: a customer
 * reaches their own tickets and nobody else's, a restaurant reaches its own,
 * an operator reaches the two lanes it works, and only the admin sees
 * everything. A closed ticket stays readable to whoever could read it and
 * takes no writes from anyone — that is what "retained, not deleted" means in
 * practice.
 */
export function supportAccess(viewer: SupportViewer, ticket: SupportTicketRef): SupportAccess {
  const closed = isTicketClosed(ticket.status);

  // A courier has no support lane in either direction. Checked first so that
  // no later clause can accidentally let one through on a restaurant match.
  if (viewer.role === UserRole.RESTAURANT_COURIER) return NO_ACCESS;

  if (viewer.role === UserRole.SUPER_ADMIN) {
    // The admin sees every lane, including the one an operator may not, and
    // may take any ticket over. An admin never escalates — there is nobody
    // above them, and a button that says otherwise is a lie.
    return { read: true, reply: !closed, close: !closed, escalate: false };
  }

  if (viewer.role === UserRole.OPERATOR) {
    if (!lanesHandledBy(UserRole.OPERATOR).includes(ticket.lane)) return NO_ACCESS;
    return {
      read: true,
      reply: !closed,
      close: !closed,
      // Escalation is the operator's way out of a ticket they cannot finish.
      escalate: !closed,
    };
  }

  /*
   * From here down the viewer is the party who RAISED the ticket, and the
   * retention rule applies to exactly them. The platform's own access is
   * decided above and is not touched by it: an operator picking up a dispute
   * about an invoice from March needs the March conversation.
   */
  const stillVisible = visibleToAsker(ticket);

  if (viewer.role === UserRole.CUSTOMER) {
    const mine =
      ticket.lane === SupportLane.CUSTOMER_TO_OPERATOR &&
      !!ticket.customerId &&
      ticket.customerId === viewer.uid;
    if (!mine) return NO_ACCESS;
    if (!stillVisible) return NO_ACCESS;
    // A customer writes into their ticket and reads it. They do not close it:
    // "is this finished?" is the platform's answer to give, and a customer who
    // closed their own ticket by accident would have to start again.
    return { read: true, reply: !closed, close: false, escalate: false };
  }

  if (isRestaurantParty(viewer.role)) {
    const mine =
      ticket.lane !== SupportLane.CUSTOMER_TO_OPERATOR &&
      !!ticket.restaurantId &&
      !!viewer.restaurantId &&
      ticket.restaurantId === viewer.restaurantId;
    if (!mine) return NO_ACCESS;
    if (!stillVisible) return NO_ACCESS;
    return { read: true, reply: !closed, close: false, escalate: false };
  }

  return NO_ACCESS;
}

/** Convenience wrappers, so a call site reads as the question it is asking. */
export function canReadTicket(viewer: SupportViewer, ticket: SupportTicketRef): boolean {
  return supportAccess(viewer, ticket).read;
}

export function canReplyToTicket(viewer: SupportViewer, ticket: SupportTicketRef): boolean {
  return supportAccess(viewer, ticket).reply;
}

export function canCloseTicket(viewer: SupportViewer, ticket: SupportTicketRef): boolean {
  return supportAccess(viewer, ticket).close;
}

export function canEscalateTicket(viewer: SupportViewer, ticket: SupportTicketRef): boolean {
  return supportAccess(viewer, ticket).escalate;
}

/** True when the viewer is the party who raised the ticket, not the answerer. */
export function isTicketAsker(viewer: SupportViewer, ticket: SupportTicketRef): boolean {
  if (viewer.role === UserRole.CUSTOMER) return ticket.customerId === viewer.uid;
  if (isRestaurantParty(viewer.role)) {
    return !!viewer.restaurantId && ticket.restaurantId === viewer.restaurantId;
  }
  return false;
}
