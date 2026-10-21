/**
 * THE ENTERPRISE FORK, FROM THE BROWSER.
 *
 * Everything here is backed by /v1/org on amber-id and every call goes through
 * lib/amber.ts's `call`, so there is exactly one place that knows where the API
 * lives and one shape of error.
 *
 * NOTHING HERE SENDS AN ORG ID. The server takes the company from the caller's
 * membership row and refuses to read one off a request, so a page that wanted
 * to act on a different organization could not ask -- which is the property
 * worth preserving on this side too. If a function here ever grows an orgId
 * parameter, something has gone wrong on the server.
 *
 * WHAT A SCOPE MEANS ON THIS PAGE. The token minted at sign-in says what it may
 * reach: `org:read` for everyone in a company, `org:admin` only for an active
 * admin, `org:create` only for an account not in one. The UI reads the scope to
 * decide what to RENDER; the server decides what is ALLOWED. Those are
 * different jobs and the first one is only about not showing somebody a button
 * that will 403.
 */

import { apiBase, call, tokenNow, writeSession, type Session } from "./amber";

export type OrgRole = "admin" | "member";
export type MemberStatus = "active" | "suspended";

export type Classification = "public" | "internal" | "customer_safe" | "private";
export type ShareScope = "self" | "group" | "org" | "customer" | "customer_group";

/** The ladder, widest last. Mirrors src/lib/org-scopes.js on the server. */
export const SHARE_SCOPES: ShareScope[] = ["self", "group", "org", "customer", "customer_group"];
export const CLASSIFICATIONS: Classification[] = ["public", "internal", "customer_safe", "private"];

export const SCOPE_LABEL: Record<ShareScope, string> = {
  self: "Only me",
  group: "A group",
  org: "Everyone here",
  customer: "One customer",
  customer_group: "A customer group",
};

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  public: "Public",
  internal: "Internal",
  customer_safe: "Customer-safe",
  private: "Private",
};

export const CLASSIFICATION_HINT: Record<Classification, string> = {
  public: "Already outside. Marketing, published research, anything on the website.",
  internal: "The company's own business. Pipeline, plans, what was said on a call.",
  customer_safe: "Written for a customer to read. Decks, summaries, shared docs.",
  private: "One person's own notes. Nobody else, by default or otherwise.",
};

export type OrgPolicy = Record<Classification, ShareScope>;

export type OrgGroup = {
  id: string;
  name: string;
  /** One line, shown wherever an audience is chosen. */
  purpose: string | null;
  description: string | null;
  memberCount: number;
  /** Where it sits on the canvas. null means it has never been moved. */
  x?: number | null;
  y?: number | null;
  /** Hand order in the list. Shared by the company, not per person. */
  sortOrder?: number;
  /** Set when somebody pinned it above the rest. */
  pinnedAt?: string | null;
};

export type OrgContext =
  | { kind: "individual"; org: null }
  | {
      kind: "org";
      /** The caller's own amber_id, so the console can tell their rows from everyone else's. */
      amberId: string;
      profile: { title: string | null; location: string | null; bio: string | null } | null;
      org: {
        id: string;
        name: string;
        emailDomain?: string | null;
        /** With this on, only addresses on emailDomain can be invited. */
        restrictDomain?: boolean;
        /** What the company does. Null until somebody says, and never nagged for. */
        description?: string | null;
        website?: string | null;
        linkedinUrl?: string | null;
      };
      role: OrgRole;
      status: MemberStatus;
      groups: { id: string; name: string; purpose?: string | null }[];
      policy: OrgPolicy;
      permittedScopes: Record<Classification, ShareScope[]>;
    };

export type OrgMember = {
  orgId: string;
  amberId: string;
  role: OrgRole;
  status: MemberStatus;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  joinedAt: string | null;
  title: string | null;
  location: string | null;
  bio: string | null;
};

export type OrgInvite = {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string | null;
  createdAt: string | null;
};

// ── context ─────────────────────────────────────────────────────────────────

export const getOrgContext = (token: string) => call<OrgContext>("/v1/org/me", {}, token);

/**
 * The response carries a FRESH TOKEN when the caller's was a browser token.
 * The old one was minted before this company existed, so its scope says
 * org:create and not org:admin -- true a second ago, useless now. Storing the
 * new one is what keeps the person who just enrolled their company from being
 * bounced back to the sign-in screen.
 */
