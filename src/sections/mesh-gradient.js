/* Our mesh gradient: a few coloured points drifting on slow orbits, blended
   by inverse distance, with the plane warped and twisted before the blend and
   a fine grain on top. One small WebGL canvas per use.

   Read off their shipped bundle on 2026-10-03, never copied from it: their
   CTA band and the voxel tops of the hero mark both mount a third-party
   MeshGradient (lazy chunk 8408) with one parameter set, quoted per constant
   below. The GLSL here is written for this repo.

   Two entry points:
     attachMeshGradient(host, opts)        fills an HTML box, returns cleanup
     attachMeshToSvgFaces(g, box, opts)    fills SVG polygons via a clipped
                                           foreignObject, returns {sync, cleanup}
   Both return null when WebGL is unavailable, so the caller keeps whatever
   CSS or SVG paint it already had. */

/* Their call sites, chunk 768 `28317` (CTA) and the hero `I` component, and
   the nav logo in 9815: all pass these colours in this order. */
export const MESH_COLORS = ["#322C8A", "#1D1956", "#5D4EE7"];

const DEFAULTS = {
  colors: MESH_COLORS,
  /* `speed: 0.4` at every call site. Their clock is 0.001 * ms * speed, and
     the shader runs at half that again, so one unit of orbit phase takes
     10s of wall time. */
  speed: 0.4,
  /* `distortion: 4`, `swirl: 1.2`, `grainMixer: 0.5`, `grainOverlay: 0.25`,
     identical at all three call sites. */
  distortion: 4,
  swirl: 1.2,
  grainMixer: 0.5,
  grainOverlay: 0.25,
};

/* Their renderer never drops below 2 device px per CSS px (minPixelRatio
   default 2) and caps the backing store at 8294400 px, one 4K frame. We cap
   the ratio AT 2 instead, per this repo's budget, and keep their pixel cap. */
const MAX_DPR = 2;
const MAX_PIXELS = 8294400;

/* Their shader adds a fixed 41.5 to the clock before halving it, so the
   first frame is already mid-drift rather than every point at its orbit
   start. Ours starts at a phase of the same size for the same reason; the
   value is ours, picked by eye against their CTA crop. */
const PHASE0 = 20;

/* Per-point orbit: x frequency, y frequency, x phase, y phase. Theirs derives
   frequencies 0.6..1.2 on x and 0.8..1.55 on y from the point index; these
   sit in the same ranges so the drift has the same unhurried pace. */
const ORBITS = [
  [0.63, 0.86, 0.0, 0.0],
  [0.94, 1.12, 0.41, 0.6],
  [1.21, 1.37, 0.79, 1.17],
  [0.71, 1.53, 1.13, 1.69],
  [1.05, 0.97, 1.5, 2.2],
];
const MAX_POINTS = ORBITS.length;

const REDUCED =
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_phase;
uniform vec3 u_col[${MAX_POINTS}];
uniform vec4 u_orbit[${MAX_POINTS}];
uniform float u_count;
uniform float u_warp;
uniform float u_twist;
uniform float u_jitter;
uniform float u_speckle;
uniform float u_grain;

