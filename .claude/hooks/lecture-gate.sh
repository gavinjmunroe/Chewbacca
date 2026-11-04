#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init lecture-gate.sh 10
# PreToolUse: refuse a coursework SPEC that never cites the lecture deck that
# assigned the work.
#
# Written 2026-11-02. The ACAD 185 A20 Hero's Journey went in as 19 slides of
# text, built from A20-SPEC.md, which was built from the dropbox brief. The
# W10S20 deck that assigned A20 asks for an AI-image storyboard, and it had
# never been pulled to disk. A teammate caught it the night before it was due.
# Caleb: "WHY WEREND THEY PULLED TO DISK??????".
#
# The map comes from `brightspace-sync refresh` (daily), which writes
# <slides>/<CODE>/deck-index.json: every deck that names each ledger
# assignment, the one that assigned it first. A SPEC whose name or title is
# that assignment has to cite one of them, and `brightspace submit` of a file
# named for it needs such a SPEC on disk, so skipping the SPEC can't get past.
#
# Exit 2 blocks the call.

set -uo pipefail
payload="$(cat)"
slides="${LECTURE_GATE_SLIDES:-${COURSEWORK_DIR:-$HOME/coursework}/slides}"
have=""
for f in "$slides"/*/deck-index.json "$slides"/*/assigned-in.json; do [ -f "$f" ] && have=1 && break; done
[ -n "$have" ] || exit 0
# Every Bash call reaches this hook; only a submit is its business.
case "$payload" in *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*)
  case "$payload" in *"brightspace"*submit*) ;; *) exit 0 ;; esac ;;
esac

# Read into a variable first: bash 3.2 misparses quotes in a heredoc inside $( ).
IFS= read -r -d '' py <<'PY'
import glob, json, os, re, time
p = json.loads(os.environ["PAYLOAD"] or "{}")
ti = p.get("tool_input") or {}
slides = os.environ["SLIDES"]
tool = p.get("tool_name")

ID = re.compile(r"\b([A-Z]{1,3}\d+[a-z]?)\b|\bProject\s+(\d+[a-z]?)\b")


def ids_in(s):
    return {m[1] or "P" + m[2] for m in ID.finditer(s)}


maps = {}
for d in glob.glob(f"{slides}/*/"):
    code = os.path.basename(os.path.dirname(d))
    idx = {}
    try:
        idx = json.load(open(os.path.join(d, "deck-index.json")))
    except (OSError, ValueError):
        try:
            for a, g in json.load(open(os.path.join(d, "assigned-in.json"))).items():
                idx[a] = [{"deck": g["deck"], "cite": [g["session"], g["deck"][:-4].split(" ", 1)[-1]]}]
        except (OSError, ValueError):
            pass
    if idx:
        maps[code] = idx


def cited(text, hits):
    low = text.lower()
    return any(c.lower() in low for h in hits for c in h["cite"])


def wanted(code, aid):
    hits = maps[code][aid]
    first = os.path.join(slides, code, hits[0]["deck"])
    if not os.path.exists(first):
        first += f" (NOT on disk: run brightspace-sync refresh --out {slides} --apply)"
    return first, hits


def deliverable_ids(path, text):
    title = next((l for l in text.splitlines() if l.strip()), "")
    return ids_in(os.path.basename(path) + " " + title)


def courses_for(aid, text, only=None):
    out = []
    for code, idx in maps.items():
        if aid not in idx or (only and code != only):
            continue
        spaced = code.replace("-", "[ -]?")
        if only or re.search(spaced, text, re.I) or sum(aid in m for m in maps.values()) == 1:
            out.append(code)
    return out


if tool in ("Write", "Edit", "MultiEdit"):
    path = ti.get("file_path") or ""
    if not re.search(r"spec[^/]*\.md$", path, re.I):
        raise SystemExit
    if tool == "Write":
        text = ti.get("content") or ""
    else:
        try:
            text = open(path).read()
        except OSError:
            text = ""
        for e in ti.get("edits") or [ti]:
            if e.get("old_string"):
                text = text.replace(e["old_string"], e.get("new_string") or "", 1)
            else:
                text += e.get("new_string") or ""
    for aid in sorted(deliverable_ids(path, text)):
        for code in courses_for(aid, text):
            first, hits = wanted(code, aid)
            if not cited(text, hits):
                print(f"{aid} ({code}) comes from a lecture this SPEC never cites. Start with:\n  {first}")
