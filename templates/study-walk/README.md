# study-walk

The engine behind the thing that actually taught Caleb biology: a one-screen
animated walkthrough per topic, then a picture test, then practice that repeats
what he missed until a finish line.

Built and proven on `bio-midterm2.up.railway.app` the night before BISC 101's
Midterm 2, 2026-11-04. He went from no biology at 5am to 79% on the mock by
7:49. The rules that make it work, and the exact corrections that produced
them, are in `~/second-brain/memory/feedback_study_sites_how_caleb_learns.md`.

## Use it

Drop `walk.js` and `walk.css` next to a page and give the page its beats.
Nothing is built or bundled, so a topic page is one HTML file you can open with
no server.

```html
<link rel="stylesheet" href="walk.css" />
<script>
  // Where "next" goes when a section's practice finishes. Site data, not
  // engine behaviour, so it lives here rather than inside walk.js.
  window.WALK_NEXT = {
    mitosis2: ["cellcycle.html", "What tells a cell to divide"],
    cellcycle1: ["./", "Home"],
  };
</script>
<script src="walk.js"></script>
```

## What makes one of these good

Four rules, every one of them a correction he made out loud:

- **Show, don't tell.** A topic opens on a drawing that moves, not a paragraph
  and not a stack of cards. "make it an interactive animation ... rather than a
  bunch of cards idk any of the terms bruh"
- **One screen, one idea.** If it does not fit without scrolling, it is two
  topics. "it doesnt even fit in 1 page and its too much to comprehend at once,
  rlly walk me through it plz! This goes for every time u ever teach me smth"
- **Test by clicking the picture**, not by reading an answer. "I like mcq +
  clicking on the right thing ... brute force visually into my mind and connect
  dots"
- **Repeat the misses until they stop being misses.** The practice queue
  re-adds every beat he got wrong. "had me do the matching in my head over and
  over until I got it"

Every new term gets defined where it first appears. On 2026-11-06, teaching him
CRISPR an hour before he presented it, the chain lost him the moment it started
naming things as if he already knew them: "u were j word bombing a bunch of
things I didnt know like bro what is a PAM, NGG, HNDH RUvC what the heck bro".
Most of those are names rather than concepts, and saying so is most of the fix.

## Its sibling

`chewbacca present` builds the other half: a talk, a presenter window, a
trainer and a morning sheet from one script file. Same shape, same rules, aimed
at a room instead of a desk. See `skills/presenting/SKILL.md`.
