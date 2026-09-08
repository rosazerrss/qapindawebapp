#!/usr/bin/env bash
#
# QAPINDA — Cloud Shell sıfırlanandan sonra hər şeyi yerinə qaytarmaq.
#
# WHAT A CLOUD SHELL RESET ACTUALLY BREAKS
# ----------------------------------------
# Not the files. `$HOME` sits on a persistent disk and survives — the project
# folder is still there after a reset, which is why this script updates it in
# place rather than starting again.
#
# What does NOT survive is everything outside `$HOME`:
#
#   • `gcloud config` forgets the project. Every gcloud call then fails with
#     "Failed to find attribute [project]", ninety-four times in a row, and the
#     output reads exactly like a permissions problem while being nothing of the
#     kind. This is the single most expensive minute in this whole file.
#   • Globally installed npm packages are gone. `firebase-tools` is preinstalled
#     by Google so it comes back; anything installed with `npm i -g` does not.
#   • `node_modules` may be there but stale against a newer `package.json`.
#
# WHAT THIS SCRIPT PROTECTS
# -------------------------
# `functions/.env` — the SMS keys, the mail key, the bootstrap secret. It is not
# in the zip (it never leaves the server) so unzipping cannot restore it, and
# unzipping also cannot delete it. It is copied aside anyway, because "cannot"
# is a claim about today's exclude list.
#
#     ./scripts/cloudshell-restore.sh <GOOGLE_DRIVE_FILE_ID>
#
# The id is the part of the share link between /d/ and /view.

set -uo pipefail

FILE_ID="${1:-}"
PROJECT_ID="qapindanew"
HOME_DIR="${HOME:-/home/$(whoami)}"
PROJECT_DIR="$HOME_DIR/qapinda"
ZIP="$HOME_DIR/qapinda-new.zip"
ENV_BACKUP="$HOME_DIR/.qapinda-functions-env.bak"

step() { echo; echo "── $* ─────────────────────────────"; }
die()  { echo "❌ $*" >&2; exit 1; }

[ -n "$FILE_ID" ] || die "Google Drive fayl ID-si lazımdır. İstifadə: ./scripts/cloudshell-restore.sh <ID>"

# ---------------------------------------------------------------------------
step "1/7  gcloud layihəsi"
# ---------------------------------------------------------------------------
gcloud config set project "$PROJECT_ID" --quiet || die "gcloud config set project alınmadı."
echo "✅ $PROJECT_ID"

