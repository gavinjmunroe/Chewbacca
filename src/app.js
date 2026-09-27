/* Lemma replica: the two pinned scene machines.

   The reference is 17,852px tall and 81% of it is pinned: a sticky child in a
   parent twelve viewports tall for the geometric narrative, and another four
   viewports tall for the product demo. Scroll holds the screen still and
   changes what is in it. No amount of reveal-on-scroll reaches that shape.

   THE RULE THAT SHAPES ALL OF SCENE 1, from a direct browser study of the
   reference on 2026-09-22: it makes loss of detail, shrinking, tilting,
   redistribution and ground reveal legible as SEPARATE STAGES. The previous
   replica treated card-to-plane as one interpolation and read as a single
   tween because of it. So every property here gets its OWN overlapping
   interval and its own curve, and none of them share one master easing.

   The 42 cells are created once and never destroyed. Their identity is the
   story: the same rectangle that carried a failure label becomes the square,
   the diamond, and the projected tile. Fading one set out and another in
   would be easier and would break the only thing the sequence is saying. */

const CELLS = 42;                    // measured on the reference: 42 rects held
const COLS = 7, ROWS = 6;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const NS = "http://www.w3.org/2000/svg";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/* Progress inside one stage's own window. Stages deliberately overlap. */
const seg = (p, a, b) => clamp((p - a) / (b - a));
/* Distinct curves, because a shared curve is what makes stages read as one
   move. ease is for travel, snap for a state change, linear for a draw. */
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const snap = t => 1 - Math.pow(1 - t, 4);
const lerp = (a, b, t) => a + (b - a) * t;

