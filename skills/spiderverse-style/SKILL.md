---
name: spiderverse-style
description: "Apply the Spider-Verse look (Into the Spider-Verse, Across the Spider-Verse) to a website, a WebGL scene, a render or a motion piece, using rules the Sony Pictures Imageworks crew described in their own talks: animating on twos, halftone in the light and hatching in the shadow, CMYK misregistration in place of depth of field, ink lines only where an illustrator would draw them, per-universe palettes, onomatopoeia and panels. Use when asked for a Spider-Verse, spiderverse or Spider-Man style, a comic shader, comic book look, halftone, Ben-Day dots, cross hatching, misregistration or chromatic aberration as depth, a 2D/3D hybrid or NPR look, stepped or choppy animation on twos, Kirby Krackle, or a page that should feel like a printed comic. Also fires on: comic filter looks cheap, halftone looks like a filter, make it look hand drawn, Miles Morales style, Gwen watercolor, Spider-Punk collage, 2099 marker style."
---

# Spider-Verse style

The look is a set of decisions, not a filter. Every rule below came from the
people who built it (Imageworks VFX, animation, effects and look-of-picture
supervisors) or from practitioners who rebuilt it in a shader, and each says
where it came from. Sources and what was actually read are in
[references/sources.md](references/sources.md). Tags like `[SIG23]` point there.

The thesis, from the crew. Danny Dimian (VFX supervisor, Into): "We basically
tried to avoid anything that looked like it was a smooth gradation." `[CB]`
Phil Lord: freeze any frame and it reads as an illustration. `[INS]` Pav
Grochola (effects, Across): the technology should serve the artist, and
the best results always combined procedural with handmade. `[GNO]` The
failure this skill exists to prevent is the opposite: one uniform post filter
over everything, which reads as a Snapchat lens rather than a comic.

## A style pass is not the movie

Caleb, 2026-10-09, on a T Combinator build that had halftone, misregistration
and ink lines over its existing scenes: "ok so far but wouldn't blow ppls
minds in the way the spiderverse movie did." The shader rules below are
necessary and nowhere near enough. What blew minds in the theater was art
direction and camera, so plan those first:

