/** Human names only. Never derive identity labels from usernames or social handles. */
export function contactName(contact: { name?: string | null; firstName?: string | null; lastName?: string | null }, fallback = 'Unnamed contact'): string {
  const name = contact.name?.trim();
  const first = contact.firstName?.trim();
  const last = contact.lastName?.trim();
  // Older API builds may replace a full contact name with a linked first name.
  if (first && last && (!name || name === first)) return `${first} ${last}`;
  return name || [first, last].filter(Boolean).join(' ') || fallback;
}