const el = (n, attrs = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

/* The failure copy that appears inside expanded cells in stage 2. Taken from
   the reference's own vocabulary rather than invented, so the stage reads as
   a real product surface. */
const FAILURES = [
  "fabricated lookup", "orphaned ticket", "escalation to nobody",
  "refund outside policy", "customerId: unknown", "placeholder identifier",
];

/* ---------------------------------------------------------------------- */
/* SCENE 1                                                                 */
/* ---------------------------------------------------------------------- */
function scene1(host) {
  const svg = el("svg", { viewBox: "0 0 1200 700", width: "100%", height: "100%",
                          preserveAspectRatio: "xMidYMid meet" });
  host.appendChild(svg);

  const gLat = el("g", { opacity: "0" });          // ground lattice, under all
  const gCells = el("g");
  const gWave = el("g", { opacity: "0" });         // the cube wave
  const gMark = el("g", { opacity: "0" });         // the purple mark
  svg.append(gLat, gCells, gWave, gMark);

  /* GROUND: a fine lattice plus tiles that CLUSTER.
     Two scales, because the reference has both, and the clustering is the
     part that reads as organic. My first field drew each cell independently
     and came out perfectly even, every tile isolated. Theirs has pairs and
     triples sitting adjacent with gaps between them.

     Independent draws cannot clump, at any density. Value noise correlates
     each cell with its neighbours, so thresholding it yields connected
     blobs: measured 93% of tiles touching another against 36% for
     independent draws at identical density. That single change is the whole
     difference between random and organic. */
  const PX = (u, v) => [600 + (u - v) * 26, 430 + (u + v) * 13];
  const field = tileField({ cols: 54, rows: 40, fill: 0.055, scale: 0.22 });
  for (const [u, v] of field.cells) {
    const p0 = PX(u, v), p1 = PX(u + 1, v), p2 = PX(u + 1, v + 1), p3 = PX(u, v + 1);
    /* Fade with distance from centre so the plane reads as extending rather
       than as a rectangle that stops. */
    const d = Math.hypot(u, v) / 34;
    gLat.appendChild(el("polygon", {
      points: [p0, p1, p2, p3].map(q => q.map(n => n.toFixed(1)).join(",")).join(" "),
      fill: "none", stroke: "#755cfe", "stroke-width": "0.35",
      opacity: (0.22 * Math.max(0, 1 - d)).toFixed(3) }));
  }
  for (const [u, v] of field.tiles) {
    const p0 = PX(u, v), p1 = PX(u + 1, v), p2 = PX(u + 1, v + 1), p3 = PX(u, v + 1);
    const d = Math.hypot(u, v) / 34;
    gLat.appendChild(el("polygon", {
      points: [p0, p1, p2, p3].map(q => q.map(n => n.toFixed(1)).join(",")).join(" "),
      fill: "#755cfe", "fill-opacity": (0.18 * Math.max(0, 1 - d)).toFixed(3),
      stroke: "#755cfe", "stroke-width": "0.7",
      opacity: (0.9 * Math.max(0, 1 - d)).toFixed(3) }));
  }

  /* Cells. Home = the card grid. Every later position is derived from the
     same index, so correspondence is structural and never re-solved. */
  /* THE GRID, READ OFF THE REFERENCE RATHER THAN GENERATED.

     Two wrong versions preceded this. First a rigid 7x6 lattice of identical
     132x74 cells with `fails: i % 4 === 1`. Then, correcting that, a seeded
     random masonry: widths drawn from 96..208 and rows packed to a flush
     edge. The second was a better guess and still a guess.

     Measuring their 42 bricks at the solid stage gives the actual thing, and
     it is neither uniform nor random:

         7 rows of 6, height 62, row pitch 70, gaps 7 to 8
         FOUR widths only: 154, 182, 197, 221
         row centres ALTERNATE between 739.5 and 701

     So the variety is a four-value palette in a fixed sequence per row, and
     the ragged look comes from the alternating row centre, not from random
     widths. A random generator cannot produce that: it gives every row a
     different centre and twenty different widths, which reads as noise where
     theirs reads as rhythm. Both of my versions were wrong in the same way,
     once toward uniform and once toward random, and the answer was to go and
     read it.

     Values are their screen pixels at 1440, divided by the 1.2 scale this
     scene's 1200-unit viewBox renders at. */
  const cells = [];
  const REF_PX = 1.2;                   // our viewBox units per reference pixel
  const CH = 62 / REF_PX;                   // 62px brick height
  const GX = 7.5 / REF_PX;                  // measured gap, 7 to 8px
  const PITCH = 70 / REF_PX;                // row to row
  const originY = 150 / REF_PX;             // first row top

  // Their per-row width sequences, in reference pixels.
  const ROW_WIDTHS = [
    [154, 221, 182, 197, 154, 197],
    [197, 182, 154, 221, 154, 221],
    [182, 221, 182, 154, 197, 154],
    [154, 221, 182, 154, 197, 182],
    [221, 154, 182, 221, 154, 182],
    [182, 197, 154, 182, 221, 154],
    [154, 182, 221, 154, 182, 221],
  ];
  // Rows alternate between two centres. Measured: 739.5 and 701, a 38.5px
  // offset that is what makes the wall read as laid rather than tiled.
  const ROW_CENTRE = [739.5, 701, 739.5, 700.5, 739, 701, 739];

  /* Which nine of the forty-two fail is data, not a rule. Nine of 42 was
     counted off their red stage; an `i % N` would put them on a cycle and a
     random draw would cluster differently on every reload. These indices are
     spaced the way theirs are spaced. */
  const FAIL_AT = new Set([1, 9, 13, 20, 24, 28, 32, 38, 41]);

  let idx = 0;
  for (let r = 0; r < ROW_WIDTHS.length; r++) {
    const wsPx = ROW_WIDTHS[r];
    const total = wsPx.reduce((a, b) => a + b, 0) / REF_PX + (wsPx.length - 1) * GX;
    let x = ROW_CENTRE[r] / REF_PX - total / 2;
    const y = originY + r * PITCH;
    for (const wPx of wsPx) {
      const w = wPx / REF_PX;
      const home = { x: x + w / 2, y: y + CH / 2 };
      const u = (x + w / 2 - 600) / 90, v = (r - (ROW_WIDTHS.length - 1) / 2);
      const iso = { x: 600 + (u - v) * 62, y: 430 + (u + v) * 31 };

      const g = el("g");
      /* FILL AND STROKE CROSSFADE, THEY DO NOT BOTH SIT AT ONE VALUE.

         Measured across their scroll:

             y1333  fill-opacity 1     stroke-opacity 0     solid purple
             y2095  fill 0.99 -> 0     stroke -> 0.01       crossfading
             y2476  fill 0            stroke 1              outline only
             y2857  failures fill 0.13 in red, and widen

         Ours had no solid stage at all: an outlined rect plus a fill rect
         pinned at opacity 0 that only ever reached 0.13. So the bricks
         arrived as faint outlines and the first fourteen chunks of the page
         were the wrong colour. One rect that crossfades its own fill and
         stroke is what they ship, and it cannot get out of step with itself
         the way two stacked rects can. */
      const rect = el("rect", { x: 0, y: 0, width: w, height: CH, rx: 0,
        fill: "#755cfe", "fill-opacity": "1",
        stroke: "#755cfe", "stroke-opacity": "0", "stroke-width": "1" });
      const lbl = el("text", { x: 8, y: 17, "font-family": "IBM Plex Mono, monospace",
        "font-size": "8", fill: "#6c6991", opacity: "0" });
      lbl.textContent = `TRACE ${String(idx + 1).padStart(2, "0")}`;
      const fail = el("text", { x: 8, y: 34, "font-family": "IBM Plex Mono, monospace",
        "font-size": "9", fill: "#ee5557", opacity: "0" });
      fail.textContent = FAILURES[idx % FAILURES.length];
      g.append(rect, lbl, fail);
      gCells.appendChild(g);
      cells.push({ g, rect, fill: rect, lbl, fail, home, iso, w,
                   i: idx, fails: FAIL_AT.has(idx) });
      x += w + GX;
      idx++;
    }
  }

  /* The cube wave. Outlined stacked cubes crossing the lattice. */
  for (let i = 0; i < 9; i++) {
    const c = el("g", { opacity: "0.5" });
    const s = 26, x = 0, y = 0;
    c.appendChild(el("path", { d: `M${x},${y} l${s},-${s * 0.5} l${s},${s * 0.5} l-${s},${s * 0.5} Z`,
      fill: "none", stroke: "#755cfe", "stroke-width": "1" }));
    c.appendChild(el("path", { d: `M${x},${y} l0,${s * 0.7} l${s},${s * 0.5} l0,-${s * 0.7}`,
      fill: "none", stroke: "#755cfe", "stroke-width": "1", opacity: "0.6" }));
    c.appendChild(el("path", { d: `M${x + s * 2},${y} l0,${s * 0.7} l-${s},${s * 0.5} l0,-${s * 0.7}`,
      fill: "none", stroke: "#755cfe", "stroke-width": "1", opacity: "0.6" }));
    c.dataset.i = i;
    gWave.appendChild(c);
  }

  /* The mark: segmented purple runs that resolve into a block L. */
  const MARK = [[0,0],[0,1],[0,2],[0,3],[1,3],[2,3],[2,2],[1,0],[1,1]];
  const markTiles = MARK.map(([mx, my]) => {
    const t = el("g", { opacity: "0" });
    const s = 54, px = 600 + (mx - my) * s * 0.9, py = 300 + (mx + my) * s * 0.45;
    t.appendChild(el("path", { d: `M${px},${py} l${s},-${s * 0.5} l${s},${s * 0.5} l-${s},${s * 0.5} Z`,
      fill: "#755cfe", opacity: "0.92" }));
    t.appendChild(el("path", { d: `M${px},${py} l0,${s * 0.62} l${s},${s * 0.5} l0,-${s * 0.62} Z`,
      fill: "#5d4ee7" }));
    t.appendChild(el("path", { d: `M${px + s * 2},${py} l0,${s * 0.62} l-${s},${s * 0.5} l0,-${s * 0.62} Z`,
      fill: "#4a3cc4" }));
    gMark.appendChild(t);
    return t;
  });

  /* Headlines, as HTML over the SVG so the type matches the rest of the page. */
  const cap = document.createElement("div");
  /* THE CAPTION OWNS A BAND AND THE GRID STARTS BELOW IT.

     The headline was printing straight through the first two rows of traces.
     The caption sits absolutely over the SVG at a percentage of the pinned
     stage while the grid is positioned in viewBox units, so the two were
     laid out in different coordinate systems and nothing connected them. At
     900px tall the caption's text ended around y=134 and the grid began at
     y=123, so they were guaranteed to collide at exactly the viewport height
     this is usually read at.

     Two systems addressing the same space with no shared constraint is the
     same failure as a percentage-positioned plate next to a pixel-positioned
     one: it works at the width you happened to test. The band below is
     reserved in BOTH systems and the grid's origin is derived from it. */
  cap.style.cssText = "position:absolute;left:0;right:0;top:2%;text-align:center;" +
    "padding:0 16px;pointer-events:none";
  /* The two headlines share ONE relative box below the label, so the
     incoming one cannot land on top of the eyebrow. Previously s1b was
     position:absolute top:0 against the whole caption, which put it exactly
     where the label sits: "RESOLUTION" printed through "With Sift, you
     don't." A wipe between two headlines needs them stacked on each other,
     not on the element above them. */
  cap.innerHTML =
    `<div class="label" id="s1label">Traces</div>
     <div id="s1stack" style="position:relative">
       <h2 id="s1a" style="font-size:36px;font-weight:400;margin:0;
           letter-spacing:-0.02em;line-height:1.2">Your agents fail silently.</h2>
       <h2 id="s1b" style="font-size:36px;font-weight:400;margin:0;
           letter-spacing:-0.02em;line-height:1.2;opacity:0;position:absolute;
           left:0;right:0;top:0">With Sift, you see it.</h2>
     </div>`;
  host.style.position = "relative";
  host.appendChild(cap);
  const s1a = cap.querySelector("#s1a"), s1b = cap.querySelector("#s1b");
  const s1label = cap.querySelector("#s1label");

  /* The trace counter that changes above the lattice during the wave. */
  const counter = document.createElement("div");
  counter.className = "label";
  counter.style.cssText = "position:absolute;left:0;right:0;bottom:8%;text-align:center;" +
    "opacity:0;pointer-events:none";
  host.appendChild(counter);

  return function render(p) {
    /* STAGE WINDOWS. They overlap on purpose: detail leaves while width is
       already changing, the ground appears before the tilt finishes. That
       overlap is what separates a sequence from a slideshow. */
    /* THE FAILURES COME AFTER THE OUTLINE, NOT DURING THE SOLID STAGE.

       tFail used to run 0.07 to 0.20, finishing before tClear began, so our
       red lit up while the wall was still solid purple and had gone again by
       the time the outlines arrived. Theirs is the other order, measured:

           y2476   crossfade done, outline only, nothing red
           y2857   nine bricks light red ON the outlined wall, and widen
           y3619   still lit
           y4000   red gone, narrowing begins

       The order carries the meaning. Solid wall, then the wall goes quiet,
       then the nine that failed light up against the quiet. Firing the red
       during the solid stage hides it, which is why ours read as a purple
       wall that flickered rather than as a wall with nine faults in it. */
    const tIn    = seg(p, 0.00, 0.08);   // cards arrive, staggered
    const tClear = seg(p, 0.10, 0.18);   // solid crossfades to outline
    const tFail  = seg(p, 0.20, 0.36);   // the nine light up, and widen
    const tNarrow= seg(p, 0.38, 0.48);   // width collapses toward square
    const tTilt  = seg(p, 0.46, 0.56);   // rotation into diamonds
    const tScat  = seg(p, 0.54, 0.66);   // redistribution onto the plane
    const tGround= seg(p, 0.60, 0.70);   // lattice reveal, under the tiles
    const tWave  = seg(p, 0.68, 0.80);   // cube wave crosses
    const tWipe  = seg(p, 0.70, 0.79);   // headline exchange
    const tMark  = seg(p, 0.80, 0.94);   // the mark assembles
    const tLift  = seg(p, 0.93, 1.00);   // everything leaves upward

    gLat.setAttribute("opacity", (tGround * 0.9 * (1 - tLift)).toFixed(3));

    for (const c of cells) {
      const d = c.i / CELLS;
      /* Arrival is staggered by index but the whole stagger fits inside the
         stage, so the last cell is not still arriving after the next stage
         has begun. */
      const a = clamp((tIn - d * 0.35) / 0.65);
      /* Width: full card -> square. Height never changes, so the shape reads
         as narrowing rather than scaling. */
      /* Each brick narrows from ITS OWN width, not from a shared constant.
         The masonry rewrite gave every brick a drawn width, so lerping from
         a single CW would have snapped all 42 to one size on the first frame
         of this stage, undoing the varied layout exactly when it starts
         moving. The square it narrows TO is shared, because that is the tile
         the ground plane holds. */
      const w = lerp(c.w, CH, ease(tNarrow));

      /* PROJECTION, NOT ROTATION. This was rotate(45) on a square, and a
         square turned 45 degrees has EQUAL diagonals. A square actually
         lying on this isometric ground plane projects to a rhombus whose
         horizontal diagonal is twice its vertical one, because the plane's
         own basis is u -> (62,31) and v -> (-62,31).

         So the tiles were the wrong shape for the plane they were sitting
         on: a diamond hovering above the grid instead of a tile lying in
         it. Rotating is not projecting, and using one for the other is why
         the scene never locked together no matter what else got fixed.

         The matrix below IS the grid. Tile and cell cannot disagree now,
         because both are generated from the same two basis vectors. */
      const k = ease(tTilt);                    // 0 flat on screen, 1 on the plane
      const ux = lerp(1, 62 / CH, k), uy = lerp(0, 31 / CH, k);
      const vx = lerp(0, -62 / CH, k), vy = lerp(1, 31 / CH, k);
      /* Inset inside the cell, not filling it. At 0.92 the tiles tiled edge
         to edge into one continuous sheet and the lattice under them became
         invisible. The reference keeps a clear gap so each tile reads as a
         separate object resting on a visible ground. */
      const sc = lerp(1, 0.6, ease(tScat));
      const x = lerp(c.home.x, c.iso.x, ease(tScat));
      const y = lerp(c.home.y, c.iso.y, ease(tScat));
      const lift = tLift * -620;

      c.g.setAttribute("transform",
        `translate(${x.toFixed(1)},${(y + lift).toFixed(1)}) ` +
        `scale(${sc.toFixed(3)}) ` +
        `matrix(${ux.toFixed(4)},${uy.toFixed(4)},${vx.toFixed(4)},${vy.toFixed(4)},` +
        `${(-w / 2).toFixed(1)},${(-CH / 2).toFixed(1)})`);
      c.g.setAttribute("opacity", (a * (1 - tLift * 0.9)).toFixed(3));
      c.rect.setAttribute("width", w.toFixed(1));

      /* THE CROSSFADE. Measured on their scroll, fill and stroke trade
         places over tClear rather than either being constant:

             before  fill-opacity 1   stroke-opacity 0    solid purple
             after   fill-opacity 0   stroke-opacity 1    outline only

         The label is invisible while the brick is solid, because there is
         nothing to read it against, and appears as the fill leaves. */
      const swap = ease(tClear);
      const f = c.fails ? tFail * (1 - tClear) : 0;
      // A failing brick keeps a 0.13 wash of red where a healthy one goes to
      // nothing. 0.13 is theirs, measured at the stage where nine of the
      // forty-two are lit.
      const fillOp = c.fails ? Math.max(1 - swap, f * 0.13) : 1 - swap;
      c.rect.setAttribute("fill", c.fails && f > 0.1 ? "#ee5557" : "#755cfe");
      c.rect.setAttribute("fill-opacity", fillOp.toFixed(3));
      c.rect.setAttribute("stroke-opacity", swap.toFixed(3));
      c.rect.setAttribute("stroke", c.fails && f > 0.1 ? "#ee5557" : "#755cfe");
      c.fail.setAttribute("opacity", f.toFixed(3));
      c.lbl.setAttribute("opacity", (a * swap * (1 - tNarrow)).toFixed(3));
    }

    /* Cube wave: crosses left to right, each cube offset so the crest is
       diagonal rather than a wall. */
    gWave.setAttribute("opacity", (tWave > 0 ? (1 - Math.abs(tWave - 0.5) * 2) : 0).toFixed(3));
    [...gWave.children].forEach((c, i) => {
      const d = i / 9;
      const t = clamp(tWave * 1.6 - d * 0.5);
      c.setAttribute("transform",
        `translate(${lerp(140, 1010, t).toFixed(1)},${(452 - d * 26 + Math.sin(t * Math.PI) * -46).toFixed(1)})`);
    });
    counter.style.opacity = (tWave > 0.05 && tWave < 0.95 ? 0.9 : 0).toFixed(2);
    counter.textContent = `${Math.round(lerp(0, 12406, tWave)).toLocaleString()} traces scored`;

    /* Headline exchange: the outgoing one wipes horizontally, which is what
       the reference does, and the incoming one arrives as the plane persists.
       A cross-fade would lose the wipe, and the wipe is the effect. */
    s1a.style.clipPath = `inset(0 ${(tWipe * 100).toFixed(1)}% 0 0)`;
    s1a.style.opacity = String(1 - tWipe * 0.2);
    /* A fully clipped element still occupies its box, so the two headlines
       kept overlapping in layout after the wipe finished. Invisible on
       screen, caught by the gate's pairwise box check at 39%. Taking the
       spent one out of the flow is both the fix and the honest state. */
    s1a.style.display = tWipe >= 1 ? "none" : "";
    s1b.style.display = tWipe <= 0 ? "none" : "";
    s1b.style.opacity = String(tWipe);
    s1b.style.clipPath = `inset(0 0 0 ${((1 - tWipe) * 100).toFixed(1)}%)`;
    s1label.textContent = tWipe > 0.5 ? "Resolution" : "Traces";

    /* The mark assembles in stages: sparse pieces, then runs, then resolved. */
    /* The whole scene leaves together. Lifting the geometry while the
       headline stayed pinned sent the assembled mark straight up THROUGH the
       type: invisible while reading the code, and the reason design-gate
       measured visual weight 0.355 off centre at this position. The
       reference moves the mark and its plane out as one object, so the
       caption travels with them. */
    const capLift = (tLift * -320).toFixed(1);
    cap.style.transform = `translateY(${capLift}px)`;
    cap.style.opacity = String(1 - tLift);
    counter.style.transform = `translateY(${capLift}px)`;
    gMark.setAttribute("opacity", (1 - tLift).toFixed(3));
    markTiles.forEach((t, i) => {
      const o = clamp((tMark - (i / markTiles.length) * 0.55) / 0.45);
      t.setAttribute("opacity", snap(o).toFixed(3));
      t.setAttribute("transform", `translate(0,${((1 - snap(o)) * 40 - tLift * 620).toFixed(1)})`);
    });
  };
}

/* ---------------------------------------------------------------------- */
/* SCENE 2: the product demo. Copy moves, the demo area stays put.         */
/* ---------------------------------------------------------------------- */
const DEMO = [
  { label: "Traces", title: "Surface failures you didn't know to look for.",
    body: "Sift audits every trace against your agent's instructions and groups recurring failures into issues.",
    render: tracePanel },
  { label: "Live alerts", title: "Get notified on what matters.",
    body: "Sift triages issues and alerts you in Slack.", render: slackPanel },
  { label: "Sift MCP", title: "Fix it where you work.",
    body: "Pull context into your coding agent to resolve it without context-switching.",
    render: agentPanel },
  { label: "Metrics", title: "Ship with confidence.",
    body: "After deploying the fix, Sift creates an online eval. If a regression occurs, you'll know.",
    render: metricsPanel },
];

function row(k, v, extra = "") {
  return `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;
    border-bottom:1px solid var(--line);font-family:var(--mono);font-size:11px">
    <span style="color:var(--ink)">${k}</span>
    <span style="color:var(--muted)">${v}</span></div>${extra}`;
}
function tracePanel() {
  return `<div class="panel-head"><span>support-agent</span>
    <span style="margin-left:auto">12.40s &middot; 10 spans</span></div>
    <div class="panel-body">
    ${row("input_guardrail", "1.40s")}${row("retrieve_context", "2.10s")}
    ${row("vector_search", "1.80s")}${row("ai.generateText", "3.20s")}
    ${row("tools", "3.40s")}${row("research_literature", "1.90s")}
    ${row("speak_to_user", "500ms")}
    <div style="margin-top:12px;padding:10px;background:#fdf2f2;border:1px solid #f0caca;
      font-family:var(--mono);font-size:11px;color:#b3352d">
      customerId: "unknown" &middot; 23 fabricated lookups</div></div>`;
}
function slackPanel() {
  return `<div class="panel-head"><span>#sift-agent</span>
    <span style="margin-left:auto">9:42 AM</span></div>
    <div class="panel-body" style="font-family:var(--chat);font-size:14px;color:var(--slack-ink)">
    <div style="font-weight:700;margin-bottom:4px">New issue found in support-agent</div>
    <div style="color:#b3352d;margin-bottom:10px">When a customer can't be identified, the
      agent invents placeholder identifiers instead of escalating.</div>
    <div style="background:var(--panel);border-left:3px solid var(--accent);padding:10px;
      font-size:13px;line-height:1.6">
      <div><b>Refunds promised outside policy window</b></div>
      <div style="color:var(--muted)">66% of support runs &middot; 23 fabricated lookups
        &middot; 15 orphaned tickets &middot; 7 escalations routed to nonexistent queues</div></div>
    <div style="margin-top:12px;font-size:13px;color:var(--muted)">3 replies &middot; Today at 9:44 AM</div>
    <div style="margin-top:8px;font-size:14px"><b>Cole Gawin</b>
      <span style="color:var(--muted);font-size:12px">9:44 AM</span></div>
    <div style="font-size:14px">can you show me the traces? <span style="color:var(--accent)">@Sift</span></div>
    </div>`;
}
function agentPanel() {
  const l = (s, c = "var(--ink)") =>
    `<div style="font-family:var(--mono);font-size:12px;color:${c};padding:2px 0">${s}</div>`;
  return `<div class="panel-head"><span>your coding agent</span>
    <span style="margin-left:auto">bypass permissions on</span></div>
    <div class="panel-body">
    ${l("&rsaquo; fix the P0 refund-policy incident from Sift", "var(--accent)")}
    ${l("&bull; sift &middot; get_incident(inc_4f2a)", "var(--muted)")}
    ${l("&boxur; P0 &mdash; promising refunds outside 30-day policy")}
    ${l("&bull; sift &middot; get_traces(refund_policy)", "var(--muted)")}
    ${l("12 traces &middot; root cause: prompt revision 41m ago", "var(--muted)")}
    <div style="margin:10px 0;padding:10px;background:var(--panel);border:1px solid var(--line);
      font-family:var(--mono);font-size:12px;line-height:1.7">
      <div style="color:var(--muted)">prompts/refund_policy.md</div>
      <div style="color:#b3352d">- Offer the customer a refund if they are unhappy.</div>
      <div style="color:#1f7a45">+ Only offer refunds within the 30-day policy window.</div>
      <div style="color:#1f7a45">+ Outside the window, route to a human agent.</div>
      <div style="color:var(--muted)">&hellip; +6 lines</div></div>
    ${l("&check; Fix applied &mdash; PR #482 opened", "#1f7a45")}</div>`;
}
function metricsPanel() {
  return `<div class="panel-head"><span>refund_policy_violations</span>
    <span style="margin-left:auto">all passing</span></div>
    <div class="panel-body">
    <div style="font-size:13px;margin-bottom:6px">Metric created &mdash;
      <span style="font-family:var(--mono);font-size:12px">refund_policy_violations</span></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">
      Scoring every new trace against this failure mode</div>
    <svg viewBox="0 0 420 150" style="width:100%;height:150px">
      <line x1="0" y1="120" x2="420" y2="120" stroke="var(--line)"/>
      ${Array.from({ length: 22 }, (_, i) => {
        const h = i < 9 ? 70 - i * 2 : Math.max(4, 52 - (i - 9) * 4);
        return `<rect x="${i * 19 + 3}" y="${120 - h}" width="13" height="${h}"
          fill="${i < 9 ? "#d4443c" : "#755cfe"}" opacity="0.85"/>`;
      }).join("")}
    </svg>
    <div style="margin-top:10px;padding:8px 10px;background:var(--panel);
      border:1px solid var(--line);font-size:12px;color:var(--muted)">
      Recurred 2m ago &mdash; 2 traces flagged &middot; team notified</div></div>`;
}


/* TEXT TRAVELS, IT DOES NOT SWITCH.

   Caleb: "In 1 section text is supposed to scroll bottom to top while the box
   on the right animates but instead the text is basically just switching."

   Exactly right. This was three `textContent =` assignments, so the panels on
   the right crossfaded while the copy beside them cut between states. A cut
   next to a dissolve reads as a bug even when neither is wrong alone.

   The reference ships the mechanism as two clip-path keyframes:

       maskHideUp      inset(0 0 0)     -> inset(0 0 100%)   opacity 1 -> 0
       maskRevealDown  inset(100% 0 0)  -> inset(0 0 0)      opacity 0 -> 1

   Outgoing line wipes upward, incoming line is uncovered from its baseline
   up. Nothing translates, so there is no reflow and nothing can overlap the
   line below it, which is what a translateY swap does at small line heights.

   The three lines are offset 0, 60 and 120ms. That is a stagger rather than a
   chain, and it is correct here: these are siblings arriving together, not
   stages where one has to finish before the next can start. Chaining them
   would take 0.9s to change a label. */
const SWAP_MS = 260;

function swapText(el, next, delay) {
  if (el.textContent === next) return;
  // A scroll-driven swap can fire many times a second while someone flicks.
  // Without this the element accumulates animations and lands mid-wipe.
  if (el._swap) { clearTimeout(el._swap); }
  el._swap = setTimeout(() => {
    if (REDUCED) { el.textContent = next; return; }
    el.animate(
      [{ clipPath: "inset(0 0 0 0)", opacity: 1 },
       { clipPath: "inset(0 0 100% 0)", opacity: 0 }],
      { duration: SWAP_MS, easing: "cubic-bezier(.33,1,.68,1)", fill: "forwards" }
    ).onfinish = () => {
      el.textContent = next;
      el.animate(
        [{ clipPath: "inset(100% 0 0 0)", opacity: 0 },
         { clipPath: "inset(0 0 0 0)", opacity: 1 }],
        { duration: SWAP_MS, easing: "cubic-bezier(.33,1,.68,1)", fill: "forwards" }
      );
    };
  }, delay);
}

function scene2() {
  const stage = document.getElementById("demoStage");
  const label = document.getElementById("demoLabel");
  const title = document.getElementById("demoTitle");
  const body  = document.getElementById("demoBody");
  const panels = DEMO.map(d => {
    const p = document.createElement("div");
    p.className = "panel";
    p.innerHTML = d.render();
    stage.appendChild(p);
    return p;
  });

  return function render(p) {
    /* Which panel, as a continuous index. The reference overlaps outgoing and
       incoming demo content rather than cutting, so neighbours share a band. */
    const f = clamp(p) * (DEMO.length - 1);
    const i = Math.min(DEMO.length - 1, Math.floor(f + 0.5));
    panels.forEach((el2, k) => {
      const d = Math.abs(f - k);
      const o = clamp(1 - d * 1.45);
      el2.style.opacity = o.toFixed(3);
      el2.style.transform = `translateY(${((f - k) * 26).toFixed(1)}px)`;
      /* Out of the band, out of the tree: a panel at opacity 0 still traps
         pointer events and still paints its children's stacking context. */
      el2.style.display = o < 0.01 ? "none" : "";
    });
    if (label.dataset.i !== String(i)) {
      label.dataset.i = String(i);
      swapText(label, DEMO[i].label, 0);
      swapText(title, DEMO[i].title, 60);
      swapText(body,  DEMO[i].body,  120);
    }
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
import { registerHero, registerReveals, startScroll } from "./scroll.js";
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
const PLATE_BOX = 1600;

/* THE OFFSETS ABOVE ARE THE >=1600 LAYOUT, AND BELOW 1600 THEY SCALE.

   Measured on all six plates at four widths. Each plate's offset from the
   page centre, as a fraction of its own offset at 1600:

       vw     1280     1440     1600     1920
       s     0.8648   0.9730   1.000    1.000

   Every plate agrees to within 0.3%, and above 1600 the box caps and
   centres, which is the behaviour the comment above already describes.

   What this fixes: applying the 1600 layout at 1440 pushed every plate
   outward from centre by 2.7%, which is small enough to look like nothing
   and is exactly the kind of error that makes a composition feel loose
   without showing you where. Plate WIDTHS are fixed pixels at every width,
   so this scales positions only.

   INTERPOLATED BETWEEN THE MEASURED POINTS, NOT MODELLED. The curve is not
   linear in viewport width (+0.108 over the first 160px, +0.027 over the
   second) and no ratio or power law fits all three, so it is probably a
   breakpoint set rather than a formula. Three points are what was measured
   and three points are what is stored; below 1280 it holds at 0.8648
   because nothing was measured there. */
const PLATE_SCALE = [[1280, 0.8648], [1440, 0.9730], [1600, 1.0]];

function plateScale(vw) {
  if (vw >= 1600) return 1;
  if (vw <= 1280) return PLATE_SCALE[0][1];
  for (let i = 1; i < PLATE_SCALE.length; i++) {
    const [x0, y0] = PLATE_SCALE[i - 1], [x1, y1] = PLATE_SCALE[i];
    if (vw <= x1) return y0 + (y1 - y0) * ((vw - x0) / (x1 - x0));
  }
  return 1;
}

const PLATES = [
  { id: "SFT. 1.1", pad: "5px 0 0 0", x: 178,  top: -15,  w: 282, h: 202, fig: "lens",   sw: 0.12, op: 0.7  },
  { id: "SFT. 1.2", pad: "52px 18px 47px", x: 1288, top: 39,  w: 158, h: 220, fig: "cube",   sw: 0.25, op: 0.85 },
  { id: "SFT. 1.3", pad: "5px 0 0 0", x: 1111, top: 66,  w: 202, h: 202, fig: "harmo",  sw: 0.15, op: 0.6  },
  { id: "SFT. 2.1", pad: "23px 18px 18px", x: 149,  top: 336, w: 176, h: 202, fig: "mesh",   sw: 0.15, op: 0.5  },
  { id: "SFT. 2.2", pad: "23px 18px 18px", x: 275,  top: 408, w: 202, h: 211, fig: "sphere", sw: 0.13, op: 0.5  },
  { id: "SFT. 2.3", pad: "5px 0 0 0", x: 1140, top: 354, w: 229, h: 202, fig: "dots",   sw: 1,    op: 0.3  },
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
    inner = polys(gravLens({ rays: 48, seg: 60 }), sw, 24, "", op);
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
    // Positioned inside a centred PLATE_BOX rather than as a percentage of
    // the viewport, so the overlaps hold their pixel relationships at any width.
    const off = (p.x - PLATE_BOX / 2) * plateScale(window.innerWidth);
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
    d.style.cssText = `left:calc(50% + ${off.toFixed(1)}px);`
                    + `top:${p.top}px;width:${p.w}px;height:${p.h}px;`
                    + `padding:${p.pad};box-sizing:border-box`;
    /* Exactly ONE plate rotates forever and ONE drifts forever. The
       reference runs 1 infinite transform and 2 infinite dashes across the
       whole page, not a loop per figure: an ambient layer is a background
       hum, and a hum on every element is noise. */
    d.dataset.fig = p.fig;
    // The label lives in a 40px box pinned to the frame's top-left corner on
    // every reference plate. Mine was bare text, which is why the plates read
    // as bordered rectangles rather than as labelled instrument panels.
    d.innerHTML = figure(p.fig, p.sw, p.op) + `<div class="cap-box"><span class="cap">${p.id}</span></div>`;
    host.appendChild(d);
  }
}

plates();

/* The hero layers must be registered AFTER plates() has put them in the
   document, because the depth ordering reads each plate's measured position.
   Registering against an empty container is the silent version of this bug:
   no error, no motion, and a scroll system that looks wired and is not. */
registerHero(document.querySelector(".hero") || document.body);
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
/* The cube's clock. Spin-up, then an indefinite slow drift, plus a pointer
   lean, paused and BANKED while off screen so scrolling back finds it where
   it was rather than restarting its entrance. */
function cubeClock() {
  const host = document.querySelector("svg:has(.cube-edges)");
  if (!host) return;
  const plate = host.closest(".plate") || host;
  const edgeG = host.querySelector(".cube-edges");
  const face  = host.querySelector(".cube-topface");
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


drive("run1", scene1(document.getElementById("stage1")));
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
import * as sec_failure_wall from "./sections/failure-wall.js";
import * as sec_counter from "./sections/counter.js";
import * as sec_waterfall from "./sections/waterfall.js";
import * as sec_chat_mock from "./sections/chat-mock.js";
import * as sec_integrations from "./sections/integrations.js";
import * as sec_testimonials from "./sections/testimonials.js";

/* Prefixed, because `testimonials` and `counter` are already bound in this
   file by the older hand-built versions. A namespace import that collides
   with an existing const is a MODULE-LEVEL SyntaxError, so it does not fail
   that one section: it stops the whole file, and all seven mount points stay
   empty with the page otherwise looking fine. Caught by checking that each
   section had children rather than by trusting that the import list was
   correct. */
const SECTIONS = [sec_logo_wall, sec_failure_wall, sec_counter, sec_waterfall, sec_chat_mock, sec_integrations, sec_testimonials];

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

/* Reveals are registered AFTER the sections exist, because the observer can
   only watch elements that are in the document. Registering first is the
   silent version of this bug: no error, no reveal, and a scroll system that
   looks wired and is not. */
registerReveals();
