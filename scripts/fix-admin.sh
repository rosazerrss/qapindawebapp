#!/usr/bin/env bash
#
# QAPINDA — Getting back in after an account was deleted by hand.
#
# WHAT HAPPENED
# -------------
# `users/{uid}` was deleted straight out of the Firestore console. Two other
# documents were not: `phoneIndex/{number}` and `emailIndex/{address}`. Those
# are the locks that make "one customer, one account" true, and they still
# named the uid of the account that no longer exists.
#
# So registration read the lock, saw a uid that was not the caller's, and
# refused — "bu nömrə artıq qeydiyyatdadır" — to the number's real owner, for
# ever, with no screen anywhere able to clear it.
#
# WHAT THIS SCRIPT DOES ABOUT IT
# ------------------------------
# Deploys the fix and opens the one door that lets a platform with no admin
# make one. Three things, in order:
#
#   1. `registerAccount` and `linkEmail`, which now check whether the account
#      behind a lock still exists before honouring it. A lock with nothing
#      behind it is taken over rather than obeyed. THIS is the real fix — after
#      this, the same accident never locks anybody out again.
#
#   2. `inspectAccountLocks` and `releaseAccountLock` — the admin screen at
#      Panel → Hesab kilidləri, so the next one can be looked at rather than
#      guessed at. `sweepStaleAccountLocks` tidies the index nightly.
#
#   3. A one-time secret in `functions/.env`, because a platform whose only
#      super admin was deleted has no way to grant the role: only a super admin
#      may promote anyone, and there is no super admin. `bootstrapSuperAdmin`
#      is that one door, and it closes by itself the moment a super admin
#      exists.
#
# DELETE THE SECRET AFTERWARDS. The script says so again at the end, and it is
# not a formality: anyone holding that string can make themselves a super admin
# on a platform that has none.
#
#   ./scripts/fix-admin.sh

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb:" >&2
  echo "     gcloud config set project qapindanew" >&2
  exit 1
fi
echo "📍 Layihə: $PROJECT"

# ---------------------------------------------------------------------------
# The secret. Generated here, never typed, never reused.
# ---------------------------------------------------------------------------
ENV_FILE="functions/.env"
touch "$ENV_FILE"

if grep -q '^BOOTSTRAP_ADMIN_SECRET=' "$ENV_FILE"; then
  SECRET="$(grep '^BOOTSTRAP_ADMIN_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  echo "ℹ️  Mövcud açar istifadə olunur."
else
  SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
  printf '\nBOOTSTRAP_ADMIN_SECRET=%s\n' "$SECRET" >> "$ENV_FILE"
  echo "🔑 Yeni açar yaradıldı və functions/.env-ə yazıldı."
fi

# ---------------------------------------------------------------------------
# Deploy. Only what is needed — a full deploy takes half an hour and none of
# the other hundred functions changed.
# ---------------------------------------------------------------------------
echo
echo "📦 Funksiyalar göndərilir..."
firebase deploy --only \
  functions:registerAccount,functions:linkEmail,functions:bootstrapSuperAdmin,functions:inspectAccountLocks,functions:releaseAccountLock,functions:sweepStaleAccountLocks \
  --non-interactive || {
    echo "❌ Deploy alınmadı. Yenidən işlət — göndərilənlər təkrar göndərilmir." >&2
    exit 1
  }

# ---------------------------------------------------------------------------
# The invoker grants, for the callables only.
#
# `sweepStaleAccountLocks` is deliberately absent: it is a scheduled job,
# invoked by Google's own service agent, and giving `allUsers` the right to
# invoke it would let anyone on the internet run it.
# ---------------------------------------------------------------------------
echo
echo "🔑 Callable-lara icazə verilir..."
for service in registeraccount linkemail bootstrapsuperadmin inspectaccountlocks releaseaccountlock; do
  if gcloud run services add-iam-policy-binding "$service" \
      --region=europe-west1 --member=allUsers --role=roles/run.invoker --quiet >/dev/null 2>&1; then
    echo "   ✅ $service"
  else
    echo "   ⚠️  $service — icazə verilmədi"
  fi
done

cat <<INSTRUCTIONS

══════════════════════════════════════════════════════════
İNDİ NƏ ETMƏLİ
══════════════════════════════════════════════════════════

1. Saytda telefon nömrənlə adi qaydada QEYDİYYATDAN KEÇ.
   Bu dəfə alınacaq: ölü kilid avtomatik təmizlənir.

2. https://qapindanew.web.app/admin-login səhifəsini aç və
   bu açarı yaz:

   $SECRET

   Hesabın super admin olacaq.

3. Açarı DƏRHAL SİL:

     sed -i '/^BOOTSTRAP_ADMIN_SECRET=/d' functions/.env
     firebase deploy --only functions:bootstrapSuperAdmin

   Açar silinməsə, onu bilən istənilən adam admin ola bilər.

4. Bundan sonra bu problem bir daha olmayacaq. Olsa belə:
   Panel → Hesab kilidləri səhifəsində nömrəni yoxla.

══════════════════════════════════════════════════════════
INSTRUCTIONS
