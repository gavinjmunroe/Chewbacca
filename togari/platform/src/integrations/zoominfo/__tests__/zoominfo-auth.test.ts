import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";

vi.mock("../../../secrets/manager", () => ({
  getOptionalSecret: async (name: string) =>
    process.env[name.replace(/-/g, "_").toUpperCase()] || undefined,
  getSecret: async (name: string) => {
    const v = process.env[name.replace(/-/g, "_").toUpperCase()];
    if (!v) throw new Error(`Secret "${name}" not found`);
    return v;
  },
}));
import {
  _resetZoomInfoAuthCacheForTests,
  buildClientJwt,
  getZoomInfoAccessToken,
  getZoomInfoCredentials,
  invalidateZoomInfoToken,
} from "../auth";
import { onFetch, getMockState } from "../../../../tests/smoke/helpers";

/**
 * Generate a real RSA keypair once for the whole suite so the buildClientJwt
 * signature is genuinely verifiable. Cheap (< 100ms) and gives us a true PKI
 * round-trip rather than mocking createSign.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function base64UrlToBuffer(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  const payload = parts[1];
  if (!payload) throw new Error("malformed jwt");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function verifyJwt(jwt: string): boolean {
  const [headerB64, payloadB64, sigB64] = jwt.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  return verifier.verify(publicKey, base64UrlToBuffer(sigB64));
}

beforeEach(() => {
  _resetZoomInfoAuthCacheForTests();
  process.env.ZOOMINFO_USERNAME = "test-user";
  process.env.ZOOMINFO_CLIENT_ID = "test-client-id";
  // Simulate the way Railway / Vercel pass private keys: literal \n
  // sequences instead of real newlines. The auth layer must normalize them.
  process.env.ZOOMINFO_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
});

describe("getZoomInfoCredentials", () => {
  it("returns the triple when all three env vars are set", async () => {
    const creds = await getZoomInfoCredentials("test_tenant");
    expect(creds).not.toBeNull();
    expect(creds!.username).toBe("test-user");
    expect(creds!.clientId).toBe("test-client-id");
    // The escaped \n must have been replaced with real newlines so PEM parsers work.
    expect(creds!.privateKey.includes("\\n")).toBe(false);
    expect(creds!.privateKey).toMatch(/BEGIN PRIVATE KEY/);
  });

  it("returns null when any field is missing", async () => {
    delete process.env.ZOOMINFO_CLIENT_ID;
    const creds = await getZoomInfoCredentials("test_tenant");
    expect(creds).toBeNull();
  });
});

describe("buildClientJwt", () => {
  it("signs an RS256 JWT with the supplied private key", async () => {
    const creds = (await getZoomInfoCredentials("test_tenant"))!;
    const jwt = buildClientJwt(creds);
    expect(verifyJwt(jwt)).toBe(true);

    const payload = decodeJwtPayload(jwt);
    expect(payload.aud).toBe("enterprise_api");
    expect(payload.username).toBe("test-user");
    expect(payload.client_id).toBe("test-client-id");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(
      (payload.exp as number) - (payload.iat as number),
    ).toBeLessThanOrEqual(5 * 60);
  });
});

describe("getZoomInfoAccessToken", () => {
  it("fetches an access token from /authenticate and caches it per tenant", async () => {
    const fakeServerJwt =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString("base64url") +
      ".sig";

    onFetch("api.zoominfo.com/authenticate", () => ({ jwt: fakeServerJwt }));

    const token = await getZoomInfoAccessToken("test_tenant");
    expect(token).toBe(fakeServerJwt);

    const callsBefore = getMockState().fetch.calls.length;
    const second = await getZoomInfoAccessToken("test_tenant");
    const callsAfter = getMockState().fetch.calls.length;

    // Cache hit: no additional auth request issued.
    expect(second).toBe(fakeServerJwt);
    expect(callsAfter).toBe(callsBefore);
  });

  it("refreshes after invalidateZoomInfoToken", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = (id: string) =>
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(JSON.stringify({ exp, id })).toString("base64url") +
      ".sig";

    let counter = 0;
    onFetch("api.zoominfo.com/authenticate", () => ({
      jwt: payload(`call-${++counter}`),
    }));

    const first = await getZoomInfoAccessToken("test_tenant");
    invalidateZoomInfoToken("test_tenant");
    const second = await getZoomInfoAccessToken("test_tenant");
    expect(first).not.toBe(second);
  });

  it("throws a clear error when credentials are missing", async () => {
    delete process.env.ZOOMINFO_USERNAME;
    await expect(getZoomInfoAccessToken("test_tenant")).rejects.toThrow(
      /not configured for tenant test_tenant/,
    );
  });

  it("dedupes concurrent auth requests for the same tenant", async () => {
    const fakeServerJwt =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString("base64url") +
      ".sig";

    let authCalls = 0;
    onFetch("api.zoominfo.com/authenticate", () => {
      authCalls++;
      return { jwt: fakeServerJwt };
    });

    const [t1, t2, t3] = await Promise.all([
      getZoomInfoAccessToken("test_tenant"),
      getZoomInfoAccessToken("test_tenant"),
      getZoomInfoAccessToken("test_tenant"),
    ]);
    expect(t1).toBe(fakeServerJwt);
    expect(t2).toBe(fakeServerJwt);
    expect(t3).toBe(fakeServerJwt);
    expect(authCalls).toBe(1);
  });
});
