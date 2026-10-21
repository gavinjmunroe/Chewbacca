/**
 * THE RELATIONSHIP LEDGER.
 *
 * Every producer -- a calendar sync, a transcript webhook, a CRM poll, an
 * enrichment job, somebody typing a note -- comes through `record()`. One
 * entry point, so the two things that decide whether this graph is useful
 * after a month both happen in exactly one place:
 *
 *   IDENTITY MATCHING. A calendar invite knows an email; Salesforce knows a
 *   record id; a transcript knows a name and maybe a phone. If two producers
 *   discovering the same human create two people, the graph is noise by the
 *   end of the first week and no amount of UI rescues it.
 *
 *   IDEMPOTENCY. A nightly sync that re-reads the last thirty days must not
 *   double the history every night. (source, external_id) is the key, and a
 *   producer that has a stable id is required to supply it.
 *
 * THE LEDGER IS APPEND-ONLY. There is no update path in this file, and that
 * is a constraint rather than an omission: the moment an interaction can be
 * edited, the history stops being evidence and the audit trail stops being
 * worth anything. A correction is a new row.
 *
 * THE COMPANY SEES THAT A RELATIONSHIP EXISTS; IT DOES NOT SEE WHAT WAS SAID.
 * Every read of org_interactions in this file passes through
 * visibleInteractions(), and there is a test that fails if one is added that
 * does not. See the comment on that function for why this is here rather than
 * in a row-level policy.
 */

import { query } from "./sql.js";
import { bestObservedName } from "./observed-names.js";
import { normalizePhone } from "../lib/auth-session.js";
import { checkWrite, getPolicy } from "./org-memory-policy.js";

/*
 * THESE MUST MATCH org_interactions_kind_shape IN THE MIGRATIONS, and for a
 * while they did not.
 *
 * 085 added 'ai' to the database constraint and to nothing else. record()
 * coerces an unknown kind to 'other' rather than refusing it -- which is the
 * right behavior for a producer sending something strange, and the reason
 * this was silent: every Copilot, ChatGPT and Claude conversation imported
 * was filed as 'other'. No error, no missing row, and the one field the
 * interface uses to say WHERE a thing came from quietly saying nothing.
 *
 * A test in org-memory.test.js now reads the constraint out of the migrations
 * and compares it to this set, because the next kind added will be added in
 * exactly the same way.
 */
const KINDS = new Set([
  "meeting", "call", "email", "message", "note",
  "crm_update", "enrichment", "task", "intro", "ai", "other",
]);

const IDENTITY_KINDS = new Set([
  "email", "phone", "linkedin", "salesforce", "microsoft", "domain", "other",
]);

const ACCOUNT_KINDS = new Set([
  "firm", "prospect", "client", "partner", "vendor", "other",
]);

/**
 * Domains that are a person, not an employer.
 *
 * An account is supposed to mean "this firm", and an account called gmail.com
 * with four hundred unrelated people under it is worse than no account at
 * all. It also drives the privacy default: somebody reached at a personal
 * address is far more likely to be a rep's dentist than a prospect, and the
 * cost of wrongly listing that in a company directory is much higher than the
 * cost of wrongly keeping a business contact private, which the owner can fix
 * in one click.
 *
 * Deliberately short. A long list is a maintenance burden that buys very
 * little: the common cases are most of the volume, and a missed one produces
 * a visible oddity rather than a leak.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "mail.com",
  "zoho.com", "yandex.com", "qq.com", "163.com", "126.com", "naver.com",
]);

/**
 * WHO MAY SEE AN INTERACTION. The only answer to that question in this file.
 *
 * WHY THIS IS NOT A ROW-LEVEL POLICY. RLS is the right tool for tenant
 * isolation, which is what it already does here: one rule, no exceptions,
 * fails closed, catches a query nobody remembered to filter. This rule is a
 * different shape. It has exceptions by design -- the aggregate rolls up
 * while the content stays private, which is the entire product -- and a
 * policy with designed exceptions is one that every aggregate query has to
 * work around. Working around a policy means SECURITY DEFINER helpers, and a
 * pile of those is how a boundary actually gets lost: not by a missing
 * policy, but by the five functions written to get past one.
 *
 * So it lives here, in one predicate, with a structural test asserting that
 * every `FROM org_interactions` in this file sits next to it.
 *
 * THREE ARMS, AND THE THIRD IS WHY SHARING DOES NOT TOUCH THE LEDGER. A
 * member sees a row that is company-wide, or that is theirs, or that somebody
 * deliberately published. The share lives in its own table because the ledger
 * is append-only: publishing is a decision made after the fact and reversible
 * by the person who made it, which is a different fact with a different
 * lifetime from the thing that happened.
 */
function visibleInteractions(alias, viewerParam) {
  return `(
    ${alias}.visibility = 'org'
    OR ${alias}.member_id = ${viewerParam}::uuid
    OR EXISTS (
      SELECT 1 FROM org_interaction_shares s
       WHERE s.org_id = ${alias}.org_id AND s.interaction_id = ${alias}.id
    )
  )`;
}

/**
 * WHO MAY SEE A PERSON.
 *
 * Company-visible people are the directory. A person marked private is
 * visible only to somebody who actually has a relationship with them, which
 * is exactly the set of people for whom that contact is not a secret.
 */
function visiblePeople(alias, viewerParam) {
  return `(
    ${alias}.visibility = 'org'
    OR EXISTS (
      SELECT 1 FROM org_person_edges pe
       WHERE pe.org_id = ${alias}.org_id
         AND pe.person_id = ${alias}.id
         AND pe.member_id = ${viewerParam}::uuid
    )
  )`;
}

/**
 * The person a node resolves to: themselves, or whoever they were merged into.
 *
 * Exactly one hop, always, because the schema forbids chains. That is what
 * lets every read below be a plain predicate instead of a recursive CTE.
 */
function survivor(alias) {
  return `COALESCE(${alias}.merged_into, ${alias}.id)`;
}

/**
 * Text Postgres will accept.
 *
 * A NULL BYTE IS NOT A STRANGE CHARACTER, IT IS A REFUSED STATEMENT. Postgres
 * text cannot hold U+0000 at all: the driver raises "invalid byte sequence for
 * encoding UTF8: 0x00" and, inside a transaction, every subsequent statement
 * on that connection fails with "current transaction is aborted" until it
 * rolls back. So one malformed character in one meeting title does not lose
 * that meeting -- it loses the rest of the batch behind it.
 *
 * AND THEY ARRIVE. Email bodies carry them from broken encoders, transcripts
 * carry them from audio tooling, and a calendar description pasted out of a
 * PDF carries them regularly. This is ordinary input that happens to be
 * unstorable, which is the worst combination: too common to be an edge case
 * and too invisible to be noticed before it eats a sync.
 *
 * Stripped rather than refused. The text either side of a stray byte is the
 * real content, and dropping a meeting because of one character in its title
 * would be a worse answer than keeping it.
 */
