'use client';

/**
 * Killing an order from the platform side.
 *
 * This is the only way a platform account ever touches somebody else's order,
 * and it is irreversible: the kitchen stops cooking and the customer is told.
 * So it asks twice — once by naming the order in the dialog, and once by
 * refusing to submit until a real sentence has been written.
 *
 * The reason is not paperwork. It is copied into the audit log under the
 * caller's name and is the only record of why a paid-for meal stopped, which
 * is what a restaurant asks about weeks later. The server enforces the ten
 * characters too; checking here only saves the round trip.
 */

import { useState } from 'react';

import { ConfirmDialog } from './ui';
import { useToast } from './Toast';
import { Alert, Select, Textarea } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { updateOrderStatus } from '@/firebase/callables';
import { CancellationReason, OrderStatus } from '@/shared/enums';
import type { Order } from '@/shared/models';

const MIN_REASON = 10;

/**
 * The reasons a platform cancellation can honestly carry.
 *
 * Not the whole enum: `CUSTOMER_CHANGED_MIND` is the customer's own reason and
 * `RESTAURANT_TOO_BUSY` is the kitchen's, and an operator recording either of
 * those would be putting words in somebody else's mouth on a record the
 * settlement and the audit trail both read. What is left is what an operator
 * can actually establish from where they sit.
 */
const PLATFORM_REASONS: CancellationReason[] = [
  CancellationReason.CUSTOMER_UNREACHABLE,
  CancellationReason.ADDRESS_OUT_OF_RANGE,
  CancellationReason.ITEM_UNAVAILABLE,
  CancellationReason.RESTAURANT_CLOSED,
  CancellationReason.DUPLICATE_ORDER,
  CancellationReason.SUSPECTED_FRAUD,
  CancellationReason.OTHER,
];

export function ForceCancelDialog({
  order,
  onClose,
  onCancelled,
}: {
  /** The order to cancel, or null when the dialog is closed. */
  order: Order | null;
  onClose: () => void;
  /** Called after the server accepted, so the caller can shut its detail view. */
  onCancelled?: () => void;
}) {
  const t = useT();
  const toast = useToast();

  /*
   * A REAL REASON, not "Digər" for everything.
   *
   * This dialog used to send `CancellationReason.OTHER` unconditionally and put
   * the operator's sentence in the note. That is why every platform
   * cancellation on every panel read "Digər" — the one word that says nothing —
   * and why the explanation only existed in the note, which most lists never
   * showed. Picking from the same nine reasons the restaurant and the customer
   * pick from makes a cancelled order scannable everywhere, and the note stays
   * for the detail.
   */
  const [reasonCode, setReasonCode] = useState<CancellationReason>(CancellationReason.OTHER);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const run = async () => {
    if (!order) return;

    setBusy(true);
    setError(null);

    const result = await updateOrderStatus({
      orderId: order.id,
      status: OrderStatus.CANCELLED,
      reason: reasonCode,
      note: reason,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('admin.orderCancelled'));
    setReason('');
    onClose();
    onCancelled?.();
  };

  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <ConfirmDialog
      open={Boolean(order)}
      title={t('order.cancel')}
      body={t('admin.cancelWarning', { code: order?.code ?? '' })}
      confirmLabel={t('common.confirm')}
      busy={busy}
      onCancel={close}
      onConfirm={() => {
        if (tooShort) return;
        void run();
      }}
    >
      <Select
        label={t('order.cancelReason')}
        value={reasonCode}
        onChange={(event) => setReasonCode(event.target.value as CancellationReason)}
      >
        {PLATFORM_REASONS.map((value) => (
          <option key={value} value={value}>
            {t(`order.reason.${value}`)}
          </option>
        ))}
      </Select>

      <Textarea
        label={t('admin.reasonRequired')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={300}
        hint={t('admin.reasonAudited')}
      />
      {tooShort && <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
    </ConfirmDialog>
  );
}
