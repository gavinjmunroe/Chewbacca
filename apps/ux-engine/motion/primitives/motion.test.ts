// Run: node apps/ux-engine/motion/primitives/motion.test.ts  (Node 22.18+)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bell,
  createFollower,
  cubeTurn,
  cubicBezierYForX,
  depthHalfLife,
  dipToColor,
  directionalBlurStdDev,
  echoWeights,
  follow,
  influenceToCss,
  lerpToHalfLife,
  motionBlurPx,
  parallax,
  posterizeTime,
  push,
  rangeAmount,
  revealText,
  spring,
  staggerProgress,
  tripleWheel,
  unitCss,
  valueAt,
  wheelTurn,
  whip,
  whipCurve,
} from "./motion.ts";

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("cubic bezier hits its endpoints and matches linear on the diagonal", () => {
  near(cubicBezierYForX(0.333, 0, 0.667, 1, 0), 0);
  near(cubicBezierYForX(0.333, 0, 0.667, 1, 1), 1);
  near(cubicBezierYForX(1 / 3, 1 / 3, 2 / 3, 2 / 3, 0.37), 0.37, 1e-5);
});

// The same assertions as FilmCraft's own bezier_eases test in keyframe.rs.
test("bezier keyframes ease like FilmCraft: slow start, symmetric midpoint", () => {
  const keys = [
    { t: 0, v: 0, interp: "bezier" as const },
    { t: 100, v: 100, interp: "bezier" as const },
  ];
  assert.ok(valueAt(keys, 10) < 10, "ease-in start should be slow");
  near(valueAt(keys, 50), 50, 1);
});

test("hold keyframes step, linear keyframes interpolate, ends clamp", () => {
  const hold = [
    { t: 0, v: 0, interp: "hold" as const },
    { t: 10, v: 5 },
  ];
  assert.equal(valueAt(hold, 9.9), 0);
  assert.equal(valueAt(hold, 10), 5);
  const lin = [
    { t: 0, v: 0 },
    { t: 10, v: 10 },
  ];
  near(valueAt(lin, 4), 4);
  assert.equal(valueAt(lin, -5), 0);
  assert.equal(valueAt(lin, 50), 10);
});

test("higher influence makes a slower start and a faster middle", () => {
  const k = (inf: number) => [
    {
      t: 0,
      v: 0,
      interp: "bezier" as const,
      outInfluence: inf,
      inInfluence: inf,
    },
    {
      t: 1,
      v: 1,
      interp: "bezier" as const,
      outInfluence: inf,
      inInfluence: inf,
    },
  ];
  assert.ok(valueAt(k(0.8), 0.15) < valueAt(k(1 / 3), 0.15));
  assert.equal(influenceToCss(0.8, 0.8), "cubic-bezier(0.8, 0, 0.2, 1)");
});

test("ramp up selector: offset -100 hides every char, offset 100 rests every char", () => {
  for (let i = 0; i < 6; i++) {
    assert.equal(rangeAmount(i, 6, { shape: "rampUp", offset: -100 }), 1);
    assert.equal(rangeAmount(i, 6, { shape: "rampUp", offset: 100 }), 0);
  }
  // mid sweep reveals left to right: earlier chars are further along
  const mid = [0, 1, 2, 3, 4, 5].map((i) =>
    rangeAmount(i, 6, { shape: "rampUp", offset: 0 }),
  );
  for (let i = 1; i < 6; i++) assert.ok(mid[i] >= mid[i - 1]);
});

test("square selector with smoothness 0 is a hard window", () => {
  assert.equal(
    rangeAmount(0, 4, { shape: "square", start: 50, end: 100, smoothness: 0 }),
    0,
  );
  assert.equal(
    rangeAmount(3, 4, { shape: "square", start: 50, end: 100, smoothness: 0 }),
    1,
  );
});

test("jayd3n reveal starts hidden and blurred, ends at rest", () => {
  const start = revealText(6, 0);
  const end = revealText(6, 1);
  for (const u of start) {
    assert.equal(u.opacity, 0);
    assert.equal(u.blur, 45);
    assert.equal(u.y, 100);
  }
  for (const u of end) {
    assert.equal(u.opacity, 1);
    assert.equal(u.blur, 0);
    assert.equal(u.y, 0);
  }
  const css = unitCss(end[0]);
  assert.equal(css.filter, "none");
  assert.equal(css.opacity, "1.000");
});

