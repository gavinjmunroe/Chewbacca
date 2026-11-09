# Motion craft, from an editor's timeline to a scroll page

What a practitioner editor decides, written as rules a web page can be checked
against. Every rule names where it came from. The code for each numbered
technique is in
[apps/ux-engine/motion/primitives/motion.ts](../../apps/ux-engine/motion/primitives/motion.ts),
tested by `node apps/ux-engine/motion/primitives/motion.test.ts`.

Read with: [web-ux.md](web-ux.md) (motion frequency, transform and opacity
only, reduced motion), [apps/ux-engine/motion/](../../apps/ux-engine/motion/README.md)
(UI timing ceilings), and the `cinematic-scroll` skill (same-object hand-offs
across a whole take).

## Sources

- **[jayd3n]** jayd3nfx, "Why Simple Edits LOOK So Much BETTER",
  youtube.com/watch?v=yUFLi6hSaPE, 9:36. Watched in full: transcript plus
  frames at 0:00 to 0:11 and 2:14 to 3:20. Three principles: focus, flow, motion.
- **[KVN]** "That's the end of our presentation", youtube.com/watch?v=GI85h-b8QOw,
  14 s, sent by Colin. One character on white, two lines of type, a hard cut to
  a black end card.
- **[FilmCraft]** open-source Rust NLE. Keyframes in
  `crates/project/src/keyframe.rs`, transitions in
  `crates/render/src/transitions/` (`motion.rs`, `dissolve.rs`, `wipe.rs`,
  `legacy.rs`), parameter defaults in `crates/project/src/vtransition.rs`,
  Echo and Posterize Time in `crates/render/src/vfx/temporal.rs`.
- **[Caleb]** his corrections on the Parker site and the FF hero, kept in
  `feedback_cinematic_site_craft` and team memory `feedback_ff_hero_not_lemma`.

## 1. Restraint is the default

- **One focal point per moment.** If everything moves, everything competes and
  nothing wins. He limits each moment to one text animation and one focal point [jayd3n 0:55
  to 1:14]. Test: pause any frame; exactly one element is mid-motion, or the
  others are moving as one group.
- **Fewer effects, not more.** His simpler, Apple-style edit was easier to make
  and people liked it more [jayd3n 0:00]. A new effect has to replace one.
- **The subject motivates the type.** In [KVN] the character points, and the
  line lands where it points. Type never arrives on its own schedule while the
  subject does something unrelated.
- **Hierarchy inside one line by weight, not by animation.** [KVN] sets
  "That's" light and "the end" bold in the same size, then a smaller second
  line under "Thank You". Two weights, two sizes, one ground colour.
- **End on a cut, not a fade.** [KVN] hard cuts from white to a black card.

## 2. Per-character text animator (the [jayd3n] reveal)

The After Effects setup at [jayd3n 2:14 to 3:23], read off the frames:

| Property                            | Value                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Comp                                | 1080x1080, 60 fps ("a bit smoother"), white solid                                          |
| Animator 1: Position                | 0, 100 (characters start 100 px low)                                                       |
| Animator 1: Blur                    | 45                                                                                         |
| Animator 1: Opacity                 | 0                                                                                          |
| Range Selector 1 > Advanced > Shape | Ramp Up (he corrects himself to Ramp Up at 3:02)                                           |
| Advanced: the two values he sets    | 50 and 100 (read here as Ease High 50, Ease Low 100; the frame is not legible)             |
| Offset                              | keyframed from a negative value where the word is fully gone, to 100, "a few frames" later |
| Keyframes                           | Easy Ease, then shaped in the graph editor, "doesn't need to be too tight"                 |

How it works: animator values apply at full strength where the selector is 1.
Ramp Up selects everything to the right of the range at 1, so offset -100 hides
the whole word and offset 100 leaves it at rest. Sweeping the offset rolls a
ramp left to right, so each character rises 100 px, unblurs from 45 and fades
in, overlapping its neighbours. A brief once quoted "Square, smoothness 100":
a Square window does not reveal on this sweep, use Ramp Up.

