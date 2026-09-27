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
  /* MASONRY, NOT A LATTICE. AND NO MODULUS.

     This was a rigid 7x6 grid of identical 132x74 cells with
     `fails: i % 4 === 1`, so every brick was the same size and every fourth
     one failed on a perfect cycle. Neither is true of the reference, whose
     rows hold bricks of clearly different widths and whose failures sit
     where they sit.

     Uniformity and a modulus are what you write when you have not looked.
     They are cheap, they are visible from across the room, and a viewer
     reads them as a placeholder even without being able to say why: real
     systems do not fail on a cycle, and a wall of identical rectangles is a
     table pretending to be a wall.

     Widths are drawn per brick and each row is PACKED to the full width, so
     no two rows break in the same place and the vertical seams never line
     up. Failures are drawn against a probability rather than an index, so
     the gaps between them vary the way a real sample does. Both come from a
     seeded generator, so the layout is stable between reloads and is still
     not a pattern. */
  const cells = [];
  const GX = 14, GY = 16, CH = 74;
  /* The caption band above needs about 100 viewBox units at the heights this
     is read at, and 96 put the first row inside it. 150 + 6 rows at 90 = 690,
     which still clears the 700 unit box. Re-declared here because the masonry
     rewrite replaced the block that used to hold it. */
  const originY = 150;
  const ROW_W = 1200 - 2 * 40;
  const rnd = rng(9);
  let idx = 0;
  for (let r = 0; r < ROWS && idx < CELLS; r++) {
    // Pack this row: draw widths until the remaining space cannot hold
    // another brick, then distribute the slack so the row ends flush.
    const widths = [];
    let used = 0;
    while (idx + widths.length < CELLS) {
      const w = 96 + Math.floor(rnd() * 112);        // 96 to 208
      if (used + w + (widths.length ? GX : 0) > ROW_W) break;
      used += w + (widths.length ? GX : 0);
      widths.push(w);
    }
    if (!widths.length) break;
    const slack = (ROW_W - used) / widths.length;
    let x = 40;
    const y = originY + r * (CH + GY);
    for (const w0 of widths) {
      const w = w0 + slack;
      /* HOME IS A CENTRE, because the transform that places it ends in
         `matrix(..., -w/2, -CH/2)` and therefore draws every brick centred
         on the point it is given. This stored the brick's TOP-LEFT instead,
         so each one rendered shifted left by its own half-width: eight
         overlapping pairs at up to 57px, and the first brick of every row
         hanging 97px off the left edge of the SVG. Measured at the settled
         home state across four scroll positions, so it was the layout and
         not the morph mid-flight.

         Varying widths are what made it look random rather than like an
         offset: a brick overlaps its left neighbour exactly when it is more
         than 2*GX wider than it. `iso` below was already a centre, which is
         the tell. One input, two conventions for what the number means. */
      const home = { x: x + w / 2, y: y + CH / 2 };
      const u = (x + w / 2 - 600) / 90, v = (r - (ROWS - 1) / 2);
      const iso = { x: 600 + (u - v) * 62, y: 430 + (u + v) * 31 };
      const g = el("g");
      const rect = el("rect", { x: 0, y: 0, width: w, height: CH, rx: 0,
        fill: "none", stroke: "#1d1956", "stroke-width": "1", opacity: "0.55" });
      const fill = el("rect", { x: 0, y: 0, width: w, height: CH,
        fill: "#755cfe", opacity: "0" });
      const lbl = el("text", { x: 8, y: 17, "font-family": "IBM Plex Mono, monospace",
        "font-size": "8", fill: "#6c6991" });
      lbl.textContent = `TRACE ${String(idx + 1).padStart(2, "0")}`;
      const fail = el("text", { x: 8, y: 34, "font-family": "IBM Plex Mono, monospace",
        "font-size": "9", fill: "#d4443c", opacity: "0" });
      fail.textContent = FAILURES[idx % FAILURES.length];
      g.append(fill, rect, lbl, fail);
      gCells.appendChild(g);
      /* Drawn, not counted. A field where everything fails says nothing, and
         a field where every fourth fails says "placeholder". About a quarter,
         irregularly spaced. */
      cells.push({ g, rect, fill, lbl, fail, home, iso, w,
                   i: idx, fails: rnd() < 0.26 });
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
    const tIn    = seg(p, 0.00, 0.10);   // cards arrive, staggered
    const tFail  = seg(p, 0.07, 0.20);   // failures light up and expand
    const tClear = seg(p, 0.19, 0.29);   // detail leaves, outlines stay
    const tNarrow= seg(p, 0.25, 0.38);   // width collapses toward square
    const tTilt  = seg(p, 0.35, 0.48);   // rotation into diamonds
    const tScat  = seg(p, 0.44, 0.60);   // redistribution onto the plane
    const tGround= seg(p, 0.50, 0.63);   // lattice reveal, under the tiles
    const tWave  = seg(p, 0.58, 0.75);   // cube wave crosses
    const tWipe  = seg(p, 0.70, 0.79);   // headline exchange
    const tMark  = seg(p, 0.76, 0.94);   // the mark assembles
    const tLift  = seg(p, 0.92, 1.00);   // everything leaves upward

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
      c.fill.setAttribute("width", w.toFixed(1));

      /* Failure state: a red fill and its caption, both gone by tClear.
         Expansion is horizontal only, which is what the reference does. */
      const f = c.fails ? tFail * (1 - tClear) : 0;
      c.fill.setAttribute("opacity", (f * 0.13).toFixed(3));
      c.fail.setAttribute("opacity", f.toFixed(3));
      c.rect.setAttribute("stroke", c.fails && f > 0.1 ? "#d4443c" : "#1d1956");
      c.lbl.setAttribute("opacity", (a * (1 - tClear)).toFixed(3));
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
  gravLens, pentagon, sphere3d, tileField } from "./geometry.js";

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

const PLATES = [
  { id: "SFT. 1.1", x: 178,  top: -9,  w: 282, h: 196, fig: "lens",   sw: 0.12, op: 0.7  },
  { id: "SFT. 1.2", x: 1288, top: 45,  w: 158, h: 214, fig: "cube",   sw: 0.25, op: 0.85 },
  { id: "SFT. 1.3", x: 1111, top: 72,  w: 202, h: 196, fig: "harmo",  sw: 0.15, op: 0.6  },
  { id: "SFT. 2.1", x: 149,  top: 342, w: 176, h: 196, fig: "mesh",   sw: 0.15, op: 0.5  },
  { id: "SFT. 2.2", x: 275,  top: 414, w: 202, h: 205, fig: "sphere", sw: 0.2,  op: 0.5  },
  { id: "SFT. 2.3", x: 1140, top: 360, w: 229, h: 196, fig: "dots",   sw: 1,    op: 0.3  },
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

function polys(list, sw = 0.55, step = 18, extra = "") {
  const shapes = list.map((pts, i) => {
    const pt = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const per = list.length <= DRAW_PER_ELEMENT_MAX
      ? ` data-draw style="animation-delay:${(i * step).toFixed(0)}ms"` : "";
    return `<polyline points="${pt}" pathLength="100"${per} ${extra}
       fill="none" stroke="${A}" stroke-width="${sw}"/>`;
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
    inner = polys(gravLens({ rays: 48, seg: 60 }), sw, 24);
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
         stroke="${A}" stroke-width="${sw}" style="animation-delay:${i * 19}ms"/>`).join("") + "</g>";
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
      + ` stroke="${A}" stroke-width="${sw}" pathLength="100" class="cube-edge"/>`).join("");
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
    inner = polys(isoTiles({ cols: 36, rows: 24 }), sw, 1);
  } else if (kind === "sphere") {
    inner = polys(sphere({ lats: 51, longs: 50, seg: 30 }), sw, 15);
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
  return `<svg viewBox="${VB}" preserveAspectRatio="xMidYMid meet" opacity="${op}">${inner}</svg>`;
}

function plates() {
  const host = document.getElementById("plates");
  if (!host) return;
  for (const p of PLATES) {
    const d = document.createElement("div");
    d.className = "plate";
    // Positioned inside a centred PLATE_BOX rather than as a percentage of
    // the viewport, so the overlaps hold their pixel relationships at any width.
    d.style.cssText = `left:calc(50% - ${PLATE_BOX / 2}px + ${p.x}px);`
                    + `top:${p.top}px;width:${p.w}px;height:${p.h}px`;
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
