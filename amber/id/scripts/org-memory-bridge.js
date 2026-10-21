#!/usr/bin/env node
/**
 * SEE WHAT A MEMBER'S PERSONAL GRAPH WOULD GIVE THE COMPANY, THEN GIVE IT.
 *
 *   railway run node scripts/org-memory-bridge.js --email you@company.com
 *   railway run node scripts/org-memory-bridge.js --email you@company.com --run
 *
 * Without --run it reads and reports: how many calendar events and email
 * headers this person has, what they have granted, and what is already in the
 * company ledger. Nothing is written.
 *
 * WHY THE DRY RUN IS THE DEFAULT. The first question about a backfill is
 * always "how much is there", and the honest answer decides whether the
 * product has anything to show. Finding out by running it and then looking at
 * the result is the same information for a much higher price, since the way
 * back out is deleting rows from a ledger that is supposed to be append-only.
 *
 * --run grants calendar and mail if they are not already granted, then
 * replays both. Granting here is a convenience for a workspace you own; in
 * the product a person grants their own sources and nobody can do it for them.
 */

import { query, closePool } from "../src/db/sql.js";
import { withTenant } from "../src/db/tenant.js";
import { bridgeMember } from "../src/db/org-memory-bridge.js";
import { grantSource, mergePeople, suggestMerges } from "../src/db/org-memory-store.js";
import { readSyncableAccounts } from "../src/db/calendar-accounts.js";
import { syncCalendarAccount } from "../src/lib/calendar-sync.js";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const n = (v) => Number(v ?? 0).toLocaleString();

