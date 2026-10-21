/**
 * The kitchen page's arithmetic. The failures these guard against are the
 * ones the old draft shipped: overlays that drifted off their object at some
 * window sizes, and a light that did not match the visitor's clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  lightFor,
  parseLight,
  pickCamera,
  coverView,
  zoomView,
  toScreen,
  boundsOf,
  clockAngles,
  msToNextMinute,
  isCompletePhone,
  phoneDigits,
  phoneGroups,
} from "./fridge.js";
import { isManifest, PLACEHOLDER } from "./fridge-manifest.js";

const CAMS = {
  wide: { width: 3840, height: 2160 },
  tall: { width: 1080, height: 2340 },
};

test("light follows the visitor's clock", () => {
  assert.equal(lightFor(6), "morning");
  assert.equal(lightFor(10), "morning");
  assert.equal(lightFor(11), "golden");
  assert.equal(lightFor(17), "golden");
  assert.equal(lightFor(18), "night");
  assert.equal(lightFor(23), "night");
  assert.equal(lightFor(2), "night");
  assert.equal(parseLight("golden"), "golden");
  assert.equal(parseLight("noon"), null);
  assert.equal(parseLight(null), null);
});

test("the camera is picked by aspect, never cropped across", () => {
  assert.equal(pickCamera(1440, 900, CAMS), "wide");
  assert.equal(pickCamera(1024, 768, CAMS), "wide");
  assert.equal(pickCamera(390, 844, CAMS), "tall");
  assert.equal(pickCamera(768, 1024, CAMS), "tall");
  const same = { wide: CAMS.wide, tall: CAMS.wide };
  assert.equal(pickCamera(390, 844, same), "tall");
  assert.equal(pickCamera(1440, 900, same), "wide");
});

test("cover fills the viewport and never leaves a gap", () => {
  for (const [vw, vh] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [2560, 1080],
    [720, 450], // a 1440x900 window at 200% browser zoom
  ]) {
    for (const focus of [undefined, [0, 0], [100, 100], [31, 52]]) {
      const v = coverView(3840, 2160, vw, vh, focus);
      assert.ok(v.x <= 1e-9 && v.y <= 1e-9, "starts at or left of the edge");
      assert.ok(v.x + 3840 * v.scale >= vw - 1e-6, "reaches the right edge");
      assert.ok(v.y + 2160 * v.scale >= vh - 1e-6, "reaches the bottom edge");
    }
  }
});

test("a hotspot maps through the same transform as the still", () => {
  // At 16:9 nothing is cropped, so 25% across is a quarter of the screen.
  const v = coverView(3840, 2160, 1920, 1080);
  assert.deepEqual(toScreen([25, 50], 3840, 2160, v), [480, 540]);
  // At 4:3 the sides are cropped equally around the centre.
  const w = coverView(3840, 2160, 1024, 768);
  const [cx] = toScreen([50, 50], 3840, 2160, w);
  assert.ok(Math.abs(cx - 512) < 1e-6);
});

test("the focus point is kept as central as the crop allows", () => {
  const v = coverView(3840, 2160, 390, 844, [31, 52]);
  const [x] = toScreen([31, 52], 3840, 2160, v);
  assert.ok(Math.abs(x - 195) < 1e-6);
});

test("zooming centres the journal page and keeps a margin", () => {
  const rect = [64, 40, 8, 19.8];
  const v = zoomView(3840, 2160, 1440, 900, rect, 0.08);
  const [x0, y0] = toScreen([rect[0], rect[1]], 3840, 2160, v);
  const [x1, y1] = toScreen(
    [rect[0] + rect[2], rect[1] + rect[3]],
    3840,
    2160,
    v,
  );
  assert.ok(Math.abs((x0 + x1) / 2 - 720) < 1e-6);
  assert.ok(Math.abs((y0 + y1) / 2 - 450) < 1e-6);
  assert.ok(y0 >= 900 * 0.08 - 1e-6 && y1 <= 900 * 0.92 + 1e-6);
});

test("bounds of a polygon", () => {
  assert.deepEqual(
    boundsOf([
      [1, 2],
      [5, 2],
      [5, 9],
    ]),
    [1, 2, 4, 7],
  );
});

test("clock hands point at the real time", () => {
  const at = (h, m) => clockAngles(new Date(2026, 9, 7, h, m, 0));
  assert.deepEqual(at(12, 0), { hour: 0, minute: 0 });
  assert.deepEqual(at(3, 0), { hour: 90, minute: 0 });
  assert.deepEqual(at(15, 30), { hour: 105, minute: 180 });
  assert.equal(msToNextMinute(new Date(2026, 9, 7, 9, 0, 59, 500)), 500);
});

test("only a complete US number goes in", () => {
  assert.equal(isCompletePhone("555 010 0002"), true);
  assert.equal(isCompletePhone("+1 (555) 010-0002"), true);
  assert.equal(isCompletePhone("310 429 628"), false);
  assert.equal(isCompletePhone("110 429 6285"), false);
  assert.equal(phoneDigits("1-555-010-0002"), "5550100002");
  assert.deepEqual(phoneGroups("5550100002"), ["310", "429", "6285"]);
  assert.deepEqual(phoneGroups("3104"), ["310", "4"]);
  assert.deepEqual(phoneGroups(""), []);
});

test("the placeholder manifest is a manifest the page can draw", () => {
  assert.ok(isManifest(PLACEHOLDER));
  assert.equal(PLACEHOLDER.objects.length, 5);
  assert.equal(
    PLACEHOLDER.shelf.hotspot.wide.length,
    PLACEHOLDER.shelf.years.length,
  );
  for (const o of PLACEHOLDER.objects) {
    for (const cam of ["wide", "tall"]) {
      for (const light of ["morning", "golden", "night"]) {
        const [x, y, w, h] = o.clip[cam][light].rect;
        assert.ok(
          x >= 0 && y >= 0 && x + w <= 100 && y + h <= 100,
          `${o.id} ${cam} rect inside frame`,
        );
      }
    }
  }
  assert.equal(isManifest({ version: 1 }), false);
  assert.equal(isManifest(null), false);
});
