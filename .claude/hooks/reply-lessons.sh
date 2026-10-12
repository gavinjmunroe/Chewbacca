#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init reply-lessons.sh 5
# Stop: refuse a reply that repeats a chat mistake Caleb already corrected.
#
# Each rule is one he had to say twice in the fortnight before 2026-10-11
# (docs/plans/REPEAT-MISTAKES.md), narrow enough to match the reply he
# objected to and not ordinary chat:
#
#   feedback_writing_as_caleb       2026-10-07: "I don't say u'll or u'd or
#                                   u've". u stands alone; contractions stay
#                                   spelled out (core/voice.md).
#   feedback_no_unasked_study_nudges  2026-10-10 23:42: "Bro mind your own
#                                   business that's rude af to assume I wasn't
#                                   doing my work", after "u just told the
#                                   school tab u haven't started yet".
#   feedback_paper_draft_first_then_compare  2026-10-09 15:16: after "Still
#                                   waiting on photos of ur paper draft", he
#                                   said "Bro just do it ... I talked to the
#                                   teacher it is chill".
#
# One perl process, no model. It never refuses. A Stop refusal can't retract
# a reply that's already on his screen, so exit 2 only added a rewritten copy
# under it. 2026-10-11 4:47pm a "u're" got the whole scripture answer sent
# twice, and he sent a screenshot of both: "Why is this still happening? We
# have tried to fix it 10+ time". A hit goes to voice-flags.pending instead,
# the file slop-guard already feeds forward, and voice-remind.sh puts it in
# front of the next reply before it's written.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
[ -n "$MSG" ] || exit 0
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

