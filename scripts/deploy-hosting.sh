#!/usr/bin/env bash
#
# QAPINDA — Saytı göndərmək, nə qədər cəhd lazımdırsa.
#
# THE FAILURE THIS EXISTS FOR
# ---------------------------
#     Error: Task <hash> failed: retries exhausted after 6 attempts, with error:
#     Failed to make request to https://upload-firebasehosting.googleapis.com/...
#
# It stops partway through — twenty files out of a hundred and twenty-one — and
# it reads like the deploy is broken. It is not. Cloud Shell opens many parallel
# uploads, the connection drops some of them, firebase-tools gives up on that one
# file, and the whole command fails with it.
#
# WHY RE-RUNNING WORKS, AND WHY IT DID NOT USED TO
# ------------------------------------------------
# Hosting stores files by content hash. The twenty that got through are already
# on Google's side, so the next run skips them and uploads a hundred and one. The
# run after that starts from whatever the second one managed. It converges.
#
# That was NOT true before `generateBuildId` in `next.config.ts`. Next.js used to
# stamp a random build id into every prerendered page, so each `npm run build`
# produced new hashes for all seventy-odd HTML files — every retry uploaded a
# fresh set and the deploy never finished. That is the hour this project once
# spent watching a progress bar that could not reach the end. The build id is now
# a hash of the source, so a rebuild with unchanged code produces byte-identical
# files, and a retry is genuinely a resume.
#
# WHICH IS WHY THIS DOES NOT REBUILD BETWEEN ATTEMPTS.
# The build in `.next` is already correct. Rebuilding would cost three minutes an
# attempt and change nothing.
#
#     ./scripts/deploy-hosting.sh          # 8 cəhd, aralarda 30 saniyə
#     ./scripts/deploy-hosting.sh 15       # daha çox

set -uo pipefail

ATTEMPTS="${1:-8}"
PAUSE=30

cd "$(dirname "$0")/.." || exit 1

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb:  gcloud config set project qapindanew" >&2
  exit 1
fi

# The build has to exist. Deploying with no `.next` publishes an empty site,
# which is a far worse outcome than a failed upload and is not obvious from the
# output — the command succeeds.
if [ ! -d ".next" ]; then
  echo "ℹ️  .next yoxdur — build edilir (bir dəfə)."
  npm run build || { echo "❌ Build alınmadı." >&2; exit 1; }
fi

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo
  echo "══════════════════════════════════════════════"
  echo "▶  Cəhd $attempt / $ATTEMPTS"
  echo "══════════════════════════════════════════════"

  if firebase deploy --only hosting --non-interactive; then
    echo
    echo "🎉 Sayt göndərildi: https://qapindanew.web.app"
    exit 0
  fi

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo
    echo "⏳ ${PAUSE}s gözlə — yüklənmiş fayllar saxlanılır, növbəti cəhd qalanları göndərir."
    sleep "$PAUSE"
  fi
done

echo
echo "❌ $ATTEMPTS cəhddən sonra da bitmədi."
echo
echo "Hər cəhddə say irəliləyirsə (20 → 60 → 95) problem yoxdur, sadəcə"
echo "yavaşdır — skripti yenidən işlət, qaldığı yerdən davam edəcək."
echo
echo "Say irəliləmirsə Cloud Shell şəbəkəsi tam kəsilib:"
echo "  ⋮ → Restart, sonra:  gcloud config set project qapindanew"
exit 1
