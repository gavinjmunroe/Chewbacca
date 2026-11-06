#!/usr/bin/env bash
# Shared hook runtime: timing, a log, a watchdog, and an output cap.
#
# Eight hooks ran before every session and none of them left a trace. A hook
# that failed degraded every session silently, a slow one taxed every session
# invisibly, and a chatty one could eat the context window before the user
# typed. Every hook sources this on line 3 and gets all four for free.
#
# Contract for a hook:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
#   hook_init <name> [timeout_seconds]
# Everything after that is timed, logged, and killed if it hangs.

CHEWBACCA_LOG_DIR="${CHEWBACCA_LOG_DIR:-$HOME/.chewbacca/logs}"
CHEWBACCA_HOOK_LOG="$CHEWBACCA_LOG_DIR/hooks.log"
# A hook is not allowed to spend more of the user's context than this. The
# session-context hook once emitted an unbounded coursework dump.
CHEWBACCA_HOOK_MAX_BYTES="${CHEWBACCA_HOOK_MAX_BYTES:-8000}"

# Every decision a hook makes is one row in the verdict log, read by
# `chewbacca why --refused` (tools/verdicts.py holds the format and the reader).
# Before 2026-10-12 the only trace was hooks.log: name, ms and exit code, cut to
# 3,000 lines, which at 1,500 rows an hour kept about three hours. It held 394
# refusals from 01:04 to 04:10 that night and not one said why, or in which
# session, so "why was this refused" meant reading transcripts.
CHEWBACCA_VERDICT_LOG="${CHEWBACCA_VERDICT_LOG:-$CHEWBACCA_LOG_DIR/verdicts.tsv}"
# Rotate past this size. 4,658 hook rows landed in 3h06m on 2026-10-12, about
# 36,000 a day; an allow row is ~110 bytes, so 8 MB is roughly two days per file.
CHEWBACCA_VERDICT_MAX_BYTES="${CHEWBACCA_VERDICT_MAX_BYTES:-8000000}"

# Perl first, python only where there is no perl. Every hook calls this twice,
# and a dozen hooks run on every Bash call. Measured 2026-10-11 at load 22:
# python3 -I took ~62 ms to start and perl ~20 ms, so a hook that did nothing
# cost ~175 ms with python and ~95 ms with perl. That was the floor under
# "Bro hurry up" and "Why is it taking that long???" (feedback_slow_means_broken):
# the tax was paid before any hook did any work.
_hook_ms() {
  perl -MTime::HiRes=time -e 'printf "%d\n", time*1000' 2>/dev/null ||
    python3 -I -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo 0
}

