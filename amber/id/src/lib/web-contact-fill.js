/**
 * Fill a contact you saved from web search with what the web actually says about
 * them, and write the leftovers down as a note.
 *
 * THE ONE RULE: fill blanks, never overwrite. A saved-from-web contact may
 * already exist — createContactForOwner dedupes and merges — so the row can
 * already hold a phone number the user synced from their address book and a
 * company they typed themselves. Replacing either with something a model read
 * off a page would be destructive, silent, and impossible for the user to
 * notice. Every write here is conditional on the column being empty.
 *
 * SECOND RULE: this can never break the save. It runs after the response is
 * sent, every step is individually caught, and a total failure leaves a contact
 * that has exactly what the user typed — which is what they got before this
 * existed. Every skip and every failure logs, so an empty card is always
 * explainable from the logs rather than a mystery.
 */

import {
  getContactWebFields as defaultGetContactWebFields,
  setContactLinkFields as defaultSetContactLinkFields,
  updateContactFields as defaultUpdateContactFields,
  insertContactNote as defaultInsertContactNote,
} from "../db/store.js";
import {
  fetchProfileText as defaultFetchProfileText,
  extractProfileFields as defaultExtractProfileFields,
  webUrlFields,
} from "./web-profile.js";

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * Decide what to write. PURE — no DB, no network — so the fill-blanks-only rule
 * is testable directly.
 *
 *   planWebContactFill({ existing, core, links })
 *     -> { fieldUpdates, linkUpdates, skipped }
 *
 * `fieldUpdates` is the updateContactFields argument shape (camelCase, phone and
 * email get their own normalization there); `linkUpdates` is column-named
 * because setContactLinkFields writes columns. `skipped` names every field we
 * had a value for and did NOT write, so the log says why the card looks the way
 * it does.
 */
export function planWebContactFill({ existing = null, core = {}, links = {} } = {}) {
  const cur = existing || {};
  const fieldUpdates = {};
  const linkUpdates = {};
  const skipped = [];

  const put = (target, key, curValue, next) => {
    if (isBlank(next)) return;
    if (!isBlank(curValue)) {
      skipped.push(key);
      return;
    }
    target[key] = next;
  };

  put(fieldUpdates, "title", cur.title, core.title);
  put(fieldUpdates, "company", cur.company, core.company);
  put(fieldUpdates, "city", cur.city, core.city);
  put(fieldUpdates, "phone", cur.phone, core.phone);
  put(fieldUpdates, "email", cur.emails, core.email);
  // fullName is deliberately absent: the user chose the name in the save sheet,
  // and a page's rendering of it ("D. Renaldo", "Danielle Renaldo, CFA") is not
  // an improvement on what they picked.

  for (const col of ["linkedin_url", "twitter_url", "github_url", "website", "avatar_url"]) {
    put(linkUpdates, col, cur[col], links[col]);
  }

  return { fieldUpdates, linkUpdates, skipped };
}

/**
 * The synchronous half: the URL you saved them from IS a field. No network, no
 * key, no model — so the LinkedIn link is on the card the moment the contact
 * exists, even when extraction is off or the page is unreadable.
 *
 * Returns the columns written.
 */
export async function applyProfileUrlFields({
  ownerId,
  contactId,
  profileUrl,
  log = null,
  deps = {},
} = {}) {
  const getFields = deps.getContactWebFields || defaultGetContactWebFields;
  const setLinks = deps.setContactLinkFields || defaultSetContactLinkFields;
  const links = webUrlFields(profileUrl);
  if (Object.keys(links).length === 0) return [];
  const existing = await getFields(ownerId, contactId).catch(() => null);
  const { linkUpdates } = planWebContactFill({ existing, links });
  if (Object.keys(linkUpdates).length === 0) return [];
  const res = await setLinks(ownerId, contactId, linkUpdates).catch((err) => {
    log?.warn?.({ err: err?.message, contactId }, "[web-fill] link write failed");
    return null;
  });
  if (res) log?.info?.({ contactId, columns: Object.keys(linkUpdates) }, "[web-fill] profile url stored");
  return Object.keys(linkUpdates);
}

/**
 * The background half: read the page, extract the rest, fill the blanks, write
 * the leftovers as a note. Resolves to a summary; never rejects.
 */
export async function fillWebContactFromProfile({
  ownerId,
  contactId,
  name = null,
  profileUrl,
  snippet = null,
  log = null,
  deps = {},
} = {}) {
  const summary = { filled: [], skipped: [], extras: 0, reason: null };
  if (!ownerId || !contactId || !profileUrl) {
    summary.reason = "missing_args";
    return summary;
  }
  const readPage = deps.fetchProfileText || defaultFetchProfileText;
  const extract = deps.extractProfileFields || defaultExtractProfileFields;
  const getFields = deps.getContactWebFields || defaultGetContactWebFields;
  const setLinks = deps.setContactLinkFields || defaultSetContactLinkFields;
  const setFields = deps.updateContactFields || defaultUpdateContactFields;
  const addNote = deps.insertContactNote || defaultInsertContactNote;

  try {
    const pageText = await readPage({ url: profileUrl, log });
    const extracted = await extract({ profileUrl, name, pageText, snippet, log });
    if (!extracted) {
      summary.reason = "nothing_extracted";
      log?.info?.({ contactId, profileUrl }, "[web-fill] no fields extracted");
      return summary;
    }
    const existing = await getFields(ownerId, contactId).catch(() => null);
    const { fieldUpdates, linkUpdates, skipped } = planWebContactFill({
      existing,
      core: extracted.core,
      links: extracted.links,
    });
    summary.skipped = skipped;

    if (Object.keys(fieldUpdates).length > 0) {
      const ok = await setFields({ ownerId, contactId, ...fieldUpdates }).catch((err) => {
        log?.warn?.({ err: err?.message, contactId }, "[web-fill] field write failed");
        return null;
      });
      if (ok) summary.filled.push(...Object.keys(fieldUpdates));
    }
    if (Object.keys(linkUpdates).length > 0) {
      const ok = await setLinks(ownerId, contactId, linkUpdates).catch((err) => {
        log?.warn?.({ err: err?.message, contactId }, "[web-fill] link write failed");
        return null;
      });
      if (ok) summary.filled.push(...Object.keys(linkUpdates));
    }

    // The leftovers. One note, clearly marked as read off a page rather than
    // something the user said, so the card never presents a scrape as a memory.
    if (extracted.extras.length > 0) {
      // A uuid, not a number. Number(contactId) was NaN, Number.isFinite said no,
      // and participantIds went out EMPTY -- so a note scraped from the web was
      // never attached to the contact it was scraped for.
      const cid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(String(contactId)) ? String(contactId) : null;
      const body = [
        `From the web (${profileUrl}):`,
        ...extracted.extras.map((e) => `• ${e}`),
      ].join("\n");
      const noteId = await addNote({
        ownerId,
        noteText: body,
        participantIds: cid ? [cid] : [],
        rawNames: [],
        status: "resolved",
        source: "web_profile_fill",
        sourceRef: profileUrl,
      }).catch((err) => {
        log?.warn?.({ err: err?.message, contactId }, "[web-fill] extras note failed");
        return null;
      });
      if (noteId) summary.extras = extracted.extras.length;
    }

    log?.info?.(
      { contactId, filled: summary.filled, skipped: summary.skipped, extras: summary.extras },
      "[web-fill] done",
    );
    return summary;
  } catch (err) {
    summary.reason = "threw";
    log?.warn?.({ err: err?.message, contactId }, "[web-fill] failed");
    return summary;
  }
}
