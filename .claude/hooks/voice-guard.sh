#!/usr/bin/env bash
# Refuses a reply that hands Caleb a text to send which doesn't read like him.
#
# 2026-10-09: two texts for Jonah and Ryan went into chat as quoted blocks,
# opening "Attached is one more page" with a colon list through 60 words. He
# said "That doesn't sound like me bruv. fix chewbs i should never send a text
# that doesn't sound like me." The drafts queue (people texts drafts add)
# already runs voice-check; texts handed over in chat never touched it.
#
# A draft in a reply is a ">" quoted block in a reply that talks about
# sending (text, WhatsApp, Slack, DM, iMessage, send). Each block goes through
# bin/voice-check, which measures against his own sent texts. Refuses at most
# once per turn, like slop-guard, so a rewrite always gets through.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init voice-guard.sh 25
set -uo pipefail

INPUT=$(cat)
command -v python3 >/dev/null 2>&1 || exit 0

# setup.sh copies hooks into ~/.claude/hooks and links bin tools into
# ~/.local/bin, so the checkout is found through the link, not this file.
VC="$(command -v voice-check || echo "$HOME/.local/bin/voice-check")"
[ -f "$VC" ] || VC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/bin/voice-check"
[ -f "$VC" ] || exit 0

OUT=$(printf '%s' "$INPUT" | python3 -I -c '
import json, re, subprocess, sys, os
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
msg = d.get("last_assistant_message") or ""
LINE = float(os.environ.get("VOICE_GUARD_LINE", "0.3"))
QUESTION = ("An AI agent shows `block` to its user, introduced by `lead_in`. Is `block` a message the user will send to "
            "another person by text or chat? Say no if it is a prompt for another AI agent or session, an email with a "
            "subject line, code, notes, or a quote of something someone else said.")
pid = d.get("prompt_id") or d.get("session_id") or "unknown"
guard = os.path.join(os.environ.get("TMPDIR", "/tmp"), "voice-guard-" + re.sub(r"[^A-Za-z0-9_-]", "", pid))
if os.path.exists(guard):
    sys.exit(0)
bodies = []
for m in re.finditer(r"((?:^[ \t]*> ?.*\n?)+)", msg, re.M):
    bodies.append((" ".join(l.strip()[1:].strip() for l in m.group(1).splitlines()).strip(), msg[max(0, m.start() - 160):m.start()]))
# 2026-10-26: a gc text for his P4a team went out in a ``` block, which this
# never read, and he wrote "Bro that doesnt sound human" (apostrophe dropped: this runs inside a single-quoted shell string). A fence with no
# language, or text/plain/txt, holding prose is a draft too. Code-shaped
# fences (shell prompts, braces, assignments, a command first word) are not.
CODEY = re.compile(r"^\s*(\$ |cd |git |npm |python|bash |#!|[A-Za-z_]+=|import |def |function |const |let |\{|\[|<)|[;{}]\s*$", re.M)
for m in re.finditer(r"^```[ \t]*([A-Za-z]*)[ \t]*\n(.*?)^```", msg, re.M | re.S):
    lang, blk = m.group(1), m.group(2)
    if lang.lower() not in ("", "text", "txt", "plain"):
        continue
    if CODEY.search(blk):
        continue
    lead = msg[max(0, m.start() - 160):m.start()].rsplit("```", 1)[-1]
    bodies.append((" ".join(l.strip() for l in blk.splitlines() if l.strip()), lead))


# A drafted text, or something else in a quote or fence? Word lists got this wrong
# both ways: three prompts for other tabs graded as texts and refused twice
# (2026-10-28), a cold email refused 8 times (2026-11-05). Asked only for a body
# that already failed voice-check. Jev down means no refusal.
def is_text(body, lead):
    stub = os.environ.get("HOOK_JUDGE_STUB")
    if stub is not None:
        return stub != "" and float(stub) >= LINE
    for d in sys.argv[2:]:
        if os.path.isfile(os.path.join(d, "jev.py")):
            sys.path.insert(0, d)
            break
    else:
        return False
    import jev
    a = jev.ask({"lead_in": lead, "block": body[:2000]},
                {"q": {"type": "noul", "instructions": QUESTION}}, timeout=3.0, decision="hook:voice-guard")
    p = jev.probability((a or {}).get("q", {}).get("noul")) if a else None
    return p is not None and p >= LINE


bad = []
for body, lead in bodies:
    if len(body.split()) < 6:
        continue
    r = subprocess.run(["python3", "-I", sys.argv[1], "--json", body], capture_output=True, text=True, timeout=20)
    if r.returncode == 1:
        try:
            why = json.loads(r.stdout).get("reasons", [])
        except ValueError:
            why = []
        if is_text(body, lead):
            bad.append((body[:80], why))
if not bad:
    sys.exit(0)
open(guard, "w").close()
for body, why in bad:
    print(f"- \"{body}...\": " + "; ".join(why))
' "$VC" "$(dirname "${BASH_SOURCE[0]}")/../../bin/lib" "${CHEWBACCA_ROOT:-/nonexistent}/bin/lib" "$HOME/.chewbacca/kit/current/bin/lib")

[ -n "$OUT" ] || exit 0
{
  echo "voice-guard: a text in this reply doesn't read like something Caleb sends, measured against his own sent texts:"
  echo "$OUT"
  echo "The reply is already on his screen, so do NOT repeat or rewrite it. Send only the corrected texts, rebuilt from his real texts to that person (people texts <name>): short pieces sent one after another, no colon lists, words he has actually typed, under one short line saying they replace the ones above. Do not mention this check."
} >&2
exit 2
