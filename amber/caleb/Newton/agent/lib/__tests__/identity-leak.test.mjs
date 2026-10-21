/**
 * Identity-leak regression tests.
 *
 * These cover the production smoke-test bug where the agent addressed a
 * tenant-owner's friend ("Maggie") as the tenant owner's name ("Sagar"):
 *
 *   1. Contact-extractor MUST NOT save the tenant owner's first or full
 *      name as a contact's displayName.
 *   2. Contact-extractor MUST NOT save the agent persona handle
 *      ("Camber", "Samber") as a contact's displayName.
 *   3. The contact-DM system prompt must NOT assert "the HUMAN you are
 *      texting is the OWNER" — it must say the human is a CONTACT and
 *      must not be addressed as the owner.
 *   4. User-facing copy must brand as "Amber" by default; the internal
 *      persona handles ("Camber" / "Samber") only leak out when a tenant
 *      explicitly opts in via preferences.useInternalPersonaName=true
 *      (or AMBER_USE_INTERNAL_PERSONA_NAME=1 for the dev number).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/identity-leak.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isForbiddenContactDisplayName,
} from "../contacts.js";
import {
  extractFirstNameFromReply,
} from "../festival.js";
import {
  getAgentName,
  getPublicAgentName,
} from "../tenant.js";
import { buildSystemPromptForSender } from "../prompts.js";

const samber = {
  id: "did:privy:sagar",
  agentName: "Samber",
  displayName: "Samber",
  phoneNumber: "+15550100004",
  onboardingProfile: {},
};
const camber = {
  id: "did:privy:caleb",
  agentName: "Camber",
  displayName: "Camber",
  phoneNumber: "+15550100002",
  onboardingProfile: {},
};

// ── isForbiddenContactDisplayName ────────────────────────────────────────

test("static deny list blocks agent persona names regardless of tenant", () => {
  for (const name of [
    "Amber", "Amber-Dvlp", "Amber-Prod", "Camber", "Samber",
    "AI", "Bot", "Assistant",
  ]) {
    assert.equal(
      isForbiddenContactDisplayName(name),
      true,
      `expected "${name}" to be forbidden`,
    );
  }
});

test("static deny list blocks both tenant owners' first and full names", () => {
  // Even without a tenant param, these are pre-seeded so we self-heal old
  // rows in either tenant's namespace.
  for (const name of [
    "Caleb", "Caleb Newton", "Sagar", "Sagar Tiwari",
    "caleb", "sagar tiwari",
  ]) {
    assert.equal(
      isForbiddenContactDisplayName(name),
      true,
      `expected "${name}" to be forbidden (static)`,
    );
  }
});

test("tenant-scoped check ALSO blocks the resolved owner's name", () => {
  // Even if we ever drop the static seed, the tenant lookup must catch it.
  assert.equal(isForbiddenContactDisplayName("Sagar", samber), true);
  assert.equal(isForbiddenContactDisplayName("Sagar Tiwari", samber), true);
  assert.equal(isForbiddenContactDisplayName("Samber", samber), true);
});

test("a real human contact name is allowed (Maggie / Mira / etc.)", () => {
  for (const name of ["Maggie", "Mira", "Priya", "Dani"]) {
    assert.equal(
      isForbiddenContactDisplayName(name, samber),
      false,
      `expected "${name}" to be allowed`,
    );
    assert.equal(
      isForbiddenContactDisplayName(name, camber),
      false,
      `expected "${name}" to be allowed`,
    );
  }
});

// ── festival first-name extractor ─────────────────────────────────────────

test("first-name extractor rejects owner names so a stranger replying 'I'm Sagar' doesn't get the owner label", () => {
  assert.equal(extractFirstNameFromReply("I'm Sagar"), null);
  assert.equal(extractFirstNameFromReply("Sagar"), null);
  assert.equal(extractFirstNameFromReply("Caleb here"), null);
  assert.equal(extractFirstNameFromReply("Camber"), null);
  assert.equal(extractFirstNameFromReply("Samber"), null);
});

test("first-name extractor still accepts a real first name like 'Maggie'", () => {
  assert.equal(extractFirstNameFromReply("I'm Maggie"), "Maggie");
  assert.equal(extractFirstNameFromReply("Maggie here"), "Maggie");
  assert.equal(extractFirstNameFromReply("maggie"), "Maggie");
});

// ── public agent name (Amber vs internal Camber/Samber) ──────────────────

test("getPublicAgentName defaults to 'Amber' even when tenant has internal persona", () => {
  assert.equal(getPublicAgentName(samber), "Amber");
  assert.equal(getPublicAgentName(camber), "Amber");
  // Sanity: the internal handle is still available for ops/logs.
  assert.equal(getAgentName(samber), "Samber");
  assert.equal(getAgentName(camber), "Camber");
});

test("getPublicAgentName respects per-tenant opt-in for the internal persona", () => {
  const dvlp = {
    ...camber,
    preferences: { useInternalPersonaName: true },
  };
  assert.equal(getPublicAgentName(dvlp), "Camber");
  assert.equal(getPublicAgentName({ ...camber }), "Amber");
});

// ── contact-DM system prompt (the Maggie regression) ─────────────────────

const maggie = {
  handle: "+15558675309",
  displayName: "Maggie",
  relationship: "friend",
  notes: [],
  messageCount: 5,
  isCaleb: false,
};

function buildContactPrompt(tenant) {
  return buildSystemPromptForSender(
    /* calebContext */ "",
    /* contact     */ maggie,
    /* isCaleb     */ false,
    /* isGroup     */ false,
    /* groupName   */ "",
    /* participants */ [],
    /* isNewGroup  */ false,
    /* groupMemory */ "",
    /* lastCalebActivityMs */ 0,
    /* conversationSummary */ "",
    /* tenant      */ tenant,
  );
}

