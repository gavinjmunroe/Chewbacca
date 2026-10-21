/**
 * WHAT A SCOPED TOKEN IS ALLOWED TO REACH.
 *
 * The website signs in the same way the iOS app does, but the credential ends up
 * in browser storage, which is the single most stealable place a token can live.
 * So a web session gets a token that says what it is for, and this decides
 * whether the route it just called is on that list.
 *
 * IT IS DEFAULT-DENY, AND THAT IS THE ENTIRE DESIGN. The alternative -- add a
 * `requireScope` to the routes a browser must not reach -- is a list somebody
 * has to remember to extend every time a route is added, and the failure mode
 * is a new endpoint that silently accepts web tokens. Here a scoped token can
 * reach exactly what is written below and nothing else, so the failure mode of
 * forgetting is a 403 on a route the site needs, which somebody notices in
 * about four seconds.
 *
 * A TOKEN WITH NO SCOPE CLAIM IS UNRESTRICTED. Every token minted before this
 * existed, and every token iOS holds, has no claim and is not affected by any
 * of this. This adds a restriction to a new kind of credential; it does not
 * take anything away from the existing one.
 */

/** Always reachable, whatever the scope: a session has to be able to end itself. */
const ALWAYS_ALLOWED = new Set([
  "POST /v1/auth/refresh",
  "POST /v1/auth/invalidate",
]);

/**
 * scope -> the routes it grants, as "METHOD <fastify route pattern>".
 *
 * The pattern is the ROUTE, not the URL: "/v1/me/contacts/:contactId" rather
 * than the id that was actually requested. Matching on the resolved URL would
 * mean parsing ids out of paths here, and a parser in an authorization check is
 * a place for bugs to live.
 */
