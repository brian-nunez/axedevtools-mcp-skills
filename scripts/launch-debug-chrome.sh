#!/usr/bin/env bash
# Launch a Chromium-family browser with a CDP port so axe-mcp can attach to it.
#
# Usage:
#   scripts/launch-debug-chrome.sh [PORT] [URL] [PROFILE_DIR]
#
# Notes:
#   - Uses a SEPARATE profile dir by default so it won't collide with a Chrome
#     you already have open. To audit your real logged-in session, fully quit
#     that browser first and point PROFILE_DIR at its profile (advanced).
#   - --remote-allow-origins=* is required by Chrome 111+ for non-browser CDP clients.

set -euo pipefail
PORT="${1:-9222}"
URL="${2:-about:blank}"
PROFILE="${3:-$HOME/.axe-mcp-chrome}"

# Pick the first available Chromium-family browser.
CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/BrowserOS.app/Contents/MacOS/BrowserOS"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
)
BIN=""
for c in "${CANDIDATES[@]}"; do
  if [ -x "$c" ]; then BIN="$c"; break; fi
done
if [ -z "$BIN" ]; then
  echo "No Chromium-family browser found in /Applications." >&2
  exit 1
fi

echo "Launching: $BIN"
echo "  CDP endpoint: http://127.0.0.1:$PORT  (use 127.0.0.1, not localhost -> avoids IPv6 ::1)"
echo "  Profile dir : $PROFILE"
exec "$BIN" \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins='*' \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  "$URL"
