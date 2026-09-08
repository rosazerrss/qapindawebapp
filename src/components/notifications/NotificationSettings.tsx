'use client';

/**
 * The notification settings, for whoever is signed in.
 *
 * WHERE THIS IS ALLOWED TO APPEAR
 * -------------------------------
 * On a page called Ayarlar → Bildirişlər, and nowhere else. Not on Hesabım, not
 * on the restaurant panel's settings sheet, not inside the bell. The owner asked
 * for that twice and the reason is the one they gave: a switch that can be
 * reached from a screen somebody is working on is a switch that gets flipped by
 * accident in the middle of a shift. The bell now carries a link to the page
 * instead, and the page is somewhere a person goes on purpose.
 *
 * WHAT IS ON THE SCREEN IS NOT DECIDED HERE
 * -----------------------------------------
 * `notificationSwitchesFor(role)` in `shared/notifications.ts` is the list of
 * rows and the cards they belong to; `mayToggleType` says whether a per-type
 * switch is this role's to set; `notificationTypeEnabled` says where each one
 * currently sits. A screen that decided any of that for itself would be the
 * second opinion this system exists to not have — the server reads the same
 * table before it writes anything, and a preference the server disagrees with
 * is not a preference, it is a lie told to the person who set it.
 *
 * EVERY SWITCH IS INDEPENDENT
 * ---------------------------
 * One row, one key, one write. Turning "sifarişiniz hazırlanır" off sends
 * `types: { ORDER_PREPARING: false }` and nothing else, and the callable lays
 * that single key over what is stored. There is no path by which one switch can
 * move another, and none of them can reach the ORDER: an order's status is
 * decided by `shared/orderState.ts`, which never reads a preference.
 *
 * WHY PERMISSION IS ASKED FOR HERE AND NOWHERE ELSE
 * ------------------------------------------------
 * A browser asks once, remembers the answer forever, and a prompt that arrives
 * before the person has any idea what it is for is answered "no". So the prompt
 * is raised by this switch, inside the click that flipped it, and the switch
 * refuses to stay on if the browser said no — a setting that claims to be on
 * while the browser is blocking it is worse than the setting being off.
 */

import { useState, useSyncExternalStore } from 'react';
import { BellOff, Send } from 'lucide-react';

import { Alert, Button, Card, Loading, Switch, cn } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale, translateError } from '@/i18n';
import { sendTestNotification, updateNotificationPrefs } from '@/firebase/callables';
import {
  pushPermission,
  pushPermissionServerSnapshot,
  requestPushPermission,
  subscribeToPushPermission,
} from '@/lib/push';
import { disablePushOnThisDevice, enablePushOnThisDevice } from '@/lib/fcm';
import { unlockNotificationSound } from '@/lib/notificationSound';
import { UserRole, type NotificationType } from '@/shared/enums';
import {
  hasPerTypeSwitches,
  mayToggleType,
  mergeNotificationPrefs,
  notificationSwitchesFor,
  notificationTypeEnabled,
  roleAudience,
  switchableTypesFor,
  type NotificationGroup,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type NotificationSwitch,
} from '@/shared/notifications';

/**
 * The three cards, in the order the owner named them.
 *
 * An emoji rather than an icon in the heading because that is what was asked
 * for, and because on a phone a coloured glyph is the thing a thumb finds
 * without reading. The icons below are still used per row, where a heading
 * emoji would be too loud fifteen times over.
 */
const GROUPS: Array<{ id: NotificationGroup; emoji: string; titleKey: string }> = [
  { id: 'general', emoji: '⚙️', titleKey: 'notifications.groupGeneral' },
  { id: 'orders', emoji: '🔔', titleKey: 'notifications.groupOrders' },
  { id: 'campaigns', emoji: '🎁', titleKey: 'notifications.groupCampaigns' },
  { id: 'sound', emoji: '🔊', titleKey: 'notifications.groupSound' },
];