float h2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 c = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h2(c);
  float b = h2(c + vec2(1.0, 0.0));
  float d = h2(c + vec2(0.0, 1.0));
  float e = h2(c + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

void main() {
  /* Fit contain: the unit square spans the shorter side, centred, and the
     longer side runs past 0..1. */
  float side = min(u_res.x, u_res.y);
  vec2 px = gl_FragCoord.xy - 0.5 * u_res;
  vec2 p = vec2(px.x, -px.y) / side + 0.5;

  float grain = vnoise(px * u_grain);
  float nudge = 0.4 * u_jitter * (grain - 0.5);

  float t = u_phase;
  float r = smoothstep(0.0, 1.0, length(p - 0.5));
  float pull = 1.0 - r;

  /* Two passes of centre-weighted warp, the second half the first. */
  for (int k = 1; k <= 2; k++) {
    float fk = float(k);
    float sy = smoothstep(0.0, 1.0, p.y);
    p.x += u_warp * pull / fk * sin(t + fk * 0.45 * sy) * cos(0.2 * t + fk * 2.3 * sy);
    float sx = smoothstep(0.0, 1.0, p.x);
    p.y += u_warp * pull / fk * cos(t + fk * 1.9 * sx);
  }

  /* Twist grows with distance from the centre. */
  float ang = -3.0 * u_twist * r;
  vec2 q = p - 0.5;
  q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q + 0.5;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (float(i) >= u_count) break;
    vec4 o = u_orbit[i];
    vec2 at = 0.5 + 0.5 * vec2(sin(t * o.x + o.z), cos(t * o.y + o.w)) + nudge;
    float d = pow(length(q - at), 3.5);
    float w = 1.0 / (d + 0.001);
    acc += u_col[i] * w;
    wsum += w;
  }
  vec3 col = acc / wsum;

  vec3 speck = vec3(
    vnoise(px * u_grain + vec2(13.0, 7.0)),
    vnoise(px * u_grain + vec2(-5.0, 29.0)),
    vnoise(px * u_grain + vec2(41.0, -3.0))
  );
  col = mix(col, speck, 0.01 + 0.3 * u_speckle);
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/* Builds the GL side on `canvas`. Returns null on any failure, with nothing
   logged: a missing context is an expected state, not an error. */
function makeRenderer(canvas, o) {
  let gl = null;
  try {
    gl =
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      }) || null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n) => gl.getUniformLocation(prog, n);
  const uRes = U("u_res"),
    uPhase = U("u_phase"),
    uGrain = U("u_grain");
  const colors = o.colors.slice(0, MAX_POINTS);
  gl.uniform3fv(U("u_col"), new Float32Array(colors.flatMap(hexToRgb)));
  gl.uniform4fv(U("u_orbit"), new Float32Array(ORBITS.flat()));
  gl.uniform1f(U("u_count"), colors.length);
  /* Their warp multiplies distortion straight into a unit-square offset;
     ours does the same, so 4 means the same large fold. */
  gl.uniform1f(U("u_warp"), o.distortion);
  gl.uniform1f(U("u_twist"), o.swirl);
  gl.uniform1f(U("u_jitter"), o.grainMixer);
  gl.uniform1f(U("u_speckle"), o.grainOverlay);

  return {
    gl,
    /* scale: backing px per on-screen CSS px. Their grain is value noise at
       0.7 per device px on a canvas that never drops below 2x, so it reads
       at 1.4 cycles per CSS px. We cap at 2x and may render at 1x, so the
       frequency is set from CSS px to keep the same grain at any ratio. */
    draw(phase, scale) {
      gl.uniform1f(uGrain, (0.7 * 2) / scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uPhase, phase);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

/* Fills `host` (positioned, any size) with a canvas and runs the mesh.
   `onLost` fires if the context is lost later, so the caller can bring its
   fallback paint back. Returns a cleanup function, or null if WebGL is
   unavailable, in which case nothing was added to the DOM. */
export function attachMeshGradient(host, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const canvas = document.createElement("canvas");
  canvas.className = "mg-canvas";
  canvas.setAttribute("aria-hidden", "true");
  /* Optional CSS clip-path on the canvas, e.g. "polygon(50% 10%, ...)".
     Their cube plate (lazy chunk 5061) cuts the mesh to the top face this
     way, with the face's vertices as % of the figure box. */
  if (o.clip) canvas.style.clipPath = o.clip;
  const ren = makeRenderer(canvas, o);
  if (!ren) return null;
  host.appendChild(canvas);

  /* Elapsed time is banked, so a pause (offscreen, hidden tab) resumes the
     drift where it stopped instead of jumping. */
  let elapsed = 0,
    scale = 1,
    last = 0,
    raf = 0,
    onScreen = false,
    dead = false;
  const phase = () => PHASE0 + 0.5 * 0.001 * elapsed * o.speed;

  function size() {
    /* getBoundingClientRect, not offsetWidth: inside a scaled SVG
       foreignObject the layout box is in user units and the on-screen size
       is what the backing store should follow. */
    const r = host.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    let w = r.width * dpr,
      h = r.height * dpr;
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    scale = w / r.width;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return true;
  }

  function frame(now) {
    raf = 0;
    if (dead) return;
    if (last) elapsed += now - last;
    last = now;
    ren.draw(phase(), scale);
    if (running()) raf = requestAnimationFrame(frame);
  }
  const running = () => !REDUCED && onScreen && !document.hidden;
  function update() {
    if (dead) return;
    if (running()) {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  /* One still frame: reduced motion, and after a resize while paused, so a
     resized canvas never shows cleared black. */
  function still() {
    if (!dead && size()) ren.draw(phase(), scale);
  }

  const io = new IntersectionObserver(
    (entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) still();
      update();
    },
    { rootMargin: "100px 0px" },
  );
  io.observe(host);
  const onVis = () => update();
  document.addEventListener("visibilitychange", onVis);
  /* ResizeObserver catches box changes; the window listener catches an SVG
     rescale, which changes the on-screen size without touching the box. */
  const ro = new ResizeObserver(() => still());
  ro.observe(host);
  const onResize = () => still();
  window.addEventListener("resize", onResize);

  const onLost = (e) => {
    e.preventDefault();
    teardown();
    options.onLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  still();

  function teardown() {
    if (dead) return;
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("resize", onResize);
    canvas.removeEventListener("webglcontextlost", onLost);
    if (!ren.gl.isContextLost()) ren.dispose();
    canvas.remove();
  }
  /* For a clip that moves (a spinning cube's top face), set it per frame. */
  teardown.setClip = (clip) => {
    canvas.style.clipPath = clip;
  };
  return teardown;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
let clipSeq = 0;

/* For SVG faces, the way theirs clips the hero mark: one foreignObject over
   the whole stage box carries the canvas, and one clipPath made of every
   visible top face cuts it down to the tops. Appended to `parent` (a <g>), so
   it paints above whatever `parent` already holds and hides with it.

   box: [x, y, w, h] in the SVG's user units. Theirs is the stage box,
   -1200 -800 2400 1500, so the colour field spans the whole scene and each
   top shows its own patch of it rather than a full gradient per cube.

   clipToFaces: false skips the clipPath, for a `parent` that is already
   clipped (our cube's <g clip-path="url(#cube-top)">); sync is then a no-op.

   Returns { sync(dList), cleanup } or null without WebGL. Call sync with the
   `d` strings of the faces visible this frame; it reuses clip paths, so a
   per-frame call costs one setAttribute per face. */
export function attachMeshToSvgFaces(parent, box, options = {}) {
  const svg = parent.ownerSVGElement || parent;
  const id = `mg-clip-${++clipSeq}`;
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", id);
  const fo = document.createElementNS(SVG_NS, "foreignObject");
  const [x, y, w, h] = box;
  fo.setAttribute("x", x);
  fo.setAttribute("y", y);
  fo.setAttribute("width", w);
  fo.setAttribute("height", h);
  const clipped = options.clipToFaces !== false;
  if (clipped) fo.setAttribute("clip-path", `url(#${id})`);
  fo.setAttribute("pointer-events", "none");
  const host = document.createElementNS(XHTML_NS, "div");
  host.setAttribute("class", "mg-host");
  fo.appendChild(host);

  let defs = svg.querySelector(":scope > defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  if (clipped) defs.appendChild(clip);
  parent.appendChild(fo);

  const stop = attachMeshGradient(host, {
    ...options,
    onLost: () => {
      fo.remove();
      clip.remove();
      options.onLost?.();
    },
  });
  if (!stop) {
    fo.remove();
    clip.remove();
    return null;
  }

  const pool = [];
  function sync(dList) {
    let n = 0;
    for (const d of dList) {
      let p = pool[n];
      if (!p) {
        p = document.createElementNS(SVG_NS, "path");
        pool.push(p);
        clip.appendChild(p);
      }
      if (p.getAttribute("d") !== d) p.setAttribute("d", d);
      if (p.style.display) p.style.display = "";
      n++;
    }
    for (let i = n; i < pool.length; i++) pool[i].style.display = "none";
  }

  return {
    sync,
    cleanup() {
      stop();
      fo.remove();
      clip.remove();
    },
  };
}