On the web: `revealText(n, p)` returns per-character `{x, y, blur, opacity}`;
`unitCss()` turns each into `transform`, `filter` and `opacity` for an
inline-block span. Drive `p` from time (about 300 to 500 ms) or from scroll.

Rules:

- **The stagger comes from the ramp, not from per-word delays.** A ramp width
  equal to the word gives about 50% overlap between neighbours.
- **Blur and offset travel together.** A character never fades in sharp from
  nowhere; the blur says where it came from.
- **One word or one short line.** The reveal is the focal point of rule 1.

## 3. Shape morphing instead of new objects

Apple transforms what is already on screen (a shape into a button, a button into a card) instead of introducing something new; he calls it shape morphing [jayd3n 3:39 to 4:15]. His build: keyframe Size, Position and Roundness
on one shape, paste the second shape's values a few frames later, delete the
second layer, Easy Ease, then in the **speed graph** drag both handles in
[jayd3n 4:27 to 5:51].

- **Morph the properties, keep the layer.** On the web that is one element
  whose width, height, border-radius and position interpolate (FLIP with
  transform and a clip-path or radius), never a fade between two elements.
- **Pushing the speed-graph handles in raises influence.** Easy Ease is 33%
  influence. 70 to 90% gives a fast middle and a long, soft landing.
  `influenceToCss(0.8, 0.8)` is `cubic-bezier(0.8, 0, 0.2, 1)`.
- **Same object across a section seam** [Caleb]: "it should be the same object,
  not the same image showing up out of nowhere with a diff size and position."

## 4. Motion that feels alive: anticipation, overshoot, settle

Real objects accelerate, slow down, overshoot and settle; they never start or stop instantly [jayd3n 5:51 to 6:30]. His bounce, on a null
parenting the shape, at 60 fps [jayd3n 6:34 to 7:38]:

| Frame        | Rotation | Scale    |
| ------------ | -------- | -------- |
| 0            | 0        | 100      |
| +2           | 11       | 113      |
| +5 to 6 more | -6       | about 90 |
| +a few more  | 7        | 104      |
| +a few more  | 0        | 100      |

Every key gets Easy Ease and the layer has motion blur on. Each swing is smaller than the last and
alternates sign. Unlinking scale and stretching X against Y gives squash
("jiggle physics", 8:10). Smaller numbers make it subtler.

On the web, either keyframe it with `valueAt()` and Easy Ease, or use
`spring(x, bounce)` or `backOut(x, s)`, both ported from FilmCraft `motion.rs`.

## 5. Whip and motion-blur transitions

- **A whip is a push with a sigmoid and a streak.** FilmCraft `whip`: both
  frames ride one strip, progress is a k = 14 sigmoid normalised to 0..1, and
  the blur length is `blur * bell(p) * 0.18 * travel` along the travel axis,
  default blur 80%. So at the midpoint of a 1440 px whip the streak is about
  207 px, and at both ends it is 0. `whip(p, travel)`.
- **Blur length is speed times shutter.** A 180 degree shutter streaks half
  a frame of travel: `motionBlurPx(pxPerFrame, 180)`. Blur that does not track
  speed reads as a filter, not as motion.
- **Motion blur on every fast move** [jayd3n 7:53]. FilmCraft's slide family
  defaults Motion Blur to 50% (shutter 0.12 of the transition for push and
  slide).
- On the web: CSS `blur()` is round, so streaks use an SVG `feGaussianBlur`
  with `stdDeviation` from `directionalBlurStdDev(len, dx, dy)` applied to the
  moving layer only.

## 6. The triple wheel

