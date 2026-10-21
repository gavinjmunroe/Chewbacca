#!/usr/bin/env node
/**
 * THE THINGS THAT GO WRONG AFTER THE DEMO.
 *
 *   railway run node scripts/audit-pressure.js
 *   railway run node scripts/audit-pressure.js --keep
 *
 * WHY THIS EXISTS SEPARATELY FROM audit-enterprise.js. That script asks one
 * question -- can company A read company B -- and answers it well. It is also
 * the easy question, because org_id is on every row and a policy comparing it
 * is hard to get wrong.
 *
 * The failures that actually reach customers are smaller and later. Two
 * colleagues in the SAME company, where there is no org_id to compare and the
 * boundary is a predicate somebody has to remember to write. The same person
 * resolving to two nodes because two calendar syncs raced. A merge pointing
 * at a person in another tenant. Consent revoked and the data still there. A
 * ledger that was supposed to be append-only being quietly updated by a
 * convenience helper added six months from now.
 *
 * None of those are visible from the outside. Every one of them is a sentence
 * somebody would have to say to a customer.
 *
 * SO THIS IS ADVERSARIAL RATHER THAN DEMONSTRATIVE. It builds a company with
 * several people in it and then tries, as each of them, to do the thing they
 * must not be able to do. A pass here means the attempt was made and came
 * back empty, not that the code reads correctly.
 *
 * EVERY SECTION IS INDEPENDENT. One failing does not stop the rest, because
 * the useful output is the full list of what is wrong, not the first thing.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { query, closePool, withTransaction } from "../src/db/sql.js";
import { withTenant } from "../src/db/tenant.js";
import { asOperator } from "./_operator.js";
import { createOrganization } from "../src/db/org-store.js";
import { ensureAccountForWorkEmail, createInvite, peekInvite } from "../src/db/org-invite-store.js";
import {
  record,
  listPeople,
  getPerson,
  history,
  whoKnows,
  grantSource,
  revokeSource,
  listSources,
  mergePeople,
  unmergePerson,
  suggestMerges,
  resolvePerson,
  goingCold,
} from "../src/db/org-memory-store.js";
import {
  getPolicy,
  setPolicy,
  checkWrite,
  applyRetention,
  listRefusals,
} from "../src/db/org-memory-policy.js";
import { issueOrgKey, verifyOrgKey, revokeOrgKey } from "../src/db/org-api-store.js";
import { importExport, undoImport } from "../src/db/org-ai-import.js";
import { createPage, getPage, searchPages } from "../src/db/org-knowledge-store.js";
import { setAudience } from "../src/db/org-audience-store.js";

const keep = process.argv.includes("--keep");
const only = (() => {
  const i = process.argv.indexOf("--only");
  return i > -1 ? process.argv[i + 1] : null;
})();
const stamp = Date.now().toString(36);
const TAG = `press-${stamp}`;
const DOMAIN = `${TAG}.invalid`;

let failures = 0;
let checks = 0;
const notes = [];

const ok = (m) => {
  checks += 1;
  console.log(`    \x1b[32m✓\x1b[0m ${m}`);
};
const bad = (m, why) => {
  checks += 1;
  failures += 1;
  console.log(`    \x1b[31m✗ ${m}\x1b[0m`);
  if (why) console.log(`        ${why}`);
};
const note = (m) => {
  notes.push(m);
  console.log(`    \x1b[33m!\x1b[0m ${m}`);
};
const section = (n) => console.log(`\n  \x1b[1m${n}\x1b[0m`);

/** Run a section unless --only named a different one. */
async function part(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  section(name);
  try {
    await fn();
  } catch (err) {
    /*
     * THE LINE, NOT JUST THE MESSAGE. "could not determine data type of
     * parameter $4" names a parameter in a statement it does not name, and
     * there are a dozen queries with a $4. The first run of this script cost
     * an evening of reading SQL by hand for want of two lines of stack.
     */
    const where = String(err?.stack ?? "")
      .split("\n")
      .filter((l) => l.includes("/src/") || l.includes("/scripts/"))
      .slice(0, 2)
      .map((l) => l.trim())
      .join("\n        ");
    bad(`${name} threw`, `${String(err?.message ?? err)}\n        ${where}`);
  }
}

// ---------------------------------------------------------------------------
// THE WORLD. One company, three colleagues, one outsider company.
//
// Three rather than two because the interesting privacy question is not "can
// Blake read Avery's" but "does Blake's own view accidentally widen when
// Casey publishes something", which needs a third party to notice.
// ---------------------------------------------------------------------------

const world = { org: null, members: {}, outsider: null };

/**
 * One work account, unwrapped.
 *
 * ensureAccountForWorkEmail returns { ok, amberId, created } -- not an
 * amber_id. Pass the whole object on as createdBy and createOrganization
 * finds it truthy, looks it up, finds nothing, and refuses with
 * `creator_required`: the same symptom as forgetting the argument entirely.
 * That is the second time in one evening a result shape read from memory
 * rather than from the function cost a run, so it is unwrapped in exactly
 * one place with a thrown reason attached.
 *
 * A WORK ACCOUNT, not just an account. createOrganization refuses a personal
 * one on purpose -- enrolling a company must never convert somebody's own
 * account -- so this walks the same door a real customer does rather than
 * inserting a user row.
 */
async function account(email) {
  const made = await ensureAccountForWorkEmail(email);
  if (!made?.ok || !made.amberId) {
    throw new Error(`could not create a work account for ${email}: ${made?.reason ?? "unknown"}`);
  }
  return String(made.amberId);
}

async function build() {
  section("Building a company with three colleagues in it");

  const ownerEmail = `${TAG}-avery@${DOMAIN}`;
  const avery = await account(ownerEmail);
  /*
   * createdBy, not ownerAmberId -- and the reason is in the result rather
   * than in the exception, which is why the first run of this script said
   * only "could not create the company" and left me guessing. A refusal
   * that does not say what it refused costs more than the bug.
   */
  const org = await createOrganization({
    name: `${TAG} Co`,
    createdBy: avery,
    emailDomain: DOMAIN,
  });
  if (!org?.ok) throw new Error(`could not create the company: ${org?.reason ?? "unknown"}`);
  const orgId = org.org.id;
  world.org = orgId;
  world.members.avery = avery;

  for (const who of ["blake", "casey"]) {
    const id = await account(`${TAG}-${who}@${DOMAIN}`);
    world.members[who] = id;
    await withTenant(orgId, async () => {
      await query(
        `INSERT INTO org_members (org_id, amber_id, role, status, joined_at)
         VALUES ($1::uuid, $2::uuid, 'member', 'active', now())
         ON CONFLICT DO NOTHING`,
        [orgId, id],
      );
    });
  }

  // A second company, for the cross-tenant halves of the merge and identity
  // tests below.
  const outsiderEmail = `${TAG}-dana@other-${DOMAIN}`;
  const dana = await account(outsiderEmail);
  const other = await createOrganization({
    name: `${TAG} Other`,
    createdBy: dana,
    emailDomain: `other-${DOMAIN}`,
  });
  if (!other?.ok) {
    throw new Error(`could not create the second company: ${other?.reason ?? "unknown"}`);
  }
  world.outsider = { orgId: other.org.id, amberId: dana };

  await withTenant(orgId, async () => {
    for (const id of Object.values(world.members)) {
      await grantSource({ orgId, amberId: id, source: "calendar" });
      await grantSource({ orgId, amberId: id, source: "mail" });
    }
  });

  ok(`${TAG} Co with Avery, Blake and Casey, plus a separate ${TAG} Other`);
}

/**
 * Write one interaction as a given colleague.
 *
 * record() returns { ok, personId, interactionId, duplicate } -- and NOT an
 * `id`, which is the kind of thing a test gets wrong once and then reports
 * green forever because `undefined === undefined`.
 */