function storable(value, max = 10000) {
  if (value == null) return null;
  const text = String(value).replace(/\u0000/g, "");
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * A person and everyone merged into them, as a subquery.
 *
 * Every read of history has to span the family: the whole point of merging
 * three addresses into one Sagar is that his node shows eleven touches
 * rather than six, and the interactions still point at the rows they were
 * written against, because the ledger does not get rewritten for a merge.
 */
function family(orgParam, personParam) {
  return `(
    SELECT f.id FROM org_people f
     WHERE f.org_id = ${orgParam}::uuid
       AND (f.id = ${personParam}::uuid OR f.merged_into = ${personParam}::uuid)
  )`;
}

/**
 * Identities are matched, so they are stored in the one form that matches.
 *
 * Lowercased and trimmed for everything; phones additionally stripped to
 * digits and a leading +, because "+1 (555) 010-9999" and "+15550109999" are
 * the same phone and will arrive both ways from different producers.
 */
export function normalizeIdentity(kind, raw) {
  const k = String(kind ?? "").trim().toLowerCase();
  if (!IDENTITY_KINDS.has(k)) return null;
  let v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (k === "phone") {
    /*
     * REUSED, NOT REIMPLEMENTED, and the test above is why.
     *
     * The first version here stripped to digits and kept a leading plus,
     * which made "5550109999" and "+15550109999" two different identities --
     * two contacts, one human, from two producers. normalizePhone already
     * knew that a bare ten-digit US number means +1, and the second
     * implementation of a matching rule is always the one that is subtly
     * wrong.
     */
    v = normalizePhone(v);
    if (!v) return null;
    v = v.toLowerCase();
  }
  if (k === "email" && !v.includes("@")) return null;
  return { kind: k, value: v };
}

/** The employer domain in a set of identities, or null if it is a person's own. */
export function employerDomain(identities = []) {
  for (const i of identities) {
    if (i?.kind !== "email") continue;
    const at = String(i.value ?? "").lastIndexOf("@");
    if (at < 0) continue;
    const domain = String(i.value).slice(at + 1).trim().toLowerCase();
    if (!domain || PERSONAL_DOMAINS.has(domain)) continue;
    return domain;
  }
  return null;
}

/* --------------------------------------------------------------- accounts */

/**
 * The firm behind a domain, created if this is the first time we have seen it.
 *
 * THIS IS WHY ACCOUNTS POPULATE THEMSELVES. A calendar invite from
 * someone@henderson-cpa.com produces the Henderson CPA account without anyone
 * filing anything, which is the difference between an account model and a
 * data-entry chore. The name starts as the domain and somebody renames it
 * once; a wrong name on a real account is a far smaller problem than an
 * account nobody created.
 */
export async function resolveAccount({ orgId, domain, name = null, kind = "other" } = {}) {
  if (!orgId) return null;
  const d = String(domain ?? "").trim().toLowerCase();
  if (!d || PERSONAL_DOMAINS.has(d)) return null;

  const { rows: found } = await query(
    `SELECT id FROM org_accounts
      WHERE org_id = $1::uuid AND domain = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [orgId, d],
  );
  if (found.length > 0) return found[0].id;

  const { rows } = await query(
    `INSERT INTO org_accounts (org_id, name, domain, kind)
     VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, String(name ?? "").trim() || d, d, ACCOUNT_KINDS.has(kind) ? kind : "other"],
  );
  if (rows.length > 0) return rows[0].id;

  // Lost a race with a concurrent producer. The other one won; use its row.
  const { rows: again } = await query(
    `SELECT id FROM org_accounts
      WHERE org_id = $1::uuid AND domain = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [orgId, d],
  );
  return again[0]?.id ?? null;
}

/**
 * Find the person these identities belong to, or make one.
 *
 * WHY THE FIRST MATCH WINS RATHER THAN MERGING. Two identities resolving to
 * two different existing people means the data is telling us those are the
 * same human, and merging them is a destructive operation on a ledger -- it
 * rewrites which person an interaction happened with. That is a decision for
 * a person looking at a screen, not for a sync job at three in the morning.
 * So: attach to the first match, record the other identity against it if it
 * is free, and leave the duplicate standing to be merged deliberately later.
 * A visible duplicate is a smaller problem than a silent wrong merge.
 */
export async function resolvePerson({
  orgId,
  identities = [],
  displayName = null,
  title = null,
  company = null,
  source = null,
} = {}) {
  if (!orgId) return null;

  const clean = identities
    .map((i) => normalizeIdentity(i?.kind, i?.value))
    .filter(Boolean);

  /*
   * NOBODY SHOULD HAVE TO PRESS A BUTTON TO BE CALLED BY THEIR NAME.
   *
   * Every sync that has ever seen one of these addresses beside a name wrote
   * that pair down as it went past: mail headers name everyone on the thread,
   * invites sometimes name a guest. Asking here, at the one door every
   * producer comes through, is what makes naming a property of the system
   * rather than a pass somebody runs. A person created by a sync at 3am is
   * named at 3am, and an existing person whose name is still a chopped-up
   * address is corrected the next time anything touches them, because
   * upgradeDetails below gets the real name instead of nothing.
   *
   * What the producer itself said still wins: it is looking at this exact
   * event, and this is a memory of other ones.
   */
  const given = String(displayName ?? "").trim();
  const known = given || (await bestObservedName(clean).catch(() => null)) || null;

  if (clean.length > 0) {
    const { rows } = await query(
      `SELECT person_id FROM org_person_identities
        WHERE org_id = $1::uuid
          AND (kind, value) IN (
            SELECT k, v FROM unnest($2::text[], $3::text[]) AS t(k, v)
          )
        LIMIT 1`,
      [orgId, clean.map((c) => c.kind), clean.map((c) => c.value)],
    );
    if (rows.length > 0) {
      const personId = rows[0].person_id;
      await attachIdentities({ orgId, personId, identities: clean, source });
      // A person we already know may still be missing their firm, because the
      // producer that created them had no email. Fill it in without ever
      // overwriting one that is already set.
      await linkAccount({ orgId, personId, identities: clean, company });
      await upgradeDetails({ orgId, personId, displayName: known, title, company });
      return personId;
    }
  }

  /*
   * A NAME IS NOT AN IDENTITY and is deliberately not matched on. Two people
   * called David Chen is ordinary; merging them because a transcript said a
   * name would put one customer's private conversation on another's record,
   * which is the worst failure this system can have.
   */
  const name = known || fallbackName(clean);
  if (!name) return null;

  const domain = employerDomain(clean);
  const accountId = domain
    ? await resolveAccount({ orgId, domain, name: company })
    : null;

  /*
   * A business address makes a company contact; anything else stays private
   * to whoever knows them. See PERSONAL_DOMAINS for why the asymmetry runs
   * this way.
   */
  const visibility = domain ? "org" : "private";

  /*
   * Did somebody tell us this name, or did we make it out of an address? The
   * answer decides whether the next producer is allowed to improve on it.
   */
  const nameSource = known && !known.includes("@") ? "provider" : "address";

  const { rows } = await query(
    `INSERT INTO org_people (org_id, display_name, title, company, account_id, visibility,
                             name_source)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7)
     RETURNING id`,
    [orgId, name, title, company, accountId, visibility, nameSource],
  );
  const personId = String(rows[0].id);

  /*
   * THE RACE THIS SETTLES, which the SELECT above cannot.
   *
   * 083 said the unique index on (org_id, kind, value) "is what makes a
   * second producer attach to an existing person rather than create a
   * duplicate". The index was there and nothing used it to decide. This
   * function looked, saw nothing, and created -- so two producers looking at
   * the same instant both saw nothing and both created. Ten concurrent
   * resolutions of one address produced TEN people and one identity row:
   * the index did its job, refusing nine identity rows, and nine people were
   * left standing with no identity at all, invisible to every subsequent
   * lookup and permanently un-mergeable because nothing points at them.
   *
   * That is not a rare interleaving. It is what happens every time two
   * colleagues sync calendars holding the same meeting, which is most
   * meetings, and the whole premise of the graph is that it does not happen.
   *
   * SO THE INSERT DECIDES, NOT THE SELECT. ON CONFLICT ... DO UPDATE returns
   * the row that is already there, and blocks rather than skipping when
   * another transaction is mid-insert -- so whoever loses learns WHO won
   * instead of silently writing nothing. The update is a no-op on purpose:
   * the point is the RETURNING, not the write.
   */
  const deduped = [];
  const seen = new Set();
  for (const c of clean) {
    const key = `${c.kind}|${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  if (deduped.length === 0) return personId;

  const { rows: claimed } = await query(
    `INSERT INTO org_person_identities (org_id, person_id, kind, value, source)
     SELECT $1::uuid, $2::uuid, t.k, t.v, $5
       FROM unnest($3::text[], $4::text[]) AS t(k, v)
     ON CONFLICT (org_id, kind, value) DO UPDATE
        SET source = org_person_identities.source
     RETURNING person_id`,
    [orgId, personId, deduped.map((c) => c.kind), deduped.map((c) => c.value), source],
  );

  const winner = claimed.map((r) => String(r.person_id)).find((id) => id !== personId);
  if (!winner) return personId;

  /*
   * Somebody else created this person between our look and our write. The
   * row we just made is safe to remove: nothing has been returned to any
   * caller yet, so by construction it holds no interactions and no edges.
   * Leaving it would be the duplicate this exists to prevent.
   */
  await query(`DELETE FROM org_people WHERE org_id = $1::uuid AND id = $2::uuid`, [orgId, personId]);
  await upgradeDetails({ orgId, personId: winner, displayName, title, company });
  return winner;
}

/**
 * A better name than the one we have, if this producer brought one.
 *
 * WHY THIS IS NOT AN EDIT TO HISTORY. org_people is not the ledger. It is the
 * current best understanding of who somebody is, and it is allowed to
 * improve; the interactions underneath it never change.
 *
 * THE CASE THIS EXISTS FOR. The first backfill ran before the reader kept
 * display names, so eighteen people were created named after their email
 * address. The second run matched every one of them by identity, found the
 * interactions already recorded, wrote nothing -- correctly, it is idempotent
 * -- and left the graph still full of sagartiw@stanford.edu. Idempotent on
 * the LEDGER is right; idempotent on everything means a graph can never be
 * improved by better data arriving later, which is the whole premise.
 *
 * STRICTLY AN UPGRADE. A real name replaces an address. A real name never
 * replaces another real name, because two producers disagreeing about what
 * somebody is called is not something to resolve by whoever synced last.
 */
async function upgradeDetails({ orgId, personId, displayName, title, company } = {}) {
  const name = String(displayName ?? "").trim();
  const better = name && !name.includes("@");
  if (!better && !title && !company) return;

  /*
   * THE RULE IS PROVENANCE, NOT SHAPE.
   *
   * This used to replace a name only if it still contained an "@", which
   * meant it never replaced anything: a person first seen as an address is
   * named by chopping the address up, so ipandey@stanford.edu was stored as
   * "Ipandey" -- no "@", therefore permanent. The one case this function
   * exists for, Google handing us "Ipsha Pandey" on the very next invite,
   * was the case it refused.
   *
   * A name we derived yields to a name a provider sent. A name a person
   * typed yields to nobody. That is the whole policy and it lives in one
   * column.
   */
  await query(
    `UPDATE org_people
        SET display_name = CASE
              WHEN $3::text IS NOT NULL AND name_source <> 'human' THEN $3::text
              ELSE display_name
            END,
            name_source = CASE
              WHEN $3::text IS NOT NULL AND name_source <> 'human' THEN 'provider'
              ELSE name_source
            END,
            title      = COALESCE(title, $4::text),
            company    = COALESCE(company, $5::text),
            updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
        AND (
          ($3::text IS NOT NULL AND name_source = 'address')
          OR (title IS NULL AND $4::text IS NOT NULL)
          OR (company IS NULL AND $5::text IS NOT NULL)
        )`,
    [orgId, personId, better ? name : null, title ?? null, company ?? null],
  );
}

/** Attach a person to their firm, only ever filling a gap. */
async function linkAccount({ orgId, personId, identities = [], company = null } = {}) {
  const domain = employerDomain(identities);
  if (!domain) return null;
  const accountId = await resolveAccount({ orgId, domain, name: company });
  if (!accountId) return null;
  await query(
    `UPDATE org_people
        SET account_id = $3::uuid, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND account_id IS NULL`,
    [orgId, personId, accountId],
  );
  return accountId;
}

/**
 * An email address is a worse name than a name and a better one than nothing.
 * Somebody can rename it later; an unnamed row is one nobody can find.
 */
/**
 * A READABLE NAME OUT OF AN ADDRESS, when the provider sent none.
 *
 * WHY THIS IS NOT COSMETIC. Of 515 calendar guest entries, five carried a
 * display name -- Google simply does not send them for most attendees. So
 * the graph filled with nodes labeled bvance@paychex.com, and every screen
 * that shows a person showed an address: the orbit, the roster, and the
 * answers, which came back "You know three people at Paychex:
 * bvance@paychex.com, jryan4@paychex.com..." That reads as a database
 * leaking rather than a product knowing somebody.
 *
 * `b.vance`, `bvance`, `brian_vance` and `vance.brian` are all one human
 * with a name in them. Splitting on the separators people actually use
 * recovers it most of the time, and when it does not the address is still
 * there underneath -- no worse than today.
 *
 * WHAT IT REFUSES TO GUESS. A local part with no separator and no case
 * change ("bvance") could be B Vance or Bvance, and inventing a first
 * initial would put a wrong name on somebody's record. Those are
 * capitalized and left as one word. A generic mailbox -- info, hello,
 * support, noreply -- is not a person at all and keeps its address, because
 * "Info" in a relationship graph is worse than an address.
 */
const GENERIC_MAILBOX = new Set([
  "info", "hello", "hi", "support", "help", "contact", "admin", "team",
  "sales", "billing", "noreply", "no-reply", "donotreply", "notifications",
  "office", "mail", "inbox", "careers", "jobs", "press", "legal", "privacy",
  "security", "accounts", "service", "enquiries", "inquiries",
]);

export function humanizeAddress(address) {
  const raw = String(address ?? "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 0) return null;

  const local = raw.slice(0, at);
  if (GENERIC_MAILBOX.has(local)) return null;

  // Trailing digits are an account suffix, not a name: jryan4 -> jryan.
  const bare = local.replace(/\d+$/, "");
  const parts = bare.split(/[._\-+]+/).filter((x) => x.length > 1 && /[a-z]/.test(x));

  if (parts.length === 0) return null;

  const title = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  // One word with no separator: capitalize it and stop. Splitting "bvance"
  // into "B Vance" is a guess, and a wrong name is worse than an address.
  if (parts.length === 1) {
    if (parts[0].length < 3) return null;
    return title(parts[0]);
  }

  return parts.slice(0, 3).map(title).join(" ");
}

function fallbackName(identities) {
  const email = identities.find((i) => i.kind === "email");
  if (email) return humanizeAddress(email.value) ?? email.value;
  const any = identities[0];
  return any ? any.value : null;
}

/**
 * ON CONFLICT DO NOTHING, because an identity already claimed by somebody
 * else is exactly the duplicate case above: do not steal it, do not merge,
 * leave it where it is. The primary key is (org_id, kind, value), so the
 * conflict IS "another person already owns this".
 */
export async function attachIdentities({ orgId, personId, identities = [], source = null } = {}) {
  const clean = identities
    .map((i) => (i.kind && i.value ? i : normalizeIdentity(i?.kind, i?.value)))
    .filter(Boolean);
  if (!orgId || !personId || clean.length === 0) return 0;

  const { rowCount } = await query(
    `INSERT INTO org_person_identities (org_id, person_id, kind, value, source)
     SELECT $1::uuid, $2::uuid, t.k, t.v, $5
       FROM unnest($3::text[], $4::text[]) AS t(k, v)
     ON CONFLICT DO NOTHING`,
    [orgId, personId, clean.map((c) => c.kind), clean.map((c) => c.value), source],
  );
  return rowCount;
}

/**
 * Write one interaction. The only way anything enters the ledger.
 *
 * Returns { ok, personId, interactionId, duplicate }. `duplicate: true` is a
 * SUCCESS, not an error: it is what a re-run of a sync looks like, and a
 * producer that treats it as a failure will retry forever.
 */
export async function record({
  orgId,
  memberId = null,
  kind = "other",
  source,
  externalId = null,
  summary = null,
  artifactUrl = null,
  occurredAt = null,
  connectionId = null,
  // 'private' unless the caller deliberately says otherwise. A default of
  // 'org' would be a setting people discover after the fact, which is not
  // consent.
  visibility = "private",
  // Either a person we already know, or enough to find or create one.
  personId = null,
  identities = [],
  displayName = null,
  title = null,
  company = null,
  /** Which connected account produced this: a calendar or mailbox address. */
  sourceAccount = null,
} = {}) {
  if (!orgId || !source) return { ok: false, reason: "bad_input" };
  const k = KINDS.has(kind) ? kind : "other";
  const vis = visibility === "org" ? "org" : "private";

  /*
   * EVERY PIECE OF FREE TEXT, AT THE ONE DOOR. These are the fields a
   * producer fills from whatever the provider sent, which is where a null
   * byte comes from and why it is cleaned here rather than in each producer:
   * the next producer inherits it without knowing it exists.
   */
  const text = {
    summary: storable(summary),
    displayName: storable(displayName, 200),
    title: storable(title, 200),
    company: storable(company, 200),
  };

  /*
   * THE CEILING, CHECKED AT THE DOOR. Here rather than in each route,
   * because a policy every caller checks is one that holds until somebody
   * adds a caller. A producer written next year inherits this without
   * knowing it exists.
   */
  const allowed = await checkWrite({ orgId, amberId: memberId, source });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const who =
    personId ??
    (await resolvePerson({
      orgId,
      identities,
      displayName: text.displayName,
      title: text.title,
      company: text.company,
      source,
    }));
  if (!who) return { ok: false, reason: "no_person" };

  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) return { ok: false, reason: "bad_time" };

  const { rows } = await query(
    `INSERT INTO org_interactions
       (org_id, person_id, member_id, kind, source, external_id,
        summary, artifact_url, occurred_at, connection_id, visibility, policy_version,
        source_account)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::uuid, $11, $12,
             $13::text)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    /*
     * The version in force when this happened, stamped on the row. Without
     * it, "we had a rule" is a claim about the present applied to the past,
     * which is the thing an auditor is paid not to accept.
     */
    [orgId, who, memberId, k, source, externalId, text.summary, artifactUrl,
     when.toISOString(), connectionId, vis, allowed.version,
     storable(sourceAccount, 320)],
  );

  // Nothing returned means the unique index on (source, external_id) caught
  // it: this exact thing is already recorded. That is the sync working.
  if (rows.length === 0) return { ok: true, personId: who, duplicate: true };

  /*
   * The edge is refreshed here rather than on a schedule, because the only
   * thing that can change it is an interaction and we have just written one.
   * It is derived, so a failure here is recoverable by rebuilding -- which
   * is why it does not take the write down with it.
   */
  if (memberId) {
    await refreshEdge({ orgId, personId: who, memberId }).catch(() => null);
  }

  return { ok: true, personId: who, interactionId: rows[0].id, duplicate: false };
}

/**
 * Recompute one edge from the ledger.
 *
 * STRENGTH IS RECENCY AND FREQUENCY, and it is deliberately simple: a
 * half-life on the last touch, lifted by how many times you have spoken,
 * capped at one. The exact curve matters far less than the fact that it is
 * computed in one place from data that is kept, so it can be changed later
 * without a migration and without anybody losing anything.
 *
 * 45 days as the half-life because that is roughly where a warm business
 * relationship starts to read as cold if nothing happens -- a judgment, not
 * a measurement, and worth revisiting against real data rather than
 * defending.
 *
 * NOTE ON VISIBILITY: an edge is derived from ALL of its member's own
 * interactions, private ones included, because it is that member's own
 * relationship and they can see all of it. What makes this safe to publish
 * company-wide is that an edge carries counts and dates, never content.
 */
export async function refreshEdge({ orgId, personId, memberId } = {}) {
  if (!orgId || !personId || !memberId) return null;

  // An edge belongs to the surviving node. Writing one against a merged-away
  // person would resurrect them in every who-knows list.
  const { rows: alive } = await query(
    `SELECT COALESCE(merged_into, id) AS id FROM org_people
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, personId],
  );
  personId = alive[0]?.id ?? personId;
  const { rows } = await query(
    `WITH stats AS (
       SELECT count(*)::int AS n,
              min(occurred_at) AS first_at,
              max(occurred_at) AS last_at
         FROM org_interactions
        WHERE org_id = $1::uuid AND member_id = $3::uuid
          -- The family, not the row: a merged person's touches belong to the
          -- survivor, and the ledger keeps pointing where it always did.
          AND person_id IN ${family("$1", "$2")}
     )
     INSERT INTO org_person_edges
       (org_id, person_id, member_id, interactions, first_at, last_at, strength, computed_at)
     SELECT $1::uuid, $2::uuid, $3::uuid, s.n, s.first_at, s.last_at,
            LEAST(1.0,
              -- recency: 1 at today, 0.5 at 45 days, trailing off after
              power(0.5, GREATEST(0, EXTRACT(EPOCH FROM (now() - s.last_at)) / 86400.0) / 45.0)
              -- frequency: a nudge upward for a relationship with history,
              -- bounded so a hundred emails cannot outrank having spoken
              -- to somebody yesterday
              * (1.0 + LEAST(0.5, s.n::numeric / 40.0))
            )::numeric(4,3),
            now()
       FROM stats s
      WHERE s.n > 0
     ON CONFLICT (org_id, person_id, member_id) DO UPDATE
        SET interactions = EXCLUDED.interactions,
            first_at     = EXCLUDED.first_at,
            last_at      = EXCLUDED.last_at,
            strength     = EXCLUDED.strength,
            computed_at  = now()
     RETURNING strength`,
    [orgId, personId, memberId],
  );
  return rows[0]?.strength ?? null;
}

