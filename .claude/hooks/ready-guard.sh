#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init ready-guard.sh 10
# Stop hook: refuse a launch-readiness claim that `chewbacca gtme ready` never
# backed.
#
# WHAT HAPPENED, 2026-10-12. An agent told Caleb a Zeutara launch was good
# "until Jonah responds", with only a footer address missing. The new copy
# existed only as local files (the live Clay drafts still graded 25 to 67
# against the 85 bar), nobody had read it as a recipient, 104 of 746 firm
# names carried legal suffixes the first line would print, 1 of 14 campaigns
# had been graded, gates 3 to 5 were NOT CHECKED, the pre-send gate receipt
# had expired and no START had ever gone to Clay. Caleb: "DONT TELL ME UR
# READY IF THIS SHIT IS HAPPENING? FIX CHEWBS BRO UR SUPPOSED TO BE A GTME".
#
# WHAT IT ENFORCES. In a session whose prompts, tool calls or replies touched
# Clay, campaigns, outbound or a client in clients.json, a reply that says the
# launch is ready ("good to go", "good until X", "only waiting on X", "just
# needs X", "ready to launch", "all set", "perfect") is refused unless
# ~/.chewbacca/state/gtme-ready/<client>.json is a signed READY under 2 hours
# old for the drafts file it graded (tools/gtme_ready.py --check). A reply that
# reports NOT READY, or negates the claim, passes: honest bad news is the
# behaviour this exists to get.
#
# WHAT IT DOESN'T DO. It reads phrasing, so a readiness claim in words it has
# never seen gets through; review catches that. It closes the hole that
# actually happened. Exit 2 is the Stop-hook block, the same as scope-guard and
# vibe-guard; it fires once per turn, so a refusal never loops.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$MSG" ] || exit 0

PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"' | tr -cd 'A-Za-z0-9_-')
GUARD="${TMPDIR:-/tmp}/ready-guard-${PROMPT_ID:-unknown}"
[ -f "$GUARD" ] && exit 0

# FOUND, NOT HARDCODED (vibe-guard's lesson): setup.sh copies this file to
# ~/.claude/hooks, where ../../tools is not the kit.
REPO="${CHEWBACCA_REPO_DIR:-}"
if [ -z "$REPO" ] && [ -f "$HOME/.claude/d1-config.sh" ]; then
  REPO="$(. "$HOME/.claude/d1-config.sh" 2>/dev/null; printf '%s' "${CHEWBACCA_REPO_DIR:-}")"
fi
TOOLS=""
for c in "$(dirname "${BASH_SOURCE[0]}")/../../tools" ${REPO:+"$REPO/tools"} "$HOME/code/chewbacca/tools"; do
  [ -f "$c/gtme_ready.py" ] && { TOOLS="$(cd "$c" && pwd)"; break; }
done
[ -n "$TOOLS" ] || exit 0

