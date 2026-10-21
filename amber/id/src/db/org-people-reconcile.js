/**
 * NAMES FROM THE PROVIDER, AND ONE ROW PER HUMAN.
 *
 * Two complaints that turn out to be the same complaint. The graph showed
 * "Ipandey" instead of Ipsha Pandey, and it showed four nodes for a man who
 * has four email addresses. Both are the resolver being honest about what an
 * address can tell you, and both are fixed by using the thing we were already
 * being handed and throwing away.
 *
 * GOOGLE AND MICROSOFT SEND THE NAME. Every calendar invite carries, per
 * guest, the display name the guest set on their own account. That name is
 * already stored on events.attendees -- the sync has written it for weeks --
 * and nothing downstream ever read it for anybody who had already been
 * created from an address. This reads it.
 *
 * WHY NOT ASK A MODEL. We did, and it was the wrong instrument: a model can
 * guess "Ipsha Pandey" from a meeting title that happens to contain it, and
 * guesses nothing when no meeting mentions her. The provider KNOWS. Reading
 * what the provider sent is deterministic, free, instant and right, so it
 * runs first and the model only ever sees whoever is left.
 *
 * AND THE NAMES ARE WHAT UNLOCKS THE MERGE. The duplicate suggester has
 * always paired two rows carrying the same multi-word provider name, and
 * always vetoed a pair that sat in the same meeting. It could never fire,
 * because nobody had a multi-word provider name: everyone was a chopped-up
 * address. Name them and the suggester works, so this applies its
 * name-signal groups and leaves the weaker address-prefix guesses for a
 * human.
 */

import { query } from "./sql.js";
import { suggestMerges, mergePeople } from "./org-memory-store.js";
import { accessTokenFor } from "../lib/calendar-sync.js";
import { observedNamesForOrg } from "./observed-names.js";

/** A name a provider sent, as opposed to one we assembled from an address. */
export function usableName(raw, email) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return null;
  if (name.includes("@")) return null;
  const local = String(email ?? "").split("@")[0]?.toLowerCase() ?? "";
  /*
   * Outlook fills displayName with the address when the sender has no
   * profile, and some clients fill it with the local part. Either is the
   * placeholder we are trying to get rid of, not an improvement on it.
   */
  if (local && name.toLowerCase().replace(/[^a-z0-9]/g, "") === local.replace(/[^a-z0-9]/g, "")) {
    return null;
  }
  return name;
}

/**
 * Every (address -> name) this org's calendars have ever seen.
 *
 * Scoped to members who have a live grant, because a grant is the authority
 * for reading that member's rows and revoking it has to actually stop this.
 * The most frequently seen spelling wins, which settles "Sagar Tiwari" against
 * a one-off "sagar tiwari (guest)".
 */
export async function providerNames({ orgId } = {}) {
  if (!orgId) return new Map();

  const { rows } = await query(
    `SELECT a.email AS email, a.name AS name, count(*)::int AS seen
       FROM org_memory_sources g
       JOIN events e
         ON e.owner_id = g.amber_id AND e.deleted_at IS NULL
      CROSS JOIN LATERAL jsonb_to_recordset(
            CASE WHEN jsonb_typeof(e.attendees) = 'array' THEN e.attendees ELSE '[]'::jsonb END
          ) AS a(email text, name text)
      WHERE g.org_id = $1::uuid
        AND g.source = 'calendar'
        AND g.revoked_at IS NULL
        AND a.email IS NOT NULL
        AND a.name IS NOT NULL
      GROUP BY a.email, a.name
      ORDER BY count(*) DESC`,
    [orgId],
  );

  const best = new Map();
  for (const r of rows) {
    const email = String(r.email ?? "").trim().toLowerCase();
    const name = usableName(r.name, email);
    if (!email.includes("@") || !name) continue;
    // Rows arrive most-seen first, so the first one to claim an address wins.
    if (!best.has(email)) best.set(email, name);
  }
  return best;
}