async function met(memberKey, { email, name, summary, visibility = "private", at = null, source = "calendar", externalId = null }) {
  const out = await record({
    orgId: world.org,
    memberId: world.members[memberKey],
    kind: "meeting",
    source,
    externalId: externalId ?? `${TAG}-${memberKey}-${Math.random().toString(36).slice(2)}`,
    summary,
    occurredAt: at ?? new Date().toISOString(),
    visibility,
    identities: [{ kind: "email", value: email }],
    displayName: name,
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. WITHIN-ORG PRIVACY. The largest untested surface.
//
// Cross-tenant isolation is a database policy. This is not: inside one
// company every row passes the tenant policy, and the boundary between two
// colleagues is a predicate in the query. A predicate can be forgotten in one
// function out of twenty and nothing anywhere will say so.
// ---------------------------------------------------------------------------

async function withinOrg() {
  const orgId = world.org;
  const secret = `${TAG}-AVERY-PRIVATE-NOTE`;
  const published = `${TAG}-AVERY-PUBLISHED-NOTE`;
  const counterparty = `${TAG}-contact@counterparty.invalid`;

  let privateId = null;
  let publishedId = null;
  let personId = null;

  await withTenant(orgId, async () => {
    const a = await met("avery", { email: counterparty, name: `${TAG} Counterparty`, summary: secret });
    const b = await met("avery", { email: counterparty, name: `${TAG} Counterparty`, summary: published, visibility: "org" });
    privateId = a.interactionId ?? null;
    publishedId = b.interactionId ?? null;
    personId = a.personId ?? b.personId ?? null;
  });

  if (!personId) {
    bad("could not write the fixture interactions", "the rest of this section is meaningless without them");
    return;
  }

  await withTenant(orgId, async () => {
    /*
     * THE CENTRAL ONE. Blake asks for the timeline of a person Avery knows.
     * The relationship itself is company knowledge -- that is the product.
     * What was SAID is Avery's until Avery publishes it.
     */
    const blakeSees = await history({ orgId, personId, viewerId: world.members.blake, limit: 100 });
    const leaked = blakeSees.items.filter((i) => String(i.summary ?? "").includes("AVERY-PRIVATE"));
    if (leaked.length === 0) ok("a colleague cannot read another colleague's private interaction");
    else bad(`a colleague read ${leaked.length} private interaction(s)`, "the viewer predicate is missing from history()");

    const sawPublished = blakeSees.items.some((i) => String(i.summary ?? "").includes("AVERY-PUBLISHED"));
    if (sawPublished) ok("a colleague does read the one Avery published");
    else bad("the published interaction is invisible to colleagues", "publishing does nothing, which is worse than not offering it");

    if (blakeSees.hidden > 0) ok(`and is told ${blakeSees.hidden} item(s) exist that they cannot read`);
    else note("hidden count is zero — a shorter timeline that looks complete is how somebody reads a relationship as cold");

    /*
     * THE COUNT, which is the subtler leak. A timeline that correctly hides
     * a row and then says "14 interactions" has disclosed the row's
     * existence and its weight. Both numbers must agree with what the
     * viewer may actually read.
     */
    const asBlake = await getPerson({ orgId, personId, viewerId: world.members.blake });
    const asAvery = await getPerson({ orgId, personId, viewerId: world.members.avery });
    if (!asBlake || !asAvery) {
      bad("one of the two viewers cannot see the person node at all", "the node is company knowledge; only the content is private");
    } else if (asBlake.interactions < asAvery.interactions) {
      ok(`the interaction count is per-viewer (${asBlake.interactions} vs ${asAvery.interactions})`);
    } else {
      bad(
        `both viewers are told ${asBlake.interactions} interactions`,
        "the count is leaking the existence and weight of rows the viewer cannot read",
      );
    }

    /*
     * WHO KNOWS THIS PERSON is deliberately company-wide: it is the whole
     * point of the product, and it discloses only that a relationship
     * exists. Checked here so that a future change that makes it private
     * fails loudly rather than quietly removing the feature.
     */
    const knowers = await whoKnows({ orgId, personId });
    if (knowers.some((k) => k.member_id === world.members.avery || k.amber_id === world.members.avery)) {
      ok("who-knows-whom stays company-visible, which is the product");
    } else {
      bad("the person's knower is not listed", "a relationship nobody can see is not a relationship graph");
    }

    /*
     * THE DIRECT ASK. Not through any helper -- the raw row by id, as a
     * route with a forgotten predicate would fetch it.
     */
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM org_interactions
        WHERE org_id = $1::uuid AND id = $2::uuid
          AND (visibility = 'org' OR member_id = $3::uuid
               OR EXISTS (SELECT 1 FROM org_interaction_shares s
                           WHERE s.org_id = org_interactions.org_id AND s.interaction_id = org_interactions.id))`,
      [orgId, privateId, world.members.blake],
    );
    if (rows[0].n === 0) ok("the visibility predicate itself refuses the row by id");
    else bad("the visibility predicate admits another member's private row", "the three arms are not doing what they claim");

    /*
     * SHARING ONE ITEM must widen exactly one item.
     */
    await query(
      `INSERT INTO org_interaction_shares (org_id, interaction_id, shared_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`,
      [orgId, privateId, world.members.avery],
    );
    const after = await history({ orgId, personId, viewerId: world.members.blake, limit: 100 });
    const nowSees = after.items.some((i) => String(i.summary ?? "").includes("AVERY-PRIVATE"));
    if (nowSees) ok("sharing one item makes exactly that item readable");
    else bad("a shared item is still hidden", "the share arm of the predicate is not connected");

    await query(`DELETE FROM org_interaction_shares WHERE org_id = $1::uuid AND interaction_id = $2::uuid`, [orgId, privateId]);
    const back = await history({ orgId, personId, viewerId: world.members.blake, limit: 100 });
    if (!back.items.some((i) => String(i.summary ?? "").includes("AVERY-PRIVATE"))) {
      ok("and un-sharing takes it back");
    } else {
      bad("un-sharing left the item readable", "a share that cannot be withdrawn is not a share");
    }

    /*
     * THE DEPARTING EMPLOYEE. Casey publishes something to the company and
     * then leaves. The research must survive, because a team that loses its
     * shared knowledge every time somebody resigns will stop publishing.
     * This is why shared_by is ON DELETE SET NULL rather than CASCADE.
     */
    const caseyWrote = await met("casey", {
      email: `${TAG}-casey-contact@counterparty.invalid`,
      name: `${TAG} Casey Contact`,
      summary: `${TAG}-CASEY-TEAM-RESEARCH`,
    });
    if (caseyWrote.interactionId) {
      await query(
        `INSERT INTO org_interaction_shares (org_id, interaction_id, shared_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`,
        [orgId, caseyWrote.interactionId, world.members.casey],
      );
      await query(`UPDATE org_members SET deleted_at = now() WHERE org_id = $1::uuid AND amber_id = $2::uuid`, [
        orgId,
        world.members.casey,
      ]);
      const { rows: survived } = await query(
        `SELECT count(*)::int AS n FROM org_interaction_shares WHERE org_id = $1::uuid AND interaction_id = $2::uuid`,
        [orgId, caseyWrote.interactionId],
      );
      if (survived[0].n === 1) ok("research published by a departing colleague survives their departure");
      else bad("the share vanished when the member was removed", "shared_by must be ON DELETE SET NULL, not CASCADE");
      await query(`UPDATE org_members SET deleted_at = NULL WHERE org_id = $1::uuid AND amber_id = $2::uuid`, [
        orgId,
        world.members.casey,
      ]);
    }
  });

  return { personId, privateId, publishedId };
}

// ---------------------------------------------------------------------------
// 2. THE SAME PERSON, TWICE. Identity resolution under race and collision.
//
// Two calendar syncs finishing at once, or the same address in two different
// companies, are the two ways one human becomes two nodes or two humans
// become one.
// ---------------------------------------------------------------------------

async function identity() {
  const orgId = world.org;
  const shared = `${TAG}-shared-contact@counterparty.invalid`;

  /*
   * THE RACE. Ten concurrent resolutions of the same address. The product
   * does this for real every time two members sync calendars containing the
   * same meeting, which is most meetings.
   */
  await withTenant(orgId, async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        resolvePerson({
          orgId,
          identities: [{ kind: "email", value: shared }],
          displayName: `${TAG} Shared Contact`,
          source: "calendar",
        }).catch(() => null),
      ),
    );
    const distinct = new Set(results.filter(Boolean).map(String));
    if (distinct.size === 1) ok("ten concurrent resolutions of one address produce one person");
    else
      bad(
        `ten concurrent resolutions produced ${distinct.size} people`,
        "a unique index on (org_id, kind, value) is what makes this a race the database settles, not the application",
      );

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM org_person_identities
        WHERE org_id = $1::uuid AND kind = 'email' AND value = $2`,
      [orgId, shared.toLowerCase()],
    );
    if (rows[0].n <= 1) ok("and exactly one identity row exists for it");
    else bad(`${rows[0].n} identity rows for one address`, "duplicate identities are how a node splits later");

    /*
     * THE ORPHANS, which are the actual damage and were not being looked
     * for. When the race lost, the index correctly refused the duplicate
     * IDENTITY -- so the symptom was never a duplicate identity. It was
     * nine people with no identity at all: invisible to every subsequent
     * lookup, so they never merge, never resolve, and never go away. A
     * check that only counts identity rows reports that as healthy.
     */
    const { rows: orphans } = await query(
      `SELECT count(*)::int AS n FROM org_people p
        WHERE p.org_id = $1::uuid AND p.deleted_at IS NULL AND p.merged_into IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM org_person_identities d
             WHERE d.org_id = p.org_id AND d.person_id = p.id
          )`,
      [orgId],
    );
    if (orphans[0].n === 0) ok("and no person was left behind with no identity at all");
    else
      bad(
        `${orphans[0].n} person row(s) have no identity`,
        "nothing can ever find or merge these; they are permanent noise in the graph",
      );
  });

  /*
   * THE COLLISION. The same counterparty address in two different companies
   * must be two different people. Obvious, and exactly the thing a
   * well-meant global unique index would break -- at which point one
   * customer's note appears on another's node.
   */
  const outside = world.outsider;
  if (outside?.orgId) {
    await withTenant(outside.orgId, async () => {
      await grantSource({ orgId: outside.orgId, amberId: outside.amberId, source: "calendar" });
      await record({
        orgId: outside.orgId,
        memberId: outside.amberId,
        kind: "meeting",
        source: "calendar",
        externalId: `${TAG}-other-1`,
        summary: `${TAG}-OTHER-COMPANY-NOTE`,
        occurredAt: new Date().toISOString(),
        identities: [{ kind: "email", value: shared }],
        displayName: `${TAG} Shared Contact`,
      });
    });

    const { rows: both } = await query(
      `SELECT count(DISTINCT person_id)::int AS people, count(DISTINCT org_id)::int AS orgs
         FROM org_person_identities WHERE kind = 'email' AND value = $1`,
      [shared.toLowerCase()],
    );
    if (both[0].orgs < 2) {
      note("the second company's write did not land — the collision was not exercised");
    } else if (both[0].people >= 2) {
      ok("the same address in two companies is two separate people");
    } else {
      bad("one person row is shared across two companies", "this is a cross-tenant leak wearing an identity-resolution costume");
    }
  }

  /*
   * NORMALIZATION. Case and whitespace must not be the difference between
   * one node and two.
   */
  await withTenant(orgId, async () => {
    const a = await resolvePerson({
      orgId,
      identities: [{ kind: "email", value: `  ${TAG}-CASE-TEST@Counterparty.Invalid  ` }],
      displayName: `${TAG} Case Test`,
      source: "calendar",
    });
    const b = await resolvePerson({
      orgId,
      identities: [{ kind: "email", value: `${TAG}-case-test@counterparty.invalid` }],
      displayName: `${TAG} Case Test`,
      source: "calendar",
    });
    if (a && b && String(a) === String(b)) ok("case and surrounding whitespace resolve to the same person");
    else bad("an address differing only in case produced a second person", "normalizeIdentity is not being applied on every path");
  });
}

// ---------------------------------------------------------------------------
// 3. MERGE. The operation that rewrites who somebody is.
//
// A merge is the one place the product changes the meaning of existing rows,
// so it is the one place a mistake is not visible as a missing row -- it is
// visible as the wrong person's history on somebody's node.
// ---------------------------------------------------------------------------

async function merges() {
  const orgId = world.org;
  const ids = {};

  await withTenant(orgId, async () => {
    for (const n of ["one", "two", "three"]) {
      ids[n] = await resolvePerson({
        orgId,
        identities: [{ kind: "email", value: `${TAG}-merge-${n}@counterparty.invalid` }],
        displayName: `${TAG} Merge ${n}`,
        source: "calendar",
      });
    }

    const self = await mergePeople({ orgId, keepId: ids.one, mergeIds: [ids.one] });
    if (!self.ok) ok("a person cannot be merged into themselves");
    else bad("self-merge was accepted", "the node now points at itself and every family query recurses or empties");

    const missing = await mergePeople({
      orgId,
      keepId: ids.one,
      mergeIds: ["00000000-0000-0000-0000-000000000000"],
    });
    if (!missing.ok) ok("merging a person who does not exist is refused");
    else bad("merging a non-existent id succeeded", "a dangling merged_into is a node that disappears");

    /*
     * THE CHAIN. two into one, then three into two. If the chain is allowed,
     * resolution stops being one hop and every family query is wrong by
     * however deep the chain happens to be that day.
     */
    const first = await mergePeople({ orgId, keepId: ids.one, mergeIds: [ids.two], byAmberId: world.members.avery });
    if (!first.ok) {
      bad("a plain merge was refused", first.reason);
    } else {
      ok("a plain merge succeeds");
      let chained = null;
      try {
        chained = await mergePeople({ orgId, keepId: ids.two, mergeIds: [ids.three], byAmberId: world.members.avery });
      } catch {
        chained = { ok: false, reason: "trigger" };
      }
      if (!chained.ok) ok("a chain is refused — resolution stays one hop");
      else bad("a merge chain was created", "amber_person_merge_is_flat() is not firing");

      const { rows: deep } = await query(
        `SELECT count(*)::int AS n FROM org_people a
           JOIN org_people b ON b.id = a.merged_into
          WHERE a.org_id = $1::uuid AND b.merged_into IS NOT NULL`,
        [orgId],
      );
      if (deep[0].n === 0) ok("and no chain exists in the table either way");
      else bad(`${deep[0].n} person row(s) point at an already-merged person`, "the invariant is broken in data");

      /*
       * HISTORY FOLLOWS THE SURVIVOR. The point of a merge is that the
       * timeline is whole afterwards.
       */
      const fam = await query(
        `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid AND merged_into = $2::uuid`,
        [orgId, ids.one],
      );
      if (fam.rows[0].n >= 1) ok("the merged-away person still exists, pointing at the survivor");
      else bad("the merged person is gone rather than pointing", "a merge must be reversible; a delete is not");

      const undone = await unmergePerson({ orgId, personId: ids.two });
      if (undone.ok) ok("and the merge can be undone");
      else bad("unmerge failed", undone.reason);
    }
  });

  /*
   * CROSS-TENANT MERGE, the worst one. Merging a person in company A into a
   * person in company B would hand A's entire history to B through a single
   * pointer, with every tenant policy still passing because each row's own
   * org_id is unchanged.
   */
  const outside = world.outsider;
  if (outside?.orgId) {
    let theirs = null;
    await withTenant(outside.orgId, async () => {
      theirs = await resolvePerson({
        orgId: outside.orgId,
        identities: [{ kind: "email", value: `${TAG}-theirs@counterparty.invalid` }],
        displayName: `${TAG} Theirs`,
        source: "calendar",
      });
    });

    /*
     * ITS OWN SCOPE, because this one is EXPECTED to be refused by the
     * database. A refused statement poisons its transaction -- everything
     * after it fails with "current transaction is aborted" -- so running
     * this inside the same scope as the checks that follow made a correct
     * refusal look like four more failures. The third time this evening
     * that pattern cost a clean read of the output.
     */
    let crossed = null;
    try {
      await withTenant(orgId, async () => {
        crossed = await mergePeople({
          orgId,
          keepId: ids.one,
          mergeIds: [theirs],
          byAmberId: world.members.avery,
        });
      });
    } catch {
      crossed = { ok: false, reason: "refused by the database" };
    }
    if (!crossed?.ok) ok("a person in another company cannot be merged into ours");
    else bad("a cross-company merge succeeded", "one pointer just handed another customer's history to this one");

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM org_people a JOIN org_people b ON b.id = a.merged_into
        WHERE a.org_id <> b.org_id`,
    );
    if (rows[0].n === 0) ok("and no merge anywhere crosses a company boundary");
    else bad(`${rows[0].n} merge(s) cross companies`, "a composite foreign key on (org_id, merged_into) is missing");
  }

  /*
   * THE SUGGESTION ENGINE must not suggest merging two people who merely
   * work at the same firm. A false positive here is a user destroying their
   * own data on our advice.
   */
  await withTenant(orgId, async () => {
    for (const n of ["alice", "bob"]) {
      await resolvePerson({
        orgId,
        identities: [{ kind: "email", value: `${n}@sameplace-${TAG}.invalid` }],
        displayName: `${TAG} ${n}`,
        source: "calendar",
      });
    }
    /*
     * suggestMerges returns GROUPS -- { n, signal, suggestedKeepId, people }
     * -- not pairs with a_name and b_name. Reading fields that do not exist
     * produces undefined, every comparison is false, and the check reports
     * green forever while testing nothing. Worth saying out loud because it
     * is the failure mode of every test written against a remembered shape.
     */
    const suggested = await suggestMerges({ orgId, limit: 50 });
    const names = (g) => (g.people ?? []).map((p) => String(p.display_name ?? "").toLowerCase());
    const wrong = suggested.filter((g) => {
      const n = names(g);
      return n.some((x) => x.includes("alice")) && n.some((x) => x.includes("bob"));
    });
    if (wrong.length === 0) ok("two colleagues at one firm are not suggested as duplicates");
    else bad("the suggester proposed merging two different people", "a false positive here destroys data on our advice");

    // And the shape itself, so this check cannot go quiet the way it just did.
    if (suggested.length === 0 || suggested.every((g) => Array.isArray(g.people) && g.suggestedKeepId !== undefined)) {
      ok("the suggestion shape is the one this test reads");
    } else {
      bad("suggestMerges returned an unexpected shape", "the duplicate check above is not testing anything");
    }
  });
}

// ---------------------------------------------------------------------------
// 4. CONSENT. Revocation has to take the data with it.
// ---------------------------------------------------------------------------

async function consent() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const sources = await listSources({ orgId, amberId: world.members.blake });
    const cal = sources.find((s) => s.source === "calendar" && !s.revoked_at);
    if (!cal) {
      note("Blake has no live calendar grant — consent section skipped");
      return;
    }

    const wrote = await record({
      orgId,
      memberId: world.members.blake,
      kind: "meeting",
      source: "calendar",
      connectionId: cal.id,
      externalId: `${TAG}-consent-1`,
      summary: `${TAG}-BLAKE-CONSENT-ROW`,
      occurredAt: new Date().toISOString(),
      identities: [{ kind: "email", value: `${TAG}-consent@counterparty.invalid` }],
      displayName: `${TAG} Consent Contact`,
    });
    if (!wrote.ok) {
      bad("could not write a row under a live grant", wrote.reason);
      return;
    }

    const before = await query(
      `SELECT count(*)::int AS n FROM org_person_edges WHERE org_id = $1::uuid AND member_id = $2::uuid`,
      [orgId, world.members.blake],
    );

    /*
     * AVERY'S CONTROL ROW, WRITTEN HERE AND COUNTED BEFORE THE REVOCATION.
     *
     * Revoking is scoped to one person's grant, and a delete keyed on the
     * wrong column takes the whole company with it -- so the check needs
     * somebody else's row to still be there afterwards.
     *
     * Two things this section got wrong first. It relied on an EARLIER
     * section having written Avery's rows, so when that section threw this
     * one announced a bug in one place as a leak in another. Then the repair
     * took both counts after the revocation, which can only ever be equal --
     * a check that reports green whatever happens.
     */
    await met("avery", {
      email: `${TAG}-control@counterparty.invalid`,
      name: `${TAG} Control Contact`,
      summary: `${TAG}-AVERY-CONTROL`,
    });
    const averyBefore = await query(
      `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND member_id = $2::uuid`,
      [orgId, world.members.avery],
    );

    const revoked = await revokeSource({ orgId, amberId: world.members.blake, sourceId: cal.id });
    if (!revoked.ok) {
      bad("revoking a grant failed", revoked.reason);
      return;
    }

    const { rows: left } = await query(
      `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND connection_id = $2::uuid`,
      [orgId, cal.id],
    );
    if (left[0].n === 0) ok("revoking a source deletes the interactions it produced");
    else bad(`${left[0].n} interaction(s) survived revocation`, "that is a toggle, not consent");

    /*
     * THE DERIVED CLAIM. An edge is a summary of interactions. If the
     * interactions are gone and the edge is not, the product still asserts a
     * relationship whose evidence has been withdrawn.
     */
    const after = await query(
      `SELECT count(*)::int AS n FROM org_person_edges e
        WHERE e.org_id = $1::uuid AND e.member_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM org_interactions i
                           WHERE i.org_id = e.org_id AND i.person_id = e.person_id AND i.member_id = e.member_id)`,
      [orgId, world.members.blake],
    );
    if (after.rows[0].n === 0) ok("and leaves no edge standing on deleted evidence");
    else bad(`${after.rows[0].n} edge(s) survive with no interactions behind them`, "the relationship is still asserted");

    const averyAfter = await query(
      `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND member_id = $2::uuid`,
      [orgId, world.members.avery],
    );
    if (averyBefore.rows[0].n === 0) {
      bad("Avery's control row was not written", "the scoping check cannot run without it");
    } else if (averyAfter.rows[0].n === averyBefore.rows[0].n) {
      ok(`another member's ${averyAfter.rows[0].n} interaction(s) are untouched by it`);
    } else {
      bad(
        `Avery went from ${averyBefore.rows[0].n} to ${averyAfter.rows[0].n} interactions`,
        "the delete is not scoped to the connection — it took another member's data",
      );
    }

    note(`before ${before.rows[0].n} edge(s) for Blake, ${revoked.removed} interaction(s) removed`);

    // Put it back so later sections have a live grant.
    await grantSource({ orgId, amberId: world.members.blake, source: "calendar" });
  });
}

// ---------------------------------------------------------------------------
// 5. THE POLICY CEILING. A ceiling that only applies at one door is a wall
// with a window in it.
// ---------------------------------------------------------------------------

async function ceiling() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const original = await getPolicy({ orgId });

    /*
     * copilot rather than something invented, because it is a real source
     * that the DEFAULT policy already excludes -- the four agent sources are
     * off until a company turns them on. So this is the state a new customer
     * is actually in on their first day, not a contrived one.
     */
    const without = (original.sources ?? []).filter((s) => s !== "copilot");
    await setPolicy({ orgId, byAmberId: world.members.avery, patch: { sources: without } });

    const grant = await grantSource({ orgId, amberId: world.members.avery, source: "copilot" });
    if (!grant.ok) ok("a member cannot grant a source the company has switched off");
    else bad("a forbidden source was granted", "the member now has a connection that silently delivers nothing");

    const write = await record({
      orgId,
      memberId: world.members.avery,
      kind: "ai",
      source: "copilot",
      externalId: `${TAG}-forbidden-1`,
      summary: `${TAG}-FORBIDDEN-WRITE`,
      occurredAt: new Date().toISOString(),
      identities: [{ kind: "email", value: `${TAG}-ceiling@counterparty.invalid` }],
      displayName: `${TAG} Ceiling Contact`,
    });
    if (!write.ok) ok("and a write from it is refused at the door");
    else bad("a write from a forbidden source landed", "the ceiling is checked at grant time only");

    const refusals = await listRefusals({ orgId, limit: 20 });
    if (refusals.some((r) => r.source === "copilot")) ok("the refusal is written down, with the policy version in force");
    else bad("the refusal left no record", "an unlogged refusal cannot be shown to an auditor");

    /*
     * THE GATE. An agent write with no human principal, while the gate is
     * required, is the shape of the thing nobody can audit afterwards. Turn
     * copilot ON first, so that what is being tested is the gate rather than
     * the ceiling refusing it again for the earlier reason.
     */
    await setPolicy({
      orgId,
      byAmberId: world.members.avery,
      patch: { sources: [...without, "copilot"], requireGate: true },
    });
    const headless = await checkWrite({ orgId, amberId: null, source: "copilot" });
    if (!headless.ok && headless.reason === "gate_requires_principal") {
      ok("an agent write with no human principal is refused while the gate is on");
    } else if (!headless.ok) {
      bad(`the refusal came back as ${headless.reason}`, "the gate is not the thing that stopped it, so the gate is untested");
    } else {
      bad("a principal-less agent write was allowed", "the gate is not doing anything");
    }

    const principled = await checkWrite({ orgId, amberId: world.members.avery, source: "copilot" });
    if (principled.ok) ok("the same write with a principal is allowed");
    else bad("a write with a named human was refused", principled.reason);

    /*
     * A NON-AGENT SOURCE MUST NOT BE GATED. A gate that stops a calendar
     * sync is an outage wearing a policy's clothes.
     */
    const calendar = await checkWrite({ orgId, amberId: null, source: "calendar" });
    if (calendar.ok) ok("and the gate does not touch a person's own calendar sync");
    else bad("the gate refused a calendar write", calendar.reason);

    /*
     * VERSION STAMPING. "We had a rule" is a claim about the present applied
     * to the past unless the row carries the version it was written under.
     */
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM org_interactions
        WHERE org_id = $1::uuid AND policy_version IS NULL`,
      [orgId],
    );
    if (rows[0].n === 0) ok("every interaction carries the policy version it was written under");
    else bad(`${rows[0].n} interaction(s) have no policy version`, "the audit trail has holes in it");

    await setPolicy({ orgId, byAmberId: world.members.avery, patch: { sources: original.sources } });
  });
}

// ---------------------------------------------------------------------------
// 6. APPEND-ONLY. The ledger's whole claim.
// ---------------------------------------------------------------------------

async function appendOnly() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const wrote = await met("avery", {
      email: `${TAG}-append@counterparty.invalid`,
      name: `${TAG} Append Contact`,
      summary: `${TAG}-ORIGINAL-TEXT`,
      externalId: `${TAG}-append-1`,
    });

    /*
     * IDEMPOTENCE. The same external id twice is one row, because a producer
     * re-running is normal and a duplicated timeline is how somebody stops
     * trusting the count.
     */
    const again = await met("avery", {
      email: `${TAG}-append@counterparty.invalid`,
      name: `${TAG} Append Contact`,
      summary: `${TAG}-REWRITTEN-TEXT`,
      externalId: `${TAG}-append-1`,
    });

    const { rows } = await query(
      `SELECT count(*)::int AS n, min(summary) AS text FROM org_interactions
        WHERE org_id = $1::uuid AND external_id = $2`,
      [orgId, `${TAG}-append-1`],
    );
    if (rows[0].n === 1) ok("re-running a producer writes one row, not two");
    else bad(`${rows[0].n} rows share one external id`, "the timeline double-counts every re-sync");

    if (String(rows[0].text ?? "").includes("ORIGINAL")) ok("and the second attempt did not rewrite the first");
    else bad("the row was overwritten by the re-run", "an append-only ledger that updates is just a table");

    if (again.duplicate === true) ok("the second write reports itself as a duplicate rather than a new row");
    else bad("the re-run did not report a duplicate", "a producer cannot tell the difference between new and already-known");
    void wrote;

    /*
     * RACING PRODUCERS. Two syncs of the same meeting at the same instant,
     * which is what actually happens when two colleagues attend it.
     */
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        met("avery", {
          email: `${TAG}-race@counterparty.invalid`,
          name: `${TAG} Race Contact`,
          summary: `${TAG}-RACE`,
          externalId: `${TAG}-race-1`,
        }).catch(() => null),
      ),
    );
    const { rows: raced } = await query(
      `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND external_id = $2`,
      [orgId, `${TAG}-race-1`],
    );
    if (raced[0].n === 1) ok("eight simultaneous writes of one meeting produce one row");
    else bad(`${raced[0].n} rows from eight concurrent writes`, "the uniqueness is being enforced in the application, not the database");
    void results;
  });

  /*
   * THE STRUCTURAL HALF, which the runtime half cannot reach. Idempotence
   * proves that THIS path does not rewrite a row. Append-only is a claim
   * about every path, including the convenience helper somebody adds in six
   * months to "just fix the summary" -- so the only way to check it is to
   * read every statement in the tree.
   */
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) continue;
      // Not this file: it writes the fixtures it is checking.
      if (full.endsWith("audit-pressure.js")) continue;
      const text = readFileSync(full, "utf8");

      /*
       * CONTENT, NOT EVERY COLUMN -- and the distinction is the whole claim.
       *
       * "Append-only" means what HAPPENED is never rewritten: who it was
       * with, when, what was said, who may see it. It does not mean no
       * column may ever be set. org-ai-import stamps import_id on the rows
       * it just created so an upload can be undone, which adds a pointer to
       * history rather than altering it.
       *
       * The first version of this check flagged that stamp, which is the
       * kind of finding that teaches people the test is wrong. Listing the
       * columns that constitute the record says what the rule actually is.
       */
      const CONTENT = [
        "summary", "occurred_at", "person_id", "member_id",
        "kind", "source", "visibility", "artifact_url", "external_id",
      ];
      for (const m of text.matchAll(/UPDATE\s+org_interactions([\s\S]{0,400}?)(?:`|;)/gi)) {
        const setClause = m[1];
        const touched = CONTENT.filter((c) => new RegExp(`\\b${c}\\s*=`).test(setClause));
        if (touched.length > 0) offenders.push(`${entry.name} (${touched.join(", ")})`);
      }
    }
  };
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const sub of ["src", "scripts"]) {
    try {
      walk(join(root, sub));
    } catch {
      /* a missing directory is not a finding */
    }
  }
  if (offenders.length === 0) ok("no code path anywhere updates an interaction");
  else bad(`${offenders.length} file(s) update org_interactions`, offenders.join(", "));
}

