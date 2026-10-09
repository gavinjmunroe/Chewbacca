---
name: feedback-the-instrument-needs-a-test
description: "A measuring script with no test of its own is an opinion with digits in it; when a number moves while the thing measured did not, suspect the instrument and write the assertion before the next fix."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbc6e4f2-bde8-442d-97fe-35337209f230
  modified: 2026-09-28T21:43:28.791Z
---

Six measurement bugs in one day on the site-clone build, all in the same
`measure2.py` that was producing the parity score the whole project steered by.
Each was found only because a number moved while the page had not, and each one
would have sent me editing code that was already correct.

    1  sampled 26 of 9,133 elements and reported "no parallax on this page"
    2  read each element's own transform, missing container-driven motion
    3  the lead finder climbed out of the heading's container and reported three
       correct blocks as 715px wide with a 14px gap where the DOM said 384 and 8
    4  the delta pairing was hardcoded index pairs and went stale the moment the
       section set changed, comparing our Subscribe against their "Fits into
       your existing stack"
    5  the page walk unmounted their pinned hero before it could be measured, so
       nine hero axes counted as differing against a page that had not changed
    6  innerText, then textContent, and both corrupted the heading label

**Two of the six were introduced by fixing the previous one.** That is the part
that should have stopped me sooner.

Bug 6 is the instructive one, because neither obvious reading of an element's
text works. `innerText` is layout-aware and returns an empty string for an
element the browser considers not rendered, and their hero is a pinned scene
mid-entrance when the probe reads it. `textContent` is not layout-aware but
swallows inline `<script>` text and drops the space a `<br>` renders as:

    "Surface failures you didn't know to look for.self.__"
    "Stop guessingwhy your agents fail"

Both corrupt a pairing key, so a run came back with 14 sections unpaired and 80
comparable rows against an expected 205, and the score read 39% against a page
that had improved. Clone the element, strip script and style, replace `<br>`
with a space, collapse whitespace.

**Why:** the scores that file produced across one afternoon went 51, 56, 53, 39,
and almost none of that movement was the page. A number with no assertion behind
it feels like evidence while being a guess, and it is worse than no number
because it gets acted on.

**How to apply:** when a script's job is to produce numbers that decide work,
write its test before the second fix to it. Assert what a sound reading looks
like, not what the answer should be: nothing came back empty or partial, every
key parsed cleanly, both sides paired, the row count is in range. Run it against
a known-broken output first and check it fails, per
[[feedback_a_silent_guard_proves_nothing]].

And when a number moves while the thing being measured did not, that is the
instrument, every time so far.

Related: a private note, [[feedback_seal_the_test_set]],
[[feedback_measure_exit_codes_directly]], [[feedback_fitting_output_is_not_recovering]],
[[feedback_a_silent_guard_proves_nothing]]
