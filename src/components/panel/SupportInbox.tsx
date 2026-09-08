'use client';

/**
 * The platform's support inbox.
 *
 * WHAT THE QUEUES ARE, AND WHY THEY ARE THESE ONES
 * ------------------------------------------------
 * Two axes, because an operator's day has two questions in it. *Who* is
 * waiting — a customer or a restaurant — decides the tone and the facts you
 * need in front of you. *What state* the ticket is in decides whether it is
 * yours to pick up now: Aktiv is work in hand, Gözləyən is the ball in
 * somebody else's court, Həll olunmuş is answered and not yet finished, and
 * Bağlanmış is history you can still read. Someone working Aktiv from the top
 * is working the right list.
 *
 * THE LIST IS LIVE, AND IT DID NOT USED TO BE
 * -------------------------------------------
 * It came from `listSupportTickets`, a callable, which meant a new ticket
 * appeared when the operator reloaded the page and not a moment before. The
 * owner's instruction was plain — *"operator terefinde saytı yenilemedende
 * herşey real time yenilensin"* — and the belief that a browser could not make
 * this query turned out to be wrong: the operator's rule names `lane in [...]`
 * and a subscription carrying that same filter proves itself against it. See
 * `watchInboxTickets`. An operator's result still never contains a restaurant →
 * admin ticket, and now the rule is what says so on every snapshot rather than
 * a server-side filter applied once.
 *
 * A refused subscription shows an error. There is no state in which this
 * screen spins for ever.
 *
 * The admin panel and the operator screen both mount this, so an operator
 * moved onto the admin panel, or the reverse, finds the same inbox behaving
 * the same way — with the admin simply seeing one lane more.
 */

import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  Inbox,
  MessageSquarePlus,
  ShieldAlert,
  Store,
  UserRound,
} from 'lucide-react';

import { Chat } from './Chat';
import { ConfirmDialog, PageHeader, SearchInput, StatusBadge, Tabs } from './ui';
import { supportTone, when } from './status';
import { useToast } from './Toast';
import { useSupportTickets } from './useSupportTickets';
import { Alert, Button, Card, Input, Select, Textarea, Spinner, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { openSupportTicket } from '@/firebase/callables';
import { listRestaurants } from '@/services/catalog';
import { useAuth } from '@/contexts/AuthContext';
import { canReachOut, lanesHandledBy } from '@/shared/supportState';
import { SupportLane, SupportTicketStatus } from '@/shared/enums';
import type { Restaurant } from '@/shared/models';

/** The four queues, in the order the owner asked for them. */
type Queue = 'active' | 'waiting' | 'resolved' | 'closed';

/** And the two sides a ticket can come from. */
type Party = 'customers' | 'restaurants';

const QUEUE_STATUSES: Record<Queue, SupportTicketStatus[]> = {
  active: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS],
  waiting: [SupportTicketStatus.WAITING_FOR_CUSTOMER],
  resolved: [SupportTicketStatus.RESOLVED],
  closed: [SupportTicketStatus.CLOSED],
};

const PARTY_LANES: Record<Party, SupportLane[]> = {
  customers: [SupportLane.CUSTOMER_TO_OPERATOR],
  restaurants: [SupportLane.RESTAURANT_TO_OPERATOR, SupportLane.RESTAURANT_TO_ADMIN],
};

