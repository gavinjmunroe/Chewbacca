#!/bin/bash
# skill-gate: an enforced skill named by skill-route refuses the first tool
# call once, clears on loading the skill, and never loops.
# 2026-09-29: graph-engineering was named and skipped across one session.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home"
# Run directly, outside run.sh, this file refused dozens of times into the real
# hooks.log on 2026-10-06 and turned doctor red with 96 "failures".
export CHEWBACCA_LOG_DIR="$TMP/logs"
mkdir -p "$CHEWBACCA_HOME/skills/graph-engineering"
cp "$ROOT/skills/graph-engineering/SKILL.md" "$CHEWBACCA_HOME/skills/graph-engineering/"
fail=0
# A fake Ollama before any route call, so the suite never runs a real model.
# The probe's classification embed gets the shipped weight vector itself for
# prompts carrying BIG and its negative otherwise, so the real PROBE_W decides.
# Every other call 404s, which sends the vector router to its keyword fallback.
cat > "$TMP/ollama.py" <<'O'
import base64, http.server, json, re, struct, sys
src = open(sys.argv[1]).read()
raw = base64.b64decode(re.search(r'^PROBE_W = "(.+)"', src, re.M).group(1))
w = list(struct.unpack(f"<{len(raw) // 2}e", raw))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        texts = body.get("input") or []
        if self.path != "/api/embed" or len(texts) != 1 or not texts[0].startswith("task: classification"):
            self.send_response(404); self.end_headers(); return
        sign = 1 if "BIG" in texts[0] else -1
        out = json.dumps({"embeddings": [[sign * x for x in w]]}).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(out)
s = http.server.HTTPServer(("127.0.0.1", 0), H)
print(s.server_port, flush=True)
s.serve_forever()
O
python3 "$TMP/ollama.py" "$ROOT/.claude/hooks/skill-route.sh" > "$TMP/port" &
OLLAMA_PID=$!
trap 'kill $OLLAMA_PID 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$TMP/port" ] && break; sleep 0.2; done
export OLLAMA_HOST="http://127.0.0.1:$(cat "$TMP/port")"
route() { jq -n --arg p "$1" '{prompt:$p, session_id:"t1", cwd:"/tmp"}' | HOME="$TMP" sh "$ROOT/.claude/hooks/skill-route.sh" >/dev/null 2>&1; }
gate() { jq -n --arg t "$1" --arg s "${2:-}" '{session_id:"t1", tool_name:$t, tool_input:{skill:$s}}' | bash "$ROOT/.claude/hooks/skill-gate.sh" >/dev/null 2>&1; echo $?; }

route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ -s "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    router marks graph-engineering" || { echo "FAIL  no marker written"; fail=1; }
[ "$(gate Bash)" = 2 ] && echo "ok    first non-skill tool call is refused" || { echo "FAIL  not refused"; fail=1; }
[ "$(gate Bash)" = 0 ] && echo "ok    refuses once, never loops" || { echo "FAIL  refused twice"; fail=1; }

route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ "$(gate Skill graph-engineering)" = 0 ] && [ "$(gate Bash)" = 0 ] && echo "ok    loading the skill clears the gate" || { echo "FAIL  skill load did not clear"; fail=1; }

rm -f "$CHEWBACCA_HOME/state/skill-required-t1"
route "someone can opt out but every person went on the trip and it needs approval"
[ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    conversational words don't trigger it" || { echo "FAIL  glue words triggered the gate"; fail=1; }

# 2026-10-06: big work gates the skill even when the prompt never sounds like
# graphs. "I should never have to tell you." The fake Ollama above stands in
# for the local classifier.
marked() { rm -f "$CHEWBACCA_HOME/state/skill-required-t1"; route "$1"; [ -s "$CHEWBACCA_HOME/state/skill-required-t1" ]; }

rm -rf "$CHEWBACCA_HOME/state/"*-t1
marked "BIG make chewbacca perfect" && echo "ok    probe over cutoff marks it" || { echo "FAIL  probe over cutoff missed"; fail=1; }
! marked "Thanks bro that worked great" && echo "ok    probe under cutoff stays silent" || { echo "FAIL  probe under cutoff gated"; fail=1; }
! marked "how do I build a BIG graph in neo4j?" && echo "ok    a question never gates" || { echo "FAIL  gated a question"; fail=1; }

# Probe down or off: no prompt gate, and no guessing from a word list.
BIGWORK_LOCAL=off marked "BIG build the Kyber keyboard into amber-ios" && { echo "FAIL  gated with the model off"; fail=1; } || echo "ok    model off means no prompt gate"
OLLAMA_HOST=http://127.0.0.1:9 marked "BIG build the Kyber keyboard into amber-ios" && { echo "FAIL  gated with the model down"; fail=1; } || echo "ok    model down means no prompt gate"

# Loaded this session: a prompt that only SOUNDS like graphs is not gated
# again, but big work is (below).
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Skill graph-engineering)" = 0 ]
route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    already loaded, a graph-sounding prompt is not re-gated" || { echo "FAIL  re-gated a loaded skill on vocabulary"; fail=1; }

