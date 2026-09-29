---
name: manim
description: Make an animated math or explainer video with Manim Community (ManimCE), the 3Blue1Brown-style engine. Use when the user asks for a manim video, a 3b1b-style animation, an animated proof, an explainer with graphs and equations, a funny math video about a friend, or links github.com/ManimCommunity/manim or github.com/3b1b/manim. Also use when a manim render fails, looks wrong, or text overlaps.
---

# Manim videos

Default to **Manim Community** (`pip install manim`), even when the user links
`3b1b/manim`. On 2026-09-29 a video was started on 3b1b's `manimgl`, and the
user switched it to ManimCE mid-render. ManimCE is the maintained, documented
one, and its API is what every example online uses.

## Setup that works on this Mac

Python 3.14 is the system default and manim's wheels lag behind it. Use a
project venv on 3.13:

```bash
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python manim
.venv/bin/manim -ql --disable_caching scene.py SceneName   # draft, 480p15
.venv/bin/manim -qh --disable_caching scene.py SceneName   # final, 1080p60
```

Output lands at `media/videos/<file>/<quality>/<Scene>.mp4`. Gitignore
`media/` and `.venv/`, then copy the final mp4 to the repo root.

**There is no LaTeX on this machine.** Anything built on `Tex`/`MathTex`
crashes: `MathTex`, `Tex`, `DecimalNumber`, `Integer`, `Variable`, and axis
`add_coordinates()` / `include_numbers`. Use `Text` for every label. For a
counting number, redraw text:

```python
score = ValueTracker(0)
number = always_redraw(lambda: Text(f"{int(score.get_value()):,}", font_size=96))
```

Put tick labels on by hand with `Text(...).next_to(axes.c2p(x, 0), DOWN)`. Unicode
symbols like ∎, →, ≥ render fine through `Text`. Color emoji don't.

If `manimgl` is ever required, it needs `setuptools<81` (it imports
`pkg_resources`) and `audioop-lts` on 3.13. Its Axes pin the y-axis at x=0, so
an `x_range` starting at 12 pushed the plot off the right edge. Shift the
range to start at 0 and relabel.

## The craft

3Blue1Brown videos work because every scene carries one idea and the picture
is the argument. The rules that came out of that:

- **One claim per scene.** Structure it like a proof: Definition, Lemma 1..n,
  Theorem, ∎. The structure itself is the joke in a comedy video, and the
  spine in a serious one.
- **The picture has to argue.** A graph where the subject's curve leaves the
  frame and the camera follows it (`MovingCameraScene`,
  `self.camera.frame.animate`, `save_state()` then `Restore`) lands harder than
  a caption saying "off the charts".
- **Real material beats invented.** For a video about a person, quote their own
  texts and show them as message bubbles with the date. Pull them with the
  `people` and `texts` skills first. Never invent a score, a date or a quote.
- **Pace it for reading.** Wait about 1 second for every 10 words on screen.
  A punchline gets its own beat with nothing else moving.
- **End on a payoff you can see.** A drawn object, a transformed symbol
  (∎ into "Q.E.G."), and only then the credits.

## Verify it by looking

A clean render proves nothing about layout. Pull frames and look at every scene:

```bash
for t in 5 20 35 50 65 80; do
  nice -n 19 ffmpeg -v error -y -ss $t -i out.mp4 -frames:v 1 -vf scale=640:-1 f$t.png
done
```

Run it serially and with `nice`: `load-guard` blocks the tiled one-shot version
when the load is high. The Colin video had three defects that the render log
never showed: the plot sat off screen, a caption overlapped the y-axis label,
and a curve cut through a line of text. Fix a curve crossing text with
`text.add_background_rectangle(color=BLACK, opacity=1, buff=0.08)`.

## Sending it

iMessage attachments go through AppleScript, because `mac messages send` only
sends text. Copy the file into `~/Pictures` first, then send it to
`participant "<handle>"` of the iMessage account. Read `chat.db` back until
`is_delivered = 1` before you say it went.
