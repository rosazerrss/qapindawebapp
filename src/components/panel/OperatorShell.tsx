'use client';

/**
 * The frame around an operator screen that is not the queue itself.
 *
 * The operator's main screen is four tabs in one page and carries its own
 * header, which is right for a queue: an operator lives on that screen all
 * shift and must never lose the tabs. It is the wrong shape for anything they
 * walk *into*, though — Ayarlar, and whatever else joins it — because those
 * need a way back and the tab bar is not one.
 *
 * So this is the same chrome minus the tabs, plus a ← Geri. The role check is a
 * redirect and not a security measure: every read below goes through the
 * security rules and every write through a callable that re-checks the caller,
 * so somebody who forced their way onto the URL would be looking at a page that
 * can do nothing. A SUPER_ADMIN may open it, because seeing what an operator
 * sees is the only way to support one.
 */

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { LogoMark } from '@/components/layout/Logo';
import { ToastProvider } from '@/components/panel/Toast';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { OPERATOR_ROOT } from '@/shared/permissions';
import { UserRole } from '@/shared/enums';

export function OperatorShell({
  title,
  subtitle,
  backHref,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const { firebaseUser, role, loading, identityLoading } = useAuth();

  const allowed = role === UserRole.OPERATOR || role === UserRole.SUPER_ADMIN;

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace(`/login?next=${encodeURIComponent(OPERATOR_ROOT)}`);
      return;
    }
    // `allowed` is a statement about the role, and the role is a CUSTOMER-shaped
    // guess until `identityLoading` clears. Redirecting on the guess is what
    // threw operators back to the shopfront on a cold load.
    if (identityLoading) return;
    if (!allowed) router.replace('/');
  }, [loading, identityLoading, firebaseUser, allowed, router]);

  if (loading || identityLoading || !firebaseUser || !allowed) return <PageLoading />;

  return (
    <ToastProvider>
      <div className="panel-canvas min-h-full bg-canvas">
        <header className="sticky top-0 z-30 border-b border-card-edge bg-surface">
          <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 py-3 sm:px-6">
            {/* 44px square — the operator's desk is a laptop, but the same
                control is on the phone they answer a shift change from. */}
            <Link
              href={backHref}
              aria-label={t('common.back')}
              className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
            >
              <ArrowLeft size={19} aria-hidden />
            </Link>

            <LogoMark size={22} className="shrink-0 text-brand-600" />

            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-ink-900">{title}</h1>
              {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