async function main() {
  const email = arg("email");
  const amberIdArg = arg("amber-id");
  const run = arg("run") === true;
  const sync = arg("sync") === true;
  const dupes = arg("duplicates") === true;
  const doMerge = arg("merge") === true;
  const since = arg("since");          // e.g. 2024-01-01
  const limit = Number(arg("limit", 5000));

  if ((!email || email === true) && (!amberIdArg || amberIdArg === true)) {
    console.error("usage: node scripts/org-memory-bridge.js --email you@company.com [--sync] [--run] [--duplicates] [--merge] [--past-days 1095] [--limit 5000]");
    process.exit(1);
  }

  /*
   * Resolved OUTSIDE a tenant scope on purpose: which company somebody is in
   * is the thing being looked up, so it cannot be a query that already
   * assumes one.
   */
  /*
   * TWO STEPS, BECAUSE ROW SECURITY IS NOW ENFORCED.
   *
   * org_members and organizations both carry the amber_tenant policy, and
   * with FORCE on they return nothing until a tenant is set -- which is the
   * thing we are trying to discover. The chicken-and-egg is exactly what
   * amber_membership_bootstrap exists for: a SECURITY DEFINER read with a
   * pinned search_path, already the sanctioned path for the API's own
   * sign-in, and not a new bypass invented for a script.
   *
   * users and user_identities carry no policy, so the first step is an
   * ordinary read.
   */
  const { rows: found } = await query(
    `SELECT u.amber_id, u.full_name
       FROM users u
       LEFT JOIN user_identities i
         ON i.amber_id = u.amber_id AND i.provider = 'email' AND i.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
        AND ( ($1::text IS NOT NULL AND lower(i.subject) = lower($1::text))
              OR ($2::uuid IS NOT NULL AND u.amber_id = $2::uuid) )
      LIMIT 1`,
    [typeof email === "string" ? email : null,
     typeof amberIdArg === "string" ? amberIdArg : null],
  );

  if (found.length === 0) {
    console.error(`\nNo account found for ${email || amberIdArg}.\n`);
    process.exit(1);
  }

  const { rows: who } = await query(
    `SELECT $2::uuid AS amber_id, $3::text AS full_name,
            b.org_id, b.org_name, b.role
       FROM amber_membership_bootstrap($1::uuid) b
      WHERE b.status = 'active'
      ORDER BY b.joined_at
      LIMIT 1`,
    [found[0].amber_id, found[0].amber_id, found[0].full_name],
  );

  if (who.length === 0) {
    console.error(`\n${found[0].full_name ?? email} exists but is not in a workspace.\n`);
    process.exit(1);
  }

  const { amber_id: amberId, full_name: name, org_id: orgId, org_name: orgName } = who[0];
  console.log(`\n${name ?? email} — ${orgName}\n`);

  /*
   * IS A CALENDAR EVEN CONNECTED. The first version of this script reported
   * zero meetings and left somebody to guess whether that meant no calendar,
   * a calendar that had never synced, or a sync that was failing. Three very
   * different problems with one indistinguishable symptom, which is the kind
   * of silence that costs an evening.
   */
  const accounts = await readSyncableAccounts(amberId);
  console.log("  Connected calendars");
  if (accounts.length === 0) {
    console.log("    none — connect one in the org console first");
  }
  for (const a of accounts) {
    const when = a.synced_at ? `last synced ${String(a.synced_at).slice(0, 16)}` : "never synced";
    console.log(`    ${String(a.provider).padEnd(10)} ${String(a.account_email).padEnd(34)} ${when}` +
                `${a.last_error ? `  ERROR: ${a.last_error}` : ""}`);
  }

  if (sync && accounts.length > 0) {
    console.log("\n  Syncing...");
    for (const a of accounts) {
      /*
       * THREE YEARS, not the sixty days a day view asks for. The whole point
       * of this graph is the person you have not spoken to in eight months,
       * and the routine window cannot see one. Paid once, on connect.
       */
      const out = await syncCalendarAccount(a, {}, {
        pastDays: Number(arg("past-days", 1095)),
        futureDays: 120,
        maxEvents: 20000,
      });
      console.log(`    ${a.account_email.padEnd(34)} ${n(out.written)} events` +
                  `${out.error ? `  ERROR: ${out.error}` : ""}`);
    }
  } else if (accounts.length > 0 && !sync) {
    console.log("    (add --sync to pull them now)");
  }
  console.log("");

  // ---------------------------------------------------------------- supply
  const { rows: supply } = await query(
    `SELECT
       /*
        * NOT contact_id IS NOT NULL. That was the old matcher's idea of a
        * usable event and it reported zero against a calendar that had just
        * synced sixty-one of them, because a work account has no contact
        * cards to match against. An event with a guest list is usable.
        */
       (SELECT count(*) FROM events e
         WHERE e.owner_id = $1::uuid
           AND (e.attendees IS NOT NULL OR e.contact_id IS NOT NULL)
           AND e.deleted_at IS NULL AND e.modality = 'actual'
           AND e.starts_at <= now())                                   AS meetings,
       (SELECT count(*) FROM events e
         WHERE e.owner_id = $1::uuid AND e.deleted_at IS NULL)         AS all_events,
       (SELECT min(starts_at) FROM events e
         WHERE e.owner_id = $1::uuid
           AND (e.attendees IS NOT NULL OR e.contact_id IS NOT NULL)
           AND e.deleted_at IS NULL AND e.modality = 'actual')         AS first_meeting,
       (SELECT count(*) FROM email_participants p
          JOIN email_messages m
            ON m.owner_id = p.owner_id AND m.message_id = p.message_id
         WHERE p.owner_id = $1::uuid AND p.role IN ('from','to'))      AS mail,
       (SELECT min(occurred_at) FROM email_messages m
         WHERE m.owner_id = $1::uuid)                                  AS first_mail,
       (SELECT count(*) FROM contacts c
         WHERE c.owner_id = $1::uuid AND c.deleted_at IS NULL)         AS contacts`,
    [amberId],
  );
  const s = supply[0];

  console.log("  What the personal graph holds");
  console.log(`    calendar meetings   ${n(s.meetings)}${s.first_meeting ? `  (back to ${String(s.first_meeting).slice(0, 10)})` : ""}`);
  // Past meetings with guests versus everything synced. A big gap means the
  // window pulled mostly future, which is what a day-view sync is tuned for.
  console.log(`    events synced       ${n(s.all_events)} total, past and future`);
  console.log(`    email headers       ${n(s.mail)}${s.first_mail ? `  (back to ${String(s.first_mail).slice(0, 10)})` : ""}`);
  console.log(`    contacts            ${n(s.contacts)}`);

  /*
   * DOES THE PROVIDER ACTUALLY SEND NAMES. Google documents displayName on an
   * attendee as optional and populates it only when it happens to know the
   * person, so "we keep the name now" and "we have names" are different
   * claims. Everything downstream -- readable nodes, and the duplicate
   * detection that keys on a name -- rests on the second one, so it gets
   * counted rather than assumed.
   */
  const { rows: named } = await query(
    `SELECT count(*)::int AS guests,
            count(*) FILTER (WHERE btrim(COALESCE(a->>'name','')) <> '')::int AS with_name
       FROM events e, LATERAL jsonb_array_elements(e.attendees) AS a
      WHERE e.owner_id = $1::uuid AND e.attendees IS NOT NULL AND e.deleted_at IS NULL`,
    [amberId],
  );
  const g = named[0] ?? { guests: 0, with_name: 0 };
  console.log(`    guest entries       ${n(g.guests)}, of which ${n(g.with_name)} carry a name`);

  if (Number(g.guests) > 0 && Number(g.with_name) === 0) {
    console.log("      (the provider sent none — nodes stay named after their address)");
  }

  if (Number(s.meetings) === 0 && Number(s.mail) === 0 && !dupes && !doMerge) {
    console.log(
      accounts.length === 0
        ? "\n  Nothing to bridge. Connect a calendar in the org console, then re-run with --sync --run.\n"
        : "\n  A calendar is connected but no past meetings came back. Re-run with --sync, and check\n" +
          "  that the connected account is the one with the meetings on it.\n",
    );
    return;
  }

  // ---------------------------------------------------------------- ledger
  await withTenant(orgId, async () => {
    const { rows: grants } = await query(
      `SELECT source, granted_at, last_sync_at, last_error
         FROM org_memory_sources
        WHERE org_id = $1::uuid AND amber_id = $2::uuid AND revoked_at IS NULL
        ORDER BY source`,
      [orgId, amberId],
    );

    console.log("\n  Granted sources");
    if (grants.length === 0) console.log("    none");
    for (const g of grants) {
      const when = g.last_sync_at ? `last run ${String(g.last_sync_at).slice(0, 16)}` : "never run";
      console.log(`    ${g.source.padEnd(12)} ${when}${g.last_error ? `  ERROR: ${g.last_error}` : ""}`);
    }

    /*
     * DUPLICATES, which is the question the first real backfill raised: one
     * person arrived as three nodes and no amount of care at write time
     * could have joined them.
     */
    if (dupes || doMerge) {
      const groups = await suggestMerges({ orgId });
      if (groups.length === 0) {
        console.log("\n  No duplicate candidates.\n");
      }
      for (const group of groups) {
        const keep = group.people.find((p) => p.id === group.suggestedKeepId);
        console.log(`\n  ${group.n} nodes look like one person  (matched on ${group.signal})`);
        for (const p of group.people) {
          const mark = p.id === group.suggestedKeepId ? "keep" : "  ->";
          console.log(
            `    ${mark} ${String(p.display_name).slice(0, 36).padEnd(38)}` +
            `${String(p.interactions).padStart(4)} touches   ${(p.emails ?? []).join(", ")}`,
          );
        }
        if (doMerge) {
          const result = await mergePeople({
            orgId,
            keepId: group.suggestedKeepId,
            mergeIds: group.people.map((p) => p.id).filter((id) => id !== group.suggestedKeepId),
            byAmberId: amberId,
          });
          console.log(result.ok
            ? `    merged ${result.merged} into ${keep?.display_name ?? "the survivor"}`
            : `    NOT merged: ${result.reason}`);
        }
      }
      if (!doMerge && groups.length > 0) {
        console.log("\n  Add --merge to join each group into its 'keep' row.\n");
      }
    }

    const { rows: have } = await query(
      `SELECT
         (SELECT count(*) FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL)   AS people,
         (SELECT count(*) FROM org_accounts WHERE org_id = $1::uuid AND deleted_at IS NULL) AS accounts,
         (SELECT count(*) FROM org_interactions WHERE org_id = $1::uuid)                    AS interactions,
         (SELECT count(*) FROM org_person_edges WHERE org_id = $1::uuid)                    AS edges`,
      [orgId],
    );
    const h = have[0];
    console.log("\n  Already in the company ledger");
    console.log(`    people ${n(h.people)}   accounts ${n(h.accounts)}   interactions ${n(h.interactions)}   edges ${n(h.edges)}`);

    if (!run) {
      if (!dupes && !doMerge) {
        console.log("\n  Dry run. Add --run to grant calendar and mail and replay them.\n");
      }
      return;
    }

    // ------------------------------------------------------------- the run
    for (const source of ["calendar", "mail"]) {
      await grantSource({ orgId, amberId, source });
    }

    console.log("\n  Bridging...");
    const started = Date.now();
    const out = await bridgeMember({ orgId, amberId, since: since || null, limit });

    for (const r of out.runs) {
      if (r.error) {
        console.log(`    ${r.source.padEnd(10)} FAILED  ${r.error}`);
        continue;
      }
      console.log(
        `    ${r.source.padEnd(10)} read ${n(r.read)}  written ${n(r.written)}` +
          `  already had ${n(r.duplicate)}  unusable ${n(r.skipped)}`,
      );
    }

    const { rows: after } = await query(
      `SELECT
         (SELECT count(*) FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL)   AS people,
         (SELECT count(*) FROM org_accounts WHERE org_id = $1::uuid AND deleted_at IS NULL) AS accounts,
         (SELECT count(*) FROM org_interactions WHERE org_id = $1::uuid)                    AS interactions,
         (SELECT count(*) FROM org_person_edges WHERE org_id = $1::uuid)                    AS edges`,
      [orgId],
    );
    const a = after[0];
    console.log(`\n  Now: people ${n(a.people)}   accounts ${n(a.accounts)}   interactions ${n(a.interactions)}   edges ${n(a.edges)}`);
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

    /*
     * The three rows worth eyeballing before trusting any of it. A name you
     * recognize with a count that matches your memory is the whole
     * verification; a graph full of plausible strangers is not.
     */
    const { rows: top } = await query(
      `SELECT p.display_name, a.name AS account, e.interactions, e.strength,
              to_char(e.last_at, 'YYYY-MM-DD') AS last_at
         FROM org_person_edges e
         JOIN org_people p ON p.org_id = e.org_id AND p.id = e.person_id
         LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
        WHERE e.org_id = $1::uuid AND e.member_id = $2::uuid
        ORDER BY e.strength DESC
        LIMIT 8`,
      [orgId, amberId],
    );
    if (top.length > 0) {
      console.log("  Strongest relationships");
      for (const t of top) {
        console.log(
          `    ${String(t.display_name).slice(0, 34).padEnd(36)}` +
            `${String(t.account ?? "").slice(0, 22).padEnd(24)}` +
            `${String(t.interactions).padStart(5)} touches   last ${t.last_at}`,
        );
      }
      console.log("");
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
