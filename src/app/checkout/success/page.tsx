'use client';

/**
 * Where the bank sends the customer after a payment.
 *
 * THIS PAGE DOES NOT DECIDE ANYTHING
 * ----------------------------------
 * Landing here means the browser was redirected. It does not mean the money
 * arrived — the URL is a link, and anybody can type it. What confirms a payment
 * is Epoint's signed callback to the server, which may land before this page
 * does, or seconds after, or (if something is wrong) not at all.
 *
 * So this screen reports rather than declares: it asks the server what state
 * the payment is actually in, and says one of three honest things — it worked,
 * it did not, or we are still waiting. The third is the one most pages get
 * wrong, and it is the one that stops a customer paying twice.
 */

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button, Card } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useT } from '@/i18n';
import { paymentStatus } from '@/firebase/callables';
import { PaymentState } from '@/shared/payments';

/** How long to keep asking before telling the customer to check their orders. */
const ATTEMPTS = 6;
const GAP_MS = 2500;

function PaymentReturn() {
  const t = useT();
  const params = useSearchParams();
  const paymentId = params.get('payment');

  const [state, setState] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    // No payment id means the bank sent them here without one. There is
    // nothing to ask about, and `settled` below derives that rather than
    // setting state during the effect.
    if (!paymentId) return;

    let cancelled = false;
    let attempt = 0;

    // Polling, deliberately: the callback is a race with this page, and the
    // honest way to handle a race is to wait a little rather than to guess.
    const ask = async () => {
      const result = await paymentStatus(paymentId);
      if (cancelled) return;

      if (result.ok && result.data) {
        setState(result.data.state);
        setOrderId(result.data.orderId);

        const settled = result.data.state !== PaymentState.PENDING;
        if (settled) return;
      }

      attempt += 1;
      if (attempt >= ATTEMPTS) {
        setGaveUp(true);
        return;
      }

      window.setTimeout(() => void ask(), GAP_MS);
    };

    void ask();

    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const paid = state === PaymentState.PAID;
  const failed =
    state === PaymentState.FAILED ||
    state === PaymentState.CANCELLED ||
    state === PaymentState.EXPIRED;

  // Still asking: a state has not come back, we have not run out of tries, and
  // there is a payment to ask about at all. Derived rather than stored, so no
  // effect has to reach back and correct it.
  if (!state && !gaveUp && paymentId) {
    return <PageLoading label={t('payment.checking')} />;
  }

  const icon = paid ? CheckCircle2 : failed ? XCircle : Clock;
  const Icon = icon;

  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <span
        aria-hidden
        className={
          paid
            ? 'mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success'
            : failed
              ? 'mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger'
              : 'mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-500'
        }
      >
        <Icon size={28} />
      </span>

      <p className="mt-4 text-lg font-medium text-ink-900">
        {paid
          ? t('payment.paidTitle')
          : failed
            ? t('payment.failedTitle')
            : t('payment.pendingTitle')}
      </p>

      <p className="mt-1.5 text-sm text-ink-500">
        {paid
          ? t('payment.paidBody')
          : failed
            ? t('payment.failedBody')
            : t('payment.pendingBody')}
      </p>

      <div className="mx-auto mt-6 max-w-xs space-y-2">
        {orderId ? (
          <Link href={`/orders/${orderId}`} className="block">
            <Button fullWidth size="lg">
              {t('payment.viewOrder')}
            </Button>
          </Link>
        ) : (
          <Link href="/orders" className="block">
            <Button fullWidth size="lg">
              {t('order.myOrders')}
            </Button>
          </Link>
        )}

        <Link href="/" className="block">
          <Button fullWidth variant="secondary">
            {t('nav.home')}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

export default function PaymentReturnPage() {
  const t = useT();

  return (
    <AppShell>
      {/* A FIXED destination, not `router.back()`: the entry behind this page
          is the bank's, and sending somebody back into a payment they have
          just completed is how an order gets paid for twice. */}
      <ScreenHeader
        title={t('payment.returnTitle')}
        fallbackHref="/orders"
        backHref="/orders"
      />
      <Suspense fallback={<PageLoading />}>
        <PaymentReturn />
      </Suspense>
    </AppShell>
  );
}
