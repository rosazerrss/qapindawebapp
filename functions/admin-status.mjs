/**
 * QAPINDA — "Admin hesabıma girə biləcəyəm ya yox?"
 *
 * WHY THIS EXISTS
 * ---------------
 * There are three ways into the admin panel and they are mutually exclusive.
 * Which one applies depends on facts sitting in Firestore that no screen shows:
 *
 *   A. A super admin account already exists and works  → just sign in.
 *   B. A super admin exists but its phone lock is stale → the lock is healed
 *      automatically now, so sign in and re-register on that number.
 *   C. No super admin exists at all → bootstrapSuperAdmin, once, with a secret.
 *
 * Guessing between them is how an evening gets spent. This reads the three
 * documents that decide it and says which one you are in.
 *
 * READ-ONLY. It writes nothing, changes nothing, and grants nothing. Every
 * sentence it prints is derived from a document it just read.
 *
 *   cd functions
 *   node admin-status.mjs                 # is there an admin at all?
 *   node admin-status.mjs +994501234567   # and: can THIS number register?
 *
 * It lives in `functions/` rather than `scripts/` for one dull reason:
 * `firebase-admin` is a dependency of the functions package and of nothing
 * else, so this is the only directory node can resolve it from without a
 * second install.
 *
 * Run it from Cloud Shell, where the project's own credentials are already
 * available. It needs no key file and no secret.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'qapindanew';

/**
 * The phone, as `phoneIndex` keys it.
 *
 * Digits only. The same normalisation `shared/collections.ts` applies, repeated
 * here rather than imported because this script has to run before `npm install`
 * has necessarily rebuilt anything, and one regex is a cheaper dependency than
 * a build step.
 */
