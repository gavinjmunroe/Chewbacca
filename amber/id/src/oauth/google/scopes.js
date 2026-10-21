/**
 * Google OAuth scope catalog.
 *
 * Phase 1 grants one consent screen that covers Calendar + Gmail + Drive +
 * Contacts, so the same refresh token can serve all four product surfaces.
 * The callback handler mirrors the resulting tokens under GCAL_*, GMAIL_*,
 * GDRIVE_*, and GCONTACTS_* secret keys (see callback.js) so downstream
 * tools can answer "do I have Contacts scope?" without parsing the granted
 * scope list.
 *
 * Why each scope:
 *   openid / email / profile        identify the Google account that consented
 *   calendar (full)                 schedule/reschedule/cancel events + freebusy
 *                                   on any calendar the user owns or has access to
 *   gmail.modify                    read, send, draft, label, archive, trash any
 *                                   message; matches "manage all my emails"
 *   gmail.send                      send-only fallback if user downgrades modify
 *   drive (full)                    read + write any file/folder in My Drive and
 *                                   any shared drives the user can access;
 *                                   matches "manage my whole Google Drive"
 *   contacts.readonly               read the user's SAVED Google contacts (the
 *                                   People API `people/me/connections` bucket)
 *                                   so they flow into the unified people graph
 *                                   alongside LinkedIn / Apple
 *   contacts.other.readonly         read the auto-collected "Other contacts"
 *                                   bucket (People API `otherContacts`) — people
 *                                   the user has emailed but never explicitly
 *                                   saved. This is a SEPARATE bucket that
 *                                   contacts.readonly does NOT cover, and it's
 *                                   usually far larger than saved contacts.
 *
 * Note: adding contacts.readonly is a SCOPE ADDITION. Existing connected
 * users will keep working with their prior grant until they re-consent (the
 * connect button re-prompts because the consent screen will show the new
 * scope), at which point the People API scraper kicks in for them too.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

/**
 * Subset of GOOGLE_SCOPES that maps to each product family. The callback
 * checks the actually-granted scope string against these to decide whether
 * to write the corresponding *_OAUTH_SCOPES secret. (If a user later
 * downgrades scopes, the family flag flips off cleanly.)
 *
 * The legacy narrower scopes are kept in each family list so a tenant
 * mid-migration (still on calendar.events / gmail.readonly / drive.file)
 * still gets the family flag set. New consents land on the broader scope
 * and the readers don't care which sub-scope produced the grant.
 */
export const GOOGLE_SCOPE_FAMILIES = {
  gcal: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  gmail: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  gdrive: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ],
  gcontacts: [
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.other.readonly",
  ],
};

/**
 * THE CONSENT THE RELATIONSHIP GRAPH ACTUALLY NEEDS.
 *
 * Every Google connection in the product asked for `purpose=calendar`, which
 * is calendar and nothing else. That is why the graph was a wall of email
 * addresses: a calendar invite carries a display name only when the organizer
 * already had that person saved, the mailbox was never readable, and the
 * contact buckets Google resolves names from were never granted. Three
 * sources of names, none of them connected, and a product whose entire job is
 * knowing who people are.
 *
 * So there is a consent for this job: the calendar, the mailbox READ-ONLY,
 * and the two contact buckets. No Drive, no send, no modify. It is more than
 * the calendar alone and it is the smallest set that can answer "who is
 * this".
 */
export const GOOGLE_RELATIONSHIP_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

/*
 * Calendar-only consent avoids requiring Gmail/Drive permission for the
 * agenda. It DOES ask for contacts, read-only, because a calendar without
 * them is a graph of email addresses: Google does not put a display name on
 * most attendees -- it is filled only when the organizer already had that
 * person saved -- and the names everyone sees in Google Calendar are resolved
 * by the client from exactly these two buckets. Asking for the calendar and
 * not for the names is asking for half the feature.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];
