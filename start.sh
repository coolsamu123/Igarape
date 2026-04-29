#!/bin/bash
set -u

PORT="${PORT:-3333}"
HOST="http://localhost:${PORT}"

echo "============================================"
echo "  Strom — Portfolio Intelligence"
echo "  Air Liquide IT Portfolio Analytics"
echo "============================================"
echo ""
echo "Starting server on ${HOST}"
echo "Press Ctrl+C to stop"
echo ""

# Make this shell (and any child, including next-server) the first OOM target
# so the kernel kills the dev server instead of vscode-server / sshd if RAM runs out.
echo 1000 > /proc/$$/oom_score_adj 2>/dev/null || true

# Cap Node heap so the dev server cannot balloon uncontrollably.
# 3072 MB is comfortable now that we have 4 GiB swap to absorb spikes.
export NODE_OPTIONS="--max-old-space-size=3072 ${NODE_OPTIONS:-}"

# Optional: enable Turbopack (Rust-based bundler, much faster cold compiles)
#   STROM_TURBO=1 ./start.sh
EXTRA_FLAGS=""
if [ "${STROM_TURBO:-0}" = "1" ]; then
  echo "→ Turbopack enabled (experimental)"
  EXTRA_FLAGS="--turbo"
fi

# Auto-discovery scheduler. Defaults: enabled, fires at 06:00/14:00/22:00 host time.
#   STROM_AUTO_DISCOVERY=0      disables the scheduler entirely (dev convenience)
#   STROM_AUTO_CRON='...'       single full-mode schedule (back-compat)
#   STROM_AUTO_CRON_FULL='...'  full pipeline schedule (discover → ... → impact)
#   STROM_AUTO_CRON_GOALS='...' goals-only schedule (skips Impact, cheaper)
#   STROM_LLM_DAILY_CAP=500     daily cap on LLM API calls (any caller, all providers)
if [ "${STROM_AUTO_DISCOVERY:-1}" = "0" ]; then
  echo "→ Auto-discovery scheduler disabled (STROM_AUTO_DISCOVERY=0)"
else
  if [ -n "${STROM_AUTO_CRON_GOALS:-}" ] || [ -n "${STROM_AUTO_CRON_FULL:-}" ]; then
    [ -n "${STROM_AUTO_CRON_GOALS:-}" ] && echo "→ Scheduler goals-only: cron='${STROM_AUTO_CRON_GOALS}'"
    [ -n "${STROM_AUTO_CRON_FULL:-}" ]  && echo "→ Scheduler full:       cron='${STROM_AUTO_CRON_FULL}'"
  else
    echo "→ Scheduler full: cron='${STROM_AUTO_CRON:-*/10 * * * *}' (DB override may take precedence)"
  fi
  echo "→ LLM daily cap: ${STROM_LLM_DAILY_CAP:-500}"
fi

# Background warmup: once the server is ready, hit each route once so the
# on-demand compiler runs in parallel with the user's first interaction.
# Disable with STROM_WARMUP=0 ./start.sh
if [ "${STROM_WARMUP:-1}" = "1" ]; then
  (
    # Wait for the server to come up
    for i in $(seq 1 60); do
      if curl -fs -o /dev/null --max-time 2 "${HOST}/api/projects"; then
        break
      fi
      sleep 1
    done
    echo ""
    echo "→ Warming up routes in background..."
    # Pre-compile heavy API routes
    for path in \
      /api/projects \
      /api/drive \
      /api/drive/sheet \
      /api/goals \
      /api/impact \
      /api/services \
      /api/services/mapping \
      /api/prompts \
      /api/admin/config \
      /api/admin/service-account ; do
      curl -fs -o /dev/null --max-time 90 "${HOST}${path}" &
    done
    # Pre-compile pages by visiting them
    curl -fs -o /dev/null --max-time 90 "${HOST}/" &
    curl -fs -o /dev/null --max-time 90 "${HOST}/admin" &
    wait
    echo "→ Warmup complete."
  ) &
fi

exec npm run dev -- -p "${PORT}" ${EXTRA_FLAGS}