export async function createOrg(
  token: string,
  body: { name: string; slug?: string; emailDomain?: string; restrictDomain?: boolean },
) {
  const r = await call<{
    org: { id: string; name: string; slug: string };
    role: OrgRole;
    token?: string;
    scope?: string[];
  }>("/v1/org", { method: "POST", body: JSON.stringify(body) }, token);
  if (r.token) writeSession({ token: r.token, scope: r.scope ?? null });
  return r;
}

// ── roster ──────────────────────────────────────────────────────────────────

/** The company's own settings. Admin only; only the fields sent are changed. */
export const updateOrg = (
  token: string,
  body: {
    name?: string;
    emailDomain?: string | null;
    restrictDomain?: boolean;
    /**
     * What the company does, in its own words. Not decoration: it is what
     * tells the assistant whether "call with Harris at Para" is a fundraise,
     * a customer or a candidate.
     */
    description?: string | null;
    website?: string | null;
    linkedinUrl?: string | null;
  },
) =>
  call<{ org: { id: string; name: string; slug: string; emailDomain: string | null; restrictDomain: boolean } }>(
    "/v1/org",
    { method: "PATCH", body: JSON.stringify(body) },
    token,
  );

/** What this deployment can actually do. Admin only; carries no secrets. */
export type OrgSetup = {
  google: { ready: boolean; missing: string[]; callbackUrl: string | null };
  email: { ready: boolean; missing: string[]; sendingDomain: string | null };
};

export const getOrgSetup = (token: string) => call<OrgSetup>("/v1/org/setup", {}, token);

/**
 * The roster, the groups, and WHO IS IN WHICH GROUP, in one request.
 *
 * The Groups tab used to fetch the group list and then one member list per
 * group — six groups meant seven round trips every time the tab mounted, and
 * mounting happens on every tab click. This is one.
 */
export const getAudienceOptions = (token: string) =>
  call<{
    people: { id: string; name: string }[];
    groups: { id: string; name: string; memberIds: string[] }[];
  }>("/v1/org/audience-options", {}, token);

export const getMembers = (token: string) =>
  call<{ members: OrgMember[]; count: number }>("/v1/org/members", {}, token);

export const updateMember = (
  token: string,
  amberId: string,
  change: { role?: OrgRole; status?: MemberStatus },
) =>
  call<{ ok: true }>(
    `/v1/org/members/${encodeURIComponent(amberId)}`,
    { method: "PATCH", body: JSON.stringify(change) },
    token,
  );

export const removeMember = (token: string, amberId: string) =>
  call<{ ok: true }>(
    `/v1/org/members/${encodeURIComponent(amberId)}`,
    { method: "DELETE" },
    token,
  );

// ── groups ──────────────────────────────────────────────────────────────────

export const getGroups = (token: string) =>
  call<{ groups: OrgGroup[]; count: number }>("/v1/org/groups", {}, token);

export const createGroup = (
  token: string,
  group: { name: string; purpose?: string; description?: string },
) => call<{ group: OrgGroup }>("/v1/org/groups", { method: "POST", body: JSON.stringify(group) }, token);

export const updateGroup = (
  token: string,
  groupId: string,
  group: { name?: string; purpose?: string; description?: string },
) =>
  call<{ ok: true }>(
    `/v1/org/groups/${encodeURIComponent(groupId)}`,
    { method: "PATCH", body: JSON.stringify(group) },
    token,
  );

