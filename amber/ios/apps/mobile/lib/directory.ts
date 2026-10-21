import { callMedhaId, type MedhaIdResult } from './medhaId';

// Mutual-profile viewing + intro flow (F4/F6d) REST surface on medha-id. Same
// authed transport + typed {ok} envelope as lib/connect.ts — callers branch on
// `res.ok` the same way.
//
// The server is the authority on visibility: profile/network reads return only
// baseline fields for the viewer (never phone/email). Contact details are
// released solely through an approved intro (getIntroContact).

export type DirectoryProfile = {
  amberId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  company: string | null;
  currentCity: string | null;
  hometown: string | null;
  school: string | null;
  linkedinUrl: string | null;
};

// A baseline contact in someone else's network — no phone/email.
export type DirectoryContact = {
  contactId: string;
  name: string | null;
  title: string | null;
  company: string | null;
  city: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
};

export type IntroStatus = 'pending' | 'approved' | 'declined';

export type Intro = {
  introId: string;
  status: IntroStatus;
  ownerAmberId: string;
  requesterAmberId: string;
  contactId: string;
  contactName: string | null;
  message: string | null;
  createdAt: string;
};

// The contact details released once an intro is approved.
export type IntroContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export function viewUserProfile(
  amberId: string,
): Promise<MedhaIdResult<{ profile: DirectoryProfile }>> {
  return callMedhaId<{ profile: DirectoryProfile }>({
    path: `/v1/users/${encodeURIComponent(amberId)}/profile`,
    method: 'GET',
    requireAuth: true,
  });
}

export function viewUserNetwork(
  amberId: string,
): Promise<MedhaIdResult<{ contacts: DirectoryContact[] }>> {
  return callMedhaId<{ contacts: DirectoryContact[] }>({
    path: `/v1/users/${encodeURIComponent(amberId)}/network`,
    method: 'GET',
    requireAuth: true,
  });
}

export function createIntro(input: {
  ownerAmberId: string;
  contactId: string;
  message?: string;
}): Promise<MedhaIdResult<{ intro: Intro }>> {
  return callMedhaId<{ intro: Intro }>({
    path: '/v1/me/intros',
    method: 'POST',
    body: input,
    requireAuth: true,
  });
}

export function listIntros(
  direction: 'incoming' | 'outgoing',
): Promise<MedhaIdResult<{ intros: Intro[] }>> {
  return callMedhaId<{ intros: Intro[] }>({
    path: `/v1/me/intros?direction=${direction}`,
    method: 'GET',
    requireAuth: true,
  });
}

export function approveIntro(id: string): Promise<MedhaIdResult<{ intro: Intro }>> {
  return callMedhaId<{ intro: Intro }>({
    path: `/v1/me/intros/${encodeURIComponent(id)}/approve`,
    method: 'POST',
    requireAuth: true,
  });
}

export function declineIntro(id: string): Promise<MedhaIdResult<{ intro: Intro }>> {
  return callMedhaId<{ intro: Intro }>({
    path: `/v1/me/intros/${encodeURIComponent(id)}/decline`,
    method: 'POST',
    requireAuth: true,
  });
}

export function getIntroContact(id: string): Promise<MedhaIdResult<{ contact: IntroContact }>> {
  return callMedhaId<{ contact: IntroContact }>({
    path: `/v1/me/intros/${encodeURIComponent(id)}/contact`,
    method: 'GET',
    requireAuth: true,
  });
}