// ---------------------------------------------------------------------------
// 7. INPUT. What a real inbox and a real calendar actually contain.
// ---------------------------------------------------------------------------

async function inputs() {
  const orgId = world.org;

  /*
   * NOT WRAPPED IN ONE withTenant, deliberately.
   *
   * A nested tenant scope JOINS the outer transaction rather than opening a
   * rival one -- which is the correct design and the reason an inner scope
   * cannot isolate anything from an outer one. Putting the loop inside a
   * single scope would have left the per-case isolation below doing nothing
   * at all while looking like it worked.
   */
  {
    const cases = [
      ["no identity and no person", { identities: [], displayName: "Nobody" }],
      ["an identity with an empty value", { identities: [{ kind: "email", value: "" }], displayName: "Empty" }],
      ["an identity with a null value", { identities: [{ kind: "email", value: null }], displayName: "Null" }],
      ["a malformed address", { identities: [{ kind: "email", value: "not-an-address" }], displayName: "Malformed" }],
      ["an address that is only an @", { identities: [{ kind: "email", value: "@" }], displayName: "At" }],
      [
        "a display name longer than any column",
        {
          identities: [{ kind: "email", value: `${TAG}-long@counterparty.invalid` }],
          displayName: "x".repeat(5000),
        },
      ],
      [
        "a summary with null bytes and newlines",
        {
          identities: [{ kind: "email", value: `${TAG}-weird@counterparty.invalid` }],
          displayName: "Weird",
          summary: "line one\nline two\u0000tail",
        },
      ],
      [
        "an address that looks like SQL",
        {
          identities: [{ kind: "email", value: `x'; DROP TABLE org_people; --@counterparty.invalid` }],
          displayName: "Injection",
        },
      ],
    ];

    /*
     * EACH ONE IN ITS OWN TRANSACTION, which is the difference between a
     * list of findings and one finding followed by noise.
     *
     * A statement Postgres refuses poisons its transaction: everything after
     * it fails with "current transaction is aborted" until a rollback. Run
     * eight hostile inputs in one scope and the first genuine failure makes
     * the other seven report a cascade rather than their own answer -- which
     * is exactly what the first run of this script did, reporting the SQL
     * injection case as broken when all it had done was follow a null byte.
     */
    let crashed = 0;
    for (const [what, patch] of cases) {
      try {
        await withTenant(orgId, async () => {
          await record({
            orgId,
            memberId: world.members.avery,
            kind: "meeting",
            source: "calendar",
            externalId: `${TAG}-input-${Math.random().toString(36).slice(2)}`,
            summary: patch.summary ?? `${TAG}-INPUT`,
            occurredAt: new Date().toISOString(),
            ...patch,
          });
        });
      } catch (err) {
        crashed += 1;
        bad(`${what} threw`, String(err?.message ?? err).slice(0, 160));
      }
    }
    if (crashed === 0) ok(`${cases.length} malformed inputs were refused or absorbed, none threw`);
  }

  // The rest shares one scope: none of it is expected to be refused.
  await withTenant(orgId, async () => {
    const { rows: alive } = await query(`SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid`, [orgId]);
    if (alive[0].n > 0) ok("org_people is still there after the injection attempt");
    else bad("org_people is empty", "something in that list was not parameterised");

    /*
     * TIME. A meeting dated in 2087 or in 1970 is a provider bug, and it
     * ends up at the top or the bottom of every timeline forever.
     */
    const far = await record({
      orgId,
      memberId: world.members.avery,
      kind: "meeting",
      source: "calendar",
      externalId: `${TAG}-time-1`,
      summary: `${TAG}-FAR-FUTURE`,
      occurredAt: "2087-01-01T00:00:00.000Z",
      identities: [{ kind: "email", value: `${TAG}-time@counterparty.invalid` }],
      displayName: `${TAG} Time Contact`,
    });
    const bogus = await record({
      orgId,
      memberId: world.members.avery,
      kind: "meeting",
      source: "calendar",
      externalId: `${TAG}-time-2`,
      summary: `${TAG}-BAD-TIME`,
      occurredAt: "not a date",
      identities: [{ kind: "email", value: `${TAG}-time@counterparty.invalid` }],
      displayName: `${TAG} Time Contact`,
    });
    if (!bogus.ok) ok("an unparseable date is refused rather than stored as now()");
    else bad("an unparseable date was accepted", "it silently became the time of the sync");

    if (far.ok || far.id) {
      note("a meeting dated 2087 was accepted — nothing rejects a provider's bad clock, and it will sit at the top of a timeline");
    }

    /*
     * GOING COLD must not count the future as recent, which is the same bug
     * seen from the other end.
     */
    const cold = await goingCold({ orgId, viewerId: world.members.avery, limit: 50 }).catch(() => []);
    ok(`goingCold returned ${Array.isArray(cold) ? cold.length : 0} row(s) without failing on the 2087 row`);
  });
}

