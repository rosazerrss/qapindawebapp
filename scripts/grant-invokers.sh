#!/usr/bin/env bash
#
# QAPINDA — Letting the browser call the callables.
#
# WHY THIS IS A SCRIPT AND NOT A LOOP OVER EVERY SERVICE
# ------------------------------------------------------
# Firebase's own step that grants `allUsers` the invoker role fails on this
# project, so it has to be done by hand after every functions deploy. The
# obvious way to do that is a loop over `gcloud run services list`, and that
# loop is dangerous.
#
# A Cloud Functions v2 deployment is a Cloud Run service whatever kind of
# function it is. `deliverPush` is a Firestore trigger and `expireStaleOrders`
# is a scheduled job — neither is ever called by a browser, and both would
# accept a forged request from anyone on the internet if `allUsers` could invoke
# them. For `deliverPush` that means an outsider crafting an event and sending
# any push notification to any account: order codes, refund amounts, links.
#
# Triggers and scheduled jobs are invoked by Google's own service agents, which
# already have permission. They need nothing from this file. So this grants the
# role to the callables only, and it works out which those are by reading the
# source rather than by trusting a list somebody keeps up to date.

set -uo pipefail

REGION="europe-west1"

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
# The callables — every `onCall`, and nothing else.
#
# `onRequest` is deliberately excluded too, with one exception below: those are
# webhooks, and each has its own signature check. Handing them out here would
# be a second, blunter answer to a question their own code already answers.
# ---------------------------------------------------------------------------
mapfile -t CALLABLES < <(node -e "
  const fs = require('fs');
  const path = require('path');

  /** Every .ts file under functions/src, minus the copies and the generated. */
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'shared' || entry.name === 'generated') return [];
        return walk(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  const names = new Set();
  for (const file of walk('functions/src')) {
    const source = fs.readFileSync(file, 'utf8');
    // \`export const X = onCall(\` — the shape every callable in this codebase
    // is declared with.
    for (const m of source.matchAll(/export const (\w+) = onCall\(/g)) {
      names.add(m[1]);
    }
  }

  // Cloud Run lowercases the service name.
  console.log([...names].map((n) => n.toLowerCase()).sort().join('\n'));
")

# The one HTTP endpoint that genuinely must be public: Epoint's callback is
# posted by Epoint's servers, not by a signed-in browser, and it verifies the
# provider's signature itself before it trusts a single field.
CALLABLES+=("epointcallback")

TOTAL=${#CALLABLES[@]}
echo "🔑 $TOTAL callable-a roles/run.invoker verilir ($REGION)."
echo "   Trigger və cədvəl funksiyalarına toxunulmur — qəsdən."
echo

OK=0
SKIPPED=()
FIRST_ERROR=""

for service in "${CALLABLES[@]}"; do
  # The error is CAPTURED, not discarded.
  #
  # This loop used to send stderr to /dev/null, and the first time it failed it
  # failed for all ninety-four at once and said nothing about why — which is
  # the least useful possible output for the one problem this script has ever
  # had. gcloud's message names the exact cause (a missing permission, an
  # organisation policy forbidding allUsers, a service that was never
  # deployed), and it is the only thing worth reading here.
  if error=$(gcloud run services add-iam-policy-binding "$service" \
      --region="$REGION" \
      --member="allUsers" \
      --role="roles/run.invoker" \
      --quiet 2>&1 >/dev/null); then
    OK=$((OK + 1))
    printf '   ✅ %s\n' "$service"
  else
    SKIPPED+=("$service")
    printf '   ⚠️  %s\n' "$service"
    # Only the first, in full. Ninety-four copies of one message is noise, and
    # when they differ the first is still where to start.
    [ -z "$FIRST_ERROR" ] && FIRST_ERROR="$error"
  fi
done

echo
echo "✅ $OK / $TOTAL"

if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo
  echo "Bunlara icazə verilmədi:"
  printf '   - %s\n' "${SKIPPED[@]}"
  echo
  echo
  echo "──── gcloud nə dedi ────"
  echo "$FIRST_ERROR"
  echo "────────────────────────"
  echo
  echo "Hamısı uğursuz olubsa səbəb tək və ümumidir — funksiyanın özündə deyil:"
  echo
  echo "  • «PERMISSION_DENIED ... setIamPolicy» → hesabında roles/run.admin yoxdur"
  echo "  • «constraint ... allowedPolicyMemberDomains» → təşkilat siyasəti"
  echo "    allUsers-i qadağan edir (Domain Restricted Sharing)"
  echo "  • «Service ... not found» → funksiya deploy olunmayıb, əvvəlcə"
  echo "    ./scripts/deploy-functions.sh işlət"
  exit 1
fi
