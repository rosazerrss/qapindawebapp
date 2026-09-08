'use client';

/**
 * The platform's ticket list, subscribed once and read twice.
 *
 * Both the operator's overview strip and the support inbox underneath it want
 * the same answer — every ticket in the lanes this account works, newest
 * activity first — and both of them used to get it from a callable that ran
 * once when the screen mounted. That is exactly what the owner asked to be
 * rid of: *"operator terefinde saytı yenilemedende herşey real time
 * yenilensin"*. A new ticket, a new message, a status somebody else moved: all
 * of it now arrives on its own.
 *
 * The lane filter is what makes the subscription legal — see the long note on
 * `watchInboxTickets` in `src/services/support.ts` — and it comes from
 * `lanesHandledBy`, the same function the callable and the security rules use.
 *
 * `error` is not decoration either. A subscription Firestore refuses has to
 * say so; the alternative is a spinner that never stops, which reads as "the
 * platform is quiet today" and is the worst possible lie to tell a queue
 * screen.
 */

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { watchInboxTickets } from '@/services/support';
import { lanesHandledBy } from '@/shared/supportState';
import type { SupportTicket } from '@/shared/models';

export interface SupportTicketsState {
  /** Null while the first snapshot is still on its way. */
  tickets: SupportTicket[] | null;
  /** True when the subscription was refused or dropped. */
  error: boolean;
}

export function useSupportTickets(): SupportTicketsState {
  const { role } = useAuth();

  const lanes = useMemo(() => lanesHandledBy(role), [role]);
  // The effect keys on the lane list as a string, so a role that produces the
  // same two lanes on every render does not tear the subscription down and
  // build it again on each one.
  const laneKey = lanes.join(',');

  const [state, setState] = useState<SupportTicketsState>({ tickets: null, error: false });

  useEffect(() => {
    if (!laneKey) return;

    return watchInboxTickets(
      laneKey.split(',') as ReturnType<typeof lanesHandledBy>,
      (tickets) => setState({ tickets, error: false }),
      () => setState({ tickets: [], error: true }),
    );
  }, [laneKey]);

  // Derived during render rather than written by an effect: an account with no
  // lanes has an empty inbox, not a loading one, and that is a fact about the
  // role rather than something to discover asynchronously.
  if (lanes.length === 0) return { tickets: [], error: false };

  return state;
}
