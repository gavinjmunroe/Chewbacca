#!/usr/bin/env bash
# doctor judges a runtime install as the install it is.
# 10/12 and 10/13 stranger runs: `setup.sh --runtime claude-code` (the README
# checkout path) and then doctor exited 2 with 20 to 22 failures, every one
# for a part the runtime install says it never installs (rules, Mac tools,
# the display, PATH tools, the kit runtime), and its fix lines named
# `chewbacca`, which a runtime install never puts on PATH.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude" "$T/.chewbacca/runtime-installs"
printf '# Mine\n\nNo imports.\n' > "$T/.claude/CLAUDE.md"
printf '{"files": [], "links": []}\n' > "$T/.chewbacca/runtime-installs/claude-code.json"
P="/usr/bin:/bin:/usr/sbin:/sbin"
env -i HOME="$T" PATH="$P" bash "$ROOT/doctor.sh" --json > "$T/runtime.json" 2>/dev/null || true
env -i HOME="$T" PATH="$P" TERM=dumb bash "$ROOT/doctor.sh" > "$T/runtime.txt" 2>&1 || true
# A full install from before 9/4 (no profile file) that later ran agent setup:
# its copied hooks say it's a full install.
mkdir -p "$T/.claude/hooks" && printf '#!/bin/bash\n' > "$T/.claude/hooks/lib.sh"
env -i HOME="$T" PATH="$P" bash "$ROOT/doctor.sh" --json > "$T/old.json" 2>/dev/null || true
rm -rf "$T/.claude/hooks"
echo developer > "$T/.claude/.chewbacca-profile"
env -i HOME="$T" PATH="$P" bash "$ROOT/doctor.sh" --json > "$T/full.json" 2>/dev/null || true
python3 - "$T" "$ROOT" <<'PY'
import json, sys
t, root = sys.argv[1], sys.argv[2]
rt, full = json.load(open(t + "/runtime.json")), json.load(open(t + "/full.json"))
text = open(t + "/runtime.txt").read()
bad = 0
def check(name, ok, got=""):
    global bad
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else f"  got {got}"))
    bad += not ok
skip_sections = {"Standards", "macOS tools", "The display", "Documented tools", "Version", "Always-on imports",
                 "Kits", "People", "Coursework"}
check("a runtime install is judged as one", rt["profile"] == "runtime", rt["profile"])
check("findings for parts it never installs are skipped, and counted", rt.get("skipped", 0) > 0, rt.get("skipped"))
leaked = [c["message"] for c in rt["checks"] if c["section"] in skip_sections and c["status"] in ("fail", "warn")]
check("none of them fails it", not leaked, leaked[:3])
hit = [c for c in rt["checks"] if "no @ imports" in c["message"]]
check("a skipped finding is recorded as skipped, never as a pass", bool(hit) and hit[0]["status"] == "skip", hit)
check("the verdict says so, and names the full install", "runtime install" in text and "setup.sh --dry-run" in text,
      text[-600:])
check("every command it prints exists on this Mac", "Or try: chewbacca" not in text
      and root + "/bin/chewbacca doctor" in text, text[-300:])
old = json.load(open(t + "/old.json"))
check("a full install from before the profile file is not mistaken for a runtime one", old["profile"] == "developer",
      old["profile"])
check("the full install is still judged in full", full["profile"] == "developer"
      and any(c["status"] == "fail" and c["section"] in skip_sections for c in full["checks"]))
sys.exit(1 if bad else 0)
PY
