#!/usr/bin/env bash
# Install/refresh the axe-guided-testing skill for every local agent:
#   Claude Code  -> ~/.claude/skills/axe-guided-testing/
#   OpenClaw     -> ~/.openclaw/workspace/skills/axe-guided-testing/
#   Codex        -> ~/.codex/prompts/axe-igt.md + AGENTS.md pointer
#   NemoClaw     -> `nemoclaw <sandbox> skill install` (sandbox must be running)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
echo "source: $SRC"

sync_dir() {
  mkdir -p "$1"
  rsync -a --delete --exclude install.sh --exclude .DS_Store "$SRC/" "$1/"
  echo "installed -> $1"
}

# Claude Code (user scope)
sync_dir "$HOME/.claude/skills/axe-guided-testing"

# OpenClaw workspace
if [ -d "$HOME/.openclaw" ]; then
  sync_dir "$HOME/.openclaw/workspace/skills/axe-guided-testing"
fi

# Codex: custom prompt + global AGENTS.md pointer
if [ -d "$HOME/.codex" ]; then
  mkdir -p "$HOME/.codex/prompts"
  cat > "$HOME/.codex/prompts/axe-igt.md" <<EOF
Run an axe DevTools guided-testing session (automatic scan + the 7 Intelligent
Guided Tests) against the URL given as arguments (default: ask).

Read $HOME/.claude/skills/axe-guided-testing/SKILL.md and follow it EXACTLY —
especially "The precision contract". Mechanics: use the axe-mcp MCP server's
axe_* tools (configured in ~/.codex/config.toml); if MCP is unavailable, run the
same-named zero-dependency scripts with \`node\` from
$HOME/github/axe-mcp/igt-scripts/ — never reimplement the CDP driving. Consult
references/categories.md per category and references/troubleshooting.md on any
failure before debugging from scratch.
EOF
  echo "installed -> ~/.codex/prompts/axe-igt.md (use /axe-igt in codex)"
  AG="$HOME/.codex/AGENTS.md"
  MARK="## axe guided testing (a11y)"
  if ! grep -qF "$MARK" "$AG" 2>/dev/null; then
    cat >> "$AG" <<EOF

$MARK
For any axe DevTools / accessibility guided-testing task, read
$HOME/.claude/skills/axe-guided-testing/SKILL.md and follow it exactly,
using its bundled node scripts (never reimplement the CDP driving).
EOF
    echo "appended pointer -> ~/.codex/AGENTS.md"
  else
    echo "AGENTS.md pointer already present"
  fi
fi

# NemoClaw: deploy into the default sandbox if the CLI is available
if command -v nemoclaw >/dev/null 2>&1; then
  SBX="${NEMOCLAW_SANDBOX:-$(nemoclaw list 2>/dev/null | sed -n 's/^[[:space:]]*\([a-z0-9-]*\) \*$/\1/p' | head -1)}"
  if [ -n "${SBX:-}" ]; then
    echo "deploying to nemoclaw sandbox: $SBX"
    nemoclaw "$SBX" skill install "$SRC" || echo "nemoclaw install failed — run manually: nemoclaw $SBX skill install $SRC"
  else
    echo "no running nemoclaw sandbox detected — run: nemoclaw <sandbox> skill install $SRC"
  fi
fi
echo "done."
