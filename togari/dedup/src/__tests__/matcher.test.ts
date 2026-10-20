/**
 * Matcher tests — exercise the priority chain + tenant isolation.
 *
 * BigQuery is mocked via an in-memory QueryRunner/RowInserter so the test
 * is hermetic. The real network is never touched.
 *
 * Run:  npx tsx src/__tests__/matcher.test.ts
 */

import assert from "node:assert/strict";
import type { BQGateway, QueryRunner, RowInserter } from "../dnc/dedup/matcher";
import {
  Matcher,
  normalizeEmail,
  normalizePhone,
  linkedInSlug,
} from "../dnc/dedup/matcher";

// ─── Test runner ──────────────────────────────────────────────────────────────

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
    .catch((err) => {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}: ${msg}`);
      process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
    });
}

function describe(suite: string): void {
  process.stdout.write(`\n── ${suite}\n`);
}

// ─── In-memory BQ fake ────────────────────────────────────────────────────────
// Mimics enough of the BigQuery API for matcher to execute against fixtures
// without touching the network. Tenant filtering is enforced exactly the way
// the real BQ does — owner_id is matched per-row.

interface FakeRow {
  contact_id: string;
  owner_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  linkedin_username: string | null;
  last_updated_at: string;
  [k: string]: unknown;
}

function makeFakeGateway(rows: FakeRow[]): {
  gateway: BQGateway;
  inserted: Record<string, unknown>[];
  getLastQuery: () => { sql: string; params: Record<string, unknown> } | null;
} {
  const inserted: Record<string, unknown>[] = [];
  const state: {
    lastQuery: { sql: string; params: Record<string, unknown> } | null;
  } = { lastQuery: null };

  const runner: QueryRunner = {
    async query<T = Record<string, unknown>>(opts: {
      query: string;
      params?: Record<string, unknown>;
    }): Promise<[T[]]> {
      state.lastQuery = {
        sql: opts.query,
        params: opts.params ?? {},
      };

      const p = (opts.params ?? {}) as {
        owner_id?: string;
        contact_id?: string;
        email?: string | null;
        linkedin?: string | null;
        phone?: string | null;
        name?: string | null;
      };

      // contact_id lookup branch (no email/linkedin/phone/name on params)
      if (p.contact_id !== undefined) {
        const hit = rows.find(
          (r) => r.owner_id === p.owner_id && r.contact_id === p.contact_id,
        );
        return [hit ? ([hit] as T[]) : []];
      }

      // match branch — rank candidates per the SQL CASE
      const candidates = rows.filter((r) => r.owner_id === p.owner_id);
      const matched = candidates
        .map((r) => {
          let rank = 99;
          if (p.email && r.email && r.email.toLowerCase() === p.email) rank = 1;
          else if (
            p.linkedin &&
            r.linkedin_username &&
            r.linkedin_username.toLowerCase() === p.linkedin
          )
            rank = 2;
          else if (p.phone && r.phone === p.phone) rank = 3;
          else if (
            p.name &&
            r.full_name &&
            r.full_name.toLowerCase() === p.name
          )
            rank = 4;
          return { row: r, rank };
        })
        .filter((c) => c.rank < 99)
        .sort((a, b) => a.rank - b.rank);

      if (matched.length === 0) return [[] as T[]];
      const top = matched[0];
      return [[{ ...top.row, match_rank: top.rank } as unknown as T]];
    },
  };

  const contacts: RowInserter = {
    async insert(toInsert: Record<string, unknown>[]): Promise<unknown> {
      inserted.push(...toInsert);
      return {};
    },
  };

  return {
    gateway: { runner, contacts },
    inserted,
    getLastQuery: () => state.lastQuery,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sagar: FakeRow = {
  contact_id: "c-sagar",
  owner_id: "owner-A",
  full_name: "Sagar Tiwari",
  first_name: "Sagar",
  last_name: "Tiwari",
  email: "sagar@example.com",
  phone: "+16267554085",
  linkedin_url: "https://linkedin.com/in/sagartiwari",
  linkedin_username: "sagartiwari",
  last_updated_at: "2026-05-20T00:00:00Z",
};

const karthik: FakeRow = {
  contact_id: "c-karthik",
  owner_id: "owner-A",
  full_name: "Karthik Rao",
  first_name: "Karthik",
  last_name: "Rao",
  email: "karthik@example.com",
  phone: null,
  linkedin_url: null,
  linkedin_username: "karthikrao",
  last_updated_at: "2026-05-19T00:00:00Z",
};

// Owned by a DIFFERENT tenant — must never leak into owner-A's results.
const stranger: FakeRow = {
  contact_id: "c-stranger",
  owner_id: "owner-B",
  full_name: "Sagar Tiwari", // same name as owner-A's Sagar — isolation test
  first_name: "Sagar",
  last_name: "Tiwari",
  email: "sagar@example.com", // same email too
  phone: "+16267554085",
  linkedin_url: null,
  linkedin_username: "sagartiwari",
  last_updated_at: "2026-05-21T00:00:00Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  describe("normalizers");

  await test("normalizeEmail lowercases and trims", () => {
    assert.equal(normalizeEmail("  Sagar@Example.com "), "sagar@example.com");
    assert.equal(normalizeEmail("not-an-email"), null);
    assert.equal(normalizeEmail(null), null);
  });

  await test("normalizePhone produces E.164", () => {
    assert.equal(normalizePhone("(626) 755-4085"), "+16267554085");
    assert.equal(normalizePhone("16267554085"), "+16267554085");
    assert.equal(normalizePhone("123"), null);
  });

  await test("linkedInSlug extracts from URL or bare slug", () => {
    assert.equal(
      linkedInSlug("https://www.linkedin.com/in/SagarTiwari/"),
      "sagartiwari",
    );
    assert.equal(linkedInSlug("sagartiwari"), "sagartiwari");
    assert.equal(linkedInSlug("not a slug with spaces"), null);
  });

  describe("Matcher.match — priority chain");

  await test("email match returns confidence 100", async () => {
    const { gateway } = makeFakeGateway([sagar, karthik]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", { email: "sagar@example.com" });
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 100);
    assert.equal(result.matched_on, "email");
    assert.equal(result.contact?.contact_id, "c-sagar");
  });

  await test("linkedin match returns confidence 90 when email absent", async () => {
    const { gateway } = makeFakeGateway([sagar, karthik]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", { linkedin: "karthikrao" });
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 90);
    assert.equal(result.matched_on, "linkedin");
    assert.equal(result.contact?.contact_id, "c-karthik");
  });

  await test("phone match returns confidence 85", async () => {
    const { gateway } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", { phone: "(626) 755-4085" });
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 85);
    assert.equal(result.matched_on, "phone");
  });

  await test("name match returns confidence 60", async () => {
    const { gateway } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", { name: "Sagar Tiwari" });
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 60);
    assert.equal(result.matched_on, "name");
  });

  await test("email beats name when both match same row", async () => {
    const { gateway } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", {
      email: "sagar@example.com",
      name: "Sagar Tiwari",
    });
    assert.equal(result.matched_on, "email");
  });

  await test("empty request returns matched=false", async () => {
    const { gateway } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", {});
    assert.equal(result.matched, false);
    assert.equal(result.confidence, 0);
  });

  await test("no candidate match returns matched=false", async () => {
    const { gateway } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-A", { email: "ghost@example.com" });
    assert.equal(result.matched, false);
  });

  describe("Matcher.match — tenant isolation");

  await test("owner-A cannot read owner-B's rows even with identical fields", async () => {
    const { gateway } = makeFakeGateway([sagar, stranger]);
    const m = new Matcher(gateway);

    // Looking up with owner-A's id must return owner-A's row, not owner-B's.
    const a = await m.match("owner-A", { email: "sagar@example.com" });
    assert.equal(a.matched, true);
    assert.equal(a.contact?.owner_id, "owner-A");
    assert.equal(a.contact?.contact_id, "c-sagar");

    // Looking up with owner-B's id must return owner-B's row only.
    const b = await m.match("owner-B", { email: "sagar@example.com" });
    assert.equal(b.matched, true);
    assert.equal(b.contact?.owner_id, "owner-B");
    assert.equal(b.contact?.contact_id, "c-stranger");
  });

  await test("owner-C with no rows returns matched=false", async () => {
    const { gateway } = makeFakeGateway([sagar, stranger]);
    const m = new Matcher(gateway);
    const result = await m.match("owner-C", { email: "sagar@example.com" });
    assert.equal(result.matched, false);
  });

  await test("query is parameterized — owner_id never interpolated", async () => {
    const { gateway, getLastQuery } = makeFakeGateway([sagar]);
    const m = new Matcher(gateway);
    await m.match("owner-A'; DROP TABLE contacts;--", {
      email: "sagar@example.com",
    });
    const q = getLastQuery();
    assert.ok(q, "query should have been issued");
    assert.ok(
      !q.sql.includes("DROP TABLE"),
      "SQL must not include user-supplied owner_id",
    );
    assert.equal(
      q.params.owner_id,
      "owner-A'; DROP TABLE contacts;--",
      "owner_id should land in params, not the SQL",
    );
  });

  describe("Matcher.getById");

  await test("returns null when cross-tenant", async () => {
    const { gateway } = makeFakeGateway([sagar, stranger]);
    const m = new Matcher(gateway);
    const hit = await m.getById("owner-A", "c-stranger");
    assert.equal(hit, null);
  });

  describe("Matcher.create");

  await test("create stamps owner_id, contact_id, and realness verdict", async () => {
    const { gateway, inserted } = makeFakeGateway([]);
    const m = new Matcher(gateway);
    const c = await m.create("owner-A", {
      full_name: "Caleb Newton",
      first_name: "Caleb",
      last_name: "Newton",
      email: "Caleb@Example.com",
    });

    assert.equal(c.owner_id, "owner-A");
    assert.ok(c.contact_id.length > 0, "contact_id should be generated");
    assert.equal(c.email, "caleb@example.com"); // normalized
    assert.equal(c.is_real_person, true);
    assert.ok(
      (c.realness_score ?? 0) >= 60,
      `realness_score should be >= 60 for a real person, got ${c.realness_score}`,
    );
    assert.ok(
      typeof c.realness_reason === "string" && c.realness_reason.length > 0,
      "realness_reason should be a non-empty string",
    );
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].owner_id, "owner-A");
  });
}

main()
  .then(() => {
    process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
    if (failed > 0) {
      process.stdout.write("\nFailures:\n");
      for (const f of failures) process.stdout.write(`  ${f}\n`);
      process.exit(1);
    }
  })
  .catch((err) => {
    process.stderr.write(`Test harness crashed: ${err}\n`);
    process.exit(2);
  });
