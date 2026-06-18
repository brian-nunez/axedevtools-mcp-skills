#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export MCP_PORT="${MCP_PORT:-3000}"
export AXE_CDP_PORT="${AXE_CDP_PORT:-9222}"
export AXE_CDP_ENDPOINT="${AXE_CDP_ENDPOINT:-http://127.0.0.1:${AXE_CDP_PORT}}"
export RUN_AS_USER="${RUN_AS_USER:-pwuser}"

AXE_EXT_ID="${AXE_EXT_ID:-lhdoppojpmngadmnindnejefpokejbdd}"

write_axe_policy() {
  if [[ -z "${AXE_SERVER_URL:-}" ]]; then
    return
  fi
  for dir in /etc/chromium/policies/managed /etc/opt/chrome/policies/managed; do
    mkdir -p "$dir"
    python3 - "$dir/axe-devtools-policy.json" "$AXE_EXT_ID" "$AXE_SERVER_URL" <<'PY'
import json
import sys
path, ext_id, axe_url = sys.argv[1:4]
policy = {
  "3rdparty": {
    "extensions": {
      ext_id: {
        "AxeURL": axe_url,
        "DisableIGT": False,
        "EnableMachineLearning": True
      }
    }
  }
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(policy, f, indent=2)
PY
  done
  echo "[axe-mcp] configured axe extension managed policy AxeURL=${AXE_SERVER_URL}" >&2
}

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT

if [[ "$(id -u)" = "0" && "${AXE_ALREADY_DROPPED:-0}" != "1" ]]; then
  write_axe_policy

  cat > /usr/share/novnc/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>axe-mcp noVNC</title>
<meta http-equiv="refresh" content="0; url=/vnc.html?autoconnect=true&resize=scale&reconnect=true">
<a href="/vnc.html?autoconnect=true&resize=scale&reconnect=true">Open noVNC</a>
HTML

  mkdir -p /tmp/.X11-unix /tmp/axe-mcp
  chmod 1777 /tmp/.X11-unix /tmp/axe-mcp
  chown -R "${RUN_AS_USER}:${RUN_AS_USER}" /home/"${RUN_AS_USER}" /tmp/axe-mcp

  echo "[axe-mcp] root preflight complete; dropping privileges to ${RUN_AS_USER}" >&2
  export AXE_ALREADY_DROPPED=1
  export HOME="/home/${RUN_AS_USER}"
  export USER="${RUN_AS_USER}"
  export LOGNAME="${RUN_AS_USER}"
  exec runuser --preserve-environment --user "${RUN_AS_USER}" -- "$0" "$@"
fi

if [[ -z "${AXE_EXTRA_ARGS+x}" ]]; then
  export AXE_EXTRA_ARGS="--no-sandbox||--disable-dev-shm-usage||--disable-gpu"
fi

Xvfb "$DISPLAY" -screen 0 "${XVFB_SCREEN:-1920x1080x24}" -nolisten tcp >/tmp/xvfb.log 2>&1 &

for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

mkdir -p "$HOME/.fluxbox"
cat > "$HOME/.fluxbox/init" <<'EOF'
session.screen0.rootCommand:
session.screen0.toolbar.visible: false
session.screen0.slit.autoHide: true
session.screen0.focusModel: ClickFocus
session.screen0.windowPlacement: RowSmartPlacement
EOF
cat > "$HOME/.fluxbox/apps" <<'EOF'
[app] (name=chrome)
  [Maximized] {yes}
[end]
EOF

fluxbox >/tmp/fluxbox.log 2>&1 &

x11vnc \
  -display "$DISPLAY" \
  -forever \
  -shared \
  -nopw \
  -listen 0.0.0.0 \
  -rfbport "$VNC_PORT" \
  >/tmp/x11vnc.log 2>&1 &

websockify \
  --web=/usr/share/novnc \
  "0.0.0.0:${NOVNC_PORT}" \
  "127.0.0.1:${VNC_PORT}" \
  >/tmp/novnc.log 2>&1 &

echo "[axe-mcp] noVNC UI: http://127.0.0.1:${NOVNC_PORT}/ (container port ${NOVNC_PORT}); raw VNC: ${VNC_PORT}; DISPLAY=${DISPLAY}" >&2
echo "[axe-mcp] MCP Streamable HTTP listening on :${MCP_PORT}/mcp; CDP on :${AXE_CDP_PORT}" >&2
echo "[axe-mcp] axe extension directory: ${AXE_EXTENSION_DIR:-/opt/axe-extension}" >&2
echo "[axe-mcp] runtime user: $(id -un) ($(id -u):$(id -g))" >&2

if [[ -n "${TARGET_URL:-${AXE_TARGET_URL:-}}" ]]; then
  node /app/dist/bootstrap.js
else
  echo "[axe-mcp] TARGET_URL/AXE_TARGET_URL not set; browser will start when setup_environment is called" >&2
fi

exec "$@"
