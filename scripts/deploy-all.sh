#!/usr/bin/env bash
#
# QAPINDA — HƏR ŞEYİ SIFIRDAN GÖNDƏRMƏK.
#
# WHY THIS EXISTS AND WHY IT IS NOT `deploy-v40.sh`
# -------------------------------------------------
# Every `deploy-vNN.sh` in this folder is a RELEASE script: it names the handful
# of functions that release changed and sends only those. That is the right shape
# when the release before it actually went out.
#
# It is the wrong shape when it did not. If v37, v38 and v39 were never deployed,
# then running v40 sends eleven functions and leaves a hundred and nine behind at
# whatever version the server last accepted — and the site, which IS fully
# rebuilt, starts calling functions that do not exist yet. The symptom is not a
# deploy error. It is a working-looking site whose buttons return
# `functions/not-found` or, worse, an old function's old answer.
#
# So this script does not care which release anything came from. It sends the
# ENTIRE current source: rules, indexes, every function, the site. Slower, and
# the only thing that is actually true afterwards.
#
# WHY THE FUNCTION NAMES ARE READ FROM THE BUILD
# ----------------------------------------------
# Not typed into a list here. A list in a script is a claim about the code that
# stops being true the first time somebody adds an export and forgets this file —
# which is exactly the class of mistake that produced the situation above. The
# names are grepped out of `functions/lib/index.js` AFTER it is compiled, so they
# are the functions that exist, by construction.
#
# WHY IT FALLS BACK TO CHUNKS
# ---------------------------
# One `firebase deploy --only functions` is much faster than ten batched ones:
# the CLI uploads a single archive and Google fans it out. When it works it is
# the right call, so it is tried first.
#
# When it fails it fails ALL AT ONCE, and on Cloud Shell it fails often — a
# hundred and twenty functions is far past the per-minute Cloud Build quota, and
# a dropped connection anywhere in a twenty-minute call loses the whole thing.
# The fallback sends them twelve at a time. Each batch that lands is finished
# work: a re-run skips nothing, but a batch that already succeeded succeeds again
# in seconds because the source hash is unchanged.
#
#     ./scripts/deploy-all.sh
#
# Safe to run again from the top, as many times as needed.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

CHUNK=12
DEBUG_LOG="firebase-debug.log"

step() { echo; echo "══ $* ═══════════════════════════════════"; }

# ---------------------------------------------------------------------------
# The generic error is not the error.
# ---------------------------------------------------------------------------
# `Error: An unexpected error has occurred.` is what firebase-tools prints when
# it has an error object it does not recognise. The real message — quota, disk,
# permission, a build failure inside the Next.js adapter — is in the debug log
# and nowhere else. Printing the tail of it here turns ten identical useless
# lines into one that says what happened.
show_debug() {
  [ -f "$DEBUG_LOG" ] || return 0
  echo
  echo "── firebase-debug.log (son sətirlər) ──────────"
  # Captured, not piped straight to `tail`: a `grep` that matches nothing still
  # ends the pipeline successfully, so `grep … || tail` would print the useful
  # fallback exactly never.
  local picked
  picked="$(grep -iE '\[error\]|Error:|quota|exceeded|permission|denied|ENOSPC|ENOMEM|out of memory|Failed to' "$DEBUG_LOG" | tail -12)"
  if [ -n "$picked" ]; then
    echo "$picked"
  else
    tail -20 "$DEBUG_LOG"
  fi
  echo "───────────────────────────────────────────────"
}

# ---------------------------------------------------------------------------
step "0/5  Yoxlamalar"
# ---------------------------------------------------------------------------
PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ gcloud layihəsi təyin olunmayıb:" >&2
  echo "   gcloud config set project qapindanew" >&2
  exit 1
fi
echo "📍 Layihə: $PROJECT"

if ! firebase projects:list >/dev/null 2>&1; then
  echo "❌ Firebase girişi yoxdur. Bunu işlət, sonra bu skripti yenidən:" >&2
  echo "   firebase login --no-localhost" >&2
  exit 1
fi
echo "✅ Firebase girişi"

