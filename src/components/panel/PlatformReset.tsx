'use client';

/**
 * "Platformanı sıfırla" — deleting the test data before launch.
 *
 * The owner is creating orders to try the platform out and wants them gone
 * before real customers arrive. This is the screen for that, and it is built
 * the way something that permanently deletes data has to be built:
 *
 *  - **It states what it will do, with numbers.** The counts are read from the
 *    server every time the dialog opens, so the sentence "1,204 sifariş
 *    silinəcək" is a fact about the platform right now rather than a figure
 *    cached when the page loaded.
 *  - **It states what it will NOT do.** The list of things that survive is as
 *    long as the list of things that go, and it is on screen next to it —
 *    "will my restaurants disappear?" is the question this feature raises and
 *    it should not have to be asked.
 *  - **Nothing is selected by default.** Each collection is its own switch and
 *    every one of them starts off. There is a "select all", because ten taps
 *    to do the obvious thing is its own kind of hazard, but the obvious thing
 *    is never the default.
 *  - **The platform's name has to be typed.** Not "are you sure" — a person
 *    who has read the numbers above is sure. This is the wall against the
 *    click that was meant for the button next to it.
 *
 * None of the above is what actually protects anything: the callable re-checks
 * the role, the settings flag, the typed name and every scope server-side. See
 * `functions/src/admin/reset.ts`. What this screen owes the owner is an honest
 * account of what is about to happen.
 */