export function SupportInbox({
  /** Sentence under the title. Each panel explains the inbox in its own words. */
  subtitle,
}: {
  subtitle: string;
}) {
  const t = useT();
  const toast = useToast();
  const { role } = useAuth();

  const { tickets, error: subscriptionFailed } = useSupportTickets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [queue, setQueue] = useState<Queue>('active');
  const [party, setParty] = useState<Party>('customers');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  // `listRestaurants` rejecting used to leave the picker permanently on
  // "Yüklənir…" with no way to find out why, and no way to open a thread.
  const [restaurantsError, setRestaurantsError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing reloads the list any more. The subscription brings a new ticket,
  // a new message and a status somebody else moved, and the row being read is
  // part of the same snapshot — so there is no patching-back to do either.

  // Everything below is derived during render. The counts in particular must
  // be: they are a pure function of the list, and an effect that copied them
  // into state would show yesterday's numbers for one frame after every reply.
  const visibleLanes = useMemo(() => lanesHandledBy(role), [role]);

  const forParty = useMemo(
    () =>
      (tickets ?? []).filter(
        (ticket) =>
          visibleLanes.includes(ticket.lane) && PARTY_LANES[party].includes(ticket.lane),
      ),
    [tickets, party, visibleLanes],
  );

  const counts = useMemo(() => {
    const totals: Record<Queue, number> = { active: 0, waiting: 0, resolved: 0, closed: 0 };
    for (const ticket of forParty) {
      for (const key of Object.keys(QUEUE_STATUSES) as Queue[]) {
        if (QUEUE_STATUSES[key].includes(ticket.status)) totals[key] += 1;
      }
    }
    return totals;
  }, [forParty]);

  const partyCounts = useMemo(() => {
    const totals: Record<Party, number> = { customers: 0, restaurants: 0 };
    for (const ticket of tickets ?? []) {
      if (!visibleLanes.includes(ticket.lane)) continue;
      for (const key of Object.keys(PARTY_LANES) as Party[]) {
        if (PARTY_LANES[key].includes(ticket.lane)) totals[key] += 1;
      }
    }
    return totals;
  }, [tickets, visibleLanes]);

  const rows = useMemo(() => {
    if (!tickets) return null;
    const needle = term.trim().toLowerCase();

    return forParty
      .filter((ticket) => QUEUE_STATUSES[queue].includes(ticket.status))
      .filter((ticket) => {
        if (!needle) return true;
        // Defensive on every field: a ticket carried over from the old
        // conversations can be missing a name, and a search box is not the
        // place to find that out by crashing.
        const haystack = [
          ticket.subject,
          ticket.restaurantName,
          ticket.customerName,
          ticket.orderCode,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .slice()
      .sort((a, b) => {
        // Waiting beats recent: a ticket nobody has answered is the reason
        // this screen exists, and a busy day of replied-to tickets must not
        // push it below the fold.
        const unread = Number((b.unreadForPlatform ?? 0) > 0) - Number((a.unreadForPlatform ?? 0) > 0);
        if (unread !== 0) return unread;
        return (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0);
      });
  }, [tickets, forParty, queue, term]);

  const selected = (tickets ?? []).find((entry) => entry.id === selectedId) ?? null;

  const openPicker = () => {
    setError(null);
    setPick('');
    setSubject('');
    setBody('');
    setDialogOpen(true);

    // Fetched when the dialog opens rather than once per session: a restaurant
    // approved during the shift has to be reachable without a page reload,
    // which is the whole of what this screen was asked to become. It is a
    // sixty-document read behind a button, not a listener. Cleared first, so
    // the picker says "loading" instead of showing the previous roster as
    // though it were current.
    setRestaurants(null);
    setRestaurantsError(null);
    listRestaurants()
      .then((found) => {
        setRestaurants(found);
        setRestaurantsError(null);
      })
      .catch(() => {
        setRestaurants([]);
        setRestaurantsError(t('errors.LIST_UNAVAILABLE'));
      });
  };

  const start = async () => {
    if (!pick || subject.trim().length < 3 || !body.trim()) return;

    setBusy(true);
    setError(null);
    const result = await openSupportTicket({
      lane: SupportLane.RESTAURANT_TO_OPERATOR,
      restaurantId: pick,
      subject: subject.trim(),
      body: body.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setDialogOpen(false);
    setParty('restaurants');
    setQueue('active');
    if (result.data?.ticketId) setSelectedId(result.data.ticketId);
    toast.show(t('support.threadOpened'));
  };

  return (
    <>
      <PageHeader
        title={t('nav.support')}
        subtitle={subtitle}
        actions={
          canReachOut(role) ? (
            <Button size="sm" variant="secondary" onClick={openPicker}>
              <MessageSquarePlus size={15} />
              {t('support.newThread')}
            </Button>
          ) : undefined
        }
      />

      {/*
        The two sides come first and the queue second, because "whose problem
        is this" changes what you read and "what state is it in" only changes
        which of them you read next.
      */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(PARTY_LANES) as Party[]).map((entry) => {
          const active = entry === party;
          const Icon = entry === 'customers' ? UserRound : Store;

          return (
            <button
              key={entry}
              onClick={() => {
                setParty(entry);
                setSelectedId(null);
              }}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition',
                active
                  ? 'border-brand-300 bg-brand-50 font-medium text-brand-800'
                  : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
              )}
            >
              <Icon size={15} aria-hidden />
              {t(`support.party.${entry}`)}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                  active ? 'bg-white text-brand-700' : 'bg-ink-100 text-ink-500',
                )}
              >
                {partyCounts[entry]}
              </span>
            </button>
          );
        })}
      </div>

      <Tabs<Queue>
        value={queue}
        onChange={setQueue}
        counts={counts}
        options={[
          { value: 'active', label: t('support.queueActive') },
          { value: 'waiting', label: t('support.queueWaiting') },
          { value: 'resolved', label: t('support.queueResolved') },
          { value: 'closed', label: t('support.queueClosed') },
        ]}
      />

      {/*
        Two columns on a desktop, one at a time on a phone. A phone cannot show
        a list and a thread at once without making both unreadable, so it shows
        the list until a thread is chosen and the thread with a way back after.
      */}
      <div className="grid gap-4 md:grid-cols-[20rem_1fr] lg:grid-cols-[24rem_1fr]">
        <div className={cn('min-w-0', selectedId && 'hidden md:block')}>
          <div className="mb-3">
            <SearchInput
              value={term}
              onChange={setTerm}
              placeholder={t('support.searchTickets')}
              className="max-w-none sm:max-w-none"
            />
          </div>

          <Card className="max-h-[calc(100vh-20rem)] overflow-y-auto p-0">
            {subscriptionFailed ? (
              <div className="p-4">
                <Alert tone="danger">{t('support.inboxUnavailable')}</Alert>
              </div>
            ) : rows === null ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-5 w-5 text-ink-400" />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Inbox size={22} className="mx-auto mb-2 text-ink-300" aria-hidden />
                <p className="font-medium text-ink-700">{t('support.noTickets')}</p>
                <p className="mt-1 text-sm text-ink-400">{t('support.noTicketsHint')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-row-edge">
                {rows.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      onClick={() => setSelectedId(ticket.id)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink-50/70',
                        ticket.id === selectedId && 'bg-brand-50/60',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink-900">
                          {ticket.subject || t('support.untitledTicket')}
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-ink-500">
                          {ticket.lastMessage || t('support.noMessagesYet')}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                          <span className="truncate">
                            {ticket.restaurantName || ticket.customerName || '—'}
                          </span>
                          {ticket.orderCode && <span>· {ticket.orderCode}</span>}
                          <span>· {when(ticket.lastMessageAt)}</span>
                          {ticket.escalated && (
                            <ShieldAlert size={12} className="text-warning" aria-hidden />
                          )}
                        </span>
                      </span>

                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <StatusBadge tone={supportTone(ticket.status)}>
                          {t(`supportStatus.${ticket.status}`)}
                        </StatusBadge>
                        {(ticket.unreadForPlatform ?? 0) > 0 && (
                          <span
                            className="min-w-5 rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums text-white"
                            aria-label={t('support.unreadCount', {
                              count: ticket.unreadForPlatform,
                            })}
                          >
                            {ticket.unreadForPlatform}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className={cn('min-w-0', !selectedId && 'hidden md:block')}>
          {selectedId ? (
            <>
              <button
                onClick={() => setSelectedId(null)}
                className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 md:hidden"
              >
                <ChevronLeft size={16} />
                {t('support.backToTickets')}
              </button>

              <Chat
                // Remounts when the operator switches ticket, so no state from
                // the previous conversation — least of all a half-typed reply
                // — can follow them into the next one.
                key={selectedId}
                ticketId={selectedId}
                seed={selected}
              />
            </>
          ) : (
            <Card className="flex h-[calc(100vh-14rem)] min-h-96 items-center justify-center px-6 text-center">
              <p className="text-sm text-ink-400">{t('support.selectTicket')}</p>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        title={t('support.newThread')}
        body={t('support.newThreadBody')}
        confirmLabel={t('support.startThread')}
        tone="primary"
        busy={busy}
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => void start()}
      >
        <Select
          label={t('support.restaurant')}
          value={pick}
          onChange={(event) => setPick(event.target.value)}
        >
          <option value="">
            {restaurantsError ? '—' : restaurants === null ? t('common.loading') : '—'}
          </option>
          {(restaurants ?? []).map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </Select>

        <Input
          label={t('support.subjectLabel')}
          value={subject}
          maxLength={120}
          placeholder={t('support.subjectPlaceholder')}
          onChange={(event) => setSubject(event.target.value)}
        />

        <Textarea
          label={t('support.bodyLabel')}
          value={body}
          rows={4}
          maxLength={2000}
          placeholder={t('support.bodyPlaceholder')}
          onChange={(event) => setBody(event.target.value)}
        />

        {restaurantsError && <Alert tone="danger">{restaurantsError}</Alert>}

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </>
  );
}
