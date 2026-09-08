'use client';

/**
 * Why an order ended badly, and who ended it — written the same way everywhere.
 *
 * "KURYER RESTORAN ADMİN OPERATOR HAMISI BİRBİRİNE BAĞLI OLMALIDIR SİFARİŞLERDE
 * LEĞV OLAN SİFARİŞLER VE S." The four panels already read the same document
 * and already agreed about the STATUS. What they did not agree about was the
 * cancellation itself: the admin printed `by` as the raw enum ("PLATFORM"), the
 * restaurant and the operator printed the reason but never said who, and the
 * courier's screens did not mention it at all — a driver whose delivery had
 * been cancelled saw the word "Ləğv edildi" and nothing else.
 *
 * One component, one sentence, four panels: the reason, the free-text note if
 * somebody wrote one, who did it, and when.
 *
 * WHY IT IS TONED red RATHER THAN NEUTRAL
 * ---------------------------------------
 * It only ever appears on an order that ended badly, and it is the single most
 * important thing on the screen when it does. It matches `orderTone`'s `danger`
 * so the block, the status pill and the card's own edge stripe are all saying
 * the same thing in the same colour.
 */

import { AlertOctagon } from 'lucide-react';

import { useT } from '@/i18n';
import { when } from './status';
import type { Order } from '@/shared/models';

export function CancellationNote({
  cancellation,
  className,
}: {
  cancellation: Order['cancellation'] | null | undefined;
  className?: string;
}) {
  const t = useT();

  if (!cancellation) return null;

  return (
    <div
      className={
        className ??
        'rounded-xl border border-danger/40 bg-red-50 px-3.5 py-3 text-sm text-danger'
      }
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertOctagon size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {t(`order.reason.${cancellation.reason}`)}
          {cancellation.note ? ` — ${cancellation.note}` : ''}
        </span>
      </p>
      {/* Who and when, in the panel's own words rather than as the stored enum.
          "PLATFORM" on a driver's phone means nothing; "Qapında" does. */}
      <p className="mt-1 pl-6 text-xs text-danger/80">
        {t('order.cancelledBy', { actor: t(`orderActor.${cancellation.by}`) })}
        {when(cancellation.at) ? ` · ${when(cancellation.at)}` : ''}
      </p>
    </div>
  );
}

/**
 * The same fact, in one line, for a list.
 *
 * WHY A SECOND SHAPE RATHER THAN A PROP
 * -------------------------------------
 * The block above is right on a detail screen, where there is room and where
 * the reader has already decided this is the order they care about. It is wrong
 * in a list: a red panel repeated down a page of history stops meaning "look at
 * this" and starts meaning nothing at all, and it pushes every other row off
 * the screen.
 *
 * But a list that shows only "Ləğv edildi" is exactly the thing the owner asked
 * to be fixed — every panel showing that an order died and none of them saying
 * why. Somebody scanning yesterday's orders should be able to see "Yemək
 * bitib" without opening seven of them.
 *
 * So: one line, the reason, the note after it when there is one, in the danger
 * colour and nothing else. It carries the same words as the block, from the
 * same dictionary, so a list and a detail screen can never disagree.
 *
 * WHEN THE NOTE MATTERS MOST
 * --------------------------
 * `ForceCancelDialog` always stores `OTHER` and puts the operator's real
 * explanation in the note. So for every platform cancellation the reason alone
 * reads "Digər" and the note IS the answer — which is why it is included here
 * and not treated as an optional extra.
 */
export function CancellationLine({
  cancellation,
  className,
}: {
  /*
   * Only the two fields this renders, not the whole `cancellation` object.
   *
   * The block above needs `by` and `at`; a one-line summary does not, and
   * demanding them would stop this being usable from `customerOrderContext`,
   * which deliberately returns a reason and a note and nothing else — an
   * operator reading a support ticket has no business being handed a
   * timestamped actor record for every order in a customer's history.
   */
  cancellation: { reason: string; note?: string | null } | null | undefined;
  className?: string;
}) {
  const t = useT();

  if (!cancellation) return null;

  const reason = t(`order.reason.${cancellation.reason}`);
  const note = cancellation.note?.trim();

  return (
    <p className={className ?? 'mt-1 text-xs text-danger'}>
      {/* The note is not truncated with the reason. A long note is wrapped, and
          the row grows — losing the second half of the only sentence that
          explains a cancellation is worse than an uneven list. */}
      {note ? `${reason} — ${note}` : reason}
    </p>
  );
}
