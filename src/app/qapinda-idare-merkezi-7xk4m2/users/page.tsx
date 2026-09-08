'use client';

/**
 * Users.
 *
 * The most important control here is REVIEW_REQUIRED, not the ban button. When
 * the anti-fraud signals fire — the same device across several phone numbers,
 * the same address claiming a first-order coupon repeatedly — the right answer
 * is a person looking at it, not an automatic ban on someone who shares a flat
 * with their brother.
 *
 * Both actions on this screen — status and role — take a written reason and
 * land in the audit log. Nothing here is a toggle: changing what an account may
 * do is exactly the kind of thing somebody has to be able to explain later.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { PhoneCall, ShieldAlert, ShieldCheck, Ticket, UserCog } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Tabs,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { userTone, when } from '@/components/panel/status';
import {
  GrantCouponDialog,
  type GrantCouponTarget,
} from '@/components/panel/GrantCouponDialog';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Input, Loading, Select, Textarea, cn } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { changeUserPhone, setUserRole, setUserStatus } from '@/firebase/callables';
import { list, matches, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { AccountStatus, RESTAURANT_SCOPED_ROLES, RestaurantStatus, UserRole } from '@/shared/enums';
import { watchRestaurantDirectory } from '@/services/catalog';
import type { Restaurant, User } from '@/shared/models';
import { formatPhone } from '@/shared/phone';
import { formatMoney } from '@/shared/pricing';

type Action = 'status' | 'role' | 'phone';

/**
 * How the roster is ordered.
 *
 * Newest first is the landing order and stays the default: the question an
 * admin opens this page with is almost always about somebody who signed up or
 * complained today. The other two answer a different question — "who are my
 * best customers" — which is what the coupon button is for, and which was
 * unanswerable before the order counters existed.
 *
 * All three sort what is already on screen. That is honest for the first two
 * hundred accounts and stops being honest after that; the note by the sort
 * control says so rather than letting a page of two hundred look like the whole
 * platform.
 */
type Sort = 'NEWEST' | 'ORDERS' | 'SPEND';
type Tab = 'ACTIVE' | 'REVIEW_REQUIRED' | 'SUSPENDED' | 'ALL';

/** Exactly the four the callable accepts; the rest are reached by other flows. */
const SETTABLE_STATUSES = [
  AccountStatus.ACTIVE,
  AccountStatus.REVIEW_REQUIRED,
  AccountStatus.SUSPENDED,
  AccountStatus.BANNED,
] as const;

const ASSIGNABLE_ROLES = [
  UserRole.CUSTOMER,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.RESTAURANT_STAFF,
  // The courier was missing here and on the server, which is why the platform
  // had none: only a restaurant owner could create one, and every restaurant on
  // this platform is set up by an admin first.
  UserRole.RESTAURANT_COURIER,
  UserRole.OPERATOR,
  UserRole.SUPER_ADMIN,
] as const;

export default function AdminUsersRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminUsersPage />
    </Suspense>
  );
}

