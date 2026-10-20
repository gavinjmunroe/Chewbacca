/**
 * Dashboard helpers — unit tests for the validation + SQL-building logic
 * that backs the inline /api/dnc, /api/social/connections, /api/social/stats,
 * /api/dnc/stats, and /dnc/sync/:platform routes in src/index.ts.
 *
 * Run:  npx tsx src/__tests__/dashboard.test.ts
 */

import assert from "node:assert/strict";
import {
  ALLOWED_SOCIAL_PLATFORMS,
  isAllowedSocialPlatform,
  isAllowedOrigin,
  requireProjectId,
  capLimit,
  buildSocialConnectionsQuery,
} from "../dashboard-helpers";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

function describe(suite: string, fn: () => void): void {
  process.stdout.write(`\n── ${suite}\n`);
  fn();
}

// ─── Platform allowlist ────────────────────────────────────────────────────

describe("platform allowlist", () => {
  test("accepts every known platform", () => {
    for (const p of ALLOWED_SOCIAL_PLATFORMS) {
      assert.equal(isAllowedSocialPlatform(p), true, `${p} should be allowed`);
    }
  });

  test("rejects SQL-injection probe", () => {
    assert.equal(isAllowedSocialPlatform("linkedin' OR 1=1--"), false);
  });

  test("rejects empty string", () => {
    assert.equal(isAllowedSocialPlatform(""), false);
  });

  test("rejects unknown platform", () => {
    assert.equal(isAllowedSocialPlatform("snapchat"), false);
  });

  test("is case-sensitive (LinkedIn != linkedin)", () => {
    assert.equal(isAllowedSocialPlatform("LinkedIn"), false);
  });
});

// ─── CORS allowlist ────────────────────────────────────────────────────────

describe("CORS allowlist", () => {
  test("accepts production MCP origin", () => {
    assert.equal(isAllowedOrigin("https://mcp.bluemodern.ai"), true);
  });

  test("accepts production Togari domain", () => {
    assert.equal(
      isAllowedOrigin("https://togari.bluemodernadvisory.com"),
      true,
    );
  });

  test("accepts localhost:3000 for dev", () => {
    assert.equal(isAllowedOrigin("http://localhost:3000"), true);
  });

  test("rejects attacker.com", () => {
    assert.equal(isAllowedOrigin("https://attacker.com"), false);
  });

  test("rejects subdomain spoof", () => {
    assert.equal(
      isAllowedOrigin("https://mcp.bluemodern.ai.attacker.com"),
      false,
    );
  });

  test("rejects http variant of production origin", () => {
    assert.equal(isAllowedOrigin("http://mcp.bluemodern.ai"), false);
  });

  test("rejects undefined", () => {
    assert.equal(isAllowedOrigin(undefined), false);
  });

  test("rejects origin with trailing path", () => {
    assert.equal(isAllowedOrigin("https://mcp.bluemodern.ai/x"), false);
  });
});

// ─── requireProjectId ──────────────────────────────────────────────────────

describe("requireProjectId", () => {
  test("throws when GCP_PROJECT_ID is unset", () => {
    const original = process.env.GCP_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;
    try {
      assert.throws(() => requireProjectId(), /GCP_PROJECT_ID/);
    } finally {
      if (original !== undefined) process.env.GCP_PROJECT_ID = original;
    }
  });

  test("returns the env value when set", () => {
    const original = process.env.GCP_PROJECT_ID;
    process.env.GCP_PROJECT_ID = "test-project-123";
    try {
      assert.equal(requireProjectId(), "test-project-123");
    } finally {
      if (original === undefined) delete process.env.GCP_PROJECT_ID;
      else process.env.GCP_PROJECT_ID = original;
    }
  });
});

// ─── capLimit ──────────────────────────────────────────────────────────────

describe("capLimit", () => {
  test("caps at 500 when value is 99999", () => {
    assert.equal(capLimit("99999"), 500);
  });

  test("caps at 500 when value is exactly 500", () => {
    assert.equal(capLimit("500"), 500);
  });

  test("returns the value when below cap", () => {
    assert.equal(capLimit("42"), 42);
  });

  test("falls back to 100 when value is missing", () => {
    assert.equal(capLimit(undefined), 100);
  });

  test("falls back to 100 when value is non-numeric", () => {
    assert.equal(capLimit("abc"), 100);
  });

  test("respects custom cap and fallback", () => {
    assert.equal(capLimit("9999", 250, 50), 250);
    assert.equal(capLimit(undefined, 250, 50), 50);
  });
});

// ─── buildSocialConnectionsQuery ───────────────────────────────────────────

describe("buildSocialConnectionsQuery", () => {
  test("with platform: parameterizes platform and limit", () => {
    const q = buildSocialConnectionsQuery("proj-1", "linkedin", 100);
    assert.match(q.sql, /WHERE platform = @platform/);
    assert.match(q.sql, /LIMIT @limit/);
    assert.deepEqual(q.params, { platform: "linkedin", limit: 100 });
    assert.deepEqual(q.types, { platform: "STRING", limit: "INT64" });
  });

  test("without platform: no WHERE clause, only @limit param", () => {
    const q = buildSocialConnectionsQuery("proj-1", undefined, 200);
    assert.doesNotMatch(q.sql, /WHERE/);
    assert.match(q.sql, /LIMIT @limit/);
    assert.deepEqual(q.params, { limit: 200 });
    assert.deepEqual(q.types, { limit: "INT64" });
  });

  test("never inlines user-supplied platform value into SQL", () => {
    const malicious = "linkedin' OR 1=1--";
    // The function happens to accept any string here; in the route this is
    // gated by isAllowedSocialPlatform first. Still, verify the value lands
    // in params, not the SQL string, so the second layer holds either way.
    const q = buildSocialConnectionsQuery("proj-1", malicious, 100);
    assert.equal(
      q.sql.includes(malicious),
      false,
      "malicious value must not appear in SQL string",
    );
    assert.equal(q.params.platform, malicious);
  });

  test("uses the given projectId in the table reference", () => {
    const q = buildSocialConnectionsQuery("custom-project", "linkedin", 100);
    assert.match(q.sql, /`custom-project\.togari_dnc\.social_connections`/);
  });
});

// ─── Results ────────────────────────────────────────────────────────────────

process.stdout.write("\n══════════════════════════════════════════════\n");
process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
process.stdout.write("══════════════════════════════════════════════\n");

if (failures.length > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) {
    process.stdout.write(`  ✗ ${f}\n`);
  }
  process.exit(1);
}

process.stdout.write("\nAll dashboard helper tests passed.\n");
