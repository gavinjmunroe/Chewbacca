#!/bin/bash
# hookd skips this guard for a Bash call that names none of the heavy tools
# its first check requires (the case list and the python import below).
# Proven by tools/hookd_replay.py: 0.073 s of CPU on every Bash call before
# (2026-10-12).
# gate: whisper yt-transcript ffmpeg ollama llama-cli llama-server stable-diffusion
# gate: comfyui blender nalana torch upscayl handbrakecli
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init load-guard.sh 10
# PreToolUse: HARD BLOCK on fanning out CPU-bound local work onto Caleb's Mac.
#
# Written 2026-09-22. Building a video corpus, this kit ran six local Whisper
# transcriptions at once with `xargs -P 6`. Twenty minutes later Caleb asked
# "Why is my computer so laggy rn". The fifteen-minute load average was 50, and
# two ~1GB mlx_whisper workers then survived the first `pkill` because their
# command line was `python -c "import mlx_whisper"` and the pattern matched the
# parent instead.
#
# He was not annoyed at the work: "Wait I didn't say stop if it ws for good
# reason that's chill". He was annoyed that his machine became unusable while
# he was on it, and that nobody noticed until he said so.
#
# WHY PROSE DID NOT CATCH THIS. The kit's parallelism rule says independent
# calls go in one message and never sequential when parallel works, and it is
# right, because tool calls and subagents are network-bound and close to free.
# Local inference is not that. Six Whisper jobs is six cores, which on a laptop
# is the whole machine. The rule never made the CPU-bound versus IO-bound
# distinction, so following it exactly produced this.
#
# Two ways through, both of which the agent can take itself:
#
#   1. Run it serially at lowest priority, which is what shipped in the end:
#        for x in ...; do nice -n 19 <heavy> "$x"; done
#      Slower in wall clock, invisible to the person using the machine, and it
#      still finishes. A command carrying `nice -n 10` or higher passes.
#
#   2. If the fan-out is genuinely worth the machine, say so out loud first:
#        touch ~/.chewbacca/load-authorized
#      Good for 10 minutes, same shape as submit-guard.
#
# It also refuses heavy local work of ANY width when the machine is already
# under load, because the second job is what turns a slow machine into an
# unusable one.

set -uo pipefail

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# chewbacca-bashparse (crates/bashparse, tree-sitter-bash) blanks the words
# the shell hands to a command that only prints, searches or lists them
# (echo, grep, which, ls, command -v, a commit message), when that output
# goes nowhere but the screen. Everything below then reads that text, so it
# refuses a subset of what it did; the parse's own finds are added further
# down. No binary, a parse error, or anything decided at run time: the raw
# command, exactly as before. Measured 2026-10-12 over 7 days: 29 of
# load-guard's 54 refusals were lookups like `which ffmpeg` and
# `grep -E 'transcri|whisper'`, whose quoted | the old split cut through.
bp="${CHEWBACCA_BASHPARSE:-$HOME/.local/bin/chewbacca-bashparse}"
raw_cmd="$cmd"
if [ -x "$bp" ] && masked="$(printf '%s' "$cmd" | "$bp" --mask load 2>/dev/null)"; then
  cmd="$masked"
fi

# Test against the command with its DATA stripped out, not the raw text.
#
# On 2026-09-22, an hour after this hook shipped, it blocked a python heredoc
# that was editing a markdown file, because the markdown being written said
# "6 local Whisper jobs took his load to 50". The guard read its own incident
# report as an invocation of whisper. submit-guard hit exactly this on its
# first day and the comment below the read-exemption says so, which means the
# lesson was written down here and still not applied to the main test.
#
# So: drop heredoc bodies and quoted strings first. A heavy binary named
# inside data is a word. A heavy binary outside it is a command.
# Two passes, because the two kinds of data are not equally ambiguous.
#
# A heredoc body is ALWAYS data. Nothing executes from inside one, so it is
# stripped unconditionally. This matters more than it looks: the commit
# message explaining this very fix was itself a heredoc quoting `xargs -P 4
# python3 -I -c "import mlx_whisper"`, and the first version of this fix blocked
# the commit, because it had decided to read the raw text whenever it saw the
# word xargs anywhere. Describing a fan-out is not performing one.
nohd="$(printf '%s\n' "$cmd" | awk '
  # A heredoc ends at ITS delimiter, never at the first all-letters line: an
  # empty line matches /^[A-Za-z_]*$/, so a blank line in a commit message
  # used to end the heredoc early and the rest was read as commands
  # (load-guard refused a commit message that mentioned a video tool,
  # 2026-09-27). The text before << is still a command and stays.
  !inh {
    if (match($0, "<<-?[ \t]*[\047\042]?[A-Za-z_][A-Za-z0-9_]*[\047\042]?") && substr($0, RSTART - 1, 1) != "<") {
      d = substr($0, RSTART, RLENGTH); gsub("<<-?[ \t]*|[\047\042]", "", d)
      print substr($0, 1, RSTART - 1); inh = 1; next
    }
    print; next
  }
  { t = $0; sub("^[ \t]+", "", t); if (t == d) inh = 0; next }
