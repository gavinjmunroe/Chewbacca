import { chooseAppleContact, saveToAppleContacts } from './appleContactWrite';
import { syncAppleContactById } from './contactsSync';
import { callMedhaId } from './medhaId';
import type { ManualContactDraft } from './manualContact';
/** Used after a person or memo's detail review. The native match choice is explicit. */
export async function createReviewedContact(draft: ManualContactDraft): Promise<string> {
  if (!draft.fullName.trim() || !(draft.email?.trim() || draft.phone?.trim()))
    throw Error('Add a full name and a phone number or email.');
  const person = {
    name: draft.fullName.trim(),
    company: draft.company,
    title: draft.title,
    emails: draft.email ? [draft.email.trim()] : [],
    phoneNumbers: draft.phone ? [draft.phone.trim()] : [],
  };
  const selected = await chooseAppleContact(person, true);
  const id = await saveToAppleContacts(person, selected?.id);
  const sync = await syncAppleContactById(id);
  if (!sync.ok || sync.failed)
    throw Error('Saved to Apple Contacts. Retry to finish syncing the same card to Amber.');
  const r = await callMedhaId<{ contactId: string }>({
    path: `/v1/me/contacts/apple-link/${encodeURIComponent(id)}`,
    requireAuth: true,
  });
  if (!r.ok)
    throw Error(
      'Your contact is saved. Its Amber match is not confirmed yet; retry before attaching the memo.',
    );
  return r.data.contactId;
}
