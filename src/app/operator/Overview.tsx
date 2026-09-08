'use client';

/**
 * The operator's shift, in figures.
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator screen was four tabs on flat white, and the owner's complaint
 * about it was exact: *"vidgetlər daha dolğun olsun biraz operator tərəfində
 * çünki bilinmir arxa fonda ağ olduğu üçün"* — the panels do not read as
 * panels, because nothing separates them from the page. The fix is not
 * decoration. It is giving the cards something to hold: how many orders are
 * moving, how many people are waiting on an answer, how many tickets nobody
 * has picked up, how many complaints still need a decision. A card with a
 * heading and a number in it is a card you can see; a card with a heading is
 * a rectangle.
 *
 * Every figure here is real and live. Nothing is a placeholder, and nothing is
 * an estimate — a dashboard that rounds is a dashboard people stop trusting
 * the first time it disagrees with the list underneath it.
 *
 * AND LIVE NOW MEANS LIVE
 * -----------------------
 * Two of these four figures used to be fetched once, when the screen mounted,
 * and then sat there being wrong for the rest of the shift. The owner's words
 * were *"operator terefinde saytı yenilemedende herşey real time yenilensin"*,
 * so:
 *
 *   - the live orders and both ticket figures are Firestore subscriptions, and
 *     the ticket ones share the very subscription the inbox below is built on,
 *     so the strip and the list can never disagree;
 *   - the complaints figure cannot be. `complaints` is closed to every browser
 *     in `firestore.rules` — it carries the complainant's real name and number
 *     — so it comes from a callable, and a callable that never runs again is
 *     the thing being fixed. It re-runs on a timer, and again whenever the
 *     operator comes back to the tab, which is when a stale number would
 *     actually be read.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit as limitTo, onSnapshot, query, where } from 'firebase/firestore';
import { AlertTriangle, Inbox, MessageSquare, Receipt, Store, UserRound } from 'lucide-react';

import { StatusBadge } from '@/components/panel/ui';
import { Card, cn } from '@/components/ui';
import { useT } from '@/i18n';
import { firestore } from '@/firebase/client';
import { listComplaints } from '@/firebase/callables';
import { list } from '@/lib/stored';
import { useSupportTickets } from '@/components/panel/useSupportTickets';
import { COLLECTIONS } from '@/shared/collections';
import {
  ACTIVE_ORDER_STATUSES,
  ACTIVE_SUPPORT_STATUSES,
  ComplaintStatus,
  SupportLane,
  SupportTicketStatus,
} from '@/shared/enums';

/** How many live orders the strip will count before it says "200+". */
const LIVE_ORDER_CAP = 200;

/**
 * How often the complaint figure is asked for again, in milliseconds.
 *
 * A minute. Complaints arrive after a delivery rather than in bursts, so this
 * is far more often than the number actually changes; the cost is one counted
 * query a minute per operator on screen, and the benefit is that the tile is
 * never more than a minute behind the queue beneath it.
 */
const COMPLAINT_REFRESH_MS = 60_000;

interface LaneCount {
  active: number;
  waiting: number;
  unassigned: number;
}

/**
 * One figure, with real surface.
 *
 * Tinted rather than white, ringed rather than shadowed, and the number is the
 * largest thing in it. The tone is the meaning, not the mood: amber is
 * something waiting on a person, brand is work in hand, grey is context.
 */
