#!/usr/bin/env node
/**
 * IS IT SAFE TO INVITE PEOPLE YET.
 *
 *   railway run node scripts/preflight.js
 *   railway run node scripts/preflight.js --fix
 *
 * One command, one answer. Everything below is something that is silently
 * fine in a one-person workspace and loudly wrong the day a second person
 * signs in, which is exactly the class of problem nobody finds by clicking
 * around their own account.
 *
 * THE ONE THAT MATTERS MOST, and the reason this file exists: row-level
 * security policies are created by each migration, but FORCE ROW LEVEL
 * SECURITY is applied by amber_tenant_enforce(), which has to be RE-RUN
 * after new tables appear. Until it is, the policies are present, the tests
 * pass, every screen looks right -- and the application, which connects as
 * the table owner, bypasses all of them. Ten tables have been added since it
 * last ran. A table with a policy that is not forced is not protected, and
 * nothing in the product can tell you that from the outside.
 *
 * --fix runs the enforcement. Everything else only reports.
 */

import { query, closePool } from "../src/db/sql.js";
import { sendingDomain } from "../src/lib/email-delivery.js";
import { operatorWorks } from "./_operator.js";
import { withTenant } from "../src/db/tenant.js";

const fix = process.argv.includes("--fix");

/**
 * The workspace to inspect, resolved the only way that works once row
 * security is enforced.
 *
 * THE TRAP THIS EXISTS TO AVOID, and it caught this script on its first run:
 * after --fix turned enforcement on, every data check returned zero and the
 * script reported "0 workspaces, 0 members, 0 people" as though the database
 * had emptied. Nothing had happened to the data. The script reads without a
 * tenant set, so every policy correctly denied every row.
 *
 * A check that cannot see anything must say so. Reporting zero problems
 * because of zero visibility is the most dangerous output a preflight can
 * produce: it is indistinguishable from success and it is the opposite.
 */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  const next = process.argv[i + 1];
  return i >= 0 && next && !next.startsWith("--") ? next : null;
}

async function orgFor(email) {
  if (!email) return { why: "no --email given" };

  const { rows: found } = await query(
    `SELECT u.amber_id, u.full_name FROM users u
       JOIN user_identities i
         ON i.amber_id = u.amber_id AND i.provider = 'email' AND i.deleted_at IS NULL
      WHERE u.deleted_at IS NULL AND lower(i.subject) = lower($1)
      LIMIT 1`,
    [email],
  );
  if (found.length === 0) {
    /*
     * THREE CAUSES, THREE MESSAGES. The first version of this returned null
     * for "no address given", "no account with that address" and "that
     * account is in no workspace" alike, and printed the same line for all
     * three -- so a correct --email produced advice to pass --email. One
     * message for several causes is how a diagnostic sends somebody to fix
     * the wrong thing.
     */
    return { why: `no account has the address ${email}` };
  }

  // users and user_identities carry no policy; org_members does. The
  // bootstrap is the sanctioned read across that boundary and is already
  // what the API's own sign-in uses.
  const { rows } = await query(
    `SELECT org_id, org_name, status FROM amber_membership_bootstrap($1::uuid)`,
    [found[0].amber_id],
  );
  if (rows.length === 0) {
    return { why: `${found[0].full_name ?? email} has an account but is not in a workspace` };
  }
  if (rows[0].status !== "active") {
    return { why: `${found[0].full_name ?? email} is ${rows[0].status} in ${rows[0].org_name}` };
  }
  return rows[0];
}

let problems = 0;
let warnings = 0;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, how) => {
  problems += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (how) console.log(`      → ${how}`);
};
const warn = (m, how) => {
  warnings += 1;
  console.log(`  \x1b[33m!\x1b[0m ${m}`);
  if (how) console.log(`      → ${how}`);
};