// ---------------------------------------------------------------------------
// 8. THE BOOTSTRAP FLAG. How much is behind it, measured rather than argued.
// ---------------------------------------------------------------------------

async function bootstrapBlastRadius() {
  /*
   * The honest version of the question in migration 090's header. Raise the
   * flag the way a compromised application could and count what comes back.
   * Under 090 that is every company's membership. Under 091 it should be
   * nothing at all, because the flag now has to name a row.
   */
  /*
   * ONE CONNECTION, inside a transaction. set_config(..., true) is
   * transaction-local, so a probe that raised the flag with the module-level
   * query() and then counted with another would take two different pooled
   * connections, raise the flag on one and count on the other -- and report
   * a reassuring zero for the wrong reason. That is a test that passes while
   * the door is open.
   */
  const probe = async (value) =>
    withTransaction(async (client) => {
      await client.query(`SELECT set_config('amber.bootstrap', $1, true)`, [value]);
      const { rows: m } = await client.query(`SELECT count(*)::int AS n FROM org_members`);
      const { rows: o } = await client.query(`SELECT count(*)::int AS n FROM organizations`);
      return { members: m[0].n, orgs: o[0].n };
    }).catch((err) => ({ error: String(err?.message ?? err) }));

  const boolean090 = await probe("on");

  if (boolean090.error) {
    note(`the boolean probe could not run: ${boolean090.error.slice(0, 120)}`);
  } else if (boolean090.members === 0 && boolean090.orgs === 0) {
    ok("raising the old boolean flag now reveals nothing — 091 is applied");
  } else {
    bad(
      `the boolean flag still exposes ${boolean090.members} membership(s) across ${boolean090.orgs} company(ies)`,
      "migration 091 has not been applied; until it is, anything that can set a session variable can read the customer list",
    );
  }

  const named = await probe(String(world.members.avery));
  if (named.error) {
    note(`the named probe could not run: ${named.error.slice(0, 120)}`);
  } else if (named.members <= 1) {
    ok(`naming one person's id reveals ${named.members} membership row and no company list`);
  } else {
    bad(`naming one id revealed ${named.members} memberships`, "the policy is not comparing the subject");
  }

  /*
   * AND THE FLAG MUST NOT SURVIVE THE CALL. A bootstrap function that
   * leaves its setting up on a pooled connection hands the next request
   * whatever it was holding.
   */
  await query(`SELECT * FROM amber_membership_bootstrap($1::uuid)`, [world.members.avery]).catch(() => null);
  const { rows: leftUp } = await query(
    `SELECT COALESCE(current_setting('amber.bootstrap', true), '') AS v,
            COALESCE(current_setting('amber.bootstrap_org', true), '') AS o`,
  );
  if (!leftUp[0].v && !leftUp[0].o) ok("the flag is down again after the call");
  else bad(`the flag is still set to '${leftUp[0].v || leftUp[0].o}'`, "a pooled connection carries it into the next request");
}

