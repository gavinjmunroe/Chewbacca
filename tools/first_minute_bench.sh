#!/bin/bash
# Clone to first win, timed, in a scratch HOME. Usage: tools/first_minute_bench.sh <repo-or-url> <out.jsonl>
# The scratch HOME has a git identity, one repo of the person's own with work
# this week (a commit, an unpushed commit, a dirty file), and all five agents
# present with configs of their own that setup must back up and preserve.
set -uo pipefail
SRC="$1"; OUT="$2"
BASE="$(mktemp -d)"; H="$BASE/home"; mkdir -p "$H" "$BASE/fakebin" "$BASE/Apps"
trap 'rm -rf "$BASE"' EXIT
for b in codex gemini code; do printf '#!/bin/sh\necho fake %s\n' "$b" > "$BASE/fakebin/$b"; chmod +x "$BASE/fakebin/$b"; done
printf '[user]\n\temail = stranger@example.com\n\tname = Stranger\n[init]\n\tdefaultBranch = main\n' > "$H/.gitconfig"
mkdir -p "$H/.claude" "$H/.cursor" "$H/.codex" "$H/.gemini" "$H/Library/Application Support/Code/User"
echo '{"model":"their-model"}' > "$H/.claude/settings.json"
echo '{"mcpServers":{"theirs":{"command":"/bin/true"}}}' > "$H/.cursor/mcp.json"
echo '{"theme":"dark"}' > "$H/.gemini/settings.json"
printf 'model = "their-model"\n' > "$H/.codex/config.toml"
echo '{"servers":{"theirs":{"type":"stdio","command":"/bin/true"}}}' > "$H/Library/Application Support/Code/User/mcp.json"
ORIG="$BASE/orig"; mkdir "$ORIG"
for f in .claude/settings.json .cursor/mcp.json .gemini/settings.json .codex/config.toml "Library/Application Support/Code/User/mcp.json"; do
  shasum -a 256 "$H/$f" >> "$ORIG/sums"
done
# Their own project: two old-enough-to-count commits this week, one pushed.
ENVX=(env -i HOME="$H" PATH="$BASE/fakebin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" USER="$USER" SHELL=/bin/zsh
      TMPDIR="$BASE" CHEWBACCA_APPLICATIONS_DIR="$BASE/Apps" CHEWBACCA_NO_SEND=1 LANG=en_US.UTF-8)
"${ENVX[@]}" git init -q --bare "$H/remote.git"
"${ENVX[@]}" git clone -q "$H/remote.git" "$H/code/myapp" 2>/dev/null
( cd "$H/code/myapp" && echo a > a && "${ENVX[@]}" git add a && "${ENVX[@]}" git commit -qm "start" && "${ENVX[@]}" git push -q origin main \
  && echo b > b && "${ENVX[@]}" git add b && "${ENVX[@]}" git commit -qm "wip not pushed" && echo c > c )
REAL_BEFORE="$(shasum -a 256 ~/.claude/settings.json ~/.cursor/mcp.json 2>/dev/null)"
LOAD="$(sysctl -n vm.loadavg | awk '{print $2}')"

python3 - "$SRC" "$H" "$OUT" "$LOAD" "${ENVX[@]}" <<'PY'
import json, subprocess, sys, time, re
src, home, out, load = sys.argv[1:5]
envx = sys.argv[5:]
t0 = time.monotonic()
clone = subprocess.run(envx + ['git', 'clone', '-q', '--depth', '1', src, home + '/Chewbacca'], capture_output=True, text=True)
t_clone = time.monotonic() - t0
p = subprocess.Popen(envx + ['bash', home + '/Chewbacca/setup.sh', '--every-agent'], stdin=subprocess.DEVNULL,
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=home)
lines, t_win, win = [], None, None
for line in p.stdout:
    lines.append(line.rstrip('\n'))
    if t_win is None and line.startswith('Your week:'):
        t_win, win = time.monotonic() - t0, line.strip()
p.wait()
total = time.monotonic() - t0
errors = [l for l in lines if re.search(r'Traceback|Error|error:|command not found|No such file', l)]
row = {'when': time.strftime('%Y-%m-%d %H:%M'), 'load': float(load), 'clone_s': round(t_clone, 1),
       'first_win_s': round(t_win, 1) if t_win else None, 'total_s': round(total, 1), 'exit': p.returncode,
       'prompts': 0 if p.returncode == 0 else None, 'errors': errors, 'win': win, 'clone_ok': clone.returncode == 0}
open(out, 'a').write(json.dumps(row) + '\n')
print('\n'.join(lines))
print(json.dumps(row, indent=1))
PY
echo "--- backups equal the originals:"
while read -r sum path; do
  b="${path}.chewbacca.backup"
  if [ -f "$b" ]; then [ "$(shasum -a 256 "$b" | cut -d' ' -f1)" = "$sum" ] && echo "ok  ${path#$H/}" || echo "BAD ${path#$H/}"; else echo "none ${path#$H/}"; fi
done < "$ORIG/sums"
echo "--- their own entries kept:"
grep -c theirs "$H/.cursor/mcp.json" "$H/Library/Application Support/Code/User/mcp.json"
grep -c their-model "$H/.claude/settings.json" "$H/.codex/config.toml"
echo "--- what each agent got:"
ls "$H/.copilot/instructions/" 2>&1; grep -o '"chewbacca"' "$H/Library/Application Support/Code/User/mcp.json" "$H/.cursor/mcp.json" "$H/.gemini/settings.json" 2>&1
ls "$H/.agents/skills" | wc -l; ls "$H/.claude/skills" | wc -l
echo "--- undo:"
"${ENVX[@]}" python3 "$H/Chewbacca/tools/agent_runtime.py" remove --runtime all | tail -8
while read -r sum path; do
  [ "$(shasum -a 256 "$path" | cut -d' ' -f1)" = "$sum" ] && echo "restored ${path#$H/}" || echo "DIFFERS  ${path#$H/}"
done < "$ORIG/sums"
REAL_AFTER="$(shasum -a 256 ~/.claude/settings.json ~/.cursor/mcp.json 2>/dev/null)"
[ "$REAL_BEFORE" = "$REAL_AFTER" ] && echo "real HOME untouched" || echo "REAL HOME CHANGED"
