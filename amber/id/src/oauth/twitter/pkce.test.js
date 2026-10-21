import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { generatePkcePair } from "./pkce.js";

test("generatePkcePair returns S256 challenge derived from verifier", () => {
  const { codeVerifier, codeChallenge, codeChallengeMethod } =
    generatePkcePair();

  assert.equal(codeChallengeMethod, "S256");
  assert.match(codeVerifier, /^[A-Za-z0-9_-]+$/);
  assert.ok(codeVerifier.length >= 43 && codeVerifier.length <= 128);

  const expected = createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  assert.equal(codeChallenge, expected);
});

test("generatePkcePair produces fresh verifiers per call", () => {
  const a = generatePkcePair();
  const b = generatePkcePair();
  assert.notEqual(a.codeVerifier, b.codeVerifier);
  assert.notEqual(a.codeChallenge, b.codeChallenge);
});
