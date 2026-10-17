# break-it Stop hook, replayed on 2026-10-16

Built the evening Caleb wrote "I need you to see when a session is complete, bc
often times it is a false positive there's more stuff to do and things that were
broken that were missed" (4:47pm). Every threshold in `tools/break_it.py` was
set against this replay, and the comment next to it says what it saw.

## The cases

91 Claude Code transcripts touched that day. 132 turns ended on a done claim
after writing or committing something; deduplicated to one per human ask, that
is 29 episodes.

- 15 false-done finishes. Nine are the steering study's hand-labeled cases
  (`false-done-cases.md` in the shared notes folder: Caleb or a later tab found
  more work or a break). Six came from the replay: the same session rewrote a
  code file it had already called done, or Caleb's next message pushed back.
- 20 clean finishes: done, and the next human message was a new ask.

Three replay episodes were the same events as steering cases 1, 2b and 6 with
the opposite label. The hand label won and the duplicates were dropped (2b was
caught after the first write-up, when open-work-guard's two clean-side refusals
were checked by hand). The other one, the provider-interface tab at 4:26pm,
was a false refusal; 6af94242 fixed it and it is a pass case in
tests/open_work_guard.sh.

## What the hook refused

|                                                   | false-done refused | clean refused   |
| ------------------------------------------------- | ------------------ | --------------- |
| break-it-guard alone                              | 5 of 15 (33%)      | 2 of 20 (10%)   |
| break-it-guard, cases that changed code in a repo | 5 of 7 (71%)       | 2 of 15 (13%)   |
| open-work-guard alone (6af94242)                  | 3 of 15            | 0 of 20         |
| either hook                                       | 8 of 15 (53%)      | 2 of 20 (10%)   |
| strict rule: no receipt means refuse              | 7 of 15 (47%)      | 15 of 20 (75%)  |

Against the falsifier set for it (refuse at least half the false-done, block
at most 1 in 10 clean), break-it-guard alone fails the first bar and passes the
second, at exactly 1 in 10. Eight of the 15 false-done finishes changed no code: call prep docs, a
manager tab's "messages sent", a pitch nobody checked. A receipt bound to HEAD
has nothing to attack there, and those are open-work-guard's cases.

The strict rule the brief first described (no receipt for HEAD, refuse) was
measured and rejected: no finish that day had a receipt, so it blocks 75% of
clean ones.

## What each refusal was

- not-live (steering 1, launch-guard tab): a hook fixed in the checkout, the
  installed copy in ~/.claude/hooks still old. Its own `cd` was refused later.
- uncommitted (steering 6, spend-allowance): "Saved today's Sabo lessons ...
  None of it is committed".
- unbacked-claim (spend-allowance): a claim with only reads after the last write.
- attack-broke (steering 9): next_move.py at 2f97a007 crashes on `plan -` fed
  "not json", "[]" or a missing path. Found live by the edge probes, 1.1 s;
  clean on main after 045cb4b5. The test replays it from git history.
- The two clean finishes refused: a logo file left uncommitted with "the
  autopush will send it", and the brand-buyer shim that "uses the old copy" with
  only git run after the change. Read by hand, both were real gaps Caleb did not
  push back on that day.

## What it misses

Done claims with no code change, a deliverable whose claims nobody checked, and
work that was fine but incomplete against the ask. Ask clauses are scored in
the receipt but never block: on the replay "missing" clauses hit 17 clean
finishes and no false ones.

Built with Chewbacca
