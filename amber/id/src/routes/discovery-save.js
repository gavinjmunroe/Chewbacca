import { query } from "../db/sql.js";
import { safeLinkedIn } from "../lib/clay-public.js";
import { requireAuth } from "../lib/auth-session.js";
import { getClayJob } from "../db/clay-jobs.js";
import {
  mergeContact,
  resolveAmberIdByPhone,
  getContactWebFields,
  upsertContactSource,
} from "../db/store.js";
const profileKey = (value) => {
  const safe = safeLinkedIn(value);
  return safe ? new URL(safe).pathname.replace(/\/$/, "").toLowerCase() : "";
};
async function existingTarget(owner, person, appleExternalId) {
  const { rows } = await query(
    `SELECT c.id, bool_or((s.source='apple' AND s.external_id=$2) OR (c.source='apple' AND c.external_id=$2)) AS apple_match FROM contacts c LEFT JOIN contact_sources s ON s.contact_id=c.id AND s.owner_id=c.owner_id AND s.deleted_at IS NULL
    WHERE c.owner_id=$1 AND c.deleted_at IS NULL AND
    (($2::text IS NOT NULL AND ((s.source='apple' AND s.external_id=$2) OR (c.source='apple' AND c.external_id=$2)))
    OR (regexp_replace(split_part(split_part(lower(c.linkedin_url),'?',1),'#',1),'^https?://(www[.])?linkedin[.]com|/+$','','g')=$3)) GROUP BY c.id`,
    [owner, appleExternalId || null, profileKey(person.linkedin)],
  );
  if (rows.length > 1) throw Error("ambiguous_contact");
  if (appleExternalId && !rows[0]?.apple_match) return null;
  return rows[0]?.id || null;
}
export async function linkDiscoveryProfile(
  owner,
  contactId,
  fields,
  run = query,
) {
  const value = safeLinkedIn(fields.linkedin_url);
  if (!value) return null;
  const { rows } = await run(
    `UPDATE contacts SET linkedin_url=CASE WHEN linkedin_url IS NULL OR btrim(linkedin_url)='' THEN $3 ELSE linkedin_url END,updated_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (linkedin_url IS NULL OR btrim(linkedin_url)='' OR regexp_replace(split_part(split_part(lower(linkedin_url),'?',1),'#',1),'^https?://(www[.])?linkedin[.]com|/+$','','g')=$4) RETURNING id`,
    [contactId, owner, value, profileKey(value)],
  );
  return rows[0] ? { contactId: rows[0].id } : null;
}
export function registerDiscoverySave(app, deps = {}) {
  const get = deps.get || getClayJob,
    merge = deps.merge || mergeContact,
    link = deps.link || linkDiscoveryProfile;
  app.post(
    "/v1/me/discovery/jobs/:id/people/:personId/save",
    {
      preValidation: async (req) => {
        req.body ??= {};
      },
      preHandler: [deps.auth || requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["id", "personId"],
          properties: {
            id: { type: "string", format: "uuid" },
            personId: { type: "string", maxLength: 80 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            appleExternalId: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (req, reply) => {
      const owner = req.privyUser?.phone
        ? await (deps.resolve || resolveAmberIdByPhone)(req.privyUser.phone)
        : null;
      if (!owner) return reply.code(401).send({ error: "no_session" });
      const job = await get(owner, req.params.id);
      const person =
        job?.kind === "search" &&
        job.status === "complete" &&
        job.input.scope === "people" &&
        job.output.people?.find((p) => p.id === req.params.personId);
      if (!person?.linkedin)
        return reply.code(404).send({ error: "not_found" });
      let target;
      try {
        target = await (deps.target || existingTarget)(
          owner,
          person,
          req.body?.appleExternalId,
        );
      } catch {
        return reply
          .code(409)
          .send({
            error: "ambiguous_contact",
            message:
              "Multiple existing cards match. Review them before saving.",
          });
      }
      if (req.body?.appleExternalId && !target)
        return reply
          .code(409)
          .send({
            error: "apple_contact_not_synced",
            message:
              "Sync this Apple contact before saving. No new card was created.",
          });
      const saved = target
        ? { contactId: target }
        : await merge(owner, {
            source: "web_search",
            externalId: person.linkedin,
            fullName: person.name,
            company: person.company,
            title: person.title,
            urls: [{ label: "LinkedIn", url: person.linkedin }],
            raw: { profileUrl: person.linkedin, provider: job.output.provider },
          });
      if (!saved?.contactId)
        return reply.code(503).send({ error: "save_failed" });
      const existing = await (deps.web || getContactWebFields)(
        owner,
        saved.contactId,
      );
      if (
        existing?.linkedin_url &&
        profileKey(existing.linkedin_url) !== profileKey(person.linkedin)
      )
        return reply
          .code(409)
          .send({
            error: "contact_conflict",
            message:
              "This contact already has a different LinkedIn profile. Review it before saving.",
          });
      const linked = await link(owner, saved.contactId, {
        linkedin_url: person.linkedin,
      });
      if (!linked)
        return reply
          .code(503)
          .send({
            error: "save_incomplete",
            message: "Contact saved; retry to finish saving its profile link.",
          });
      if (target)
        await (deps.source || upsertContactSource)(owner, target, {
          source: "web_search",
          externalId: person.linkedin,
          fullName: person.name,
          raw: { profileUrl: person.linkedin, provider: job.output.provider },
        });
      return { ok: true, contactId: saved.contactId, existing: !!target };
    },
  );
}