VERDICT=$(RG_MSG="$MSG" RG_TRANSCRIPT="$TRANSCRIPT" RG_TOOLS="$TOOLS" python3 -I - <<'PY'
import json, os, re, sys

msg = os.environ["RG_MSG"]
body = re.sub(r"```.*?```", " ", msg, flags=re.S)
low = body.lower()

# An honest verdict quoted from the tool is the answer being asked for.
if re.search(r"\bnot ready\b", low):
    print("ok"); raise SystemExit

STRONG = [
    r"\bgood to (go|launch|send|start|ship)\b",
    r"\b(good|ready|set|clear|green|fine)\s+(until|till|except|other than|apart from|besides|once|pending|but for|as soon as)\b",
    r"\b(only|just|simply)\s+(waiting|blocked|pending|missing|needs?|left|remaining)\b",
    r"\bonly\s+(thing|blocker|item|piece|step|gap)s?\s+(left|missing|remaining|outstanding|is|are)\b",
    r"\bnothing\s+(left|else|blocking|outstanding|remaining)\b",
    r"\bready\s+(to|for)\s+(launch|send|go|start|ship|fire|monday)\b",
    r"\b(launch|send|start)[- ]ready\b",
    r"\ball set\b",
    r"\b(it'?s|is|are|looks?|all|everything)\s+(is\s+|are\s+|looks?\s+)?perfect\b",
    r"^\W*perfect\b",
    r"\bwe'?re\s+(all\s+)?(good|ready|set)\b",
]
WEAK = [r"\b(is|are|'s|'re)\s+(all\s+|fully\s+|now\s+)?(ready|good|green)\b",
        r"\beverything'?s?\s+(is\s+)?(ready|good|green|in place)\b"]
LAUNCH = re.compile(r"\b(launch\w*|start\w*|send\w*|campaigns?|drafts?|sequences?|copy|lists?|wave|monday|"
                    r"go live|clay|outbound|tier [ab])\b")
NEG = re.compile(r"(\bnot\b|n't\b|\bnever\b|\bno\b|\bnothing is\b)[^.]{0,30}$")

claim = None
for m in re.finditer(r"[^.!?\n]+[.!?]?", low):
    sent = m.group(0)
    if sent.rstrip().endswith("?"):
        continue
    pats = STRONG + (WEAK if LAUNCH.search(sent) else [])
    for p in pats:
        hit = re.search(p, sent)
        if hit and not NEG.search(sent[:hit.start()]):
            claim = sent.strip()[:80]
            break
    if claim:
        break
if not claim:
    print("ok"); raise SystemExit

# Clients and the words that name them.
cf = os.path.expanduser(os.environ.get("GTME_CLIENTS") or os.environ.get("CHEWBACCA_GTM_CLIENTS")
                        or "~/.chewbacca/gtm/clients.json")
try:
    clients = json.load(open(cf)).get("clients", [])
except (OSError, ValueError):
    clients = []


def names_for(c):
    out = {c.get("name", "")}
    parts = c.get("name", "").split()
    if len(parts) > 2:
        out.add(" ".join(parts[:-1]))
    p = c.get("principal") or ""
    if p:
        out.add(p)
        if len(p.split()[0]) >= 4:
            out.add(p.split()[0])
    return {n.lower() for n in out if n}


def mentioned(text):
    return [c["name"] for c in clients if c.get("name")
            and any(re.search(r"\b" + re.escape(n) + r"\b", text) for n in names_for(c))]


# What the session actually did: his prompts, tool calls and replies. Hook and
# skill-list injections ride in user rows that start with a tag and are not
# work, so they never count (every session's skill list says "campaign").
seen = []
tp = os.environ.get("RG_TRANSCRIPT") or ""
try:
    lines = open(tp, encoding="utf-8", errors="replace").readlines()[-3000:]
except OSError:
    lines = []
for raw in lines:
    try:
        row = json.loads(raw)
    except ValueError:
        continue
    content = (row.get("message") or {}).get("content")
    if row.get("type") == "user":
        if isinstance(content, str):
            texts = [content]
        elif isinstance(content, list):
            texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        else:
            texts = []
        seen += [t for t in texts if t.strip() and not t.lstrip().startswith("<")]
    elif row.get("type") == "assistant" and isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                seen.append(json.dumps(b.get("input") or {}))
            elif b.get("type") == "text":
                seen.append(b.get("text", ""))
work = (" ".join(seen) + " " + body).lower()
GTM = re.compile(r"\b(clay|campaigns?|cam_[a-z0-9]+|sequencer|gtme|gtme-grade|gtme_grade|outbound|cold[- ]emails?|"
                 r"pre[-_ ]send|send list|drafts\.json)\b")
if not (GTM.search(work) or mentioned(work)):
    print("ok"); raise SystemExit

sys.path.insert(0, os.environ["RG_TOOLS"])
try:
    import gtme_ready
except Exception as exc:  # a broken import must not hide the claim
    print(f"refuse\t<client>\t{claim}\tgtme ready could not load ({exc.__class__.__name__})"); raise SystemExit

named = mentioned(low)
pool = named or mentioned(work)
if not pool:
    d = gtme_ready.state_dir()
    pool = [c["name"] for c in clients if c.get("name") and (d / (gtme_ready.slug(c["name"]) + ".json")).exists()]
if not pool:
    print(f"refuse\t<client>\t{claim}\tno client named and no gtme ready result on file"); raise SystemExit
whys = {n: gtme_ready.check_result(n) for n in pool}
bad = [n for n, w in whys.items() if w]
# A client the reply names must each be READY; a session-level guess needs one.
if (named and bad) or (not named and len(bad) == len(pool)):
    print(f"refuse\t{bad[0]}\t{claim}\t{whys[bad[0]]}")
else:
    print("ok")
PY
)

case "$VERDICT" in
  refuse*)
    IFS=$'\t' read -r _ CLIENT CLAIM WHY <<<"$VERDICT"
    touch "$GUARD"
    {
      echo "ready-guard: refusing. This reply says the launch is ready (\"$CLAIM\"), and"
      echo "there is no READY from \`chewbacca gtme ready\` for $CLIENT in the last 2 hours:"
      echo "$WHY."
      echo
      echo "On 2026-10-12 a Zeutara launch was called good \"until Jonah responds\" while the"
      echo "live copy graded 25 to 67, 1 of 14 campaigns had been graded, gates 3 to 5 were"
      echo "NOT CHECKED and the pre-send receipt had expired. Caleb: \"DONT TELL ME UR READY"
      echo "IF THIS SHIT IS HAPPENING?\""
      echo
      echo "The reply is already on his screen, so do not repeat it. Run"
      echo "\`chewbacca gtme ready --client \"$CLIENT\" --drafts <drafts.json>\` now and add"
      echo "its blocker list as it stands, in a few short lines: the NOT READY count and"
      echo "the first reason for each failing campaign. Call nothing ready until that"
      echo "command prints READY."
    } >&2
    exit 2 ;;
esac
exit 0