# 2026-10-07: loaded at session start, then hours of one-at-a-time jobs with
# nothing to stop them. The requirement re-arms on every big-work PROMPT.
BIG2="BIG now render the reel, generate the assets, write the page and prep the deploy"
rm -rf "$CHEWBACCA_HOME/state/"*-t1
route "BIG build the onboarding flow"
[ "$(gate Skill graph-engineering)" = 0 ]
route "Thanks bro that worked great"
route "$BIG2"
r="$(gate Bash)$(gate Bash)"
[ "$r" = "20" ] && echo "ok    second big prompt in a session re-arms the gate, once" || { echo "FAIL  second big prompt gave $r"; fail=1; }
route "$BIG2"
route "ok looks good, keep going"
[ "$(gate Bash)" = 0 ] && echo "ok    a small prompt does not re-arm, and clears the last turn's marker" || { echo "FAIL  small prompt was gated"; fail=1; }
route "$BIG2"
[ "$(gate Skill graph-engineering)$(gate Bash)" = "00" ] && echo "ok    re-loading the skill that turn satisfies it" || { echo "FAIL  re-load did not satisfy"; fail=1; }
route "$BIG2"
[ "$(gate Agent)$(gate Bash)" = "00" ] && echo "ok    spawning an agent that turn satisfies it" || { echo "FAIL  agent spawn did not satisfy"; fail=1; }
route "$BIG2"
[ "$(gate Skill handwriting)$(gate Bash)" = "02" ] && echo "ok    another skill's load does not satisfy it" || { echo "FAIL  unrelated skill satisfied it"; fail=1; }
# Parallel calls in one message: exactly one of them refuses.
route "$BIG2"
# Wait on these six by pid: a bare wait would block on the fake Ollama.
pids=""; for i in 1 2 3 4 5 6; do gate Bash > "$TMP/par.$i" & pids="$pids $!"; done
for p in $pids; do wait "$p"; done
n=$(cat "$TMP"/par.* | grep -c '^2$')
[ "$n" = 1 ] && echo "ok    six parallel calls refuse exactly once" || { echo "FAIL  parallel calls refused $n times"; fail=1; }

# Behavior backstop: a third distinct file, or an agent spawn, without the
# skill loaded is refused once.
edit() { jq -n --arg f "$1" '{session_id:"t1", tool_name:"Edit", tool_input:{file_path:$f}}' | bash "$ROOT/.claude/hooks/skill-gate.sh" >/dev/null 2>&1; echo $?; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
r="$(edit /a)$(edit /a)$(edit /b)$(edit /c)$(edit /d)"
[ "$r" = "00020" ] && echo "ok    third distinct file refused once" || { echo "FAIL  edit counter gave $r"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Agent)$(gate Agent)" = "20" ] && echo "ok    agent spawn refused once" || { echo "FAIL  agent spawn not gated once"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
route "BIG build the onboarding flow"
[ "$(gate Agent)$(gate Agent)" = "20" ] && echo "ok    backstop and prompt marker refuse once total" || { echo "FAIL  refused twice in a row"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
r="$(edit "$HOME/second-brain/memory/x.md")$(edit /tmp/s)$(edit /a)$(edit /b)"
[ "$r" = "0000" ] && echo "ok    notes and scratch don't count toward three" || { echo "FAIL  notes counted: $r"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Skill graph-engineering)" = 0 ]
r="$(edit /a)$(edit /b)$(edit /c)$(gate Agent)"
[ "$r" = "0000" ] && echo "ok    loaded skill disables the backstop" || { echo "FAIL  backstop fired after load: $r"; fail=1; }
# The trainer and the hook must embed with the same prefix, or retrained
# weights silently score a different vector space.
PREFIX=$(sed -n 's/^PREFIX = "\(.*\)"$/\1/p' "$ROOT/tools/train_bigwork_probe.py")
[ -n "$PREFIX" ] && grep -qF "\"$PREFIX\" + prompt" "$ROOT/.claude/hooks/skill-route.sh" && echo "ok    hook and trainer share the embed prefix" || { echo "FAIL  embed prefix drifted between hook and trainer"; fail=1; }
exit $fail