async function tenantIsolation() {
  console.log("\nTenant isolation");

  const { rows } = await query(
    `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'amber_tenant'
      ORDER BY c.relname`,
  );

  const unforced = rows.filter((r) => !r.forced);
  const off = rows.filter((r) => !r.enabled);

  if (rows.length === 0) {
    bad("no table carries the amber_tenant policy", "migration 070 has not been applied");
    return;
  }

  if (off.length > 0) {
    bad(
      `${off.length} table(s) have the policy but row security OFF: ${off.map((r) => r.table).join(", ")}`,
      "the migration that created them did not ENABLE ROW LEVEL SECURITY",
    );
  }

  if (unforced.length === 0) {
    ok(`${rows.length} tables isolated and forced`);
    return;
  }

  /*
   * THE FAILURE THIS CATCHES. A policy without FORCE is bypassed by the
   * table's owner, and the application connects as the owner. So the
   * isolation reads as present in every migration, passes every structural
   * test, and does nothing at all.
   */
  bad(
    `${unforced.length} of ${rows.length} tables have a policy that is NOT forced`,
    `the owner bypasses them: ${unforced.map((r) => r.table).join(", ")}`,
  );

  if (!fix) {
    console.log("      → re-run with --fix, or: SELECT amber_tenant_enforce();");
    return;
  }

  const { rows: done } = await query("SELECT amber_tenant_enforce() AS result");
  console.log(`      → ${done[0].result}`);
  problems -= 1;
  ok("fixed");
}

