/**
 * THE SCOPE CLAIM HAS TO SURVIVE THE ROUND TRIP, AND NOT BE FORGEABLE.
 *
 * A scope that does not come back out of the token is a restriction that
 * silently is not applied. A scope that can be edited by whoever holds the
 * token is not a restriction at all.
 */

process.env.AMBER_JWT_SECRET ||= "unit-test-secret-not-a-real-one-0123456789";

import test from "node:test";
import assert from "node:assert/strict";

const { signSessionToken, verifySessionToken } = await import("./amber-jwt.js");

const DID = "did:amber:11111111-1111-1111-1111-111111111111";
const PHONE = "+15550001111";

test("a token minted without a scope verifies with scope null", () => {
  const { token } = signSessionToken({ did: DID, phone: PHONE });
  const claims = verifySessionToken(token);
  assert.equal(claims.scope, null, "an app token grew a restriction");
  assert.equal(claims.did, DID);
});

test("a scope survives the round trip", () => {
  const { token } = signSessionToken({
    did: DID,
    phone: PHONE,
    scope: ["network:read", "contacts:read"],
  });
  assert.deepEqual(verifySessionToken(token).scope, ["network:read", "contacts:read"]);
});

test("EDITING THE SCOPE INVALIDATES THE TOKEN", () => {
  // The whole point. If a holder can widen their own scope, none of this means
  // anything.
  const { token } = signSessionToken({ did: DID, phone: PHONE, scope: ["contacts:read"] });
  const [h, , s] = token.split(".");
  const forged = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  );
  forged.scope = ["network:read", "contacts:read", "everything:write"];
  const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`;
  assert.equal(verifySessionToken(tampered), null, "a forged scope verified");
});

test("a shorter ttl is honored, and the default is not shortened", () => {
  const short = signSessionToken({ did: DID, phone: PHONE, scope: ["contacts:read"], ttlSeconds: 60 });
  const normal = signSessionToken({ did: DID, phone: PHONE });
  assert.ok(short.expiresAt < normal.expiresAt, "the scoped token did not expire sooner");
});

test("an empty scope array is refused rather than minted", () => {
  // A token that can do nothing is what `.filter()` on junk produces. Minting
  // it would 403 on every route and read as a server fault.
  assert.throws(() => signSessionToken({ did: DID, phone: PHONE, scope: [] }));
});

test("duplicate scopes collapse", () => {
  const { token } = signSessionToken({
    did: DID, phone: PHONE, scope: ["contacts:read", "contacts:read"],
  });
  assert.deepEqual(verifySessionToken(token).scope, ["contacts:read"]);
});
