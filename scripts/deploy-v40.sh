#!/usr/bin/env bash
#
# QAPINDA v40 — çek, endirim nişanı, reklam yeri və e-poçt qəbzi.
#
# WHAT IS IN IT
# -------------
#   • The printed slip no longer repeats the customer's own telephone number as
#     the door contact. It prints that block only when it is somebody else.
#   • The call button says "Restorana zəng et" instead of naming the restaurant
#     a second time under its own heading.
#   • A restaurant with a discounted dish gets an "Endirim" mark on its card,
#     and the dish gets one in the menu. The word only — no code, no conditions.
#   • "Seçilmiş" splits in two. The editorial pick stays free and unlabelled; a
#     sold slot reads "Reklam", carries an end date, and posts its fee to the
#     restaurant's ledger so the monthly settlement collects it beside the
#     commission.
#   • The customer is emailed an itemised receipt when their order completes.
#   • The search screen no longer opens on the whole catalogue. It opens on the
#     four things that actually shorten a search — cuisines, this device's own
#     recent searches, the paid slots (labelled), and what other people search
#     for and then open — and the grid appears once a word or a category
#     narrows it. The popular terms are counted on the OPEN, not the keystroke:
#     a term somebody typed and abandoned is a search that failed.
#
# ORDER
# -----
#   1. INDEXES FIRST, and this release genuinely needs them. Two new ones back
#      queries the new code issues on its very first run: `products` by
#      restaurant and discount, and `restaurants` by promotion and end date. A
#      function deployed before its index answers those with a permission error
#      that reads exactly like a bug in the function.
#   2. FUNCTIONS SECOND — eight of them.
#   3. THE SITE LAST.
#
# AFTER THE DEPLOY, RUN THE MENU BACKFILL ONCE. Existing dishes have no
# `discounted` value, so no restaurant shows the mark until it has. The message
# at the end says where the button is.
#
#     ./scripts/deploy-v40.sh
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
  saveProduct
  deleteProduct
  setProductAvailability
  bulkAdjustPrices
  backfillProductSearch
  setRestaurantFeatured
  expirePromotions
  recordSearchHit
  removeSearchTerm
  settleDeliveredOrders
  updateOrderStatus
)

step() { echo; echo "── $* ─────────────────────────────"; }

# ---------------------------------------------------------------------------
step "1/3  Qaydalar və indekslər"
# ---------------------------------------------------------------------------
# Firestore indeksi arxa planda qurur və deploy hazır olmamış qayıdır. Boş
# kolleksiyada bu bir neçə saniyədir; ona görə indekslər birinci gedir.
# Qaydalar da gedir: `searchTerms` yeni kolleksiyadır — hamı oxuya bilir,
# heç kim yaza bilmir. Funksiyalar ora yazmağa başlamazdan əvvəl qaydası
# yerində olmalıdır.
firebase deploy --only firestore:rules,firestore:indexes --non-interactive \
  || { echo "❌ Qaydalar/indekslər göndərilmədi." >&2; exit 1; }

# ---------------------------------------------------------------------------
step "2/3  Funksiyalar (11 ədəd)"
# ---------------------------------------------------------------------------
npm run functions:build || { echo "❌ Funksiya build alınmadı." >&2; exit 1; }

ONLY=""
for name in "${CHANGED[@]}"; do
  ONLY="${ONLY},functions:${name}"
done
ONLY="${ONLY#,}"

for attempt in 1 2 3; do
  echo "▶ Cəhd $attempt / 3"
  # `--force` — isti nüsxəli iki funksiyaya görə Firebase minimum hesabı
  # təsdiqlətmək istəyir. Xərc v36-dan bəridir.
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
v40 GÖNDƏRİLDİ
══════════════════════════════════════════════

BİR DƏFƏLİK — ENDİRİM NİŞANI ÜÇÜN
  Admin panel → Ayarlar → «Axtarış indeksini
  yenidən qur» → işlət.

  Bu düymə indi həm axtarış sözlərini, həm də
  hər yeməyin endirim bayrağını yazır. İşlədənə
  qədər heç bir restoranda «Endirim» görünməyəcək
  — bu normaldır.

YOXLA:
  1. Bir yeməyə köhnə qiymət yaz (məsələn qiymət
     5 ₼, köhnə qiymət 7 ₼). Menyuda «Endirim»
     nişanı çıxmalı, ana səhifədə restoran kartında
     da çıxmalıdır.
  2. Admin → Restoranlar → ulduza bas.
     «Reklam — ödənişli» seç, 1 ay, qiymət yaz.
     Kartda «Reklam» yazısı görünməlidir, «Seçilmiş»
     yox. Hesablaşmada bir sətir əlavə olunmalıdır.
  3. Yeni bir sifariş ver və çap et — qapı telefonu
     müştərinin öz nömrəsi ilə eynidirsə, çekdə
     TƏKRAR YAZILMAMALIDIR.
  4. Sifarişlərim → qırmızı düymə «Restorana zəng et»
     olmalıdır, restoranın adı təkrarlanmamalıdır.
  5. AXTAR səhifəsi: girən kimi restoran siyahısı
     GÖRSƏNMƏMƏLİDİR. Mətbəxlər, son axtarışlar,
     reklam və populyar sözlər olmalıdır. Bir söz
     yazanda restoranlar çıxmalıdır.
  6. Bir axtarış et, nəticədən restorana gir, sonra
     Axtar-a qayıt — həmin söz «Son axtarışlar»da
     olmalıdır, yanında × ilə.

E-POÇT QƏBZİ
  Sifariş tamamlananda (çatdırılmadan 60 dəq sonra)
  müştəriyə qəbz gedir — YALNIZ e-poçtu təsdiqlənmiş
  hesaba. Özün üçün sınamaq istəsən: Hesabım →
  e-poçtu təsdiqlə, sonra bir sifariş ver.

══════════════════════════════════════════════
DONE
