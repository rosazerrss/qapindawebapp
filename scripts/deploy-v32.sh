#!/usr/bin/env bash
#
# QAPINDA v32 — deploying only what changed.
#
# WHY NOT `firebase deploy --only functions`
# ------------------------------------------
# There are ninety-nine callables on this project now. Sending all of them takes
# the best part of an hour from Cloud Shell and fails partway through often
# enough that `deploy-functions.sh` exists purely to retry the ones that dropped.
#
# Nineteen of them changed in v30. Sending those nineteen takes a few minutes and
# cannot half-fail the other eighty, because the other eighty are never sent.
#
#     ./scripts/deploy-v32.sh
#
# Safe to run again. Deploying a function that is already current is a no-op on
# Google's side, and the invoker grants below are idempotent.
#
# If a batch fails, run it again — or fall back to ./scripts/deploy-functions.sh,
# which sends everything in batches and retries only the failures.

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
# NEW in v30.
# ---------------------------------------------------------------------------
NEW=(
  # Hesab kilidləri — ölü kilidi görmək və silmək
  inspectAccountLocks
  releaseAccountLock
  sweepStaleAccountLocks
  # Ünvanın telefonu — SMS ilə təsdiq
  sendAddressPhoneCode
  verifyAddressPhoneCode
  # Restoranı platformadan silmək
  removeRestaurant
  # Operator: bir sifarişin arxasındakı müştərinin bütün sifarişləri
  customerOrderContext
)

# ---------------------------------------------------------------------------
# CHANGED in v30.
# ---------------------------------------------------------------------------
CHANGED=(
  # v32: mətbəx növü seçimli siyahıdır, printer stansiyaları saxlanılır
  updateRestaurantProfile
  # v32: sifariş sətrinə kateqoriya yazılır (çeklərin bölünməsi üçün)
  createOrder
  previewOrder
  # v31: yeni restoranlarda təhvil kodu açıq gəlir
  applyForRestaurant
  createRestaurantByAdmin
  # Ölü kilidi özü təmizləyir
  registerAccount
  linkEmail
  # Ünvanda ad + təsdiqlənmiş telefon məcburidir
  saveAddress
  # Hesab dərhal silinir, kilidlər azad olur
  requestAccountDeletion
  anonymiseUser
  # Ünvan yoxlanışı + qapını açanın adı və nömrəsi sifarişə yazılır
  createOrder
  # Təhvil kodu artıq platformanın qərarıdır
  issueDeliveryCode
  courierConfirmDelivery
  # Çatdırılmadıqda restorana bildiriş gedir
  reportDeliveryFailure
  # Restoran platformanın kod qaydasını söndürə bilmir
  updateRestaurantProfile
  # deliveryCodePolicy ayarı
  updatePublicSettings
  # SEXSI → SHEXSI
  grantCustomerCoupon
)

deploy() {
  local spec=""
  for name in "$@"; do spec+="${spec:+,}functions:${name}"; done
  firebase deploy --only "$spec" --non-interactive
}

echo
echo "══════════════════════════════════════════════"
echo "1/4  Yeni funksiyalar (${#NEW[@]})"
echo "══════════════════════════════════════════════"
deploy "${NEW[@]}" || echo "⚠️  Bu dəstə alınmadı — skripti yenidən işlət."

echo
echo "══════════════════════════════════════════════"
echo "2/4  Dəyişən funksiyalar (${#CHANGED[@]})"
echo "══════════════════════════════════════════════"
# Two halves: thirteen at once is where the Cloud Shell connection starts
# dropping requests, and a dropped request looks exactly like a permissions
# error while being nothing of the kind.
deploy "${CHANGED[@]:0:7}" || echo "⚠️  1-ci yarı alınmadı."
sleep 20
deploy "${CHANGED[@]:7}" || echo "⚠️  2-ci yarı alınmadı."

# ---------------------------------------------------------------------------
# The invoker grants, for the callables only.
#
# `sweepStaleAccountLocks` is deliberately absent: it is a scheduled job invoked
# by Google's own service agent, and granting `allUsers` the right to invoke it
# would let anyone on the internet run it.
# ---------------------------------------------------------------------------
echo
echo "══════════════════════════════════════════════"
echo "3/4  Yeni callable-lara icazə"
echo "══════════════════════════════════════════════"
for service in \
  inspectaccountlocks releaseaccountlock \
  sendaddressphonecode verifyaddressphonecode \
  removerestaurant customerordercontext
do
  if error=$(gcloud run services add-iam-policy-binding "$service" \
      --region=europe-west1 --member=allUsers --role=roles/run.invoker \
      --quiet 2>&1 >/dev/null); then
    echo "   ✅ $service"
  else
    echo "   ⚠️  $service"
    echo "      $error"
  fi
done

echo
echo "══════════════════════════════════════════════"
echo "4/4  Qaydalar, indekslər və sayt"
echo "══════════════════════════════════════════════"
# The indexes matter this time: three new composite queries were added, and a
# query with no index does not degrade — it throws, on somebody's screen.
firebase deploy --only firestore:rules,firestore:indexes --non-interactive || \
  echo "⚠️  Qaydalar/indekslər alınmadı."

npm run build && firebase deploy --only hosting --non-interactive || \
  echo "⚠️  Hosting alınmadı."

cat <<'DONE'

══════════════════════════════════════════════
DEPLOY BİTDİ — İNDİ YOXLA
══════════════════════════════════════════════

1. Admin → Ayarlar → Platforma:
   «Təhvil kodu hər sifarişdə» AÇIQ olmalıdır (standart açıqdır).

2. Admin → Hesab kilidləri:
   Bir nömrə yaz, «Yoxla» bas. Kilid canlıdırsa silmək düyməsi
   görünməməlidir — bu qəsdəndir.

3. Müştəri tərəfdə yeni ünvan əlavə et:
   Ad-soyad və telefon indi məcburidir. Öz nömrən olsa SMS getmir.

4. SMS provayderi hələ qurulmayıbsa, BAŞQASININ nömrəsi ilə ünvan
   təsdiqlənməyəcək — ekran bunu açıq deyir. functions/.env-ə
   SMS_API_URL, SMS_API_KEY, SMS_SENDER yazılandan sonra işləyəcək:

     firebase deploy --only functions:sendAddressPhoneCode

5. İndekslər «Building» yazırsa gözlə — hazır olana qədər operator
   panelindəki müştəri tarixçəsi boş görünə bilər.
══════════════════════════════════════════════
DONE
