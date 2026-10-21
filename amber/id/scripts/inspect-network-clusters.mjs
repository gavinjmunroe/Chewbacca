#!/usr/bin/env node
/**
 * WHAT EVERY GROUP IS MADE OF, WHY EACH PERSON IS IN IT, AND WHAT GOT FOLDED.
 *
 * A wrong edge costs more than a missing one: it makes somebody distrust the
 * edges that are right. "There are people randomly attached to pwc.com and I
 * don't think I have anyone at pwc" is not a question the graph can answer
 * about itself, so this answers it -- every group, every member, and the exact
 * field that put them there.
 *
 * IT RESOLVES THE OWNER THE WAY THE API DOES. An earlier version called
 * buildNetworkGraph with no identity at all, so it reported the owner's own
 * card as an ordinary contact and made it look like the server was drawing it.
 * A diagnostic that does not run the same call as the thing it is diagnosing
 * is worse than none, because it sends you after the wrong layer.
 *
 * READ ONLY. It runs the same grouping the API runs, against the same rows,
 * and prints. It writes nothing.
 *
 *   railway run node scripts/inspect-network-clusters.mjs --owner +15550100001
 *   railway run node scripts/inspect-network-clusters.mjs --owner +1630... --cluster pwc
 *   railway run node scripts/inspect-network-clusters.mjs --owner +1630... --merges
 */

import { query } from "../src/db/sql.js";
import { buildNetworkGraph } from "../src/lib/network-graph.js";
import { listContacts } from "../src/db/user-store.js";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const flag = (name) => argv.includes(`--${name}`);

const HEX = /^[0-9a-f-]{6,}$/i;

async function resolveOwner(raw) {
  if (!raw) throw new Error("pass --owner <phone or amber_id>");
  // Shape-based dispatch: a uuid prefix is an id, anything with a + is a phone.
  // Guessing wrong here means inspecting a stranger's address book.
  if (raw.startsWith("+")) {
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE phone = $1 LIMIT 1`,
      [raw],
    );
    if (!rows[0]) throw new Error(`no account for ${raw}`);
    return rows[0].amber_id;
  }
  if (HEX.test(raw)) {
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE amber_id::text LIKE $1 LIMIT 1`,
      [`${raw}%`],
    );
    if (!rows[0]) throw new Error(`no account matching ${raw}`);
    return rows[0].amber_id;
  }
  throw new Error(`cannot tell if "${raw}" is a phone or an id`);
}

/** Exactly the identity the route assembles, so this sees what the API sees. */
async function ownerIdentity(did) {
  const out = { emails: [], phones: [], name: null };
  const { rows: u } = await query(
    `SELECT phone, imessage_linked_phone, full_name FROM users WHERE amber_id = $1`,
    [did],
  );
  if (u[0]) {
    out.phones.push(u[0].phone, u[0].imessage_linked_phone);
    out.name = u[0].full_name ?? null;
  }
  const { rows: ids } = await query(
    `SELECT email FROM user_identities
      WHERE amber_id = $1 AND email IS NOT NULL AND deleted_at IS NULL`,
    [did],
  );
  for (const r of ids) out.emails.push(r.email);
  const { rows: accounts } = await query(
    `SELECT account_email FROM calendar_accounts
      WHERE owner_id = $1 AND account_email IS NOT NULL`,
    [did],
  );
  for (const a of accounts) out.emails.push(a.account_email);
  out.phones = out.phones.filter(Boolean);
  out.emails = [...new Set(out.emails.filter(Boolean))];
  return out;
}

const main = async () => {
  const owner = await resolveOwner(arg("owner"));
  const only = arg("cluster");

  const contacts = await listContacts(owner);
  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const identity = await ownerIdentity(owner);

  const graph = buildNetworkGraph(contacts, new Map(), {
    ownerName: identity.name || "You",
    ownerPhones: identity.phones,
    ownerEmails: identity.emails,
    ownerAmberId: owner,
    ownerProfileName: identity.name,
  });

  console.log(`\n  owner ${String(owner).slice(0, 8)} — ${identity.name ?? "(no profile name)"}`);
  console.log(`  identity: ${identity.phones.join(", ") || "(no phone)"} · ${identity.emails.join(", ") || "(no addresses)"}`);
  console.log(
    `  ${graph.stats.cards} cards → ${graph.stats.people} people and ${graph.stats.places} businesses/places ` +
      `(${graph.stats.merged} folded as duplicates, ${graph.stats.foldedOwnCards} folded as you), ` +
      `${graph.stats.clusters} groups\n`,
  );

  if (graph.stats.foldedOwnCards === 0) {
    console.log("  NOTE: no card in this book was recognized as yours. If one of");
    console.log("  your own cards is drawn as a contact, none of the addresses or");
    console.log("  numbers above appear on it and its name does not match your");
    console.log("  Amber profile name exactly.\n");
  }

  const contactNodes = new Map(
    graph.nodes.filter((n) => n.kind === "contact").map((n) => [n.id, n]),
  );

  if (flag("merges")) {
    const folded = [...contactNodes.values()].filter((n) => (n.mergedCount ?? 1) > 1);
    console.log(`  ${folded.length} person(s) assembled from more than one card:\n`);
    for (const n of folded) {
      console.log(`      ${n.name.padEnd(26)} also filed as: ${n.aliases.join(", ") || "(same name)"}`);
    }
    console.log("");
  }

  const sorted = graph.groups.filter(
    (g) => !only || g.label.toLowerCase().includes(only.toLowerCase()) || g.key.includes(only.toLowerCase()),
  );

  if (!sorted.length) {
    console.log(only ? `  no group matching "${only}"\n` : "  no groups\n");
    return;
  }

  for (const g of sorted) {
    console.log(`  ${g.label}  (${g.kind}, ${g.memberCount})`);
    for (const id of g.memberIds) {
      const node = contactNodes.get(id);
      const row = byId.get(id);
      if (!node) continue;
      const emails = Array.isArray(row?.emails) ? row.emails : [];
      // THE REASON, stated: the company field, or the address whose domain
      // resolved to this group's key.
      const hit = emails.find((e) => String(e).toLowerCase().includes(g.key));
      const why =
        g.kind === "category"
          ? "not a person"
          : hit
            ? `email ${hit}`
            : `company "${row?.company ?? node.company ?? ""}"`;
      const also = (node.aliases ?? []).length ? `  [+ ${node.aliases.join(", ")}]` : "";
      console.log(`      ${String(node.name).padEnd(26)} ${why}${also}${row?.source ? `  via ${row.source}` : ""}`);
    }
    console.log("");
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  });
