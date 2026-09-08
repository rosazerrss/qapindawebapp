'use client';

/**
 * Admin Panel → Hesab kilidləri.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * One sentence: "it says my number is already registered, and it is not."
 *
 * `phoneIndex` and `emailIndex` are what make one-person-one-account true, and
 * until this screen existed there was no way to look at either of them. When
 * one went wrong — an account deleted straight out of the Firestore console,
 * leaving its lock behind — the symptom was a customer who could not register
 * and an admin with nothing to look at.
 *
 * So the screen answers the question first and only then offers to act. The
 * check is read-only; the delete button appears only when the server has
 * already said the lock is dead.
 *
 * WHY THE BUTTON IS SOMETIMES MISSING
 * -----------------------------------
 * Because the lock is live — a real account still holds that number. The server
 * refuses to release those and this screen does not offer to ask: an admin able
 * to unhook a live number from its account could hand any customer's telephone
 * number to anybody. Unwinding a real account is the deletion flow, which needs
 * the account holder's own request first.
 */

import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Input } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import {
  inspectAccountLocks,
  releaseAccountLock,
  type AccountLockReport,
} from '@/firebase/callables';
import { ADMIN_ROOT } from '@/shared/permissions';
import { formatPhone } from '@/shared/phone';

export default function Page() {
  const t = useT();
  const toast = useToast();

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [locks, setLocks] = useState<AccountLockReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!phone.trim() && !email.trim()) {
      setError(t('admin.locksNoInput'));
      return;
    }

    setBusy(true);
    setError(null);

    const result = await inspectAccountLocks({
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });

    setBusy(false);

    if (!result.ok || !result.data) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setLocks(result.data.locks);
  }

  async function release(lock: AccountLockReport) {
    setBusy(true);
    setError(null);

    const result = await releaseAccountLock(
      lock.kind === 'PHONE' ? { phone: phone.trim() } : { email: email.trim() },
    );

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('admin.locksReleased'));
    await check();
  }

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('admin.locksTitle')}
        subtitle={t('admin.locksHint')}
        backHref={ADMIN_ROOT}
      />

      <Card className="space-y-4 p-4">
        <p className="text-sm text-ink-500">{t('admin.locksIntro')}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('admin.locksPhone')}
            name="lockPhone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+994 50 123 45 67"
            inputMode="tel"
          />
          <Input
            label={t('admin.locksEmail')}
            name="lockEmail"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ad@numune.az"
            inputMode="email"
          />
        </div>

        <Button onClick={check} loading={busy}>
          {t('admin.locksCheck')}
        </Button>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {locks?.map((lock) => (
        <LockCard
          key={`${lock.kind}:${lock.key}`}
          lock={lock}
          busy={busy}
          onRelease={() => release(lock)}
        />
      ))}
    </PanelShell>
  );
}

function LockCard({
  lock,
  busy,
  onRelease,
}: {
  lock: AccountLockReport;
  busy: boolean;
  onRelease: () => void;
}) {
  const t = useT();

  const label = lock.kind === 'PHONE' ? formatPhone(`+${lock.key}`) || lock.key : lock.key;

  if (!lock.exists) {
    return (
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-success" />
          {label}
        </div>
        <p className="text-sm text-ink-500">{t('admin.locksNoLock')}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {lock.live ? (
          <ShieldCheck className="h-4 w-4 text-success" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-warning" />
        )}
        {label}
      </div>

      <p className={lock.live ? 'text-sm text-ink-500' : 'text-sm text-warning'}>
        {lock.live ? t('admin.locksLive') : t('admin.locksStale')}
      </p>

      <dl className="grid gap-1 text-sm">
        <Row label={t('admin.locksHolder')} value={lock.holderUid ?? '—'} />
        <Row
          label={t('admin.locksAccount')}
          value={lock.holderExists ? (lock.holderStatus ?? '—') : t('admin.locksHolderMissing')}
        />
        {!lock.live ? (
          <Row
            label={t('admin.locksReason')}
            value={t(`admin.locksReason${lock.stale ?? 'NO_UID'}`)}
          />
        ) : null}
      </dl>

      {lock.live ? (
        <Alert tone="info">{t('admin.locksLiveHint')}</Alert>
      ) : (
        <>
          <Alert tone="warning">{t('admin.locksStaleHint')}</Alert>
          <Button variant="danger" onClick={onRelease} loading={busy}>
            {t('admin.locksRelease')}
          </Button>
        </>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  );
}
