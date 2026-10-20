/**
 * API key generation + hashing tests.
 *
 * Pure functions only — no BigQuery side. Integration paths (issue → verify
 * round-trip, middleware reject of revoked keys) are exercised manually via
 * curl against `npm run dev` per the WS-2 acceptance criteria.
 *
 * Run:  npx tsx src/__tests__/api-keys.test.ts
 */

import assert from "node:assert/strict";

import { base32Encode, generateRawKey, hashKey } from "../dnc/auth/api-keys";
import { validateApiKey } from "../dnc/auth/api-key-middleware";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    })
    .catch((err: unknown) => {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}\n    ${msg}`);
      process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
    });
}

async function base32Vectors() {
  process.stdout.write("\nbase32Encode — RFC 4648 vectors (no padding)\n");
  const cases: Array<[string, string]> = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [input, expected] of cases) {
    await test(`"${input}" → "${expected}"`, () => {
      const out = base32Encode(Buffer.from(input, "utf8"));
      assert.equal(out, expected);
    });
  }
}

async function generateRawKeyShape() {
  process.stdout.write("\ngenerateRawKey\n");

  await test("starts with tgi_live_ prefix", () => {
    assert.ok(generateRawKey().startsWith("tgi_live_"));
  });

  await test("encodes 32 random bytes (~52 base32 chars + 9 prefix)", () => {
    const key = generateRawKey();
    assert.equal(key.length, "tgi_live_".length + 52);
  });

  await test("uses only RFC 4648 base32 alphabet after prefix", () => {
    const key = generateRawKey();
    const body = key.slice("tgi_live_".length);
    assert.match(body, /^[A-Z2-7]+$/);
  });

  await test("two calls return distinct keys (randomness sanity)", () => {
    assert.notEqual(generateRawKey(), generateRawKey());
  });
}

async function hashKeyShape() {
  process.stdout.write("\nhashKey\n");

  await test("returns 64-char lowercase hex", () => {
    const h = hashKey("tgi_live_TESTKEY");
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  await test("is deterministic for identical input", () => {
    assert.equal(hashKey("tgi_live_X"), hashKey("tgi_live_X"));
  });

  await test("different inputs produce different hashes", () => {
    assert.notEqual(hashKey("tgi_live_A"), hashKey("tgi_live_B"));
  });

  await test("never returns the raw key itself", () => {
    const raw = generateRawKey();
    assert.notEqual(hashKey(raw), raw);
  });
}

function makeRes(): {
  res: import("express").Response;
  status: { code: number | null };
  body: { value: unknown };
} {
  const status = { code: null as number | null };
  const body = { value: undefined as unknown };
  const res = {
    status(c: number) {
      status.code = c;
      return res;
    },
    json(b: unknown) {
      body.value = b;
      return res;
    },
    send() {
      return res;
    },
    locals: {} as Record<string, unknown>,
  } as unknown as import("express").Response;
  return { res, status, body };
}

async function middlewareFormatChecks() {
  process.stdout.write("\nvalidateApiKey — format guards\n");

  await test("rejects missing Authorization header with 401", async () => {
    const req = {
      header: () => undefined,
    } as unknown as import("express").Request;
    const { res, status } = makeRes();
    let nextCalled = false;
    await validateApiKey(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(status.code, 401);
  });

  await test("rejects non-Bearer scheme with 401", async () => {
    const req = {
      header: (n: string) =>
        n.toLowerCase() === "authorization" ? "Basic abc" : undefined,
    } as unknown as import("express").Request;
    const { res, status } = makeRes();
    let nextCalled = false;
    await validateApiKey(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(status.code, 401);
  });

  await test("rejects wrong key prefix with 401 (never hits BQ)", async () => {
    const req = {
      header: (n: string) =>
        n.toLowerCase() === "authorization"
          ? "Bearer sk_live_whatever"
          : undefined,
    } as unknown as import("express").Request;
    const { res, status } = makeRes();
    let nextCalled = false;
    await validateApiKey(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(status.code, 401);
  });
}

async function main() {
  process.stdout.write("API key generation + middleware tests\n");
  await base32Vectors();
  await generateRawKeyShape();
  await hashKeyShape();
  await middlewareFormatChecks();

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.stdout.write("\nFailures:\n");
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `Test runner crashed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