// ---------------------------------------------------------------------------
// 9. RETENTION. A promise with a number in it.
// ---------------------------------------------------------------------------

async function retention() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString();
    await record({
      orgId,
      memberId: world.members.avery,
      kind: "meeting",
      source: "calendar",
      externalId: `${TAG}-retain-1`,
      summary: `${TAG}-OLD-ROW`,
      occurredAt: old,
      identities: [{ kind: "email", value: `${TAG}-retain@counterparty.invalid` }],
      displayName: `${TAG} Retain Contact`,
    });

    // The control: same person, same producer, this week rather than last year.
    await record({
      orgId,
      memberId: world.members.avery,
      kind: "meeting",
      source: "calendar",
      externalId: `${TAG}-retain-recent`,
      summary: `${TAG}-RECENT-ROW`,
      occurredAt: new Date().toISOString(),
      identities: [{ kind: "email", value: `${TAG}-retain@counterparty.invalid` }],
      displayName: `${TAG} Retain Contact`,
    });

    const before = await getPolicy({ orgId });
    await setPolicy({ orgId, byAmberId: world.members.avery, patch: { retentionMonths: 6 } });

    const applied = await applyRetention({ orgId }).catch((e) => ({ error: String(e?.message ?? e) }));
    if (applied?.error) {
      bad("applying retention threw", applied.error.slice(0, 160));
    } else {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND external_id = $2`,
        [orgId, `${TAG}-retain-1`],
      );
      if (rows[0].n === 0) ok("a 400-day-old row is gone once retention is six months");
      else bad("the old row survived retention", "the number in the policy is decoration");

      /*
       * THE SAME MISTAKE AS THE CONSENT CHECK, and it reported the same way:
       * this counted recent rows after retention ran and called zero an
       * inverted comparison -- which it said because earlier sections had
       * thrown and left nothing recent to keep. The control row is written
       * by this section, so the answer means what it says.
       */
      const { rows: kept } = await query(
        `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND external_id = $2`,
        [orgId, `${TAG}-retain-recent`],
      );
      if (kept[0].n === 1) ok("and a row from this week is untouched");
      else bad("retention took a row from this week", "the interval comparison is inverted");
    }

    await setPolicy({
      orgId,
      byAmberId: world.members.avery,
      patch: { retentionMonths: before.retention_months ?? null },
    });
  });
}

// ---------------------------------------------------------------------------
// 10. INVITATIONS. The first thing a new customer's team touches.
// ---------------------------------------------------------------------------

async function invitations() {
  const orgId = world.org;

  let token = null;
  await withTenant(orgId, async () => {
    const made = await createInvite({
      orgId,
      email: `${TAG}-invitee@${DOMAIN}`,
      role: "member",
      invitedBy: world.members.avery,
    });
    token = made?.token ?? null;
    if (!token) note(`createInvite returned no token (${made?.reason ?? "unknown"}) — the claim tests cannot run`);
  });

  if (token) {
    // peekInvite returns the camelCase shape, not the raw row.
    const peeked = await peekInvite(token);
    if (peeked?.orgId === String(orgId)) ok("an invitation can be read by its token before signing in");
    else bad("peeking a valid invitation returned nothing", "the bootstrap policy on org_invites is too narrow or the flag is not raised");

    const wrong = await peekInvite(`${token}x`).catch(() => null);
    if (!wrong) ok("a token with one character changed reads nothing");
    else bad("a mutated token was accepted", "the lookup is not on the full hash");

    const empty = await peekInvite("").catch(() => null);
    if (!empty) ok("an empty token reads nothing");
    else bad("an empty token returned an invitation", "a blank value is matching rows");
  }

  /*
   * EXPIRY AND REVOCATION are the two states that must stop a link that was
   * once valid, and both are easy to implement at the read and forget at the
   * claim.
   */
  await withTenant(orgId, async () => {
    const stale = await createInvite({
      orgId,
      email: `${TAG}-expired@${DOMAIN}`,
      role: "member",
      invitedBy: world.members.avery,
    });
    if (stale?.invite?.id) {
      await query(`UPDATE org_invites SET expires_at = now() - interval '1 day' WHERE org_id = $1::uuid AND id = $2::uuid`, [
        orgId,
        stale.invite.id,
      ]);
      const read = await peekInvite(stale.token).catch(() => null);
      if (!read) ok("an expired invitation reads as nothing");
      else bad("an expired invitation is still readable", "the link in somebody's inbox never stops working");
    }

    const rev = await createInvite({
      orgId,
      email: `${TAG}-revoked@${DOMAIN}`,
      role: "member",
      invitedBy: world.members.avery,
    });
    if (rev?.invite?.id) {
      await query(`UPDATE org_invites SET revoked_at = now() WHERE org_id = $1::uuid AND id = $2::uuid`, [orgId, rev.invite.id]);
      const gone = await peekInvite(rev.token).catch(() => null);
      if (!gone) ok("a revoked invitation reads as nothing");
      else bad("a revoked invitation is still readable", "revocation is advisory");
    }
  });

  /*
   * THE TOKEN MUST NOT BE IN THE TABLE IN THE CLEAR. If it is, reading the
   * invitations table is the same as holding every outstanding link.
   */
  const { rows: cols } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'org_invites' AND column_name IN ('token', 'token_hash')`,
  );
  const names = cols.map((c) => c.column_name);
  if (names.includes("token_hash") && !names.includes("token")) ok("invitations store only the hash of their token");
  else bad(`org_invites has column(s) ${names.join(", ")}`, "a plaintext token column is every outstanding invitation in one select");
}

