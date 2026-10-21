#!/usr/bin/env node
/**
 * WHY DID CONNECTING A CALENDAR NOT WORK.
 *
 *   railway run node scripts/diagnose-calendar.js --email sagar@amberintelligence.ai
 *
 * "It just didn't work" is the most expensive sentence in this product right
 * now, and it is expensive because the calendar path is EIGHT LINKS LONG and
 * every one of them fails quietly:
 *
 *   1. the OAuth client is configured on this deployment
 *   2. the person has an account, and it is the WORK one
 *   3. that account is in a workspace
 *   4. a calendar_accounts row exists for it
 *   5. that row has a refresh token and is not disabled
 *   6. events came back from the sync
 *   7. those events carry other people as attendees
 *   8. the bridge turned those attendees into org_people and edges
 *
 * Break link 4 and the screen says "connect your calendar" forever to
 * somebody who just connected it. Break link 7 and the sync reports success
 * with zero people, which reads as the product not working rather than as a
 * calendar with no shared meetings in it. Break link 2 -- which is the one I
 * would bet on, because personal and work are deliberately separate accounts
 * -- and the calendar is connected to the OTHER account, perfectly, where
 * this workspace will never see it.
 *
 * None of those produce an error anybody sees. So this walks the chain in
 * order and stops at the first break, with the fix attached.
 */

import { query, closePool } from "../src/db/sql.js";
import { configCheck } from "../src/oauth/lib/env-check.js";
import { asOperator, operatorWorks } from "./_operator.js";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const email = (arg("email") || "").trim().toLowerCase();

let broke = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  broke = true;
  console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
  if (fix) console.log(`      → ${fix}`);
};
const note = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

