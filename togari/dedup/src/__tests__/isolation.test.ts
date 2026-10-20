/**
 * Tenant-isolation guard tests (WS-6).
 *
 * Verifies the defensive checks added to DedupEngine, DncBigQueryWriter, and
 * the platform sync workers refuse to operate when ownerId is missing or when
 * a row's owner_id does not match the cache's owner_id.
 *
 * These do NOT hit BigQuery; every assertion validates the pre-BQ guard.
 *
 * Run:  npx tsx src/__tests__/isolation.test.ts
 */

import assert from "node:assert/strict";

import { DedupEngine } from "../dnc/dedup/engine.js";
import { DncBigQueryWriter } from "../dnc/workers/bq-writer.js";
import type {
  PlatformCache,
  SocialConnectionRow,
  UnifiedContact,
} from "../dnc/types/index.js";

// ─── Tiny test runner ────────────────────────────────────────────────────────

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

async function expectThrows(
  fn: () => Promise<unknown> | unknown,
  pattern: RegExp,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(
      msg,
      pattern,
      `expected error matching ${pattern}, got: ${msg}`,
    );
  }
  assert.equal(threw, true, "expected function to throw");
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCache(ownerId: string): PlatformCache {
  return {
    ownerId,
    ownerAccountId: "platform-acct-1",
    ownerUsername: "user-one",
    knownIds: new Set(),
    lastPollAt: null,
    lastConnectedAt: null,
    followerCount: null,
  };
}

function makeRow(ownerId: string, platformUserId: string): SocialConnectionRow {
  const now = new Date().toISOString();
  return {
    connection_id: `conn-${platformUserId}`,
    platform: "linkedin",
    owner_id: ownerId,
    owner_account_id: "platform-acct-1",
    owner_username: "user-one",
    platform_user_id: platformUserId,
    username: `user-${platformUserId}`,
    full_name: "Test Person",
    first_name: "Test",
    last_name: "Person",
    profile_url: `https://linkedin.com/in/user-${platformUserId}`,
    avatar_url: null,
    bio: null,
    follower_count: null,
    following_count: null,
    is_verified: false,
    connection_type: "connection",
    connected_at: now,
    connection_degree: 1,
    dnc_contact_id: null,
    work_email: null,
    current_title: null,
    current_company: null,
    company_domain: null,
    is_dnc: false,
    dnc_reason: null,
    dnc_added_at: null,
    raw_platform_data: {},
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
}

function makeContact(ownerId: string, contactId: string): UnifiedContact {
  const now = new Date().toISOString();
  return {
    contact_id: contactId,
    owner_id: ownerId,
    full_name: "Test Person",
    first_name: "Test",
    last_name: "Person",
    email: null,
    phone: null,
    linkedin_url: null,
    linkedin_username: null,
    instagram_username: null,
    twitter_username: null,
    current_title: null,
    current_company: null,
    company_domain: null,
    sources: ["linkedin"],
    source_detail: {},
    is_dnc: false,
    dnc_reason: null,
    confidence_score: 100,
    merge_count: 1,
    first_seen_at: now,
    last_updated_at: now,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  describe("DedupEngine — ownerId is required");

  const engine = new DedupEngine();

  await test("run() throws when ownerId is empty string", async () => {
    await expectThrows(() => engine.run(""), /ownerId is required/i);
  });

  await test("run() throws when ownerId is undefined-cast", async () => {
    // @ts-expect-error — exercising runtime guard against bad callers
    await expectThrows(() => engine.run(undefined), /ownerId is required/i);
  });

  await test("getStats() throws when ownerId is empty string", async () => {
    await expectThrows(() => engine.getStats(""), /ownerId is required/i);
  });

  describe("DncBigQueryWriter — warmCache requires ownerId");

  const bq = new DncBigQueryWriter();

  await test("warmCache() throws when ownerId is empty string", async () => {
    await expectThrows(
      () => bq.warmCache("linkedin", "", "platform-acct-1", "user-one"),
      /ownerId is required/i,
    );
  });

  describe("DncBigQueryWriter — insertNewRows enforces tenant guard");

  await test("insertNewRows() throws when a row's owner_id != cache.ownerId", async () => {
    const cache = makeCache("owner-A");
    const rows = [makeRow("owner-B", "platform-user-1")]; // mismatch
    await expectThrows(
      () => bq.insertNewRows(rows, cache),
      /does not match cache owner_id/i,
    );
  });

  await test("insertNewRows() throws if ANY row's owner_id mismatches (mixed batch)", async () => {
    const cache = makeCache("owner-A");
    const rows = [
      makeRow("owner-A", "platform-user-1"),
      makeRow("owner-B", "platform-user-2"), // poisoned
      makeRow("owner-A", "platform-user-3"),
    ];
    await expectThrows(
      () => bq.insertNewRows(rows, cache),
      /does not match cache owner_id/i,
    );
  });

  await test("insertNewRows() returns 0 for empty input without touching BQ", async () => {
    const cache = makeCache("owner-A");
    const result = await bq.insertNewRows([], cache);
    assert.equal(result, 0);
  });

  describe("DedupEngine — batch update rejects cross-tenant contacts");

  // batchUpdateContacts is private; exercise via the public interface guard.
  // We can't call it directly without TS friction, but the same defensive
  // pattern lives in the public run() path. Instead, exercise via a tiny
  // reflective access — accepting one `any` to test the private contract.
  await test("batchUpdateContacts() throws when contact owner_id != ownerId", async () => {
    const e = new DedupEngine();
    // Access private method for unit test only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = (e as any).batchUpdateContacts.bind(e) as (
      ownerId: string,
      contacts: UnifiedContact[],
    ) => Promise<void>;
    const wrongOwner = [makeContact("owner-B", "contact-1")];
    await expectThrows(
      () => batch("owner-A", wrongOwner),
      /does not match query owner_id/i,
    );
  });

  // ─── Summary ───────────────────────────────────────────────────────────────

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
