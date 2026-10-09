#!/bin/bash
# kit-debt must fire when work happened elsewhere and the kit learned nothing,
# and stay quiet otherwise. A gate that never fires is decoration.
set -uo pipefail
TOOL="$(dirname "$0")/../bin/kit-debt"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

python3 - "$TOOL" <<'PY'
import importlib.util, sys, types
spec = importlib.util.spec_from_loader("kd", loader=None)
kd = types.ModuleType("kd")
kd.__dict__["__file__"] = sys.argv[1]
exec(open(sys.argv[1]).read().split('if __name__')[0], kd.__dict__)
# owing: busy projects, zero kit commits
kd.kit_commits = lambda h: []
kd.work_dirs  = lambda h: {"someproject": 12}
sys.argv = ["kit-debt", "--terse"]
assert kd.main() == 1, "should owe when projects moved and the kit did not"
# clear: kit learned something
kd.kit_commits = lambda h: ["abc feat: a lesson"]
assert kd.main() == 0, "should be clear when the kit has commits"
# clear: nothing happened anywhere
kd.kit_commits = lambda h: []
kd.work_dirs  = lambda h: {}
assert kd.main() == 0, "should be clear when there was no project work"
# a satellite tool repo that ships skills counts as the kit, not as project work
import pathlib, tempfile, subprocess as sp
home = pathlib.Path(tempfile.mkdtemp())
sat = home / "code" / "tools" / "sat"; (sat / "skills").mkdir(parents=True)
sp.run(["git", "init", "-q", str(sat)], check=True)
plain = home / "code" / "tools" / "plain"; plain.mkdir(parents=True)
sp.run(["git", "init", "-q", str(plain)], check=True)
real_home = pathlib.Path.home
pathlib.Path.home = classmethod(lambda cls: home)
names = {d.name for d in kd.satellites()}
pathlib.Path.home = real_home
assert names == {"sat"}, f"satellites should be only skill-shipping tool repos, got {names}"
# 2026-10-09: corrected twice, wrote no skill, other sessions' board commits
# must not clear it.
import json
t = home / "t.jsonl"
t.write_text("\n".join(json.dumps(e) for e in [
    {"type": "user", "message": {"content": "Fix the sites based on what Tyler just texted"}},
    {"type": "user", "message": {"content": "Bro the tts site is so lame lmao"}},
    {"type": "user", "message": {"content": "Ts so lame"}},
    {"type": "user", "message": {"content": [{"type": "text", "text": "<system-reminder>lame</system-reminder>"}]}},
]))
kd.kit_commits = lambda h: ["abc team: CHW-143 moved"]
kd.work_dirs = lambda h: {}
kd.session_taught = lambda s: False
sys.argv = ["kit-debt", "--terse", "--session", "s1", "--transcript", str(t)]
assert kd.corrections(str(t)) == 2, kd.corrections(str(t))
assert kd.main() == 1, "two corrections and no skill written should owe"
kd.session_taught = lambda s: True
assert kd.main() == 0, "should clear once this session wrote a skill"
t.write_text(json.dumps({"type": "user", "message": {"content": "make it blue"}}))
kd.session_taught = lambda s: False
assert kd.main() == 0, "a session with no corrections owes nothing on that count"
print("LOGIC_OK")
PY
if [ $? -eq 0 ]; then ok "fires when owed, quiet when clear"; else no "logic wrong"; fi
"$TOOL" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] && ok "runs against the real tree" || no "crashed on the real tree"
echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
