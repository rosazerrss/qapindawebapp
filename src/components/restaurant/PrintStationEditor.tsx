'use client';

/**
 * Where this restaurant's slips come out.
 *
 * WHAT THIS SCREEN CAN HONESTLY PROMISE
 * -------------------------------------
 * It decides what goes on each slip and prints them one after another. It does
 * NOT choose the printer — no web page can, on any browser, and the note at the
 * bottom of this screen says so in the restaurant's own language rather than
 * leaving them to discover it at eight on a Friday.
 *
 * The setup that makes three slips reach three machines is Chrome's
 * `--kiosk-printing`, one profile per station. That is written out on screen
 * too, because it is the difference between this feature working and this
 * feature being three dialogue boxes.
 *
 * WHY CATEGORIES AND NOT DISHES
 * -----------------------------
 * A restaurant with sixty dishes would have to tick sixty boxes, and then tick
 * one more every time it adds a dish — which nobody does, so new dishes would
 * quietly stop printing. Categories are the level the menu is already organised
 * at, and a new kebab lands on the grill slip by itself.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Alert, Button, Card, Input, Select, Switch, cn } from '@/components/ui';
import { useT } from '@/i18n';
import { firestore } from '@/firebase/client';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS } from '@/shared/collections';
import {
  MAX_PRINT_STATIONS,
  STATION_KINDS,
  STATION_NAME_MAX,
  newStationId,
  uncoveredCategoryIds,
  type PrintStation,
  type StationKind,
} from '@/shared/printStations';
import type { MenuCategory } from '@/shared/models';

export function PrintStationEditor({
  restaurantId,
  value,
  onChange,
}: {
  restaurantId: string | null;
  value: PrintStation[];
  onChange: (next: PrintStation[]) => void;
}) {
  const t = useT();
  const [categories, setCategories] = useState<MenuCategory[]>([]);

  useEffect(() => {
    const db = firestore();
    if (!db || !restaurantId) return;

    let live = true;
    void getDocs(
      query(
        collection(db, COLLECTIONS.menuCategories),
        where('restaurantId', '==', restaurantId),
        orderBy('sortOrder', 'asc'),
      ),
    )
      .then((snapshot) => {
        if (!live) return;
        setCategories(snapshot.docs.map((doc) => doc.data() as MenuCategory));
      })
      .catch(() => {
        // A menu that will not load leaves the routing controls empty rather
        // than breaking the screen: a station with no categories prints
        // everything, which is the safe answer.
      });

    return () => {
      live = false;
    };
  }, [restaurantId]);

  /**
   * The sections no slip carries.
   *
   * Empty whenever any slip is unrouted, because an unrouted slip carries
   * everything — which is the common shape and the reason most restaurants
   * never see this warning.
   */
  const uncoveredIds = uncoveredCategoryIds(
    categories.map((category) => category.id),
    value,
  );
  const uncovered = categories.filter((category) => uncoveredIds.includes(category.id));

  const patch = (id: string, values: Partial<PrintStation>) =>
    onChange(value.map((station) => (station.id === id ? { ...station, ...values } : station)));

  const add = () =>
    onChange([
      ...value,
      {
        id: newStationId(),
        name: '',
        kind: 'KITCHEN' as StationKind,
        categoryIds: [],
        /*
         * ON by default, and this matters more than it looks.
         *
         * Before stations existed, accepting an order always printed. A
         * restaurant that defines a kitchen slip and leaves this off would
         * therefore accept an order and get NO paper at all — the feature they
         * just configured would look broken in the direction that costs them a
         * meal. Somebody who genuinely wants to press the button by hand can
         * switch it off, which is a decision; silently printing nothing is not.
         */
        autoPrint: true,
      },
    ]);

  const toggleCategory = (station: PrintStation, categoryId: string) => {
    const next = station.categoryIds.includes(categoryId)
      ? station.categoryIds.filter((entry) => entry !== categoryId)
      : [...station.categoryIds, categoryId];
    patch(station.id, { categoryIds: next });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">{t('printStations.intro')}</p>

      {value.length === 0 && <Alert tone="info">{t('printStations.empty')}</Alert>}

      {/*
        Configured, but nothing prints by itself.
        
        A restaurant in this state accepts an order and gets no paper — which
        is a legitimate choice, and is also exactly what somebody who forgot
        the switch would see. Saying so is the difference between a decision
        and a bug.
      */}
      {value.length > 0 && !value.some((station) => station.autoPrint) && (
        <Alert tone="warning">{t('printStations.noneAuto')}</Alert>
      )}

      {/*
        Menu sections that would print nowhere.
        
        The one failure in this whole feature that is completely silent: route
        every slip, forget a section, and those dishes never reach the kitchen.
        Nobody finds out until a customer rings. `slipsFor` catches it at print
        time by putting the orphans on the first slip; this catches it here,
        by name, before an order is ever taken.
      */}
      {uncovered.length > 0 && (
        <Alert tone="danger">
          {t('printStations.uncovered', {
            names: uncovered.map((category) => category.name).join(', '),
          })}
        </Alert>
      )}

      {value.map((station) => (
        <Card key={station.id} className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <Input
              label={t('printStations.name')}
              value={station.name}
              onChange={(event) => patch(station.id, { name: event.target.value })}
              maxLength={STATION_NAME_MAX}
              placeholder={t('printStations.namePlaceholder')}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((entry) => entry.id !== station.id))}
              aria-label={t('common.delete')}
              className="mt-7 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-400 transition hover:bg-red-50 hover:text-danger"
            >
              <Trash2 size={17} aria-hidden />
            </button>
          </div>

          <Select
            label={t('printStations.kind')}
            value={station.kind}
            onChange={(event) => patch(station.id, { kind: event.target.value as StationKind })}
            hint={t(`printStations.kindHint.${station.kind}`)}
          >
            {STATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`printStations.kindName.${kind}`)}
              </option>
            ))}
          </Select>

          {/*
            Which parts of the menu land on this slip.

            Nothing ticked means everything, and the hint says so — the failure
            mode of "nothing ticked means nothing prints" is a cook holding an
            empty ticket, which is worse than a full one.
          */}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-700">
              {t('printStations.categories')}
            </legend>

            {categories.length === 0 ? (
              <p className="text-sm text-ink-400">{t('printStations.noCategories')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const active = station.categoryIds.includes(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => toggleCategory(station, category.id)}
                      className={cn(
                        'min-h-11 rounded-xl border px-3 py-2 text-sm transition',
                        active
                          ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                          : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
                      )}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-2 text-sm text-ink-400">
              {station.categoryIds.length === 0
                ? t('printStations.categoriesAll')
                : t('printStations.categoriesSome', { count: station.categoryIds.length })}
            </p>
          </fieldset>

          <div className="flex items-center gap-3 border-t border-row-edge pt-3">
            <p className="min-w-0 flex-1 text-sm text-ink-500">{t('printStations.autoHint')}</p>
            <Switch
              checked={station.autoPrint}
              onChange={(next) => patch(station.id, { autoPrint: next })}
              label={t('printStations.auto')}
            />
          </div>
        </Card>
      ))}

      {value.length < MAX_PRINT_STATIONS && (
        <Button variant="secondary" onClick={add}>
          <Plus size={15} aria-hidden /> {t('printStations.add')}
        </Button>
      )}

      {/*
        The honest note, and the setup that makes it work.

        Not buried in a help page: a restaurant reading this screen is a
        restaurant about to buy a second printer, and finding out afterwards
        that the browser cannot address it is the worst possible moment.
      */}
      <Alert tone="info">
        <span className="block font-medium">{t('printStations.limitTitle')}</span>
        <span className="mt-1 block">{t('printStations.limitBody')}</span>
        <span className="mt-2 block font-medium">{t('printStations.kioskTitle')}</span>
        <span className="mt-1 block whitespace-pre-line">{t('printStations.kioskBody')}</span>
      </Alert>
    </div>
  );
}