const SCOPE_ROUTES = new Map([
  [
    "network:read",
    ["GET /v1/me/network/edges"],
  ],
  [
    "contacts:read",
    [
      "GET /v1/me/contacts",
      "GET /v1/me/contacts/:contactId",
      "GET /v1/me/contacts/:contactId/profile",
      // Where each piece of a card came from. Reads only what the card itself
      // already exposes, restated with its provenance, so it grants nothing
      // the two routes above do not already grant.
      "GET /v1/me/contacts/:contactId/provenance",
      // How often you two are in touch. Counts of interactions the caller
      // already owns, with no message content anywhere in the response -- the
      // shape is "13 emails in 90 days", never a subject line.
      "GET /v1/me/contacts/:contactId/cadence",
      // Search reads nothing beyond the contacts the caller already owns, and a
      // graph of several thousand people without it is not usable.
      "GET /v1/me/contacts/search",
      // THE CONTENT OF A CARD, AND THIS ONE IS A REAL WIDENING -- worth
      // stating rather than slipping in with the rest.
      //
      // Everything above is structure: who exists, how often you speak, where
      // a field came from. These two are the things somebody actually WROTE --
      // facts observed about a person, and the experiences shared with them --
      // and a browser-stored token is the most stealable place a credential
      // lives. That is exactly the argument this file opens with.
      //
      // It is granted because a contact card without them is a phone number
      // and a job title, which is an address book, not Amber. Both are
      // read-only and scoped to the caller's own contacts; nothing here lets a
      // web session write, delete or resolve a fact, which stays on the phone.
      "GET /v1/me/contacts/:contactId/facts",
      "GET /v1/me/contacts/:id/experiences",
    ],
  ],
  /**
   * THE ORG CONSOLE, WHICH IS A BROWSER FEATURE AND ONLY A BROWSER FEATURE.
   *
   * Everything above was written for a website that reads one person's own
   * graph. The enterprise fork is administered from the same browser and the
   * same stealable token, so its routes are scoped the same way -- and split
   * three ways rather than one, because the three have genuinely different
   * blast radii:
   *
   *   org:read    the roster, the groups, the ceiling. What any member sees.
   *   org:create  enrol a company. Held only by an account that is not in one.
   *   org:admin   change who is in the company and how far things may travel.
   *
   * A token carries org:admin only when the account it was minted for was an
   * admin AT MINT TIME. Demoting somebody does not reach back into a token they
   * already hold -- which is why requireOrgAdmin checks the database on every
   * request as well. The scope narrows what a stolen browser token can reach;
   * the role check is what actually decides.
   */
  [
    "org:read",
    [
      "GET /v1/org/me",
      "GET /v1/org/members",
      "GET /v1/org/groups",
      "GET /v1/org/groups/:groupId/members",
      "GET /v1/org/audience-options",
      "GET /v1/org/connectors",
      "GET /v1/org/connections",
      "POST /v1/org/connections",
      "PATCH /v1/org/connections/:id",
      "DELETE /v1/org/connections/:id",
      "GET /v1/org/groups/:groupId/calendar",
      "GET /v1/org/groups/:groupId/calendar/mine",
      /*
       * CONNECTING A CALENDAR, FROM THE WEB.
       *
       * The team calendar is built out of calendars people have already
       * connected, and until now the only way to connect one was the iOS app
       * -- so the group calendar told an admin to go to "account settings"
       * that, on the website, do not exist. A feature reachable only from a
       * device half the users do not have is a feature that reads as broken.
       *
       * These three are the person's OWN calendars: list, connect, remove.
       * They sit in org:read because every member needs them for the team
       * calendar to be worth anything, and because what they touch is that
       * person's own connection rather than the company's.
       */
      "GET /v1/me/calendars",
      /*
       * SYNCING AND READING YOUR OWN CALENDAR FROM THE WEB.
       *
       * The console could list the calendars somebody had connected and
       * could neither refresh them nor show a single meeting out of them,
       * so the calendar was a row in a settings list rather than a thing
       * anybody could see. Both of these are the caller's own data,
       * resolved from their own session.
       */
      "POST /v1/me/calendars/sync",
      "GET /v1/me/events",
      "DELETE /v1/me/calendars/:id",
      "GET /v1/oauth/google/init",
      "GET /v1/oauth/microsoft/init",
      "POST /v1/org/groups/:groupId/calendar/share",
      "POST /v1/org/groups/:groupId/calendar/events",
      "DELETE /v1/org/groups/:groupId/calendar/events/:eventId",
      "GET /v1/org/policy",
      "GET /v1/org/setup",
      "GET /v1/org/reach",
      "PATCH /v1/org",
      "GET /v1/org/links",
      "POST /v1/org/links",
      "PATCH /v1/org/links/:linkId",
      "DELETE /v1/org/links/:linkId",
      "PUT /v1/org/groups/:groupId/position",
      // Same argument as the canvas position beside it: how a company
      // arranges its own teams is the company's business, and an
      // arrangement only an admin can change is one that stays wrong.
      "PUT /v1/org/groups/order",
      "PUT /v1/org/groups/:groupId/pin",

      /*
       * THE RELATIONSHIP LEDGER, ALL OF IT IN THE MEMBER SCOPE.
       *
       * Reads, the write path and consent all sit here rather than being
       * split across org:read and something narrower, because every one of
       * them is a member acting on their own work. A rep who cannot record
       * an interaction cannot use the product; a rep who cannot revoke their
       * own source is trapped in it, which is the one thing consent must
       * never be.
       *
       * What is NOT here is the whole safety story: there is no route to
       * edit or delete an interaction, and none to write an edge. The ledger
       * is append-only and edges are derived, so the scope does not have to
       * carry a distinction the API never offers.
       */
      "GET /v1/org/memory/people",
      "GET /v1/org/memory/people/:personId",
      "PATCH /v1/org/memory/people/:personId",
      /*
       * Merging is a member decision about the company's own graph, like
       * filing a group or renaming an account. Not admin: the person who
       * spots that three nodes are one colleague is whoever is looking at
       * them, and routing that through an admin means it never happens.
       */
      /*
       * Reading the ceiling is a member right, not an admin one: a rep
       * deciding whether to connect their calendar is entitled to see the
       * rules that will govern it, and a privacy promise nobody can read is
       * one nobody believes. Changing it is admin, enforced by the route's
       * own preHandler rather than by the scope.
       */
      "GET /v1/org/memory/policy",
      "PATCH /v1/org/memory/policy",
      "GET /v1/org/memory/refusals",
      "POST /v1/org/memory/retention/apply",
      "GET /v1/org/memory/duplicates",
      "POST /v1/org/memory/merge",
      "DELETE /v1/org/memory/merge/:personId",
      "GET /v1/org/memory/accounts",
      "GET /v1/org/memory/accounts/:accountId",
      "PATCH /v1/org/memory/accounts/:accountId",
      "POST /v1/org/memory/interactions",
      /*
       * The button somebody presses when they come back from Google. A
       * member acting on their own connections, so it sits with the rest of
       * the member scope rather than behind an admin.
       */
      "POST /v1/org/memory/sync",
      /*
       * Relabeling your own company's rows from the addresses already on
       * them. It reads nothing a member cannot read and writes no new
       * relationship, so it belongs beside the sync rather than behind an
       * admin: the person staring at a graph of email addresses is the one
       * who needs it.
       */
      "POST /v1/org/memory/names",
      "GET /v1/org/memory/names/sources",
      "GET /v1/org/memory/links",
      "POST /v1/org/memory/links",
      "POST /v1/org/memory/links/:linkId/accept",
      "DELETE /v1/org/memory/links/:linkId",
      "POST /v1/org/memory/capture",
      "POST /v1/org/memory/people/:personId/email",
      "POST /v1/org/memory/people/:personId/identities",
      /* A person's wiki page: what we have written that names them, and
         which rooms they are in if they are one of us. */
      "GET /v1/org/memory/people/:personId/profile",
      "GET /v1/org/memory/cold",

      /*
       * COPILOT. Reading the status is a member right for the same reason
       * reading the policy is: somebody deciding whether to use the ask bar
       * is entitled to know whether their company connected Copilot, and the
       * answer carries no content -- a tenant id and a date.
       *
       * Starting the consent is in the same scope and gated to an admin by
       * the route's own preHandler, which is where the other admin-only
       * memory routes draw that line too. The scope says which routes a
       * browser session may reach; the preHandler says who.
       */
      "GET /v1/org/copilot/status",
      "POST /v1/org/copilot/consent-url",

      /*
       * The ask bar. A member read, because the answer is assembled from
       * exactly what that member could already read by clicking through the
       * screens -- it is a faster path to their own evidence, not a wider one.
       */
      "GET /v1/org/ask/available",
      /*
       * A CIRCLE AS A ROOM. Reads only, and every one of them is a read the
       * member could already make one screen at a time -- the same store
       * functions with the same viewer. Putting them behind one call does
       * not widen anything.
       */
      /*
       * THE CALENDAR, AS A PLACE RATHER THAN A SETTING. Reading your own
       * connected calendars and what is on them, pulling them again, and
       * disconnecting one. All of it is the caller's own data.
       */
      "GET /v1/org/calendar",
      "POST /v1/org/calendar/sync",
      "DELETE /v1/org/calendar/:accountId",
      "GET /v1/org/circles",
      "GET /v1/org/circles/:groupId",
      /*
       * Making a project or an artifact in a room. It produces a page, and
       * writing a page is a member's right everywhere else in this API --
       * a wiki only admins may write is a policy document.
       */
      "POST /v1/org/circles/:groupId/build",
      /* Changing something already built by saying what is wrong with it,
         and tagging the assistant in a message to make it act. Both write a
         page, which is a member's right everywhere else in this API. */
      "POST /v1/org/circles/:groupId/work/:pageId/revise",
      "POST /v1/org/circles/:groupId/amber",
      /*
       * SHARE LINKS. Making one and turning it off are member rights for the
       * same reason writing a page is: a wiki only admins may share is a
       * policy document. The public route that serves the page takes no
       * session at all and is therefore not in any scope.
       */
      "POST /v1/org/pages/:pageId/link",
      "GET /v1/org/pages/:pageId/links",
      "DELETE /v1/org/share-links/:linkId",
      "POST /v1/org/ask",
      // The same question, answered as it is written. Same evidence, same
      // permission model, different transport.
      "POST /v1/org/ask/stream",
      "GET /v1/org/memory/sources",
      "POST /v1/org/memory/sources",
      "DELETE /v1/org/memory/sources/:sourceId",

      /*
       * AI history, and publishing one piece of it.
       *
       * The import is a member acting on their OWN export, and the share is a
       * member publishing their OWN row, so both belong to the member scope
       * for the same reason the rest of the ledger does. There is no admin
       * route here and there is deliberately no column an admin could set:
       * nobody can share somebody else's AI work on their behalf.
       */
      "POST /v1/org/memory/import",
      "GET /v1/org/memory/imports",
      "DELETE /v1/org/memory/imports/:importId",
      "POST /v1/org/memory/interactions/:interactionId/share",
      "DELETE /v1/org/memory/interactions/:interactionId/share",
    ],
  ],
  ["org:create", ["POST /v1/org"]],
  /**
   * The workspace picker. It returns names and kinds and no content at all, and
   * switching mints a session for an account this one has already proven it
   * holds -- so it is reachable by any web session, and it widens nothing.
   */
  /**
   * THE ACCOUNT'S OWN SIGN-IN SETTINGS.
   *
   * Its own scope rather than folded into profile:write, because these three
   * routes change how somebody gets in rather than what their profile says,
   * and that is a different thing to hand a stolen browser token. Setting a
   * password still requires the current one when one exists, which is what
   * actually stops a stolen session from taking the account.
   */
  [
    "credentials",
    [
      "GET /v1/me/credentials",
      "PUT /v1/me/username",
      "PUT /v1/me/password",
    ],
  ],
  [
    "workspaces",
    [
      "GET /v1/me/workspaces",
      "POST /v1/me/workspaces/link/start",
      "POST /v1/me/workspaces/link/verify",
      "POST /v1/me/workspaces/switch",
    ],
  ],
  /**
   * THE WRITES A BROWSER NEEDS TO BE A WHOLE PRODUCT.
   *
   * Until now a web session could read a graph and nothing else, which was
   * correct while the website was a viewer sitting beside an iOS app. It stops
   * being correct the moment somebody is told they can set up a company here:
   * an account that cannot say its own name, and an address book that cannot be
   * filled without a phone, is not an account somebody can use.
   *
   * SO THE LIST GREW, AND IT GREW BY NAME. Every route here was argued for one
   * at a time, which is the property default-deny buys and the reason this is
   * not simply "web sessions are unrestricted now":
   *
   *   profile:write   your own name, city, role. PATCH /v1/me and nothing else.
   *   contacts:write  add a person, upload an export, write a note on a card.
   *                   No delete, no merge, no enrichment spend -- destructive
   *                   and billable actions stay on the phone, where the
   *                   credential is not sitting in browser storage.
   *   shares:write    address something to an audience, and take it back. This
   *                   is the one that makes the ceiling mean anything: without
   *                   it the policy governs a thing nobody on the web can do.
   */
  ["profile:write", ["PATCH /v1/me", "GET /v1/me"]],
  [
    "contacts:write",
    [
      "POST /v1/me/contacts/create",
      "POST /v1/me/contacts/import-file",
      "POST /v1/me/contacts/:contactId/note",
    ],
  ],
  [
    "shares:write",
    [
      "POST /v1/me/shares",
      "POST /v1/me/shares/unshare",
      "DELETE /v1/me/shares/:id",
      "GET /v1/me/shares/for-item",
      "GET /v1/me/shared-with-me",
    ],
  ],
  /**
   * THE WIKI, THE DRIVE AND THE FEED, as one scope.
   *
   * It is not folded into org:read because org:read is a read scope and this
   * writes, and it is not folded into org:admin because writing here is a
   * member's right -- a wiki only admins can edit is a policy document. It is
   * one scope rather than a read and a write pair because the two are used by
   * the same screen in the same breath: nobody opens a page without being able
   * to fix the typo they came to fix.
   *
   * What it reaches is bounded by the caller's own organization in every
   * handler, so the worst a stolen token with this scope can do is read and
   * write that one company's pages -- which is also what the person it was
   * stolen from could do.
   */
  [
    "org:knowledge",
    [
      "GET /v1/org/knowledge",
      "GET /v1/org/pages",
      "GET /v1/org/pages/search",
      "POST /v1/org/pages",
      "GET /v1/org/pages/:pageId",
      "PATCH /v1/org/pages/:pageId",
      "DELETE /v1/org/pages/:pageId",
      "GET /v1/org/pages/:pageId/revisions",
      "GET /v1/org/pages/:pageId/audience",
      "POST /v1/org/pages/:pageId/files/upload-url",
      "POST /v1/org/pages/:pageId/files/:attachmentId",
      "GET /v1/org/pages/:pageId/files/:attachmentId",
      "DELETE /v1/org/pages/:pageId/files/:attachmentId",
      "GET /v1/org/feed",
      "POST /v1/org/feed",
      "POST /v1/org/feed/seen",
      "POST /v1/org/feed/:postId/react",
      "GET /v1/org/feed/:postId/reactions",
      "POST /v1/org/feed/:postId/pin",
      "GET /v1/org/feed/:postId/answers",
      "POST /v1/org/feed/:postId/answers",
      "POST /v1/org/feed/:postId/answers/:answerId/accept",
      "DELETE /v1/org/feed/:postId",
      "GET /v1/org/experts",
      "GET /v1/org/people/:amberId",
      "PUT /v1/org/me/profile",
      "GET /v1/org/directory",
      "GET /v1/org/drive",
      "GET /v1/org/files",
      "GET /v1/org/tags",
      "POST /v1/org/files/upload-url",
      "POST /v1/org/files/:fileId",
      "GET /v1/org/files/:fileId/url",
      "GET /v1/org/files/:fileId/audience",
      "PATCH /v1/org/files/:fileId",
      "DELETE /v1/org/files/:fileId",
    ],
  ],
  [
    "org:admin",
    [
      "POST /v1/org/invites",
      "GET /v1/org/invites",
      "GET /v1/org/shares",
      "DELETE /v1/org/invites/:inviteId",
      "POST /v1/org/invites/:inviteId/link",
      "POST /v1/org/groups",
      "PATCH /v1/org/groups/:groupId",
      "DELETE /v1/org/groups/:groupId",
      "POST /v1/org/groups/:groupId/members",
      "DELETE /v1/org/groups/:groupId/members/:amberId",
      "PATCH /v1/org/members/:amberId",
      "DELETE /v1/org/members/:amberId",
      "PUT /v1/org/policy",
      "POST /v1/org/pages/:pageId/archive",
      /*
       * CONNECTORS AND KEYS.
       *
       * Adding a connector states that the company moves data through a
       * product, and a key is a credential that outlives whoever made it --
       * both are admin-shaped, so they live here rather than in org:read.
       * Reading the directory is not: GET /v1/org/connectors is a catalog
       * every member can see, and it sits with the other reads above.
       *
       * These were missing entirely, which is not the same as being denied:
       * a route in no scope at all is refused for every browser session with
       * "this session is not allowed to do that", including an owner's. A
       * capability that exists in the API and in no scope list is a feature
       * that cannot be reached from the product it was built for.
       */
      "POST /v1/org/connectors",
      "PATCH /v1/org/connectors/:id",
      "DELETE /v1/org/connectors/:id",
      "GET /v1/org/api-keys",
      "POST /v1/org/api-keys",
      "DELETE /v1/org/api-keys/:id",
    ],
  ],
]);

