'use client';

/**
 * Distance bands: what delivery costs, by how far it goes.
 *
 * WHY ONE FEE IS WRONG TWICE
 * --------------------------
 * A restaurant with a five-kilometre radius and one flat fee has to price for
 * the far edge, so the flat across the road subsidises somebody's petrol eight
 * streets away — and the near customers, who order most often, are the ones
 * paying it. Bands let a kitchen say what it actually means: a manat next door,
 * two further out, and no deliveries under fifteen manats past three kilometres.
 *
 * OPTIONAL, AND EMPTY BY DEFAULT
 * ------------------------------
 * A restaurant with no bands is priced exactly as it was before — the flat fee
 * and minimum on this same page. Nothing needed migrating and nothing changes
 * until somebody presses "add". That is deliberate: this is an option for the
 * shops that want it, not a form every restaurant on the platform now has to
 * fill in before it can take an order.
 *
 * DISTANCE IN KILOMETRES, STORED IN METRES
 * ----------------------------------------
 * Nobody thinks about delivery in metres. The boxes are kilometres with one
 * decimal, converted on the way in and out, because a restaurant typing "2000"
 * where it meant "2" would price the whole city as one zone.
 *
 * The bands are validated by `checkDeliveryZones` in `shared/geo.ts` — the same
 * function the server refuses with — so a hole between 2 km and 3 km is caught
 * here, in words, rather than becoming a customer quoted a fee nobody can
 * explain.
 */

import { Plus, Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import { Alert, Button, Input, cn } from '@/components/ui';
import { checkDeliveryZones, type DeliveryZone } from '@/shared/geo';
import { formatMinorUnits, parseMajorUnits } from '@/shared/pricing';

const MAX_ZONES = 5;

/** Metres in, kilometres out — one decimal, because "2.5 km" is how people talk. */
const toKm = (metres: number): string => (metres / 1000).toFixed(1);

function fromKm(text: string): number | null {
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1000);
}

/** Money in text form, so a half-typed "1," survives a keystroke. */
function money(text: string): number | null {
  if (!text.trim()) return null;
  try {
    return parseMajorUnits(text);
  } catch {
    return null;
  }
}

export function DeliveryZoneEditor({
  zones,
  onChange,
  /** The restaurant's own radius, used to size the first band sensibly. */
  radiusMetres,
}: {
  zones: DeliveryZone[];
  onChange: (next: DeliveryZone[]) => void;
  radiusMetres: number;
}) {
  const t = useT();
  const problem = checkDeliveryZones(zones);

  const update = (index: number, patch: Partial<DeliveryZone>) => {
    onChange(zones.map((zone, at) => (at === index ? { ...zone, ...patch } : zone)));
  };

  const addZone = () => {
    /*
     * A new band starts where the last one ended.
     *
     * Which is the whole reason gaps are rare in practice: the form hands the
     * restaurant a contiguous list and it has to go out of its way to break it.
     * The first band is half the radius, because a two-band split is what
     * almost everybody wants and guessing it saves a decision.
     */
    const last = zones[zones.length - 1];
    const from = last ? last.toMetres : 0;
    const to = last
      ? Math.max(from + 1000, radiusMetres || from + 2000)
      : Math.max(1000, Math.round((radiusMetres || 4000) / 2));

    onChange([...zones, { fromMetres: from, toMetres: to, fee: 0, minOrderAmount: null }]);
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900">
          {t('restaurantPanel.zonesTitle')}
        </h3>
        <p className="mt-0.5 text-sm text-ink-500">{t('restaurantPanel.zonesHint')}</p>
      </div>

      {zones.length === 0 && (
        <p className="rounded-2xl border border-card-edge bg-subtle px-3 py-2.5 text-sm text-ink-600">
          {t('restaurantPanel.zonesNone')}
        </p>
      )}

      {zones.map((zone, index) => (
        <div
          key={index}
          className="rounded-2xl border border-card-edge bg-subtle p-3 shadow-[0_1px_2px_rgb(38_36_35/0.05)]"
        >
          <div className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <Input
                label={t('restaurantPanel.zoneFrom')}
                value={toKm(zone.fromMetres)}
                onChange={(event) => {
                  const metres = fromKm(event.target.value);
                  if (metres !== null) update(index, { fromMetres: metres });
                }}
                inputMode="decimal"
                // The first band always starts at the door. Making it editable
                // only invites a restaurant to type 0.5 and wonder why nobody
                // nearby can order.
                disabled={index === 0}
                hint={index === 0 ? t('restaurantPanel.zoneFromFixed') : undefined}
              />
              <Input
                label={t('restaurantPanel.zoneTo')}
                value={toKm(zone.toMetres)}
                onChange={(event) => {
                  const metres = fromKm(event.target.value);
                  if (metres !== null) update(index, { toMetres: metres });
                }}
                inputMode="decimal"
              />
              <Input
                label={`${t('home.deliveryFee')} (₼)`}
                value={zone.fee > 0 ? formatMinorUnits(zone.fee) : ''}
                onChange={(event) => {
                  const minor = money(event.target.value);
                  update(index, { fee: minor ?? 0 });
                }}
                inputMode="decimal"
                placeholder="0"
              />
              <Input
                label={`${t('home.minOrder')} (₼)`}
                value={zone.minOrderAmount !== null ? formatMinorUnits(zone.minOrderAmount) : ''}
                onChange={(event) => {
                  const text = event.target.value;
                  // Empty is a real answer — "use the shop's own minimum" —
                  // and it is not the same as zero, which means "no minimum".
                  update(index, { minOrderAmount: text.trim() ? (money(text) ?? 0) : null });
                }}
                inputMode="decimal"
                hint={t('restaurantPanel.zoneMinHint')}
              />
            </div>

            <button
              type="button"
              aria-label={t('restaurantPanel.zoneRemove')}
              onClick={() => onChange(zones.filter((_, at) => at !== index))}
              className={cn(
                'mt-7 rounded-xl p-2 text-ink-400 transition hover:bg-ink-100 hover:text-danger',
              )}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      ))}

      {/* The rule that is broken, named. A restaurant should not have to work
          out from a rejected save that its bands leave a hole at 2 km. */}
      {problem && <Alert tone="warning">{t(`restaurantPanel.zoneProblem.${problem}`)}</Alert>}

      {zones.length < MAX_ZONES && (
        <Button variant="secondary" fullWidth onClick={addZone}>
          <Plus size={17} /> {t('restaurantPanel.zoneAdd')}
        </Button>
      )}
    </div>
  );
}