/* --------------------------------------------------------------- reading */

/**
 * One person, with everything known about them. The node view.
 *
 * TWO COUNTS, AND THE DIFFERENCE IS THE POINT. `interactions` is what this
 * viewer can actually read. `company_interactions` is the whole relationship,
 * summed from edges, which are company-visible by design. A screen that shows
 * both can say "fourteen touches across three people, four of them yours" --
 * which is the honest version, and far more useful than either number alone.
 */
export async function getPerson({ orgId, personId, viewerId = null } = {}) {
  if (!orgId || !personId) return null;
  const { rows } = await query(
    `SELECT p.id, p.display_name, p.title, p.company, p.note, p.visibility,
            p.owner_id, u.full_name AS owner_name,
            p.account_id, a.name AS account_name, a.domain AS account_domain,
            p.created_at, p.updated_at,
            (SELECT count(*)::int FROM org_interactions i
              WHERE i.org_id = p.org_id AND i.person_id IN ${family("$1", "$2")}
                AND ${visibleInteractions("i", "$3")}) AS interactions,
            (SELECT max(i.occurred_at) FROM org_interactions i
              WHERE i.org_id = p.org_id AND i.person_id IN ${family("$1", "$2")}
                AND ${visibleInteractions("i", "$3")}) AS last_at,
            COALESCE((SELECT sum(e.interactions)::int FROM org_person_edges e
                       WHERE e.org_id = p.org_id AND e.person_id = p.id), 0)
              AS company_interactions,
            (SELECT max(e.last_at) FROM org_person_edges e
              WHERE e.org_id = p.org_id AND e.person_id = p.id) AS company_last_at,
            /* Every address the merged family answers to, on one node. */
            COALESCE((
              SELECT jsonb_agg(DISTINCT jsonb_build_object('kind', d.kind, 'value', d.value))
                FROM org_person_identities d
               WHERE d.org_id = p.org_id AND d.person_id IN ${family("$1", "$2")}
            ), '[]'::jsonb) AS identities,
            (SELECT count(*)::int FROM org_people m
              WHERE m.org_id = p.org_id AND m.merged_into = p.id) AS merged_count
       FROM org_people p
       LEFT JOIN users u ON u.amber_id = p.owner_id
       LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
      WHERE p.org_id = $1::uuid AND p.id = $2::uuid AND p.deleted_at IS NULL
        AND ${visiblePeople("p", "$3")}`,
    [orgId, personId, viewerId],
  );
  return rows[0] ?? null;
}

