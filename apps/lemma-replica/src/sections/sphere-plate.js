/* Plate 2.2, the globe. It turns, and you can pin it.

   Read from their lazy chunk 3150 on 2026-10-03. Ours had been a frozen
   snapshot of their rotation (phase 49.3 deg) drawn with an older flat
   generator, so at rest their plate moved and ours did not, which the idle
   sweep counted as most of the hero's missing motion.

     spin      16 deg/s about the vertical axis, redrawn at most every 33ms,
               paused offscreen with the angle banked so it resumes in place
     grid      32 meridians at 64 segments, 19 parallels, a 14 deg tilt,
               near strokes at 0.7 opacity and far at 0.4, stroke 0.13,
               inside a 0.2 outline circle at r 38 about (50, 52)
     pins      a click on the disc drops a pin at that point on the sphere;
               it turns with the globe and hides on the far side
*/

const SPIN_DEG_PER_S = 16;
const FRAME_MS = 33;
const MERIDIANS = 32;
const PARALLELS = 20; // rings 1..19, the poles are points
const SEG = 64;
const TILT = (14 * Math.PI) / 180;
const CX = 50,
  CY = 52,
  R = 38;
const NS = "http://www.w3.org/2000/svg";

function project(p, deg) {
  const s = (deg * Math.PI) / 180;
  const x = p.x * Math.cos(s) + p.z * Math.sin(s);
  const z = -p.x * Math.sin(s) + p.z * Math.cos(s);
  const y = p.y;
  return {
    sx: CX + R * x,
    sy: CY + R * (y * Math.cos(TILT) - z * Math.sin(TILT)),
    front: y * Math.sin(TILT) + z * Math.cos(TILT) >= 0,
  };
}

/* Each curve splits into its near and far runs; one path per run set. */
function curves(deg) {
  const out = [];
  const emit = (pts) => {
    let near = "",
      far = "",
      inNear = false,
      inFar = false;
    for (const p of pts) {
      const q = project(p, deg),
        xy = `${q.sx.toFixed(2)},${q.sy.toFixed(2)} `;
      if (q.front) {
        near += (inNear ? "L" : "M") + " " + xy;
        inNear = true;
        inFar = false;
      } else {
        far += (inFar ? "L" : "M") + " " + xy;
        inFar = true;
        inNear = false;
      }
    }
    if (near) out.push({ d: near, front: true });
    if (far) out.push({ d: far, front: false });
  };
  for (let m = 0; m < MERIDIANS; m++) {
    const lon = (m / MERIDIANS) * Math.PI * 2,
      pts = [];
    for (let i = 0; i <= SEG; i++) {
      const lat = -Math.PI / 2 + (i / SEG) * Math.PI;
      pts.push({
        x: Math.cos(lat) * Math.sin(lon),
        y: Math.sin(lat),
        z: Math.cos(lat) * Math.cos(lon),
      });
    }
    emit(pts);
  }
  for (let k = 1; k < PARALLELS; k++) {
    const lat = -Math.PI / 2 + (k / PARALLELS) * Math.PI,
      pts = [];
    for (let i = 0; i <= SEG; i++) {
      const lon = (i / SEG) * Math.PI * 2;
      pts.push({
        x: Math.cos(lat) * Math.sin(lon),
        y: Math.sin(lat),
        z: Math.cos(lat) * Math.cos(lon),
      });
    }
    emit(pts);
  }
  return out;
}

export function sphereFigure(accent, sw) {
  const paths = curves(0)
    .map(
      (c, i) =>
        `<path class="sph-line" d="${c.d}" fill="none" stroke="${accent}" stroke-width="${sw}"` +
        ` opacity="${c.front ? 0.7 : 0.4}" pathLength="100" data-draw style="animation-delay:${100 + 15 * i}ms"/>`,
    )
    .join("");
  return (
    `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${accent}" stroke-width="0.2"` +
    ` opacity="0.5" pathLength="100" data-draw/>` +
    `<g class="sph-lines">${paths}</g><g class="sph-pins" pointer-events="none"></g>`
  );
}

