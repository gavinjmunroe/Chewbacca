/**
 * Deal Store tenant-scoping tests.
 *
 * Verifies that searchDeals, listDeals, updateDeal, and createDeal all
 * carry a client_id predicate to BigQuery, and that calling them outside
 * a runWithTenantContext() scope (with no override) throws rather than
 * silently issuing an unscoped query.
 *
 * Run:  npx tsx src/__tests__/deal-store.test.ts
 *
 * BigQuery is monkey-patched at the prototype level so no network calls
 * happen. The patched `query` records every SQL + params pair and serves
 * deterministic responses for SELECT/UPDATE/INSERT shapes used here.
 */

import assert from "node:assert/strict";
import { BigQuery } from "@google-cloud/bigquery";

import {
  createDeal,
  searchDeals,
  listDeals,
  updateDeal,
  getDealsDigest,
  type DealStoreConfig,
} from "../agents/middle-of-funnel/deal-store";
import { runWithTenantContext } from "../middleware/auth";

// ─── Test infra ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    })
    .catch((err: unknown) => {
      failed++;
      const msg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      failures.push(`${name}: ${msg}`);
      process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
    });
}

function describe(suite: string): void {
  process.stdout.write(`\n── ${suite}\n`);
}

// ─── BigQuery mock ─────────────────────────────────────────────────────────

interface CapturedCall {
  query: string;
  params: Record<string, unknown> | undefined;
}

const captured: CapturedCall[] = [];

// In-memory store used by the round-trip test so SELECT returns the
// rows that INSERT just wrote. Keyed by deal_id.
const dealStore = new Map<string, Record<string, unknown>>();

type QueryHandler = (
  q: string,
  params: Record<string, unknown> | undefined,
) => unknown[];

let queryHandler: QueryHandler = () => [];

function setQueryHandler(h: QueryHandler): void {
  queryHandler = h;
}

function resetMockState(): void {
  captured.length = 0;
  dealStore.clear();
  queryHandler = () => [];
}

// Replace BigQuery.prototype.query so every getBqClient(...) instance
// routes through our mock. Returns BigQuery's tuple shape: [rows, ...].
(BigQuery.prototype as unknown as { query: unknown }).query = function (opts: {
  query: string;
  params?: Record<string, unknown>;
}): Promise<unknown[][]> {
  captured.push({ query: opts.query, params: opts.params });
  const rows = queryHandler(opts.query, opts.params);
  return Promise.resolve([rows]);
};

const config: DealStoreConfig = {
  projectId: "test-project",
  dataset: "test_dataset",
  table: "togari_structured_deals",
};

const lastCall = (): CapturedCall => {
  const c = captured[captured.length - 1];
  if (!c) throw new Error("no captured BQ call");
  return c;
};

