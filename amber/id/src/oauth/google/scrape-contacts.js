/**
 * Google People API contact scraper.
 *
 * Pulls the user's full Google contact list from
 *   GET https://people.googleapis.com/v1/people/me/connections
 * and funnels each contact into the unified people graph
 * (Firestore users/{did}/contacts + Pinecone tenant-{did} namespace) via
 * the same upsertContact + indexContacts pipeline LinkedIn and Apple
 * Contacts already use.
 *
 * Auth model: shares the Google OAuth refresh token granted at consent.
 * The People API only ships rows when the user granted
 * https://www.googleapis.com/auth/contacts.readonly. The Phase 1 scope
 * list adds that scope (see scopes.js) so any user who consents after
 * this lands picks up Contacts automatically. Existing users keep working
 * with their prior grant until they reconnect.
 *
 * Best-effort: never throws, never fails the outer HTTP request. Every
 * failure logs and moves on. Batches of 100 are embedded into Pinecone
 * before the next page is fetched so a mid-run timeout still leaves the
 * partial set queryable.
 */

import { upsertContact } from "../../db/user-store.js";
import { getSecret } from "../../db/secrets.js";
import { GOOGLE_SCOPE_FAMILIES } from "./scopes.js";
import { resolveAmberIdByPrivyDid } from "../../db/store.js";
import { isJunk } from "../../lib/google-contacts.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PEOPLE_CONNECTIONS_URL =
  "https://people.googleapis.com/v1/people/me/connections";

const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const PAGE_TIMEOUT_MS = 10000;
const PAGE_PACING_MS = 100;
const EMBED_BATCH_SIZE = 100;

const PERSON_FIELDS = [
  "names",
  "emailAddresses",
  "phoneNumbers",
  "organizations",
  "addresses",
  "occupations",
  "urls",
  "photos",
  "biographies",
  "locations",
].join(",");

function describeFetchError(err) {
  if (!err) return { message: "unknown" };
  const cause = err.cause || {};
  return {
    message: err.message || String(err),
    causeMessage: cause.message,
    causeCode: cause.code,
    causeErrno: cause.errno,
    causeName: cause.name,
  };
}

/**
 * Mint a fresh Google access token from the stored refresh token. Returns
 * null on any failure (network, revoked grant, missing env). Never logs
 * the token value itself; only the failure mode.
 */
async function mintAccessToken(refreshToken, log) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log?.warn(
      { has_client_id: !!clientId, has_client_secret: !!clientSecret },
      "[google:contacts] mint access token aborted, env missing",
    );
    return null;
  }
  let res;
  try {
    res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      describeFetchError(err),
      "[google:contacts] mint token fetch failed",
    );
    return null;
  }
  if (!res.ok) {
    log?.warn(
      { status: res.status },
      "[google:contacts] mint token non-200 response",
    );
    return null;
  }
  const json = await res.json().catch(() => null);
  return json?.access_token || null;
}

async function fetchConnectionsPage(accessToken, pageToken, log) {
  const params = new URLSearchParams({
    personFields: PERSON_FIELDS,
    pageSize: String(PAGE_SIZE),
    sortOrder: "LAST_MODIFIED_DESCENDING",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const url = `${PEOPLE_CONNECTIONS_URL}?${params.toString()}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(describeFetchError(err), "[google:contacts] page fetch failed");
    return { ok: false, error: "fetch_failed" };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: `status_${res.status}` };
  }
  if (!res.ok) {
    log?.warn(
      { status: res.status },
      "[google:contacts] page non-200 response",
    );
    return { ok: false, error: `status_${res.status}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "parse_failed" };
  }
  const connections = Array.isArray(body?.connections) ? body.connections : [];
  return {
    ok: true,
    connections,
    nextPageToken: body?.nextPageToken || null,
    totalPeople: body?.totalPeople ?? body?.totalItems ?? null,
  };
}