function phoneKey(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

/** `+994 ** *** ** 45` — enough to recognise your own number, not to dial it. */
function maskPhone(phone) {
  const digits = phoneKey(phone);
  if (digits.length < 4) return '—';
  return `+${digits.slice(0, 3)} ** *** ** ${digits.slice(-2)}`;
}

const line = (char = '─') => console.log(char.repeat(58));

async function main() {
  const wanted = process.argv[2] ?? null;

  console.log();
  line('═');
  console.log('  QAPINDA — admin hesabının vəziyyəti');
  line('═');
  console.log(`  Layihə: ${PROJECT_ID}`);

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const auth = getAuth();

  // -------------------------------------------------------------------------
  // 1. Is there a super admin at all?
  // -------------------------------------------------------------------------
  const admins = await db.collection('users').where('role', '==', 'SUPER_ADMIN').get();

  console.log();
  line();
  console.log('  1. SUPER ADMIN HESABLARI');
  line();

  if (admins.empty) {
    console.log('  ❌ Heç bir super admin yoxdur.');
  } else {
    for (const doc of admins.docs) {
      const user = doc.data();
      /*
       * The Auth credential is checked separately from the document.
       *
       * They can disagree, and the disagreement is invisible from either side
       * alone: a `users/{uid}` with no Auth user behind it cannot sign in at
       * all, and that is exactly the state a half-finished deletion leaves.
       */
      let credential = '✅ var';
      try {
        await auth.getUser(doc.id);
      } catch {
        credential = '❌ YOXDUR — bu hesabla giriş mümkün deyil';
      }

      console.log(`  • ${user.fullName ?? '—'}`);
      console.log(`    uid       : ${doc.id}`);
      console.log(`    telefon   : ${maskPhone(user.phone)}`);
      console.log(`    status    : ${user.accountStatus ?? '—'}`);
      console.log(`    giriş     : ${credential}`);

      if (user.accountStatus && user.accountStatus !== 'ACTIVE') {
        console.log(`    ⚠️  status ACTIVE deyil — bu hesab panelə buraxılmır.`);
      }
      console.log();
    }
  }

  // -------------------------------------------------------------------------
  // 2. Is the bootstrap door open?
  // -------------------------------------------------------------------------
  console.log();
  line();
  console.log('  2. BOOTSTRAP AÇARI');
  line();

  // Read from the deployed function's environment file, not from the running
  // process: this script runs on Cloud Shell, and the secret that matters is
  // the one the FUNCTION will see.
  const fs = await import('node:fs');
  let secretPresent = false;
  try {
    const env = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
    const match = env.match(/^BOOTSTRAP_ADMIN_SECRET=(.+)$/m);
    secretPresent = Boolean(match && match[1].trim().length >= 20);
  } catch {
    // No file. Which is the normal, and safer, state.
  }

  if (secretPresent) {
    console.log('  ✅ functions/.env-də açar var.');
    if (!admins.empty) {
      console.log('  ⚠️  AMMA super admin artıq mövcuddur — bootstrap işləməyəcək');
      console.log('     (bir dəfəlik qapıdır) və açar orada qalmamalıdır:');
      console.log();
      console.log("       sed -i '/^BOOTSTRAP_ADMIN_SECRET=/d' functions/.env");
      console.log('       firebase deploy --only functions:bootstrapSuperAdmin');
    }
  } else {
    console.log('  ℹ️  Açar yoxdur. Super admin lazımdırsa ./scripts/fix-admin.sh yaradır.');
  }

  // -------------------------------------------------------------------------
  // 3. Can a specific number register?
  // -------------------------------------------------------------------------
  if (wanted) {
    const key = phoneKey(wanted);

    console.log();
    line();
    console.log(`  3. ${maskPhone(wanted)} — QEYDİYYAT MÜMKÜNDÜRMÜ?`);
    line();

    const lock = await db.doc(`phoneIndex/${key}`).get();

    if (!lock.exists) {
      console.log('  ✅ Kilid yoxdur — bu nömrə ilə qeydiyyat açıqdır.');
    } else {
      const holderUid = lock.data()?.uid ?? null;
      const holder = holderUid ? await db.doc(`users/${holderUid}`).get() : null;
      const held = holder?.exists ? holder.data() : null;

      /*
       * The same rule `shared/accountLocks.ts` applies, and the reason this
       * script is worth reading: a lock is only real while the account behind
       * it still exists, is not anonymised, and still claims that number.
       */
      const live =
        Boolean(held) &&
        held.accountStatus !== 'ANONYMIZED' &&
        phoneKey(held.phone) === key;

      console.log(`  Kilid var, göstərdiyi uid: ${holderUid ?? '—'}`);

      if (!held) {
        console.log('  ⚠️  O hesab MÖVCUD DEYİL — kilid ölüdür.');
        console.log('  ✅ v30-dan sonra qeydiyyat bu kilidi özü təmizləyir.');
      } else if (held.accountStatus === 'ANONYMIZED') {
        console.log('  ⚠️  O hesab anonimləşdirilib — kilid ölüdür.');
        console.log('  ✅ v30-dan sonra qeydiyyat bu kilidi özü təmizləyir.');
      } else if (!live) {
        console.log('  ⚠️  O hesab artıq bu nömrəni daşımır — kilid ölüdür.');
        console.log('  ✅ v30-dan sonra qeydiyyat bu kilidi özü təmizləyir.');
      } else {
        console.log(`  ❌ Kilid CANLIDIR — nömrə real hesaba bağlıdır.`);
        console.log(`     ad   : ${held.fullName ?? '—'}`);
        console.log(`     rol  : ${held.role ?? '—'}`);
        console.log('     Bu nömrə ilə İKİNCİ hesab açıla bilməz. Həmin hesabla gir.');
      }
    }
  }

  // -------------------------------------------------------------------------
  // The verdict.
  // -------------------------------------------------------------------------
  console.log();
  line('═');
  console.log('  NƏ ETMƏLİ');
  line('═');

  if (!admins.empty) {
    const usable = [];
    for (const doc of admins.docs) {
      const user = doc.data();
      if (user.accountStatus !== 'ACTIVE') continue;
      try {
        await auth.getUser(doc.id);
        usable.push(maskPhone(user.phone));
      } catch {
        // No credential — cannot sign in. Not a usable route.
      }
    }

    if (usable.length > 0) {
      console.log('  ✅ İşlək super admin var. Sadəcə daxil ol:');
      console.log();
      console.log('     https://qapindanew.web.app/admin-giris');
      console.log();
      console.log(`     Nömrə: ${usable.join(', ')}`);
      console.log('     SMS kodu ilə giriş. Başqa heç nə lazım deyil.');
    } else {
      console.log('  ⚠️  Super admin sənədi var, amma girişi yoxdur.');
      console.log('     Həmin nömrə ilə YENİDƏN QEYDİYYATDAN KEÇ — hesab sənədi');
      console.log('     yerindədir və rolu SUPER_ADMIN olaraq qalır, ona görə');
      console.log('     qeydiyyat bitən kimi panelə girə biləcəksən.');
    }
  } else {
    console.log('  Super admin yoxdur. Ardıcıllıq:');
    console.log();
    console.log('     1. ./scripts/fix-admin.sh        (açar yaradır və göndərir)');
    console.log('     2. Saytda adi qaydada qeydiyyatdan keç');
    console.log('     3. /admin-giris → açarı yaz');
    console.log('     4. Açarı DƏRHAL sil (skript əmri verir)');
  }

  line('═');
  console.log();
}

main().catch((error) => {
  console.error();
  console.error('❌ Oxuna bilmədi:', error?.message ?? error);
  console.error();
  console.error('   Ən çox rast gəlinən səbəb — Cloud Shell icazəsi:');
  console.error();
  console.error('     gcloud auth application-default login');
  console.error();
  process.exit(1);
});
