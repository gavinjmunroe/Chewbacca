/**
 * THE VENDOR IS THE LEAST TRUSTED THING IN THE SYSTEM, and these tests are
 * mostly about what it is NOT allowed to do:
 *
 *   overwrite a field the owner already has        -- ever, at any confidence
 *   pick one of five strangers with the same name  -- it declines instead
 *   get called when the meter says no              -- checked before the spend
 *   vanish when it errors                          -- recorded at cost zero
 */
import test from "node:test";
import assert from "node:assert/strict";
import { enrichOneContact, fillableFields, chooseCandidate } from "./metered-enrich.js";

const CONTACT = {
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "Sagar Tiwari",
  company: null,
  title: null,
  city: null,
  linkedin_url: null,
};

function harness({ contact = CONTACT, candidates = [], allowed = true, reason = "ok", throws = null, configured = true } = {}) {
  const calls = { search: 0, union: [], record: [] };
  return {
    calls,
    deps: {
      provider: {
        name: "clay",
        async searchCandidates() {
          calls.search += 1;
          if (throws) throw new Error(throws);
          return { configured, candidates };
        },
      },
      meter: {
        async getLimits() { return { dailyUnits: 10, monthlyUnits: 100, cooldownHours: 24 }; },
        async getSpend() { return { spentDay: 0, spentMonth: 0, contactLastAt: null }; },
        decide() { return { allowed, reason, remaining: { day: 10, month: 100 } }; },
        async record(row) { calls.record.push(row); return { id: 1 }; },
      },
      async applyUnion(owner, id, record, opts) { calls.union.push({ record, opts }); return true; },
      async readContact() { return contact; },
    },
  };
}

const OWNER = "22222222-2222-2222-2222-222222222222";

// ── what the vendor may touch ───────────────────────────────────────────────

test("a vendor fills a blank field and never touches a populated one", () => {
  const row = { company: "Rytual", title: null, city: "", linkedin_url: null };
  const fill = fillableFields(row, {
    company: "Some Other Corp",       // occupied -> refused
    title: "Founder",                 // blank -> filled
    city: "Chicago",                  // empty string is blank -> filled
    linkedinUrl: "https://li/x",      // blank -> filled
  });
  assert.deepEqual(fill, { title: "Founder", city: "Chicago", linkedinUrl: "https://li/x" });
});

test("a vendor field that is blank fills nothing", () => {
  assert.deepEqual(fillableFields({}, { company: "   ", title: null }), {});
  assert.deepEqual(fillableFields({}, {}), {});
  assert.deepEqual(fillableFields(null, null), {});
});

// ── declining to guess ──────────────────────────────────────────────────────

test("one candidate is taken", () => {
  assert.equal(chooseCandidate({}, [{ company: "A" }]).why, "only_candidate");
});

test("five strangers with the same name are NOT guessed between", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ company: `Co ${i}`, city: `City ${i}` }));
  const { candidate, why } = chooseCandidate({ company: null, city: null }, five);
  assert.equal(candidate, null);
  assert.equal(why, "ambiguous");
});

test("a candidate agreeing with what the card already says is the one taken", () => {
  const { candidate, why } = chooseCandidate({ company: "Rytual" }, [
    { company: "Rytual", title: "Founder" },
    { company: "Elsewhere", title: "Analyst" },
  ]);
  assert.equal(why, "company_agrees");
  assert.equal(candidate.title, "Founder");
});

test("two candidates agreeing equally is still ambiguous", () => {
  const { candidate } = chooseCandidate({ company: "Rytual" }, [
    { company: "Rytual", title: "Founder" },
    { company: "Rytual", title: "Analyst" },
  ]);
  assert.equal(candidate, null);
});

// ── the meter ───────────────────────────────────────────────────────────────

test("the provider is NOT called when the meter refuses", async () => {
  const h = harness({ allowed: false, reason: "daily_limit" });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "daily_limit");
  assert.equal(h.calls.search, 0);
});

test("a refusal writes NO ledger row", async () => {
  // The ledger is also the cooldown. A refused request that recorded itself
  // would extend the very refusal it recorded.
  const h = harness({ allowed: false, reason: "recently_enriched" });
  await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.deepEqual(h.calls.record, []);
});

test("a successful fill is written at vendor trust, fill-only", async () => {
  const h = harness({ candidates: [{ company: "Rytual", title: "Founder", city: "Chicago" }] });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.fieldsFilled, 3);
  assert.equal(h.calls.union.length, 1);
  assert.equal(h.calls.union[0].opts.authoritative, false, "must never be authoritative");
  assert.equal(h.calls.union[0].record.source, "clay");
  assert.equal(h.calls.record[0].outcome, "ok");
  assert.equal(h.calls.record[0].fieldsFilled, 3);
});

test("a call that finds nothing still costs, and says so", async () => {
  const h = harness({ candidates: [] });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.fieldsFilled, 0);
  assert.equal(h.calls.union.length, 0);
  assert.equal(h.calls.record[0].outcome, "empty");
  assert.equal(h.calls.record[0].costUnits, 1);
});

test("a provider error is recorded at zero cost", async () => {
  const h = harness({ throws: "upstream 503" });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "provider_error");
  assert.equal(h.calls.record[0].outcome, "error");
  assert.equal(h.calls.record[0].costUnits, 0);
});

test("an unconfigured provider is a no-op, not a ledger row", async () => {
  const h = harness({ configured: false });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.reason, "provider_not_configured");
  assert.deepEqual(h.calls.record, []);
});

test("a contact that is not the caller's is refused before anything is spent", async () => {
  const h = harness({ contact: null });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.reason, "contact_not_found");
  assert.equal(h.calls.search, 0);
});

test("a nameless contact is not searched for", async () => {
  const h = harness({ contact: { ...CONTACT, full_name: "  " } });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.equal(res.reason, "no_name_to_search");
  assert.equal(h.calls.search, 0);
});

test("a vendor cannot overwrite the owner's own values, end to end", async () => {
  const h = harness({
    contact: { ...CONTACT, company: "Rytual", title: "Cofounder", city: "Chicago" },
    candidates: [{ company: "Rytual", title: "Junior Analyst", city: "Toledo", linkedinUrl: "https://li/s" }],
  });
  const res = await enrichOneContact(OWNER, CONTACT.id, h.deps);
  assert.deepEqual(Object.keys(res.filled), ["linkedinUrl"]);
  assert.equal(h.calls.union[0].record.title, undefined);
  assert.equal(h.calls.union[0].record.city, undefined);
});
