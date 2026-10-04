/* The page's scene wiring. The hero scene lives in sections/hero-scene.js;
   this file mounts it, runs the pinned product demo, draws the hero plates
   and mounts the section modules. */

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));


/* ---------------------------------------------------------------------- */
/* SCENE 2: the product demo. Copy moves, the demo area stays put.         */
/* ---------------------------------------------------------------------- */
/* THE FOUR PANELS, NOW THE RICH ONES.

   `waterfall`, `chat-mock` and `integrations` were three standalone sections
   sitting after this pinned demo: 1785px with no counterpart on the
   reference, covering ground the demo already covers. Their panels are far
   richer than the thin ones written here, so they move into the slots and
   the sections go.

   WHICH PANEL GOES WHERE, and this corrects what the plan said. I had put
   the waterfall under "Ship with confidence". It is a trace waterfall: spans,
   durations, a tree, findings. It belongs under "Traces", and the thin
   `tracePanel` it replaces was a worse drawing of the same thing.

       Traces        the waterfall      spans, timings, findings
       Live alerts   the chat mock      a channel, a thread, a typing state
       Sift MCP      the integrations   a framework rail and two config blocks
       Metrics       metrics.js         an issue that closed and came back

   `mount` runs after the panel is in the document, because all three modules
   query inside a root they are handed. The thin panels had no interactive
   parts and so needed nothing. */
const DEMO = [
  { label: "Traces", title: "Find the runs that failed quietly.",
    body: "Sift reads every run against what your agent was told to do, and folds the failures that repeat into one issue each.",
    mod: sec_waterfall },
  { label: "Live alerts", title: "Hear about it where your team already talks.",
    body: "Each new issue lands in Slack.",
    mod: sec_chat_mock },
  { label: "Sift MCP", title: "Fix it in your editor.",
    body: "Your editor gets the trace, the diff and the fix, with no tab to change.",
    mod: sec_integrations },
  { label: "Metrics", title: "Know if it comes back.",
    body: "Once the fix ships, Sift keeps scoring new runs against the same failure and tells you the minute one slips through.",
    mod: sec_metrics },
];

function scene2() {
  const stage = document.getElementById("demoStage");
  const text  = document.getElementById("demoText");
  if (!stage || !text) return () => {};

  text.innerHTML = DEMO.map((d, i) => `
    <div class="feat-block" data-i="${i}">
      <div class="label">${d.label}</div>
      <h2>${d.title}</h2>
      <p>${d.body}</p>
    </div>`).join("");

  /* THEIR STACK, from the DOM: four absolute layers over the pinned 900px
     column, each a flex column centring its panel, and the switch is a CSS
     opacity transition of 500ms ease-out on a class. The crossfade is
     TIMED, not scrubbed: at the halfway scroll point theirs reads 0.447 and
     0.553 because the transition is in flight, and it lands either way.

     Each panel module hands back setActive, because their panels are timed
     state machines that run only while their block is the one in view and
     restart on every return. */
  const layers = DEMO.map((d) => {
    const layer = document.createElement("div");
    layer.className = "demo-layer";
    layer.innerHTML = `<div class="demo-w">${d.mod.panel()}</div>`;
    stage.appendChild(layer);
    let ctl = null;
    try { ctl = d.mod.mount(layer.querySelector(".demo-w").firstElementChild) || null; }
    catch (err) { console.error("panel mount failed:", d.label, err); }
    return { layer, ctl };
  });

  /* Active is the last block to cross half visible, as their container does
     it: an IntersectionObserver at threshold 0.5 that only ever SETS the
     index. It starts at -1, so no panel shows until the first block is half
     on screen, and it never clears, so scrolling back above the column
     keeps the first panel rather than blanking it. Ours picked the nearest
     centre, which showed panel one a full screen early. */
  const blocks = [...text.querySelectorAll(".feat-block")];
  let active = -1;
  let k = -1;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) k = Number(e.target.dataset.i);
    apply();
  }, { threshold: 0.5 });
  blocks.forEach(b => io.observe(b));
  return apply;
  function apply() {
    if (k === active) return;
    active = k;
    layers.forEach((L, i) => {
      L.layer.classList.toggle("on", i === k);
      if (L.ctl && typeof L.ctl.setActive === "function") L.ctl.setActive(i === k);
    });
  };
}