async function crossTenantLeaks(org) {
  const orgId = org?.org_id ?? null;
  console.log("\nCross-company data");

  if (!orgId) {
    warn(`skipped: ${org?.why ?? "no workspace"}`, "these checks must read inside a tenant");
    return;
  }

  /*
   * A row whose org_id does not match the org of the thing it hangs off is
   * invisible to RLS -- the policy compares the row's own org_id and finds
   * it consistent. Only a join across the pair can see it, which is what
   * this is.
   */
  const checks = [
    ["people filed under another company's account", `
      SELECT count(*)::int AS n FROM org_people p
        JOIN org_accounts a ON a.id = p.account_id
       WHERE a.org_id <> p.org_id`],
    ["interactions against another company's person", `
      SELECT count(*)::int AS n FROM org_interactions i
        JOIN org_people p ON p.id = i.person_id
       WHERE p.org_id <> i.org_id`],
    ["edges against another company's person", `
      SELECT count(*)::int AS n FROM org_person_edges e
        JOIN org_people p ON p.id = e.person_id
       WHERE p.org_id <> e.org_id`],
    ["merges pointing into another company", `
      SELECT count(*)::int AS n FROM org_people a
        JOIN org_people b ON b.id = a.merged_into
       WHERE a.org_id <> b.org_id`],
  ];

  /*
   * PEOPLE WITH NO IDENTITY, which is a different kind of wrong and worth
   * its own sentence.
   *
   * resolvePerson used to look for an existing identity and, finding none,
   * create a person -- so two producers looking at the same instant both
   * created one, the unique index correctly refused the loser's identity
   * row, and the loser's PERSON row stayed. Nothing points at it. No lookup
   * finds it, no merge suggestion reaches it, and it sits in the roster
   * forever as a name with an empty history.
   *
   * The code is fixed; this is for rows written before it was. They are
   * safe to delete only if nothing references them, which is why this
   * reports rather than fixes.
   */
  const { rows: orphans } = await query(
    `SELECT count(*)::int AS n FROM org_people p
      WHERE p.deleted_at IS NULL AND p.merged_into IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM org_person_identities d
           WHERE d.org_id = p.org_id AND d.person_id = p.id
        )`,
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (orphans[0].n > 0) {
    const { rows: withRows } = await query(
      `SELECT count(*)::int AS n FROM org_people p
        WHERE p.deleted_at IS NULL AND p.merged_into IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM org_person_identities d
             WHERE d.org_id = p.org_id AND d.person_id = p.id
          )
          AND EXISTS (
            SELECT 1 FROM org_interactions i
             WHERE i.org_id = p.org_id AND i.person_id = p.id
          )`,
    ).catch(() => ({ rows: [{ n: 0 }] }));
    warn(
      `${orphans[0].n} person row(s) have no identity, ${withRows[0].n} of them carrying interactions`,
      withRows[0].n === 0
        ? "left by a resolution race that has since been fixed; nothing references them, so they can be deleted"
        : "these hold history and cannot simply be deleted — merge them into the right person first",
    );
  }

  /*
   * HONEST ABOUT ITS OWN BLIND SPOT. Inside a tenant scope this sees one
   * company's rows, so a child filed under ANOTHER company is invisible to
   * it for the same reason it is invisible to the policy. What it does
   * catch is a parent in this company with a child that is not, which is
   * the direction a missing composite key actually produces.
   */
  let found = false;
  await withTenant(orgId, async () => {
    for (const [what, sql] of checks) {
      const { rows } = await query(sql).catch(() => ({ rows: [{ n: 0 }] }));
      if (rows[0].n > 0) {
        bad(`${rows[0].n} ${what}`, "a composite foreign key is missing somewhere");
        found = true;
      }
    }
  });
  if (!found) ok("within this workspace, no row belongs to another company");
}

async function privacy(org) {
  const orgId = org?.org_id ?? null;
  console.log("\nPrivacy defaults");

  if (!orgId) {
    warn(`skipped: ${org?.why ?? "no workspace"}`);
    return;
  }

  const { rows } = await withTenant(orgId, () => query(
    `SELECT
       (SELECT count(*)::int FROM org_interactions WHERE visibility = 'org')     AS public_rows,
       (SELECT count(*)::int FROM org_interactions)                              AS all_rows,
       (SELECT count(*)::int FROM org_interactions WHERE member_id IS NULL)      AS unowned,
       (SELECT count(*)::int FROM org_interaction_shares)                        AS shares`,
  ));
  const r = rows[0];

  if (r.all_rows === 0) {
    warn("the ledger is empty", "nothing to check yet");
    return;
  }

  /*
   * An interaction with no member is readable by nobody through the normal
   * path and by everybody if somebody later writes a query that forgets the
   * predicate. Producers always attribute; a run of these means one did not.
   */
  if (r.unowned > 0) {
    warn(`${r.unowned} interactions have no member`, "a producer wrote without attributing");
  }

  const pct = Math.round((r.public_rows / r.all_rows) * 100);
  if (pct > 50) {
    bad(
      `${pct}% of the ledger is company-visible`,
      "private is the default; this suggests a producer is passing visibility: 'org'",
    );
  } else {
    ok(`${r.all_rows} interactions, ${r.public_rows} published deliberately, ${r.shares} shared per-item`);
  }
}

async function deliverability() {
  console.log("\nInvitations");

  const web = process.env.AMBER_WEB_URL ?? process.env.MEDHA_FRONTEND_URL ?? null;
  const api = process.env.AMBER_API_BASE_URL ?? process.env.MEDHA_ID_PUBLIC_URL ?? null;
  const resend = process.env.RESEND_API_KEY ?? null;
  const from = process.env.EMAIL_FROM ?? null;

  if (!api) bad("AMBER_API_BASE_URL is not set", "OAuth callbacks will be built wrong");
  else ok(`API base ${api}`);

  if (!web) bad("AMBER_WEB_URL is not set", "invite links will point nowhere");
  else ok(`Invite links point at ${web}`);

  /*
   * DOMAIN CONSISTENCY, which is a deliverability question rather than an
   * aesthetic one. An invitation sent from a domain the mail provider has
   * not verified is rejected outright, and the symptom is somebody saying
   * they never got the email.
   */
  if (web && from) {
    const webHost = String(web).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const fromHost = String(from).split("@").pop()?.replace(/>$/, "").trim();
    if (fromHost && webHost && fromHost !== webHost) {
      warn(
        `invites are sent from ${fromHost} but link to ${webHost}`,
        "different domains in one email is what a spam filter is built to notice",
      );
    } else {
      ok(`sending and linking both use ${webHost}`);
    }
  }

  if (!resend) {
    bad("no mail key", "invitations cannot be sent at all");
    return;
  }

  /*
   * ASK RESEND, rather than telling somebody to go and find out.
   *
   * This used to say "whether the sending domain is VERIFIED is not knowable
   * from here" and advise inviting yourself at an outside address. It IS
   * knowable -- Resend has an endpoint that lists every domain and its
   * status -- and the cost of not asking is an invitation that is created,
   * reported as sent, and never arrives. Nobody debugs that from the
   * recipient's end.
   */
  const want = sendingDomain();
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${resend}` },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 || res.status === 403) {
      /*
       * A SENDING-ONLY KEY IS THE CORRECT KEY, AND IT CANNOT READ THIS.
       *
       * Resend scopes its keys. `Sending access` can send mail and nothing
       * else; listing domains needs full access. So the key that is right
       * for production -- the narrow one -- is exactly the key that gets a
       * 403 here.
       *
       * The first version of this check read that 403 as "the key is wrong
       * or revoked" and told somebody to replace a working key. That is
       * worse than not checking: it is a diagnostic sending you to break
       * something that was fine, and it is the second time in this file that
       * a check reported its own lack of access as the system being broken.
       *
       * So a refusal here is reported as what it is -- unknown, for a good
       * reason -- and the one thing that IS knowable is said instead.
       */
      warn(
        "this key has Sending access only, so the domain's status cannot be read from here",
        "that is the right key for production. Check resend.com/domains in a browser, or run " +
          "this once with a full-access key. A key that was actually revoked fails the send itself, " +
          "which the invite screen reports per invitation.",
      );
      return;
    }
    if (!res.ok) {
      warn(`Resend answered ${res.status}`, "could not check the domain; try again in a moment");
      return;
    }

    const body = await res.json();
    const domains = Array.isArray(body?.data) ? body.data : [];
    const mine = domains.find((d) => String(d?.name ?? "").toLowerCase() === want);

    /*
     * WHOSE DOMAIN THIS IS, said in the message, because the question comes
     * up and the answer is not obvious from the word "domain".
     *
     * This is AMBER'S OWN sending domain -- the address invitations are sent
     * FROM -- configured once, by us, for every customer. A company signing
     * up here never touches DNS: their invitations also arrive from
     * amberintelligence.ai. The only reason a customer would add records is
     * to make invitations appear to come from their own domain instead,
     * which is a white-labeling feature nobody has asked for.
     *
     * Without that sentence the failure reads as "every customer has to set
     * up DNS before they can invite anybody", which would be a product that
     * nobody could onboard.
     */
    if (!mine) {
      bad(
        `${want} is not added to this Resend account`,
        `invitations will be refused. This is Amber's OWN sending domain, set up once for every ` +
          `customer — not something a company signing up ever does. Add it at resend.com/domains, ` +
          `or point EMAIL_FROM at one that is already there: ${
            domains.map((d) => d.name).join(", ") || "none added"
          }`,
      );
    } else if (String(mine.status).toLowerCase() === "verified") {
      ok(`${want} is verified with Resend — invitations will actually arrive`);
    } else {
      bad(
        `${want} is added but ${mine.status}`,
        "the DNS records are not in place yet, so every invitation is refused with a 403. " +
          "resend.com/domains lists the exact records — they go on amberintelligence.ai, " +
          "once, and no customer ever adds any of their own",
      );
    }
  } catch (err) {
    warn(
      `could not reach Resend (${String(err?.message ?? err).slice(0, 60)})`,
      "the domain's status is unknown; invite yourself at an outside address before trusting it",
    );
  }
}

