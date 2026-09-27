#!/bin/bash
# Stop hook: refuse a reply that calls a command silent or empty while a
# background job of this session has not reported back yet.
#
# WHY THIS EXISTS. 2026-09-26. `bin/closeout` was run in the background. Its
# output file was read at roughly one minute, then again, then again, then a
# fourth time, and every read showed zero bytes with no process alive. The
# conclusion drawn was that closeout was dying silently and producing nothing,
# and a handoff prompt was written for another tab telling it to fix a silent
# death that was never happening.
#
# closeout was fine. Every print in it lands at the END of the run, after all
# checks finish, and the run took about twenty minutes. The empty file was an
# unfinished job, not a broken tool. The notification arrived later and carried
# a complete verdict: three named failures, one of them a real regression.
#
# The cost was not the wasted reads. It was that a wrong diagnosis reached the
# user as a confident instruction to go change working code.
#
# WHAT IT ENFORCES, narrowly:
#
#   A reply may not say a command produced nothing, exited silently, printed
#   zero bytes, or hung, while this session has launched more background jobs
#   than have reported completion. Either wait for the notification, or say
#   plainly that the job has not finished.
#
# An empty output file is a reading, not a result. The completion notification
# is what turns one into the other.
#
# Exit 2 blocks the turn. Exit 0 says nothing. An advisory version of this
# would be worthless: slop-guard once exited 0 on an unrecognised JSON field
# and twelve bad replies shipped before anyone noticed.

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
[ -n "$MSG" ] || exit 0

# The claim this guards against. Deliberately about a command being EMPTY or
# SILENT, not about ordinary failure: "the tests failed" is honest bad news and
# must never be blocked.
printf '%s' "$MSG" | grep -qiE \
  'produced (no|zero) (output|bytes)|no output at all|zero bytes|(dying|died|dies|failing|fails|failed) silently|silent (death|failure)|exited silently|printed nothing|output was empty|empty output file' \
  || exit 0

# An explicit acknowledgement that the job is unfinished is the correct reply,
# so let it through.
printf '%s' "$MSG" | grep -qiE \
  'not (yet )?finished|still running|has not (finished|completed|reported)|unfinished|awaiting (the )?(notification|completion)|too early' \
  && exit 0

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -f "$TRANSCRIPT" ] || exit 0

# Launches vs completions, counted off the transcript. Every backgrounded Bash
# call records run_in_background; every finished one produces a task
# notification carrying its task id.
LAUNCHED=$(grep -o '"run_in_background":[[:space:]]*true' "$TRANSCRIPT" 2>/dev/null | wc -l | tr -d ' ')
REPORTED=$(grep -o '<task-notification>' "$TRANSCRIPT" 2>/dev/null | wc -l | tr -d ' ')
[ -n "$LAUNCHED" ] || exit 0
[ "$LAUNCHED" -gt "$REPORTED" ] 2>/dev/null || exit 0

cat >&2 <<MSGEOF
stale-read-guard: this reply calls a command silent or empty, and $(( LAUNCHED - REPORTED )) background
job(s) launched in this session have not reported completion yet.

An empty output file is a reading, not a result. On 2026-09-26 closeout was
called "dying silently" after four reads of a zero-byte file; it was buffering
every print until the end of a twenty minute run, and its real verdict named
three failures including a live regression. A wrong diagnosis then reached the
user as an instruction to change working code.

Do one of these:
  - wait for the task notification and answer from what it carried
  - say plainly that the job has not finished, rather than that it printed
    nothing
  - if the process is genuinely gone, say so with the evidence: the exit code,
    or that no matching process is alive
MSGEOF
exit 2
