// The agents page in a normal browser tab, no Kyber. Kyber's web view hands
// the page its token before it runs; a browser tab has nothing like that, so
// on 10/12 a stranger's page came up blank ("server token not provided to
// renderer"). `realm-ui open` trades the token for a one-time launch code in
// the URL fragment, and bridge.js redeems it on load (server.mjs launchCodes).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  launchCodes,
  LAUNCH_CODE_TTL_MS,
} from "../bin/lib/realm_ui/server.mjs";

const BRIDGE = readFileSync(
  new URL("../bin/lib/realm_ui/bridge.js", import.meta.url),
  "utf8",
);

/** bridge.js in a plain browser tab: a hash, a server that answers redeem,
 *  and this tab's sessionStorage. */
function tab({ hash = "", answer = null, stored = null, preset } = {}) {
  const calls = { redeem: [], replaced: null };
  const storage = new Map(stored ? [["realm-ui-token", stored]] : []);
  class XMLHttpRequest {
    open(method, url, isAsync) {
      this.method = method;
      this.url = url;
      this.isAsync = isAsync;
    }
    setRequestHeader() {}
    send(body) {
      calls.redeem.push({ method: this.method, url: this.url, sync: this.isAsync === false, body });
      this.status = answer === null ? 403 : 200;
      this.responseText = answer ?? "code";
    }
  }
  const window = {
    addEventListener() {},
    XMLHttpRequest,
    location: { hash, pathname: "/", search: "" },
    history: { replaceState: (_s, _t, url) => (calls.replaced = url) },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, v),
    },
  };
  if (preset !== undefined) window.__realmUiToken = preset;
  vm.runInNewContext(BRIDGE, { window, document: {} });
  return { window, calls, storage };
}

test("a launch code in the fragment becomes the page's token, once, and leaves the address bar", () => {
  const { window, calls, storage } = tab({ hash: "#launch=abc_DEF-123", answer: "pipe-token" });
  assert.equal(window.realm.token, "pipe-token");
  assert.equal(calls.redeem.length, 1);
  assert.deepEqual(
    { ...calls.redeem[0] },
    { method: "POST", url: "/realm-launch/redeem", sync: true, body: "abc_DEF-123" },
  );
  assert.equal(calls.replaced, "/");
  assert.equal(storage.get("realm-ui-token"), "pipe-token");
});

test("a reload keeps working from this tab's own storage", () => {
  const { window, calls } = tab({ stored: "kept-token" });
  assert.equal(window.realm.token, "kept-token");
  assert.equal(calls.redeem.length, 0);
});

test("a refused or spent code leaves no token, and still strips the code", () => {
  const { window, calls } = tab({ hash: "#launch=spent", answer: null });
  assert.equal(window.realm.token, "");
  assert.equal(calls.replaced, "/");
});

test("on the glass Kyber's token wins and nothing is redeemed", () => {
  const { window, calls } = tab({ hash: "#launch=x", answer: "other", preset: "glass-token" });
  assert.equal(window.realm.token, "glass-token");
  assert.equal(calls.redeem.length, 0);
});

test("a page in a test with no location, storage or XHR still boots with no token", () => {
  const window = { addEventListener() {} };
  vm.runInNewContext(BRIDGE, { window, document: {} });
  assert.equal(window.realm.token, "");
});

test("a launch code works once and dies after its ttl", () => {
  let t = 1_000;
  const codes = launchCodes({ now: () => t });
  const a = codes.mint();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(codes.redeem(a), true);
  assert.equal(codes.redeem(a), false, "single use");
  const b = codes.mint();
  t += LAUNCH_CODE_TTL_MS + 1;
  assert.equal(codes.redeem(b), false, "expired");
  assert.equal(codes.redeem(undefined), false);
  assert.equal(codes.redeem("never-minted"), false);
});

test("a loop of mints cannot grow the code table without bound", () => {
  const codes = launchCodes();
  const all = Array.from({ length: 40 }, () => codes.mint());
  assert.equal(codes.redeem(all[0]), false, "oldest evicted");
  assert.equal(codes.redeem(all[39]), true);
});