# ---------------------------------------------------------------------------
step "2/7  Disk yeri"
# ---------------------------------------------------------------------------
# Cloud Shell gives 5 GB. Two node_modules trees plus a build is most of it, and
# the failure when it runs out is not "disk full" — it is a random npm or webpack
# error several minutes later that looks like a code problem.
AVAIL_MB=$(df -Pm "$HOME_DIR" | awk 'NR==2 {print $4}')
echo "Boş yer: ${AVAIL_MB} MB"
if [ "${AVAIL_MB:-0}" -lt 1200 ]; then
  echo "⚠️  Yer azdır — köhnə build və zip-lər silinir."
  rm -rf "$PROJECT_DIR/.next" 2>/dev/null
  rm -f "$HOME_DIR"/qapinda-v*.zip "$HOME_DIR"/*.zip 2>/dev/null
  npm cache clean --force >/dev/null 2>&1
  echo "Boş yer indi: $(df -Pm "$HOME_DIR" | awk 'NR==2 {print $4}') MB"
fi

# ---------------------------------------------------------------------------
step "3/7  functions/.env kənara götürülür"
# ---------------------------------------------------------------------------
if [ -f "$PROJECT_DIR/functions/.env" ]; then
  cp "$PROJECT_DIR/functions/.env" "$ENV_BACKUP"
  echo "✅ Saxlanıldı: $ENV_BACKUP"
else
  echo "ℹ️  functions/.env yoxdur — saxlanacaq bir şey yoxdur."
fi

# ---------------------------------------------------------------------------
step "4/7  Zip yüklənir"
# ---------------------------------------------------------------------------
rm -f "$ZIP"

# Direct download first. A file this size has no virus-scan interstitial, so the
# plain URL returns the archive rather than an HTML page — which is exactly what
# `unzip -t` below is checking, because a saved HTML error page has a .zip name
# and fails several steps later with something unrelated.
curl -sSL --fail-with-body \
  -o "$ZIP" \
  "https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t" \
  || echo "⚠️  curl alınmadı — gdown yoxlanacaq."

if ! unzip -tq "$ZIP" >/dev/null 2>&1; then
  echo "⚠️  Yüklənən fayl düzgün zip deyil. gdown ilə cəhd edilir..."
  rm -f "$ZIP"

  if ! command -v gdown >/dev/null 2>&1; then
    pip install --quiet --user gdown || die "gdown qurulmadı."
    export PATH="$HOME_DIR/.local/bin:$PATH"
  fi

  gdown --id "$FILE_ID" -O "$ZIP" || die "Zip yüklənmədi. Drive-da fayl «linki olan hər kəs» üçün açıqdırmı?"
  unzip -tq "$ZIP" >/dev/null 2>&1 || die "Yüklənən fayl hələ də düzgün zip deyil."
fi

echo "✅ $(du -h "$ZIP" | cut -f1)"

# ---------------------------------------------------------------------------
step "5/7  Açılır"
# ---------------------------------------------------------------------------
# THE SOURCE TREES ARE DELETED FIRST. THIS IS THE POINT OF THE STEP.
# -------------------------------------------------------------------
# `unzip -o` overwrites what the archive CONTAINS and touches nothing else. That
# reads as safe, and for a release that only edits files it is. For a release
# that RENAMES or DELETES one it is the opposite of safe: the old file is not in
# the archive, so nothing overwrites it, and it simply stays.
#
# v37 renamed every route folder — `src/app/hesabim` became `src/app/account`,
# and forty others like it. After an unzip-over, Cloud Shell held both. The old
# ones still referred to files the release had removed (`odenis/xeta` re-exports
# `../ugurlu/page`, which no longer exists), so `npm run build` failed, the
# deploy script stopped at that line, and NOTHING WAS EVER SENT. The site looked
# unchanged and the reason was three steps upstream of where anyone would look.
#
# So: every directory the archive supplies in full is removed before it is
# unpacked. What is NOT removed is everything that lives outside them and is not
# in the zip — `functions/.env`, `.env.local`, `node_modules`, any local note.
# Those are the files that must survive, and none of them is inside this list.
cd "$HOME_DIR" || die "cd $HOME_DIR alınmadı."

if [ -d "$PROJECT_DIR" ]; then
  # `scripts` is deliberately NOT in this list: this file is running from it.
  # Bash would keep reading the deleted inode on Linux, but relying on that to
  # finish a restore is not a trade worth making — and the archive overwrites
  # every script anyway. A leftover `deploy-v36.sh` beside `deploy-v40.sh` is
  # inert; a half-executed restore is not.
  for stale in src shared tests functions/src .next; do
    rm -rf "${PROJECT_DIR:?}/$stale"
  done
  echo "🧹 Köhnə qaynaq qovluqları silindi (adı dəyişən fayllar qalmasın deyə)."
fi

unzip -oq "$ZIP" || die "Açılmadı."
rm -f "$ZIP"

[ -d "$PROJECT_DIR" ] || die "$PROJECT_DIR yaranmadı — zip-in içindəki qovluq adı fərqli ola bilər."

if [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" "$PROJECT_DIR/functions/.env"
  echo "✅ functions/.env geri qoyuldu."
fi

# ---------------------------------------------------------------------------
step "6/7  Paketlər"
# ---------------------------------------------------------------------------
cd "$PROJECT_DIR" || die "cd alınmadı."

# `npm install`, not `npm ci`: ci deletes node_modules and re-downloads
# everything, which on Cloud Shell is several minutes and the step most likely
# to run the disk out. install reconciles what is already there.
npm install --no-audit --no-fund || die "npm install (kök) alınmadı."
(cd functions && npm install --no-audit --no-fund) || die "npm install (functions) alınmadı."

chmod +x scripts/*.sh

# ---------------------------------------------------------------------------
step "7/7  Yoxlama"
# ---------------------------------------------------------------------------
node scripts/sync-shared.mjs || die "sync-shared alınmadı."

# The routes are English as of v37. An Azerbaijani folder still sitting under
# `src/app` means the deletion above did not happen — an older copy of this
# script, an interrupted run — and the symptom is a build that fails for a
# reason ("module not found: ../ugurlu/page") that points nowhere near the
# cause. Better to say it here, in one line, than to let the deploy stop.
STALE=""
for old in hesabim giris admin-giris sebet odenis sifarislerim kuryer \
           restoran-paneli restoran-qosul axtar huquqi restoran; do
  [ -d "src/app/$old" ] && STALE="$STALE $old"
done
if [ -n "$STALE" ]; then
  echo "⚠️  Köhnə ünvan qovluqları qalıb:$STALE"
  echo "    Bunlar build-i dayandırır. Sil və yenidən işlət:"
  echo
  echo "     rm -rf$(printf ' src/app/%s' $STALE)"
  echo
fi

if firebase projects:list >/dev/null 2>&1; then
  echo "✅ firebase girişi keçərlidir."
else
  echo "⚠️  firebase girişi yoxdur. Bunu işlət, sonra davam et:"
  echo
  echo "     firebase login --no-localhost"
fi

cat <<'DONE'

══════════════════════════════════════════════
HAZIRDIR — İNDİ DEPLOY
══════════════════════════════════════════════

  cd ~/qapinda
  ./scripts/deploy-all.sh

BU, HƏR ŞEYİ GÖNDƏRİR — qaydalar, indekslər, bütün
120 funksiya və sayt. Bir neçə buraxılış göndərilmədən
qalıbsa lazım olan budur, `deploy-vNN.sh` deyil: onlar
yalnız o buraxılışın dəyişdirdiyi funksiyaları göndərir,
qalanı köhnə qalır.

Yarım saat çəkir. Yarıda kəsilsə eyni əmri yenidən
işlət — getmiş hissə yenidən getmir.

Xəta olsa skript firebase-debug.log-un əsl sətirlərini
çap edir. O hissəni göndər.
══════════════════════════════════════════════
DONE