')"
# A quoted string is sometimes data and sometimes the argument that names the
# binary, so it is only stripped when nothing outside it looks like a fan-out.
stripped="$(printf '%s' "$nohd" | sed "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g")"
# Which text to test depends on whether this is a fan-out.
#
#   With xargs/parallel/&: test the RAW command. `xargs -P 4 python3 -c
#   "import mlx_whisper"` names the heavy thing inside quotes and is still a
#   real six-wide fan-out, so stripping quotes there would miss the exact
#   shape of the original incident.
#
#   Without them: test the STRIPPED command, so prose about whisper is prose.
# Redirects are not backgrounding. `2>&1`, `&>file` and `&&` all contain an
# ampersand, and on 2026-10-09 a `2>&1` sent four plain lookups down the raw
# path, where a quoted tool name counts, and all four were refused.
noredir="$(printf '%s' "$nohd" | sed -E 's/[0-9]*>&[0-9-]+//g; s/&>//g; s/&&/;/g')"
if printf '%s' "$noredir" | grep -qE 'xargs|parallel|&'; then
  subject="$nohd"
else
  subject="$stripped"
fi
lower="$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]')"

# Local inference and transcode, the things that actually saturate cores.
# Deliberately NOT a general "python" or "node": this fires on named heavy
# binaries only, so writing a script that happens to mention them is safe.
heavy=0
case "$lower" in
  *whisper*|*mlx_whisper*|*mlx-whisper*|*yt-transcript*|*ffmpeg*|*ollama\ run*\
  |*llama-cli*|*llama-server*|*stable-diffusion*|*comfyui*|*"blender -b"*|*"nalana -b"*|*nalana.app*\
  |*"torch.compile"*|*upscayl*|*handbrakecli*) heavy=1 ;;
esac
# `python3 -I -c "import mlx_whisper"` names the model only inside quotes, which
# the stripped subject drops. A python command importing it is a real job.
if [ "$heavy" = 0 ] && printf '%s' "$nohd" | grep -qiE 'python[0-9.]*[^|;&]*(import|-m) *(mlx_whisper|whisper|torch)'; then
  heavy=1