function primary(items, field = "value") {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ranked = items.find((it) => it?.metadata?.primary === true) || items[0];
  const v = ranked?.[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function allValues(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => (typeof it?.value === "string" ? it.value.trim() : null))
    .filter(Boolean);
}

function buildContactNotes(person, primaryOrg) {
  const lines = [];
  const bio = primary(person?.biographies, "value");
  if (bio) lines.push(bio);
  const occupations = allValues(person?.occupations);
  if (occupations.length > 0) {
    lines.push(`Occupations: ${occupations.join("; ")}.`);
  }
  if (primaryOrg?.department) {
    lines.push(`Department: ${primaryOrg.department}.`);
  }
  const urls = allValues(person?.urls);
  if (urls.length > 0) lines.push(`Links: ${urls.join(" ")}`);
  return lines.length > 0 ? lines.join(" ") : null;
}

function personToContact(person) {
  const resourceName = person?.resourceName;
  if (!resourceName || typeof resourceName !== "string") return null;
  const nameObj = Array.isArray(person.names)
    ? person.names.find((n) => n?.metadata?.primary === true) || person.names[0]
    : null;
  const displayName =
    nameObj?.displayName ||
    [nameObj?.givenName, nameObj?.familyName].filter(Boolean).join(" ") ||
    primary(person.emailAddresses, "value");
  if (!displayName) return null;

  const orgs = Array.isArray(person.organizations) ? person.organizations : [];
  const primaryOrg =
    orgs.find((o) => o?.metadata?.primary === true) || orgs[0] || null;

  const addresses = Array.isArray(person.addresses) ? person.addresses : [];
  const primaryAddress =
    addresses.find((a) => a?.metadata?.primary === true) ||
    addresses[0] ||
    null;
  const locationFromAddress = primaryAddress?.formattedValue || null;
  const locationFromLocations = primary(person.locations, "value");
  const photoUrl = primary(person.photos, "url");

  return {
    source: "google",
    sourceHandle: resourceName,
    // The BARE People API resourceName, matching what the /v1/me/contacts/
    // import/google path writes. This used to be `google:${resourceName}`, so the
    // same Google person occupied two rows of the (owner_id, external_id) unique
    // index — one per writer — and neither could see the other.
    externalId: resourceName,
    name: displayName,
    firstName: nameObj?.givenName || null,
    lastName: nameObj?.familyName || null,
    emails: allValues(person.emailAddresses),
    phoneNumbers: allValues(person.phoneNumbers),
    company: primaryOrg?.name || null,
    title: primaryOrg?.title || null,
    location: locationFromAddress || locationFromLocations || null,
    notes: buildContactNotes(person, primaryOrg),
    metadata: {
      google: {
        resourceName,
        etag: person?.etag || null,
        photoUrl,
      },
    },
  };
}

/**
 * Top-level orchestrator. Reads the user's Google refresh token from the
 * secrets bag, mints an access token, paginates People API connections,
 * persists each row to Firestore via upsertContact, and embeds them into
 * Pinecone in batches so the back-catalog stays queryable even if a late
 * page times out.
 *
 * Returns a summary object suitable for logging. Never throws; missing
 * scope / missing refresh token resolve to `{ ok: false, reason }`.
 */
export async function scrapeAndIndexGoogleContacts(did, log) {
  if (!did) return { ok: false, reason: "missing_did" };

  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    log?.info({ did }, "[google:contacts] privy_did not linked to amber, skipping");
    return { ok: false, reason: "owner_not_linked" };
  }

  const refreshToken = await getSecret(did, "GCAL_OAUTH_REFRESH");
  if (!refreshToken || refreshToken === "cookie-mode") {
    log?.info({ did }, "[google:contacts] no google refresh token, skipping");
    return { ok: false, reason: "no_refresh_token" };
  }

  const grantedScopes = (await getSecret(did, "GCONTACTS_OAUTH_SCOPES")) || "";
  const familyScopes = GOOGLE_SCOPE_FAMILIES.gcontacts;
  const hasContactsScope = familyScopes.some((s) =>
    grantedScopes.split(/\s+/).includes(s),
  );
  if (!hasContactsScope) {
    log?.info(
      { did },
      "[google:contacts] user has not granted contacts.readonly, skipping",
    );
    return { ok: false, reason: "missing_scope" };
  }

  const accessToken = await mintAccessToken(refreshToken, log);
  if (!accessToken) {
    return { ok: false, reason: "mint_access_token_failed" };
  }

  log?.info({ did }, "[google:contacts] starting people API pull");

  let pagesScraped = 0;
  let connectionsFound = 0;
  let contactsPersisted = 0;
  let contactsIndexed = 0;
  let contactsFiltered = 0;
  let totalPeople = null;
  let pageToken = null;
  let pendingBatch = [];

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    pendingBatch = [];
  };

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchConnectionsPage(accessToken, pageToken, log);
    if (!result.ok) break;
    pagesScraped++;
    if (typeof result.totalPeople === "number") {
      totalPeople = result.totalPeople;
    }
    if (result.connections.length === 0) break;
    connectionsFound += result.connections.length;

    for (const person of result.connections) {
      const contact = personToContact(person);
      if (!contact) continue;
      // Same junk filter the /v1/me/contacts/import/google path applies, so the
      // two Google writers can never disagree about what counts as a contact.
      //
      // This endpoint reads ONLY `people/me/connections` — the SAVED bucket — and
      // saved contacts are never junk, so in practice this drops nothing. That is
      // deliberate, not dead code: it is the guarantee that a contact the user
      // saved is kept, expressed in the one place both paths share. If this
      // scraper ever gains the otherContacts bucket, the harvested-entry rules
      // apply automatically instead of having to be remembered.
      if (
        isJunk({
          bucket: "saved",
          fullName: contact.name,
          phones: contact.phoneNumbers || [],
          emails: contact.emails || [],
        })
      ) {
        contactsFiltered++;
        continue;
      }
      try {
        const saved = await upsertContact(ownerId, contact);
        if (saved) {
          contactsPersisted++;
          pendingBatch.push(saved);
          if (pendingBatch.length >= EMBED_BATCH_SIZE) {
            await flushBatch();
          }
        }
      } catch (err) {
        log?.warn(
          { did, name: contact.name, err: err.message },
          "[google:contacts] upsert failed",
        );
      }
    }

    pageToken = result.nextPageToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, PAGE_PACING_MS));
  }

  await flushBatch();

  const summary = {
    ok: true,
    did,
    pages: pagesScraped,
    connections_found: connectionsFound,
    contacts_persisted: contactsPersisted,
    contacts_indexed: contactsIndexed,
    contacts_filtered: contactsFiltered,
    total_people: totalPeople,
  };
  log?.info(summary, "[google:contacts] pull complete");
  return summary;
}
