/**
 * Google contacts fetcher for the multi-source import.
 *
 * Reads the user's Google refresh token from the secrets bag (the same
 * GCAL_OAUTH_REFRESH key the Gmail/Calendar tools and the google OAuth callback
 * use — see src/oauth/google/callback.js), mints an access token, and pulls
 * People API contacts from BOTH buckets:
 *   - SAVED   people/me/connections   (needs contacts.readonly)
 *   - OTHER   otherContacts           (needs contacts.other.readonly)
 *
 * fetchGoogleContacts is read-only. importGoogleContactsForOwner wires it into
 * the merge layer (mergeContact) so imported contacts dedupe into the canonical
 * contacts table. The access-token refresh mirrors the existing mintAccessToken
 * in src/oauth/google/scrape-contacts.js (there is no shared exported helper).
 */

import { getSecret } from "../db/secrets.js";
import {
  mergeContact,
  resolveAmberIdByPrivyDid,
  resolveAmberIdByPhone,
} from "../db/store.js";
import { normalizePhone } from "./auth-session.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";
const OTHER_CONTACTS_URL = "https://people.googleapis.com/v1/otherContacts";
const PAGE_SIZE = 1000;
const TIMEOUT_MS = 15000;

// Machine/bulk sender local-parts (anchored at the start of the full email).
const MACHINE_EMAIL_RE =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|newsletter|mailer(-daemon)?|bounce|postmaster|unsubscribe)@/i;
// Known ESP / bulk-mail domains (substring match on the email domain).
const ESP_DOMAIN_SUBSTRINGS = [
  "mailchimp",
  "sendgrid",
  "sparkpostmail",
  "amazonses",
  "mcsv",
  "mailgun",
];

function isJunkEmail(email) {
  if (typeof email !== "string" || !email) return true;
  const e = email.toLowerCase();
  if (MACHINE_EMAIL_RE.test(e)) return true;
  const domain = e.split("@")[1] || "";
  return ESP_DOMAIN_SUBSTRINGS.some((d) => domain.includes(d));
}

/**
 * Mint a fresh Google access token from the stored refresh token. Returns null
 * on any failure (network, revoked grant, missing env). Mirrors the pattern in
 * src/oauth/google/scrape-contacts.js. Never logs the token value.
 */
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.access_token || null;
  } catch {
    return null;
  }
}

