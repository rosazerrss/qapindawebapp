#!/usr/bin/env bash
#
# QAPINDA v38 — sürət limiti (rate limiting) və App Check hazırlığı.
#
# WHY THIS ONE DEPLOYS EVERY FUNCTION
# -----------------------------------
# The rate limit lives in `guard()`, and every one of the ninety-nine callables
# is wrapped in `guard()`. That is the point of putting it there — one place,
# and nothing can be forgotten — but it means every function's code changed, so
# every function has to go out. Naming a subset here would leave most of the
# platform unprotected while the deploy looked successful.
#
# Ninety-nine functions from Cloud Shell is the best part of an hour and it will
# probably drop part-way. That is expected and handled: Firebase skips a
# function whose code has not changed, so re-running the script resumes rather
# than restarting. Run it, watch it, and if it stops, run it again.
#
# ORDER
# -----
#   1. RULES AND INDEXES FIRST, and they are tiny. The new `rateLimits`
#      collection needs its rule (closed to every client) in place before the
#      functions start writing to it — not for correctness, since functions
#      bypass rules, but so there is never a window where a collection exists
#      with no rule written for it.
#   2. FUNCTIONS SECOND, all of them.
#   3. THE SITE LAST. Nothing in the browser changed in this release, but the
#      build is cheap and keeps the deployed bundle in step with the source.
#
# APP CHECK IS NOT TURNED ON HERE.
# The code for it has been ready since v35 and is gated on one environment
# variable, `APPCHECK_ENFORCE`. Turning it on before the reCAPTCHA key exists
# would refuse every call from the real app and look exactly like a total
# outage. The order is: create the key → set it in the browser build → confirm
# real traffic is carrying tokens in the Firebase console → only then set
# APPCHECK_ENFORCE=true and redeploy the functions. The steps are written out
# in the message at the end of this script.
#
#     ./scripts/deploy-v38.sh
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

step() { echo; echo "── $* ─────────────────────────────"; }

# ---------------------------------------------------------------------------
step "1/3  Qaydalar və indekslər"
# ---------------------------------------------------------------------------
# `rateLimits` bağlıdır — heç bir müştəri oxuya və yaza bilmir. Oxuya bilsəydi,
# hücumçu limitə nə qədər qaldığını görərdi; limitin gizlətdiyi yeganə məlumat elə odur.
#
# Indekslərdə bir təkrar da silindi (orders · status + deliveredAt iki dəfə
# yazılmışdı). 65 → 64.
firebase deploy --only firestore:rules,firestore:indexes --non-interactive \
  || { echo "❌ Qaydalar/indekslər göndərilmədi." >&2; exit 1; }

# ---------------------------------------------------------------------------
step "2/3  Funksiyalar — HAMISI (99 ədəd)"
# ---------------------------------------------------------------------------
npm run functions:build || { echo "❌ Funksiya build alınmadı." >&2; exit 1; }

echo
echo "⏳ Bu addım uzundur — 40-60 dəqiqə. Yarıda kəsilsə skripti yenidən işlət;"
echo "   göndərilmiş funksiya yenidən göndərilmir, qaldığı yerdən davam edir."
echo

for attempt in 1 2 3 4 5; do
  echo "▶ Cəhd $attempt / 5"
  # `--force` answers one specific question, and it is worth knowing which.
  #
  # `createOrder` and `startOnlinePayment` carry `minInstances: 1` — one warm
  # copy, always running, so that checkout never pays a cold start. A person
  # watching a spinner at the moment they are trying to pay is the most
  # expensive three seconds in the app.
  #
  # A warm instance costs money whether or not anybody orders (roughly 8-15 AZN
  # a month for the two), so the CLI refuses to raise the floor of the bill
  # without being asked. It cannot ask us — `--non-interactive` — so it stops.
  # The cost was accepted back in v36; this only re-answers the same question.
  #
  # If that bill ever needs to go away, the change is to drop `minInstances`
  # from those two functions, NOT to leave this flag off.
  if firebase deploy --only functions --non-interactive --force; then
    echo "✅ Funksiyalar göndərildi."
    break
  fi
  if [ "$attempt" = "5" ]; then
    echo "⚠️  Bitmədi. Skripti yenidən işlət — qaldığı yerdən davam edəcək." >&2
  else
    echo "⏳ 30s gözlə…"; sleep 30
  fi
done

# `createOrder` və `startOnlinePayment` isti nüsxə istəyir; yeni revizyon üçün
# çağırış icazəsi yenidən verilməlidir.
./scripts/grant-invokers.sh || echo "⚠️  İcazələri sonra ver: ./scripts/grant-invokers.sh"

# ---------------------------------------------------------------------------
step "3/3  Sayt"
# ---------------------------------------------------------------------------
rm -rf .next
npm run build || { echo "❌ Build alınmadı." >&2; exit 1; }
./scripts/deploy-hosting.sh 10

cat <<'DONE'

══════════════════════════════════════════════
v38 GÖNDƏRİLDİ — SÜRƏT LİMİTİ AKTİVDİR
══════════════════════════════════════════════

Artıq 99 funksiyanın hamısında limit var. Əvvəl
6-da var idi.

YOXLA (5 dəqiqə):
  1. Adi bir sifariş ver — heç nə dəyişməməlidir.
  2. Restoran panelində 10 məhsulu ard-arda
     «bitib» et — dayandırmamalıdır.
  3. Loglarda «rate limited» axtar:
       gcloud logging read 'textPayload:"rate limited"' \
         --project=qapindanew --limit=20 --freshness=1h
     Normal istifadədə BOŞ olmalıdır. Nəticə çıxırsa
     limit çox sərtdir — mənə de, qaldıraq.

══════════════════════════════════════════════
İNDİ APP CHECK — SƏNİN KONSOL İŞİN
══════════════════════════════════════════════

Sıra vacibdir. Tərsinə etsən sayt tamamilə dayanar.

ADDIM 1 — reCAPTCHA Enterprise açarı
  console.cloud.google.com → Security → reCAPTCHA
  → CREATE KEY → Website
  Domainlər:  qapindanew.web.app
              qapindanew.firebaseapp.com
              qapinda.az          (varsa)
  Açarı kopyala (6L… ilə başlayır).

ADDIM 2 — Firebase-də qeydiyyat
  console.firebase.google.com → Build → App Check
  → Apps → veb tətbiqini seç → reCAPTCHA Enterprise
  → açarı yapışdır → Save.
  ⚠️  «Enforce» düyməsinə HƏLƏ BASMA.

ADDIM 3 — açarı sayta ver
  ~/qapinda/.env.local faylına əlavə et:
      NEXT_PUBLIC_APPCHECK_SITE_KEY=6L...
  sonra:
      cd ~/qapinda && rm -rf .next && npm run build
      ./scripts/deploy-hosting.sh 10

ADDIM 4 — GÖZLƏ VƏ BAX (ən azı 1 gün)
  App Check → Metrics. «Verified requests» rəqəmi
  artmalıdır. Real trafikin demək olar hamısı
  «verified» olana qədər növbəti addıma keçmə.

ADDIM 5 — yalnız indi məcbur et
  Firebase konsolunda App Check → Enforce.
  Sonra funksiyalar üçün:
      cd ~/qapinda/functions
      echo "APPCHECK_ENFORCE=true" >> .env
      cd ~/qapinda && firebase deploy --only functions --force

Nəsə səhv gedərsə geri qaytarmaq bir sətirdir:
funksiyaların .env-indən APPCHECK_ENFORCE sətrini sil
və yenidən göndər.
══════════════════════════════════════════════
DONE