export function NotificationSettings({ className }: { className?: string }) {
  const { t } = useLocale();
  const { profile, role, identityLoading } = useAuth();

  /*
   * The saved value, with whatever this screen has changed laid over it.
   *
   * Derived during render rather than copied into state on mount: the profile
   * is live, so a change saved on another device arrives here as a new profile,
   * and a copy taken once would quietly show the old answer forever.
   */
  const [pending, setPending] = useState<NotificationPrefsPatch>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushBlocked, setPushBlocked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(false);

  /*
   * The saved answer with this screen's unsaved taps laid over it, merged by
   * the same function the server merges with. One rule, one place: a screen
   * that folded the two together by hand is a second opinion about what an
   * absent field means, and that disagreement is exactly what made switching a
   * notification off look as though it had not worked.
   */
  const prefs: NotificationPrefs = mergeNotificationPrefs(
    profile?.notificationPrefs,
    pending,
    role,
  );

  /*
   * Nothing is drawn until we know WHOSE settings these are.
   *
   * `role` is CUSTOMER by default for about a round trip after sign-in, so a
   * screen that rendered straight away would show a restaurant owner the
   * customer's switches and then swap them under their finger — and a switch
   * flipped in that gap would be a write against the wrong list. `identityLoading`
   * is the exact question "do we know who this is yet", and it is false for a
   * signed-out visitor, so this cannot become a spinner nobody escapes.
   */
  const rows = notificationSwitchesFor(role);
  const perType = hasPerTypeSwitches(role);
  const audience = roleAudience(role);
  const isRestaurant = audience === 'RESTAURANT';

  /*
   * Read through a store rather than straight off `Notification`: the server
   * renders this page too, and a value that differs between the server's HTML
   * and the browser's first render is a hydration mismatch.
   */
  const permission = useSyncExternalStore(
    subscribeToPushPermission,
    pushPermission,
    pushPermissionServerSnapshot,
  );
  const canPush = permission !== 'unsupported';

  /**
   * One switch, one write.
   *
   * `key` is only used to disable the row that is in flight — the rest of the
   * screen stays live, because a person turning three switches off in a row
   * should not have to wait for each of them. A refusal puts that one switch
   * back where the server says it belongs; leaving it where the finger dragged
   * it would show a setting that is not actually in force.
   */
  const save = async (key: string, change: NotificationPrefsPatch) => {
    setPending((current) => ({
      ...current,
      ...change,
      types: { ...(current.types ?? {}), ...(change.types ?? {}) },
    }));
    setSavingKey(key);
    setError(null);

    const result = await updateNotificationPrefs(change);
    setSavingKey(null);

    if (result.ok) return;

    setPending((current) => {
      const reverted: NotificationPrefsPatch = { ...current };
      for (const field of Object.keys(change) as Array<keyof NotificationPrefsPatch>) {
        if (field === 'types') continue;
        delete reverted[field];
      }
      if (change.types) {
        const types = { ...(reverted.types ?? {}) };
        for (const type of Object.keys(change.types) as NotificationType[]) delete types[type];
        reverted.types = types;
      }
      return reverted;
    });

    // Never the raw code. `translateError` turns anything it has no sentence
    // for into the generic Azerbaijani failure and logs the code for us.
    setError(translateError(t, result.errorCode, result.errorDetail));
  };

  const togglePush = async (key: string, next: boolean) => {
    setPushBlocked(false);

    if (!next) {
      // The device is unregistered as well as the preference saved. Leaving the
      // token behind would keep a sleeping tablet ringing for somebody who has
      // just said they do not want it, and the switch would look broken in the
      // one way that is impossible to argue with.
      await disablePushOnThisDevice().catch(() => undefined);
      await save(key, { push: false });
      return;
    }

    // Asked for from inside this click, which is the only moment a browser will
    // consider it, and only when somebody has actually asked for push.
    const answer = await requestPushPermission();
    if (answer !== 'granted') {
      setPushBlocked(true);
      return;
    }

    await save(key, { push: true });

    /*
     * Now claim the device with Firebase Cloud Messaging.
     *
     * After the preference is saved, not before: if this fails — an old Safari,
     * a project with no VAPID key, a private window — the person has still
     * switched push on and still gets a banner while a tab is open, which is
     * what the setting has always meant. Background delivery is the part that
     * may be unavailable, and it fails silently for exactly that reason.
     */
    await enablePushOnThisDevice().catch(() => undefined);
  };

  /** Where one row currently sits, whatever kind of switch it is. */
  const valueOf = (row: NotificationSwitch): boolean => {
    if (row.kind === 'type' && row.type) return notificationTypeEnabled(prefs, row.type);
    if (row.kind === 'category' && row.category) return prefs[row.category];
    if (row.flag === 'push') {
      /*
       * The STORED preference, not the browser's permission.
       *
       * These used to be `&&`-ed together on the argument that a switch saying
       * "on" while the browser blocks the banner is a lie. It bought that
       * honesty at a price nobody could pay: a restaurant starts with `push`
       * on and the browser at "default", so the row read OFF while the stored
       * answer was ON — and the only thing pressing it could do was ask for
       * permission again. There was no gesture left that meant "switch it
       * off", which is precisely the complaint. So the switch shows what is
       * saved, the person can always turn it off, and the browser's refusal is
       * said in words underneath rather than by moving the control.
       */
      return prefs.push;
    }
    if (row.flag) return prefs[row.flag];
    return false;
  };

  const toggle = (row: NotificationSwitch, next: boolean) => {
    if (row.kind === 'type' && row.type) {
      void save(row.key, { types: { [row.type]: next } });
      return;
    }
    if (row.kind === 'category' && row.category) {
      void save(row.key, { [row.category]: next } as NotificationPrefsPatch);
      return;
    }
    if (row.flag === 'push') {
      void togglePush(row.key, next);
      return;
    }
    if (row.flag) void save(row.key, { [row.flag]: next } as NotificationPrefsPatch);
  };

  /**
   * Sends a real notification to this account, the long way round.
   *
   * The sound is unlocked from inside this click first: a browser will not make
   * a noise until somebody has interacted with the page, and a test that stayed
   * silent because of the autoplay policy would answer the question wrongly.
   */
  const runTest = async () => {
    unlockNotificationSound();
    setTesting(true);
    setTestSent(false);
    setError(null);

    const result = await sendTestNotification();
    setTesting(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    setTestSent(true);
  };

  if (identityLoading) {
    return (
      <div className={cn('py-10', className)}>
        <Loading label={t('common.loading')} />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {GROUPS.map((group) => {
        const inGroup = rows.filter((row) => row.group === group.id);
        if (inGroup.length === 0) return null;

        return (
          <Card key={group.id} className="overflow-hidden">
            <h3 className="flex items-center gap-2 border-b border-card-edge px-4 py-3 text-sm font-semibold text-ink-900">
              <span aria-hidden>{group.emoji}</span>
              {t(group.titleKey)}
            </h3>

            <div className="divide-y divide-row-edge">
              {inGroup.map((row) => {
                const unsupportedPush = row.flag === 'push' && !canPush;
                /*
                 * "It is on here, and the browser is still refusing it."
                 *
                 * The switch no longer hides that state by pretending to be
                 * off, so the row has to say it — otherwise somebody turns
                 * push on, sees the switch stay on, and never learns why no
                 * banner ever arrives.
                 */
                const pushNeedsPermission =
                  row.flag === 'push' && canPush && prefs.push && permission !== 'granted';
                return (
                  <Row
                    key={row.key}
                    label={t(`notifications.switch.${row.key}`)}
                    hint={
                      unsupportedPush
                        ? t('notifications.prefPushUnsupported')
                        : pushNeedsPermission
                          ? t('notifications.prefPushNeedsPermission')
                          : t(`notifications.switchHint.${row.key}`)
                    }
                    checked={valueOf(row)}
                    disabled={savingKey === row.key || unsupportedPush}
                    onChange={(next) => toggle(row, next)}
                  />
                );
              })}
            </div>

            {group.id === 'sound' && isRestaurant && (
              <div className="border-t border-card-edge p-4">
                {/* The button that answers "do notifications actually reach
                    me". It writes a real document through the real server and
                    waits for the real listener to bring it back — a mock would
                    look identical whether or not any of that works. */}
                <Button
                  variant="secondary"
                  fullWidth
                  loading={testing}
                  onClick={() => void runTest()}
                >
                  <Send size={16} aria-hidden /> {t('notifications.sendTest')}
                </Button>
                <p className="mt-2 text-sm text-ink-400">{t('notifications.sendTestHint')}</p>
                {testSent && (
                  <div className="mt-3">
                    <Alert tone="success">{t('notifications.testSent')}</Alert>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {pushBlocked && <Alert tone="warning">{t('notifications.pushDenied')}</Alert>}

      {/* The rule the whole settings design rests on, said out loud once. */}
      <p className="flex items-start gap-2 text-sm text-ink-500">
        <BellOff size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        {t('notifications.alwaysShownNote')}
      </p>

      {perType && <PerTypeCard prefs={prefs} role={role} savingKey={savingKey} onSave={save} />}

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

/**
 * The operator's and the admin's per-type list.
 *
 * Kept as its own card rather than folded into the three above because it is a
 * different kind of control: those are a handful of promises to a customer,
 * this is a queue somebody works. An operator watching the late-delivery lane
 * does not want nine hundred "new order" lines and asked to be able to say so
 * kind by kind.
 *
 * Only the types this role may actually switch are listed. A row that cannot be
 * turned off is not shown as a dead switch — it is named in the note above,
 * which is where "some of these cannot be hidden" belongs.
 */
function PerTypeCard({
  prefs,
  role,
  savingKey,
  onSave,
}: {
  prefs: NotificationPrefs;
  role: UserRole | null;
  savingKey: string | null;
  onSave: (key: string, change: Partial<NotificationPrefs>) => Promise<void>;
}) {
  const { t } = useLocale();

  const types = switchableTypesFor(role).filter((type) => mayToggleType(role, type));
  if (types.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-card-edge px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-900">{t('notifications.perTypeTitle')}</h3>
        <p className="mt-1 text-sm text-ink-500">{t('notifications.perTypeHint')}</p>
      </div>

      <div className="divide-y divide-row-edge">
        {types.map((type) => (
          <Row
            key={type}
            label={t(`notifications.${type}.title`)}
            hint={t('notifications.perTypeRowHint')}
            checked={notificationTypeEnabled(prefs, type)}
            disabled={savingKey === type}
            onChange={(next) => void onSave(type, { types: { [type]: next } })}
          />
        ))}
      </div>
    </Card>
  );
}

/** One line: what it is, what it does, and the switch. 44px minimum. */
function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-ink-800">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-ink-400">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}