fi
# What the parse adds: a heavy tool the shell really runs where the text
# above can't see it, behind xargs or timeout, inside `bash -c '...'` or
# `$( )`, or in a heredoc fed to a shell. Before 2026-10-12 `bash -c
# 'ffmpeg -i a b'` and `cat ids | xargs yt-transcript` under load both passed.
# Only where it could change the answer: a busy machine, or a fan-out (the
# two cases that refuse). On a quiet machine this python costs 0.1 s of CPU
# per call for nothing (0.107 to 0.216 s measured 2026-10-12, load 8).
parse_running=""
busy="${LOAD_GUARD_LOAD:-$(uptime | grep -oE 'load averages?: *[0-9.]+' | grep -oE '[0-9.]+$')}"
busy="${busy%%.*}"
if [ -x "$bp" ] && { [ "${busy:-0}" -ge 8 ] 2>/dev/null || printf '%s' "$raw_cmd" | grep -qE 'xargs|parallel|&'; } &&
   facts="$(printf '%s' "$raw_cmd" | "$bp" 2>/dev/null)" && [ -n "$facts" ]; then
  parse_running=$(LG_FACTS="$facts" python3 -I - <<'PY'
import json, os, re
heavy = {"whisper", "mlx_whisper", "mlx-whisper", "yt-transcript", "ffmpeg",
         "llama-cli", "llama-server", "stable-diffusion", "comfyui", "upscayl",
         "handbrakecli", "blender", "nalana", "ollama"}
ASK = {"--version", "-version", "--help", "-help", "-h", "-encoders", "-decoders", "-codecs", "-formats", "-filters"}
QUIET = {"-b", "-hide_banner", "--background"}
wrap = {"nice", "time", "env", "nohup", "caffeinate", "exec", "sudo", "command",
        "timeout", "gtimeout", "xargs", "parallel", "noglob"}
try:
    facts = json.loads(os.environ.get("LG_FACTS") or "null") or {}
except ValueError:
    facts = {}
for c in facts.get("commands", []):
    words = [c.get("name")] + list(c.get("args") or [])
    if words[:2] == ["command", "-v"] or words[:1] in (["which"], ["type"]):
        continue
    while words and words[0] is not None and (os.path.basename(words[0]) in wrap or "=" in words[0]
                                               or words[0].startswith("-") or words[0].isdigit()):
        words = words[1:]
    if not words or words[0] is None:
        continue
    first = os.path.basename(words[0]).lower()
    # Asked only for a version, help or a capability list: exits at once.
    # Same rule as chewbacca-bashparse --mask load.
    args = words[1:]
    if args and None not in args and any(a in ASK for a in args) and (
            all(a in ASK or a in QUIET for a in args)
            or (len(args) == 2 and not args[0].startswith("-") and args[1] in ("--help", "-h", "-help"))):
        continue
    rest = " ".join(w for w in words[1:] if w)
    # Same bar as the text check above: ollama only when it runs a model,
    # blender and nalana only in the background (-b). `ollama list` at load
    # 99 was refused by the first cut of this (corpus replay, 2026-10-12).
    if first == "ollama" and args[:1] != ["run"]:
        continue
    if first in ("blender", "nalana") and not ({"-b", "--background"} & set(a for a in args if a)):
        continue
    if first in heavy or (first.startswith("python") and re.search(r"(import|-m)\s*(mlx_whisper|whisper|torch)", rest, re.I)):
        print("yes")
        break
PY
)
fi
[ "$parse_running" = "yes" ] && heavy=1
[ "$heavy" = 1 ] || exit 0

# Reading about it is not running it. submit-guard learned this the hard way
# when a note ABOUT the rule tripped the rule on its first day.
#
# But the exemption only applies to a command that is ONLY a read. The first
# version keyed on the leading word, and `cat ids.txt | xargs -P 6 -I{}
# yt-transcript {}` starts with cat, so the guard exempted the exact command
# that caused the incident it was written for. A leading verb does not
# describe a pipeline.
if [ "$parse_running" != "yes" ] && ! printf '%s' "$cmd" | grep -qE '[|;&]|xargs|parallel'; then
  case "$lower" in
    cat\ *|less\ *|head\ *|tail\ *|grep\ *|rg\ *|wc\ *|ls\ *|find\ *|echo\ *) exit 0 ;;
  esac
fi
# A kill is the fix, never the problem.
case "$lower" in
  *pkill*|*killall*|*"kill -"*) exit 0 ;;
esac

# Already being polite? Let it through. nice 10+ yields the machine to whatever
# Caleb is actually doing.
if printf '%s' "$lower" | grep -qE 'nice -n *(1[0-9]|20)'; then exit 0; fi

# Did he authorize the fan-out in the last 10 minutes?
AUTH="$HOME/.chewbacca/load-authorized"
if [ -f "$AUTH" ]; then
  now=$(date +%s)
  then_=$(stat -f %m "$AUTH" 2>/dev/null || stat -c %Y "$AUTH" 2>/dev/null || echo 0)
  [ $((now - then_)) -lt 600 ] && exit 0
fi

# How wide is this? xargs -P N, parallel -j N, or a loop backgrounding with &.
width=1
p=$(printf '%s' "$cmd" | grep -oE '(xargs[^|]*-P *|parallel[^|]*-j *)[0-9]+' | grep -oE '[0-9]+$' | sort -rn | head -1)
[ -n "$p" ] && width="$p"
# `... &` inside a for/while loop is an unbounded fan-out, which is worse than
# a counted one because nothing caps it.
if printf '%s' "$cmd" | grep -qE '(for |while ).*(do|;).*&[[:space:]]*(done|$)'; then
  width=99
