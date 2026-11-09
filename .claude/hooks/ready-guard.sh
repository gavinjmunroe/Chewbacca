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
# A quoted sentence is a report about a claim, not one. 2026-10-16: the reply
# explaining this guard's own fix quoted "A13 is done, and A14 only needs ur
# engagement-metrics cell" next to the word launch, and was refused.
body = re.sub(r"\"[^\"\n]{0,300}\"|“[^”\n]{0,300}”", " ", body)
# The session opener is a prayer, not a report. 2026-11-05: "until Caleb's ready"
# in one was refused as a launch claim. Only a leading paragraph addressed to God
# and ending in Amen is dropped, so a claim after it still counts.
body = re.sub(r"\A\s*(jesus|lord|father|god)\b[^\n]*\bamen[.!]?\s*(\n|\Z)", " ", body, flags=re.I)
low = body.lower()

# An honest verdict quoted from the tool is the answer being asked for.
if re.search(r"\bnot ready\b", low):
    print("ok"); raise SystemExit

WAITING = r"\b(only|just|simply)\s+(waiting|blocked|pending|missing|needs?|left|remaining)\b"
STRONG = [
    r"\bgood to (go|launch|send|start|ship)\b",
    r"\b(good|ready|set|clear|green|fine)\s+(until|till|except|other than|apart from|besides|once|pending|but for|as soon as)\b",
    WAITING,
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


# Dough (calebnewtonusc/dough) has its own `dough ready`, which writes
# <DOUGH_STATE>/<client>/ready.json with the plan and copy hashes it saw. On
# 2026-11-02 Caleb asked whether Dough had learned the Jonah mistakes and it
# hadn't learned this one: nothing stopped a "Junto is ready" claim, because
# Junto isn't a gtme client and the reply never says campaign or Clay.
def dough_repo():
    import subprocess, tempfile
    home_repo = os.environ.get("DOUGH_REPO") or os.path.expanduser("~/code/dough")
    if os.path.isfile(os.path.join(home_repo, "dough", "ready.py")):
        return home_repo
    if not os.path.isdir(os.path.join(home_repo, ".git")):
        return None
    # The checkout can sit on a branch cut before `dough ready` existed. Read main's
    # copy instead, unpacked once per commit.
    try:
        sha = subprocess.run(["git", "-C", home_repo, "rev-parse", "origin/main"], capture_output=True,
                             text=True, timeout=5).stdout.strip()
        if not sha:
            return None
        dest = os.path.join(tempfile.gettempdir(), f"dough-main-{sha[:12]}")
        if not os.path.isfile(os.path.join(dest, "dough", "ready.py")):
            os.makedirs(dest, exist_ok=True)
            tar = subprocess.run(["git", "-C", home_repo, "archive", "origin/main", "dough", "clients"],
                                 capture_output=True, timeout=10).stdout
            subprocess.run(["tar", "-x", "-C", dest], input=tar, timeout=10)
        return dest if os.path.isfile(os.path.join(dest, "dough", "ready.py")) else None
    except (OSError, subprocess.SubprocessError):
        return None


DREPO = dough_repo()
DCLIENTS = {}
if DREPO:
    import glob
    for f in glob.glob(os.path.join(DREPO, "clients", "*.json")):
        stem = os.path.splitext(os.path.basename(f))[0]
        try:
            DCLIENTS[stem] = {stem.lower(), json.load(open(f)).get("name", stem).lower()}
        except (OSError, ValueError):
            continue


def dmention(text):
    return [k for k, ns in DCLIENTS.items() if any(re.search(r"\b" + re.escape(n) + r"\b", text) for n in ns)]


DOUGH_CTX = re.compile(r"\b(load\w*|copy|lists?|leads?|plan|follow-?ups?|note|pilot|ready|good to go|all set)\b")
dough_about = bool((re.search(r"\bdough\b", low) or dmention(low)) and DOUGH_CTX.search(low) and not mentioned(low))


# "Only needs", "good until", "nothing left" are how anyone reports progress.
# On 2026-10-16 the manager tab's "A13 is done, and A14 only needs ur
# engagement-metrics cell" (school assignments, no launch in it) was refused
# because the session had touched campaigns earlier.
#
# So the reply itself has to be about a GTM launch; session context alone is
# never enough. 2026-10-25/26, 7 refusals in 2 days on Parker site and school
# tabs: "we're good now" about a site deploy, "ready to send as a draft" about
# a render, "nothing else needs u before church". Each passed the old filter
# because the reply said "draft" or "queued", or the session had once touched a
# client. Standalone, only outbound words count: plural "drafts" and "sends"
# (the Parker replies said "a draft" and "to send"), a wave, a footer, Clay
# that isn't a clay render. "Launch" counts unless the reply is about a site,
# page, app, deploy or render. A client name counts with a word about what goes
# out, so "Jonah" plus "footer" is a launch and "Firm Foundation" plus "deploy"
# is not. Bare "ready" never is.
REPLY_GTM = re.compile(r"\b(campaigns?|cam_[a-z0-9]+|sequencer|sequences?|gtme|outbound|cold[- ]emails?|"
                       r"pre[-_ ]send|send list|tier [ab]|drafts|sends|wave|footer|go live|"
                       r"clay(?! (render|material|model|shader|sculpt|look|pass))(?!-))\b")
LAUNCH_WORD = re.compile(r"\blaunch(es|ed|ing)?\b")
NOT_OUTBOUND = re.compile(r"\b(site|page|app|deploy\w*|render\w*|build|preview|vision pro)\b")
CLIENT_CTX = re.compile(r"\b(copy|drafts?|footer|lists?|sends?|wave|emails?|leads?|mailbox(es)?|inbox(es)?)\b")
strong_about = REPLY_GTM.search(low) or (LAUNCH_WORD.search(low) and not NOT_OUTBOUND.search(low)) or dough_about
about = strong_about or (mentioned(low) and CLIENT_CTX.search(low))
dough_only = dough_about and not REPLY_GTM.search(low) and not (LAUNCH_WORD.search(low) and not NOT_OUTBOUND.search(low))
if not about:
    print("ok"); raise SystemExit

claim = None
for m in re.finditer(r"[^.!?\n]+[.!?]?", low):
    sent = m.group(0)
    if sent.rstrip().endswith("?"):
        continue
    # A client name plus "lead" is how a money or pipeline answer talks, so on
    # that context alone the claim sentence itself has to be about a launch.
    # 2026-10-28, a rent-odds reply: "Gavin's lead" put Firm Foundation in
    # context and "- Nothing else recurring" (abt income) was refused.
    if not strong_about and not LAUNCH.search(sent):
        continue
    # When Dough is the only thing making the reply about outbound, the claim
    # sentence has to be about Dough too. 2026-11-03, a reply that mentioned
    # the Dough pitch also said two memory files "will clear once that
    # checkout catches up", and "clear once" was refused as a Dough claim.
    if dough_only and not (re.search(r"\bdough\b", sent) or dmention(sent) or DOUGH_CTX.search(sent)):
        continue
    pats = STRONG + (WEAK if LAUNCH.search(sent) else [])
    for p in pats:
        hit = re.search(p, sent)
        # "Just waiting on" is how anyone reports a text thread. 2026-11-05: "that's
        # just waiting on his reply" about Noah's texts was refused bc outbound came
        # up elsewhere in the reply. The sentence itself has to name the launch or a client.
        if hit and p == WAITING and not (LAUNCH.search(sent) or mentioned(sent) or dmention(sent)):
            continue
        if hit and not NEG.search(sent[:hit.start()]):
            claim = sent.strip()[:80]
            break
    if claim:
        break
if not claim:
    print("ok"); raise SystemExit

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
        # A Stop hook's own refusal comes back as a user row, and this guard's
        # refusal text names Zeutara and Jonah. 2026-10-29, a Firm Foundation
        # tab was refused three times "for Zeutara" after the first refusal
        # landed in its transcript, though Zeutara was never touched there.
        seen += [t for t in texts if t.strip() and not t.lstrip().startswith("<")
                 and not t.lstrip().startswith("Stop hook feedback")]
    elif row.get("type") == "assistant" and isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                seen.append(json.dumps(b.get("input") or {}))
            elif b.get("type") == "text":
                seen.append(b.get("text", ""))
work = (" ".join(seen) + " " + body).lower()
if dough_about or (re.search(r"\bdough\b", work) and not mentioned(low) and not mentioned(work)):
    if not DREPO:
        print(f"refuse-dough\t<client>\t{claim}\tthe Dough repo isn't on this machine, so no dough ready can back it")
        raise SystemExit
    sys.path.insert(0, DREPO)
    try:
        from dough import config as dconfig, ready as dready
    except Exception as exc:  # a broken import must not hide the claim
        print(f"refuse-dough\t<client>\t{claim}\tdough ready could not load ({exc.__class__.__name__})"); raise SystemExit
    dnamed = dmention(low)
    dpool = dnamed or dmention(work) or [k for k in DCLIENTS if (dconfig.STATE / k / "ready.json").exists()]
    if not dpool:
        print(f"refuse-dough\t<client>\t{claim}\tno Dough client named and no dough ready on file"); raise SystemExit
    dwhys = {}
    for k in dpool:
        try:
            dwhys[k] = dready.check_verdict(dconfig.STATE / k, k, dconfig.load_client(k))
        except Exception as exc:
            dwhys[k] = f"dough ready's verdict couldn't be read ({exc.__class__.__name__})"
    dbad = [k for k, w in dwhys.items() if w]
    if (dnamed and dbad) or (not dnamed and len(dbad) == len(dpool)):
        print(f"refuse-dough\t{dbad[0]}\t{claim}\t{dwhys[dbad[0]]}")
    else:
        print("ok")
    raise SystemExit

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
# 2026-10-28: "u're good to go" before the Junto sales call (prep checked, site
# up, the gift line saying "the campaign already running") was refused for a
# Zeutara launch, a client the reply never named. A reply that names no client
# and is about getting ready for a call or meeting is not a launch claim.
# Review of 8364cb82: an early exit on any call word let "the campaigns are good
# to go, see you on the call" through. Only the claim sentence decides: it
# passes when it is about the call and says nothing about anything going out.
CALL_PREP = re.compile(r"\b(call|meeting|demo|pitch|walk in|cheat sheet)\b")
GOES_OUT = re.compile(r"\b(campaigns?|cam_[a-z0-9]+|drafts?|sequences?|sends?|sending|sent|wave|launch\w*|"
                      r"live|running|started|active|outbound|leads?|lists?|emails?|copy|footer|tier [ab]|clay)\b")
if not named and CALL_PREP.search(claim) and not GOES_OUT.search(claim):
    print("ok"); raise SystemExit
pool = named or mentioned(work)
if not pool:
    d = gtme_ready.state_dir()
    pool = [c["name"] for c in clients if c.get("name") and (d / (gtme_ready.slug(c["name"]) + ".json")).exists()]
if not pool:
    print(f"refuse\t<client>\t{claim}\tno client named and no gtme ready result on file"); raise SystemExit
whys = {n: gtme_ready.check_result(n) for n in pool}
bad = [n for n, w in whys.items() if w]
# A client the reply names must each be READY; a session-level guess needs one.
# Name the client the session touched last, never the first in clients.json.
bad.sort(key=lambda n: max([work.rfind(x) for x in names_for({"name": n, **next((c for c in clients if c.get("name") == n), {})})] or [-1]), reverse=True)
if (named and bad) or (not named and len(bad) == len(pool)):
    print(f"refuse\t{bad[0]}\t{claim}\t{whys[bad[0]]}")
else:
    print("ok")
PY
)

case "$VERDICT" in
  refuse-dough*)
    IFS=$'\t' read -r _ CLIENT CLAIM WHY <<<"$VERDICT"
    touch "$GUARD"
    {
      echo "ready-guard: refusing. This reply says Dough is ready (\"$CLAIM\"), and there is"
      echo "no READY from \`dough ready\` for $CLIENT that still matches the plan and copy: $WHY."
      echo
      echo "The reply is already on his screen, so do not repeat it. Run"
      echo "\`dough ready --client $CLIENT\` from the dough repo now and add its blocker"
      echo "list as it stands, in a few short lines. Call nothing ready until it prints READY."
    } >&2
    exit 2 ;;
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
