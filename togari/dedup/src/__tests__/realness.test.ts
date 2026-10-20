/**
 * Realness classifier tests.
 *
 * Run: npx tsx src/__tests__/realness.test.ts
 *
 * Mirrors the assertion-throwing style of sql-generator.test.ts (no Jest).
 *
 * Covers:
 *   - 10 org / bot fixtures: heuristic classifies them as not-real, no Haiku call
 *   - 10 real-person fixtures: heuristic classifies them as real, no Haiku call
 *   - Cost guard: Haiku is never invoked for clear-cut heuristic scores
 *   - Ambiguous path: Haiku IS invoked when the heuristic score lands in [30, 70]
 *     and the orchestrator surfaces its verdict
 */

import assert from "node:assert/strict";
import type { UnifiedContact, RealnessVerdict } from "../dnc/types/index";
import { classifyRealness } from "../dnc/dedup/realness";
import { runHeuristics, isClearCut } from "../dnc/dedup/realness.heuristics";

// ─── Test runner (copied style from sql-generator.test.ts) ────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(
  name: string,
  fn: () => void | Promise<void>,
): Promise<void> {
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
  fn: () => Promise<void> | void,
): Promise<void> {
  process.stdout.write(`\n── ${suite}\n`);
  await fn();
}

// ─── Fixture builder ──────────────────────────────────────────────────────────

function makeContact(overrides: Partial<UnifiedContact>): UnifiedContact {
  return {
    contact_id: overrides.contact_id ?? "test-id",
    full_name: overrides.full_name ?? null,
    first_name: overrides.first_name ?? null,
    last_name: overrides.last_name ?? null,
    email: overrides.email ?? null,
    phone: overrides.phone ?? null,
    linkedin_url: overrides.linkedin_url ?? null,
    linkedin_username: overrides.linkedin_username ?? null,
    instagram_username: overrides.instagram_username ?? null,
    twitter_username: overrides.twitter_username ?? null,
    facebook_username: overrides.facebook_username ?? null,
    tiktok_username: overrides.tiktok_username ?? null,
    current_title: overrides.current_title ?? null,
    current_company: overrides.current_company ?? null,
    company_domain: overrides.company_domain ?? null,
    sources: overrides.sources ?? "",
    source_detail: overrides.source_detail ?? {},
    is_dnc: overrides.is_dnc ?? false,
    dnc_reason: overrides.dnc_reason ?? null,
    dnc_added_at: overrides.dnc_added_at ?? null,
    confidence_score: overrides.confidence_score ?? 0,
    merge_count: overrides.merge_count ?? 0,
    first_seen_at: overrides.first_seen_at ?? "2026-01-01T00:00:00Z",
    last_updated_at: overrides.last_updated_at ?? "2026-01-01T00:00:00Z",
    is_real_person: overrides.is_real_person ?? null,
    realness_score: overrides.realness_score ?? null,
    realness_reason: overrides.realness_reason ?? null,
    apple_contact_id: overrides.apple_contact_id ?? null,
    apple_etag: overrides.apple_etag ?? null,
    owner_id: overrides.owner_id ?? "test-owner",
  };
}

/** Throws if invoked — used to assert the Haiku path was NOT taken. */
function forbiddenHaiku(): Promise<RealnessVerdict> {
  throw new Error("Haiku should not be called for clear-cut heuristic cases");
}

/** Records calls so a test can assert the Haiku path WAS taken. */
function spyHaiku(verdict: RealnessVerdict): {
  fn: (contact: UnifiedContact) => Promise<RealnessVerdict>;
  calls: UnifiedContact[];
} {
  const calls: UnifiedContact[] = [];
  const fn = async (contact: UnifiedContact): Promise<RealnessVerdict> => {
    calls.push(contact);
    return verdict;
  };
  return { fn, calls };
}

// ─── 10 org / bot fixtures ────────────────────────────────────────────────────

const ORG_FIXTURES: { label: string; contact: UnifiedContact }[] = [
  {
    label: "Acme Inc",
    contact: makeContact({ full_name: "Acme Inc" }),
  },
  {
    label: "OpenAI LLC",
    contact: makeContact({ full_name: "OpenAI LLC" }),
  },
  {
    label: "support@stripe.com role address",
    contact: makeContact({
      full_name: "Stripe Support",
      email: "support@stripe.com",
    }),
  },
  {
    label: "noreply@github.com",
    contact: makeContact({
      full_name: "GitHub Notifications",
      email: "noreply@github.com",
    }),
  },
  {
    label: "Customer Support role",
    contact: makeContact({ full_name: "Customer Support" }),
  },
  {
    label: "Sales Team",
    contact: makeContact({ full_name: "Sales Team" }),
  },
  {
    label: "TechCo Bot",
    contact: makeContact({ full_name: "TechCo Bot" }),
  },
  {
    label: "official_press LinkedIn handle",
    contact: makeContact({
      full_name: "Press Office",
      linkedin_username: "official_press",
    }),
  },
  {
    label: "info_official Instagram handle",
    contact: makeContact({
      full_name: "Info Channel",
      instagram_username: "info_official",
    }),
  },
  {
    label: "Foundation Partners",
    contact: makeContact({ full_name: "Foundation Partners" }),
  },
];

// ─── 10 real-person fixtures ──────────────────────────────────────────────────