elif tool == "Bash":
    cmd = ti.get("command") or ""
    import shlex
    try:
        argv = shlex.split(cmd)
    except ValueError:
        argv = cmd.split()
    i = next((k for k in range(len(argv) - 1) if argv[k].endswith("brightspace") and argv[k + 1] == "submit"), None)
    if i is None:
        raise SystemExit
    args = argv[i + 2:]
    for k, a in enumerate(args):
        if a in ("&&", "||", ";", "|"):
            args = args[:k]
            break
    if "--dry-run" in args:
        raise SystemExit
    pos = [a for a in args if not a.startswith("-")]
    if len(pos) < 3:
        raise SystemExit
    if not pos[0].isdigit():
        # `brightspace submit WRIT ...` takes a course name since 2026-11-03.
        # Map it to an ou through the same cache brightspace reads, so a name
        # never walks past this gate; an unknown name is still gated, with no code.
        import re as _re
        norm = lambda t: _re.sub(r"[^a-z0-9]", "", str(t).lower())
        q = norm(pos[0])
        try:
            cmap = json.load(open(os.environ.get("BRIGHTSPACE_MAP") or os.path.join(
                os.environ.get("BRIGHTSPACE_STATE") or os.path.expanduser("~/.chewbacca/brightspace"),
                "map.json"))).get("courses") or {}
        except (OSError, ValueError):
            cmap = {}
        hits = {tuple(u) for c, u in cmap.items() if q and norm(c) and (norm(c).startswith(q) or q.startswith(norm(c)))}
        pos[0] = str(next(iter(hits))[0]) if len(hits) == 1 and next(iter(hits)) else ""
    m = (None, pos[0], " ".join(pos[2:]))
    try:
        code = json.load(open(os.path.join(slides, "courses.json"))).get(m[1]) if m[1] else None
        if code is None and m[1]:
            raise SystemExit  # an ou outside this term's courses
    except (OSError, ValueError):
        code = None
    # The work went in without a SPEC at all: the other way past the Write gate.
    dirs = os.environ.get("LECTURE_GATE_SPEC_DIRS") or " ".join(
        os.path.expanduser(x) for x in ("~/Downloads", "~/code/school", "~/coursework", "~/code/kits"))
    specs = []
    cutoff = time.time() - 45 * 86400
    # Bounded walk. Unbounded, globbing ~/Downloads and ~/code/school with their
    # node_modules took over 5 s on 2026-11-02, the watchdog killed the hook,
    # and tonight's real A20 submit was allowed. Out of budget now means deny.
    SKIP = {"node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".text"}
    budget = time.time() + 4
    seen = 0
    for d in dirs.split():
        base = d.rstrip("/").count("/")
        for root, subdirs, files in os.walk(d):
            subdirs[:] = [x for x in subdirs if x not in SKIP and not x.startswith(".")]
            if root.count("/") - base >= 4:
                subdirs[:] = []
            for name in files:
                seen += 1
                if seen > 200000 or time.time() > budget:
                    print("the SPEC search ran out of time, so nothing could confirm a SPEC cites the lecture.\n"
                          "  Put the SPEC in ~/coursework or the project folder, or set LECTURE_GATE_SPEC_DIRS.")
                    raise SystemExit
                if re.search(r"(spec|outline)[^/]*\.md$", name, re.I):
                    f = os.path.join(root, name)
                    try:
                        if os.path.getmtime(f) >= cutoff:
                            specs.append((f, open(f, errors="replace").read()))
                    except OSError:
                        pass
    for aid in sorted(ids_in(m[2])):
        for c in courses_for(aid, cmd, only=code):
            first, hits = wanted(c, aid)
            if not any(aid in deliverable_ids(f, t) and cited(t, hits) for f, t in specs):
                print(f"{aid} ({c}) is being submitted with no SPEC that cites the lecture behind it. Start with:\n  {first}")
PY
msg="$(PAYLOAD="$payload" SLIDES="$slides" /usr/bin/python3 -I -c "$py")"
[ -n "$msg" ] || exit 0
cat >&2 <<MSG
lecture-gate: refusing. $msg

Read that deck whole and write what it asks for into a SPEC, naming the deck
(or its session) next to each requirement. The dropbox brief is a
summary. The lecture is the spec. See "Read the lecture that assigned it
before building" in skills/coursework/SKILL.md.
MSG
exit 2