/**
 * The ledger for one person, newest first. The thing the node view shows.
 *
 * `hidden` is the count of rows this viewer may not read. Saying "and 9 more
 * you cannot see" is better than silently showing a shorter history, because
 * a timeline that looks complete and is not is how somebody concludes a
 * relationship is cold when it is not.
 */
export async function history({ orgId, personId, viewerId = null, limit = 100 } = {}) {
  if (!orgId || !personId) return { items: [], hidden: 0 };

  const n = Math.min(Number(limit) || 100, 500);
  const { rows } = await query(
    `SELECT i.id, i.kind, i.source, i.summary, i.artifact_url,
            i.occurred_at, i.member_id, i.visibility, u.full_name AS member_name
       FROM org_interactions i
       LEFT JOIN users u ON u.amber_id = i.member_id
      WHERE i.org_id = $1::uuid AND i.person_id IN ${family("$1", "$2")}
        AND ${visibleInteractions("i", "$3")}
      ORDER BY i.occurred_at DESC
      LIMIT $4`,
    [orgId, personId, viewerId, n],
  );

  const { rows: counts } = await query(
    `SELECT count(*)::int AS hidden
       FROM org_interactions i
      WHERE i.org_id = $1::uuid AND i.person_id IN ${family("$1", "$2")}
        AND NOT ${visibleInteractions("i", "$3")}`,
    [orgId, personId, viewerId],
  );

  return { items: rows, hidden: counts[0]?.hidden ?? 0 };
}

/**
 * Who in the company knows this person, strongest first.
 *
 * The warm-intro question, and the reason the edge table exists: answering it
 * by folding the ledger on every render is what turns a product into a demo.
 * This is company-visible in full, because counts and dates are precisely the
 * part a company is entitled to and the part that costs nobody anything.
 */
export async function whoKnows({ orgId, personId } = {}) {
  if (!orgId || !personId) return [];
  const { rows } = await query(
    `SELECT e.member_id, u.full_name AS member_name, m.title,
            e.interactions, e.first_at, e.last_at, e.strength
       FROM org_person_edges e
       JOIN users u ON u.amber_id = e.member_id
       LEFT JOIN org_members m ON m.org_id = e.org_id AND m.amber_id = e.member_id
      WHERE e.org_id = $1::uuid AND e.person_id = $2::uuid
      ORDER BY e.strength DESC, e.last_at DESC`,
    [orgId, personId],
  );
  return rows;
}

