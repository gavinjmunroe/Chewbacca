#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: run.sh closeout doctor blender init create cargo rails startproject
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init lesson-guard.sh 5
# PreToolUse (Bash, Agent, Task): three corrections Caleb repeated in the two
# weeks before 2026-10-11, each refused here instead of remembered in prose.
# Ranked in docs/plans/REPEAT-MISTAKES.md from 14 days of his transcripts.
#
# 1. A long check run in the foreground (feedback_nothing_takes_this_long, 8
#    repeats; feedback_slow_means_broken, 6). Measured on the turns he asked
#    "Wtf taking so long": a full tests/run.sh held the turn 601 to 1071 s
#    (10-03), the installer group 407 s (10-09 15:03), the tools group 315 s
#    (10-09 23:35), the reasoning backends group 251 s (10-08), bin/closeout
#    301 s (09-28), and a suite command 816 s (10-09 13:18). Each time the tab
#    went silent until it finished. In the background the turn can tell him
#    where things stand while it runs.
#
# 2. 3D work that skips Nalana (feedback_3d_means_nalana, 3 repeats: 10-05
#    "Bro use nalana", 10-06 "Bro we hv nalana.", 10-11 "Bro we hv NALANA never
#    forget"). A logo took ~12 blind headless renders. Headless blender is
#    refused, and so is a subagent brief about 3D that never names Nalana.
#
# 3. A new project started without looking for the existing one
#    (feedback_find_the_existing_thing_first: 10-04 a literal iOS keyboard
#    built all night when amber-circles already existed; 10-07 "Bro we hv the
#    repo sagar gave me"). The first `git init`, `gh repo create` or scaffolder
#    per session and target is refused with the closest existing repos listed;
#    the same command again goes through, so it costs one look, never a question.
#
# Cost: a Bash call that mentions none of these exits after one jq and a case
# match. Measured in tests/lesson_guard.sh.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"

if [ "$tool" = "Agent" ] || [ "$tool" = "Task" ]; then
  brief="$(printf '%s' "$payload" | jq -r '(.tool_input.prompt // "") + " " + (.tool_input.description // "")' 2>/dev/null)"
  if printf '%s' "$brief" | grep -qiE '\b(blender|\.blend\b|3d (render|scene|model|art|asset|room|object|logo|print)|diorama|isometric (art|scene|room|render))' &&
     ! printf '%s' "$brief" | grep -qi 'nalana'; then
    echo "lesson-guard: a 3D brief that never names Nalana. Caleb, 2026-10-11: \"Bro we hv NALANA never forget\" (third time in a week). Put it in the brief: drive Nalana, the live Blender at /Applications/Nalana.app, through the blender MCP tools (get_scene_info, execute_blender_code, look), never headless blender renders." >&2
    exit 2
  fi
  exit 0
fi
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$cmd" in
  *run.sh*|*closeout*|*doctor*|*blender*|*init*|*create*|*cargo\ new*|*rails\ new*|*startproject*) ;;
  *) exit 0 ;;
esac
bg="$(printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "none"' 2>/dev/null)"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"

LG_CMD="$cmd" LG_BG="$bg" LG_SESSION="$session" LG_CWD="$cwd" python3 -I -c '
import hashlib, os, re, shlex, sys
from pathlib import Path

cmd, bg = os.environ["LG_CMD"], os.environ["LG_BG"] == "true"
home = Path.home()

def segments(text):
    for line in text.split("\n"):
        for seg in re.split(r"&&|\|\||;|\|", line):
            try:
                toks = shlex.split(seg)
            except ValueError:
                toks = seg.split()
            while toks and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]) or
                            toks[0] in ("time", "nice", "caffeinate", "-i", "exec", "command", "env")):
                toks.pop(0)
            if toks:
                yield toks

# The groups tests/run.sh itself lists as slow (pytest ~300 s, hud ~170,
# reasoning backends 203, tools 183, doctor 123, installer 87; measured
# 2026-10-03), and the whole suite with no group.
SLOW = {"pytest", "hud", "reasoning backends", "tools", "doctor", "installer"}

def long_runner(toks):
    words = toks[1:] if toks[0] in ("bash", "sh", "zsh") else toks
    if not words:
        return ""
    head = words[0]
    if head.endswith("tests/run.sh"):
        rest, i, toks2 = [], 0, words[1:]
        while i < len(toks2):
            t = toks2[i]
            if re.match(r"^(\d*>>?|&>>?|<)$", t):
                i += 2
                continue
            if not re.match(r"^(\d*>|&>|<|--?\w)", t):
                rest.append(t)
            i += 1
        group = " ".join(rest).strip()
        if not group:
            return "the whole suite (tests/run.sh, ~6 min parallel, 10 to 18 min at load)"
        if group in SLOW:
            return f"the {group} group of tests/run.sh"
        return ""
    if head.endswith("closeout") or (head.endswith("chewbacca") and words[1:2] == ["closeout"]):
        return "closeout (301 s on 2026-09-28)"
    if head.endswith("doctor.sh") or (head.endswith("chewbacca") and words[1:2] == ["doctor"]):
        return "doctor"
    return ""