hook_init() {
  _HOOK_NAME="${1:-$(basename "${BASH_SOURCE[1]:-hook}")}"
  _HOOK_TIMEOUT="${2:-10}"
  _HOOK_START="$(_hook_ms)"
  mkdir -p "$CHEWBACCA_LOG_DIR" 2>/dev/null || true
  _HOOK_VERDICT=""; _HOOK_REASON=""; _HOOK_ERR=""
  _hook_buffers && _HOOK_ERR="${TMPDIR:-/tmp}/chewbacca-hook-err.$$"

  # Watchdog. A hook that hangs blocks the session with no error and no
  # explanation, which is the worst failure this kit has shipped.
  if [ "$_HOOK_TIMEOUT" -gt 0 ] 2>/dev/null; then
    # It ends the hook with exit 0, not SIGKILL. A straight kill -9 made the
    # hook exit 137, which the host reports as a hook error: on 2026-10-09, at
    # load 61, kit-autopush.sh ran past its 30s on git and the suite's "survives
    # empty input" check failed with exit 137. So the stuck child is stopped
    # first, the TERM trap exits 0, and -9 is only the last resort.
    ( sleep "$_HOOK_TIMEOUT"
      kill -0 $$ 2>/dev/null && {
        _hook_log timeout "killed after ${_HOOK_TIMEOUT}s"
        for child in $(pgrep -P $$ 2>/dev/null); do
          [ "$child" = "$BASHPID" ] || kill -TERM "$child" 2>/dev/null
        done
        kill -TERM $$ 2>/dev/null
        sleep 2
        # Killed here, the hook never runs its EXIT trap, so what it held is
        # lost either way (the host sees exit 137); at least the file goes.
        kill -0 $$ 2>/dev/null && { kill -9 $$ 2>/dev/null; rm -f "$_HOOK_ERR" 2>/dev/null; }
      } ) >/dev/null 2>&1 &
    _HOOK_WATCHDOG=$!
    trap 'exit 0' TERM
  fi

  # The hook's stderr is held in a file until it exits, then handed on
  # unchanged, so its verdict row can say why it refused. The host reads a
  # hook's stderr only after it exits, so nothing arrives later than before.
  # hookd reads the stderr of the guards it runs itself (HOOKD_VERDICTS holds
  # its pid), and a hook that execs a program or replaces the EXIT trap calls
  # hook_unbuffer first (tests/test_verdicts.py holds every hook to that).
  #
  # The host's stderr waits on fd 8 meanwhile, and anything that inherits it
  # holds the host's pipe open: a review on 2026-10-12 measured stderr EOF at
  # 5 s instead of 0 when the watchdog's sleep had it. So this runs after the
  # watchdog forks, and every background spawn in a hook closes it (8>&-).
  if _hook_buffers; then
    if { : > "$_HOOK_ERR"; } 2>/dev/null; then
      exec 8>&2 2>>"$_HOOK_ERR"
    else
      _HOOK_ERR=""
    fi
  fi
  trap '_hook_finish $?' EXIT
}

# Does this run hold its stderr for the verdict row? Not when hookd started
# it (hookd reads the guard's stderr itself; HOOKD_VERDICTS is hookd's pid, so
# a process further down that inherits the variable still logs), and not when
# the log is switched off.
_hook_buffers() {
  [ "${CHEWBACCA_VERDICTS:-1}" != "0" ] || return 1
  [ -n "${HOOKD_VERDICTS:-}" ] && [ "$HOOKD_VERDICTS" = "$PPID" ] && return 1
  return 0
}

_hook_log() {
  local status="$1" detail="${2:-}" ms=0
  _HOOK_NOW="$(_hook_ms)"
  [ -n "${_HOOK_START:-}" ] && ms=$(( _HOOK_NOW - _HOOK_START ))
  _HOOK_ELAPSED="$ms"
  printf '%s|%s|%s|%s|%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "${_HOOK_NAME:-unknown}" "$ms" "$status" "$detail" \
    >> "$CHEWBACCA_HOOK_LOG" 2>/dev/null || true
  # Keep the log from growing without bound. 5000 lines is weeks of sessions.
  if [ -f "$CHEWBACCA_HOOK_LOG" ] && [ "$(wc -l < "$CHEWBACCA_HOOK_LOG" 2>/dev/null || echo 0)" -gt 5000 ]; then
    tail -3000 "$CHEWBACCA_HOOK_LOG" > "$CHEWBACCA_HOOK_LOG.tmp" 2>/dev/null &&
      mv "$CHEWBACCA_HOOK_LOG.tmp" "$CHEWBACCA_HOOK_LOG" 2>/dev/null || true
  fi
}