const REAL_FIXTURES: { label: string; contact: UnifiedContact }[] = [
  {
    label: "Caleb Newton (full profile)",
    contact: makeContact({
      full_name: "Caleb Newton",
      first_name: "Caleb",
      last_name: "Newton",
      email: "caleb@example.com",
      linkedin_url: "https://linkedin.com/in/calebnewtonusc",
      current_title: "Software Engineer",
      current_company: "Blue Modern Advisory",
    }),
  },
  {
    label: "Sagar Tiwari",
    contact: makeContact({
      full_name: "Sagar Tiwari",
      first_name: "Sagar",
      last_name: "Tiwari",
      email: "sagar@example.com",
      linkedin_url: "https://linkedin.com/in/sagartiwari",
    }),
  },
  {
    label: "Joel Newton",
    contact: makeContact({
      full_name: "Joel Newton",
      first_name: "Joel",
      last_name: "Newton",
      linkedin_url: "https://linkedin.com/in/joelnewton",
      current_title: "Director",
    }),
  },
  {
    label: "Maria Garcia",
    contact: makeContact({
      full_name: "Maria Garcia",
      first_name: "Maria",
      last_name: "Garcia",
      email: "maria.garcia@example.com",
      current_title: "Product Manager",
    }),
  },
  {
    label: "John Smith",
    contact: makeContact({
      full_name: "John Smith",
      first_name: "John",
      last_name: "Smith",
      phone: "+15551234567",
      linkedin_username: "john-smith-engineer",
    }),
  },
  {
    label: "Aisha Patel",
    contact: makeContact({
      full_name: "Aisha Patel",
      first_name: "Aisha",
      last_name: "Patel",
      email: "aisha@example.com",
      linkedin_url: "https://linkedin.com/in/aishapatel",
      current_title: "Designer",
      current_company: "Figma",
    }),
  },
  {
    label: "Kevin Liu",
    contact: makeContact({
      full_name: "Kevin Liu",
      first_name: "Kevin",
      last_name: "Liu",
      email: "kevin@example.com",
      current_title: "Engineer",
      current_company: "Stripe",
    }),
  },
  {
    label: "Maggie Chen",
    contact: makeContact({
      full_name: "Maggie Chen",
      first_name: "Maggie",
      last_name: "Chen",
      linkedin_url: "https://linkedin.com/in/maggiechen",
    }),
  },
  {
    label: "Parker Davis",
    contact: makeContact({
      full_name: "Parker Davis",
      first_name: "Parker",
      last_name: "Davis",
      linkedin_url: "https://linkedin.com/in/parkerdavis",
      current_title: "Analyst",
    }),
  },
  {
    label: "Matija Kovac",
    contact: makeContact({
      full_name: "Matija Kovac",
      first_name: "Matija",
      last_name: "Kovac",
      email: "matija@example.com",
      current_title: "Founder",
      current_company: "48North",
    }),
  },
];

// ─── Suites ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await describe("orgs / bots are classified as not-real and skip Haiku", async () => {
    for (const { label, contact } of ORG_FIXTURES) {
      await test(label, async () => {
        const heuristic = runHeuristics(contact);
        assert.ok(
          isClearCut(heuristic.score),
          `expected ${label} to be clear-cut, got score ${heuristic.score} (${heuristic.reason})`,
        );
        const verdict = await classifyRealness(contact, {
          haiku: forbiddenHaiku,
        });
        assert.equal(
          verdict.is_real,
          false,
          `expected is_real=false for ${label}`,
        );
        assert.ok(
          verdict.score < 60,
          `expected score < 60 for ${label}, got ${verdict.score}`,
        );
        assert.match(
          verdict.reason,
          /^heuristic:/,
          `expected heuristic-prefixed reason for ${label}, got: ${verdict.reason}`,
        );
      });
    }
  });

  await describe("real people are classified as real and skip Haiku", async () => {
    for (const { label, contact } of REAL_FIXTURES) {
      await test(label, async () => {
        const heuristic = runHeuristics(contact);
        assert.ok(
          isClearCut(heuristic.score),
          `expected ${label} to be clear-cut, got score ${heuristic.score} (${heuristic.reason})`,
        );
        const verdict = await classifyRealness(contact, {
          haiku: forbiddenHaiku,
        });
        assert.equal(
          verdict.is_real,
          true,
          `expected is_real=true for ${label}`,
        );
        assert.ok(
          verdict.score >= 60,
          `expected score >= 60 for ${label}, got ${verdict.score}`,
        );
        assert.match(
          verdict.reason,
          /^heuristic:/,
          `expected heuristic-prefixed reason for ${label}, got: ${verdict.reason}`,
        );
      });
    }
  });

  await describe("ambiguous heuristic scores escalate to Haiku", async () => {
    await test("single-token name with no signals triggers Haiku", async () => {
      const contact = makeContact({ full_name: "Robin" });
      const heuristic = runHeuristics(contact);
      assert.ok(
        !isClearCut(heuristic.score),
        `expected ambiguous score, got ${heuristic.score} (${heuristic.reason})`,
      );

      const haiku = spyHaiku({
        is_real: true,
        score: 75,
        reason:
          "single first name with no other signal is plausibly a real person",
      });
      const verdict = await classifyRealness(contact, { haiku: haiku.fn });

      assert.equal(
        haiku.calls.length,
        1,
        "expected Haiku to be called exactly once",
      );
      assert.equal(verdict.is_real, true);
      assert.equal(verdict.score, 75);
      assert.match(verdict.reason, /^haiku:/);
    });

    await test("Haiku failure falls back to heuristic verdict", async () => {
      const contact = makeContact({ full_name: "Pat" });
      const heuristic = runHeuristics(contact);
      assert.ok(!isClearCut(heuristic.score));

      const failingHaiku = async (): Promise<RealnessVerdict> => {
        throw new Error("haiku down");
      };
      const verdict = await classifyRealness(contact, { haiku: failingHaiku });

      assert.equal(verdict.score, heuristic.score);
      assert.match(verdict.reason, /heuristic-fallback/);
      assert.match(verdict.reason, /haiku down/);
    });
  });

  // ─── Summary ──
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`unexpected error: ${err}\n`);
  process.exit(1);
});
