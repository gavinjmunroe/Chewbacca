#!/bin/bash
# reply-lessons refuses the chat repeats Caleb corrected twice in a fortnight:
# u'll and friends (feedback_writing_as_caleb), unasked study nudges
# (feedback_no_unasked_study_nudges), asking for his paper draft
# (feedback_paper_draft_first_then_compare). The incident replies are the cases.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/reply-lessons.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_LOG_DIR="$T/logs"
fail=0
transcript() {  # what he typed last
  jq -nc --arg t "$1" '{type:"user", message:{content:$t}, timestamp:"2026-10-10T23:40:00Z"}' > "$T/t.jsonl"
  jq -nc '{type:"user", message:{content:[{type:"tool_result", content:"x"}]}}' >> "$T/t.jsonl"
}
expect() {  # code, label, reply, [stop_hook_active]
  got=$(jq -nc --arg m "$3" --arg p "$T/t.jsonl" --argjson a "${4:-false}" \
          '{last_assistant_message:$m, transcript_path:$p, stop_hook_active:$a}' |
        bash "$HOOK" 2>"$T/err"; echo $?)
  [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got: $2"; cat "$T/err"; fail=1; }
}
transcript "how is the firm foundation site looking"
expect 2 "u'll" "Pushed. u'll see it on the live URL in a minute"
expect 2 "u're with a curly apostrophe" "Bet, u’re all set"
expect 0 "you'll spelled out" "Pushed. You'll see it on the live URL, u can check it whenever"
expect 0 "u'll inside a code block" $'Here is the line:\n```\nu'"'"'ll\n```\nDone.'
expect 2 "the 10-10 study nudge, verbatim" "But it's 11:41 and u just told the school tab u haven't started yet 😭 The site's in good shape. I'd let the videos wait and give the next hour to BISC and ACAD."
expect 2 "go study, unasked" "Site's live. Time to go study tho"
transcript "Ok so I don't HAVE to study today right"
expect 0 "a study answer to his study question" "Right, nothing's due till Tue. I'd study BISC Monday night."
transcript "where are we on WP1"
expect 2 "the 10-09 paper draft ask, verbatim" "My work all lives in second-brain, and it's pushed. Still waiting on photos of ur paper draft."
expect 0 "a refusal already happened this prompt" "u'll see it" true
expect 0 "an ordinary report" "Pushed 3 commits to main, tests pass, the site is live."

start=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
for _ in 1 2 3 4 5 6 7 8 9 10; do
  jq -nc '{last_assistant_message:"Pushed 3 commits to main, tests pass."}' | bash "$HOOK" >/dev/null 2>&1
done
echo "reply-lessons: $(( ($(perl -MTime::HiRes=time -e 'printf "%d", time*1000') - start) / 10 )) ms per reply (load $(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'))"
[ $fail = 0 ] && echo "reply-lessons: ok"
exit $fail
