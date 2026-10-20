import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { verifyClayHmac } from "../../../src/ingest/clay/hmac";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(body: Buffer, secret = SECRET): string {
  return (
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

describe("verifyClayHmac", () => {
  it("accepts a valid signature with sha256= prefix", () => {
    const body = Buffer.from('{"clay_run_id":"r1"}');
    const sig = sign(body);
    expect(verifyClayHmac(body, sig, SECRET)).toEqual({ ok: true });
  });

  it("accepts a valid signature without the sha256= prefix (bare hex)", () => {
    const body = Buffer.from('{"clay_run_id":"r1"}');
    const sig = sign(body).slice("sha256=".length);
    expect(verifyClayHmac(body, sig, SECRET)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const body = Buffer.from('{"clay_run_id":"r1"}');
    const sig = sign(body);
    const tampered = Buffer.from('{"clay_run_id":"r2"}');
    expect(verifyClayHmac(tampered, sig, SECRET)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects when secret is missing", () => {
    const body = Buffer.from("{}");
    const result = verifyClayHmac(body, sign(body), undefined);
    expect(result).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("rejects when signature header is missing", () => {
    const body = Buffer.from("{}");
    expect(verifyClayHmac(body, undefined, SECRET)).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("rejects a malformed (non-hex) signature", () => {
    const body = Buffer.from("{}");
    expect(verifyClayHmac(body, "sha256=not-hex-at-all", SECRET)).toEqual({
      ok: false,
      reason: "malformed_signature",
    });
  });

  it("rejects a signature signed with a different secret", () => {
    const body = Buffer.from('{"clay_run_id":"r1"}');
    const wrongSig = sign(body, "different-secret");
    const result = verifyClayHmac(body, wrongSig, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_signature");
  });

  it("rejects a signature with the right alphabet but wrong length", () => {
    const body = Buffer.from("{}");
    // 32-char hex string — too short for sha256 (which is 64).
    const short = "sha256=" + "a".repeat(32);
    const result = verifyClayHmac(body, short, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_signature");
  });
});
