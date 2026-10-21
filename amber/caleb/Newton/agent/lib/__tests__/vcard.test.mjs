/**
 * Tests for the public Amber vCard builder and the "share contact"
 * intent matcher. Both ship with the EDC contact-card flow.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/vcard.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAmberVcard, vcardFilename } from "../vcard.js";
import {
  wantsVcardShare,
  buildVcardShareReply,
} from "../festival.js";

const camberTenant = {
  id: "did:privy:caleb",
  privyDid: "did:privy:caleb",
  displayName: "Camber",
  agentName: "Camber",
  phoneNumber: "+15550100002",
  loopSenderId: "c351f20c-dec0-44b3-8127-55b662e237a6",
  loopSenderPhone: "+15550100003",
  preferences: {},
};

const samberTenant = {
  id: "did:privy:sagar",
  privyDid: "did:privy:sagar",
  displayName: "Samber",
  agentName: "Samber",
  phoneNumber: "+15550100004",
  loopSenderId: "00069c6f-7e7a-4059-a677-a1fdc77d8813",
  loopSenderPhone: "+15550100005",
  preferences: {},
};

// ── vCard build ──────────────────────────────────────────────────────────

test("buildAmberVcard: produces a valid vCard 3.0 with the public sender phone", () => {
  const vcf = buildAmberVcard(camberTenant);
  assert.ok(vcf, "vcf should be non-null");
  assert.match(vcf, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(vcf, /\r\nEND:VCARD\r\n$/);
  assert.match(vcf, /\r\nFN:Amber\r\n/);
  assert.match(vcf, /\r\nTEL;TYPE=CELL,VOICE,iPhone:\+15550100003\r\n/);
});

test("buildAmberVcard: NEVER leaks the human owner's name or phone", () => {
  // Identity-leak guard — the same class of bug as the Maggie/Sagar
  // regression. The public vCard must contain only the public agent
  // name ("Amber") and the public iMessage sender phone.
  for (const tenant of [camberTenant, samberTenant]) {
    const vcf = buildAmberVcard(tenant);
    assert.ok(vcf);
    // No owner phone numbers
    assert.doesNotMatch(vcf, /\+15550100002/);
    assert.doesNotMatch(vcf, /\+15550100004/);
    // No owner human names — owner is "Caleb Newton" / "Sagar Tiwari"
    assert.doesNotMatch(vcf, /Caleb/i);
    assert.doesNotMatch(vcf, /Sagar/i);
    assert.doesNotMatch(vcf, /Newton/i);
    assert.doesNotMatch(vcf, /Tiwari/i);
    // No internal persona name in the default (public) branding
    assert.doesNotMatch(vcf, /Camber/i);
    assert.doesNotMatch(vcf, /Samber/i);
  }
});

test("buildAmberVcard: returns null when the tenant has no loopSenderPhone", () => {
  assert.equal(buildAmberVcard(null), null);
  assert.equal(buildAmberVcard({}), null);
  assert.equal(
    buildAmberVcard({ ...camberTenant, loopSenderPhone: null }),
    null,
  );
});

test("buildAmberVcard: honors the AMBER_USE_INTERNAL_PERSONA_NAME dev override", () => {
  // Dev path used by the Amber-Dvlp number — operators set the env
  // flag so the dev card brands as "Camber" instead of "Amber" to
  // help smoke tests distinguish.
  const prev = process.env.AMBER_USE_INTERNAL_PERSONA_NAME;
  process.env.AMBER_USE_INTERNAL_PERSONA_NAME = "1";
  try {
    const vcf = buildAmberVcard(camberTenant);
    assert.match(vcf, /\r\nFN:Camber\r\n/);
  } finally {
    if (prev === undefined) {
      delete process.env.AMBER_USE_INTERNAL_PERSONA_NAME;
    } else {
      process.env.AMBER_USE_INTERNAL_PERSONA_NAME = prev;
    }
  }
});

test("vcardFilename: safe ASCII filename based on the public agent name", () => {
  assert.equal(vcardFilename(camberTenant), "Amber.vcf");
  assert.equal(vcardFilename(null), "Amber.vcf");
  assert.equal(
    vcardFilename({ ...camberTenant, preferences: { useInternalPersonaName: true } }),
    "Camber.vcf",
  );
});

// ── Share-intent matcher ────────────────────────────────────────────────

test("wantsVcardShare: matches common phrasings", () => {
  const yes = [
    "send me your contact",
    "share your contact please",
    "drop your vcard",
    "text me your number",
    "save your contact",
    "save Amber's contact",
    "can you send your contact?",
    "could u text me your number",
    "vcard",
    "your contact",
    "your number?",
    "add you to my contacts",
    "how do I save Amber's number",
    "where do I save your contact",
  ];
  for (const t of yes) {
    assert.equal(wantsVcardShare(t), true, `should match: ${t}`);
  }
});

test("wantsVcardShare: doesn't fire on prose", () => {
  const no = [
    "got it, see you at the food trucks",
    "I'll text you later",
    "I need my contact list",
    "share the location pin",
    "what's the next number on the schedule",
    "save the date",
    "save me a spot",
    null,
    "",
  ];
  for (const t of no) {
    assert.equal(wantsVcardShare(t), false, `should NOT match: ${t}`);
  }
});

test("buildVcardShareReply: short, friendly, mentions SAFE pull-cord", () => {
  const r = buildVcardShareReply();
  assert.ok(r.length > 0 && r.length < 220);
  assert.match(r, /SAFE/);
  // No external URLs in copy — the card itself is the payload.
  assert.doesNotMatch(r, /https?:\/\//);
});