/** The scopes a website session is minted with. */
export const WEB_SESSION_SCOPE = Object.freeze(["network:read", "contacts:read"]);

/**
 * THE SCOPES A WEBSITE SESSION GETS, AND WHY THEY NO LONGER DEPEND ON THE
 * PERSON.
 *
 * This used to compute the list from the caller's membership: org:create only
 * for somebody not in a company, org:admin only for an active admin. It was a
 * nice idea and it was wrong, because a scope is baked into a token at mint
 * time and the facts it was computed from are not.
 *
 * What it produced in practice: somebody signs in, creates their company --
 * which makes them an admin one millisecond after their token said they were
 * not -- and every admin call for the next eight hours is refused with "this
 * session can only read your network and your contacts". The token has to be
 * re-minted, the client has to notice, and every path that forgets is a 403
 * nobody can explain. That is a lot of failure to buy a property the route
 * checks anyway.
 *
 * SO THE LIST IS STATIC AND THE ROLE IS CHECKED WHERE IT CAN BE CHECKED
 * HONESTLY: in requireOrgAdmin, against the database, on every single request.
 * Scope keeps doing the job it is actually good at -- bounding which ROUTES a
 * stolen browser token can reach at all, default-deny, one line per route -- and
 * stops pretending to answer a question about who somebody is right now.
 *
 * Note what is still NOT here: delete, merge, enrichment spend, DMs, the
 * secrets bag. A stolen web token is still worth far less than a stolen app
 * token, which was always the point.
 */
