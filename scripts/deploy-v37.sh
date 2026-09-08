#!/usr/bin/env bash
#
# QAPINDA v37 — kimlik yoxlaması düzəlişi və ingilis dilində ünvanlar.
#
# WHAT THIS RELEASE IS, AND WHY THE ORDER IS DIFFERENT FROM v36
# ------------------------------------------------------------
# v36 changed rules, indexes and fourteen functions, so it had to go out
# carefully. This one is almost entirely the SITE:
#
#   • The sign-in bug. A failed read of the user document used to be recorded
#     as "this account has no profile", which sent registered people to the
#     registration form and flashed a sign-up card on the way to /account.
#     That lives in the browser bundle. Nothing server-side changes.
#
#   • Every route renamed to English, with a permanent redirect from each old
#     one. Also the browser bundle — the redirects are Next config, which
#     Firebase Hosting serves from the same deployment.
#
# Two functions DO change, and only because they held a link that a
# notification puts in somebody's pocket:
#
#     approveRestaurant   → the owner's "you are live" notification pointed at
#                           a path that no longer exists (it pointed at one
#                           that never existed, in fact — the bare root).
#     fileComplaint       → the restaurant's complaint notification.
#
# ORDER
# -----
#   1. FUNCTIONS FIRST here, unusually. They only change a string, and both old
#      and new links work throughout — the redirects see to that — so there is
#      no window where one half is wrong.
#   2. THE SITE SECOND, because it is the slow step and the only one worth
#      retrying all evening.
#
# Rules and indexes are NOT sent: nothing in them moved. Sending them anyway
# would be harmless but would add ten minutes to a deploy for no reason.
#
#     ./scripts/deploy-v37.sh
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
  approveRestaurant
  fileComplaint
)

step() { echo; echo "── $* ─────────────────────────────"; }

# ---------------------------------------------------------------------------
step "1/2  Funksiyalar (2 ədəd)"
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
    echo "⚠️  Göndərilmədi. ./scripts/deploy-functions.sh ilə davam et." >&2
  else
    echo "⏳ 20s gözlə…"; sleep 20
  fi
done

# ---------------------------------------------------------------------------
step "2/2  Sayt"
# ---------------------------------------------------------------------------
# `rm -rf .next` on purpose: the route folders were RENAMED, and a stale build
# directory keeps the old ones. Next would then serve two versions of the same
# page and the redirects would fight the leftovers.
rm -rf .next
npm run build || { echo "❌ Build alınmadı." >&2; exit 1; }
./scripts/deploy-hosting.sh 10

cat <<'DONE'

══════════════════════════════════════════════
v37 GÖNDƏRİLDİ — İNDİ YOXLA
══════════════════════════════════════════════

  1. Hesabına gir. Restoranlara bax. Sonra «Hesabım»a
     qayıt — «qeydiyyatı tamamla» ekranı GÖRSƏNMƏMƏLİDİR.

  2. Köhnə ünvanı yaz:  qapindanew.web.app/hesabim
     → /account-ə yönləndirməlidir.

  3. Restoran hesabı ilə gir → /panel açılmalıdır,
     «Hesabım»a atmamalıdır.

  4. Köhnə bir bildirişə toxun (varsa) — sifariş
     səhifəsi açılmalıdır.

══════════════════════════════════════════════
DONE