async function askBar() {
  console.log("\nAsk bar");

  /*
   * A MISSING KEY MAKES THE BAR VANISH, which is the worst way for a
   * feature to be off: the screen looks finished, nothing errors, and the
   * one control that makes the graph useful is simply not there. Somebody
   * reports "the search bar is gone" and there is nothing in any log.
   */
  if (!process.env.ANTHROPIC_API_KEY) {
    bad(
      "ANTHROPIC_API_KEY is not set, so the ask bar does not render at all",
      "railway variables --set ANTHROPIC_API_KEY=sk-ant-...",
    );
  } else {
    ok("the ask bar can synthesize answers");
  }
}

async function readiness(org) {
  const orgId = org?.org_id ?? null;
  console.log("\nWorkspace");

  if (!orgId) {
    warn(`skipped: ${org?.why ?? "no workspace"}`);
    return;
  }

  const { rows } = await withTenant(orgId, () => query(
    `SELECT
       (SELECT count(*)::int FROM organizations)                                  AS orgs,
       (SELECT count(*)::int FROM org_members WHERE deleted_at IS NULL)           AS members,
       (SELECT count(*)::int FROM org_people
         WHERE deleted_at IS NULL AND merged_into IS NULL)                        AS people,
       (SELECT count(*)::int FROM org_accounts WHERE deleted_at IS NULL)          AS accounts,
       /*
        * THE SAME POPULATION AS THE COUNT ABOVE. It used to count every row
        * including the ones merged away, so a workspace with 14 people
        * reported 18 of them unnamed -- a report that contradicts itself in
        * two adjacent lines, which is how somebody learns to skim past it.
        */
       (SELECT count(*)::int FROM org_people
         WHERE display_name LIKE '%@%'
           AND deleted_at IS NULL AND merged_into IS NULL)                      AS unnamed`,
  ));
  const r = rows[0];
  ok(`${r.orgs} workspace(s), ${r.members} member(s), ${r.people} people, ${r.accounts} firms`);

  if (r.unnamed > 0) {
    warn(
      `${r.unnamed} people are still named after an email address`,
      "the provider sent no display name; rename the ones that matter on their node",
    );
  }

  const { rows: policy } = await withTenant(orgId, () =>
    query(`SELECT org_id, allow_external, require_gate, retention_months FROM org_memory_policy`),
  );
  for (const p of policy) {
    if (p.allow_external) {
      warn("a workspace allows person-level data to leave through a key", "check that this is intended");
    }
    if (!p.require_gate) {
      warn("a workspace has the agent gate off", "agent writes with no human principal will be accepted");
    }
  }
  if (policy.length > 0) ok(`${policy.length} workspace policy row(s) in force`);
}

