import React, { createContext, useContext } from "react";
import { Easing, interpolate } from "remotion";

/*
 * Camera: frames a 1080x1920 world. The world is drawn in frame-sized coordinates; the
 * camera state says which world point sits at the frame centre and how it is zoomed/rolled.
 *   Cam { x, y }  world point at the frame centre (default 540, 960 = identity)
 *   zoom          1 = 1:1, 2 = twice as close (default 1)
 *   rot           camera roll in degrees (default 0)
 * <Camera> renders its own full-frame <svg>. Put <Layer depth={…}> children directly inside
 * it (or inside another Layer) for parallax. Anything not in a Layer sits at depth 1.
 */
export type Cam = { x: number; y: number; zoom: number; rot: number };
export type Offset = { x: number; y: number; rot: number };
export const CAM0: Cam = { x: 540, y: 960, zoom: 1, rot: 0 };
const W = 1080, H = 1920, CX = W / 2, CY = H / 2;

// A camera keyframe: at `frame` the camera reaches `cam` (missing fields carry over from the
// previous key). The segment INTO this key uses `ease` (default ease-in-out).
export type Key = [frame: number, cam: Partial<Cam>, ease?: (t: number) => number];
const inOut = Easing.bezier(0.45, 0, 0.55, 1);

export const camAt = (fr: number, keys: Key[]): Cam => {
  let prev: Cam = { ...CAM0, ...keys[0]?.[1] };
  if (!keys.length || fr <= keys[0][0]) return prev;
  for (let i = 1; i < keys.length; i++) {
    const [k1, c1, e = inOut] = keys[i];
    const next: Cam = { ...prev, ...c1 };
    const k0 = keys[i - 1][0];
    if (fr < k1) {
      const t = interpolate(fr, [k0, k1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
      // zoom interpolates in log space so zoom moves feel even
      return {
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
        zoom: Math.exp(Math.log(prev.zoom) + (Math.log(next.zoom) - Math.log(prev.zoom)) * t),
        rot: prev.rot + (next.rot - prev.rot) * t,
      };
    }
    prev = next;
  }
  return prev;
};

// Impact shake: a decaying jolt starting at frame `start`. strength ~ px of the first kick.
export const shake = (fr: number, start: number, strength = 24, dur = 18): Offset => {
  const k = (fr - start) / dur;
  if (k < 0 || k > 1) return { x: 0, y: 0, rot: 0 };
  const a = strength * (1 - k) * (1 - k);
  const t = fr - start;
  return { x: a * Math.sin(t * 2.3 + 0.5), y: a * 0.8 * Math.cos(t * 2.9), rot: a * 0.03 * Math.sin(t * 1.7) };
};

// Slow handheld drift. amount 1 ≈ ±10px and ±0.35°.
export const handheld = (fr: number, amount = 1, seed = 0): Offset => ({
  x: amount * (Math.sin(fr * 0.031 + seed) * 6 + Math.sin(fr * 0.077 + seed * 2.1) * 4),
  y: amount * (Math.sin(fr * 0.027 + seed * 1.3 + 1) * 6 + Math.sin(fr * 0.069 + seed * 0.7) * 3),
  rot: amount * (Math.sin(fr * 0.019 + seed * 0.5) * 0.25 + Math.sin(fr * 0.053 + seed) * 0.1),
});

// SVG transform that maps world -> screen for a layer at `depth` (1 = world plane,
// 0 = glued to the screen/infinitely far, >1 = foreground that moves faster).
export const parallax = (cam: Cam, depth = 1) => {
  const x = CX + (cam.x - CX) * depth, y = CY + (cam.y - CY) * depth, z = Math.pow(cam.zoom, depth);
  return `translate(${CX} ${CY}) rotate(${cam.rot}) scale(${z}) translate(${-x} ${-y})`;
};
// Screen -> world for a layer at `depth` (the inverse of parallax).
export const inverse = (cam: Cam, depth: number) => {
  const x = CX + (cam.x - CX) * depth, y = CY + (cam.y - CY) * depth, z = Math.pow(cam.zoom, depth);
  return `translate(${x} ${y}) scale(${1 / z}) rotate(${-cam.rot}) translate(${-CX} ${-CY})`;
};
// Screen point of a world point at a given depth (to aim FX or captions at something).
export const toScreen = (cam: Cam, p: [number, number], depth = 1): [number, number] => {
  const x = CX + (cam.x - CX) * depth, y = CY + (cam.y - CY) * depth, z = Math.pow(cam.zoom, depth);
  const dx = (p[0] - x) * z, dy = (p[1] - y) * z, r = (cam.rot * Math.PI) / 180;
  return [CX + dx * Math.cos(r) - dy * Math.sin(r), CY + dx * Math.sin(r) + dy * Math.cos(r)];
};

const Ctx = createContext<{ cam: Cam; depth: number }>({ cam: CAM0, depth: 1 });
export const useCam = () => useContext(Ctx).cam;

type CameraProps = {
  fr?: number; // needed for keys / handheld
  cam?: Partial<Cam>; // a fixed camera (or one you computed yourself)
  keys?: Key[]; // keyframed camera (wins over cam)
  handheld?: number; // drift amount, 0 = locked off
  seed?: number;
  shake?: Offset | Offset[]; // e.g. [shake(fr, hit1), shake(fr, hit2, 40)]
  background?: string; // fills the frame behind everything
  children: React.ReactNode;
};
// Film-wide near layer: Film.tsx provides a foreground for the current shot (or null) and every
// Camera draws it at depth 1.3 over its own children, so it moves with that shot's camera.
export const NearLayer = createContext<React.ReactNode>(null);

export const Camera: React.FC<CameraProps> = ({ fr = 0, cam, keys, handheld: hh = 0, seed = 0, shake: sh, background, children }) => {
  const near = useContext(NearLayer);
  const c: Cam = keys ? camAt(fr, keys) : { ...CAM0, ...cam };
  const offs = [hh ? handheld(fr, hh, seed) : null, ...(Array.isArray(sh) ? sh : sh ? [sh] : [])].filter(Boolean) as Offset[];
  const o = offs.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, rot: a.rot + b.rot }), { x: 0, y: 0, rot: 0 });
  // Shake/handheld zoom in 3% so the frame edge never shows.
  const pad = offs.length ? 1.03 : 1;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "hidden", background }}>
      <g transform={`translate(${CX + o.x} ${CY + o.y}) rotate(${o.rot}) scale(${pad}) translate(${-CX} ${-CY})`}>
        <Ctx.Provider value={{ cam: c, depth: 1 }}>
          <g transform={parallax(c, 1)}>
            {/* a camera nested inside this one (a screen insert) never draws it again */}
            <NearLayer.Provider value={null}>{children}</NearLayer.Provider>
            {near && <Layer depth={1.3}>{near}</Layer>}
          </g>
        </Ctx.Provider>
      </g>
    </svg>
  );
};

// A parallax layer. depth 0.2 = far background, 1 = world, 1.4 = near foreground.
// Far layers must be drawn wider than the frame if the camera pans a lot.
export const Layer: React.FC<{ depth: number; children: React.ReactNode; opacity?: number }> = ({ depth, children, opacity }) => {
  const { cam, depth: parent } = useContext(Ctx);
  return (
    <Ctx.Provider value={{ cam, depth }}>
      <g transform={`${inverse(cam, parent)} ${parallax(cam, depth)}`} opacity={opacity}>{children}</g>
    </Ctx.Provider>
  );
};