test("stagger progress: first unit leads, last unit trails, all finish at p=1", () => {
  assert.ok(staggerProgress(0, 5, 0.3) > staggerProgress(4, 5, 0.3));
  for (let i = 0; i < 5; i++) assert.equal(staggerProgress(i, 5, 1), 1);
});

test("triple wheel puts the active phrase at the reading angle in full ink", () => {
  const w = tripleWheel(1, { readingAngle: -35, radius: 200 });
  near(w[1].angle, -35);
  assert.equal(w[1].ink, 1);
  assert.equal(w[0].ink, 0);
  assert.equal(w[2].ink, 0);
  // spokes are 120 degrees apart
  near(w[2].angle - w[1].angle, 120);
  // every phrase is rotated to read left to right (within 90 degrees of level)
  for (const it of w) {
    const r = (((it.rotation % 360) + 540) % 360) - 180;
    assert.ok(Math.abs(r) <= 90, `rotation ${it.rotation}`);
  }
  // wraps: index 2 to 0 is one step away
  const wrap = tripleWheel(2.5);
  near(wrap[0].ink, 0.5);
});

test("wheel turn and whip: fast middle, blur peaks mid-turn and vanishes at the ends", () => {
  near(whipCurve(0), 0);
  near(whipCurve(1), 1);
  assert.ok(whipCurve(0.4) < 0.4 && whipCurve(0.6) > 0.6);
  const a = wheelTurn(0.02, 0, 1);
  const m = wheelTurn(0.5, 0, 1);
  assert.ok(m.blurPx > a.blurPx * 5);
  near(wheelTurn(1, 0, 1).active, 1);
  const w0 = whip(0, 1000);
  const w1 = whip(1, 1000);
  near(w0.outOffset, 0);
  near(w0.inOffset, -1000);
  near(w1.inOffset, 0);
  near(w0.blurPx, 0);
  near(whip(0.5, 1000).blurPx, 0.8 * 1000 * 0.18);
});

test("FilmCraft transitions honour the contract: p=0 is A, p=1 is B", () => {
  const p0 = push(0, 500);
  const p1 = push(1, 500);
  near(p0.outOffset, 0);
  near(p1.inOffset, 0);
  assert.deepEqual(dipToColor(0, 0.2), { a: 1, color: 0, b: 0 });
  const d1 = dipToColor(1, 0.2);
  near(d1.b, 1);
  assert.equal(dipToColor(0.5, 0.2).color, 1);
  near(cubeTurn(0, 100).angle, 0);
  near(cubeTurn(1, 100).angle, 90);
  near(cubeTurn(0.5, 100).pushBack, 45);
  near(bell(0), 0);
  near(bell(0.5), 1);
});

test("spring lands on 1 and overshoots on the way", () => {
  near(spring(1, 0.5), 1);
  let max = 0;
  for (let i = 0; i <= 100; i++) max = Math.max(max, spring(i / 100, 0.5));
  assert.ok(max > 1.01);
});

test("motion blur, echo and posterize helpers", () => {
  assert.equal(motionBlurPx(40, 180), 20);
  const [sx, sy] = directionalBlurStdDev(12, 1, 0);
  near(sx, 12 / Math.sqrt(12));
  near(sy, 0);
  assert.deepEqual(echoWeights(2, 1, 0.5), [1, 0.5, 0.25]);
  near(posterizeTime(0.13, 12), 1 / 12);
});

test("follower halves the gap every half-life regardless of frame rate", () => {
  near(follow(0, 100, 100, 100), 50);
  const a = createFollower(0, 100);
  for (let i = 0; i < 10; i++) a.step(100, 10);
  near(a.value, 50, 1e-9);
  // a per-frame lerp of 0.1 at 60 fps is about a 110 ms half-life
  near(lerpToHalfLife(0.1, 60), 109.7, 0.2);
});

test("parallax: depth 0 tracks the page, depth 1 moves at half speed, farther lags more", () => {
  assert.equal(parallax(400, 0).translate, 0);
  assert.equal(parallax(400, 1).translate, 200);
  assert.equal(parallax(400, 1).speed, 0.5);
  assert.ok(depthHalfLife(2) > depthHalfLife(0));
});
