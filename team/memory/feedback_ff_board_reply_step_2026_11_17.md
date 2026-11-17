---
name: feedback_ff_board_reply_step_2026_11_17
description: "Anything that reads Dough's book must take step \"reply\" and a sent draft; on 11/16 the FF board sync crashed on step \"reply\" for 17 hours and then offered an already-sent email as the next reply"
metadata:
  node_type: memory
  type: feedback
---

Dough logs our answer to a church's reply in `sent.jsonl` with `"step": "reply"`, not a number, and it keeps the last reply draft on the church's book after that draft goes out (`reply.state` becomes `sent`, `reply.draft` stays).

On 2026-11-16 at about 9:40pm CST three replies went out (Lighthouse, AEBC, Lavon). The FF board packer in firm-foundation (`ops/board/build.py`) ran `int(step)` and crashed on every sync until 3:05pm the next day. The GitHub Action showed red the whole time and nobody looked, so the board showed last night's state all morning. After that fix, Catie's thank-you at Lighthouse came back as "reply owed" with the already-sent fix list as the draft to send.

Fixed in firm-foundation 01734af (a reply counts as step 0, the church page says "We replied") and d8391da (a sent draft is never offered again), both with tests in `ops/board/test_build.py`.

**Why:** the board is how Gavin and Caleb decide what to send, so a frozen board or a stale draft points a founder at a wrong or duplicate email.

**How to apply:** treat `step` as a string anywhere outside Dough's own book.py, and check `reply.state` before using `reply.draft`. When the board looks stale, run `gh run list -R Firm-Foundation-Tech/firm-foundation --workflow board.yml` before trusting it.