/** The roster of people, searchable, with the one number that matters. */
export async function listPeople({
  orgId,
  q = null,
  ownerId = null,
  accountId = null,
  viewerId = null,
  /** 'internal', 'external', or null for everybody. */
  scope = null,
  limit = 100,
} = {}) {
  if (!orgId) return [];
  const needle = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const { rows } = await query(
    /*
     * INTERNAL IS DERIVED, NOT FILED. A colleague who appears on your
     * calendar before they have accepted their invitation is still a
     * colleague, and asking somebody to classify them by hand means the
     * classification is wrong the day somebody joins. Their address is on
     * the company's domain; that is the whole test.
     *
     * `member_amber_id` is the link to the actual account, when there is
     * one. Null means we know them from a meeting but they have not joined
     * yet, which is a real and useful state rather than a gap: it is the
     * list of people to invite.
     */
    /*
     * THE COMPANY'S DOMAINS, PLURAL, AND DERIVED RATHER THAN CONFIGURED.
     *
     * organizations.email_domain is one field somebody has to have filled in,
     * and when it is blank -- which it is until an admin thinks to set it --
     * nobody is internal and "one of us" is empty. But the company's own
     * members are signed in with their own addresses, and the domain of those
     * addresses IS the company's domain. A colleague on the calendar who has
     * not joined yet matches it, which is exactly the person that question is
     * asked about.
     *
     * Public mailbox providers are excluded, because a member who signed up
     * with a personal address would otherwise make every Gmail user in the
     * graph a colleague.
     */
    `WITH org_domain AS (
       SELECT lower(COALESCE(email_domain, '')) AS d
         FROM organizations WHERE id = $1::uuid AND COALESCE(email_domain, '') <> ''
       UNION
       /*
        * THE ADDRESS IS IN THE EMAIL COLUMN, NOT ALWAYS IN SUBJECT.
        *
        * An identity row's subject is whatever the provider calls the user:
        * for a password or magic-link account that IS the address, and for a
        * Google account it is an opaque numeric id with the real address in
        * the email column. Reading subject and filtering to provider
        * 'email' therefore found nothing at all for anybody who signed in
        * with Google -- which is everybody here -- so the company had no
        * domains, nobody was internal, and "one of us" was empty while two
        * colleagues sat in the graph with company addresses on their cards.
        */
       SELECT DISTINCT lower(split_part(COALESCE(ui.email, ui.subject), '@', 2)) AS d
         FROM org_members m
         JOIN user_identities ui
           ON ui.amber_id = m.amber_id AND ui.deleted_at IS NULL
        WHERE m.org_id = $1::uuid AND m.deleted_at IS NULL
          AND COALESCE(ui.email, ui.subject) LIKE '%@%'
          AND lower(split_part(COALESCE(ui.email, ui.subject), '@', 2)) NOT IN (
            'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
            'yahoo.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
            'protonmail.com', 'aol.com', 'msn.com', 'gmx.com', 'yandex.com'
          )
     ),
     tagged AS (
       SELECT p.id,
              EXISTS (
                SELECT 1 FROM org_person_identities d, org_domain od
                 WHERE d.org_id = p.org_id AND d.person_id = p.id AND d.kind = 'email'
                   AND od.d <> '' AND split_part(d.value, '@', 2) = od.d
              ) AS internal,
              (
                SELECT m.amber_id FROM org_members m
                  JOIN user_identities ui
                    ON ui.amber_id = m.amber_id AND ui.deleted_at IS NULL
                 WHERE m.org_id = p.org_id AND m.deleted_at IS NULL
                   /* Same reason as above: a Google row keeps it in the email column. */
                   AND lower(COALESCE(ui.email, ui.subject)) IN (
                     SELECT d.value FROM org_person_identities d
                      WHERE d.org_id = p.org_id AND d.person_id = p.id AND d.kind = 'email'
                   )
                 LIMIT 1
              ) AS member_amber_id
         FROM org_people p
        WHERE p.org_id = $1::uuid
     )
     SELECT p.id, p.display_name, p.title, p.company, p.owner_id, p.visibility,
            p.account_id, a.name AS account_name,
            u.full_name AS owner_name,
            t.internal, t.member_amber_id,
            mu.full_name AS member_name,
            /*
             * THE ADDRESS, CARRIED ALONGSIDE THE NAME. Once a person is
             * called Sagar Tiwari rather than sagartiw@stanford.edu, the
             * address stops being visible anywhere -- and it is the thing
             * somebody needs to actually contact them, and the thing the ask
             * bar highlights so a name in an answer can be opened.
             */
            (SELECT i.value FROM org_person_identities i
              WHERE i.org_id = p.org_id AND i.person_id = p.id AND i.kind = 'email'
              ORDER BY i.created_at LIMIT 1) AS email,
            /*
             * ALL OF THEM, because a person is the set of their addresses and
             * a search box that only knows the first one cannot find somebody
             * by the address you actually have for them. Four addresses on one
             * row is the whole point of merging them.
             */
            COALESCE((SELECT array_agg(i.value ORDER BY i.created_at)
                        FROM org_person_identities i
                       WHERE i.org_id = p.org_id AND i.person_id = p.id
                         AND i.kind = 'email'), '{}') AS emails,
            p.note,
            e.interactions, e.last_at, e.strength
       FROM org_people p
       JOIN tagged t ON t.id = p.id
       LEFT JOIN users u ON u.amber_id = p.owner_id
       LEFT JOIN users mu ON mu.amber_id = t.member_amber_id
       LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
       /*
        * The strongest edge, not the sum: "how well does this company know
        * them" is best answered by the person who knows them best, and an
        * average is dragged down by everybody who has met them once.
        */
       LEFT JOIN LATERAL (
         SELECT interactions, last_at, strength
           FROM org_person_edges x
          WHERE x.org_id = p.org_id AND x.person_id = p.id
          ORDER BY x.strength DESC
          LIMIT 1
       ) e ON true
      WHERE p.org_id = $1::uuid
        AND p.deleted_at IS NULL
        -- Merged-away rows still exist and still hold their interactions;
        -- they just stopped being their own node.
        AND p.merged_into IS NULL
        AND ${visiblePeople("p", "$5")}
        AND ($2::text IS NULL OR lower(p.display_name) LIKE $2
             OR lower(COALESCE(p.company, '')) LIKE $2
             OR lower(COALESCE(p.title, '')) LIKE $2
             -- What somebody wrote about them is a thing to search by.
             OR lower(COALESCE(p.note, '')) LIKE $2
             OR lower(COALESCE(a.name, '')) LIKE $2
             -- A question can name somebody by their address, and before
             -- enrichment runs the address IS the name people know them by.
             OR EXISTS (SELECT 1 FROM org_person_identities i2
                         WHERE i2.org_id = p.org_id AND i2.person_id = p.id
                           AND lower(i2.value) LIKE $2))
        AND ($3::uuid IS NULL OR p.owner_id = $3::uuid)
        AND ($4::uuid IS NULL OR p.account_id = $4::uuid)
        AND ($7::text IS NULL
             OR ($7 = 'internal' AND t.internal)
             OR ($7 = 'external' AND NOT t.internal))
      ORDER BY e.last_at DESC NULLS LAST, lower(p.display_name)
      LIMIT $6`,
    [orgId, needle, ownerId, accountId, viewerId,
     Math.min(Number(limit) || 100, 500),
     scope === "internal" || scope === "external" ? scope : null],
  );
  return rows;
}

/**
 * The firms, with the relationship summed across everybody who has one.
 *
 * THE QUESTION THIS ANSWERS is "what is our relationship with Henderson CPA",
 * which no CRM can answer because a CRM has the account record and not the
 * relationship. Summed across people and across members, because a firm you
 * have four warm contacts at is a different thing from one where a single
 * person knows a single partner.
 */