/**
 * NAMES OUT OF THE CONTACT BOOKS WE ALREADY SYNCED.
 *
 * THIS IS THE SOURCE THAT ACTUALLY HAS THEM, and it needed no new permission
 * and no new sync: it has been sitting in `contacts` the whole time. Gmail's
 * own headers carry "Ipsha Pandey" <i.pandey@pnptc.com> and the mail sync
 * writes that name onto the contact. The company graph never looked, because
 * its people are created from calendar guest lists and a guest list is only
 * addresses.
 *
 * Why this ranks above the calendar: Google Calendar does NOT put a name on
 * most attendees. displayName is filled only when the ORGANIZER had the
 * person in their own contacts, so an invite forwarded around a company
 * arrives as a list of bare addresses. The names on screen in Google Calendar
 * are resolved by the Google client from the viewer's contacts -- which is
 * this table, not the event.
 */
export async function contactBookNames({ orgId } = {}) {
  if (!orgId) return new Map();

  const { rows } = await query(
    `SELECT lower(btrim(e.addr)) AS email, btrim(c.full_name) AS name, count(*)::int AS seen
       FROM org_members m
       JOIN contacts c
         ON c.owner_id = m.amber_id AND c.deleted_at IS NULL
      CROSS JOIN LATERAL unnest(
            string_to_array(regexp_replace(lower(COALESCE(c.emails, '')), '[;[:space:]]+', ',', 'g'), ',')
          ) AS e(addr)
      WHERE m.org_id = $1::uuid
        AND m.status = 'active'
        AND c.full_name IS NOT NULL
        AND btrim(c.full_name) <> ''
        AND e.addr LIKE '%@%'
      GROUP BY 1, 2
      ORDER BY count(*) DESC`,
    [orgId],
  );

  const best = new Map();
  for (const r of rows) {
    const email = String(r.email ?? "").trim().toLowerCase();
    const name = usableName(r.name, email);
    if (!email.includes("@") || !name) continue;
    if (!best.has(email)) best.set(email, name);
  }
  return best;
}

/**
 * NAMES STRAIGHT FROM GOOGLE, including the ones nobody saved.
 *
 * People API has two buckets. `connections` is the address book somebody
 * curated; `otherContacts` is the one Google fills in by itself from everyone
 * they have ever corresponded with, and it is where the long tail of names
 * lives. Together they are the same resolution Google's own clients do, which
 * is why a name appears in Google Calendar that never appears in the event.
 *
 * IT MAY 403, AND THAT IS A REPORTABLE ANSWER RATHER THAN A FAILURE. A
 * calendar connected through the calendar-only consent has no contacts scope.
 * The call is caught, the account is counted under `needsConsent`, and
 * everything else still runs -- so the diagnostic can say "reconnect this
 * calendar to get names from Google" instead of leaving somebody to guess.
 */