RL_MSG="$MSG" RL_TRANSCRIPT="$TRANSCRIPT" perl - <<'PL'
use strict; use warnings; use Encode qw(decode_utf8);
my $m = decode_utf8($ENV{RL_MSG} // "");
my $raw = $m;                   # drafts he pastes live in code blocks, so a rule flagged [4] reads them too
$m =~ s/```.*?(?:```|\z)//sg;   # code is data, not his voice
$m =~ s/^\s*>.*$//mg;           # a quoted line is somebody's words, not the reply's
my $q = qr/['\x{2019}]/;
my @rules = (
  [qr/\bu${q}(?:ll|d|ve|re)\b/i,
   "writes u'll, u'd, u've or u're. Caleb, 2026-10-07: \"I don't say u'll or u'd or u've, I say those the normal way you'll you'd you've\" (feedback_writing_as_caleb)."],
  [qr/\b(?:you|u)\s+(?:just\s+)?(?:told|said)\b[^.\n]{0,60}\b(?:haven${q}?t|didn${q}?t|not)\s+start/i,
   "guesses whether he has started studying, from another tab. Caleb, 2026-10-10: \"mind your own business that's rude af to assume I wasn't doing my work\" (feedback_no_unasked_study_nudges). Answer what he asked.", 1],
  [qr/\b(?:go|time to|(?:you|u)\s+should(?:\s+probably)?|i${q}?d)\s+(?:go\s+)?(?:study|start studying|hit the books)\b|\bgive\s+the\s+next\s+(?:hour|few hours|\d+ hours?)\s+to\s+(?:BISC|ACAD|WRIT|MPGU|studying|school|class)/i,
   "tells him to go study, unasked. Caleb, 2026-10-10: \"mind your own business\" (feedback_no_unasked_study_nudges).", 1],
  [qr/\b(?:what(?:${q}s| is)|send me|need)\s+(?:the\s+|his\s+|her\s+|their\s+|ur\s+|your\s+)?(?:city|zip|zip code|full address|street address|phone number|website|domain)\b/i,
   "asks a person for a fact a lookup finds. Caleb, 2026-10-11: \"Never ask humans things that you don't need a human for\" after a zip code request for 2849 Summerdale Dr, \"1 search online away\". Look it up first: `chewbacca resolve \"<question>\" --about <who>`. Only ask what no source has.", 0, 1],
  [qr/\b(?:photos?|pics?|pictures?|a scan|scans)\s+of\s+(?:ur|your)\s+(?:paper\s+|handwritten\s+)?draft|\bsend\s+(?:me\s+)?(?:ur|your)\s+(?:paper|handwritten)\s+draft/i,
   "asks for his paper draft. He hand-writes first and has Claude draft from his picks to compare; never ask for the paper draft (feedback_paper_draft_first_then_compare, 2026-10-09: \"Bro just do it\")."],
  [qr/\by${q}?all\b/i,
   "writes yall or y'all. Caleb says ygs for a group: \"ygs, not yall. I thought I told you this\" (2026-10-12, a gc draft in a code block; first set 2026-10-06 in core/voice.md).", 0, 0, 1],
);
# The last thing he typed, read only when a study rule matched: a study answer
# to a study question is the job, not a nudge.
sub asked_about_school {
  my $path = $ENV{RL_TRANSCRIPT} // "";
  open(my $fh, "<:raw", $path) or return 0;
  my $size = -s $fh; seek($fh, $size > 524288 ? $size - 524288 : 0, 0);
  local $/; my $data = <$fh>; close $fh;
  for my $line (reverse split /\n/, $data) {
    next unless index($line, '"user"') >= 0;
    require JSON::PP;
    my $row = eval { JSON::PP->new->utf8->decode($line) } or next;
    next if ($row->{type} // "") ne "user" or $row->{isMeta} or $row->{isSidechain};
    my $c = ($row->{message} // {})->{content};
    my $t = ref $c eq "ARRAY" ? join(" ", map { ref $_ eq "HASH" && ($_->{type} // "") eq "text" ? $_->{text} : "" } @$c)
          : (defined $c && !ref $c ? $c : "");
    next if ref $c eq "ARRAY" && grep { ref $_ eq "HASH" && ($_->{type} // "") eq "tool_result" } @$c;
    $t =~ s/^\s+//;
    next if $t eq "" || $t =~ /^</;
    return $t =~ /stud|exam|midterm|quiz|homework|due|class|lecture|bisc|acad|writ|mpgu|school/i ? 1 : 0;
  }
  return 0;
}
for my $r (@rules) {
  my $s = $r->[4] ? $raw : $m;
  next if $r->[2] && $s =~ $r->[0] && asked_about_school();
  if ($s =~ $r->[0]) {
    my $dir = $ENV{CHEWBACCA_HOME} || "$ENV{HOME}/.chewbacca";
    mkdir $dir unless -d $dir;
    my $found = "";
    # The rule that catches an ask also answers it: the sentence that asked
    # goes through resolve, so the next reply starts with the fact instead of
    # waiting on a person. Caleb, 2026-10-11: reengineer the way it tries to
    # be good, not only avoid the bad.
    if ($r->[3] && !$ENV{REPLY_LESSONS_NO_RESOLVE}) {
      my $re = $r->[0];
      my ($asked) = $m =~ /([^.?!\n]*(?:$re)[^.?!\n]*[.?!]?)/;
      my $bin = $ENV{CHEWBACCA_RESOLVE_BIN} || "$ENV{HOME}/.local/bin/chewbacca";
      if ($asked && -x $bin) {
        $asked =~ s/[`"\\\$]//g;
        my $ctx = substr($m, 0, 2000); $ctx =~ s/[`"\\\$]//g;
        my $out = `perl -e 'alarm 15; exec \@ARGV' "$bin" resolve "$asked" --context "$ctx" 2>/dev/null`;
        $found = "\nresolve already found:\n$out" if $out =~ /\S/;
      }
    }
    if (open(my $fh, ">>:encoding(UTF-8)", "$dir/voice-flags.pending")) {
      print $fh "reply-lessons: your last reply $r->[1]$found\n"; close $fh;
    }
    exit 0;
  }
}
exit 0;
PL
exit $?
