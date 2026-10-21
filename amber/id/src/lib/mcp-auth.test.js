/**
 * THE DOOR HAS TO OPEN FOR THE CLIENTS THAT EXIST.
 *
 * /mcp is what Claude, Cursor and Perplexity connect to. Most of them can send
 * exactly one credential header: `Authorization: Bearer <token>`. A server that
 * reads only `x-api-key` is not one you can add anywhere.
 *
 * The second test is the one that matters more: widening WHICH header carries
 * the key must not widen WHAT counts as a key. A Privy user JWT arrives in the
 * same header and must still be refused.
 */

import test from "node:test";
import assert from "node:assert/strict";

delete process.env.AMBER_ID_API_KEY;
delete process.env.DEFAULT_OWNER_DID;
process.env.AMBER_ID_API_KEYS = JSON.stringify([
  { name: "clay", key: "key-for-clay", did: "did:privy:clay-owner" },
]);

const { requireMcpKey } = await import("./auth.js");
const { _resetNamedApiKeysCache } = await import("./instance.js");
_resetNamedApiKeysCache();

function fakeReply() {
  const r = { statusCode: null, payload: null };
  r.code = (c) => {
    r.statusCode = c;
    return r;
  };
  r.send = (p) => {
    r.payload = p;
    return r;
  };
  return r;
}
const run = async (headers) => {
  const request = { headers };
  const reply = fakeReply();
  await requireMcpKey(request, reply);
  return { request, reply };
};

test("a key in x-api-key is accepted, as it always was", async () => {
  const { request, reply } = await run({ "x-api-key": "key-for-clay" });
  assert.equal(reply.statusCode, null);
  assert.equal(request.serviceAuth, true);
});

test("THE SAME KEY AS A BEARER TOKEN IS ACCEPTED", async () => {
  const { request, reply } = await run({ authorization: "Bearer key-for-clay" });
  assert.equal(reply.statusCode, null, JSON.stringify(reply.payload));
  assert.equal(request.serviceAuth, true);
});

test("the owner DID bound to the key is stamped either way", async () => {
  const viaHeader = await run({ "x-api-key": "key-for-clay" });
  const viaBearer = await run({ authorization: "Bearer key-for-clay" });
  assert.equal(
    viaHeader.request.ownerDid,
    viaBearer.request.ownerDid,
    "the same key produced different owners depending on the header",
  );
  assert.ok(viaBearer.request.ownerDid);
});

test("'bearer' in any casing works, because clients disagree about it", async () => {
  const { reply } = await run({ authorization: "bearer key-for-clay" });
  assert.equal(reply.statusCode, null);
});

test("A BEARER TOKEN THAT IS NOT AN API KEY IS STILL REFUSED", async () => {
  // A Privy user JWT arrives in exactly this header. Accepting the header must
  // not mean accepting the credential.
  const { request, reply } = await run({
    authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.not-an-api-key.signature",
  });
  assert.equal(reply.statusCode, 401);
  assert.notEqual(request.serviceAuth, true);
});

test("no credential at all is refused", async () => {
  const { reply } = await run({});
  assert.equal(reply.statusCode, 401);
});

test("x-api-key wins when both are present, so a stale Bearer cannot shadow it", async () => {
  const { reply } = await run({
    "x-api-key": "key-for-clay",
    authorization: "Bearer something-else-entirely",
  });
  assert.equal(reply.statusCode, null);
});

test("the refusal says which headers work, because that is the whole problem", async () => {
  const { reply } = await run({ authorization: "Bearer nope" });
  assert.match(String(reply.payload?.message ?? ""), /Bearer/);
  assert.match(String(reply.payload?.message ?? ""), /x-api-key/);
});