export const deleteGroup = (token: string, groupId: string) =>
  call<{ ok: true }>(`/v1/org/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" }, token);

export const getGroupMembers = (token: string, groupId: string) =>
  call<{ members: { amberId: string; fullName: string | null }[] }>(
    `/v1/org/groups/${encodeURIComponent(groupId)}/members`,
    {},
    token,
  );

export const addToGroup = (token: string, groupId: string, amberId: string) =>
  call<{ ok: true }>(
    `/v1/org/groups/${encodeURIComponent(groupId)}/members`,
    { method: "POST", body: JSON.stringify({ amberId }) },
    token,
  );

export const removeFromGroup = (token: string, groupId: string, amberId: string) =>
  call<{ ok: true }>(
    `/v1/org/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(amberId)}`,
    { method: "DELETE" },
    token,
  );

// ── the ceiling ─────────────────────────────────────────────────────────────

export const getPolicy = (token: string) =>
  call<{ policy: OrgPolicy; permittedScopes: Record<Classification, ShareScope[]> }>(
    "/v1/org/policy",
    {},
    token,
  );

export const setPolicy = (token: string, policy: Partial<OrgPolicy>) =>
  call<{ policy: OrgPolicy }>("/v1/org/policy", { method: "PUT", body: JSON.stringify({ policy }) }, token);

// ── invites ─────────────────────────────────────────────────────────────────

export const getInvites = (token: string) =>
  call<{ invites: OrgInvite[]; count: number }>("/v1/org/invites", {}, token);

/**
 * The response carries `acceptUrl`. That is the invite link, handed back to the
 * admin who just created it so they can send it however they like -- which is
 * the one place a token is returned on purpose. `emailed` says whether the
 * server also sent it; when mail is not configured it is false and the link is
 * the only copy.
 */
export const createInvite = (
  token: string,
  email: string,
  role: OrgRole = "member",
  groupId?: string | null,
) =>
  call<{
    invite: OrgInvite;
    acceptUrl: string;
    emailed: boolean;
    /** Why it was not emailed, when it was not. See the invite route. */
    deliveryReason: string | null;
    deliveryDetail: string | null;
    /** The domain Resend must have verified. Null when the send succeeded. */
    sendingDomain?: string | null;
  }>(
    "/v1/org/invites",
    { method: "POST", body: JSON.stringify({ email, role, groupId: groupId ?? null }) },
    token,
  );

/**
 * Reissue an invitation and get a link for it.
 *
 * Only the hash of a token is stored, so this genuinely cannot return the
 * original -- it mints a new one and the previous link stops working. The
 * button says so.
 */
export const reissueInvite = (token: string, inviteId: string) =>
  call<{
    invite: OrgInvite;
    acceptUrl: string;
    emailed: boolean;
    deliveryReason: string | null;
    deliveryDetail: string | null;
    /** The domain Resend must have verified. Null when the send succeeded. */
    sendingDomain?: string | null;
  }>(`/v1/org/invites/${encodeURIComponent(inviteId)}/link`, { method: "POST" }, token);

export const revokeInvite = (token: string, inviteId: string) =>
  call<{ ok: true }>(`/v1/org/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }, token);

// ── what has actually been shared ───────────────────────────────────────────

export type OrgShare = {
  id: string;
  itemType: string;
  scopeType: "network" | "circle" | "contact" | "cohort" | "org" | "group";
  scopeRef: string | null;
  groupName: string | null;
  classification: Classification;
  author: string | null;
  authorId: string;
  createdAt: string | null;
  /** False means the current ceiling is blocking it — it reaches nobody today. */
  permitted: boolean;
};

export const getOrgShares = (token: string) =>
  call<{ shares: OrgShare[]; count: number; blocked: number }>("/v1/org/shares", {}, token);

/** What an audience reads as on screen. Keyed by the server's scope_type. */
export const AUDIENCE_LABEL: Record<string, string> = {
  group: "A group",
  org: "Everyone here",
  contact: "One person",
  circle: "A circle",
  cohort: "A cohort",
  network: "Their whole network",
};

// ── joining, and signing in without a phone ─────────────────────────────────

export type InvitePreview = {
  org: { name: string; slug: string };
  email: string;
  role: OrgRole;
  expiresAt: string | null;
};

/** Read-only. Does not spend the invite; the accept below does. */
export const previewInvite = (inviteToken: string) =>
  call<InvitePreview>(`/v1/org/invites/preview?token=${encodeURIComponent(inviteToken)}`);

/**
 * Accept and come back signed in.
 *
 * `existing` is an Amber session the person already has, and passing it means
 * "put THIS account in the company" rather than making a new one -- the person
 * who signed up by phone and was later invited at work.
 */
