'use client';

/**
 * Verifying an email address with a six-digit code.
 *
 * Two steps in one sheet: the address, then the code. The address step is
 * skipped when there is already one on the account and it just needs proving.
 *
 * If the platform has no mail provider configured the server says so plainly
 * (EMAIL_SENDING_DISABLED) and this screen repeats it — better than a spinner
 * that never resolves into an email nobody sent.
 */

import { useState } from 'react';

import { useT, translateError } from '@/i18n';
import { Alert, Button, Input, Sheet } from '@/components/ui';
import { sendEmailCode, verifyEmailCode } from '@/firebase/callables';

export function EmailVerifySheet({
  open,
  onClose,
  currentEmail,
}: {
  open: boolean;
  onClose: () => void;
  currentEmail: string | null;
}) {
  const t = useT();

  const [email, setEmail] = useState(currentEmail ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);

    const result = await sendEmailCode(email.trim());
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setError(null);

    const result = await verifyEmailCode(code.trim());
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setDone(true);
    // A moment on the success state, then out — closing instantly reads as a
    // failure to anyone who blinked.
    setTimeout(onClose, 1200);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={currentEmail ? t('account.verifyEmail') : t('account.addEmail')}
      footer={
        done ? null : sent ? (
          <Button fullWidth loading={busy} disabled={code.trim().length !== 6} onClick={verify}>
            {t('auth.verify')}
          </Button>
        ) : (
          <Button fullWidth loading={busy} disabled={!email.includes('@')} onClick={send}>
            {t('account.sendEmailCode')}
          </Button>
        )
      }
    >
      {done ? (
        <Alert tone="success">{t('account.emailVerified')}</Alert>
      ) : sent ? (
        <div className="space-y-4">
          <p className="text-ink-600">{t('account.codeSentTo', { email: email.trim() })}</p>

          <Input
            label={t('auth.code')}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
          />

          <button
            onClick={() => {
              setSent(false);
              setCode('');
              setError(null);
            }}
            className="text-sm text-ink-500 underline"
          >
            {t('account.changeEmail')}
          </button>

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label={t('auth.email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            maxLength={254}
            hint={t('account.emailHint')}
          />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Sheet>
  );
}
