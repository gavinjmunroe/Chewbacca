import { callMedhaId } from './medhaId';
export type ContactCadence = { summary: string; total: { countAll: number }; rhythm: { label: string | null; trend: string } };
export type ContactProvenance = {
  contactId: string; summary: string;
  sources: { source: string; trustLabel: string; contributed: { name: string | null; company: string | null; emails: string[]; phones: string[] } }[];
  fields: { field: string; source: string; trustLabel: string }[];
};
export const getContactProvenance = (id: string) => callMedhaId<ContactProvenance>({
  path: `/v1/me/contacts/${encodeURIComponent(id)}/provenance`, requireAuth: true,
});
