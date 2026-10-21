/**
 * Save a person you found on the OPEN WEB as one of your contacts.
 *
 *   POST /v1/me/contacts/from-web
 *     { name, profileUrl, title?, company?, snippet?, tags?: string[], note? }
 *     -> { contactId, tags, links, enriching }
 *
 * WHY THIS IS NOT /v1/me/contacts/create. That route requires a phone, an email or an
 * Amber ID — a deliberate guard, because a contact with no identifier cannot be
 * deduped, messaged, or matched to an account, and the address book fills with junk.
 * Someone found on LinkedIn has none of those three. What they DO have is a profile
 * URL, which is a stronger identifier than a phone for a stranger: it is unique, it is
 * checkable, and it is how you would find them again. So this route takes the URL as
 * the identifier and keeps the guard rather than weakening it for everyone.
 *
 * The contact is created through createContactForOwner, so it goes through the same
 * identity resolution and dedupe as a synced contact — saving the same person twice, or
 * saving someone already in your address book under the same name, merges instead of
 * duplicating.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  applyProfileUrlFields,
  fillWebContactFromProfile,
} from "../lib/web-contact-fill.js";
import {


  resolveAmberIdByPhone as defaultResolveAmberIdByPhone,
  createContactForOwner,
  updateContactFields,
  upsertContactSource,
  addContactTags,
  insertContactNote,
} from "../db/store.js";

// A contact id is a uuid. Declared here rather than inlined so the checks in
// this file cannot drift apart.
const _CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Only a real http(s) profile page counts as an identifier. */
const PROFILE_URL_RE = /^https?:\/\/[^\s]+\.[^\s]+/i;

export function registerWebContactRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const createContact = deps.createContactForOwner || createContactForOwner;
  const setFields = deps.updateContactFields || updateContactFields;
  const setSource = deps.upsertContactSource || upsertContactSource;
  const setTags = deps.addContactTags || addContactTags;
  const addNote = deps.insertContactNote || insertContactNote;
  // The two halves of "put everything we can find on the card". The first is a
  // pure-DB write of the URL itself and is AWAITED, so the link is on the card
  // the instant it exists. The second reads the page and asks a model for the
  // rest; it is deliberately NOT awaited — see the comment at the call site.
  const applyUrls = deps.applyProfileUrlFields || applyProfileUrlFields;
  const fillFromProfile = deps.fillWebContactFromProfile || fillWebContactFromProfile;
  const extractionConfigured =
    deps.extractionConfigured || (() => !!process.env.ANTHROPIC_API_KEY);

  app.post(
    "/v1/me/contacts/from-web",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["name", "profileUrl"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            profileUrl: { type: "string", minLength: 8, maxLength: 500 },
            title: { type: "string", maxLength: 200 },
            company: { type: "string", maxLength: 200 },
            // What the search card showed under the person. Passed through so a
            // page that blocks crawlers can still be extracted from something.
            snippet: { type: "string", maxLength: 2000 },
            tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
            note: { type: "string", maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) {
        return reply
          .code(400)
          .send({ error: "no_phone_on_session", message: "Session carries no phone." });
      }
      const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!ownerId) {
        return reply
          .code(400)
          .send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      }

      const body = request.body || {};
      const name = String(body.name || "").trim();
      const profileUrl = String(body.profileUrl || "").trim();
      if (!name) {
        return reply.code(400).send({ error: "name_required", message: "A name is required." });
      }
      if (!PROFILE_URL_RE.test(profileUrl)) {
        return reply.code(400).send({
          error: "invalid_profile_url",
          message: "A web contact needs a real profile link.",
        });
      }

      const created = await createContact({
        ownerId,
        ownerPhone: phone,
        fullName: name,
        source: "web_search",
      });
      const contactId = created?.id;
      if (contactId == null) {
        return reply
          .code(500)
          .send({ error: "create_failed", message: "Could not save that contact." });
      }

      // Title and company only when supplied — passing undefined leaves the column
      // alone, so re-saving someone whose card had no company cannot blank out a
      // company they already had.
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
      const company =
        typeof body.company === "string" && body.company.trim() ? body.company.trim() : undefined;
      if (title !== undefined || company !== undefined) {
        await setFields({ ownerId, contactId, title, company }).catch(() => null);
      }

      // The profile URL, recorded as a real source row keyed on the URL itself. That
      // key is what makes saving the same person twice idempotent, and it keeps the
      // provenance — where this contact came from — instead of losing it.
      await setSource(ownerId, contactId, {
        source: "web_search",
        externalId: profileUrl,
        fullName: name,
        company: company ?? null,
        raw: { profileUrl, title: title ?? null, company: company ?? null },
      }).catch(() => null);

      const tags = await setTags(ownerId, contactId, body.tags).catch(() => []);

      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (note) {
        // Written as a real contact note, exactly like the favorites note, so it shows
        // up on the person's card with everything else you have said about them.
        // Same as favorites.js: NaN, so the note attached to nobody.
        const cid = _CONTACT_ID_RE.test(String(contactId)) ? String(contactId) : null;
        await addNote({
          ownerId,
          noteText: note,
          participantIds: cid ? [cid] : [],
          rawNames: [],
          status: "resolved",
          source: "app_web_save",
        }).catch((err) => {
          request.log?.warn?.({ err: err?.message }, "[contacts-web] note write failed");
          return null;
        });
      }

      // THE URL IS A FIELD, not just provenance. linkedin.com -> linkedin_url,
      // anything else -> website. Awaited because it is one UPDATE with no network
      // call, and because the person card reads linkedin_url to show the LinkedIn
      // button: a save that returns before this is written is a card with a
      // missing link for no reason.
      const links = await applyUrls({ ownerId, contactId, profileUrl, log: request.log }).catch(
        () => [],
      );

      // EVERYTHING ELSE — title, company, city, email, phone, other links, and the
      // leftovers as a note — comes from reading the page, which costs a page fetch
      // and a model call. That runs AFTER the reply, on purpose:
      //   - Save stays instant. Nobody waits on a third party to add a contact.
      //   - A slow, blocked or dead profile page cannot fail the save. The contact
      //     already exists with what the user typed.
      // The client is told this is happening via `enriching`, so it can say so
      // rather than showing a card that looks final and then changes.
      const enriching = extractionConfigured();
      if (enriching) {
        // .catch is NOT belt-and-braces here. A bare `void promise` that rejects
        // is an unhandledRejection, which Node can turn into a process exit — so
        // an unreadable profile page could take the server down. The background
        // pass promises not to reject; this is what makes that true instead of
        // trusted.
        void fillFromProfile({
          ownerId,
          contactId,
          name,
          profileUrl,
          snippet: typeof body.snippet === "string" ? body.snippet : null,
          log: request.log,
        }).catch((err) =>
          request.log.warn(
            { err: err?.message, contactId },
            "[contacts-web] background fill rejected",
          ),
        );
      } else {
        request.log.warn("[contacts-web] extraction not configured — saved fields only");
      }

      request.log.info(
        { ownerId, contactId, tagCount: tags.length, links, enriching },
        "[contacts-web] saved",
      );
      return { contactId: String(contactId), tags, links, enriching };
    },
  );
}
