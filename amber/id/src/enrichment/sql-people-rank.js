import { query } from "../db/sql.js";

/**
 * Load contacts from Cloud SQL by owner phone in the shape toContactIn()
 * (togari-search-rank.js) expects. Used by the Photon iMessage pipeline where
 * only a phone number is available (no Privy DID).
 *
 * Returns [] on any DB error so callers always get an array.
 */
export async function listContactsForPeople(ownerPhone) {
  try {
    const { rows } = await query(
      `SELECT id, full_name, company, title, city, apple_notes AS notes, phone_primary
       FROM contacts WHERE owner_phone = $1 AND deleted_at IS NULL`,
      [ownerPhone],
    );
    return rows
      .filter((r) => r.id && r.full_name)
      .map((r) => ({
        id: String(r.id),
        name: r.full_name,
        company: r.company || null,
        title: r.title || null,
        city: r.city || null,
        notes: r.notes || null,
        phone: r.phone_primary || null,
        source: null,
      }));
  } catch {
    return [];
  }
}

function scoreContact(contact, tokens) {
  const haystack = [
    contact.full_name,
    contact.company,
    contact.title,
    contact.city,
    contact.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits++;
  }
  return hits;
}

export async function rankContactsFromSql(ownerPhone, queryText, limit = 10) {
  try {
    const { rows } = await query(
      `SELECT id, full_name, company, title, city, apple_notes AS notes, phone_primary
       FROM contacts
       WHERE owner_phone = $1 AND deleted_at IS NULL`,
      [ownerPhone],
    );

    if (!rows.length) return [];

    const tokens = queryText
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const scored = rows
      .map((row) => ({ row, score: scoreContact(row, tokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row }) => ({
        contactId: String(row.id),
        name: row.full_name || "Unknown",
        title: row.title || null,
        company: row.company || null,
      }));

    return scored;
  } catch {
    return [];
  }
}
