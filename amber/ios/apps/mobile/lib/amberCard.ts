import { callMedhaId } from './medhaId';
export type CardLink = {
  id: string;
  label: string;
  value: string;
  type: 'url' | 'email' | 'phone';
  enabled: boolean;
};
export type AmberCard = {
  name: string;
  bio: string;
  links: CardLink[];
  published: boolean;
  updatedAt?: string;
};
export type CardResponse = { card: AmberCard | null; shareUrl: string | null };
export async function loadAmberCard(): Promise<CardResponse> {
  const r = await callMedhaId<CardResponse>({ path: '/v1/me/amber-card', requireAuth: true });
  if (!r.ok) throw Error('Your card could not load. Retry before making changes.');
  return r.data;
}
export async function saveAmberCard(card: AmberCard): Promise<CardResponse> {
  const r = await callMedhaId<CardResponse>({
    path: '/v1/me/amber-card',
    method: 'PUT',
    requireAuth: true,
    body: { ...card, expectedUpdatedAt: card.updatedAt || null },
  });
  if (!r.ok)
    throw Error(
      r.status === 409
        ? 'Your card changed on another device. Reload before saving.'
        : r.status === 400
          ? 'Check your links. Websites need https://, emails need an address, and phone numbers need digits.'
          : 'Could not save. Your last shared card is unchanged.',
    );
  return r.data;
}
