/**
 * Idempotency.
 *
 * A phone loses signal halfway through "Sifarişi təsdiqlə" and the app retries.
 * Without a claim, that is two dinners and two charges. The key is claimed
 * inside the *same transaction* as the effect it guards, so there is no window
 * where the key exists and the order does not, or the reverse.
 */

import { db, now } from './admin';
import { fail } from './errors';
import { AppErrorCode } from '../shared/errors';
import { paths } from '../shared/collections';
import type { IdempotencyRecord } from '../shared/models';

/**
 * Claims a key inside a transaction.
 *
 * Returns the existing record when the key was already used, so the caller can
 * return the original result instead of doing the work twice.
 */
/**
 * Reads a claim without writing anything.
 *
 * Firestore transactions require every read to happen before the first write.
 * `claimKeyIn` does both at once, which is fine only when nothing else in the
 * transaction needs to read afterwards — and that condition is easy to break
 * later without noticing. Where a transaction has more reads to do, use this
 * pair instead: read every document first, then decide, then write.
 */
export async function readClaimIn(
  tx: FirebaseFirestore.Transaction,
  key: string,
): Promise<IdempotencyRecord | null> {
  const snapshot = await tx.get(db.doc(paths.idempotencyKey(key)));
  return snapshot.exists ? (snapshot.data() as IdempotencyRecord) : null;
}

/** The write half of `readClaimIn`. Call only after every read is done. */
export function writeClaimIn(
  tx: FirebaseFirestore.Transaction,
  key: string,
  operation: string,
  resultRef: string | null = null,
): void {
  tx.set(db.doc(paths.idempotencyKey(key)), { key, operation, resultRef, createdAt: now() });
}

export async function claimKeyIn(
  tx: FirebaseFirestore.Transaction,
  key: string,
  operation: string,
  resultRef: string | null = null,
): Promise<{ claimed: boolean; existing: IdempotencyRecord | null }> {
  const ref = db.doc(paths.idempotencyKey(key));
  const snapshot = await tx.get(ref);

  if (snapshot.exists) {
    return { claimed: false, existing: snapshot.data() as IdempotencyRecord };
  }

  tx.set(ref, { key, operation, resultRef, createdAt: now() });
  return { claimed: true, existing: null };
}

/** Claims a key on its own. Use when there is no surrounding transaction. */
export async function claimKey(key: string, operation: string): Promise<boolean> {
  try {
    await db.doc(paths.idempotencyKey(key)).create({
      key,
      operation,
      resultRef: null,
      createdAt: now(),
    });
    return true;
  } catch {
    return false;
  }
}

/** Rejects a repeat outright, for operations with nothing to return. */
export async function requireFreshKey(key: string, operation: string): Promise<void> {
  if (!(await claimKey(key, operation))) fail(AppErrorCode.DUPLICATE_REQUEST);
}