test("contact-DM prompt does NOT tell the model 'the HUMAN you are texting is the owner'", () => {
  // This is the precise sentence that produced the Maggie-called-Sagar
  // bug — it was hard-coded in AGENT_IDENTITY and shipped on every
  // non-owner DM. We removed it for the contact branch.
  const prompt = buildContactPrompt(samber);
  assert.ok(
    !/The HUMAN you are texting right now is Sagar/i.test(prompt),
    "contact-DM prompt must not claim the human is the owner (Sagar)",
  );
  assert.ok(
    !/The HUMAN you are texting right now is Caleb/i.test(prompt),
    "contact-DM prompt must not claim the human is the owner (Caleb)",
  );
});

test("contact-DM prompt explicitly forbids addressing the contact as the owner", () => {
  const prompt = buildContactPrompt(samber);
  assert.match(
    prompt,
    /NEVER call a contact "Sagar"/i,
    "must explicitly forbid calling the contact by the owner's name",
  );
  // Identity must be re-anchored to the contact's own profile.
  assert.match(prompt, /ABOUT THIS PERSON/);
  assert.match(prompt, /Maggie/);
});

test("contact-DM prompt brands the agent as 'Amber' by default, not 'Samber'", () => {
  const prompt = buildContactPrompt(samber);
  // The first identity sentence must say Amber.
  assert.match(
    prompt,
    /You are Amber\b/,
    "user-facing identity must brand as Amber",
  );
  // Samber may still appear as the internal ops handle, but only as
  // such — never as the user-facing answer to "who are you".
  assert.ok(
    !/answer "Samber"/i.test(prompt),
    "must not instruct the model to say its name is Samber",
  );
});

test("owner-DM prompt keeps the 'the human is the owner' assertion (where it is correct)", () => {
  const prompt = buildSystemPromptForSender(
    "Caleb context block here",
    { handle: camber.phoneNumber, isCaleb: true, displayName: "Caleb", notes: [], messageCount: 100 },
    /* isCaleb */ true,
    false, "", [], false, "", 0, "",
    camber,
  );
  // In the owner branch, "the HUMAN is the owner" is the truth.
  assert.match(prompt, /The HUMAN you are texting right now is Caleb/);
});

test("group prompt does NOT collapse all participants into the owner", () => {
  const prompt = buildSystemPromptForSender(
    "",
    { handle: camber.phoneNumber, isCaleb: true, displayName: "Caleb", notes: [], messageCount: 10 },
    /* isCaleb */ true,
    /* isGroup */ true,
    "Festival crew",
    [
      { handle: "+15558675309", displayName: "Maggie", relationship: "friend" },
      { handle: "+15551112222", displayName: "Priya", relationship: "friend" },
    ],
    false, "", 0, "",
    camber,
  );
  assert.match(prompt, /Address each person by THEIR OWN name/);
  assert.match(prompt, /NEVER address a non-owner participant as "Caleb"/);
});