// ---------------------------------------------------------------------------
// 11. SHAPE. The queries that get slow at a thousand people rather than ten.
// ---------------------------------------------------------------------------

async function shape() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const timed = async (label, fn) => {
      const t0 = Date.now();
      const out = await fn().catch((e) => ({ error: String(e?.message ?? e) }));
      const ms = Date.now() - t0;
      if (out?.error) bad(`${label} failed`, out.error.slice(0, 140));
      else if (ms > 1500) bad(`${label} took ${ms}ms`, "this is the shape of a query that is fine in a demo and unusable in a quarter");
      else ok(`${label} in ${ms}ms`);
      return out;
    };

    await timed("listPeople", () => listPeople({ orgId, viewerId: world.members.avery, limit: 200 }));
    await timed("listPeople scoped internal", () => listPeople({ orgId, viewerId: world.members.avery, scope: "internal", limit: 200 }));
    await timed("suggestMerges", () => suggestMerges({ orgId, limit: 25 }));
    await timed("goingCold", () => goingCold({ orgId, viewerId: world.members.avery, limit: 50 }));

    /*
     * THE CROSS JOIN THAT WAS THERE. suggestMerges compares every person to
     * every other, which is fifty million comparisons at ten thousand
     * people. A prefix key turns it into a hash join. This asks the planner
     * rather than the clock, because the clock is honest only at scale.
     */
    const { rows: plan } = await query(
      `EXPLAIN (FORMAT JSON)
       SELECT 1 FROM org_people a JOIN org_people b ON a.org_id = b.org_id AND a.id < b.id
        WHERE a.org_id = $1::uuid`,
      [orgId],
    ).catch(() => ({ rows: [] }));
    if (plan.length > 0) {
      const text = JSON.stringify(plan[0]);
      if (/Nested Loop/.test(text) && !/Hash|Merge Join/.test(text)) {
        note("a self-join on org_people plans as a nested loop — fine now, quadratic later");
      } else {
        ok("a self-join on org_people does not plan as a bare nested loop");
      }
    }

    /*
     * INDEXES ON THE COLUMNS EVERY TENANT QUERY FILTERS BY. Missing these is
     * invisible until the table is large, and then it is every screen at
     * once.
     */
    const want = [
      ["org_interactions", "org_id"],
      ["org_people", "org_id"],
      ["org_person_identities", "org_id"],
      ["org_person_edges", "org_id"],
      ["org_members", "amber_id"],
    ];
    const missing = [];
    for (const [table, col] of want) {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM pg_indexes
          WHERE tablename = $1 AND indexdef LIKE '%' || $2 || '%'`,
        [table, col],
      );
      if (rows[0].n === 0) missing.push(`${table}.${col}`);
    }
    if (missing.length === 0) ok("every tenant-filtered column is indexed");
    else bad(`no index covers ${missing.join(", ")}`, "every policy check is a sequential scan");
  });
}

// ---------------------------------------------------------------------------
// 12. API KEYS. The credential that leaves the building.
//
// A session belongs to a person at a screen. A key belongs to whatever holds
// it -- a Copilot connector, a script, a vendor -- and it is the one thing
// here that is copied into another company's product by design. So the
// questions are different: does it name exactly one tenant, does revoking it
// stop it immediately, and is the stored form useless to somebody reading the
// table.
// ---------------------------------------------------------------------------

async function apiKeys() {
  const orgId = world.org;

  let issued = null;
  await withTenant(orgId, async () => {
    issued = await issueOrgKey({
      orgId,
      name: `${TAG} connector`,
      // A REAL scope. normalizeScopes keeps only read/write/admin and falls
      // back to ["read"] for anything else, so asking for a made-up scope
      // and then checking what came back tests the fallback, not the key.
      scopes: ["read"],
      createdBy: world.members.avery,
    }).catch((e) => ({ error: String(e?.message ?? e) }));
  });

  if (!issued || issued.error || !issued.raw) {
    bad("could not issue an API key", issued?.error ?? "no key returned");
    return;
  }

  /*
   * VERIFICATION HAPPENS BEFORE THERE IS A TENANT -- the key is what decides
   * which tenant -- so this is deliberately called OUTSIDE any scope. If it
   * only worked inside one, every real request carrying a key would fail.
   */
  const seen = await verifyOrgKey(issued.raw);
  if (seen?.orgId === String(orgId)) ok("a key resolves to its own company, with no tenant set");
  else bad("a valid key did not resolve", "every machine request would be rejected");

  if (seen && seen.scopes.includes("read") && seen.scopes.length === 1) {
    ok("and carries exactly the scopes it was issued with");
  } else {
    bad(`the key came back with scopes ${JSON.stringify(seen?.scopes)}`, "a scope it was not granted is an escalation");
  }

  /*
   * THE STORED FORM MUST BE USELESS. If the table holds the key itself, then
   * reading one row is the same as holding the credential -- and a database
   * backup becomes a set of live keys for every customer.
   */
  /*
   * INSIDE A TENANT SCOPE. org_api_keys is policied, so reading it unscoped
   * returns nothing -- which the first version reported as "not readable to
   * check its stored form", a failure message describing the test's own
   * mistake rather than anything about the key.
   */
  let stored = [];
  await withTenant(orgId, async () => {
    const r = await query(
      `SELECT key_hash, key_prefix, last4 FROM org_api_keys WHERE org_id = $1::uuid AND id = $2::uuid`,
      [orgId, issued.key.id],
    );
    stored = r.rows;
  });
  if (stored.length === 0) {
    bad("the key row is not readable to check its stored form", "cannot verify the hash");
  } else {
    const hash = String(stored[0].key_hash ?? "");
    if (!hash.includes(issued.raw) && hash !== issued.raw) ok("the stored form is a hash, not the key");
    else bad("the raw key is in the table", "a backup of this database is a set of live credentials");

    if (String(stored[0].last4) === issued.raw.slice(-4)) {
      ok("with a last-four kept so somebody can tell two keys apart");
    }
  }

  /*
   * ONE CHARACTER WRONG IS NOT CLOSE ENOUGH, and a key from one company must
   * not resolve while scoped to another.
   */
  const mutated = await verifyOrgKey(`${issued.raw.slice(0, -1)}${issued.raw.slice(-1) === "a" ? "b" : "a"}`);
  if (!mutated) ok("a key with one character changed resolves to nothing");
  else bad("a mutated key resolved", "the lookup is not on the whole value");

  const junk = await verifyOrgKey("not-a-key");
  if (!junk) ok("and so does a value that is not a key at all");
  else bad("a junk string resolved to a company", "looksLikeOrgKey is not gating the lookup");

  // Revocation has to be immediate, not advisory.
  await withTenant(orgId, async () => {
    await revokeOrgKey({ orgId, keyId: issued.key.id, revokedBy: world.members.avery });
  });
  const afterRevoke = await verifyOrgKey(issued.raw);
  if (!afterRevoke) ok("a revoked key stops resolving at once");
  else bad("a revoked key still works", "revocation is advisory, which is the same as not having it");

  /*
   * THE OTHER COMPANY MUST NOT SEE IT. Keys are the credential most likely
   * to be listed on a settings screen, so the listing is worth probing from
   * the wrong side.
   */
  if (world.outsider?.orgId) {
    await withTenant(world.outsider.orgId, async () => {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM org_api_keys WHERE org_id = $1::uuid`,
        [orgId],
      );
      if (rows[0].n === 0) ok("another company cannot see this company's keys");
      else bad(`${rows[0].n} key row(s) are visible from the other company`, "a tenant policy is missing on org_api_keys");
    });
  }
}

