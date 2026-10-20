/**
 * Tests for SqlSanitizer (validation + tenant injection) and BigQueryClient.executeQuery().
 *
 * Run: npx tsx src/__tests__/sql-generator.test.ts
 *
 * Mirrors the assertion-throwing style of src/tests/governance.test.ts so the
 * same tsx-runnable flow works without Jest.
 */

import assert from "node:assert/strict";
import { SqlSanitizer } from "../services/sql-generator";
import { BigQueryClient, type QueryParams } from "../services/bigquery-client";

// ─── Test runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      // Async test — caller is expected to await
      (result as Promise<void>)
        .then(() => {
          passed++;
          process.stdout.write(`  ✓ ${name}\n`);
        })
        .catch((err) => {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${name}: ${msg}`);
          process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
        });
      return;
    }
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

async function describe(
  suite: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  process.stdout.write(`\n── ${suite}\n`);
  await fn();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SqlSanitizer.validate
// ═══════════════════════════════════════════════════════════════════════════

describe("SqlSanitizer.validate — mutation rejection", () => {
  test("rejects INSERT", () => {
    assert.throws(() => SqlSanitizer.validate("INSERT INTO foo VALUES (1)"));
  });

  test("rejects UPDATE", () => {
    assert.throws(() => SqlSanitizer.validate("UPDATE foo SET x = 1"));
  });

  test("rejects DELETE", () => {
    assert.throws(() => SqlSanitizer.validate("DELETE FROM foo"));
  });

  test("rejects DROP", () => {
    assert.throws(() => SqlSanitizer.validate("DROP TABLE foo"));
  });

  test("rejects MERGE", () => {
    assert.throws(() => SqlSanitizer.validate("MERGE INTO foo USING bar"));
  });

  test("rejects stacked statements (SELECT ; DROP)", () => {
    assert.throws(() =>
      SqlSanitizer.validate("SELECT * FROM foo; DROP TABLE bar"),
    );
  });

  test("rejects mutation hidden in subquery", () => {
    assert.throws(() =>
      SqlSanitizer.validate(
        "SELECT * FROM foo WHERE id IN (SELECT id FROM bar UPDATE)",
      ),
    );
  });

  test("rejects empty / non-SELECT input", () => {
    assert.throws(() => SqlSanitizer.validate("FOO BAR BAZ"));
  });

  test("accepts plain SELECT", () => {
    assert.doesNotThrow(() => SqlSanitizer.validate("SELECT * FROM foo"));
  });

  test("accepts WITH ... SELECT (CTE)", () => {
    assert.doesNotThrow(() =>
      SqlSanitizer.validate("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    );
  });

  test("accepts SELECT with WHERE / ORDER BY / LIMIT", () => {
    assert.doesNotThrow(() =>
      SqlSanitizer.validate(
        "SELECT * FROM foo WHERE x = 'a' ORDER BY y LIMIT 10",
      ),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SqlSanitizer.injectTenant
// ═══════════════════════════════════════════════════════════════════════════

describe("SqlSanitizer.injectTenant — tenant predicate", () => {
  test("appends WHERE when none exists", () => {
    const out = SqlSanitizer.injectTenant("SELECT * FROM foo");
    assert.match(out, /WHERE\s+client_id\s*=\s*@clientId/);
  });

  test("prepends to existing WHERE", () => {
    const out = SqlSanitizer.injectTenant("SELECT * FROM foo WHERE x = 1");
    assert.match(out, /WHERE\s+client_id\s*=\s*@clientId\s+AND\s+x\s*=\s*1/);
  });

  test("inserts before ORDER BY when no WHERE", () => {
    const out = SqlSanitizer.injectTenant("SELECT * FROM foo ORDER BY x");
    // Tenant predicate must come before ORDER BY
    const wherePos = out.search(/WHERE\s+client_id/);
    const orderPos = out.search(/ORDER\s+BY/);
    assert.ok(wherePos !== -1, "WHERE should be present");
    assert.ok(orderPos !== -1, "ORDER BY should remain");
    assert.ok(wherePos < orderPos, "WHERE must come before ORDER BY");
  });

  test("inserts before LIMIT when no WHERE", () => {
    const out = SqlSanitizer.injectTenant("SELECT * FROM foo LIMIT 10");
    const wherePos = out.search(/WHERE\s+client_id/);
    const limitPos = out.search(/LIMIT/);
    assert.ok(wherePos !== -1 && wherePos < limitPos);
  });

  test("does not inject into a subquery WHERE", () => {
    const out = SqlSanitizer.injectTenant(
      "SELECT * FROM foo WHERE id IN (SELECT id FROM bar WHERE x = 1)",
    );
    // Outer WHERE keeps its tenant predicate; subquery WHERE x = 1 stays untouched
    assert.match(out, /WHERE\s+client_id\s*=\s*@clientId\s+AND\s+id\s+IN/);
    assert.match(out, /SELECT id FROM bar WHERE x = 1/);
  });

  test("CTE — injects into outermost SELECT, not the CTE body", () => {
    const out = SqlSanitizer.injectTenant(
      "WITH cte AS (SELECT 1 AS a) SELECT * FROM cte",
    );
    // Outer SELECT must have the tenant predicate
    assert.match(out, /SELECT \* FROM cte\s+WHERE\s+client_id\s*=\s*@clientId/);
    // CTE body untouched
    assert.match(out, /WITH cte AS \(SELECT 1 AS a\)/);
  });

  test("strips trailing semicolon", () => {
    const out = SqlSanitizer.injectTenant("SELECT * FROM foo;");
    assert.ok(!out.endsWith(";"));
    assert.match(out, /WHERE\s+client_id\s*=\s*@clientId/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SqlSanitizer.sanitize — full pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("SqlSanitizer.sanitize — full pipeline", () => {
  test("returns sql, params, rawSql for a valid SELECT", () => {
    const result = SqlSanitizer.sanitize("SELECT * FROM foo", "bma");
    assert.equal(result.params.clientId, "bma");
    assert.equal(result.rawSql, "SELECT * FROM foo");
    assert.match(result.sql, /WHERE\s+client_id\s*=\s*@clientId/);
  });

  test("throws on a mutation", () => {
    assert.throws(() => SqlSanitizer.sanitize("DELETE FROM foo", "bma"));
  });

  test("preserves rawSql exactly as input", () => {
    const raw = "select * from foo where x = 1";
    const result = SqlSanitizer.sanitize(raw, "bma");
    assert.equal(result.rawSql, raw);
    // Sanitized SQL has the tenant predicate added
    assert.match(result.sql, /client_id\s*=\s*@clientId/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. BigQueryClient.executeQuery — params forwarding + cross-tenant guard
// ═══════════════════════════════════════════════════════════════════════════

interface CapturedJob {
  query: string;
  params?: Record<string, unknown>;
  types?: Record<string, string>;
  useLegacySql?: boolean;
}

function makeMockClient(rows: Record<string, unknown>[] = []): {
  client: BigQueryClient;
  captured: CapturedJob[];
} {
  const captured: CapturedJob[] = [];
  const fakeBq = {
    createQueryJob: async (job: CapturedJob) => {
      captured.push(job);
      return [
        {
          getQueryResults: async () => [
            rows,
            null,
            { schema: { fields: [{ name: "id", type: "STRING" }] } },
          ],
        },
      ];
    },
  };
  const client = new BigQueryClient("test-project");
  // Replace internal client with our mock — accessing via cast to avoid changing the public API
  (client as unknown as { client: typeof fakeBq }).client = fakeBq;
  return { client, captured };
}

(async () => {
  await describe("BigQueryClient.executeQuery — params forwarding", async () => {
    await asyncTest("forwards clientId param + STRING type", async () => {
      const { client, captured } = makeMockClient([{ id: "1" }]);
      const params: QueryParams = { clientId: "bma" };
      await client.executeQuery(
        "SELECT * FROM foo WHERE client_id = @clientId",
        params,
      );
      assert.equal(captured.length, 1);
      assert.deepEqual(captured[0].params, { clientId: "bma" });
      assert.deepEqual(captured[0].types, { clientId: "STRING" });
      assert.equal(captured[0].useLegacySql, false);
    });

    await asyncTest("forwards extra params with STRING type", async () => {
      const { client, captured } = makeMockClient();
      const params: QueryParams = { clientId: "bma", email: "a@b.com" };
      await client.executeQuery(
        "SELECT * FROM foo WHERE client_id = @clientId AND email = @email",
        params,
      );
      assert.deepEqual(captured[0].params, {
        clientId: "bma",
        email: "a@b.com",
      });
      assert.deepEqual(captured[0].types, {
        clientId: "STRING",
        email: "STRING",
      });
    });

    await asyncTest(
      'falls back to clientId="unknown" when params omitted',
      async () => {
        const { client, captured } = makeMockClient();
        await client.executeQuery("SELECT * FROM foo");
        assert.deepEqual(captured[0].params, { clientId: "unknown" });
        assert.deepEqual(captured[0].types, { clientId: "STRING" });
      },
    );

    await asyncTest("caps returned rows at 200", async () => {
      const manyRows = Array.from({ length: 250 }, (_, i) => ({
        id: String(i),
      }));
      const { client } = makeMockClient(manyRows);
      const result = await client.executeQuery(
        "SELECT * FROM foo WHERE client_id = @clientId",
        { clientId: "bma" },
      );
      assert.equal(result.rows.length, 200);
      assert.equal(result.totalRows, 250);
    });
  });

  await describe("BigQueryClient.executeQuery — defense-in-depth", async () => {
    await asyncTest("rejects non-SELECT (DELETE)", async () => {
      const { client } = makeMockClient();
      await assert.rejects(
        () => client.executeQuery("DELETE FROM foo", { clientId: "bma" }),
        /Only SELECT queries are permitted/,
      );
    });

    await asyncTest("rejects non-SELECT (UPDATE)", async () => {
      const { client } = makeMockClient();
      await assert.rejects(
        () => client.executeQuery("UPDATE foo SET x = 1", { clientId: "bma" }),
        /Only SELECT queries are permitted/,
      );
    });

    await asyncTest(
      "accepts our own injected client_id = @clientId predicate",
      async () => {
        const { client } = makeMockClient();
        // This SQL has the literal predicate that SqlSanitizer.injectTenant adds.
        // The cross-tenant check must NOT trigger on our own injection.
        await client.executeQuery(
          "SELECT * FROM foo WHERE client_id = @clientId AND email = @email",
          { clientId: "bma", email: "a@b.com" },
        );
      },
    );

    await asyncTest(
      'rejects literal cross-tenant filter (client_id = "evil")',
      async () => {
        const { client } = makeMockClient();
        await assert.rejects(
          () =>
            client.executeQuery("SELECT * FROM foo WHERE client_id = 'evil'", {
              clientId: "bma",
            }),
          /Cross-tenant query attempt blocked/,
        );
      },
    );

    await asyncTest("rejects client_id IN (...) attack", async () => {
      const { client } = makeMockClient();
      await assert.rejects(
        () =>
          client.executeQuery(
            "SELECT * FROM foo WHERE client_id IN ('a','b')",
            { clientId: "bma" },
          ),
        /Cross-tenant query attempt blocked/,
      );
    });

    await asyncTest("accepts WITH ... SELECT", async () => {
      const { client } = makeMockClient();
      await client.executeQuery(
        "WITH cte AS (SELECT 1 AS a) SELECT * FROM cte WHERE client_id = @clientId",
        { clientId: "bma" },
      );
    });
  });

  await describe("BigQueryClient.writeToolAudit — extras forward-compat", async () => {
    function makeAuditMock(): {
      client: BigQueryClient;
      captured: {
        params?: Record<string, unknown>;
        types?: Record<string, string>;
      }[];
    } {
      const captured: {
        params?: Record<string, unknown>;
        types?: Record<string, string>;
      }[] = [];
      const fakeBq = {
        query: async (job: {
          params?: Record<string, unknown>;
          types?: Record<string, string>;
        }) => {
          captured.push(job);
          return [[]];
        },
      };
      const client = new BigQueryClient("test-project");
      (client as unknown as { client: typeof fakeBq }).client = fakeBq;
      return { client, captured };
    }

    await asyncTest(
      "extras absent — no stderr warning, only known columns written",
      async () => {
        const { client, captured } = makeAuditMock();
        const stderrWrites: string[] = [];
        const origWrite = process.stderr.write.bind(process.stderr);
        (process.stderr.write as unknown as (chunk: string) => boolean) = (
          chunk: string,
        ) => {
          stderrWrites.push(chunk);
          return true;
        };
        try {
          await client.writeToolAudit({
            clientId: "bma",
            toolName: "query_contacts",
            durationMs: 42,
            success: true,
          });
        } finally {
          process.stderr.write = origWrite;
        }
        assert.equal(
          stderrWrites.filter((s) => s.includes("[audit]")).length,
          0,
          "should not warn when extras absent",
        );
        const params = captured[0].params!;
        assert.equal(params.client_id, "bma");
        // Forward-compat fields must NOT appear in params yet
        assert.ok(!("signal_type" in params));
        assert.ok(!("opportunity_score" in params));
      },
    );

    await asyncTest(
      "extras passed — warns to stderr, does not write extras to BQ",
      async () => {
        const { client, captured } = makeAuditMock();
        const stderrWrites: string[] = [];
        const origWrite = process.stderr.write.bind(process.stderr);
        (process.stderr.write as unknown as (chunk: string) => boolean) = (
          chunk: string,
        ) => {
          stderrWrites.push(chunk);
          return true;
        };
        try {
          await client.writeToolAudit({
            clientId: "bma",
            toolName: "query_contacts",
            durationMs: 42,
            success: true,
            extras: { signal_type: "funding", opportunity_score: 0.87 },
          });
        } finally {
          process.stderr.write = origWrite;
        }
        const auditWarning = stderrWrites.find((s) => s.includes("[audit]"));
        assert.ok(auditWarning, "should emit a stderr warning");
        assert.match(auditWarning!, /signal_type/);
        assert.match(auditWarning!, /opportunity_score/);
        // BQ params still only contain known columns
        const params = captured[0].params!;
        assert.ok(!("signal_type" in params));
        assert.ok(!("opportunity_score" in params));
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════

  // Give pending sync test() calls a tick to flush before printing results
  await new Promise((resolve) => setImmediate(resolve));

  process.stdout.write("\n══════════════════════════════════\n");
  process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
  process.stdout.write("══════════════════════════════════\n");

  if (failures.length > 0) {
    process.stdout.write("\nFailures:\n");
    for (const f of failures) {
      process.stdout.write(`  ✗ ${f}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("\nAll sql-generator + bigquery-client tests passed.\n");
})();