export async function googleDirectoryNames({ orgId, fetchImpl = fetch } = {}) {
  const out = new Map();
  const report = { accounts: 0, read: 0, needsConsent: 0, failed: 0 };
  if (!orgId) return { names: out, report };

  const { rows: accounts } = await query(
    `SELECT DISTINCT ca.id, ca.provider, ca.refresh_token, ca.scopes, ca.account_email
       FROM org_memory_sources g
       JOIN calendar_accounts ca
         ON ca.owner_id = g.amber_id AND ca.disabled_at IS NULL
      WHERE g.org_id = $1::uuid AND g.revoked_at IS NULL AND ca.provider = 'google'`,
    [orgId],
  );

  for (const account of accounts) {
    report.accounts += 1;
    const token = await accessTokenFor(account, fetchImpl).catch(() => null);
    if (!token) {
      report.failed += 1;
      continue;
    }

    for (const bucket of ["connections", "otherContacts"]) {
      const base =
        bucket === "connections"
          ? "https://people.googleapis.com/v1/people/me/connections"
          : "https://people.googleapis.com/v1/otherContacts";
      const maskKey = bucket === "connections" ? "personFields" : "readMask";

      let pageToken = null;
      let pages = 0;
      do {
        const url = new URL(base);
        url.searchParams.set(maskKey, "names,emailAddresses");
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        let body = null;
        try {
          const res = await fetchImpl(url.toString(), {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20000),
          });
          if (res.status === 403 || res.status === 401) {
            report.needsConsent += 1;
            break;
          }
          if (!res.ok) {
            report.failed += 1;
            break;
          }
          body = await res.json();
        } catch {
          report.failed += 1;
          break;
        }

        for (const person of body?.[bucket] ?? []) {
          const named = (person?.names ?? []).find((n) => n?.metadata?.primary) ?? person?.names?.[0];
          const label =
            named?.displayName ||
            [named?.givenName, named?.familyName].filter(Boolean).join(" ");
          if (!label) continue;
          for (const e of person?.emailAddresses ?? []) {
            const email = String(e?.value ?? "").trim().toLowerCase();
            const name = usableName(label, email);
            if (!email.includes("@") || !name) continue;
            if (!out.has(email)) out.set(email, name);
            report.read += 1;
          }
        }

        pageToken = body?.nextPageToken ?? null;
        pages += 1;
      } while (pageToken && pages < 20);
    }
  }

  return { names: out, report };
}

/**
 * Give every address-named person the name their provider sent.
 *
 * Only touches rows whose name we invented. A name somebody typed is marked
 * 'human' and is never reached by this.
 */
export async function reconcileNames({ orgId, fetchImpl = fetch, directory = null } = {}) {
  /*
   * THREE SOURCES, WORST FIRST, so the best one wins by overwriting.
   *
   * The calendar is the weakest because most invites carry no name at all.
   * The contact books are next and cost nothing. Google's own directory is
   * the strongest and the only one that can need a reconsent, so it is also
   * the only one that can be absent -- and when it is, the other two still
   * run.
   */
  const names = new Map();
  const from = { calendar: 0, contacts: 0, observed: 0, google: 0 };

  for (const [email, name] of await providerNames({ orgId })) {
    names.set(email, name);
    from.calendar += 1;
  }
  for (const [email, name] of await contactBookNames({ orgId })) {
    names.set(email, name);
    from.contacts += 1;
  }
  /*
   * AND THE ENVELOPES, WHICH IS WHERE THEY ACTUALLY ARE. Every header any
   * sync has read wrote its (address, name) pair down. It outranks a contact
   * card because a header is written by the person themselves, and a card is
   * whatever somebody once typed.
   */
  for (const [email, name] of await observedNamesForOrg(orgId)) {
    names.set(email, name);
    from.observed += 1;
  }
  /*
   * The caller may hand this in already fetched. The worker does, because the
   * People API is a network call and the rest of this runs inside a database
   * transaction -- and a transaction held open across somebody else's HTTP
   * round trip is how a sync turns into a lock everybody else waits behind.
   */
  const dir =
    directory ??
    (await googleDirectoryNames({ orgId, fetchImpl }).catch(() => ({
      names: new Map(),
      report: { accounts: 0, read: 0, needsConsent: 0, failed: 0 },
    })));
  for (const [email, name] of dir.names) {
    names.set(email, name);
    from.google += 1;
  }

  if (names.size === 0) {
    return { considered: 0, renamed: 0, from, google: dir.report };
  }

  const { rows } = await query(
    `SELECT p.id, p.display_name,
            array_agg(i.value) AS emails
       FROM org_people p
       JOIN org_person_identities i
         ON i.org_id = p.org_id AND i.person_id = p.id AND i.kind = 'email'
      WHERE p.org_id = $1::uuid
        AND p.deleted_at IS NULL
        AND p.name_source = 'address'
      GROUP BY p.id, p.display_name`,
    [orgId],
  );

  let renamed = 0;
  for (const row of rows) {
    let found = null;
    for (const email of row.emails ?? []) {
      const hit = names.get(String(email).toLowerCase());
      if (hit) {
        found = hit;
        break;
      }
    }
    if (!found || found === row.display_name) continue;

    await query(
      `UPDATE org_people
          SET display_name = $3::text, name_source = 'provider', updated_at = now()
        WHERE org_id = $1::uuid AND id = $2::uuid AND name_source = 'address'`,
      [orgId, row.id, found],
    );
    renamed += 1;
  }

  return { considered: rows.length, renamed, from, google: dir.report };
}

