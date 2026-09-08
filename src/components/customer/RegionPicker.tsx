'use client';

/**
 * The city chooser.
 *
 * Search plus a list — no typing a city into a free field anywhere in the app.
 * "Yerimi tap" is offered but never auto-triggered.
 */

import { useMemo, useState } from 'react';
import { Check, LocateFixed, MapPin, Search } from 'lucide-react';

import { useRegion } from '@/contexts/RegionContext';
import { useT } from '@/i18n';
import { Alert, Button, Input, Sheet, cn } from '@/components/ui';
import { searchRegions } from '@/shared/regions';

export function RegionButton({ className }: { className?: string }) {
  const { region } = useRegion();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
          'bg-white/15 text-white hover:bg-white/25',
          className,
        )}
      >
        <MapPin size={15} />
        {region.name}
      </button>

      <RegionSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function RegionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { regionId, setRegion, detect, detecting } = useRegion();
  const [term, setTerm] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const results = useMemo(() => searchRegions(term), [term]);

  const runDetect = async () => {
    setNotice(null);
    const outcome = await detect();

    if (outcome.ok) {
      onClose();
      return;
    }

    setNotice(
      outcome.reason === 'out-of-range'
        ? t('region.outOfRange')
        : outcome.reason === 'unsupported'
          ? t('region.unsupported')
          : t('region.denied'),
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('region.title')}>
      <div className="space-y-4">
        <Button variant="secondary" fullWidth loading={detecting} onClick={runDetect}>
          <LocateFixed size={17} /> {t('region.detect')}
        </Button>

        {notice && <Alert tone="warning">{notice}</Alert>}

        <div className="relative">
          <Search
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('region.search')}
            className="pl-10"
          />
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">{t('home.noResults')}</p>
          ) : (
            results.map((region) => (
              <button
                key={region.id}
                onClick={() => {
                  setRegion(region.id);
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition',
                  regionId === region.id
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'hover:bg-ink-50',
                )}
              >
                <span className="flex-1">{region.name}</span>
                {regionId === region.id && <Check size={17} />}
              </button>
            ))
          )}
        </div>
      </div>
    </Sheet>
  );
}