async function main() {
  console.log("\n\x1b[1mAmber preflight\x1b[0m");

  /*
   * EVERY COUNT BELOW IS A LIE WITHOUT THIS.
   *
   * preflight reads organizations, org_members and org_people with no tenant
   * set, which once isolation was enforced returns nothing. It then reported
   * "0 workspaces, 0 members, 0 people" over a populated database -- and
   * that was read, reasonably, as data loss.
   */
  if (!(await operatorWorks())) {
    bad(
      "this check cannot read across workspaces",
      "migration 092 is not applied — every count below would be zero whatever is in the database. Run: npm run migrate",
    );
    console.log("");
    process.exitCode = 1;
    return;
  }

  const org = await orgFor(arg("email"));
  if (org?.org_id) console.log(`  workspace: ${org.org_name}`);

  await tenantIsolation();
  await crossTenantLeaks(org);
  await privacy(org);
  await deliverability();
  await askBar();
  await readiness(org);

  console.log("");
  if (problems > 0) {
    console.log(`\x1b[31m${problems} thing(s) to fix before inviting anybody.\x1b[0m`);
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(`\x1b[33mNothing blocking. ${warnings} thing(s) worth a look.\x1b[0m`);
    if (!arg("email")) {
      console.log("\x1b[33mMost data checks were skipped. Add --email you@company.com.\x1b[0m");
    }
  } else {
    console.log("\x1b[32mReady.\x1b[0m");
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