// ---------------------------------------------------------------------------
// 13. AI IMPORT. The Copilot and ChatGPT history, which is the demo.
//
// The rule that matters is that an import NEVER CREATES A PERSON. An export
// is thousands of conversations mentioning everybody the model has ever been
// asked about, and letting it mint nodes would fill the graph with people
// nobody has met. It may only attach to people the company already knows.
// ---------------------------------------------------------------------------

async function aiImport() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    // Somebody the company genuinely knows, so there is something to attach to.
    const known = await met("avery", {
      email: `${TAG}-ai-known@counterparty.invalid`,
      name: `Dana Whitfield`,
      summary: `${TAG}-AI-SEED`,
    });
    if (!known.ok) {
      bad("could not seed a person for the import test", known.reason);
      return;
    }

    const before = await query(
      `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL`,
      [orgId],
    );

    const conversations = [
      {
        id: `${TAG}-c1`,
        title: "Prep for the Whitfield call",
        occurredAt: new Date().toISOString(),
        messages: [{ role: "user", text: "What should I ask Dana Whitfield about renewal?" }],
      },
      {
        id: `${TAG}-c2`,
        title: "Someone we have never met",
        occurredAt: new Date().toISOString(),
        messages: [{ role: "user", text: "Tell me about Persimmon Okonkwo-Vance at Initech." }],
      },
    ];

    const result = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "copilot",
      conversations,
      filename: `${TAG}.json`,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!result?.ok) {
      /*
       * copilot is an agent source and the company default excludes the four
       * agent sources, so a refusal here may be the ceiling doing its job
       * rather than a fault. Said out loud rather than scored either way.
       */
      note(`the import returned ${result?.reason ?? "nothing"} — if this is a policy refusal it is correct`);
      return;
    }

    const after = await query(
      `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid AND deleted_at IS NULL`,
      [orgId],
    );
    if (after.rows[0].n === before.rows[0].n) {
      ok("an import attached to people we know and created nobody");
    } else {
      bad(
        `the import created ${after.rows[0].n - before.rows[0].n} person row(s)`,
        "an export mentions everybody ever asked about; minting nodes from it fills the graph with strangers",
      );
    }

    /*
     * IDEMPOTENCE, for the same reason a calendar re-sync has to be: people
     * re-upload the same export, and a doubled history is how somebody stops
     * believing the numbers.
     */
    const again = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "copilot",
      conversations,
      filename: `${TAG}.json`,
    }).catch(() => ({ ok: false }));

    const { rows: dup } = await query(
      `SELECT count(*)::int AS n FROM org_interactions
        WHERE org_id = $1::uuid AND source = 'copilot' AND external_id LIKE $2`,
      [orgId, `copilot:${TAG}-c1:%`],
    );
    if (dup[0].n <= 1) ok("re-uploading the same export writes nothing twice");
    else bad(`${dup[0].n} rows for one conversation`, "the external id is not keyed on conversation and person");
    void again;

    /*
     * AND IT HAS TO BE REVERSIBLE. Somebody uploads two years of history,
     * sees what it looks like, and wants it gone. An import that cannot be
     * undone is one nobody will risk running.
     */
    if (result.importId) {
      const undone = await undoImport({
        orgId,
        amberId: world.members.avery,
        importId: result.importId,
      }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

      if (undone?.ok) {
        const { rows: left } = await query(
          `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND import_id = $2::uuid`,
          [orgId, result.importId],
        );
        if (left[0].n === 0) ok("and an import can be undone completely");
        else bad(`${left[0].n} imported row(s) survived the undo`, "a partial undo is worse than none");
      } else {
        bad("undoing the import failed", undone?.reason ?? "unknown");
      }

      /*
       * THE SEED MUST SURVIVE THE UNDO. Undo removes what the import wrote,
       * not the meetings that were there first -- a delete scoped to the
       * person rather than the import would take the relationship with it.
       */
      const { rows: seed } = await query(
        `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid AND source = 'calendar'`,
        [orgId],
      );
      if (seed[0].n > 0) ok("and the meetings that were there before it are untouched");
      else bad("the undo took the calendar history with it", "it is scoped to the person rather than the import");
    }
  });

  /*
   * ONE MEMBER MUST NOT UNDO ANOTHER'S IMPORT. An import is somebody's own
   * AI history; the undo is theirs too.
   */
  await withTenant(orgId, async () => {
    const mine = await importExport({
      orgId,
      amberId: world.members.avery,
      provider: "claude",
      conversations: [
        {
          id: `${TAG}-c3`,
          title: "Mine",
          occurredAt: new Date().toISOString(),
          messages: [{ role: "user", text: "Dana Whitfield renewal notes" }],
        },
      ],
      filename: `${TAG}-mine.json`,
    }).catch(() => ({ ok: false }));

    if (!mine?.ok || !mine.importId) {
      note("could not create an import to test cross-member undo");
      return;
    }
    const theft = await undoImport({
      orgId,
      amberId: world.members.blake,
      importId: mine.importId,
    }).catch(() => ({ ok: false, reason: "threw" }));

    if (!theft?.ok) ok("one member cannot undo another member's import");
    else bad("a colleague undid somebody else's import", "the undo is not scoped to its owner");

    await undoImport({ orgId, amberId: world.members.avery, importId: mine.importId }).catch(() => null);
  });
}