export async function acceptInvite(inviteToken: string, existing?: string): Promise<Session & { orgId: string; role: OrgRole }> {
  const r = await call<{ token: string; scope: string[] | null; orgId: string; role: OrgRole }>(
    "/v1/org/invites/accept",
    { method: "POST", body: JSON.stringify({ token: inviteToken }) },
    existing,
  );
  const session = { token: r.token, scope: r.scope ?? null };
  writeSession(session);
  return { ...session, orgId: r.orgId, role: r.role };
}

/**
 * SETTING UP A COMPANY STARTS WITH A WORK ADDRESS.
 *
 * It creates the account if there is not one, and the link goes to that inbox —
 * never back in this response. Which also keeps the two instances apart by
 * construction: an admin who signs up this way gets a company account, separate
 * from whatever personal Amber lives on their phone.
 */
/**
 * THE ORDINARY DOOR: a work email and a password.
 *
 * It exists because the other one could close. An account made from a work
 * email has no phone, so a mailed link was its only way in — and an
 * unconfigured mail provider left it with none at all.
 */
/**
 * ONE FIELD, EMAIL OR USERNAME.
 *
 * The server decides which it got by looking for an @, which is also exactly
 * why a username is not allowed to contain one. Asking somebody to first
 * classify their own identifier is asking them to do the computer's job.
 */