_hook_finish() {
  local rc="${1:-0}"
  # Reaped here, quietly: otherwise bash reports "Killed: 9" for it on the
  # stderr hook_unbuffer is about to hand back to the host.
  # `|| true`: wait returns 137 here, which under `set -e` would end the
  # EXIT trap before the held stderr goes out (review, 2026-10-12).
  [ -n "${_HOOK_WATCHDOG:-}" ] && { kill -9 "$_HOOK_WATCHDOG"; wait "$_HOOK_WATCHDOG" || true; } 2>/dev/null
  type hook_cache_release >/dev/null 2>&1 && hook_cache_release
  [ "$rc" -eq 0 ] || _hook_read_reason
  hook_unbuffer
  if [ "$rc" -eq 0 ]; then _hook_log ok "${_HOOK_DETAIL:-}"; else _hook_log "exit$rc" "${_HOOK_DETAIL:-}"; fi
  local decision="${_HOOK_VERDICT:-}"
  if [ -z "$decision" ]; then
    case "$rc" in 0) decision=allow ;; 2) decision=refuse ;; *) decision=error ;; esac
  fi
  # hookd writes the row for a guard it ran, with the payload in hand.
  [ -n "${HOOKD_VERDICTS:-}" ] && [ "$HOOKD_VERDICTS" = "$PPID" ] ||
    hook_verdict_row hook "${_HOOK_NAME:-unknown}" "$decision" "${_HOOK_ELAPSED:-0}" "${_HOOK_REASON:-}"
}

# The first lines of what the hook printed to stderr, once, before it is
# handed on: that is the refusal text the agent saw.
_hook_read_reason() {
  [ -n "${_HOOK_REASON:-}" ] && return 0
  [ -n "${_HOOK_ERR:-}" ] && [ -s "$_HOOK_ERR" ] || return 0
  local line n=0
  while [ "$n" -lt 4 ] && IFS= read -r line; do
    [ -n "$line" ] || continue
    _HOOK_REASON="${_HOOK_REASON}${_HOOK_REASON:+ / }$line"
    n=$((n + 1))
  done < "$_HOOK_ERR"
}

# Hand the held stderr on and stop holding it. A hook calls this itself before
# it execs another program or sets its own EXIT trap; either would skip
# _hook_finish and leave the text in the file.
hook_unbuffer() {
  [ -n "${_HOOK_ERR:-}" ] || return 0
  exec 2>&8 8>&-
  [ -s "$_HOOK_ERR" ] && cat "$_HOOK_ERR" >&2
  rm -f "$_HOOK_ERR" 2>/dev/null
  _HOOK_ERR=""
}

# Say what this run decided when the exit code doesn't: a block printed as
# JSON on stdout exits 0. hook_verdict refuse "the reason"
hook_verdict() { _HOOK_VERDICT="$1"; [ -n "${2:-}" ] && _HOOK_REASON="$2"; return 0; }

# One row: epoch ms, kind, name, event, decision, ms, session, subject, reason.
# Tabs and newlines inside a field become spaces; the reason is capped so one
# row stays one write. tools/verdicts.py and hookd write the same columns.
hook_verdict_row() {
  [ "${CHEWBACCA_VERDICTS:-1}" = "0" ] && return 0
  local kind="$1" name="$2" decision="$3" ms="${4:-0}" reason="${5:-}" subject="${6:-}" event="${7:-}"
  local now="${_HOOK_NOW:-}"
  [ -n "$now" ] || now="$(_hook_ms)"
  reason="${reason//$'\t'/ }"; reason="${reason//$'\n'/ }"; reason="${reason//$'\r'/ }"
  subject="${subject//$'\t'/ }"; subject="${subject//$'\n'/ }"; subject="${subject//$'\r'/ }"
  # Created owner-only, once: a subject is a command, and a command can carry
  # a token. The subshell for umask costs a fork only when the file is new.
  [ -f "$CHEWBACCA_VERDICT_LOG" ] || ( umask 077; mkdir -p "$(dirname "$CHEWBACCA_VERDICT_LOG")"; : >> "$CHEWBACCA_VERDICT_LOG" ) 2>/dev/null
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$now" "$kind" "$name" "$event" "$decision" "$ms" \
    "${CLAUDE_CODE_SESSION_ID:-}" "${subject:0:300}" "${reason:0:600}" \
    >> "$CHEWBACCA_VERDICT_LOG" 2>/dev/null || return 0
  # A size check costs a stat; one row in 64 pays it.
  if [ $((RANDOM % 64)) -eq 0 ]; then
    local size
    size=$(stat -f %z "$CHEWBACCA_VERDICT_LOG" 2>/dev/null || stat -c %s "$CHEWBACCA_VERDICT_LOG" 2>/dev/null || echo 0)
    if [ "${size:-0}" -gt "$CHEWBACCA_VERDICT_MAX_BYTES" ] 2>/dev/null; then
      # A timestamped name, so two hooks rotating at once can't clobber a file.
      mv "$CHEWBACCA_VERDICT_LOG" "${CHEWBACCA_VERDICT_LOG%.tsv}-$now.tsv" 2>/dev/null
      # Eight days: the weekly refusal replay reads the last seven.
      find "$(dirname "$CHEWBACCA_VERDICT_LOG")" -maxdepth 1 -name 'verdicts-*.tsv' -mtime +8 -delete 2>/dev/null
    fi
  fi
  return 0
}