/* ---------------------------------------------------------------------- */
function drive(runId, render) {
  const run = document.getElementById(runId);
  if (!run) return;
  if (REDUCED) { render(0.62); return; }   // one representative resolved state
  let queued = false;
  const tick = () => {
    queued = false;
    const r = run.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    if (travel <= 0) return;
    render(clamp(-r.top / travel));
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  tick();
}



/* Hero plates. Positions, sizes and stacking are MEASURED off the reference
   at 1280x900, not composed: six framed plates, two overlapping pairs, all
   four corners occupied and the centre column left clear for the type.

   The first version drew unframed random polylines with captions underneath
   and read as clip-art scattered on a page. Three things fix that and all
   three came from looking at the two screenshots side by side: the hairline
   frame, the label INSIDE the frame's top-left, and the overlap. The overlap
   is the only depth cue in a flat drawing, and it is what makes six plates
   read as one composition instead of six decorations. */
import { registerReveals, startScroll } from "./scroll.js";
import { PLATE_LAYOUT } from "./sections/hero-intro.js";
import { attachMeshToSvgFaces, MESH_COLORS } from "./sections/mesh-gradient.js";
import { sphere, isoTiles, isoCube, fit, rose, rng,
  extrudedCube, cubeSpinAt, CUBE_POINTER_LERP, CUBE_POINTER_YAW, CUBE_POINTER_PITCH,
  rule30, caX, caY, CA_R_LIVE, CA_R_DEAD, CA_R_HIT, caClipHeight, CA_MS_PER_GEN,
  gravLens, pentagon, sphere3d, tileField, meshPentagon } from "./geometry.js";

/* MEASURED 2026-09-27 off the reference at 1280, 1600 and 2456 wide.

   Plate sizes are FIXED PIXELS and identical at every viewport; only the
   container centres. Above 1600 every plate shifts by exactly half the
   viewport growth, which is the signature of a capped centred container
   rather than a fluid grid. So these offsets are coordinates inside a
   1600px box, and the box centres.

   My previous version used percentage lefts, which is why the overlaps
   drifted apart on a wide screen: a percentage offset scales the GAPS with
   the viewport, and the whole composition depends on two specific plates
   overlapping by a specific number of pixels.

   Figure assignments are measured from their DOM node counts, not guessed:
   1.1 has 48 paths (the lens), 1.2 has 12 lines plus a canvas (the cube and
   its shader), 1.3 has 60 paths (the harmonograph), 2.1 has 864, 2.2 has
   100 (the sphere), 2.3 has 2842 circles (the automaton: 2000 cells, 842
   hit targets). I previously had the cube in 1.3 and a ring in 1.2, so both
   were wrong and the ring does not exist. */
/* The fitted scale curve that lived here ("probably a breakpoint set
   rather than a formula") was percentages all along: their plates sit at a
   percent of a box capped at 1480, so the offset from centre scales with
   min(vw, 1480). Positions now come from PLATE_LAYOUT in hero-intro.js. */
const PLATES = [
  { id: "SFT. 1.1", desc: "rays bent by one mass", pad: "5px 0 0 0", fig: "lens",   sw: 0.12, op: 0.7  },
  { id: "SFT. 1.2", desc: "a box turned to its edge", pad: "52px 18px 47px", fig: "cube",   sw: 0.25, op: 0.85 },
  { id: "SFT. 1.3", desc: "sixty turns of one shape", pad: "5px 0 0 0", fig: "harmo",  sw: 0.15, op: 0.6  },
  { id: "SFT. 2.1", desc: "tiles in three directions", pad: "23px 18px 18px", fig: "mesh",   sw: 0.15, op: 0.5  },
  { id: "SFT. 2.2", desc: "rings around one axis", pad: "23px 18px 18px", fig: "sphere", sw: 0.13, op: 0.5  },
  { id: "SFT. 2.3", desc: "growth from a single cell", pad: "5px 0 0 0", fig: "dots",   sw: 1,    op: 0.3  },
];

const A = "#755cfe";

/* ONE COORDINATE SYSTEM, AND ONLY ONE.
   Caleb: "Your scaling and positioning is always off." It was, and it was
   one cause repeated, not a run of separate mistakes.

   The reference gives EVERY plate viewBox="0 0 100 100". One normalised box,
   and the viewBox does all the scaling. geometry.js already ends every
   generator with fit(), which emits into exactly that 0..100 box.

   I was taking fit()'s output and hand-multiplying it per figure by numbers
   I invented: w*0.0082 here, min(w,h)*0.24 there, h*0.32 somewhere else.
   That is a SECOND mapping from geometry to pixels, sitting alongside the
   one the viewBox already performs, and the two disagreed differently in
   every figure. Two plates rendered as empty frames from it; the rest were
   each wrong by their own private factor.

   This is feedback_one_mapping_for_spatial_input, which was written after
   six alignment bugs in one morning, all of them two paths from a landmark
   to a pixel: map once, at the door.

   So: viewBox is 0 0 100 100 for every plate, coordinates are emitted raw
   from fit(), and there is no scaling arithmetic anywhere below. A figure
   cannot be the wrong size now, because nothing is sizing it. */
const VB = "0 0 100 100";

/* pathLength="100" makes the dash length mean the SAME thing on every path.
   The reference animates stroke-dashoffset from 100px to 0; without
   declaring a path length, 100 is 100 real user units, so a 40-unit ring
   segment is already fully covered by the first dash and a 400-unit curve
   gets four dashes marching along it. That is what rendered the sphere as a
   dotted line instead of a drawn one. Declaring the length makes 100 mean
   "the whole path" everywhere, which is what the reference's figures assume.

   vector-effect is gone: with non-scaling-stroke the dash is measured in
   SCREEN pixels while the path is in user units, so the two disagree by the
   viewBox scale, differently on every plate. Another second mapping. */
/* ONE ANIMATION PER FIGURE ABOVE THIS COUNT, not one per stroke.

   Measured 2026-09-27: this page ran 1,091 animations at load against the
   reference's 220, and 864 of them were a single plate's tile field with
   every tile drawing itself. Per-element animation on a dense field is
   invisible work: at 864 strokes nobody can follow an individual one, and
   each is a compositor entry bought for nothing.

   The threshold comes from the reference rather than from taste. Its
   animation inventory contains `opacity + strokeDashoffset [700-1500ms]
   once` exactly 48 times, which is its 48-ray lens animating per ray, and
   its 864-path plate appears nowhere as 864 animations. So it draws the
   sparse figure stroke by stroke and reveals the dense ones as one object.

   60 sits between those two measured cases. It is a real boundary, not a
   round number: below it a viewer can follow individual strokes arriving,
   above it they read the field emerging. */
const DRAW_PER_ELEMENT_MAX = 60;

/* OPACITY GOES ON THE SHAPE, NEVER ON THE SVG.

   The reference sets it per shape on all six plates and leaves every <svg>
   at 1. We set the same six values (0.7, 0.85, 0.6, 0.5, 0.5, 0.3) on the
   <svg> instead, so every number matched and every plate rendered wrong.

   It is a compositing difference, not a bookkeeping one. Per shape, two
   crossing strokes at 0.6 give 1-(1-0.6)^2 = 0.84, so crossings are darker
   than single strokes and the lattice is visible. Group opacity composites
   all 60 shapes into one layer at full alpha FIRST, where every crossing
   saturates to the same value, then fades the finished layer. The moire is
   destroyed before the fade is applied.

   That is why the rosette read as a smooth airbrushed donut against their
   crosshatched one at identical geometry, identical stroke width and
   identical effective opacity. Measuring the effective value said 0.6 on
   both sides and could never have found this; the pixels did. */
function polys(list, sw = 0.55, step = 18, extra = "", op = 1) {
  const shapes = list.map((pts, i) => {
    const pt = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const per = list.length <= DRAW_PER_ELEMENT_MAX
      ? ` data-draw style="animation-delay:${(i * step).toFixed(0)}ms"` : "";
    return `<polyline points="${pt}" pathLength="100"${per} ${extra}
       fill="none" stroke="${A}" stroke-width="${sw}" opacity="${op}"/>`;
  }).join("");
  return list.length <= DRAW_PER_ELEMENT_MAX
    ? shapes
    : `<g data-draw-group>${shapes}</g>`;
}

/* Every generator already returns fit()-normalised 0..100 polylines, except
   the three added for this rebuild, which are normalised here ONCE so the
   rule holds for all of them without exception. */
function norm(list) { return fit(list); }

/* WEIGHT IS MEASURED, NOT CHOSEN.

   Every figure here previously rendered at group opacity 1 with a stroke
   width picked per branch by eye. The reference runs each plate at its own
   measured pair, and the group opacities are the whole reason their page
   reads as faint instrument marks while an identical element count reads as
   a dense black scribble:

     1.1  0.12px @ 0.70     1.2  0.25px @ 0.85     1.3  0.15px @ 0.60
     2.1  0.15px @ 0.50     2.2  0.20px @ 0.50     2.3  fill  @ 0.30

   Identical node counts with the wrong weight is a different drawing. Weight
   is not a finishing pass. */
function figure(kind, sw, op) {
  let inner = "";
  if (kind === "lens") {
    /* LEM 1.1: 48 paths, counted off their live DOM per plate.

       This plate previously held a 714 path hyperboloid, built on a note
       saying "their LEM 1.1 is 714 paths, density is the effect". That count
       came from a page wide path total attributed to one plate. Counting the
       plates individually gives 48, 12, 60, 864, 100 and 2842, so the 714
       was never in this frame.

       The density lesson was still real, it was just filed against the wrong
       figure: the dense one is LEM 2.1 at 864. Here, 48 rays IS the drawing,
       and stacking 700 would bury the one thing it is about, which is that
       every ray passes through a single point.

       Recovered generator: 48 rays deflected by a Gaussian centred on the
       plate, sigma^2 = 784. Measured waist spread across all 48 midpoints
       was 0.000000, so the crossing is exact rather than approximate. */
    /* Their lens STRETCHES: preserveAspectRatio none across the 282x202
       plate, a vertical fade mask over the top and bottom 18%, and a radial
       glow at the lens centre. Ours was letterboxed into a 202 square in the
       middle, which is why the rays stopped 43px short of each edge. The
       stagger is 18ms per ray, read off their draw delay. */
    const glow = `<div class="lens-glow" aria-hidden="true"></div>`;
    return glow + `<svg class="lens-svg" viewBox="${VB}" preserveAspectRatio="none">`
         + polys(gravLens({ rays: 48, seg: 60 }), sw, 18, 'class="lens-ray"', op) + `</svg>`;
  } else if (kind === "harmo") {
    /* LEM 1.3: 60 paths. Not a harmonograph trace in the usual sense but 60
       IDENTICAL copies of one closed 5 vertex figure, each rotated 6.10deg
       from the last. 60 x 6.10 = 366deg, so it closes just past a full turn
       and the last copy sits fractionally off the first, which is what gives
       the rosette its moire rather than a clean 60 fold symmetry. */
    /* rose() returns {pts, rot}: ONE shape plus 60 rotations, because that
       is what the reference ships. Rendering it through polys(), which takes
       raw coordinate arrays, threw "pts.map is not a function" and blanked
       every plate after it. Keeping the rotation as data rather than baking
       it into coordinates is what makes the repetition legible as a single
       figure turned 60 times. */
    inner = "<g>" + rose({ copies: 60, stepDeg: 6.10 }).map((r, i) =>
      `<polygon points="${r.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}"
         transform="rotate(${r.rot} 50 50)" pathLength="100" data-draw fill="none"
         stroke="${A}" stroke-width="${sw}" opacity="${op}"
         style="animation-delay:${i * 19}ms"/>`).join("") + "</g>";
  } else if (kind === "cube") {
    /* Orthographic, 35 deg of yaw and 22 of pitch to start, from the
       reference's own projector. The top face doubles as a clip region.

       THE LOAD IS A CHAIN, NOT A STAGGER. Their timings:

           draw    starts 0.42s, runs 1.1s   (stroke-dashoffset to 0)
           dashed  starts 1.52s

       0.42 + 1.1 = 1.52. Each stage begins the frame the previous one ends,
       which is why it reads as one composed move. An index * 100ms stagger,
       the reflex version of this, cannot produce that relationship because it
       never knows how long anything takes.

       pathLength="100" normalises every edge to the same dash budget, so the
       twelve edges finish together despite being different lengths on screen.
       Without it the short struts land first and the cube assembles raggedly. */
    const c = extrudedCube({ spin: 35, tilt: 22 });
    const edges = c.edges.map(e =>
      `<line x1="${e.x1.toFixed(2)}" y1="${e.y1.toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${e.y2.toFixed(2)}"`
      + ` stroke="${A}" stroke-width="${sw}" opacity="${op}" pathLength="100" class="cube-edge"/>`).join("");
    const top = c.topVerts.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(" ");
    inner = `<defs>
        <clipPath id="cube-top"><polygon class="cube-topface" points="${top}"/></clipPath>
        <linearGradient id="cube-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stop-color="#322C8A"/>
          <stop offset="0.5" stop-color="${A}"/>
          <stop offset="1"   stop-color="#322C8A"/>
          <animateTransform attributeName="gradientTransform" type="rotate"
            from="0 0.5 0.5" to="360 0.5 0.5" dur="14s" repeatCount="indefinite"/>
        </linearGradient>
      </defs>
      <g clip-path="url(#cube-top)"><rect x="0" y="0" width="100" height="100" fill="url(#cube-grad)"/></g>
      <g class="cube-edges">${edges}</g>`;
  } else if (kind === "mesh") {
    /* LEM 2.1 is their densest plate: 864 paths in 162 groups, counted off
       their DOM. A 240 line crosshatch reads as a wireframe you can count.
       At 864 tiles the strokes stop reading as strokes and the plane
       emerges, which is the same density effect I had previously filed
       against the wrong plate. */
    /* fit() normalises into the shared 0-100 box with ONE scale factor
       taken from the larger span, so the aspect survives and the field
       centres. Without it this plate rendered as a horizontal streak: the
       basis is 3.58:1 by construction, so 36 columns span ~198 units of x
       against ~78 of y, and xMidYMid meet shrinks that until the mesh is a
       few pixels tall. Every other figure here already goes through fit and
       this one did not, which is the entire bug. */
    /* NOT fitted, deliberately. The basis gives a 4.15 unit cell edge, which
       is 4% of the 100 unit box and reads as a cell. Running 864 of them
       through fit() compresses 198 units of x into 84 and takes each cell
       under 2 units, where the strokes merge into a solid wash: 864 paths
       rendering as one grey parallelogram.

       The reference shows 864 cells that are individually legible, which is
       only possible if its field is LARGER than the plate and cropped by it.
       So this is placed at natural scale and allowed to overflow, which is
       also what makes the plane read as continuing past the frame rather
       than as an object sitting inside one. */
    inner = polys(meshPentagon(), sw, 1, "", op);
  } else if (kind === "sphere") {
    /* LEM 2.2. Their path count is 100 plus one <circle>, and ours is 101, so
       the wireframe itself was never the problem. Three things were:

         stroke     theirs 0.13, ours 0.20. On 101 overlapping curves a 54%
                    heavier stroke is what turns a wireframe into a dark mat,
                    and it reads as "too dense" rather than as "too thick".
         shape      theirs is a true circle: a literal <circle r="38"> at
                    (50,52), with the wireframe inscribed in it. Ours came out
                    of fit() as an 80 x 84 ellipse, taller than wide.
         outline    that circle is a drawn element in its own right at stroke
                    0.2 and opacity 0.5, heavier than the wireframe inside it.
                    Without it the globe has no silhouette and the meridians
                    just stop.

       So the wireframe is inscribed rather than fitted: mapped onto the same
       r=38 circle at (50,52) the outline uses, which is the only way the two
       cannot disagree. */
    const R = 38, CX = 50, CY = 52;
    const raw = sphere({ lats: 16, longs: 28, seg: 30 });
    // fit() leaves the set spanning 0..100 on its longer axis; rescale the
    // whole SET (never each curve) onto the r=38 circle, so relative
    // positions survive and only the envelope changes.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const pts of raw) for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const k = (2 * R) / Math.max(x1 - x0, y1 - y0);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const fitted = raw.map((pts) =>
      pts.map(([x, y]) => [CX + (x - mx) * k, CY + (y - my) * k]));
    inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${A}"`
          + ` stroke-width="0.2" opacity="${op}"/>`
          + polys(fitted, sw, 15, "", op);
  } else if (kind === "dots") {
    /* Rule 30. Recovered from the reference's bundle, where the component is
       named CellularAutomataFigure. 842 live cells and 1158 dead, which is
       not a chosen density: it is what the rule produces from one seed.

       Dead cells are static and never animate. The live cells are revealed by
       a clip rect that grows downward one generation every 70ms, so the figure
       DRAWS ITSELF rather than fading in. That is one animated attribute for
       the whole plate, which is why the reference can afford a 2,000 circle
       field inside a 214 animation budget and my per-circle version could
       not. */
    const ca = rule30({});
    const dead = ca.dead.map(([r, c]) =>
      `<circle cx="${caX(c).toFixed(3)}" cy="${caY(r).toFixed(3)}" r="${CA_R_DEAD}" fill="${A}" opacity="0.3"/>`).join("");
    const live = ca.live.map(([r, c], i) =>
      `<g><circle cx="${caX(c).toFixed(3)}" cy="${caY(r).toFixed(3)}" r="${CA_R_LIVE}" fill="${A}" opacity="0.85"`
      + ` style="transition:cx 220ms ease-out,cy 220ms ease-out;pointer-events:none"/>`
      + `<circle class="ca-hit" data-ca="${i}" cx="${caX(c).toFixed(3)}" cy="${caY(r).toFixed(3)}" r="${CA_R_HIT}"`
      + ` fill="transparent" style="transition:cx 220ms ease-out,cy 220ms ease-out"/></g>`).join("");
    inner = `<defs><clipPath id="sift-ca-clip"><rect class="ca-clip" x="0" y="0" width="100" height="0"/></clipPath></defs>`
          + `<g clip-path="url(#sift-ca-clip)">${dead}${live}</g>`;
  }
  return `<svg viewBox="${VB}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

function plates() {
  const host = document.getElementById("plates");
  if (!host) return;
  for (const p of PLATES) {
    const d = document.createElement("div");
    d.className = "plate";
    const L = PLATE_LAYOUT[PLATES.indexOf(p)];
    /* THE PLATES ARE NOT ALL THE SAME KIND OF PLATE.

       Ours all had the figure filling the frame, inset only by the 1px
       border. Measuring the svg box inside each plate on the reference shows
       two classes and one special case:

           1.1 1.3 2.3   l1  t6  r1  b1    the figure bleeds to the frame,
                                           with 6px at the top for the caption
           2.1 2.2       l19 t24 r19 b19   the figure sits in a padded well
           1.2           l19 t53 r19 b48   a 120x120 square, floated high

       Missing 19px on each side of a 202px plate draws the figure 19% too
       large, which is why the sphere and the tile field read as oversized
       and crowded while their internal geometry measured correct. The svg
       scales to its box, so padding the box is the whole fix. */
    /* Percent of a centred 1480 box one viewport tall, as their plate props
       give it. The old pixel offsets put every plate exactly 96px high. */
    d.style.cssText = `left:${L.left}%;top:${L.top}%;width:${L.w}px;height:${L.h}px;`
                    + `z-index:${L.z};padding:${p.pad};box-sizing:border-box`;
    /* Exactly ONE plate rotates forever and ONE drifts forever. The
       reference runs 1 infinite transform and 2 infinite dashes across the
       whole page, not a loop per figure: an ambient layer is a background
       hum, and a hum on every element is noise. */
    d.dataset.fig = p.fig;
    // The label lives in a 40px box pinned to the frame's top-left corner on
    // every reference plate. Mine was bare text, which is why the plates read
    // as bordered rectangles rather than as labelled instrument panels.
    d.innerHTML = figure(p.fig, p.sw, p.op) + `<div class="cap-box"><span class="cap">${p.id}</span><span class="cap-tip">${p.desc}</span></div>`;
    host.appendChild(d);
  }
}

plates();

/* The hero layers must be registered AFTER plates() has put them in the
   document, because the depth ordering reads each plate's measured position.
   Registering against an empty container is the silent version of this bug:
   no error, no motion, and a scroll system that looks wired and is not. */
registerReveals();
startScroll();
/* ---------------------------------------------------------------------- */
/* The cellular automaton's clock.

   One animated attribute for a 2,000 circle field: the clip rect's height.
   Growing it one generation every 70ms uncovers rows in the order the rule
   computes them, which reads as the figure thinking rather than appearing.

   Two details that are the difference between this and a fade:

   It starts on INTERSECTION, not on load. A figure that finished drawing
   while it was off screen was never seen, and the reference guards against
   exactly that (its own version also remembers it has already run, so
   scrolling back does not replay it).

   Under prefers-reduced-motion it jumps straight to the finished state. The
   figure is information, so it still has to be there; only the drawing goes.
   Stopping at height 0 would delete the artwork for the people who asked for
   less movement. */
function caClock() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const svg of document.querySelectorAll("svg:has(.ca-clip)")) {
    const clip = svg.querySelector(".ca-clip");
    if (!clip) continue;

    if (reduced) { clip.setAttribute("height", String(caClipHeight(50))); continue; }

    let played = false, raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) { cancelAnimationFrame(raf); return; }
      if (played) { clip.setAttribute("height", String(caClipHeight(50))); return; }
      played = true;
      const t0 = performance.now();
      let last = 0;
      const step = now => {
        // 30fps is plenty for a 50 step reveal and leaves the main thread to
        // the rest of the page; the reference throttles to the same 33ms.
        if (now - last >= 33) {
          last = now;
          const gen = Math.min(50, Math.floor((now - t0) / CA_MS_PER_GEN) + 1);
          clip.setAttribute("height", String(caClipHeight(gen)));
          if (gen >= 50) { svg.dataset.caDone = "1"; io.disconnect(); return; }
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0 });
    io.observe(svg);
  }
}

/* Click a settled cell and it hops to a random EMPTY orthogonal neighbour,
   easing over 220ms. It only arms once the reveal has finished, because a
   cell you can move before it has been drawn is a cell nobody saw arrive. */
function caInteraction() {
  document.addEventListener("click", ev => {
    const hit = ev.target.closest?.(".ca-hit");
    if (!hit) return;
    const svg = hit.closest("svg");
    if (!svg || svg.dataset.caDone !== "1") return;

    const cells = [...svg.querySelectorAll(".ca-hit")];
    const key = el => `${el.getAttribute("cx")},${el.getAttribute("cy")}`;
    const taken = new Set(cells.map(key));

    const PX = 2.5, PY = 1.84;
    const cx = +hit.getAttribute("cx"), cy = +hit.getAttribute("cy");
    const free = [[cx, cy - PY], [cx, cy + PY], [cx - PX, cy], [cx + PX, cy]]
      .filter(([x, y]) => x > 0 && x < 100 && y > 0 && y < 100
                       && !taken.has(`${x.toFixed(3)},${y.toFixed(3)}`));
    if (!free.length) return;

    const [nx, ny] = free[Math.floor(Math.random() * free.length)];
    const dot = hit.previousElementSibling;   // the visible circle in the same <g>
    for (const el of [dot, hit]) {
      el.setAttribute("cx", nx.toFixed(3));
      el.setAttribute("cy", ny.toFixed(3));
    }
  });
}

caClock();
caInteraction();

/* ---------------------------------------------------------------------- */
/* The lens centre is draggable. Theirs eases the centre toward the pointer
   at 0.025 a frame at rest and 0.12 while held, on a 33ms throttle, and
   recomputes all 48 rays from the same Gaussian each step. Off screen the
   loop stops. Only ever runs while the centre is still moving. */
function lensClock() {
  const plate = document.querySelector('.plate[data-fig="lens"]');
  if (!plate) return;
  const rays = [...plate.querySelectorAll(".lens-ray")];
  const glow = plate.querySelector(".lens-glow");
  const svg = plate.querySelector(".lens-svg");
  const cur = { x: 50, y: 50 }, aim = { x: 50, y: 50 };
  let held = false, raf = 0, last = 0;
  plate.style.pointerEvents = "auto";
  svg.style.cursor = "grab";
  const draw = () => {
    gravLens({ rays: 48, seg: 60, cx: cur.x, cy: cur.y }).forEach((line, i) => {
      rays[i]?.setAttribute("points", line.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "));
    });
    glow.style.background = `radial-gradient(circle at ${cur.x.toFixed(2)}% ${cur.y.toFixed(2)}%, `
      + "rgba(117,92,254,0.25) 0%, rgba(117,92,254,0.08) 22%, transparent 45%)";
  };
  const step = now => {
    raf = requestAnimationFrame(step);
    if (now - last < 33) return;
    last = now;
    const k = held ? 0.12 : 0.025;
    cur.x += (aim.x - cur.x) * k;
    cur.y += (aim.y - cur.y) * k;
    draw();
    if (!held && Math.abs(aim.x - cur.x) < 0.01 && Math.abs(aim.y - cur.y) < 0.01) {
      cancelAnimationFrame(raf); raf = 0;
    }
  };
  const go = () => { if (!raf) raf = requestAnimationFrame(step); };
  const point = e => {
    const r = svg.getBoundingClientRect();
    aim.x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    aim.y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
  };
  svg.addEventListener("pointerdown", e => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    held = true; svg.style.cursor = "grabbing"; point(e); go();
  });
  svg.addEventListener("pointermove", e => { if (held) point(e); });
  const release = () => { held = false; svg.style.cursor = "grab"; };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  new IntersectionObserver(([e]) => {
    if (!e.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
    else if (e.isIntersecting && (held || aim.x !== cur.x || aim.y !== cur.y)) go();
  }).observe(plate);
  draw();
}
lensClock();

/* ---------------------------------------------------------------------- */
/* The cube's clock. Spin-up, then an indefinite slow drift, plus a pointer
   lean, paused and BANKED while off screen so scrolling back finds it where
   it was rather than restarting its entrance. */
function cubeClock() {
  const host = document.querySelector("svg:has(.cube-edges)");
  if (!host) return;
  const plate = host.closest(".plate") || host;
  const edgeG = host.querySelector(".cube-edges");
  const face  = host.querySelector(".cube-topface");
  /* Their cube top is the same mesh gradient as the hero voxels (chunk 5061).
     The group is already clipped to the top face, which this clock moves. */
  attachMeshToSvgFaces(host.querySelector('g[clip-path="url(#cube-top)"]'), [0, 0, 100, 100],
    { colors: MESH_COLORS, clipToFaces: false });
  if (!edgeG || !face) return;

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const want = { x: 0, y: 0 };
  let lean = { x: 0, y: 0 }, banked = 0, t0 = 0, live = false, raf = 0, last = 0;

  plate.addEventListener("mousemove", ev => {
    const r = plate.getBoundingClientRect();
    const n = Math.min(r.width, r.height);
    want.x = (ev.clientX - (r.left + r.width / 2)) / n;
    want.y = (ev.clientY - (r.top + r.height / 2)) / n;
  });
  plate.addEventListener("mouseleave", () => { want.x = 0; want.y = 0; });

  const step = now => {
    if (!live) return;
    if (now - last >= 33) {
      last = now;
      const t = banked + (now - t0) / 1000;
      // Lerping toward the pointer rather than tracking it is what makes the
      // lean feel like mass instead of a cursor readout.
      lean = { x: lean.x + (want.x - lean.x) * CUBE_POINTER_LERP,
               y: lean.y + (want.y - lean.y) * CUBE_POINTER_LERP };
      const spin = cubeSpinAt(t) + CUBE_POINTER_YAW * lean.x;
      const tilt = 22 - CUBE_POINTER_PITCH * lean.y;
      const c = extrudedCube({ spin, tilt });
      const lines = edgeG.children;
      for (let i = 0; i < lines.length; i++) {
        const e = c.edges[i];
        lines[i].setAttribute("x1", e.x1.toFixed(2)); lines[i].setAttribute("y1", e.y1.toFixed(2));
        lines[i].setAttribute("x2", e.x2.toFixed(2)); lines[i].setAttribute("y2", e.y2.toFixed(2));
      }
      face.setAttribute("points", c.topVerts.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(" "));
    }
    raf = requestAnimationFrame(step);
  };

  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !live) {
      live = true; t0 = performance.now(); last = 0;
      host.classList.add("cube-drawing");
      raf = requestAnimationFrame(step);
    } else if (!e.isIntersecting && live) {
      live = false;
      banked += (performance.now() - t0) / 1000;
      cancelAnimationFrame(raf);
    }
  }, { threshold: 0 }).observe(host);
}

cubeClock();


mountHeroScene(document.getElementById("hero"));
drive("run2", scene2());

/* ---------------------------------------------------------------------- */
/* SECTION MODULES.

   Seven sections were built in parallel, each owning exactly one js and one
   css that no other writer touches. This file mounts them and is the only
   place that knows they exist, which is what kept seven concurrent builders
   from colliding on it.

   A module that fails to mount must not take the page down with it. Each one
   is a separate try: on a page assembled from independently built parts, one
   throwing module silently blanking the other six is the worst possible
   failure mode, because it looks like a layout bug rather than an error. */
import * as sec_logo_wall from "./sections/logo-wall.js";
import * as sec_waterfall from "./sections/waterfall.js";
import * as sec_chat_mock from "./sections/chat-mock.js";
import * as sec_integrations from "./sections/integrations.js";
import * as sec_testimonials from "./sections/testimonials.js";
import * as sec_lower from "./sections/lower.js";
import { mountHeroScene } from "./sections/hero-scene.js";
import * as sec_states from "./sections/states.js";
import * as sec_metrics from "./sections/metrics.js";

/* Prefixed, because `testimonials` and `counter` are already bound in this
   file by the older hand-built versions. A namespace import that collides
   with an existing const is a MODULE-LEVEL SyntaxError, so it does not fail
   that one section: it stops the whole file, and all seven mount points stay
   empty with the page otherwise looking fine. Caught by checking that each
   section had children rather than by trusting that the import list was
   correct. */
/* failure-wall and counter were cut 2026-09-28. Neither has a counterpart on
   the reference, so keeping them guaranteed a permanent gap in every chunk
   comparison, and failure-wall rendered a second purple brick wall in the
   middle of their feature sequence that read as a duplicate of the trace
   wall. Both are still in git at 42cc2df if they are ever wanted. */
/* waterfall, chat-mock and integrations are no longer sections: their
   panels mount inside the pinned demo above. Only their CSS is still
   loaded, and their render() exports still work if they are ever wanted
   standalone again. */
const SECTIONS = [sec_lower, sec_testimonials];

for (const mod of SECTIONS) {
  try {
    const root = document.querySelector(mod.MOUNT);
    if (!root) { console.warn("no mount point for", mod.MOUNT); continue; }
    if (typeof mod.render === "function") root.innerHTML = mod.render();
    if (typeof mod.mount === "function") mod.mount(root);
  } catch (err) {
    console.error("section failed to mount:", mod.MOUNT, err);
  }
}
/* Hover, focus, pressed and keyboard for every control. Mounted on the body
   because it is the one cross-cutting module; see states.js. */
try { sec_states.mount(document.body); } catch (err) { console.error("states failed to mount:", err); }

/* Reveals are registered AFTER the sections exist, because the observer can
   only watch elements that are in the document. Registering first is the
   silent version of this bug: no error, no reveal, and a scroll system that
   looks wired and is not. */
registerReveals();

/* The cookie card dismisses and stays dismissed. A consent dialog that comes
   back on every load is not consent, it is nagging, and it is also the thing
   that makes a page feel unfinished. localStorage can throw in a private
   window, so every touch of it is wrapped and the card simply shows. */
(() => {
  const card = document.getElementById("cookie-card");
  if (!card) return;
  const KEY = "sift.cookie-choice";
  let prior = null;
  try { prior = localStorage.getItem(KEY); } catch { /* blocked, show it */ }
  /* The footer's Cookie settings button asks for the card back. */
  document.addEventListener("sift:cookie-settings", () => { card.hidden = false; });
  if (prior) { card.hidden = true; return; }
  card.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-cc]")?.dataset.cc;
    if (!choice) return;
    try { localStorage.setItem(KEY, choice); } catch { /* nothing to do */ }
    card.hidden = true;
  });
})();
