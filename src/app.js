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

  /* Ground lattice. It must use the SAME projection as the cells, or the
     tiles sit on a plane that is not the plane they are drawn on and the
     whole scene stops reading as three-dimensional.

     The first version lerped between two arcs and produced a curved fan: it
     looked like a drawing of a plane rather than a plane, and the diamonds
     floated above it. Drawing the grid through the cell projection fixes it
     for free, because then the two cannot disagree by construction. */
  const PX = (u, v) => [600 + (u - v) * 62, 430 + (u + v) * 31];
  const EXT = 5.5;                       // half a cell past the outermost tile
  const gline = (a, b, o) => el("line", {
    x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1),
    stroke: "#755cfe", "stroke-width": "0.5", opacity: String(o) });
  for (let i = -EXT; i <= EXT; i += 1) {
    /* Fade with distance from the centre, so the plane reads as extending
       rather than as a rectangle that stops. */
    const o = (0.34 * (1 - Math.abs(i) / (EXT + 1.5))).toFixed(3);
    gLat.appendChild(gline(PX(i, -EXT), PX(i, EXT), o));
    gLat.appendChild(gline(PX(-EXT, i), PX(EXT, i), o));
  }

  /* Cells. Home = the card grid. Every later position is derived from the
     same index, so correspondence is structural and never re-solved. */
  const cells = [];
  const CW = 132, CH = 74, GX = 14, GY = 16;
  const originX = (1200 - (COLS * CW + (COLS - 1) * GX)) / 2;
  const originY = 96;
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    /* Staggered rows: odd rows offset, as the reference shows. */
    const home = { x: originX + c * (CW + GX) + (r % 2 ? CW * 0.22 : 0),
                   y: originY + r * (CH + GY) };
    /* Isometric target: same index, projected onto the ground plane. */
    const u = (c - (COLS - 1) / 2), v = (r - (ROWS - 1) / 2);
    const iso = { x: 600 + (u - v) * 62, y: 430 + (u + v) * 31 };
    const g = el("g");
    const rect = el("rect", { x: 0, y: 0, width: CW, height: CH, rx: 0,
      fill: "none", stroke: "#1d1956", "stroke-width": "1", opacity: "0.55" });
    const fill = el("rect", { x: 0, y: 0, width: CW, height: CH,
      fill: "#755cfe", opacity: "0" });
    const lbl = el("text", { x: 8, y: 17, "font-family": "IBM Plex Mono, monospace",
      "font-size": "8", fill: "#6c6991" });
    lbl.textContent = `TRACE ${String(i + 1).padStart(2, "0")}`;
    const fail = el("text", { x: 8, y: 34, "font-family": "IBM Plex Mono, monospace",
      "font-size": "9", fill: "#d4443c", opacity: "0" });
    fail.textContent = FAILURES[i % FAILURES.length];
    g.append(fill, rect, lbl, fail);
    gCells.appendChild(g);
    /* Every 4th cell is a failing one. A field where everything fails says
       nothing; the reference shows a minority lit up inside a calm grid. */
    cells.push({ g, rect, fill, lbl, fail, home, iso, i, fails: i % 4 === 1 });
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
  cap.style.cssText = "position:absolute;left:0;right:0;top:6%;text-align:center;" +
    "padding:0 16px;pointer-events:none";
  cap.innerHTML =
    `<div class="label" id="s1label" style="margin-bottom:10px">Traces</div>
     <h2 id="s1a" style="font-size:var(--t-h2);font-weight:400;margin:0;
         letter-spacing:-0.02em;line-height:1.15">Your agents fail silently.</h2>
     <h2 id="s1b" style="font-size:var(--t-h2);font-weight:400;margin:0;
         letter-spacing:-0.02em;line-height:1.15;opacity:0;position:absolute;
         left:0;right:0;top:0;padding:0 16px">With Lemma, you don't.</h2>`;
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
      const w = lerp(CW, CH, ease(tNarrow));

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
    body: "Lemma audits every trace against your agent's instructions and groups recurring failures into issues.",
    render: tracePanel },
  { label: "Live alerts", title: "Get notified on what matters.",
    body: "Lemma triages issues and alerts you in Slack.", render: slackPanel },
  { label: "Lemma MCP", title: "Fix it where you work.",
    body: "Pull context into your coding agent to resolve it without context-switching.",
    render: agentPanel },
  { label: "Metrics", title: "Ship with confidence.",
    body: "After deploying the fix, Lemma creates an online eval. If a regression occurs, you'll know.",
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
  return `<div class="panel-head"><span>#lemma-agent</span>
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
    <div style="font-size:14px">can you show me the traces? <span style="color:var(--accent)">@Lemma</span></div>
    </div>`;
}
function agentPanel() {
  const l = (s, c = "var(--ink)") =>
    `<div style="font-family:var(--mono);font-size:12px;color:${c};padding:2px 0">${s}</div>`;
  return `<div class="panel-head"><span>your coding agent</span>
    <span style="margin-left:auto">bypass permissions on</span></div>
    <div class="panel-body">
    ${l("&rsaquo; fix the P0 refund-policy incident from Lemma", "var(--accent)")}
    ${l("&bull; lemma &middot; get_incident(inc_4f2a)", "var(--muted)")}
    ${l("&boxur; P0 &mdash; promising refunds outside 30-day policy")}
    ${l("&bull; lemma &middot; get_traces(refund_policy)", "var(--muted)")}
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
      label.textContent = DEMO[i].label;
      title.textContent = DEMO[i].title;
      body.textContent  = DEMO[i].body;
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

const TESTIMONIALS = [
  ["conor brennan-burke", "@contextconor", "we've been using Lemma for observability and it's legitimately awesome"],
  ["Nicolas Dessaigne", "Y Combinator &middot; @dessaigne", "Agents can look like they're working even when they've failed. Lemma catches that before your users do."],
  ["Baptiste D", "@baptistedebever", "congrats to the lemma team! we switched over from raindrop a while back at folk and the difference is night and day"],
  ["Chenxin Yan", "@chenxinyan04", "Very excited to be working alongside the Lemma team!"],
  ["Hai Ta (YC P26)", "Userlens &middot; @HaiTa", "Every morning, I check our frontend logs, backend logs, then Lemma logs, then pipe any issues straight into the coding agent."],
  ["Adhit Sankaran", "@adhit_sankaran", "can confirm: agents f*ck up. volume is growing faster than any human could review, so this is the only way."],
  ["Elior Alayev", "@EliorAlayev", "Agents are getting better. Their mistakes are getting weirder."],
  ["Jenny He", "Founder & General Partner, Position &middot; @jennydhe", "This is why we invested. Sign up before your agents turn everything into paperclips."],
  ["Kevin Le", "Cladlabs (YC F25) &middot; @xkevin_le", "We got set up on lemma in under 10 min using their agent skill. almost immediately it flagged a real issue."],
  ["Danylo Borodchuk", "Lopus (YC W25) &middot; @danylo_dev", "the thing we love is that it understands what your agents are supposed to do, instead of just logging what they did."],
  ["Prama Yudhistira", "Parameter &middot; @menace_codes", "Well deserved, been working with the lemma team since we were still in the yc batch together."],
  ["Cole Gawin", "@colegawin_", "Love the Lemma team. Gave me the easiest way to find where our agent did something it shouldn't have."],
];

function testimonials() {
  const g = document.getElementById("tgrid");
  if (!g) return;
  /* @handles render as accent links inline in the quote, which is how the
     reference reads: these are real posts, not pull-quotes, and the handle
     being live is what says so. */
  const at = t => t.replace(/(@[A-Za-z0-9_]+)/g, '<a href="#">$1</a>');
  g.innerHTML = TESTIMONIALS.map(([n, h, q]) =>
    `<figure class="tcard">
       <div class="who"><span class="nm">${n}</span><span class="hd">${at(h)}</span></div>
       <blockquote class="q" style="margin:0">${at(q)}</blockquote>
     </figure>`).join("");

  const dots = document.getElementById("cdots");
  if (dots) dots.innerHTML = TESTIMONIALS.map(() => "<i></i>").join("");
  const mark = () => {
    const i = Math.round(g.scrollLeft / (g.scrollWidth / TESTIMONIALS.length));
    [...(dots ? dots.children : [])].forEach((d, k) => d.classList.toggle("on", k === i));
  };
  const page = dir => g.scrollBy({ left: dir * 356, behavior: "smooth" });
  document.querySelector(".cbtn.prev")?.addEventListener("click", () => page(-1));
  document.querySelector(".cbtn.next")?.addEventListener("click", () => page(1));
  g.addEventListener("scroll", mark, { passive: true });
  mark();
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
import { sphere, crosshatch, hyperboloid, ring, isoCube, dotField, fit } from "./geometry.js";

const PLATES = [
  { id: "LEM. 1.1", left: "8%",    top: 0,   w: 281, h: 186, fig: "hyper" },
  { id: "LEM. 1.3", left: "83%",   top: 41,  w: 156, h: 218, fig: "cube"  },
  { id: "LEM. 1.2", left: "71%",   top: 67,  w: 200, h: 200, fig: "ring"  },
  { id: "LEM. 2.1", left: "6%",    top: 336, w: 174, h: 200, fig: "mesh"  },
  { id: "LEM. 2.2", left: "14.6%", top: 407, w: 201, h: 210, fig: "sphere"},
  { id: "LEM. 2.3", left: "73%",   top: 355, w: 229, h: 200, fig: "dots"  },
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
function polys(list, sw = 0.55, step = 18, extra = "") {
  return list.map((pts, i) =>
    `<polyline points="${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}"
       pathLength="100" data-draw ${extra} fill="none" stroke="${A}"
       stroke-width="${sw}" style="animation-delay:${(i * step).toFixed(0)}ms"/>`).join("");
}

/* Every generator already returns fit()-normalised 0..100 polylines, except
   the three added for this rebuild, which are normalised here ONCE so the
   rule holds for all of them without exception. */
function norm(list) { return fit(list); }

function figure(kind) {
  let inner = "";
  if (kind === "hyper") {
    /* DENSITY IS THE EFFECT. Their LEM 1.1 plate is 714 paths; this was 60.
       At 60 you see a lattice and can count the strokes. At 700 the strokes
       stop reading as strokes: the waist EMERGES where chords crowd, and the
       bright pinch is an interference pattern, not a drawn highlight.

       This is why every figure looked cheap next to theirs while using the
       same construction. Same generator, same maths, an order of magnitude
       fewer elements, and the emergent behaviour never appears. Nothing
       about opacity, colour or timing could have recovered it. */
    const hy = norm(hyperboloid({ n: 714, twist: 1.25, w: 100, h: 60 }));
    /* Stagger scaled so 714 paths still land inside the reference's own
       1,180ms harmonograph window: 1180/714 is about 1.6ms. */
    inner = polys(hy.slice(0, 712), 0.18, 1.6)
          + polys(hy.slice(712), 0.5, 1.6, 'data-orbit');
  } else if (kind === "ring") {
    /* A torus, not a donut. 30 bands paint a flat ring; 260 fine bands with
       a density falloff read as a lit tube, because the eye integrates the
       spacing into a gradient. Opacity per band does the work a blur filter
       would, and stays crisp at any size. */
    /* The falloff has to live in the STROKE COLOUR, not in opacity. The
       shared draw keyframe ends at a fixed opacity, so it overwrote the
       per-band value and all 260 bands landed at the same alpha, packing
       into a solid slab. Putting the falloff in rgba() leaves the keyframe
       free to animate opacity while each band keeps its own weight, and the
       eye integrates the spacing into a gradient. That gradient is the
       difference between a lit torus and a flat donut. */
    const bands = ring({ r: 34, thick: 15, bands: 260 });
    inner = "<g>" + bands.map((b, i) =>
      `<polyline points="${b.pts.map(([x, y]) => `${(x + 50).toFixed(2)},${(y + 50).toFixed(2)}`).join(" ")}"
         pathLength="100" data-draw fill="none" stroke="rgba(117,92,254,${b.o.toFixed(3)})"
         stroke-width="0.3" style="animation-delay:${(i * 3).toFixed(0)}ms"/>`).join("") + "</g>";
  } else if (kind === "cube") {
    const c = isoCube({ s: 24 });
    const P = pts => pts.map(([x, y]) => `${(x + 38).toFixed(2)},${(y + 50).toFixed(2)}`).join(" ");
    inner = `<polygon points="${P(c.left)}"  fill="none" stroke="${A}" stroke-width="0.8"/>
             <polygon points="${P(c.right)}" fill="none" stroke="${A}" stroke-width="0.8"/>
             <polygon points="${P(c.top)}"   fill="#1d1956"/>`;
  } else if (kind === "mesh") {
    inner = polys(crosshatch({ n: 120, seg: 10 }), 0.22, 3);   // a plane, not a fan
  } else if (kind === "sphere") {
    inner = polys(sphere({ lats: 51, longs: 50, seg: 30 }), 0.5, 15);
  } else if (kind === "dots") {
    /* 2,046 circles on the reference's densest plate. 700 here rather than
       the previous ~400: still under it, and honest about being under it,
       but far past the point where the arch reads as a field instead of a
       sprinkle. */
    /* ANIMATION BUDGET. The reference runs 214 animations on the whole
       page: 100 sphere paths, 60 harmonograph, 48 gravlens, 6 others. Mine
       ran 1,969 because every element that could animate did, including
       every one of these circles.

       The reference's densest plate holds 2,046 circles and animates NONE of
       them individually: the field fades in as ONE group. A per-circle
       animation on a dense field is invisible anyway, and 700 of them is
       700 compositor entries buying nothing. */
    /* Their exact grid: 2,000 circles, both radii, the recovered dither. */
    inner = `<g data-draw-group>` + dotField({ cols: 40, rows: 50 })
      .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${A}"/>`).join("") + `</g>`;
  }
  return `<svg viewBox="${VB}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

function plates() {
  const host = document.getElementById("plates");
  if (!host) return;
  for (const p of PLATES) {
    const d = document.createElement("div");
    d.className = "plate";
    d.style.cssText = `left:${p.left};top:${p.top}px;width:${p.w}px;height:${p.h}px`;
    /* Exactly ONE plate rotates forever and ONE drifts forever. The
       reference runs 1 infinite transform and 2 infinite dashes across the
       whole page, not a loop per figure: an ambient layer is a background
       hum, and a hum on every element is noise. */
    if (p.fig === "ring") d.classList.add("spin");
    d.dataset.fig = p.fig;
    d.innerHTML = figure(p.fig) + `<div class="cap">${p.id}</div>`;
    host.appendChild(d);
  }
}

plates();
testimonials();
drive("run1", scene1(document.getElementById("stage1")));
drive("run2", scene2());
