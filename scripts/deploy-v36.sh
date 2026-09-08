#!/usr/bin/env bash
#
# QAPINDA v36 — audit düzəlişləri və panel bütövlüyü.
#
# WHY THIS RELEASE IS DIFFERENT FROM v33 AND v34
# ----------------------------------------------
# Those were the site alone. This one changes Firestore rules, Storage rules,
# indexes AND fourteen Cloud Functions, so the order below matters:
#
#   1. INDEXES FIRST. Three new composite indexes back queries the new code
#      issues. A function deployed before its index answers every one of those
#      queries with a permission error — which looks exactly like a bug in the
#      function.
#   2. FUNCTIONS SECOND. The rules that follow close doors the OLD functions
#      were relying on (an operator reading `restaurants/*/private`, a browser
#      writing its own address). Sending the rules first would break the running
#      version for the minutes it takes the functions to go out.
#   3. RULES THIRD.
#   4. THE SITE LAST, because it is the slowest and the only step that is safe
#      to retry all evening.
#
#     ./scripts/deploy-v36.sh
#
# Safe to run again from the top. Every step is idempotent.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb:  gcloud config set project qapindanew" >&2
  exit 1
fi
echo "📍 Layihə: $PROJECT"

# The functions changed in this release. Sending 114 takes the best part of an
# hour from Cloud Shell and fails partway through often enough that it is worth
# naming the fourteen that actually moved.
CHANGED=(
  getSettlement
  setPayoutDetails
  listComplaints
  resolveComplaint
  updateOrderStatus
  setServiceState
  restaurantDashboard
  createOrder
  previewOrder
  startOnlinePayment
  epointCallback
  refundPayment
  expirePendingPayments
  expireStaleOrders
  settleDeliveredOrders
  sendEmailCode
  openSupportTicket
  sendSupportMessage
  setRestaurantStaff
  customerOrderContext
)

step() { echo; echo "── $* ─────────────────────────────"; }

# ---------------------------------------------------------------------------
step "1/4  İndekslər"
# ---------------------------------------------------------------------------
# Firestore builds an index in the background and the deploy returns before it
# is ready. On an empty-ish collection that is seconds; on a large one it can be
# minutes, and a query issued in between fails. This is why indexes go first and
# not last.
firebase deploy --only firestore:indexes --non-interactive \
  || { echo "❌ İndekslər göndərilmədi." >&2; exit 1; }

# ---------------------------------------------------------------------------
step "2/4  Funksiyalar"
# ---------------------------------------------------------------------------
npm run functions:build || { echo "❌ Funksiya build alınmadı." >&2; exit 1; }

ONLY=""
for name in "${CHANGED[@]}"; do
  ONLY="${ONLY},functions:${name}"
done
ONLY="${ONLY#,}"

for attempt in 1 2 3; do
  echo "▶ Cəhd $attempt / 3"
  if firebase deploy --only "$ONLY" --non-interactive; then
    echo "✅ Funksiyalar göndərildi."
    break
  fi
  if [ "$attempt" = "3" ]; then
    echo "⚠️  Bəziləri göndərilmədi. ./scripts/deploy-functions.sh ilə davam et." >&2
  else
    echo "⏳ 20s gözlə…"; sleep 20
  fi
done

# `createOrder` and `startOnlinePayment` now ask for a warm instance, and a new
# revision needs its invoker grant again.
./scripts/grant-invokers.sh || echo "⚠️  İcazələri sonra ver: ./scripts/grant-invokers.sh"

# ---------------------------------------------------------------------------
step "3/4  Qaydalar"
# ---------------------------------------------------------------------------
# Firestore and Storage together: the address rule and the complaint-photo rule
# are two halves of the same decision and should not be live one without the
# other.
firebase deploy --only firestore:rules,storage --non-interactive \
  || { echo "❌ Qaydalar göndərilmədi." >&2; exit 1; }

# ---------------------------------------------------------------------------
step "4/4  Sayt"
# ---------------------------------------------------------------------------
rm -rf .next
npm run build || { echo "❌ Build alınmadı." >&2; exit 1; }
./scripts/deploy-hosting.sh 10

cat <<'DONE'

══════════════════════════════════════════════
BİTDİ — İNDİ BUNLARI YOXLA
══════════════════════════════════════════════

  qapindanew.web.app/robots.txt     → görünməlidir
  qapindanew.web.app/sitemap.xml    → restoranlar sadalanmalıdır

  Telefonda saytı aç → aşağıda footer görünməlidir
  Hüquqi səhifə aç   → {{...}} işarələri qalmamalıdır

══════════════════════════════════════════════
DONE