# Annotate this run's single log line. Calling _hook_log directly logs a second
# row for one run, which made every cache hit look like two hook invocations.
hook_note() { _HOOK_DETAIL="$1"; }

# Ask Jev one yes/no question about text on stdin. Prints a probability, or
# nothing when there's no judgment (no key, down, slow), and the guard treats
# nothing as no refusal. A judgment can add a refusal, never grant anything
# (agent-neutral.md). For the agent's own replies and briefs only: his typed
# prompts stay on this Mac, a security review pulled them off Jev (822ed4c).
#   p=$(printf '%s' "$MSG" | hook_judge scope-guard "Does this reply ...?")
# HOOK_JUDGE_STUB is the test seam: a probability instead of a network call.
hook_judge() {
  if [ -n "${HOOK_JUDGE_STUB+set}" ]; then printf '%s' "$HOOK_JUDGE_STUB"; return 0; fi
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
  python3 -I -c '
import os, sys
name, question = sys.argv[1], sys.argv[2]
# Both ends: a closing recap and a BLOCKED: line sit at the end of a long reply.
raw = sys.stdin.buffer.read()
if len(raw) > 4000:
    raw = raw[:1500] + b"\n...\n" + raw[-2500:]
text = raw.decode("utf-8", "replace")
for d in sys.argv[3:]:
    if os.path.isfile(os.path.join(d, "jev.py")):
        sys.path.insert(0, d)
        break
else:
    raise SystemExit(0)
import jev
a = jev.ask({"text": text}, {"q": {"type": "noul", "instructions": question}},
            timeout=3.0, decision="hook:" + name)
if a and isinstance(a.get("q"), dict) and jev.probability(a["q"].get("noul")) is not None:
    print(a["q"]["noul"])
' "$1" "$2" "$here/../../bin/lib" "${CHEWBACCA_ROOT:-/nonexistent}/bin/lib" "$HOME/.chewbacca/kit/current/bin/lib" 2>/dev/null
}

# True when a hook_judge probability clears the line. Empty is false.
hook_judge_yes() { [ -n "$1" ] && python3 -I -c 'import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)' "$1" "${2:-0.85}" 2>/dev/null; }