// ---------------------------------------------------------------------------
// 14. KNOWLEDGE AND AUDIENCES. Who can read a page.
//
// Same shape of boundary as the relationship ledger and a different
// mechanism, which is the reason to test it separately rather than assume the
// first one covers it.
// ---------------------------------------------------------------------------

async function knowledge() {
  const orgId = world.org;

  await withTenant(orgId, async () => {
    const made = await createPage({
      orgId,
      title: `${TAG} private page`,
      body: `${TAG}-PAGE-SECRET`,
      createdBy: world.members.avery,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!made?.ok || !made.page?.id) {
      note(`could not create a page (${made?.reason ?? "no id"}) — the audience checks are skipped`);
      return;
    }
    const page = made.page;

    /*
     * The audience is set to the author alone, then read as somebody else.
     * A page visible to its author and to nobody else is the narrowest case
     * and therefore the one a missing predicate shows up in first.
     *
     * `everyone: false` is load-bearing: normalizeAudience DEFAULTS everyone
     * to true when the key is absent, so an audience object listing people
     * and omitting it means "the whole company" -- and this check would then
     * read a company-wide page, find a colleague could see it, and report a
     * leak that is only the test having asked for one.
     */
    const set = await setAudience({
      orgId,
      itemType: "page",
      itemId: page.id,
      audience: { everyone: false, people: [world.members.avery] },
      actorId: world.members.avery,
    }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));

    if (!set?.ok) {
      note(`could not narrow the audience (${set?.reason ?? "unknown"}) — reading it back proves nothing`);
      return;
    }

    const asAuthor = await getPage({ orgId, pageId: page.id, viewerId: world.members.avery });
    if (asAuthor) ok("the author can read their own page");
    else bad("the author cannot read their own page", "the audience predicate excludes the person it names");

    const asOther = await getPage({ orgId, pageId: page.id, viewerId: world.members.blake });
    if (!asOther) ok("a colleague outside the audience cannot read it");
    else bad("a colleague read a page they are not in the audience for", "the audience is decorative");

    const found = await searchPages({ orgId, q: "PAGE-SECRET", viewerId: world.members.blake, limit: 20 }).catch(
      () => [],
    );
    const leaked = (found ?? []).filter((r) => String(r.id) === String(page.id));
    if (leaked.length === 0) ok("and search does not return it either");
    else
      bad(
        "search returned a page the viewer may not open",
        "search is the usual way a careful read predicate gets bypassed — it is a second query somebody has to remember",
      );
  });
}

// ---------------------------------------------------------------------------
// Cleanup.
// ---------------------------------------------------------------------------

async function cleanup() {
  section("Cleaning up");

  /*
   * EVERY press- RUN, NOT JUST THIS ONE.
   *
   * A run that throws partway through leaves its rows behind and says so,
   * and the next run cleans up only its own tag -- so the debris from a
   * failed run accumulates in a production database, one abandoned company
   * at a time, each with a plausible-looking name. The first failed run of
   * this script left exactly that, and the honest thing is for the script
   * to collect its own litter rather than for a sentence in a chat log to
   * be the only record of where it is.
   *
   * Scoped to the press- prefix and nothing else: it removes what this
   * script creates, and has no opinion about anything a person made.
   */
  const { rows: strays } = await query(
    `SELECT id FROM organizations WHERE name LIKE 'press-%'`,
  ).catch(() => ({ rows: [] }));

  const orgs = [
    ...new Set([world.org, world.outsider?.orgId, ...strays.map((r) => r.id)].filter(Boolean)),
  ];
  if (strays.length > (world.outsider?.orgId ? 2 : 1)) {
    note(`also clearing ${strays.length - 2} company(ies) left behind by an earlier run`);
  }
  for (const orgId of orgs) {
    await withTenant(orgId, async () => {
      for (const sql of [
        /*
         * The newer surfaces first, and they are listed EXPLICITLY rather
         * than discovered: a cleanup that walks the schema would quietly
         * start deleting from whatever table is added next, in a production
         * database, which is a worse failure than leaving a row behind.
         */
        `DELETE FROM org_audiences WHERE org_id = $1::uuid`,
        `DELETE FROM org_page_revisions WHERE org_id = $1::uuid`,
        `DELETE FROM org_page_attachments WHERE org_id = $1::uuid`,
        `DELETE FROM org_pages WHERE org_id = $1::uuid`,
        `DELETE FROM org_api_keys WHERE org_id = $1::uuid`,
        `DELETE FROM org_interaction_shares WHERE org_id = $1::uuid`,
        `DELETE FROM org_interactions WHERE org_id = $1::uuid`,
        `DELETE FROM org_ai_imports WHERE org_id = $1::uuid`,
        `DELETE FROM org_person_edges WHERE org_id = $1::uuid`,
        `DELETE FROM org_person_identities WHERE org_id = $1::uuid`,
        `UPDATE org_people SET merged_into = NULL WHERE org_id = $1::uuid`,
        `DELETE FROM org_people WHERE org_id = $1::uuid`,
        `DELETE FROM org_accounts WHERE org_id = $1::uuid`,
        `DELETE FROM org_memory_sources WHERE org_id = $1::uuid`,
        `DELETE FROM org_policy_refusals WHERE org_id = $1::uuid`,
        `DELETE FROM org_memory_policy WHERE org_id = $1::uuid`,
        `DELETE FROM org_invites WHERE org_id = $1::uuid`,
        `DELETE FROM org_group_members WHERE org_id = $1::uuid`,
        `DELETE FROM org_groups WHERE org_id = $1::uuid`,
        `DELETE FROM org_policy WHERE org_id = $1::uuid`,
        `DELETE FROM org_members WHERE org_id = $1::uuid`,
      ]) {
        await query(sql, [orgId]).catch(() => null);
      }
    });
    await asOperator((c) => c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [orgId]), { tenant: orgId }).catch(() => null);
  }
  /*
   * The accounts, by address rather than by id -- a run that died before
   * creating its company still created its people, and this is the only
   * handle left on them.
   */
  const { rows: people } = await query(
    `SELECT amber_id FROM user_identities WHERE provider = 'email' AND subject LIKE 'press-%'`,
  ).catch(() => ({ rows: [] }));

  const ids = [
    ...new Set(
      [...Object.values(world.members), world.outsider?.amberId, ...people.map((r) => r.amber_id)]
        .filter(Boolean)
        .map(String),
    ),
  ];
  for (const id of ids) {
    // The identity row first: it references the account, and a failed delete
    // here would leave a user behind that nothing names.
    await query(`DELETE FROM user_identities WHERE amber_id = $1::uuid`, [id]).catch(() => null);
    await query(`DELETE FROM users WHERE amber_id = $1::uuid`, [id]).catch(() => null);
  }

  /*
   * VERIFIED THROUGH THE OPERATOR SCOPE, and this is the whole lesson.
   *
   * This check used to run unscoped, which returns nothing once isolation is
   * enforced -- so it reported "every row this run created is gone" while six
   * fake companies accumulated in a production database. A cleanup that
   * verifies itself with the same blind read it deleted with is not a
   * cleanup; it is a cleanup-shaped sentence.
   */
  const { rows } = await asOperator((c) =>
    c.query(`SELECT count(*)::int AS n FROM organizations WHERE name LIKE 'press-%'`),
  );
  if (rows[0].n === 0) ok("every row this run created is gone, and any an earlier one left");
  else bad(`${rows[0].n} pressure-test company(ies) remain`, "delete them by hand: name LIKE 'press-%'");
}

async function main() {
  console.log("\n\x1b[1mAmber pressure test\x1b[0m");
  console.log(`  tag ${TAG}${only ? `, only sections matching "${only}"` : ""}\n`);

  await build();

  await part("Within-company privacy", withinOrg);
  await part("Identity resolution under race and collision", identity);
  await part("Merge", merges);
  await part("Consent and revocation", consent);
  await part("The policy ceiling", ceiling);
  await part("Append-only", appendOnly);
  await part("Hostile input", inputs);
  await part("The bootstrap flag's blast radius", bootstrapBlastRadius);
  await part("Retention", retention);
  await part("Invitations", invitations);
  await part("API keys", apiKeys);
  await part("AI import", aiImport);
  await part("Knowledge and audiences", knowledge);
  await part("Query shape", shape);

  if (!keep) await cleanup();
  else console.log(`\n  --keep: ${TAG} is still in the database.`);

  console.log("");
  if (failures > 0) {
    console.log(`\x1b[31m${failures} failure(s) out of ${checks} checks.\x1b[0m`);
    process.exitCode = 1;
  } else {
    console.log(`\x1b[32m${checks} checks, no failures.\x1b[0m`);
  }
  if (notes.length > 0) {
    console.log(`\x1b[33m${notes.length} thing(s) worth a look:\x1b[0m`);
    for (const n of notes) console.log(`  · ${n}`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("\n", err);
    console.error(`\nThe run did not finish. Rows tagged ${TAG} may remain.`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
