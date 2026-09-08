'use client';

/**
 * Fills in the order counters for accounts that predate them.
 *
 * WHY THERE IS A BUTTON FOR THIS
 * ------------------------------
 * Every completed order now moves three fields on the customer's document —
 * how many orders they have finished, what they have spent, and when the last
 * one arrived. That is what makes "who are my best customers" a question the
 * admin roster can sort on rather than one nobody could answer.
 *
 * Those fields are written from the moment the release lands, so they are
 * correct for everything that happens afterwards and empty for everything that
 * happened before. Until this is pressed once, every existing account shows a
 * dash — which is honest (nothing is *known*) but useless.
 *
 * WHY IT PAGES, AND WHY THE PAGES ARE VISIBLE
 * -------------------------------------------
 * It walks four hundred accounts per call and reads each one's completed orders,
 * which is more work than a single callable should do in one breath. So it
 * returns a cursor and this presses again until there is nothing left, showing
 * the running total as it goes: a job that takes two minutes with no sign of
 * progress is a job somebody reloads halfway through.
 *
 * Pressing it twice is harmless. Each account is written with the value that
 * was counted, never an increment, so a second run computes the same answer and
 * stores it again.
 */

import { useState } from 'react';
import { Calculator } from 'lucide-react';

import { Alert, Button } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { backfillCustomerCounters } from '@/firebase/callables';

/** A stop, so a bug in the cursor cannot become an endless loop of calls. */
const MAX_PAGES = 200;

export function CounterBackfill() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; updated: number } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    setProgress(null);

    let after: string | null = null;
    let scanned = 0;
    let updated = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await backfillCustomerCounters(after);

      if (!result.ok || !result.data) {
        setBusy(false);
        setError(translateError(t, result.errorCode, result.errorDetail));
        // What it managed before failing is kept on screen: a run that stopped
        // three quarters of the way through has done three quarters of the work,
        // and pressing again resumes rather than repeating.
        setProgress({ scanned, updated });
        return;
      }

      scanned += result.data.scanned;
      updated += result.data.updated;
      setProgress({ scanned, updated });

      if (!result.data.more) break;
      after = result.data.last;
    }

    setBusy(false);
    setDone(true);
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900">{t('admin.counterBackfill')}</h3>
        <p className="mt-0.5 text-sm text-ink-500">{t('admin.counterBackfillHint')}</p>
      </div>

      <Button variant="secondary" loading={busy} onClick={run}>
        <Calculator size={16} aria-hidden />
        {t('admin.counterBackfillRun')}
      </Button>

      {progress && (
        <Alert tone={done ? 'success' : 'info'}>
          {t('admin.counterBackfillDone', {
            scanned: progress.scanned,
            updated: progress.updated,
          })}
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
