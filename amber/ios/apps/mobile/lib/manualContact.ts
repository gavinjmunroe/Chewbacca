import { callMedhaId } from './medhaId';
import { bustContactsCache } from './network';
export type ManualContactDraft = {
  fullName: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  city?: string;
};
export async function createManualContact(draft: ManualContactDraft): Promise<string> {
  const name = draft.fullName.trim(),
    phone = draft.phone?.trim(),
    email = draft.email?.trim();
  if (!name || !(phone || email)) throw Error('Add a full name and a phone number or email.');
  const result = await callMedhaId<{ ok: boolean; contactId: string }>({
    path: '/v1/me/contacts/create',
    method: 'POST',
    requireAuth: true,
    retries: 0,
    body: {
      name,
      phone,
      email,
      company: draft.company?.trim(),
      title: draft.title?.trim(),
      city: draft.city?.trim(),
    },
  });
  if (!result.ok || !result.data.ok || !result.data.contactId)
    throw Error('Save was not confirmed. Check your network before trying again.');
  bustContactsCache();
  return result.data.contactId;
}
