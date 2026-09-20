#!/usr/bin/env bash
#
# Repeatedly hit one Kernelia cron endpoint from inside a single GitHub
# Actions job.
#
# WHY A LOOP AND NOT JUST MORE CRON ENTRIES
# -----------------------------------------
# `.github/workflows/cron.yml` asks for 48 classify ticks and 24
# broadcast ticks a day. Measured against `cron_runs`, GitHub delivered
# exactly that until 2026-08-31 and then, from 2026-09-01, dropped to
# 6-7 classify and 5-7 broadcast ticks a day — an ~87% shortfall, with
# the ticks that did land arriving 20-50 minutes late. The repo is
# public (unlimited Actions minutes) and nothing in the workflow
# changed, so this is the scheduler deprioritising a low-activity repo,
# which is documented best-effort behaviour we cannot appeal.
#
# The pipeline was sized for the requested cadence, so the shortfall
# starved classify (~18 articles/day of capacity against ~45/day
# arriving), the pending queue grew to 362, every classified article
# aged past the broadcast lookback, and the channels went silent for
# two weeks.
#
# The fix is to stop depending on tick COUNT. A scheduled run is now an
# entry point, not a unit of work: each one stays alive and calls its
# endpoint every INTERVAL_SECONDS for up to ITERATIONS times. Six
# delivered runs a day of a 17-call classify loop beat 48 single-call
# ticks that GitHub never delivers.
#
# Usage: cron-call.sh <path> [query]
#   ITERATIONS         how many calls to make (default 1)
#   INTERVAL_SECONDS   sleep between calls (default 180)
#   BASE_URL           https://host — no path, no trailing slash
#   CRON_SECRET        bearer token
set -euo pipefail

PATH_SEGMENT="${1:?usage: cron-call.sh <path> [query]}"
QUERY="${2:-}"
ITERATIONS="${ITERATIONS:-1}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-180}"

# Fail loud if the secrets are missing. Without this guard GitHub
# silently substitutes "" and curl reports the unhelpful
# "URL rejected: No host part in the URL" — costing one cron tick
# to figure out the real cause.
: "${BASE_URL:?KERNELIA_PROD_URL secret is empty/unset in repo settings}"
: "${CRON_SECRET:?CRON_SECRET secret is empty/unset in repo settings}"

# Trim leading/trailing whitespace (incl. the trailing \n that commonly
# sneaks in via copy-paste from Vercel) and a trailing slash.
BASE_URL="${BASE_URL#"${BASE_URL%%[![:space:]]*}"}"
BASE_URL="${BASE_URL%"${BASE_URL##*[![:space:]]}"}"
BASE_URL="${BASE_URL%/}"
if [[ ! "$BASE_URL" =~ ^https?://[^/]+$ ]]; then
  echo "::error::KERNELIA_PROD_URL is malformed (length=${#BASE_URL}). Expected something like https://kernelia.dev — no trailing slash, no quotes, no whitespace." >&2
  exit 1
fi

url="${BASE_URL}${PATH_SEGMENT}${QUERY}"
failures=0

for ((i = 1; i <= ITERATIONS; i++)); do
  echo "::group::${PATH_SEGMENT} — call ${i}/${ITERATIONS}"
  # No --retry and no --fail-with-body: every handler enforces its own
  # wall-clock budget and returns 200 with a summary rather than 5xx.
  # A retry would just burn provider tokens. We also refuse to abort
  # the whole loop on one bad call — a transient 5xx at call 3 must not
  # cost us the remaining 14 calls, which are the entire point of
  # looping. Failures are tallied and reported at the end instead.
  if ! curl --silent --show-error \
    --max-time 90 \
    --write-out "\nHTTP %{http_code} in %{time_total}s\n" \
    --header "Authorization: Bearer ${CRON_SECRET}" \
    "${url}"; then
    failures=$((failures + 1))
    echo "::warning::call ${i}/${ITERATIONS} to ${PATH_SEGMENT} failed"
  fi
  echo "::endgroup::"

  # Don't sleep past the final call — it would just hold the runner
  # open for nothing.
  if ((i < ITERATIONS)); then
    sleep "${INTERVAL_SECONDS}"
  fi
done

if ((failures > 0)); then
  echo "::error::${failures}/${ITERATIONS} calls to ${PATH_SEGMENT} failed"
  exit 1
fi
echo "${ITERATIONS}/${ITERATIONS} calls to ${PATH_SEGMENT} succeeded"
