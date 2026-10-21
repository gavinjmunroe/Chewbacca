/**
 * WHERE EVERY PIECE OF THIS CONTACT CAME FROM.
 *
 * An Amber card is an amalgamation: an Apple card, a Google card, the address
 * somebody has been emailing, a Clay enrichment, a name typed by hand. That is
 * the whole value of it, and it is also the reason people distrust it. A card
 * that says "Sagar Tiwari, Rytual, +1555..." and cannot say WHERE any of that
 * came from is asking to be believed. A card that can show Apple gave the
 * phone, Gmail gave the work address, and Clay guessed the title is one
 * somebody can actually check.
 *
 * NOTHING NEW IS STORED FOR THIS. Three things already written on every path
 * are simply read back:
 *
 *   contact_sources     every source that ever claimed this person, with the
 *                       RAW values it sent -- so "Google called him Sagar T."
 *                       survives even after the merged card settled on
 *                       "Sagar Tiwari"
 *   contacts.field_sources  which source owns each field on the card TODAY,
 *                       written by the merge engine as it resolves conflicts
 *   contact_merges      the duplicates this card absorbed, so "one card, built
 *                       from three" is visible rather than implied
 *
 * IDENTITY KEYS ARE COUNTED, NEVER RETURNED. contact_identity_keys holds salted
 * hashes of phones and emails. They are how the resolver matches people, and
 * they are not something a card needs to display -- so this reports how many
 * keys of each kind anchor the contact, which is the useful signal ("this
 * person is anchored by 3 emails and 2 phones"), and never the hashes.
 */

import { query } from "./sql.js";
import { trustOf, TRUST } from "../lib/source-trust.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** The tier names, so a client renders words rather than the integers 0-3. */
const TIER_LABEL = Object.freeze({
  [TRUST.OWNER_STATED]: "you",
  [TRUST.OWNER_SYNCED]: "your accounts",
  [TRUST.AMBER_DERIVED]: "amber",
  [TRUST.VENDOR]: "enrichment",
});

const splitList = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Everything known about how this card was assembled.
 *
 * Returns null when the contact is not this owner's or does not exist, so the
 * route can 404 without a second lookup.
 */
export async function getContactProvenance(ownerId, contactId) {
  const owner = asUuid(ownerId);
  const contact = asUuid(contactId);
  if (!owner || !contact) return null;

  const { rows: cards } = await query(
    `SELECT id, full_name, source, source_tier, field_sources, created_at, updated_at
       FROM contacts
      WHERE owner_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
    [owner, contact],
  );
  if (!cards.length) return null;
  const card = cards[0];

  // Run the three reads together: they are independent, and a card panel that
  // waits for them in series is three round trips of latency for no reason.
  const [sourceRows, keyRows, mergeRows] = await Promise.all([
    query(
      `SELECT source, external_id, raw_full_name, raw_emails, raw_phones, raw_company,
              created_at, updated_at
         FROM contact_sources
        WHERE owner_id = $1::uuid AND contact_id = $2::uuid AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [owner, contact],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT key_type, count(*)::int AS n
         FROM contact_identity_keys
        WHERE owner_id = $1::uuid AND contact_id = $2::uuid
        GROUP BY key_type`,
      [owner, contact],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT id, absorbed_ids, origin, rule, merged_at, undone_at
         FROM contact_merges
        WHERE owner_id = $1::uuid AND survivor_id = $2::uuid AND undone_at IS NULL
        ORDER BY merged_at DESC
        LIMIT 20`,
      [owner, contact],
    ).catch(() => ({ rows: [] })),
  ]);

  return shapeProvenance({
    card,
    sourceRows: sourceRows.rows,
    keyRows: keyRows.rows,
    mergeRows: mergeRows.rows,
  });
}