- Universes colliding, each in its own art style (Miles' halftone Brooklyn,
  Gwen's watercolor, 2099's clean neon marker, Spider-Punk's collage), with
  a glitch tear between them. One style everywhere reads as a theme.
- One unforgettable shot, like the Leap of Faith's inverted fall up into
  the city.
- Camera language: whip pans with blocky streaks, dutch angles, holds on
  twos, a sudden split into simultaneous panels.
- Type as a character: caption boxes that pop in one frame, onomatopoeia
  only on the big beats.
- A concept that makes the viewer the subject. Caleb, same night: the
  takeaway was "cool effects" and not "holy shit that is the coolest site
  I've ever seen". Effects don't produce that reaction. A site that's about
  the person looking at it does, so they put themselves in the comic and
  send it to their group chat. Test it with "would they screenshot this?"
- Every page in the same world. The apply form after a cinematic home page
  was "ass lmao" (same night). The last page is the last panel of the comic.

## What makes it read as comic and not as a filter

A filter applies one treatment everywhere at one strength. The films decide
per element, the way an illustrator does:

1. **Lines are placed, not detected.** Grochola rejects edge-detect lines in
   comp or shaders because they carry no artistic choice. `[B&A]` Lines go
   where an illustrator would draw them: a crease, a nose, a chin against a
   neck, a silhouette break. Never on every edge.
2. **Light and shadow get different marks.** Dots in the light, lines in the
   shadow, flat color in between. A filter that dots everything is the tell.
3. **Detail has a hierarchy.** Focus areas are fully rendered; backgrounds
   fall away to blobs of color, sketches and blue-line. `[WIR] [SIG23]`
4. **Imperfection is an accent, never the structure.** Dimian: imperfections
   must be accents, secondary actions or embellishments, decided case by
   case. `[VFXV]` Offset outlines on an iris, a misprint here, a broken line
   there. Not noise over the whole frame.
5. **Patterns are pinned to the screen and do not swim.** Imageworks built
   tools specifically so paper texture and dots would not slide or scale as
   cameras moved, because audiences got distracted. `[SIG23]` Their first
   literal print simulation was "distracting in motion", so they built a
   visual language that suggests print instead. `[SPI-1]`
6. **Commit.** Grochola: if you ask everyone the best color you get beige.
   One vision, no compromise, is why the films look the way they do. `[GNO]`

## The rules

Each rule is phrased so it can be built and checked. Source tags follow.

### Time

1. **Characters on twos, camera on ones.** Hold each pose for two frames
   (12 poses per second at 24fps) while the camera moves every frame.
   Josh Beveridge: on twos "more often than not", but fluid, with holds and
   switches to ones inside a shot; avoid strobe and mush. `[VFXV] [WIR] [JDH]`
   Dimian: "What we didn't like visually was the smoothness of being on 1s." `[CB]`
2. **Frame rate is characterization.** Ones read as mastery or grace, twos as
   effort. In the forest swing Miles is on twos and out of sync with the
   camera, Peter B. on ones; they converge as Miles gets it. `[WIR] [INS]`
   The crane leap stays on ones because it is graceful. `[HW]`
3. **Different parts can run at different rates.** Spider-Punk: body on twos
   and threes, jacket on fours, guitar on sixes, because separating body
   parts looked like South Park. Alan Hawkins (head of character animation). `[GNO]`
   (No The Robot reports threes and fours `[NTR]`; trust the head of
   animation.)
4. **No in-betweens on impacts.** Anticipation pose, then the impact pose,
   held two frames. A smear goes on the second held frame only. `[NTR] [CW]`
5. **Smears and ink effects live one or two frames.** Any longer and they
   distract. Beveridge, via Jeff Panko. `[CBQ]`
6. **Inverted burst cards before a big hit.** A few black-and-white,
   scratch-art frames that escalate, then snap back to white with black line.
   Meant to be felt, not seen. `[MAN2]` Same family: pop frames, hand-drawn
   stills that cut in for a beat. `[WIR] [INS]`
7. **Lines boil, on purpose.** Kismet keeps two sets of lines: one draws on
   while the other draws off ("dual rest"), so lines are always correct for
   the angle and alive while still. `[SIG23] [GNO] [B&A]`

### Motion without blur

8. **No motion blur, ever.** Replace with smears, multiples (extra limbs or
   afterimages of an object), speed lines connected to the form, and blocky
   graphic streaks on fast pans. `[SPI-M] [CB] [VFXV] [CW]`
9. **Echo instead of blur** where something must feel fast: repeat the image
   offset along the motion ("shifting"). `[CBQ]`

### Focus and depth

10. **Depth of field is color misregistration, not blur.** Shift the color
    plates apart in proportion to distance from the focus plane; in-focus
    plates line up. Dimian: a z-depth-based offset of colors, applied
    consistently, never blur or defocus. `[VFXV] [SPI-SV] [TH]`
11. **Reuse the same offset for other jobs:** camera motion, lens flares,
    light bleeding in from off screen, and pure emotion (Kingpin's eyes
    shake in offset because he is overwhelmed), per production designer
    Justin K. Thompson. `[TH]`
12. **Fringe direction is consistent.** Recreations of Across put green
    toward the upper right and pink toward the lower left. `[MAN-HT]`

### Light and shadow

13. **Highlights are dots, shadows are lines, midtones are flat.**
    Thresher and Hatcher: dots where light hits, hatching where shadow hits. `[FDY]`
    Geeta Basantani (lighting): "light and reflections were defined by dots." `[CBQ]`
14. **Kill gradients, then break the steps.** Quantize values into bands
    (banding is welcome), then let halftone carry the transition. Lighting TD
    Anuar Figueroa: once you have a gradient they look into killing it. `[AAA]`
    Dimian: values are stepped, then broken with halftone. `[VFXV]`
15. **Dot size maps to light intensity**, larger toward the hot center,
    tapering thick to thin to suggest glow. `[CBQ] [AAA]`
16. **No soft glow.** Basantani: "We were against glow." `[CBQ]`
17. **Keep the dots small.** Kingpin's shoulder highlight dots never get big;
    midtone halftone, when used, is barely visible. `[GSG]` Halftone and
    tone-map banding should not compete in the same area; pick one. `[MAN-HT]`
18. **Shadow hatching is mostly fine, thin streaks**, thick-to-thin lines
    building a value. `[MAN-HT] [VFXV]` Thompson: shadows create sketchy hatch marks.
19. **Dots are cast by lights**, so they differ per surface with the angle of
    the light, the surface and the view. `[TH]`
20. **Keep the underlying 3D shading.** The look sits on top of real form
    and specular; it is not flat cel shading. `[GSG] [VFXV]`
21. **Shadows can be any color the art says**, and differ by which object
    casts them; graphic cast shadows may ignore geometry. `[SIG23] [GNO]`

### Lines

22. **Three kinds of line:** form lines built into the model (inside an ear),
    drawn form lines that describe shape (chin against neck), and acting lines
    for emotion. All are independent of the geometry. `[CB] [VFXV]`
23. **A stroke beats a wrinkle.** Animators drew expression lines instead of
    sculpting wrinkles. Beveridge: characters do not look on model until the
    expression lines are in. `[VFXV] [WIR]`
24. **Face lines follow a per-angle library.** A designer drew how the nose
    line looks from each head angle; ML predicted placement, artists
    corrected. Across expanded this to 14 characters. `[WIR] [SIG23]`
25. **Lines are offset from the surface and may overshoot the silhouette**
    (Miguel's shoulder lines; 2099 concept-art overshoot). `[B&A] [SIG23] [MAN2]`
26. **Lighting can thicken lines or remove them on one side.** `[B&A]`
27. **Silhouette lines come from the sign flip of N dot V** across a polygon;
    build the rest on top of that clean silhouette. Grochola, Q&A. `[GNO]`
28. **Broken models.** Floating lines, unconnected window panes, lines that
    do not close. `[CB]`

### Shape, detail, composition

29. **Graphic reduction: big, medium, small.** Distant traffic is color blobs;
    a bus full of passengers is a painting; interiors are flat shapes. `[WIR] [DA]`
30. **Hard edges everywhere.** Shapes look lasso-cut at full opacity. `[DA]`
31. **Reserve the extremes for the subject.** Backgrounds stop short of pure
    white and pure black so the character's darks and lights always read. `[MB]`
32. **Cities are built for one camera.** Manhattan buildings 8 to 10 times too
    tall, skewed, broken from any other angle. `[WIR]`
33. **Lenses changed between films:** Into used flat 35 to 50mm comic-panel
    framing; Across pushed 21 to 35mm. `[GNO]` Dutch tilts, upside-down
    frames and big negative space around a silhouette are recurring. `[HW]`
34. **Silhouettes avoid repetition:** vary C curves, S curves and straights;
    straights read faster and go on the limb under exertion. `[MB]`

### Color

35. **Color script first, and it changes.** Art directors replaced render
    color wholesale in comp to hit the script. `[GNO]`
36. **Natural for the grounded, supernatural for the super.** Home and family
    scenes are naturalistic; hero and villain moments get vivid color plus
    comic elements (letters on screen, word balloons). Thompson. `[TH]`
37. **Push saturation past natural**, so color reads as printed ink. `[AAA] [SPI-SV]`
38. **Limited analogous palette plus one far accent.** A pie slice of the
    wheel, hues ordered across the frame, and the Spider-Man blue as the one
    color outside it. `[MB]`
39. **Color can mean emotional distance.** Two characters lit in different
    colors are apart; sharing a color means they are together. `[JS] [GH]`
40. **Climax: strip to black, then one strike.** Into's final fight loses
    all color so Miles' venom strike lands on black. `[WIR]`
41. **Kirby Krackle** (clusters of black energy dots) for portals, energy and
    the collider. `[WIR] [TH] [INS]`

### Text, panels, onomatopoeia

Evidence here is thinner than for light and line: one production designer
interview, one explainer and one motion tutorial. Treat as strong defaults.

42. **Comic devices belong to supernatural moments**: onomatopoeia, captions,
    word balloons, thought boxes. `[TH] [INS]`
43. **Panels can be a montage device.** A web whose cells are panels fills in
    one by one. `[HW]` Webbing panels show background action. `[INS]`
44. **Caption boxes** in the Into style: hard black border, solid offset drop
    shadow at 100% opacity with no blur, slightly rough edges, halftone dots
    inside the box and inside the shadow, and they pop on in one frame. `[AE]`
45. **Text lives in the scene's depth**, placed in 3D and parallaxing with
    it, not pasted flat on top. `[AE]`

## Universe palettes

Descriptions are sourced. No source gives hex values; tokens in the CSS
section are starter values chosen here, not sampled from the films.

| Universe          | Look                                                                                                                                                                                                         | Source                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Earth-1610, Miles | Printed comic: Ben-Day dots, halftone, hatching, CMYK offset, ink. Brooklyn warm and safe; Manhattan deep blue and green, ominous. Across renders Brooklyn near monochrome.                                  | `[SIG23] [TH] [WIR] [SPI-SV]` |
| Earth-65, Gwen    | Wet-on-wet watercolor, sketchy line, art-directed drips. Pink, blue and violet with green and white accents. Light "obeys feeling"; outside her attention dissolves to a wash; frisket-white negative space. | `[SIG23] [SPI-SV]`            |
| Earth-928, 2099   | Syd Mead and John Berkey. Clean, sharp, cool. Built up paper, perspective lines, sketch, blue-line, ink, marker, then painted detail only where the eye goes.                                                | `[SIG23] [GNO]`               |
| Mumbattan, Pavitr | 1960s and 70s Indrajal comics: pulpy paper, misprints, color offsets, heavy dots, loose heavy ink, vivid bursts; density collapses to swabs of color at distance.                                            | `[SIG23] [SPI-SV] [GNO]`      |
| Earth-138, Hobie  | 70s London punk xerox collage, flat printed look, colors and textures that keep changing, lines redrawing in odd directions, inconsistent frame rates.                                                       | `[SIG23] [GNO]`               |
| Earth-42          | Frank Miller and Sean Gordon Murphy noir: colors recede into blocked-up shadow, heavy gritty ink, splatter and dry brush over saturated washes.                                                              | `[SIG23] [GNO]`               |
| Noir              | Black and white, halftone; never takes color in any world.                                                                                                                                                   | `[WIR] [MAN2]`                |
| Vulture           | Sepia Da Vinci drawing come to life; even his smoke is sketched.                                                                                                                                             | `[SIG23] [MAN2]`              |

Gwen's analyzed scenes use pink for Gwen and blue for her father's
responsibility, with teal as healing. That is critics' reading, not studio
statement. `[JS] [GH]`

## Building it on the web

### CSS, no WebGL

```css
:root {
  /* starter tokens, chosen here, not sampled from the films */
  --paper: #fbf4e4;
  --ink: #111014;
  --c: #00a8e0;
  --m: #e6007e;
  --y: #ffe100;
  --misreg-a: rgb(0 230 170 / 0.85); /* green, upper right */
  --misreg-b: rgb(255 0 140 / 0.85); /* pink, lower left */
}

/* Rule 10: offset scales with distance from focus. Focal element gets --d: 0. */
.layer {
  --d: 0;
}
.layer--far {
  --d: 4px;
}
.layer--near {
  --d: 3px;
}
.layer > * {
  filter: drop-shadow(var(--d) calc(var(--d) * -1) 0 var(--misreg-a))
    drop-shadow(calc(var(--d) * -1) var(--d) 0 var(--misreg-b));
}

/* Rule 44: caption box with a hard offset shadow and no blur */
.caption {
  background: var(--y);
  color: var(--ink);
  border: 3px solid var(--ink);
  box-shadow: 6px 6px 0 var(--ink);
  font-family:
    "Bangers", "Komika Axis", sans-serif; /* any condensed comic face */
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Fixed-radius dot field. Variable radius needs bands or the trick below. */
.dots {
  background-image: radial-gradient(circle, var(--ink) 0 30%, transparent 31%);
  background-size: 8px 8px;
  background-attachment: fixed; /* rule 5: pinned to the screen */
}

/* Rule 1: stepped motion. 12 steps per second for character-like elements. */
.pose-in {
  animation: pose-in 0.5s steps(6, jump-end) both;
}

/* Scroll and camera-like motion stay smooth (rule 1). Only "characters" step. */

@media (prefers-reduced-motion: reduce) {
  .pose-in,
  .boil {
    animation: none;
  }
}
```

Variable dot size in pure CSS: the contrast-threshold trick (soft radial dots
blended over a gradient, then `filter: contrast()` high enough to threshold
them) gives dots that grow with darkness. Verify it in every target browser
before relying on it; WebGL is the dependable path.

Rough, boiling edges: an SVG filter with `feTurbulence` into
`feDisplacementMap` (scale 2 to 4). To boil, change the turbulence `seed`
attribute at 8 to 12 times a second from JS, never every frame. `[AE]` uses
the same idea (turbulent displace on borders).

### WebGL post pass

One full-screen fragment shader over the rendered scene. Needs the color
buffer and a depth buffer. `fwidth` needs `OES_standard_derivatives` on WebGL1;
it is core in WebGL2. Structure follows the Imageworks split of light into
highlight, midtone and shadow masks `[GSG] [MAN-HT] [UE]`; the grid, rotation
and anti-aliasing follow `[MH]`.

```glsl
precision highp float;
uniform sampler2D uScene, uDepth;
uniform vec2  uRes;
uniform float uFocus;      // depth of the focal plane, 0..1
uniform float uDefocus;    // how fast misregistration grows with distance
uniform float uMisregPx;   // max plate offset in px, 3..6 reads well
uniform float uCellPx;     // dot cell size in px, 5..9
uniform float uHatchPx;    // hatch period in px, 4..7
uniform float uLevels;     // luminance bands, 3..5
varying vec2 vUv;

const float PI = 3.14159265;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

// Dot mask on a rotated screen grid. cover 0..1 is the fraction of the cell
// to ink; radius from circle area, so perceived tone tracks cover until dots
// touch (about 78%).
float dots(vec2 px, float angle, float cover) {
  vec2 g = rot(angle) * px / uCellPx;
  float d = length(fract(g) - 0.5);
  float r = sqrt(clamp(cover, 0.0, 1.0) / PI);
  float aa = fwidth(d);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

// 45 degree lines; cover is the inked fraction of each period.
float hatch(vec2 px, float cover) {
  float v = fract((px.x + px.y) * 0.70710678 / uHatchPx);
  float d = abs(v - 0.5);
  float aa = fwidth(v);
  return 1.0 - smoothstep(0.5 * cover - aa, 0.5 * cover + aa, d);
}

void main() {
  vec2 px = vUv * uRes;

  // Rule 10 and 12: misregistration grows with distance from focus.
  float z = texture2D(uDepth, vUv).r;
  float k = clamp(abs(z - uFocus) * uDefocus, 0.0, 1.0);
  vec2 o = k * uMisregPx * normalize(vec2(1.0, 1.0)) / uRes;
  vec3 col;
  col.r = texture2D(uScene, vUv).r;
  col.g = texture2D(uScene, vUv - o).g;   // green content lands up-right
  col.b = texture2D(uScene, vUv).b;

  // Rule 14: quantize luminance into bands, keep hue.
  float l = luma(col);
  float q = floor(l * uLevels + 0.5) / uLevels;
  col *= q / max(l, 1e-3);

  // Rule 13: masks; each world gets its own thresholds
  float hi = smoothstep(0.62, 0.95, l);          // highlights
  float lo = 1.0 - smoothstep(0.08, 0.38, l);    // shadows

  // Rule 15 and 17: small light dots, bigger toward the hot center.
  float hd = dots(px, radians(15.0), hi * 0.55);
  col = mix(col, vec3(1.0), hd * 0.85);

  // Rule 18: thin dark lines in shadow, thicker as it gets darker.
  float hl = hatch(px, lo * 0.45);
  col *= 1.0 - hl * 0.75;

  gl_FragColor = vec4(col, 1.0);
}
```

Print-accurate four-plate halftone, for the Mumbattan or newsprint worlds:
convert to CMYK with `k = 1 - max(r,g,b)`, `cmy = (1 - rgb - k) / (1 - k)`,
screen each plate at its own angle (cyan 15, magenta 75, yellow 0, key 45
degrees, the angles `[MH]` uses), size each dot from coverage, and multiply
the plates onto paper white. Offset the plates by a few pixels for
misprints. Different angles per plate are what prevent moiré. `[MH]`

Twos in a render loop: step animation time, not the frame.

```js
const FPS_POSE = 12; // rule 1
const tPose = Math.floor(t * FPS_POSE) / FPS_POSE;
character.update(tPose); // poses hold for two frames
camera.update(t); // camera stays on ones
const boilSeed = Math.floor(t * 8); // rule 7: lines redraw at 8fps
```

Painterly worlds (Gwen, 2099 backgrounds) are not halftone. No source says
Imageworks used a Kuwahara filter; it is the standard real-time stand-in for
brushed paint. Use the generalized version: circular kernel, 8 sectors, and
weight each sector's mean by `1 / (1 + sigma)` instead of picking the
lowest-variance sector, which removes flicker in motion. The anisotropic
version (kernel follows the structure tensor) holds up best on faces and
hair. `[ACR]` Imageworks' actual painterly tools were brush systems that
sample color per stroke region; sampling per pixel makes strokes pop when
lighting changes. `[GNO]`

Limited palettes: quantize each channel with `floor(c * (n - 1) + 0.5) / (n - 1)`,
optionally after adding an ordered (Bayer) threshold. To map to a hand-picked
palette, quantize luminance and use it as the U coordinate into a palette
strip. `[ACR-Q]`

## Translating per element on a site

| Element              | Do                                                                       | Source rule |
| -------------------- | ------------------------------------------------------------------------ | ----------- |
| Hero headline        | Flat ink type, misregistration only if it is not the focus               | 10, 36      |
| Focal CTA or card    | Plates aligned, hard border, hard offset shadow, dots in the shadow      | 10, 44      |
| Background imagery   | Misregistered, reduced to big shapes, dots in highlights, hatch in shade | 10, 13, 29  |
| Section transitions  | One or two pop frames or a burst card, never a crossfade                 | 6           |
| Hover                | Snap between two poses on twos, no easing tween                          | 1, 4        |
| Scroll parallax      | Smooth, every frame                                                      | 1           |
| Icons, illustrations | Lines only at silhouette breaks and creases, boil at 8fps                | 7, 22       |
| SFX words            | Only at the loudest moment on the page; one per screen                   | 42          |
| Sections per theme   | One universe palette per section, switch on purpose                      | 35, 36      |

## Tells that it reads as a filter

- Outlines on every edge at one width.
- Dots everywhere, including shadows and midtones, all at one size.
- Any blur: Gaussian, backdrop, soft shadow, CSS `transition` on position.
- Patterns that slide when the page scrolls or the camera moves.
- Chromatic aberration on the focal element.
- Smooth 60fps easing on characters and illustrations.
- Random jitter over the whole frame instead of placed imperfections.
- A dozen comic SFX words on one page.
- Every section the same palette and the same treatment.

## Accessibility

- Inverted burst frames and color flashes: stay under three flashes per
  second (WCAG 2.3.1), and drop them under `prefers-reduced-motion`.
- Boil and twos stepping stop under `prefers-reduced-motion`.
- Misregistration never goes on body text. Check contrast on the aligned text.
- Halftone over text backgrounds lowers contrast; measure on the dot color,
  not the average.

## Checklist before calling it done

- [ ] Freeze any frame or scroll position: does it read as a finished illustration?
- [ ] Is the focal element the only thing with aligned plates?
- [ ] Dots only in light, lines only in shadow, midtones flat?
- [ ] Zero blur anywhere, including CSS shadows and transitions?
- [ ] Character-like motion stepped, camera and scroll smooth?
- [ ] Lines placed by hand or rule, not edge-detected?
- [ ] One palette per section, chosen from the universe table, with one accent?
- [ ] Comic devices reserved for the big moments?
- [ ] Reduced-motion path checked?
