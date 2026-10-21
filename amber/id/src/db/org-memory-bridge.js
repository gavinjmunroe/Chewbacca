/**
 * THE PERSONAL GRAPH FEEDS THE COMPANY GRAPH, ONCE SOMEBODY SAYS SO.
 *
 * Amber has spent a year building the hard half of this on the personal side:
 * calendar events resolved to contacts, email reduced to headers and
 * participants, addresses and phones run through an identity resolver, all of
 * it deduped and kept. The company ledger does not need a second Gmail sync
 * and a second calendar sync. It needs a translation.
 *
 * So this walks one member's own rows and replays them through record(),
 * which means every one of them lands on an org person through the SAME
 * normalizer every other producer uses. A calendar contact and an email
 * participant that are the same human converge, because the convergence
 * happens in the org store rather than here.
 *
 * NOTHING MOVES WITHOUT A GRANT, and that is the whole architecture of this
 * file rather than a check at the top of it. The caller passes the grant row;
 * every interaction written carries its id in connection_id; revoking that
 * grant deletes exactly the rows that came in under it and rebuilds the edges
 * that were derived from them. "Connect your calendar" and "disconnect it and
 * take the data back" are therefore the same mechanism run forwards and
 * backwards, not two features that have to be kept in agreement.
 *
 * WHAT DOES NOT CROSS. The personal rows stay personal: this reads them and
 * writes a company-side interaction with a time, a kind and a source. No
 * email body, no event description, no note. There is nothing to leak later
 * because nothing was copied in the first place -- and the thing a company
 * actually wants, which is that a relationship exists and how warm it is, is
 * entirely expressible without any of that.
 *
 * IT IS IDEMPOTENT, which is what makes it safe to run on a schedule, run
 * twice by accident, or run again after it fails halfway. (source,
 * external_id) is unique, so a second pass reports duplicates and writes
 * nothing.
 *
 * CALENDAR RESOLVES FROM THE RAW GUEST LIST rather than from personal
 * contacts, because a work account has no address book to match against.
 * Mail still goes through contacts, since email_participants is already
 * resolved and there is no unresolved address kept beside it.
 */

import { query } from "./sql.js";
import { record } from "./org-memory-store.js";

/** How many rows one pass will replay per source. */
const DEFAULT_LIMIT = 5000;

/**
 * Addresses arrive as one delimited string on the contact row.
 *
 * Comma, semicolon and whitespace all appear in real data, sometimes in the
 * same field, because this column has been fed by vCard imports, Apple's
 * contact store and Clay pushes over two years. Splitting on all three and
 * discarding anything without an @ is cheaper and more reliable than trying
 * to find out which writer produced a given row.
 */
