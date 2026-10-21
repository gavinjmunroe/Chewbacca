/**
 * Where the links this service puts in emails point.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { webBaseUrl } from "./email-delivery.js";

/**
 * A LINK IN AN EMAIL POINTS SOMEWHERE THAT EXISTS.
 *
 * The default used to be app.amberintelligence.com, a placeholder from before
 * the site had an address. Every invitation issued without AMBER_WEB_BASE_URL
 * set carried a link to nowhere, and it failed as a 404 in somebody else's
 * browser, days later, with nothing in our logs. A test rather than a careful
 * default, because the next placeholder will look just as plausible.
 */
test("the request's own origin wins, when it is one we already allow", () => {
  const before = process.env.AMBER_WEB_ORIGINS;
  process.env.AMBER_WEB_ORIGINS = "https://amberintelligence.ai,https://www.amberintelligence.ai";
  try {
    assert.equal(
      webBaseUrl({ headers: { origin: "https://www.amberintelligence.ai" } }),
      "https://www.amberintelligence.ai",
    );
  } finally {
    process.env.AMBER_WEB_ORIGINS = before;
  }
});

test("an origin we do not allow is ignored, not echoed into an email", () => {
  const before = process.env.AMBER_WEB_ORIGINS;
  process.env.AMBER_WEB_ORIGINS = "https://amberintelligence.ai";
  try {
    const out = webBaseUrl({ headers: { origin: "https://evil.example" } });
    assert.ok(!out.includes("evil.example"), `a forged origin reached an email: ${out}`);
  } finally {
    process.env.AMBER_WEB_ORIGINS = before;
  }
});

test("no request at all still points at a real domain", () => {
  const before = process.env.AMBER_WEB_BASE_URL;
  delete process.env.AMBER_WEB_BASE_URL;
  try {
    const out = webBaseUrl();
    assert.ok(out.endsWith("amberintelligence.ai"), `default base url is ${out}`);
  } finally {
    if (before) process.env.AMBER_WEB_BASE_URL = before;
  }
});
