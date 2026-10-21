import { callMedhaId, type MedhaIdResult } from './medhaId';
import type { PostComment, PostReactions } from './postSocial';

// Amber Connections REST surface on medha-id. Same authed transport + typed
// {ok} envelope as lib/wall.ts — callers branch on `res.ok` the same way.

export type ConnectProfile = {
  amberId: string;
  /**
   * MY OWN CARD FOR THIS PERSON, when I have one.
   *
   * A connection is an ACCOUNT and an account is not a contact card. Tapping
   * somebody used to open /u/<amberId>, the Amber profile -- and an account that
   * has filled nothing in renders as "Amber user", which is a stranger's screen
   * for somebody whose card you have been keeping notes on for months. Null when
   * there genuinely is no card: connected by link, never in the address book.
   */
  contactId?: string | null;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  currentCity: string | null;
};

export type ConnectSearchUser = ConnectProfile & {
  status: 'none' | 'pending_out' | 'pending_in' | 'connected';
};

export type IncomingRequest = {
  requestId: string;
  message: string | null;
  createdAt: string;
  requester: ConnectProfile;
};

export type OutgoingRequest = {
  requestId: string;
  message: string | null;
  createdAt: string;
  addressee: ConnectProfile;
};

export type Connection = {
  connectionId: string;
  connectedAt: string;
  user: ConnectProfile;
};

export type NetworkPost = {
  postId: string;
  text: string;
  createdAt: string;
  author: {
    amberId: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  };
  /**
   * WHAT PEOPLE HAVE SAID BACK, carried with the page rather than fetched per
   * card. The feed embeds these from two grouped queries for the whole page
   * (see socialForPosts) -- a request per row would draw forty empty hearts and
   * then pop them on one by one.
   *
   * OPTIONAL because a build of the app can outlive a build of the server, and
   * a feed from a server that does not send them yet is a feed, not a crash.
   * NO_SOCIAL in lib/postSocial is what stands in.
   */
  reactions?: PostReactions;
  commentCount?: number;
  /**
   * The last two comments, so the card can draw them without a round trip. The
   * COUNT and this are different numbers on purpose: three comments exist and
   * the card shows two, which is what the comments button is for.
   */
  comments?: PostComment[];
};

export function usernameAvailable(
  u: string,
): Promise<MedhaIdResult<{ available: boolean; username: string; reason?: string }>> {
  return callMedhaId<{ available: boolean; username: string; reason?: string }>({
    path: `/v1/me/connect/username-available?u=${encodeURIComponent(u)}`,
    method: 'GET',
    requireAuth: true,
  });
}

export function searchConnectUsers(
  q: string,
): Promise<MedhaIdResult<{ users: ConnectSearchUser[] }>> {
  return callMedhaId<{ users: ConnectSearchUser[] }>({
    path: `/v1/me/connect/search?q=${encodeURIComponent(q)}`,
    method: 'GET',
    requireAuth: true,
  });
}

// Resolve a set of phone numbers to an Amber user (if any of them belong to a
// signed-up account). Powers the contact card's "On Amber" section — resolving
// live means the card auto-updates once a contact later joins Amber.
export function resolveContactAmberUser(
  phones: string[],
): Promise<MedhaIdResult<{ amberUser: ConnectSearchUser | null }>> {
  return callMedhaId<{ amberUser: ConnectSearchUser | null }>({
    path: '/v1/me/connect/resolve-by-phone',
    method: 'POST',
    body: { phones },
    requireAuth: true,
  });
}

// WHAT THE SERVER ACTUALLY SAID. POST /v1/me/connect/requests answers 200 with a
// `status` of requested | connected | already_connected | already_requested. Every
// caller treated 200 as "request sent", so re-tapping a link for someone you are
// already connected to cheerfully claimed a request had gone out. The status is the
// answer; the HTTP code only says the call was understood.
export function connectResultCopy(status: string | undefined, firstName: string): string {
  switch (status) {
    case 'connected':
      return `You're connected with ${firstName}.`;
    case 'already_connected':
      return `You're already connected with ${firstName}.`;
    case 'already_requested':
      return `You already have a request out to ${firstName}.`;
    case 'requested':
    default:
      return `Request sent to ${firstName}.`;
  }
}

export function sendConnectRequest(
  addresseeAmberId: string,
  message?: string,
): Promise<MedhaIdResult<{ status: string; requestId?: string }>> {
  return callMedhaId<{ status: string; requestId?: string }>({
    path: '/v1/me/connect/requests',
    method: 'POST',
    body: { addresseeAmberId, ...(message !== undefined ? { message } : {}) },
    requireAuth: true,
  });
}

export function listIncomingRequests(): Promise<MedhaIdResult<{ requests: IncomingRequest[] }>> {
  return callMedhaId<{ requests: IncomingRequest[] }>({
    path: '/v1/me/connect/requests?direction=incoming',
    method: 'GET',
    requireAuth: true,
  });
}

export function listOutgoingRequests(): Promise<MedhaIdResult<{ requests: OutgoingRequest[] }>> {
  return callMedhaId<{ requests: OutgoingRequest[] }>({
    path: '/v1/me/connect/requests?direction=outgoing',
    method: 'GET',
    requireAuth: true,
  });
}

export function acceptConnectRequest(
  id: string,
): Promise<MedhaIdResult<{ ok: boolean; status?: string }>> {
  return callMedhaId<{ ok: boolean; status?: string }>({
    path: `/v1/me/connect/requests/${encodeURIComponent(id)}/accept`,
    method: 'POST',
    requireAuth: true,
  });
}

export function declineConnectRequest(
  id: string,
): Promise<MedhaIdResult<{ ok: boolean; status?: string }>> {
  return callMedhaId<{ ok: boolean; status?: string }>({
    path: `/v1/me/connect/requests/${encodeURIComponent(id)}/decline`,
    method: 'POST',
    requireAuth: true,
  });
}

export function cancelConnectRequest(id: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/connect/requests/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export function listConnections(): Promise<MedhaIdResult<{ connections: Connection[] }>> {
  return callMedhaId<{ connections: Connection[] }>({
    path: '/v1/me/connect/connections',
    method: 'GET',
    requireAuth: true,
  });
}

export function networkFeed(): Promise<MedhaIdResult<{ posts: NetworkPost[] }>> {
  return callMedhaId<{ posts: NetworkPost[] }>({
    path: '/v1/me/connect/feed',
    method: 'GET',
    requireAuth: true,
  });
}
