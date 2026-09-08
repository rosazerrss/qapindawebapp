/**
 * The rule that decides whether a phone/email lock still means anything.
 *
 * These are the tests that matter most in this file's short life, because the
 * failure they guard against is asymmetric. A lock wrongly called *dead* lets a
 * second person take over a live customer's number — the one thing the whole
 * index exists to prevent. A lock wrongly called *live* only means somebody has
 * to ask an admin. So the live cases are asserted first and in detail.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { lockIsLive, lockIsStale, staleReason } from '../shared/accountLocks';

const KEY = '994501234567';

const liveHolder = {
  accountStatus: 'ACTIVE',
  phoneKey: KEY,
  emailKey: 'ali@gmail.com',
};

describe('a lock that is still doing its job', () => {
  it('is live when the account exists and still claims the number', () => {
    expect(
      lockIsLive({ kind: 'PHONE', lockKey: KEY, holderUid: 'ABC', holder: liveHolder }),
    ).toBe(true);
  });

  it('is live for a suspended or banned account — those people still own their number', () => {
    for (const accountStatus of ['SUSPENDED', 'BANNED', 'REVIEW_REQUIRED', 'DELETION_REQUESTED']) {
      expect(
        lockIsLive({
          kind: 'PHONE',
          lockKey: KEY,
          holderUid: 'ABC',
          holder: { ...liveHolder, accountStatus },
        }),
      ).toBe(true);
    }
  });

  it('is live on the email side by the email key, not the phone key', () => {
    expect(
      lockIsLive({
        kind: 'EMAIL',
        lockKey: 'ali@gmail.com',
        holderUid: 'ABC',
        holder: liveHolder,
      }),
    ).toBe(true);
  });
});

describe('a lock with nothing behind it', () => {
  it('is stale when the user document is gone — the console-deletion case', () => {
    const input = { kind: 'PHONE' as const, lockKey: KEY, holderUid: 'ABC', holder: null };
    expect(lockIsStale(input)).toBe(true);
    expect(staleReason(input)).toBe('NO_ACCOUNT');
  });

  it('is stale when the lock names no uid at all', () => {
    const input = { kind: 'PHONE' as const, lockKey: KEY, holderUid: null, holder: liveHolder };
    expect(lockIsStale(input)).toBe(true);
    expect(staleReason(input)).toBe('NO_UID');
  });

  it('is stale for an anonymised account', () => {
    const input = {
      kind: 'PHONE' as const,
      lockKey: KEY,
      holderUid: 'ABC',
      holder: { ...liveHolder, accountStatus: 'ANONYMIZED' },
    };
    expect(lockIsStale(input)).toBe(true);
    expect(staleReason(input)).toBe('ANONYMISED');
  });

  it('is stale when the account has moved to a different number', () => {
    const input = {
      kind: 'PHONE' as const,
      lockKey: KEY,
      holderUid: 'ABC',
      holder: { ...liveHolder, phoneKey: '994559999999' },
    };
    expect(lockIsStale(input)).toBe(true);
    expect(staleReason(input)).toBe('MOVED_ON');
  });

  it('is stale when the account carries no number of its own', () => {
    expect(
      lockIsStale({
        kind: 'PHONE',
        lockKey: KEY,
        holderUid: 'ABC',
        holder: { ...liveHolder, phoneKey: null },
      }),
    ).toBe(true);
  });

  it('reports no reason at all for a live lock', () => {
    expect(
      staleReason({ kind: 'PHONE', lockKey: KEY, holderUid: 'ABC', holder: liveHolder }),
    ).toBeNull();
  });
});

/**
 * The decisions above are only worth anything if the server actually consults
 * them. These read the source, in the same style as the rest of this suite.
 */
describe('the server uses the rule rather than a bare uid comparison', () => {
  const registration = fs.readFileSync('functions/src/users/account.ts', 'utf8');
  const locks = fs.readFileSync('functions/src/users/locks.ts', 'utf8');

  it('registration decides on lockIsLive, not on the raw lock document', () => {
    expect(registration).toContain('lockIsLive');
    expect(registration).toContain('phoneLockLive');
    expect(registration).toContain('emailLockLive');
  });

  it('linking an email applies the same rule', () => {
    // Two call sites: registration and linkEmail. A single one would mean the
    // settings screen still refuses a ghost lock.
    expect(registration.match(/lockIsLive\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('the admin release refuses a live lock', () => {
    expect(locks).toContain('if (report.live) fail(AppErrorCode.CONFLICT');
  });

  it('the nightly sweep skips live locks', () => {
    expect(locks).toContain('if (report.live) continue;');
  });

  it('releasing a lock is audited', () => {
    expect(locks).toContain('AuditAction.ACCOUNT_LOCK_RELEASED');
  });
});