/**
 * Apply the merges that are not a judgment call.
 *
 * The duplicate suggester already exists and is already careful: it pairs two
 * rows when the provider gave both the SAME multi-word name, and it vetoes
 * any pair that sat in the same meeting, because two guests at one meeting
 * are two people. What was missing is that nothing ever acted on it -- the
 * suggestions sat on a screen waiting for a click, so a man with four
 * addresses stayed four nodes.
 *
 * THIS OVERRIDES A DELIBERATE "SUGGEST, NEVER PERFORM". That rule was
 * written when a name was weak evidence, which it was while every name was
 * a chopped-up address. A name both providers independently reported, on two
 * rows that never sat in a meeting together, is not that. And the merge is
 * reversible -- unmergePerson puts both rows back -- so the cost of being
 * wrong is a click, not an apology.
 *
 * Only the name-signal groups are applied here. The address-signal ones --
 * where one local part is a prefix of another -- stay suggestions, because
 * "sagar@" and "sagarsub@" being one person is a guess, and an unwanted merge
 * costs more than an unmerged pair. Those are reversible from the duplicates
 * screen either way.
 */
export async function autoMerge({ orgId, byAmberId = null, limit = 50 } = {}) {
  if (!orgId) return { merged: 0, groups: 0 };

  const groups = await suggestMerges({ orgId, limit });
  let merged = 0;
  let applied = 0;

  for (const g of groups) {
    if (g.signal !== "name") continue;
    const keepId = g.suggestedKeepId;
    const mergeIds = (g.people ?? []).map((p) => p.id).filter((id) => id && id !== keepId);
    if (!keepId || mergeIds.length === 0) continue;

    const res = await mergePeople({ orgId, keepId, mergeIds, byAmberId }).catch(() => null);
    if (res?.ok) {
      applied += 1;
      merged += res.merged ?? 0;
    }
  }

  return { merged, groups: applied };
}

/**
 * WHERE THE NAMES ARE, COUNTED, BEFORE CHANGING ANYTHING.
 *
 * Written because three rounds of this were spent guessing which source had
 * what, and a guess that sounds right is worse than no answer. This says how
 * many people are still named after their address, how many names each source
 * can supply, how many of the unnamed each source would actually fix, and
 * whether Google refused for want of a consent.
 */