export function mountSphere(svg, accent) {
  const linesG = svg.querySelector(".sph-lines");
  const pinsG = svg.querySelector(".sph-pins");
  if (!linesG || !pinsG) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pins = [];
  let deg = 0,
    banked = 0,
    t0 = 0,
    last = 0,
    raf = 0,
    running = false;
  /* The draw-on entrance owns the first 1.6s (100ms + 15ms x ~100 paths of
     stagger, 700ms each), so the spin holds until it lands, as theirs does by
     mounting the figure before the observer starts its clock. */
  const DRAW_MS = 1600;
  const born = performance.now();

  const draw = () => {
    const cs = curves(deg);
    let els = [...linesG.children];
    while (els.length < cs.length) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("class", "sph-line");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", accent);
      p.setAttribute(
        "stroke-width",
        els[0]?.getAttribute("stroke-width") || "0.13",
      );
      linesG.appendChild(p);
      els.push(p);
    }
    els.forEach((el, i) => {
      const c = cs[i];
      if (!c) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.setAttribute("d", c.d);
      el.setAttribute("opacity", c.front ? "0.7" : "0.4");
    });
    pinsG.innerHTML = pins
      .map((p) => {
        const q = project(p, deg);
        if (!q.front) return "";
        const n = q.sx.toFixed(2),
          c = q.sy,
          top = (c - 5.2).toFixed(2);
        return (
          `<ellipse cx="${n}" cy="${(c + 0.3).toFixed(2)}" rx="1" ry="0.3" fill="#000" opacity="0.25"/>` +
          `<path d="M ${n} ${c.toFixed(2)} C ${(q.sx - 2).toFixed(2)} ${(c - 3).toFixed(2)} ${(q.sx - 2).toFixed(2)} ${(c - 6.2).toFixed(2)} ${n} ${top}` +
          ` C ${(q.sx + 2).toFixed(2)} ${(c - 6.2).toFixed(2)} ${(q.sx + 2).toFixed(2)} ${(c - 3).toFixed(2)} ${n} ${c.toFixed(2)} Z"` +
          ` fill="${accent}" stroke="#fff" stroke-width="0.18"/>` +
          `<circle cx="${n}" cy="${top}" r="0.7" fill="#fff"/>`
        );
      })
      .join("");
  };

  const tick = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - born < DRAW_MS || now - last < FRAME_MS) return;
    last = now;
    deg = (banked + ((now - t0) / 1000) * SPIN_DEG_PER_S) % 360;
    draw();
  };

  if (!reduced) {
    new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !running) {
          running = true;
          t0 = performance.now();
          banked = deg;
          last = 0;
          raf = requestAnimationFrame(tick);
        } else if (!e.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0 },
    ).observe(svg);
  }

  /* A click inside the disc becomes a point on the sphere: undo the tilt,
     then the current turn, so the pin stays where it was put. */
  svg.style.cursor = "crosshair";
  const plate = svg.closest(".plate");
  if (plate) plate.style.pointerEvents = "auto";
  svg.addEventListener("click", (ev) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const m = pt.matrixTransform(ctm.inverse());
    const cx = (m.x - CX) / R,
      cy = (m.y - CY) / R,
      r2 = cx * cx + cy * cy;
    if (r2 > 1) return;
    const cz = Math.sqrt(1 - r2),
      h = (deg * Math.PI) / 180;
    const y = cy * Math.cos(TILT) + cz * Math.sin(TILT);
    const zr = -cy * Math.sin(TILT) + cz * Math.cos(TILT);
    pins.push({
      x: cx * Math.cos(h) - zr * Math.sin(h),
      y,
      z: cx * Math.sin(h) + zr * Math.cos(h),
    });
    draw();
  });
}