// GET a People API URL with the access token. Throws an Error carrying
// `.status` on a non-OK response so callers can distinguish 403 (missing
// scope) from other failures.
async function getJson(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`people api ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Paginate a People API list endpoint to completion. `key` is the array field
// on each page ("connections" | "otherContacts"). Extra query params via `params`.
async function fetchAllPages(baseUrl, key, params, accessToken) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = await getJson(url, accessToken);
    if (Array.isArray(json?.[key])) out.push(...json[key]);
    pageToken = json?.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Normalize a People API `person` into the unified contact shape.
export function normalizePerson(person, bucket) {
  const name = Array.isArray(person?.names)
    ? person.names.find((n) => n?.metadata?.primary) || person.names[0]
    : null;
  const emails = Array.isArray(person?.emailAddresses)
    ? person.emailAddresses
        .map((e) => (typeof e?.value === "string" ? e.value.trim().toLowerCase() : null))
        .filter(Boolean)
    : [];
  const phones = Array.isArray(person?.phoneNumbers)
    ? person.phoneNumbers
        .map((p) => (typeof p?.value === "string" ? p.value.trim() : null))
        .filter(Boolean)
    : [];
  const org = Array.isArray(person?.organizations) ? person.organizations[0] : null;
  return {
    source: "google",
    bucket,
    externalId: person?.resourceName ?? null,
    fullName: name?.displayName ?? null,
    firstName: name?.givenName ?? null,
    lastName: name?.familyName ?? null,
    emails,
    phones,
    company: org?.name ?? null,
    title: org?.title ?? null,
    // Full original People API person object — persisted losslessly into
    // contact_sources.raw so normalization never drops anything.
    raw: person,
  };
}

/**
 * Junk filter for Google imports. The rule is about PROVENANCE first:
 *
 *   SAVED bucket  → NEVER junk. Full stop. If the user put a contact in their
 *                   Google address book, it is theirs, and no heuristic here
 *                   gets to overrule that — not "no phone and no email", not
 *                   "the only address is a no-reply". A name-only saved contact
 *                   ("Dentist", "Nagu Mama") is a real entry a person typed.
 *   OTHER bucket  → Google auto-harvested these from mail traffic; the user
 *                   never chose them, so they have to earn their place.
 *
 * Previously the reachability rules applied to BOTH buckets, so a saved
 * name-only contact and a saved contact whose only address was a mailing-list
 * sender were silently dropped at import. That is the bug this shape fixes: the
 * bucket check now short-circuits before any reachability test runs.
 *
 * Within the harvested bucket, junk is:
 *   - no name AND no phone — nothing but an address Google scraped; unrankable
 *     (PeopleRank has no name to match on). 162 of 1,125 rows in one real book.
 *   - no phone AND no email — unreachable and carrying no signal at all.
 *   - email-only where EVERY address is a machine/bulk/ESP sender.
 * Anyone harvested with a phone, or with any real email, is kept — including
 * info@/support@/hello@ and small-business domains.
 */
export function isJunk(c) {
  // Deliberately saved by the user → never junk, regardless of what it carries.
  if (c.bucket !== "other") return false;

  const hasPhone = c.phones.length > 0;
  const hasEmail = c.emails.length > 0;
  const hasName = typeof c.fullName === "string" && c.fullName.trim().length > 0;
  if (!hasName && !hasPhone) return true;
  if (!hasPhone && !hasEmail) return true;
  if (!hasPhone && hasEmail) {
    const anyReal = c.emails.some((e) => !isJunkEmail(e));
    if (!anyReal) return true;
  }
  return false;
}

/**
 * Fetch + normalize + junk-filter a user's Google contacts from both buckets.
 * Returns:
 *   { connected:false }                                  when no Google token
 *   { connected:true, otherContactsScope, saved, other,
 *     filteredCount, grantedScopes }                     otherwise
 * `otherContactsScope` is false when the token lacks contacts.other.readonly
 * (the otherContacts call 403s) — that case is caught, not thrown.
 */
export async function fetchGoogleContacts(did) {
  if (!did) return { connected: false };

  const refreshToken = await getSecret(did, "GCAL_OAUTH_REFRESH").catch(() => null);
  if (!refreshToken || refreshToken === "cookie-mode") return { connected: false };

  const grantedScopesStr =
    (await getSecret(did, "GCONTACTS_OAUTH_SCOPES").catch(() => "")) || "";
  const grantedScopes = grantedScopesStr.split(/\s+/).filter(Boolean);

  const accessToken = await refreshAccessToken(refreshToken);
  if (!accessToken) return { connected: false };

  // SAVED contacts.
  const savedRaw = await fetchAllPages(
    CONNECTIONS_URL,
    "connections",
    { personFields: "names,emailAddresses,phoneNumbers,organizations,photos" },
    accessToken,
  );

  // OTHER contacts — tolerate a missing scope (403) by marking the flag.
  let otherContactsScope = true;
  let otherRaw = [];
  try {
    otherRaw = await fetchAllPages(
      OTHER_CONTACTS_URL,
      "otherContacts",
      { readMask: "names,emailAddresses,phoneNumbers" },
      accessToken,
    );
  } catch (err) {
    if (err?.status === 403) {
      otherContactsScope = false;
      otherRaw = [];
    } else {
      throw err;
    }
  }

  let filteredCount = 0;
  const keep = (list, bucket) => {
    const out = [];
    for (const person of list) {
      const c = normalizePerson(person, bucket);
      if (isJunk(c)) {
        filteredCount++;
        continue;
      }
      out.push(c);
    }
    return out;
  };

  const saved = keep(savedRaw, "saved");
  const other = keep(otherRaw, "other");

  return { connected: true, otherContactsScope, saved, other, filteredCount, grantedScopes };
}

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _PERSON_ID_RE = /^[0-9a-f]{32}$/i;

// Resolve any caller identifier to an amber_id (uuid). did / did:amber / bare
// amber_id uuid / 32-hex person_id go through resolveAmberIdByPrivyDid (which
// understands all of them); a phone is resolved via resolveAmberIdByPhone. The
// resulting amber_id is ALSO what getSecret keys the Google token under, so the
// same amber_id serves both the secrets read and mergeContact. Returns null if
// unresolvable.
async function _resolveAmberId(identifier) {
  if (!identifier) return null;
  const s = String(identifier);
  if (s.startsWith("did:") || _UUID_RE.test(s) || _PERSON_ID_RE.test(s)) {
    return resolveAmberIdByPrivyDid(s).catch(() => null);
  }
  const phone = normalizePhone(s);
  return phone ? resolveAmberIdByPhone(phone).catch(() => null) : null;
}

/**
 * Merge already-fetched records into the canonical contacts table, counting what
 * happened. Split out of importGoogleContactsForOwner so the counting is testable
 * without a Google round trip (see google-contacts.test.js).
 *
 * Counts:
 *   created  a person we had no row for
 *   merged   collapsed onto an EXISTING person (a row from an earlier sync)
 *   updated  the same (source, external_id) restated — rule 1, same card
 *   deduped  a SECOND record in THIS run that landed on a person another record
 *            in the same run had already resolved to: two Google cards for one
 *            human, collapsed inside one import
 *   failed   mergeContact could not place the record
 *   people   distinct contacts touched
 */
export async function importContactRecords(ownerId, records) {
  let created = 0;
  let merged = 0;
  let updated = 0;
  let failed = 0;
  let deduped = 0;
  const touched = new Set();

  for (const rec of records) {
    const r = await mergeContact(ownerId, rec);
    if (!r) {
      failed++;
      continue;
    }
    const id = String(r.contactId);
    // `merged` and `deduped` are MUTUALLY EXCLUSIVE, so a client can show both
    // without double-counting: landing on a person another record in this same
    // run already resolved to is an intra-sync duplicate card, not a merge onto
    // the pre-existing address book. This mirrors the Apple path, where `deduped`
    // is payload-internal and `merged` is against rows that were already there.
    if (touched.has(id)) {
      deduped++;
      continue;
    }
    touched.add(id);
    if (r.action === "created") created++;
    else if (r.action === "merged") merged++;
    else if (r.action === "updated") updated++;
  }

  return { created, merged, updated, failed, deduped, people: touched.size };
}

/**
 * Import a caller's Google contacts into the canonical contacts table, deduping
 * via mergeContact. Resolves the identifier to an amber_id (used for BOTH the
 * secrets/token read and mergeContact), fetches both buckets, and merges each
 * normalized record (source:'google') sequentially — fine for hundreds;
 * batching is a later optimization for very large accounts.
 *
 * Returns { connected:false } when the caller has no Google token, else
 * { connected:true, otherContactsScope, fetched, created, merged, updated,
 *   deduped, failed, removed, filteredCount }.
 *
 * `removed` is the junk filter's count (harvested entries with nothing to
 * identify a person by); `filteredCount` is kept as its pre-existing alias.
 */
export async function importGoogleContactsForOwner(identifier) {
  const amberId = await _resolveAmberId(identifier);
  if (!amberId) return { connected: false };

  const result = await fetchGoogleContacts(amberId);
  if (!result.connected) return { connected: false };

  const records = [...result.saved, ...result.other];
  const counts = await importContactRecords(amberId, records);

  // THE LABELS AND AREA CODES, FOR GOOGLE USERS TOO.
  //
  // retagAddressBook derives contact_tags, area_code and area_metro over the
  // whole book, and it was wired into the Apple sync route ONLY. So a
  // Google-only user's book had those columns NULL forever, and every question
  // the labeled or implied layer answers -- "who do I know that goes to USC",
  // "do I know anyone in New York" -- came back empty for them however well
  // their contacts were labeled. Same derivation, same book, one route.
  //
  // Once, here, after the whole import rather than per record: it reads the
  // entire book each time, so calling it inside the loop would redo the work
  // once per contact. Awaited, because the client refreshes the moment this
  // responds and a book whose labels arrive a second later answers the first
  // question with nothing. Never allowed to fail an import that has landed.
  try {
    const { retagAddressBook } = await import("../db/address-book-store.js");
    await retagAddressBook(amberId);
  } catch (err) {
    console.warn(`GOOGLE_IMPORT_RETAG_FAILED owner=${amberId} ${(err?.message || err).toString().slice(0, 160)}`);
  }

  return {
    connected: true,
    otherContactsScope: result.otherContactsScope,
    fetched: records.length,
    created: counts.created,
    merged: counts.merged,
    updated: counts.updated,
    deduped: counts.deduped,
    failed: counts.failed,
    removed: result.filteredCount,
    filteredCount: result.filteredCount,
  };
}