export async function signInWithPassword(identifier: string, password: string): Promise<Session> {
  const r = await call<{ token: string; scope: string[] | null }>("/v1/org/auth/password", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  const session = { token: r.token, scope: r.scope ?? null };
  writeSession(session);
  return session;
}

export const startOrgSignup = (email: string) =>
  call<{ ok: true; sent: true }>("/v1/org/auth/email/signup", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const requestEmailLink = (email: string) =>
  call<{ ok: true; sent: true }>("/v1/org/auth/email/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export async function verifyEmailLink(linkToken: string): Promise<Session> {
  const r = await call<{ token: string; scope: string[] | null }>("/v1/org/auth/email/verify", {
    method: "POST",
    body: JSON.stringify({ token: linkToken }),
  });
  const session = { token: r.token, scope: r.scope ?? null };
  writeSession(session);
  return session;
}

/** What the UI may render. The server still decides what is allowed. */
export const can = (scope: string[] | null, s: string) => scope === null || scope.includes(s);

// ── workspaces ──────────────────────────────────────────────────────────────

/**
 * WHICH AMBER THIS PERSON IS IN, AND WHICH OTHERS THEY COULD OPEN.
 *
 * A personal Amber and a work Amber are different accounts with different
 * contacts, different graphs, different everything. The picker is the only
 * thing that spans them and it carries a name and a kind — no contact, note or
 * graph edge is reachable across it, by construction on the server.
 */
export type Workspace = {
  amberId: string;
  kind: "personal" | "work";
  name: string;
  orgName: string | null;
  role: OrgRole | null;
  current: boolean;
};

export const getWorkspaces = (token: string) =>
  call<{ workspaces: Workspace[]; count: number }>("/v1/me/workspaces", {}, token);

/**
 * Linking takes the session as it is at the moment of the call rather than one
 * handed in, because the caller here has just signed in and the credential it
 * would have passed is the one from before that.
 */
export const startWorkspaceLink = (phone: string) =>
  call<{ ok: true; sent: true }>(
    "/v1/me/workspaces/link/start",
    { method: "POST", body: JSON.stringify({ phone }) },
    tokenNow() ?? undefined,
  );

export const verifyWorkspaceLink = (phone: string, code: string) =>
  call<{ ok: true; workspaces: Workspace[] }>(
    "/v1/me/workspaces/link/verify",
    { method: "POST", body: JSON.stringify({ phone, code }) },
    tokenNow() ?? undefined,
  );

/** Mints a session for the other account and stores it. Nothing is merged. */
export async function switchWorkspace(token: string, amberId: string) {
  const r = await call<{ token: string; scope: string[]; kind: "personal" | "work" }>(
    "/v1/me/workspaces/switch",
    { method: "POST", body: JSON.stringify({ amberId }) },
    token,
  );
  writeSession({ token: r.token, scope: r.scope ?? null });
  return r;
}

/** Re-read the credential at the moment of use. See tokenNow in lib/amber. */
export { tokenNow };
/* ───────────────────────────────────────────────── the company canvas */

export type GroupLink = {
  id: string;
  from_group_id: string;
  to_group_id: string;
  from_name: string;
  to_name: string;
  label: string | null;
  description: string | null;
  created_at: string;
};

export const getGroupLinks = (token: string) =>
  call<{ links: GroupLink[] }>("/v1/org/links", {}, token);

export const linkGroups = (
  token: string,
  body: { fromGroupId: string; toGroupId: string; label?: string | null; description?: string | null },
) => call<{ link: GroupLink }>("/v1/org/links", { method: "POST", body: JSON.stringify(body) }, token);

export const updateGroupLink = (
  token: string,
  linkId: string,
  body: { label?: string | null; description?: string | null },
) =>
  call<{ link: GroupLink }>(
    `/v1/org/links/${encodeURIComponent(linkId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    token,
  );

export const unlinkGroups = (token: string, linkId: string) =>
  call<{ ok: true }>(`/v1/org/links/${encodeURIComponent(linkId)}`, { method: "DELETE" }, token);

export const moveGroup = (token: string, groupId: string, x: number, y: number) =>
  call<{ ok: true }>(
    `/v1/org/groups/${encodeURIComponent(groupId)}/position`,
    { method: "PUT", body: JSON.stringify({ x, y }) },
    token,
  );

/* ────────────────────────────────────────────── signing in, and staying in */

export const getCredentials = (token: string) =>
  call<{ username: string | null; hasPassword: boolean; email: string | null; phone: string | null }>(
    "/v1/me/credentials",
    {},
    token,
  );

export const setUsername = (token: string, username: string) =>
  call<{ ok: true; username: string }>(
    "/v1/me/username",
    { method: "PUT", body: JSON.stringify({ username }) },
    token,
  );

export const setPassword = (token: string, password: string, current?: string | null) =>
  call<{ ok: true; created: boolean }>(
    "/v1/me/password",
    { method: "PUT", body: JSON.stringify({ password, current: current ?? null }) },
    token,
  );

/* ───────────────────────────────────────────────────────── ways in */

export type AuthMethods = { google: boolean; password: boolean; emailLink: boolean };

/**
 * Which doors this deployment actually has open.
 *
 * Asked rather than assumed, because a "Continue with Google" button that
 * leads to "Google sign-in is not set up on this server" is worse than no
 * button: it looks like the product is broken rather than unconfigured.
 */
export const getAuthMethods = () => call<AuthMethods>("/v1/org/auth/methods", {});

/**
 * Where to send a browser to start Google sign-in.
 *
 * A plain navigation rather than a fetch: this is an OAuth redirect, and the
 * whole point is that the browser visits Google with its own cookies.
 */
export async function googleSignInUrl(
  email?: string,
  intent?: "signin" | "register",
): Promise<string> {
  const base = await apiBase();
  const q = new URLSearchParams();
  if (email) q.set("email", email);
  // The server signs this into the OAuth state, so it cannot be flipped on the
  // way back. It is what lets the button on the CREATE ACCOUNT screen actually
  // create one, while the button on the sign-in screen still refuses an
  // address nobody invited.
  if (intent) q.set("intent", intent);
  const qs = q.toString();
  return `${base}/v1/org/auth/google/start${qs ? `?${qs}` : ""}`;
}

/** Create a company account with an email and a password, in one call. */
export async function registerWork(body: {
  email: string;
  password: string;
  fullName?: string | null;
}) {
  const r = await call<{ token: string; scope: string[] | null }>("/v1/org/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const session = { token: r.token, scope: r.scope ?? null };
  writeSession(session);
  return session;
}

/**
 * Save the order of the whole list.
 *
 * The entire array, not one group's new index: a drag changes the relative
 * position of everything it moved past, and sending one position makes the
 * server guess at the rest.
 */
export const setGroupOrder = (token: string, ids: string[]) =>
  call<{ ok: true; moved: number }>(
    "/v1/org/groups/order",
    { method: "PUT", body: JSON.stringify({ ids }) },
    token,
  );

export const setGroupPinned = (token: string, groupId: string, pinned: boolean) =>
  call<{ ok: true; pinnedAt: string | null }>(
    `/v1/org/groups/${groupId}/pin`,
    { method: "PUT", body: JSON.stringify({ pinned }) },
    token,
  );
