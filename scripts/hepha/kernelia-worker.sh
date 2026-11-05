#!/usr/bin/env bash
#
# Kernelia worker en Hepha (fase 9.D): ejecuta en la Pi los jobs que antes
# eran funciones de Vercel, para que no gasten CPU de la cuota Hobby.
#
#   kernelia-worker.sh ingest     # ingesta RSS (antes /api/cron/ingest)
#   kernelia-worker.sh og-cards   # tarjetas OG -> Supabase Storage
#   kernelia-worker.sh deploy     # actualiza ~/kernelia-worker a origin/main
#                                 # (KERNELIA_WORKER_BRANCH=<rama> para un PR)
#
# El repo es publico: el checkout vive en ~/kernelia-worker (git clone por
# HTTPS, sin credenciales) y `deploy` lo pone al dia una vez al dia. Las
# variables (DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE)
# van en ~/scripts/kernelia-worker.env, fuera del repo.
#
# Un cerrojo por job: si el tick anterior sigue vivo, este se salta (SKIP
# en el log). `deploy` espera a los dos para no cambiar el codigo o
# node_modules bajo un job en marcha.
set -euo pipefail

JOB="${1:?uso: kernelia-worker.sh <ingest|og-cards|deploy>}"
APP_DIR="${KERNELIA_WORKER_DIR:-${HOME}/kernelia-worker}"
ENV_FILE="${KERNELIA_WORKER_ENV:-${HOME}/scripts/kernelia-worker.env}"
LOCK_DIR="${KERNELIA_WORKER_LOCK_DIR:-${HOME}/scripts}"
LOG="${KERNELIA_WORKER_LOG:-${HOME}/scripts/kernelia-worker.log}"
REPO_URL="https://github.com/raulfdeztdo/kernelia.git"
# Rama a desplegar. Solo se cambia para probar un PR antes del merge.
BRANCH="${KERNELIA_WORKER_BRANCH:-main}"
export PATH="/usr/local/bin:${PATH}"

log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${JOB}" "$1" >> "${LOG}"; }

rotate_log() {
  # ~60 lineas/dia; recortar a 2500 deja ~1 mes sin registrarlo en logrotate.
  if [ -f "${LOG}" ] && [ "$(wc -l < "${LOG}")" -gt 5000 ]; then
    tail -n 2500 "${LOG}" > "${LOG}.tmp" && mv "${LOG}.tmp" "${LOG}"
  fi
}

push_kuma() {
  # Opcional: KUMA_PUSH_URL en el .env. Nunca debe hacer fallar el tick.
  [ -n "${KUMA_PUSH_URL:-}" ] || return 0
  curl --silent --max-time 10 --get --data-urlencode "status=$1" \
    --data-urlencode "msg=$2" "${KUMA_PUSH_URL}" >/dev/null 2>&1 || true
}

mkdir -p "${LOCK_DIR}"

if [ "${JOB}" = "deploy" ]; then
  exec 8>"${LOCK_DIR}/kernelia-worker.ingest.lock"; flock --wait 600 8
  exec 9>"${LOCK_DIR}/kernelia-worker.og-cards.lock"; flock --wait 300 9
  if [ ! -d "${APP_DIR}/.git" ]; then
    git clone --quiet --depth 50 "${REPO_URL}" "${APP_DIR}"
  fi
  cd "${APP_DIR}"
  before="$(git rev-parse --short HEAD)"
  git fetch --quiet origin "${BRANCH}"
  git reset --quiet --hard FETCH_HEAD
  after="$(git rev-parse --short HEAD)"
  if [ "${before}" != "${after}" ] || [ ! -d node_modules ]; then
    CI=true pnpm install --frozen-lockfile --silent
  fi
  log "OK ${BRANCH} ${before} -> ${after}"
  rotate_log
  exit 0
fi

case "${JOB}" in
  ingest|og-cards) ;;
  *) echo "job desconocido: ${JOB}" >&2; exit 2 ;;
esac

exec 9>"${LOCK_DIR}/kernelia-worker.${JOB}.lock"
if ! flock --nonblock 9; then
  log "SKIP: el tick anterior sigue en marcha"
  exit 0
fi

# shellcheck source=/dev/null
set -a; . "${ENV_FILE}"; set +a

cd "${APP_DIR}"
started=$(date +%s)
# timeout: ingest tarda ~5-10 s en la Pi y og-cards < 1 min con un tick
# normal; 300 s solo corta un cuelgue de red.
set +e
out=$(KERNELIA_ENV_FILE=/dev/null timeout 300 \
  pnpm --silent exec tsx --tsconfig tsconfig.worker.json scripts/worker.ts "${JOB}" 2>&1)
code=$?
set -e
summary=$(printf '%s\n' "${out}" | grep '^{"job"' | tail -1)
[ -n "${summary}" ] || summary=$(printf '%s\n' "${out}" | tail -1)
elapsed=$(( $(date +%s) - started ))

if [ "${code}" -eq 0 ]; then
  log "OK ${elapsed}s ${summary}"
  push_kuma up "${JOB} ok"
else
  log "ERROR(${code}) ${elapsed}s ${summary}"
  push_kuma down "${JOB}: ${summary:0:200}"
fi
rotate_log
exit "${code}"
