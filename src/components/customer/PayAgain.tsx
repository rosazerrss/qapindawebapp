'use client';

/**
 * An online order that has not been paid for.
 *
 * This exists because the alternative is a dead end. A customer who closed the
 * bank page, lost signal, or had a card declined ends up holding an order that
 * no kitchen will ever see and no screen explains — and the thing they do next
 * is place the same order again, which is how a restaurant ends up cooking two
 * dinners for one household.
 *
 * So the state is stated plainly and there is exactly one button. Pressing it
 * asks the server for a fresh payment; the server hands back the live attempt
 * if one is still open rather than starting a second, so pressing it twice
 * cannot open two bank pages.
 */

import { useState } from 'react';
import { CreditCard } from 'lucide-react';

import { Alert, Button, Card } from '@/components/ui';
import { startOnlinePayment } from '@/firebase/callables';
import { useT, translateError } from '@/i18n';

export function PayAgain({ orderId }: { orderId: string }) {
  const t = useT();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setError(null);

    const result = await startOnlinePayment(orderId);

    if (!result.ok || !result.data) {
      setBusy(false);
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    // Left busy on purpose: the page is about to be replaced by the bank's,
    // and a button that springs back to life first invites a second tap.
    window.location.href = result.data.redirectUrl;
  };

  return (
    <Card className="mt-3 border-warning/30 bg-amber-50 p-4">
      <p className="font-medium text-ink-900">{t('payment.unpaidTitle')}</p>
      <p className="mt-1 text-sm text-ink-600">{t('payment.unpaidBody')}</p>

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Button className="mt-3" fullWidth loading={busy} onClick={() => void pay()}>
        <CreditCard size={17} aria-hidden /> {t('payment.payNow')}
      </Button>
    </Card>
  );
}