async function main() {
  console.log("\n\x1b[1mCalendar connection, link by link\x1b[0m\n");

  /*
   * CAN THIS SCRIPT SEE ANYTHING? Asked first, because without the operator
   * policy the membership and workspace reads below return nothing and the
   * script confidently reports "none of those accounts is in a workspace"
   * about somebody who is in one.
   */
  if (!(await operatorWorks())) {
    bad(
      "this script cannot read across workspaces",
      "migration 092 has not been applied — every membership below would read as zero. Run: npm run migrate",
    );
    return;
  }

  /* ----------------------------------------------------------------- 1 */
  const google = configCheck("google");
  if (google.configured) ok("the Google OAuth client is configured on this deployment");
  else {
    bad(
      `Google OAuth is not configured: ${google.missing_config.join(", ")} missing`,
      "nobody can start a calendar connection at all until these are set on this service",
    );
    return;
  }

  if (!email) {
    note("no --email given, so the per-person links are skipped");
    return;
  }

  /* ----------------------------------------------------------------- 2 */
  /*
   * EVERY ACCOUNT WITH THIS ADDRESS, not one. Personal and work are separate
   * amber_ids on purpose, and the whole failure mode this script exists for
   * is a calendar landing on the wrong one. Showing both is the answer.
   */
  const { rows: accounts } = await asOperator((c) => c.query(
    `SELECT u.amber_id, u.full_name, u.workspace_kind, u.created_at,
            (SELECT count(*)::int FROM org_members m
              WHERE m.amber_id = u.amber_id AND m.deleted_at IS NULL) AS memberships
       FROM users u
       JOIN user_identities ui
         ON ui.amber_id = u.amber_id AND ui.provider = 'email' AND ui.deleted_at IS NULL
      WHERE lower(ui.subject) = $1 AND u.deleted_at IS NULL
      ORDER BY u.created_at`,
    [email],
  ));

  if (accounts.length === 0) {
    bad(`no account signs in with ${email}`, "they have not signed up, or they used a different address");
    return;
  }

  ok(`${accounts.length} account(s) use ${email}`);
  for (const a of accounts) {
    console.log(
      `      ${a.workspace_kind ?? "personal"}  ${a.amber_id}  ${a.memberships} membership(s)  ${a.full_name ?? "(no name)"}`,
    );
  }

  const work = accounts.filter((a) => a.memberships > 0);
  if (work.length === 0) {
    bad(
      "none of those accounts is in a workspace",
      "they signed in to the personal product, or their invitation was never accepted",
    );
    return;
  }
  if (accounts.length > 1) {
    note(
      "more than one account shares this address — personal and work are separate by design, " +
        "and a calendar connected while signed into the wrong one is invisible here",
    );
  }

  /* --------------------------------------------------------------- 3-8 */
  for (const who of work) {
    const { rows: orgRows } = await asOperator((c) => c.query(
      `SELECT o.id, o.name FROM org_members m
         JOIN organizations o ON o.id = m.org_id
        WHERE m.amber_id = $1::uuid AND m.deleted_at IS NULL LIMIT 1`,
      [who.amber_id],
    ));
    const org = orgRows[0];
    console.log(`\n  \x1b[1m${who.full_name ?? email} in ${org?.name ?? "(no workspace)"}\x1b[0m`);

    /* ------------------------------------------------------------- 4 */
    const { rows: cals } = await query(
      `SELECT id, provider, account_email, connected_at, synced_at, disabled_at, last_error,
              (refresh_token IS NOT NULL) AS has_refresh, scopes
         FROM calendar_accounts WHERE owner_id = $1::uuid ORDER BY connected_at`,
      [who.amber_id],
    );

    if (cals.length === 0) {
      /*
       * THE MOST LIKELY BREAK, and the most confusing one on screen. The
       * OAuth callback writes this row ONLY when the calendar scope family
       * came back in the grant. Connect with the wrong purpose, or approve
       * the account-picker without ticking calendar, and the connection
       * genuinely succeeded -- tokens are stored -- while the one table the
       * product reads stays empty. The screen then says "connect your
       * calendar" to somebody who just did.
       */
      bad(
        "no calendar is connected to this account",
        "if they just pressed Connect and came back: the grant did not include the calendar scope, " +
          "or they picked a different Google account at the chooser. Check whether a calendar is " +
          "connected on their OTHER amber_id above.",
      );
      continue;
    }
    ok(`${cals.length} calendar account(s) connected`);

    for (const c of cals) {
      const label = `${c.provider}:${c.account_email}`;

      /* ----------------------------------------------------------- 5 */
      if (c.disabled_at) {
        bad(`${label} is disabled`, c.last_error ?? "re-connect it");
        continue;
      }
      if (!c.has_refresh) {
        bad(
          `${label} has no refresh token`,
          "Google only issues one on FIRST consent — disconnect it and reconnect to get a new one",
        );
        continue;
      }
      if (c.last_error) note(`${label} last reported: ${c.last_error}`);
      if (!c.synced_at) {
        bad(`${label} has never synced`, "press the sync button, or run scripts/org-memory-bridge.js --sync --run");
        continue;
      }
      ok(`${label} synced ${new Date(c.synced_at).toISOString().slice(0, 16).replace("T", " ")}`);

      /* ----------------------------------------------------------- 6 */
      const { rows: ev } = await query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE jsonb_array_length(COALESCE(attendees, '[]'::jsonb)) > 1) AS shared,
                min(starts_at) AS earliest, max(starts_at) AS latest
           FROM events WHERE calendar_account_id = $1::uuid`,
        [c.id],
      ).catch(() => ({ rows: [{ n: 0, shared: 0 }] }));

      if (ev[0].n === 0) {
        bad(
          `${label} brought back no events`,
          "an empty calendar, or the sync window missed them — the backfill asks for 1095 days",
        );
        continue;
      }
      ok(`${ev[0].n} events, ${ev[0].shared} of them with other people on`);

      /* ----------------------------------------------------------- 7 */
      if (Number(ev[0].shared) === 0) {
        /*
         * THE SILENT ONE. A sync that worked perfectly and produced nothing,
         * because a graph is built from WHO WAS IN THE ROOM and a calendar of
         * solo blocks has nobody in it. This reads on screen as the product
         * being broken; it is the calendar being personal.
         */
        bad(
          "none of those events has another attendee",
          "a relationship graph is built from who was in the room — a calendar of solo blocks " +
            "and reminders produces nothing, correctly. Check a calendar with real meetings on it.",
        );
        continue;
      }
    }

    if (!org) continue;

    /* --------------------------------------------------------------- 8 */
    const { rows: grant } = await query(
      `SELECT count(*)::int AS n FROM org_memory_sources
        WHERE org_id = $1::uuid AND amber_id = $2::uuid AND source = 'calendar' AND revoked_at IS NULL`,
      [org.id, who.amber_id],
    );
    if (grant[0].n === 0) {
      bad(
        "no live calendar grant in this workspace",
        "the grant is what the bridge writes against; POST /v1/org/memory/sync creates it",
      );
    } else {
      ok("calendar consent is on record for this workspace");
    }

    const { rows: built } = await query(
      `SELECT
         (SELECT count(*)::int FROM org_people
           WHERE org_id = $1::uuid AND deleted_at IS NULL AND merged_into IS NULL)   AS people,
         (SELECT count(*)::int FROM org_person_edges
           WHERE org_id = $1::uuid AND member_id = $2::uuid)                          AS mine,
         (SELECT count(*)::int FROM org_interactions
           WHERE org_id = $1::uuid AND member_id = $2::uuid AND source = 'calendar')  AS rows_from_calendar`,
      [org.id, who.amber_id],
    );
    const b = built[0];

    if (b.rows_from_calendar === 0) {
      bad(
        "no interaction in this workspace came from their calendar",
        "the bridge has not run for them, or it ran before the grant existed: " +
          "railway run node scripts/org-memory-bridge.js --sync --run --past-days 1095",
      );
    } else {
      ok(`${b.rows_from_calendar} interactions, ${b.mine} relationships of theirs, ${b.people} people in the workspace`);
    }
  }

  console.log("");
  if (!broke) {
    console.log("\x1b[32mEvery link is intact. If a screen still looks empty, the problem is in the screen.\x1b[0m\n");
  } else {
    console.log("\x1b[33mThe first ✗ above is where it stops. Everything below it is a consequence.\x1b[0m\n");
  }
}

main()
  .catch((err) => {
    console.error("\n", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
