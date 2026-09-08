#!/usr/bin/env bash
#
# QAPINDA v39 — ad, telefon və müştəri sayğacları.
#
# WHAT IS IN IT
# -------------
#   • A customer may change their own display name. It used to be writable
#     straight from the browser with no length bound, no moderation and no audit
#     row — and no screen used it, so it was a hole with no feature behind it.
#     Now it goes through `updateProfile` and the rule no longer lists the field.
#   • An admin may move a telephone number to another account. Sign-in is a code
#     to that number and nothing else, so until now a person who lost their
#     number lost their account, permanently, with no tool for support at all.
#   • Every account now carries its completed order count, lifetime spend and
#     last order date, so the admin roster can be sorted by them.
#   • The mobile hang is fixed. A token read that never came back left
#     `identityLoading` true forever and every screen that waits for the identity
#     spun with no way to end — introduced by v37, reported as "sometimes it says
#     loading and never opens". The read now settles on failure, and there is a
#     six-second deadline behind it so nothing can wait indefinitely again.
#   • The footer is on the browse pages only. Four columns of links under a list
#     of saved addresses read as a broken page on a phone.
#   • Signing out is red. It was a white button on a white card.
#   • BOTH SETTINGS SCREENS ARE REACHABLE AGAIN. The v37 rename rewrote every
#     path that begins with a slash and missed the ones built as
#     `${ROOT}/gorunus` — so the admin's eight settings pages and the
#     restaurant's nine all answered 404, silently, for a release and a half.
#     A new test now walks the real route tree and checks every link in the app
#     against it, so a renamed folder cannot leave its links behind again.
#
# ORDER
# -----
#   1. RULES FIRST, and they must go before the site. The rule stops the browser
#      writing `fullName`; the new screen writes it through a callable instead.
#      Rules first means there is never a moment where the old screen could
#      still write and the new one could not — there is no old screen.
#   2. FUNCTIONS SECOND, and only the six that changed. Everything else is
#      byte-identical to v38 and Firebase would skip it anyway; naming them
#      keeps the deploy to ten minutes instead of an hour.
#   3. THE SITE LAST.
#
# AFTER THE DEPLOY, RUN THE BACKFILL ONCE. The counters are incremented from
# here on, so every account that already existed shows a dash until it has run.
# The message at the end says how.
#
#     ./scripts/deploy-v39.sh
#
# Safe to run again from the top.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb:  gcloud config set project qapindanew" >&2
  exit 1
fi
echo "📍 Layihə: $PROJECT"

CHANGED=(
  updateProfile
  changeUserPhone
  backfillCustomerCounters
  settleDeliveredOrders
  updateOrderStatus
)

step() { echo; echo "── $* ─────────────────────────────"; }

# ---------------------------------------------------------------------------
step "1/3  Qaydalar"
# ---------------------------------------------------------------------------
firebase deploy --only firestore:rules --non-interactive \
  || { echo "❌ Qaydalar göndərilmədi." >&2; exit 1; }

# ---------------------------------------------------------------------------
step "2/3  Funksiyalar (5 ədəd)"
# ---------------------------------------------------------------------------
npm run functions:build || { echo "❌ Funksiya build alınmadı." >&2; exit 1; }

ONLY=""
for name in "${CHANGED[@]}"; do
  ONLY="${ONLY},functions:${name}"
done
ONLY="${ONLY#,}"

for attempt in 1 2 3; do
  echo "▶ Cəhd $attempt / 3"
  # `--force` — `createOrder` və `startOnlinePayment` isti nüsxə saxlayır və
  # Firebase minimum hesabın artmasını təsdiqlətmək istəyir. Xərc v36-dan
  # bəridir; bu, eyni suala təkrar cavabdır.
  if firebase deploy --only "$ONLY" --non-interactive --force; then
    echo "✅ Funksiyalar göndərildi."
    break
  fi
  if [ "$attempt" = "3" ]; then
    echo "⚠️  Bitmədi. Skripti yenidən işlət." >&2
  else
    echo "⏳ 20s gözlə…"; sleep 20
  fi
done

./scripts/grant-invokers.sh || echo "⚠️  İcazələri sonra ver: ./scripts/grant-invokers.sh"

# ---------------------------------------------------------------------------
step "3/3  Sayt"
# ---------------------------------------------------------------------------
rm -rf .next
npm run build || { echo "❌ Build alınmadı." >&2; exit 1; }
./scripts/deploy-hosting.sh 10

cat <<'DONE'

══════════════════════════════════════════════
v39 GÖNDƏRİLDİ
══════════════════════════════════════════════

YOXLA:
  1. Hesabım → adın yanındakı qələmə bas, adı
     dəyiş. Köhnə sifarişlərdə köhnə ad qalmalıdır.
  1b. Telefonda saytı bir neçə dəfə aç-bağla —
     «yüklənir» ilişməməlidir.
  1c. Ünvanlar/kuponlar/səbət/sifarişlərim →
     footer GÖRSƏNMƏMƏLİDİR. Ana səhifə və
     restoran səhifəsində GÖRSƏNMƏLİDİR.
  1d. Hesabım → «Çıxış» qırmızı olmalıdır.
  1e. Admin → Ayarlar → HƏR SƏKKİZ plitəyə bas.
     Heç birində 404 olmamalıdır.
  1f. Restoran paneli → Ayarlar → hər doqquz plitə.
  2. Admin → İstifadəçilər → bir sətirdə telefon
     düyməsi. AÇMA, sadəcə görün.
  3. Admin → İstifadəçilər → sıralama seçicisi:
     «Ən çox sifariş». Hamısı «—» görünəcək —
     bu normaldır, backfill hələ işləməyib.

══════════════════════════════════════════════
BACKFILL — BİR DƏFƏ, İNDİ
══════════════════════════════════════════════

Sayğaclar bundan sonra öz-özünə artır. Amma
əvvəldən mövcud hesabların tarixçəsi yoxdur —
admin siyahısında hamısı «—» görünəcək.

  Admin panel → Ayarlar → aşağıda
  «Müştəri sayğaclarını hesabla» → Hesabla

Düymə səhifə-səhifə işləyir və gedişatı göstərir.
İki dəfə basmaq zərərsizdir.

══════════════════════════════════════════════
DONE