for toks in segments(cmd):
    what = long_runner(toks)
    if what and not bg and "CHEWBACCA_FOREGROUND_OK=1" not in cmd:
        print(f"lesson-guard: {what} in the foreground holds this turn silent until it ends. "
              "Caleb asked \"Wtf taking so long?\" eight times in a week (feedback_nothing_takes_this_long). "
              "Run it with run_in_background: true, tell him in one line where things stand, and read the "
              "result when it lands. A short check that must block can carry CHEWBACCA_FOREGROUND_OK=1.",
              file=sys.stderr)
        sys.exit(2)
    if toks[0].endswith("blender") and any(t in ("-b", "--background") for t in toks[1:]):
        print("lesson-guard: headless blender. Caleb, 2026-10-11: \"Bro we hv NALANA never forget\" "
              "(feedback_3d_means_nalana). Drive Nalana, the live Blender, through the blender MCP tools: "
              "get_scene_info, execute_blender_code, then look to see the result.", file=sys.stderr)
        sys.exit(2)

# New projects.
SCAFFOLD = re.compile(r"^(?:git init|gh repo create|npx (?:-y )?create-[\w-]+|npm (?:create|init) [\w@/-]+|"
                      r"pnpm create|yarn create|bun create|cargo new|swift package init|rails new|"
                      r"django-admin startproject|flutter create|expo init|npx (?:-y )?create-expo-app)\b")
here = Path(os.environ["LG_CWD"] or ".")
for toks in segments(cmd):
    line = " ".join(toks)
    if toks[0] == "cd" and len(toks) > 1:
        here = here / Path(toks[1]).expanduser()
        continue
    m = SCAFFOLD.match(line)
    if not m:
        continue
    rest = toks[len(m.group(0).split()):]
    args = [t for t in rest if not t.startswith("-")]
    target = Path(args[0]).name if args else here.name
    # The folder the project lives in. gh repo create names a repo, not a
    # folder, unless it is pointed at one with --source.
    source = next((t.split("=", 1)[1] for t in rest if t.startswith("--source=")), None)
    if source is None and "--source" in rest[:-1]:
        source = rest[rest.index("--source") + 1]
    if m.group(0).startswith("gh repo create"):
        project = str((here / Path(source).expanduser()).resolve()) if source else "gh:" + target.lower()
    else:
        project = str((here / Path(args[0]).expanduser()).resolve()) if args else str(here.resolve())
    where = str(Path(os.environ["LG_CWD"] or ".").resolve())
    # Scratch and test trees are throwaway by design.
    if re.match(r"^/(?:private/)?(?:tmp|var/folders)/", where) or "scratch" in where:
        continue
    session = os.environ["LG_SESSION"]
    # One look per project per session. The weekly false-positive report
    # (hookd_replay.py fp) on 2026-10-12 found 3 refusals by this rule that
    # week rerun unchanged, and 2 of them were the second refusal for one
    # project: `git init` in ~/code/design-quiz2, then `gh repo create
    # calebnewtonusc/design-quiz2 --source=.`, each keyed on its own command
    # line. Both point at one folder, so the key is that folder, resolved (a
    # bare name collided `git init .` in two folders, review 10/12).
    key = hashlib.sha256(f"{session}|{project}".encode()).hexdigest()[:24]
    state = Path(os.environ.get("CHEWBACCA_HOME") or home / ".chewbacca") / "state" / "lesson-guard"
    try:
        state.mkdir(parents=True, exist_ok=True)
    except OSError:
        sys.exit(0)
    mark = state / key
    if mark.exists():
        continue
    mark.touch()
    want = set(re.split(r"[^a-z0-9]+", target.lower())) - {"", "app", "the", "new", "site", "web"}
    repos = []
    roots = [home / "code", home / "Desktop" / "2026-Code"]
    for root in roots:
        for git in list(root.glob("*/.git")) + list(root.glob("*/*/.git")):
            name = git.parent.name.lower()
            score = len(want & set(re.split(r"[^a-z0-9]+", name)))
            repos.append((score, str(git.parent).replace(str(home), "~")))
    repos.sort(key=lambda r: (-r[0], r[1]))
    near = [r for s, r in repos if s] or []
    print(f"lesson-guard: about to start a new project ({line[:60]}). On 2026-10-04 a whole night went into "
          "a new keyboard while amber-circles already existed, and on 10-07 Caleb said \"Bro we hv the repo\" "
          "(feedback_find_the_existing_thing_first). Look first: gh repo list, ls ~/code/*/, the brain index."
          + (" Closest existing by name: " + ", ".join(near[:6]) + "." if near else "")
          + " If none of them is it, run the same command again and it goes through.", file=sys.stderr)
    sys.exit(2)
'
exit $?
