'use client';

/**
 * Staff.
 *
 * A person is added by their phone number, because that is their identity in
 * this system. They must already have a Qapında account — there is no way to
 * create one on someone else's behalf, which is exactly what "one phone, one
 * account" requires.
 *
 * Every write on this screen is the same callable: adding someone, changing
 * their role and removing them are all "this phone now holds this role". The
 * only one that cannot be walked back by re-typing a number is removal, so that
 * is the one behind a dialog.
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { UserMinus } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  ConfirmDialog,
  DataTable,
  FilterSelect,
  PageHeader,
  StatusBadge,
  type Column,
} from '@/components/panel/ui';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Select } from '@/components/ui';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { formatPhone } from '@/shared/phone';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { cancelRestaurantInvite, setRestaurantStaff } from '@/firebase/callables';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { InviteStatus, UserRole } from '@/shared/enums';
import type { RestaurantInvite, User } from '@/shared/models';

export default function StaffPage() {
  const t = useT();
  const toast = useToast();
  const { restaurantId, firebaseUser } = useAuth();

  const [staff, setStaff] = useState<User[] | null>(null);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>(UserRole.RESTAURANT_STAFF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** Offers made and not yet answered. Empty for most restaurants, most days. */
  const [invites, setInvites] = useState<RestaurantInvite[]>([]);

  useEffect(() => {
    const db = firestore();
    if (!db || !restaurantId) return;

    return onSnapshot(
      query(collection(db, COLLECTIONS.users), where('restaurantId', '==', restaurantId)),
      (snapshot) => {
        setStaff(snapshot.docs.map((entry) => entry.data() as User));
        setListError(null);
      },
      // Swallowing this is what made a permission failure look like "no staff
      // yet" — an empty table for a team that was added and is really there.
      // It has to say something, or the next person debugging it sees nothing.
      () => {
        setStaff([]);
        setListError(t('restaurantPanel.staffListFailed'));
      },
    );
  }, [restaurantId, t]);

  /*
   * The outstanding invitations.
   *
   * A separate subscription rather than a field on the staff query, because
   * these are not staff yet — that is the entire point of the flow. The
   * restaurant needs to see them or it will type the same number again next
   * week, having no idea the first offer is sitting unanswered.
   */
  useEffect(() => {
    const db = firestore();
    if (!db || !restaurantId) return;

    return onSnapshot(
      query(
        collection(db, COLLECTIONS.restaurantInvites),
        where('restaurantId', '==', restaurantId),
        where('status', '==', InviteStatus.PENDING),
      ),
      (snapshot) => setInvites(snapshot.docs.map((entry) => entry.data() as RestaurantInvite)),
      () => setInvites([]),
    );
  }, [restaurantId]);

  const withdraw = async (invite: RestaurantInvite) => {
    if (!restaurantId) return;
    setBusy(true);
    setError(null);

    const result = await cancelRestaurantInvite({ restaurantId, uid: invite.uid });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    toast.show(t('restaurantPanel.doneInviteCancelled'));
  };

  /**
   * One call for all three actions. `done` is the message to toast when the
   * write lands — the caller knows what it meant, this function does not.
   */
  const submit = async (targetPhone: string, targetRole: string, done: string) => {
    if (!restaurantId) return false;

    setBusy(true);
    setError(null);

    const result = await setRestaurantStaff({
      restaurantId,
      phone: targetPhone,
      role: targetRole,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return false;
    }

    toast.show(done);
    return true;
  };

  const add = async () => {
    // "Invitation sent", not "staff added": nothing has changed about that
    // account yet, and a toast that said otherwise would be the first lie in a
    // flow built entirely to stop people being enrolled without knowing.
    if (await submit(phone, role, t('restaurantPanel.doneInviteSent'))) setPhone('');
  };

  const remove = async () => {
    if (!removing) return;
    if (await submit(removing.phone, UserRole.CUSTOMER, t('restaurantPanel.doneStaffRemoved'))) {
      setRemoving(null);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('restaurantPanel.staffName'),
      cell: (member) => <span className="font-medium text-ink-900">{member.fullName}</span>,
      sortValue: (member) => member.fullName,
    },
    {
      key: 'phone',
      header: t('restaurantPanel.staffPhone'),
      cell: (member) => (
        <span className="tabular-nums text-ink-600">{formatPhone(member.phone)}</span>
      ),
      sortValue: (member) => member.phone,
    },
    {
      key: 'role',
      header: t('restaurantPanel.role'),
      cell: (member) =>
        // The owner's role is not editable here: there is exactly one, and the
        // person who could change it would be locking themselves out.
        member.role === UserRole.RESTAURANT_OWNER ? (
          <StatusBadge tone="progress">{t('roles.RESTAURANT_OWNER')}</StatusBadge>
        ) : (
          <FilterSelect
            value={member.role}
            label={t('restaurantPanel.changeRole')}
            onChange={(next) =>
              void submit(member.phone, next, t('restaurantPanel.doneRoleChanged'))
            }
          >
            <option value={UserRole.RESTAURANT_STAFF}>{t('restaurantPanel.roleStaff')}</option>
            <option value={UserRole.RESTAURANT_MANAGER}>{t('restaurantPanel.roleManager')}</option>
            <option value={UserRole.RESTAURANT_COURIER}>{t('restaurantPanel.roleCourier')}</option>
          </FilterSelect>
        ),
      sortValue: (member) => member.role,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (member) =>
        // Nobody can remove the owner, and nobody can remove themselves.
        member.role !== UserRole.RESTAURANT_OWNER && member.uid !== firebaseUser?.uid ? (
          <Button size="sm" variant="secondary" onClick={() => setRemoving(member)}>
            <UserMinus size={15} /> {t('restaurantPanel.removeStaff')}
          </Button>
        ) : null,
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('restaurantPanel.staffTitle')}
        subtitle={t('restaurantPanel.staffSubtitle')}
      />

      <Card className="mb-5 p-4">
        <h2 className="mb-3 font-medium text-ink-900">{t('restaurantPanel.addStaff')}</h2>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <PhoneInput
            label={t('restaurantPanel.staffPhone')}
            value={phone}
            onChange={setPhone}
            className="sm:flex-1"
          />
          <Select
            label={t('restaurantPanel.role')}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="sm:w-48"
          >
            <option value={UserRole.RESTAURANT_STAFF}>{t('restaurantPanel.roleStaff')}</option>
            <option value={UserRole.RESTAURANT_MANAGER}>{t('restaurantPanel.roleManager')}</option>
            <option value={UserRole.RESTAURANT_COURIER}>{t('restaurantPanel.roleCourier')}</option>
          </Select>
          <Button loading={busy} disabled={phone.length !== 13} onClick={() => void add()}>
            {t('common.add')}
          </Button>
        </div>

        <p className="mt-3 text-sm text-ink-400">{t('restaurantPanel.staffAccountHint')}</p>

        {/* Where a courier actually goes. Without this the restaurant adds a
            driver and nobody knows which screen is theirs. */}
        {role === UserRole.RESTAURANT_COURIER && (
          <p className="mt-1 text-sm text-ink-500">{t('restaurantPanel.roleCourierHint')}</p>
        )}

        {error && (
          <div className="mt-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </Card>

      {listError && (
        <div className="mb-4">
          <Alert tone="danger">{listError}</Alert>
        </div>
      )}

      {invites.length > 0 && (
        <Card className="mb-5 p-4">
          <h2 className="font-medium text-ink-900">{t('restaurantPanel.pendingInvites')}</h2>
          <p className="mt-0.5 text-sm text-ink-500">{t('restaurantPanel.pendingInvitesHint')}</p>

          <ul className="mt-3 divide-y divide-row-edge">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  {/* The role, not the person. This document deliberately holds
                      no name and no number — the restaurant typed the number,
                      and somebody who may still say no should not have their
                      name published to the whole staff-managing team. */}
                  <span className="block text-ink-800">{t(`roles.${invite.role}`)}</span>
                  <span className="block text-sm text-ink-400">
                    {t('restaurantPanel.invitePending')}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void withdraw(invite)}
                >
                  {t('restaurantPanel.cancelInvite')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <DataTable
        rows={staff}
        columns={columns}
        rowKey={(member) => member.uid}
        emptyTitle={t('restaurantPanel.noStaff')}
        emptyHint={t('restaurantPanel.noStaffHint')}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={t('restaurantPanel.removeStaff')}
        body={t('restaurantPanel.warnRemoveStaff', { name: removing?.fullName ?? '' })}
        confirmLabel={t('restaurantPanel.removeStaff')}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </PanelShell>
  );
}
