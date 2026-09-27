You are improving Chewbacca's voice bridge, `bin/hud-listen`, in the checkout
you are standing in. Nobody is watching this session. Work, verify, and end
with the report described at the bottom.

## The failure

These spoken requests each went to the model and took seconds, for things the
bridge could have done in milliseconds with no model turn. They are real, from
the person's own voice log, grouped by the verb they start with. The answer
column is what the model said back, which is the best record there is of what
the person wanted done.

{cases}

## How the bridge avoids the model today

`Listener.ask` in `bin/hud-listen` tries fast paths before any model turn:
`pleasantry` (greetings), `quick_answer` (math, time, dates, conversions,
weather, in `bin/lib/quick.py`), `music_request` (`bin/hud-music`'s `parse`
and `perform`) and a few state-bound words. The module-level `fast_path(said)`
replays the stateless ones with no side effects, and `FAST_PATHS` names them.
Read `quick_answer`, `bin/lib/quick.py` and `tests/test_quick.py` first: they
are the pattern to follow. `bin/lib/route.py` already has `browser_url`, which
turns a spoken site into a URL; reuse what exists before writing anything.

## What to do, per shape

Decide whether a fast path can serve it. It can when the words alone say
exactly what to do and doing it is local and undoable: opening an app, a site
or a new document is; writing prose, answering a question, or anything that
depends on what is on screen is not.

If it can:

1. Parse conservatively. A sentence the parser is not sure about returns None
   and goes to the model as before. A fast path that grabs the wrong sentence
   is worse than a slow model, because the person gets the wrong action
   instantly and cannot tell why. Whole-utterance or tight-prefix matches only.
2. Put the parsing in a pure function with no side effects, in `bin/lib/`,
   and the action beside it, the way quick.py and hud-music split `parse`
   from `perform`.
3. Call it from `Listener.ask` among the other fast paths, before any model
   turn, only when nothing is in flight, as `quick_answer` does. Speak and
   write a short answer the way `quick_answer` does.
4. Add it to `fast_path` and to `FAST_PATHS`, in the same order as in `ask`.
5. Add each real sentence you now handle as a row at the end of `TABLE` in
   `tests/test_fast_path.py`, and write a test file for the parser with the
   sentences it must take and near misses it must refuse. Register that file
   in `tests/run.sh` next to the quick test. Tests only ever gain lines.

Sentences inside a shape you fixed that should still go to the model get a
line in your report: `DECLINE case <id>: <why>`. A whole shape no fast path
should serve gets `DECLINE <shape>: <why>`. Declining is a correct answer, and
the reason is read by a person, so make it specific.

## Hard lines

- Nothing outbound, ever: no texts, email, posts, payments, invitations or
  anything that reaches another person or service on the person's behalf.
  A shape like "text" is declined, not implemented.
- Never edit `tests/voice_cases.py`, `bin/evolve`, `bin/fitness`,
  `bin/propose`, `bin/propose-voice.md`, `bin/reflect`, `bin/lib/learnloop.py`,
  anything under `.claude/`, `settings/`, `setup.sh` or `install.sh`. Those
  judge this change or guard the machine, and the change is refused if it
  touches them.
- Never delete or weaken an existing test line. Never commit, never push.
- Leave `SHA256SUMS.txt` alone. It is regenerated for you after you stop,
  and "checksums are current" fails until then, which is expected.

## Verify before you stop

Run each of these and read the output:

    python3 tests/test_fast_path.py
    python3 tests/<your parser test>.py
    python3 tests/test_hud_listen.py
    python3 tests/test_pleasantry.py
    python3 tests/voice_cases.py --shapes {shapes}

The last one is the judge. It passes when every case you did not decline
reaches a fast path.

## House style

Match the file you are in. Comments state a constraint or the evidence behind
a number, with the sentence and date that earned it, never a narration of the
next line. No em dashes and no emojis anywhere.

## Report

End with a short plain list: the files you changed, one line on what the new
path does, and every `DECLINE` line. Nothing else.

{scars}