The open of [jayd3n 0:06 to 0:11]: three phrases ("less effects", "less visual
clutter", "less stuff") sit on spokes 120 degrees apart around one hub, each
reading outward along its spoke. The active phrase is black; the other two are
mid grey. The whole group rotates to bring the next phrase into the reading
slot, with a rotational smear during the turn, then the wheel exits on a whip
into a dark, glitched frame.

Measured from the frames: the reading slot is not level. The active phrase sits
at roughly 35 to 50 degrees off horizontal. The tilt adds energy; level reads
calmer.

- `tripleWheel(active, {radius, readingAngle})` lays it out and handles
  fractional `active` mid-turn (ink crossfades by distance, wrapping).
- `wheelTurn(p, from, to)` gives whip timing and the arc blur that peaks
  mid-turn.
- Rules: three items, never more. One active at a time. The turn is fast
  (8 to 12 frames at 60 fps); the hold is long enough to read the phrase.

## 7. Camera moves inside a scene

- **Move the camera, not the picture** [cinematic-scroll]. Scale the whole rig
  about the target in log space so it reads as a dolly: `logLerp(1, 4, p)`.
- **A hand-off is a push that continues.** FilmCraft `motion_camera`: A pushes
  in 40% on ease-in over the first 70% while turning up to 8 degrees, B arrives
  from the same push and settles on ease-out from 30%, and the crossfade is
  `smoothstep(0.3, 0.7, p)`. `cameraHandoff(p)`.
- **A cube turn pulls back to make room.** FilmCraft `roll_3d`: 90 degrees on
  ease-in-out cubic, pushed back 0.45 of the side at the midpoint. `cubeTurn`.

## 8. Parallax depth with lag

- **Speed is 1/(1 + depth).** Depth 0 moves with the page, depth 1 at half
  speed, depth 3 at a quarter. `parallax(scroll, depth)`.
- **Farther layers lag more.** Smooth each layer toward its target with a
  frame-rate independent half-life that grows with depth:
  `follow(current, target, dt, depthHalfLife(depth))`. A per-frame lerp of 0.1
  at 60 fps is a 110 ms half-life (`lerpToHalfLife`); per-frame lerps change
  feel at 120 Hz, half-lives do not.
- **Three planes at most**: foreground, subject, ground. More planes read as a
  gimmick and fight rule 1.
- Never hijack the scroll itself; lag the layers, not the page [web-ux.md].

## 9. Easing, with numbers

| Need               | Curve                                                        | Source                                                                                     |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Default keyframe   | Easy Ease, influence 33%, `cubic-bezier(0.333, 0, 0.667, 1)` | FilmCraft default influence 1/3                                                            |
| Morph, long settle | influence 80%, `cubic-bezier(0.8, 0, 0.2, 1)`                | [jayd3n] speed-graph handles pushed in                                                     |
| Push, slide, cube  | ease-in-out cubic                                            | FilmCraft `ease_in_out`                                                                    |
| Whip               | sigmoid k = 14                                               | FilmCraft `whip`                                                                           |
| Pop in             | back-out, s = 1.70158                                        | FilmCraft `back_out`                                                                       |
| Settle with bounce | damped spring, bounce 0..1                                   | FilmCraft `spring`                                                                         |
| Constant loops     | linear                                                       | [apps/ux-engine/motion/measured-motion.md](../../apps/ux-engine/motion/measured-motion.md) |

FilmCraft's keyframe model: a Bezier keyframe has flat handles (velocity 0)
whose length in time is its influence; the curve between two keys is
`cubic-bezier(outInfluence_A, 0, 1 - inInfluence_B, 1)`. `valueAt(keys, t)`
reproduces it, including Hold, Ease In, Ease Out and linear.

## 10. Timing

- 60 fps for text and shape work [jayd3n 1:31].
- Overshoot peaks 2 frames after the start, the counter-swing lands 5 to 6
  frames later [jayd3n bounce].
- Text reveal: "a few frames" of offset sweep, roughly 300 to 500 ms on a page.
- UI that the user triggers stays under 300 ms [apps/ux-engine/motion].
- Animate on twos for a drawn feel: `posterizeTime(t, 12)` at 24 fps
  (FilmCraft Posterize Time; see the `spiderverse-style` skill).
- Echo trails decay geometrically: weight `start * decay^k` (FilmCraft Echo).

## 11. FilmCraft transitions mapped to a scroll page

Progress `p` is `sceneProgress(scroll, start, length)` over a pinned section,
usually one viewport of scroll. FilmCraft's contract carries over: `p = 0` is
exactly the outgoing frame, `p = 1` exactly the incoming one, continuous at both
ends, and the same scroll position always renders the same frame.

| FilmCraft                 | Its math                                                                    | On a scroll page                          | Use when                                 |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Cross Dissolve            | linear mix                                                                  | opacity crossfade                         | almost never; it is the fade slop tell   |
| Film Dissolve             | mix in gamma 2.2                                                            | crossfade without the mid dip             | two shots of the same place              |
| Dip to Color              | A to colour, hold, colour to B                                              | a full-bleed colour layer                 | a real chapter break; hold 10 to 30%     |
| Blur Dissolve             | A blurs out from 0 to 60%, B unblurs from 40%, mix `smoothstep(0.25, 0.75)` | filter blur on two layers                 | focus pull between depths                |
| Push                      | both frames move one travel on ease-in-out                                  | translate both sections together          | the next thing is beside this one        |
| Whip                      | push with sigmoid k 14, streak 18% of travel                                | translate plus SVG directional blur       | energy jump, same axis as the content    |
| Cube / Roll 3D            | 90 degree turn, push back 0.45 side                                         | `rotateY` with `perspective`              | the two scenes are faces of one object   |
| Motion Camera             | push-in 40%, turn 8 degrees, crossfade `smoothstep(0.3, 0.7)`               | scale and rotate the stage about a point  | entering a screen or object              |
| Motion Tween              | both frames scale-matched 15%, mixed on ease-in-out                         | FLIP scale of the shared element          | an element that exists in both scenes    |
| Morph Cut                 | optical-flow warp between frames                                            | same DOM element animated between layouts | the same subject, two positions          |
| Iris / Clock / Star wipes | a scalar field crossing a threshold                                         | `clip-path` circle or polygon             | avoid: Caleb rejected iris circles twice |
| Page Peel                 | cylinder roll over the corner                                               | rarely worth it on the web                | a paper object already in the scene      |
| Echo                      | earlier frames at `start * decay^k`                                         | stacked copies of a moving element        | showing speed of one hero object         |
| Posterize Time            | `floor(t * rate) / rate`                                                    | quantise `p` before rendering             | a drawn or stop-motion look              |

## Slop tells

Each one is refused on sight:

- **Fade-up entrances**: every block rising 20 px and fading in as it scrolls
  into view. It moves everything, so nothing is the focal point [jayd3n focus]
  [Caleb "lazy ahh transition"].
- **Numbered word sequences**: "1 2 3" or "Step one, step two, step three"
  appearing one by one. A slideshow in disguise [Caleb "NEVER make anything
  that could've been a slideshow"].
- **Unmotivated gradients**, lines or rectangles nobody chose [Caleb
  "unintentional ah lame gradient"].
- **Labels explaining the obvious**: "drag to turn", "scroll to explore". The
  cue should be the object's own behaviour, like the Dock's attention bounce
  [cinematic-scroll].
- **Overlapping text**: a label over a label, or type over the subject's face.
  Lay text out from the render's object boxes and check every seam.
- **Decorative props with no job**: an object that does not carry the story
  or become the next scene. Every prop either morphs into the next thing or
  goes [jayd3n flow].
- **A borrowed choreography with new shapes**: Lemma's sequence with pills
  instead of bricks was still "copying the animation" [Caleb, FF hero].
- **Blur without speed**: a static blur filter called motion.
- **Everything easing the same**: one curve on loops, pops and pushes alike.

## Checks before showing motion

1. Pause at 10 evenly spaced points: one focal motion in each.
2. Scrub backward through every transition: it reverses exactly (same `p`,
   same frame).
3. Name, for every transition, the object that persists across it.
4. Every blur is tied to a velocity, and is 0 at rest.
5. Reduced motion: transforms and blurs drop, opacity and colour stay.
6. Run the slop tells above against the page, then `site-gate` and `ui-proof`
   from the `interface` skill.
