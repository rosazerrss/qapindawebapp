'use client';

/**
 * A visible warning when Firebase is not configured.
 *
 * Without this the app renders an empty restaurant list, which looks exactly
 * like "nobody has joined yet" — the most confusing possible failure. Better to
 * say plainly that the environment file is missing.
 */

import { isFirebaseConfigured } from '@/firebase/client';

export function ConfigNotice() {
  if (isFirebaseConfigured) return null;

  return (
    <div className="bg-amber-50 px-4 py-2.5 text-center text-sm text-warning">
      Firebase konfiqurasiyası tapılmadı. <code className="font-mono">.env.local</code> faylını
      yaradın — <code className="font-mono">.env.example</code> nümunədir.
    </div>
  );
}
