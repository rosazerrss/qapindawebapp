'use client';

/**
 * Rebuilds every dish's search index.
 *
 * WHY THERE IS A BUTTON FOR THIS AT ALL
 * -------------------------------------
 * A dish is indexed when it is saved, so the catalogue keeps itself up to date
 * and nothing here is needed in normal operation. What is needed is a way to
 * run the indexer over menus that were saved BEFORE the indexer changed — and
 * it has changed: search now stores prefixes, so that three typed letters find
 * a dish, and the restaurant's own name, so that searching for the sign above
 * the door finds what is sold under it.
 *
 * A menu written under the old scheme carries neither. It is not broken; it is
 * simply findable only by whole words, which is the behaviour the customer was
 * complaining about. Until this is pressed once, the search fix applies to
 * dishes saved from now on and to nothing else.
 *
 * WHY IT IS NOT A SCHEDULED JOB
 * -----------------------------
 * It is a one-off after a deploy, not a thing that needs doing every night, and
 * a nightly job that rewrites every product document on the platform is a bill
 * with no purpose. Pressing it twice is harmless — the tokens are derived from
 * the dish, never accumulated — so there is no danger in an owner who is unsure
 * whether they already did.
 */

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Alert, Button } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { backfillProductSearch } from '@/firebase/callables';

/** A stop, so a bug in the cursor cannot become an endless loop of calls. */
const MAX_PAGES = 200;

export function SearchBackfill() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ scanned: number; updated: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * ONE PRESS, EVERY DISH.
   *
   * The callable answers one page and says where it stopped; this walks the
   * pages until it says there are none left. It used to be a single call, which
   * covered the first two thousand dishes and silently left the rest — and
   * still reported "done", because from one call's point of view it was.
   *
   * The running total is shown as it goes rather than at the end, because a
   * catalogue of several thousand dishes takes long enough that a button which
   * only spins looks like a button that has hung.
   */
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    setFinished(false);

    let after: string | null = null;
    let scanned = 0;
    let updated = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await backfillProductSearch(after);

      if (!result.ok || !result.data) {
        setBusy(false);
        setError(translateError(t, result.errorCode, result.errorDetail));
        // What it managed before failing stays on screen, and pressing again
        // starts from the beginning — which is safe, because the tokens are
        // derived from the dish rather than accumulated on it.
        setDone({ scanned, updated });
        return;
      }

      scanned += result.data.scanned;
      updated += result.data.updated;
      setDone({ scanned, updated });

      if (!result.data.more) break;
      after = result.data.last;
    }

    setBusy(false);
    setFinished(true);
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900">{t('admin.searchRebuild')}</h3>
        <p className="mt-0.5 text-sm text-ink-500">{t('admin.searchRebuildHint')}</p>
      </div>

      <Button variant="secondary" loading={busy} onClick={run}>
        <RefreshCw size={16} aria-hidden />
        {t('admin.searchRebuildRun')}
      </Button>

      {/* The count, because "done" on a job that touched nothing looks exactly
          like "done" on a job that reindexed the whole catalogue. */}
      {done && (
        <Alert tone={finished ? 'success' : 'info'}>
          {t('admin.searchRebuildDone', { scanned: done.scanned, updated: done.updated })}
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
