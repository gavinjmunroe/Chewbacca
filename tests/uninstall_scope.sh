#!/usr/bin/env bash
# uninstall.sh removes the kit and only the kit. Break-it, 2026-10-19: after
# setup then uninstall, 89 of 90 hook registrations pointed at deleted
# scripts and skipDangerousModePermissionPrompt stayed true; on a machine
# that never ran setup it deleted the user's own security.md and
# code-reviewer.md because they share a shipped name.
# brew and launchctl are stubbed: nothing here touches the real machine.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.claude/rules" "$HOME/.claude/agents" "$T/stub"
for b in brew launchctl; do printf '#!/bin/sh\nexit 0\n' > "$T/stub/$b"; chmod +x "$T/stub/$b"; done
export PATH="$T/stub:$PATH"
fail=0; ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

# The kit's own settings, written by setup's settings block, plus one hook of the user's.
python3 - "$ROOT" <<'PY'
import json, os, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1]); home = pathlib.Path(os.environ["HOME"])
lines = (root / "setup.sh").read_text().splitlines()
start = lines.index("python3 << 'PYEOF'") + 1
end = start + lines[start:].index("PYEOF")
block = "\n".join(lines[start:end]) + "\n"
(home / ".claude/settings.json").write_text(json.dumps(
    {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "/opt/me/my-git.sh"}]}]}}))
env = dict(os.environ, D1_HOOKS=str(home / ".claude/hooks"), D1_SESSION_OPENER="none", D1_BYPASS_PERMS="yes")
subprocess.run([sys.executable, "-c", block], env=env, check=True, capture_output=True)
PY
grep -q skipDangerousModePermissionPrompt "$HOME/.claude/settings.json" || { echo "  FAIL  setup block didn't set the key this test checks"; exit 1; }
echo "my own security rules" > "$HOME/.claude/rules/security.md"
echo "my reviewer" > "$HOME/.claude/agents/code-reviewer.md"
cp "$ROOT/.claude/rules/git.md" "$HOME/.claude/rules/git.md" 2>/dev/null || true

bash "$ROOT/uninstall.sh" >"$T/out" 2>&1 < /dev/null; rc=$?
ok "uninstall exits 0" '[ "$rc" = 0 ]'
left=$(python3 -c '
import json, os, sys
s = json.load(open(os.path.expanduser("~/.claude/settings.json")))
cmds = [h.get("command","") for g in (s.get("hooks") or {}).values() for e in g for h in e.get("hooks",[])]
print(sum(1 for c in cmds if "/.claude/hooks/" in c or "hookd" in c))')
ok "no kit hook registration is left behind ($left)" '[ "$left" = 0 ]'
ok "the user's own hook is kept" 'grep -q "/opt/me/my-git.sh" "$HOME/.claude/settings.json"'
ok "skipDangerousModePermissionPrompt is gone" '! grep -q skipDangerousModePermissionPrompt "$HOME/.claude/settings.json"'
ok "the user's own security.md is kept" 'grep -qx "my own security rules" "$HOME/.claude/rules/security.md"'
ok "the user's own code-reviewer.md is kept" 'grep -qx "my reviewer" "$HOME/.claude/agents/code-reviewer.md"'
[ -f "$ROOT/.claude/rules/git.md" ] && ok "the kit's unchanged git.md is removed" '[ ! -e "$HOME/.claude/rules/git.md" ]'
[ "$fail" -eq 0 ] && echo "uninstall scope ok" || { echo "uninstall scope: $fail failed"; exit 1; }
