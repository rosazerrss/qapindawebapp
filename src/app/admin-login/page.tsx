'use client';

/**
 * The one-time door to the admin panel.
 *
 * There is no "admin password" in Qapında, and there should not be — a password
 * that grants the whole platform is a password worth stealing. Instead:
 *
 *  1. You sign in like anyone else, with your phone.
 *  2. You come here once and paste a secret that exists only in the server's
 *     environment. Nobody can read it from the browser, the database, or this
 *     source code.
 *  3. The server checks it, makes *your account* the super admin, and refuses
 *     forever after — the function will not create a second super admin.
 *
 * After that the secret is dead weight and should be deleted from the server.
 * From then on, admins are made by admins, in the panel, with an audit entry.
 *
 * The page is deliberately unlinked from everywhere else. It is not a secret in
 * the security sense — the secret is the secret — it is simply not a door
 * customers should ever walk past.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';

import Link from 'next/link';

import { Alert, Button, Card, Input, Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { bootstrapSuperAdmin } from '@/firebase/callables';
import { UserRole } from '@/shared/enums';
import { isPlatformRole, platformHome } from '@/shared/permissions';

export default function AdminBootstrapPage() {
  const t = useT();
  const router = useRouter();
  const { firebaseUser, profile, role, loading, identityLoading, needsRegistration, refreshClaims } =
    useAuth();

  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) router.replace('/login?next=/admin-login');
  }, [loading, firebaseUser, router]);

  // Waits for the ROLE as well: the `isPlatformRole` test below is read off it,
  // and until it lands every account looks like a customer.
  if (loading || identityLoading || !firebaseUser) return <Loading />;

  // Already an admin: no reason to be here.
  if (isPlatformRole(role) && !done) {
    return (
      <Shell>
        <Alert tone="success">{t('bootstrap.alreadyAdmin')}</Alert>
        {/* An operator and a super admin are both platform accounts, and they
            work in different places. `platformHome` is the single answer to
            which, so this door and the admin shell can never disagree. */}
        <Button className="mt-4" fullWidth onClick={() => router.replace(platformHome(role))}>
          {t(role === UserRole.OPERATOR ? 'bootstrap.openOperator' : 'bootstrap.openPanel')}
        </Button>
      </Shell>
    );
  }

  // The server refuses an account that has not registered yet, so say so here
  // rather than letting them paste the secret into a guaranteed failure. Only
  // on a confirmed missing profile — a profile that merely could not be READ is
  // a different fact, and telling somebody to register on the strength of it is
  // the bug this whole change exists to remove.
  if (needsRegistration || !profile) {
    return (
      <Shell>
        <Alert tone="warning">{t('bootstrap.registerFirst')}</Alert>
      </Shell>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);

    const result = await bootstrapSuperAdmin(secret.trim());

    if (!result.ok) {
      setBusy(false);
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    // The role lives in the token; without this the panel would still see a
    // customer until the token happened to refresh on its own.
    await refreshClaims();
    setBusy(false);
    setDone(true);
  };

  if (done) {
    return (
      <Shell>
        <Alert tone="success">{t('bootstrap.success')}</Alert>
        <Button className="mt-4" fullWidth onClick={() => router.replace(platformHome(role))}>
          {t('bootstrap.openPanel')}
        </Button>
        <p className="mt-4 text-sm text-ink-500">{t('bootstrap.removeSecret')}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-ink-600">{t('bootstrap.body')}</p>

      <div className="mt-5">
        <Input
          label={t('bootstrap.secret')}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="••••••••••••••••••••"
          hint={t('bootstrap.secretHint')}
        />
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Button
        className="mt-5"
        fullWidth
        loading={busy}
        disabled={secret.trim().length < 20}
        onClick={submit}
      >
        <ShieldCheck size={17} /> {t('bootstrap.submit')}
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-900 px-4 py-12">
      <Card className="w-full max-w-md p-6">
        {/* A plain link home rather than `ScreenHeader`: this page is reached
            by typing its address, so there is no history to go back through,
            and it is not inside `AppShell` — nothing has reported a pathname
            for `hasInAppHistory` to count. */}
        <Link
          href="/"
          aria-label={t('common.back')}
          className="-ml-2.5 mb-1 flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
        >
          <ArrowLeft size={19} aria-hidden />
        </Link>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-900 text-white">
          <KeyRound size={22} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink-900">{t('bootstrap.title')}</h1>
        <div className="mt-3">{children}</div>
      </Card>
    </div>
  );
}
