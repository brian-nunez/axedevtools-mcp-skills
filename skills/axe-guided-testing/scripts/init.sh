#!/usr/bin/env bash
set -euo pipefail

# Start a fresh axe-mcp container for an agent-run IGT session.
#
# Usage:
#   init.sh <target-url>
#
# The first positional argument becomes TARGET_URL. If omitted, TARGET_URL must
# already exist in the environment.
#
# Required environment variables:
#   AXE_LOGIN_EMAIL
#   AXE_LOGIN_PASSWORD
#
# Optional environment variables:
#   AXE_SERVER_URL
#   IMAGE            default: axe-mcp:latest
#   CONTAINER        default: axe-mcp
#   PROFILE_VOLUME   default: axe-mcp-profile
#   MCP_PORT         default: 3000
#   NOVNC_PORT       default: 6080
#   VNC_PORT         default: 5900
#   CDP_PORT         default: 9222
#   ON_PREM          default: 0
#   READY_TIMEOUT    default: 60

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  init.sh <target-url>

Starts a fresh axe-mcp Docker container and waits until Chromium, noVNC,
DevTools, the axe DevTools panel, login, and startup scan are prepared.

Required environment variables:
  AXE_LOGIN_EMAIL
  AXE_LOGIN_PASSWORD

Optional environment variables:
  AXE_SERVER_URL
  TARGET_URL       fallback target URL when no argument is provided
  IMAGE            default: axe-mcp:latest
  CONTAINER        default: axe-mcp
  PROFILE_VOLUME   default: axe-mcp-profile
  MCP_PORT         default: 3000
  NOVNC_PORT       default: 6080
  VNC_PORT         default: 5900
  CDP_PORT         default: 9222
  ON_PREM          default: 0
  READY_TIMEOUT    default: 60
EOF
  exit 0
fi

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 <target-url>" >&2
  exit 64
fi

TARGET_URL="${1:-${TARGET_URL:-}}"

: "${TARGET_URL:?target URL argument or TARGET_URL environment variable is required}"
: "${AXE_LOGIN_EMAIL:?AXE_LOGIN_EMAIL must be set before running init.sh}"
: "${AXE_LOGIN_PASSWORD:?AXE_LOGIN_PASSWORD must be set before running init.sh}"
export TARGET_URL

IMAGE="${IMAGE:-axe-mcp:latest}"
CONTAINER="${CONTAINER:-axe-mcp}"
PROFILE_VOLUME="${PROFILE_VOLUME:-axe-mcp-profile}"
AXE_SERVER_URL="${AXE_SERVER_URL:-}"

MCP_PORT="${MCP_PORT:-3000}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
VNC_PORT="${VNC_PORT:-5900}"
CDP_PORT="${CDP_PORT:-9222}"
ON_PREM="${ON_PREM:-0}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"

echo "[axe-guided-testing] removing existing container and browser profile volume" >&2
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker volume rm -f "${PROFILE_VOLUME}" >/dev/null 2>&1 || true

echo "[axe-guided-testing] starting ${IMAGE} as ${CONTAINER}" >&2
docker run -d \
  --name "${CONTAINER}" \
  -p "${MCP_PORT}:3000" \
  -p "${NOVNC_PORT}:6080" \
  -p "${VNC_PORT}:5900" \
  -p "${CDP_PORT}:9222" \
  -e TARGET_URL \
  -e AXE_SERVER_URL="${AXE_SERVER_URL}" \
  -e AXE_LOGIN_EMAIL \
  -e AXE_LOGIN_PASSWORD \
  -e ON_PREM="${ON_PREM}" \
  -v "${PROFILE_VOLUME}:/home/pwuser/.axe-mcp-browser" \
  "${IMAGE}" >/dev/null

echo "MCP:      http://127.0.0.1:${MCP_PORT}/mcp"
echo "Health:   http://127.0.0.1:${MCP_PORT}/healthz"
echo "Liveness: http://127.0.0.1:${MCP_PORT}/livez"
echo "noVNC:    http://127.0.0.1:${NOVNC_PORT}/"
echo "VNC:      127.0.0.1:${VNC_PORT}"
echo "CDP:      http://127.0.0.1:${CDP_PORT}"

echo "[axe-guided-testing] waiting for prepared browser/devtools/axe panel" >&2
for _ in $(seq 1 "${READY_TIMEOUT}"); do
  if docker exec "${CONTAINER}" test -f /tmp/axe-mcp/ready.json >/dev/null 2>&1; then
    docker exec "${CONTAINER}" cat /tmp/axe-mcp/ready.json
    exit 0
  fi

  if docker exec "${CONTAINER}" test -f /tmp/axe-mcp/bootstrap-error.json >/dev/null 2>&1; then
    echo "Browser preparation failed; container is still running for visual validation." >&2
    docker exec "${CONTAINER}" cat /tmp/axe-mcp/bootstrap-error.json
    echo "noVNC: http://127.0.0.1:${NOVNC_PORT}/"
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    echo "Container exited before readiness." >&2
    docker logs "${CONTAINER}" 2>/dev/null || true
    exit 1
  fi

  sleep 1
done

echo "Timed out waiting for /tmp/axe-mcp/ready.json" >&2
docker logs "${CONTAINER}" --tail 120 >&2
exit 1
