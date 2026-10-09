# Motion and interaction craft

Researched 2026-09-20 from specs, design-system token source files, and the
shipped source of libraries people actually use. Where a published rule and the
author's own shipped code disagree, both are recorded, because the shipped
value is what the interface really does.

## 1. Easing

### The enter/exit rule, and the fight about it

`ease-out` for entering, `ease-in` for exiting, `ease-in-out` for moving while
staying on screen. Chris Coyier states it as using them opposite to their
names: *"When the knight calls them, they better arrive at a run, and slow down
into place. When the knight sends them away, they'd better very quickly get
moving out of there."*
[css-tricks](https://css-tricks.com/ease-out-in-ease-in-out/)

**Emil Kowalski, who wrote Sonner and Vaul, overrides this: never use `ease-in`
on UI at all.** His reason: *"It starts slow, delaying the exact moment the user
is watching. `ease-out` at 200ms feels faster than `ease-in` at 200ms."* His
decision order is entering **or exiting** to `ease-out`, moving or morphing to
`ease-in-out`, hover and colour to `ease`, constant motion to `linear`.
[STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)

**This is a real conflict and a generator has to pick one.** Material, Coyier
and Atlassian say accelerate on exit. Kowalski says never.

### Curves, exact, verified from source files

| Name | cubic-bezier | Use |
|---|---|---|
| M3 standard | `cubic-bezier(0.2, 0, 0, 1)` | default |
| M3 standard-decelerate | `cubic-bezier(0, 0, 0, 1)` | entering |
| M3 standard-accelerate | `cubic-bezier(0.3, 0, 1, 1)` | exiting |
| M3 emphasized-decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` | emphasized enter |
| M3 emphasized-accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` | emphasized exit |
| M3 legacy (= M2 standard) | `cubic-bezier(0.4, 0, 0.2, 1)` | |
| M2 sharp | `cubic-bezier(0.4, 0, 0.6, 1)` | exiting, may return |
| Carbon productive standard | `cubic-bezier(0.2, 0, 0.38, 0.9)` | task UI |
| Carbon productive entrance | `cubic-bezier(0, 0, 0.38, 0.9)` | |
| Carbon productive exit | `cubic-bezier(0.2, 0, 1, 0.9)` | |
| Carbon expressive standard | `cubic-bezier(0.4, 0.14, 0.3, 1)` | marketing |
| Atlassian ease-out bold | `cubic-bezier(0, 0.4, 0, 1)` | panel entrance |
| Atlassian ease-in practical | `cubic-bezier(0.6, 0, 0.8, 0.6)` | exit |
| Kowalski strong ease-out | `cubic-bezier(0.23, 1, 0.32, 1)` | UI enter/exit |
| Kowalski strong ease-in-out | `cubic-bezier(0.77, 0, 0.175, 1)` | on-screen movement |
| **Vaul drawer, shipped** | `cubic-bezier(0.32, 0.72, 0, 1)` | iOS-style sheets |

Source: [material-web v0.192 tokens](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss),
[@carbon/motion@11](https://unpkg.com/@carbon/motion@11.0.0/lib/index.js),
[atlassian.design](https://atlassian.design/foundations/motion),
[vaul/src/constants.ts](https://github.com/emilkowalski/vaul/blob/main/src/constants.ts)

**`easing-emphasized` and `easing-standard` are byte-identical in Google's own
web tokens**, both `cubic-bezier(0.2, 0, 0, 1)`. Flutter ships no plain
`emphasized` constant at all, because the spec curve is a multi-part path that
CSS cannot express. In CSS there is no difference between them.

**Replace the built-in CSS keywords on any deliberate animation.** Kowalski:
"Built-in CSS easings are too weak." Use `linear` only for constant-rate
motion: marquees, hold-to-delete timers, progress.

**Apple publishes no cubic-bezier values anywhere in the HIG.** Verified by
reading the full Motion page. Their numeric guidance is spring-based.

## 2. Duration

Ceilings, in descending authority: Material says nothing over **400ms**
("transitions that exceed 400ms may feel too slow"). Kowalski says nothing over
**300ms** ("a 180ms dropdown feels more responsive than a 400ms one").

**But his own shipped libraries break his own rule**, and that is the most
useful fact in this section. Vaul's drawer is **500ms**. Sonner's toast is
**400ms**. So the real rule is not a single ceiling:

> Under 300ms for anything the user triggers and then waits on. 400 to 500ms
> for a large surface moving a long distance.

### By interaction type

| Interaction | Duration |
|---|---|
| Hover, colour change | 50-150ms |
| Button press `:active` | 100-160ms, `scale(0.97)`, ease-out |
| Tooltip, small popover | 125-200ms |
| Dropdown, select | 150-250ms |
| Modal, drawer | 200-500ms |
| **Drawer, shipped (Vaul)** | **500ms** |
| **Toast transform, shipped (Sonner)** | **400ms** |
| **Toast swipe-out, shipped** | **200ms** |
| **Toast lifetime, shipped** | **4000ms** |
| Entering (Material) | 225ms, decelerate |
| Exiting (Material) | 195ms, accelerate |
| Stagger between list items | **30-80ms**. Longer feels slow |

**Make press-and-release asymmetric.** Kowalski's shipped pattern: press is
`clip-path 2s linear`, release is `clip-path 200ms ease-out`. Symmetric timing
on a press-and-hold is a defect.

### The frequency rule, which is the best rule in this file

**Match motion to how often the user sees it.**

| Frequency | Motion |
|---|---|
| 100+ per day (shortcuts, command palette) | **none** |
| Tens per day (hover, list nav) | reduced |
| Occasional (modals, drawers, toasts) | standard |
| Rare or first-time | delight |

Raycast ships **no open/close animation**, which is correct for something
opened hundreds of times a day. Apple agrees: "in apps, generally avoid adding
motion to UI interactions that occur frequently."

## 3. Spring physics

### Apple's argument, WWDC 2018 "Designing Fluid Interfaces"

Nathan de Vries, [session 803](https://developer.apple.com/videos/play/wwdc2018/803/):

- **Stop using the word duration for elastic behaviour.** *"We actually like to
  avoid using duration when we're describing elastic behaviors, because it
  reinforces this concept of constant dynamic change. The spring is always
  moving, and it's ready to move somewhere else."*
- **Use springs because interruption is free.** *"This seamlessness is, kind
  of, built in to the behavior."*
- **Start at 100% damping, meaning zero overshoot.** Add overshoot only when
  the driving gesture carried momentum. Apple's own Music app uses 100% damping
  on tap and **80%** on swipe: "if the gesture that's driving the motion itself
  has momentum, then you should reward that momentum with a little bit of
  overshoot."
- Project a gesture endpoint from velocity:
  `projectedPosition = velocity / (2 * decelerationRate)`.

### SwiftUI defaults, from Apple's doc API

```
spring(response: 0.5, dampingFraction: 0.825, blendDuration: 0)
smooth(duration: 0.5, extraBounce: 0)     base bounce 0
snappy(duration: 0.5, extraBounce: 0)     base bounce 0.15
bouncy(duration: 0.5, extraBounce: 0)     base bounce 0.3
```

**`extraBounce` is additive on a base bounce**, so `.bouncy(extraBounce: 0.1)`
is bounce 0.4, not 0.1. Apple defines `duration` as *perceptual*, not settling
time. `response: 0` requests an infinitely stiff spring, for finger-tracking.

### Framer Motion defaults, from the shipped package

```
stiffness: 100, damping: 10, mass: 1.0, velocity: 0
duration: 800ms, bounce: 0.3, visualDuration: 0.3s
restSpeed: 2, restDelta: 0.5
minDuration: 0.01s, maxDuration: 10s
```

**motion.dev's docs say `bounce` defaults to 0.25. The shipped source says
0.3.** Trust the source. `stiffness`/`damping`/`mass` override
`duration`/`bounce` when both are given. `bounce` maps to damping ratio as
`1 - bounce`, clamped to [0.05, 1].

### react-spring presets

| Preset | tension | friction |
|---|---|---|
| default | 170 | 26 |
| gentle | 120 | 14 |
| wobbly | 180 | 12 |
| stiff | 210 | 20 |
| slow | 280 | 60 |
| molasses | 280 | 120 |

All mass 1. [react-spring config](https://www.react-spring.dev/docs/advanced/config)

### Shipped gesture thresholds

Vaul: `VELOCITY_THRESHOLD 0.4`, `CLOSE_THRESHOLD 0.25`,
`SCROLL_LOCK_TIMEOUT 100`, `NESTED_DISPLACEMENT 16`.
Sonner dismisses when `|swipe| >= 45px` **or** `velocity > 0.11 px/ms`.
**Do not require crossing a distance threshold alone. A flick should be
enough.**

**Damp motion past a natural boundary rather than hard-stopping it.** Drag
further, move less.

## 4. The 60fps rule

Target 16.66ms per frame, budget **10ms** of your own work. Keep compositing to
**4-5ms** during scroll.

| Property class | Stages | Examples |
|---|---|---|
| **Compositor only, animate these** | style, composite | `transform`, `opacity` |
| Paint | style, paint, composite | `background-image`, `color`, `box-shadow`, `border-radius` |
| **Layout, worst** | style, layout, paint, composite | `width`, `height`, `top`, `left`, `margin`, `padding` |

- **Animate `transform` and `opacity` only.** Treat animating width, height,
  margin, padding, top or left as a performance bug.
- **Ban `transition: all`.** It animates unintended properties off the GPU.
- **Use `translateY(100%)` over hardcoded pixel offsets.** Transform
  percentages resolve against the element's own size, which is how Sonner and
  Vaul position things.
- **Do not set a CSS variable on a parent to drive child transforms.** It
  recalculates style for every child. Write `element.style.transform` directly.
- **In Framer Motion, animate the full transform string, not the `x`/`y`
  shorthands, when the page may be busy.** `animate={{ x: 100 }}` runs on the
  main thread via rAF and drops frames.
- **Prefer CSS animations over rAF for predetermined motion.** They run off the
  main thread and survive script and paint spikes.
- **Keep `filter: blur()` under 20px.** Worst in Safari.

### will-change

MDN, quoted: *"`will-change` is intended to be used as a last resort... It
should not be used to anticipate performance problems."*

- **Never ship it in a static stylesheet** for an element that changes
  occasionally. That "implies the targeted elements are always a few moments
  away from changing" and the browser holds the optimization far too long.
  Toggle it in JS and set back to `auto`.
- **Never write `* { will-change: transform }`.**
- Set it slightly *ahead* of the change, not at the instant of it.
- Count your layers. Each costs memory and CPU-to-GPU upload bandwidth.

## 5. Scroll

### Native CSS scroll-driven animations

`animation-timeline: scroll(<scroller> <axis>)` or `view(<axis> <inset>)`.
Set `animation-duration: auto`.

**Declare `animation-timeline` AFTER the `animation` shorthand.** It is a
reset-only value in the shorthand, so the shorthand silently resets it to
`auto`. This is the single most likely way to get it wrong.

`animation-range` takes `cover`, `entry`, `exit`, `entry-crossing`,
`exit-crossing`, `contain`.

### Browser support, 2026

| Browser | First version |
|---|---|
| Chrome / Edge | 115 |
| Safari | **26.0** (unsupported through 18.7) |
| Firefox | **159** (unsupported through 158) |

**Global usage 87.22%.** [caniuse](https://caniuse.com/mdn-css_properties_animation-timeline)
MDN still marks it "limited availability, not Baseline."

**Gate every scroll-driven effect behind `@supports (animation-timeline:
scroll())` and keep the effect decorative**, because 12.8% will not see it.
Discard blog claims of "Firefox 126+" or "Safari 17.2+", which contradict the
per-version table.

### Lenis defaults

```
duration: 1.2, lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1
easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t))
```

### The case against scroll hijacking

[NN/g Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/).
Study finding: *"The majority of participants experienced at least mild
disorientation."* Some read it as a bug. A participant: *"That was a full
swipe, and it moved nowhere... if I were looking at this as a prospect, I would
get severely agitated."*

Never change scroll direction. Never scrolljack a section with body copy in it.
Never on mobile. Never above the fold. Put normal-scrolling sections between
hijacked ones. NN/g found exactly one positive case, a short scrolljack on BBC
News used to progressively disclose information with real value.

## 6. Accessibility

`prefers-reduced-motion` has exactly two values, `no-preference` and `reduce`.

**The spec's own words are "removes, reduces, or replaces" motion, not
"removes."**

- **Reduce, do not delete.** Keep transitions that aid comprehension, remove
  movement and position changes. Keep opacity and colour, drop transforms.
- **Prefer shortening durations to `animation: none`**, because some sites rely
  on animation events to function.
- **Listen for live changes.** `matchMedia(...).addEventListener('change', ...)`,
  do not read the preference once at boot.
- **Gate every hover animation behind `@media (hover: hover) and (pointer:
  fine)`.** Touch fires false hovers on tap.

### Vestibular triggers, named by Val Head

Parallax, scrolljacking, full-screen wipes, 3D zooms covering large virtual
distances, horizontal scroll conflicting with vertical.
**Safe by contrast:** "animation that involves only non-moving properties, like
opacity, color, and blurs, are unlikely to be problematic."

**The variable is virtual distance covered, not duration.** She publishes no
pixel or time threshold. Do not invent one.
[A List Apart](https://alistapart.com/article/designing-safer-web-animation-for-motion-sensitivity/)

### Apple's Reduced Motion criteria

Disable depth simulation, multi-axis motion, spinning and vortex effects. Stop
auto-advancing carousels or give a control to stop them. **Do not delete an
animation that carries information: substitute a dissolve or colour shift.**
"Let people cancel motion." For visionOS, a real number: **avoid sustained
oscillation around 0.2 Hz.**

### WCAG

| SC | Level | Rule |
|---|---|---|
| **2.2.2 Pause, Stop, Hide** | **A** | Anything moving that starts automatically, lasts more than **five seconds**, and sits alongside other content needs a pause/stop/hide control |
| **2.3.3 Animation from Interactions** | AAA | Motion triggered by interaction must be disableable unless essential |

2.3.3's stated stakes: *"Triggered reactions include nausea, migraine
headaches, and potentially needing bed rest to recover."* Hover and
scroll-into-view both count as "triggered by interaction."

**2.2.2 is Level A, so it is the one that is actually legally load-bearing.**

## 7. Micro-interaction anatomy

Dan Saffer, *Microinteractions* (O'Reilly, 2013): **trigger, rules, feedback,
loops and modes.** The four-part breakdown here is secondhand; O'Reilly returns
403 and the primary text was not fetched. **[UNVERIFIED]**

### Kowalski's ten, which are operational rather than descriptive

1. **Justify the motion.** "It looks cool" on a frequently-seen element is not
   a reason.
2. **Match motion to frequency.** See the table in section 2.
3. **Use responsive easing.** `ease-in` on UI is a block.
4. **Stay under 300ms on UI.**
5. **Get the origin right. Never `scale(0)`.** Start from `scale(0.9)` to
   `scale(0.97)` plus `opacity: 0`: *"Nothing in the real world appears from
   nothing."* Popovers and dropdowns scale from their trigger via
   `transform-origin`. **Modals are the exception and keep
   `transform-origin: center`.**
6. **Make it interruptible.** CSS **transitions** retarget mid-flight;
   `@keyframes` restart from zero. Use transitions for anything triggered
   rapidly. Use `@starting-style` for entry without JS.
7. **Animate `transform` and `opacity` only.**
8. **Honour `prefers-reduced-motion`, and gate hover behind `(hover: hover)`.**
9. **Make enter and exit asymmetric.**
10. **Match the component's personality.** *"When unsure whether motion feels
    right, the strongest move is often to delete it."*

**Fix priority when something is wrong, in order:** delete it, reduce it, fix
the easing, fix the origin, make it interruptible, move it to the GPU, make the
timing asymmetric, polish, then accessibility and cohesion.

**Debugging method:** bump duration 2 to 5x, or use the DevTools Animations
panel, and check that colours crossfade cleanly, easing does not stop abruptly,
`transform-origin` is right, and coordinated properties stay in sync.

## Contradictions a generator must resolve

1. **Exit easing.** Coyier, Material and Atlassian say accelerate on exit.
   Kowalski says `ease-out` always. Pick one and write it down.
2. **`easing-emphasized` equals `easing-standard`** in Google's own web tokens.
   In CSS there is no difference.
3. **Framer Motion `bounce`:** docs say 0.25, source says 0.3.
4. **Two incompatible M3 duration sets circulate.** Google's current one ends at
   `extra-long4: 1000ms`. Discard any list showing `extra-long2: 1400ms`.
5. **Max duration:** Material 400ms, Kowalski 300ms, and Kowalski's own shipped
   drawer is 500ms.