# Disk. Cloud Shell has 5 GB, and the hosting deploy copies the whole build into
# `.firebase/` — so the run needs room for a SECOND copy of `.next`. When it runs
# out, firebase-tools does not say "disk full"; it says "An unexpected error has
# occurred", which is the exact line that sent this project in a circle.
AVAIL_MB=$(df -Pm . | awk 'NR==2 {print $4}')
echo "💾 Boş yer: ${AVAIL_MB} MB"
if [ "${AVAIL_MB:-0}" -lt 1500 ]; then
  echo "⚠️  Yer azdır — təmizlənir."
  rm -rf .firebase .next "$HOME"/*.zip 2>/dev/null
  npm cache clean --force >/dev/null 2>&1
  echo "💾 İndi: $(df -Pm . | awk 'NR==2 {print $4}') MB"
fi

# ---------------------------------------------------------------------------
step "1/5  Qaydalar və indekslər"
# ---------------------------------------------------------------------------
# First, always. An index is built in the background and a function deployed
# ahead of the index it needs answers its very first query with a permission
# error that reads exactly like a bug in the function.
for attempt in 1 2 3; do
  if firebase deploy --only firestore:rules,firestore:indexes,storage --non-interactive; then
    echo "✅ Qaydalar və indekslər"
    break
  fi
  show_debug
  [ "$attempt" = "3" ] && { echo "❌ Qaydalar göndərilmədi." >&2; exit 1; }
  echo "⏳ 20s…"; sleep 20
done

# ---------------------------------------------------------------------------
step "2/5  Funksiyalar qurulur"
# ---------------------------------------------------------------------------
node scripts/sync-shared.mjs || { echo "❌ sync-shared alınmadı." >&2; exit 1; }
npm --prefix functions run build || { echo "❌ Funksiya build alınmadı." >&2; exit 1; }

# The names, from the compiled output rather than from a list somebody maintains.
mapfile -t NAMES < <(
  grep -o 'Object.defineProperty(exports, "[A-Za-z0-9_]*"' functions/lib/index.js \
    | sed 's/.*"\(.*\)"/\1/' \
    | grep -v '^__' \
    | sort -u
)

if [ "${#NAMES[@]}" -lt 50 ]; then
  echo "❌ Yalnız ${#NAMES[@]} funksiya tapıldı — build natamamdır." >&2
  exit 1
fi
echo "✅ ${#NAMES[@]} funksiya tapıldı."

# ---------------------------------------------------------------------------
step "3/5  Funksiyalar göndərilir"
# ---------------------------------------------------------------------------
# `--force` for two reasons, both real: two functions keep a warm instance, which
# raises the minimum bill and which the CLI refuses to do silently; and a full
# functions deploy removes anything on the server that is no longer in the
# source, which is the point of a full sync and which it also refuses to do
# silently.
FUNCTIONS_OK=0

echo "▶ Hamısı birdən (sürətli yol)…"
if firebase deploy --only functions --non-interactive --force; then
  echo "✅ Bütün funksiyalar göndərildi."
  FUNCTIONS_OK=1
else
  show_debug
  echo
  echo "ℹ️  Birdən alınmadı — 12-lik dəstələrlə göndərilir."
  echo "   Bu normaldır və uzun çəkir. Kəsilsə eyni əmri yenidən işlət."

  TOTAL=${#NAMES[@]}
  FAILED=()
  index=0

  while [ "$index" -lt "$TOTAL" ]; do
    batch=("${NAMES[@]:index:CHUNK}")
    only=""
    for name in "${batch[@]}"; do only="${only},functions:${name}"; done
    only="${only#,}"

    number=$(( index / CHUNK + 1 ))
    total_batches=$(( (TOTAL + CHUNK - 1) / CHUNK ))
    echo
    echo "── Dəstə $number / $total_batches  (${batch[0]} …) ──"

    sent=0
    for attempt in 1 2 3; do
      if firebase deploy --only "$only" --non-interactive --force; then
        sent=1; break
      fi
      show_debug
      [ "$attempt" = "3" ] || { echo "⏳ 30s…"; sleep 30; }
    done

    if [ "$sent" = "0" ]; then
      FAILED+=("${batch[@]}")
      echo "⚠️  Bu dəstə getmədi — sonda yenidən cəhd olunacaq."
    fi

    index=$(( index + CHUNK ))
  done

  if [ "${#FAILED[@]}" -eq 0 ]; then
    echo; echo "✅ Bütün dəstələr göndərildi."
    FUNCTIONS_OK=1
  else
    echo; echo "── Getməyən ${#FAILED[@]} funksiya üçün son cəhd ──"
    only=""
    for name in "${FAILED[@]}"; do only="${only},functions:${name}"; done
    if firebase deploy --only "${only#,}" --non-interactive --force; then
      echo "✅ Qalanlar da getdi."
      FUNCTIONS_OK=1
    else
      show_debug
      echo "❌ Bunlar hələ də getmədi:" >&2
      printf '   %s\n' "${FAILED[@]}" >&2
    fi
  fi
fi

# Public callables need the invoker role explicitly; a function deployed for the
# first time does not get it. Runs whatever happened above — it is idempotent and
# a missing role looks like a permission bug in the app, not a deploy problem.
./scripts/grant-invokers.sh || echo "⚠️  Sonra işlət: ./scripts/grant-invokers.sh"

# ---------------------------------------------------------------------------
step "4/5  Sayt qurulur"
# ---------------------------------------------------------------------------
# `.next` and `.firebase` both go. A stale `.firebase` is the cached copy of a
# PREVIOUS build, and hosting deploys that copy — the one case where a deploy
# succeeds and publishes the wrong site.
rm -rf .next .firebase
npm run build || { echo "❌ Sayt build alınmadı." >&2; show_debug; exit 1; }

# ---------------------------------------------------------------------------
step "5/5  Sayt göndərilir"
# ---------------------------------------------------------------------------
HOSTING_OK=0
for attempt in 1 2 3 4 5 6 7 8; do
  echo
  echo "▶ Cəhd $attempt / 8"
  if firebase deploy --only hosting --non-interactive; then
    HOSTING_OK=1
    break
  fi
  show_debug
  # Not rebuilt between attempts: `generateBuildId` in next.config.ts makes a
  # rebuild byte-identical, so the files already uploaded are skipped and the
  # retry genuinely resumes. Rebuilding would cost three minutes and change
  # nothing.
  AVAIL_MB=$(df -Pm . | awk 'NR==2 {print $4}')
  if [ "${AVAIL_MB:-0}" -lt 600 ]; then
    echo "⚠️  Disk dolur (${AVAIL_MB} MB) — npm keşi silinir."
    npm cache clean --force >/dev/null 2>&1
  fi
  [ "$attempt" = "8" ] || { echo "⏳ 30s…"; sleep 30; }
done

# ---------------------------------------------------------------------------
echo
echo "══════════════════════════════════════════════"
if [ "$FUNCTIONS_OK" = "1" ] && [ "$HOSTING_OK" = "1" ]; then
  cat <<'DONE'
HƏR ŞEY GÖNDƏRİLDİ ✅
══════════════════════════════════════════════

  https://qapindanew.web.app

BİR DƏFƏLİK — İNDİ ET
  Admin panel → Ayarlar → «Axtarış indeksini
  yenidən qur».
  Bu düymə həm axtarış sözlərini, həm də hər
  yeməyin endirim bayrağını yazır. İşlədənə qədər
  heç bir restoranda «Endirim» görünməyəcək.

  Elə orada, altında: «Sifariş saylarını bərpa et»
  — köhnə hesabların sifariş sayı üçün. Bu ikisi
  bir dəfə işlədilir, sonra bir daha lazım deyil.

YOXLA
  1. Endirimli yemək → menyuda və ana səhifədə
     «Endirim» nişanı.
  2. Admin → Restoranlar → ulduz → «Reklam —
     ödənişli» → kartda «Reklam» yazısı.
  3. Çek: qapı telefonu müştərinin öz nömrəsi ilə
     eynidirsə təkrar yazılmamalıdır.
  4. Sifarişlərim → «Restorana zəng et».
  5. Axtar səhifəsi: girən kimi restoran siyahısı
     GÖRSƏNMƏMƏLİDİR.
  6. Giriş et → «Hesabım» → giriş ekranı
     çaxmamalıdır.
DONE
else
  echo "BİTMƏDİ"
  echo "══════════════════════════════════════════════"
  [ "$FUNCTIONS_OK" = "1" ] || echo "  ✗ Funksiyalar"
  [ "$HOSTING_OK" = "1" ]   || echo "  ✗ Sayt"
  echo
  echo "Yuxarıda «firebase-debug.log (son sətirlər)» yazan"
  echo "hissəni mənə göndər — orada əsl səbəb yazılır."
  echo
  echo "Ən çox rast gəlinən iki səbəb:"
  echo "  • Disk dolub  →  df -h ~   (1 GB-dan az qalıbsa)"
  echo "  • Şəbəkə kəsilib → ⋮ → Restart, sonra:"
  echo "      gcloud config set project qapindanew"
  echo
  echo "Skripti yenidən işlət — getmiş hissə yenidən getmir."
  exit 1
fi
echo "══════════════════════════════════════════════"