# Print, but never more than the cap. Context the user did not ask for is
# still context the user pays for.
hook_emit() {
  local text; text="$(cat)"
  local n=${#text}
  if [ "$n" -gt "$CHEWBACCA_HOOK_MAX_BYTES" ]; then
    printf '%s' "${text:0:$CHEWBACCA_HOOK_MAX_BYTES}"
    printf '\n\n[%s truncated %s of %s characters to stay inside its context budget]\n' \
      "${_HOOK_NAME:-hook}" "$((n - CHEWBACCA_HOOK_MAX_BYTES))" "$n"
    _hook_log truncated "$n chars"
  else
    printf '%s' "$text"
  fi
}

# A cache with exactly one writer.
#
# On 2026-09-15 at 19:20 five tabs opened in the same second, and eight
# SessionStart hooks were killed by their own watchdogs. Nothing was slow: both
# hooks run in about 0.13s alone. They all missed a cold cache at once and all
# did the identical computation, and the contention is what blew the 5s and 8s
# budgets. Those five tabs started with none of the user's context, which is the
# failure this exists to prevent.
#
#   hook_cache_ready <cache> <ttl_seconds> [source_dir ...]
#     0  serve the file: it is fresh, or it is stale and somebody else is
#        already refreshing it
#     1  this process holds the lock and must recompute
#     2  nothing to serve and somebody else is refreshing; exit quietly
#
# The lock is a directory because mkdir is the only atomic create-or-fail
# primitive portable shell has. It carries its holder's pid, so a lock orphaned
# by the watchdog's kill -9 is reclaimed by the next session instead of wedging
# every session after it.
_hook_cache_fresh() {
  local cache="$1" ttl="$2"; shift 2
  [ "${CHEWBACCA_NO_CACHE:-0}" = "1" ] && return 1
  [ -f "$cache" ] || return 1
  local mt age d
  mt=$(stat -f %m "$cache" 2>/dev/null || stat -c %Y "$cache" 2>/dev/null || echo 0)
  age=$(( $(date +%s) - mt ))
  [ "$age" -lt "$ttl" ] || return 1
  # A context file edited since the cache was written takes effect in the next
  # session rather than whenever the TTL happens to run out.
  for d in "$@"; do
    [ -d "$d" ] || continue
    [ -n "$(find "$d" -newer "$cache" -type f -print -quit 2>/dev/null)" ] && return 1
  done
  return 0
}

hook_cache_ready() {
  local cache="$1" ttl="${2:-900}"; shift 2
  _HOOK_CACHE_LOCK="$cache.lock"
  mkdir -p "$(dirname "$cache")" 2>/dev/null || true

  if _hook_cache_fresh "$cache" "$ttl" "$@"; then
    hook_note "cache hit"
    return 0
  fi

  if [ -d "$_HOOK_CACHE_LOCK" ]; then
    local holder; holder="$(cat "$_HOOK_CACHE_LOCK/pid" 2>/dev/null)"
    if [ -z "$holder" ] || ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$_HOOK_CACHE_LOCK" 2>/dev/null || true
    fi
  fi

  if mkdir "$_HOOK_CACHE_LOCK" 2>/dev/null; then
    echo $$ > "$_HOOK_CACHE_LOCK/pid" 2>/dev/null || true
    _HOOK_CACHE_HELD=1
    return 1
  fi

  # Another session is computing the identical answer.
  #
  # A stale copy is served at once: it is close enough, and waiting on somebody
  # else to finish is exactly the contention this is here to remove.
  if [ -f "$cache" ]; then
    hook_note "stale, another session is refreshing"
    return 0
  fi

  # No copy at all, which is the genuinely cold start: the first tab of the day,
  # or five opened at once after the cache expired. Exiting here would hand the
  # winner its context and leave every other tab blind, so wait the winner out.
  # The winner takes about a second; this caps at a third of the tightest hook
  # watchdog (5s), so the wait can never be what kills the hook.
  local waited=0 cap="${CHEWBACCA_CACHE_WAIT_MS:-3000}"
  while [ "$waited" -lt "$cap" ]; do
    sleep 0.1
    waited=$((waited + 100))
    if [ -s "$cache" ]; then
      hook_note "waited ${waited}ms for another session to build it"
      return 0
    fi
    # The winner died without writing. Its lock is gone, so take the work over
    # rather than waiting out the full cap for a file nobody is writing.
    if [ ! -d "$_HOOK_CACHE_LOCK" ] && mkdir "$_HOOK_CACHE_LOCK" 2>/dev/null; then
      echo $$ > "$_HOOK_CACHE_LOCK/pid" 2>/dev/null || true
      _HOOK_CACHE_HELD=1
      hook_note "took over after ${waited}ms"
      return 1
    fi
  done
  hook_note "gave up after ${cap}ms"
  return 2
}

hook_cache_release() {
  [ "${_HOOK_CACHE_HELD:-0}" = "1" ] && rm -rf "${_HOOK_CACHE_LOCK:-/nonexistent}" 2>/dev/null
  _HOOK_CACHE_HELD=0
}