/**
 * THE SHAPING, WITH NO DATABASE IN IT.
 *
 * Separated from the reads on purpose. The in-memory SQL fake cannot answer
 * these four queries, so a unit test that went through getContactProvenance
 * would be asserting against an empty result and proving nothing -- green, and
 * testing air. Every decision worth getting right lives here instead, where it
 * can be handed real row shapes and checked: that a source's RAW values survive
 * the merge, that key material never reaches the payload, that the ordering is
 * stable. The wrapper above is four SELECTs and a null check, and the smoke
 * script covers that it runs.
 */
export function shapeProvenance({ card, sourceRows = [], keyRows = [], mergeRows = [] }) {
  // ── what each source contributed, in its own words ────────────────────────
  const sources = sourceRows.map((r) => {
    const label = String(r.source ?? "unknown");
    const tier = trustOf(label);
    return {
      source: label,
      trust: tier,
      trustLabel: TIER_LABEL[tier] ?? "enrichment",
      externalId: r.external_id ?? null,
      firstSeen: r.created_at ?? null,
      lastSeen: r.updated_at ?? null,
      // The RAW values, not the merged ones. This is the point: it shows what
      // this source actually said, including where it disagreed with the card.
      contributed: {
        name: r.raw_full_name ?? null,
        emails: splitList(r.raw_emails),
        phones: splitList(r.raw_phones),
        company: r.raw_company ?? null,
      },
    };
  });

  // ── which source owns each field on the card right now ────────────────────
  const fs = card.field_sources && typeof card.field_sources === "object" ? card.field_sources : {};
  const fields = Object.entries(fs)
    .filter(([, v]) => v != null)
    .map(([field, source]) => {
      const tier = trustOf(String(source));
      return {
        field,
        source: String(source),
        trust: tier,
        trustLabel: TIER_LABEL[tier] ?? "enrichment",
      };
    })
    // Alphabetical, so a strip does not reorder itself between two reads of the
    // same unchanged card.
    .sort((a, b) => a.field.localeCompare(b.field));

  // ── how many identities anchor this person, never which ───────────────────
  const identityKeys = { phone: 0, email: 0, source: 0 };
  for (const r of keyRows) {
    if (r.key_type === 1) identityKeys.phone = r.n;
    else if (r.key_type === 2) identityKeys.email = r.n;
    else if (r.key_type === 3) identityKeys.source = r.n;
  }

  const merges = mergeRows.map((r) => ({
    mergeId: String(r.id),
    absorbed: Array.isArray(r.absorbed_ids) ? r.absorbed_ids.length : 0,
    // "auto" means the resolver decided during a sync; "user" means somebody
    // tapped Merge. Worth showing, because they warrant different trust.
    origin: r.origin ?? null,
    rule: r.rule ?? null,
    mergedAt: r.merged_at ?? null,
  }));

  return {
    contactId: String(card.id),
    name: card.full_name ?? null,
    // The card's own label and tier, which is the most authoritative source
    // that has contributed to it.
    primarySource: card.source ?? null,
    primaryTrust: Number.isFinite(card.source_tier)
      ? card.source_tier
      : trustOf(card.source),
    createdAt: card.created_at ?? null,
    updatedAt: card.updated_at ?? null,
    sources,
    fields,
    identityKeys,
    merges,
    // A one-line answer for a strip that has room for one line.
    summary: summarize(sources, merges),
  };
}

/**
 * "Built from Apple, Google and Clay, with 2 duplicates merged in."
 *
 * Composed here rather than in each client so the phone and the website say the
 * same sentence, and so changing the wording is one edit rather than two.
 */
function summarize(sources, merges) {
  const names = [...new Set(sources.map((s) => s.source))];
  if (names.length === 0) return "No recorded source for this contact.";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const absorbed = merges.reduce((n, m) => n + m.absorbed, 0);
  if (absorbed === 0) return `Built from ${list}.`;
  return `Built from ${list}, with ${absorbed} duplicate${absorbed === 1 ? "" : "s"} merged in.`;
}