fi

# Current machine state. One decimal figure, the 1-minute load average.
#
# LOAD_GUARD_LOAD overrides it, for tests only. Without a seam here the test
# for "a single heavy job passes" depends on what the machine happens to be
# doing, and it flipped from pass to fail between two runs an hour apart with
# no code change. A test that reports the weather is not a test.
load="${LOAD_GUARD_LOAD:-}"
if [ -z "$load" ]; then
  load=$(uptime | grep -oE 'load averages?: *[0-9.]+' | grep -oE '[0-9.]+$')
fi
[ -n "$load" ] || load=0
load_int=${load%%.*}
[ -n "$load_int" ] || load_int=0

block=""
if [ "$width" -ge 3 ]; then
  block="width"
elif [ "$load_int" -ge 8 ]; then
  block="load"
fi
[ -n "$block" ] || exit 0

# Under load alone (no fan-out), only refuse when the heavy tool is the thing
# being RUN: the first word of a command, or python importing it. On
# 2026-10-09 `command -v ffmpeg`, `ls ~/.cache | grep whisper` and similar
# lookups were refused at load 30, because the word appeared at all.
if [ "$block" = "load" ]; then
  running=$(LG_CMD="$nohd" python3 -I - <<'PY'
import os, re, shlex
heavy = {"whisper", "mlx_whisper", "mlx-whisper", "yt-transcript", "ffmpeg",
         "llama-cli", "llama-server", "stable-diffusion", "comfyui", "upscayl",
         "handbrakecli", "blender", "nalana", "ollama"}
skip = {"nice", "time", "env", "nohup", "caffeinate", "exec", "sudo"}
text = os.environ.get("LG_CMD", "")
for seg in re.split(r"[;|&\n]|\b(?:do|then|else)\b", text):
    try:
        words = shlex.split(seg)
    except ValueError:
        words = seg.split()
    if words[:2] == ["command", "-v"] or words[:1] in (["which"], ["type"]):
        continue
    while words and (words[0] in skip or "=" in words[0]
                     or words[0].startswith("-") or words[0].isdigit()):
        words = words[1:]
    if not words:
        continue
    first = os.path.basename(words[0]).lower()
    if first in heavy:
        print("yes"); break
    if first.startswith("python") and re.search(r"whisper|torch", seg, re.I):
        print("yes"); break
PY
)
  [ "$running" = "yes" ] || [ "$parse_running" = "yes" ] || exit 0
fi

cores=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 8)

{
  echo "BLOCKED by load-guard: this fans out CPU-bound local work onto the machine Caleb is using."
  echo
  if [ "$block" = "width" ]; then
    if [ "$width" = 99 ]; then
      echo "  Detected: a loop backgrounding heavy jobs with & and nothing capping it."
    else
      echo "  Detected: parallel width $width on $cores cores, running local inference or transcode."
    fi
  else
    echo "  Detected: heavy local work while the 1-minute load average is already $load."
  fi
  echo
  echo "On 2026-09-22 six parallel Whisper jobs took his load average to 50 and he"
  echo "asked why his computer was laggy. The work was fine. Six wide was not."
  echo
  echo "Hand it to the machine queue, which runs it when there's room, pauses it"
  echo "when the Mac gets busy, and outlives this tab:"
  echo
  echo "  chewbacca jobs submit --heavy --title \"what it is\" -- <command>"
  echo
  echo "Or one of these:"
  echo
  echo "  1. Serial and polite, which is what ended up working:"
  echo "       for x in ...; do nice -n 19 <command> \"\$x\"; done"
  echo "     Slower in wall clock, invisible to him, and it still finishes."
  echo
  echo "  2. If the fan-out is genuinely worth his machine, ask him, then:"
  echo "       touch ~/.chewbacca/load-authorized"
  echo "     Good for 10 minutes."
  echo
  echo "Network-bound work does not need this. Fan out tool calls, subagents and"
  echo "downloads as wide as you like. This is about cores."
} >&2

exit 2