export async function nameCoverage({ orgId, fetchImpl = fetch } = {}) {
  if (!orgId) return null;

  const { rows: counts } = await query(
    `SELECT
       count(*) FILTER (WHERE name_source = 'address')::int  AS from_address,
       count(*) FILTER (WHERE name_source = 'provider')::int AS from_provider,
       count(*) FILTER (WHERE name_source = 'human')::int    AS from_human,
       count(*)::int                                         AS people
     FROM org_people
     WHERE org_id = $1::uuid AND deleted_at IS NULL AND merged_into IS NULL`,
    [orgId],
  );

  const { rows: unnamed } = await query(
    `SELECT p.id, array_agg(i.value) AS emails
       FROM org_people p
       JOIN org_person_identities i
         ON i.org_id = p.org_id AND i.person_id = p.id AND i.kind = 'email'
      WHERE p.org_id = $1::uuid AND p.deleted_at IS NULL
        AND p.merged_into IS NULL AND p.name_source = 'address'
      GROUP BY p.id`,
    [orgId],
  );

  const calendar = await providerNames({ orgId });
  const contacts = await contactBookNames({ orgId });
  const observed = await observedNamesForOrg(orgId);
  const directory = await googleDirectoryNames({ orgId, fetchImpl }).catch(() => ({
    names: new Map(),
    report: { accounts: 0, read: 0, needsConsent: 0, failed: 0 },
  }));

  const wouldFix = (map) =>
    unnamed.filter((p) => (p.emails ?? []).some((e) => map.has(String(e).toLowerCase()))).length;

  const covered = unnamed.filter((p) =>
    (p.emails ?? []).some((e) => {
      const k = String(e).toLowerCase();
      return calendar.has(k) || contacts.has(k) || observed.has(k) || directory.names.has(k);
    }),
  ).length;

  /*
   * THE ROWS THEMSELVES, because the counts above answered the wrong
   * question. They said four people are still address-derived while the
   * screen showed eight addresses -- which means the others are marked as
   * real names and are therefore skipped by every pass. Totals cannot tell
   * you that; a list of who, what they are called, where that name came from
   * and what each source offers instead can.
   */
  /*
   * WHICH DOMAINS THE COMPANY IS, as the query actually computes them.
   *
   * "One of us" is empty whenever this list is, and the list is derived from
   * the members' own sign-in addresses -- which live in different columns
   * depending on how somebody signed in. Printing it ends the argument about
   * whether the rule is wrong or the data is.
   */
  const { rows: domains } = await query(
    `SELECT lower(COALESCE(email_domain, '')) AS d, 'organizations.email_domain' AS via
       FROM organizations WHERE id = $1::uuid AND COALESCE(email_domain, '') <> ''
     UNION
     SELECT DISTINCT lower(split_part(COALESCE(ui.email, ui.subject), '@', 2)),
            'member ' || ui.provider
       FROM org_members m
       JOIN user_identities ui
         ON ui.amber_id = m.amber_id AND ui.deleted_at IS NULL
      WHERE m.org_id = $1::uuid AND m.deleted_at IS NULL
        AND COALESCE(ui.email, ui.subject) LIKE '%@%'`,
    [orgId],
  ).catch(() => ({ rows: [] }));

  const { rows: sample } = await query(
    `SELECT p.display_name, p.name_source,
            COALESCE((SELECT array_agg(i.value ORDER BY i.value)
                        FROM org_person_identities i
                       WHERE i.org_id = p.org_id AND i.person_id = p.id
                         AND i.kind = 'email'), '{}') AS emails
       FROM org_people p
      WHERE p.org_id = $1::uuid AND p.deleted_at IS NULL AND p.merged_into IS NULL
      ORDER BY p.name_source, p.display_name
      LIMIT 40`,
    [orgId],
  );

  const offersFor = (emails) => {
    const out = {};
    for (const e of emails ?? []) {
      const k = String(e).toLowerCase();
      const hit = {
        envelopes: observed.get(k) ?? null,
        contacts: contacts.get(k) ?? null,
        google: directory.names.get(k) ?? null,
        calendar: calendar.get(k) ?? null,
      };
      if (hit.envelopes || hit.contacts || hit.google || hit.calendar) out[k] = hit;
    }
    return out;
  };

  return {
    ...counts[0],
    orgDomains: domains,
    people_detail: sample.map((r) => ({
      name: r.display_name,
      from: r.name_source,
      emails: r.emails,
      offers: offersFor(r.emails),
    })),
    stillUnnamed: unnamed.length,
    sources: {
      calendar: { known: calendar.size, wouldFix: wouldFix(calendar) },
      envelopes: { known: observed.size, wouldFix: wouldFix(observed) },
      contacts: { known: contacts.size, wouldFix: wouldFix(contacts) },
      google: { known: directory.names.size, wouldFix: wouldFix(directory.names), ...directory.report },
    },
    /* The ones no source can name. These genuinely need a human or a merge. */
    unresolvable: unnamed.length - covered,
  };
}
