/** Source names are identity data, not text to shorten or derive from handles. */
export function contactDisplayName(row) {
  return row.full_name?.trim() ||
    [row.first_name?.trim(), row.last_name?.trim()].filter(Boolean).join(" ") ||
    row.linked_name?.trim() || null;
}