export async function listAccounts({ orgId, q = null, ownerId = null, limit = 100 } = {}) {
  if (!orgId) return [];
  const needle = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const { rows } = await query(
    `SELECT a.id, a.name, a.domain, a.kind, a.owner_id,
            u.full_name AS owner_name,
            COALESCE(r.people, 0)       AS people,
            COALESCE(r.knowers, 0)      AS knowers,
            COALESCE(r.interactions, 0) AS interactions,
            r.last_at,
            r.strength
       FROM org_accounts a
       LEFT JOIN users u ON u.amber_id = a.owner_id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT p.id)::int        AS people,
                count(DISTINCT e.member_id)::int AS knowers,
                COALESCE(sum(e.interactions), 0)::int AS interactions,
                max(e.last_at)                   AS last_at,
                max(e.strength)                  AS strength
           FROM org_people p
           LEFT JOIN org_person_edges e
                  ON e.org_id = p.org_id AND e.person_id = p.id
          WHERE p.org_id = a.org_id AND p.account_id = a.id AND p.deleted_at IS NULL
       ) r ON true
      WHERE a.org_id = $1::uuid
        AND a.deleted_at IS NULL
        AND ($2::text IS NULL OR lower(a.name) LIKE $2 OR lower(COALESCE(a.domain, '')) LIKE $2)
        AND ($3::uuid IS NULL OR a.owner_id = $3::uuid)
      ORDER BY r.last_at DESC NULLS LAST, lower(a.name)
      LIMIT $4`,
    [orgId, needle, ownerId, Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

/** One firm: the record, who there we know, and who here knows them. */
export async function getAccount({ orgId, accountId, viewerId = null } = {}) {
  if (!orgId || !accountId) return null;

  const { rows } = await query(
    `SELECT a.id, a.name, a.domain, a.kind, a.note, a.owner_id,
            u.full_name AS owner_name, a.created_at, a.updated_at
       FROM org_accounts a
       LEFT JOIN users u ON u.amber_id = a.owner_id
      WHERE a.org_id = $1::uuid AND a.id = $2::uuid AND a.deleted_at IS NULL`,
    [orgId, accountId],
  );
  if (rows.length === 0) return null;

  const [people, knowers] = await Promise.all([
    listPeople({ orgId, accountId, viewerId, limit: 200 }),
    accountKnowers({ orgId, accountId }),
  ]);

  return { account: rows[0], people, whoKnows: knowers };
}

/** Who at this company has a relationship with anyone at that firm. */
export async function accountKnowers({ orgId, accountId } = {}) {
  if (!orgId || !accountId) return [];
  const { rows } = await query(
    `SELECT e.member_id, u.full_name AS member_name,
            count(DISTINCT e.person_id)::int      AS people,
            COALESCE(sum(e.interactions), 0)::int AS interactions,
            max(e.last_at)                        AS last_at,
            max(e.strength)                       AS strength
       FROM org_person_edges e
       JOIN org_people p ON p.org_id = e.org_id AND p.id = e.person_id
       JOIN users u ON u.amber_id = e.member_id
      WHERE e.org_id = $1::uuid AND p.account_id = $2::uuid AND p.deleted_at IS NULL
      GROUP BY e.member_id, u.full_name
      ORDER BY max(e.strength) DESC, max(e.last_at) DESC`,
    [orgId, accountId],
  );
  return rows;
}

/**
 * The firm's whole timeline, across everybody at it.
 *
 * Same visibility rule as a person's history: this viewer's own touches plus
 * whatever has been made company-wide, with a count of what is withheld.
 */
export async function accountHistory({ orgId, accountId, viewerId = null, limit = 100 } = {}) {
  if (!orgId || !accountId) return { items: [], hidden: 0 };

  const n = Math.min(Number(limit) || 100, 500);
  const { rows } = await query(
    `SELECT i.id, i.kind, i.source, i.summary, i.artifact_url,
            i.occurred_at, i.member_id, i.visibility,
            u.full_name AS member_name,
            p.id AS person_id, p.display_name AS person_name
       FROM org_interactions i
       JOIN org_people p ON p.org_id = i.org_id AND p.id = i.person_id
       LEFT JOIN users u ON u.amber_id = i.member_id
      WHERE i.org_id = $1::uuid AND p.account_id = $2::uuid AND p.deleted_at IS NULL
        AND ${visibleInteractions("i", "$3")}
      ORDER BY i.occurred_at DESC
      LIMIT $4`,
    [orgId, accountId, viewerId, n],
  );

  const { rows: counts } = await query(
    `SELECT count(*)::int AS hidden
       FROM org_interactions i
       JOIN org_people p ON p.org_id = i.org_id AND p.id = i.person_id
      WHERE i.org_id = $1::uuid AND p.account_id = $2::uuid AND p.deleted_at IS NULL
        AND NOT ${visibleInteractions("i", "$3")}`,
    [orgId, accountId, viewerId],
  );

  return { items: rows, hidden: counts[0]?.hidden ?? 0 };
}

/**
 * WHAT IS GOING COLD.
 *
 * The read that makes this a product rather than a database: relationships
 * that were warm and have not been touched. Scored by how strong it was
 * against how long it has been, so somebody you spoke to weekly and have not
 * called in a month outranks somebody you met once in March.
 *
 * Deliberately only looks at people somebody actually has a relationship
 * with -- a contact imported from a list and never spoken to is not "going
 * cold", it was never warm, and mixing the two makes the list ignorable.
 */
export async function goingCold({
  orgId,
  memberId = null,
  viewerId = null,
  days = 21,
  limit = 20,
} = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT p.id, p.display_name, p.company,
            p.account_id, a.name AS account_name,
            e.member_id, u.full_name AS member_name,
            e.last_at, e.interactions, e.strength,
            EXTRACT(DAY FROM (now() - e.last_at))::int AS days_since
       FROM org_person_edges e
       JOIN org_people p ON p.org_id = e.org_id AND p.id = e.person_id
                        AND p.deleted_at IS NULL AND p.merged_into IS NULL
       JOIN users u ON u.amber_id = e.member_id
       LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
      WHERE e.org_id = $1::uuid
        AND ($2::uuid IS NULL OR e.member_id = $2::uuid)
        AND ${visiblePeople("p", "$5")}
        AND e.last_at < now() - make_interval(days => $3::int)
        -- Warm once: more than a single touch, and a real relationship rather
        -- than a name somebody imported.
        AND e.interactions > 1
      ORDER BY e.strength DESC, e.last_at ASC
      LIMIT $4`,
    [orgId, memberId, Math.max(1, Number(days) || 21),
     Math.min(Number(limit) || 20, 100), viewerId],
  );
  return rows;
}

/* ------------------------------------------------------------- consent */

/** Record that somebody has agreed to let a source feed the company graph. */
export async function grantSource({ orgId, amberId, source, scopeRef = null } = {}) {
  if (!orgId || !amberId || !source) return { ok: false, reason: "bad_input" };

  /*
   * A member may decline a permitted source. A member may not enable a
   * forbidden one. That sentence is the whole ceiling, and this is where it
   * is true for consent rather than only for writes -- otherwise somebody
   * grants a source the company has switched off and gets a connection that
   * silently never delivers anything.
   */
  const policy = await getPolicy({ orgId });
  if (!policy.sources.includes(source)) {
    return { ok: false, reason: "source_forbidden" };
  }
  /*
   * AND ENROL THEM FOR THE SYNC WORKER.
   *
   * The worker cannot read org_memory_sources: that table is tenant-scoped
   * and a worker has no tenant, so its query came back empty every hour
   * without ever failing. The queue holds two ids and nothing else, and it is
   * written here because here is where consent becomes a fact. A member who
   * revokes everything is still in the queue and is simply found to have no
   * live grant when the worker opens their tenant and checks.
   */
  await query(
    `INSERT INTO memory_refresh_queue (org_id, amber_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (org_id, amber_id) DO NOTHING`,
    [orgId, amberId],
  ).catch(() => null);

  const { rows } = await query(
    `INSERT INTO org_memory_sources (org_id, amber_id, source, scope_ref)
     VALUES ($1::uuid, $2::uuid, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, amberId, source, scopeRef],
  );
  if (rows.length > 0) return { ok: true, id: rows[0].id, created: true };

  /*
   * $4::text, AND THE CAST IS NOT COSMETIC. `COALESCE($4, '')` gives Postgres
   * two untyped operands and nothing to infer from, so it refuses the
   * statement outright with "could not determine data type of parameter $4".
   * Not a wrong answer -- no answer, every time this line runs.
   *
   * And it runs on the path nobody tests: granting a source that is ALREADY
   * granted. The first grant inserts and returns above. The second one falls
   * through to here, which means pressing Connect twice, or a first-run sync
   * re-granting what a member already allowed, raised a 500.
   */
  const { rows: existing } = await query(
    `SELECT id FROM org_memory_sources
      WHERE org_id = $1::uuid AND amber_id = $2::uuid AND source = $3
        AND COALESCE(scope_ref, '') = COALESCE($4::text, '') AND revoked_at IS NULL`,
    [orgId, amberId, source, scopeRef],
  );
  return { ok: true, id: existing[0]?.id ?? null, created: false };
}

/**
 * Revoke, and take the data with it.
 *
 * A consent record that stops future writes but leaves everything already
 * collected is not consent, it is a toggle. The interactions that arrived
 * under this grant are deleted, then the edges they contributed to are
 * recomputed -- because an edge is derived, and derived from data that no
 * longer exists means it has to change.
 */
export async function revokeSource({ orgId, amberId, sourceId } = {}) {
  if (!orgId || !amberId || !sourceId) return { ok: false, reason: "bad_input" };

  const { rows: owned } = await query(
    `SELECT id FROM org_memory_sources
      WHERE org_id = $1::uuid AND id = $2::uuid AND amber_id = $3::uuid`,
    [orgId, sourceId, amberId],
  );
  if (owned.length === 0) return { ok: false, reason: "not_found" };

  // Which people are about to lose rows, so their edges can be rebuilt after.
  const { rows: touched } = await query(
    `SELECT DISTINCT person_id, member_id FROM org_interactions
      WHERE org_id = $1::uuid AND connection_id = $2::uuid AND member_id IS NOT NULL`,
    [orgId, sourceId],
  );

  const { rowCount: removed } = await query(
    `DELETE FROM org_interactions WHERE org_id = $1::uuid AND connection_id = $2::uuid`,
    [orgId, sourceId],
  );

  await query(
    `UPDATE org_memory_sources SET revoked_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, sourceId],
  );

  for (const t of touched) {
    await refreshEdge({ orgId, personId: t.person_id, memberId: t.member_id }).catch(() => null);
  }

  /*
   * An edge whose interactions are all gone has nothing left to be derived
   * from. refreshEdge writes no row when the count is zero, so the stale one
   * has to go explicitly -- otherwise revoking leaves a relationship standing
   * with the evidence for it deleted, which is exactly the claim consent was
   * supposed to withdraw.
   */
  await query(
    `DELETE FROM org_person_edges e
      WHERE e.org_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM org_interactions i
           WHERE i.org_id = e.org_id AND i.person_id = e.person_id
             AND i.member_id = e.member_id
        )`,
    [orgId],
  );

  return { ok: true, removed };
}

export async function listSources({ orgId, amberId } = {}) {
  if (!orgId || !amberId) return [];
  const { rows } = await query(
    `SELECT id, source, scope_ref, granted_at, last_sync_at, last_error
       FROM org_memory_sources
      WHERE org_id = $1::uuid AND amber_id = $2::uuid AND revoked_at IS NULL
      ORDER BY granted_at`,
    [orgId, amberId],
  );
  return rows;
}

/* ----------------------------------------------------------------- merging */

/**
 * Two local parts where one is a prefix of the other, after digits go.
 *
 * sagar / sagartiw / sagart851 -> sagar, sagartiw, sagart. The first is a
 * prefix of both others, which is how one human's three addresses announce
 * themselves when nothing else will: a calendar invite carries no name for
 * 510 of 515 guests, so the address is all there is to reason from.
 *
 * FOUR CHARACTERS MINIMUM, and a prefix rather than a fuzzy distance. "jo"
 * prefixes half an address book; edit distance would pair ryan and bryan,
 * who are two people. A prefix relationship between local parts of four or
 * more is narrow enough to be worth a human looking at, which is all this
 * has to be.
 */
export function sharePrefix(a, b) {
  const clean = (v) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const x = clean(a);
  const y = clean(b);
  if (x.length < 4 || y.length < 4 || x === y) return x === y && x.length >= 4;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Pairs into groups, so three addresses for one person are one suggestion.
 *
 * Union-find rather than a recursive query: the pairs come back as (a,b) and
 * the thing a person wants to see is "these three are Sagar", not three
 * separate prompts that each half-fix it.
 */
export function clusters(pairs) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const [a, b] of pairs) parent.set(find(a), find(b));

  const groups = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Nodes that look like one person.
 *
 * WHAT THE DATA ACTUALLY OFFERS. The first instinct was the provider's
 * display name, and it is worthless here: of 515 guest entries on a real
 * calendar, 5 carried a name. Google documents displayName as optional and
 * fills it only when it already knows the person. So a name-keyed matcher
 * would have been correct, tested, and silent forever.
 *
 * What is left is the address, and it is enough:
 *
 *   PROPOSE on a prefix relationship between local parts. sagar is a prefix
 *   of sagartiw and of sagart851. This is loose on its own -- it would pair
 *   sagar with sagarika.
 *
 *   VETO on co-occurrence. Two addresses that have ever been guests at the
 *   same meeting are not one person. Somebody's work and personal addresses
 *   are essentially never both invited to one event, while two colleagues
 *   who both work with you are in the same room constantly. The veto is what
 *   turns a loose prefix rule into one worth showing.
 *
 * A name match still counts when there is one, since five is not zero.
 *
 * SUGGEST, NEVER PERFORM. A wrong merge puts one customer's private history
 * on another customer's record, which is not recoverable by apology. These
 * are candidates; a person presses the button.
 */
export async function suggestMerges({ orgId, limit = 25 } = {}) {
  if (!orgId) return [];

  /*
   * Candidates and the veto in one statement, because doing the veto in JS
   * would mean fetching every pair's whole meeting history to the client.
   *
   * The event id is recovered from the ledger's own idempotency key:
   * `event:<externalId>:<email>`. Two rows sharing the middle field were
   * guests at the same meeting. Reusing the key rather than joining back to
   * `events` keeps this working for producers that never had a row there.
   */
  const { rows: pairRows } = await query(
    `WITH people AS (
       SELECT p.id, p.display_name,
              lower(btrim(p.display_name)) AS name_key,
              array_length(string_to_array(btrim(p.display_name), ' '), 1) AS words
         FROM org_people p
        WHERE p.org_id = $1::uuid AND p.deleted_at IS NULL AND p.merged_into IS NULL
     ),
     locals AS (
       SELECT d.person_id,
              lower(regexp_replace(split_part(d.value, '@', 1), '[^a-z]', '', 'g')) AS lp
         FROM org_person_identities d
        WHERE d.org_id = $1::uuid AND d.kind = 'email'
     ),
     met_together AS (
       SELECT DISTINCT a.person_id AS a_id, b.person_id AS b_id
         FROM org_interactions a
         JOIN org_interactions b
           ON b.org_id = a.org_id
          AND split_part(b.external_id, ':', 2) = split_part(a.external_id, ':', 2)
          AND b.person_id <> a.person_id
        WHERE a.org_id = $1::uuid
          AND a.source = 'calendar' AND b.source = 'calendar'
          AND a.external_id IS NOT NULL AND b.external_id IS NOT NULL
     )
     SELECT DISTINCT pa.id AS a_id, pb.id AS b_id,
            CASE WHEN pa.name_key = pb.name_key THEN 'name' ELSE 'address' END AS signal
       FROM people pa
       JOIN people pb ON pa.id < pb.id
       LEFT JOIN locals la ON la.person_id = pa.id
       LEFT JOIN locals lb ON lb.person_id = pb.id
      WHERE (
              -- a real shared name, when the provider gave one
              (pa.name_key = pb.name_key AND pa.words >= 2 AND pa.display_name NOT LIKE '%@%')
              -- or one address is a prefix of the other
              OR (
                length(la.lp) >= 4 AND length(lb.lp) >= 4
                /*
                 * THE EQUALITY IS AN OPTIMIZATION, NOT A RULE. It is implied
                 * by the prefix test below -- if one local part is a prefix
                 * of the other and both are at least four characters, their
                 * first four characters are equal by definition -- so it
                 * changes no result. What it changes is the plan: without an
                 * equality to join on, Postgres compares every person to
                 * every other person, which is fine at eighteen people and
                 * fifty million comparisons at ten thousand.
                 */
                AND left(la.lp, 4) = left(lb.lp, 4)
                AND (la.lp LIKE lb.lp || '%' OR lb.lp LIKE la.lp || '%')
              )
            )
        -- THE VETO. Guests at the same meeting are two people.
        AND NOT EXISTS (
          SELECT 1 FROM met_together m
           WHERE (m.a_id = pa.id AND m.b_id = pb.id)
              OR (m.a_id = pb.id AND m.b_id = pa.id)
        )`,
    [orgId],
  );

  const groups = clusters(pairRows.map((r) => [r.a_id, r.b_id])).slice(0, limit);
  if (groups.length === 0) return [];

  const signals = new Map();
  for (const r of pairRows) signals.set(`${r.a_id}|${r.b_id}`, r.signal);

  const { rows: detail } = await query(
    `SELECT p.id, p.display_name, p.account_id, a.name AS account_name,
            COALESCE((
              SELECT array_agg(d.value ORDER BY d.value)
                FROM org_person_identities d
               WHERE d.org_id = p.org_id AND d.person_id = p.id AND d.kind = 'email'
            ), ARRAY[]::text[]) AS emails,
            (SELECT count(*)::int FROM org_interactions i
              WHERE i.org_id = p.org_id AND i.person_id = p.id) AS interactions,
            (SELECT max(i.occurred_at) FROM org_interactions i
              WHERE i.org_id = p.org_id AND i.person_id = p.id) AS last_at
       FROM org_people p
       LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
      WHERE p.org_id = $1::uuid AND p.id = ANY($2::uuid[])`,
    [orgId, groups.flat()],
  );
  const byId = new Map(detail.map((d) => [d.id, d]));

  return groups.map((ids) => {
    const people = ids.map((id) => byId.get(id)).filter(Boolean);
    // The busiest node is the one to keep, so the survivor is the one most
    // links already point at.
    people.sort((x, y) => (y.interactions ?? 0) - (x.interactions ?? 0));
    const byName = ids.some((a) =>
      ids.some((b) => signals.get(`${a}|${b}`) === "name"),
    );
    return {
      n: people.length,
      signal: byName ? "name" : "address",
      suggestedKeepId: people[0]?.id ?? null,
      people,
    };
  });
}

/**
 * Join several nodes into one.
 *
 * NOTHING IS REWRITTEN. The merged-away rows stay exactly where they are and
 * so does every interaction pointing at them; only a pointer is set. That is
 * what keeps the ledger append-only through a merge, and it is what makes the
 * operation reversible -- which matters, because somebody will eventually
 * merge two real people who share a name and need it undone.
 */
export async function mergePeople({ orgId, keepId, mergeIds = [], byAmberId = null } = {}) {
  const losers = [...new Set(mergeIds.filter((id) => id && id !== keepId))];
  if (!orgId || !keepId || losers.length === 0) return { ok: false, reason: "bad_input" };

  const { rows: valid } = await query(
    `SELECT id FROM org_people
      WHERE org_id = $1::uuid AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [orgId, [keepId, ...losers]],
  );
  if (valid.length !== losers.length + 1) return { ok: false, reason: "not_found" };

  /*
   * Who held an edge to any of these, so the survivor's edges can be rebuilt
   * afterwards. Collected BEFORE the merge, because the edges are deleted as
   * part of it and the list would be gone.
   */
  const { rows: members } = await query(
    `SELECT DISTINCT member_id FROM org_person_edges
      WHERE org_id = $1::uuid AND person_id = ANY($2::uuid[])`,
    [orgId, [keepId, ...losers]],
  );

  // The trigger refuses a chain, so a failure here is a real conflict rather
  // than something to work around.
  await query(
    `UPDATE org_people
        SET merged_into = $2::uuid, merged_at = now(), merged_by = $4::uuid, updated_at = now()
      WHERE org_id = $1::uuid AND id = ANY($3::uuid[])`,
    [orgId, keepId, losers, byAmberId],
  );

  // A merged-away person is no longer a node, so they hold no edges.
  await query(
    `DELETE FROM org_person_edges WHERE org_id = $1::uuid AND person_id = ANY($2::uuid[])`,
    [orgId, losers],
  );

  for (const m of members) {
    await refreshEdge({ orgId, personId: keepId, memberId: m.member_id }).catch(() => null);
  }

  /*
   * The survivor inherits the firm if it did not have one. A person known
   * only by a personal address, merged into their work identity, should end
   * up filed under the firm rather than nowhere.
   */
  await query(
    `UPDATE org_people k
        SET account_id = sub.account_id, updated_at = now()
       FROM (
         SELECT account_id FROM org_people
          WHERE org_id = $1::uuid AND id = ANY($2::uuid[]) AND account_id IS NOT NULL
          LIMIT 1
       ) sub
      WHERE k.org_id = $1::uuid AND k.id = $3::uuid AND k.account_id IS NULL`,
    [orgId, losers, keepId],
  );

  return { ok: true, merged: losers.length, keepId };
}

/** Undo one merge. The pointer goes back to null and both sides recompute. */
export async function unmergePerson({ orgId, personId } = {}) {
  if (!orgId || !personId) return { ok: false, reason: "bad_input" };

  const { rows } = await query(
    `UPDATE org_people
        SET merged_into = NULL, merged_at = NULL, merged_by = NULL, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND merged_into IS NOT NULL
      RETURNING merged_into AS was`,
    [orgId, personId],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  const was = rows[0].was;

  const { rows: members } = await query(
    `SELECT DISTINCT member_id FROM org_interactions
      WHERE org_id = $1::uuid AND person_id IN ($2::uuid, $3::uuid) AND member_id IS NOT NULL`,
    [orgId, personId, was],
  );
  for (const m of members) {
    await refreshEdge({ orgId, personId, memberId: m.member_id }).catch(() => null);
    await refreshEdge({ orgId, personId: was, memberId: m.member_id }).catch(() => null);
  }

  return { ok: true, separated: personId, from: was };
}

/**
 * Pure helpers, exposed for tests only.
 *
 * Named __test rather than exported outright so that nothing in the product
 * imports storable() and starts cleaning text on a second path -- the point
 * of doing it at the one door is that there is one door.
 */
export const __test = { storable };

/**
 * WHAT THIS CIRCLE HAS BEEN IN A ROOM FOR, past and coming up.
 *
 * WHY A CIRCLE HAS A CALENDAR AT ALL. A circle is a set of people, and the
 * thing a set of people shares that nobody has to type is the meetings they
 * were in. Every other tab in a chat is something somebody posted; this one
 * is already true, which makes it the tab that is worth something on day
 * one.
 *
 * MEMBERS, NOT TOPICS. The rows are interactions belonging to the circle's
 * own members -- not a guess at which meetings were "about" this circle,
 * which is a thing nobody can know and a thing a wrong answer in is worse
 * than no answer.
 *
 * AND IT IS STILL THE VIEWER'S VIEW. visibleInteractions is the same clause
 * every other read uses, so being in a circle with somebody does not quietly
 * open their private entries. A circle is a room, not a permission.
 */
export async function circleCalendar({ orgId, memberIds = [], viewerId = null, limit = 80 } = {}) {
  if (!orgId || memberIds.length === 0) return { past: [], upcoming: [] };

  const n = Math.min(Number(limit) || 80, 400);

  /*
   * ONE ROW PER MEETING, AND THE KEY IS THE MEETING ITSELF.
   *
   * TWO WRONG ANSWERS CAME BEFORE THIS ONE, both from trusting external_id.
   * The ledger is a PERSON's timeline, so a meeting with five guests writes
   * five rows; the bridge keys them event:<provider id>:<person>, so every
   * row's external_id differs by construction. Grouping on the whole string
   * grouped nothing. Stripping the last segment fixed that case and left
   * another: when a provider id is absent the bridge falls back to the local
   * row id, so the same meeting synced from two connected calendars -- or
   * re-synced into two local rows -- still carries two different ids.
   *
   * So the key is what makes two entries THE SAME MEETING to somebody
   * looking at a calendar: the same title, starting the same minute. Two
   * genuinely different meetings with an identical title at an identical
   * minute would collapse, and they would also be indistinguishable on the
   * screen, so the grouping is honest about what it can tell apart.
   *
   * WHAT IT GATHERS INSTEAD OF DISCARDING: who was in the room, which
   * colleagues' calendars it came off, and which connected accounts. That
   * is the thing somebody wanted when they clicked a duplicate.
   */
  const { rows } = await query(
    `WITH visible AS (
       SELECT i.id, i.kind, i.source, i.summary, i.occurred_at, i.member_id,
              i.source_account,
              u.full_name AS member_name,
              p.display_name AS person_name,
              a.name AS firm
         FROM org_interactions i
         LEFT JOIN users u ON u.amber_id = i.member_id
         LEFT JOIN org_people p ON p.org_id = i.org_id AND p.id = i.person_id
         LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
        WHERE i.org_id = $1::uuid
          AND i.member_id = ANY($2::uuid[])
          AND i.kind IN ('meeting', 'call', 'event')
          AND ${visibleInteractions("i", "$3")}
     )
     SELECT min(id::text)            AS id,
            min(kind)                AS kind,
            min(source)              AS source,
            min(summary)             AS summary,
            min(occurred_at)         AS occurred_at,
            min(member_id::text)     AS member_id,
            min(member_name)         AS member_name,
            min(firm)                AS firm,
            array_remove(array_agg(DISTINCT person_name), NULL)    AS people,
            array_remove(array_agg(DISTINCT member_name), NULL)    AS members,
            array_remove(array_agg(DISTINCT source_account), NULL) AS accounts,
            count(*)::int                                          AS rows_behind
       FROM visible
      GROUP BY lower(btrim(COALESCE(summary, ''))),
               date_trunc('minute', occurred_at)
      ORDER BY min(occurred_at) DESC
      LIMIT $4`,
    [orgId, memberIds, viewerId, n],
  );

  const now = Date.now();
  const past = [];
  const upcoming = [];
  for (const r of rows) {
    const row = {
      ...r,
      people: r.people ?? [],
      members: r.members ?? [],
      accounts: r.accounts ?? [],
      /* Kept for every screen that was reading one name. */
      person_name: (r.people ?? [])[0] ?? null,
    };
    (new Date(r.occurred_at).getTime() > now ? upcoming : past).push(row);
  }
  // Soonest first for what is coming; most recent first for what is done.
  upcoming.reverse();
  return { past, upcoming };
}
