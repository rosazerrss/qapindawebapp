'use client';

/**
 * The other ending: the courier went and could not hand the food over.
 *
 * "Delivered" is an ordinary button beside the rest of the order's steps, so it
 * is not here. This is only the unhappy path, and it sits behind a second tap
 * on purpose — it closes the order, waives the commission and starts a
 * conversation with the customer, and none of that should be one stray thumb
 * away on a busy Friday.
 *
 * A reason is compulsory. "Delivery failed" with no reason is a number nobody
 * can act on; "customer unreachable, three times this week, same address" is
 * the beginning of a fix.
 */

import { useState } from 'react';
import { PackageX } from 'lucide-react';

import { Alert, Button, Select, Textarea } from '@/components/ui';
import { reportDeliveryFailure } from '@/firebase/callables';
import { useT, translateError } from '@/i18n';
import { DeliveryFailureReason } from '@/shared/enums';

const REASONS = Object.values(DeliveryFailureReason);

export function DeliveryHandover({
  orderId,
  onDone,
}: {
  orderId: string;
  /** Fires once the order has actually moved; the list re-reads itself. */
  onDone: () => void;
}) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(DeliveryFailureReason.CUSTOMER_UNAVAILABLE);
  const [note, setNote] = useState('');

  const submit = async () => {
    setBusy(true);
    setError(null);

    const result = await reportDeliveryFailure({
      orderId,
      reason,
      note: note.trim() || null,
    });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setOpen(false);
    onDone();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-3 inline-flex items-center gap-1.5 rounded px-1 text-sm text-ink-500 underline transition hover:text-danger"
      >
        <PackageX size={15} aria-hidden /> {t('delivery.couldNotDeliver')}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <p className="text-sm font-medium text-ink-800">{t('delivery.failTitle')}</p>

      <Select
        label={t('delivery.failReason')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      >
        {REASONS.map((option) => (
          <option key={option} value={option}>
            {t(`deliveryFailure.${option}`)}
          </option>
        ))}
      </Select>

      <Textarea
        label={t('delivery.failNote')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
        hint={t('delivery.failNoteHint')}
      />

      <Alert tone="warning">{t('delivery.failWarning')}</Alert>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          fullWidth
          loading={busy}
          onClick={() => void submit()}
        >
          {t('delivery.failConfirm')}
        </Button>
      </div>
    </div>
  );
}