function Tile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'plain',
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Inbox;
  tone?: 'plain' | 'brand' | 'warning';
}) {
  const tones = {
    plain: 'border-ink-200 bg-white',
    brand: 'border-brand-200 bg-brand-50',
    warning: 'border-amber-200 bg-amber-50',
  } as const;

  const figures = {
    plain: 'text-ink-900',
    brand: 'text-brand-800',
    warning: 'text-warning',
  } as const;

  return (
    <div className={cn('rounded-2xl border p-4', tones[tone])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-600">{label}</p>
        <Icon size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
      </div>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums', figures[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Overview() {
  const t = useT();

  const { tickets, error: ticketsFailed } = useSupportTickets();

  const [liveOrders, setLiveOrders] = useState<number | null>(null);
  const [openComplaints, setOpenComplaints] = useState<number | null>(null);
  // A tile that could not be read shows the dash it already shows while
  // loading, never a zero. "No live orders" and "I could not find out" look
  // identical as a 0 and mean opposite things to whoever is on shift.
  const [liveOrdersFailed, setLiveOrdersFailed] = useState(false);
  const [complaintsFailed, setComplaintsFailed] = useState(false);

  // The live orders are already a subscription on the orders tab; this one is
  // a count of the same query, kept separate so the strip stays honest even
  // while the operator is looking at a different tab.
  //
  // Capped, and the cap is shown as "200+" rather than as a wrong number. An
  // unbounded listener on every active order would be a bill that grows with
  // the platform for a figure nobody reads past the first two digits.
  useEffect(() => {
    const db = firestore();
    if (!db) return;

    return onSnapshot(
      query(
        collection(db, COLLECTIONS.orders),
        where('status', 'in', ACTIVE_ORDER_STATUSES),
        limitTo(LIVE_ORDER_CAP),
      ),
      (snapshot) => {
        setLiveOrders(snapshot.size);
        setLiveOrdersFailed(false);
      },
      () => setLiveOrdersFailed(true),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    // The callable is the external system this effect subscribes to, and the
    // figure is written from its callback — never synchronously in the effect
    // body, which would paint a number the render pass has not seen.
    const refresh = () => {
      listComplaints(ComplaintStatus.OPEN).then((result) => {
        if (cancelled) return;

        if (!result.ok || !result.data) {
          setComplaintsFailed(true);
          return;
        }

        setOpenComplaints(list(result.data.complaints).length);
        setComplaintsFailed(false);
      });
    };

    refresh();
    const timer = setInterval(refresh, COMPLAINT_REFRESH_MS);
    // Coming back to the tab is the moment a stale number is about to be read,
    // so it is also the moment worth spending a query on.
    window.addEventListener('focus', refresh);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Derived during render from the live ticket list: the totals are a pure
  // function of it, and mirroring them into state would only add a frame of
  // wrong numbers after every reply.
  const byLane = useMemo(() => {
    const empty = (): LaneCount => ({ active: 0, waiting: 0, unassigned: 0 });
    const totals = new Map<SupportLane, LaneCount>();

    for (const ticket of tickets ?? []) {
      const entry = totals.get(ticket.lane) ?? empty();
      if (ACTIVE_SUPPORT_STATUSES.includes(ticket.status)) entry.active += 1;
      if (ticket.status === SupportTicketStatus.WAITING_FOR_CUSTOMER) entry.waiting += 1;
      // "Unpicked" is a ticket still sitting in OPEN: nobody has answered it
      // and nobody has claimed it, which is the one number worth interrupting
      // an operator over.
      if (ticket.status === SupportTicketStatus.OPEN) entry.unassigned += 1;
      totals.set(ticket.lane, entry);
    }

    return {
      customers: totals.get(SupportLane.CUSTOMER_TO_OPERATOR) ?? empty(),
      restaurants: totals.get(SupportLane.RESTAURANT_TO_OPERATOR) ?? empty(),
    };
  }, [tickets]);

  const unpicked = byLane.customers.unassigned + byLane.restaurants.unassigned;
  const dash = (value: number | null, failed = false) =>
    failed || value === null ? '—' : value;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">{t('operator.overviewTitle')}</h2>
        {unpicked > 0 && (
          <StatusBadge tone="warning">
            {t('operator.unpickedTickets', { count: unpicked })}
          </StatusBadge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('operator.liveOrders')}
          value={
            !liveOrdersFailed && liveOrders === LIVE_ORDER_CAP
              ? `${LIVE_ORDER_CAP}+`
              : dash(liveOrders, liveOrdersFailed)
          }
          hint={t('operator.liveOrdersHint')}
          icon={Receipt}
          tone="brand"
        />
        <Tile
          label={t('operator.openComplaints')}
          value={dash(openComplaints, complaintsFailed)}
          hint={t('operator.openComplaintsHint')}
          icon={AlertTriangle}
          tone={!complaintsFailed && openComplaints ? 'warning' : 'plain'}
        />
        <Tile
          label={t('operator.customerTickets')}
          value={tickets === null || ticketsFailed ? '—' : byLane.customers.active}
          hint={t('operator.waitingCount', { count: byLane.customers.waiting })}
          icon={UserRound}
        />
        <Tile
          label={t('operator.restaurantTickets')}
          value={tickets === null || ticketsFailed ? '—' : byLane.restaurants.active}
          hint={t('operator.waitingCount', { count: byLane.restaurants.waiting })}
          icon={Store}
        />
      </div>

      {/*
        The one line that says what to do next. It is a card rather than a
        sentence because on a phone the tiles above scroll and this must not
        scroll away with them: it is the whole point of the strip.
      */}
      <Card className="mt-3 flex items-center gap-3 border-ink-200 bg-ink-50/60 p-3.5">
        {ticketsFailed || liveOrdersFailed || complaintsFailed ? (
          <>
            <AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden />
            <p className="text-sm text-danger">
              {ticketsFailed ? t('support.inboxUnavailable') : t('errors.LIVE_UNAVAILABLE')}
            </p>
          </>
        ) : unpicked > 0 ? (
          <>
            <Inbox size={18} className="shrink-0 text-warning" aria-hidden />
            <p className="text-sm text-ink-700">{t('operator.pickUpHint')}</p>
          </>
        ) : (
          <>
            <MessageSquare size={18} className="shrink-0 text-ink-400" aria-hidden />
            <p className="text-sm text-ink-500">{t('operator.allPickedUp')}</p>
          </>
        )}
      </Card>
    </section>
  );
}
