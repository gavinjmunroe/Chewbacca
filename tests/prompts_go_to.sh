#!/bin/bash
# The install summary names the company that gets the student's prompts, for
# the agent they actually have. On the 2026-10-13 USC week walk a Codex-only
# student was told "Your prompts go to Anthropic".
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
mkdir -p "$T/codex" "$T/both" "$T/none"
for f in codex/codex both/codex both/claude; do printf '#!/bin/sh\n' > "$T/$f"; chmod +x "$T/$f"; done
line() { PATH="$T/$1:/usr/bin:/bin" /bin/bash "$ROOT/bin/lib/prompts-go-to.sh"; }
[ "$(line codex)" = "Your prompts go to OpenAI, the same as any Codex session." ] \
  && ok "a Codex-only Mac is told OpenAI" || no "codex only: $(line codex)"
[ "$(line both)" = "Your prompts go to whoever runs the agent you type them into: Anthropic for Claude Code, OpenAI for Codex." ] \
  && ok "a Mac with both names both" || no "both: $(line both)"
line none | grep -q "Anthropic for Claude Code, OpenAI for Codex" \
  && ok "a Mac with neither yet names both" || no "none: $(line none)"
grep -q 'prompts-go-to.sh' "$ROOT/setup.sh" && ! grep -q '"    Your prompts go to Anthropic' "$ROOT/setup.sh" \
  && ok "setup.sh prints the detected line, not a fixed Anthropic one" || no "setup.sh still hardcodes Anthropic"
exit "$fail"
