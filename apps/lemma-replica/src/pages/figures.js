/* Line figures for post thumbnails and the careers plates.

   Theirs are canvas and image figures, one per post, drawn in the accent on
   a light grey well. These are ours: each kind draws something from Sift's
   own subject (a run's spans, a retry loop, a grouped failure) so a figure
   says what its post is about rather than being decoration.

   Deterministic: a seeded generator, so a thumbnail is the same drawing on
   every load and in every screenshot comparison. */

const NS = "http://www.w3.org/2000/svg";
const ACC = "#755cfe";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A run's waterfall: bars on rows, one failing span outlined. */
function spans(r) {
  let out = "";
  let x = 40;
  for (let i = 0; i < 14; i++) {
    const w = 30 + r() * 160;
    const y = 30 + i * 21;
    const bad = i === 9;
    out += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="9" fill="${bad ? "none" : ACC}" fill-opacity="${bad ? 0 : 0.18 + r() * 0.3}" stroke="${ACC}" stroke-width="${bad ? 1.4 : 0.6}" ${bad ? 'stroke-dasharray="3 2"' : ""}/>`;
    x = Math.min(520, x + r() * 46);
  }
  out += `<line x1="0" y1="225" x2="600" y2="225" stroke="${ACC}" stroke-width=".5" stroke-dasharray="2 4" opacity=".6"/>`;
  return out;
}

/* The brand mark, large, in white on the navy well. */
function mark() {
  return `<g transform="translate(250 105) scale(4.6)">
    <path d="M11 1 1 6l10 5 10-5z" fill="#f2f2f2"/>
    <path d="M1 10.5 11 15.5 21 10.5" fill="none" stroke="#f2f2f2" stroke-width="1.6"/>
    <path d="M1 14.5 11 19.5 21 14.5" fill="none" stroke="#f2f2f2" stroke-width="1.6" opacity=".55"/>
  </g>`;
}

/* A dot field where one cluster repeats: failures grouped by cause. */
function cluster(r) {
  let out = "";
  for (let y = 24; y < 320; y += 12) {
    for (let x = 20; x < 590; x += 12) {
      const dx = x - 400,
        dy = y - 160;
      const near = Math.hypot(dx, dy * 1.6) < 95;
      const on = near ? r() < 0.75 : r() < 0.08;
      if (on)
        out += `<circle cx="${x}" cy="${y}" r="${near ? 2 : 1.2}" fill="${ACC}" opacity="${near ? 0.85 : 0.35}"/>`;
    }
  }
  out += `<ellipse cx="400" cy="160" rx="110" ry="70" fill="none" stroke="${ACC}" stroke-width=".8" stroke-dasharray="4 3"/>`;
  return out;
}

/* A loop that keeps coming back to the same tool call. */
function loop(r) {
  let out = "";
  for (let k = 0; k < 9; k++) {
    const rx = 70 + k * 18 + r() * 6,
      ry = 40 + k * 11;
    out += `<ellipse cx="300" cy="160" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" stroke="${ACC}" stroke-width=".7" opacity="${(0.9 - k * 0.08).toFixed(2)}" transform="rotate(${(-8 + k * 2).toFixed(1)} 300 160)"/>`;
  }
  out += `<circle cx="300" cy="160" r="4" fill="${ACC}"/>`;
  return out;
}

/* Rows of a long trace read from the end backwards: lines fading leftward. */
function backwards(r) {
  let out = "";
  for (let i = 0; i < 26; i++) {
    const y = 20 + i * 11.5;
    const end = 560 - r() * 60;
    const start = 40 + r() * 200;
    out += `<line x1="${start.toFixed(1)}" y1="${y}" x2="${end.toFixed(1)}" y2="${y}" stroke="${ACC}" stroke-width=".8" opacity="${(0.15 + (i / 26) * 0.7).toFixed(2)}"/>`;
  }
  out += `<path d="M560 300 L560 20" stroke="${ACC}" stroke-width="1.2"/><path d="M552 30 560 18 568 30" fill="none" stroke="${ACC}" stroke-width="1.2"/>`;
  return out;
}

/* Careers plates. */
function wave(r) {
  let out = "";
  for (let k = 0; k < 22; k++) {
    let d = "";
    for (let x = 0; x <= 200; x += 4) {
      const y =
        100 +
        Math.sin(x / 26 + k * 0.12) * (50 - k * 1.2) +
        Math.cos(x / 9) * 2;
      d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`;
    }
    out += `<path d="${d}" fill="none" stroke="${ACC}" stroke-width=".5" opacity=".55"/>`;
  }
  return out;
}
function orbit() {
  let out = "";
  for (let k = 1; k <= 7; k++) {
    out += `<circle cx="${(150 - k * 9).toFixed(1)}" cy="130" r="${k * 18}" fill="none" stroke="${ACC}" stroke-width=".6" stroke-dasharray="${k % 2 ? "3 3" : "none"}" opacity=".7"/>`;
  }
  out += `<circle cx="150" cy="130" r="4" fill="${ACC}"/>`;
  return out;
}
function field() {
  let out = "";
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    out += `<ellipse cx="160" cy="135" rx="${(20 + t * 130).toFixed(1)}" ry="${(14 + t * 110).toFixed(1)}" fill="none" stroke="${ACC}" stroke-width=".5" opacity=".6"/>`;
  }
  for (let a = 0; a < 24; a++) {
    const th = (a / 24) * Math.PI * 2;
    out += `<line x1="160" y1="135" x2="${(160 + Math.cos(th) * 150).toFixed(1)}" y2="${(135 + Math.sin(th) * 124).toFixed(1)}" stroke="${ACC}" stroke-width=".4" opacity=".35"/>`;
  }
  out += `<circle cx="112" cy="135" r="4" fill="${ACC}"/><circle cx="208" cy="135" r="4" fill="${ACC}"/>`;
  return out;
}

const KINDS = { spans, mark, cluster, loop, backwards, wave, orbit, field };
const BOXES = {
  wave: "0 0 200 200",
  orbit: "0 0 300 260",
  field: "0 0 320 270",
};

export function drawFigures(root = document) {
  for (const host of root.querySelectorAll("[data-fig]")) {
    if (host.firstElementChild) continue;
    const kind = host.dataset.fig;
    const draw = KINDS[kind];
    if (!draw) continue;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", BOXES[kind] || "0 0 600 320");
    svg.setAttribute(
      "preserveAspectRatio",
      BOXES[kind] ? "xMidYMid meet" : "xMidYMid slice",
    );
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = draw(rng(Number(host.dataset.seed || 7)));
    host.appendChild(svg);
  }
}
