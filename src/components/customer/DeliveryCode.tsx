'use client';

/**
 * The six digits a customer reads out at the door.
 *
 * Hidden behind one tap on purpose: the code is meant for the courier, not
 * for a phone screen glanced at across a room, so nothing here shows a digit
 * until the customer actually wants to.
 *
 * `issueDeliveryCode` mints the code the first time it is asked for and then
 * throws the plaintext away — only its hash survives, on the server, for
 * `courierConfirmDelivery` to check. A second tap after the page reloaded
 * therefore cannot bring the same digits back; the server says so plainly
 * (`unchanged: true, code: null`) rather than making this component spin
 * forever waiting for something that is never coming.
 */

import { useState } from 'react';
import { Eye } from 'lucide-react';

import { Alert, Button, Card } from '@/components/ui';
import { issueDeliveryCode } from '@/firebase/callables';
import { useT, translateError } from '@/i18n';

export function DeliveryCode({ orderId }: { orderId: string }) {
  const t = useT();

  const [code, setCode] = useState<string | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setBusy(true);
    setError(null);

    const result = await issueDeliveryCode(orderId);
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    if (result.data?.code) setCode(result.data.code);
    else setUnchanged(true);
  };

  return (
    <Card className="mt-4 border-brand-100 bg-brand-50 p-4">
      <h2 className="font-medium text-ink-900">{t('deliveryCode.title')}</h2>
      <p className="mt-1 text-sm text-ink-600">{t('deliveryCode.hint')}</p>

      {code ? (
        <p className="mt-3 text-center text-4xl font-semibold tracking-[0.3em] tabular-nums text-ink-900">
          {code}
        </p>
      ) : unchanged ? (
        <div className="mt-3">
          <Alert tone="info">
            <span className="block font-medium text-ink-900">{t('deliveryCode.unchangedTitle')}</span>
            <span className="mt-0.5 block">{t('deliveryCode.unchangedBody')}</span>
          </Alert>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" fullWidth loading={busy} onClick={() => void reveal()}>
            <Eye size={16} />
            {t('deliveryCode.reveal')}
          </Button>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}