function addresses(raw) {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

/** Everything we know that could identify this contact to the org resolver. */
function identitiesOf(row) {
  const out = [];
  for (const email of addresses(row.emails)) out.push({ kind: "email", value: email });
  if (row.phone_primary_normalized) {
    out.push({ kind: "phone", value: row.phone_primary_normalized });
  } else if (row.phone_primary) {
    out.push({ kind: "phone", value: row.phone_primary });
  }
  if (row.linkedin_url) out.push({ kind: "linkedin", value: row.linkedin_url });
  return out;
}

/**
 * Every address this member is themselves, so they are not their own contact.
 *
 * Every invite carries the organizer and the owner. Counting those would make
 * somebody their own strongest relationship, every day, which is both wrong
 * and the first thing anyone would notice.
 */
async function selfAddresses(amberId) {
  const { rows } = await query(
    `SELECT lower(subject) AS addr FROM user_identities
      WHERE amber_id = $1::uuid AND provider = 'email' AND deleted_at IS NULL
     UNION
     SELECT lower(account_email) FROM calendar_accounts
      WHERE owner_id = $1::uuid AND disabled_at IS NULL`,
    [amberId],
  );
  return new Set(rows.map((r) => r.addr).filter(Boolean));
}

/**
 * Replay this member's calendar into the company ledger.
 *
 * RESOLVED FROM THE RAW GUEST LIST, not from personal contacts, and that is
 * the fix for the cold start rather than an optimization. The personal side
 * matches attendees against an address book imported from a phone. A work
 * account has no address book and never will, so every attendee matched
 * nothing and a member who had just handed over two years of meetings was
 * shown an empty graph.
 *
 * The addresses are the evidence; org_people is where they resolve. Every
 * attendee becomes a person through the same normalizer every other producer
 * uses, which is also what finally makes a four-person meeting count for
 * four rather than for whichever one happened to have a contact card.
 */
async function bridgeCalendar({ orgId, amberId, grantId, since, limit }) {
  const self = await selfAddresses(amberId);

  const { rows } = await query(
    `SELECT e.event_id, e.title, e.starts_at, e.external_id, e.attendees, e.organizer,
            /*
             * WHICH CALENDAR THIS CAME FROM. Carried onto the ledger row so a
             * meeting can say "from your work Google" rather than "from a
             * calendar" -- which is the first question anybody asks when two
             * rows look the same.
             */
            ca.account_email AS source_account,
            c.full_name AS contact_name, c.company AS contact_company,
            c.title AS contact_title, c.emails AS contact_emails,
            c.phone_primary_normalized, c.linkedin_url
       FROM events e
       LEFT JOIN calendar_accounts ca ON ca.id = e.calendar_account_id
       /*
        * LEFT, not INNER. The old query required a matched contact, which on
        * a work account is never, so it returned nothing for exactly the
        * people this is built for. The contact is now a bonus that supplies a
        * real name when it happens to exist.
        */
       LEFT JOIN contacts c
         ON c.owner_id = e.owner_id AND c.id = e.contact_id AND c.deleted_at IS NULL
      WHERE e.owner_id = $1::uuid
        AND e.deleted_at IS NULL
        -- 'actual' only. A declined invitation or a block of availability is
        -- not a conversation, and counting one as a touch would make the
        -- going-cold list wrong in the direction nobody checks.
        AND e.modality = 'actual'
        AND e.starts_at <= now()
        AND (e.attendees IS NOT NULL OR e.contact_id IS NOT NULL)
        AND ($2::timestamptz IS NULL OR e.starts_at >= $2::timestamptz)
      ORDER BY e.starts_at DESC
      LIMIT $3`,
    [amberId, since, limit],
  );

  let written = 0;
  let duplicate = 0;
  let skipped = 0;

  for (const row of rows) {
    /*
     * One interaction per guest. The same meeting advances every relationship
     * that was in the room, and the external id carries the address so three
     * guests are three rows rather than one row and two silent duplicates.
     */
    const guests = (row.attendees ?? [])
      .map((a) => ({
        email: String(a?.email ?? "").trim().toLowerCase(),
        name: a?.name ? String(a.name).trim() : null,
      }))
      .filter((g) => g.email.includes("@") && !self.has(g.email));

    const targets = guests.length > 0
      ? guests.map((g) => ({
          key: g.email,
          identities: [{ kind: "email", value: g.email }],
          /*
           * The provider's own display name first. Without it the graph's
           * nodes are local parts of addresses, which nobody can read and
           * which gives the resolver nothing that could ever span one
           * person's work and personal addresses.
           */
          displayName: g.name ?? (guests.length === 1 ? row.contact_name ?? null : null),
          company: guests.length === 1 ? row.contact_company ?? null : null,
          title: guests.length === 1 ? row.contact_title ?? null : null,
        }))
      : [{
          key: "contact",
          identities: identitiesOf({
            emails: row.contact_emails,
            phone_primary_normalized: row.phone_primary_normalized,
            linkedin_url: row.linkedin_url,
          }),
          displayName: row.contact_name ?? null,
          company: row.contact_company ?? null,
          title: row.contact_title ?? null,
        }];

    for (const target of targets) {
      if (target.identities.length === 0) {
        // Nothing that could ever match another producer. Counted rather than
        // written, because a person nothing can converge onto is noise.
        skipped += 1;
        continue;
      }

      const result = await record({
        orgId,
        memberId: amberId,
        kind: "meeting",
        source: "calendar",
        externalId: `event:${row.external_id || row.event_id}:${target.key}`,
        sourceAccount: row.source_account ?? null,
        summary: row.title ?? null,
        occurredAt: row.starts_at,
        connectionId: grantId,
        identities: target.identities,
        displayName: target.displayName,
        title: target.title,
        company: target.company,
      });

      if (!result.ok) skipped += 1;
      else if (result.duplicate) duplicate += 1;
      else written += 1;
    }
  }

  return { source: "calendar", read: rows.length, written, duplicate, skipped };
}

/**
 * Replay this member's email headers into the company ledger.
 *
 * Headers only, which is all the personal side ever stored: who, when, which
 * direction. No subject and no body cross into the company ledger even though
 * the subject would often be useful, because "we have never copied the
 * contents of your mail" is a sentence worth being able to say without
 * qualification.
 */
async function bridgeMail({ orgId, amberId, grantId, since, limit }) {
  const { rows } = await query(
    `SELECT m.message_id, m.occurred_at, m.direction, p.role,
            c.full_name, c.company, c.title AS contact_title,
            c.emails, c.phone_primary, c.phone_primary_normalized, c.linkedin_url
       FROM email_messages m
       JOIN email_participants p
         ON p.owner_id = m.owner_id AND p.message_id = m.message_id
       JOIN contacts c
         ON c.owner_id = p.owner_id AND c.id = p.contact_id AND c.deleted_at IS NULL
      WHERE m.owner_id = $1::uuid
        -- A direct correspondent is a relationship. One of forty on a CC line
        -- is a mailing list, and letting those through would bury the people
        -- somebody actually talks to under everyone who was ever copied.
        AND p.role IN ('from', 'to')
        /*
         * YOU HAVE TO HAVE WRITTEN BACK.
         *
         * An inbox is mostly people who wrote to you: newsletters, cold
         * outreach, receipts, recruiters. Every one of them is a direct
         * correspondent by the rule above, and letting them in buries the
         * dozen people somebody actually deals with under a thousand who
         * mailed them once. A relationship graph that fills with senders is
         * a graph nobody trusts twice.
         *
         * Replying is the cheapest honest signal that a relationship
         * exists, and the mailbox already knows: this contact must appear
         * on at least one OUTBOUND message. Nothing else changes -- still
         * no subjects, still no bodies, still only direct participants.
         */
        AND EXISTS (
          SELECT 1
            FROM email_participants rp
            JOIN email_messages rm
              ON rm.owner_id = rp.owner_id AND rm.message_id = rp.message_id
           WHERE rp.owner_id = p.owner_id
             AND rp.contact_id = p.contact_id
             AND rm.direction = 'outbound'
        )
        AND ($2::timestamptz IS NULL OR m.occurred_at >= $2::timestamptz)
      ORDER BY m.occurred_at DESC
      LIMIT $3`,
    [amberId, since, limit],
  );

  let written = 0;
  let duplicate = 0;
  let skipped = 0;

  for (const row of rows) {
    const identities = identitiesOf(row);
    if (identities.length === 0) {
      skipped += 1;
      continue;
    }

    const result = await record({
      orgId,
      memberId: amberId,
      kind: "email",
      source: "mail",
      /*
       * The participant is part of the key, not just the message. One message
       * to three people is three relationships advancing, and keying on the
       * message alone would record only whichever of them was written first
       * and silently drop the rest as duplicates.
       */
      externalId: `mail:${row.message_id}:${addresses(row.emails)[0] ?? "x"}`,
      summary: null,
      occurredAt: row.occurred_at,
      connectionId: grantId,
      identities,
      displayName: row.full_name ?? null,
      title: row.contact_title ?? null,
      company: row.company ?? null,
    });

    if (!result.ok) skipped += 1;
    else if (result.duplicate) duplicate += 1;
    else written += 1;
  }

  return { source: "mail", read: rows.length, written, duplicate, skipped };
}

const BRIDGES = new Map([
  ["calendar", bridgeCalendar],
  ["mail", bridgeMail],
]);

/**
 * Run every source this member has granted.
 *
 * Reads the grants rather than taking a list, because the grant IS the
 * authority: a caller that could pass "mail" without a mail grant would be a
 * way around consent, and the simplest way to make that impossible is for
 * this function to have no opinion about what it was asked for.
 */
export async function bridgeMember({ orgId, amberId, since = null, limit = DEFAULT_LIMIT } = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "bad_input" };

  const { rows: grants } = await query(
    `SELECT id, source FROM org_memory_sources
      WHERE org_id = $1::uuid AND amber_id = $2::uuid AND revoked_at IS NULL`,
    [orgId, amberId],
  );

  const runs = [];
  for (const grant of grants) {
    const bridge = BRIDGES.get(grant.source);
    // A granted source with no bridge yet is not an error. Somebody has said
    // yes to Salesforce before we built the Salesforce producer, which is the
    // right order for those two things to happen in.
    if (!bridge) continue;

    try {
      const out = await bridge({ orgId, amberId, grantId: grant.id, since, limit });
      runs.push(out);
      await query(
        `UPDATE org_memory_sources
            SET last_sync_at = now(), last_error = NULL
          WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, grant.id],
      );
    } catch (err) {
      /*
       * One source failing does not stop the others, and the reason is
       * recorded on the grant rather than only in a log: the person who
       * connected it is the one who can fix it, and they are looking at a
       * screen, not at Railway.
       */
      runs.push({ source: grant.source, error: String(err?.message ?? err) });
      await query(
        `UPDATE org_memory_sources
            SET last_error = $3
          WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, grant.id, String(err?.message ?? err).slice(0, 500)],
      );
    }
  }

  const written = runs.reduce((n, r) => n + (r.written ?? 0), 0);
  return { ok: true, written, runs };
}