import { useState } from 'react';
import { RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';

import { ConfirmDialog } from './ui';
import { useToast } from './Toast';
import { Alert, Button, Input, Spinner, Switch, cn } from '@/components/ui';
import { useT, translateError, type Translate } from '@/i18n';
import { platformResetStatus, resetPlatformData } from '@/firebase/callables';
import {
  RESET_SCOPES,
  RESET_SCOPE_TARGETS,
  ResetScope,
  normaliseConfirmation,
} from '@/shared/reset';

interface Status {
  enabled: boolean;
  platformName: string;
  counts: Record<string, number>;
  countCap: number;
  kept: string[];
}

interface Outcome {
  documentsDeleted: number;
  done: boolean;
  remaining: Record<string, number>;
}

/** "5000+" once the server stopped counting, so no figure on screen is a lie. */
function countLabel(value: number | undefined, cap: number): string {
  if (value === undefined) return '—';
  return value >= cap ? `${cap}+` : String(value);
}

/** How many documents one switch is responsible for. */
function scopeCount(scope: ResetScope, counts: Record<string, number>): number {
  return RESET_SCOPE_TARGETS[scope].reduce(
    (total, target) => total + (counts[target.collection] ?? 0),
    0,
  );
}

/** The collections behind one switch, named in the reader's own language. */
function scopeCollections(t: Translate, scope: ResetScope): string {
  return RESET_SCOPE_TARGETS[scope]
    .map((target) => t(`resetCollection.${target.collection}`))
    .join(' · ');
}

export function PlatformReset({ enabled }: { enabled: boolean }) {
  const t = useT();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<ResetScope[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  /** Counts are read on every open, never cached across one. */
  const load = () => {
    setStatus(null);
    setStatusError(null);

    void platformResetStatus().then((result) => {
      if (result.ok && result.data) {
        setStatus(result.data as Status);
        return;
      }
      setStatusError(translateError(t, result.errorCode, result.errorDetail));
    });
  };

  const start = () => {
    setScopes([]);
    setConfirmation('');
    setError(null);
    setOutcome(null);
    setOpen(true);
    load();
  };

  const toggle = (scope: ResetScope) =>
    setScopes((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope],
    );

  const platformName = status?.platformName ?? '';
  const typedCorrectly =
    platformName.length > 0 &&
    normaliseConfirmation(confirmation) === normaliseConfirmation(platformName);

  const ready = Boolean(status?.enabled) && scopes.length > 0 && typedCorrectly && !busy;

  const run = async () => {
    setBusy(true);
    setError(null);

    const result = await resetPlatformData({ scopes, confirmation });

    setBusy(false);

    if (!result.ok || !result.data) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setOutcome({
      documentsDeleted: result.data.documentsDeleted,
      done: result.data.done,
      remaining: result.data.remaining,
    });

    // A run that stopped on its budget is not a failure and must not be
    // announced as success: the figures below say what is left and the button
    // stays there to finish the job.
    toast.show(
      result.data.done
        ? t('admin.resetDone', { count: result.data.documentsDeleted })
        : t('admin.resetPartial', { count: result.data.documentsDeleted }),
      result.data.done ? 'success' : 'danger',
    );

    // Whatever happened, the counts on screen are now stale.
    load();
  };

  const selectedTotal = status
    ? scopes.reduce((total, scope) => total + scopeCount(scope, status.counts), 0)
    : 0;

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">{t('admin.resetIntro')}</p>

        {/*
          THE BUTTON IS DEAD UNTIL THE GUARD IS OPEN, AND IT SAYS SO HERE.

          It used to open regardless. The dialog then appeared with every switch
          greyed out, a "Hamısını seç" link that still looked clickable, and one
          line of explanation above them — so the honest reading from the other
          side of the screen was "the selection is broken", not "the guard is
          shut". That is exactly how it was reported.

          Refusing at the button instead is the same protection said one step
          earlier, in the place where somebody is about to press it.
        */}
        <Button variant="danger" onClick={start} disabled={!enabled}>
          <RotateCcw size={15} aria-hidden /> {t('admin.resetOpen')}
        </Button>

        {!enabled && <p className="text-sm text-ink-500">{t('admin.resetLockedHint')}</p>}
      </div>

      <ConfirmDialog
        open={open}
        title={t('admin.resetOpen')}
        body={t('admin.resetBody', { name: platformName || t('admin.resetPlatformFallback') })}
        confirmLabel={t('admin.resetConfirm')}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (!ready) return;
          void run();
        }}
      >
        {statusError ? (
          <Alert tone="danger">{statusError}</Alert>
        ) : status === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-ink-400">
            <Spinner className="h-4 w-4" /> {t('common.loading')}
          </div>
        ) : (
          <>
            {/* The production guard, said in the place where somebody would
                otherwise be wondering why the button does nothing. */}
            {!status.enabled && <Alert tone="warning">{t('admin.resetDisabled')}</Alert>}

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink-700">{t('admin.resetScopes')}</span>
              {/* Disabled with the switches, not left live above them: a link
                  that ticks boxes nobody can untick is worse than no link. */}
              <button
                type="button"
                disabled={!status.enabled || busy}
                onClick={() =>
                  setScopes((current) => (current.length === RESET_SCOPES.length ? [] : [...RESET_SCOPES]))
                }
                className="text-sm text-brand-600 underline disabled:cursor-not-allowed disabled:text-ink-300 disabled:no-underline"
              >
                {scopes.length === RESET_SCOPES.length
                  ? t('admin.resetSelectNone')
                  : t('admin.resetSelectAll')}
              </button>
            </div>

            <ul className="divide-y divide-row-edge rounded-xl border border-ink-200">
              {RESET_SCOPES.map((scope) => {
                const count = scopeCount(scope, status.counts);
                const on = scopes.includes(scope);

                return (
                  <li key={scope} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-sm font-medium',
                          on ? 'text-ink-900' : 'text-ink-600',
                        )}
                      >
                        {t(`resetScope.${scope}`)}
                      </span>
                      <span className="block text-xs text-ink-400">
                        {scopeCollections(t, scope)}
                      </span>
                    </span>

                    <span className="shrink-0 pt-0.5 text-sm tabular-nums text-ink-500">
                      {countLabel(count, status.countCap)}
                    </span>

                    <Switch
                      checked={on}
                      onChange={() => toggle(scope)}
                      disabled={!status.enabled || busy}
                      label={t(`resetScope.${scope}`)}
                    />
                  </li>
                );
              })}
            </ul>

            {/* What survives, listed as plainly as what goes. */}
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                <ShieldCheck size={15} aria-hidden /> {t('admin.resetKeptTitle')}
              </p>
              <p className="mt-1 text-xs text-ink-600">
                {status.kept.map((name) => t(`resetCollection.${name}`)).join(' · ')}
              </p>
              <p className="mt-1 text-xs text-ink-500">{t('admin.resetKeptAudit')}</p>
            </div>

            <Alert tone="danger">
              <span className="flex items-start gap-1.5">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>{t('admin.resetIrreversible', { count: selectedTotal })}</span>
              </span>
            </Alert>

            <Input
              label={t('admin.resetTypeName', { name: platformName })}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder={platformName}
              hint={t('admin.resetTypeNameHint')}
            />

            {outcome && (
              <Alert tone={outcome.done ? 'success' : 'warning'}>
                {outcome.done
                  ? t('admin.resetDone', { count: outcome.documentsDeleted })
                  : t('admin.resetPartialHint', { count: outcome.documentsDeleted })}
              </Alert>
            )}

            {error && <Alert tone="danger">{error}</Alert>}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
