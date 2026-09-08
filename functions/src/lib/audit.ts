/**
 * The audit trail.
 *
 * Append-only, and no client can write to it — see `firestore.rules`. Every
 * privileged action records who did it, to what, and what the value was before,
 * because "the commission was always 25%" is not a claim anyone should have to
 * take on trust.
 */

import { db, now } from './admin';
import { COLLECTIONS } from '../shared/collections';
import type { AuditAction, UserRole } from '../shared/enums';

export interface AuditInput {
  actorId: string;
  actorRole: UserRole | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  restaurantId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
}

function entry(input: AuditInput) {
  return {
    actorId: input.actorId,
    actorRole: input.actorRole ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    restaurantId: input.restaurantId ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
    ip: input.ip ?? null,
    at: now(),
  };
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await db.collection(COLLECTIONS.auditLogs).add(entry(input));
}

/**
 * Adds the audit entry to an in-flight transaction or batch, so the record and
 * the change it describes commit together — an audit log that can be missing
 * when the write succeeded is worse than none.
 */
export function auditIn(
  writer: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  input: AuditInput,
): void {
  const ref = db.collection(COLLECTIONS.auditLogs).doc();
  (writer as FirebaseFirestore.WriteBatch).set(ref, entry(input));
}