export const WEB_SESSION_FULL_SCOPE = Object.freeze([
  ...WEB_SESSION_SCOPE,
  "profile:write",
  "contacts:write",
  "shares:write",
  "org:read",
  "org:create",
  "org:admin",
  "org:knowledge",
  "credentials",
  "workspaces",
]);

/**
 * Kept as the one entry point every mint path calls, so there is still exactly
 * one answer to "what does a browser session carry". The membership argument is
 * ignored and is accepted only so the three call sites did not all have to
 * change in the same commit as the behavior.
 */
export function webSessionScopeFor() {
  return WEB_SESSION_FULL_SCOPE;
}

/** Every scope name this service knows. Used to refuse a token asking for one it invented. */
export function knownScopes() {
  return [...SCOPE_ROUTES.keys()];
}

/**
 * May a token carrying `scope` call `method routePattern`?
 *
 * `scope` null/undefined means an unrestricted token: always true.
 */
export function scopeAllows(scope, method, routePattern) {
  if (!Array.isArray(scope)) return true; // unrestricted -- the iOS token
  if (!routePattern) {
    // No route pattern means the request did not match a registered route, or
    // Fastify changed where it puts it. Either way this check cannot make an
    // informed decision, and an authorization check that cannot decide must
    // say no.
    return false;
  }
  const key = `${String(method).toUpperCase()} ${routePattern}`;
  if (ALWAYS_ALLOWED.has(key)) return true;
  for (const s of scope) {
    const routes = SCOPE_ROUTES.get(s);
    if (routes && routes.includes(key)) return true;
  }
  return false;
}
