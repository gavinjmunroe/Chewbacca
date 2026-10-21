/**
 * Historical one-time contact cleanup utility.
 *
 * Previously scanned `amber-contacts/` in the now-retired claude-context
 * GitHub repo to fix a class of corrupted entries. Contacts now live in
 * amber-id's operational Firestore store and do not need this sweep.
 * Kept as a no-op export so any remaining imports don't break.
 */

export async function cleanupCorruptedContacts() {
  return;
}