function AdminUsersPage() {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();
  const { firebaseUser } = useAuth();

  const [users, setUsers] = useState<User[] | null>(null);
  // A refused subscription is not an empty platform, and the difference
  // decides whether somebody starts looking for the bug or for the customer.
  const [loadError, setLoadError] = useState<string | null>(null);
  // ACTIVE is the honest landing tab — it is what "users" means to whoever
  // opened the page. The count on REVIEW_REQUIRED is what pulls them over.
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('NEWEST');
  /** The new number being typed into the phone dialog. */
  const [phone, setPhone] = useState('');
  const [detail, setDetail] = useState<User | null>(null);
  const [dialog, setDialog] = useState<{ user: User; action: Action } | null>(null);
  const [status, setStatus] = useState<string>(AccountStatus.REVIEW_REQUIRED);
  const [role, setRole] = useState<string>(UserRole.CUSTOMER);
  const [restaurantId, setRestaurantId] = useState('');
  /**
   * The restaurants to choose from, live.
   *
   * `null` while the first snapshot is in flight, which is not the same as an
   * empty platform — the select says "loading" rather than "no restaurants",
   * because the second reads as a broken screen.
   */
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    The customer a personal coupon is being written for.
    
    Null when the dialog is shut. Kept as the whole user rather than a uid so
    the dialog can print the phone and the short name without a second lookup.
  */
  const [couponFor, setCouponFor] = useState<GrantCouponTarget | null>(null);

  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorTerm, setOperatorTerm] = useState('');
  const [operatorUid, setOperatorUid] = useState<string | null>(null);
  const [operatorReason, setOperatorReason] = useState('');
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [operatorError, setOperatorError] = useState<string | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    return onSnapshot(
      query(collection(db, COLLECTIONS.users), orderBy('createdAt', 'desc'), limit(200)),
      (snapshot) => {
        setUsers(snapshot.docs.map((entry) => entry.data() as User));
        setLoadError(null);
      },
      () => {
        setUsers([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [t]);

  const counts = useMemo(() => {
    const all = users ?? [];
    return {
      ACTIVE: all.filter((user) => user.accountStatus === AccountStatus.ACTIVE).length,
      REVIEW_REQUIRED: all.filter(
        (user) => user.accountStatus === AccountStatus.REVIEW_REQUIRED,
      ).length,
      SUSPENDED: all.filter((user) => user.accountStatus === AccountStatus.SUSPENDED).length,
    } as Partial<Record<Tab, number>>;
  }, [users]);

  const rows = useMemo(() => {
    if (!users) return null;
    const needle = term.trim().toLowerCase();

    const filtered = users
      .filter((user) => tab === 'ALL' || user.accountStatus === tab)
      .filter((user) => matches(needle, user.fullName, user.phone, user.email));

    if (sort === 'NEWEST') return filtered;

    /*
     * A missing counter reads as zero, not as "unknown".
     *
     * Every account created before the counters existed has no value at all
     * until `backfillCustomerCounters` has run. Sorting those to the bottom is
     * the honest answer — they have no *known* orders — and it is also the one
     * that makes the backfill's effect visible when it does run.
     *
     * `slice()` first: `sort` mutates, and mutating the array a `useMemo`
     * derived from `users` would reorder the listener's own snapshot.
     */
    const value = (user: User) =>
      sort === 'ORDERS' ? (user.completedOrderCount ?? 0) : (user.totalSpent ?? 0);

    return filtered.slice().sort((a, b) => value(b) - value(a));
  }, [users, tab, term, sort]);

  const open = (user: User, action: Action) => {
    setError(null);
    setReason('');
    // The pre-selection is the move an operator almost always wants: pause a
    // healthy account for review, or put a paused one back.
    setStatus(
      user.accountStatus === AccountStatus.ACTIVE
        ? AccountStatus.REVIEW_REQUIRED
        : AccountStatus.ACTIVE,
    );
    setRole(user.role);
    setRestaurantId(user.restaurantId ?? '');
    // Starts empty rather than pre-filled with the current number: this dialog
    // replaces an identity, and a pre-filled field is one stray keystroke away
    // from replacing it with something almost right.
    setPhone('');
    setDialog({ user, action });
  };

  /*
   * Subscribed only while the role dialog is open.
   *
   * A listener held for the whole visit would stream every restaurant document
   * at every admin who opened the user list — a screen that mostly does not
   * mention restaurants at all. Opening the dialog is the moment the answer is
   * needed, and closing it is the moment it stops being.
   */
  const pickingRestaurant = dialog?.action === 'role';

  useEffect(() => {
    if (!pickingRestaurant) return;
    return watchRestaurantDirectory(setRestaurants);
  }, [pickingRestaurant]);

  // The scoped list, so a courier is asked which restaurant it drives for —
  // `RESTAURANT_ROLES` deliberately excludes couriers from the roles that may
  // ACT for a shop, which is a different question from belonging to one.
  const needsRestaurant = RESTAURANT_SCOPED_ROLES.includes(role as UserRole);
  const reasonValid = reason.trim().length >= 10;
  const roleValid = !needsRestaurant || restaurantId.trim().length > 0;
  const dangerous = status === AccountStatus.SUSPENDED || status === AccountStatus.BANNED;
  // Loose on purpose — the server normalises and validates the real shape. This
  // only stops the confirm button firing on an obviously empty field.
  const phoneValid = phone.replace(/\D/g, '').length >= 9;

  const run = async () => {
    if (!dialog) return;

    setBusy(true);
    setError(null);

    const { user, action } = dialog;
    const result =
      action === 'phone'
      ? await changeUserPhone({ uid: user.uid, phone: phone.trim(), reason })
      : action === 'status'
        ? await setUserStatus({ uid: user.uid, status, reason })
        : await setUserRole({
            uid: user.uid,
            role,
            // The callable rejects a restaurant id on a platform role and
            // demands one on a restaurant role, so send null rather than ''.
            restaurantId: needsRestaurant ? restaurantId.trim() : null,
            reason,
          });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    /*
     * The half-applied case gets its own sentence.
     *
     * `changeUserPhone` writes Firestore first and Firebase Auth second, and
     * only the second one decides whether a person can actually receive a
     * sign-in code. If it did not land, telling the admin "done" would send
     * them away believing they had fixed an account they had not.
     */
    if (
      action === 'phone' &&
      (result.data as { authUpdated?: boolean } | null)?.authUpdated === false
    ) {
      setError(t('admin.phoneMovedPartly'));
      return;
    }

    /*
     * The same half-applied case, for a status change.
     *
     * The account's status HAS changed and every callable already refuses it —
     * but the sign-in block did not go on, so the person can still open the
     * app. Saying "done" here would be true about the half that matters least.
     */
    if (
      action === 'status' &&
      (result.data as { authUpdated?: boolean } | null)?.authUpdated === false
    ) {
      setError(t('admin.statusChangedPartly'));
      return;
    }

    toast.show(t(`admin.done_user_${action}`));
    setDialog(null);
    setReason('');
    setPhone('');
  };

  // The whole roster is already in memory for the table, so promoting somebody
  // is a filter over what is on screen rather than another lookup by phone.
  const operatorCandidates = useMemo(() => {
    const needle = operatorTerm.trim().toLowerCase();
    return (users ?? [])
      .filter((user) => user.uid !== firebaseUser?.uid)
      .filter((user) => matches(needle, user.fullName, user.phone, user.email))
      .slice(0, 8);
  }, [users, operatorTerm, firebaseUser?.uid]);

  const operatorTarget = useMemo(
    () => (users ?? []).find((user) => user.uid === operatorUid) ?? null,
    [users, operatorUid],
  );

  const operatorReasonValid = operatorReason.trim().length >= 10;

  const openOperator = () => {
    setOperatorTerm('');
    setOperatorUid(null);
    setOperatorReason('');
    setOperatorError(null);
    setOperatorOpen(true);
  };

  const runOperator = async () => {
    if (!operatorTarget) return;

    setOperatorBusy(true);
    setOperatorError(null);

    const result = await setUserRole({
      uid: operatorTarget.uid,
      role: UserRole.OPERATOR,
      // OPERATOR is a platform role, and the callable refuses a restaurant id
      // on one. Somebody promoted out of a restaurant loses that link here.
      restaurantId: null,
      reason: operatorReason,
    });

    setOperatorBusy(false);

    if (!result.ok) {
      setOperatorError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('admin.done_operator'));
    setOperatorOpen(false);
  };

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('auth.fullName'),
      cell: (user) => (
        <span className="block">
          <span className="block font-medium text-ink-900">{user.fullName}</span>
          {user.email && <span className="block text-xs text-ink-400">{user.email}</span>}
        </span>
      ),
      sortValue: (user) => text(user.fullName),
    },
    {
      key: 'phone',
      header: t('auth.phone'),
      cell: (user) => <span className="tabular-nums text-ink-700">{formatPhone(user.phone)}</span>,
      sortValue: (user) => text(user.phone),
    },
    {
      key: 'role',
      header: t('admin.role'),
      cell: (user) => (
        <span className={user.role === UserRole.CUSTOMER ? 'text-ink-500' : 'text-ink-900'}>
          {t(`roles.${user.role}`)}
        </span>
      ),
      sortValue: (user) => user.role,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (user) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={userTone(user.accountStatus)}>
            {t(`status.${user.accountStatus}`)}
          </StatusBadge>
          {list(user.riskFlags).length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <ShieldAlert size={13} />
              {list(user.riskFlags).length}
            </span>
          )}
        </span>
      ),
      sortValue: (user) => user.accountStatus,
    },
    {
      /*
       * What this customer is worth, at a glance.
       *
       * Two figures in one cell rather than two columns: the table already
       * carries six, and "eleven orders" and "142 manat" are read together or
       * not at all. A customer with no orders shows a dash rather than a zero —
       * the difference between "never ordered" and "ordered nothing" is a real
       * one on a screen whose next control writes them a coupon.
       */
      key: 'orders',
      header: t('admin.ordersCount'),
      align: 'right' as const,
      cell: (user: User) => {
        const count = user.completedOrderCount ?? 0;
        if (count === 0) return <span className="text-ink-300">-</span>;
        return (
          <span className="block tabular-nums">
            <span className="block font-medium text-ink-900">{count}</span>
            <span className="block text-xs text-ink-400">
              {formatMoney(user.totalSpent ?? 0, 'AZN')}
            </span>
          </span>
        );
      },
      sortValue: (user: User) => user.completedOrderCount ?? 0,
    },
    {
      key: 'joined',
      header: t('admin.joined'),
      align: 'right',
      cell: (user) => <span className="text-xs text-ink-500">{when(user.createdAt)}</span>,
      sortValue: (user) => user.createdAt?.toMillis?.() ?? 0,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (user) => (
        <span className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          {/* The callable refuses self-edits outright; offering the buttons
              would only produce a confusing FORBIDDEN. */}
          {/* A coupon is not an edit to the account, so it is offered for
              every customer including the admin's own row. */}
          {user.role === UserRole.CUSTOMER && (
            <Button
              size="sm"
              variant="secondary"
              title={t('admin.grantCoupon')}
              aria-label={t('admin.grantCoupon')}
              onClick={() =>
                setCouponFor({ uid: user.uid, phone: user.phone, fullName: user.fullName })
              }
            >
              <Ticket size={15} />
            </Button>
          )}
          {user.uid !== firebaseUser?.uid && (
            <>
              <Button size="sm" variant="secondary" onClick={() => open(user, 'role')}>
                <UserCog size={15} />
              </Button>
              {/* "I lost my number." With sign-in being a code to that number
                  and nothing else, this is the only way back into an account —
                  see `changeUserPhone` for why it is not offered to the
                  customer themselves. */}
              <Button
                size="sm"
                variant="secondary"
                title={t('admin.changePhone')}
                aria-label={t('admin.changePhone')}
                onClick={() => open(user, 'phone')}
              >
                <PhoneCall size={15} />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => open(user, 'status')}>
                {t('admin.changeStatus')}
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('nav.users')}
        subtitle={t('admin.usersSubtitle')}
        actions={
          <Button size="sm" onClick={openOperator}>
            <ShieldCheck size={15} /> {t('admin.addOperator')}
          </Button>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'ACTIVE', label: t('status.ACTIVE') },
          { value: 'REVIEW_REQUIRED', label: t('status.REVIEW_REQUIRED') },
          { value: 'SUSPENDED', label: t('status.SUSPENDED') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('search.hintUsers')} />
        {/*
          Sorting the two hundred rows that are on screen, not the platform.
          Said plainly in the hint rather than left for somebody to discover the
          day the roster outgrows the page and the "best customer" is one who
          simply signed up recently.
        */}
        <Select
          aria-label={t('admin.sortBy')}
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          hint={sort === 'NEWEST' ? undefined : t('admin.sortScopeHint')}
        >
          <option value="NEWEST">{t('admin.sortNewest')}</option>
          <option value="ORDERS">{t('admin.sortOrders')}</option>
          <option value="SPEND">{t('admin.sortSpend')}</option>
        </Select>
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(user) => user.uid}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noUsers')}
      />

      {/* --- Detail ---------------------------------------------------- */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.fullName ?? ''}
        subtitle={detail ? t(`roles.${detail.role}`) : undefined}
      >
        {detail && (
          <div className="space-y-4">
            <StatusBadge tone={userTone(detail.accountStatus)}>
              {t(`status.${detail.accountStatus}`)}
            </StatusBadge>

            <Card className="px-4 py-2">
              <Field label={t('auth.phone')}>{formatPhone(detail.phone)}</Field>
              <Field label={t('auth.email')}>{detail.email ?? '—'}</Field>
              <Field label={t('admin.role')}>{t(`roles.${detail.role}`)}</Field>
              <Field label={t('admin.joined')}>{when(detail.createdAt)}</Field>
            </Card>

            {detail.role === UserRole.CUSTOMER && (
              <Button
                variant="secondary"
                fullWidth
                onClick={() =>
                  setCouponFor({
                    uid: detail.uid,
                    phone: detail.phone,
                    fullName: detail.fullName,
                  })
                }
              >
                <Ticket size={15} /> {t('admin.grantCoupon')}
              </Button>
            )}

            {list<string>(detail.riskFlags).length > 0 && (
              <Card className="px-4 py-2">
                <Field label={t('admin.riskFlags')}>
                  {list<string>(detail.riskFlags).join(', ')}
                </Field>
              </Card>
            )}

            <p className="text-xs text-ink-400">{t('admin.reviewExplainer')}</p>
          </div>
        )}
      </Drawer>

      {/* --- A personal coupon for one customer ------------------------ */}
      <GrantCouponDialog
        target={couponFor}
        onClose={() => setCouponFor(null)}
        onGranted={(code) => toast.show(t('admin.done_coupon_granted', { code }))}
      />

      {/* --- Action --------------------------------------------------- */}
      <ConfirmDialog
        open={Boolean(dialog)}
        title={
          dialog
            ? t(
                dialog.action === 'role'
                  ? 'admin.changeRole'
                  : dialog.action === 'phone'
                    ? 'admin.changePhone'
                    : 'admin.changeStatus',
              )
            : ''
        }
        body={
          dialog
            ? t(`admin.warn_user_${dialog.action}`, { name: dialog.user.fullName })
            : ''
        }
        confirmLabel={t('common.confirm')}
        tone={
          dialog?.action === 'phone' || (dialog?.action === 'status' && dangerous)
            ? 'danger'
            : 'primary'
        }
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (!reasonValid) return;
          if (dialog?.action === 'role' && !roleValid) return;
          if (dialog?.action === 'phone' && !phoneValid) return;
          void run();
        }}
      >
        {dialog?.action === 'status' && (
          <Select
            label={t('admin.newStatus')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {SETTABLE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {t(`status.${option}`)}
              </option>
            ))}
          </Select>
        )}

        {dialog?.action === 'role' && (
          <Select
            label={t('admin.newRole')}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {t(`roles.${option}`)}
              </option>
            ))}
          </Select>
        )}

        {dialog?.action === 'phone' && (
          <>
            <Alert tone="warning">{t('admin.changePhoneWarning')}</Alert>
            <Input
              label={t('admin.newPhone')}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+994 50 123 45 67"
              hint={t('admin.newPhoneHint')}
            />
          </>
        )}

        {/*
          THE RESTAURANT IS CHOSEN, NOT TYPED.

          This was a text box for a document id, and a document id is not
          something a person knows. It had to be copied from another screen, and
          a single wrong character attaches a manager to somebody else's
          restaurant — a mistake with no error message, because the id is
          well-formed and the account is created exactly as asked. The list is
          live, so a restaurant approved a minute ago is already in it.

          The id the account already carries is kept as a last option even when
          it is not in the list: a restaurant beyond the five hundred loaded, or
          one since removed, must still be visible rather than silently
          replaced by whatever sits at the top of the menu.
        */}
        {dialog?.action === 'role' && needsRestaurant && (
          <Select
            label={t('admin.roleRestaurant')}
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
            hint={t('admin.roleRestaurantHint')}
          >
            <option value="">
              {restaurants === null ? t('common.loading') : t('admin.roleRestaurantPick')}
            </option>
            {(restaurants ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.status !== RestaurantStatus.ACTIVE
                  ? ` · ${t(`status.${option.status}`)}`
                  : ''}
              </option>
            ))}
            {restaurantId && !(restaurants ?? []).some((one) => one.id === restaurantId) && (
              <option value={restaurantId}>{restaurantId}</option>
            )}
          </Select>
        )}

        <Textarea
          label={t('admin.reasonRequired')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          hint={t('admin.reasonAudited')}
        />

        {!reasonValid && <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>}

        {dialog?.action === 'status' && status === AccountStatus.REVIEW_REQUIRED && (
          <Alert tone="info">{t('admin.reviewExplainer')}</Alert>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>

      {/* --- Promote to operator --------------------------------------- */}
      <Drawer
        open={operatorOpen}
        onClose={() => setOperatorOpen(false)}
        title={t('admin.addOperator')}
        subtitle={t('admin.addOperatorSubtitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOperatorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={operatorBusy}
              disabled={!operatorTarget || !operatorReasonValid}
              onClick={() => void runOperator()}
            >
              {t('admin.addOperator')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* An operator can read every restaurant's support thread and act on
              complaints. Saying so before the promotion is cheaper than
              discovering it afterwards. */}
          <Alert tone="warning">{t('admin.operatorPowerWarning')}</Alert>

          <SearchInput
            value={operatorTerm}
            onChange={setOperatorTerm}
            placeholder={t('search.hintUsers')}
          />

          {operatorCandidates.length === 0 ? (
            <p className="text-sm text-ink-400">{t('admin.operatorNoMatch')}</p>
          ) : (
            <ul className="space-y-1.5">
              {operatorCandidates.map((candidate) => {
                const selected = candidate.uid === operatorUid;
                return (
                  <li key={candidate.uid}>
                    <button
                      type="button"
                      onClick={() => setOperatorUid(candidate.uid)}
                      aria-pressed={selected}
                      className={cn(
                        'w-full rounded-xl border px-3.5 py-2.5 text-left transition',
                        selected
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-ink-200 bg-white hover:bg-ink-50',
                      )}
                    >
                      <span className="block font-medium text-ink-900">{candidate.fullName}</span>
                      <span className="block text-xs text-ink-500">
                        {formatPhone(candidate.phone)} · {t(`roles.${candidate.role}`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Somebody who runs a restaurant cannot also moderate the platform
              that rates it — the callable drops the restaurant link, and the
              admin should know that before confirming, not after. */}
          {operatorTarget && RESTAURANT_SCOPED_ROLES.includes(operatorTarget.role) && (
            <Alert tone="warning">
              {t('admin.operatorLeavesRestaurant', { name: operatorTarget.fullName })}
            </Alert>
          )}

          <Textarea
            label={t('admin.reasonRequired')}
            value={operatorReason}
            onChange={(event) => setOperatorReason(event.target.value)}
            maxLength={300}
            hint={t('admin.reasonAudited')}
          />

          {!operatorReasonValid && (
            <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>
          )}

          {operatorError && <Alert tone="danger">{operatorError}</Alert>}
        </div>
      </Drawer>
    </PanelShell>
  );
}
