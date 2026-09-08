'use client';

/**
 * The first question the shopfront asks.
 *
 * A food app is useless until it knows which city you are in, and the fastest
 * honest way to learn that is to ask the phone. But a browser gives you exactly
 * one chance at the location prompt: if it appears unexplained the moment the
 * page loads, most people tap "Block", and that decision is permanent and
 * silent — from then on detection can never work again for that person.
 *
 * So this card explains first, and the browser's own prompt only appears after
 * a deliberate tap. Declining costs nothing: the second button opens the city
 * list, which is the same list they would have used anyway.
 *
 * It shows once. Choosing a city — by either route — stores the choice, and
 * this card never appears again.
 */

import { useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';

import { RegionSheet } from '@/components/customer/RegionPicker';
import { Alert, Button, Card } from '@/components/ui';
import { useRegion } from '@/contexts/RegionContext';
import { useT } from '@/i18n';

export function LocationPrompt() {
  const t = useT();
  const { chosen, detect, detecting } = useRegion();

  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (chosen || dismissed) return null;

  const findMe = async () => {
    setNotice(null);
    const outcome = await detect();

    // A successful detection has already stored the city, which flips `chosen`
    // and unmounts this card. Only the failures need saying out loud.
    if (outcome.ok) return;

    setNotice(
      outcome.reason === 'out-of-range'
        ? t('region.outOfRange')
        : outcome.reason === 'unsupported'
          ? t('region.unsupported')
          : t('region.denied'),
    );
  };

  return (
    <>
      <Card className="mb-6 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <MapPin size={20} aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink-900">{t('region.promptTitle')}</p>
            <p className="mt-1 text-sm text-ink-500">{t('region.promptBody')}</p>

            {notice && (
              <div className="mt-3">
                <Alert tone="warning">{notice}</Alert>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button loading={detecting} onClick={() => void findMe()}>
                <LocateFixed size={17} aria-hidden /> {t('region.detect')}
              </Button>

              <Button variant="secondary" onClick={() => setPicking(true)}>
                {t('region.chooseManually')}
              </Button>
            </div>

            {/* Neither button is compulsory: somebody who wants to look around
                first should be able to, and Bakı is the sensible default. */}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="mt-3 rounded px-1 text-sm text-ink-400 underline transition hover:text-ink-700"
            >
              {t('region.later')}
            </button>
          </div>
        </div>
      </Card>

      <RegionSheet
        open={picking}
        onClose={() => {
          // Closing without choosing still counts as an answer for this visit —
          // the card has been seen, and repeating it would nag.
          setPicking(false);
          setDismissed(true);
        }}
      />
    </>
  );
}
