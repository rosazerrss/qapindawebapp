import { describe, expect, it } from 'vitest';

import {
  SUPPORT_TRANSITIONS,
  checkSupportTransition,
  isTicketClosed,
  nextTicketStatusesFor,
  statusAfterAskerReply,
  supportActorFor,
} from '../shared/supportState';
import { SupportActor, SupportTicketStatus, UserRole } from '../shared/enums';

const ALL_STATUSES = Object.values(SupportTicketStatus);
const ALL_ACTORS = Object.values(SupportActor);

/**
 * The ticket state machine.
 *
 * The rules that matter commercially are all here: a closed ticket is finished
 * forever, a party never moves a ticket's status, and the platform can always
 * get from wherever a ticket is to closed. Each of them is asserted rather than
 * read off the transition table, because the table is the thing under test.
 */
describe('support ticket transitions', () => {
  it('covers every status', () => {
    for (const status of ALL_STATUSES) {
      expect(SUPPORT_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('walks the happy path with an operator', () => {
    const path: SupportTicketStatus[] = [
      SupportTicketStatus.OPEN,
      SupportTicketStatus.IN_PROGRESS,
      SupportTicketStatus.WAITING_FOR_CUSTOMER,
      SupportTicketStatus.RESOLVED,
      SupportTicketStatus.CLOSED,
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      const check = checkSupportTransition(path[index], path[index + 1], SupportActor.OPERATOR);
      expect(check.allowed, `${path[index]} → ${path[index + 1]}`).toBe(true);
    }
  });

  it('lets the admin walk the same path', () => {
    expect(
      checkSupportTransition(
        SupportTicketStatus.OPEN,
        SupportTicketStatus.IN_PROGRESS,
        SupportActor.ADMIN,
      ).allowed,
    ).toBe(true);
    expect(
      checkSupportTransition(
        SupportTicketStatus.RESOLVED,
        SupportTicketStatus.CLOSED,
        SupportActor.ADMIN,
      ).allowed,
    ).toBe(true);
  });

  it('is terminal at CLOSED — nothing leads out of it, for anyone', () => {
    expect(isTicketClosed(SupportTicketStatus.CLOSED)).toBe(true);
    expect(SUPPORT_TRANSITIONS[SupportTicketStatus.CLOSED]).toEqual([]);

    for (const actor of ALL_ACTORS) {
      for (const to of ALL_STATUSES) {
        const check = checkSupportTransition(SupportTicketStatus.CLOSED, to, actor);
        expect(check.allowed, `${actor} → ${to}`).toBe(false);
        expect(check.reason).toBe('ticket-closed');
      }
    }
  });

  it('never lets a customer or a restaurant move a ticket', () => {
    for (const actor of [SupportActor.CUSTOMER, SupportActor.RESTAURANT]) {
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          expect(
            checkSupportTransition(from, to, actor).allowed,
            `${actor}: ${from} → ${to}`,
          ).toBe(false);
        }
      }
      expect(nextTicketStatusesFor(SupportTicketStatus.OPEN, actor)).toEqual([]);
    }
  });

  it('lets the platform close a ticket from every live status', () => {
    for (const from of ALL_STATUSES) {
      if (isTicketClosed(from)) continue;
      expect(
        checkSupportTransition(from, SupportTicketStatus.CLOSED, SupportActor.OPERATOR).allowed,
        from,
      ).toBe(true);
    }
  });

  it('refuses a move that is not in the table, and says which kind of no it is', () => {
    // OPEN → OPEN is not a transition at all.
    expect(
      checkSupportTransition(
        SupportTicketStatus.OPEN,
        SupportTicketStatus.OPEN,
        SupportActor.OPERATOR,
      ),
    ).toEqual({ allowed: false, reason: 'transition-not-allowed' });

    // WAITING → IN_PROGRESS exists, but not for the person who raised it.
    expect(
      checkSupportTransition(
        SupportTicketStatus.WAITING_FOR_CUSTOMER,
        SupportTicketStatus.IN_PROGRESS,
        SupportActor.CUSTOMER,
      ),
    ).toEqual({ allowed: false, reason: 'actor-not-allowed' });
  });

  it('reopens a ticket when the party who raised it writes back', () => {
    // The two states where the ball was in the asker's court.
    expect(statusAfterAskerReply(SupportTicketStatus.WAITING_FOR_CUSTOMER)).toBe(
      SupportTicketStatus.IN_PROGRESS,
    );
    expect(statusAfterAskerReply(SupportTicketStatus.RESOLVED)).toBe(
      SupportTicketStatus.IN_PROGRESS,
    );

    // And the ones where it changes nothing.
    expect(statusAfterAskerReply(SupportTicketStatus.OPEN)).toBeNull();
    expect(statusAfterAskerReply(SupportTicketStatus.IN_PROGRESS)).toBeNull();
    expect(statusAfterAskerReply(SupportTicketStatus.CLOSED)).toBeNull();

    // SYSTEM is the actor that makes that move, so the machine must allow it.
    expect(
      checkSupportTransition(
        SupportTicketStatus.RESOLVED,
        SupportTicketStatus.IN_PROGRESS,
        SupportActor.SYSTEM,
      ).allowed,
    ).toBe(true);
  });
});

describe('who acts as what', () => {
  it('maps every role, and gives the courier none', () => {
    expect(supportActorFor(UserRole.CUSTOMER)).toBe(SupportActor.CUSTOMER);
    expect(supportActorFor(UserRole.RESTAURANT_OWNER)).toBe(SupportActor.RESTAURANT);
    expect(supportActorFor(UserRole.RESTAURANT_MANAGER)).toBe(SupportActor.RESTAURANT);
    expect(supportActorFor(UserRole.RESTAURANT_STAFF)).toBe(SupportActor.RESTAURANT);
    expect(supportActorFor(UserRole.OPERATOR)).toBe(SupportActor.OPERATOR);
    expect(supportActorFor(UserRole.SUPER_ADMIN)).toBe(SupportActor.ADMIN);

    // The courier rule, in one assertion.
    expect(supportActorFor(UserRole.RESTAURANT_COURIER)).toBeNull();
    expect(supportActorFor(null)).toBeNull();
  });
});
