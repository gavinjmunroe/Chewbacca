// PURE unit test for the privacy field policy — NO DB, NO creds.
// Run: node scripts/test-field-policy.js

import { classifyField, canView, filterForViewer } from "../src/privacy/field-policy.js";

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const OWNER = "owner-1";
const VIEWER = "viewer-2";

// A mixed record spanning all three classes + an unknown field.
const record = {
  full_name: "Jane Doe",
  company: "Acme",
  linkedin_url: "https://linkedin.com/in/jane",
  city: "Chicago",
  phone: "+13125550123",
  emails: "jane@acme.com",
  notes: "secret note",
  enrichment: { provider: "clay" },
  relationship_score: 0.9,
  mystery_field: "should never leak",
};

// ── classification ──
check("classifyField baseline (company)", classifyField("company") === "baseline");
check("classifyField contact_method (phone)", classifyField("phone") === "contact_method");
check("classifyField private (notes)", classifyField("notes") === "private");
check("classifyField camelCase alias (linkedinUrl → baseline)", classifyField("linkedinUrl") === "baseline");
check("classifyField camelCase alias (phonePrimary → contact_method)", classifyField("phonePrimary") === "contact_method");
check("classifyField UNKNOWN → private (fail-closed)", classifyField("mystery_field") === "private");

// ── owner viewing self → sees everything (incl. phone/email/notes) ──
check("owner sees own baseline", canView({ viewerId: OWNER, ownerId: OWNER, field: "company", connected: false, ownerShares: false }));
check("owner sees own contact_method", canView({ viewerId: OWNER, ownerId: OWNER, field: "phone", connected: false, ownerShares: false }));
check("owner sees own private", canView({ viewerId: OWNER, ownerId: OWNER, field: "notes", connected: false, ownerShares: false }));
check("owner sees own unknown field", canView({ viewerId: OWNER, ownerId: OWNER, field: "mystery_field", connected: false, ownerShares: false }));

// ── connected + ownerShares → baseline yes; contact_method/private no ──
const shared = { viewerId: VIEWER, ownerId: OWNER, connected: true, ownerShares: true };
check("connected+shares: baseline company visible", canView({ ...shared, field: "company" }));
check("connected+shares: baseline linkedin_url visible", canView({ ...shared, field: "linkedin_url" }));
check("connected+shares: baseline city visible", canView({ ...shared, field: "city" }));
check("connected+shares: phone NOT visible", !canView({ ...shared, field: "phone" }));
check("connected+shares: email NOT visible", !canView({ ...shared, field: "emails" }));
check("connected+shares: notes NOT visible", !canView({ ...shared, field: "notes" }));
check("connected+shares: enrichment NOT visible", !canView({ ...shared, field: "enrichment" }));
check("connected+shares: unknown field NOT visible", !canView({ ...shared, field: "mystery_field" }));

// ── connected but ownerShares=false → baseline gated off → nothing ──
const noShare = { viewerId: VIEWER, ownerId: OWNER, connected: true, ownerShares: false };
check("connected+noShare: baseline company NOT visible", !canView({ ...noShare, field: "company" }));
check("connected+noShare: phone NOT visible", !canView({ ...noShare, field: "phone" }));

// ── not connected → nothing ──
const stranger = { viewerId: VIEWER, ownerId: OWNER, connected: false, ownerShares: true };
check("stranger: baseline company NOT visible", !canView({ ...stranger, field: "company" }));
check("stranger: phone NOT visible", !canView({ ...stranger, field: "phone" }));

// ── filterForViewer strips contact_method + private + unknown ──
const filtered = filterForViewer(record, { viewerId: VIEWER, ownerId: OWNER, connected: true, ownerShares: true });
const keys = Object.keys(filtered).sort();
check("filter (connected+shares): keeps ONLY baseline keys", JSON.stringify(keys) === JSON.stringify(["city", "company", "full_name", "linkedin_url"]), JSON.stringify(keys));
check("filter: no phone/emails/notes/enrichment/relationship_score/mystery", ["phone", "emails", "notes", "enrichment", "relationship_score", "mystery_field"].every((k) => !(k in filtered)), JSON.stringify(keys));

// filterForViewer for owner returns everything; for stranger returns {}.
const ownerView = filterForViewer(record, { viewerId: OWNER, ownerId: OWNER, connected: false, ownerShares: false });
check("filter (owner): returns all keys", Object.keys(ownerView).length === Object.keys(record).length, JSON.stringify(Object.keys(ownerView)));
const strangerView = filterForViewer(record, { viewerId: VIEWER, ownerId: OWNER, connected: false, ownerShares: true });
check("filter (stranger): returns {}", Object.keys(strangerView).length === 0, JSON.stringify(strangerView));
const noShareView = filterForViewer(record, { viewerId: VIEWER, ownerId: OWNER, connected: true, ownerShares: false });
check("filter (connected+noShare): returns {}", Object.keys(noShareView).length === 0, JSON.stringify(noShareView));

// never mutates input
check("filterForViewer does not mutate input", Object.keys(record).length === 10);

console.log(failed ? "\n❌ FIELD-POLICY TEST FAILED" : "\n✅ FIELD-POLICY TEST PASSED");
process.exit(failed ? 1 : 0);