// ─── Tests ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  describe("requireClientId enforcement");

  await test("searchDeals throws when called outside runWithTenantContext with no override", async () => {
    resetMockState();
    await assert.rejects(
      () => searchDeals(config, { query: "acme" }),
      /No tenant context/,
    );
    assert.equal(captured.length, 0, "no BQ call should be issued");
  });

  await test("listDeals throws when called outside runWithTenantContext with no override", async () => {
    resetMockState();
    await assert.rejects(() => listDeals(config, {}), /No tenant context/);
    assert.equal(captured.length, 0);
  });

  await test("updateDeal throws when called outside runWithTenantContext with no override", async () => {
    resetMockState();
    await assert.rejects(
      () => updateDeal(config, { deal_id: "deal-1", stage: "contacted" }),
      /No tenant context/,
    );
    assert.equal(captured.length, 0);
  });

  describe("Tenant predicate is injected on every read/write");

  await test("searchDeals SQL contains WHERE client_id = @client_id", async () => {
    resetMockState();
    setQueryHandler(() => []);
    await searchDeals(config, { query: "acme", clientId: "bma" });
    const call = lastCall();
    assert.match(call.query, /WHERE client_id = @client_id/);
    assert.equal(call.params?.["client_id"], "bma");
    assert.equal(call.params?.["q"], "%acme%");
  });

  await test("searchDeals with pipeline still tenant-scoped, both predicates present", async () => {
    resetMockState();
    setQueryHandler(() => []);
    await searchDeals(config, {
      query: "acme",
      pipeline: "outbound",
      clientId: "bma",
    });
    const call = lastCall();
    assert.match(call.query, /WHERE client_id = @client_id/);
    assert.match(call.query, /AND pipeline = @pipeline/);
    assert.equal(call.params?.["pipeline"], "outbound");
  });

  await test("listDeals (no options) issues SQL with client_id predicate from async context", async () => {
    resetMockState();
    setQueryHandler(() => []);
    await runWithTenantContext("bma", undefined, async () => {
      await listDeals(config, {});
    });
    const call = lastCall();
    assert.match(call.query, /WHERE client_id = @client_id/);
    assert.equal(call.params?.["client_id"], "bma");
  });

  await test("listDeals with pipeline + owner stacks predicates AND-wise", async () => {
    resetMockState();
    setQueryHandler(() => []);
    await listDeals(config, {
      clientId: "bma",
      pipeline: "outbound",
      owner: "caleb",
    });
    const call = lastCall();
    assert.match(call.query, /WHERE client_id = @client_id/);
    assert.match(call.query, /AND pipeline = @pipeline/);
    assert.match(call.query, /AND LOWER\(owner\) = LOWER\(@owner\)/);
    assert.equal(call.params?.["client_id"], "bma");
    assert.equal(call.params?.["pipeline"], "outbound");
    assert.equal(call.params?.["owner"], "caleb");
  });

  describe("updateDeal cross-tenant isolation");

  await test("updateDeal for a deal owned by another tenant throws 'Deal not found'", async () => {
    resetMockState();
    // Existence check returns 0 rows because client_id doesn't match
    setQueryHandler((sql) => {
      if (/^SELECT deal_id FROM/.test(sql.trim())) return [];
      return [];
    });
    await assert.rejects(
      () =>
        updateDeal(config, {
          deal_id: "deal-other-tenant",
          stage: "negotiating",
          clientId: "bma",
        }),
      /Deal not found/,
    );
    // Existence query was issued and was tenant-scoped; the UPDATE was not.
    assert.equal(captured.length, 1);
    assert.match(
      captured[0].query,
      /WHERE deal_id = @deal_id AND client_id = @client_id/,
    );
    assert.equal(captured[0].params?.["client_id"], "bma");
  });

  await test("updateDeal UPDATE statement carries the tenant predicate", async () => {
    resetMockState();
    setQueryHandler((sql) => {
      if (/^SELECT deal_id FROM/.test(sql.trim())) {
        return [{ deal_id: "deal-1" }];
      }
      return [];
    });
    await updateDeal(config, {
      deal_id: "deal-1",
      stage: "negotiating",
      clientId: "bma",
    });
    // 2 calls: existence check + UPDATE
    assert.equal(captured.length, 2);
    const update = captured[1];
    assert.match(update.query, /^UPDATE/);
    assert.match(
      update.query,
      /WHERE deal_id = @deal_id AND client_id = @client_id/,
    );
    assert.equal(update.params?.["client_id"], "bma");
    assert.equal(update.params?.["deal_id"], "deal-1");
  });

  describe("createDeal + searchDeals round-trip via async context");

  await test("createDeal then searchDeals returns the row inside runWithTenantContext", async () => {
    resetMockState();
    // Mock store: INSERT writes to the map; SELECT returns matching rows.
    setQueryHandler((sql, params) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith("INSERT INTO")) {
        const id = String(params?.["deal_id"]);
        dealStore.set(id, {
          deal_id: id,
          client_id: params?.["client_id"] ?? null,
          deal_name: params?.["deal_name"],
          company: params?.["company"],
          contact_ids: params?.["contact_ids"] ?? [],
          value: null,
          pipeline: params?.["pipeline"],
          stage: params?.["stage"],
          owner: params?.["owner"],
          close_date: null,
          notes: null,
          next_action: params?.["next_action"],
          next_action_date: params?.["next_action_date"],
          created_at: params?.["created_at"],
          updated_at: params?.["updated_at"],
          contact_full_name: null,
          contact_first_name: null,
          contact_last_name: null,
          contact_email: null,
          contact_linkedin: null,
          deal_source: null,
          deal_duration: null,
          deal_amount_cycle: null,
        });
        return [];
      }
      if (trimmed.startsWith("SELECT")) {
        const cid = params?.["client_id"];
        const q = String(params?.["q"] ?? "")
          .replace(/%/g, "")
          .toLowerCase();
        return Array.from(dealStore.values()).filter((row) => {
          if (row["client_id"] !== cid) return false;
          if (!q) return true;
          const company = String(row["company"] ?? "").toLowerCase();
          return company.includes(q);
        });
      }
      return [];
    });

    await runWithTenantContext("bma", undefined, async () => {
      await createDeal(config, {
        deal_name: "Acme partnership",
        company: "Acme Health",
        pipeline: "partnerships",
        stage: "researching",
        owner: "caleb",
        next_action: "Send intro",
        next_action_date: "2026-05-15",
      });

      const results = await searchDeals(config, { query: "acme" });
      assert.equal(results.length, 1, "should find the deal we just created");
      assert.equal(results[0].company, "Acme Health");
      assert.equal(results[0].client_id, "bma");
    });

    // Cross-tenant: another tenant searching for the same string sees nothing.
    await runWithTenantContext("other-tenant", undefined, async () => {
      const results = await searchDeals(config, { query: "acme" });
      assert.equal(results.length, 0, "other tenant must not see bma's deal");
    });
  });

  describe("getDealsDigest tenant scoping + 24h window");

  await test("getDealsDigest throws when called with no tenant context and no override", async () => {
    resetMockState();
    await assert.rejects(() => getDealsDigest(config, {}), /No tenant context/);
    assert.equal(captured.length, 0);
  });

  await test("getDealsDigest tenant-scopes both the listDeals call and the 24h SQL", async () => {
    resetMockState();
    setQueryHandler((sql) => {
      // listDeals SELECT and the recent-changes SELECT both return [].
      // We only care about the SQL + params that were sent.
      void sql;
      return [];
    });
    await getDealsDigest(config, { clientId: "bma" });

    // Two SELECTs: listDeals + recent-changes
    assert.equal(captured.length, 2);

    const listCall = captured[0];
    assert.match(listCall.query, /WHERE client_id = @client_id/);
    assert.equal(listCall.params?.["client_id"], "bma");

    const recentCall = captured[1];
    assert.match(recentCall.query, /WHERE client_id = @client_id/);
    assert.match(
      recentCall.query,
      /updated_at >= TIMESTAMP_SUB\(CURRENT_TIMESTAMP\(\), INTERVAL 1 DAY\)/,
    );
    assert.match(recentCall.query, /AND stage IS NOT NULL/);
    assert.equal(recentCall.params?.["client_id"], "bma");
  });

  await test("getDealsDigest with pipeline filter applies it to both queries", async () => {
    resetMockState();
    setQueryHandler(() => []);
    await getDealsDigest(config, { clientId: "bma", pipeline: "outbound" });

    assert.equal(captured.length, 2);
    for (const call of captured) {
      assert.match(call.query, /AND pipeline = @pipeline/);
      assert.equal(call.params?.["pipeline"], "outbound");
      assert.equal(call.params?.["client_id"], "bma");
    }
  });

  await test("getDealsDigest splits stale + overdue + 24h changes correctly", async () => {
    resetMockState();
    let listCallSeen = false;
    setQueryHandler((sql) => {
      const trimmed = sql.trim();
      // listDeals SELECT is the one with days_since_update / is_overdue / is_stale
      if (/days_since_update/.test(trimmed) && !listCallSeen) {
        listCallSeen = true;
        return [
          {
            deal_id: "stale-1",
            client_id: "bma",
            company: "Acme",
            stage: "contacted",
            pipeline: "outbound",
            days_since_update: 30,
            is_overdue: false,
            is_stale: true,
          },
          {
            deal_id: "overdue-1",
            client_id: "bma",
            company: "Beta",
            stage: "contacted",
            pipeline: "outbound",
            days_since_update: 2,
            is_overdue: true,
            is_stale: false,
          },
          {
            deal_id: "fresh-1",
            client_id: "bma",
            company: "Gamma",
            stage: "contacted",
            pipeline: "outbound",
            days_since_update: 1,
            is_overdue: false,
            is_stale: false,
          },
        ];
      }
      // The 24h changes SELECT
      if (/INTERVAL 1 DAY/.test(trimmed)) {
        return [
          {
            deal_id: "fresh-1",
            client_id: "bma",
            company: "Gamma",
            stage: "contacted",
          },
        ];
      }
      return [];
    });

    const digest = await getDealsDigest(config, { clientId: "bma" });
    assert.equal(digest.stale.length, 1);
    assert.equal(digest.stale[0].deal_id, "stale-1");
    assert.equal(digest.overdue.length, 1);
    assert.equal(digest.overdue[0].deal_id, "overdue-1");
    assert.equal(digest.stage_changes_last_24h.length, 1);
    assert.equal(digest.stage_changes_last_24h[0].deal_id, "fresh-1");
  });

  // ─── Results ─────────────────────────────────────────────────────────────

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

  process.stdout.write("\nAll deal-store tenant tests passed.\n");
}

main().catch((err) => {
  process.stderr.write(`Test runner crashed: ${err}\n`);
  process.exit(1);
});
