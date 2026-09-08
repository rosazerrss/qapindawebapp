#!/usr/bin/env bash
#
# QAPINDA — Deploying the functions in batches.
#
# WHY THIS EXISTS
# ---------------
# `firebase deploy --only functions` sends every function in one run. At a
# hundred and seven of them that stopped working from Cloud Shell: the requests
# go out faster than the connection carries them and firebase-tools reports
#
#     Failed to make request to https://cloudfunctions.googleapis.com/v2/...
#
# for most of the batch. It reads like a permissions problem and is not one —
# a permissions failure says PERMISSION_DENIED, and in a failed run some
# functions still deploy successfully, which no permission error would allow.
# It is the volume.
#
# So this deploys in batches, waits between them, and — the part that makes it
# worth having — RETRIES ONLY WHAT FAILED. A blanket re-run of the whole deploy
# spends twenty minutes redoing the eighty that already worked in order to
# reach the six that did not.
#
# HOW TO USE IT
#
#     ./scripts/deploy-functions.sh              # everything, in batches
#     ./scripts/deploy-functions.sh 12           # a different batch size
#
# It is safe to run again after a partial failure. Deploying a function that is
# already current is a no-op on Google's side.

set -uo pipefail

BATCH_SIZE="${1:-10}"
PAUSE_SECONDS=20
MAX_ATTEMPTS=3

# ---------------------------------------------------------------------------
# The trap that cost an evening, checked in one line.
#
# Cloud Shell forgets `core/project` whenever its VM is recreated, which it does
# on its own schedule. Without it every `gcloud` call below fails with "Failed
# to find attribute [project]" — and because this script tries ninety-four of
# them, the output is ninety-four identical warnings and no cause. It reads
# exactly like a permissions problem or an organisation policy, and it is
# neither: gcloud simply does not know which project it is talking about.
#
# One check, said once, with the fix in it.
# ---------------------------------------------------------------------------
PROJECT="$(gcloud config get-value project 2>/dev/null)"

if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb." >&2
  echo >&2
  echo "   Cloud Shell sessiya sıfırlananda bunu unudur. Düzəlişi:" >&2
  echo >&2
  echo "     gcloud config set project qapindanew" >&2
  echo >&2
  echo "   Sonra bu skripti yenidən işlət." >&2
  exit 1
fi

echo "📍 Layihə: $PROJECT"

cd "$(dirname "$0")/.." || exit 1

# ---------------------------------------------------------------------------
# The function list, read from the source rather than written down here.
#
# A hand-maintained list would be wrong the first time somebody adds a function
# and right-looking forever after — the deploy would simply skip it, with no
# error, and nobody would find out until the feature did not work in
# production.
# ---------------------------------------------------------------------------
mapfile -t FUNCTIONS < <(node -e "
  const fs = require('fs');
  let source = fs.readFileSync('functions/src/index.ts', 'utf8');
  // Comments first: an export block with a comment inside it would otherwise
  // yield prose as a function name.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*\$/gm, '');
  const names = [...source.matchAll(/export \{([^}]+)\} from/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*\$/.test(n));
  console.log([...new Set(names)].join('\n'));
")

TOTAL=${#FUNCTIONS[@]}
if [ "$TOTAL" -eq 0 ]; then
  echo "❌ functions/src/index.ts-dən funksiya siyahısı oxunmadı." >&2
  exit 1
fi

echo "📦 $TOTAL funksiya, $BATCH_SIZE-lik dəstələrlə."
echo

FAILED=()

deploy_batch() {
  local names=("$@")
  local spec=""
  for name in "${names[@]}"; do
    spec+="${spec:+,}functions:${name}"
  done

  firebase deploy --only "$spec" --non-interactive
}

# ---------------------------------------------------------------------------
# Pass one: every batch, in order.
# ---------------------------------------------------------------------------
index=0
batch_number=1
while [ "$index" -lt "$TOTAL" ]; do
  batch=("${FUNCTIONS[@]:index:BATCH_SIZE}")
  echo "──────────────────────────────────────────────"
  echo "▶  Dəstə $batch_number  (${#batch[@]} funksiya)"
  echo "──────────────────────────────────────────────"

  if deploy_batch "${batch[@]}"; then
    echo "✅ Dəstə $batch_number tamam."
  else
    echo "⚠️  Dəstə $batch_number uğursuz — sonda təkrar yoxlanacaq."
    FAILED+=("${batch[@]}")
  fi

  index=$((index + BATCH_SIZE))
  batch_number=$((batch_number + 1))

  # Breathing room. The failures are a rate problem, and going straight into
  # the next batch is how the second one fails for the same reason as the first.
  if [ "$index" -lt "$TOTAL" ]; then
    echo "⏳ ${PAUSE_SECONDS}s gözləyirəm..."
    sleep "$PAUSE_SECONDS"
  fi
done

# ---------------------------------------------------------------------------
# Pass two: only what failed, one at a time.
#
# Singly, because a batch that failed as a batch is exactly the case where the
# volume was the problem. One function per request is the slowest way to deploy
# and the most likely to succeed, which is the right trade for a handful.
# ---------------------------------------------------------------------------
attempt=1
while [ "${#FAILED[@]}" -gt 0 ] && [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo
  echo "══════════════════════════════════════════════"
  echo "🔁 Təkrar cəhd $attempt — ${#FAILED[@]} funksiya, bir-bir"
  echo "══════════════════════════════════════════════"

  RETRY=("${FAILED[@]}")
  FAILED=()

  for name in "${RETRY[@]}"; do
    echo "▶  $name"
    if deploy_batch "$name"; then
      echo "   ✅"
    else
      echo "   ❌ yenə alınmadı"
      FAILED+=("$name")
    fi
    sleep 5
  done

  attempt=$((attempt + 1))
done

echo
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "🎉 Bütün $TOTAL funksiya deploy olundu."
  echo
  echo "İndi callable-lara icazə ver (yalnız callable-lara — trigger və cədvəl"
  echo "funksiyalarına allUsers VERMƏ):"
  echo
  echo "  ./scripts/grant-invokers.sh"
  exit 0
fi

echo "❌ Bu funksiyalar hələ də deploy olunmadı:"
printf '   - %s\n' "${FAILED[@]}"
echo
echo "Şəbəkə davamlı kəsilirsə: Cloud Shell sessiyasını yenilə (⋮ → Restart)"
echo "və skripti təkrar işlət. Artıq deploy olunanlar yenidən göndərilmir."
exit 1
